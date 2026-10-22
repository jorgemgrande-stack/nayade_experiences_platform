/**
 * Módulos y ampliaciones en el panel de la empresa: el catálogo publicado (plano de control) cruzado con las licencias
 * de ESTA empresa. Pura: no consulta nada ni cambia nada.
 */
import type { CapabilityGrant } from "./_core/capabilities/model";
import { effectiveStatus } from "./subscriptionOverview";

export type PanelModuleState = "active" | "read_only" | "available" | "on_request" | "coming_soon";

export interface PanelCatalogItemView {
  key: string;
  name: string;
  family: string;
  kind: "module" | "quantity";
  metric: string | null;
  step: number | null;
  commercialStatus: "coming_soon" | "on_request" | "available";
  capabilities: string[];
  monthly: { amountCents: number; currency: string; taxIncluded: boolean; unit: string | null } | null;
  purchasable: boolean;
}

export interface PanelModule extends PanelCatalogItemView {
  state: PanelModuleState;
}

export interface PanelModules {
  purchasesEnabled: boolean;
  modules: PanelModule[];
}

/**
 * Estado de cada módulo para esta empresa:
 *  - `active`: todas sus capacidades activas; `read_only`: todas visibles y alguna en solo lectura.
 *  - Si no lo tiene: su estado comercial (`available`, `on_request`, `coming_soon`).
 * Las ampliaciones por cantidad siempre muestran su estado comercial (se compran por unidades).
 */
export function panelModules(catalog: { purchasesEnabled: boolean; items: PanelCatalogItemView[] }, grants: CapabilityGrant[], now: number): PanelModules {
  const modules = catalog.items.map((item): PanelModule => {
    if (item.kind === "module" && item.capabilities.length > 0) {
      const states = item.capabilities.map((c) => effectiveStatus(grants, c, now));
      if (states.every((s) => s === "active")) return { ...item, state: "active", purchasable: false };
      if (states.every((s) => s === "active" || s === "read_only")) return { ...item, state: "read_only", purchasable: false };
    }
    return { ...item, state: item.commercialStatus };
  });
  return { purchasesEnabled: catalog.purchasesEnabled, modules };
}
