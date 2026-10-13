/**
 * Contexto de tenant (inquilino).
 *
 * Elephant Source Core es un único despliegue que servirá a varios clientes, cada uno con
 * su propia base de datos. Este módulo fija la *forma* de la resolución del tenant sin
 * cambiar el comportamiento actual:
 *
 *  - TENANT_MODE=single (por defecto): todo el código se ejecuta en el tenant `default`,
 *    que es la única base de datos de hoy (DATABASE_URL).
 *  - TENANT_MODE=multi: una operación sin tenant resuelto es un error (fallo seguro), nunca
 *    se «cae» silenciosamente en otra base de datos.
 *
 * El tenant viaja en AsyncLocalStorage: lo fija el borde (middleware de resolución por
 * host, jobs, webhooks) con `runWithTenant` y lo leen las capas de datos, almacenamiento y
 * medición sin que cada función tenga que recibirlo por parámetro.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type TenantContext = {
  /** Identificador estable del tenant. Solo [a-z0-9_-], máx. 63. */
  tenantId: string;
};

export type TenantMode = "single" | "multi";

export const DEFAULT_TENANT_ID = "default";

const TENANT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantMode(): TenantMode {
  return process.env.TENANT_MODE === "multi" ? "multi" : "single";
}

export function isValidTenantId(id: unknown): id is string {
  return typeof id === "string" && TENANT_ID_RE.test(id);
}

export class TenantResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/** Ejecuta `fn` con el tenant indicado. El tenant se valida: nunca se confía en entrada sin comprobar. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!isValidTenantId(tenantId)) {
    throw new TenantResolutionError("Identificador de tenant no válido");
  }
  return storage.run({ tenantId }, fn);
}

/** Contexto actual, o `undefined` si no se ha fijado ninguno. */
export function peekTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Tenant de la operación en curso.
 * - single: el fijado, o `default`.
 * - multi: el fijado; si no hay ninguno lanza (nunca se asume uno).
 */
export function getTenantId(): string {
  const ctx = storage.getStore();
  if (ctx) return ctx.tenantId;
  if (getTenantMode() === "single") return DEFAULT_TENANT_ID;
  throw new TenantResolutionError("Operación sin tenant resuelto en modo multi-tenant");
}

/** Variante que no lanza: para medición y trazas, que nunca deben romper una petición. */
export function getTenantIdOrDefault(): string {
  try {
    return getTenantId();
  } catch {
    return "unresolved";
  }
}
