/**
 * Política de envío: modo (off/sandbox/live), lista de destinatarios autorizados en sandbox, identidad del
 * remitente por empresa, límites de frecuencia, reintentos y guarda de enlaces. Funciones puras.
 *
 * Variables (ver docs/runbooks/CORREO_BREVO.md):
 *   MAIL_MODE                 off (por defecto) | sandbox | live
 *   MAIL_SANDBOX_ALLOWLIST    direcciones o dominios autorizados en sandbox, separados por comas
 *   MAIL_LIVE_AUTHORIZED      «1» para permitir live (lo pone el propietario; sin él, live → off)
 *   MAIL_SENDING_DOMAIN       dominio de envío autenticado en el proveedor (From: no-reply@<dominio>)
 *   ELEPHANT_SUPPORT_EMAIL    Reply-To de los avisos de plataforma (si falta, no se muestra)
 *   MAIL_RATE_TENANT_PER_HOUR / MAIL_RATE_RECIPIENT_PER_HOUR   límites (300 / 8)
 *   MAIL_MAX_ATTEMPTS         intentos de envío antes de «failed» (5)
 */
import crypto from "node:crypto";
import { maskEmail } from "../_core/ops/log";
import type { MailAddress, MailMode } from "./types";

export interface MailPolicy {
  /** Modo EFECTIVO (un live sin autorización o un sandbox sin lista quedan en off). */
  mode: MailMode;
  /** Por qué el modo efectivo no es el pedido. */
  degradedReason: string | null;
  allowDomains: ReadonlySet<string>;
  allowAddresses: ReadonlySet<string>;
  sendingDomain: string | null;
  supportEmail: string | null;
  limits: { tenantPerHour: number; recipientPerHour: number };
  retry: { maxAttempts: number; baseMs: number; capMs: number; lockMs: number };
}

const EMAIL_RE = /^[^\s@<>"',;:()\\[\]]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Dirección normalizada (minúsculas, sin espacios) o `null` si no es válida (también con saltos de línea). */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || /[\r\n]/.test(raw)) return null;
  return EMAIL_RE.test(v) ? v : null;
}

/** Huella del destinatario (límites y supresiones sin guardar la dirección). */
export function recipientHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export const maskRecipient = (email: string) => maskEmail(email).slice(0, 200);

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
};

export function mailPolicyFromEnv(env: NodeJS.ProcessEnv): MailPolicy {
  const raw = (env.MAIL_MODE ?? "off").trim().toLowerCase();
  let mode: MailMode = raw === "sandbox" || raw === "live" ? raw : "off";
  let degradedReason: string | null = raw !== "" && raw !== mode ? "unknown_mode" : null;
  const allowDomains = new Set<string>();
  const allowAddresses = new Set<string>();
  for (const item of (env.MAIL_SANDBOX_ALLOWLIST ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (item.includes("@")) {
      const e = normalizeEmail(item);
      if (e) allowAddresses.add(e);
    } else if (HOST_RE.test(item.replace(/^@/, ""))) allowDomains.add(item.replace(/^@/, ""));
  }
  const sendingDomain = HOST_RE.test((env.MAIL_SENDING_DOMAIN ?? "").trim().toLowerCase()) ? env.MAIL_SENDING_DOMAIN!.trim().toLowerCase() : null;
  if (mode === "live" && env.MAIL_LIVE_AUTHORIZED !== "1") [mode, degradedReason] = ["off", "live_not_authorized"];
  if (mode === "sandbox" && allowDomains.size + allowAddresses.size === 0) [mode, degradedReason] = ["off", "sandbox_without_allowlist"];
  if (mode !== "off" && !sendingDomain) [mode, degradedReason] = ["off", "sending_domain_missing"];
  return {
    mode,
    degradedReason,
    allowDomains,
    allowAddresses,
    sendingDomain,
    supportEmail: normalizeEmail(env.ELEPHANT_SUPPORT_EMAIL ?? ""),
    limits: { tenantPerHour: int(env.MAIL_RATE_TENANT_PER_HOUR, 300, 1, 100_000), recipientPerHour: int(env.MAIL_RATE_RECIPIENT_PER_HOUR, 8, 1, 1000) },
    retry: { maxAttempts: int(env.MAIL_MAX_ATTEMPTS, 5, 1, 20), baseMs: 60_000, capMs: 3_600_000, lockMs: 120_000 },
  };
}

/** ¿Puede salir un correo hacia esta dirección (ya normalizada) con el modo efectivo? */
export function recipientAllowed(p: Pick<MailPolicy, "mode" | "allowDomains" | "allowAddresses">, email: string): boolean {
  if (p.mode === "live") return true;
  if (p.mode === "sandbox") return p.allowAddresses.has(email) || p.allowDomains.has(domainOf(email));
  return false;
}

/** Espera antes del intento `attempt + 1` (1 min, 2, 4, 8… con tope de 1 h). */
export function backoffMs(p: Pick<MailPolicy, "retry">, attempt: number): number {
  return Math.min(p.retry.capMs, p.retry.baseMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * Nombre visible del remitente: sin caracteres que permitan inyectar cabeceras ni hacerse pasar por una
 * dirección («soporte@banco.example» como nombre). Máximo 70 caracteres.
 */
export function sanitizeDisplayName(raw: string): string {
  return raw.replace(/[<>"\r\n@\\;,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70).trim();
}

export const PLATFORM_BRAND = "Elephant Source";

/** Logotipo oficial (imagen pública de la web; los correos cargan imágenes por URL absoluta). */
export const DEFAULT_MAIL_LOGO_URL = "https://www.bigelephant.es/brand/big-elephant-logo.png";
/** Emisor que firma los avisos de plataforma (titular confirmado del servicio). */
export const PLATFORM_LEGAL_LINE = "Elephant Source es un servicio de IRON ELEPHANT CONSULTING, S.L. · NIF B26987875 · Calle Corazón de María, 57, 1.º D, 28002 Madrid";

/**
 * Identidad visual de los avisos de PLATAFORMA: logotipo (`MAIL_LOGO_URL`, https; vacío = sin imagen) y línea del
 * emisor. Los avisos de una EMPRESA no la usan: llevan su propia marca y nunca la de la plataforma.
 */
export function platformIdentity(env: Record<string, string | undefined> = process.env): { logoUrl: string | null; legal: string } {
  const raw = env.MAIL_LOGO_URL === undefined ? DEFAULT_MAIL_LOGO_URL : env.MAIL_LOGO_URL.trim();
  let logoUrl: string | null = null;
  try {
    logoUrl = raw && new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    logoUrl = null;
  }
  return { logoUrl, legal: PLATFORM_LEGAL_LINE };
}

/**
 * Remitente. Nunca se usa una dirección elegida por la empresa como From: siempre
 * `<nombre comercial> <no-reply@{MAIL_SENDING_DOMAIN}>`, con `Reply-To` hacia la empresa (tenant) o el
 * soporte de plataforma (si está configurado). Sin dominio o sin nombre, `null`: no se envía.
 */
export function senderFor(p: Pick<MailPolicy, "sendingDomain" | "supportEmail">, who: { lane: "tenant"; brandName: string; replyTo: string | null; fromEmail?: string | null } | { lane: "platform" }): { from: MailAddress; replyTo: string | null } | null {
  if (!p.sendingDomain) return null;
  const email = `no-reply@${p.sendingDomain}`;
  if (who.lane === "platform") return { from: { name: PLATFORM_BRAND, email }, replyTo: p.supportEmail };
  const name = sanitizeDisplayName(who.brandName);
  if (!name) return null;
  // SMTP propio de la empresa: su dirección, solo si es del dominio de envío de su política (verificado)
  const own = who.fromEmail ? normalizeEmail(who.fromEmail) : null;
  if (who.fromEmail && (!own || domainOf(own) !== p.sendingDomain)) return null;
  return { from: { name, email: own ?? email }, replyTo: normalizeEmail(who.replyTo ?? "") };
}

/** Hosts de los enlaces (href) http(s) de un HTML. */
export function linkHosts(html: string): string[] {
  const out = new Set<string>();
  for (const m of Array.from(html.matchAll(/href\s*=\s*["']\s*(https?:\/\/[^"'\s]+)/gi))) {
    try {
      out.add(new URL(m[1]).hostname.toLowerCase());
    } catch {
      /* enlace no válido: no cuenta */
    }
  }
  return Array.from(out);
}

/**
 * Enlaces prohibidos en un correo de empresa en multiempresa: hacia Náyade o hacia el host global de la
 * instalación (`APP_URL`) cuando no es el de la propia empresa. Devuelve los hosts encontrados.
 */
export function forbiddenLinkHosts(html: string, o: { tenantHosts: string[]; appUrl?: string | null }): string[] {
  const own = new Set(o.tenantHosts.map((h) => h.toLowerCase()));
  let appHost: string | null = null;
  try {
    appHost = o.appUrl ? new URL(o.appUrl).hostname.toLowerCase() : null;
  } catch {
    appHost = null;
  }
  return linkHosts(html).filter((h) => !own.has(h) && (/(^|\.)nayadeexperiences\.es$/.test(h) || (appHost !== null && h === appHost)));
}
