/**
 * Life Net · recordatorios por correo (tarea `life-net-reminders`, por empresa con `scheduleTenantCron`, cada 10 minutos).
 *
 *  - Solo en empresas con la capacidad `life-net` activa (sin ella, o sin poder comprobarla, no toca nada).
 *  - Sin la migración 0047 la empresa se omite sin error.
 *  - Destinatarios: los miembros con acceso (usuario del panel activo y con correo) que son responsables de la tarea o
 *    participan en la actividad. A los perfiles sin acceso (p. ej. un menor) no se les escribe.
 *  - Idempotente: una vez por elemento, miembro y hora del recordatorio (registro `life_reminders` con reserva previa al
 *    envío y clave de idempotencia propia en la bandeja de salida). Cambiar la hora programa un recordatorio nuevo.
 *  - Margen: un recordatorio vencido hace más de 24 h no se envía (tarea parada o fecha ya pasada al crearlo).
 *  - Correo transaccional del Core (`sendEmail`) con la categoría explícita `operational`, ya autorizada en el correo
 *    real de production (scripts/deploy/esRailwayLib.ts, LIVE_MAIL_CATEGORIES). Tope de envíos por pasada.
 * Flag por empresa: `life_net_reminders_enabled` (activa por defecto).
 */
import { scheduleTenantCron } from "../_core/tenantRegistry/scheduler";
import { getTrustedBaseUrl } from "../_core/publicUrl";
import { isMultiTenant } from "../_core/tenant";
import { renderEmail } from "../mail/design";
import { platformBrand } from "../mail/templates";
import { sendEmail } from "../mailer";
import { LIFE_NET_CAPABILITY, LIFE_PATHS, REMINDER_GRACE_HOURS, REMINDER_MAX_ATTEMPTS, wallClock } from "../../shared/lifeNet";
import type { MailCategory } from "../mail/types";
import type { ReminderTarget } from "../lifeNetDb";

export const LIFE_REMINDERS_JOB = "life-net-reminders";
export const LIFE_REMINDERS_FLAG = "life_net_reminders_enabled";
/** Categoría explícita del correo (transaccional operativo, autorizada en production). */
export const LIFE_REMINDER_CATEGORY: MailCategory = "operational";
/** Envíos máximos por empresa y pasada. */
export const LIFE_REMINDERS_PER_RUN = 100;

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Correo del recordatorio. Puro. */
export function reminderEmail(t: ReminderTarget, panelUrl: string | null): { subject: string; html: string; text?: string } {
  const what = t.kind === "task" ? "Tarea" : "Actividad";
  const when = t.date ? `${fmtDay(t.date)}${t.time ? `, ${t.time}` : ""}` : "Sin fecha";
  const rows = [
    { label: what, value: t.title },
    { label: t.kind === "task" ? "Fecha límite" : "Cuándo", value: when },
    ...(t.location ? [{ label: "Dónde", value: t.location }] : []),
    { label: "Para", value: t.memberName },
  ];
  const path = t.kind === "task" ? LIFE_PATHS.tasks : LIFE_PATHS.agenda;
  return renderEmail(platformBrand(null), {
    family: "transactional",
    eyebrow: "Recordatorio de tu hogar",
    hero: "calendario",
    title: t.kind === "task" ? "Tienes una tarea pendiente" : "Tienes una actividad próxima",
    subject: `Recordatorio: ${t.title}`,
    greeting: `Hola, ${t.userName || t.memberName}:`,
    intro: [t.kind === "task" ? "Te recordamos esta tarea de tu hogar en Life Net." : "Te recordamos esta actividad de la agenda de tu hogar en Life Net."],
    blocks: [{ card: { rows } }],
    cta: panelUrl ? { label: t.kind === "task" ? "Ver mis tareas" : "Ver la agenda", url: `${panelUrl}${path}` } : null,
  });
}

export interface ReminderDeps {
  licensed: () => Promise<boolean>;
  timeZone: () => Promise<string>;
  targets: (nowStamp: string, floorStamp: string, limit: number) => Promise<ReminderTarget[]>;
  claim: (t: ReminderTarget) => Promise<boolean>;
  settle: (t: ReminderTarget, ok: boolean) => Promise<void>;
  send: (t: ReminderTarget) => Promise<boolean>;
}

function panelUrl(): string | null {
  try {
    return getTrustedBaseUrl().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Clave de idempotencia del correo: elemento, miembro y hora del recordatorio. */
export const reminderKey = (t: Pick<ReminderTarget, "kind" | "itemId" | "memberId" | "remindAt">) => `life:reminder:${t.kind}:${t.itemId}:${t.memberId}:${t.remindAt.replace(/\D/g, "")}`;

async function defaultDeps(): Promise<ReminderDeps> {
  const db = await import("../lifeNetDb");
  return {
    licensed: async () => {
      // Life Net es de empresas con licencias por capacidad: en la instalación única (Náyade) no hace nada
      if (!isMultiTenant()) return false;
      const { getCapabilityAccess } = await import("../_core/capabilities/access");
      return (await getCapabilityAccess().check(LIFE_NET_CAPABILITY, { write: true })).allowed;
    },
    timeZone: db.householdTimeZone,
    targets: db.dueReminderTargets,
    claim: (t) => db.claimReminder(t, REMINDER_MAX_ATTEMPTS),
    settle: db.settleReminder,
    send: (t) => {
      const c = reminderEmail(t, panelUrl());
      return sendEmail({ to: t.email, subject: c.subject, html: c.html, text: c.text, category: LIFE_REMINDER_CATEGORY, idempotencyKey: reminderKey(t) }).catch(() => false);
    },
  };
}

export interface ReminderRun {
  sent: number;
  failed: number;
  skipped?: string;
}

/** Una pasada en la empresa en curso. */
export async function runLifeReminders(now = new Date(), deps?: ReminderDeps): Promise<ReminderRun> {
  const d = deps ?? (await defaultDeps());
  try {
    if (!(await d.licensed())) return { sent: 0, failed: 0, skipped: "sin_licencia" };
  } catch {
    return { sent: 0, failed: 0, skipped: "licencia_no_verificable" };
  }
  try {
    const tz = await d.timeZone();
    const nowStamp = wallClock(now, tz).stamp;
    const floorStamp = wallClock(new Date(now.getTime() - REMINDER_GRACE_HOURS * 3_600_000), tz).stamp;
    const targets = await d.targets(nowStamp, floorStamp, LIFE_REMINDERS_PER_RUN);
    let sent = 0;
    let failed = 0;
    for (const t of targets) {
      if (!(await d.claim(t))) continue;
      const ok = await d.send(t).catch(() => false);
      await d.settle(t, ok);
      if (ok) sent++;
      else failed++;
    }
    return { sent, failed };
  } catch (e) {
    const { isMissingLifeSchema } = await import("../lifeNetDb");
    const cause = (e as { cause?: unknown }).cause ?? e;
    if (isMissingLifeSchema(cause) || isMissingLifeSchema(e)) return { sent: 0, failed: 0, skipped: "sin_migracion" };
    throw e;
  }
}

export function startLifeRemindersJob(): void {
  console.log("[Jobs] Iniciando cron life_net_reminders (*/10 * * * *)");
  scheduleTenantCron("*/10 * * * *", LIFE_REMINDERS_JOB, async () => {
    try {
      const r = await runLifeReminders();
      if (r.sent || r.failed) console.log(`[LifeNetReminders] ${r.sent} enviado(s), ${r.failed} fallido(s)`);
    } catch (err) {
      console.error("[LifeNetReminders] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
