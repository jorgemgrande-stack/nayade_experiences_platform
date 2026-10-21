/**
 * Jobs y procesos internos con contexto de tenant explícito.
 *
 *  - single / shadow: el job se ejecuta una vez, en el tenant `default` (comportamiento actual).
 *  - multi: se ejecuta una vez POR tenant con escrituras permitidas (active/trial/grace),
 *    cada una dentro de su contexto; el fallo de un tenant no impide los demás.
 *
 * Un job que se ejecute en `multi` sin pasar por aquí no tiene contexto y `getTenantId()`
 * lanza: fallo seguro, nunca «alguna» base de datos.
 */
import { withTenantDb } from "../dbRegistry";
import { Metrics, meter } from "../metering";
import { DEFAULT_TENANT_ID, isMultiTenant, runWithTenant } from "../tenant";
import { accessPolicy } from "./lifecycle";
import type { TenantRegistryReader } from "./store";

export interface TenantJobResult {
  tenantId: string;
  ok: boolean;
  error?: string;
}

export type TenantLister = () => Promise<string[]>;

/** Tenants sobre los que los jobs pueden escribir, según el registro. */
export function writableTenantLister(reader: Pick<TenantRegistryReader, "listTenants">): TenantLister {
  return async () => (await reader.listTenants()).filter((t) => accessPolicy(t.status).writes).map((t) => t.id);
}

/** Empresas con panel (activas, en prueba, en gracia o suspendidas): tareas que deben seguir en solo lectura. */
export function adminTenantLister(reader: Pick<TenantRegistryReader, "listTenants">): TenantLister {
  return async () => (await reader.listTenants()).filter((t) => accessPolicy(t.status).admin).map((t) => t.id);
}

export async function runForEachTenant(
  jobName: string,
  job: (tenantId: string) => Promise<void>,
  listTenants?: TenantLister,
): Promise<TenantJobResult[]> {
  if (!isMultiTenant()) {
    await runWithTenant(DEFAULT_TENANT_ID, () => job(DEFAULT_TENANT_ID));
    return [{ tenantId: DEFAULT_TENANT_ID, ok: true }];
  }
  if (!listTenants) {
    throw new Error(`Job ${jobName}: en modo multi se requiere el listado de tenants del registro`);
  }
  const results: TenantJobResult[] = [];
  for (const tenantId of await listTenants()) {
    try {
      // Con el pool del tenant precargado y arrendado: el código heredado (legacyDb) funciona
      await withTenantDb(tenantId, () => job(tenantId));
      results.push({ tenantId, ok: true });
    } catch (e) {
      // Sin datos del tenant ni del error más allá del mensaje
      results.push({ tenantId, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
      meter(Metrics.TENANT_SHADOW, 1, "count", { verdict: "job_error", job: jobName });
    }
  }
  return results;
}
