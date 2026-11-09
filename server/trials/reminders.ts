/**
 * Recordatorios automáticos de la prueba gratuita (encargo del 09/11/2026, decisión 3). Son de SERVICIO: ayudan a
 * completar la prueba que la persona pidió; nunca llevan ofertas ni publicidad. Los comerciales salen solo del Centro
 * de envíos, con el consentimiento de su finalidad (server/communications/consent.ts).
 *
 * Tres casos, un recordatorio cada uno (idempotencia por prueba, tipo y paso: `reminder:<tipo>:<paso>` en el
 * historial, y la clave del mensaje en la bandeja de salida):
 *  (a) `verify`        correo sin verificar 20 h después del alta (antes de que caduque el enlace de 24 h) → enlace nuevo
 *                      (el reenvío de siempre, con su espera mínima y su máximo diario). Hasta 6 días después del alta.
 *  (b) `setup`         empresa verificada que no ha entrado en su panel (sin `first_access`) 2 días después del inicio.
 *                      Si entró y no terminó la configuración, ya le escribe el Core (server/onboardingReminders.ts,
 *                      día 3): no se duplica.
 *  (c) `first_action`  ha entrado pero sin primera acción útil (`first_action`) 4 días después del inicio.
 *
 * Cada uno se cancela solo al cumplirse su objetivo: se evalúa en cada pasada justo antes de enviar. Nunca a registros
 * técnicos (`configuration.test`), a empresas exentas, a quien se dio de baja de los recordatorios
 * (`configuration.reminders.optOutAt`) ni a direcciones suprimidas por el proveedor (rebote, queja o baja: la bandeja
 * de salida no las envía). Lógica pura: la ejecuta la tarea programada de la prueba (./scheduler.ts).
 */
import type { TrialRequest } from "./store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const REMINDER_KINDS = ["verify", "setup", "first_action"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Cuándo toca cada recordatorio (desde el alta en `verify`; desde el inicio de la prueba en los otros dos). */
export const REMINDER_AFTER_MS: Record<ReminderKind, number> = { verify: 20 * HOUR, setup: 2 * DAY, first_action: 4 * DAY };

/** Paso de cada tipo (hoy uno; la clave admite más sin cambiar las ya enviadas). */
export const REMINDER_STEP = 1;
/** Hasta cuándo tiene sentido recordar la verificación (dentro de la vida máxima de una solicitud, 7 días). */
const VERIFY_UNTIL_MS = 6 * DAY;
export const reminderKey = (kind: ReminderKind, step = REMINDER_STEP) => `reminder:${kind}:${step}`;

/** ¿Puede recibir recordatorios? Fuera los registros técnicos y quien se dio de baja. */
export const remindable = (t: TrialRequest) => !t.configuration?.test && !t.configuration?.reminders?.optOutAt;

/**
 * Recordatorio que toca ahora a una prueba, o null. `actions`: acciones de su historial (hitos y avisos encolados con
 * su clave en `notices`).
 */
export function dueReminder(t: TrialRequest, actions: ReadonlySet<string>, notices: ReadonlySet<string>, now: number): ReminderKind | null {
  if (!remindable(t)) return null;
  if (t.state === "pending_verification") {
    // El reenvío da un enlace nuevo aunque el anterior haya caducado; pasada la vida máxima la solicitud se anula sola
    const live = t.createdAt + VERIFY_UNTIL_MS > now;
    return live && t.createdAt + REMINDER_AFTER_MS.verify <= now && !notices.has(reminderKey("verify")) ? "verify" : null;
  }
  if (t.state !== "active" || t.startsAt === null || t.endsAt === null || t.endsAt <= now || !t.tenantId) return null;
  if (!actions.has("first_access")) return t.startsAt + REMINDER_AFTER_MS.setup <= now && !notices.has(reminderKey("setup")) ? "setup" : null;
  if (!actions.has("first_action")) return t.startsAt + REMINDER_AFTER_MS.first_action <= now && !notices.has(reminderKey("first_action")) ? "first_action" : null;
  return null;
}
