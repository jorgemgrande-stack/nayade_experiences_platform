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
 *   SMTP_FROM       — remitente visible, ej: "Nayade Experiences <reservas@nayadeexperiences.es>"
 *   SMTP_HOST/PORT/USER/PASS/SECURE — fallback SMTP (entornos locales o no-cloud)
 */

import nodemailer from "nodemailer";
import { getSystemSettingSync } from "./config";

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface MailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string | string[];
}

// ─── Helper: parsea el SMTP_FROM en nombre + email ───────────────────────────
function parseSender(raw: string): { name: string; email: string } {
  // Formatos: "Nombre <email>" o solo "email"
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: getSystemSettingSync("brand_name", "Nayade Experiences"), email: raw.trim() };
}

// ─── Modo 1: Brevo HTTP API ───────────────────────────────────────────────────
async function sendViaBrevoApi(params: MailParams): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;

  const noreplyEmail = getSystemSettingSync("email_noreply_sender", "");
  const brandName = getSystemSettingSync("brand_name", "Nayade Experiences");
  const fromRaw = params.from
    ?? process.env.SMTP_FROM
    ?? (noreplyEmail ? `${brandName} <${noreplyEmail}>` : `${brandName} <noreply@example.com>`);
  const sender = parseSender(fromRaw);

  const toList = Array.isArray(params.to)
    ? params.to.map(e => ({ email: e }))
    : [{ email: params.to }];

  const ccList = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc]).map(e => ({ email: e }))
    : undefined;

  const body = {
    sender,
    to: toList,
    subject: params.subject,
    htmlContent: params.html,
    ...(params.text ? { textContent: params.text } : {}),
    ...(ccList ? { cc: ccList } : {}),
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
      console.log(`[Mailer] ✓ Brevo API → ${Array.isArray(params.to) ? params.to.join(", ") : params.to} | messageId: ${json.messageId ?? "—"}`);
      return true;
    }

    const errText = await res.text();
    console.error(`[Mailer] ✗ Brevo API error ${res.status}: ${errText}`);
    return false;
  } catch (err) {
    console.error("[Mailer] ✗ Brevo API fetch error:", err);
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
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.cc ? { cc: Array.isArray(params.cc) ? params.cc.join(", ") : params.cc } : {}),
    });
    console.log(`[Mailer] ✓ SMTP → ${Array.isArray(params.to) ? params.to.join(", ") : params.to}`);
    return true;
  } catch (err) {
    console.error("[Mailer] ✗ SMTP error:", err);
    return false;
  }
}

// ─── CC global ───────────────────────────────────────────────────────────────
// Dirección que recibe copia de TODOS los emails salientes.
// Se puede sobreescribir con la variable de entorno GLOBAL_CC_EMAIL.
const GLOBAL_CC_EMAIL = process.env.GLOBAL_CC_EMAIL ?? "reservas@nayadeexperiences.es";

function mergeGlobalCc(params: MailParams): MailParams {
  const existing = params.cc
    ? (Array.isArray(params.cc) ? params.cc : [params.cc])
    : [];
  const merged = [...new Set([...existing, GLOBAL_CC_EMAIL])];
  return { ...params, cc: merged };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Envía un email usando Brevo API (primario) o SMTP (fallback).
 * Devuelve true si el envío fue exitoso.
 */
export async function sendEmail(params: MailParams): Promise<boolean> {
  const enriched = mergeGlobalCc(params);

  // Intentar primero con Brevo API
  if (process.env.BREVO_API_KEY) {
    const ok = await sendViaBrevoApi(enriched);
    if (ok) return true;
    console.warn("[Mailer] Brevo API falló, intentando SMTP...");
  }

  // Fallback SMTP
  return sendViaSMTP(enriched);
}
