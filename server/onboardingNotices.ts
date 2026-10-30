/**
 * Avisos de «Primeros pasos» a la persona que configura la empresa (plantillas onboarding.steps y
 * onboarding.progress), por la bandeja de la empresa:
 *  - primer acceso al asistente sin ningún paso dado: guía de los primeros pasos (una sola vez);
 *  - al cruzar la mitad de los pasos sin haber terminado: progreso (una sola vez).
 * Solo con una URL pública de la empresa (los enlaces van a su panel). Nunca rompen el asistente.
 */
import { getTrustedBaseUrl } from "./_core/publicUrl";
import { extraTemplates } from "./mail/extraTemplates";
import { sendEmail } from "./mailer";
import { progressPercent, SETUP_STEPS, type SetupProgress } from "../shared/setupWizard";

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

const resolved = (p: SetupProgress) => SETUP_STEPS.filter((s) => p.steps[s].status !== "pending").length;

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
  if (!(progressPercent(before) < 50 && progressPercent(after) >= 50)) return false;
  const h = host();
  if (!h) return false;
  const c = extraTemplates.onboardingProgress({ name: to.name, host: h, done: resolved(after), total: SETUP_STEPS.length });
  return sendEmail({ to: to.email, subject: c.subject, html: c.html, text: c.text, category: "onboarding", idempotencyKey: "onboarding:progress:50" }).catch(() => false);
}
