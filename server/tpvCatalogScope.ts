/**
 * Qué secciones del catálogo vende el TPV de cada empresa.
 *
 *  - Instalación de una sola empresa o empresa sin licencias por capacidad: todo, como siempre
 *    (experiencias, packs, SPA, hotel y Lego Packs).
 *  - Empresa con licencias por capacidad (pyme): sus productos y servicios (agrupados por sus
 *    propias categorías) y, de lo sectorial, solo lo que tenga contratado: SPA con Care Net y
 *    alojamiento con Hotel Net. Packs y Lego Packs son propios de la instalación original.
 */
import { getTenantMode } from "./_core/tenant";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { buildSubscriptionOverview } from "./subscriptionOverview";

export interface TpvCatalogScope {
  /** true = empresa con licencias por capacidad (filtros por sus categorías). */
  licensed: boolean;
  packs: boolean;
  legoPacks: boolean;
  spa: boolean;
  hotel: boolean;
  /** Régimen especial de agencias de viajes (Travel Net): conceptos libres en REAV como en la instalación original. */
  reav: boolean;
}

export const FULL_TPV_SCOPE: TpvCatalogScope = { licensed: false, packs: true, legoPacks: true, spa: true, hotel: true, reav: true };

/** Alcance a partir de las licencias visibles (activas o en solo lectura). `null` = sin licencias por capacidad. */
export function tpvScopeFrom(visible: readonly string[] | null): TpvCatalogScope {
  if (visible === null) return FULL_TPV_SCOPE;
  const has = (id: string) => visible.includes(id);
  return { licensed: true, packs: false, legoPacks: false, spa: has("care-net"), hotel: has("hotel-net"), reav: has("travel-net") };
}

/**
 * Alcance del tenant en curso. Si no pueden leerse las licencias se comporta como el menú (modo
 * heredado): la autorización de cada operación la sigue haciendo el guardián de capacidades.
 */
export async function currentTpvScope(): Promise<TpvCatalogScope> {
  const mode = getTenantMode();
  if (mode !== "multi") return FULL_TPV_SCOPE;
  const access = getCapabilityAccess();
  let grants;
  try {
    grants = await access.list();
  } catch {
    return FULL_TPV_SCOPE;
  }
  const ov = buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants, now: access.currentTime() });
  return tpvScopeFrom(ov.licensing === "capabilities" ? ov.visible : null);
}
