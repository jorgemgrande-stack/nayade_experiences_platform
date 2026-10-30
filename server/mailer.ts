/**
 * mailer.ts — Sistema de envío de emails
 *
 * Estrategia dual:
 *   1. PRIMARIO: Brevo HTTP API (puerto 443 HTTPS — funciona desde Railway/cloud)
 *   2. FALLBACK:  Nodemailer SMTP (solo funciona si el host no bloquea puertos SMTP)
 *
 * Railway bloquea conexiones SMTP salientes (465/587), por lo que el modo
 * primario es siempre la API HTTP de Brevo cuando BREVO_API_KEY está definida.
 *
 * Variables de entorno necesarias:
 *   BREVO_API_KEY   — clave API de Brevo (preferido en Railway)
 *   SMTP_FROM       — remitente visible, ej: "Skicenter <reservas@nayadeexperiences.es>"
 *   SMTP_HOST/PORT/USER/PASS/SECURE — fallback SMTP (entornos locales o no-cloud)
 */

import nodemailer from "nodemailer";
import { Metrics, meter } from "./_core/metering";
import { enforceQuota } from "./_core/erm/runtime";
import { QuotaExceededError } from "./_core/erm/types";
import { maskEmail, opsLog } from "./_core/ops/log";
import { recordFailure } from "./_core/ops/failureAlerts";

/** Destinatarios para los logs: nunca la dirección completa. */
const maskTo = (to: string | string[]) => (Array.isArray(to) ? to : [to]).map(maskEmail).join(", ");
import { isMultiTenant } from "./_core/tenant";
import { getSystemSettingSync } from "./config";
import { brandName, tenantCommsConfig } from "./tenantBrand";
import type { MailCategory } from "./mail/types";
import { readStoredFile } from "./storage";
import { objectIdFromUrl } from "./_core/files/service";
import { cleanSubject } from "./mail/plainText";

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface MailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  /**
   * Adjuntos por URL. Si la URL es de un fichero del almacenamiento del Core (privado), se adjunta su
   * CONTENIDO (el proveedor de correo no puede descargarlo); el resto se adjunta por URL.
   */
  attachments?: { name: string; url: string; content?: Buffer }[];
  /** Tipo de aviso (servicio de correo centralizado: trazas y límites). */
  category?: MailCategory;
  /** Clave de idempotencia: el mismo aviso con la misma clave sale una sola vez. */
  idempotencyKey?: string;
}

// ─── Helper: parsea el SMTP_FROM en nombre + email ───────────────────────────
function parseSender(raw: string): { name: string; email: string } {
  // Formatos: "Nombre <email>" o solo "email"
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: brandName(), email: raw.trim() };
}

/**
 * Remitente en multiempresa: NUNCA el de Náyade ni el buzón global de la plataforma como
 * propio. Se usa la configuración de comunicaciones del tenant (`tenantCommsConfig`: remitente
 * verificado, nombre y responder-a) o, sin remitente propio, el de plataforma
 * (`PLATFORM_MAIL_FROM`) con el nombre del tenant y `Reply-To` hacia el correo del propio
 * tenant. Sin remitente o sin nombre, no se envía (falla cerrado).
 */
export function resolveTenantSender(): { from: string; replyTo?: string } | null {
  const c = tenantCommsConfig();
  const address = c.fromEmail || (process.env.PLATFORM_MAIL_FROM ?? "");
  if (!address || !c.fromName) return null;
  return { from: `${c.fromName} <${address}>`, replyTo: c.replyTo ?? undefined };
}

// ─── Modo 1: Brevo HTTP API ───────────────────────────────────────────────────
async function sendViaBrevoApi(params: MailParams): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;

  const noreplyEmail = getSystemSettingSync("email_noreply_sender", "");
  const brandName = getSystemSettingSync("brand_name", "Skicenter");
  let replyToEmail: string | undefined;
  let fromRaw: string;
  if (isMultiTenant()) {
    const t = resolveTenantSender();
    if (!t) {
      console.warn("[Mailer] Tenant sin remitente configurado: no se envía");
      return false;
    }
    fromRaw = t.from;
    replyToEmail = t.replyTo;
  } else {
    fromRaw = params.from
      ?? process.env.SMTP_FROM
      ?? (noreplyEmail ? `${brandName} <${noreplyEmail}>` : `${brandName} <noreply@example.com>`);
  }
  const sender = parseSender(fromRaw);

  const toList = Array.isArray(params.to)
    ? params.to.map(e => ({ email: e }))
    : [{ email: params.to }];

  const ccList = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc]).map(e => ({ email: e }))
    : undefined;

  const body = {
    sender,
    ...(replyToEmail ? { replyTo: { email: replyToEmail } } : {}),
    to: toList,
    subject: cleanSubject(params.subject),
    htmlContent: params.html,
    ...(params.text ? { textContent: params.text } : {}),
    ...(ccList ? { cc: ccList } : {}),
    // Adjuntos: contenido en base64 (ficheros propios) o por URL (Brevo descarga el fichero público)
    ...(params.attachments?.length
      ? { attachment: params.attachments.map(a => (a.content ? { content: a.content.toString("base64"), name: a.name } : { url: a.url, name: a.name })) }
      : {}),
    // Desactivar click-tracking de Brevo para que los enlaces lleguen directos sin redirección
    headers: { "X-Mailin-no-track": "1" },
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json() as { messageId?: string };
      console.log(`[Mailer] ✓ Brevo API → ${maskTo(params.to)} | messageId: ${json.messageId ?? "—"}`);
      return true;
    }

    // El cuerpo del error del proveedor puede repetir destinatarios: solo el código de estado
    await res.text().catch(() => "");
    opsLog("error", "Mailer", "provider_error", { channel: "brevo", httpStatus: res.status });
    return false;
  } catch (err) {
    opsLog("error", "Mailer", "provider_error", { channel: "brevo", error: err instanceof Error ? err.name : "error" });
    return false;
  }
}

// ─── Modo 2: Nodemailer SMTP (fallback) ───────────────────────────────────────
export function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !user || !pass) {
    console.warn("[Mailer] SMTP no configurado — faltan SMTP_HOST, SMTP_USER o SMTP_PASS");
    return null;
  }

  console.log(`[Mailer] SMTP transporter → ${host}:${port} secure=${secure}`);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

async function sendViaSMTP(params: MailParams): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) return false;

  const fromAddress = params.from
    ?? process.env.SMTP_FROM
    ?? process.env.SMTP_USER
    ?? getSystemSettingSync("email_noreply_sender", "");

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
      subject: cleanSubject(params.subject),
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.cc ? { cc: Array.isArray(params.cc) ? params.cc.join(", ") : params.cc } : {}),
      ...(params.attachments?.length
        ? { attachments: params.attachments.map(a => (a.content ? { filename: a.name, content: a.content } : { filename: a.name, path: a.url })) }
        : {}),
    });
    console.log(`[Mailer] ✓ SMTP → ${maskTo(params.to)}`);
    return true;
  } catch (err) {
    opsLog("error", "Mailer", "provider_error", { channel: "smtp", error: err instanceof Error ? err.name : "error", code: (err as { code?: unknown })?.code ?? null });
    return false;
  }
}

// ─── CC global ───────────────────────────────────────────────────────────────
// Dirección que recibe copia de TODOS los emails salientes.
// Solo la configurada (GLOBAL_CC_EMAIL); sin ella, ninguna.
const globalCcEmail = () => (process.env.GLOBAL_CC_EMAIL ?? "").trim();

/**
 * Correos con enlaces de acceso de un solo uso (crear o restablecer contraseña, verificar el correo): nunca
 * llevan la copia global. Quien la reciba podría entrar en la cuenta de otra persona. Tampoco los avisos de
 * seguridad ni los de la exportación de datos (solo para quien la pidió).
 */
const NO_GLOBAL_CC: ReadonlySet<string> = new Set(["password_reset", "user_invite", "email_verification", "tenant_welcome", "security_notice", "data_export"]);

function mergeGlobalCc(params: MailParams): MailParams {
  if (params.category && NO_GLOBAL_CC.has(params.category)) return params;
  const existing = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc])
    : [];
  // En multiempresa la copia global es un ajuste del propio tenant: nunca la dirección de Náyade
  const cc = isMultiTenant() ? getSystemSettingSync("email_cc_all", "") : globalCcEmail();
  const merged = Array.from(new Set([...existing, ...(cc ? [cc] : [])]));
  return { ...params, cc: merged.length ? merged : undefined };
}

// ─── Adjuntos del almacenamiento propio ───────────────────────────────────────

/** Sustituye las URL de ficheros del Core por su contenido; uno que no se pueda leer no se adjunta. */
async function resolveOwnAttachments(params: MailParams): Promise<MailParams> {
  if (!params.attachments?.some((a) => !a.content && objectIdFromUrl(a.url))) return params;
  const attachments: NonNullable<MailParams["attachments"]> = [];
  for (const a of params.attachments) {
    if (a.content || !objectIdFromUrl(a.url)) {
      attachments.push(a);
      continue;
    }
    const f = await readStoredFile(a.url);
    if (f) attachments.push({ name: a.name, url: a.url, content: f.data });
    else opsLog("warn", "Mailer", "attachment_unavailable", {});
  }
  return { ...params, attachments };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Categorías que la cuota diaria de correo nunca bloquea. */
export const CRITICAL_MAIL_CATEGORIES: ReadonlySet<MailCategory> = new Set<MailCategory>([
  "password_reset",
  "security_notice",
  "email_verification",
  "user_invite",
  "payment_confirmed",
  "payment_failed",
  "invoice_available",
  "withdrawal_receipt",
  "withdrawal_resolution",
  "data_export",
]);

/**
 * Envía un email usando Brevo API (primario) o SMTP (fallback).
 * Devuelve true si el envío fue exitoso.
 */
export async function sendEmail(params: MailParams): Promise<boolean> {
  // Los avisos críticos (acceso, seguridad, cobros y obligaciones legales) no los corta la cuota diaria: siguen
  // midiéndose y conservan los límites del servicio de correo (idempotencia y límites por hora).
  if (!(params.category && CRITICAL_MAIL_CATEGORIES.has(params.category))) {
    try {
      await enforceQuota(Metrics.EMAIL_SENT, 1);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.warn("[Mailer] Cuota de envíos excedida: no se envía");
        return false;
      }
    }
  }
  // Prueba gratuita: solo a los buzones propios de la empresa y con tope diario (server/trialRestrictions.ts)
  if (isMultiTenant()) {
    const { applyTrialMailPolicy } = await import("./trialRestrictions");
    const allowed = await applyTrialMailPolicy(params);
    if (!allowed) {
      opsLog("info", "Mailer", "trial_mail_not_sent", { category: params.category ?? null });
      return false;
    }
    params = allowed;
  }
  const enriched = mergeGlobalCc(await resolveOwnAttachments(params));

  // Servicio centralizado (bandeja de salida, MAIL_MODE off|sandbox|live, idempotencia, límites y
  // remitente de plataforma por empresa): siempre en multiempresa; en single solo si se define
  // MAIL_MODE. Sin MAIL_MODE, la instalación única sigue exactamente como antes (docs/runbooks/CORREO_BREVO.md).
  const { sendTenantMail, usesMailService } = await import("./mail/tenantMail");
  if (usesMailService()) {
    const ok = await sendTenantMail(enriched);
    meter(Metrics.EMAIL_SENT, 1, "count", { channel: "outbox", ok });
    return ok;
  }

  // Intentar primero con Brevo API
  if (process.env.BREVO_API_KEY) {
    const ok = await sendViaBrevoApi(enriched);
    if (ok) {
      meter(Metrics.EMAIL_SENT, 1, "count", { channel: "brevo", ok: true });
      return true;
    }
    console.warn("[Mailer] Brevo API falló, intentando SMTP...");
  }

  // Fallback SMTP: el buzón SMTP del entorno es de la plataforma/Náyade; en multiempresa no se usa
  if (isMultiTenant()) return mailFailed("no_channel_left");
  const sent = await sendViaSMTP(enriched);
  meter(Metrics.EMAIL_SENT, 1, "count", { channel: "smtp", ok: sent });
  return sent || mailFailed("smtp_failed");
}

/** Envío definitivamente fallido: evento estructurado (sin destinatarios ni asunto) y alerta por repetición. */
function mailFailed(reason: string): false {
  opsLog("error", "Mailer", "send_failed", { reason });
  recordFailure("mail.send_failed");
  return false;
}
