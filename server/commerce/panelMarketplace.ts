/**
 * Carrusel y cabeceras de marca del marketplace para el panel de UNA empresa (solo lectura). Parte de lo publicado y
 * vigente (`WebAdminService.marketplace`) y quita lo que esa empresa no debe ver:
 *  - campañas con audiencia de planes que no son el suyo (si no se sabe su plan, solo las que no tienen audiencia);
 *  - campañas que apuntan a productos que la empresa no ve en su catálogo (internos, retirados o fuera del panel).
 * Las notas internas nunca llegan: la vista publicada ya no las lleva.
 */
import type { CommercialOrder } from "../orchestrator/types";
import { slideProducts, type MarketplaceDocument } from "../web/service";

export interface PanelMarketplace {
  slides: Array<Record<string, unknown> & { id: string }>;
  settings: { autoplayMs: number };
  brands: Array<Record<string, unknown> & { key: string }>;
}

/** Ritmo del carrusel por defecto mientras no haya ajuste publicado. */
export const DEFAULT_AUTOPLAY_MS = 6000;

export const EMPTY_MARKETPLACE: PanelMarketplace = { slides: [], settings: { autoplayMs: DEFAULT_AUTOPLAY_MS }, brands: [] };

export function panelMarketplace(doc: MarketplaceDocument | null, o: { visible: ReadonlySet<string>; plan: string | null }): PanelMarketplace {
  if (!doc) return EMPTY_MARKETPLACE;
  const slides = doc.slides
    .filter((s) => {
      const plans = s.audience?.plans ?? [];
      if (plans.length && (!o.plan || !plans.includes(o.plan))) return false;
      return slideProducts(s).every((k) => o.visible.has(k));
    })
    .map(({ audience: _a, order: _o, ...s }) => s as Record<string, unknown> & { id: string });
  return { slides, settings: { autoplayMs: doc.settings.autoplayMs }, brands: doc.settings.brands };
}

/** Plan vigente de una empresa a partir de sus pedidos (el del pedido vigente más reciente), o null. */
export function planFromOrders(orders: ReadonlyArray<Pick<CommercialOrder, "id" | "tenantId" | "state" | "request">>, tenantId: string): string | null {
  const current = orders
    .filter((o) => o.tenantId === tenantId && ["active", "past_due", "suspended", "cancel_scheduled"].includes(o.state))
    .sort((a, b) => b.id - a.id)[0];
  return current?.request?.plan ?? null;
}
