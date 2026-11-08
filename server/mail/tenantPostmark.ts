/**
 * Postmark PROPIO de cada empresa para su correo transaccional (decisión del 08/11/2026).
 *
 * Regla de integraciones: credenciales de la propia empresa en la bóveda (proveedor `postmark`, leídas en cada envío);
 * sin configurar, o con un remitente que no es de un dominio propio VERIFICADO de la empresa, no se usa y el correo sale
 * por el servicio de Elephant Source como hasta ahora. Nunca la cuenta de otra empresa ni las variables de la plataforma.
 *
 * Mismo motor que siempre (bandeja de salida, plantillas, idempotencia, reintentos, supresión y política MAIL_MODE): aquí
 * solo se elige el proveedor. Solo correo transaccional por el flujo transaccional (`outbound` por defecto): las
 * categorías comerciales no pasan nunca por Postmark (las campañas siguen en Brevo marketing). Sin seguimiento de
 * aperturas ni clics (lo fija `postmarkProvider` en cada mensaje).
 */
import { isMultiTenant } from "../_core/tenant";
import { credentialFor } from "../_core/credentials/cache";
import { peekTenantIdentity, type TenantRegistryIdentity } from "../_core/tenantIdentity";
import { normalizeEmail } from "./policy";
import { senderDomainVerified } from "./ownSmtp";
import { POSTMARK_API_BASE, type FetchLike } from "./providers";
import { MailProviderError, type MailProviderPort, type ProviderMessage } from "./types";

export const POSTMARK_PROVIDER_ID = "postmark";
export const POSTMARK_DEFAULT_STREAM = "outbound";
/** Webhook de la empresa en el Core, en su propio dominio (fuera de /api/trpc). */
export const TENANT_POSTMARK_WEBHOOK_PATH = "/api/mail/postmark/webhook";

/** Categorías que no son transaccionales: nunca por Postmark de la empresa (envío de siempre). */
export const NON_TRANSACTIONAL_CATEGORIES: ReadonlySet<string> = new Set(["marketing", "survey"]);
export const isTransactionalCategory = (category: string | null | undefined) => !NON_TRANSACTIONAL_CATEGORIES.has(String(category ?? ""));

export interface TenantPostmarkConfig {
  serverToken: string;
  messageStream: string;
  fromEmail: string;
  /** Dominio del remitente: dominio de envío de la política de la empresa cuando sale por Postmark. */
  domain: string;
  webhookToken: string | null;
}

export type PostmarkProblem = "not_configured" | "incomplete" | "sender_invalid" | "domain_not_verified";

export const POSTMARK_PROBLEM_TEXT: Record<PostmarkProblem, string> = {
  not_configured: "Sin configurar: los correos salen por el servicio de Elephant Source.",
  incomplete: "Faltan el token del servidor o la dirección del remitente.",
  sender_invalid: "La dirección del remitente no es válida.",
  domain_not_verified: "El dominio del remitente no es un dominio propio verificado de tu empresa: verifícalo en Ajustes → Dominios. Mientras tanto, los correos salen por el servicio de Elephant Source.",
};

const trim = (v: string | undefined) => (v ?? "").trim();

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
  const webhookToken = trim(values.webhookToken);
  return {
    config: { serverToken, messageStream: trim(values.messageStream) || POSTMARK_DEFAULT_STREAM, fromEmail, domain, webhookToken: webhookToken.length >= 32 ? webhookToken : null },
    problem: null,
    domain,
  };
}

/** Valores de la bóveda de la empresa en curso (precargados por petición o tarea). */
export function tenantPostmarkValues(): Record<string, string | undefined> {
  return {
    serverToken: credentialFor(POSTMARK_PROVIDER_ID, "serverToken"),
    messageStream: credentialFor(POSTMARK_PROVIDER_ID, "messageStream"),
    fromEmail: credentialFor(POSTMARK_PROVIDER_ID, "fromEmail"),
    webhookToken: credentialFor(POSTMARK_PROVIDER_ID, "webhookToken"),
  };
}

/** Postmark de la empresa en curso, o `null` (monoempresa, sin configurar, incompleto o remitente no verificado). */
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
 * Puerto que reparte cada mensaje: por Postmark de la empresa SOLO si es transaccional y su remitente es del dominio
 * de Postmark (lo que se encoló con esa identidad); el resto (comerciales, o mensajes encolados antes con la identidad
 * de la plataforma o del SMTP propio) por el envío de siempre. Devuelve el proveedor que envió de verdad.
 */
export function transactionalRouter(o: { primary: MailProviderPort; primaryDomain: string; fallback: MailProviderPort | null }): MailProviderPort {
  return {
    name: o.primary.name,
    async send(m: ProviderMessage) {
      const usePrimary = isTransactionalCategory(m.tag) && domainOf(m.from.email) === o.primaryDomain.toLowerCase();
      const p = usePrimary ? o.primary : o.fallback;
      if (!p) throw new MailProviderError("no_provider", false);
      const r = await p.send(m);
      return { messageId: r.messageId, provider: r.provider ?? p.name };
    },
  };
}

// ── Consulta de la cuenta (solo lectura; nunca envía) ────────────────────────

export interface PostmarkServerInfo {
  ok: boolean;
  outcome: "connected" | "rejected" | "error";
  message: string;
  serverName: string | null;
  /** «Live» (cuenta aprobada) o «Sandbox» (Postmark no entrega a destinatarios reales). */
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
 * El token del servidor no da acceso a dominios ni firmas (exigen el token de la cuenta, que no se pide): el dominio se
 * comprueba en el registro de la empresa y Postmark rechaza el envío si no está firmado.
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
  if (out.deliveryType === "Sandbox") out.warnings.push("El servidor está en modo Sandbox: Postmark acepta los correos pero no los entrega. Pide la aprobación de la cuenta en Postmark.");
  if (out.serverTrackOpens || (out.serverTrackLinks && out.serverTrackLinks !== "None")) out.warnings.push("El servidor tiene activado el seguimiento por defecto; Elephant Source lo desactiva en cada correo.");
  return { ...out, ok: true, outcome: "connected", message: `Conexión correcta con «${out.serverName ?? "servidor de Postmark"}» (${out.deliveryType ?? "tipo desconocido"}), flujo transaccional «${streamId}»` };
}
