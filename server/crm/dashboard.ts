/**
 * Métricas del panel comercial calculadas solo con datos reales: del CRM (leads, oportunidades,
 * contratos, tareas, empresas) y, si el plano de control tiene facturación, de las suscripciones.
 * Sin facturación configurada (o sin el ámbito `billing:read`) el bloque de facturación es `null`:
 * nunca se presentan ceros como si fueran datos.
 */
import type { Subscription } from "../_core/billing/types";

export const DAY_MS = 86_400_000;

export interface BillingSummary {
  trialing: number;
  active: number;
  pastDue: number;
  suspended: number;
  /** Pruebas que terminan dentro del horizonte (ordenadas por fecha). */
  trialsEndingSoon: Array<{ tenantId: string; planId: string; trialEnd: number }>;
  /** Suscripciones que se cancelan al final del periodo dentro del horizonte. */
  endingSoon: Array<{ tenantId: string; planId: string; periodEnd: number }>;
  /** Pagos pendientes: suscripciones en `past_due` con su fin de gracia. */
  pendingPayments: Array<{ tenantId: string; planId: string; graceEnd: number | null; attempts: number }>;
  horizonDays: number;
}

export function billingSummary(subs: Subscription[], now: number, horizonDays = 7): BillingSummary {
  const until = now + horizonDays * DAY_MS;
  const count = (s: Subscription["status"]) => subs.filter((x) => x.status === s).length;
  return {
    trialing: count("trialing"),
    active: count("active"),
    pastDue: count("past_due"),
    suspended: count("suspended"),
    trialsEndingSoon: subs
      .filter((s) => s.status === "trialing" && s.trialEnd !== null && s.trialEnd <= until)
      .sort((a, b) => a.trialEnd! - b.trialEnd!)
      .map((s) => ({ tenantId: s.tenantId, planId: s.planId, trialEnd: s.trialEnd! })),
    endingSoon: subs
      .filter((s) => s.status === "active" && s.cancelAtPeriodEnd && s.currentPeriodEnd <= until)
      .sort((a, b) => a.currentPeriodEnd - b.currentPeriodEnd)
      .map((s) => ({ tenantId: s.tenantId, planId: s.planId, periodEnd: s.currentPeriodEnd })),
    pendingPayments: subs
      .filter((s) => s.status === "past_due")
      .map((s) => ({ tenantId: s.tenantId, planId: s.planId, graceEnd: s.graceEnd, attempts: s.attempts })),
    horizonDays,
  };
}
