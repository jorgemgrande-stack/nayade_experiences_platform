/**
 * Postmark PROPIO de cada empresa para su correo transaccional (decisión del 08/11/2026).
 *
 * Regla de integraciones: credenciales de la propia empresa en la bóveda (proveedor `postmark`, leídas en cada envío);
 * sin configurar, sin VERIFICAR o con un remitente que no es de un dominio propio verificado de la empresa, no se usa y el
 * correo sale por el servicio de siempre (SMTP propio o Elephant Source). Nunca la cuenta de otra empresa ni las
 * variables de la plataforma.
 *
 * Verificación: solo se usa si la última comprobación (panel) fue correcta con un servidor Live y un flujo Transactional
 * para ESE token y ese flujo (`verifiedFor`, huella cifrada en la bóveda). Cambiar el token o el flujo exige comprobar de
 * nuevo. Si Postmark rechaza la cuenta al enviar (token revocado, cuenta pendiente, remitente sin firmar), la integración
 * se marca como no sana y ese mismo mensaje sale en el acto por el envío de siempre (sin duplicar: Postmark no lo aceptó).
 *
 * Mismo motor (bandeja, plantillas, idempotencia, reintentos, supresión y MAIL_MODE). Solo categorías transaccionales
 * de una lista explícita; el resto (comerciales, desconocidas, «legacy», comunicados) por el envío de siempre. Sin
 * seguimiento de aperturas ni clics (lo fija `postmarkProvider` en cada mensaje).
 */
import crypto from "node:crypto";
import { isMultiTenant } from "../_core/tenant";
import { credentialFor } from "../_core/credentials/cache";
import { peekTenantIdentity, type TenantRegistryIdentity } from "../_core/tenantIdentity";
import { normalizeEmail } from "./policy";
import { senderDomainVerified } from "./ownSmtp";
import { POSTMARK_API_BASE, type FetchLike } from "./providers";
import { MailProviderError, type MailProviderPort, type ProviderMessage } from "./types";

export const POSTMARK_PROVIDER_ID = "postmark";
/** Etiqueta en la bandeja de los envíos por el Postmark de la empresa (distinta del Postmark de la plataforma). */
export const TENANT_POSTMARK_LABEL = "postmark_tenant";
export const POSTMARK_DEFAULT_STREAM = "outbound";
/** Webhook de la empresa en el Core, en su propio dominio (fuera de /api/trpc). */
export const TENANT_POSTMARK_WEBHOOK_PATH = "/api/mail/postmark/webhook";

/** Únicas categorías que salen por el Postmark de la empresa (transaccionales). Cualquier otra: envío de siempre. */
export const TRANSACTIONAL_CATEGORIES: ReadonlySet<string> = new Set([
  "operational",
  "quote_sent",
  "payment_confirmed",
  "invoice_available",
  "refund_recorded",
  "cancellation",
  "withdrawal_receipt",
  "withdrawal_resolution",
  "contract_invitation",
  "email_verification",
  "user_invite",
  "password_reset",
  "security_notice",
  "data_export",
]);
export const isTransactionalCategory = (category: string | null | undefined) => TRANSACTIONAL_CATEGORIES.has(String(category ?? ""));

export interface TenantPostmarkConfig {
  serverToken: string;
  messageStream: string;
  fromEmail: string;
  /** Dominio del remitente: dominio de envío de la política de la empresa cuando sale por Postmark. */
  domain: string;
  webhookToken: string | null;
}

export type PostmarkProblem = "not_configured" | "incomplete" | "sender_invalid" | "domain_not_verified" | "not_verified";

export const POSTMARK_PROBLEM_TEXT: Record<PostmarkProblem, string> = {
  not_configured: "Sin configurar: los correos salen por el servicio de Elephant Source.",
  incomplete: "Faltan el token del servidor o la dirección del remitente.",
  sender_invalid: "La dirección del remitente no es válida.",
  domain_not_verified: "El dominio del remitente no es un dominio propio verificado de tu empresa: verifícalo en Ajustes → Dominios. Mientras tanto, los correos salen por el servicio de Elephant Source.",
  not_verified: "Pendiente de comprobar (o la última comprobación o un envío fallaron): pulsa «Probar conexión». Mientras tanto, los correos salen por el servicio de Elephant Source.",
};

const trim = (v: string | undefined) => (v ?? "").trim();

/** Huella del token y el flujo comprobados (se guarda cifrada en `verifiedFor`). */
export function postmarkFingerprint(serverToken: string, messageStream: string | undefined): string {
  return crypto.createHash("sha256").update(`postmark-verified\n${trim(serverToken)}\n${trim(messageStream) || POSTMARK_DEFAULT_STREAM}`).digest("hex");
}

/** Configuración a partir de los valores de la bóveda y la identidad de la empresa (función pura). */
export function postmarkConfigFrom(
  values: Record<string, string | undefined>,
  identity: Pick<TenantRegistryIdentity, "customDomains"> | null,
): { config: TenantPostmarkConfig | null; problem: PostmarkProblem | null; domain: string | null } {
  const serverToken = trim(values.serverToken);
  const rawFrom = trim(values.fromEmail);
  if (!serverToken && !rawFrom) return { config: null, problem: "not_configured", domain: null };
  if (!serverToken || !rawFrom) return { config: null, problem: "incomplete", domain: null };
  const fromEmail = normalizeEmail(rawFrom);
  if (!fromEmail) return { config: null, problem: "sender_invalid", domain: null };
  const domain = fromEmail.slice(fromEmail.lastIndexOf("@") + 1);
  if (!senderDomainVerified(domain, identity)) return { config: null, problem: "domain_not_verified", domain };
  const messageStream = trim(values.messageStream) || POSTMARK_DEFAULT_STREAM;
  if (trim(values.verifiedFor) !== postmarkFingerprint(serverToken, messageStream)) return { config: null, problem: "not_verified", domain };
  const webhookToken = trim(values.webhookToken);
  return { config: { serverToken, messageStream, fromEmail, domain, webhookToken: webhookToken.length >= 32 ? webhookToken : null }, problem: null, domain };
}

/** Valores de la bóveda de la empresa en curso (precargados por petición o tarea). */
export function tenantPostmarkValues(): Record<string, string | undefined> {
  const f = (k: string) => credentialFor(POSTMARK_PROVIDER_ID, k);
  return { serverToken: f("serverToken"), messageStream: f("messageStream"), fromEmail: f("fromEmail"), webhookToken: f("webhookToken"), verifiedFor: f("verifiedFor") };
}

/** Postmark de la empresa en curso, o `null` (monoempresa, sin configurar, sin verificar o remitente no verificado). */
export function tenantPostmark(identity: Pick<TenantRegistryIdentity, "customDomains"> | null = isMultiTenant() ? peekTenantIdentity() : null): TenantPostmarkConfig | null {
  if (!isMultiTenant()) return null;
  return postmarkConfigFrom(tenantPostmarkValues(), identity).config;
}

/** Token del webhook de la empresa en curso (el del dominio de la petición), o `null`. */
export function tenantPostmarkWebhookToken(): string | null {
  if (!isMultiTenant()) return null;
  const t = trim(credentialFor(POSTMARK_PROVIDER_ID, "webhookToken"));
  return t.length >= 32 ? t : null;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/**
 * ¿Rechazo de la CUENTA (no del mensaje)? Token no válido o revocado (HTTP 401, código 10), cuenta pendiente de
 * aprobación (412) o remitente sin firma o sin confirmar (400, 401). Todos los envíos fallarían igual.
 */
export function postmarkAccountFailure(e: unknown): boolean {
  if (!(e instanceof MailProviderError)) return false;
  if (e.httpStatus === 401 || e.httpStatus === 412) return true;
  return ["postmark_10", "postmark_412", "postmark_400", "postmark_401", "http_401", "http_412"].includes(e.code);
}

/** Puerto con la identidad del remitente protegida: lo que no es de `domain` sale como `from`. */
export function senderGuard(provider: MailProviderPort | null, o: { domain: string | null; from: string | null }): MailProviderPort | null {
  if (!provider || !o.domain || !o.from) return provider;
  const from = o.from;
  const domain = o.domain.toLowerCase();
  return {
    name: provider.name,
    send: (m) => provider.send(domainOf(m.from.email) === domain ? m : { ...m, from: { ...m.from, email: from } }),
  };
}

/**
 * Puerto que reparte cada mensaje: por Postmark de la empresa SOLO si su categoría es transaccional y su remitente es del
 * dominio de Postmark; el resto por el envío de siempre (`fallback`, con su identidad `fallbackFrom`). Si Postmark
 * rechaza la cuenta, avisa (`onAccountFailure`) y envía ese mismo mensaje por el envío de siempre. Devuelve el proveedor
 * que envió de verdad y, si falla, lo indica en el error.
 */
export function transactionalRouter(o: {
  primary: MailProviderPort;
  primaryDomain: string;
  fallback: MailProviderPort | null;
  fallbackFrom?: string | null;
  onAccountFailure?: (e: MailProviderError) => Promise<void> | void;
}): MailProviderPort {
  const primaryDomain = o.primaryDomain.toLowerCase();
  const toFallback = async (m: ProviderMessage) => {
    if (!o.fallback) throw new MailProviderError("no_provider", false);
    const msg = o.fallbackFrom && domainOf(m.from.email) === primaryDomain ? { ...m, from: { ...m.from, email: o.fallbackFrom } } : m;
    try {
      const r = await o.fallback.send(msg);
      return { messageId: r.messageId, provider: r.provider ?? o.fallback.name };
    } catch (e) {
      if (e instanceof MailProviderError) e.provider = o.fallback.name;
      throw e;
    }
  };
  return {
    name: o.primary.name,
    async send(m: ProviderMessage) {
      const usePrimary = isTransactionalCategory(m.tag) && domainOf(m.from.email) === primaryDomain;
      if (!usePrimary) return toFallback(m);
      try {
        const r = await o.primary.send(m);
        return { messageId: r.messageId, provider: r.provider ?? o.primary.name };
      } catch (e) {
        if (postmarkAccountFailure(e)) {
          await Promise.resolve(o.onAccountFailure?.(e as MailProviderError)).catch(() => undefined);
          return toFallback(m);
        }
        if (e instanceof MailProviderError) e.provider = o.primary.name;
        throw e;
      }
    },
  };
}

// ── Consulta de la cuenta (solo lectura; nunca envía) ────────────────────────

export interface PostmarkServerInfo {
  ok: boolean;
  outcome: "connected" | "rejected" | "error";
  message: string;
  serverName: string | null;
  /** «Live» (cuenta aprobada) o «Sandbox» (Postmark no entrega a destinatarios reales: no se admite). */
  deliveryType: string | null;
  /** Ajustes por defecto del servidor (cada mensaje los desactiva igualmente). */
  serverTrackOpens: boolean | null;
  serverTrackLinks: string | null;
  stream: { id: string; found: boolean; type: string | null; name: string | null };
  warnings: string[];
}

/**
 * Comprueba el token del servidor y el flujo con la API oficial de Postmark, solo lectura:
 *  - GET /server                     https://postmarkapp.com/developer/api/server-api
 *  - GET /message-streams/{streamId} https://postmarkapp.com/developer/api/message-streams-api
 * Correcta solo con servidor Live y flujo Transactional. El token del servidor no da acceso a dominios ni firmas (exigen
 * el token de la cuenta, que no se pide): el dominio se comprueba en el registro de la empresa.
 */
export async function postmarkServerInfo(o: { serverToken: string; messageStream?: string | null; fetch?: FetchLike; baseUrl?: string }): Promise<PostmarkServerInfo> {
  const base = (o.baseUrl ?? POSTMARK_API_BASE).replace(/\/+$/, "");
  const doFetch: FetchLike = o.fetch ?? ((url, init) => fetch(url, init) as never);
  const streamId = trim(o.messageStream ?? "") || POSTMARK_DEFAULT_STREAM;
  const out: PostmarkServerInfo = { ok: false, outcome: "error", message: "", serverName: null, deliveryType: null, serverTrackOpens: null, serverTrackLinks: null, stream: { id: streamId, found: false, type: null, name: null }, warnings: [] };
  const get = async (path: string): Promise<{ status: number; json: any } | null> => {
    try {
      const r = await doFetch(`${base}${path}`, { method: "GET", headers: { accept: "application/json", "X-Postmark-Server-Token": o.serverToken }, signal: AbortSignal.timeout(8000) });
      const json = typeof r.json === "function" ? await r.json().catch(() => null) : null;
      return { status: r.status, json };
    } catch {
      return null;
    }
  };
  const srv = await get("/server");
  if (!srv) return { ...out, message: "No se pudo contactar con Postmark" };
  if (srv.status === 401 || srv.status === 403 || (srv.status === 422 && srv.json?.ErrorCode === 10)) return { ...out, outcome: "rejected", message: "Postmark rechaza el token del servidor" };
  if (srv.status === 412 || srv.json?.ErrorCode === 412) return { ...out, outcome: "rejected", message: "La cuenta de Postmark está pendiente de aprobación" };
  if (srv.status !== 200) return { ...out, message: `Postmark respondió ${srv.status}` };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  out.serverName = str(srv.json?.Name);
  out.deliveryType = str(srv.json?.DeliveryType);
  out.serverTrackOpens = typeof srv.json?.TrackOpens === "boolean" ? srv.json.TrackOpens : null;
  out.serverTrackLinks = str(srv.json?.TrackLinks);
  const st = await get(`/message-streams/${encodeURIComponent(streamId)}`);
  if (!st || st.status !== 200) {
    return { ...out, message: st ? `El flujo «${streamId}» no existe en este servidor de Postmark` : "No se pudo consultar el flujo de mensajes" };
  }
  out.stream = { id: streamId, found: true, type: str(st.json?.MessageStreamType), name: str(st.json?.Name) };
  if (out.stream.type !== "Transactional") {
    return { ...out, message: `El flujo «${streamId}» es de tipo ${out.stream.type ?? "desconocido"}: elige un flujo transaccional (las campañas van por Brevo marketing)` };
  }
  if (out.deliveryType !== "Live") {
    return { ...out, message: `El servidor de Postmark está en modo ${out.deliveryType ?? "desconocido"}: Postmark acepta los correos pero no los entrega. Pide la aprobación de la cuenta en Postmark y vuelve a comprobar.` };
  }
  if (out.serverTrackOpens || (out.serverTrackLinks && out.serverTrackLinks !== "None")) out.warnings.push("El servidor tiene activado el seguimiento por defecto; Elephant Source lo desactiva en cada correo.");
  return { ...out, ok: true, outcome: "connected", message: `Conexión correcta con «${out.serverName ?? "servidor de Postmark"}» (Live), flujo transaccional «${streamId}»` };
}
