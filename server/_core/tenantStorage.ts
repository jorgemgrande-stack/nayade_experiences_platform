/**
 * Aislamiento de ficheros por tenant.
 *
 * Todas las claves de almacenamiento pasan por `scopeStorageKey`:
 *  - Se rechaza cualquier clave con segmentos `..`, barras invertidas, NUL o demasiado larga
 *    (en cualquier modo: evita escapar del directorio local o del prefijo).
 *  - single / shadow: la clave no cambia (compatible con los ficheros existentes).
 *  - multi: `t/<tenantId>/<clave>`. Una clave que ya apunte a `t/<otro>/…` se rechaza.
 *    El tenant indicado en `TENANT_LEGACY_STORAGE_TENANT` conserva el espacio sin prefijo
 *    (ficheros heredados de Náyade) y no puede leer espacios `t/…`.
 *
 * Nota: el aislamiento por prefijo no sustituye a una política de acceso del proveedor; con
 * un bucket de lectura pública la protección real es el nombre no adivinable. Ver
 * docs/roadmap/DECISIONS.md.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getTenantId, getTenantMode, peekTenantContext } from "./tenant";

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

const PREFIX_ROOT = "t/";

export function tenantStoragePrefix(tenantId: string): string {
  return `${PREFIX_ROOT}${tenantId}/`;
}

function legacyTenant(): string | undefined {
  return process.env.TENANT_LEGACY_STORAGE_TENANT || undefined;
}

/** Normaliza y valida; devuelve la clave sin barra inicial. */
export function sanitizeStorageKey(relKey: string): string {
  if (typeof relKey !== "string") throw new StorageKeyError("Clave de almacenamiento no válida");
  const key = relKey.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!key || key.length > 1024) throw new StorageKeyError("Clave de almacenamiento no válida");
  if (key.includes("\0") || key.includes("\\")) throw new StorageKeyError("Clave de almacenamiento no válida");
  if (key.split("/").some((s) => s === ".." || s === ".")) throw new StorageKeyError("Clave de almacenamiento no válida");
  return key;
}

export function scopeStorageKey(relKey: string): string {
  const key = sanitizeStorageKey(relKey);
  if (getTenantMode() !== "multi") return key;

  const tenant = getTenantId(); // lanza sin contexto: nunca se escribe «en ninguna parte»
  if (key.startsWith(PREFIX_ROOT)) {
    if (key.startsWith(tenantStoragePrefix(tenant))) return key;
    throw new StorageKeyError("La clave pertenece a otro tenant");
  }
  if (legacyTenant() === tenant) return key;
  return tenantStoragePrefix(tenant) + key;
}

/** ¿Puede este tenant servir esta ruta de fichero local? */
export function storagePathAllowed(pathKey: string, tenantId: string): boolean {
  let key: string;
  try {
    key = sanitizeStorageKey(pathKey);
  } catch {
    return false;
  }
  if (key.startsWith(PREFIX_ROOT)) return key.startsWith(tenantStoragePrefix(tenantId));
  return legacyTenant() === tenantId;
}

/** Middleware para `/local-storage`: en multi solo sirve ficheros del tenant de la petición. */
export function localStorageTenantGuard(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (getTenantMode() !== "multi") return next();
    const tenant = peekTenantContext()?.tenantId ?? null;
    let p: string;
    try {
      p = decodeURIComponent(req.path);
    } catch {
      return res.status(404).end();
    }
    if (!tenant || !storagePathAllowed(p, tenant)) return res.status(404).end();
    return next();
  };
}
