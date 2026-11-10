/**
 * Carrito público del checkout unificado: plan Elephant Core OBLIGATORIO + soluciones Net y extensiones Connect
 * habilitadas para la compra en línea (decisión de Jorge del 10/11/2026). Reutilizable para cualquier producto: no
 * hay nada propio de un producto concreto.
 *
 * El navegador solo dice QUÉ quiere (claves); el servidor valida y calcula todo:
 *  - lista blanca del servidor (CP_PUBLIC_CHECKOUT_PRODUCTS, claves separadas por comas; vacía por defecto: solo plan);
 *  - el plan: uno de los de Checkout, «available», no interno ni heredado;
 *  - cada producto: en la lista blanca, «available», no heredado (`catalog.legacy` ni extensión antigua de Net), no
 *    interno, de una familia comprable (la misma regla que la compra desde el panel), no una ampliación por cantidad,
 *    con oferta de contratación inmediata y Checkout, y con un único precio aprobado enlazado a un Price ACTIVO;
 *  - compatibilidades y dependencias con el cotizador del catálogo publicado (el mismo del pedido y del cobro);
 *  - las partidas de Stripe con los Prices REALES (`checkoutLines.ts`): importes, moneda, periodicidad y sin IVA.
 *
 * No guarda nada ni crea nada. El pedido y la sesión de pago los crea el autoservicio (`selfService.ts`) con lo
 * validado aquí. Al abrir el pago, `checkout.ts` vuelve a comprobar el estado comercial, los Prices reales y los importes;
 * la lista blanca, lo heredado y la modalidad solo se comprueban aquí (al iniciar o reanudar el pago). Una sesión abierta
 * dura como mucho 2 h (SESSION_TTL_MS): retirar un producto no cierra las sesiones que ya estuvieran abiertas.
 */
import { quote as runQuote, legacyProductText, type QuoteCatalog, type QuoteRequest, type QuoteResult } from "../catalog/quote";
import { legacyExtensionText } from "../../shared/netProducts";
import type { CatalogPort } from "../subscriptions/ports";
import { CHECKOUT_PLANS, PURCHASABLE_FAMILIES, isPersonalCheckoutPlan } from "./catalog";
import { CheckoutLinesError, MAX_CHECKOUT_LINES, planCheckoutLines, type CheckoutLinePlan } from "./checkoutLines";
import type { StripeGateway } from "./gateway";
import type { StripeStore } from "./store";

/** Máximo de productos (además del plan) en un carrito: el límite de partidas de Stripe menos el plan. */
export const PUBLIC_CART_MAX_PRODUCTS = MAX_CHECKOUT_LINES - 1;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Lista blanca de productos comprables en la web (`CP_PUBLIC_CHECKOUT_PRODUCTS`). Vacía o sin definir: ninguno (solo
 * se contrata el plan). Una clave con forma no válida impide arrancar: mejor que abrir la venta a otra cosa.
 */
export function publicCheckoutProductsFromEnv(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const keys = (env.CP_PUBLIC_CHECKOUT_PRODUCTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const bad = keys.filter((k) => !KEY_RE.test(k));
  if (bad.length) throw new Error("CP_PUBLIC_CHECKOUT_PRODUCTS contiene claves de producto no válidas");
  if (keys.some((k) => (CHECKOUT_PLANS as readonly string[]).includes(k))) throw new Error("CP_PUBLIC_CHECKOUT_PRODUCTS no admite planes: el plan se elige aparte");
  return new Set(keys);
}

export type PublicCartCode = "plan_required" | "plan_not_self_service" | "no_online" | "legacy" | "incompatible" | "too_many_products" | "unavailable";
const STATUS: Record<PublicCartCode, number> = { plan_required: 400, too_many_products: 400, plan_not_self_service: 409, no_online: 409, legacy: 409, incompatible: 409, unavailable: 503 };

export class PublicCartError extends Error {
  readonly status: number;
  constructor(
    public readonly code: PublicCartCode,
    message: string,
    public readonly product?: string,
  ) {
    super(message);
    this.name = "PublicCartError";
    this.status = STATUS[code];
  }
}

export interface PublicCartInput {
  plan: string;
  interval: "month" | "year";
  products?: string[];
}

export interface PublicCartDeps {
  /** Lista blanca (CP_PUBLIC_CHECKOUT_PRODUCTS). */
  allowed: ReadonlySet<string>;
  catalog: CatalogPort;
  /** Catálogo PUBLICADO en el formato del cotizador (el mismo que cotiza el pedido y el cobro). */
  site: () => Promise<QuoteCatalog>;
  store: Pick<StripeStore, "priceForWebPrice">;
  gateway: Pick<StripeGateway, "pricesByLookupKeys">;
  /** Stripe Tax en live: Prices sin IVA obligatorios. */
  requireExclusive?: boolean;
  now?: () => number;
}

/** Vida de la copia de los Prices de Stripe que usa el presupuesto (el alta y el cobro los leen siempre en vivo). */
export const QUOTE_PRICE_CACHE_MS = 60_000;

export interface PublicCartValidation {
  request: QuoteRequest & { items: Array<{ key: string }> };
  quote: QuoteResult;
  lines: CheckoutLinePlan;
}

export interface PublicOfferItem {
  key: string;
  name: string;
  family: string;
  monthlyCents: number | null;
  yearlyCents: number | null;
  dependencies: string[];
  bundleOf: string[];
}

export class PublicCart {
  private priceCache = new Map<string, { at: number; prices: Awaited<ReturnType<StripeGateway["pricesByLookupKeys"]>> }>();
  constructor(private d: PublicCartDeps) {}

  /** Lectura de Prices para el presupuesto, con copia corta: el presupuesto público no multiplica las llamadas a Stripe. */
  private cachedGateway(): Pick<StripeGateway, "pricesByLookupKeys"> {
    return {
      pricesByLookupKeys: async (keys) => {
        const now = (this.d.now ?? Date.now)();
        const id = [...keys].sort().join(",");
        const hit = this.priceCache.get(id);
        if (hit && now - hit.at < QUOTE_PRICE_CACHE_MS) return hit.prices;
        const prices = await this.d.gateway.pricesByLookupKeys(keys);
        if (this.priceCache.size > 500) this.priceCache.clear();
        this.priceCache.set(id, { at: now, prices });
        return prices;
      },
    };
  }

  /** Qué se puede comprar en línea ahora mismo: planes y productos que pasan TODAS las reglas (sin llamar a Stripe). */
  async offer(): Promise<{ plans: PublicOfferItem[]; products: PublicOfferItem[]; catalogVersion: string; currency: "EUR"; taxIncluded: false }> {
    const site = await this.d.site();
    const offer = await this.d.catalog.offer();
    const plans: PublicOfferItem[] = [];
    const products: PublicOfferItem[] = [];
    // Solo se omite lo que no se vende en línea; un fallo de infraestructura sí se propaga (503, no una lista vacía)
    const onlyCart = (e: unknown) => {
      if (e instanceof PublicCartError) return null;
      throw e;
    };
    for (const key of CHECKOUT_PLANS) {
      const item = await this.sellable(site, offer, key, true).catch(onlyCart);
      if (item) plans.push(item);
    }
    for (const key of Array.from(this.d.allowed).sort()) {
      const item = await this.sellable(site, offer, key, false).catch(onlyCart);
      if (item) products.push(item);
    }
    return { plans, products, catalogVersion: site.version, currency: "EUR", taxIncluded: false };
  }

  /** Error tipado si el plan falta, no es un plan o no se contrata en línea. */
  async checkPlan(plan: unknown): Promise<void> {
    if (typeof plan !== "string" || !plan.trim()) throw new PublicCartError("plan_required", "Elige un plan Elephant Core: es obligatorio en toda contratación");
    if ((CHECKOUT_PLANS as readonly string[]).includes(plan)) return;
    const p = KEY_RE.test(plan) ? await this.d.catalog.product(plan) : null;
    if (p?.family === "core_plan") throw new PublicCartError("plan_not_self_service", "Este plan todavía no se contrata en línea: solicita la contratación y te contactaremos");
    throw new PublicCartError("plan_required", "Elige un plan Elephant Core: es obligatorio en toda contratación");
  }

  /** Valida el carrito completo y devuelve la petición del pedido, el presupuesto del servidor y las partidas de Stripe. */
  async validate(input: PublicCartInput, opts: { cachedPrices?: boolean } = {}): Promise<PublicCartValidation> {
    await this.checkPlan(input.plan);
    const products = Array.from(new Set((input.products ?? []).map((k) => String(k).trim()).filter(Boolean)));
    if (products.length > PUBLIC_CART_MAX_PRODUCTS) throw new PublicCartError("too_many_products", `Demasiados productos en una contratación (máximo ${PUBLIC_CART_MAX_PRODUCTS})`);
    if (isPersonalCheckoutPlan(input.plan) && input.interval !== "month") throw new PublicCartError("incompatible", "El plan personal solo tiene tarifa mensual");
    const site = await this.d.site();
    const offer = await this.d.catalog.offer();
    const plan = await this.sellable(site, offer, input.plan, true);
    if ((input.interval === "year" ? plan.yearlyCents : plan.monthlyCents) === null) throw new PublicCartError("plan_not_self_service", `«${plan.name}» no tiene tarifa ${input.interval === "year" ? "anual" : "mensual"} en línea`);
    for (const key of products) {
      if ((CHECKOUT_PLANS as readonly string[]).includes(key)) throw new PublicCartError("incompatible", "Solo se contrata un plan Elephant Core por contratación", key);
      await this.sellable(site, offer, key, false);
    }
    // Un paquete y uno de sus componentes, nunca juntos (el pedido lo rechazaría después de crear la empresa)
    for (const key of products) {
      const p = site.products.find((x) => x.key === key)!;
      const both = products.find((c) => c !== key && p.bundleOf.includes(c));
      if (both) throw new PublicCartError("incompatible", `«${site.products.find((x) => x.key === both)?.name ?? both}» ya va incluido en «${p.name}»: elige el paquete o el módulo, no los dos`, both);
    }
    const request = { plan: input.plan, interval: input.interval, items: products.map((key) => ({ key })) };
    const q = runQuote(site, request);
    if (!q.ok) throw new PublicCartError("incompatible", `La combinación no es válida: ${q.errors.join("; ")}`);
    const twice = q.lines.find((l) => l.status === "included_in_bundle");
    if (twice) throw new PublicCartError("incompatible", `«${twice.name}» ya va incluido en otro producto elegido`, twice.key);
    if (q.blocking.length) throw new PublicCartError("no_online", `Incluye productos que aún no se pueden contratar: ${q.blocking.join(", ")}`);
    if (q.contractable !== "self_service") throw new PublicCartError("no_online", "Esta combinación no se contrata en línea: solicita la contratación y te contactaremos");
    // Mismo presupuesto que guardará el pedido (orquestador) y que exigirá el cobro
    const t = q.totals;
    const orderQuote = {
      currency: q.currency,
      contractAmountCents: input.interval === "month" ? t.monthlyCents : t.annualizedCents,
      firstPeriodNetCents: input.interval === "month" ? t.monthlyCents : t.yearlyCents + t.monthlyCents,
    };
    let lines: CheckoutLinePlan;
    try {
      lines = await planCheckoutLines({ catalog: this.d.catalog, store: this.d.store, gateway: opts.cachedPrices ? this.cachedGateway() : this.d.gateway }, { request, quote: orderQuote as never }, q, { requireExclusive: !!this.d.requireExclusive });
    } catch (e) {
      if (e instanceof CheckoutLinesError) throw new PublicCartError(e.code === "unsupported" ? "no_online" : "unavailable", e.code === "unsupported" ? e.message : "La venta en línea no está disponible ahora mismo: inténtalo más tarde");
      throw e;
    }
    // Plan anual con un producto solo mensual: Stripe Checkout no crea suscripciones con periodicidades mixtas
    // (https://docs.stripe.com/billing/subscriptions/mixed-interval, «Limitations»). El Core sabe cobrar el primer mes aparte
    // y añadir la partida después (deferredItems.ts), pero esa vía no se abre a la web hasta validarla en el sandbox y que
    // Jorge la apruebe: en línea, solo periodicidades iguales
    if (lines.deferred.length) throw new PublicCartError("incompatible", `${lines.deferred.map((l) => `«${l.name}»`).join(", ")} solo se contrata mensualmente: elige el plan mensual`, lines.deferred[0].productKey);
    return { request, quote: q, lines };
  }

  /**
   * Un plan o producto vendible en línea, o el error tipado de por qué no. Solo lee el catálogo y los enlaces locales
   * con Stripe (el Price real se comprueba en `validate`).
   */
  private async sellable(site: QuoteCatalog, offerList: Awaited<ReturnType<CatalogPort["offer"]>>, key: string, isPlan: boolean): Promise<PublicOfferItem> {
    if (!KEY_RE.test(key)) throw new PublicCartError("no_online", "Producto no válido", key);
    const noOnline = (why = "no se contrata en línea") => new PublicCartError(isPlan ? "plan_not_self_service" : "no_online", `«${q?.name ?? key}» ${why}: solicita información y te contactaremos`, isPlan ? undefined : key);
    const q = site.products.find((x) => x.key === key);
    if (!isPlan && !this.d.allowed.has(key)) throw noOnline();
    // Productos heredados (retirados de la venta): ni las antiguas extensiones de Net ni los marcados en el catálogo
    const legacyExt = legacyExtensionText(key);
    if (legacyExt) throw new PublicCartError("legacy", legacyExt, key);
    const p = await this.d.catalog.product(key);
    if (p?.legacy || q?.legacy) {
      const to = (p?.legacy ?? q?.legacy)!.replacedBy;
      throw new PublicCartError("legacy", legacyProductText(p?.name ?? q?.name ?? key, site.products.find((x) => x.key === to)?.name ?? to), key);
    }
    if (!p || !q || p.commercialStatus !== "available" || q.commercialStatus !== "available" || p.internalOnly) throw noOnline();
    if (isPlan ? p.family !== "core_plan" : !PURCHASABLE_FAMILIES.has(p.family) || !!p.addonFor || !!q.addonFor) throw noOnline();
    // Oferta comercial: contratación inmediata con Checkout (lo «bajo solicitud», asistido o sin oferta, no)
    if (!q.offer?.checkout || q.offer.modality !== "immediate") throw noOnline();
    const offer = offerList.find((x) => x.key === key);
    const approved = (kind: "monthly" | "yearly") => (offer?.prices ?? []).filter((x) => x.kind === kind && x.status === "approved" && x.currency.toUpperCase() === "EUR");
    const linked = async (kind: "monthly" | "yearly") => {
      const list = approved(kind);
      if (list.length !== 1) return null;
      const link = await this.d.store.priceForWebPrice(list[0].id);
      return link && link.status === "active" ? list[0].amountCents : null;
    };
    const monthlyCents = await linked("monthly");
    const yearlyCents = await linked("yearly");
    if (monthlyCents === null && yearlyCents === null) throw noOnline("no tiene precio de venta en línea");
    return { key, name: q.name, family: q.family, monthlyCents, yearlyCents, dependencies: q.dependencies, bundleOf: q.bundleOf };
  }
}
