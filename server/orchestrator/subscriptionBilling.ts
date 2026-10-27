/**
 * Origen del cobro de una suscripción del motor de contratos: Stripe Billing o simulación.
 *
 * Una suscripción se cobra en Stripe cuando algún pedido suyo tiene pagos verificados en Stripe (el mismo
 * criterio con el que el orquestador ya se niega a cancelar o rechazar por su cuenta). Entonces la gobierna
 * Stripe: su estado y sus periodos llegan por los webhooks y la conciliación, y la API de suscripciones
 * rechaza las operaciones de simulación (renovaciones, cambios, cancelación y facturación sombra).
 *
 * Solo lectura: no llama a Stripe ni escribe nada.
 */
import { isStripeProvider, STRIPE_LIVE_PAYMENT_PROVIDER } from "./service";
import type { OrderStore } from "./store";
import { TERMINAL_STATES, type CommercialOrder, type OrderPayment, type OrderState, type PaymentPurpose, type PaymentStatus } from "./types";

export interface StripeBilling {
  source: "stripe";
  /** Modo del último cobro de Stripe: «test» (sandbox) o «live» (cuenta real). */
  mode: "test" | "live";
  /** Pedido vigente de la contratación (el último no terminado; si todos lo están, el último). */
  orderId: number;
  orderReference: string | null;
  orderState: OrderState;
  /** Fin de la gracia por impago, si la hay. */
  graceEndsAt: number | null;
  lastPayment: { status: PaymentStatus; purpose: PaymentPurpose; amountCents: number; currency: string; at: number; periodStart: number | null } | null;
}
export type SubscriptionBilling = StripeBilling | { source: "shadow" };

export const SHADOW_BILLING: SubscriptionBilling = { source: "shadow" };

const at = (p: OrderPayment) => p.settledAt ?? p.createdAt;

export async function subscriptionBilling(store: Pick<OrderStore, "list" | "payments">, subscriptionId: number): Promise<SubscriptionBilling> {
  const orders = await store.list({ subscriptionId, limit: 50 });
  if (!orders.length) return SHADOW_BILLING;
  let last: OrderPayment | null = null;
  for (const o of orders) {
    for (const p of await store.payments(o.id)) {
      if (isStripeProvider(p.provider) && (!last || at(p) >= at(last))) last = p;
    }
  }
  if (!last) return SHADOW_BILLING;
  // `list` devuelve de más reciente a más antiguo
  const current: CommercialOrder = orders.find((o) => !TERMINAL_STATES.has(o.state)) ?? orders[0];
  return {
    source: "stripe",
    mode: last.provider === STRIPE_LIVE_PAYMENT_PROVIDER ? "live" : "test",
    orderId: current.id,
    orderReference: current.reference,
    orderState: current.state,
    graceEndsAt: current.graceEndsAt,
    lastPayment: { status: last.status, purpose: last.purpose, amountCents: last.amountCents, currency: last.currency, at: at(last), periodStart: last.periodStart },
  };
}
