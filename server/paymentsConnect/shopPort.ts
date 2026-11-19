/**
 * Puerto real hacia los pedidos de la tienda web. Aplica el resultado del pago con el MISMO tratamiento que el aviso de
 * Redsys (`applyPaymentResult` en redsysRoutes.ts: estado de las reservas, inventario, puntos, cliente del CRM, factura
 * única del pedido, booking operativo, contabilidad, correos). La puerta de «una sola vez» es la actualización
 * condicional de las reservas de `pending_payment` a `paid`.
 */
import type { ShopPort } from "./service";

export function realShopPort(): ShopPort {
  return {
    async applyPaid(merchantOrder, p) {
      // Import tardío: redsysRoutes arrastra medio servidor
      const { applyPaymentResult } = await import("../redsysRoutes");
      await applyPaymentResult({
        merchantOrder,
        isAuthorized: true,
        amount: p.amountCents,
        responseCode: "STRIPE",
        rawData: { provider: "stripe", session: p.sessionId, payment_intent: p.paymentIntent },
        provider: "stripe",
      });
    },
    async applyFailed(merchantOrder, p) {
      const { applyPaymentResult } = await import("../redsysRoutes");
      await applyPaymentResult({
        merchantOrder,
        isAuthorized: false,
        amount: 0,
        // La columna admite 10 caracteres (códigos de 4 de Redsys)
        responseCode: "STRIPE_KO",
        rawData: { provider: "stripe", session: p.sessionId },
        provider: "stripe",
      });
    },
  };
}
