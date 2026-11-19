/**
 * Puerto real hacia los presupuestos de la empresa. Lectura por token y marca de «pagado» reutilizando EXACTAMENTE la
 * lógica de cobro de siempre (`crm.quotes.confirmPayment`: factura, reserva, cliente, correo, operación), llamada como
 * «Sistema (Stripe)». Es idempotente por sí misma (si el presupuesto ya está pagado devuelve la factura existente).
 */
import { eq } from "drizzle-orm";
import { quotes, leads } from "../../drizzle/schema";
import { getDb } from "../db";
import type { QuoteInfo, QuotePort } from "./service";

export const STRIPE_SYSTEM_ACTOR = "Sistema (Stripe)";

export function realQuotePort(): QuotePort {
  return {
    async byToken(token) {
      const db = await getDb();
      if (!db) throw new Error("Base de datos no disponible");
      const [q] = await db.select().from(quotes).where(eq(quotes.paymentLinkToken, token)).limit(1);
      if (!q) return null;
      const [lead] = await db.select({ email: leads.email }).from(leads).where(eq(leads.id, q.leadId)).limit(1);
      const info: QuoteInfo = {
        id: q.id,
        total: String(q.total),
        status: q.status,
        paidAt: q.paidAt ?? null,
        validUntil: q.validUntil ?? null,
        hasPaymentPlan: q.paymentPlanId != null,
        title: q.title ?? null,
        email: lead?.email ?? null,
        currency: q.currency || "EUR",
      };
      return info;
    },
    async markPaid(quoteId, reference) {
      // Import tardío: crm.ts es enorme y arrastra medio servidor
      const { crmRouter } = await import("../routers/crm");
      const caller = crmRouter.createCaller({
        req: { headers: {}, ip: "stripe-connect" } as any,
        res: {} as any,
        user: { id: 0, role: "admin", name: STRIPE_SYSTEM_ACTOR, email: null, openId: "system:stripe" } as any,
      });
      await caller.quotes.confirmPayment({
        quoteId,
        paymentMethod: "otro",
        paymentNote: `Pago con tarjeta en Stripe (cuenta de la empresa). Referencia ${reference}`,
      });
    },
  };
}
