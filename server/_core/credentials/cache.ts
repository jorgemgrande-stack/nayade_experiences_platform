/**
 * Lectura SÍNCRONA de credenciales ya descifradas del tenant en curso.
 *
 * Se precarga por petición/tarea (`warmIntegrationCreds`) y vive en memoria aislada por
 * tenant con TTL corto. Sin tenant resuelto o sin precarga devuelve `undefined`.
 */
import { TenantCache } from "../tenantScope";

type Resolved = Record<string, Record<string, string>>;

const cache = new TenantCache<Resolved>(60_000, 1);

export function setResolvedCredentials(r: Resolved): void {
  cache.set("all", r);
}

export function credentialFor(provider: string, field: string): string | undefined {
  return cache.get("all")?.[provider]?.[field];
}

export function hasWarmCredentials(): boolean {
  return cache.get("all") !== undefined;
}

export function invalidateCredentials(): void {
  cache.clear();
}
