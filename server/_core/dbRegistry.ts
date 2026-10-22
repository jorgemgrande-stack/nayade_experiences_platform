/**
 * Registro de acceso a la base de datos por tenant.
 *
 * Punto único de resolución «tenant → conexión». Hoy, en modo `single`, devuelve la misma
 * base de datos que siempre (DATABASE_URL) con la misma configuración de pool, de modo que
 * `getDb()` no cambia de comportamiento. En modo `multi` cada tenant obtiene su propio pool,
 * a partir de un resolvedor de conexiones que proporcionará el plano de control.
 *
 * Reglas de seguridad:
 *  - Nunca se comparte un pool entre tenants distintos.
 *  - En `multi` no hay «tenant por defecto»: sin tenant resuelto se lanza.
 *  - La cadena de conexión nunca se registra en logs.
 *
 * Consumo de conexiones en `multi` (ver _core/dbPoolConfig y el runbook OPERACIONES_MULTITENANT):
 *  - Cada pool de empresa reserva su límite completo de un PRESUPUESTO por proceso; la suma de
 *    reservas nunca supera el presupuesto, así que las conexiones abiertas tampoco.
 *  - Sin hueco: se expulsa el pool menos usado recientemente que no esté arrendado (LRU); si
 *    todos están arrendados se espera un tiempo máximo y después `DbCapacityError` (503 con
 *    `Retry-After` en el borde HTTP). Nunca se abre por encima del presupuesto.
 *  - Las conexiones ociosas se cierran (`maxIdle`/`idleTimeout`) y los pools sin actividad
 *    durante `inactiveMs` se cierran por completo.
 *
 * Acceso síncrono heredado en `multi` (ver _core/legacyDb y docs/architecture/
 * MULTIEMPRESA_ACCESO_HEREDADO.md): el borde (middleware de petición, jobs) «arrienda» el pool
 * del tenant con `leaseTenantDatabase` y lo asocia al contexto ALS en curso. El acceso
 * síncrono solo devuelve ese pool arrendado: sin contexto o sin arriendo, lanza.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import {
  DEFAULT_TENANT_ID,
  TenantResolutionError,
  getTenantId,
  isMultiTenant,
  peekTenantContext,
  runWithTenant,
  type TenantContext,
} from "./tenant";
import { effectiveMaxPools, intFromEnv, tenantPoolPolicyFromEnv, type TenantPoolPolicy } from "./dbPoolConfig";
import { Metrics, meter } from "./metering";

const createDatabase = (pool: mysql.Pool) => drizzle(pool);
export type Database = ReturnType<typeof createDatabase>;

/** Devuelve la cadena de conexión del tenant, o `null` si no existe. */
export type ConnectionResolver = (tenantId: string) => string | null | Promise<string | null>;

/** Sin hueco en el presupuesto de conexiones tras la espera máxima: reintentar más tarde (503). */
export class DbCapacityError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Capacidad de conexiones a la base de datos agotada temporalmente");
    this.name = "DbCapacityError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Entry = {
  tenantId: string;
  pool: mysql.Pool;
  db: Database;
  /** Arriendos activos (peticiones/jobs en curso que usan este pool). */
  pins: number;
  /** Fuera del registro: se cierra al liberarse el último arriendo. */
  retired: boolean;
  /** Conexiones reservadas del presupuesto (0 en single: fuera del presupuesto). */
  reserved: number;
  /** Última actividad (arriendo, acceso o liberación), para la inactividad. */
  lastUsed: number;
  /** `pool.end()` ya solicitado: su reserva ya se devolvió. */
  closed: boolean;
};

type Inflight = { promise: Promise<Entry | null>; pins: number };
type Waiter = { need: number; since: number; tenantId: string; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const entries = new Map<string, Entry>();
// Pools aún abiertos (incluidos los retirados que esperan a que se libere su último arriendo)
const alive = new Set<Entry>();
// Creaciones en curso: dos primeras llamadas simultáneas deben compartir el mismo pool.
const inflight = new Map<string, Inflight>();
// Pool arrendado por cada contexto de tenant (petición o ejecución de job).
const leasedByContext = new WeakMap<TenantContext, Entry>();
let resolver: ConnectionResolver | null = null;

let policy: TenantPoolPolicy | null = null;
const getPolicy = (): TenantPoolPolicy => (policy ??= tenantPoolPolicyFromEnv(process.env));
/** Conexiones reservadas por los pools de empresa abiertos (≤ presupuesto). */
let reservedTotal = 0;
let reservedPools = 0;
const waiters: Waiter[] = [];
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const counters = { created: 0, waits: 0, waitTimeouts: 0, evictedLru: 0, evictedIdle: 0, peakReserved: 0 };
let lastLoggedCounters = "";

/** Configura cómo se resuelve la conexión de cada tenant (modo multi). */
export function setConnectionResolver(r: ConnectionResolver | null): void {
  resolver = r;
}

async function resolveUri(tenantId: string): Promise<string | null> {
  if (!isMultiTenant()) {
    // Un único tenant: la BD de siempre, para cualquier identificador.
    return process.env.DATABASE_URL ?? null;
  }
  if (!resolver) {
    throw new TenantResolutionError("No hay resolvedor de conexiones configurado para el modo multi-tenant");
  }
  const uri = await resolver(tenantId);
  if (!uri) throw new TenantResolutionError("Tenant desconocido");
  return uri;
}

async function getEntry(tenantId?: string, pin = false): Promise<Entry | null> {
  const id = tenantId ?? getTenantId();
  const key = !isMultiTenant() ? DEFAULT_TENANT_ID : id;

  const existing = entries.get(key);
  if (existing) {
    // Recencia para la expulsión LRU: Map conserva el orden de inserción
    if (isMultiTenant()) {
      entries.delete(key);
      entries.set(key, existing);
    }
    existing.lastUsed = Date.now();
    // El arriendo se toma en el mismo paso síncrono: nada puede expulsarlo entre medias
    if (pin) existing.pins++;
    return existing;
  }

  let creating = inflight.get(key);
  if (!creating) {
    const fl: Inflight = { pins: 0, promise: null as unknown as Promise<Entry | null> };
    fl.promise = createEntry(id, key, fl).finally(() => inflight.delete(key));
    inflight.set(key, fl);
    creating = fl;
  }
  // Los arriendos pedidos durante la creación se aplican al nacer el pool (ver createEntry)
  if (pin) creating.pins++;
  return creating.promise;
}

/**
 * Base de datos del tenant actual (o del indicado).
 * Devuelve `null` si no hay conexión configurada en modo `single`, como `getDb()` hoy.
 */
export async function getTenantDatabase(tenantId?: string): Promise<Database | null> {
  return (await getEntry(tenantId))?.db ?? null;
}

function tenantPoolOptions(uri: string, p: TenantPoolPolicy): mysql.PoolOptions {
  return { uri, connectionLimit: p.connectionsPerTenant, maxIdle: p.maxIdle, idleTimeout: p.idleTimeoutMs };
}

/** Pool único de single/shadow: mismo tamaño que siempre (10), configurable con DB_POOL_CONNECTIONS. */
function singlePoolOptions(uri: string): mysql.PoolOptions {
  return { uri, connectionLimit: intFromEnv(process.env, "DB_POOL_CONNECTIONS", 10, 1, 100) };
}

async function createEntry(id: string, key: string, fl: Inflight): Promise<Entry | null> {
  const uri = await resolveUri(id);
  if (!uri) return null;
  const multi = isMultiTenant();
  const p = getPolicy();
  // Reserva ANTES de crear el pool: si no hay hueco, espera o lanza DbCapacityError
  if (multi) await acquireBudget(p.connectionsPerTenant, key);

  try {
    const pool = mysql.createPool(multi ? tenantPoolOptions(uri, p) : singlePoolOptions(uri));
    const entry: Entry = {
      tenantId: key,
      pool,
      db: createDatabase(pool),
      pins: fl.pins,
      retired: false,
      reserved: multi ? p.connectionsPerTenant : 0,
      lastUsed: Date.now(),
      closed: false,
    };
    entries.set(key, entry);
    alive.add(entry);
    if (multi) {
      counters.created++;
      ensureSweep();
    }
    return entry;
  } catch (error) {
    if (multi) returnBudget(p.connectionsPerTenant);
    console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "error");
    return null;
  }
}

// ─── Presupuesto de conexiones ──────────────────────────────────────────────────────────────

function fits(need: number): boolean {
  const p = getPolicy();
  return reservedTotal + need <= p.connectionBudget && reservedPools < effectiveMaxPools(p);
}

/** Expulsa pools sin arriendo, del menos al más reciente, hasta que quepa `need`. */
function tryReserve(need: number): boolean {
  if (!fits(need)) {
    for (const [key, e] of Array.from(entries)) {
      if (fits(need)) break;
      if (e.pins > 0 || e.retired || e.reserved === 0) continue;
      retire(key, e);
      counters.evictedLru++;
      meter(Metrics.DB_POOL_EVICTED, 1, "count", { reason: "lru" }, key);
    }
  }
  if (!fits(need)) return false;
  reservedTotal += need;
  reservedPools++;
  counters.peakReserved = Math.max(counters.peakReserved, reservedTotal);
  return true;
}

function returnBudget(n: number): void {
  reservedTotal -= n;
  reservedPools--;
}

function acquireBudget(need: number, tenantId: string): Promise<void> {
  // Orden de llegada: si ya hay quien espera, se pone a la cola
  if (waiters.length === 0 && tryReserve(need)) return Promise.resolve();
  const p = getPolicy();
  counters.waits++;
  return new Promise<void>((resolve, reject) => {
    const w: Waiter = {
      need,
      since: Date.now(),
      tenantId,
      resolve,
      reject,
      timer: setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        counters.waitTimeouts++;
        meter(Metrics.DB_POOL_REJECTED, 1, "count", undefined, tenantId);
        reject(new DbCapacityError(p.retryAfterSeconds));
        // El siguiente de la cola puede necesitar menos o encontrar hueco ahora
        pump();
      }, p.waitMs),
    };
    waiters.push(w);
  });
}

let pumping = false;
/** Atiende a la cola de espera mientras haya hueco (tras cerrar o desarrendar un pool). */
function pump(): void {
  if (pumping) return;
  pumping = true;
  try {
    while (waiters.length > 0 && tryReserve(waiters[0].need)) {
      const w = waiters.shift()!;
      clearTimeout(w.timer);
      meter(Metrics.DB_POOL_WAIT_MS, Date.now() - w.since, "ms", undefined, w.tenantId);
      w.resolve();
    }
  } finally {
    pumping = false;
  }
}

/** Saca el pool del registro; se cierra ya si no tiene arriendos (si no, al liberar el último). */
function retire(key: string, e: Entry): Promise<void> {
  if (entries.get(key) === e) entries.delete(key);
  e.retired = true;
  return e.pins === 0 ? close(e) : Promise.resolve();
}

/** Cierra el pool y devuelve su reserva al presupuesto en el acto (idempotente). */
function close(e: Entry): Promise<void> {
  if (e.closed) return Promise.resolve();
  e.closed = true;
  alive.delete(e);
  if (e.reserved > 0) returnBudget(e.reserved);
  return e.pool.end().catch(() => undefined);
}

// ─── Inactividad ────────────────────────────────────────────────────────────────────────────

function ensureSweep(): void {
  if (sweepTimer) return;
  const p = getPolicy();
  const every = Math.max(1_000, Math.min(60_000, Math.floor(p.inactiveMs / 2)));
  sweepTimer = setInterval(sweepInactivePools, every);
  sweepTimer.unref?.();
}

/** Cierra los pools de empresa sin arriendos ni actividad durante `inactiveMs`. Devuelve cuántos. */
export function sweepInactivePools(now = Date.now()): number {
  const p = getPolicy();
  let closed = 0;
  for (const [key, e] of Array.from(entries)) {
    if (e.pins > 0 || e.reserved === 0 || now - e.lastUsed < p.inactiveMs) continue;
    void retire(key, e);
    closed++;
    counters.evictedIdle++;
    meter(Metrics.DB_POOL_EVICTED, 1, "count", { reason: "idle" }, key);
  }
  if (closed > 0) pump();
  logStatsIfChanged();
  return closed;
}

// ─── Arriendos ──────────────────────────────────────────────────────────────────────────────

/** Arriendo de un pool: mientras no se libere, la expulsión no lo cierra. */
export interface TenantDbLease {
  db: Database;
  pool: mysql.Pool;
  /** Idempotente. */
  release(): void;
}

/**
 * Precarga y arrienda el pool del tenant del contexto actual, y lo asocia a ese contexto para
 * el acceso síncrono heredado. Debe llamarse DENTRO de `runWithTenant` (middleware, jobs).
 *
 * Solo tiene efecto en `multi`; en `single`/`shadow` no se usa (el acceso heredado sigue como
 * siempre). Lanza si el tenant no tiene conexión resoluble: falla cerrado. Lanza
 * `DbCapacityError` si el presupuesto de conexiones está agotado tras la espera máxima.
 */
export async function leaseTenantDatabase(): Promise<TenantDbLease> {
  const ctx = peekTenantContext();
  if (!ctx) throw new TenantResolutionError("Arriendo de base de datos sin tenant en contexto");
  // El arriendo se toma de forma atómica al obtener el pool (existente o recién creado)
  const entry = await getEntry(ctx.tenantId, true);
  if (!entry) throw new TenantResolutionError("Tenant sin base de datos configurada");
  leasedByContext.set(ctx, entry);
  let released = false;
  return {
    db: entry.db,
    pool: entry.pool,
    release() {
      if (released) return;
      released = true;
      entry.pins--;
      entry.lastUsed = Date.now();
      if (entry.pins > 0) return;
      if (entry.retired) void close(entry);
      // Al quedar sin arriendos el pool es expulsable: quien espera puede tener hueco
      if (waiters.length > 0) pump();
    },
  };
}

/**
 * Ejecuta `fn` en el contexto del tenant con su pool precargado y arrendado (jobs, tareas
 * internas, scripts). El acceso heredado síncrono (`legacyDb()`) funciona dentro de `fn`.
 */
export function withTenantDb<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return runWithTenant(tenantId, async () => {
    if (!isMultiTenant()) return fn();
    const lease = await leaseTenantDatabase();
    try {
      return await fn();
    } finally {
      lease.release();
    }
  });
}

/**
 * Pool del contexto actual para el acceso SÍNCRONO heredado (ver _core/legacyDb).
 *
 *  - single/shadow: la base de datos única de siempre (DATABASE_URL), como hasta ahora.
 *  - multi: el pool arrendado por el contexto de tenant en curso. Sin contexto, o sin arriendo
 *    (no precargado), lanza: nunca se sirve «alguna» base de datos.
 */
function getCurrentEntrySync(): Entry | null {
  if (isMultiTenant()) {
    const ctx = peekTenantContext();
    if (!ctx) {
      throw new TenantResolutionError(
        "Acceso heredado a la base de datos sin tenant en contexto (modo multi-tenant)",
      );
    }
    const leased = leasedByContext.get(ctx);
    if (!leased || leased.tenantId !== ctx.tenantId) {
      throw new TenantResolutionError(
        "Acceso heredado a la base de datos sin pool precargado para el tenant (modo multi-tenant)",
      );
    }
    return leased;
  }
  const existing = entries.get(DEFAULT_TENANT_ID);
  if (existing) return existing;
  const uri = process.env.DATABASE_URL;
  if (!uri) return null;
  const pool = mysql.createPool(singlePoolOptions(uri));
  const entry: Entry = {
    tenantId: DEFAULT_TENANT_ID,
    pool,
    db: createDatabase(pool),
    pins: 0,
    retired: false,
    reserved: 0,
    lastUsed: Date.now(),
    closed: false,
  };
  entries.set(DEFAULT_TENANT_ID, entry);
  alive.add(entry);
  return entry;
}

/** BD del contexto para el acceso heredado síncrono (single: la única; multi: la arrendada). */
export function getCurrentDatabaseSync(): Database | null {
  return getCurrentEntrySync()?.db ?? null;
}

/** Pool del contexto para el acceso heredado síncrono (single: el único; multi: el arrendado). */
export function getCurrentPoolSync(): mysql.Pool | null {
  return getCurrentEntrySync()?.pool ?? null;
}

/** Alias históricos (mismo comportamiento que `getCurrent*Sync`). */
export const getSingleTenantDatabaseSync = getCurrentDatabaseSync;
export const getSingleTenantPoolSync = getCurrentPoolSync;

/**
 * Cierra y olvida el pool de un tenant (cambio de BD activa, suspensión, baja). La siguiente
 * petición vuelve a resolver la conexión en el registro. Si hay peticiones en curso con el
 * pool arrendado, el cierre se aplaza hasta que se libere el último arriendo.
 */
export async function evictTenantDatabase(tenantId: string): Promise<boolean> {
  const e = entries.get(tenantId);
  if (!e) return false;
  const done = retire(tenantId, e);
  if (waiters.length > 0) pump();
  await done;
  return true;
}

// ─── Diagnóstico ────────────────────────────────────────────────────────────────────────────

/** Tenants con pool abierto (diagnóstico y pruebas). */
export function openTenantPools(): string[] {
  return Array.from(entries.keys());
}

/** Métricas de los pools de empresa SIN identificadores de empresa ni datos de conexión. */
export interface TenantPoolStats {
  pools: number;
  poolsLeased: number;
  poolsMax: number;
  connectionsPerTenant: number;
  connectionBudget: number;
  connectionsReserved: number;
  /** Conexiones realmente abiertas ahora por estos pools (en uso + ociosas). */
  connectionsOpen: number;
  connectionsInUse: number;
  waiting: number;
  totals: { poolsCreated: number; waits: number; waitTimeouts: number; evictedLru: number; evictedIdle: number; peakReserved: number };
}

/** Conexiones abiertas y libres de un pool de mysql2 (campos internos: si cambian, cuenta 0). */
function poolConnections(pool: mysql.Pool): { open: number; free: number } {
  const inner = (pool as unknown as { pool?: { _allConnections?: { length: number }; _freeConnections?: { length: number } } }).pool;
  const open = Number(inner?._allConnections?.length ?? 0);
  const free = Number(inner?._freeConnections?.length ?? 0);
  return { open: Number.isFinite(open) ? open : 0, free: Number.isFinite(free) ? free : 0 };
}

export function getTenantPoolStats(): TenantPoolStats {
  const p = getPolicy();
  let open = 0;
  let free = 0;
  let leased = 0;
  let pools = 0;
  for (const e of Array.from(alive)) {
    if (e.reserved === 0) continue; // el pool único de single no cuenta en el presupuesto
    pools++;
    if (e.pins > 0) leased++;
    const c = poolConnections(e.pool);
    open += c.open;
    free += c.free;
  }
  return {
    pools,
    poolsLeased: leased,
    poolsMax: effectiveMaxPools(p),
    connectionsPerTenant: p.connectionsPerTenant,
    connectionBudget: p.connectionBudget,
    connectionsReserved: reservedTotal,
    connectionsOpen: open,
    connectionsInUse: Math.max(0, open - free),
    waiting: waiters.length,
    totals: {
      poolsCreated: counters.created,
      waits: counters.waits,
      waitTimeouts: counters.waitTimeouts,
      evictedLru: counters.evictedLru,
      evictedIdle: counters.evictedIdle,
      peakReserved: counters.peakReserved,
    },
  };
}

/** Línea de log `DbPools` cuando cambian esperas, rechazos o expulsiones (sin datos sensibles). */
function logStatsIfChanged(): void {
  const key = JSON.stringify(counters);
  if (key === lastLoggedCounters) return;
  lastLoggedCounters = key;
  console.log(JSON.stringify({ ctx: "DbPools", event: "stats", ...getTenantPoolStats() }));
}

/** Cierra y olvida los pools (apagado ordenado y pruebas). */
export async function closeAllDatabases(): Promise<void> {
  const all = Array.from(alive);
  entries.clear();
  for (const e of all) e.retired = true;
  for (const w of waiters.splice(0)) {
    clearTimeout(w.timer);
    w.reject(new DbCapacityError(getPolicy().retryAfterSeconds));
  }
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  await Promise.allSettled(all.map((e) => close(e)));
}

/** Solo para pruebas: olvida los pools sin cerrarlos y vuelve a leer la política del entorno. */
export function _resetRegistryForTests(): void {
  entries.clear();
  alive.clear();
  inflight.clear();
  for (const w of waiters.splice(0)) clearTimeout(w.timer);
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  resolver = null;
  policy = null;
  reservedTotal = 0;
  reservedPools = 0;
  for (const k of Object.keys(counters) as Array<keyof typeof counters>) counters[k] = 0;
  lastLoggedCounters = "";
}
