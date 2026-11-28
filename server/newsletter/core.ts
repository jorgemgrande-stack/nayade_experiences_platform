/**
 * Newsletter · piezas puras (sin base de datos ni correo): validación del correo, enlaces, plantillas de los correos y
 * exportación a CSV y Excel. Todo lo que se prueba sin servicios externos vive aquí.
 *
 * Garantías:
 *  - El enlace de confirmación es aleatorio (256 bits), se guarda SOLO su huella SHA-256 y caduca a las 48 h.
 *  - El enlace de baja no caduca (una baja siempre tiene que poder pedirse): HMAC sobre empresa y suscriptor.
 *  - Los correos escapan todo lo que viene de una persona o de la configuración; nunca HTML sin escapar.
 *  - Las exportaciones neutralizan las fórmulas (=, +, -, @, tabulador, retorno) y nunca incluyen enlaces ni huellas.
 */
import crypto from "node:crypto";
import * as XLSX from "xlsx";

export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
/** Mínimo entre dos correos de confirmación al mismo correo, y tope por suscripción. */
export const CONFIRM_COOLDOWN_MS = 2 * 60 * 1000;
export const CONFIRM_MAX_SENDS = 5;
export const LOCALES = ["de", "es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type SubscriberStatus = "pending" | "active" | "unsubscribed";
export const STATUSES: readonly SubscriberStatus[] = ["pending", "active", "unsubscribed"];

// ── Correo ──
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** Correo normalizado (minúsculas, sin espacios) o null si no es válido. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  if (e.includes("..")) return null;
  const tld = e.split("@")[1].split(".").pop() ?? "";
  return tld.length >= 2 ? e : null;
}
export const maskEmail = (e: string) => `${e.split("@")[0].slice(0, 2)}…@${e.split("@")[1] ?? ""}`;

export function normalizeLocale(raw: unknown, fallback: Locale = "de"): Locale {
  const l = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 2) : "";
  return (LOCALES as readonly string[]).includes(l) ? (l as Locale) : fallback;
}

// ── Enlaces ──
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newConfirmToken = () => crypto.randomBytes(32).toString("base64url");
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Huella de la IP (nunca se guarda la dirección): HMAC con el secreto de la instalación y la empresa. */
export function ipFingerprint(ip: string | null | undefined, tenantId: string, secret: string): string | null {
  if (!ip || !secret) return null;
  return crypto.createHmac("sha256", secret).update(`newsletter:${tenantId}:${ip}`).digest("hex");
}

const UNSUB_RE = /^(\d{1,10})\.([A-Za-z0-9_-]{32})$/;
function unsubMac(secret: string, tenantId: string, id: number) {
  return crypto.createHmac("sha256", secret).update(`newsletter-unsub:${tenantId}:${id}`).digest("base64url").slice(0, 32);
}
export function unsubscribeToken(id: number, tenantId: string, secret: string): string {
  return `${id}.${unsubMac(secret, tenantId, id)}`;
}
/** Suscriptor de un enlace de baja con firma válida para la empresa, o null. */
export function verifyUnsubscribeToken(token: unknown, tenantId: string, secrets: readonly string[]): number | null {
  if (typeof token !== "string") return null;
  const m = UNSUB_RE.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const got = Buffer.from(m[2]);
  for (const s of secrets) {
    const want = Buffer.from(unsubMac(s, tenantId, id));
    if (want.length === got.length && crypto.timingSafeEqual(want, got)) return id;
  }
  return null;
}

// ── Textos legales ──
/** Versión del texto de consentimiento mostrado (cambia si la empresa cambia el texto). */
export const consentVersion = (text: string) => sha256(text).slice(0, 12);
export const cleanText = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// ── Plantillas de los correos (editables desde el administrador, por idioma) ──
export interface MailTemplate {
  subject: string;
  /** Texto sin formato: un párrafo por bloque separado por una línea en blanco. */
  body: string;
}
export type TemplatesJson = { welcome?: Partial<Record<Locale, Partial<MailTemplate>>>; confirm?: Partial<Record<Locale, Partial<MailTemplate>>> };

export const DEFAULT_WELCOME: Record<Locale, MailTemplate> = {
  es: {
    subject: "Bienvenida a Quantum Soulrise ✨",
    body: "Hola,\n\nGracias por unirte a nuestra comunidad.\n\nA partir de ahora recibirás cada semana inspiración, reflexiones y novedades para acompañarte en tu camino de crecimiento y conexión interior.\n\nMe alegra que formes parte de este espacio.\n\nCon cariño,\n\nIndira\nQuantum Soulrise",
  },
  de: {
    subject: "Willkommen bei Quantum Soulrise ✨",
    body: "Hallo,\n\nvielen Dank, dass du Teil unserer Gemeinschaft wirst.\n\nAb jetzt erhältst du jede Woche Inspiration, Gedanken und Neuigkeiten, die dich auf deinem Weg des Wachstums und der inneren Verbindung begleiten.\n\nIch freue mich, dass du diesen Raum mit uns teilst.\n\nMit Liebe,\n\nIndira\nQuantum Soulrise",
  },
  en: {
    subject: "Welcome to Quantum Soulrise ✨",
    body: "Hello,\n\nThank you for joining our community.\n\nFrom now on you will receive inspiration, reflections and news every week to accompany you on your path of growth and inner connection.\n\nI'm glad you are part of this space.\n\nWith love,\n\nIndira\nQuantum Soulrise",
  },
};
export const DEFAULT_CONFIRM: Record<Locale, MailTemplate> = {
  es: { subject: "Confirma tu inscripción a la newsletter", body: "Hola,\n\nHas pedido recibir nuestra newsletter semanal. Para confirmar que esta dirección es tuya, pulsa el botón de abajo.\n\nSi no has sido tú, ignora este correo: no recibirás nada." },
  de: { subject: "Bitte bestätige deine Anmeldung zum Newsletter", body: "Hallo,\n\ndu hast darum gebeten, unseren wöchentlichen Newsletter zu erhalten. Bitte bestätige mit dem Button unten, dass diese Adresse dir gehört.\n\nWenn du das nicht warst, ignoriere diese E-Mail: Du erhältst nichts." },
  en: { subject: "Please confirm your newsletter subscription", body: "Hello,\n\nYou asked to receive our weekly newsletter. Please confirm with the button below that this address is yours.\n\nIf it wasn't you, just ignore this email: you will receive nothing." },
};
const BUTTON: Record<Locale, { confirm: string; unsub: string; why: string; expires: string }> = {
  es: { confirm: "Confirmar mi inscripción", unsub: "Darme de baja", why: "Recibes este correo porque esta dirección se inscribió a la newsletter.", expires: "El enlace caduca en 48 horas." },
  de: { confirm: "Anmeldung bestätigen", unsub: "Abmelden", why: "Du erhältst diese E-Mail, weil sich diese Adresse für den Newsletter angemeldet hat.", expires: "Der Link läuft in 48 Stunden ab." },
  en: { confirm: "Confirm my subscription", unsub: "Unsubscribe", why: "You are receiving this email because this address subscribed to the newsletter.", expires: "The link expires in 48 hours." },
};

/** Plantilla efectiva: la guardada por la empresa o, en su defecto, la de fábrica (por campo). */
export function resolveTemplate(kind: "welcome" | "confirm", locale: Locale, json: TemplatesJson | null | undefined): MailTemplate {
  const base = (kind === "welcome" ? DEFAULT_WELCOME : DEFAULT_CONFIRM)[locale];
  const mine = json?.[kind]?.[locale];
  return { subject: cleanText(mine?.subject, 200) || base.subject, body: (typeof mine?.body === "string" ? mine.body : "").slice(0, 6000).trim() || base.body };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const paragraphs = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#2b2730">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

export interface MailIdentity {
  brand: string;
  /** Datos de identificación del responsable (razón social, NIF, domicilio, contacto): una línea. */
  legalLine: string;
  logoUrl?: string | null;
}
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Correo con la identidad de la empresa. `button`: enlace de acción (confirmación). `unsubscribeUrl`: pie de baja. */
export function renderMail(t: MailTemplate, locale: Locale, id: MailIdentity, o: { buttonUrl?: string; unsubscribeUrl?: string }): RenderedMail {
  const L = BUTTON[locale];
  const button = o.buttonUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(o.buttonUrl)}" style="background:#6b4eff;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;display:inline-block">${escapeHtml(L.confirm)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#6b6574">${escapeHtml(L.expires)}</p>`
    : "";
  const foot = [
    `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#6b6574">${escapeHtml(L.why)}</p>`,
    id.legalLine ? `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#6b6574">${escapeHtml(id.legalLine)}</p>` : "",
    o.unsubscribeUrl ? `<p style="margin:0;font-size:12px;line-height:18px"><a href="${escapeHtml(o.unsubscribeUrl)}" style="color:#6b6574">${escapeHtml(L.unsub)}</a></p>` : "",
  ].join("");
  const html =
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;background:#f4f1fa;font-family:Georgia,'Times New Roman',serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:18px;padding:32px 30px"><tr><td>` +
    `<p style="margin:0 0 22px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6b4eff">${escapeHtml(id.brand)}</p>` +
    `${paragraphs(t.body)}${button}<hr style="border:0;border-top:1px solid #ece8f5;margin:24px 0 16px">${foot}</td></tr></table></td></tr></table></body></html>`;
  const text = [t.body.trim(), o.buttonUrl ? `\n${L.confirm}: ${o.buttonUrl}\n${L.expires}` : "", `\n--\n${L.why}`, id.legalLine, o.unsubscribeUrl ? `${L.unsub}: ${o.unsubscribeUrl}` : ""].filter(Boolean).join("\n");
  return { subject: t.subject, html, text };
}

// ── Exportación ──
export interface ExportRow {
  email: string;
  status: SubscriberStatus;
  source: string;
  locale: string;
  createdAt: number;
  confirmedAt: number | null;
  unsubscribedAt: number | null;
  consentVersion: string | null;
}
export const EXPORT_HEADERS = ["Email", "Estado", "Origen", "Idioma", "Fecha de inscripción", "Fecha de confirmación", "Fecha de baja", "Versión del texto aceptado"] as const;
const STATUS_ES: Record<SubscriberStatus, string> = { pending: "Pendiente", active: "Activo", unsubscribed: "Baja" };
const isoDate = (ms: number | null) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "");

/** Neutraliza la inyección de fórmulas: una celda que empieza por = + - @ tabulador o retorno se antepone con ' */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
const toCells = (r: ExportRow): string[] => [r.email, STATUS_ES[r.status] ?? r.status, r.source, r.locale, isoDate(r.createdAt), isoDate(r.confirmedAt), isoDate(r.unsubscribedAt), r.consentVersion ?? ""].map((c) => safeCell(c));

/** CSV para Excel en español: UTF-8 con BOM, separador «;» y comillas dobles. */
export function toCsv(rows: ExportRow[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const lines = [EXPORT_HEADERS.map(q).join(";"), ...rows.map((r) => toCells(r).map(q).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
/** Libro Excel (.xlsx): todas las celdas son texto (nunca una fórmula) y la primera fila va en negrita. */
export function toXlsx(rows: ExportRow[]): Buffer {
  const aoa = [Array.from(EXPORT_HEADERS), ...rows.map(toCells)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const addr of Object.keys(ws)) {
    const c = ws[addr] as XLSX.CellObject | undefined;
    if (addr[0] !== "!" && c) {
      c.t = "s";
      delete (c as { f?: string }).f;
    }
  }
  ws["!cols"] = [{ wch: 36 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Suscriptores");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
