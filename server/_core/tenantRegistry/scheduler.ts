/**
 * Programador de tareas con contexto de tenant.
 *
 *  - Cada ejecución corre dentro de `runForEachTenant`: una vez por tenant con escrituras
 *    (multi) o una vez en el tenant único (single/shadow). Sin contexto no hay acceso a BD.
 *  - Control de concurrencia: no se solapan dos ejecuciones de la misma tarea y tenant
 *    (en proceso; Railway ejecuta una única instancia — ver DECISIONS).
 *  - Aislamiento de fallos: el error de un tenant se registra y no impide los demás.
 *  - Resultado de la última ejecución por tarea/tenant consultable (`jobStatus()`).
 */
import cron from "node-cron";
import { getFeatureFlag } from "../../config";
import { Metrics, meter } from "../metering";
import { runForEachTenant, type TenantJobResult, type TenantLister } from "./jobs";

export interface JobRunRecord {
  job: string;
  tenantId: string;
  startedAt: number;
  durationMs: number;
  outcome: "ok" | "error" | "skipped";
  error?: string;
}

let lister: TenantLister | undefined;
let prelude: (() => Promise<void>) | undefined;
const running = new Set<string>();
const last = new Map<string, JobRunRecord>();

/** Preparación previa a cada ejecución, ya dentro del contexto del tenant (credenciales, ajustes). */
export function setJobPrelude(p: (() => Promise<void>) | null): void {
  prelude = p ?? undefined;
}

/** Origen del listado de tenants para el modo multi (lo fija `installTenantResolution`). */
export function setJobTenantLister(l: TenantLister | null): void {
  lister = l ?? undefined;
}

const keyOf = (job: string, tenantId: string) => `${job}\u0000${tenantId}`;

/**
 * Feature flag que habilita cada tarea. Se evalúa dentro del contexto de cada tenant, justo
 * antes de ejecutar: un tenant puede tener una tarea activa y otro no.
 */
const jobFlags = new Map<string, { key: string; fallback: boolean }>();

export function setJobFlag(job: string, flagKey: string, fallback = false): void {
  jobFlags.set(job, { key: flagKey, fallback });
}

export function jobStatus(): JobRunRecord[] {
  return Array.from(last.values());
}

/** Ejecuta `handler` ahora para todos los tenants aplicables. No lanza: devuelve resultados. */
export async function runTenantJob(name: string, handler: () => Promise<unknown> | unknown): Promise<TenantJobResult[]> {
  try {
    return await runForEachTenant(
      name,
      async (tenantId) => {
        const key = keyOf(name, tenantId);
        const startedAt = Date.now();
        if (running.has(key)) {
          last.set(key, { job: name, tenantId, startedAt, durationMs: 0, outcome: "skipped" });
          return;
        }
        const flag = jobFlags.get(name);
        if (flag && !(await getFeatureFlag(flag.key, flag.fallback))) {
          last.set(key, { job: name, tenantId, startedAt, durationMs: 0, outcome: "skipped" });
          return;
        }
        running.add(key);
        try {
          if (prelude) await prelude().catch(() => undefined);
          await handler();
          const durationMs = Date.now() - startedAt;
          last.set(key, { job: name, tenantId, startedAt, durationMs, outcome: "ok" });
          meter(Metrics.JOB_RUN_MS, durationMs, "ms", { job: name, outcome: "ok" });
        } catch (e) {
          const durationMs = Date.now() - startedAt;
          const error = e instanceof Error ? e.message.slice(0, 200) : "error";
          last.set(key, { job: name, tenantId, startedAt, durationMs, outcome: "error", error });
          meter(Metrics.JOB_RUN_MS, durationMs, "ms", { job: name, outcome: "error" });
          throw e;
        } finally {
          running.delete(key);
        }
      },
      lister,
    );
  } catch (e) {
    console.error(`[Jobs] ${name}:`, e instanceof Error ? e.message : "error");
    return [];
  }
}

/** Sustituye a `cron.schedule(expr, fn)`: misma firma + nombre de la tarea. */
export function scheduleTenantCron(expr: string, name: string, handler: () => Promise<unknown> | unknown) {
  return cron.schedule(expr, () => {
    void runTenantJob(name, handler);
  });
}

/**
 * Sustituye a los bucles `setTimeout(run, n)` autorreprogramados: espera `firstDelayMs`,
 * ejecuta la tarea para todos los tenants y reprograma `intervalMs` después de terminar
 * (sin solapamientos).
 */
export function scheduleTenantInterval(
  name: string,
  intervalMs: number,
  firstDelayMs: number,
  handler: () => Promise<unknown> | unknown,
): { stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const tick = async () => {
    await runTenantJob(name, handler);
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, firstDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
