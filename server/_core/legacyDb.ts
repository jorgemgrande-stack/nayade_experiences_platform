/**
 * Acceso heredado a la base de datos: mismo contrato que tenían los ficheros que creaban su
 * propio pool al importarse (`const db = drizzle(pool)`), pero respaldado por el registro.
 *
 * Qué cambia respecto a crear un pool por fichero:
 *  - Un único pool compartido (10 conexiones) en lugar de decenas de pools de 1 conexión.
 *  - Resolución perezosa: no se abre ninguna conexión al importar el módulo.
 *  - En modo `multi-tenant` falla de forma explícita (TenantResolutionError): estos accesos
 *    son síncronos y no conocen el tenant, así que nunca deben servir datos de «alguna» BD.
 *
 * Es un puente de migración: el código nuevo debe usar `getDb()` (asíncrono y con tenant).
 */
import type mysql from "mysql2/promise";
import { getSingleTenantDatabaseSync, getSingleTenantPoolSync, type Database } from "./dbRegistry";

function lazy<T extends object>(resolve: () => T | null, what: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      const target = resolve();
      if (!target) throw new Error(`${what}: base de datos no configurada (DATABASE_URL)`);
      const value = (target as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(_t, prop) {
      const target = resolve();
      return !!target && prop in (target as object);
    },
  });
}

/** Equivale a `mysql.createPool(...)` del código heredado. */
export function legacyPool(): mysql.Pool {
  return lazy<mysql.Pool>(getSingleTenantPoolSync, "legacyPool");
}

/** Equivale a `drizzle(pool)` del código heredado. */
export function legacyDb(): Database {
  return lazy<Database>(getSingleTenantDatabaseSync, "legacyDb");
}
