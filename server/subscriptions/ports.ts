/**
 * Puertos hacia lo que YA existe (no se duplica nada): el catálogo comercial publicado y sus precios
 * aprobados (server/web) y las empresas y contratos del CRM (server/crm). Los adaptadores solo leen.
 */
import type { CrmStore } from "../crm/store";
import type { WebStore } from "../web/store";
import type { Family, Interval, PriceKind } from "./types";

export interface CatalogProduct {
  key: string;
  name: string;
  family: Family;
  /** Familia del catálogo de Elephant Source (`connect`, `addon`, `net_module`…), antes de traducirla a la contractual. */
  catalogFamily?: string;
  technicalStatus: "available" | "partial" | "planned";
  /** Estado comercial del catálogo de Elephant Source (las entradas anteriores: «on_request»). */
  commercialStatus: "unpublished" | "coming_soon" | "in_preparation" | "on_request" | "available";
  /** Producto interno de pruebas: nunca público; solo lo compran las empresas de prueba autorizadas. */
  internalOnly?: boolean;
  activationKind: string;
  activationRef: string | null;
  dependencies: string[];
  compatibleWith: string[];
  /** Paquetes: componentes que sustituye (catálogo `bundleOf`). */
  bundleOf: string[];
  /** Ampliación por cantidad: métrica que amplía y unidades por cada partida (p. ej. 10 GB). */
  addonFor?: { metric: string; step: number } | null;
  /** Cupos incluidos (planes): usuarios, sedes, almacenamiento… null = por contrato. */
  quotas?: Array<{ metric: string; included: number | null }>;
}
export interface CatalogPrice {
  id: number;
  productKey: string;
  kind: PriceKind;
  amountCents: number;
  currency: string;
  unit: string | null;
  taxRateBp: number;
  taxIncluded: boolean;
  status: "draft" | "approved" | "retired";
}
export interface CatalogPort {
  /** Solo productos PUBLICADOS (lo que se puede contratar). */
  product(key: string): Promise<CatalogProduct | null>;
  price(id: number): Promise<CatalogPrice | null>;
  /** Productos publicados con sus precios aprobados (para la interfaz). */
  offer(): Promise<Array<CatalogProduct & { prices: CatalogPrice[] }>>;
}

export interface ContractInfo {
  /** Configuración cotizada (si el contrato la tiene): plan y periodicidad acordados. */
  /** Configuración cotizada: petición y, si la hay, las líneas calculadas por el servidor (ampliaciones incluidas). */
  configuration?: { request: { plan: string; interval: Interval; items: Array<{ key: string }> }; quote?: { lines?: Array<{ key: string; family: string; quantity: number }> } } | null;
  id: number;
  reference: string | null;
  companyId: number;
  status: string;
  amountCents: number | null;
  currency: string;
  billingInterval: Interval | null;
  tenantId: string | null;
}
export interface CrmPort {
  company(id: number): Promise<{ id: number; name: string } | null>;
  contract(id: number): Promise<ContractInfo | null>;
}

/**
 * Familias del catálogo de Elephant Source → familias contractuales del motor. Un paquete se
 * contrata como un complemento más (con el precio del paquete); sus componentes no se añaden aparte.
 */
const CONTRACT_FAMILY: Record<string, Family> = {
  core_plan: "core_plan",
  extension: "extension",
  industry_module: "industry_module",
  usage: "usage",
  service: "service",
  net_module: "industry_module",
  net_bundle: "industry_module",
  connect: "extension",
  connect_bundle: "extension",
  extra: "extension",
  addon: "extension",
};

export function catalogFromWebStore(store: WebStore): CatalogPort {
  const productOf = (e: Awaited<ReturnType<WebStore["getEntry"]>>): CatalogProduct | null => {
    if (!e || e.kind !== "product" || e.publication !== "published" || !e.published || !e.family) return null;
    const p = e.published as {
      name: string;
      technicalStatus: CatalogProduct["technicalStatus"];
      activation: { kind: string; ref: string | null };
      dependencies?: string[];
      compatibleWith?: string[];
      catalog?: { commercialStatus?: CatalogProduct["commercialStatus"]; internalOnly?: boolean; bundleOf?: string[]; addonFor?: { metric: string; step: number } | null; quotas?: Array<{ metric: string; included: number | null }> };
      billingModel?: string;
    };
    // Un «servicio» con cuota recurrente (alojamiento web) se contrata como complemento recurrente;
    // los servicios de pago único siguen siendo «service»
    const family = e.family === "service" && p.billingModel === "recurring_addon" ? "extension" : CONTRACT_FAMILY[e.family];
    if (!family) return null;
    return {
      key: e.key,
      name: p.name,
      family,
      catalogFamily: e.family,
      technicalStatus: p.technicalStatus,
      commercialStatus: p.catalog?.commercialStatus ?? "on_request",
      internalOnly: p.catalog?.internalOnly === true,
      activationKind: p.activation?.kind ?? "none",
      activationRef: p.activation?.ref ?? null,
      dependencies: p.dependencies ?? [],
      compatibleWith: p.compatibleWith ?? [],
      bundleOf: p.catalog?.bundleOf ?? [],
      addonFor: p.catalog?.addonFor ? { metric: p.catalog.addonFor.metric, step: p.catalog.addonFor.step } : null,
      quotas: (p.catalog?.quotas ?? []).map((q) => ({ metric: q.metric, included: q.included })),
    };
  };
  const priceOf = (x: Awaited<ReturnType<WebStore["getPrice"]>>, key: string): CatalogPrice | null =>
    x
      ? { id: x.id, productKey: key, kind: x.kind, amountCents: x.amountCents, currency: x.currency, unit: x.unit, taxRateBp: x.taxRateBp, taxIncluded: x.taxIncluded, status: x.status }
      : null;
  return {
    product: async (key) => productOf(await store.getEntry("product", key)),
    price: async (id) => {
      const p = await store.getPrice(id);
      if (!p) return null;
      const entry = (await store.listEntries({ kind: "product" })).find((e) => e.id === p.entryId);
      return entry ? priceOf(p, entry.key) : null;
    },
    offer: async () => {
      const entries = await store.listEntries({ kind: "product" });
      const prices = await store.listPrices();
      const out: Array<CatalogProduct & { prices: CatalogPrice[] }> = [];
      for (const e of entries) {
        const prod = productOf(e);
        if (!prod || prod.technicalStatus === "planned") continue;
        out.push({ ...prod, prices: prices.filter((p) => p.entryId === e.id && p.status === "approved").map((p) => priceOf(p, e.key)!) });
      }
      return out;
    },
  };
}

export function crmFromStore(store: CrmStore): CrmPort {
  return {
    company: async (id) => {
      const c = await store.get("companies", id);
      return c ? { id: c.id, name: c.name } : null;
    },
    contract: async (id) => {
      const c = await store.get("contracts", id);
      return c
        ? { id: c.id, reference: c.reference, companyId: c.companyId, status: c.status, amountCents: c.amountCents, currency: c.currency, billingInterval: c.billingInterval, tenantId: c.tenantId, configuration: c.configuration ?? null }
        : null;
    },
  };
}
