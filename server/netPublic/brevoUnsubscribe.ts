/**
 * Elephant Connect · Campaigns (Brevo): baja pública de las comunicaciones comerciales (capacidad `email-campaigns`).
 *
 *  - Enlace sin estado: `/baja/<cliente>.<firma>`, firma HMAC-SHA256 con NET_UNSUBSCRIBE_SECRET (o, sin ella, JWT_SECRET) sobre
 *    `brevo-unsub:<empresa>:<cliente>`. Un enlace de una empresa no vale en otra (la firma incluye la empresa) y no
 *    caduca: una baja tiene que poder pedirse siempre. Nada se guarda para el enlace (no hay token que robar de la BD).
 *  - La baja la registra BrevoMarketingService.publicUnsubscribe: retira el consentimiento existente con su fila del
 *    historial (idempotente) y la propaga a la lista de Brevo SOLO con la clave propia de la empresa configurada.
 *  - La página pide confirmar con un botón (POST) para que los antivirus y vistas previas que abren enlaces no den de
 *    baja a nadie; también acepta el POST de un solo clic de los gestores de correo (RFC 8058).
 *  - Respuesta igual exista o no el cliente; una firma no válida, «enlace no válido».
 */
import crypto from "node:crypto";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { sessionSecret } from "../_core/sessionSecret";
import { secureEqual } from "../_core/signedLinks";
import { getTenantIdOrDefault } from "../_core/tenant";
import { BREVO_CAPABILITY, brevoMarketingService } from "../brevoMarketing/runtime";
import { publicUrl } from "./html";

export const UNSUB_TOKEN_RE = /^(\d{1,10})\.([A-Za-z0-9_-]{32})$/;

/**
 * Claves de firma: la propia de las bajas (`NET_UNSUBSCRIBE_SECRET`, opcional) y la de sesiones como respaldo. Se firma
 * con la propia si existe y se acepta la firma de cualquiera de las dos: rotar JWT_SECRET (cerrar sesiones) no invalida
 * los enlaces de baja ya enviados si hay clave propia, y los firmados antes de configurarla siguen valiendo mientras
 * no cambie JWT_SECRET.
 */
function unsubscribeKeys(): string[] {
  const own = (process.env.NET_UNSUBSCRIBE_SECRET ?? "").trim();
  const session = sessionSecret();
  return Array.from(new Set([own.length >= 32 ? own : "", session ?? ""].filter(Boolean)));
}

function macWith(key: string, clientId: number, tenantId: string): string {
  return crypto.createHmac("sha256", key).update(`brevo-unsub:${tenantId}:${clientId}`).digest("base64url").slice(0, 32);
}

function mac(clientId: number, tenantId: string): string {
  const [key] = unsubscribeKeys();
  return key ? macWith(key, clientId, tenantId) : "";
}

export function unsubscribeToken(clientId: number, tenantId: string = getTenantIdOrDefault()): string {
  return `${clientId}.${mac(clientId, tenantId)}`;
}

/** Cliente del enlace con firma válida para la empresa en curso; si no, null. */
export function verifyUnsubscribeToken(token: unknown, tenantId: string = getTenantIdOrDefault()): number | null {
  if (typeof token !== "string") return null;
  const m = UNSUB_TOKEN_RE.exec(token);
  if (!m) return null;
  const clientId = Number(m[1]);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return null;
  return unsubscribeKeys().some((k) => secureEqual(m[2], macWith(k, clientId, tenantId))) ? clientId : null;
}

export const unsubscribeUrl = (clientId: number) => publicUrl(`/baja/${unsubscribeToken(clientId)}`);

/** ¿Está la baja disponible? Con la capacidad activa o en solo lectura: una baja nunca se bloquea por el plan. */
export async function unsubscribeAvailable(): Promise<boolean> {
  try {
    const d = await getCapabilityAccess().check(BREVO_CAPABILITY, { write: false });
    return d.allowed;
  } catch {
    return false;
  }
}

export function unsubscribe(clientId: number) {
  return brevoMarketingService().publicUnsubscribe(clientId);
}
