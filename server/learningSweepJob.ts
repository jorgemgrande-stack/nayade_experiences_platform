/**
 * Elephant LMS · barrido de derechos pendientes. Cada pocos minutos, por empresa: concede el derecho de los presupuestos PAGADOS
 * de retiros sin convocatoria (con regla activa y duración confirmada) y reintenta los pedidos pagados que no llegaron a conceder.
 * Idempotente (las claves de concesión impiden duplicar). Sin el LMS, sin reglas activas o sin la migración, no hace nada.
 */
import { scheduleTenantInterval } from "./_core/tenantRegistry/scheduler";

export const LEARNING_SWEEP_JOB = "learning-sweep";

export async function runLearningSweep(): Promise<{ skipped?: string; quotes?: number; granted?: number; needsTerms?: number; orders?: number }> {
  const { sweepLearningGrants } = await import("./learningFlow");
  const { isMissingLearningSchema } = await import("./learningDb");
  try {
    return await sweepLearningGrants();
  } catch (e) {
    if (isMissingLearningSchema(e)) return { skipped: "sin_lms" };
    throw e;
  }
}

export function startLearningSweepJob(): void {
  console.log("[Jobs] Iniciando learning_sweep_job (cada 10 min)");
  scheduleTenantInterval(LEARNING_SWEEP_JOB, 10 * 60_000, 90_000, async () => {
    try {
      const r = await runLearningSweep();
      if (r.skipped) return;
      if ((r.granted ?? 0) + (r.orders ?? 0) > 0) console.log(`[LearningSweep] derechos concedidos: presupuestos ${r.granted}, pedidos ${r.orders}`);
    } catch (err) {
      console.error("[LearningSweep] Error inesperado:", err instanceof Error ? err.message : err);
    }
  });
}
