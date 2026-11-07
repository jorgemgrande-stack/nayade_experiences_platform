/**
 * Elephant Connect · Campaigns (Brevo): baja pública de las comunicaciones comerciales (capacidad `email-campaigns`).
 *
 *  - Enlace sin estado: `/baja/<cliente>.<firma>`, firma HMAC-SHA256 con la clave de sesiones (JWT_SECRET) sobre
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

function mac(clientId: number, tenantId: string): string {
  const key = sessionSecret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(`brevo-unsub:${tenantId}:${clientId}`).digest("base64url").slice(0, 32);
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
  const expected = mac(clientId, tenantId);
  return expected && secureEqual(m[2], expected) ? clientId : null;
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
