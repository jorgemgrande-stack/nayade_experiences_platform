/**
 * Partidas mensuales de un plan anual contratado por Checkout (fase 2, `checkoutLines.ts`).
 *
 * Stripe Checkout no crea suscripciones con periodicidades mixtas: el primer mes de cada partida mensual se cobró en
 * el mismo pago del alta como importe único. Al activarse el pedido, esas partidas se añaden a LA MISMA suscripción
 * (modo flexible: Stripe factura cada partida en su periodo) SIN prorrateo, porque el primer mes ya está pagado. Desde
 * entonces Stripe las cobra cada mes y el plan cada año.
 *
 *  - Se calcula con el pedido y el presupuesto del servidor (nunca con datos del navegador ni de Stripe).
 *  - Un pedido, un cambio (`stripe_subscription_changes`, clave `es-<ns>-order-<id>-items-v1`): repetirlo no añade
 *    nada dos veces. Si Stripe no responde, el cambio queda pendiente y la conciliación de compras lo reenvía con la
 *    misma clave y los mismos parámetros (`ModulePurchaseService.sync` → `sendReduction`).
 *  - Nunca se toca una suscripción en modo clásico (no admite mezclar periodicidades): se avisa para revisión.
 */
import type { QuoteRequest, QuoteResult } from "../catalog/quote";
import type { CommercialOrder } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { CheckoutLinesError, planCheckoutLines } from "./checkoutLines";
import type { GwSubscription, StripeGateway } from "./gateway";
import { itemChanges } from "./multipart";
import type { StripeStore } from "./store";
import { SubscriptionChangeError, sameItems, type ExpectedItem, type SubscriptionChangeStore } from "./changes";

/** `attached`: añadidas ahora; `applied`: ya estaban; `pending`: se reintentará; `blocked`: requiere revisión. */
export type DeferredOutcome = "none" | "attached" | "applied" | "pending" | "blocked";

export interface DeferredItemsDeps {
  namespace: string;
  catalog: CatalogPort;
  store: Pick<StripeStore, "priceForWebPrice" | "sessionPriceSets">;
  gateway: Pick<StripeGateway, "pricesByLookupKeys" | "updateSubscriptionItems">;
  changes: SubscriptionChangeStore;
  quote: (r: QuoteRequest) => Promise<QuoteResult>;
  now?: () => number;
}

const LIVE: CommercialOrder["state"][] = ["active", "past_due", "suspended", "cancel_scheduled"];

export class DeferredItemsService {
  private now: () => number;
  constructor(private d: DeferredItemsDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Añade (o reintenta) las partidas mensuales pendientes del alta. Idempotente; sin nada pendiente no llama a Stripe. */
  async attach(order: CommercialOrder, sub: GwSubscription): Promise<DeferredOutcome> {
    if (order.kind === "change" || order.request.interval !== "year" || !LIVE.includes(order.state)) return "none";
    const prev = await this.d.changes.byOrder(order.id);
    if (prev?.status === "applied") return "applied";
    if (prev && prev.status !== "pending") return "blocked";
    // Solo un alta cobrada por Checkout (una aprobada por excepción no tiene sesión ni partidas en Stripe)
    if (!prev && !(await this.d.store.sessionPriceSets(order.id)).length) return "none";
    const q = await this.d.quote(order.request);
    // Sin partidas mensuales cobradas no hay nada que añadir (y no se consulta Stripe)
    if (!prev && !q.lines.some((l) => l.status === "charged" && l.interval === "month")) return "none";

    let expected: ExpectedItem[];
    if (prev) expected = prev.expectedItems;
    else {
      let deferred;
      try {
        deferred = (await planCheckoutLines({ catalog: this.d.catalog, store: this.d.store, gateway: this.d.gateway }, order, q)).deferred;
      } catch (e) {
        if (!(e instanceof CheckoutLinesError)) throw e;
        return this.alert(order, sub, "plan_failed", e.message);
      }
      if (!deferred.length) return "none";
      const want = new Map((sub.items ?? []).map((i) => [i.priceId, i.quantity]));
      for (const l of deferred) want.set(l.stripePriceId, l.quantity);
      expected = Array.from(want.entries()).map(([priceId, quantity]) => ({ priceId, quantity }));
    }
    if (sameItems(sub.items ?? [], expected)) {
      if (prev) await this.d.changes.resolve(prev.id, "applied", null, this.now());
      return "applied";
    }
    if (sub.billingMode !== "flexible") return this.alert(order, sub, "classic_billing_mode", "La suscripción de Stripe está en modo clásico: no admite partidas mensuales con un plan anual");
    if (sub.status !== "active" || sub.pendingUpdate) return "pending";
    const items = itemChanges(sub.items ?? [], expected);
    if (items.some((i) => i.deleted || i.id)) return this.alert(order, sub, "unexpected_items", "La suscripción de Stripe tiene partidas distintas de las del alta");

    let change = prev;
    if (!change) {
      try {
        change = (
          await this.d.changes.insert({
            orderId: order.id,
            companyId: order.companyId,
            stripeSubscriptionId: sub.id,
            idempotencyKey: `es-${this.d.namespace}-order-${order.id}-items-v1`,
            items,
            expectedItems: expected,
            createdBy: "system:checkout",
            createdAt: this.now(),
          })
        ).change;
      } catch (e) {
        // Otro cambio pendiente de cobro en la suscripción: se reintenta con el próximo evento o la conciliación
        if (e instanceof SubscriptionChangeError && e.code === "pending_exists") return "pending";
        throw e;
      }
    }
    try {
      // Mismos parámetros que el reenvío de la conciliación (`sendReduction`): misma clave, mismo resultado
      const r = await this.d.gateway.updateSubscriptionItems(
        { subscriptionId: change.stripeSubscriptionId, items: change.items, prorationBehavior: "none", paymentBehavior: "error_if_incomplete", metadata: { es_change_order_id: String(order.id) } },
        change.idempotencyKey,
      );
      if (!sameItems(r.subscription.items ?? [], change.expectedItems)) return "pending";
      await this.d.changes.resolve(change.id, "applied", null, this.now());
      opsLog("info", "StripeDeferredItems", "attached", { orderId: order.id, subscriptionId: sub.id, items: change.items.length });
      return "attached";
    } catch (e) {
      // El cambio queda pendiente: la conciliación lo reenvía. Hasta entonces Stripe no cobra esas partidas
      opsLog("warn", "StripeDeferredItems", "attach_pending", { orderId: order.id, subscriptionId: sub.id, retryable: (e as { retryable?: boolean }).retryable === true });
      recordFailure("stripe.deferred_items_pending");
      return "pending";
    }
  }

  private alert(order: CommercialOrder, sub: GwSubscription, reason: string, detail: string): DeferredOutcome {
    opsLog("error", "StripeDeferredItems", "blocked", { orderId: order.id, subscriptionId: sub.id, reason, detail: detail.slice(0, 200) });
    recordFailure("stripe.deferred_items_blocked");
    return "blocked";
  }
}
