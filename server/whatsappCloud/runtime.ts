/**
 * Ensamblado de Elephant WhatsApp AI en el proceso: almacén en la BD de la empresa en curso, la credencial
 * `whatsapp_cloud` de la bóveda DE LA EMPRESA, la IA central del Core (`invokeLLM`: consumo medido y limitado por
 * empresa), la base de conocimiento y el catálogo publicado que ya usa Reception AI (solo lectura), el cupo diario
 * atómico de reception_ai_cupos (tipo `whatsapp_auto`), la URL pública de su dominio y la licencia `whatsapp-ai`.
 */
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getVault } from "../_core/credentials/runtime";
import { invokeLLM } from "../_core/llm";
import { publicBaseUrl } from "../_core/productIdentity";
import { isMultiTenant } from "../_core/tenant";
import { companyName } from "../tenantBrand";
import { buildKnowledgeBlock } from "../../shared/receptionAi";
import { WHATSAPP_CAPABILITY, WHATSAPP_PROVIDER, WHATSAPP_WEBHOOK_PATH } from "../../shared/whatsappCloud";
import { publishedCatalog } from "../receptionAi/catalog";
import { TenantDbReceptionStore } from "../receptionAi/store";
import type { GraphFetch } from "./graph";
import { WhatsappService, type LlmMessage } from "./service";
import { TenantDbWhatsappStore } from "./store";

/** Tope de tokens de salida de cada respuesta de WhatsApp (el texto se recorta además a 4096 caracteres). */
export const WHATSAPP_MAX_TOKENS = 400;

const store = new TenantDbWhatsappStore();
const reception = new TenantDbReceptionStore();

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === "text" ? String(p.text ?? "") : "")).join("");
  return "";
}

/** ¿Licencia `whatsapp-ai` en la empresa en curso? (`write`: activa; si no, también en solo lectura). */
export async function whatsappLicensed(write: boolean): Promise<boolean> {
  if (!isMultiTenant()) return false;
  try {
    return (await getCapabilityAccess().check(WHATSAPP_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export async function whatsappCredentials(): Promise<Record<string, string>> {
  try {
    return await getVault().resolve(WHATSAPP_PROVIDER);
  } catch {
    return {};
  }
}

/** Conocimiento de la empresa: el de su recepcionista (Reception AI) con el catálogo publicado si lo incluye. */
async function knowledge(): Promise<string> {
  const settings = await reception.settings();
  const [items, catalog] = await Promise.all([reception.knowledge(false), settings.includeCatalog ? publishedCatalog().catch(() => []) : Promise.resolve([])]);
  return buildKnowledgeBlock({ companyName: companyName(), settings, items, catalog });
}

export function whatsappService(o: { fetch?: GraphFetch } = {}): WhatsappService {
  return new WhatsappService({
    store,
    credentials: whatsappCredentials,
    fetch: o.fetch ?? ((url, init) => globalThis.fetch(url, init as RequestInit) as unknown as ReturnType<GraphFetch>),
    llm: async (messages: LlmMessage[]) => {
      const res = await invokeLLM({ messages, maxTokens: WHATSAPP_MAX_TOKENS });
      return textOf(res.choices?.[0]?.message?.content).trim();
    },
    knowledge,
    companyName,
    quota: { reserve: (day, limit) => reception.reserveDaily("whatsapp_auto", day, limit), release: (day) => reception.releaseDaily("whatsapp_auto", day) },
    webhookUrl: () => `${publicBaseUrl().replace(/\/+$/, "")}${WHATSAPP_WEBHOOK_PATH}`,
  });
}
