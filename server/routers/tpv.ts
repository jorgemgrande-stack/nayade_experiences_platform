import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import { buildReservationConfirmHtml } from "../emailTemplates";
import {
  cashRegisters,
  cashSessions,
  cashMovements,
  tpvSales,
  tpvSaleItems,
  tpvSalePayments,
  experiences,
  packs,
  spaTreatments,
  roomTypes,
  reservations,
  transactions,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function generateTicketNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `TPV-${date}-${rand}`;
}

function generateReservationRef(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `TPV-RES-${date}-${rand}`;
}

function generateTransactionNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `TXN-${date}-${rand}`;
}

/**
 * Obtiene el régimen fiscal de un producto consultando la BD.
 * Devuelve 'general_21' | 'reav' | 'mixed'
 */
async function getProductFiscalRegime(
  productType: string,
  productId: number
): Promise<"reav" | "general_21" | "mixed"> {
  try {
    if (productType === "experience") {
      const [row] = await db.select({ fiscalRegime: experiences.fiscalRegime }).from(experiences).where(eq(experiences.id, productId));
      return (row?.fiscalRegime as "reav" | "general_21" | "mixed") ?? "general_21";
    } else if (productType === "pack") {
      const [row] = await db.select({ fiscalRegime: packs.fiscalRegime }).from(packs).where(eq(packs.id, productId));
      return (row?.fiscalRegime as "reav" | "general_21" | "mixed") ?? "general_21";
    } else if (productType === "spa") {
      const [row] = await db.select({ fiscalRegime: spaTreatments.fiscalRegime }).from(spaTreatments).where(eq(spaTreatments.id, productId));
      return (row?.fiscalRegime as "reav" | "general_21" | "mixed") ?? "general_21";
    } else if (productType === "hotel") {
      const [row] = await db.select({ fiscalRegime: roomTypes.fiscalRegime }).from(roomTypes).where(eq(roomTypes.id, productId));
      return (row?.fiscalRegime as "reav" | "general_21" | "mixed") ?? "general_21";
    }
  } catch { /* fallback */ }
  return "general_21";
}

/**
 * Calcula la fiscalidad de una línea de venta.
 * Para IVA general_21: base = precio / 1.21, iva = precio - base
 * Para REAV: margen = precio - coste (coste estimado al 60% si no se conoce), impuesto = margen * 0.21
 */
function calcLineFiscal(
  lineTotal: number,
  fiscalRegime: "reav" | "general_21" | "mixed",
  reavCostHint?: number // coste real del proveedor si se conoce
): { taxBase: number; taxAmount: number; taxRate: number; reavCost: number; reavMargin: number; reavTax: number } {
  if (fiscalRegime === "reav") {
    const cost = reavCostHint ?? lineTotal * 0.6; // estimación 60% si no hay coste real
    const margin = Math.max(0, lineTotal - cost);
    const reavTax = margin * 0.21;
    return { taxBase: 0, taxAmount: 0, taxRate: 0, reavCost: cost, reavMargin: margin, reavTax };
  } else {
    // IVA 21% incluido en el precio
    const taxBase = lineTotal / 1.21;
    const taxAmount = lineTotal - taxBase;
    return { taxBase, taxAmount, taxRate: 21, reavCost: 0, reavMargin: 0, reavTax: 0 };
  }
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const tpvRouter = router({
  // ── REGISTERS ──────────────────────────────────────────────────────────────
  getRegisters: protectedProcedure.query(async () => {
    return await db.select().from(cashRegisters).where(eq(cashRegisters.isActive, true));
  }),

  // ── SESSIONS ───────────────────────────────────────────────────────────────
  getActiveSession: protectedProcedure
    .input(z.object({ registerId: z.number() }))
    .query(async ({ input }) => {
      const sessions = await db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.registerId, input.registerId),
            eq(cashSessions.status, "open")
          )
        )
        .limit(1);
      return sessions[0] ?? null;
    }),

  openSession: protectedProcedure
    .input(
      z.object({
        registerId: z.number(),
        openingAmount: z.number().min(0),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check no open session exists
      const existing = await db
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.registerId, input.registerId),
            eq(cashSessions.status, "open")
          )
        )
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe una sesión abierta para esta caja",
        });
      }
      const [result] = await db.insert(cashSessions).values({
        registerId: input.registerId,
        cashierUserId: ctx.user.id,
        cashierName: ctx.user.name ?? ctx.user.email ?? "Cajero",
        openingAmount: String(input.openingAmount),
        status: "open",
        notes: input.notes,
        openedAt: Date.now(),
      });
      const id = (result as any).insertId as number;
      const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, id));
      return session;
    }),

  closeSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        countedCash: z.number().min(0),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [session] = await db
        .select()
        .from(cashSessions)
        .where(eq(cashSessions.id, input.sessionId));
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión no encontrada" });
      if (session.status === "closed") {
        throw new TRPCError({ code: "CONFLICT", message: "La sesión ya está cerrada" });
      }

      // Calculate totals from payments
      const salesRows = await db
        .select()
        .from(tpvSales)
        .where(eq(tpvSales.sessionId, input.sessionId));
      const saleIds = salesRows.map((s) => s.id);

      let totalCash = 0, totalCard = 0, totalBizum = 0, totalMixed = 0;
      if (saleIds.length > 0) {
        for (const saleId of saleIds) {
          const payments = await db
            .select()
            .from(tpvSalePayments)
            .where(and(eq(tpvSalePayments.saleId, saleId), eq(tpvSalePayments.status, "completed")));
          for (const p of payments) {
            const amt = parseFloat(String(p.amount));
            if (p.method === "cash") totalCash += amt;
            else if (p.method === "card") totalCard += amt;
            else if (p.method === "bizum") totalBizum += amt;
            else totalMixed += amt;
          }
        }
      }

      // Manual movements
      const movements = await db
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.sessionId, input.sessionId));
      let totalManualOut = 0, totalManualIn = 0;
      for (const m of movements) {
        if (m.type === "out") totalManualOut += parseFloat(String(m.amount));
        else totalManualIn += parseFloat(String(m.amount));
      }

      const openingAmt = parseFloat(String(session.openingAmount));
      const closingAmount = openingAmt + totalCash + totalManualIn - totalManualOut;
      const cashDifference = input.countedCash - closingAmount;

      await db.update(cashSessions).set({
        status: "closed",
        closedAt: Date.now(),
        countedCash: String(input.countedCash),
        closingAmount: String(closingAmount),
        cashDifference: String(cashDifference),
        totalCash: String(totalCash),
        totalCard: String(totalCard),
        totalBizum: String(totalBizum),
        totalMixed: String(totalMixed),
        totalManualOut: String(totalManualOut),
        totalManualIn: String(totalManualIn),
        notes: input.notes ?? session.notes,
      }).where(eq(cashSessions.id, input.sessionId));

      const [updated] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));
      return updated;
    }),

  getSessionSummary: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión no encontrada" });

      const sales = await db.select().from(tpvSales).where(eq(tpvSales.sessionId, input.sessionId));
      const movements = await db.select().from(cashMovements).where(eq(cashMovements.sessionId, input.sessionId));

      const totalSales = sales.reduce((acc, s) => acc + parseFloat(String(s.total)), 0);
      const totalOut = movements.filter(m => m.type === "out").reduce((acc, m) => acc + parseFloat(String(m.amount)), 0);
      const totalIn = movements.filter(m => m.type === "in").reduce((acc, m) => acc + parseFloat(String(m.amount)), 0);

      return { session, sales, movements, totalSales, totalOut, totalIn };
    }),

  // ── CASH MOVEMENTS ─────────────────────────────────────────────────────────
  addCashMovement: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        type: z.enum(["out", "in"]),
        amount: z.number().positive(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(cashMovements).values({
        sessionId: input.sessionId,
        type: input.type,
        amount: String(input.amount),
        reason: input.reason,
        cashierName: ctx.user.name ?? ctx.user.email ?? "Cajero",
        createdAt: Date.now(),
      });
      const id = (result as any).insertId as number;
      const [movement] = await db.select().from(cashMovements).where(eq(cashMovements.id, id));
      return movement;
    }),

  // ── CATALOG ────────────────────────────────────────────────────────────────
  getCatalog: protectedProcedure.query(async () => {
    const [exps, pkgs, spas, rooms] = await Promise.all([
      db.select({
        id: experiences.id,
        title: experiences.title,
        basePrice: experiences.basePrice,
        coverImageUrl: experiences.coverImageUrl,
        discountPercent: experiences.discountPercent,
        categoryId: experiences.categoryId,
        isActive: experiences.isActive,
      }).from(experiences).where(and(eq(experiences.isActive, true), eq(experiences.isPresentialSale, true))),

      db.select({
        id: packs.id,
        title: packs.title,
        basePrice: packs.basePrice,
        coverImageUrl: packs.image1,
        discountPercent: packs.discountPercent,
        isActive: packs.isActive,
      }).from(packs).where(and(eq(packs.isActive, true), eq(packs.isPresentialSale, true))),

      db.select({
        id: spaTreatments.id,
        title: spaTreatments.name,
        basePrice: spaTreatments.price,
        coverImageUrl: spaTreatments.coverImageUrl,
        discountPercent: spaTreatments.discountPercent,
        isActive: spaTreatments.isActive,
      }).from(spaTreatments).where(and(eq(spaTreatments.isActive, true), eq(spaTreatments.isPresentialSale, true))),

      db.select({
        id: roomTypes.id,
        title: roomTypes.name,
        basePrice: roomTypes.basePrice,
        coverImageUrl: roomTypes.coverImageUrl,
        discountPercent: roomTypes.discountPercent,
        isActive: roomTypes.isActive,
      }).from(roomTypes).where(and(eq(roomTypes.isActive, true), eq(roomTypes.isPresentialSale, true))),
    ]);

    return {
      experiences: exps.map(p => ({ ...p, productType: "experience" as const })),
      packs: pkgs.map(p => ({ ...p, productType: "pack" as const })),
      spa: spas.map(p => ({ ...p, productType: "spa" as const })),
      hotel: rooms.map(p => ({ ...p, productType: "hotel" as const })),
    };
  }),

  // ── SALES ──────────────────────────────────────────────────────────────────
  createSale: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        customerName: z.string().optional(),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
        discountAmount: z.number().min(0).default(0),
        discountReason: z.string().optional(),
        discountCodeId: z.number().optional(),
        notes: z.string().optional(),
        items: z.array(
          z.object({
            productType: z.enum(["experience", "pack", "spa", "hotel", "restaurant", "extra"]),
            productId: z.number(),
            productName: z.string(),
            quantity: z.number().int().positive(),
            unitPrice: z.number().positive(),
            discountPercent: z.number().min(0).max(100).default(0),
            eventDate: z.string().optional(),
            eventTime: z.string().optional(),
            participants: z.number().int().positive().default(1),
            notes: z.string().optional(),
          })
        ).min(1),
        payments: z.array(
          z.object({
            payerName: z.string().optional(),
            method: z.enum(["cash", "card", "bizum", "other"]),
            amount: z.number().positive(),
            amountTendered: z.number().optional(),
          })
        ).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // ── 1. Calcular totales básicos ────────────────────────────────────────
      const subtotal = input.items.reduce((acc, item) => {
        const lineTotal = item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
        return acc + lineTotal;
      }, 0);
      const total = Math.max(0, subtotal - input.discountAmount);

      // Validate payments sum
      const paymentsTotal = input.payments.reduce((acc, p) => acc + p.amount, 0);
      if (Math.abs(paymentsTotal - total) > 0.01) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Los pagos (${paymentsTotal.toFixed(2)}€) no coinciden con el total (${total.toFixed(2)}€)`,
        });
      }

      // ── 2. Calcular fiscalidad por línea ────────────────────────────────────
      const linesFiscal: Array<{
        fiscalRegime: "reav" | "general_21" | "mixed";
        taxBase: number; taxAmount: number; taxRate: number;
        reavCost: number; reavMargin: number; reavTax: number;
        lineSubtotal: number;
      }> = [];

      for (const item of input.items) {
        const lineSubtotal = item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
        const regime = await getProductFiscalRegime(item.productType, item.productId);
        const fiscal = calcLineFiscal(lineSubtotal, regime);
        linesFiscal.push({ fiscalRegime: regime, ...fiscal, lineSubtotal });
      }

      // Totales fiscales agregados
      const totalTaxBase   = linesFiscal.reduce((s, l) => s + l.taxBase,   0);
      const totalTaxAmount = linesFiscal.reduce((s, l) => s + l.taxAmount, 0);
      const totalReavMargin= linesFiscal.reduce((s, l) => s + l.reavMargin,0);
      const totalReavCost  = linesFiscal.reduce((s, l) => s + l.reavCost,  0);
      const totalReavTax   = linesFiscal.reduce((s, l) => s + l.reavTax,   0);
      const hasReav = linesFiscal.some(l => l.fiscalRegime === "reav");
      const hasIva  = linesFiscal.some(l => l.fiscalRegime === "general_21");
      const fiscalSummary = hasReav && hasIva ? "mixed" : hasReav ? "reav_only" : "iva_only";

      const ticketNumber = generateTicketNumber();
      const sellerName = (ctx as any).user?.name ?? null;
      const sellerUserId = (ctx as any).user?.id ?? null;

      // ── 3. Insertar venta con datos fiscales ─────────────────────────────────
      const [saleResult] = await db.insert(tpvSales).values({
        ticketNumber,
        sessionId: input.sessionId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        subtotal: String(subtotal.toFixed(2)),
        discountAmount: String(input.discountAmount.toFixed(2)),
        discountReason: input.discountReason,
        discountCodeId: input.discountCodeId ?? null,
        total: String(total.toFixed(2)),
        status: "paid",
        notes: input.notes,
        createdAt: Date.now(),
        paidAt: Date.now(),
        taxBase:        String(totalTaxBase.toFixed(2)),
        taxAmount:      String(totalTaxAmount.toFixed(2)),
        taxRate:        "21",
        reavMargin:     String(totalReavMargin.toFixed(2)),
        reavCost:       String(totalReavCost.toFixed(2)),
        reavTax:        String(totalReavTax.toFixed(2)),
        fiscalSummary,
        saleChannel:    "tpv",
        sellerUserId,
        sellerName,
      } as any);
      const saleId = (saleResult as any).insertId as number;

      // ── 4. Insertar líneas con fiscalidad ───────────────────────────────────
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const lf   = linesFiscal[i];
        await db.insert(tpvSaleItems).values({
          saleId,
          productType: item.productType,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice.toFixed(2)),
          discountPercent: String(item.discountPercent.toFixed(2)),
          subtotal: String(lf.lineSubtotal.toFixed(2)),
          eventDate: item.eventDate,
          eventTime: item.eventTime,
          participants: item.participants,
          notes: item.notes,
          fiscalRegime: lf.fiscalRegime,
          taxBase:    String(lf.taxBase.toFixed(2)),
          taxAmount:  String(lf.taxAmount.toFixed(2)),
          taxRate:    String(lf.taxRate.toFixed(2)),
          reavCost:   String(lf.reavCost.toFixed(2)),
          reavMargin: String(lf.reavMargin.toFixed(2)),
          reavTax:    String(lf.reavTax.toFixed(2)),
        } as any);
      }

      // ── 5. Insertar pagos ────────────────────────────────────────────────────
      const primaryPaymentMethod = input.payments[0]?.method ?? "other";
      for (const payment of input.payments) {
        const changeGiven = payment.method === "cash" && payment.amountTendered
          ? Math.max(0, payment.amountTendered - payment.amount)
          : 0;
        await db.insert(tpvSalePayments).values({
          saleId,
          payerName: payment.payerName,
          method: payment.method,
          amount: String(payment.amount.toFixed(2)),
          amountTendered: payment.amountTendered ? String(payment.amountTendered.toFixed(2)) : null,
          changeGiven: String(changeGiven.toFixed(2)),
          status: "completed",
          createdAt: Date.now(),
        });
      }

      // ── 6. Generar reserva automática siempre que haya producto principal ────
      let reservationId: number | null = null;
      const mainItem = input.items[0];
      if (mainItem) {
        try {
          const merchantOrder = generateReservationRef();
          const amountCents = Math.round(total * 100);
          const [resResult] = await db.insert(reservations).values({
            productId: mainItem.productId,
            productName: mainItem.productName,
            bookingDate: mainItem.eventDate ?? new Date().toISOString().slice(0, 10),
            people: mainItem.participants ?? 1,
            amountTotal: amountCents,
            amountPaid: amountCents,
            status: "paid",
            customerName: input.customerName || "Cliente TPV",
            customerEmail: input.customerEmail || null,
            customerPhone: input.customerPhone || null,
            merchantOrder,
            notes: `[ORIGEN_TPV] Ticket: ${ticketNumber}${input.customerName ? ` · ${input.customerName}` : ""}`,
            paymentMethod: primaryPaymentMethod === "card" ? "redsys" :
                           primaryPaymentMethod === "cash" ? "efectivo" : "otro",
            channel: "tpv",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            paidAt: Date.now(),
          } as any);
          reservationId = (resResult as any).insertId as number;
          // Actualizar la venta con el ID de reserva
          await db.update(tpvSales).set({ reservationId } as any).where(eq(tpvSales.id, saleId));
        } catch (e) {
          console.error("[TPV] Error creando reserva automática:", e);
        }
      }

      // ── 7. Registrar transacción unificada en el libro maestro ───────────────
      try {
        const methodMap: Record<string, string> = {
          cash: "efectivo", card: "tarjeta", bizum: "otro", other: "otro"
        };
        const txMethod = methodMap[primaryPaymentMethod] ?? "otro";
        const txNumber = generateTransactionNumber();
        await db.insert(transactions).values({
          transactionNumber: txNumber,
          type: "ingreso",
          amount: String(total.toFixed(2)),
          currency: "EUR",
          paymentMethod: txMethod as any,
          status: "completado",
          description: `Venta TPV ${ticketNumber}${mainItem ? ` — ${mainItem.productName}` : ""}`,
          processedAt: new Date(),
          clientName: input.customerName ?? null,
          clientEmail: input.customerEmail ?? null,
          clientPhone: input.customerPhone ?? null,
          productName: mainItem?.productName ?? null,
          saleChannel: "tpv",
          sellerUserId,
          sellerName,
          taxBase:    String(totalTaxBase.toFixed(2)),
          taxAmount:  String(totalTaxAmount.toFixed(2)),
          reavMargin: String(totalReavMargin.toFixed(2)),
          fiscalRegime: (fiscalSummary === "iva_only" ? "general_21" : fiscalSummary === "reav_only" ? "reav" : "mixed") as any,
          tpvSaleId: saleId,
          reservationId: reservationId ?? undefined,
          reservationRef: reservationId ? `TPV-RES-${saleId}` : undefined,
          operationStatus: "confirmada",
        } as any);
      } catch (e) {
        console.error("[TPV] Error registrando transacción:", e);
      }

      // ── 8. Email de confirmación (cliente si hay email + siempre a reservas@) ─
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT ?? "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const emailHtml = buildReservationConfirmHtml({
          merchantOrder: ticketNumber,
          productName: mainItem?.productName ?? input.items.map(i => i.productName).join(", "),
          customerName: input.customerName || "Cliente TPV",
          date: new Date().toLocaleDateString("es-ES"),
          people: mainItem?.participants ?? 1,
          amount: `${total.toFixed(2)} €`,
        });
        const subject = `[TPV] Compra confirmada ${ticketNumber} — Náyade Experiences`;
        // Siempre a reservas@
        await transporter.sendMail({
          from: process.env.SMTP_FROM ?? "noreply@nayadeexperiences.com",
          to: "reservas@nayadeexperiences.es",
          subject,
          html: emailHtml,
        });
        // Al cliente si proporcionó email
        if (input.customerEmail) {
          await transporter.sendMail({
            from: process.env.SMTP_FROM ?? "noreply@nayadeexperiences.com",
            to: input.customerEmail,
            subject,
            html: emailHtml,
          });
        }
      } catch (e) {
        console.error("[TPV] Error enviando email de confirmación:", e);
      }

      // ── 9. Devolver venta completa ───────────────────────────────────────────
      const [sale] = await db.select().from(tpvSales).where(eq(tpvSales.id, saleId));
      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, saleId));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, saleId));
      return { sale, items, payments, reservationId };;
    }),

  getSale: protectedProcedure
    .input(z.object({ saleId: z.number() }))
    .query(async ({ input }) => {
      const [sale] = await db.select().from(tpvSales).where(eq(tpvSales.id, input.saleId));
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });
      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, input.saleId));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, input.saleId));
      return { sale, items, payments };
    }),

  getSessionSales: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      return await db
        .select()
        .from(tpvSales)
        .where(eq(tpvSales.sessionId, input.sessionId))
        .orderBy(desc(tpvSales.createdAt));
    }),

  // ── BACKOFFICE ─────────────────────────────────────────────────────────────
  getBackoffice: protectedProcedure
    .input(
      z.object({
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const sessions = await db
        .select()
        .from(cashSessions)
        .orderBy(desc(cashSessions.openedAt))
        .limit(input.limit)
        .offset(offset);

      // Enrich with register names
      const registers = await db.select().from(cashRegisters);
      const registerMap = Object.fromEntries(registers.map(r => [r.id, r.name]));

      return sessions.map(s => ({
        ...s,
        registerName: registerMap[s.registerId] ?? "Caja",
      }));
    }),

  getBackofficeSalesByProduct: protectedProcedure
    .input(z.object({ sessionId: z.number().optional() }))
    .query(async ({ input }) => {
      const items = await db.select().from(tpvSaleItems);
      // Group by product name
      const grouped: Record<string, { productName: string; productType: string; totalQty: number; totalRevenue: number }> = {};
      for (const item of items) {
        const key = `${item.productType}:${item.productId}`;
        if (!grouped[key]) {
          grouped[key] = {
            productName: item.productName,
            productType: item.productType,
            totalQty: 0,
            totalRevenue: 0,
          };
        }
        grouped[key].totalQty += item.quantity;
        grouped[key].totalRevenue += parseFloat(String(item.subtotal));
      }
      return Object.values(grouped).sort((a, b) => b.totalRevenue - a.totalRevenue);
    }),

  // ── SEND TICKET EMAIL ─────────────────────────────────────────────────────
  sendTicketEmail: protectedProcedure
    .input(
      z.object({
        ticketNumber: z.string(),
        email: z.string().email(),
      })
    )
    .mutation(async ({ input }) => {
      const [sale] = await db
        .select()
        .from(tpvSales)
        .where(eq(tpvSales.ticketNumber, input.ticketNumber))
        .limit(1);
      if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "Venta no encontrada" });

      const items = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, sale.id));
      const payments = await db.select().from(tpvSalePayments).where(eq(tpvSalePayments.saleId, sale.id));

      const METHOD_LABELS: Record<string, string> = {
        cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro",
      };

      const itemsHtml = items.map(item => `
        <tr>
          <td style="padding:4px 8px;">${item.productName}</td>
          <td style="padding:4px 8px;text-align:center;">${item.quantity}</td>
          <td style="padding:4px 8px;text-align:right;">${parseFloat(String(item.unitPrice)).toFixed(2)}€</td>
          <td style="padding:4px 8px;text-align:right;">${parseFloat(String(item.subtotal)).toFixed(2)}€</td>
        </tr>
      `).join("");

      const paymentsHtml = payments.map(p => `
        <tr>
          <td style="padding:4px 8px;">${METHOD_LABELS[p.method] ?? p.method}</td>
          <td style="padding:4px 8px;text-align:right;">${parseFloat(String(p.amount)).toFixed(2)}€</td>
        </tr>
      `).join("");

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#7c3aed;">Náyade Experiences — Ticket ${sale.ticketNumber}</h2>
          <p style="color:#555;font-size:11px;margin:0 0 2px;">NEXTAIR, S.L. &middot; CIF: B16408031</p>
          <p style="color:#777;font-size:11px;margin:0 0 10px;">C/JOSE LUIS PEREZ PUJADAS, Nº 14, PLTA.1, PUERTA D EDIFICIO FORUM &middot; 18006 GRANADA</p>
          <p style="color:#666;">Fecha: ${new Date(Number(sale.createdAt)).toLocaleString("es-ES")}</p>
          ${sale.customerName ? `<p>Cliente: <strong>${sale.customerName}</strong></p>` : ""}
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <thead><tr style="background:#f3f0ff;">
              <th style="padding:6px 8px;text-align:left;">Producto</th>
              <th style="padding:6px 8px;">Cant.</th>
              <th style="padding:6px 8px;text-align:right;">Precio</th>
              <th style="padding:6px 8px;text-align:right;">Total</th>
            </tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <table style="width:100%;border-collapse:collapse;margin:8px 0;">
            <tr style="border-top:2px solid #7c3aed;">
              <td style="padding:8px;font-weight:bold;">TOTAL</td>
              <td style="padding:8px;text-align:right;font-weight:bold;font-size:18px;color:#7c3aed;">${parseFloat(String(sale.total)).toFixed(2)}€</td>
            </tr>
          </table>
          <h4 style="margin-top:16px;">Forma de pago</h4>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${paymentsHtml}</tbody>
          </table>
          <p style="margin-top:24px;color:#999;font-size:12px;">¡Gracias por su visita! — www.nayadeexperiences.com</p>
        </div>
      `;

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? "noreply@nayadeexperiences.com",
        to: input.email,
        subject: `Tu ticket de compra ${sale.ticketNumber} — Náyade Experiences`,
        html,
      });

      return { ok: true };
    }),
});
