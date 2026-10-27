/**
 * Catálogo del cotizador a partir de la semilla oficial (sin base de datos): pruebas y documentación generada.
 * En producción el cotizador usa lo publicado (`quoteCatalogFromSite`), que coincide con esta semilla.
 */
import { CATALOG_VERSION, PRODUCTS, TAX_RATE_BP } from "../elephantSourceV1";
import type { QuoteCatalog } from "../quote";

export function quoteCatalogFromSeed(): QuoteCatalog {
  return {
    version: CATALOG_VERSION,
    products: PRODUCTS.map((p) => ({
      key: p.key,
      name: p.draft.name,
      family: p.family,
      technicalStatus: p.draft.technicalStatus,
      commercialStatus: p.draft.catalog.commercialStatus,
      capabilities: p.draft.catalog.capabilities,
      inherits: p.draft.catalog.inherits,
      group: p.draft.catalog.group,
      scope: p.draft.catalog.scope,
      bundleOf: p.draft.catalog.bundleOf,
      dependencies: p.draft.dependencies,
      compatibleWith: p.draft.compatibleWith,
      quotas: p.draft.catalog.quotas.map((q) => ({ metric: q.metric, included: q.included })),
      addonFor: p.draft.catalog.addonFor,
      thirdPartyCosts: p.draft.thirdPartyCosts,
      prices: p.prices.map((x) => ({ kind: x.kind, amountCents: x.amountCents, currency: "EUR", unit: x.unit ?? null, taxRateBp: TAX_RATE_BP, taxIncluded: false })),
    })),
  };
}
