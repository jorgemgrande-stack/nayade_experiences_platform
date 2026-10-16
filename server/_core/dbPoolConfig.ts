/**
 * Tamaños y política de los pools de conexiones MySQL, configurables por entorno.
 *
 * Una única instancia MySQL (Railway) la comparten el Core (pools de empresa + pools fijos del
 * registro y del ERM), el plano de control (registro, CRM, facturación…) y las bases de cada
 * empresa. Por eso:
 *  - Cada empresa abre como máximo `DB_TENANT_POOL_CONNECTIONS` conexiones.
 *  - La SUMA de los límites de todos los pools de empresa de un proceso nunca supera
 *    `DB_TENANT_CONNECTION_BUDGET` (presupuesto): se reserva el límite completo al crear el pool,
 *    así las conexiones reales nunca pueden pasar del presupuesto aunque todas se usen a la vez.
 *  - Las conexiones ociosas se cierran (`maxIdle`/`idleTimeout` de mysql2) y los pools de empresas
 *    sin actividad se cierran tras `DB_TENANT_POOL_INACTIVE_MS`.
 *
 * Dimensionado (ver docs/runbooks/OPERACIONES_MULTITENANT.md):
 *   conexiones ≤ procesos_core × (presupuesto + pools fijos del Core) + pools fijos del plano de control
 *
 * Valores no numéricos o fuera de rango se sustituyen por el valor por defecto (o se acotan):
 * una variable mal escrita nunca puede dejar el proceso sin límite.
 */

export interface TenantPoolPolicy {
  /** Conexiones máximas por empresa (connectionLimit del pool). */
  connectionsPerTenant: number;
  /** Pools de empresa vivos como máximo (además del límite implícito presupuesto / conexiones). */
  maxPools: number;
  /** Suma máxima de conexiones de todos los pools de empresa del proceso. */
  connectionBudget: number;
  /** Conexiones ociosas que cada pool conserva abiertas (el resto se cierra). */
  maxIdle: number;
  /** Tras cuánto tiempo ociosa se cierra una conexión (ms). */
  idleTimeoutMs: number;
  /** Tras cuánto tiempo sin actividad se cierra el pool entero de una empresa (ms). */
  inactiveMs: number;
  /** Espera máxima por hueco en el presupuesto antes de responder 503 (ms). */
  waitMs: number;
  /** Valor de `Retry-After` (s) cuando no hay hueco. */
  retryAfterSeconds: number;
}

type Env = Record<string, string | undefined>;

/** Entero de la variable `name` acotado a [min, max]; si falta o no es un entero, `def`. */
export function intFromEnv(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export const TENANT_POOL_DEFAULTS: TenantPoolPolicy = {
  connectionsPerTenant: 4,
  maxPools: 50,
  connectionBudget: 60,
  maxIdle: 1,
  idleTimeoutMs: 30_000,
  inactiveMs: 10 * 60_000,
  waitMs: 3_000,
  retryAfterSeconds: 5,
};

export function tenantPoolPolicyFromEnv(env: Env = process.env): TenantPoolPolicy {
  const d = TENANT_POOL_DEFAULTS;
  const connectionsPerTenant = intFromEnv(env, "DB_TENANT_POOL_CONNECTIONS", d.connectionsPerTenant, 1, 50);
  return {
    connectionsPerTenant,
    maxPools: intFromEnv(env, "DB_TENANT_POOLS_MAX", d.maxPools, 1, 10_000),
    // El presupuesto nunca puede ser menor que un pool: ninguna empresa podría abrir
    connectionBudget: intFromEnv(env, "DB_TENANT_CONNECTION_BUDGET", d.connectionBudget, connectionsPerTenant, 100_000),
    maxIdle: intFromEnv(env, "DB_TENANT_POOL_MAX_IDLE", d.maxIdle, 0, connectionsPerTenant),
    idleTimeoutMs: intFromEnv(env, "DB_TENANT_POOL_IDLE_TIMEOUT_MS", d.idleTimeoutMs, 1_000, 3_600_000),
    inactiveMs: intFromEnv(env, "DB_TENANT_POOL_INACTIVE_MS", d.inactiveMs, 1_000, 86_400_000),
    waitMs: intFromEnv(env, "DB_TENANT_BUDGET_WAIT_MS", d.waitMs, 0, 60_000),
    retryAfterSeconds: intFromEnv(env, "DB_TENANT_RETRY_AFTER_SECONDS", d.retryAfterSeconds, 1, 300),
  };
}

/** Pools que caben a la vez: el menor entre el máximo configurado y presupuesto / conexiones. */
export function effectiveMaxPools(p: TenantPoolPolicy): number {
  return Math.max(1, Math.min(p.maxPools, Math.floor(p.connectionBudget / p.connectionsPerTenant)));
}

/**
 * Opciones de un pool FIJO (registro, ERM, CRM, facturación…): tamaño configurable con
 * `name` (p. ej. `DB_REGISTRY_POOL_CONNECTIONS`) y cierre de conexiones ociosas
 * (`DB_FIXED_POOL_MAX_IDLE`, `DB_FIXED_POOL_IDLE_TIMEOUT_MS`).
 */
export function fixedPoolOptions(
  name: string,
  def: number,
  env: Env = process.env,
): { connectionLimit: number; maxIdle: number; idleTimeout: number } {
  const connectionLimit = intFromEnv(env, name, def, 1, 100);
  return {
    connectionLimit,
    maxIdle: intFromEnv(env, "DB_FIXED_POOL_MAX_IDLE", 2, 0, connectionLimit),
    idleTimeout: intFromEnv(env, "DB_FIXED_POOL_IDLE_TIMEOUT_MS", 60_000, 1_000, 3_600_000),
  };
}
