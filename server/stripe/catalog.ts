/**
 * Catálogo de Stripe ↔ catálogo aprobado de Elephant Source.
 *
 *  - Solo se contratan por autoservicio Essential y Business, mensual y anual. Enterprise nunca
 *    tiene Price de autoservicio.
 *  - La fuente del importe es el precio APROBADO (`web_prices`). En Stripe, el Price se identifica por
 *    una `lookup_key` estable derivada de ese precio: es:<producto>:<kind>:<moneda>:v<web_price_id>.
 *    Un precio aprobado nuevo es otra clave y otro Price; nunca se reutiliza un Price con otro importe.
 *  - El servicio NO escribe el catálogo en Stripe. `planCatalogWrites` lista las operaciones exactas
 *    para que las ejecute una persona (Dashboard o MCP oficial con su sesión), y `syncCatalog` solo LEE
 *    los Prices de Stripe, valida que coinciden y guarda la correspondencia (`stripe_prices`).
 */
import type { CatalogPort } from "../subscriptions/ports";
import type { GwPrice, StripeGateway } from "./gateway";
import type { StripeStore } from "./store";

export const SELF_SERVICE_PLANS = ["essential", "business"] as const;
export type SelfServicePlan = (typeof SELF_SERVICE_PLANS)[number];

/** Nombre del Product en Stripe para cada plan (decisión del propietario, 17/10/2026). */
export const STRIPE_PRODUCT_NAME: Record<SelfServicePlan, string> = {
  essential: "Elephant Core Essential",
  business: "Elephant Core Business",
};

const KIND_INTERVAL = { monthly: "month", yearly: "year" } as const;

export interface DesiredPrice {
  productKey: SelfServicePlan;
  productName: string;
  webPriceId: number;
  kind: "monthly" | "yearly";
  interval: "month" | "year";
  amountCents: number;
  currency: string;
  lookupKey: string;
}

export class StripeCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeCatalogError";
  }
}

export const lookupKeyFor = (productKey: string, kind: string, currency: string, webPriceId: number) => `es:${productKey}:${kind}:${currency.toLowerCase()}:v${webPriceId}`;

/** Precios que deben existir en Stripe, sacados del catálogo publicado y aprobado. Exige los cuatro. */
export async function desiredCatalog(catalog: CatalogPort): Promise<DesiredPrice[]> {
  const offer = await catalog.offer();
  const out: DesiredPrice[] = [];
  for (const plan of SELF_SERVICE_PLANS) {
    const product = offer.find((p) => p.key === plan);
    if (!product) throw new StripeCatalogError(`El plan «${plan}» no está publicado en el catálogo`);
    for (const kind of ["monthly", "yearly"] as const) {
      const approved = product.prices.filter((p) => p.kind === kind && p.status === "approved" && p.currency.toUpperCase() === "EUR");
      if (approved.length !== 1) throw new StripeCatalogError(`El plan «${plan}» necesita exactamente un precio ${kind} aprobado en EUR (hay ${approved.length})`);
      const p = approved[0];
      if (p.taxIncluded) throw new StripeCatalogError(`El precio ${p.id} incluye IVA: los Prices de Stripe se crean sin IVA (tax_behavior exclusive)`);
      if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new StripeCatalogError(`Importe no válido en el precio ${p.id}`);
      out.push({ productKey: plan, productName: STRIPE_PRODUCT_NAME[plan], webPriceId: p.id, kind, interval: KIND_INTERVAL[kind], amountCents: p.amountCents, currency: "EUR", lookupKey: lookupKeyFor(plan, kind, "EUR", p.id) });
    }
  }
  return out;
}

export type PriceCheck = { ok: true } | { ok: false; reasons: string[] };

/** ¿El Price de Stripe corresponde exactamente al precio aprobado? */
export function checkPrice(d: DesiredPrice, p: GwPrice): PriceCheck {
  const reasons: string[] = [];
  if (p.lookupKey !== d.lookupKey) reasons.push("lookup_key distinta");
  if (!p.active) reasons.push("Price inactivo");
  if (p.type !== "recurring") reasons.push("no es recurrente");
  if (p.interval !== d.interval || p.intervalCount !== 1) reasons.push(`periodicidad ${p.interval ?? "?"}×${p.intervalCount ?? "?"} en lugar de ${d.interval}×1`);
  if (p.currency !== d.currency) reasons.push(`moneda ${p.currency} en lugar de ${d.currency}`);
  if (p.unitAmount !== d.amountCents) reasons.push(`importe ${p.unitAmount ?? "?"} en lugar de ${d.amountCents}`);
  if (p.taxBehavior !== "exclusive") reasons.push(`tax_behavior ${p.taxBehavior ?? "?"} en lugar de exclusive`);
  if (p.metadata.es_web_price_id !== String(d.webPriceId)) reasons.push("metadata es_web_price_id no coincide");
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export interface CatalogWritePlan {
  /** Operaciones exactas que debe ejecutar una persona (en el sandbox). Vacío si no falta nada. */
  operations: Array<
    | { op: "create_product"; productKey: SelfServicePlan; params: { name: string; metadata: Record<string, string> } }
    | { op: "create_price"; lookupKey: string; productKey: SelfServicePlan; params: { product: string; currency: string; unit_amount: number; recurring: { interval: "month" | "year"; interval_count: 1 }; tax_behavior: "exclusive"; lookup_key: string; nickname: string; metadata: Record<string, string> } }
  >;
  /** Prices que ya existen y coinciden. */
  ready: string[];
  /** Prices con la misma lookup_key que NO coinciden: requieren revisión humana (nunca se corrigen solos). */
  conflicts: Array<{ lookupKey: string; priceId: string; reasons: string[] }>;
}

/**
 * Plan de escrituras del catálogo: lee Stripe (por lookup_key y los Products ya enlazados) y devuelve
 * solo lo que falta. Repetirlo tras crear los objetos da un plan vacío (idempotente). El id del Product
 * de un plan se toma de un Price existente de ese plan; si no hay ninguno, se marca «PRODUCT:<plan>»
 * para sustituirlo por el id del Product creado en el paso anterior.
 */
export async function planCatalogWrites(desired: DesiredPrice[], gw: StripeGateway): Promise<CatalogWritePlan> {
  const found = await gw.pricesByLookupKeys(desired.map((d) => d.lookupKey));
  const byKey = new Map(found.filter((p) => p.lookupKey).map((p) => [p.lookupKey!, p]));
  const plan: CatalogWritePlan = { operations: [], ready: [], conflicts: [] };
  const productIdOf = new Map<SelfServicePlan, string>();
  for (const d of desired) {
    const p = byKey.get(d.lookupKey);
    if (p && p.metadata.es_product_key === d.productKey) productIdOf.set(d.productKey, p.productId);
  }
  for (const key of SELF_SERVICE_PLANS) {
    const needed = desired.filter((d) => d.productKey === key);
    if (!needed.length || productIdOf.has(key)) continue;
    plan.operations.push({ op: "create_product", productKey: key, params: { name: STRIPE_PRODUCT_NAME[key], metadata: { es_product_key: key, es_catalog: "elephant-source" } } });
  }
  for (const d of desired) {
    const p = byKey.get(d.lookupKey);
    if (p) {
      const c = checkPrice(d, p);
      if (c.ok) plan.ready.push(p.id);
      else plan.conflicts.push({ lookupKey: d.lookupKey, priceId: p.id, reasons: c.reasons });
      continue;
    }
    plan.operations.push({
      op: "create_price",
      lookupKey: d.lookupKey,
      productKey: d.productKey,
      params: {
        product: productIdOf.get(d.productKey) ?? `PRODUCT:${d.productKey}`,
        currency: d.currency.toLowerCase(),
        unit_amount: d.amountCents,
        recurring: { interval: d.interval, interval_count: 1 },
        tax_behavior: "exclusive",
        lookup_key: d.lookupKey,
        nickname: `${d.productName} · ${d.kind === "monthly" ? "mensual" : "anual"}`,
        metadata: { es_product_key: d.productKey, es_web_price_id: String(d.webPriceId), es_kind: d.kind },
      },
    });
  }
  return plan;
}

export interface CatalogSyncReport {
  linked: Array<{ lookupKey: string; webPriceId: number; stripePriceId: string; stripeProductId: string }>;
  missing: string[];
  conflicts: Array<{ lookupKey: string; priceId: string; reasons: string[] }>;
}

/**
 * Enlaza en la BD los Prices de Stripe que ya existen y coinciden exactamente (solo LECTURA en Stripe).
 * Idempotente: repetirlo no duplica nada. Un Price que no coincide nunca se enlaza.
 */
export async function syncCatalog(desired: DesiredPrice[], gw: StripeGateway, store: StripeStore, now: number): Promise<CatalogSyncReport> {
  const found = await gw.pricesByLookupKeys(desired.map((d) => d.lookupKey));
  const byKey = new Map(found.filter((p) => p.lookupKey).map((p) => [p.lookupKey!, p]));
  const report: CatalogSyncReport = { linked: [], missing: [], conflicts: [] };
  for (const d of desired) {
    const p = byKey.get(d.lookupKey);
    if (!p) {
      report.missing.push(d.lookupKey);
      continue;
    }
    const c = checkPrice(d, p);
    if (!c.ok) {
      report.conflicts.push({ lookupKey: d.lookupKey, priceId: p.id, reasons: c.reasons });
      continue;
    }
    const product = await gw.product(p.productId);
    if (!product || !product.active || product.metadata.es_product_key !== d.productKey) {
      report.conflicts.push({ lookupKey: d.lookupKey, priceId: p.id, reasons: ["Product inexistente, inactivo o de otro plan"] });
      continue;
    }
    await store.upsertPrice({ webPriceId: d.webPriceId, stripeProductId: p.productId, stripePriceId: p.id, lookupKey: d.lookupKey, now });
    report.linked.push({ lookupKey: d.lookupKey, webPriceId: d.webPriceId, stripePriceId: p.id, stripeProductId: p.productId });
  }
  return report;
}
