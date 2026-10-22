/**
 * Catálogo de módulos (base del marketplace) y estado de módulos por tenant.
 *
 * Se construye a partir de los manifiestos (contrato de módulos), del catálogo comercial
 * (planes que incluyen cada módulo y precio como complemento, si existe) y de las licencias.
 * Las reglas de activación (dependencias) se comprueban aquí y las aplica el plano de control.
 */
import { MODULE_CONTRACT_VERSION, ModuleError, type ModuleManifest } from "./contract";
import { validateManifest } from "./registry";
import { satisfies } from "./semver";
import type { Entitlement } from "./entitlements";

export interface PlanRef {
  id: string;
  name: string;
  includedModules: string[];
}
export interface ModulePriceRef {
  moduleId: string;
  interval: "month" | "year";
  priceCents: number | null;
  currency: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  kind: ModuleManifest["kind"];
  description: string | null;
  coreRange: string;
  /** El manifiesto es compatible con la versión actual del Core. */
  compatible: boolean;
  dependsOn: Array<{ id: string; range: string }>;
  /** Módulos que dependen de este (directa o indirectamente). */
  dependents: string[];
  permissions: Array<{ key: string; description: string }>;
  navigationItems: number;
  hasMigrations: boolean;
  resources: string[];
  source: { location: "core" | "external"; repository?: string };
  availability: {
    includedInBase: boolean;
    /** Planes que lo incluyen. */
    plans: string[];
    /** Precio como complemento (null = sin tarifa definida; ausente = no se vende suelto). */
    addon: { interval: "month" | "year"; priceCents: number | null; currency: string } | null;
  };
  /** Tenants con la licencia activa (o todos, si va incluido en la base); null si no se calculó. */
  activeTenants: number | null;
}

export type TenantModuleState = "included" | "active" | "suspended" | "expired" | "inactive";

export interface TenantModuleEntry {
  id: string;
  name: string;
  state: TenantModuleState;
  validUntil: string | null;
  /** Dependencias no disponibles para el tenant (impiden activarlo). */
  missingDependencies: string[];
  /** Dependientes activos (impiden desactivarlo). */
  activeDependents: string[];
  includedInPlan: boolean;
}

/** Dependientes directos e indirectos (sin exigir compatibilidad: el catálogo también lista los incompatibles). */
export function dependentsOf(manifests: ModuleManifest[], id: string): string[] {
  const out = new Set<string>();
  const walk = (target: string) => {
    for (const m of manifests) {
      if ((m.dependsOn ?? []).some((d) => d.id === target) && !out.has(m.id)) {
        out.add(m.id);
        walk(m.id);
      }
    }
  };
  walk(id);
  return Array.from(out).sort();
}

export function buildCatalog(input: {
  manifests: ModuleManifest[];
  coreVersion: string;
  plans?: PlanRef[];
  modulePrices?: ModulePriceRef[];
  activeCounts?: Map<string, number> | null;
  tenantCount?: number | null;
}): { contractVersion: string; coreVersion: string; modules: CatalogEntry[] } {
  for (const m of input.manifests) validateManifest(m);
  const modules = input.manifests
    .map((m): CatalogEntry => {
      const price = input.modulePrices?.find((p) => p.moduleId === m.id) ?? null;
      const active = m.includedInBase ? (input.tenantCount ?? null) : (input.activeCounts?.get(m.id) ?? (input.activeCounts ? 0 : null));
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        kind: m.kind,
        description: m.description ?? null,
        coreRange: m.coreRange,
        compatible: satisfies(input.coreVersion, m.coreRange),
        dependsOn: m.dependsOn ?? [],
        dependents: dependentsOf(input.manifests, m.id),
        permissions: m.permissions ?? [],
        navigationItems: (m.navigation ?? []).length,
        hasMigrations: Boolean(m.migrationsDir),
        resources: m.resources ?? [],
        source: m.source ?? { location: "core" },
        availability: {
          includedInBase: Boolean(m.includedInBase),
          plans: (input.plans ?? []).filter((p) => p.includedModules.includes(m.id)).map((p) => p.id),
          addon: price ? { interval: price.interval, priceCents: price.priceCents, currency: price.currency } : null,
        },
        activeTenants: active,
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "core" ? -1 : b.kind === "core" ? 1 : a.kind.localeCompare(b.kind)));
  return { contractVersion: MODULE_CONTRACT_VERSION, coreVersion: input.coreVersion, modules };
}

const isActive = (e: Entitlement | undefined, now: number) => Boolean(e && e.status === "active" && (!e.validUntil || e.validUntil.getTime() > now));

/** Estado de cada módulo del catálogo para un tenant. */
export function tenantModules(manifests: ModuleManifest[], entitlements: Entitlement[], now: number, planModules: string[] = []): TenantModuleEntry[] {
  const byId = new Map(entitlements.map((e) => [e.moduleId, e]));
  const available = (id: string) => Boolean(manifests.find((m) => m.id === id)?.includedInBase) || isActive(byId.get(id), now);
  return manifests.map((m) => {
    const e = byId.get(m.id);
    let state: TenantModuleState;
    if (m.includedInBase) state = "included";
    else if (!e) state = "inactive";
    else if (e.status === "active" && e.validUntil && e.validUntil.getTime() <= now) state = "expired";
    else state = e.status as TenantModuleState;
    return {
      id: m.id,
      name: m.name,
      state,
      validUntil: e?.validUntil ? e.validUntil.toISOString() : null,
      missingDependencies: (m.dependsOn ?? []).map((d) => d.id).filter((d) => !available(d)),
      activeDependents: manifests.filter((x) => (x.dependsOn ?? []).some((d) => d.id === m.id) && isActive(byId.get(x.id), now)).map((x) => x.id),
      includedInPlan: planModules.includes(m.id),
    };
  });
}

/** Reglas de activación/desactivación: lanza `ModuleError` si se rompen dependencias. */
export function assertCanActivate(manifests: ModuleManifest[], entitlements: Entitlement[], moduleId: string, now: number): void {
  const entry = tenantModules(manifests, entitlements, now).find((x) => x.id === moduleId);
  if (!entry) return; // módulo externo desconocido para este plano de control: sin reglas que aplicar
  if (entry.missingDependencies.length) {
    throw new ModuleError("missing_dependency", `${moduleId} requiere antes: ${entry.missingDependencies.join(", ")}`);
  }
}

export function assertCanDeactivate(manifests: ModuleManifest[], entitlements: Entitlement[], moduleId: string, now: number): void {
  const entry = tenantModules(manifests, entitlements, now).find((x) => x.id === moduleId);
  if (!entry) return;
  if (entry.state === "included") throw new ModuleError("dependency_active", `${moduleId} va incluido en la base y no se puede desactivar`);
  if (entry.activeDependents.length) {
    throw new ModuleError("dependency_active", `Antes hay que desactivar: ${entry.activeDependents.join(", ")}`);
  }
}
