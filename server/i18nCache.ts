/**
 * Caché por empresa con TTL corto (épica E-1). La clave la pone quien llama (la empresa en curso): dos empresas nunca
 * comparten entrada. Se invalida al escribir; el TTL cubre otros procesos.
 */
export interface TenantCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
  clear(): void;
}

export function createTenantCache<T>(ttlMs: number, now: () => number = Date.now): TenantCache<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return {
    async get(key, load) {
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = load();
      entries.set(key, { at: now(), value });
      // Un fallo no se cachea
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    invalidate(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
