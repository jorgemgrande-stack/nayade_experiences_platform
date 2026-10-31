/**
 * Tarea programada de gastos recurrentes (APAGADA por defecto: `CP_FINANCE_RECURRING_ENABLED=1`, interruptor nuevo).
 *
 * Cada tick genera los BORRADORES de gasto de las plantillas activas hasta hoy (Europe/Madrid) con
 * `FinanceOpsService.runRecurring`: no registra ni contabiliza nada (eso lo hace una persona en el CRM) y es idempotente
 * (`recurring:<plantilla>:<periodo>`, único en la BD). Exclusión entre réplicas con el cerrojo consultivo de MySQL
 * (`GET_LOCK` sin espera, como la tarea de la prueba gratuita): si otra réplica lo tiene, este tick no hace nada.
 */
import type { SchedulerLock } from "../trials/scheduler";
import type { FinanceOpsService } from "./opsService";

export const FINANCE_RECURRING_LOCK = "elephant_finance_recurring";
export const FINANCE_RECURRING_ACTOR = "system:finance-recurring";
/** Cada seis horas (los borradores son diarios como mucho; el primer tick, al minuto de arrancar). */
export const FINANCE_RECURRING_INTERVAL_MS = 6 * 3_600_000;
const FIRST_TICK_MS = 60_000;

export async function financeRecurringTick(ops: Pick<FinanceOpsService, "runRecurring" | "today">, lock: SchedulerLock): Promise<{ created: number; skipped: number } | null> {
  const release = await lock.acquire(FINANCE_RECURRING_LOCK);
  if (!release) return null;
  try {
    return await ops.runRecurring(ops.today(), { by: FINANCE_RECURRING_ACTOR, requestId: null });
  } finally {
    await release();
  }
}

export function startFinanceRecurringScheduler(o: {
  ops: Pick<FinanceOpsService, "runRecurring" | "today">;
  lock: SchedulerLock;
  env: NodeJS.ProcessEnv;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  log?: (data: Record<string, unknown>) => void;
}): { enabled: boolean; stop: () => void; tick: () => Promise<void> } {
  const enabled = o.env.CP_FINANCE_RECURRING_ENABLED === "1";
  const log = o.log ?? ((data) => console.log(JSON.stringify({ ctx: "Finance", event: "recurring_scheduler", ...data })));
  log({ enabled, intervalMs: FINANCE_RECURRING_INTERVAL_MS });
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const r = await financeRecurringTick(o.ops, o.lock);
      if (r && r.created) log({ created: r.created, skipped: r.skipped });
    } catch (e) {
      log({ error: "tick_failed", message: e instanceof Error ? e.message.slice(0, 200) : "error" });
    } finally {
      busy = false;
    }
  };
  if (!enabled) return { enabled: false, stop: () => undefined, tick };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  const first = timers.setTimeout(() => void tick(), FIRST_TICK_MS);
  const every = timers.setInterval(() => void tick(), FINANCE_RECURRING_INTERVAL_MS);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  return {
    enabled: true,
    tick,
    stop: () => {
      stopped = true;
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}
