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

const createDatabase = (pool: mysql.Pool) => drizzle(pool);
export type Database = ReturnType<typeof createDatabase>;

/** Devuelve la cadena de conexión del tenant, o `null` si no existe. */
export type ConnectionResolver = (tenantId: string) => string | null | Promise<string | null>;

type Entry = {
  tenantId: string;
  pool: mysql.Pool;
  db: Database;
  /** Arriendos activos (peticiones/jobs en curso que usan este pool). */
  pins: number;
  /** Fuera del registro: se cierra al liberarse el último arriendo. */
  retired: boolean;
};

const entries = new Map<string, Entry>();
// Creaciones en curso: dos primeras llamadas simultáneas deben compartir el mismo pool.
const inflight = new Map<string, Promise<Entry | null>>();
// Pool arrendado por cada contexto de tenant (petición o ejecución de job).
const leasedByContext = new WeakMap<TenantContext, Entry>();
let resolver: ConnectionResolver | null = null;

const POOL_CONNECTION_LIMIT = 10;
/** Máximo de pools simultáneos en modo multi (se expulsa el menos usado que no esté en uso). */
const MAX_TENANT_POOLS = 50;

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

async function getEntry(tenantId?: string): Promise<Entry | null> {
  const id = tenantId ?? getTenantId();
  const key = !isMultiTenant() ? DEFAULT_TENANT_ID : id;

  const existing = entries.get(key);
  if (existing) {
    // Recencia para la expulsión LRU: Map conserva el orden de inserción
    if (isMultiTenant()) {
      entries.delete(key);
      entries.set(key, existing);
    }
    return existing;
  }

  let creating = inflight.get(key);
  if (!creating) {
    creating = createEntry(id, key).finally(() => inflight.delete(key));
    inflight.set(key, creating);
  }
  return creating;
}

/**
 * Base de datos del tenant actual (o del indicado).
 * Devuelve `null` si no hay conexión configurada en modo `single`, como `getDb()` hoy.
 */
export async function getTenantDatabase(tenantId?: string): Promise<Database | null> {
  return (await getEntry(tenantId))?.db ?? null;
}

async function createEntry(id: string, key: string): Promise<Entry | null> {
  const uri = await resolveUri(id);
  if (!uri) return null;

  try {
    const pool = mysql.createPool({ uri, connectionLimit: POOL_CONNECTION_LIMIT });
    const entry: Entry = { tenantId: key, pool, db: createDatabase(pool), pins: 0, retired: false };
    entries.set(key, entry);
    if (isMultiTenant()) evictLeastRecentlyUsed(key);
    return entry;
  } catch (error) {
    console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "error");
    return null;
  }
}

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
 * siempre). Lanza si el tenant no tiene conexión resoluble: falla cerrado.
 */
export async function leaseTenantDatabase(): Promise<TenantDbLease> {
  const ctx = peekTenantContext();
  if (!ctx) throw new TenantResolutionError("Arriendo de base de datos sin tenant en contexto");
  // Una expulsión puede retirar el pool entre su creación y el arriendo: se reintenta.
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await getEntry(ctx.tenantId);
    if (!entry) throw new TenantResolutionError("Tenant sin base de datos configurada");
    if (entry.retired) continue;
    entry.pins++;
    leasedByContext.set(ctx, entry);
    let released = false;
    return {
      db: entry.db,
      pool: entry.pool,
      release() {
        if (released) return;
        released = true;
        entry.pins--;
        if (entry.retired && entry.pins === 0) void entry.pool.end().catch(() => undefined);
      },
    };
  }
  throw new TenantResolutionError("No se pudo arrendar la base de datos del tenant");
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
  const pool = mysql.createPool({ uri, connectionLimit: POOL_CONNECTION_LIMIT });
  const entry: Entry = { tenantId: DEFAULT_TENANT_ID, pool, db: createDatabase(pool), pins: 0, retired: false };
  entries.set(DEFAULT_TENANT_ID, entry);
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

function evictLeastRecentlyUsed(keep: string): void {
  if (entries.size <= MAX_TENANT_POOLS) return;
  // Del menos al más reciente; los pools en uso (arrendados) y el recién creado no se tocan.
  // Si todos están en uso se tolera superar el máximo temporalmente.
  for (const [key, e] of Array.from(entries)) {
    if (entries.size <= MAX_TENANT_POOLS) return;
    if (key === keep || e.pins > 0) continue;
    void evictTenantDatabase(key);
  }
}

/**
 * Cierra y olvida el pool de un tenant (cambio de BD activa, suspensión, baja). La siguiente
 * petición vuelve a resolver la conexión en el registro. Si hay peticiones en curso con el
 * pool arrendado, el cierre se aplaza hasta que se libere el último arriendo.
 */
export async function evictTenantDatabase(tenantId: string): Promise<boolean> {
  const e = entries.get(tenantId);
  if (!e) return false;
  entries.delete(tenantId);
  e.retired = true;
  if (e.pins === 0) await e.pool.end().catch(() => undefined);
  return true;
}

/** Tenants con pool abierto (diagnóstico y pruebas). */
export function openTenantPools(): string[] {
  return Array.from(entries.keys());
}

/** Cierra y olvida los pools (apagado ordenado y pruebas). */
export async function closeAllDatabases(): Promise<void> {
  const all = Array.from(entries.values());
  entries.clear();
  for (const e of all) e.retired = true;
  await Promise.allSettled(all.map((e) => e.pool.end()));
}

/** Solo para pruebas: olvida los pools sin cerrarlos. */
export function _resetRegistryForTests(): void {
  entries.clear();
  inflight.clear();
  resolver = null;
}
