/**
 * Correo de la EMPRESA en el Core: `sendEmail()` (server/mailer.ts) entra aquí en multiempresa o cuando
 * `MAIL_MODE` está definido. Bandeja de salida en la base de la propia empresa (db/migrations/0010).
 *
 *  - Remitente: `<nombre comercial> <no-reply@MAIL_SENDING_DOMAIN>` con Reply-To de la empresa
 *    (`tenantCommsConfig`). La dirección «email_from_address» de la empresa NO se usa como From: una
 *    empresa no puede enviar con una identidad que no es la suya.
 *  - Multiempresa: se rechazan los correos con enlaces a Náyade o al host global (`APP_URL`) cuando no
 *    es el de la empresa (`forbidden_link_host`).
 *  - Sin la migración aplicada en la base de la empresa no se envía (`outbox_missing`): falla cerrado.
 */
import type mysql from "mysql2/promise";
import { getTenantDatabase } from "../_core/dbRegistry";
import { getTenantIdOrDefault, isMultiTenant } from "../_core/tenant";
import { peekTenantIdentity } from "../_core/tenantIdentity";
import { opsLog } from "../_core/ops/log";
import { tenantCommsConfig } from "../tenantBrand";
import { forbiddenLinkHosts, mailPolicyFromEnv } from "./policy";
import { mailProviderFromEnv, postmarkProvider, smtpProvider, type FetchLike } from "./providers";
import { tenantOwnSmtp } from "./ownSmtp";
import { TENANT_POSTMARK_LABEL, isTransactionalCategory, senderGuard, tenantPostmark, transactionalRouter } from "./tenantPostmark";
import { markPostmarkUnhealthy } from "./tenantPostmarkHealth";
import { MailService } from "./service";
import { MysqlMailStore } from "./store";
import type { MailCategory, MailProviderError, MailProviderPort } from "./types";
import { cleanSubject, dropEmptyContactLinks, htmlToText } from "./plainText";

export interface TenantMailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  attachments?: { name: string; url: string; content?: Buffer }[];
  category?: MailCategory;
  idempotencyKey?: string;
}

/** ¿Pasa `sendEmail` por el servicio centralizado? Siempre en multi; en single solo si se define MAIL_MODE. */
export function usesMailService(env: NodeJS.ProcessEnv = process.env): boolean {
  return isMultiTenant() || (env.MAIL_MODE ?? "").trim() !== "";
}

// Comprobación de la tabla por empresa: positiva para siempre, negativa durante 60 s
const ready = new Map<string, number | true>();
async function outboxReady(tenantId: string, pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  const c = ready.get(tenantId);
  if (c === true) return true;
  if (typeof c === "number" && Date.now() - c < 60_000) return false;
  const ok = await pool.query("SELECT 1 FROM mail_outbox LIMIT 0").then(() => true, () => false);
  ready.set(tenantId, ok ? true : Date.now());
  return ok;
}

let providerOverride: MailProviderPort | null | undefined;
let postmarkFetchOverride: FetchLike | undefined;
/**
 * Solo pruebas: sustituye el proveedor del entorno (p. ej. por uno en memoria). `undefined` lo restaura. Con Postmark
 * de la empresa configurado, sustituye al envío de siempre (el respaldo), no a Postmark.
 */
export function setTenantMailProviderForTests(p: MailProviderPort | null | undefined): void {
  providerOverride = p;
  ready.clear();
}
/** Solo pruebas: `fetch` falso para el Postmark de la empresa (ninguna llamada real). `undefined` lo restaura. */
export function setTenantPostmarkFetchForTests(f: FetchLike | undefined): void {
  postmarkFetchOverride = f;
}
let postmarkFailureHook: ((e: MailProviderError) => Promise<void>) | undefined;
/** Solo pruebas: sustituye lo que se hace cuando Postmark rechaza la cuenta (por defecto, marcarla no sana). */
export function setTenantPostmarkFailureHookForTests(f: ((e: MailProviderError) => Promise<void>) | undefined): void {
  postmarkFailureHook = f;
}

/**
 * Vía por la que sale un correo de la empresa: el servicio central de la plataforma (coste de Big Elephant, se mide como
 * `email.sent` y cuenta para la cuota) o una cuenta propia de la empresa, Postmark o SMTP (la paga su titular: se mide
 * aparte como `email.own.sent`, sin coste ni cuota de la plataforma).
 */
export type MailRoute = "platform" | "own_postmark" | "own_smtp";

/** Puerto que avisa (`onRoute`) de la vía de cada mensaje que el proveedor ACEPTA. Sin aviso, el mismo puerto. */
function routeTagged(port: MailProviderPort | null, route: MailRoute, onRoute: ((route: MailRoute) => void) | undefined): MailProviderPort | null {
  if (!port || !onRoute) return port;
  return {
    name: port.name,
    async send(m) {
      const r = await port.send(m);
      try {
        onRoute(route);
      } catch {
        // Medir no puede afectar al envío
      }
      return r;
    },
  };
}

/**
 * Vía prevista para un correo de esta categoría en la empresa en curso (antes de enviarlo): Postmark propio si es
 * transaccional y está activo, SMTP propio si está configurado y, si no, la plataforma. La vía real puede ser la
 * plataforma cuando la cuenta propia falla (envío alternativo): la indica `sendTenantMail`.
 */
export function predictedMailRoute(category: string | null | undefined): MailRoute {
  if (!isMultiTenant()) return "platform";
  if (tenantPostmark() && isTransactionalCategory(category ?? "legacy")) return "own_postmark";
  return tenantOwnSmtp() ? "own_smtp" : "platform";
}

/**
 * Vía con la que se mide un envío: la plataforma si algún mensaje salió por ella (también el envío alternativo); si no,
 * la cuenta propia que lo aceptó; sin ninguna aceptación (fallo, omitido o reintento pendiente), la prevista.
 */
export function meteredMailRoute(used: ReadonlySet<MailRoute>, predicted: MailRoute): MailRoute {
  if (used.has("platform")) return "platform";
  if (used.has("own_postmark")) return "own_postmark";
  if (used.has("own_smtp")) return "own_smtp";
  return predicted;
}

/**
 * Servicio de correo de la empresa en curso, o `null` (sin base o sin migración). Proveedor, por orden: Postmark propio
 * de la empresa (solo transaccional y con su dominio verificado), SMTP propio (dominio verificado) o el servicio
 * central. `category` decide la identidad del remitente al encolar: una comercial nunca usa la de Postmark.
 */
export async function tenantMailService(o: { category?: string; onRoute?: (route: MailRoute) => void } = {}): Promise<MailService | null> {
  const tenantId = getTenantIdOrDefault();
  const db = await getTenantDatabase();
  if (!db) return null;
  const pool = (db as unknown as { $client: mysql.Pool }).$client;
  if (!(await outboxReady(tenantId, pool))) return null;
  const own = tenantOwnSmtp();
  const pm = tenantPostmark();
  // Envío de siempre con SU identidad: un mensaje encolado con otra (p. ej. la de Postmark, si la cuenta falló o se
  // desconectó) sale con la dirección del SMTP propio o con no-reply de la plataforma, nunca con un dominio ajeno
  const platformDomain = (process.env.MAIL_SENDING_DOMAIN ?? "").trim().toLowerCase() || null;
  const fallbackDomain = own ? own.domain : platformDomain;
  const fallbackFrom = own ? own.fromEmail : platformDomain ? `no-reply@${platformDomain}` : null;
  const fallback = routeTagged(
    senderGuard(providerOverride !== undefined ? providerOverride : own ? smtpProvider(own.config) : mailProviderFromEnv(process.env), { domain: fallbackDomain, from: fallbackFrom }),
    own ? "own_smtp" : "platform",
    o.onRoute,
  );
  const provider = pm
    ? transactionalRouter({
        primary: routeTagged({ ...postmarkProvider({ serverToken: pm.serverToken, messageStream: pm.messageStream, fetch: postmarkFetchOverride }), name: TENANT_POSTMARK_LABEL }, "own_postmark", o.onRoute)!,
        primaryDomain: pm.domain,
        fallback,
        fallbackFrom,
        onAccountFailure: postmarkFailureHook ?? markPostmarkUnhealthy,
      })
    : fallback;
  // Misma política de envío (MAIL_MODE, sandbox, límites); solo cambia el dominio del remitente
  const domain = pm && isTransactionalCategory(o.category) ? pm.domain : own ? own.domain : null;
  return new MailService({
    lane: "tenant",
    store: new MysqlMailStore(pool),
    provider,
    policy: mailPolicyFromEnv(domain ? { ...process.env, MAIL_SENDING_DOMAIN: domain } : process.env),
    tenantId,
  });
}

/** Dirección propia del remitente para un aviso de esta categoría (Postmark o SMTP de la empresa), o `null` (plataforma). */
function ownSenderFor(category: string): string | null {
  const pm = tenantPostmark();
  if (pm && isTransactionalCategory(category)) return pm.fromEmail;
  return tenantOwnSmtp()?.fromEmail ?? null;
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);

/**
 * Envía (vía bandeja de salida) un correo de la empresa en curso. `true` si la API del proveedor lo aceptó. `onRoute`
 * recibe la vía de cada mensaje aceptado (para medir el consumo de la plataforma aparte del de las cuentas propias).
 */
export async function sendTenantMail(p: TenantMailParams, onRoute?: (route: MailRoute) => void): Promise<boolean> {
  // Solo los mensajes de ESTE envío: los reintentos pendientes que se drenan al final no se atribuyen a él
  let open = true;
  const svc = await tenantMailService({ category: p.category ?? "legacy", onRoute: onRoute && ((r) => open && onRoute(r)) }).catch(() => null);
  if (!svc) {
    opsLog("error", "Mail", "not_sent", { lane: "tenant", reason: "outbox_missing", category: p.category ?? "legacy" });
    return false;
  }
  const comms = tenantCommsConfig();
  const ownFrom = ownSenderFor(p.category ?? "legacy");
  const identity = isMultiTenant() ? peekTenantIdentity() : null;
  const hosts = identity ? [identity.publicHost, ...identity.customDomains.filter((d) => d.state === "verified").map((d) => d.domain)].filter((h): h is string => !!h) : [];
  const guard = isMultiTenant() ? (html: string) => (forbiddenLinkHosts(html, { tenantHosts: hosts, appUrl: process.env.APP_URL }).length ? "forbidden_link_host" : null) : undefined;
  const tenantId = getTenantIdOrDefault();
  let allOk = true;
  const tos = list(p.to);
  for (let i = 0; i < tos.length; i++) {
    const to = tos[i];
    const r = await svc.send({
      tenantId,
      idempotencyKey: p.idempotencyKey ? (tos.length > 1 ? `${p.idempotencyKey}:${i}` : p.idempotencyKey) : "",
      category: p.category ?? "legacy",
      to,
      cc: list(p.cc),
      subject: cleanSubject(p.subject),
      html: dropEmptyContactLinks(p.html),
      // Sin versión de texto, se genera a partir del HTML (mejor entrega y accesibilidad)
      text: p.text || htmlToText(dropEmptyContactLinks(p.html)),
      // Contenido de ficheros privados del almacenamiento (ya leído por el mailer) en base64 para la bandeja
      attachments: p.attachments?.map((a) => (a.content ? { name: a.name, url: a.url, content: a.content.toString("base64") } : { name: a.name, url: a.url })),
      // La dirección propia de la empresa (si la configuró) recibe las respuestas; nunca es el From
      sender: { lane: "tenant", brandName: comms.fromName, replyTo: comms.replyTo ?? comms.fromEmail, fromEmail: ownFrom },
      guard,
    });
    if (!(r.status === "accepted" || r.status === "delivered")) allOk = false;
  }
  // Reintentos pendientes de la empresa, sin esperar al ciclo periódico
  open = false;
  void svc.drain(3).catch(() => undefined);
  return tos.length > 0 && allOk;
}

/** Reintentos vencidos de la empresa en curso (lo llama la tarea periódica por empresa). */
export async function drainTenantOutbox(limit = 50): Promise<number> {
  const svc = await tenantMailService().catch(() => null);
  return svc ? svc.drain(limit) : 0;
}
