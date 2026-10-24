/**
 * Ficha 360° → Módulos: las cuatro capas de cada módulo de una empresa, sin confundirlas.
 *  - **Instalado**: el código está en la plataforma (Core o externo cargado), es compatible, sus dependencias se
 *    cumplen y no le quedan migraciones pendientes en la base de la empresa (dato del Core).
 *  - **Habilitado**: la empresa puede usarlo ahora mismo (licencia vigente o incluido, y flag operativo; dato del Core).
 *  - **Contratado**: licencia activa, incluido en la base o en el plan de su suscripción (registro y facturación).
 *  - **Comercializable**: figura en el catálogo comercial (en un plan o con precio como complemento).
 * Si el Core no responde, la capa técnica queda «sin datos»: nunca se da por instalado.
 */
import type { ModulesTechnicalReport } from "../_core/modules/technical";
import type { TenantModuleEntry } from "../_core/modules/catalog";

export type InstallState = "installed" | "update_pending" | "error" | "incompatible" | "not_installed" | "unknown";

export interface ModuleLayers {
  id: string;
  name: string;
  version: string | null;
  source: "core" | "external" | null;
  install: InstallState;
  installDetail: string | null;
  enabled: boolean | null;
  contracted: boolean;
  licenseState: string;
  sellable: boolean;
  dependsOn: Array<{ id: string; range: string; satisfied: boolean }>;
  migrations: { applied: Array<{ id: string; appliedAt: string | null }>; pending: string[] };
}

export function moduleLayers(
  licensed: TenantModuleEntry[],
  report: ModulesTechnicalReport | null,
  catalog: { plans?: Array<{ includedModules?: string[] }>; modules?: Array<{ moduleId: string; priceCents: number | null }> } | null,
): ModuleLayers[] {
  const sellableIds = new Set<string>([
    ...(catalog?.plans ?? []).flatMap((p) => p.includedModules ?? []),
    // Con precio publicado como complemento (sin precio no se puede vender suelto)
    ...(catalog?.modules ?? []).filter((m) => m.priceCents !== null).map((m) => m.moduleId),
  ]);
  const ids = Array.from(new Set([...licensed.map((m) => m.id), ...(report?.modules ?? []).map((m) => m.id)]));
  return ids.map((id) => {
    const lic = licensed.find((m) => m.id === id);
    const tech = report?.modules.find((m) => m.id === id) ?? null;
    let install: InstallState;
    let installDetail: string | null = null;
    if (!report) install = "unknown";
    else if (!tech) install = "not_installed";
    else if (!tech.compatible) {
      install = "incompatible";
      installDetail = `Requiere Core ${tech.coreRange} (plataforma ${report.coreVersion})`;
    } else if (tech.dependsOn.some((d) => !d.satisfied)) {
      install = "incompatible";
      installDetail = `Dependencias no cumplidas: ${tech.dependsOn.filter((d) => !d.satisfied).map((d) => `${d.id} ${d.range}`).join(", ")}`;
    } else if (tech.migrations.error) {
      install = "error";
      installDetail = tech.migrations.error;
    } else if (tech.migrations.pending.length) {
      install = "update_pending";
      installDetail = `${tech.migrations.pending.length} migración(es) pendiente(s): ${tech.migrations.pending.join(", ")}`;
    } else install = "installed";
    const licenseState = lic?.state ?? "inactive";
    return {
      id,
      name: lic?.name ?? tech?.name ?? id,
      version: tech?.version ?? null,
      source: tech?.source ?? null,
      install,
      installDetail,
      enabled: tech ? tech.enabled : null,
      contracted: licenseState === "active" || licenseState === "included" || !!lic?.includedInPlan,
      licenseState,
      sellable: sellableIds.has(id),
      dependsOn: tech?.dependsOn ?? [],
      migrations: { applied: tech?.migrations.applied ?? [], pending: tech?.migrations.pending ?? [] },
    };
  });
}
