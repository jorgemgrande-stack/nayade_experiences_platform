/**
 * Care Net · recordatorios de cita por correo (tarea `care-net-reminders`, por empresa con `scheduleTenantCron`, cada
 * 10 minutos) y envío manual desde el panel («Enviar recordatorio ahora»).
 *
 *  - Solo en empresas con la capacidad `care-net` y los recordatorios ACTIVADOS en sus ajustes (por defecto apagados).
 *  - Sin la migración 0051 la empresa se omite sin error.
 *  - Sin correo configurado (sin remitente, correo apagado por la política o sin canal) no se envía nada ni se registra.
 *  - Destinatario: el correo del cliente de la reserva (citas confirmadas y aún no empezadas, no anuladas).
 *  - Idempotente: un recordatorio por cita y antelación (registro `care_reminder_sends` con reserva previa al envío y
 *    clave de idempotencia propia en la bandeja de salida). Enviado, fallido (con reintentos limitados) u omitido con
 *    su motivo (sin correo, superado por otra antelación, prueba gratuita).
 *  - Correo transaccional del Core (`sendEmail`) con la categoría `operational` (la de los recordatorios de Life Net,
 *    autorizada en production). La prueba gratuita la aplica el propio Core (solo buzones de la empresa).
 *  - Plantilla con la marca de la empresa (buildNoticeHtml): fecha y hora en Europe/Madrid, tratamiento, profesional o
 *    cabina, dirección y cómo cancelar o contactar. Nunca datos clínicos.
 * Flag por empresa: `care_net_reminders_enabled` (activa por defecto; el interruptor real es el ajuste de la empresa).
 */
import { scheduleTenantCron } from "./_core/tenantRegistry/scheduler";
import { isMultiTenant } from "./_core/tenant";
import { sendEmail } from "./mailer";
import { buildNoticeHtml } from "./emailTemplates";
import { brandSetting, companyName, tenantCommsConfig } from "./tenantBrand";
import { CARE_NET_CAPABILITY } from "../shared/careNet";
import {
  CARE_REMINDER_TZ,
  HOUR_MS,
  MANUAL_LEAD,
  REMINDER_MAX_ATTEMPTS,
  appointmentProblem,
  dayIn,
  planReminder,
  wallToUtc,
  type ReminderSettings,
} from "../shared/careNetReminders";
import type { MailCategory } from "./mail/types";
import type { ReminderAppointment, SendRow } from "./careNetRemindersDb";

export const CARE_REMINDERS_JOB = "care-net-reminders";
export const CARE_REMINDERS_FLAG = "care_net_reminders_enabled";
export const CARE_REMINDER_CATEGORY: MailCategory = "operational";
/** Citas por página, páginas máximas (20.000 citas) y envíos máximos por empresa y pasada. */
export const CARE_REMINDERS_SCAN = 500;
export const CARE_REMINDERS_MAX_PAGES = 40;
export const CARE_REMINDERS_PER_RUN = 100;
/** Pausa mínima entre dos envíos manuales de la misma cita (doble clic, reintentos del navegador). */
export const MANUAL_COOLDOWN_MS = 2 * 60_000;

const EMAIL_RE = /^[^\s@<>"',;:()\\[\]]+@[^\s@<>"',;:()\\[\]]+\.[^\s@<>"',;:()\\[\]]+$/;
export const validEmail = (v: string | null | undefined): string | null => {
  const e = (v ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
};
const oneLine = (v: string) => v.replace(/[\r\n\t]+/g, " ").trim();

// ─── Plantilla ───────────────────────────────────────────────────────────────

export interface ReminderBrand {
  company: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export function currentBrand(): ReminderBrand {
  const address = brandSetting("brand_address", "") || brandSetting("brand_location", "");
  return {
    company: companyName(),
    address: address || null,
    phone: brandSetting("brand_support_phone", "") || brandSetting("brand_phone", "") || null,
    email: brandSetting("email_reservations", "") || null,
  };
}

/** «lunes, 9 de noviembre de 2026» de un día AAAA-MM-DD (la franja ya es hora de Madrid). */
export const dayLabel = (d: string): string =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Correo del recordatorio. Puro: sin datos clínicos (solo la cita, el tratamiento y el profesional o la cabina). */
export function reminderEmail(a: ReminderAppointment, brand: ReminderBrand, extraText: string): { subject: string; html: string; text: string } {
  const company = oneLine(brand.company) || "tu centro";
  const day = dayLabel(a.date);
  const hour = a.startTime.slice(0, 5);
  const details = [
    `Fecha: ${day}`,
    `Hora: ${hour} (hora peninsular española)`,
    ...(a.treatmentName ? [`Tratamiento: ${oneLine(a.treatmentName)}`] : []),
    ...(a.resourceName ? [`${a.resourceType === "cabina" ? "Cabina" : "Profesional"}: ${oneLine(a.resourceName)}`] : []),
    ...(a.people > 1 ? [`Personas: ${a.people}`] : []),
    ...(brand.address ? [`Dirección: ${oneLine(brand.address)}`] : []),
    ...(a.reservationNumber ? [`Localizador: ${oneLine(a.reservationNumber)}`] : []),
  ];
  const contact = [brand.phone ? `llamando al ${oneLine(brand.phone)}` : "", brand.email ? `escribiendo a ${oneLine(brand.email)}` : ""].filter(Boolean);
  const cancel = `Si no puedes venir o quieres cambiar la cita, avísanos cuanto antes respondiendo a este correo${contact.length ? `, ${contact.join(" o ")}` : ""}.`;
  const extra = extraText.trim();
  const paragraphs = [`Te recordamos tu cita en ${company}.`, ...details, ...(extra ? [extra] : []), cancel];
  const subject = oneLine(`Recordatorio de tu cita en ${company}: ${day}, ${hour}`).slice(0, 200);
  const html = buildNoticeHtml({ badge: "Recordatorio de cita", title: "Te esperamos", greetingName: a.customerName ? oneLine(a.customerName) : null, paragraphs, note: "Este es un aviso automático de tu cita. No contiene información clínica." });
  const text = [`Hola${a.customerName ? `, ${oneLine(a.customerName)}` : ""}:`, "", ...paragraphs, "", company].join("\n");
  return { subject, html, text };
}

/** Clave de idempotencia del correo: cita y antelación (el manual lleva además el instante del envío). */
export const reminderKey = (reservationId: number, leadHours: number, manualAt?: number): string =>
  leadHours === MANUAL_LEAD ? `care:reminder:${reservationId}:manual:${manualAt ?? 0}` : `care:reminder:${reservationId}:${leadHours}h`;

// ─── ¿Se puede enviar correo en la empresa? ──────────────────────────────────

/**
 * Motivo por el que la empresa no puede enviar correo ahora (null = puede). Solo LEE la política (no la cambia):
 *  - servicio de correo (siempre en multiempresa): modo efectivo «off» → apagado; sin nombre de remitente de la
 *    empresa (`tenantCommsConfig`, el que usa la bandeja de salida) → sin remitente;
 *  - instalación única sin servicio: hace falta Brevo o SMTP.
 * El resto (prueba gratuita, límites, supresiones, ámbito) lo decide el propio Core al enviar.
 */
export async function mailBlockReason(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const { usesMailService } = await import("./mail/tenantMail");
  if (usesMailService(env)) {
    const { mailPolicyFromEnv } = await import("./mail/policy");
    if (mailPolicyFromEnv(env).mode === "off") return "correo_desactivado";
    if (isMultiTenant() && !tenantCommsConfig().fromName) return "sin_remitente";
    return null;
  }
  return env.BREVO_API_KEY || env.SMTP_HOST ? null : "sin_canal_de_correo";
}

export const MAIL_BLOCK_LABELS: Record<string, string> = {
  sin_remitente: "La empresa no tiene configurado el nombre del remitente de sus correos (Ajustes · Correo).",
  correo_desactivado: "El envío de correo está desactivado en esta instalación.",
  sin_canal_de_correo: "No hay ningún canal de correo configurado.",
};

// ─── Tarea programada ────────────────────────────────────────────────────────

export interface CareReminderDeps {
  licensed: () => Promise<boolean>;
  settings: () => Promise<ReminderSettings>;
  mailBlock: () => Promise<string | null>;
  appointments: (from: string, to: string, limit: number, offset: number) => Promise<ReminderAppointment[]>;
  sends: (reservationIds: number[]) => Promise<SendRow[]>;
  claim: (reservationId: number, leadHours: number, appointmentAt: number) => Promise<boolean>;
  settle: (reservationId: number, leadHours: number, status: "sent" | "failed" | "skipped", reason: string | null) => Promise<void>;
  skip: (reservationId: number, leadHours: number, appointmentAt: number, reason: string) => Promise<void>;
  /** ¿La política de la prueba gratuita del Core impide escribir a ese destinatario? (entonces, omitido). */
  trialBlocks: (email: string) => Promise<boolean>;
  send: (a: ReminderAppointment, leadHours: number, email: string) => Promise<boolean>;
}

/**
 * ¿La política de correo de la prueba gratuita (la misma función que aplica `sendEmail`) deja fuera a este
 * destinatario? Sin contar la cuota de prueba, que es temporal: un envío cortado por la cuota queda «fallido» y se
 * reintenta. Fuera de multiempresa, o si no se puede comprobar, false (decide el envío).
 */
export async function trialBlocksNow(email: string): Promise<boolean> {
  if (!isMultiTenant()) return false;
  try {
    const { applyTrialMailPolicy } = await import("./trialRestrictions");
    return (await applyTrialMailPolicy({ to: email, category: CARE_REMINDER_CATEGORY }, { usage: async () => 0 })) === null;
  } catch {
    return false;
  }
}

async function licensedNow(): Promise<boolean> {
  const { getCapabilityAccess } = await import("./_core/capabilities/access");
  return (await getCapabilityAccess().check(CARE_NET_CAPABILITY, { write: true })).allowed;
}

async function defaultDeps(): Promise<CareReminderDeps> {
  const db = await import("./careNetRemindersDb");
  return {
    licensed: licensedNow,
    settings: db.getReminderSettings,
    mailBlock: () => mailBlockReason(),
    appointments: db.appointmentsBetween,
    sends: db.sendsFor,
    claim: (id, lead, at) => db.claimSend(id, lead, at, REMINDER_MAX_ATTEMPTS),
    settle: db.settleSend,
    skip: db.skipSend,
    trialBlocks: trialBlocksNow,
    send: async (a, lead, email) => {
      const s = await db.getReminderSettings();
      const c = reminderEmail(a, currentBrand(), s.extraText);
      return sendEmail({ to: email, subject: c.subject, html: c.html, text: c.text, category: CARE_REMINDER_CATEGORY, idempotencyKey: reminderKey(a.reservationId, lead) }).catch(() => false);
    },
  };
}

export interface CareReminderRun {
  sent: number;
  failed: number;
  skipped: number;
  /** Motivo por el que la empresa entera se omitió (sin licencia, apagado, sin correo, sin migración). */
  skippedAll?: string;
}

/** Una pasada en la empresa en curso. */
export async function runCareReminders(now = new Date(), deps?: CareReminderDeps): Promise<CareReminderRun> {
  const out: CareReminderRun = { sent: 0, failed: 0, skipped: 0 };
  let d: CareReminderDeps;
  try {
    d = deps ?? (await defaultDeps());
    if (!(await d.licensed())) return { ...out, skippedAll: "sin_licencia" };
  } catch {
    return { ...out, skippedAll: "licencia_no_verificable" };
  }
  try {
    const s = await d.settings();
    if (!s.enabled || !s.leadHours.length) return { ...out, skippedAll: "desactivado" };
    const block = await d.mailBlock();
    if (block) return { ...out, skippedAll: block };
    const t = now.getTime();
    const maxLead = Math.max(...s.leadHours);
    const from = dayIn(t, CARE_REMINDER_TZ);
    const to = dayIn(t + (maxLead + 24) * HOUR_MS, CARE_REMINDER_TZ);
    let budget = CARE_REMINDERS_PER_RUN;
    // Por páginas: en un centro con mucho volumen ninguna cita se queda fuera (hasta CARE_REMINDERS_MAX_PAGES)
    for (let page = 0; page < CARE_REMINDERS_MAX_PAGES && budget > 0; page++) {
      const raw = await d.appointments(from, to, CARE_REMINDERS_SCAN, page * CARE_REMINDERS_SCAN);
      const list = raw.filter((a) => appointmentProblem(a, t) == null);
      const done = await d.sends(list.map((a) => a.reservationId));
      for (const a of list) {
        if (budget <= 0) break;
        const at = wallToUtc(a.date, a.startTime)!;
        const plan = planReminder(at, t, s.leadHours, done.filter((r) => r.reservationId === a.reservationId));
        for (const l of plan.supersede) {
          await d.skip(a.reservationId, l, at, "superado");
          out.skipped++;
        }
        if (plan.send == null) continue;
        const email = validEmail(a.customerEmail);
        if (!email) {
          await d.skip(a.reservationId, plan.send, at, "sin_correo");
          out.skipped++;
          continue;
        }
        if (!(await d.claim(a.reservationId, plan.send, at))) continue;
        // Solo la política de la prueba gratuita deja el recordatorio omitido (definitivo); cualquier otro fallo
        // queda «fallido» y se reintenta
        if (await d.trialBlocks(email).catch(() => false)) {
          await d.settle(a.reservationId, plan.send, "skipped", "prueba_gratuita");
          out.skipped++;
          continue;
        }
        budget--;
        const ok = await d.send(a, plan.send, email).catch(() => false);
        if (ok) {
          await d.settle(a.reservationId, plan.send, "sent", null);
          out.sent++;
        } else {
          await d.settle(a.reservationId, plan.send, "failed", "envio_fallido");
          out.failed++;
        }
      }
      if (raw.length < CARE_REMINDERS_SCAN) break;
    }
    return out;
  } catch (e) {
    const { ReminderSchemaMissing } = await import("./careNetRemindersDb");
    if (e instanceof ReminderSchemaMissing) return { ...out, skippedAll: "sin_migracion" };
    throw e;
  }
}

export function startCareRemindersJob(): void {
  console.log("[Jobs] Iniciando cron care_net_reminders (*/10 * * * *)");
  scheduleTenantCron("*/10 * * * *", CARE_REMINDERS_JOB, async () => {
    try {
      const r = await runCareReminders();
      if (r.sent || r.failed) console.log(`[CareNetReminders] ${r.sent} enviado(s), ${r.failed} fallido(s), ${r.skipped} omitido(s)`);
    } catch (err) {
      console.error("[CareNetReminders] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}

// ─── Envío manual desde el panel ─────────────────────────────────────────────

export interface ManualDeps {
  appointment: (reservationId: number) => Promise<ReminderAppointment | null>;
  mailBlock: () => Promise<string | null>;
  lastManual: (reservationId: number) => Promise<SendRow | null>;
  claim: (reservationId: number, appointmentAt: number, userId: number) => Promise<boolean>;
  settle: (reservationId: number, status: "sent" | "failed" | "skipped", reason: string | null) => Promise<void>;
  trialBlocks: (email: string) => Promise<boolean>;
  send: (a: ReminderAppointment, email: string, at: number) => Promise<boolean>;
}

export type ManualResult = { ok: true; status: "sent" } | { ok: false; status: "failed" | "skipped" | "refused"; message: string };

/** «Enviar recordatorio ahora»: misma comprobación que el job, sin antelación (lead 0) y con pausa anti doble clic. */
export async function sendReminderNow(reservationId: number, userId: number, now = Date.now(), deps?: ManualDeps): Promise<ManualResult> {
  const d = deps ?? (await defaultManualDeps());
  const a = await d.appointment(reservationId);
  if (!a) return { ok: false, status: "refused", message: "La cita no existe o no es una reserva de SPA." };
  const problem = appointmentProblem(a, now);
  if (problem) return { ok: false, status: "refused", message: problem };
  const email = validEmail(a.customerEmail);
  if (!email) return { ok: false, status: "refused", message: "El cliente no tiene un correo válido en la reserva." };
  const block = await d.mailBlock();
  if (block) return { ok: false, status: "refused", message: MAIL_BLOCK_LABELS[block] ?? "El correo no está disponible." };
  const last = await d.lastManual(reservationId);
  if (last && (last.status === "sending" || (last.status === "sent" && now - last.at < MANUAL_COOLDOWN_MS))) {
    return { ok: false, status: "refused", message: "Ya se ha enviado un recordatorio de esta cita hace un momento." };
  }
  const at = wallToUtc(a.date, a.startTime)!;
  if (!(await d.claim(reservationId, at, userId))) return { ok: false, status: "refused", message: "Ya se está enviando un recordatorio de esta cita." };
  if (await d.trialBlocks(email).catch(() => false)) {
    await d.settle(reservationId, "skipped", "prueba_gratuita");
    return { ok: false, status: "skipped", message: "No enviado: durante la prueba gratuita solo se envían correos a los buzones de la empresa." };
  }
  const ok = await d.send(a, email, now).catch(() => false);
  if (ok) {
    await d.settle(reservationId, "sent", null);
    return { ok: true, status: "sent" };
  }
  await d.settle(reservationId, "failed", "envio_fallido");
  return { ok: false, status: "failed", message: "No se ha podido enviar el recordatorio. Inténtalo más tarde." };
}

async function defaultManualDeps(): Promise<ManualDeps> {
  const db = await import("./careNetRemindersDb");
  return {
    appointment: db.appointmentById,
    mailBlock: () => mailBlockReason(),
    lastManual: async (id) => (await db.sendsFor([id])).find((r) => r.leadHours === MANUAL_LEAD) ?? null,
    claim: (id, at, userId) => db.claimSend(id, MANUAL_LEAD, at, REMINDER_MAX_ATTEMPTS, userId),
    settle: (id, status, reason) => db.settleSend(id, MANUAL_LEAD, status, reason),
    trialBlocks: trialBlocksNow,
    send: async (a, email, at) => {
      const s = await db.getReminderSettings();
      const c = reminderEmail(a, currentBrand(), s.extraText);
      return sendEmail({ to: email, subject: c.subject, html: c.html, text: c.text, category: CARE_REMINDER_CATEGORY, idempotencyKey: reminderKey(a.reservationId, MANUAL_LEAD, at) }).catch(() => false);
    },
  };
}

/** Estado del correo de la empresa para el panel (sin detalles de la política). */
export async function reminderMailStatus(): Promise<{ ready: boolean; message: string | null }> {
  const block = await mailBlockReason().catch(() => "correo_desactivado");
  return { ready: block == null, message: block ? MAIL_BLOCK_LABELS[block] ?? null : null };
}

