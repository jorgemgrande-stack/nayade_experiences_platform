/**
 * Puerto real hacia los presupuestos de la empresa. Lectura por token y marca de «pagado» reutilizando EXACTAMENTE la
 * lógica de cobro de siempre (`crm.quotes.confirmPayment`: factura, reserva, cliente, correo, operación), llamada como
 * «Sistema (Stripe)». Es idempotente por sí misma (si el presupuesto ya está pagado devuelve la factura existente).
 */
import { and, eq, isNull, like } from "drizzle-orm";
import { invoices, quotes, leads, reservations } from "../../drizzle/schema";
import { getDb, logActivity } from "../db";
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
      // Un presupuesto que ya estaba pagado (en efectivo, por transferencia, por Redsys o por otra sesión de Stripe) NO se
      // vuelve a facturar: el cargo de Stripe es un cobro duplicado y queda trazado en la ficha para su reembolso manual.
      const dbPaid = await getDb();
      if (!dbPaid) throw new Error("Base de datos no disponible");
      const [current] = await dbPaid.select({ paidAt: quotes.paidAt }).from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      // ¿Lo pagó ESTA misma referencia en una llamada anterior que falló a medias (p. ej. tras confirmPayment)? Entonces no es un
      // duplicado: se completan los pasos pendientes. La referencia queda en la nota de la reserva que crea confirmPayment.
      let appliedByThisReference = false;
      if (current?.paidAt) {
        const [mine] = await dbPaid.select({ id: reservations.id }).from(reservations).where(like(reservations.notes, `%Referencia ${reference}%`)).limit(1);
        appliedByThisReference = !!mine;
      }
      if (current?.paidAt && !appliedByThisReference) {
        await logActivity("quote", quoteId, "duplicate_payment_detected", 0, STRIPE_SYSTEM_ACTOR, { reference, message: "Cobro de Stripe sobre un presupuesto ya pagado: sin nueva factura; revisar el reembolso" }).catch(() => undefined);
        return { alreadyPaid: true as const };
      }
      if (!appliedByThisReference) {
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
      }
      // `confirmPayment` no pone método a la factura (queda el valor por defecto de la tabla, «redsys», también en los cobros
      // manuales): un cobro de Stripe no puede figurar como Redsys. Se anota «otro» (la referencia queda en la reserva y en
      // payment_checkouts); idempotente.
      const db = await getDb();
      if (!db) throw new Error("Base de datos no disponible");
      await db.update(invoices).set({ paymentMethod: "otro" }).where(eq(invoices.quoteId, quoteId));
      await db.update(quotes).set({ paymentMethod: "otro" }).where(and(eq(quotes.id, quoteId), isNull(quotes.paymentMethod)));
    },
  };
}
