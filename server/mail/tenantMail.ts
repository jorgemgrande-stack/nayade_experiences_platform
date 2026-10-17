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
import { mailProviderFromEnv } from "./providers";
import { MailService } from "./service";
import { MysqlMailStore } from "./store";
import type { MailCategory, MailProviderPort } from "./types";

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
/** Solo pruebas: sustituye el proveedor del entorno (p. ej. por uno en memoria). `undefined` lo restaura. */
export function setTenantMailProviderForTests(p: MailProviderPort | null | undefined): void {
  providerOverride = p;
  ready.clear();
}

/** Servicio de correo de la empresa en curso, o `null` (sin base o sin migración). */
export async function tenantMailService(): Promise<MailService | null> {
  const tenantId = getTenantIdOrDefault();
  const db = await getTenantDatabase();
  if (!db) return null;
  const pool = (db as unknown as { $client: mysql.Pool }).$client;
  if (!(await outboxReady(tenantId, pool))) return null;
  return new MailService({
    lane: "tenant",
    store: new MysqlMailStore(pool),
    provider: providerOverride !== undefined ? providerOverride : mailProviderFromEnv(process.env),
    policy: mailPolicyFromEnv(process.env),
    tenantId,
  });
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);

/** Envía (vía bandeja de salida) un correo de la empresa en curso. `true` si la API del proveedor lo aceptó. */
export async function sendTenantMail(p: TenantMailParams): Promise<boolean> {
  const svc = await tenantMailService().catch(() => null);
  if (!svc) {
    opsLog("error", "Mail", "not_sent", { lane: "tenant", reason: "outbox_missing", category: p.category ?? "legacy" });
    return false;
  }
  const comms = tenantCommsConfig();
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
      subject: p.subject,
      html: p.html,
      text: p.text,
      // Contenido de ficheros privados del almacenamiento (ya leído por el mailer) en base64 para la bandeja
      attachments: p.attachments?.map((a) => (a.content ? { name: a.name, url: a.url, content: a.content.toString("base64") } : { name: a.name, url: a.url })),
      // La dirección propia de la empresa (si la configuró) recibe las respuestas; nunca es el From
      sender: { lane: "tenant", brandName: comms.fromName, replyTo: comms.replyTo ?? comms.fromEmail },
      guard,
    });
    if (!(r.status === "accepted" || r.status === "delivered")) allOk = false;
  }
  // Reintentos pendientes de la empresa, sin esperar al ciclo periódico
  void svc.drain(3).catch(() => undefined);
  return tos.length > 0 && allOk;
}

/** Reintentos vencidos de la empresa en curso (lo llama la tarea periódica por empresa). */
export async function drainTenantOutbox(limit = 50): Promise<number> {
  const svc = await tenantMailService().catch(() => null);
  return svc ? svc.drain(limit) : 0;
}
