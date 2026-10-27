/**
 * Partidas de la Checkout Session de un pedido: plan Elephant Core + módulos + ampliaciones (fase 2).
 *
 *  - Fuente: el presupuesto del SERVIDOR (cotizador con el catálogo publicado). Cada línea cobrada se cobra con el
 *    Price enlazado (`stripe_prices`) de su precio aprobado y de SU periodicidad; el importe del Price real de Stripe
 *    debe ser el aprobado y la suma, el importe del contrato del pedido. Nunca se inventa ni se redondea un importe.
 *  - Misma periodicidad que el plan → partida recurrente del Checkout.
 *  - Mensual con un plan anual (módulo sin tarifa anual o ampliación por cantidad): Stripe Checkout no crea
 *    suscripciones con periodicidades mixtas. El primer mes va en el MISMO pago como importe único (mismo Product
 *    y mismo importe aprobado) y, al activarse el pedido, la partida mensual se añade sin prorrateo a la misma
 *    suscripción (modo flexible) para que Stripe la cobre cada mes (`deferredItems.ts`). Así el primer pago cubre
 *    todo lo contratado: ningún derecho se concede sin cobrar.
 *  - No se cobra por Checkout: lo presupuestado aparte (sin tarifa), los productos internos de pruebas, más de
 *    20 partidas (límite de Stripe) o una partida anual en un plan mensual.
 */
import type { QuoteResult } from "../catalog/quote";
import type { CommercialOrder } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import type { StripeGateway } from "./gateway";
import type { StripeStore } from "./store";

/** Máximo de partidas de una Checkout Session (regla de Stripe). */
export const MAX_CHECKOUT_LINES = 20;

export interface CheckoutLine {
  productKey: string;
  name: string;
  interval: "month" | "year";
  quantity: number;
  unitAmountCents: number;
  stripePriceId: string;
  stripeProductId: string;
}

export interface CheckoutLinePlan {
  /** Partidas recurrentes del Checkout (periodicidad del plan). La primera es el plan. */
  recurring: CheckoutLine[];
  /** Partidas mensuales de un plan anual: primer mes como importe único; recurrentes tras la activación. */
  deferred: CheckoutLine[];
  /** Neto del primer cobro (céntimos, sin IVA). */
  firstChargeCents: number;
  /** Importe recurrente por periodicidad (sin IVA). */
  monthlyCents: number;
  yearlyCents: number;
}

export class CheckoutLinesError extends Error {
  constructor(
    public readonly code: "unsupported" | "unavailable" | "conflict" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "CheckoutLinesError";
  }
}

export interface CheckoutLinesDeps {
  catalog: CatalogPort;
  store: Pick<StripeStore, "priceForWebPrice">;
  gateway: Pick<StripeGateway, "pricesByLookupKeys">;
}

/**
 * Partidas de Stripe de la configuración del pedido. `q` es el presupuesto del servidor de `order.request`;
 * `requireExclusive` (Stripe Tax en live) exige Prices sin IVA.
 */
export async function planCheckoutLines(d: CheckoutLinesDeps, order: Pick<CommercialOrder, "request" | "quote">, q: QuoteResult, opts: { requireExclusive?: boolean } = {}): Promise<CheckoutLinePlan> {
  if (!q.ok) throw new CheckoutLinesError("invalid_state", `La configuración del pedido ya no es válida: ${q.errors.join("; ")}`);
  if (!order.quote) throw new CheckoutLinesError("invalid_state", "El pedido no tiene presupuesto");
  const planInterval = order.request.interval;
  const offer = await d.catalog.offer();
  const lines: Array<CheckoutLine & { lookupKey: string }> = [];
  for (const l of q.lines) {
    if (l.status === "included_in_bundle") continue;
    if (l.status === "no_price" || l.unitCents === null) throw new CheckoutLinesError("unsupported", `«${l.name}» se presupuesta aparte: esta contratación no se cobra por Checkout`);
    if (l.interval === "year" && planInterval === "month") throw new CheckoutLinesError("unsupported", `«${l.name}» es anual y el plan es mensual`);
    const product = offer.find((p) => p.key === l.key);
    if (!product) throw new CheckoutLinesError("unavailable", `«${l.name}» no está publicado en el catálogo`);
    if (product.internalOnly) throw new CheckoutLinesError("unsupported", `«${l.name}» es un producto interno de pruebas: no se vende por Checkout`);
    const kind = l.interval === "year" ? "yearly" : "monthly";
    const approved = product.prices.filter((p) => p.kind === kind && p.status === "approved" && p.currency.toUpperCase() === "EUR");
    if (approved.length !== 1) throw new CheckoutLinesError("unavailable", `«${l.name}» no tiene un único precio ${kind === "yearly" ? "anual" : "mensual"} aprobado`);
    const price = approved[0];
    if (price.amountCents !== l.unitCents) throw new CheckoutLinesError("conflict", `El precio aprobado de «${l.name}» no coincide con el presupuesto`);
    const link = await d.store.priceForWebPrice(price.id);
    if (!link || link.status !== "active") throw new CheckoutLinesError("unavailable", `«${l.name}» no tiene precio enlazado en Stripe (catálogo sin sincronizar o producto no disponible para venta en línea)`);
    lines.push({ productKey: l.key, name: l.name, interval: l.interval, quantity: l.quantity, unitAmountCents: price.amountCents, stripePriceId: link.stripePriceId, stripeProductId: link.stripeProductId, lookupKey: link.lookupKey });
  }
  if (!lines.length || lines[0].productKey !== order.request.plan) throw new CheckoutLinesError("invalid_state", "El presupuesto no empieza por el plan");
  if (lines.length > MAX_CHECKOUT_LINES) throw new CheckoutLinesError("unsupported", `Demasiadas partidas para un pago (${lines.length}; máximo ${MAX_CHECKOUT_LINES})`);
  if (new Set(lines.map((l) => l.stripePriceId)).size !== lines.length) throw new CheckoutLinesError("conflict", "Dos partidas usan el mismo precio de Stripe");

  // Se compara con los Prices REALES de Stripe (lo que se cobrará), no solo con el catálogo web
  const live = await d.gateway.pricesByLookupKeys(lines.map((l) => l.lookupKey));
  for (const l of lines) {
    const p = live.find((x) => x.id === l.stripePriceId);
    if (!p || !p.active || p.type !== "recurring" || p.unitAmount !== l.unitAmountCents || p.currency.toUpperCase() !== "EUR" || p.interval !== l.interval || (p.intervalCount ?? 1) !== 1) {
      throw new CheckoutLinesError("conflict", `El precio de Stripe de «${l.name}» (${p?.unitAmount ?? "?"} ${p?.currency ?? ""}) no coincide con el aprobado (${l.unitAmountCents} EUR, sin IVA)`);
    }
    if (opts.requireExclusive && p.taxBehavior !== "exclusive") throw new CheckoutLinesError("conflict", `El precio de Stripe de «${l.name}» no está marcado sin IVA (tax_behavior exclusive): no se cobra con Stripe Tax`);
  }

  const amount = (l: CheckoutLine) => l.unitAmountCents * l.quantity;
  const monthlyCents = lines.filter((l) => l.interval === "month").reduce((a, l) => a + amount(l), 0);
  const yearlyCents = lines.filter((l) => l.interval === "year").reduce((a, l) => a + amount(l), 0);
  // Presupuesto del pedido y Stripe nunca muestran importes distintos
  const contract = planInterval === "month" ? monthlyCents : yearlyCents + 12 * monthlyCents;
  const quoteCur = order.quote.currency.toUpperCase();
  if (contract !== order.quote.contractAmountCents || quoteCur !== "EUR") {
    throw new CheckoutLinesError("conflict", `El importe del presupuesto (${order.quote.contractAmountCents} ${quoteCur}, sin IVA) no coincide con los precios de Stripe (${contract} EUR)`);
  }
  // El primer cobro es el que el procesador de eventos exigirá a la factura inicial
  const first = monthlyCents + yearlyCents;
  if (first !== (order.quote.firstPeriodNetCents ?? order.quote.contractAmountCents)) {
    throw new CheckoutLinesError("conflict", "El presupuesto del pedido es anterior a las partidas mensuales con plan anual: vuelve a crear la contratación");
  }
  const strip = ({ lookupKey: _k, ...l }: CheckoutLine & { lookupKey: string }): CheckoutLine => l;
  return {
    recurring: lines.filter((l) => l.interval === planInterval).map(strip),
    deferred: lines.filter((l) => l.interval !== planInterval).map(strip),
    firstChargeCents: first,
    monthlyCents,
    yearlyCents,
  };
}
