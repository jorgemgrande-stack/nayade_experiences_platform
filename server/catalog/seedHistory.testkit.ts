/**
 * Catálogos de fechas anteriores, SOLO para pruebas: la semilla oficial (elephantSourceV1.ts) recoge el estado vigente, y
 * algunas pruebas necesitan partir de cómo estaba el catálogo antes de una decisión (contratos anteriores, o el estado de
 * partida de una revisión de catálogo). Se pasan a `seedElephantSource(svc, store, { products })`.
 */
import { PRODUCTS, type SeedProduct } from "./elephantSourceV1";

const edit = (p: SeedProduct, catalog: Partial<SeedProduct["draft"]["catalog"]>, rest: Partial<SeedProduct> = {}): SeedProduct => ({ ...p, ...rest, draft: { ...p.draft, catalog: { ...p.draft.catalog, ...catalog } } });

/**
 * Antes de la unificación de Elephant Net (09/11/2026): los 19 módulos sueltos todavía se contrataban por separado (sin la
 * marca `catalog.legacy`). Para las pruebas de contratos de esa época y para el estado de partida de esa revisión.
 */
export function beforeNetUnification(products: readonly SeedProduct[] = PRODUCTS): SeedProduct[] {
  return products.map((p) => {
    if (!p.draft.catalog.legacy) return p;
    const { legacy: _legacy, ...catalog } = p.draft.catalog;
    return { ...p, draft: { ...p.draft, catalog } };
  });
}

/**
 * Antes de la revisión del TPV (10/11/2026): `connect-pos` por sede («por sede») y a 25 € al mes. Para el estado de
 * partida de esa revisión (review20261109tpv.ts).
 */
export function beforeTpvPerCompany(products: readonly SeedProduct[] = PRODUCTS): SeedProduct[] {
  return products.map((p) => (p.key === "connect-pos" ? edit(p, { scope: "site", chargeUnit: "por sede" }, { prices: [{ kind: "monthly", amountCents: 2500, unit: null }] }) : p));
}
