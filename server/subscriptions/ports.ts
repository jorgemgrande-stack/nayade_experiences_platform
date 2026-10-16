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
  technicalStatus: "available" | "partial" | "planned";
  activationKind: string;
  activationRef: string | null;
  dependencies: string[];
  compatibleWith: string[];
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

export function catalogFromWebStore(store: WebStore): CatalogPort {
  const productOf = (e: Awaited<ReturnType<WebStore["getEntry"]>>): CatalogProduct | null => {
    if (!e || e.kind !== "product" || e.publication !== "published" || !e.published || !e.family) return null;
    const p = e.published as {
      name: string;
      technicalStatus: CatalogProduct["technicalStatus"];
      activation: { kind: string; ref: string | null };
      dependencies?: string[];
      compatibleWith?: string[];
    };
    return {
      key: e.key,
      name: p.name,
      family: e.family as Family,
      technicalStatus: p.technicalStatus,
      activationKind: p.activation?.kind ?? "none",
      activationRef: p.activation?.ref ?? null,
      dependencies: p.dependencies ?? [],
      compatibleWith: p.compatibleWith ?? [],
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
        ? { id: c.id, reference: c.reference, companyId: c.companyId, status: c.status, amountCents: c.amountCents, currency: c.currency, billingInterval: c.billingInterval, tenantId: c.tenantId }
        : null;
    },
  };
}
