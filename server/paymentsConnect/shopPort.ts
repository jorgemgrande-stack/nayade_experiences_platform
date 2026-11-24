/**
 * Puerto real hacia los pedidos de la tienda web. Aplica el resultado del pago con el MISMO tratamiento que el aviso de
 * Redsys (`applyPaymentResult` en redsysRoutes.ts: estado de las reservas, inventario, puntos, cliente del CRM, factura
 * única del pedido, booking operativo, contabilidad, correos). La puerta de «una sola vez» es la actualización
 * condicional de las reservas de `pending_payment` a `paid`.
 */
import { and, eq, isNull } from "drizzle-orm";
import { reservations } from "../../drizzle/schema";
import { createVentaPerdidaLead, getDb, logActivity } from "../db";
import { applyPaymentToInventoryHolds } from "../inventoryHoldsDb";
import { changeLearningAccessForOrder } from "../learningFlow";
import { alertAdmin, INCIDENT_LABEL } from "./incidents";
import type { PaymentIncident, ShopPort } from "./service";

const STRIPE_ACTOR = "Sistema (Stripe)";

/** Acción sobre la matrícula según el hecho. El reembolso parcial NO la toca (el alumno sigue con lo que pagó). */
const ACCESS: Partial<Record<PaymentIncident["kind"], { action: "revoke" | "suspend" | "reactivate"; reason: string }>> = {
  refund_full: { action: "revoke", reason: "Stripe: reembolso total del pedido" },
  dispute_lost: { action: "revoke", reason: "Stripe: disputa perdida" },
  dispute_opened: { action: "suspend", reason: "Stripe: disputa abierta, acceso en pausa" },
  dispute_won: { action: "reactivate", reason: "Stripe: disputa ganada, acceso restablecido" },
};

export function realShopPort(): ShopPort {
  return {
    async applyPaid(merchantOrder, p) {
      // Import tardío: redsysRoutes arrastra medio servidor
      const { applyPaymentResult, orderEffectsPending } = await import("../redsysRoutes");
      await applyPaymentResult({
        merchantOrder,
        isAuthorized: true,
        amount: p.amountCents,
        responseCode: "STRIPE",
        rawData: { provider: "stripe", session: p.sessionId, payment_intent: p.paymentIntent },
        provider: "stripe",
        retry: true,
      });
      // Pago registrado pero pedido sin cerrar (un paso posterior falló, incluso si el aviso lo absorbió): se falla el evento
      // para que Stripe lo reenvíe y se completen los efectos pendientes sin repetir los aplicados.
      if (await orderEffectsPending(merchantOrder)) throw new Error("Pedido pagado sin cerrar: se reintentará");
    },
    async applyExpired(merchantOrder) {
      const db = await getDb();
      if (!db) throw new Error("Base de datos no disponible");
      // Solo las líneas del pedido directo aún pendientes (lo pagado o ya cancelado no se toca)
      const pending = await db.select().from(reservations).where(and(eq(reservations.merchantOrder, merchantOrder), eq(reservations.status, "pending_payment"), isNull(reservations.quoteId)));
      const direct = pending.filter((r) => (r as any).channel === "ONLINE_DIRECTO");
      if (!direct.length) return;
      // Misma consecuencia que el abandono de siempre (lead «Venta perdida»), pero sin esperar a la limpieza periódica
      try {
        await createVentaPerdidaLead(direct as any);
      } catch (e) {
        console.error("[Stripe] No se pudo registrar la venta perdida:", (e as Error).message);
      }
      await db.update(reservations).set({ status: "cancelled", updatedAt: Date.now() } as any)
        .where(and(eq(reservations.merchantOrder, merchantOrder), eq(reservations.status, "pending_payment"), isNull(reservations.quoteId)));
      // Plazas de spa/hotel liberadas ya (idempotente). El stock de artículos solo se descuenta al pagar: no hay nada que devolver.
      await applyPaymentToInventoryHolds(merchantOrder, false);
    },
    async applyIncident(merchantOrder, i) {
      const db = await getDb();
      if (!db) throw new Error("Base de datos no disponible");
      const rows = await db.select({ id: reservations.id, changesLog: reservations.changesLog }).from(reservations).where(eq(reservations.merchantOrder, merchantOrder));
      if (!rows.length) return;
      // Primero la protección del acceso (idempotente; si falla, el evento se reintenta y no queda abierto en silencio)
      const access = ACCESS[i.kind];
      const learning = access ? await changeLearningAccessForOrder(merchantOrder, access.action, access.reason) : { changed: 0 };
      // Un reintento del mismo evento no duplica la marca ni el aviso
      const marked = rows.some((r) => (Array.isArray(r.changesLog) ? r.changesLog : []).some((e: any) => e?.eventId === i.eventId));
      if (marked) return;
      const now = Date.now();
      const entry = { ts: now, actor: STRIPE_ACTOR, action: `stripe_${i.kind}`, label: INCIDENT_LABEL[i.kind], eventId: i.eventId, paymentIntent: i.paymentIntent, chargedCents: i.chargedCents, refundedCents: i.refundedCents, reason: i.reason, learningChanged: learning.changed };
      for (const r of rows) {
        const log = Array.isArray(r.changesLog) ? r.changesLog : [];
        await db.update(reservations).set({ changesLog: [...log, entry] } as any).where(eq(reservations.id, r.id));
      }
      await logActivity("reservation", rows[0].id, `stripe_${i.kind}`, null, STRIPE_ACTOR, { merchantOrder, ...i, learningChanged: learning.changed });
      await alertAdmin(`pedido ${merchantOrder}`, i);
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
