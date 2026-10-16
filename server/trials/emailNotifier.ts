/**
 * Avisos de la prueba gratuita por correo transaccional, sin depender de un proveedor concreto.
 *
 * El proveedor es un puerto (`TransactionalEmailPort`): hoy hay SMTP genérico (sirve para cualquier relé SMTP,
 * también los de Brevo o Postmark) y uno en memoria para pruebas. Ningún proveedor se da por disponible.
 *
 * Modos (`CP_TRIAL_EMAIL_MODE`):
 *  - off (por defecto): no se envía nada; solo se deja constancia, sin correo ni token, como hasta ahora.
 *  - sandbox: solo se envía a direcciones de los dominios de `CP_TRIAL_EMAIL_ALLOWED_DOMAINS` (pruebas
 *    internas); el resto se descarta con constancia.
 *  - live: envío a cualquier destinatario. Requiere autorización expresa: solo tiene sentido con la apertura
 *    pública de la prueba (`CP_PUBLIC_TRIAL_ENABLED`), que también la requiere.
 *
 * Un fallo del proveedor nunca rompe el alta: se registra (sin datos personales) y la prueba sigue su curso.
 */
import nodemailer from "nodemailer";
import type { TrialNotifier } from "./onboarding";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Tipo de aviso, para trazas y para etiquetar en el proveedor. */
  tag: "trial_verification" | "trial_welcome" | "trial_expiry";
}

export interface TransactionalEmailPort {
  readonly name: string;
  send(mail: OutgoingEmail): Promise<void>;
}

export type TrialEmailMode = "off" | "sandbox" | "live";

export interface EmailTrialNotifierOptions {
  mode: TrialEmailMode;
  port: TransactionalEmailPort | null;
  /** Dominios permitidos en sandbox (sin @, en minúsculas). */
  allowedDomains?: string[];
  /** Página de la web comercial que completa la verificación (recibe `id` y `token`). */
  verifyUrl: string;
  /** Página de alta y precios para convertir la prueba. */
  pricingUrl?: string | null;
  productName?: string;
  log?: (entry: Record<string, unknown>) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });

function render(title: string, paragraphs: string[], cta?: { label: string; url: string }): { text: string; html: string } {
  const text = [title, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n");
  const html =
    `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:560px;margin:auto;padding:24px">` +
    `<h1 style="font-size:20px">${esc(title)}</h1>` +
    paragraphs.map((p) => `<p style="line-height:1.5">${esc(p)}</p>`).join("") +
    (cta ? `<p><a href="${esc(cta.url)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(cta.label)}</a></p>` : "") +
    `</body></html>`;
  return { text, html };
}

/** Plantillas en español. Puras: no envían nada. */
export function trialEmails(o: { verifyUrl: string; pricingUrl?: string | null; productName?: string }) {
  const product = o.productName ?? "Elephant Source";
  return {
    verification(to: string, l: { trialId: number; token: string }): OutgoingEmail {
      const url = `${o.verifyUrl}${o.verifyUrl.includes("?") ? "&" : "?"}id=${l.trialId}&token=${encodeURIComponent(l.token)}`;
      const body = render(`Confirma tu correo para empezar la prueba de ${product}`, [
        "Hemos recibido una solicitud de prueba gratuita con esta dirección.",
        "Para activarla, confirma que el correo es tuyo. El enlace caduca y solo sirve una vez.",
        "Si no la has solicitado tú, ignora este mensaje: no se creará nada.",
      ], { label: "Confirmar correo", url });
      return { to, subject: `Confirma tu correo · prueba de ${product}`, tag: "trial_verification", ...body };
    },
    welcome(to: string, i: { tenantId: string; domain: string | null; inviteToken: string }): OutgoingEmail {
      const base = i.domain ? `https://${i.domain}` : null;
      const paragraphs = [
        `Tu espacio de ${product} está listo.`,
        base ? `Tu dirección: ${base}` : "Tu dirección se te comunicará en cuanto esté publicada.",
        "Define tu contraseña de administrador para entrar. El enlace es personal y caduca.",
      ];
      const body = render(`Bienvenido a ${product}`, paragraphs, base ? { label: "Definir contraseña", url: `${base}/establecer-contrasena?token=${encodeURIComponent(i.inviteToken)}` } : undefined);
      return { to, subject: `Tu prueba de ${product} está lista`, tag: "trial_welcome", ...body };
    },
    expiryNotice(to: string, i: { trialId: number; endsAt: number; daysLeft: number }): OutgoingEmail {
      const when = i.daysLeft <= 0 ? "termina hoy" : i.daysLeft === 1 ? "termina mañana" : `termina en ${i.daysLeft} días`;
      const body = render(`Tu prueba de ${product} ${when}`, [
        `La prueba gratuita termina el ${fmtDate(i.endsAt)}.`,
        "Al terminar, tu cuenta pasa a solo lectura: no se borra nada y puedes contratar cuando quieras para seguir trabajando.",
      ], o.pricingUrl ? { label: "Ver planes", url: o.pricingUrl } : undefined);
      return { to, subject: `Tu prueba de ${product} ${when}`, tag: "trial_expiry", ...body };
    },
  };
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
}

export function createEmailTrialNotifier(o: EmailTrialNotifierOptions): TrialNotifier {
  const log = o.log ?? (({ event, ...rest }) => opsLog(String(event).endsWith("_failed") ? "error" : "info", "Trials", String(event), rest));
  const allowed = new Set((o.allowedDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean));
  const t = trialEmails(o);

  async function deliver(mail: OutgoingEmail, ref: Record<string, unknown>) {
    // Nunca se registran la dirección ni los tokens
    if (o.mode === "off" || !o.port) return void log({ event: `${mail.tag}_not_sent`, reason: o.port ? "mode_off" : "no_provider", ...ref });
    if (o.mode === "sandbox" && !allowed.has(domainOf(mail.to))) return void log({ event: `${mail.tag}_not_sent`, reason: "sandbox_recipient_not_allowed", ...ref });
    try {
      await o.port.send(mail);
      log({ event: `${mail.tag}_sent`, provider: o.port.name, mode: o.mode, ...ref });
    } catch (e) {
      log({ event: `${mail.tag}_failed`, provider: o.port.name, error: e instanceof Error ? e.name : "error", ...ref });
      recordFailure("mail.send_failed");
    }
  }

  return {
    verification: (to, l) => deliver(t.verification(to, l), { trialId: l.trialId }),
    welcome: (to, i) => deliver(t.welcome(to, i), { tenantId: i.tenantId }),
    expiryNotice: (to, i) => deliver(t.expiryNotice(to, i), { trialId: i.trialId, daysLeft: i.daysLeft }),
  };
}

/** SMTP genérico (cualquier relé SMTP). La conexión se abre al enviar, no al crear el adaptador. */
export function smtpEmailPort(c: { host: string; port: number; secure: boolean; user: string; pass: string; from: string; replyTo?: string | null }): TransactionalEmailPort {
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } });
  return {
    name: "smtp",
    async send(m) {
      await transport.sendMail({ from: c.from, replyTo: c.replyTo ?? undefined, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: { "X-Elephant-Tag": m.tag } });
    },
  };
}

/** En memoria, para pruebas: guarda lo «enviado». */
export function memoryEmailPort(): TransactionalEmailPort & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { name: "memory", sent, send: async (m) => void sent.push(m) };
}

/**
 * Configuración desde el entorno. Sin `CP_TRIAL_EMAIL_MODE` (o con valor desconocido) el modo es «off».
 * Devuelve `null` si no hay nada que configurar (se mantiene el aviso que solo deja constancia).
 */
export function trialNotifierFromEnv(env: NodeJS.ProcessEnv, log?: EmailTrialNotifierOptions["log"]): { notifier: TrialNotifier; mode: TrialEmailMode; provider: string | null; reason?: string } | null {
  const raw = (env.CP_TRIAL_EMAIL_MODE ?? "off").trim();
  const mode: TrialEmailMode = raw === "sandbox" || raw === "live" ? raw : "off";
  if (mode === "off") return null;
  const verifyUrl = env.CP_TRIAL_VERIFY_URL?.trim();
  if (!verifyUrl || !/^https:\/\//.test(verifyUrl)) return { notifier: createEmailTrialNotifier({ mode: "off", port: null, verifyUrl: "https://invalid.example", log }), mode: "off", provider: null, reason: "verify_url_missing" };
  const allowedDomains = (env.CP_TRIAL_EMAIL_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (mode === "sandbox" && !allowedDomains.length) return { notifier: createEmailTrialNotifier({ mode: "off", port: null, verifyUrl, log }), mode: "off", provider: null, reason: "sandbox_without_allowed_domains" };
  const host = env.CP_TRIAL_SMTP_HOST, user = env.CP_TRIAL_SMTP_USER, pass = env.CP_TRIAL_SMTP_PASS, from = env.CP_TRIAL_EMAIL_FROM;
  if (!host || !user || !pass || !from) return { notifier: createEmailTrialNotifier({ mode: "off", port: null, verifyUrl, log }), mode: "off", provider: null, reason: "smtp_not_configured" };
  const port = smtpEmailPort({ host, port: Number(env.CP_TRIAL_SMTP_PORT ?? 587), secure: env.CP_TRIAL_SMTP_SECURE === "true", user, pass, from, replyTo: env.CP_TRIAL_EMAIL_REPLY_TO ?? null });
  return { notifier: createEmailTrialNotifier({ mode, port, allowedDomains, verifyUrl, pricingUrl: env.CP_TRIAL_PRICING_URL ?? null, log }), mode, provider: port.name };
}
