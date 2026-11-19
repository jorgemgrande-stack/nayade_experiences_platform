/**
 * Fin de prueba con un acuerdo comercial ACEPTADO (22/11/2026): la conclusión prueba → pago (`TermsAcceptanceService.concludeDue`)
 * no depende de la tarea del cobro de Stripe ni de la tarea de pruebas.
 *
 *  - `TrialConclusionHook`: lo rellena la API al montar las condiciones; lo usan la tarea de pruebas y el temporizador propio.
 *  - `agreementDeferral`: para la tarea de pruebas. Solo difiere el vencimiento si hay un acuerdo aceptado con plan Y existe quien lo
 *    concluya (el gancho está montado); en ese caso concluye ya esa suscripción (en su instante exacto, nunca antes). Consulta acotada
 *    por empresa (y tenant) de UNA prueba, nunca todas las suscripciones.
 *  - `startAgreementConclusion`: barrido periódico (por defecto cada 5 min; apagable con CP_TERMS_AUTO_CONCLUDE=0). Idempotente.
 */
import { opsLog } from "../_core/ops/log";
import type { SubscriptionStore } from "../subscriptions/store";
import { isPlanLine } from "./acceptance";
import type { TermsStore } from "./store";

export interface TrialConclusionHook {
  concludeDue: ((o?: { subscriptionId?: number; limit?: number }) => Promise<unknown>) | null;
}

export function agreementDeferral(d: {
  companyOfTenant: (tenantId: string) => Promise<{ id: number } | null>;
  subscriptions: Pick<SubscriptionStore, "list">;
  terms: Pick<TermsStore, "list">;
  conclusion: TrialConclusionHook;
}): (t: { tenantId: string | null }) => Promise<boolean> {
  return async (t) => {
    if (!t.tenantId || !d.conclusion.concludeDue) return false;
    const company = await d.companyOfTenant(t.tenantId);
    if (!company) return false;
    const sub = (await d.subscriptions.list({ companyId: company.id, status: "trialing", limit: 5 })).find((s) => s.tenantId === t.tenantId);
    if (!sub) return false;
    const agreed = (await d.terms.list({ subscriptionId: sub.id, status: ["scheduled", "active"] })).some((x) => x.acceptanceStatus === "accepted" && x.lines.some(isPlanLine));
    if (!agreed) return false;
    // Concluye ya esa suscripción si su instante llegó (idempotente); un fallo queda en el registro y el margen de la tarea sigue protegiendo
    await d.conclusion.concludeDue({ subscriptionId: sub.id }).catch((e) => opsLog("warn", "CommercialTerms", "defer_conclude_failed", { subscriptionId: sub.id, error: e instanceof Error ? e.name : "error" }));
    return true;
  };
}

export const CONCLUDE_SWEEP_DEFAULT_MS = 5 * 60_000;

export function startAgreementConclusion(o: { conclusion: TrialConclusionHook; env?: NodeJS.ProcessEnv; intervalMs?: number }): { stop(): void } | null {
  const env = o.env ?? process.env;
  if (env.CP_TERMS_AUTO_CONCLUDE === "0") return null;
  const every = Math.max(60_000, Math.min(o.intervalMs ?? (Number(env.CP_TERMS_AUTO_CONCLUDE_INTERVAL_MS) || CONCLUDE_SWEEP_DEFAULT_MS), 60 * 60_000));
  const tick = async () => {
    try {
      await o.conclusion.concludeDue?.();
    } catch (e) {
      opsLog("warn", "CommercialTerms", "conclude_sweep_failed", { error: e instanceof Error ? e.name : "error" });
    }
  };
  const timer = setInterval(() => void tick(), every);
  timer.unref?.();
  opsLog("info", "CommercialTerms", "conclude_sweep_started", { everyMs: every });
  return { stop: () => clearInterval(timer) };
}
