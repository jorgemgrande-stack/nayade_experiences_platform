/**
 * Contexto de empresa y de sede para los módulos.
 *
 * La empresa viene del contexto de tenant del Core (AsyncLocalStorage de `_core/tenant`). La sede viaja
 * en otro AsyncLocalStorage propio del SDK: la fija quien atiende la operación (`runWithSite`) y la leen
 * el guardián de licencias y los eventos.
 *
 * Validación de sedes: las sedes viven en el registro (`tenant_sites`, Elephant Control). El arranque
 * multiempresa debe configurar un directorio (`configureSiteDirectory`); sin él, en `multi` se falla
 * cerrado y en `single` (una sola empresa, sin registro) solo se valida el formato.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getTenantId, isMultiTenant } from "../_core/tenant";
import type { OrganizationStore } from "../organization/service";
import { LicenseUnverifiable, SiteUnknown } from "./errors";

/** Mismo formato que los ids de sede de Elephant Control. */
export const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface CompanyContext {
  tenantId: string;
  siteId: string | null;
}

const siteStorage = new AsyncLocalStorage<{ siteId: string }>();

export function runWithSite<T>(siteId: string, fn: () => T): T {
  if (!SITE_ID_RE.test(siteId)) throw new SiteUnknown(null, siteId, "Identificador de sede no válido");
  return siteStorage.run({ siteId }, fn);
}

/** Empresa (lanza en `multi` sin tenant) y sede en curso (o `null`). */
export function getCompanyContext(): CompanyContext {
  return { tenantId: getTenantId(), siteId: siteStorage.getStore()?.siteId ?? null };
}

export interface SiteDirectory {
  /** Ids de las sedes ACTIVAS de la empresa. */
  activeSites(tenantId: string): Promise<string[]>;
}

/** Adaptador del almacén de organización (registro) al directorio de sedes. */
export function siteDirectoryFrom(store: Pick<OrganizationStore, "sites">): SiteDirectory {
  return { activeSites: async (t) => (await store.sites(t)).filter((s) => s.status === "active").map((s) => s.siteId) };
}

let directory: SiteDirectory | null = null;

export function configureSiteDirectory(d: SiteDirectory | null): void {
  directory = d;
}

/** Lanza `SiteUnknown` si la sede no es una sede activa de la empresa en curso. */
export async function assertSite(siteId: string, moduleId: string | null = null, tenantId: string = getTenantId()): Promise<void> {
  if (!SITE_ID_RE.test(siteId)) throw new SiteUnknown(moduleId, siteId, "Identificador de sede no válido");
  if (!directory) {
    if (isMultiTenant()) throw new LicenseUnverifiable(moduleId, "Directorio de sedes no configurado");
    return;
  }
  let sites: string[];
  try {
    sites = await directory.activeSites(tenantId);
  } catch {
    throw new LicenseUnverifiable(moduleId, "No se pudieron verificar las sedes de la empresa");
  }
  if (!sites.includes(siteId)) throw new SiteUnknown(moduleId, siteId);
}
