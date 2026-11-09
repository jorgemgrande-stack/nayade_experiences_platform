/**
 * Ensamblado de Elephant Reception AI en el proceso: almacén en la BD de la empresa en curso, catálogo y reservas del
 * Core, alta de leads del CRM, IA central del Core (`invokeLLM`: consumo medido y limitado por empresa), la credencial
 * `vapi` de la bóveda DE LA EMPRESA, las URL públicas de su dominio y la licencia `reception-ai`.
 */
import crypto from "node:crypto";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getVault } from "../_core/credentials/runtime";
import { meteredFetch } from "../_core/externalMetering";
import { invokeLLM } from "../_core/llm";
import { publicBaseUrl } from "../_core/productIdentity";
import { sessionSecret } from "../_core/sessionSecret";
import { secureEqual } from "../_core/signedLinks";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { createLead } from "../db";
import { companyName } from "../tenantBrand";
import { RECEPTION_CAPABILITY } from "../../shared/receptionAi";
import { publishedCatalog, slotsAndBookings } from "./catalog";
import { ReceptionService, type LlmMessage } from "./service";
import { TenantDbReceptionStore } from "./store";

export const RECEPTION_TOOLS_PATH = "/api/vapi/reception/tools";
export const VAPI_WEBHOOK_PATH = "/api/vapi/webhook";
/** Enlace del chat: `/recepcion/<clave>`; la clave es la firma de la empresa y de la versión del enlace. */
export const CHAT_KEY_RE = /^[A-Za-z0-9_-]{32}$/;
/** Tope de tokens de salida de cada respuesta de la recepcionista (el texto se recorta además a 2000 caracteres). */
export const RECEPTION_MAX_TOKENS = 600;

const store = new TenantDbReceptionStore();
const url = (path: string) => `${publicBaseUrl().replace(/\/+$/, "")}${path}`;

function chatKey(version: number, tenantId: string = getTenantIdOrDefault()): string {
  const secret = sessionSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(`reception-chat:${tenantId}:${version}`).digest("base64url").slice(0, 32);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === "text" ? String(p.text ?? "") : "")).join("");
  return "";
}

/** ¿Licencia `reception-ai` en la empresa en curso? (`write`: activa; si no, también en solo lectura). */
export async function receptionLicensed(write: boolean): Promise<boolean> {
  if (!isMultiTenant()) return false;
  try {
    return (await getCapabilityAccess().check(RECEPTION_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export function receptionService(): ReceptionService {
  return new ReceptionService({
    store,
    companyName,
    catalog: () => publishedCatalog(),
    slots: slotsAndBookings,
    createLead: async (l) => {
      const r = await createLead({ ...l });
      return typeof r === "number" ? r : r.id;
    },
    llm: async (messages: LlmMessage[]) => {
      // Respuestas breves de recepción: tope de salida acotado
      const res = await invokeLLM({ messages, maxTokens: RECEPTION_MAX_TOKENS });
      return textOf(res.choices?.[0]?.message?.content).trim();
    },
    vapi: {
      credentials: async () => {
        const c = await getVault().resolve("vapi");
        return { apiKey: c.apiKey || null, webhookSecret: c.webhookSecret || null };
      },
      fetch: (u, init) => meteredFetch("vapi", u, init, { endpoint: "assistant.upsert" }),
      beforeCall: async () => (await import("../trialRestrictions")).assertIntegrationAllowed("vapi"),
    },
    urls: { tools: () => url(RECEPTION_TOOLS_PATH), webhook: () => url(VAPI_WEBHOOK_PATH), chat: (key) => url(`/recepcion/${key}`) },
    chatKeys: {
      sign: (v) => chatKey(v),
      verify: (key, v) => {
        const expected = chatKey(v);
        return !!expected && CHAT_KEY_RE.test(key) && secureEqual(key, expected);
      },
    },
  });
}
