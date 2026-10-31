/**
 * Avisos de «Primeros pasos» a la persona que configura la empresa (plantillas onboarding.steps y
 * onboarding.progress), por la bandeja de la empresa:
 *  - primer acceso al asistente sin ningún paso dado: guía de los primeros pasos (una sola vez);
 *  - al cruzar la mitad de los pasos sin haber terminado: progreso (una sola vez);
 *  - sin terminar a los 3 días del primer acceso: recordatorio con los pasos pendientes (tarea onboarding-reminder).
 * Solo con una URL pública de la empresa (los enlaces van a su panel). Nunca rompen el asistente.
 */
import { getTrustedBaseUrl } from "./_core/publicUrl";
import { extraTemplates } from "./mail/extraTemplates";
import { sendEmail } from "./mailer";
import { FLOW_STEPS, STEP_LABELS, type SetupProgress } from "../shared/setupWizard";

export interface OnboardingRecipient {
  email: string | null;
  name: string | null;
}

function host(): string | null {
  try {
    return new URL(getTrustedBaseUrl()).host || null;
  } catch {
    return null;
  }
}

// Pasos de configuración que cuentan en los avisos: la bienvenida no es un paso de configuración y el sectorial
// solo existe con un módulo contratado
const COUNTED = FLOW_STEPS.filter((s) => s !== "welcome" && s !== "sector");
const resolved = (p: SetupProgress) => COUNTED.filter((s) => p.steps[s].status !== "pending").length;
const percent = (p: SetupProgress) => Math.round((resolved(p) / COUNTED.length) * 100);

/** Primer acceso: el asistente se abre y todavía no se ha dado ningún paso. */
export async function onboardingFirstAccess(p: SetupProgress, to: OnboardingRecipient): Promise<boolean> {
  if (p.updatedAt !== null || p.completedAt !== null || !to.email) return false;
  const h = host();
  if (!h) return false;
  const c = extraTemplates.onboardingSteps({ name: to.name, host: h });
  return sendEmail({ to: to.email, subject: c.subject, html: c.html, text: c.text, category: "onboarding", idempotencyKey: "onboarding:steps" }).catch(() => false);
}

/** Progreso: la configuración cruza la mitad de los pasos y no ha terminado. */
export async function onboardingProgressed(before: SetupProgress, after: SetupProgress, to: OnboardingRecipient): Promise<boolean> {
  if (after.completedAt !== null || !to.email) return false;
  if (!(percent(before) < 50 && percent(after) >= 50)) return false;
  const h = host();
  if (!h) return false;
  const c = extraTemplates.onboardingProgress({ name: to.name, host: h, done: resolved(after), total: COUNTED.length });
  return sendEmail({ to: to.email, subject: c.subject, html: c.html, text: c.text, category: "onboarding", idempotencyKey: "onboarding:progress:50" }).catch(() => false);
}

/** Recordatorio de configuración incompleta (hito en días desde el primer acceso), con los pasos que faltan. */
export async function onboardingReminder(p: SetupProgress, to: OnboardingRecipient, days: number): Promise<boolean> {
  if (p.completedAt !== null || !to.email) return false;
  const h = host();
  if (!h) return false;
  const pending = COUNTED.filter((s) => s !== "finish" && p.steps[s].status === "pending").map((s) => STEP_LABELS[s].title);
  if (!pending.length) return false;
  const c = extraTemplates.onboardingReminder({ name: to.name, host: h, pending });
  return sendEmail({ to: to.email, subject: c.subject, html: c.html, text: c.text, category: "onboarding", idempotencyKey: `onboarding:reminder:${days}` }).catch(() => false);
}
