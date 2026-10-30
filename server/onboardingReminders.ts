/**
 * Recordatorios de «Primeros pasos» (plantilla onboarding.reminder), tarea `onboarding-reminder`: cada hora, en cada
 * empresa con el asistente sin terminar, recuerda los pasos pendientes a quien lo abrió a los 3 días de su primer
 * acceso. El estado de los pasos se relee en cada pasada, justo antes de enviar: nunca recuerda un paso hecho.
 *  - Solo con el primer acceso REGISTRADO (al abrir el asistente sin ningún paso dado): nunca para empresas que no lo
 *    han abierto ni con fechas supuestas.
 *  - Un recordatorio por hito (hoy uno: el día 3), idempotentes por empresa e hito (reserva con la fila bloqueada antes de
 *    enviar; si el correo no sale, se libera y se reintenta en la siguiente pasada).
 *  - Con la pasada tardía (tarea parada unos días) solo se envía el hito más reciente; los anteriores quedan cubiertos.
 *  - Se detienen al completar el asistente.
 * Flag por empresa: `onboarding_reminder_job_enabled` (activo por defecto).
 */
import { scheduleTenantInterval } from "./_core/tenantRegistry/scheduler";
import { onboardingReminder } from "./onboardingNotices";
import {
  activeUserContact,
  claimOnboardingReminder,
  readOnboardingReminderState,
  readProgress,
  releaseOnboardingReminder,
  type OnboardingReminderState,
} from "./setupWizardDb";
import type { SetupProgress } from "../shared/setupWizard";

export const ONBOARDING_REMINDER_JOB_INTERVAL_MS = 3600_000;
/** Hitos en días desde el primer acceso. */
export const ONBOARDING_REMINDER_DAYS = [3] as const;
const DAY = 86_400_000;

/** Hito que toca enviar ahora (el más reciente alcanzado y sin enviar), o null. Puro. */
export function dueReminder(state: OnboardingReminderState | null, progress: SetupProgress, now: number): number | null {
  if (!state || progress.completedAt !== null) return null;
  const reached = ONBOARDING_REMINDER_DAYS.filter((d) => state.firstAccessAt + d * DAY <= now);
  if (!reached.length) return null;
  const latest = Math.max(...reached);
  return state.sent[String(latest)] === undefined ? latest : null;
}

export interface ReminderDeps {
  readState: () => Promise<OnboardingReminderState | null>;
  readProgress: () => Promise<SetupProgress>;
  contact: (userId: number) => Promise<{ email: string; name: string | null } | null>;
  claim: (days: number, earlier: number[], now: number) => Promise<boolean>;
  release: (days: number, earlier: number[], claimedAt: number) => Promise<void>;
  send: (p: SetupProgress, to: { email: string; name: string | null }, days: number) => Promise<boolean>;
}

const defaultDeps: ReminderDeps = {
  readState: readOnboardingReminderState,
  readProgress,
  contact: activeUserContact,
  claim: claimOnboardingReminder,
  release: releaseOnboardingReminder,
  send: onboardingReminder,
};

/** Una pasada en la empresa en curso. Devuelve el hito enviado, o null. */
export async function runOnboardingReminders(now = Date.now(), d: ReminderDeps = defaultDeps): Promise<number | null> {
  const state = await d.readState();
  if (!state) return null;
  const progress = await d.readProgress();
  const days = dueReminder(state, progress, now);
  if (days === null || state.userId === null) return null;
  const to = await d.contact(state.userId);
  if (!to) return null;
  const earlier = ONBOARDING_REMINDER_DAYS.filter((x) => x < days);
  if (!(await d.claim(days, earlier, now))) return null;
  const ok = await d.send(progress, to, days).catch(() => false);
  if (!ok) {
    await d.release(days, earlier, now);
    return null;
  }
  return days;
}

export function startOnboardingReminderJob() {
  return scheduleTenantInterval("onboarding-reminder", ONBOARDING_REMINDER_JOB_INTERVAL_MS, 10 * 60_000, () => runOnboardingReminders());
}
