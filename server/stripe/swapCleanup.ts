/**
 * Limpieza de la partida a 0 que deja una sustitución por paquete (p. ej. Comunidades + Tokens → Social Token Net
 * Complete). Stripe no admite borrar partidas en un cambio pendiente de cobro, así que la sustitución deja la partida
 * del segundo componente a cantidad 0. En cuanto el cambio está confirmado (la suscripción ya tiene las partidas
 * esperadas y el pedido está vigente), esa partida se retira:
 *  - SIN prorrateo (`proration_behavior: none`): no tiene importe, así que ni cargo ni abono ni factura.
 *  - Solo las partidas que el propio cambio dejó a 0, si siguen a 0 y con el precio del componente sustituido.
 *    Nunca otras partidas.
 *  - Idempotente: clave derivada del cambio y de las partidas; si ya no están, no se llama a Stripe.
 *  - Si Stripe falla: alerta `purchases.swap_cleanup_pending` y el cambio sigue pendiente, de modo que la
 *    conciliación de compras lo reintenta.
 */
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { SubscriptionChange } from "./changes";
import type { GwSubscription, StripeGateway } from "./gateway";

/** Clave del cambio de Stripe de una sustitución por paquete: lleva abono, así que nunca se reenvía sin prorrateo. */
export const SWAP_SUFFIX = "-swap-v1";

/** Partidas de la suscripción que la sustitución dejó a 0 y siguen así (las únicas que se pueden retirar). */
export function swapZeroItems(change: SubscriptionChange, sub: GwSubscription): string[] {
  if (!change.idempotencyKey.endsWith(SWAP_SUFFIX)) return [];
  const zeroed = new Set(change.items.filter((i) => i.id && !i.priceId && !i.deleted && i.quantity === 0).map((i) => i.id!));
  const zeroPrices = new Set(change.expectedItems.filter((e) => e.quantity === 0).map((e) => e.priceId));
  return (sub.items ?? []).filter((i) => zeroed.has(i.id) && i.quantity === 0 && zeroPrices.has(i.priceId)).map((i) => i.id).sort();
}

/** Retira las partidas a 0 de una sustitución ya confirmada. true si no queda ninguna (o no había). */
export async function cleanupSwapZeros(gateway: StripeGateway, change: SubscriptionChange, sub: GwSubscription): Promise<boolean> {
  const ids = swapZeroItems(change, sub);
  if (!ids.length) return true;
  try {
    await gateway.updateSubscriptionItems(
      { subscriptionId: change.stripeSubscriptionId, items: ids.map((id) => ({ id, deleted: true as const })), prorationBehavior: "none", paymentBehavior: "error_if_incomplete", metadata: { es_change_order_id: String(change.orderId) } },
      `${change.idempotencyKey}-cleanup-${ids.join("-")}`,
    );
    opsLog("info", "Purchases", "swap_cleanup_done", { orderId: change.orderId, changeId: change.id, items: ids.length });
    return true;
  } catch (e) {
    opsLog("error", "Purchases", "swap_cleanup_pending", { orderId: change.orderId, changeId: change.id, retryable: (e as { retryable?: boolean }).retryable === true });
    recordFailure("purchases.swap_cleanup_pending");
    return false;
  }
}
