/**
 * Catálogo publicado → formato del cotizador. Es la misma información que sale en
 * `/cp/v1/public/site` (solo lo publicado, sin datos internos).
 */
import type { SiteDocument } from "../web/service";
import type { QuoteCatalog, QuoteCatalogProduct } from "./quote";

interface PublishedProduct {
  key: string;
  family: string;
  name?: string;
  technicalStatus?: string;
  dependencies?: string[];
  compatibleWith?: string[];
  thirdPartyCosts?: string | null;
  prices: QuoteCatalogProduct["prices"];
  catalog?: Partial<{
    commercialStatus: QuoteCatalogProduct["commercialStatus"];
    capabilities: string[];
    inherits: string | null;
    group: string | null;
    scope: "company" | "site";
    bundleOf: string[];
    quotas: Array<{ metric: string; included: number | null }>;
    addonFor: { metric: string; step: number; plans: string[] } | null;
  }>;
}

export function quoteCatalogFromSite(site: Pick<SiteDocument, "version" | "catalog">): QuoteCatalog {
  return {
    version: site.version,
    products: (site.catalog.products as unknown as PublishedProduct[]).map((p) => ({
      key: p.key,
      name: p.name ?? p.key,
      family: p.family,
      technicalStatus: p.technicalStatus ?? "planned",
      // Entradas anteriores al catálogo de Elephant Source: se tratan como «Solicitar activación»
      commercialStatus: p.catalog?.commercialStatus ?? "on_request",
      capabilities: p.catalog?.capabilities ?? [],
      inherits: p.catalog?.inherits ?? null,
      group: p.catalog?.group ?? null,
      scope: p.catalog?.scope ?? "company",
      bundleOf: p.catalog?.bundleOf ?? [],
      dependencies: p.dependencies ?? [],
      compatibleWith: p.compatibleWith ?? [],
      quotas: (p.catalog?.quotas ?? []).map((q) => ({ metric: q.metric, included: q.included })),
      addonFor: p.catalog?.addonFor ?? null,
      thirdPartyCosts: p.thirdPartyCosts ?? null,
      prices: p.prices.filter((x) => !("draft" in x && (x as { draft?: boolean }).draft)),
    })),
  };
}
