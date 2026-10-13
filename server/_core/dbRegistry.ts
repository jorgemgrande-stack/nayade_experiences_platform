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
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { DEFAULT_TENANT_ID, TenantResolutionError, getTenantId, isMultiTenant } from "./tenant";

const createDatabase = (pool: mysql.Pool) => drizzle(pool);
export type Database = ReturnType<typeof createDatabase>;

/** Devuelve la cadena de conexión del tenant, o `null` si no existe. */
export type ConnectionResolver = (tenantId: string) => string | null | Promise<string | null>;

type Entry = { pool: mysql.Pool; db: Database };

const entries = new Map<string, Entry>();
// Creaciones en curso: dos primeras llamadas simultáneas deben compartir el mismo pool.
const inflight = new Map<string, Promise<Database | null>>();
let resolver: ConnectionResolver | null = null;

const POOL_CONNECTION_LIMIT = 10;

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

/**
 * Base de datos del tenant actual (o del indicado).
 * Devuelve `null` si no hay conexión configurada en modo `single`, como `getDb()` hoy.
 */
export async function getTenantDatabase(tenantId?: string): Promise<Database | null> {
  const id = tenantId ?? getTenantId();
  const key = !isMultiTenant() ? DEFAULT_TENANT_ID : id;

  const existing = entries.get(key);
  if (existing) return existing.db;

  let creating = inflight.get(key);
  if (!creating) {
    creating = createEntry(id, key).finally(() => inflight.delete(key));
    inflight.set(key, creating);
  }
  return creating;
}

async function createEntry(id: string, key: string): Promise<Database | null> {
  const uri = await resolveUri(id);
  if (!uri) return null;

  try {
    const pool = mysql.createPool({ uri, connectionLimit: POOL_CONNECTION_LIMIT });
    const db = createDatabase(pool);
    entries.set(key, { pool, db });
    return db;
  } catch (error) {
    console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "error");
    return null;
  }
}

/**
 * Acceso SÍNCRONO a la base de datos única de hoy, solo para el código heredado que crea su
 * conexión en el momento de importar el módulo (ver _core/legacyDb).
 *
 * Solo existe en modo `single`: en `multi` no hay una única base de datos, y un acceso
 * síncrono sin tenant sería justo el riesgo de fuga entre clientes que se quiere evitar.
 */
function getSingleEntrySync(): Entry | null {
  if (isMultiTenant()) {
    throw new TenantResolutionError(
      "Acceso heredado a la base de datos no disponible en modo multi-tenant: usar getDb() con tenant resuelto",
    );
  }
  const existing = entries.get(DEFAULT_TENANT_ID);
  if (existing) return existing;
  const uri = process.env.DATABASE_URL;
  if (!uri) return null;
  const pool = mysql.createPool({ uri, connectionLimit: POOL_CONNECTION_LIMIT });
  const entry = { pool, db: createDatabase(pool) };
  entries.set(DEFAULT_TENANT_ID, entry);
  return entry;
}

export function getSingleTenantDatabaseSync(): Database | null {
  return getSingleEntrySync()?.db ?? null;
}

export function getSingleTenantPoolSync(): mysql.Pool | null {
  return getSingleEntrySync()?.pool ?? null;
}

/** Cierra y olvida los pools (apagado ordenado y pruebas). */
export async function closeAllDatabases(): Promise<void> {
  const all = Array.from(entries.values());
  entries.clear();
  await Promise.allSettled(all.map((e) => e.pool.end()));
}

/** Solo para pruebas: olvida los pools sin cerrarlos. */
export function _resetRegistryForTests(): void {
  entries.clear();
  inflight.clear();
  resolver = null;
}
