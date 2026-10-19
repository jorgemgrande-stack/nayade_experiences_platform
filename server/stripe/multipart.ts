/**
 * Reglas de una suscripción de Stripe con varias partidas (plan + módulos + ampliaciones), sin red.
 *
 *  - Cobro condicionado: `pending_if_incomplete` solo con métodos de cobro inmediato confirmable (tarjeta y
 *    monederos, Link, PayPal…). NO con adeudo SEPA: con él no se compra en línea (vía asíncrona aparte).
 *  - Modo de facturación: `classic` (por defecto) exige la MISMA periodicidad en todas las partidas; `flexible`
 *    admite mezclarlas, pero pasar una suscripción a flexible es irreversible: solo por decisión expresa
 *    (`CP_STRIPE_BILLING_MODE=flexible`) y nunca automáticamente sobre suscripciones existentes.
 *  - Prorrateo: como Stripe, por segundos sobre el periodo en curso.
 *  - Precios anuales: propuesta = 10 × mensual (decisión A), sin publicar ni crear nada.
 */
import type { StripeBillingMode } from "./config";
import type { GwSubscriptionItem, SubscriptionItemsChange } from "./gateway";

export { stripeBillingModeFromEnv, type StripeBillingMode } from "./config";

/** Tipos de método de pago con los que Stripe admite cambios pendientes de cobro (documentación oficial). */
export const PENDING_UPDATE_METHODS: ReadonlySet<string> = new Set([
  "card",
  "link",
  "alipay",
  "amazon_pay",
  "afterpay_clearpay",
  "cashapp",
  "eps",
  "klarna",
  "paypal",
  "revolut_pay",
  "twint",
  "wechat_pay",
]);

/** ¿Se puede comprar en línea con este método (cobro inmediato, sin conceder nada antes de confirmarlo)? */
export function supportsPendingUpdate(paymentMethodType: string | null): boolean {
  return paymentMethodType !== null && PENDING_UPDATE_METHODS.has(paymentMethodType);
}

/**
 * ¿Puede una partida de esa periodicidad convivir con el plan? En clásico, solo la misma. En flexible, se admite
 * mezclar (Stripe factura cada partida en su periodo).
 */
export function intervalCompatible(mode: StripeBillingMode, planInterval: "month" | "year", itemInterval: "month" | "year"): boolean {
  return mode === "flexible" || planInterval === itemInterval;
}

/** Prorrateo de una partida por segundos (positivo: cargo; negativo: abono), redondeado al céntimo. */
export function prorationCents(unitAmount: number, oldQuantity: number, newQuantity: number, periodStart: number, periodEnd: number, at: number): number {
  if (periodEnd <= periodStart) return 0;
  const remaining = Math.min(Math.max(periodEnd - at, 0), periodEnd - periodStart);
  return Math.round(((newQuantity - oldQuantity) * unitAmount * remaining) / (periodEnd - periodStart));
}

/**
 * Partidas a enviar a Stripe para pasar de las actuales a las deseadas (por precio: un precio aparece como mucho
 * una vez en una suscripción). Cantidad 0 o ausente = quitar. Sin cambios: lista vacía.
 */
export function itemChanges(current: GwSubscriptionItem[], desired: Array<{ priceId: string; quantity: number }>): SubscriptionItemsChange["items"] {
  const out: SubscriptionItemsChange["items"] = [];
  const want = new Map(desired.filter((d) => d.quantity > 0).map((d) => [d.priceId, d.quantity]));
  for (const c of current) {
    const q = want.get(c.priceId);
    if (q === undefined) out.push({ id: c.id, deleted: true });
    else if (q !== c.quantity) out.push({ id: c.id, quantity: q });
    want.delete(c.priceId);
  }
  for (const [priceId, quantity] of Array.from(want.entries())) out.push({ priceId, quantity });
  return out;
}

/** Precio anual propuesto: 10 mensualidades (decisión A). */
export const yearlyFromMonthly = (monthlyCents: number) => monthlyCents * 10;

/**
 * Propuestas de precio anual para los productos que tienen precio mensual APROBADO y no tienen anual. No escribe
 * nada: un precio nuevo pasa por la aprobación del catálogo y, después, por Stripe (lo hace una persona).
 */
export function proposeYearlyPrices(offer: Array<{ key: string; name: string; prices: Array<{ kind: string; amountCents: number; currency: string; status?: string }> }>) {
  const out: Array<{ productKey: string; name: string; currency: string; monthlyCents: number; proposedYearlyCents: number }> = [];
  for (const p of offer) {
    const approved = p.prices.filter((x) => x.status === undefined || x.status === "approved");
    const monthly = approved.find((x) => x.kind === "monthly");
    if (!monthly || approved.some((x) => x.kind === "yearly")) continue;
    out.push({ productKey: p.key, name: p.name, currency: monthly.currency, monthlyCents: monthly.amountCents, proposedYearlyCents: yearlyFromMonthly(monthly.amountCents) });
  }
  return out;
}
