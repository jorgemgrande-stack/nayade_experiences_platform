/**
 * Jobs y procesos internos con contexto de tenant explícito.
 *
 *  - single / shadow: el job se ejecuta una vez, en el tenant `default` (comportamiento actual).
 *  - multi: se ejecuta una vez POR tenant con escrituras permitidas (active/trial/grace),
 *    cada una dentro de su contexto; el fallo de un tenant no impide los demás.
 *
 * Un job que se ejecute en `multi` sin pasar por aquí no tiene contexto y `getTenantId()`
 * lanza: fallo seguro, nunca «alguna» base de datos.
 *
 * Aislamiento en `multi` (ver ./jobIsolation.ts): varias empresas a la vez (`concurrency`), con plazas globales y por
 * empresa, y tiempo máximo por empresa (`timeoutMs`): la empresa que lo supera queda en error y las demás siguen.
 * La ejecución abandonada cuenta como «colgada» hasta que termina de verdad; con `maxHung` colgadas de la misma
 * tarea no se arrancan más empresas de esa tarea.
 */
import { withTenantDb } from "../dbRegistry";
import { Metrics, meter } from "../metering";
import { opsLog } from "../ops/log";
import { DEFAULT_TENANT_ID, isMultiTenant, runWithTenant } from "../tenant";
import { JobTimeoutError, Semaphore, globalJobConcurrency, mapLimit, tenantJobConcurrency, withDeadline } from "./jobIsolation";
import { accessPolicy } from "./lifecycle";
import type { TenantRegistryReader } from "./store";

export interface TenantJobResult {
  tenantId: string;
  ok: boolean;
  error?: string;
  /** La empresa no se ejecutó (motivo: ya en curso, cortocircuito, otra réplica…). */
  skipped?: string;
  /** Se agotó el tiempo máximo (la ejecución puede seguir viva, «colgada»). */
  timedOut?: boolean;
  /** Duración de la ejecución de la empresa (solo multi). */
  durationMs?: number;
}

export interface TenantRunOptions {
  /** Empresas a la vez en esta pasada (por defecto 1: una tras otra). */
  concurrency?: number;
  /** Tiempo máximo por empresa (por defecto, sin límite). */
  timeoutMs?: number;
  /** Ejecuciones colgadas de esta tarea a partir de las cuales no se arrancan más empresas. */
  maxHung?: number;
  /** Admisión previa, antes de tocar la base de la empresa: devuelve el motivo para omitirla o null. */
  admit?: (tenantId: string) => string | null;
}

/** Resultado de la ejecución de una empresa: nada (hecha) o la omisión con su motivo. */
export type TenantJobOutcome = void | { skipped: string };

export type TenantLister = () => Promise<string[]>;

/** Tenants sobre los que los jobs pueden escribir, según el registro. */
export function writableTenantLister(reader: Pick<TenantRegistryReader, "listTenants">): TenantLister {
  return async () => (await reader.listTenants()).filter((t) => accessPolicy(t.status).writes).map((t) => t.id);
}

/** Empresas con panel (activas, en prueba, en gracia o suspendidas): tareas que deben seguir en solo lectura. */
export function adminTenantLister(reader: Pick<TenantRegistryReader, "listTenants">): TenantLister {
  return async () => (await reader.listTenants()).filter((t) => accessPolicy(t.status).admin).map((t) => t.id);
}

let globalSlots: Semaphore | null = null;
const tenantSlots = new Map<string, Semaphore>();
const hung = new Map<string, number>();

const tenantSlot = (tenantId: string) => {
  let s = tenantSlots.get(tenantId);
  if (!s) {
    s = new Semaphore(tenantJobConcurrency());
    tenantSlots.set(tenantId, s);
  }
  return s;
};

/** Ejecuciones abandonadas por tiempo que siguen vivas, por tarea. */
export function hungJobs(): Record<string, number> {
  return Object.fromEntries(Array.from(hung.entries()).filter(([, n]) => n > 0));
}

/** Solo pruebas: rehace las plazas (tras cambiar las variables de concurrencia) y olvida las colgadas. */
export function resetJobSlots(): void {
  globalSlots = null;
  tenantSlots.clear();
  hung.clear();
}

export async function runForEachTenant(
  jobName: string,
  job: (tenantId: string, signal: AbortSignal) => Promise<TenantJobOutcome>,
  listTenants?: TenantLister,
  opts: TenantRunOptions = {},
): Promise<TenantJobResult[]> {
  if (!isMultiTenant()) {
    await runWithTenant(DEFAULT_TENANT_ID, () => job(DEFAULT_TENANT_ID, new AbortController().signal));
    return [{ tenantId: DEFAULT_TENANT_ID, ok: true }];
  }
  if (!listTenants) {
    throw new Error(`Job ${jobName}: en modo multi se requiere el listado de tenants del registro`);
  }
  return mapLimit(await listTenants(), opts.concurrency ?? 1, (tenantId) => runOneTenant(jobName, tenantId, job, opts));
}

async function runOneTenant(
  jobName: string,
  tenantId: string,
  job: (tenantId: string, signal: AbortSignal) => Promise<TenantJobOutcome>,
  opts: TenantRunOptions,
): Promise<TenantJobResult> {
  if (opts.maxHung !== undefined && (hung.get(jobName) ?? 0) >= opts.maxHung) {
    return { tenantId, ok: true, skipped: "hung_limit" };
  }
  const refused = opts.admit?.(tenantId);
  if (refused) return { tenantId, ok: true, skipped: refused };
  // Plazas de la empresa y global ANTES de contar el tiempo: esperar turno no es un fallo de la empresa
  const releaseTenant = await tenantSlot(tenantId).acquire();
  globalSlots ??= new Semaphore(globalJobConcurrency());
  const releaseGlobal = await globalSlots.acquire();
  const release = () => {
    releaseTenant();
    releaseGlobal();
  };
  const startedAt = Date.now();
  // Con el pool del tenant precargado y arrendado: el código heredado (legacyDb) funciona
  const run = (signal: AbortSignal) => withTenantDb(tenantId, () => job(tenantId, signal));
  const { result, settled } = withDeadline(run, opts.timeoutMs ?? 0);
  try {
    const out = await result;
    release();
    return { tenantId, ok: true, durationMs: Date.now() - startedAt, ...(out && out.skipped ? { skipped: out.skipped } : {}) };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const timedOut = e instanceof JobTimeoutError;
    release();
    if (timedOut) {
      // Se deja de esperar: la plaza se libera y la ejecución cuenta como colgada hasta que termine
      hung.set(jobName, (hung.get(jobName) ?? 0) + 1);
      opsLog("error", "Jobs", "tenant_timeout", { job: jobName, tenantId, timeoutMs: opts.timeoutMs, hung: hung.get(jobName) });
      void settled.then(() => {
        hung.set(jobName, Math.max(0, (hung.get(jobName) ?? 1) - 1));
        opsLog("warn", "Jobs", "hung_settled", { job: jobName, tenantId, durationMs: Date.now() - startedAt });
      });
    }
    // Sin datos del tenant ni del error más allá del mensaje
    meter(Metrics.TENANT_SHADOW, 1, "count", { verdict: timedOut ? "job_timeout" : "job_error", job: jobName }, tenantId);
    return { tenantId, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error", durationMs, ...(timedOut ? { timedOut } : {}) };
  }
}
