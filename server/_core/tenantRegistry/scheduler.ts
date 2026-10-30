/**
 * Programador de tareas con contexto de tenant.
 *
 *  - Cada ejecución corre dentro de `runForEachTenant`: una vez por tenant con escrituras
 *    (multi) o una vez en el tenant único (single/shadow). Sin contexto no hay acceso a BD.
 *  - Control de concurrencia: no se solapan dos ejecuciones de la misma tarea y tenant en el proceso y, en multi,
 *    tampoco entre réplicas (bloqueo por tarea y empresa, ver ./jobLocks.ts).
 *  - Aislamiento de fallos: el error de un tenant se registra y no impide los demás.
 *  - Aislamiento operativo en multi (ver ./jobIsolation.ts y la política de cada tarea): varias empresas a la vez,
 *    tiempo máximo por empresa, cortocircuito por empresa y tarea con backoff, y reintentos solo ante errores de
 *    conexión. En single/shadow el comportamiento no cambia.
 *  - Resultado de la última ejecución por tarea/tenant consultable (`jobStatus()`) y estado de los
 *    cortocircuitos (`jobCircuits()`, `jobHealth()`).
 *
 * Alerta de indisponibilidad: al abrirse un cortocircuito se registra `Jobs/circuit_open` (opsLog, con `tenantId`) y
 * se avisa al oyente de `setJobCircuitListener`. Las alertas administrativas (`admin.integration_error`) viven en el
 * plano de control, el único proceso con escritura en el registro: el Core no puede abrir la incidencia. El oyente
 * es el gancho para conectarlas cuando exista un canal Core → plano de control; mientras tanto el estado se consulta
 * desde el plano de control (`GET /ops/jobs/circuits`, ops:read) por el canal interno `/_ops/access`.
 */
import cron from "node-cron";
import { getFeatureFlag } from "../../config";
import { Metrics, meter } from "../metering";
import { opsLog } from "../ops/log";
import { isMultiTenant } from "../tenant";
import { runForEachTenant, hungJobs, type TenantJobOutcome, type TenantJobResult, type TenantLister } from "./jobs";
import { JobCircuitBreakers, jobIsolationPolicy, retryTransient, type CircuitEvent, type CircuitState, type JobIsolationPolicy } from "./jobIsolation";
import { jobLockKey, type JobLock, type JobLockProvider } from "./jobLocks";

export interface JobRunRecord {
  job: string;
  tenantId: string;
  startedAt: number;
  durationMs: number;
  outcome: "ok" | "error" | "skipped" | "timeout";
  error?: string;
  /** Motivo de la omisión (`running`, `flag_off`, `circuit_open`, `other_replica`, `lock_unavailable`, `hung_limit`). */
  reason?: string;
}

/** Contexto que recibe cada ejecución: la empresa y la señal que se aborta al agotarse su tiempo máximo. */
export interface JobRunContext {
  tenantId: string;
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobRunContext) => Promise<unknown> | unknown;

let lister: TenantLister | undefined;
/** Empresas con acceso al panel aunque no admitan escrituras (suspendidas o en solo lectura): tareas que deben
 * seguir sirviendo a la empresa en ese periodo (p. ej. su exportación de datos). */
let adminLister: TenantLister | undefined;
let prelude: (() => Promise<void>) | undefined;
let lockProvider: JobLockProvider | undefined;
let circuitListener: ((e: CircuitEvent) => void | Promise<void>) | undefined;
let circuits = new JobCircuitBreakers();
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

/** Origen del listado de empresas con panel (incluye suspendidas) para las tareas que lo piden expresamente. */
export function setJobAdminTenantLister(l: TenantLister | null): void {
  adminLister = l ?? undefined;
}

/** Exclusión entre réplicas (multi). Sin proveedor, solo se evita el solape dentro del proceso. */
export function setJobLockProvider(p: JobLockProvider | null): void {
  lockProvider = p ?? undefined;
}

/** Gancho de alertas: aperturas y cierres de cortocircuito (ver la cabecera). Nunca rompe la tarea. */
export function setJobCircuitListener(l: ((e: CircuitEvent) => void | Promise<void>) | null): void {
  circuitListener = l ?? undefined;
}

/** Solo pruebas: olvida cortocircuitos y registros; `now` fija el reloj de los cortocircuitos. */
export function resetJobIsolation(now?: () => number): void {
  circuits = new JobCircuitBreakers(now);
  last.clear();
}

export interface TenantJobOptions {
  /** También las empresas suspendidas o en solo lectura (con panel). Por defecto, solo las que admiten escrituras. */
  includeReadOnly?: boolean;
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

/** Cortocircuitos con fallos (abiertos, en prueba o acumulando fallos). */
export function jobCircuits(filter: { tenantId?: string; onlyOpen?: boolean } = {}): CircuitState[] {
  return circuits.list(filter);
}

/** Estado de las tareas de una empresa en este proceso (canal interno del plano de control, solo lectura). */
export function jobHealth(tenantId: string): { circuits: CircuitState[]; runs: JobRunRecord[]; hung: Record<string, number> } {
  return { circuits: circuits.list({ tenantId }), runs: jobStatus().filter((r) => r.tenantId === tenantId), hung: hungJobs() };
}

function emitCircuit(e: CircuitEvent | null): void {
  if (!e) return;
  if (e.type === "opened") {
    opsLog("error", "Jobs", "circuit_open", { job: e.job, tenantId: e.tenantId, failures: e.consecutiveFailures, opens: e.opens, retryAt: new Date(e.retryAt).toISOString(), reopen: e.reopen, error: e.lastError });
    meter(Metrics.JOB_CIRCUIT_OPEN, 1, "count", { job: e.job, reopen: e.reopen }, e.tenantId);
  } else {
    opsLog("info", "Jobs", "circuit_closed", { job: e.job, tenantId: e.tenantId, downMs: e.downMs });
  }
  try {
    void Promise.resolve(circuitListener?.(e)).catch(() => opsLog("warn", "Jobs", "circuit_listener_failed", { job: e.job, tenantId: e.tenantId }));
  } catch {
    opsLog("warn", "Jobs", "circuit_listener_failed", { job: e.job, tenantId: e.tenantId });
  }
}

/** Ejecuta `handler` ahora para todos los tenants aplicables. No lanza: devuelve resultados. */
export async function runTenantJob(name: string, handler: JobHandler, opts: TenantJobOptions = {}): Promise<TenantJobResult[]> {
  const multi = isMultiTenant();
  const policy = jobIsolationPolicy(name);
  const roundStart = Date.now();
  try {
    const results = await runForEachTenant(
      name,
      async (tenantId, signal): Promise<TenantJobOutcome> => {
        const key = keyOf(name, tenantId);
        const startedAt = Date.now();
        const skip = (reason: string): TenantJobOutcome => {
          last.set(key, { job: name, tenantId, startedAt, durationMs: 0, outcome: "skipped", reason });
          return { skipped: reason };
        };
        if (running.has(key)) return skip("running");
        const flag = jobFlags.get(name);
        if (flag && !(await getFeatureFlag(flag.key, flag.fallback))) return skip("flag_off");
        let lock: JobLock | null = null;
        if (multi && lockProvider) {
          try {
            lock = await lockProvider.tryAcquire(jobLockKey(name, tenantId));
          } catch {
            // Sin almacén de bloqueos no se arriesga un duplicado: se reintenta en el siguiente ciclo
            opsLog("warn", "Jobs", "lock_unavailable", { job: name, tenantId });
            return skip("lock_unavailable");
          }
          if (!lock) return skip("other_replica");
        }
        running.add(key);
        try {
          if (prelude) await prelude().catch(() => undefined);
          const run = () => Promise.resolve(handler({ tenantId, signal }));
          await (multi
            ? retryTransient(run, policy, {
                signal,
                onRetry: (attempt, delayMs, e) =>
                  opsLog("warn", "Jobs", "tenant_retry", { job: name, tenantId, attempt, delayMs, error: e instanceof Error ? e.message.slice(0, 200) : "error" }),
              })
            : run());
          const durationMs = Date.now() - startedAt;
          last.set(key, { job: name, tenantId, startedAt, durationMs, outcome: "ok" });
          meter(Metrics.JOB_RUN_MS, durationMs, "ms", { job: name, outcome: "ok" }, tenantId);
        } catch (e) {
          const durationMs = Date.now() - startedAt;
          const error = e instanceof Error ? e.message.slice(0, 200) : "error";
          last.set(key, { job: name, tenantId, startedAt, durationMs, outcome: "error", error });
          meter(Metrics.JOB_RUN_MS, durationMs, "ms", { job: name, outcome: "error" }, tenantId);
          throw e;
        } finally {
          // Al terminar DE VERDAD (también la ejecución abandonada por tiempo): hasta entonces nadie la duplica
          running.delete(key);
          await lock?.release().catch(() => undefined);
        }
      },
      opts.includeReadOnly ? (adminLister ?? lister) : lister,
      multi
        ? {
            concurrency: policy.concurrency,
            timeoutMs: policy.timeoutMs,
            maxHung: policy.maxHung,
            // Cortocircuito ANTES de tocar nada de la empresa (ni su base ni su configuración)
            admit: (tenantId) => (circuits.admit(name, tenantId).allowed ? null : "circuit_open"),
          }
        : {},
    );
    if (multi) settleRound(name, policy, results, roundStart);
    return results;
  } catch (e) {
    console.error(`[Jobs] ${name}:`, e instanceof Error ? e.message : "error");
    return [];
  }
}

/** Cortocircuitos, registro por empresa y resumen de la pasada (multi). */
function settleRound(name: string, policy: JobIsolationPolicy, results: TenantJobResult[], roundStart: number): void {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let timedOut = 0;
  for (const r of results) {
    const key = keyOf(name, r.tenantId);
    if (r.skipped) {
      skipped++;
      // Una ejecución de prueba que no llegó a correr deja libre la prueba para la siguiente pasada
      if (r.skipped !== "circuit_open") circuits.releaseTrial(name, r.tenantId);
      if (r.skipped === "circuit_open" || r.skipped === "hung_limit") {
        last.set(key, { job: name, tenantId: r.tenantId, startedAt: roundStart, durationMs: 0, outcome: "skipped", reason: r.skipped });
      }
      continue;
    }
    if (r.ok) {
      ok++;
      emitCircuit(circuits.success(name, r.tenantId));
      continue;
    }
    failed++;
    if (r.timedOut) {
      timedOut++;
      last.set(key, { job: name, tenantId: r.tenantId, startedAt: Date.now() - (r.durationMs ?? 0), durationMs: r.durationMs ?? 0, outcome: "timeout", error: r.error });
      meter(Metrics.JOB_RUN_MS, r.durationMs ?? 0, "ms", { job: name, outcome: "timeout" }, r.tenantId);
    }
    opsLog("error", "Jobs", "tenant_failed", { job: name, tenantId: r.tenantId, durationMs: r.durationMs ?? null, timedOut: !!r.timedOut, error: r.error ?? null });
    emitCircuit(circuits.failure(name, r.tenantId, r.error ?? "error", policy));
  }
  if (failed) {
    opsLog("warn", "Jobs", "run_done", { job: name, tenants: results.length, ok, failed, skipped, timedOut, durationMs: Date.now() - roundStart });
  }
}

/** Sustituye a `cron.schedule(expr, fn)`: misma firma + nombre de la tarea. */
export function scheduleTenantCron(expr: string, name: string, handler: JobHandler) {
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
  handler: JobHandler,
  opts: TenantJobOptions = {},
): { stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const tick = async () => {
    await runTenantJob(name, handler, opts);
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
