/**
 * CRM Router — Nayade Experiences
 * Ciclo completo: Lead → Presupuesto → Pago Redsys → Reserva → Factura PDF
 */import { router, protectedProcedure, publicProcedure, staffProcedure } from "../_core/trpc";
import { createLead, createBookingFromReservation, createReavExpedient, attachReavDocument, upsertClientFromReservation, postConfirmOperation, getGHLCredentials } from "../db";
import { calcularREAVSimple, validarConfiguracionREAV } from "../reav";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  leads,
  quotes,
  reservations,
  invoices,
  crmActivityLog,
  clients,
  experiences,
  experienceVariants,
  reavExpedients,
  siteSettings,
  tpvSales,
  tpvSaleItems,
  legoPacks,
  packs,
  pendingPayments,
  discountCodes,
  paymentPlans,
  paymentInstallments,
  cancellationRequests,
  discountCodeUses,
  bankMovements,
  bankMovementLinks,
  cardTerminalOperations,
  ghlConversations,
  vapiCalls,
} from "../../drizzle/schema";
import { recordDiscountUse } from "./discounts";
import { getDefaultCashAccountId, createCashMovementIfNotExists } from "./cashRegisterHelper";
import { eq, desc, and, gte, lte, like, or, sql, count, sum, isNull, max, ne, notInArray, inArray, isNotNull, getTableColumns } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { generateDocumentNumber } from "../documentNumbers";
import { htmlToPdf } from "../pdfGenerator";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";
import { storagePut, hasExternalStorage } from "../storage";
import {
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildQuotePdfHtml,
  buildPendingPaymentHtml,
  buildPendingPaymentReminderHtml,
  buildInstallmentReminderHtml,
} from "../emailTemplates";
import { buildInvoiceHtml, getLegalCompanySettings } from "../invoiceHtml";
import { syncLeadUrlsToGHL, createGHLContact, getGHLTagsFromSource } from "../ghl";
import { getSystemSettingSync, getBusinessEmail } from "../config";
import { groupTaxBreakdown, totalTaxAmount } from "../taxUtils";

// DB helper — usa la misma pool que el resto del servidor
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

// Email helper — delega en el helper compartido mailer.ts
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const sent = await sharedSendEmail({ to, subject, html });
  if (!sent) { console.warn("SMTP not configured, skipping email"); return; }
  const copyEmail = getSystemSettingSync("email_copy_recipient", "");
  if (copyEmail) await sharedSendEmail({ to: copyEmail, subject: `[COPIA] ${subject}`, html });
}
// ─── HELPERS ─────────────────────────────────────────────────────────────────

// logActivity ahora viene de db.ts (centralizado)
import { logActivity } from "../db";

// generateInvoiceNumber y generateQuoteNumber reemplazadas por el helper centralizado
// Ver server/documentNumbers.ts
async function generateInvoiceNumber(context?: string, userId?: string): Promise<string> {
  return generateDocumentNumber("factura", context ?? "crm:invoice", userId ?? "system");
}
async function generateQuoteNumber(context?: string, userId?: string): Promise<string> {
  return generateDocumentNumber("presupuesto", context ?? "crm:quote", userId ?? "system");
}
async function generateReservationNum(context?: string, userId?: string): Promise<string> {
  return generateDocumentNumber("reserva", context ?? "crm:reservation", userId ?? "system");
}

// ─── INVOICE PDF GENERATION ──────────────────────────────────────────────────
async function generateInvoicePdf(invoice: {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string; taxRate?: number }[];
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  taxBreakdown?: { rate: number; base: number; amount: number }[];
  issuedAt: Date;
}): Promise<{ url: string; key: string }> {
  // Sin almacenamiento externo (S3/Forge) → URL on-demand desde BD, sin archivos temporales
  if (!hasExternalStorage()) {
    const url = `/api/invoices/preview?n=${encodeURIComponent(invoice.invoiceNumber)}`;
    return { url, key: "" };
  }

  const html = await buildInvoiceHtml(invoice);
  try {
    const pdfBuffer = await htmlToPdf(html);
    const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.pdf`;
    const { url } = await storagePut(key, pdfBuffer, "application/pdf");
    return { url, key };
  } catch (pdfErr) {
    console.error("[PDF] Error generando factura PDF, usando vista on-demand:", pdfErr);
    const url = `/api/invoices/preview?n=${encodeURIComponent(invoice.invoiceNumber)}`;
    return { url, key: "" };
  }
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

async function sendQuoteEmail(quote: {
  quoteNumber: string;
  title: string;
  clientName: string;
  clientEmail: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  validUntil?: Date | null;
  notes?: string | null;
  conditions?: string | null;
  paymentLinkUrl?: string | null;
  installmentPlan?: {
    firstRequiredAmountCents: number | null;
    installments: { installmentNumber: number; amountCents: number; dueDate: string; isRequiredForConfirmation: boolean }[];
  } | null;
}) {
  const html = buildQuoteHtml({
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    clientName: quote.clientName,
    items: quote.items,
    subtotal: quote.subtotal,
    discount: quote.discount,
    tax: quote.tax,
    total: quote.total,
    validUntil: quote.validUntil ?? undefined,
    notes: quote.notes ?? undefined,
    conditions: quote.conditions ?? undefined,
    paymentLinkUrl: quote.paymentLinkUrl ?? undefined,
    installmentPlan: quote.installmentPlan ?? undefined,
  });

  await sendEmail({
    to: quote.clientEmail,
    subject: `Tu propuesta de Náyade Experiences — ${quote.quoteNumber}`,
    html,
  });
}

async function sendConfirmationEmail(data: {
  clientName: string;
  clientEmail: string;
  reservationRef: string;
  quoteTitle: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  total: string;
  invoiceUrl?: string | null;
  bookingDate?: string | null;
  selectedTime?: string | null;
  installmentPlan?: {
    installments: Array<{
      installmentNumber: number;
      amountCents: number;
      dueDate: string;
      status: string;
      isRequiredForConfirmation: boolean;
    }>;
  };
}) {
  const html = buildConfirmationHtml({
    clientName: data.clientName,
    reservationRef: data.reservationRef,
    quoteTitle: data.quoteTitle,
    items: data.items,
    total: data.total,
    invoiceUrl: data.invoiceUrl ?? undefined,
    bookingDate: data.bookingDate ?? undefined,
    selectedTime: data.selectedTime ?? undefined,
    installmentPlan: data.installmentPlan,
  });

  await sendEmail({
    to: data.clientEmail,
    subject: `✅ Reserva confirmada — ${data.reservationRef} · Náyade Experiences`,
    html,
  });
}


async function sendInternalNotification(data: {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  reservationRef: string;
  quoteTitle: string;
  total: string;
  paidAt: Date;
  reservationId: number;
}) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#1a3a6b;padding:24px 32px;">
      <div style="display:inline-block;background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.4);border-radius:20px;padding:4px 14px;font-size:11px;color:#86efac;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">💰 Compra Efectuada</div>
      <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;">${data.clientName}</h1>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:140px;">Referencia</td><td style="padding:8px 0;font-weight:600;color:#111827;">${data.reservationRef}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 0;color:#111827;">${data.clientEmail}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Teléfono</td><td style="padding:8px 0;color:#111827;">${data.clientPhone || "—"}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Producto</td><td style="padding:8px 0;color:#111827;">${data.quoteTitle}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Importe</td><td style="padding:8px 0;font-size:18px;font-weight:800;color:#16a34a;">${Number(data.total).toFixed(2)} €</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Fecha pago</td><td style="padding:8px 0;color:#111827;">${data.paidAt.toLocaleString("es-ES")}</td></tr>
      </table>
      <div style="margin-top:24px;text-align:center;">
        <a href="${process.env.VITE_OAUTH_PORTAL_URL || ""}/admin/crm/reservations/${data.reservationId}" style="display:inline-block;background:#1a3a6b;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Ver ficha de reserva →</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: await getBusinessEmail('reservations'),
    subject: `💰 Compra efectuada "${data.clientName}" — ${data.reservationRef}`,
    html,
  });
}

// ─── Email: Confirmación de pago por transferencia bancaria (al cliente) ────
async function sendTransferConfirmationEmail(data: {
  clientName: string;
  clientEmail: string;
  invoiceNumber: string;
  reservationRef: string;
  quoteTitle: string;
  quoteNumber?: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  taxAmount: string;
  total: string;
  invoiceUrl?: string | null;
  confirmedBy?: string;
  confirmedAt?: Date;
}) {
  const html = buildTransferConfirmationHtml({
    clientName: data.clientName,
    invoiceNumber: data.invoiceNumber,
    reservationRef: data.reservationRef,
    quoteTitle: data.quoteTitle,
    quoteNumber: data.quoteNumber,
    items: data.items,
    subtotal: data.subtotal,
    taxAmount: data.taxAmount,
    total: data.total,
    invoiceUrl: data.invoiceUrl ?? undefined,
    confirmedBy: data.confirmedBy,
    confirmedAt: data.confirmedAt,
  });

  await sendEmail({
    to: data.clientEmail,
    subject: `🏦 Pago por transferencia confirmado — ${data.invoiceNumber} · Náyade Experiences`,
    html,
  });
}

// ─── CRM ROUTER ──────────────────────────────────────────────────────────────

const staff = staffProcedure;

export async function checkAndConfirmInstallmentPlan(quoteId: number, userId: number, userName: string) {
  const installments = await db.select().from(paymentInstallments)
    .where(eq(paymentInstallments.quoteId, quoteId));
  const required = installments.filter(i => i.isRequiredForConfirmation);
  if (required.length === 0) return;
  const allRequiredPaid = required.every(i => i.status === "paid");
  if (!allRequiredPaid) return;

  const allInstallmentsPaid = installments.every(i => i.status === "paid");

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return;

  const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
  const now = new Date();
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string }[]) ?? [];
  const subtotal = Number(quote.subtotal);
  const breakdown = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
  const taxAmount = totalTaxAmount(breakdown);
  const taxRateInst = breakdown.length === 1 ? breakdown[0].rate : 21;
  const total = parseFloat((subtotal + taxAmount).toFixed(2));

  // ── FASE 1: Confirmar reserva cuando se pagan las cuotas obligatorias ──────
  // Idempotente: sólo si el quote aún no está aceptado
  if (quote.status !== "aceptado") {
    let [reservation] = await db.select().from(reservations)
      .where(and(eq(reservations.quoteId, quoteId), ne(reservations.status, "cancelled")))
      .orderBy(desc(reservations.createdAt))
      .limit(1);

    const paidAmountCents = installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
    const totalAmountCents = installments.reduce((s, i) => s + i.amountCents, 0);

    if (!reservation) {
      // Pago manual de la primera cuota: no existe reserva previa — crearla ahora
      const mainProductId = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead?.experienceId ?? 0;
      const serviceDate = lead?.preferredDate
        ? new Date(lead.preferredDate).toISOString().split("T")[0]
        : now.toISOString().split("T")[0];
      const reservationNumber = await generateReservationNum("crm:installments:manual", String(userId));
      const merchantOrder = reservationNumber.replace(/[^A-Z0-9]/gi, "").substring(0, 12);
      const [resResult] = await db.insert(reservations).values({
        productId: mainProductId,
        productName: quote.title ?? "Presupuesto",
        bookingDate: serviceDate,
        people: lead?.numberOfPersons ?? lead?.numberOfAdults ?? 1,
        amountTotal: totalAmountCents,
        amountPaid: paidAmountCents,
        status: "paid",
        statusReservation: "CONFIRMADA",
        statusPayment: allInstallmentsPaid ? "PAGADO" : "PAGO_PARCIAL",
        channel: "ONLINE_ASISTIDO",
        customerName: lead?.name ?? quote.title ?? "",
        customerEmail: lead?.email ?? "",
        customerPhone: lead?.phone ?? "",
        merchantOrder,
        reservationNumber,
        quoteId,
        quoteSource: "presupuesto",
        paymentMethod: "otro",
        notes: `Plan fraccionado — confirmado desde presupuesto ${quote.quoteNumber}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        paidAt: Date.now(),
      } as any);
      const newReservationId = (resResult as { insertId: number }).insertId;
      const [newRes] = await db.select().from(reservations).where(eq(reservations.id, newReservationId)).limit(1);
      reservation = newRes;
      console.log(`[checkAndConfirmInstallmentPlan] Reserva ${reservationNumber} creada para plan fraccionado manual — quoteId=${quoteId}`);
    } else if (reservation.status !== "paid") {
      await db.update(reservations)
        .set({ status: "paid", amountPaid: paidAmountCents, updatedAt: Date.now() } as any)
        .where(eq(reservations.id, reservation.id));
    }

    await db.update(quotes).set({
      status: "aceptado",
      paymentLinkToken: null,
      updatedAt: now,
    }).where(eq(quotes.id, quoteId));

    if (lead) {
      await db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, lead.id));
    }

    // Crear pendingPayments para cuotas aún sin pagar
    const stillPending = installments.filter(i => i.status === "pending");
    if (stillPending.length > 0) {
      const nowMs = Date.now();
      for (const inst of stillPending) {
        await db.insert(pendingPayments).values({
          quoteId: quote.id,
          reservationId: reservation?.id ?? null,
          clientName: lead?.name ?? quote.title ?? "",
          clientEmail: lead?.email ?? undefined,
          clientPhone: lead?.phone ?? undefined,
          productName: quote.title ?? undefined,
          amountCents: inst.amountCents,
          dueDate: inst.dueDate ?? undefined,
          reason: `Plan fraccionado — Cuota #${inst.installmentNumber}${inst.notes ? `: ${inst.notes}` : ""}`,
          status: "pending",
          createdBy: userId,
          createdAt: nowMs,
          updatedAt: nowMs,
        } as any);
      }
    }

    await db.insert(crmActivityLog).values({
      entityType: "quote",
      entityId: quoteId,
      action: "confirmed_by_installments",
      actorId: userId,
      actorName: userName,
      details: { message: "Cuotas obligatorias pagadas — reserva confirmada, plan activo" },
      createdAt: now,
    });

    // Email de confirmación solo si quedan cuotas pendientes (si todas pagadas, Fase 2 envía el email con factura)
    if (!allInstallmentsPaid && lead?.email) {
      try {
        await sendConfirmationEmail({
          clientName: lead.name,
          clientEmail: lead.email,
          reservationRef: quote.quoteNumber ?? `PRES-${quoteId}`,
          quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
          items,
          total: String(total),
          invoiceUrl: null,
          installmentPlan: {
            installments: installments.map(i => ({
              installmentNumber: i.installmentNumber,
              amountCents: i.amountCents,
              dueDate: i.dueDate ?? "",
              status: i.status ?? "pending",
              isRequiredForConfirmation: i.isRequiredForConfirmation ?? false,
            })),
          },
        });
      } catch (emailErr) {
        console.error("[_checkAndConfirmReservation] Error enviando email confirmación:", emailErr);
      }
    }
  }

  // ── FASE 2: Generar factura sólo cuando TODAS las cuotas están pagadas ─────
  if (allInstallmentsPaid) {
    // Re-leer el quote para verificar idempotencia (evitar doble factura en llamadas concurrentes)
    const [freshQuote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (freshQuote?.paidAt) return;

    // Usar la reserva MÁS ANTIGUA (la original del primer pago), no la más reciente.
    // En planes multi-cuota, payWithToken crea una nueva reserva por cada pago, pero la
    // factura debe vincularse a la reserva original (la que el cliente ve como "su reserva").
    const [reservation] = await db.select().from(reservations)
      .where(and(eq(reservations.quoteId, quoteId), ne(reservations.status, "cancelled")))
      .orderBy(reservations.createdAt)
      .limit(1);

    const invoiceNumber = await generateInvoiceNumber("crm:installments", String(userId));
    let pdfUrl: string | null = null;
    let pdfKey: string | null = null;
    try {
      const pdf = await generateInvoicePdf({
        invoiceNumber,
        clientName: lead?.name ?? quote.title,
        clientEmail: lead?.email ?? "",
        clientPhone: lead?.phone ?? null,
        clientNif: null,
        clientAddress: null,
        itemsJson: items as any,
        subtotal: String(subtotal),
        taxRate: String(taxRateInst),
        taxAmount: String(taxAmount),
        taxBreakdown: breakdown.length > 0 ? breakdown : undefined,
        total: String(total),
        issuedAt: now,
      });
      pdfUrl = pdf.url;
      pdfKey = pdf.key;
    } catch (e) {
      console.error("[checkAndConfirmInstallmentPlan] Error generando PDF:", e);
    }

    const [invResult] = await db.insert(invoices).values({
      invoiceNumber,
      quoteId: quote.id,
      reservationId: reservation?.id ?? null,
      clientName: lead?.name ?? quote.title,
      clientEmail: lead?.email ?? "",
      clientPhone: lead?.phone ?? null,
      itemsJson: items as any,
      subtotal: String(subtotal),
      taxRate: String(taxRateInst),
      taxAmount: String(taxAmount),
      taxBreakdown: breakdown.length > 0 ? breakdown : undefined,
      total: String(total),
      status: "cobrada",
      paymentMethod: "otro",
      isAutomatic: false,
      issuedAt: now,
      pdfUrl,
      pdfKey,
      createdAt: now,
      updatedAt: now,
    });
    const invoiceId = (invResult as { insertId: number }).insertId;

    if (reservation) {
      await db.update(reservations)
        .set({ amountPaid: Math.round(total * 100), invoiceId, invoiceNumber, paidAt: Date.now(), updatedAt: Date.now() } as any)
        .where(eq(reservations.id, reservation.id));
    }

    await db.update(quotes).set({
      paidAt: now,
      invoiceNumber,
      invoicePdfUrl: pdfUrl,
      updatedAt: now,
    }).where(eq(quotes.id, quoteId));

    await db.insert(crmActivityLog).values({
      entityType: "quote",
      entityId: quoteId,
      action: "invoice_generated",
      actorId: userId,
      actorName: userName,
      details: { invoiceNumber, message: "Plan de pagos completado — factura generada" },
      createdAt: now,
    });

    // Email final con factura adjunta
    if (lead?.email) {
      try {
        await sendConfirmationEmail({
          clientName: lead.name,
          clientEmail: lead.email,
          reservationRef: invoiceNumber,
          quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
          items,
          total: String(total),
          invoiceUrl: pdfUrl,
          installmentPlan: {
            installments: installments.map(i => ({
              installmentNumber: i.installmentNumber,
              amountCents: i.amountCents,
              dueDate: i.dueDate ?? "",
              status: i.status ?? "paid",
              isRequiredForConfirmation: i.isRequiredForConfirmation ?? false,
            })),
          },
        });
      } catch (emailErr) {
        console.error("[_checkAndConfirmReservation] Error enviando email factura:", emailErr);
      }
    }
  }
}

export const crmRouter = router({
  // ─── LEADS ─────────────────────────────────────────────────────────────────

  leads: router({
    list: staff
      .input(
        z.object({
          opportunityStatus: z.enum(["nueva", "enviada", "ganada", "perdida"]).optional(),
          search: z.string().optional(),
          assignedTo: z.number().optional(),
          priority: z.enum(["baja", "media", "alta"]).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];
        if (input.opportunityStatus) conditions.push(eq(leads.opportunityStatus, input.opportunityStatus));
        if (input.assignedTo) conditions.push(eq(leads.assignedTo, input.assignedTo));
        if (input.priority) conditions.push(eq(leads.priority, input.priority));
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(leads.name, s),
              like(leads.email, s),
              like(leads.phone, s),
              like(leads.company, s),
              like(leads.selectedProduct, s),
              like(leads.selectedCategory, s),
              like(leads.message, s),
              like(leads.source, s)
            )
          );
        }
        if (input.from) conditions.push(gte(leads.createdAt, new Date(input.from)));
        if (input.to) conditions.push(lte(leads.createdAt, new Date(input.to)));

        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db
            .select({ ...getTableColumns(leads), clientId: clients.id })
            .from(leads)
            .leftJoin(clients, eq(clients.leadId, leads.id))
            .where(where)
            .orderBy(desc(leads.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(leads).where(where),
        ]);

        return { rows, total };
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());

      const [total, nueva, enviada, ganada, perdida, hoy, semana, sinLeer,
             valorNueva, valorEnviada, valorGanada, valorPerdida] = await Promise.all([
        db.select({ cnt: count() }).from(leads),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "nueva")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "enviada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "ganada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "perdida")),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfDay)),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfWeek)),
        db.select({ cnt: count() }).from(leads).where(isNull(leads.seenAt)),
        // Valor económico por estado: suma del presupuesto más reciente de cada lead
        // "nueva": lead sin presupuesto aún → usa leads.budget (estimación del cliente)
        db.select({ total: sum(leads.budget) }).from(leads).where(eq(leads.opportunityStatus, "nueva")),
        // "enviada": presupuesto ya enviado → suma quotes.total (importe real del presupuesto)
        db.select({ total: sum(quotes.total) }).from(quotes)
          .innerJoin(leads, eq(quotes.leadId, leads.id))
          .where(and(eq(leads.opportunityStatus, "enviada"), sql`${quotes.status} NOT IN ('rechazado')`)),
        // "ganada": presupuesto aceptado → suma quotes.total del presupuesto aceptado
        db.select({ total: sum(quotes.total) }).from(quotes)
          .innerJoin(leads, eq(quotes.leadId, leads.id))
          .where(and(eq(leads.opportunityStatus, "ganada"), eq(quotes.status, "aceptado"))),
        // "perdida": lead descartado → usa leads.budget (ya no tiene presupuesto activo)
        db.select({ total: sum(leads.budget) }).from(leads).where(eq(leads.opportunityStatus, "perdida")),
      ]);

      return {
        total: total[0]?.cnt ?? 0,
        nueva: nueva[0]?.cnt ?? 0,
        enviada: enviada[0]?.cnt ?? 0,
        ganada: ganada[0]?.cnt ?? 0,
        perdida: perdida[0]?.cnt ?? 0,
        hoy: hoy[0]?.cnt ?? 0,
        semana: semana[0]?.cnt ?? 0,
        sinLeer: sinLeer[0]?.cnt ?? 0,
        valorNueva: Number(valorNueva[0]?.total ?? 0),
        valorEnviada: Number(valorEnviada[0]?.total ?? 0),
        valorGanada: Number(valorGanada[0]?.total ?? 0),
        valorPerdida: Number(valorPerdida[0]?.total ?? 0),
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Mark as seen
        if (!lead.seenAt) {
          await db.update(leads).set({ seenAt: new Date() }).where(eq(leads.id, input.id));
        }

        // Activity log
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(50);

        // Related quotes
        const relatedQuotes = await db
          .select()
          .from(quotes)
          .where(eq(quotes.leadId, input.id))
          .orderBy(desc(quotes.createdAt));

        return { lead, activity, quotes: relatedQuotes };
      }),

    update: staff
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          email: z.string().email().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
          message: z.string().optional(),
          opportunityStatus: z.enum(["nueva", "enviada", "ganada", "perdida"]).optional(),
          priority: z.enum(["baja", "media", "alta"]).optional(),
          assignedTo: z.number().nullable().optional(),
          lostReason: z.string().optional(),
          selectedCategory: z.string().optional(),
          selectedProduct: z.string().optional(),
          numberOfAdults: z.number().optional(),
          numberOfChildren: z.number().optional(),
           preferredDate: z.string().optional(),
          activitiesJson: z.array(z.object({
            experienceId: z.number(),
            experienceTitle: z.string(),
            family: z.string(),
            participants: z.number(),
            details: z.record(z.string(), z.union([z.string(), z.number()])),
          })).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
        if (data.preferredDate) updateData.preferredDate = new Date(data.preferredDate);
        await db.update(leads).set(updateData).where(eq(leads.id, id));
        await logActivity("lead", id, "lead_updated", ctx.user.id, ctx.user.name, { changes: Object.keys(data) });
        return { success: true };
      }),

    addNote: staff
      .input(z.object({ id: z.number(), text: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select({ notes: leads.internalNotes }).from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = (lead.notes as { text: string; authorId: number; authorName: string; createdAt: string }[]) ?? [];
        const newNote = {
          text: input.text,
          authorId: ctx.user.id,
          authorName: ctx.user.name ?? "Agente",
          createdAt: new Date().toISOString(),
        };
        const updated = [...existing, newNote];

        await db.update(leads).set({ internalNotes: updated, lastContactAt: new Date() }).where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "note_added", ctx.user.id, ctx.user.name, { note: input.text });
        return { success: true, note: newNote };
      }),

    markLost: staff
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", status: "perdido", lostReason: input.reason, updatedAt: new Date() })
          .where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "marked_lost", ctx.user.id, ctx.user.name, { reason: input.reason });
        return { success: true };
      }),

    convertToQuote: staff
      .input(
        z.object({
          leadId: z.number(),
          title: z.string(),
          description: z.string().optional(),
          items: z.array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitPrice: z.number(),
              total: z.number(),
              fiscalRegime: z.enum(["reav", "general"]).optional(),
              taxRate: z.number().optional(),
              productId: z.number().optional(),
            })
          ),
          subtotal: z.number(),
          discount: z.number().default(0),
          taxRate: z.number().default(21),
          total: z.number(),
          validUntil: z.string().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });

        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        // Precios ya incluyen IVA: extraer cuota con groupTaxBreakdown
        const breakdown = groupTaxBreakdown(input.items.filter(i => i.fiscalRegime !== "reav"));
        const taxAmount = totalTaxAmount(breakdown);

        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: input.leadId,
          agentId: ctx.user.id,
          title: input.title,
          description: input.description,
          items: input.items,
          subtotal: String(input.subtotal),
          discount: String(input.discount),
          tax: String(taxAmount),
          total: String(input.total),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          notes: input.notes,
          conditions: input.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const quoteId = (result as { insertId: number }).insertId;

        // Update lead status
        await db
          .update(leads)
          .set({ status: "en_proceso", updatedAt: new Date() })
          .where(eq(leads.id, input.leadId));

        await logActivity("lead", input.leadId, "converted_to_quote", ctx.user.id, ctx.user.name, { quoteId, quoteNumber });
        await logActivity("quote", quoteId, "quote_created", ctx.user.id, ctx.user.name, { fromLead: input.leadId });
        return { success: true, quoteId, quoteNumber };
      }),

    // ─── Generar presupuesto automáticamente desde activitiesJson del lead ─────────────────────────
    generateFromLead: staff
      .input(z.object({
        leadId: z.number(),
        taxRate: z.number().default(21),
        conditions: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Cargar el lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });

        const activities = (lead.activitiesJson as {
          experienceId: number;
          experienceTitle: string;
          family: string;
          participants: number;
          details: Record<string, string | number>;
        }[] | null) ?? [];

        // 2. Resolver precios para cada actividad
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number }[] = [];

        // ── Fallback: si no hay activitiesJson, buscar por selectedProduct en packs/experiences/legoPacks ──
        if (activities.length === 0) {
          const productName = lead.selectedProduct;
          const qty = lead.numberOfPersons ?? 1;

          if (!productName) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Este lead no tiene actividades ni producto seleccionado. Añade los conceptos manualmente.",
            });
          }

          // Buscar en packs (día, escolar, empresa)
          const [foundPack] = await db.select().from(packs)
            .where(and(eq(packs.title, productName), eq(packs.isActive, true)))
            .limit(1);

          if (foundPack) {
            const unitPrice = parseFloat(String(foundPack.basePrice));
            quoteItems.push({
              description: `${foundPack.title}${foundPack.subtitle ? ` — ${foundPack.subtitle}` : ""}`,
              quantity: qty,
              unitPrice,
              total: parseFloat((unitPrice * qty).toFixed(2)),
              fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
              taxRate: foundPack.taxRate != null ? parseFloat(String(foundPack.taxRate)) : 21,
              productId: foundPack.id,
            });
          } else {
            // Buscar en legoPacks
            const [foundLego] = await db.select().from(legoPacks)
              .where(and(eq(legoPacks.title, productName), eq(legoPacks.isActive, true)))
              .limit(1);

            if (foundLego) {
              const unitPrice = parseFloat(String((foundLego as any).basePrice ?? (foundLego as any).price ?? 0));
              quoteItems.push({
                description: `${foundLego.title}${(foundLego as any).subtitle ? ` — ${(foundLego as any).subtitle}` : ""}`,
                quantity: qty,
                unitPrice,
                total: parseFloat((unitPrice * qty).toFixed(2)),
                fiscalRegime: "general",
                taxRate: (foundLego as any).taxRate != null ? parseFloat(String((foundLego as any).taxRate)) : 21,
                productId: foundLego.id,
              });
            } else {
              // Buscar en experiences
              const [foundExp] = await db.select().from(experiences)
                .where(and(eq(experiences.title, productName), eq(experiences.isActive, true)))
                .limit(1);

              if (foundExp) {
                const unitPrice = parseFloat(String(foundExp.basePrice));
                quoteItems.push({
                  description: foundExp.title,
                  quantity: qty,
                  unitPrice,
                  total: parseFloat((unitPrice * qty).toFixed(2)),
                  fiscalRegime: foundExp.fiscalRegime === "reav" ? "reav" : "general",
                  taxRate: foundExp.taxRate != null ? parseFloat(String(foundExp.taxRate)) : 21,
                  productId: foundExp.id,
                });
              } else {
                // Producto no encontrado en BD: crear línea vacía con nombre del producto
                quoteItems.push({
                  description: productName,
                  quantity: qty,
                  unitPrice: 0,
                  total: 0,
                  fiscalRegime: "general",
                  taxRate: 21,
                });
              }
            }
          }
        }

        for (const act of activities) {
          // Cargar experiencia base
          const [exp] = await db.select().from(experiences).where(eq(experiences.id, act.experienceId));
          const basePrice = exp ? parseFloat(String(exp.basePrice)) : 0;

          // Cargar variantes de esta experiencia
          const variants = await db
            .select()
            .from(experienceVariants)
            .where(eq(experienceVariants.experienceId, act.experienceId));

          // Determinar variante seleccionada (si existe)
          const selectedVariantName = act.details?.variante as string | undefined;
          const matchedVariant = selectedVariantName
            ? variants.find((v) => v.name === selectedVariantName)
            : variants.length === 1 ? variants[0] : null;

          let unitPrice = basePrice;
          let description = act.experienceTitle;

          if (matchedVariant) {
            const modifier = parseFloat(String(matchedVariant.priceModifier ?? "0"));
            if (matchedVariant.priceType === "per_person") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name} (${act.participants} pax)`;
            } else if (matchedVariant.priceType === "fixed") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            } else if (matchedVariant.priceType === "percentage") {
              unitPrice = basePrice * (1 + modifier / 100);
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            }
          } else if (variants.length > 0) {
            // Hay variantes pero ninguna seleccionada: usar precio base
            description = `${act.experienceTitle} (precio base)`;
          }

          // Añadir detalles contextuales a la descripción
          const detailParts: string[] = [];
          if (act.details?.duration) detailParts.push(String(act.details.duration));
          if (act.details?.jumps) detailParts.push(`${act.details.jumps} saltos`);
          if (act.details?.notes) detailParts.push(String(act.details.notes));
          if (detailParts.length > 0) description += ` • ${detailParts.join(" · ")}`;

           const quantity = act.participants;
          const total = parseFloat((unitPrice * quantity).toFixed(2));
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general";
          const itemTaxRate = exp?.taxRate != null ? parseFloat(String(exp.taxRate)) : 21;
          quoteItems.push({ description, quantity, unitPrice: parseFloat(unitPrice.toFixed(2)), total, fiscalRegime: itemFiscalRegime, taxRate: itemTaxRate, productId: act.experienceId });
        }
        // 3. Calcular totales — IVA ya incluido en precios, se extrae con groupTaxBreakdown
        const subtotal = parseFloat(quoteItems.reduce((s, i) => s + i.total, 0).toFixed(2));
        const taxBreakdown = groupTaxBreakdown(quoteItems);
        const taxAmount = parseFloat(totalTaxAmount(taxBreakdown).toFixed(2));
        const total = subtotal;

        // 4. Crear el presupuesto en borrador
        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 15); // válido 15 días

        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: input.leadId,
          agentId: ctx.user.id,
          title: `Propuesta para ${lead.name}`,
          description: `Generado automáticamente desde las actividades seleccionadas en el formulario.`,
          items: quoteItems,
          subtotal: String(subtotal),
          discount: "0",
          tax: String(taxAmount),
          total: String(total),
          validUntil,
          conditions: input.conditions ?? "Presupuesto válido por 15 días. Sujeto a disponibilidad.",
          status: "borrador",
          isAutoGenerated: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const quoteId = (result as { insertId: number }).insertId;

        // 5. Actualizar estado del lead
        await db.update(leads).set({ status: "en_proceso", updatedAt: new Date() }).where(eq(leads.id, input.leadId));

        await logActivity("lead", input.leadId, "auto_quote_generated", ctx.user.id, ctx.user.name, { quoteId, quoteNumber, itemCount: quoteItems.length });
        await logActivity("quote", quoteId, "quote_created", ctx.user.id, ctx.user.name, { fromLead: input.leadId, auto: true });

        return { success: true, quoteId, quoteNumber, itemCount: quoteItems.length, subtotal, total };
      }),

    // ─── Previsualizar líneas desde activitiesJson (sin guardar en BD) ───────────────────────────
    previewFromLead: staffProcedure
      .input(z.object({ leadId: z.number() }))
      .query(async ({ input }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });
        const activities = (lead.activitiesJson as {
          experienceId: number;
          experienceTitle: string;
          family: string;
          participants: number;
          details: Record<string, string | number>;
        }[] | null) ?? [];
        if (activities.length === 0) {
          // Fallback: buscar por selectedProduct en packs/legoPacks/experiences
          const productName = lead.selectedProduct;
          const qty = lead.numberOfPersons ?? 1;
          if (!productName) return { items: [], hasActivities: false };

          const [foundPack] = await db.select().from(packs)
            .where(and(eq(packs.title, productName), eq(packs.isActive, true))).limit(1);
          if (foundPack) {
            const unitPrice = parseFloat(String(foundPack.basePrice));
            return { items: [{ description: `${foundPack.title}${foundPack.subtitle ? ` — ${foundPack.subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general", productId: foundPack.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundLego] = await db.select().from(legoPacks)
            .where(and(eq(legoPacks.title, productName), eq(legoPacks.isActive, true))).limit(1);
          if (foundLego) {
            const unitPrice = parseFloat(String((foundLego as any).basePrice ?? (foundLego as any).price ?? 0));
            return { items: [{ description: `${foundLego.title}${(foundLego as any).subtitle ? ` — ${(foundLego as any).subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: "general" as const, productId: foundLego.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundExp] = await db.select().from(experiences)
            .where(and(eq(experiences.title, productName), eq(experiences.isActive, true))).limit(1);
          if (foundExp) {
            const unitPrice = parseFloat(String(foundExp.basePrice));
            return { items: [{ description: foundExp.title, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundExp.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general", productId: foundExp.id }], hasActivities: true, fromSelectedProduct: true };
          }
          return { items: [{ description: productName, quantity: qty, unitPrice: 0, total: 0, fiscalRegime: "general" as const }], hasActivities: true, fromSelectedProduct: true };
        }
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; productId?: number }[] = [];
        for (const act of activities) {
          const [exp] = await db.select().from(experiences).where(eq(experiences.id, act.experienceId));
          const basePrice = exp ? parseFloat(String(exp.basePrice)) : 0;
          const variants = await db.select().from(experienceVariants).where(eq(experienceVariants.experienceId, act.experienceId));
          const selectedVariantName = act.details?.variante as string | undefined;
          const matchedVariant = selectedVariantName
            ? variants.find((v) => v.name === selectedVariantName)
            : variants.length === 1 ? variants[0] : null;
          let unitPrice = basePrice;
          let description = act.experienceTitle;
          if (matchedVariant) {
            const modifier = parseFloat(String(matchedVariant.priceModifier ?? "0"));
            if (matchedVariant.priceType === "per_person") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name} (${act.participants} pax)`;
            } else if (matchedVariant.priceType === "fixed") {
              unitPrice = modifier;
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            } else if (matchedVariant.priceType === "percentage") {
              unitPrice = basePrice * (1 + modifier / 100);
              description = `${act.experienceTitle} — ${matchedVariant.name}`;
            }
          } else if (variants.length > 0) {
            description = `${act.experienceTitle} (precio base)`;
          }
          const detailParts: string[] = [];
          if (act.details?.duration) detailParts.push(String(act.details.duration));
          if (act.details?.jumps) detailParts.push(`${act.details.jumps} saltos`);
          if (act.details?.notes) detailParts.push(String(act.details.notes));
          if (detailParts.length > 0) description += ` • ${detailParts.join(" · ")}`;
          const quantity = act.participants;
          const total = parseFloat((unitPrice * quantity).toFixed(2));
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general";
          quoteItems.push({ description, quantity, unitPrice: parseFloat(unitPrice.toFixed(2)), total, fiscalRegime: itemFiscalRegime, productId: act.experienceId });
        }
        return { items: quoteItems, hasActivities: true };
      }),

    create: staff
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        company: z.string().optional(),
        message: z.string().optional(),
        preferredDate: z.string().optional(),
        numberOfAdults: z.number().optional(),
        numberOfChildren: z.number().optional(),
        selectedCategory: z.string().optional(),
        selectedProduct: z.string().optional(),
        source: z.string().optional(),
        activitiesJson: z.array(z.object({
          experienceId: z.number(),
          experienceTitle: z.string(),
          family: z.string(),
          participants: z.number(),
          details: z.record(z.string(), z.union([z.string(), z.number()])),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Usar createLead de db.ts para que se cree el cliente automáticamente
        const { source: _source, activitiesJson: _acts, ...leadInput } = input;
        const result = await createLead({
          ...leadInput,
        });
        // Si hay actividades, guardarlas en el lead
        if (input.activitiesJson && input.activitiesJson.length > 0) {
          await db.update(leads).set({ activitiesJson: input.activitiesJson }).where(eq(leads.id, result.id));
        }
        await logActivity("lead", result.id, "lead_created_admin", ctx.user.id, ctx.user.name, { name: input.name });
        return result;
      }),

    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [lead] = await db.select().from(leads).where(eq(leads.id, input.id));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead no encontrado" });
        // Borrar actividad relacionada
        await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, input.id)));
        await db.delete(leads).where(eq(leads.id, input.id));
        await logActivity("lead", input.id, "lead_deleted", ctx.user.id, ctx.user.name, { name: lead.name });
        return { success: true };
      }),

    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        for (const id of input.ids) {
          await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "lead"), eq(crmActivityLog.entityId, id)));
        }
        await db.delete(leads).where(inArray(leads.id, input.ids));
        return { deleted: input.ids.length };
      }),

    bulkMarkSeen: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        await db.update(leads).set({ seenAt: new Date() }).where(and(inArray(leads.id, input.ids), isNull(leads.seenAt)));
        return { updated: input.ids.length };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["nueva", "enviada", "ganada", "perdida"]),
      }))
      .mutation(async ({ input }) => {
        await db.update(leads).set({ opportunityStatus: input.status, updatedAt: new Date() }).where(inArray(leads.id, input.ids));
        return { updated: input.ids.length };
      }),
  }),
  // ─── QUOTESES ────────────────────────────────────────────────────────────────

  quotes: router({
    list: staff
      .input(
        z.object({
          status: z.enum(["borrador", "enviado", "visualizado", "convertido_carrito", "pago_fallido", "aceptado", "rechazado", "expirado", "perdido"]).optional(),
          search: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];
        if (input.status) conditions.push(eq(quotes.status, input.status));
         if (input.from) conditions.push(gte(quotes.createdAt, new Date(input.from)));
        if (input.to) conditions.push(lte(quotes.createdAt, new Date(input.to)));
        // Join con leads para obtener datos del cliente
        // NOTE: search filter is applied AFTER the join so we can search by client name/email/phone
        const baseQuery = db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            title: quotes.title,
            status: quotes.status,
            total: quotes.total,
            subtotal: quotes.subtotal,
            discount: quotes.discount,
            tax: quotes.tax,
            items: quotes.items,
            validUntil: quotes.validUntil,
            notes: quotes.notes,
            conditions: quotes.conditions,
            paymentLinkUrl: quotes.paymentLinkUrl,
            paymentLinkToken: quotes.paymentLinkToken,
            paidAt: quotes.paidAt,
            sentAt: quotes.sentAt,
            viewedAt: quotes.viewedAt,
            isAutoGenerated: quotes.isAutoGenerated,
            invoiceNumber: quotes.invoiceNumber,
            invoicePdfUrl: quotes.invoicePdfUrl,
            createdAt: quotes.createdAt,
            updatedAt: quotes.updatedAt,
            leadId: quotes.leadId,
            agentId: quotes.agentId,
            paymentPlanId: quotes.paymentPlanId,
            // Datos del cliente (desde el lead)
            clientName: leads.name,
            clientEmail: leads.email,
            clientPhone: leads.phone,
            clientCompany: leads.company,
            clientId: clients.id,
          })
          .from(quotes)
          .leftJoin(leads, eq(quotes.leadId, leads.id))
          .leftJoin(clients, eq(clients.leadId, quotes.leadId));
        // Build search condition including joined lead fields
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(quotes.quoteNumber, s),
              like(quotes.title, s),
              like(quotes.notes, s),
              like(leads.name, s),
              like(leads.email, s),
              like(leads.phone, s),
              like(leads.company, s),
              like(leads.selectedProduct, s)
            )
          );
        }
        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          baseQuery
            .where(where)
            .orderBy(desc(quotes.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(quotes)
            .leftJoin(leads, eq(quotes.leadId, leads.id))
            .leftJoin(clients, eq(clients.leadId, quotes.leadId))
            .where(where),
        ]);
        return { rows, total };
      }),

    counters: staff.query(async () => {
      const [borrador, enviado, pagoFallido, pendientePago, ganado, perdido, totalImporte,
             importeBorrador, importeEnviado, importePagoFallido] = await Promise.all([
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "borrador")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "enviado")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "pago_fallido")),
        db.select({ cnt: count() }).from(quotes).where(and(eq(quotes.status, "enviado"), sql`${quotes.paidAt} IS NULL`)),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "aceptado")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "perdido")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "aceptado")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "borrador")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "enviado")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "pago_fallido")),
      ]);

      const totalEnviados = (enviado[0]?.cnt ?? 0);
      const totalGanados = (ganado[0]?.cnt ?? 0);
      const ratio = totalEnviados > 0 ? Math.round((totalGanados / totalEnviados) * 100) : 0;

      return {
        borrador: borrador[0]?.cnt ?? 0,
        enviado: enviado[0]?.cnt ?? 0,
        pagoFallido: pagoFallido[0]?.cnt ?? 0,
        pendientePago: pendientePago[0]?.cnt ?? 0,
        ganado: totalGanados,
        perdido: perdido[0]?.cnt ?? 0,
        importeTotal: Number(totalImporte[0]?.total ?? 0).toFixed(2),
        importeBorrador: Number(importeBorrador[0]?.total ?? 0),
        importeEnviado: Number(importeEnviado[0]?.total ?? 0),
        importePagoFallido: Number(importePagoFallido[0]?.total ?? 0),
        ratioConversion: ratio,
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(50);

        const relatedInvoices = await db.select().from(invoices).where(eq(invoices.quoteId, input.id));

        return { quote, lead, activity, invoices: relatedInvoices };
      }),

    update: staff
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          description: z.string().optional(),
          items: z
            .array(
              z.object({
                description: z.string(),
                quantity: z.number(),
                unitPrice: z.number(),
                total: z.number(),
                fiscalRegime: z.enum(["reav", "general"]).optional(),
                taxRate: z.number().optional(),
                productId: z.number().optional(),
              })
            )
            .optional(),
          subtotal: z.number().optional(),
          discount: z.number().optional(),
          taxRate: z.number().optional(),
          total: z.number().optional(),
          validUntil: z.string().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { id, taxRate, ...rest } = input;
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (rest.title !== undefined) updateData.title = rest.title;
        if (rest.description !== undefined) updateData.description = rest.description;
        if (rest.items !== undefined) updateData.items = rest.items;
        if (rest.subtotal !== undefined) updateData.subtotal = String(rest.subtotal);
        if (rest.discount !== undefined) updateData.discount = String(rest.discount);
        if (rest.total !== undefined) updateData.total = String(rest.total);
        if (taxRate !== undefined && rest.subtotal !== undefined) {
          const taxAmount = (rest.subtotal - (rest.discount ?? 0)) * (taxRate / 100);
          updateData.tax = String(taxAmount);
        }
        if (rest.validUntil) updateData.validUntil = new Date(rest.validUntil);
        if (rest.notes !== undefined) updateData.notes = rest.notes;
        if (rest.conditions !== undefined) updateData.conditions = rest.conditions;

        await db.update(quotes).set(updateData).where(eq(quotes.id, id));
        await logActivity("quote", id, "quote_updated", ctx.user.id, ctx.user.name, {});
        return { success: true };
      }),

    send: staff
      .input(
        z.object({
          id: z.number(),
          /** URL base del frontend (window.location.origin) para construir el enlace de aceptación */
          origin: z.string().url().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead asociado no encontrado" });

        // Generar token único de aceptación si no existe ya
        const { randomBytes } = await import("crypto");
        const token = quote.paymentLinkToken ?? randomBytes(32).toString("hex");
        const origin = input.origin ?? "https://www.nayadeexperiences.es";
        const acceptUrl = `${origin}/presupuesto/${token}`;

        // Update quote
        await db
          .update(quotes)
          .set({
            status: "enviado",
            sentAt: new Date(),
            paymentLinkToken: token,
            paymentLinkUrl: acceptUrl,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, input.id));

        // Update lead opportunity status
        await db
          .update(leads)
          .set({ opportunityStatus: "enviada", status: "contactado", lastContactAt: new Date(), seenAt: new Date(), updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        // Send email con el enlace de aceptación
        let quoteInstallmentPlan = null;
        if (quote.paymentPlanId) {
          const planInsts = await db.select({
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
          }).from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);
          const firstReq = planInsts.find(i => i.isRequiredForConfirmation) ?? null;
          quoteInstallmentPlan = { firstRequiredAmountCents: firstReq?.amountCents ?? null, installments: planInsts };
        }
        await sendQuoteEmail({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: lead.name,
          clientEmail: lead.email,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl: acceptUrl,
          installmentPlan: quoteInstallmentPlan,
        });

        await logActivity("quote", input.id, "quote_sent", ctx.user.id, ctx.user.name, { email: lead.email, acceptUrl });
        await logActivity("lead", quote.leadId, "quote_sent_to_client", ctx.user.id, ctx.user.name, { quoteId: input.id });

        // Sync URL del presupuesto al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            quoteUrl: acceptUrl,
            quoteNumber: quote.quoteNumber,
            email: lead.email,
            phone: lead.phone,
            credentials: ghlCreds ?? undefined,
          });
        });

        return { success: true, acceptUrl, token };
      }),

    resend: staff
      .input(z.object({
        id: z.number(),
        origin: z.string().url().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Si el presupuesto no tiene token de aceptación, generarlo ahora
        const { randomBytes } = await import("crypto");
        let paymentLinkUrl = quote.paymentLinkUrl;
        if (!paymentLinkUrl || !quote.paymentLinkToken) {
          const token = randomBytes(32).toString("hex");
          const origin = input.origin ?? "https://www.nayadeexperiences.es";
          paymentLinkUrl = `${origin}/presupuesto/${token}`;
          await db.update(quotes).set({
            paymentLinkToken: token,
            paymentLinkUrl,
            updatedAt: new Date(),
          }).where(eq(quotes.id, input.id));
        }

        let resendInstallmentPlan = null;
        if (quote.paymentPlanId) {
          const planInsts = await db.select({
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
          }).from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);
          const firstReq = planInsts.find(i => i.isRequiredForConfirmation) ?? null;
          resendInstallmentPlan = { firstRequiredAmountCents: firstReq?.amountCents ?? null, installments: planInsts };
        }
        await sendQuoteEmail({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: lead.name,
          clientEmail: lead.email,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl,
          installmentPlan: resendInstallmentPlan,
        });
        await logActivity("quote", input.id, "quote_resent", ctx.user.id, ctx.user.name, { paymentLinkUrl });

        // Sync URL del presupuesto regenerado al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            quoteUrl: paymentLinkUrl ?? undefined,
            quoteNumber: quote.quoteNumber,
            email: lead.email,
            phone: lead.phone,
            credentials: ghlCreds ?? undefined,
          });
        });

        return { success: true };
      }),

    duplicate: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [original] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });

        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        const [result] = await db.insert(quotes).values({
          quoteNumber,
          leadId: original.leadId,
          agentId: ctx.user.id,
          title: `${original.title} (copia)`,
          description: original.description,
          items: original.items,
          subtotal: original.subtotal,
          discount: original.discount,
          tax: original.tax,
          total: original.total,
          validUntil: original.validUntil,
          notes: original.notes,
          conditions: original.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const newId = (result as { insertId: number }).insertId;
        await logActivity("quote", newId, "quote_duplicated", ctx.user.id, ctx.user.name, { originalId: input.id });
        return { success: true, quoteId: newId, quoteNumber };
      }),

    markLost: staff
      .input(z.object({ id: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        await db.update(quotes).set({ status: "perdido", updatedAt: new Date() }).where(eq(quotes.id, input.id));
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", status: "perdido", lostReason: input.reason, updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        await logActivity("quote", input.id, "quote_lost", ctx.user.id, ctx.user.name, { reason: input.reason });
        return { success: true };
      }),

    // Called from Redsys webhook or manual confirmation
    confirmPayment: staff
      .input(
        z.object({
          quoteId: z.number(),
          redsysOrderId: z.string().optional(),
          paidAmount: z.number().optional(),
          paymentMethod: z.enum(["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]).optional(),
          tpvOperationNumber: z.string().optional(), // Nº operación TPV (tarjeta)
          paymentNote: z.string().optional(),        // Justificación (efectivo) o nota interna
          transferProofUrl: z.string().optional(),   // URL S3 del justificante de transferencia
          transferProofKey: z.string().optional(),   // Key S3 del justificante de transferencia
          bankMovementId: z.number().optional(),     // Vincular movimiento bancario conciliado
          cardTerminalOperationId: z.number().optional(), // Vincular operación TPV (tarjeta)
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Idempotencia: si el presupuesto ya está pagado, devolver la factura existente sin duplicar
        if (quote.paidAt || quote.status === "aceptado") {
          const [existingInv] = await db.select().from(invoices)
            .where(eq(invoices.quoteId, quote.id))
            .orderBy(invoices.id)
            .limit(1);
          if (existingInv) {
            return {
              success: true,
              invoiceId: existingInv.id,
              invoiceNumber: existingInv.invoiceNumber,
              reservationId: null,
              pdfUrl: existingInv.pdfUrl ?? null,
              reavExpedientId: null,
              reavExpedientNumber: null,
            };
          }
        }

        const now = new Date();

        // Generate invoice
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
        const subtotal = Number(quote.subtotal);
        // Solo líneas general llevan IVA
        const bdInv = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
        const taxAmount = totalTaxAmount(bdInv);
        const taxRate = bdInv.length === 1 ? bdInv[0].rate : 21;
        const total = parseFloat((subtotal + taxAmount).toFixed(2));
        // Generate PDF
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            itemsJson: items,
            subtotal: String(subtotal),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdInv,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("PDF generation failed:", e);
        }
        // Insert invoice record
        // Determinar productId principal desde las líneas del presupuesto
        const mainProductId = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead.experienceId ?? 0;

        const [invResult] = await db.insert(invoices).values({
          invoiceNumber,
          quoteId: quote.id,
          clientName: lead.name,
          clientEmail: lead.email,
          clientPhone: lead.phone,
          itemsJson: items,
          subtotal: String(subtotal),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdInv.length > 0 ? bdInv : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          isAutomatic: false,
          status: "generada",
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // Create reservation
        // BUG #1 FIX: usar la fecha preferida del lead como fecha operativa del servicio
        const serviceDate = lead.preferredDate
          ? new Date(lead.preferredDate).toISOString().split("T")[0]
          : now.toISOString().split("T")[0];
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const reservationNumber = await generateReservationNum("crm:confirmPayment", String(ctx.user.id));
        const [resResult] = await db.insert(reservations).values({
          productId: mainProductId, // FIX: usar el productId principal del presupuesto
          productName: quote.title,
          bookingDate: serviceDate, // BUG #1 FIX: fecha preferida del lead, no hoy
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          statusReservation: "CONFIRMADA",
          statusPayment: "PAGADO",
          // Canal: presupuesto cobrado manualmente por el equipo → siempre ONLINE_ASISTIDO
          channel: "ONLINE_ASISTIDO",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber,
          paymentMethod: input.paymentMethod ?? "efectivo",
          transferProofUrl: input.transferProofUrl ?? null,
          notes: [
            `Generado desde presupuesto ${quote.quoteNumber}`,
            input.tpvOperationNumber ? `Nº operación TPV: ${input.tpvOperationNumber}` : null,
            input.paymentNote ? `Nota: ${input.paymentNote}` : null,
            input.transferProofUrl ? `Justificante transferencia adjunto` : null,
          ].filter(Boolean).join(" — "),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;
        // FIX: Vincular factura ↔ reserva recién creadass
        await db.update(invoices).set({ reservationId, updatedAt: now }).where(eq(invoices.id, invoiceId));
        await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, reservationId));

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "presupuesto",
          leadId: lead.id,
        });

        // Update quote
        await db
          .update(quotes)
          .set({
            status: "aceptado",
            paidAt: now,
            redsysOrderId: input.redsysOrderId,
            invoiceNumber,
            invoicePdfUrl: pdfUrl,
            invoiceGeneratedAt: now,
            updatedAt: now,
          })
          .where(eq(quotes.id, input.quoteId));

        // Update lead
        await db
          .update(leads)
          .set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now })
          .where(eq(leads.id, quote.leadId));

        // Log activity
        await logActivity("quote", quote.id, "payment_confirmed", ctx.user.id, ctx.user.name, { invoiceId, reservationId });
        await logActivity("lead", quote.leadId, "opportunity_won", ctx.user.id, ctx.user.name, { quoteId: quote.id });
        await logActivity("invoice", invoiceId, "invoice_generated", ctx.user.id, ctx.user.name, { pdfUrl });

        // Sync URL de factura al contacto GHL (fire-and-forget)
        getGHLCredentials().then(ghlCreds => {
          syncLeadUrlsToGHL({
            ghlContactId: (lead as any).ghlContactId,
            invoiceUrl: pdfUrl ?? undefined,
            invoiceNumber,
            credentials: ghlCreds ?? undefined,
          });
        });

        // Send emails
        try {
          await sendConfirmationEmail({
            clientName: lead.name,
            clientEmail: lead.email,
            reservationRef,
            quoteTitle: quote.title,
            items,
            total: String(total),
            invoiceUrl: pdfUrl,
            bookingDate: serviceDate ?? undefined,
          });
        } catch (e) {
          console.error("Confirmation email failed:", e);
        }

        try {
          await sendInternalNotification({
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            reservationRef,
            quoteTitle: quote.title,
            total: String(total),
            paidAt: now,
            reservationId,
          });
        } catch (e) {
          console.error("Internal notification failed:", e);
        }

        // ── Crear expediente REAV automáticamente si hay líneas REAV ─────────────
        const reavLines = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientId: number | undefined;
        let reavExpedientNumber: string | undefined;
        if (reavLines.length > 0) {
          try {
            const reavSaleAmount = reavLines.reduce((s, i) => s + i.total, 0);

            // ── P5+P3+P4: calcular por línea con los porcentajes de cada producto ──
            // Cada línea REAV puede tener un producto con porcentajes distintos.
            // Si la config es inválida no se usa fallback 60/40 — se registra la advertencia.
            let totalEstimatedCost = 0;
            let totalEstimatedMargin = 0;
            const configWarnings: string[] = [];

            for (const line of reavLines as any[]) {
              const productId = line.productId ?? (lead as any).experienceId;
              let lineCostePct: number | null = null;
              let lineMargenPct: number | null = null;

              if (productId) {
                const [prod] = await db.select({
                  providerPercent: experiences.providerPercent,
                  agencyMarginPercent: experiences.agencyMarginPercent,
                  fiscalRegime: experiences.fiscalRegime,
                }).from(experiences).where(eq(experiences.id, productId)).limit(1);

                if (prod?.fiscalRegime === "reav") {
                  const errores = validarConfiguracionREAV(prod);
                  if (errores.length === 0) {
                    lineCostePct = parseFloat(String(prod.providerPercent));
                    lineMargenPct = parseFloat(String(prod.agencyMarginPercent));
                  } else {
                    configWarnings.push(`Producto ${productId} (${line.description}): ${errores.join("; ")}`);
                    console.warn(`[confirmPayment] REAV config inválida en producto ${productId}:`, errores);
                  }
                } else if (prod) {
                  configWarnings.push(`Producto ${productId} (${line.description}): fiscalRegime no es "reav" (es "${prod.fiscalRegime}").`);
                }
              } else {
                configWarnings.push(`Línea "${line.description}": sin productId, no se pueden obtener porcentajes REAV.`);
              }

              if (lineCostePct !== null && lineMargenPct !== null) {
                const lineCalc = calcularREAVSimple(line.total, lineCostePct, lineMargenPct);
                totalEstimatedCost += lineCalc.costeProveedor;
                totalEstimatedMargin += lineCalc.margenAgencia;
              } else {
                // Sin config válida: coste y margen estimados quedan en 0 (visible en expediente)
                configWarnings.push(`Línea "${line.description}" (${line.total.toFixed(2)}€): coste/margen estimados no calculados — revisar configuración del producto.`);
              }
            }

            const reavCalc = { costeProveedor: totalEstimatedCost, margenAgencia: totalEstimatedMargin };
            // Obtener datos del cliente del lead
            const clientName = lead.name ?? undefined;
            const clientEmail = lead.email ?? undefined;
            const clientPhone = lead.phone ?? undefined;
            const clientDni = (lead as any).dni ?? undefined;
            const clientAddress = (lead as any).address ?? undefined;
            const reavResult = await createReavExpedient({
              invoiceId,
              reservationId,
              quoteId: quote.id,
              serviceDescription: reavLines.map(i => i.description).join(" | "),
              serviceDate: serviceDate,
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmount),
              providerCostEstimated: String(reavCalc.costeProveedor),
              agencyMarginEstimated: String(reavCalc.margenAgencia),
              // Datos del cliente
              clientName,
              clientEmail,
              clientPhone,
              clientDni,
              clientAddress,
              // Canal y referencia
              channel: "crm",
              sourceRef: invoiceNumber,
              internalNotes: [
                `Expediente creado automáticamente al confirmar pago del presupuesto ${quote.quoteNumber ?? quote.id}.`,
                clientName ? `Cliente: ${clientName}` : null,
                clientEmail ? `Email: ${clientEmail}` : null,
                clientPhone ? `Teléfono: ${clientPhone}` : null,
                clientDni ? `DNI/NIF: ${clientDni}` : null,
                `Factura: ${invoiceNumber}`,
                `Importe REAV: ${reavSaleAmount.toFixed(2)}€`,
                `Agente: ${ctx.user.name ?? ctx.user.email}`,
                configWarnings.length > 0 ? `⚠ REVISAR CONFIGURACIÓN REAV: ${configWarnings.join(" | ")}` : null,
              ].filter(Boolean).join(" · "),
            });
            reavExpedientId = reavResult.id;
            reavExpedientNumber = reavResult.expedientNumber;
            // Adjuntar la factura PDF al expediente (documento del cliente)
            if (pdfUrl && reavExpedientId) {
              await attachReavDocument({
                expedientId: reavExpedientId,
                side: "client",
                docType: "factura_emitida",
                title: `Factura ${invoiceNumber}`,
                fileUrl: pdfUrl,
                mimeType: "application/pdf",
                notes: `Factura generada automáticamente al confirmar pago. Presupuesto: ${quote.quoteNumber ?? quote.id}.`,
                uploadedBy: ctx.user.id,
              });
            }
            // Adjuntar el presupuesto PDF al expediente (documento del cliente)
            if ((quote as any).pdfUrl && reavExpedientId) {
              await attachReavDocument({
                expedientId: reavExpedientId,
                side: "client",
                docType: "otro",
                title: `Presupuesto ${quote.quoteNumber ?? quote.id}`,
                fileUrl: (quote as any).pdfUrl,
                mimeType: "application/pdf",
                notes: `Presupuesto original aceptado por el cliente.`,
                uploadedBy: ctx.user.id,
              });
            }
            await logActivity("invoice", invoiceId, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientId, expedientNumber: reavExpedientNumber });
          } catch (e) {
            console.error("[confirmPayment] Error al crear expediente REAV:", e);
          }
        }

        // ── BUG #2 + #3 FIX: Crear booking operativo + transacción contable ─────────
        try {
          const bdForTx = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
          const taxAmountForTx = totalTaxAmount(bdForTx);
          const generalSubtotalForTx = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
          const reavSubtotalForTx = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
          const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
            : reavSubtotalForTx > 0 ? "reav" : "general";
          await postConfirmOperation({
            reservationId,
            productId: mainProductId, // FIX: usar el productId principal del presupuesto
            productName: quote.title,
            serviceDate,
            people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
            amountCents: Math.round((input.paidAmount ?? total) * 100),
            customerName: lead.name,
            customerEmail: lead.email,
            customerPhone: lead.phone,
            totalAmount: total,
            paymentMethod: input.paymentMethod ?? "otro",
            saleChannel: "crm",
            invoiceNumber,
            reservationRef,
            sellerUserId: ctx.user.id,
            sellerName: ctx.user.name ?? undefined,
            taxBase: generalSubtotalForTx,
            taxAmount: taxAmountForTx,
            reavMargin: reavSubtotalForTx,
            fiscalRegime: fiscalRegimeForTx,
            description: `Pago CRM — ${quote.quoteNumber} — ${lead.name}`,
            quoteId: quote.id,
            sourceChannel: "otro",
            ghlContactId: (lead as any).ghlContactId ?? null,
          });
          await logActivity("reservation", reservationId, "booking_and_transaction_created", ctx.user.id, ctx.user.name, { invoiceNumber, serviceDate });
        } catch (e) {
          console.error("[confirmPayment] Error en postConfirmOperation:", e);
        }

        // ── Conciliación bancaria opcional ──────────────────────────────────────
        if (input.bankMovementId) {
          const [bm] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
          if (bm && bm.conciliationStatus !== "conciliado") {
            await db.insert(bankMovementLinks).values({
              bankMovementId: input.bankMovementId,
              entityType: "quote",
              entityId: input.quoteId,
              linkType: "income_transfer",
              amountLinked: String(total),
              status: "confirmed",
              confidenceScore: 100,
              matchedBy: ctx.user.name ?? undefined,
              matchedAt: now,
            });
            await db.update(bankMovements)
              .set({ conciliationStatus: "conciliado" })
              .where(eq(bankMovements.id, input.bankMovementId));
            await logActivity("quote", input.quoteId, "bank_movement_linked", ctx.user.id, ctx.user.name, {
              bankMovementId: input.bankMovementId,
              amount: total,
            });
          }
        }

        // ── Vinculación operación TPV opcional ──────────────────────────────
        if (input.cardTerminalOperationId) {
          const [tpvOp] = await db.select().from(cardTerminalOperations).where(eq(cardTerminalOperations.id, input.cardTerminalOperationId));
          if (tpvOp && tpvOp.status !== "conciliado") {
            await db.update(cardTerminalOperations).set({
              linkedEntityType: "quote",
              linkedEntityId: input.quoteId,
              linkedAt: now,
              linkedBy: ctx.user.name ?? "admin",
              status: "conciliado",
            }).where(eq(cardTerminalOperations.id, input.cardTerminalOperationId));
            await logActivity("quote", input.quoteId, "tpv_operation_linked", ctx.user.id, ctx.user.name, {
              cardTerminalOperationId: input.cardTerminalOperationId,
              operationNumber: tpvOp.operationNumber,
              amount: total,
            });
          }
        }

        // ── Caja: movimiento automático si pago en efectivo ─────────────────
        if ((input.paymentMethod ?? "efectivo") === "efectivo") {
          try {
            const cashAccountId = await getDefaultCashAccountId();
            if (cashAccountId) {
              await createCashMovementIfNotExists({
                accountId: cashAccountId,
                date: now.toISOString().slice(0, 10),
                type: "income",
                amount: total,
                concept: `Cobro en efectivo ${quote.quoteNumber} — ${lead.name}`,
                relatedEntityType: "reservation",
                relatedEntityId: reservationId,
                createdBy: ctx.user.id,
              });
            }
          } catch (e) {
            console.error("[confirmPayment] Error creando movimiento de caja:", e);
          }
        }

        return { success: true, invoiceId, invoiceNumber, reservationId, pdfUrl, reavExpedientId, reavExpedientNumber };
      }),

    // ─── ESCENARIO B: Convertir a reserva SIN pago previo (admin manual) ──────
    convertToReservation: staff
      .input(z.object({
        quoteId: z.number(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead asociado no encontrado" });

        const now = new Date();
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const total = Number(quote.total);
        const reservationNumberConvert = await generateReservationNum("crm:convertQuote", String(ctx.user.id));

        // Crear reserva CONFIRMADA: el admin siempre confirma al convertir, independientemente del pago
        const [resResult] = await db.insert(reservations).values({
          productId: 0,
          productName: quote.title,
          bookingDate: now.toISOString().split("T")[0],
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: 0,
          status: "pending_payment",         // pago pendiente
          statusReservation: "CONFIRMADA",    // reserva SIEMPRE confirmada por el admin
          statusPayment: "PENDIENTE",          // pago pendiente hasta que se cobre
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber: reservationNumberConvert,
          channel: "ONLINE_ASISTIDO",
          quoteId: input.quoteId,
          quoteSource: "presupuesto",
          notes: input.notes ?? `Convertido manualmente desde presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "presupuesto",
          leadId: lead.id,
        });

        // Actualizar presupuesto: estado aceptado (ganado comercialmente) pero sin factura
        await db.update(quotes).set({
          status: "aceptado",
          updatedAt: now,
        }).where(eq(quotes.id, input.quoteId));

        // Actualizar lead: oportunidad ganada comercialmente
        await db.update(leads).set({
          opportunityStatus: "ganada",
          status: "convertido",
          updatedAt: now,
        }).where(eq(leads.id, quote.leadId));

        await logActivity("quote", quote.id, "converted_to_reservation_manual", ctx.user.id, ctx.user.name, { reservationId, status: "pending_payment" });
        await logActivity("lead", quote.leadId, "opportunity_won_manual", ctx.user.id, ctx.user.name, { quoteId: quote.id });

        return { success: true, reservationId, reservationRef, status: "pending_payment" };
      }),

    // ─── ESCENARIO B: Confirmación manual por transferencia bancaria ──────────
    // Paso 1: Subir el justificante (JPG/PNG/PDF) a S3
    uploadTransferProof: staff
      .input(
        z.object({
          quoteId: z.number(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        })
      )
      .mutation(async ({ input }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/png" ? "png" : "jpg";
        const fileKey = `transfer-proofs/${input.quoteId}-${Date.now()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        await db.update(quotes).set({
          transferProofUrl: url,
          transferProofKey: fileKey,
          updatedAt: new Date(),
        } as Record<string, unknown>).where(eq(quotes.id, input.quoteId));
        return { url, fileKey };
      }),

    // Subir justificante de transferencia sin modificar el presupuesto (para el modal Confirmar Pago)
    uploadProofOnly: staff
      .input(
        z.object({
          quoteId: z.number(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/png" ? "png" : "jpg";
        const fileKey = `transfer-proofs/pay-${input.quoteId}-${Date.now()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        return { url, fileKey };
      }),

    // Paso 2: Confirmar el pago (exige justificante ya subido)
    confirmTransfer: staff
      .input(
        z.object({
          quoteId: z.number(),
          paidAmount: z.number().optional(),
          bankMovementId: z.number().optional(), // FASE 2A: vínculo bancario opcional
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const proofUrl = (quote as Record<string, unknown>).transferProofUrl as string | null;

        // Si se vincula movimiento bancario, el justificante no es obligatorio
        if (!proofUrl && !input.bankMovementId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Debes adjuntar el justificante de transferencia o vincular un movimiento bancario.",
          });
        }

        // Validar movimiento bancario si se proporciona
        if (input.bankMovementId) {
          const [movement] = await db.select().from(bankMovements).where(eq(bankMovements.id, input.bankMovementId));
          if (!movement) throw new TRPCError({ code: "NOT_FOUND", message: "Movimiento bancario no encontrado." });
          if (movement.status === "ignorado") throw new TRPCError({ code: "BAD_REQUEST", message: "El movimiento bancario está marcado como ignorado." });
          if (movement.conciliationStatus === "conciliado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este movimiento bancario ya está conciliado con otro pago." });
          const existingConfirmed = await db.select({ id: bankMovementLinks.id }).from(bankMovementLinks)
            .where(and(eq(bankMovementLinks.bankMovementId, input.bankMovementId), eq(bankMovementLinks.status, "confirmed"))).limit(1);
          if (existingConfirmed.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Este movimiento bancario ya tiene una conciliación confirmada." });
        }
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        // Idempotencia: si ya hay factura para este presupuesto, devolver la existente
        if (quote.paidAt || quote.status === "aceptado") {
          const [existingInvT] = await db.select().from(invoices)
            .where(eq(invoices.quoteId, quote.id))
            .orderBy(invoices.id)
            .limit(1);
          if (existingInvT) {
            return { success: true, invoiceId: existingInvT.id, invoiceNumber: existingInvT.invoiceNumber };
          }
        }

        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
        const subtotal = Number(quote.subtotal);
        // Solo líneas general llevan IVA
        const bdT = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
        const taxAmount = totalTaxAmount(bdT);
        const taxRate = bdT.length === 1 ? bdT[0].rate : 21;
        const total = parseFloat((subtotal + taxAmount).toFixed(2));
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            itemsJson: items,
            subtotal: String(subtotal),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdT,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("PDF generation failed:", e);
        }
        // Determinar productId principal desde las líneas del presupuesto
        const mainProductIdT = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? lead.experienceId ?? 0;

        const [invResult] = await db.insert(invoices).values({
          invoiceNumber,
          quoteId: quote.id,
          clientName: lead.name,
          clientEmail: lead.email,
          clientPhone: lead.phone,
          itemsJson: items,
          subtotal: String(subtotal),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdT.length > 0 ? bdT : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          status: "cobrada",
          paymentMethod: "transferencia",
          transferProofUrl: proofUrl,
          isAutomatic: false,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;
        // BUG #1 FIX (confirmTransfer): usar la fecha preferida del lead como fecha operativa
        const serviceDateTransfer = lead.preferredDate
          ? new Date(lead.preferredDate).toISOString().split("T")[0]
          : now.toISOString().split("T")[0];
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const reservationNumberTransfer = await generateReservationNum("crm:confirmTransfer", String(ctx.user.id));
        const [resResult] = await db.insert(reservations).values({
          productId: mainProductIdT, // FIX: usar el productId principal del presupuesto
          productName: quote.title,
          bookingDate: serviceDateTransfer, // BUG #1 FIX: fecha preferida del lead
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          statusReservation: "CONFIRMADA",
          statusPayment: "PAGADO",
          // Canal: transferencia confirmada manualmente por el equipo → ONLINE_ASISTIDO
          channel: "ONLINE_ASISTIDO",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          reservationNumber: reservationNumberTransfer,
          notes: `Pago por transferencia bancaria confirmado manualmente. Presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // FIX: Vincular factura ↔ reserva recién creadas
        await db.update(invoices).set({ reservationId, updatedAt: now }).where(eq(invoices.id, invoiceId));
        await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, reservationId));

        // Crear/actualizar cliente en el CRM
        await upsertClientFromReservation({
          name: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          source: "transferencia",
          leadId: lead.id,
        });

        await db.update(quotes).set({
          status: "aceptado",
          paidAt: now,
          invoiceNumber,
          invoicePdfUrl: pdfUrl,
          invoiceGeneratedAt: now,
          transferConfirmedAt: now,
          transferConfirmedBy: ctx.user.name,
          paymentMethod: "transferencia",
          updatedAt: now,
        } as Record<string, unknown>).where(eq(quotes.id, input.quoteId));
        await db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, quote.leadId));
        await logActivity("quote", quote.id, "transfer_payment_confirmed", ctx.user.id, ctx.user.name, {
          invoiceId, reservationId, proofUrl, confirmedBy: ctx.user.name,
        });
        await logActivity("lead", quote.leadId, "opportunity_won", ctx.user.id, ctx.user.name, { quoteId: quote.id, method: "transferencia" });
        await logActivity("invoice", invoiceId, "invoice_generated", ctx.user.id, ctx.user.name, { pdfUrl });
        // ── BUG #2 + #3 FIX (confirmTransfer): Crear booking operativo + transacción contable ────
        try {
          const generalSubtotalT = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
          const reavSubtotalT = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
          const taxAmountT = totalTaxAmount(groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav")));
          const fiscalRegimeT = reavSubtotalT > 0 && generalSubtotalT > 0 ? "mixed"
            : reavSubtotalT > 0 ? "reav" : "general";
          await postConfirmOperation({
            reservationId,
            productId: mainProductIdT, // FIX: usar el productId principal del presupuesto
            productName: quote.title,
            serviceDate: serviceDateTransfer,
            people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
            amountCents: Math.round((input.paidAmount ?? total) * 100),
            customerName: lead.name,
            customerEmail: lead.email,
            customerPhone: lead.phone,
            totalAmount: total,
            paymentMethod: "transferencia",
            saleChannel: "crm",
            invoiceNumber,
            reservationRef,
            sellerUserId: ctx.user.id,
            sellerName: ctx.user.name ?? undefined,
            taxBase: generalSubtotalT,
            taxAmount: taxAmountT,
            reavMargin: reavSubtotalT,
            fiscalRegime: fiscalRegimeT,
            description: `Transferencia CRM — ${quote.quoteNumber} — ${lead.name}`,
            quoteId: quote.id,
            sourceChannel: "transferencia",
            ghlContactId: (lead as any).ghlContactId ?? null,
          });
        } catch (e) { console.error("[confirmTransfer] Error en postConfirmOperation:", e); }
        try {
          await sendTransferConfirmationEmail({
            clientName: lead.name,
            clientEmail: lead.email,
            invoiceNumber,
            reservationRef,
            quoteTitle: quote.title,
            quoteNumber: quote.quoteNumber ?? undefined,
            items,
            subtotal: String(subtotal),
            taxAmount: String(taxAmount),
            total: String(total),
            invoiceUrl: pdfUrl ?? undefined,
            confirmedBy: ctx.user.name ?? undefined,
            confirmedAt: now,
          });
        } catch (e) { console.error("Transfer confirmation email failed:", e); }
        try {
          await sendInternalNotification({
            clientName: lead.name,
            clientEmail: lead.email,
            clientPhone: lead.phone,
            reservationRef,
            quoteTitle: quote.title,
            total: String(total),
            paidAt: now,
            reservationId,
          });
        } catch (e) { console.error("Internal notification failed:", e); }

        // ── Crear expediente REAV automáticamente si hay líneas REAV ─────────────
        const reavLinesTransfer = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientIdT: number | undefined;
        let reavExpedientNumberT: string | undefined;
        if (reavLinesTransfer.length > 0) {
          try {
            const reavSaleAmountT = reavLinesTransfer.reduce((s, i) => s + i.total, 0);
            // ── Obtener porcentajes REAV desde el producto (origen único de verdad) ──
            let reavCostePctT = 60; // fallback conservador
            let reavMargenPctT = 40;
            const firstReavLineT = reavLinesTransfer[0] as any;
            const reavProductIdT = firstReavLineT?.productId ?? (lead as any).experienceId;
            if (reavProductIdT) {
              const [reavProductT] = await db.select({
                providerPercent: experiences.providerPercent,
                agencyMarginPercent: experiences.agencyMarginPercent,
                fiscalRegime: experiences.fiscalRegime,
              }).from(experiences).where(eq(experiences.id, reavProductIdT)).limit(1);
              if (reavProductT && reavProductT.fiscalRegime === "reav") {
                const erroresT = validarConfiguracionREAV(reavProductT);
                if (erroresT.length === 0) {
                  reavCostePctT = parseFloat(String(reavProductT.providerPercent ?? 60));
                  reavMargenPctT = parseFloat(String(reavProductT.agencyMarginPercent ?? 40));
                } else {
                  console.warn("[confirmTransfer] Configuración REAV inválida, usando fallback 60/40:", erroresT);
                }
              }
            }
            const reavCalcT = calcularREAVSimple(reavSaleAmountT, reavCostePctT, reavMargenPctT);
            const clientNameT = lead.name ?? undefined;
            const clientEmailT = lead.email ?? undefined;
            const clientPhoneT = lead.phone ?? undefined;
            const clientDniT = (lead as any).dni ?? undefined;
            const clientAddressT = (lead as any).address ?? undefined;
            const reavResultT = await createReavExpedient({
              invoiceId,
              reservationId,
              quoteId: quote.id,
              serviceDescription: reavLinesTransfer.map(i => i.description).join(" | "),
              serviceDate: serviceDateTransfer,
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmountT),
              providerCostEstimated: String(reavCalcT.costeProveedor),
              agencyMarginEstimated: String(reavCalcT.margenAgencia),
              clientName: clientNameT,
              clientEmail: clientEmailT,
              clientPhone: clientPhoneT,
              clientDni: clientDniT,
              clientAddress: clientAddressT,
              channel: "crm",
              sourceRef: invoiceNumber,
              internalNotes: [
                `Expediente creado automáticamente al confirmar transferencia del presupuesto ${quote.quoteNumber ?? quote.id}.`,
                clientNameT ? `Cliente: ${clientNameT}` : null,
                clientEmailT ? `Email: ${clientEmailT}` : null,
                clientPhoneT ? `Teléfono: ${clientPhoneT}` : null,
                clientDniT ? `DNI/NIF: ${clientDniT}` : null,
                `Factura: ${invoiceNumber}`,
                `Importe REAV: ${reavSaleAmountT.toFixed(2)}€`,
                `Agente: ${ctx.user.name ?? ctx.user.email}`,
              ].filter(Boolean).join(" · "),
            });
            reavExpedientIdT = reavResultT.id;
            reavExpedientNumberT = reavResultT.expedientNumber;
            // Adjuntar la factura PDF al expediente
            if (pdfUrl && reavExpedientIdT) {
              await attachReavDocument({
                expedientId: reavExpedientIdT,
                side: "client",
                docType: "factura_emitida",
                title: `Factura ${invoiceNumber}`,
                fileUrl: pdfUrl,
                mimeType: "application/pdf",
                notes: `Factura generada al confirmar transferencia. Presupuesto: ${quote.quoteNumber ?? quote.id}.`,
                uploadedBy: ctx.user.id,
              });
            }
            if ((quote as any).pdfUrl && reavExpedientIdT) {
              await attachReavDocument({
                expedientId: reavExpedientIdT,
                side: "client",
                docType: "otro",
                title: `Presupuesto ${quote.quoteNumber ?? quote.id}`,
                fileUrl: (quote as any).pdfUrl,
                mimeType: "application/pdf",
                notes: `Presupuesto original aceptado por el cliente (pago por transferencia).`,
                uploadedBy: ctx.user.id,
              });
            }
            await logActivity("invoice", invoiceId, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientIdT, expedientNumber: reavExpedientNumberT });
          } catch (e) {
            console.error("[confirmTransfer] Error al crear expediente REAV:", e);
          }
        }

        // FASE 2A: crear vínculo bancario y marcar movimiento como conciliado
        if (input.bankMovementId) {
          try {
            const now2 = new Date();
            await db.insert(bankMovementLinks).values({
              bankMovementId: input.bankMovementId,
              entityType: "quote",
              entityId: input.quoteId,
              linkType: "income_transfer",
              amountLinked: String(total),
              status: "confirmed",
              confidenceScore: 100,
              matchedBy: ctx.user.name ?? undefined,
              matchedAt: now2,
            });
            await db.update(bankMovements)
              .set({ conciliationStatus: "conciliado" })
              .where(eq(bankMovements.id, input.bankMovementId));
            await logActivity("quote", input.quoteId, "bank_movement_linked", ctx.user.id, ctx.user.name, {
              bankMovementId: input.bankMovementId, invoiceId, invoiceNumber,
            });
          } catch (e) {
            console.error("[confirmTransfer] Error al crear vínculo bancario:", e);
          }
        }

        return { success: true, invoiceId, invoiceNumber, reservationId, pdfUrl, reavExpedientId: reavExpedientIdT, reavExpedientNumber: reavExpedientNumberT };
      }),


    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        // Borrar actividad e invoices relacionadas
        await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.id)));
        await db.delete(invoices).where(eq(invoices.quoteId, input.id));
        await db.delete(quotes).where(eq(quotes.id, input.id));
        // Si el lead asociado no tiene más presupuestos, volver a estado "nueva"
        if (quote.leadId) {
          const remaining = await db.select({ cnt: count() }).from(quotes).where(eq(quotes.leadId, quote.leadId));
          if ((remaining[0]?.cnt ?? 0) === 0) {
            await db.update(leads).set({ opportunityStatus: "nueva", status: "nuevo", updatedAt: new Date() }).where(eq(leads.id, quote.leadId));
          }
        }
        return { success: true };
      }),

    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        for (const id of input.ids) {
          await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, id)));
          await db.delete(invoices).where(eq(invoices.quoteId, id));
        }
        await db.delete(quotes).where(inArray(quotes.id, input.ids));
        return { deleted: input.ids.length };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado", "perdido"]),
      }))
      .mutation(async ({ input }) => {
        await db.update(quotes).set({ status: input.status, updatedAt: new Date() }).where(inArray(quotes.id, input.ids));
        return { updated: input.ids.length };
      }),

    generatePdf: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        // Fetch quote + lead data
        const rows = await db
          .select({
            id: quotes.id,
            quoteNumber: quotes.quoteNumber,
            title: quotes.title,
            status: quotes.status,
            total: quotes.total,
            subtotal: quotes.subtotal,
            discount: quotes.discount,
            tax: quotes.tax,
            items: quotes.items,
            validUntil: quotes.validUntil,
            notes: quotes.notes,
            conditions: quotes.conditions,
            paymentLinkUrl: quotes.paymentLinkUrl,
            createdAt: quotes.createdAt,
            clientName: leads.name,
            clientEmail: leads.email,
            clientPhone: leads.phone,
            clientCompany: leads.company,
          })
          .from(quotes)
          .leftJoin(leads, eq(quotes.leadId, leads.id))
          .where(eq(quotes.id, input.id));

        const quote = rows[0];
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

        const items: { description: string; quantity: number; unitPrice: number; total: number }[] =
          Array.isArray(quote.items) ? quote.items as { description: string; quantity: number; unitPrice: number; total: number }[] : JSON.parse((quote.items as unknown as string) ?? "[]");

        // Obtener datos de empresa facturadora
        const legalQ = await getLegalCompanySettings();

        const html = buildQuotePdfHtml({
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          clientName: quote.clientName ?? "",
          clientEmail: quote.clientEmail ?? "",
          clientPhone: quote.clientPhone,
          clientCompany: quote.clientCompany,
          items,
          subtotal: quote.subtotal,
          discount: quote.discount,
          tax: quote.tax,
          total: quote.total,
          validUntil: quote.validUntil,
          notes: quote.notes,
          conditions: quote.conditions,
          paymentLinkUrl: quote.paymentLinkUrl,
          createdAt: quote.createdAt,
          issuerName: legalQ.name,
          issuerCif: legalQ.cif,
          issuerAddress: `${legalQ.address}, ${legalQ.zip} ${legalQ.city} (${legalQ.province})`,
        });

        // Generar PDF con puppeteer-core (funciona en producción desplegada)
        const ts = Date.now();
        try {
          const pdfBuffer = await htmlToPdf(html);
          const key = `quotes/${quote.quoteNumber}-${ts}.pdf`;
          const { url } = await storagePut(key, pdfBuffer, "application/pdf");
          return {
            success: true,
            pdfUrl: url,
            filename: `Presupuesto-${quote.quoteNumber}.pdf`,
          };
        } catch (pdfErr) {
          console.error("[PDF] Error generando presupuesto PDF, guardando HTML como fallback:", pdfErr);
          // Fallback: guardar HTML
          const key = `quotes/${quote.quoteNumber}-${ts}.html`;
          const { url } = await storagePut(key, Buffer.from(html), "text/html");
          return {
            success: true,
            pdfUrl: url,
            filename: `Presupuesto-${quote.quoteNumber}.html`,
          };
        }
      }),

    // ─── CREAR PRESUPUESTO DIRECTO (sin lead previo) ─────────────────────────
    createDirect: staff
      .input(
        z.object({
          // Datos del cliente
          clientName: z.string().min(1),
          clientEmail: z.string().email(),
          clientPhone: z.string().optional(),
          clientCompany: z.string().optional(),
          // Datos del presupuesto
          title: z.string().min(1),
          description: z.string().optional(),
          items: z.array(
            z.object({
              description: z.string(),
              quantity: z.number(),
              unitPrice: z.number(),
              total: z.number(),
              fiscalRegime: z.enum(["reav", "general"]).optional(),
              taxRate: z.number().optional(),
              productId: z.number().optional(),
            })
          ),
          subtotal: z.number(),
          discount: z.number().default(0),
          taxRate: z.number().default(21),
          total: z.number(),
          validUntil: z.string().optional(),
          notes: z.string().optional(),
          conditions: z.string().optional(),
          sendNow: z.boolean().default(false),
          origin: z.string().url().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // 1. Resolver leadId: lead existente → cliente existente con lead → crear lead nuevo
        let leadId: number;
        const [existingLead] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(eq(leads.email, input.clientEmail))
          .orderBy(desc(leads.createdAt))
          .limit(1);

        if (existingLead) {
          leadId = existingLead.id;
        } else {
          // Sin lead — buscar cliente existente que ya tenga leadId (p.ej. vino por reserva)
          const [existingClient] = await db
            .select({ leadId: clients.leadId })
            .from(clients)
            .where(eq(clients.email, input.clientEmail))
            .limit(1);

          if (existingClient?.leadId) {
            leadId = existingClient.leadId;
          } else {
            // Cliente nuevo sin historial — crear lead silencioso
            const [leadResult] = await db.insert(leads).values({
              name: input.clientName,
              email: input.clientEmail,
              phone: input.clientPhone ?? "",
              company: input.clientCompany ?? "",
              source: "presupuesto_directo",
              status: "en_proceso",
              opportunityStatus: "nueva",
              priority: "media",
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            leadId = (leadResult as { insertId: number }).insertId;
            await logActivity("lead", leadId, "lead_created_from_quote", ctx.user.id, ctx.user.name, { name: input.clientName });
          }
        }

        // 2. Upsert de cliente — nunca sobreescribe leadId si ya tiene uno válido
        try {
          await db.insert(clients).values({
            leadId,
            source: "presupuesto_directo",
            name: input.clientName,
            email: input.clientEmail,
            phone: input.clientPhone ?? "",
            company: input.clientCompany ?? "",
            tags: [],
            isConverted: false,
            totalBookings: 0,
          }).onDuplicateKeyUpdate({
            set: {
              leadId: sql`IF(${clients.leadId} IS NULL, ${leadId}, ${clients.leadId})`,
              name: sql`IF(TRIM(${clients.name}) = '' OR ${clients.name} IS NULL, ${input.clientName}, ${clients.name})`,
              phone: sql`IF(TRIM(${clients.phone}) = '' OR ${clients.phone} IS NULL, ${input.clientPhone ?? ''}, ${clients.phone})`,
              company: sql`IF(TRIM(${clients.company}) = '' OR ${clients.company} IS NULL, ${input.clientCompany ?? ''}, ${clients.company})`,
              updatedAt: new Date(),
            },
          });
        } catch (e) {
          console.warn("[createDirect] No se pudo crear/vincular cliente:", e);
        }

        // 3. Crear el presupuesto
        const quoteNumber = await generateQuoteNumber("crm:createQuote", String(ctx.user.id));
        const taxAmount = (input.subtotal - input.discount) * (input.taxRate / 100);

        const [quoteResult] = await db.insert(quotes).values({
          quoteNumber,
          leadId,
          agentId: ctx.user.id,
          title: input.title,
          description: input.description,
          items: input.items,
          subtotal: String(input.subtotal),
          discount: String(input.discount),
          tax: String(taxAmount),
          total: String(input.total),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          notes: input.notes,
          conditions: input.conditions,
          status: "borrador",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const quoteId = (quoteResult as { insertId: number }).insertId;

        await logActivity("quote", quoteId, "quote_created_direct", ctx.user.id, ctx.user.name, { leadId, quoteNumber });

        // 4. Enviar inmediatamente si se solicita
        if (input.sendNow) {
          // Generar token de aceptación SIEMPRE antes de enviar el email
          const { randomBytes } = await import("crypto");
          const token = randomBytes(32).toString("hex");
          const origin = input.origin ?? "https://www.nayadeexperiences.es";
          const acceptUrl = `${origin}/presupuesto/${token}`;

          await db.update(quotes).set({
            status: "enviado",
            sentAt: new Date(),
            paymentLinkToken: token,
            paymentLinkUrl: acceptUrl,
            updatedAt: new Date(),
          }).where(eq(quotes.id, quoteId));
          await db.update(leads).set({ opportunityStatus: "enviada", status: "contactado", lastContactAt: new Date(), seenAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
          await sendQuoteEmail({
            quoteNumber,
            title: input.title,
            clientName: input.clientName,
            clientEmail: input.clientEmail,
            items: input.items,
            subtotal: String(input.subtotal),
            discount: String(input.discount),
            tax: String(taxAmount),
            total: String(input.total),
            validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
            notes: input.notes,
            conditions: input.conditions,
            paymentLinkUrl: acceptUrl,
          });
          await logActivity("quote", quoteId, "quote_sent", ctx.user.id, ctx.user.name, { email: input.clientEmail, acceptUrl });

          // Sync GHL: crear contacto si no existe, luego sincronizar URL del presupuesto
          getGHLCredentials().then(async (ghlCreds) => {
            if (!ghlCreds) return;
            try {
              // Leer el lead para saber si ya tiene ghlContactId
              const [lead] = await db.select({ ghlContactId: (leads as any).ghlContactId })
                .from(leads).where(eq(leads.id, leadId)).limit(1);
              let ghlContactId: string | null = (lead as any)?.ghlContactId ?? null;

              // Si no tiene contacto en GHL, crearlo ahora
              if (!ghlContactId) {
                ghlContactId = await createGHLContact(
                  {
                    name: input.clientName,
                    email: input.clientEmail,
                    phone: input.clientPhone,
                    companyName: input.clientCompany,
                    tags: getGHLTagsFromSource("presupuesto_directo"),
                    notes: `[Lead #${leadId}] Presupuesto directo ${quoteNumber}`,
                  },
                  ghlCreds,
                );
                if (ghlContactId) {
                  await db.update(leads)
                    .set({ ghlContactId, updatedAt: new Date() } as any)
                    .where(eq(leads.id, leadId));
                }
              }

              // Sincronizar URL del presupuesto al contacto GHL
              syncLeadUrlsToGHL({
                ghlContactId,
                quoteUrl: acceptUrl,
                quoteNumber,
                email: input.clientEmail,
                phone: input.clientPhone,
                credentials: ghlCreds,
              });
            } catch (err: any) {
              console.error("[createDirect] Error sync GHL:", err?.message);
            }
          });
        }

        return { success: true, quoteId, quoteNumber, leadId, sent: input.sendNow };
      }),

    // ─── FLUJO PÚBLICO: Aceptación de presupuesto por token ─────────────────────

    /**
     * Carga un presupuesto por su paymentLinkToken.
     * Endpoint público — no requiere autenticación.
     * Registra viewedAt y actualiza status a 'visualizado' si era 'enviado'.
     */
    getByToken: publicProcedure
      .input(z.object({ token: z.string().min(10) }))
      .query(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado o enlace inválido" });

        // Marcar como visualizado si llega por primera vez (solo desde "enviado")
        // Si ya está en pago_fallido o estados posteriores, no se degrada el estado
        if (quote.status === "enviado") {
          await db
            .update(quotes)
            .set({ status: "visualizado", viewedAt: new Date(), updatedAt: new Date() })
            .where(eq(quotes.id, quote.id));
          await logActivity("quote", quote.id, "quote_viewed_by_client", null, null, { token: input.token });
        } else if (!quote.viewedAt) {
          // Garantizar viewedAt aunque el estado ya haya avanzado
          await db.update(quotes).set({ viewedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));
        }

        // Obtener datos del lead/cliente
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);

        // Verificar si ha expirado
        const isExpired = quote.validUntil && new Date(quote.validUntil) < new Date();
        const isPaid = !!quote.paidAt;
        const isRejected = quote.status === "rechazado";

        // Cargar plan de pagos si existe
        let installmentPlan: {
          planId: number;
          firstRequiredAmountCents: number | null;
          installments: {
            id: number;
            installmentNumber: number;
            amountCents: number;
            dueDate: string;
            status: string;
            isRequiredForConfirmation: boolean;
          }[];
        } | null = null;

        if (quote.paymentPlanId) {
          const planInstallments = await db
            .select({
              id: paymentInstallments.id,
              installmentNumber: paymentInstallments.installmentNumber,
              amountCents: paymentInstallments.amountCents,
              dueDate: paymentInstallments.dueDate,
              status: paymentInstallments.status,
              isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
            })
            .from(paymentInstallments)
            .where(eq(paymentInstallments.quoteId, quote.id))
            .orderBy(paymentInstallments.installmentNumber);

          const firstRequired = planInstallments.find(
            (i) => i.isRequiredForConfirmation && i.status === "pending"
          ) ?? planInstallments.find((i) => i.isRequiredForConfirmation) ?? null;

          installmentPlan = {
            planId: quote.paymentPlanId,
            firstRequiredAmountCents: firstRequired?.amountCents ?? null,
            installments: planInstallments,
          };
        }

        return {
          id: quote.id,
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          items: (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
          subtotal: quote.subtotal,
          discount: quote.discount ?? "0",
          tax: quote.tax ?? "0",
          total: quote.total,
          currency: quote.currency,
          validUntil: quote.validUntil,
          status: quote.status,
          notes: quote.notes,
          conditions: quote.conditions,
          isExpired: !!isExpired,
          isPaid,
          isRejected,
          clientName: lead?.name ?? "",
          clientEmail: lead?.email ?? "",
          clientPhone: lead?.phone ?? "",
          invoicePdfUrl: quote.invoicePdfUrl,
          invoiceNumber: quote.invoiceNumber,
          installmentPlan,
        };
      }),

    /**
     * El cliente rechaza el presupuesto desde el enlace.
     */
    rejectByToken: publicProcedure
      .input(z.object({ token: z.string().min(10), reason: z.string().max(500).optional() }))
      .mutation(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya ha sido pagado" });
        if (quote.status === "rechazado") return { success: true };

        await db
          .update(quotes)
          .set({ status: "rechazado", updatedAt: new Date() })
          .where(eq(quotes.id, quote.id));
        await db
          .update(leads)
          .set({ opportunityStatus: "perdida", updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));
        await logActivity("quote", quote.id, "quote_rejected_by_client", null, null, { reason: input.reason });
        return { success: true };
      }),

    /**
     * Inicia el pago Redsys para un presupuesto por token.
     * Los precios están CONGELADOS — se usan los del presupuesto, nunca los del catálogo.
     * Devuelve el formulario Redsys para que el frontend lo envíe.
     */
    payWithToken: publicProcedure
      .input(z.object({
        token: z.string().min(10),
        origin: z.string().url(),
        // El cliente puede ajustar datos de contacto antes de pagar
        customerName: z.string().min(2).optional(),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const [quote] = await db
          .select()
          .from(quotes)
          .where(eq(quotes.paymentLinkToken, input.token))
          .limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya ha sido pagado" });
        if (quote.status === "rechazado") throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto fue rechazado" });
        if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ha expirado" });
        }

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente no encontrado" });

        // Garantizar viewedAt: si el cliente llega a iniciar el pago, definitivamente vio el presupuesto
        if (!quote.viewedAt) {
          await db.update(quotes).set({ viewedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));
        }

        // Precios CONGELADOS del presupuesto — nunca recalculados
        const totalEuros = Number(quote.total);
        if (!(totalEuros > 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `El presupuesto tiene un importe inválido (${quote.total}). Contacta con el equipo.` });
        }

        // Si hay plan de pagos, cobrar la siguiente cuota pendiente:
        // 1º prioridad: cuotas requeridas para confirmar reserva
        // 2º prioridad: cualquier cuota pendiente (cuotas posteriores a la confirmación)
        let amountCents = Math.round(totalEuros * 100);
        let firstRequiredInstallment: { id: number; amountCents: number; installmentNumber: number } | null = null;

        if (quote.paymentPlanId) {
          // Buscar primera cuota requerida pendiente
          const [requiredInst] = await db
            .select({ id: paymentInstallments.id, amountCents: paymentInstallments.amountCents, installmentNumber: paymentInstallments.installmentNumber })
            .from(paymentInstallments)
            .where(and(
              eq(paymentInstallments.quoteId, quote.id),
              eq(paymentInstallments.isRequiredForConfirmation, true),
              eq(paymentInstallments.status, "pending"),
            ))
            .orderBy(paymentInstallments.installmentNumber)
            .limit(1);

          if (requiredInst) {
            firstRequiredInstallment = requiredInst;
            amountCents = requiredInst.amountCents;
          } else {
            // No quedan requeridas — buscar la próxima cuota pendiente (plan en curso)
            const [nextInst] = await db
              .select({ id: paymentInstallments.id, amountCents: paymentInstallments.amountCents, installmentNumber: paymentInstallments.installmentNumber })
              .from(paymentInstallments)
              .where(and(
                eq(paymentInstallments.quoteId, quote.id),
                eq(paymentInstallments.status, "pending"),
              ))
              .orderBy(paymentInstallments.installmentNumber)
              .limit(1);
            if (!nextInst) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "No hay cuotas pendientes de pago. El plan está completamente cobrado." });
            }
            firstRequiredInstallment = nextInst;
            amountCents = nextInst.amountCents;
          }
        }

        const customerName = input.customerName ?? lead.name;
        const customerEmail = input.customerEmail ?? lead.email ?? "";
        const customerPhone = input.customerPhone ?? lead.phone ?? "";

        // Reutilizar reserva pending_payment existente si el presupuesto ya fue convertido
        // o si el pago anterior falló y el cliente reintenta con una nueva tarjeta.
        if ((quote.status === "convertido_carrito" || quote.status === "pago_fallido") && quote.redsysOrderId) {
          const [existingReservation] = await db
            .select()
            .from(reservations)
            .where(and(eq(reservations.quoteId, quote.id), eq(reservations.status, "pending_payment")))
            .limit(1);

          if (existingReservation) {
            const redsysForm = buildRedsysForm({
              amount: amountCents,
              merchantOrder: existingReservation.merchantOrder,
              productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
              notifyUrl: `${process.env.APP_URL}/api/redsys/notification`,
              okUrl: `${process.env.APP_URL}/reserva/ok?order=${existingReservation.merchantOrder}`,
              koUrl: `${process.env.APP_URL}/reserva/error?order=${existingReservation.merchantOrder}`,
              holderName: customerName,
            });
            return {
              merchantOrder: existingReservation.merchantOrder,
              amountCents,
              amountEuros: totalEuros,
              quoteTitle: quote.title,
              redsysForm,
            };
          }
        }

        // Generar merchantOrder único para Redsys (máx 12 chars)
        const merchantOrder = generateMerchantOrder();

        // Guardar pre-reserva con estado pending_payment
        const reservationNumberLink = await generateReservationNum("crm:paymentLink", "system");

        const [resResult] = await db.insert(reservations).values({
          productId: 0,
          productName: quote.title,
          bookingDate: new Date().toISOString().split("T")[0],
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: amountCents,
          amountPaid: 0,
          status: "pending_payment",
          customerName,
          customerEmail,
          customerPhone,
          merchantOrder,
          reservationNumber: reservationNumberLink,
          notes: `Pago desde enlace de presupuesto ${quote.quoteNumber}`,
          quoteId: quote.id,
          quoteSource: "presupuesto",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // Actualizar quote: solo cambiar a convertido_carrito si aún no está confirmado (aceptado)
        // Un quote "aceptado" ya pasó la Fase 1 — no debe degradarse de estado
        await db
          .update(quotes)
          .set({
            ...(quote.status !== "aceptado" ? { status: "convertido_carrito" as const, acceptedAt: new Date() } : {}),
            redsysOrderId: merchantOrder,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, quote.id));

        // Vincular la reserva a la cuota del plan de pagos
        if (firstRequiredInstallment) {
          await db
            .update(paymentInstallments)
            .set({ reservationId, merchantOrder, updatedAt: new Date() })
            .where(eq(paymentInstallments.id, firstRequiredInstallment.id));
        }

        await logActivity("quote", quote.id, "payment_initiated", null, null, {
          merchantOrder,
          reservationId,
          installmentId: firstRequiredInstallment?.id ?? null,
          installmentNumber: firstRequiredInstallment?.installmentNumber ?? null,
        });

        // Construir formulario Redsys
        const redsysForm = buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
          notifyUrl: `${process.env.APP_URL}/api/redsys/notification`,
          okUrl: `${process.env.APP_URL}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${process.env.APP_URL}/reserva/error?order=${merchantOrder}`,
          holderName: customerName,
        });

        return {
          merchantOrder,
          amountCents,
          amountEuros: totalEuros,
          quoteTitle: quote.title,
          redsysForm,
        };
      }),
  }),

  // ─── PLANES DE PAGO FRACCIONADO ──────────────────────────────────────────────
  // Estos procedimientos son NUEVOS y no tocan ningún flujo existente de pago.
  // El flujo de pago completo clásico sigue intacto si paymentPlanId === null.

  paymentPlans: router({

    // Crear o reemplazar el plan de pagos de un presupuesto
    // Solo permitido si el presupuesto NO tiene cuotas ya pagadas
    upsert: staff
      .input(z.object({
        quoteId: z.number(),
        installments: z.array(z.object({
          installmentNumber: z.number().int().min(1),
          amountCents: z.number().int().min(1),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
          isRequiredForConfirmation: z.boolean(),
          notes: z.string().optional(),
        })).min(1).max(24),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

        // No permitir si el presupuesto ya está completamente pagado (plan finalizado)
        if (quote.paidAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede modificar el plan de un presupuesto ya cerrado (todas las cuotas cobradas)" });
        }

        // Si ya existe plan, verificar que no haya cuotas pagadas
        if (quote.paymentPlanId) {
          const paidInstallments = await db
            .select({ id: paymentInstallments.id })
            .from(paymentInstallments)
            .where(and(
              eq(paymentInstallments.planId, quote.paymentPlanId),
              eq(paymentInstallments.status, "paid")
            ))
            .limit(1);
          if (paidInstallments.length > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede modificar el plan porque ya hay cuotas pagadas. Crea un nuevo presupuesto si necesitas reestructurar." });
          }
          // Borrar cuotas pendientes del plan anterior
          await db.delete(paymentInstallments).where(eq(paymentInstallments.planId, quote.paymentPlanId));
          await db.delete(paymentPlans).where(eq(paymentPlans.id, quote.paymentPlanId));
        }

        // Validar que la suma de cuotas == total del presupuesto (tolerancia ±1 céntimo por redondeo)
        const totalQuoteCents = Math.round(Number(quote.total) * 100);
        const sumInstallments = input.installments.reduce((s, i) => s + i.amountCents, 0);
        if (Math.abs(sumInstallments - totalQuoteCents) > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `La suma de las cuotas (${(sumInstallments / 100).toFixed(2)}€) no coincide con el total del presupuesto (${(totalQuoteCents / 100).toFixed(2)}€)`,
          });
        }

        // Validar que al menos una cuota esté marcada como obligatoria para confirmar
        const hasRequired = input.installments.some(i => i.isRequiredForConfirmation);
        if (!hasRequired) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Al menos una cuota debe ser obligatoria para confirmar la reserva" });
        }

        // Crear plan
        const [planResult] = await db.insert(paymentPlans).values({
          quoteId: input.quoteId,
          planType: "installment",
          totalAmountCents: totalQuoteCents,
          createdBy: ctx.user.id,
        });
        const planId = (planResult as { insertId: number }).insertId;

        // Crear cuotas
        for (const inst of input.installments) {
          await db.insert(paymentInstallments).values({
            planId,
            quoteId: input.quoteId,
            installmentNumber: inst.installmentNumber,
            amountCents: inst.amountCents,
            dueDate: inst.dueDate,
            isRequiredForConfirmation: inst.isRequiredForConfirmation,
            notes: inst.notes ?? null,
            status: "pending",
          });
        }

        // Vincular plan al presupuesto
        await db.update(quotes).set({ paymentPlanId: planId, updatedAt: new Date() }).where(eq(quotes.id, input.quoteId));

        await logActivity("quote", input.quoteId, "payment_plan_created", ctx.user.id, ctx.user.name, {
          planId,
          installmentsCount: input.installments.length,
          totalCents: totalQuoteCents,
        });

        return { success: true, planId, installmentsCount: input.installments.length };
      }),

    // Obtener el plan de pagos de un presupuesto
    get: staff
      .input(z.object({ quoteId: z.number() }))
      .query(async ({ input }) => {
        const [quote] = await db.select({ paymentPlanId: quotes.paymentPlanId, total: quotes.total })
          .from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote || !quote.paymentPlanId) return null;

        const [plan] = await db.select().from(paymentPlans)
          .where(eq(paymentPlans.id, quote.paymentPlanId)).limit(1);
        if (!plan) return null;

        const installments = await db.select().from(paymentInstallments)
          .where(eq(paymentInstallments.planId, plan.id))
          .orderBy(paymentInstallments.installmentNumber);

        return { plan, installments };
      }),

    // Eliminar plan (solo si no hay cuotas pagadas)
    delete: staff
      .input(z.object({ quoteId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote || !quote.paymentPlanId) throw new TRPCError({ code: "NOT_FOUND", message: "No hay plan de pagos para este presupuesto" });

        const paidInstallments = await db
          .select({ id: paymentInstallments.id })
          .from(paymentInstallments)
          .where(and(eq(paymentInstallments.planId, quote.paymentPlanId), eq(paymentInstallments.status, "paid")))
          .limit(1);
        if (paidInstallments.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede eliminar el plan porque hay cuotas ya pagadas" });
        }

        await db.delete(paymentInstallments).where(eq(paymentInstallments.planId, quote.paymentPlanId));
        await db.delete(paymentPlans).where(eq(paymentPlans.id, quote.paymentPlanId));
        await db.update(quotes).set({ paymentPlanId: null, updatedAt: new Date() }).where(eq(quotes.id, input.quoteId));

        await logActivity("quote", input.quoteId, "payment_plan_deleted", ctx.user.id, ctx.user.name, {});
        return { success: true };
      }),

    // Confirmar pago de una cuota manualmente (efectivo / transferencia / tarjeta presencial)
    confirmInstallment: staff
      .input(z.object({
        installmentId: z.number(),
        paymentMethod: z.enum(["efectivo", "transferencia", "tarjeta_fisica"]),
        paymentNote: z.string().optional(),
        tpvOperationNumber: z.string().optional(),
        transferProofUrl: z.string().optional(),
        transferProofKey: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [inst] = await db.select().from(paymentInstallments)
          .where(eq(paymentInstallments.id, input.installmentId)).limit(1);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Cuota no encontrada" });
        if (inst.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta cuota ya está pagada" });
        if (inst.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta cuota está cancelada" });

        const now = new Date();
        await db.update(paymentInstallments).set({
          status: "paid",
          paymentMethod: input.paymentMethod,
          paidAt: now,
          paidBy: `admin:${ctx.user.id}`,
          notes: [
            input.paymentNote,
            input.tpvOperationNumber ? `Nº operación TPV: ${input.tpvOperationNumber}` : null,
            input.transferProofUrl ? `Justificante: ${input.transferProofUrl}` : null,
          ].filter(Boolean).join(" · ") || inst.notes,
          updatedAt: now,
        }).where(eq(paymentInstallments.id, input.installmentId));

        await logActivity("quote", inst.quoteId, "installment_paid_manual", ctx.user.id, ctx.user.name, {
          installmentId: inst.id,
          installmentNumber: inst.installmentNumber,
          amountCents: inst.amountCents,
          paymentMethod: input.paymentMethod,
          tpvOperationNumber: input.tpvOperationNumber ?? null,
          transferProofUrl: input.transferProofUrl ?? null,
        });

        // Marcar el pendingPayments vinculado como cobrado (primera coincidencia por quoteId + amountCents)
        try {
          const [matchingPP] = await db.select({ id: pendingPayments.id })
            .from(pendingPayments)
            .where(and(
              eq(pendingPayments.quoteId, inst.quoteId),
              eq(pendingPayments.amountCents, inst.amountCents),
              eq(pendingPayments.status, "pending"),
            ))
            .limit(1);
          if (matchingPP) {
            await db.update(pendingPayments)
              .set({ status: "paid", updatedAt: Date.now() } as any)
              .where(eq(pendingPayments.id, matchingPP.id));
          }
        } catch (ppErr) {
          console.error("[confirmInstallment] Error actualizando pendingPayments:", ppErr);
        }

        // Enviar email de confirmación de pago al cliente
        try {
          const [quote] = await db.select({ leadId: quotes.leadId, quoteNumber: quotes.quoteNumber, title: quotes.title })
            .from(quotes).where(eq(quotes.id, inst.quoteId)).limit(1);
          if (quote) {
            const [lead] = await db.select({ name: leads.name, email: leads.email })
              .from(leads).where(eq(leads.id, quote.leadId)).limit(1);
            const allInstallments = await db.select({ id: paymentInstallments.id })
              .from(paymentInstallments).where(eq(paymentInstallments.quoteId, inst.quoteId));
            if (lead?.email) {
              const html = buildInstallmentReminderHtml({
                clientName: lead.name ?? "Cliente",
                clientEmail: lead.email,
                quoteNumber: quote.quoteNumber ?? "",
                installmentNumber: inst.installmentNumber,
                totalInstallments: allInstallments.length,
                amountFormatted: `${(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
                dueDate: inst.dueDate,
              });
              await sendEmail({
                to: lead.email,
                subject: `✅ Pago recibido — Cuota ${inst.installmentNumber}/${allInstallments.length} — ${quote.quoteNumber}`,
                html,
              });
            }
          }
        } catch (emailErr) {
          console.error("[confirmInstallment] Error enviando email al cliente:", emailErr);
        }

        await checkAndConfirmInstallmentPlan(inst.quoteId, ctx.user.id, ctx.user.name ?? "Admin");

        return { success: true };
      }),

    // Obtener cuotas próximas a vencer o vencidas (para dashboard)
    upcoming: staff
      .input(z.object({
        daysAhead: z.number().default(7),
        status: z.enum(["pending", "overdue"]).optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const future = new Date(now.getTime() + input.daysAhead * 86400000);
        const todayStr = now.toISOString().split("T")[0];
        const futureStr = future.toISOString().split("T")[0];

        // Mostrar cuotas de presupuestos activos (enviados, en proceso o aceptados).
        // Excluye borradores y rechazados — incluye planes donde aún no se ha pagado ninguna cuota.
        const conditions = [
          ne(paymentInstallments.status, "paid"),
          ne(paymentInstallments.status, "cancelled"),
          ne(quotes.status, "borrador"),
          ne(quotes.status, "rechazado"),
        ];
        if (input.status === "overdue") {
          conditions.push(lte(paymentInstallments.dueDate, todayStr));
        } else if (!input.status) {
          conditions.push(lte(paymentInstallments.dueDate, futureStr));
        }

        const rows = await db
          .select({
            id: paymentInstallments.id,
            planId: paymentInstallments.planId,
            quoteId: paymentInstallments.quoteId,
            installmentNumber: paymentInstallments.installmentNumber,
            amountCents: paymentInstallments.amountCents,
            dueDate: paymentInstallments.dueDate,
            status: paymentInstallments.status,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
            merchantOrder: paymentInstallments.merchantOrder,
            reservationId: paymentInstallments.reservationId,
            paymentMethod: paymentInstallments.paymentMethod,
            paidAt: paymentInstallments.paidAt,
            paidBy: paymentInstallments.paidBy,
            remindersSent: paymentInstallments.remindersSent,
            lastReminderAt: paymentInstallments.lastReminderAt,
            notes: paymentInstallments.notes,
            createdAt: paymentInstallments.createdAt,
            updatedAt: paymentInstallments.updatedAt,
            quoteNumber: quotes.quoteNumber,
            quoteTitle: quotes.title,
          })
          .from(paymentInstallments)
          .innerJoin(quotes, eq(quotes.id, paymentInstallments.quoteId))
          .where(and(...conditions))
          .orderBy(paymentInstallments.dueDate)
          .limit(50);

        return rows;
      }),

    // Generar enlace de pago para la siguiente cuota pendiente y enviarlo al cliente
    generateInstallmentLink: staff
      .input(z.object({
        quoteId: z.number(),
        origin: z.string().url(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (!quote.paymentPlanId) throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto no tiene plan de pagos" });
        if (quote.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "El plan ya está completamente cobrado" });

        // Verificar que hay cuotas pendientes
        const [nextPending] = await db
          .select({ id: paymentInstallments.id, installmentNumber: paymentInstallments.installmentNumber, amountCents: paymentInstallments.amountCents, dueDate: paymentInstallments.dueDate })
          .from(paymentInstallments)
          .where(and(
            eq(paymentInstallments.quoteId, input.quoteId),
            eq(paymentInstallments.status, "pending"),
          ))
          .orderBy(paymentInstallments.installmentNumber)
          .limit(1);
        if (!nextPending) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay cuotas pendientes de cobro" });

        // Generar nuevo token y actualizar el quote
        const { randomBytes } = await import("crypto");
        const token = randomBytes(32).toString("hex");
        await db.update(quotes)
          .set({ paymentLinkToken: token, updatedAt: new Date() })
          .where(eq(quotes.id, input.quoteId));

        const paymentUrl = `${input.origin}/presupuesto/${token}`;

        // Enviar email al cliente con el enlace
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
        const allInstallments = await db.select({ id: paymentInstallments.id })
          .from(paymentInstallments).where(eq(paymentInstallments.quoteId, input.quoteId));

        if (lead?.email) {
          try {
            const html = buildInstallmentReminderHtml({
              clientName: lead.name ?? "Cliente",
              clientEmail: lead.email,
              quoteNumber: quote.quoteNumber ?? "",
              installmentNumber: nextPending.installmentNumber,
              totalInstallments: allInstallments.length,
              amountFormatted: `${(nextPending.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
              dueDate: nextPending.dueDate,
              paymentUrl,
            });
            await sendEmail({
              to: lead.email,
              subject: `💳 Enlace de pago — Cuota ${nextPending.installmentNumber}/${allInstallments.length} — ${quote.quoteNumber}`,
              html,
            });
          } catch (emailErr) {
            console.error("[generateInstallmentLink] Error enviando email:", emailErr);
          }
        }

        await logActivity("quote", input.quoteId, "installment_link_sent", ctx.user.id, ctx.user.name, {
          installmentNumber: nextPending.installmentNumber,
          amountCents: nextPending.amountCents,
          paymentUrl,
        });

        return { paymentUrl, installmentNumber: nextPending.installmentNumber, amountCents: nextPending.amountCents };
      }),

    // Marcar cuotas vencidas automáticamente (llamado por job)
    markOverdue: staff
      .input(z.object({}))
      .mutation(async ({ ctx }) => {
        const todayStr = new Date().toISOString().split("T")[0];
        const result = await db.update(paymentInstallments)
          .set({ status: "overdue", updatedAt: new Date() })
          .where(and(
            eq(paymentInstallments.status, "pending"),
            lte(paymentInstallments.dueDate, todayStr),
          ));
        const affected = (result[0] as any).affectedRows ?? 0;
        if (affected > 0) {
          console.log(`[InstallmentJob] ${affected} cuota(s) marcadas como vencidas`);
        }
        return { marked: affected };
      }),
  }),

  // ─── QUOTES TIMELINE ─────────────────────────────────────────────────────────
  timeline: router({
    get: staff.input(z.object({ quoteId: z.number() })).query(async ({ input }) => {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId)).limit(1);
      if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });

      // Construir eventos sintéticos desde los campos del quote
      type TimelineEvent = {
        id: string;
        type: "created" | "sent" | "viewed" | "reminder" | "accepted" | "rejected" | "paid" | "lost" | "expired" | "activity";
        label: string;
        detail?: string;
        timestamp: number;
        actor?: string;
      };

      const events: TimelineEvent[] = [];

      // 1. Creado
      events.push({
        id: "created",
        type: "created",
        label: "Presupuesto creado",
        detail: quote.quoteNumber,
        timestamp: new Date(quote.createdAt).getTime(),
      });

      // 2. Enviado
      if (quote.sentAt) {
        events.push({
          id: "sent",
          type: "sent",
          label: "Enviado al cliente",
          detail: "Email con enlace de aceptación",
          timestamp: new Date(quote.sentAt).getTime(),
        });
      }

      // 3. Recordatorios automáticos (estimamos desde lastReminderAt y reminderCount)
      if (quote.reminderCount && quote.reminderCount > 0 && quote.lastReminderAt) {
        // Si hay 2 recordatorios, el primero fue ~48h después del envío
        if (quote.reminderCount >= 2 && quote.sentAt) {
          const firstReminderTs = new Date(quote.sentAt).getTime() + 48 * 60 * 60 * 1000;
          events.push({
            id: "reminder_1",
            type: "reminder",
            label: "Recordatorio automático #1",
            detail: "Presupuesto no abierto en 48h",
            timestamp: firstReminderTs,
          });
        }
        events.push({
          id: "reminder_last",
          type: "reminder",
          label: `Recordatorio automático #${quote.reminderCount}`,
          detail: "Reenvío automático del sistema",
          timestamp: new Date(quote.lastReminderAt).getTime(),
        });
      }

      // 4. Visto
      if (quote.viewedAt) {
        events.push({
          id: "viewed",
          type: "viewed",
          label: "Abierto por el cliente",
          detail: "El cliente visualizó el presupuesto",
          timestamp: new Date(quote.viewedAt).getTime(),
        });
      }

      // 5. Aceptado
      if (quote.acceptedAt) {
        events.push({
          id: "accepted",
          type: "accepted",
          label: "Presupuesto aceptado",
          detail: "El cliente aceptó el presupuesto",
          timestamp: new Date(quote.acceptedAt).getTime(),
        });
      }

      // 6. Pagado
      if (quote.paidAt) {
        events.push({
          id: "paid",
          type: "paid",
          label: "Pago confirmado",
          detail: quote.invoiceNumber ? `Factura ${quote.invoiceNumber} generada` : "Pago recibido",
          timestamp: new Date(quote.paidAt).getTime(),
        });
      }

      // 7. Perdido / Expirado / Rechazado (estado final negativo)
      if (quote.status === "perdido" || quote.status === "expirado" || quote.status === "rechazado") {
        events.push({
          id: "closed_negative",
          type: quote.status === "rechazado" ? "rejected" : "lost",
          label: quote.status === "rechazado" ? "Rechazado por el cliente" : quote.status === "expirado" ? "Presupuesto expirado" : "Marcado como perdido",
          timestamp: new Date(quote.updatedAt).getTime(),
        });
      }

      // 8. Actividad manual del CRM (notas, cambios de estado manuales)
      const activityLogs = await db.select().from(crmActivityLog)
        .where(and(eq(crmActivityLog.entityType, "quote"), eq(crmActivityLog.entityId, input.quoteId)))
        .orderBy(desc(crmActivityLog.createdAt))
        .limit(20);

      for (const log of activityLogs) {
        // Evitar duplicados con eventos sintéticos ya añadidos
        const isDuplicate = events.some(e =>
          Math.abs(e.timestamp - new Date(log.createdAt).getTime()) < 2000 &&
          (e.type === "sent" || e.type === "paid" || e.type === "accepted")
        );
        if (!isDuplicate) {
          events.push({
            id: `log_${log.id}`,
            type: "activity",
            label: log.action,
            detail: log.details ? JSON.stringify(log.details) : undefined,
            actor: log.actorName ?? undefined,
            timestamp: new Date(log.createdAt).getTime(),
          });
        }
      }

      // Ordenar cronológicamente
      events.sort((a, b) => a.timestamp - b.timestamp);

      return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        events,
      };
    }),

    // ─── Aplicar código de descuento / bono a un presupuesto ─────────────────
    // El descuento se registra en quotes.discount, se recalcula el total,
    // y se marca el código como usado (sincronizando el bono si origin=voucher).
    applyDiscountCode: staff
      .input(z.object({
        id: z.number(),
        code: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const normalizedCode = input.code.toUpperCase().trim();

        // 1. Cargar el presupuesto
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND", message: "Presupuesto no encontrado" });
        if (quote.status === "pagado" || quote.status === "facturado" || quote.status === "convertido_reserva") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede aplicar un descuento a un presupuesto ya pagado o convertido" });
        }
        if (quote.discount && Number(quote.discount) > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este presupuesto ya tiene un descuento aplicado" });
        }

        // 2. Validar el código
        const [dc] = await db.select().from(discountCodes)
          .where(eq(discountCodes.code, normalizedCode))
          .limit(1);

        if (!dc) throw new TRPCError({ code: "NOT_FOUND", message: "Código no encontrado" });
        if (dc.status === "inactive") throw new TRPCError({ code: "BAD_REQUEST", message: "El código está inactivo" });
        if (dc.expiresAt && new Date(dc.expiresAt) < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El código ha caducado" });
        }
        if (dc.maxUses !== null && dc.currentUses >= dc.maxUses) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El código ya ha alcanzado el límite de usos" });
        }

        // 3. Calcular importe del descuento
        const subtotalEur = Number(quote.subtotal);
        let discountEur: number;
        if (dc.discountType === "fixed") {
          discountEur = Math.min(Number(dc.discountAmount ?? 0), subtotalEur);
        } else {
          discountEur = (subtotalEur * Number(dc.discountPercent)) / 100;
        }
        discountEur = Math.round(discountEur * 100) / 100;

        // 4. Recalcular total: subtotal - descuento + IVA sobre base descontada
        const taxRate = quote.tax && subtotalEur > 0 ? Number(quote.tax) / subtotalEur : 0;
        const newTaxBase = subtotalEur - discountEur;
        const newTax = Math.round(newTaxBase * taxRate * 100) / 100;
        const newTotal = Math.max(0, newTaxBase + newTax);

        // 5. Actualizar presupuesto
        await db.update(quotes).set({
          discount: String(discountEur.toFixed(2)),
          tax: String(newTax.toFixed(2)),
          total: String(newTotal.toFixed(2)),
          updatedAt: new Date(),
        }).where(eq(quotes.id, input.id));

        // 6. Registrar uso del código (también sincroniza el bono si origin=voucher)
        await recordDiscountUse({
          discountCodeId: dc.id,
          code: dc.code,
          discountPercent: Number(dc.discountPercent),
          discountAmount: discountEur,
          originalAmount: subtotalEur,
          finalAmount: Math.max(0, subtotalEur - discountEur),
          channel: "crm",
          appliedByUserId: String(ctx.user.id),
        });

        // 7. Log de actividad
        await logActivity("quote", input.id, "discount_applied", ctx.user.id, ctx.user.name, {
          code: dc.code,
          name: dc.name,
          discountType: dc.discountType,
          discountEur,
          newTotal,
        });

        return { success: true, discountEur, newTotal, code: dc.code, name: dc.name };
      }),
  }),

  // ─── RESERVATIONSS ──────────────────────────────────────────────────────────

  reservations: router({
    list: staff
      .input(
        z.object({
          status: z.string().optional(),
          channel: z.string().optional(),
          search: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        const conditions = [];

        if (input.status) {
          conditions.push(eq(reservations.status, input.status as "draft" | "pending_payment" | "paid" | "failed" | "cancelled"));
        } else {
          // Regla de negocio: solo mostrar reservas reales.
          // - "paid": confirmadas por Redsys o admin.
          // - "cancelled": anuladas (deben seguir visibles con estado "Anulada").
          // - "pending_payment" + canal NO ONLINE_DIRECTO: autorizadas por admin (link de pago desde CRM).
          // Quedan excluidos: intentos de checkout web no pagados (pending_payment+ONLINE_DIRECTO)
          // y pagos fallidos (failed).
          conditions.push(
            or(
              eq(reservations.status, "paid"),
              eq(reservations.status, "cancelled"),
              and(
                eq(reservations.status, "pending_payment"),
                ne(reservations.channel, "ONLINE_DIRECTO")
              )
            ) as ReturnType<typeof and>
          );
        }

        if (input.channel) {
          if (input.channel === "coupon") {
            // Filtrar por origen cupón (cualquier plataforma)
            conditions.push(eq(reservations.originSource, "coupon_redemption"));
          } else {
            conditions.push(eq(reservations.channel, input.channel as "web" | "crm" | "telefono" | "email" | "otro" | "tpv" | "groupon"));
          }
        }
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(
            or(
              like(reservations.reservationNumber, s),
              like(reservations.customerName, s),
              like(reservations.customerEmail, s),
              like(reservations.customerPhone, s),
              like(reservations.merchantOrder, s),
              like(reservations.invoiceNumber, s),
              like(reservations.productName, s),
              like(reservations.bookingDate, s),
              like(reservations.notes, s)
            )
          );
        }
        if (input.from) conditions.push(gte(reservations.createdAt, new Date(input.from).getTime()));
        if (input.to) conditions.push(lte(reservations.createdAt, new Date(input.to).getTime()));

        const where = conditions.length ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          db
            .select({
              ...getTableColumns(reservations),
              invoicePdfUrl: invoices.pdfUrl,
              clientId: clients.id,
              tpvOperationNumber: cardTerminalOperations.operationNumber,
            })
            .from(reservations)
            .leftJoin(invoices, eq(invoices.id, reservations.invoiceId as any))
            .leftJoin(quotes, eq(quotes.id, reservations.quoteId as any))
            .leftJoin(clients, eq(clients.leadId, quotes.leadId))
            .leftJoin(
              cardTerminalOperations,
              and(
                eq(cardTerminalOperations.linkedEntityId, reservations.id),
                eq(cardTerminalOperations.linkedEntityType, "reservation")
              )
            )
            .where(where)
            .orderBy(desc(reservations.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(reservations).where(where),
        ]);
        return { rows, total };
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).getTime();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const endOfWeekStr = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const [
        confirmadas, importeConfirmadas,
        pendientePago, importePendientePago,
        canceladas,
        servicioHoy, importeServicioHoy,
        proximasSemana, importeProximasSemana,
        esteMes, importeEsteMes,
        ingresos, facturas,
      ] = await Promise.all([
        // Confirmadas (paid)
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations).where(eq(reservations.status, "paid")),
        // Pendiente de pago
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "pending_payment")),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations).where(eq(reservations.status, "pending_payment")),
        // Canceladas
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "cancelled")),
        // Servicio hoy (bookingDate = hoy, cualquier estado activo)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.bookingDate, todayStr), sql`${reservations.status} != 'cancelled'`)),
        // Importe servicio hoy: usa amountTotal cuando está disponible, si no cae a pendingPayments.amountCents
        // (las reservas placeholder del flujo pendingPayments tienen amountTotal=0)
        db.select({
          total: sql<number>`
            COALESCE(SUM(
              CASE WHEN r.amount_total > 0 THEN r.amount_total
                   ELSE COALESCE(pp.amount_cents, 0)
              END
            ), 0)
          `
        })
        .from(sql`reservations r`)
        .leftJoin(sql`pending_payments pp`, sql`pp.reservation_id = r.id AND pp.status = 'paid'`)
        .where(sql`r.booking_date = ${todayStr} AND r.status != 'cancelled'`),
        // Próximas 7 días (servicio confirmado)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.status, "paid"), sql`${reservations.bookingDate} > ${todayStr}`, sql`${reservations.bookingDate} <= ${endOfWeekStr}`)),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations)
          .where(and(eq(reservations.status, "paid"), sql`${reservations.bookingDate} > ${todayStr}`, sql`${reservations.bookingDate} <= ${endOfWeekStr}`)),
        // Este mes (creadas este mes, pagadas)
        db.select({ cnt: count() }).from(reservations)
          .where(and(eq(reservations.status, "paid"), gte(reservations.createdAt, startOfMonth))),
        db.select({ total: sum(reservations.amountTotal) }).from(reservations)
          .where(and(eq(reservations.status, "paid"), gte(reservations.createdAt, startOfMonth))),
        // Legacy: ingresos totales (amountPaid) y facturas
        db.select({ total: sum(reservations.amountPaid) }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ cnt: count() }).from(invoices).where(eq(invoices.status, "generada")),
      ]);

      return {
        confirmadas: confirmadas[0]?.cnt ?? 0,
        importeConfirmadas: ((importeConfirmadas[0]?.total ?? 0) as number) / 100,
        pendientePago: pendientePago[0]?.cnt ?? 0,
        importePendientePago: ((importePendientePago[0]?.total ?? 0) as number) / 100,
        canceladas: canceladas[0]?.cnt ?? 0,
        servicioHoy: servicioHoy[0]?.cnt ?? 0,
        importeServicioHoy: ((importeServicioHoy[0]?.total ?? 0) as number) / 100,
        proximasSemana: proximasSemana[0]?.cnt ?? 0,
        importeProximasSemana: ((importeProximasSemana[0]?.total ?? 0) as number) / 100,
        esteMes: esteMes[0]?.cnt ?? 0,
        importeEsteMes: ((importeEsteMes[0]?.total ?? 0) as number) / 100,
        // legacy
        hoy: servicioHoy[0]?.cnt ?? 0,
        proximas: proximasSemana[0]?.cnt ?? 0,
        ingresos: ((ingresos[0]?.total ?? 0) as number) / 100,
        facturas: facturas[0]?.cnt ?? 0,
      };
    }),

    // ─── Auditoría: reservas pagadas sin factura o sin expediente REAV ──────
    auditOrphans: staff.query(async () => {
      // 1. Reservas pagadas sin factura asociada
      const paidRes = await db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          customerName: reservations.customerName,
          customerEmail: reservations.customerEmail,
          productName: reservations.productName,
          amountTotal: reservations.amountTotal,
          createdAt: reservations.createdAt,
          quoteId: reservations.quoteId,
          invoiceId: reservations.invoiceId,
          productId: reservations.productId,
        })
        .from(reservations)
        .where(eq(reservations.status, "paid"));

      const paidIds = paidRes.map(r => r.id);
      const paidQuoteIds = paidRes.map(r => r.quoteId).filter((q): q is number => q != null);

      // Facturas vinculadas por reservationId o quoteId
      const linkedInvoices = paidIds.length > 0
        ? await db.select({ reservationId: invoices.reservationId, quoteId: invoices.quoteId })
            .from(invoices)
            .where(
              or(
                inArray(invoices.reservationId, paidIds),
                paidQuoteIds.length > 0 ? inArray(invoices.quoteId, paidQuoteIds) : sql`false`
              )
            )
        : [];

      const invoicedResIds = new Set<number>();
      for (const inv of linkedInvoices) {
        if (inv.reservationId) invoicedResIds.add(inv.reservationId);
      }
      // También cubrir la relación por quoteId: si la factura tiene quoteId, marcar todas las reservas de ese quote
      const invoicedQuoteIds = new Set(linkedInvoices.map(i => i.quoteId).filter((q): q is number => q != null));
      for (const r of paidRes) {
        if (r.quoteId && invoicedQuoteIds.has(r.quoteId)) invoicedResIds.add(r.id);
        if (r.invoiceId) invoicedResIds.add(r.id); // campo directo en la reserva
      }

      const sinFactura = paidRes.filter(r => !invoicedResIds.has(r.id)).map(r => ({
        id: r.id,
        reservationNumber: r.reservationNumber,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        productName: r.productName,
        amountEur: (r.amountTotal ?? 0) / 100,
        createdAt: r.createdAt,
      }));

      // 2. Reservas pagadas vinculadas a producto REAV sin expediente REAV
      const reavProductIds = paidRes
        .map(r => r.productId)
        .filter((pid): pid is number => pid != null && pid > 0);

      let reavProductSet = new Set<number>();
      if (reavProductIds.length > 0) {
        const reavProds = await db
          .select({ id: experiences.id })
          .from(experiences)
          .where(and(inArray(experiences.id, reavProductIds), eq(experiences.fiscalRegime, "reav")));
        reavProductSet = new Set(reavProds.map(p => p.id));
      }

      const reavReservationIds = paidRes
        .filter(r => r.productId != null && reavProductSet.has(r.productId!))
        .map(r => r.id);

      let expedientedIds = new Set<number>();
      if (reavReservationIds.length > 0) {
        const expedients = await db
          .select({ reservationId: reavExpedients.reservationId })
          .from(reavExpedients)
          .where(inArray(reavExpedients.reservationId, reavReservationIds));
        expedientedIds = new Set(expedients.map(e => e.reservationId).filter((id): id is number => id != null));
      }

      const sinReav = paidRes
        .filter(r => r.productId != null && reavProductSet.has(r.productId!) && !expedientedIds.has(r.id))
        .map(r => ({
          id: r.id,
          reservationNumber: r.reservationNumber,
          customerName: r.customerName,
          customerEmail: r.customerEmail,
          productName: r.productName,
          amountEur: (r.amountTotal ?? 0) / 100,
          createdAt: r.createdAt,
        }));

      return {
        sinFactura,
        sinReav,
        totalPagadas: paidRes.length,
        sinFacturaCount: sinFactura.length,
        sinReavCount: sinReav.length,
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [reservation] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!reservation) throw new TRPCError({ code: "NOT_FOUND" });

        // Buscar facturas por reservationId O por quoteId (planes de pago multi-cuota
        // vinculan la factura a la reserva de la última cuota, no necesariamente a la primera)
        const invoiceCondition = reservation.quoteId
          ? or(eq(invoices.reservationId, input.id), eq(invoices.quoteId, reservation.quoteId))
          : eq(invoices.reservationId, input.id);
        const relatedInvoices = await db.select().from(invoices)
          .where(invoiceCondition)
          .orderBy(desc(invoices.createdAt));
        const activity = await db
          .select()
          .from(crmActivityLog)
          .where(and(eq(crmActivityLog.entityType, "reservation"), eq(crmActivityLog.entityId, input.id)))
          .orderBy(desc(crmActivityLog.createdAt))
          .limit(30);

        return { reservation, invoices: relatedInvoices, activity };
      }),

    // ─── Actualizar estado/notas de una reserva ─────────────────────────────
    update: staff
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "pending_payment", "paid", "failed", "cancelled"]).optional(),
        notes: z.string().optional(),
        bookingDate: z.string().optional(),
        people: z.number().optional(),
        channel: z.string().optional(),
        channelDetail: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...fields } = input;
        const [current] = await db.select().from(reservations).where(eq(reservations.id, id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });
        const updateData: Record<string, unknown> = { updatedAt: Date.now() };
        if (fields.status !== undefined) updateData.status = fields.status;
        if (fields.notes !== undefined) updateData.notes = fields.notes;
        if (fields.bookingDate !== undefined) updateData.bookingDate = fields.bookingDate;
        if (fields.people !== undefined) updateData.people = fields.people;
        if (fields.channel !== undefined) updateData.channel = fields.channel;
        if (fields.channelDetail !== undefined) updateData.channelDetail = fields.channelDetail;
        await db.update(reservations).set(updateData).where(eq(reservations.id, id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: id,
          action: "reservation_updated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { fields: Object.keys(fields) },
          createdAt: new Date(),
        });
        return { ok: true };
      }),

    // ─── Actualizar estados separados (statusReservation + statusPayment) ───────────────
    updateStatuses: staff
      .input(z.object({
        id: z.number(),
        statusReservation: z.enum(["PENDIENTE_CONFIRMACION", "CONFIRMADA", "EN_CURSO", "FINALIZADA", "NO_SHOW", "ANULADA"]).optional(),
        statusPayment: z.enum(["PENDIENTE", "PAGO_PARCIAL", "PENDIENTE_VALIDACION", "PAGADO"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [current] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });
        const now = Date.now();
        const logEntry = {
          ts: now,
          actor: ctx.user.name ?? String(ctx.user.id),
          action: "status_change",
          from: JSON.stringify({ statusReservation: current.statusReservation, statusPayment: current.statusPayment }),
          to: JSON.stringify({ statusReservation: input.statusReservation, statusPayment: input.statusPayment }),
        };
        const existingLog = Array.isArray(current.changesLog) ? current.changesLog : [];
        const updateData: Record<string, unknown> = { updatedAt: now, changesLog: [...existingLog, logEntry] };
        if (input.statusReservation !== undefined) updateData.statusReservation = input.statusReservation;
        if (input.statusPayment !== undefined) updateData.statusPayment = input.statusPayment;
        // Sincronizar status legacy según los estados nuevos
        if (input.statusReservation === "ANULADA") {
          updateData.status = "cancelled";
        } else if (input.statusPayment === "PAGADO") {
          updateData.status = "paid";
          updateData.paidAt = now;
        } else if (input.statusPayment !== undefined) {
          // Si el pago retrocede desde pagado, liberar el status legacy para permitir borrado
          updateData.status = "pending_payment";
        }
        await db.update(reservations).set(updateData).where(eq(reservations.id, input.id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "status_updated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { from: logEntry.from, to: logEntry.to },
          createdAt: new Date(),
        });
        return { ok: true };
      }),

    // ─── Cambio de fecha con motivo obligatorio + trazabilidad ─────────────────────
    changeDate: staff
      .input(z.object({
        id: z.number(),
        newDate: z.string().min(1, "La nueva fecha es obligatoria"),
        reason: z.string().min(3, "El motivo del cambio es obligatorio"),
      }))
      .mutation(async ({ input, ctx }) => {
        const [current] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!current) throw new TRPCError({ code: "NOT_FOUND" });
        const now = Date.now();
        const logEntry = {
          ts: now,
          actor: ctx.user.name ?? String(ctx.user.id),
          action: "date_change",
          from: String(current.bookingDate),
          to: input.newDate,
          reason: input.reason,
        };
        const existingLog = Array.isArray(current.changesLog) ? current.changesLog : [];
        await db.update(reservations).set({
          bookingDate: input.newDate,
          dateChangedReason: input.reason,
          dateModified: true,
          changesLog: [...existingLog, logEntry],
          updatedAt: now,
        }).where(eq(reservations.id, input.id));
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "date_changed",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { from: current.bookingDate, to: input.newDate, reason: input.reason },
          createdAt: new Date(),
        });
        return { ok: true };
      }),

    // ─── Reenviar email de confirmación al cliente ──────────────────────────
    resendConfirmation: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        const isTransfer = res.paymentMethod === "transferencia";
        let html: string;
        let subject: string;
        if (isTransfer) {
          const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
          html = buildTransferConfirmationHtml({
            clientName: res.customerName,
            invoiceNumber: res.invoiceNumber ?? res.merchantOrder,
            reservationRef: res.merchantOrder,
            quoteTitle: res.productName,
            items: [{
              description: res.productName,
              quantity: res.people,
              unitPrice: amountEur / res.people,
              total: amountEur,
            }],
            subtotal: amountEur.toFixed(2),
            taxAmount: "0.00",
            total: amountEur.toFixed(2),
            invoiceUrl: null,
          });
          subject = `🏦 Confirmación de reserva — ${res.productName} · Náyade Experiences`;
        } else {
          html = buildConfirmationHtml({
            clientName: res.customerName,
            reservationRef: res.merchantOrder,
            quoteTitle: res.productName,
            items: [{
              description: res.productName,
              quantity: res.people,
              unitPrice: (res.amountTotal / res.people) / 100,
              total: res.amountTotal / 100,
            }],
            total: `${(res.amountTotal / 100).toFixed(2)} €`,
            bookingDate: res.bookingDate,
            contactEmail: await getBusinessEmail('reservations'),
            contactPhone: "+34 911 67 51 89",
          });
          subject = `✅ Confirmación de reserva — ${res.productName} · Náyade Experiences`;
        }
        await sendEmail({ to: res.customerEmail ?? "", subject, html });
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.id,
          action: "email_resent",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { to: res.customerEmail ?? "", subject },
          createdAt: new Date(),
        });
        return { ok: true, sentTo: res.customerEmail ?? "" };
      }),

    // ─── Generar factura desde reserva TPV ────────────────────────────────
    generateInvoice: staff
      .input(z.object({
        reservationId: z.number(),
        clientNif: z.string().optional(),
        clientAddress: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Load reservation
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.reservationId));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        if (res.invoiceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Esta reserva ya tiene factura generada" });
        // ⚠️ GUARD: Reservas Groupon no son facturables desde el CRM
        if (res.channel === "groupon" || res.originSource === "coupon_redemption") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Las reservas procedentes de canje de cupón Groupon no pueden facturarse desde el CRM. Su liquidación económica pertenece al flujo de conciliación del proveedor ticketing.",
          });
        }

        // 2. Load TPV sale and items if available
        const tpvSaleRows = await db.select().from(tpvSales).where(eq(tpvSales.reservationId, input.reservationId));
        const tpvSale = tpvSaleRows[0] ?? null;
        let items: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[] = [];

        if (tpvSale) {
          const saleItems = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, tpvSale.id));
          items = saleItems.map(i => ({
            description: i.productName,
            quantity: i.quantity,
            unitPrice: parseFloat(String(i.unitPrice)),
            total: parseFloat(String(i.subtotal)),
            fiscalRegime: (i.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
          }));
        } else {
          // Fallback: single line from reservation data
          const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
          items = [{ description: res.productName, quantity: res.people, unitPrice: amountEur / res.people, total: amountEur }];
        }

        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const subtotal = items.reduce((s, i) => s + i.total, 0);
        const bdTpv = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
        const taxAmount = totalTaxAmount(bdTpv);
        const taxRate = bdTpv.length === 1 ? bdTpv[0].rate : 21;
        const total = parseFloat((subtotal + taxAmount).toFixed(2));

        // 3. Generate PDF
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: res.customerName,
            clientEmail: res.customerEmail ?? "",
            clientPhone: res.customerPhone,
            clientNif: input.clientNif,
            clientAddress: input.clientAddress,
            itemsJson: items,
            subtotal: String(subtotal.toFixed(2)),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total.toFixed(2)),
            taxBreakdown: bdTpv,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("Invoice PDF generation failed:", e);
        }

        // 4. Insert invoice record
        const [invResult] = await db.insert(invoices).values({
          invoiceNumber,
          reservationId: input.reservationId,
          clientName: res.customerName,
          clientEmail: res.customerEmail ?? "",
          clientPhone: res.customerPhone,
          itemsJson: items,
          subtotal: String(subtotal.toFixed(2)),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdTpv.length > 0 ? bdTpv : undefined,
          total: String(total.toFixed(2)),
          pdfUrl,
          pdfKey,
          clientNif: input.clientNif ?? null,
          clientAddress: input.clientAddress ?? null,
          isAutomatic: false,
          status: "generada",
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // 5. Update reservation with invoiceId and invoiceNumber
        await db.update(reservations).set({
          invoiceId,
          invoiceNumber,
          updatedAt: Date.now(),
        }).where(eq(reservations.id, input.reservationId));

        // 6. Update tpvSale with invoiceId if applicable (no new REAV expedient)
        if (tpvSale) {
          await db.update(tpvSales).set({ invoiceId }).where(eq(tpvSales.id, tpvSale.id));
        }

        // 7. Attach invoice PDF to existing REAV expedient (if any) — NO new expedient created
        if (pdfUrl) {
          const reavRows = await db.select({ id: reavExpedients.id })
            .from(reavExpedients)
            .where(eq(reavExpedients.sourceRef, tpvSale?.ticketNumber ?? res.merchantOrder ?? ""))
            .limit(1);
          const reavId = reavRows[0]?.id ?? null;
          if (reavId) {
            await attachReavDocument({
              expedientId: reavId,
              side: "client",
              docType: "factura_emitida",
              title: `Factura ${invoiceNumber}`,
              fileUrl: pdfUrl,
              notes: `Factura generada desde reserva TPV ${res.merchantOrder}`,
            });
          }
        }

        // 8. Log activity
        await db.insert(crmActivityLog).values({
          entityType: "reservation",
          entityId: input.reservationId,
          action: "invoice_generated",
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          details: { invoiceId, invoiceNumber, pdfUrl },
          createdAt: new Date(),
        });

        return { ok: true, invoiceId, invoiceNumber, pdfUrl };
      }),

    // ─── Eliminar reserva ───────────────────────────────────────────────────
    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const [res] = await db.select({ id: reservations.id, status: reservations.status }).from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
        if (res.status === "paid") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se puede eliminar una reserva pagada. Cancélala primero desde Editar." });
        await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "reservation"), eq(crmActivityLog.entityId, input.id)));
        await db.delete(reservations).where(eq(reservations.id, input.id));
        return { ok: true };
      }),

    bulkDelete: staff
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const rows = await db.select({ id: reservations.id, status: reservations.status }).from(reservations).where(inArray(reservations.id, input.ids));
        const deletable = rows.filter(r => r.status !== "paid").map(r => r.id);
        const skipped = input.ids.length - deletable.length;
        if (deletable.length > 0) {
          for (const id of deletable) {
            await db.delete(crmActivityLog).where(and(eq(crmActivityLog.entityType, "reservation"), eq(crmActivityLog.entityId, id)));
          }
          await db.delete(reservations).where(inArray(reservations.id, deletable));
        }
        return { deleted: deletable.length, skipped };
      }),

    bulkUpdateStatus: staff
      .input(z.object({
        ids: z.array(z.number()).min(1),
        status: z.enum(["draft", "pending_payment", "paid", "failed", "cancelled"]),
      }))
      .mutation(async ({ input }) => {
        await db.update(reservations).set({ status: input.status }).where(inArray(reservations.id, input.ids));
        return { updated: input.ids.length };
      }),

    // ─── Crear reserva manual (admin) ─────────────────────────────────────────────────────────────────────────────
    // Crea una reserva directa sin pasar por presupuesto, ejecutando el mismo
    // postConfirmOperation que los flujos automáticos (CRM, Redsys, Ticketing, TPV).
    createManual: staff
      .input(
        z.object({
          // Cliente
          customerName: z.string().min(2),
          customerEmail: z.string().email(),
          customerPhone: z.string().optional(),
          // Producto
          productId: z.number(),
          productName: z.string().min(1),
          // Servicio
          bookingDate: z.string().min(1),   // YYYY-MM-DD
          people: z.number().min(1),
          // Económico
          amountTotal: z.number().min(0),    // en euros
          amountPaid: z.number().min(0),     // en euros
          paymentMethod: z.enum(["efectivo", "transferencia", "redsys", "otro"]).default("efectivo"),
          // Opcionales
          notes: z.string().optional(),
          channel: z.enum(["crm", "telefono", "email", "otro"]).default("crm"),
          sendConfirmationEmail: z.boolean().default(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const now = new Date();
        const merchantOrder = `MAN-${Date.now().toString(36).toUpperCase()}`;

        // 1. Upsert cliente
        await upsertClientFromReservation({
          name: input.customerName,
          email: input.customerEmail,
          phone: input.customerPhone ?? null,
          source: "admin",
        });

        // 2. Generar número de factura
        const invoiceNumber = await generateInvoiceNumber("crm:manual", String(ctx.user.id));

        // 3. Construir líneas de factura
        const unitPrice = input.people > 0 ? input.amountTotal / input.people : input.amountTotal;
        const items = [{
          description: input.productName,
          quantity: input.people,
          unitPrice,
          total: input.amountTotal,
          fiscalRegime: "general" as const,
        }];
        const subtotal = input.amountTotal;
        const bdManual = groupTaxBreakdown(items);
        const taxAmount = totalTaxAmount(bdManual);
        const taxRate = bdManual.length === 1 ? bdManual[0].rate : 21;
        const total = parseFloat((subtotal + taxAmount).toFixed(2));

        // 4. Generar PDF de factura
        let pdfUrl: string | null = null;
        let pdfKey: string | null = null;
        try {
          const pdf = await generateInvoicePdf({
            invoiceNumber,
            clientName: input.customerName,
            clientEmail: input.customerEmail,
            clientPhone: input.customerPhone ?? null,
            itemsJson: items,
            subtotal: String(subtotal),
            taxRate: String(taxRate),
            taxAmount: String(taxAmount),
            total: String(total),
            taxBreakdown: bdManual,
            issuedAt: now,
          });
          pdfUrl = pdf.url;
          pdfKey = pdf.key;
        } catch (e) {
          console.error("[createManual] PDF generation failed:", e);
        }

        // 5. Insertar factura
        const [invResult] = await db.insert(invoices).values({
          invoiceNumber,
          clientName: input.customerName,
          clientEmail: input.customerEmail,
          clientPhone: input.customerPhone ?? null,
          itemsJson: items,
          subtotal: String(subtotal),
          taxRate: String(taxRate),
          taxAmount: String(taxAmount),
          taxBreakdown: bdManual.length > 0 ? bdManual : undefined,
          total: String(total),
          pdfUrl,
          pdfKey,
          isAutomatic: false,
          status: "generada",
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const invoiceId = (invResult as { insertId: number }).insertId;

        // 6. Insertar reserva
        const reservationNumberManual = await generateReservationNum("crm:createManual", String(ctx.user.id));
        const [resResult] = await db.insert(reservations).values({
          productId: input.productId,
          productName: input.productName,
          bookingDate: input.bookingDate,
          people: input.people,
          amountTotal: Math.round(input.amountTotal * 100),
          amountPaid: Math.round(input.amountPaid * 100),
          status: "paid",
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? "",
          channel: input.channel,
          paymentMethod: input.paymentMethod,
          merchantOrder,
          reservationNumber: reservationNumberManual,
          invoiceId,
          invoiceNumber,
          notes: input.notes ?? `Reserva creada manualmente por ${ctx.user.name ?? ctx.user.id}`,
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

        // 7. Actualizar reservationId en la factura
        await db.update(invoices).set({ reservationId }).where(eq(invoices.id, invoiceId));

        // 8. postConfirmOperation: booking + transacción + reservation_operational
        try {
          await postConfirmOperation({
            reservationId,
            productId: input.productId,
            productName: input.productName,
            serviceDate: input.bookingDate,
            people: input.people,
            amountCents: Math.round(input.amountPaid * 100),
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone ?? null,
            totalAmount: input.amountPaid,
            paymentMethod: input.paymentMethod === "tarjeta_fisica" ? "tarjeta_fisica" : input.paymentMethod === "tarjeta_redsys" ? "tarjeta_redsys" : input.paymentMethod === "redsys" ? "redsys" : input.paymentMethod === "transferencia" ? "transferencia" : input.paymentMethod === "efectivo" ? "efectivo" : "otro",
            saleChannel: "admin",
            invoiceNumber,
            reservationRef: merchantOrder,
          });
        } catch (e) {
          console.error("[createManual] postConfirmOperation error:", e);
        }

        // 9. Email de confirmación al cliente
        if (input.sendConfirmationEmail && input.customerEmail) {
          try {
            const html = buildConfirmationHtml({
              clientName: input.customerName,
              reservationRef: merchantOrder,
              quoteTitle: input.productName,
              items: [{ description: input.productName, quantity: input.people, unitPrice, total: input.amountTotal }],
              total: `${input.amountTotal.toFixed(2)} €`,
              bookingDate: input.bookingDate,
              contactEmail: await getBusinessEmail('reservations'),
              contactPhone: "+34 911 67 51 89",
            });
            await sendEmail({
              to: input.customerEmail,
              subject: `✅ Confirmación de reserva — ${input.productName} · Náyade Experiences`,
              html,
            });
          } catch (e) {
            console.error("[createManual] Email send error:", e);
          }
        }

        // 10. Registrar actividad
        await logActivity(
          "reservation",
          reservationId,
          "reservation_created",
          ctx.user.id,
          ctx.user.name,
          {
            productName: input.productName,
            customerName: input.customerName,
            bookingDate: input.bookingDate,
            people: input.people,
            amountPaid: input.amountPaid,
            invoiceNumber,
            merchantOrder,
            channel: input.channel,
            createdBy: ctx.user.name ?? ctx.user.id,
          }
        ).catch(() => {});

         return {
          ok: true,
          reservationId,
          invoiceId,
          invoiceNumber,
          merchantOrder,
          pdfUrl,
        };
      }),

    // ─── Descargar PDF de reserva ──────────────────────────────────────────────────
    downloadPdf: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const [res] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!res) throw new TRPCError({ code: "NOT_FOUND" });
        const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
        const channelLabels: Record<string, string> = {
          ONLINE_DIRECTO: "Online Directo", ONLINE_ASISTIDO: "Online Asistido",
          VENTA_DELEGADA: "Venta Delegada", TPV_FISICO: "TPV Físico",
          PARTNER: "Partner", MANUAL: "Manual", API: "API",
          web: "Web", crm: "CRM", telefono: "Teléfono", email: "Email",
          otro: "Otro", tpv: "TPV", groupon: "Groupon",
        };
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          body{font-family:Arial,sans-serif;color:#1a1a2e;margin:0;padding:32px;}
          .header{background:#1a3a5c;color:#fff;padding:24px 32px;border-radius:8px 8px 0 0;}
          .header h1{margin:0;font-size:22px;} .header p{margin:4px 0;font-size:13px;opacity:.8;}
          .section{padding:20px 0;border-bottom:1px solid #e5e7eb;}
          .section h2{font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;}
          .row{display:flex;justify-content:space-between;margin:6px 0;font-size:13px;}
          .label{color:#6b7280;} .value{font-weight:600;color:#1a1a2e;}
          .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;}
          .badge-blue{background:#dbeafe;color:#1d4ed8;} .badge-green{background:#dcfce7;color:#15803d;}
          .badge-amber{background:#fef3c7;color:#92400e;} .badge-red{background:#fee2e2;color:#b91c1c;}
          .badge-gray{background:#f3f4f6;color:#374151;}
          .total-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin-top:16px;}
          .total-box .amount{font-size:28px;font-weight:800;color:#1a3a5c;}
          .footer{margin-top:32px;text-align:center;font-size:11px;color:#9ca3af;}
          .tag{display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-left:8px;}
        </style></head><body>
          <div class="header">
            <h1>Reserva #${res.merchantOrder}${res.dateModified ? '<span class="tag">⚠️ FECHA MODIFICADA</span>' : ""}</h1>
            <p>Náyade Experiences • Los Ángeles de San Rafael, Segovia</p>
          </div>
          <div style="padding:0 0 0 0;">
            <div class="section">
              <h2>Cliente</h2>
              <div class="row"><span class="label">Nombre</span><span class="value">${res.customerName}</span></div>
              ${res.customerEmail ? `<div class="row"><span class="label">Email</span><span class="value">${res.customerEmail}</span></div>` : ""}
              ${res.customerPhone ? `<div class="row"><span class="label">Teléfono</span><span class="value">${res.customerPhone}</span></div>` : ""}
            </div>
            <div class="section">
              <h2>Actividad</h2>
              <div class="row"><span class="label">Producto</span><span class="value">${res.productName}</span></div>
              <div class="row"><span class="label">Fecha actividad</span><span class="value">${res.bookingDate}</span></div>
              <div class="row"><span class="label">Personas</span><span class="value">${res.people}</span></div>
              ${res.dateModified && res.dateChangedReason ? `<div class="row"><span class="label">Motivo cambio fecha</span><span class="value" style="color:#92400e">${res.dateChangedReason}</span></div>` : ""}
            </div>
            <div class="section">
              <h2>Estado</h2>
              <div class="row">
                <span class="label">Estado reserva</span>
                <span class="value">${res.statusReservation ?? "PENDIENTE_CONFIRMACION"}</span>
              </div>
              <div class="row">
                <span class="label">Estado pago</span>
                <span class="value">${res.statusPayment ?? "PENDIENTE"}</span>
              </div>
              <div class="row"><span class="label">Canal</span><span class="value">${channelLabels[res.channel ?? ""] ?? res.channel ?? ""}${res.channelDetail ? " — " + res.channelDetail : ""}</span></div>
              <div class="row"><span class="label">Método de pago</span><span class="value">${({ tarjeta_fisica: "Tarjeta Física", tarjeta_redsys: "Tarjeta Redsys", redsys: "Tarjeta Redsys", tarjeta: "Tarjeta", transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro" } as Record<string, string>)[res.paymentMethod ?? ""] ?? res.paymentMethod ?? "—"}</span></div>
              <div class="row"><span class="label">Fecha de compra</span><span class="value">${new Date(res.createdAt).toLocaleDateString("es-ES")}</span></div>
            </div>
            <div class="total-box">
              <div class="row"><span class="label">Importe total</span></div>
              <div class="amount">${amountEur.toFixed(2)} €</div>
              ${res.invoiceNumber ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Factura: ${res.invoiceNumber}</div>` : ""}
            </div>
          </div>
          <div class="footer">Generado por Náyade Experiences CRM • ${new Date().toLocaleDateString("es-ES")}</div>
        </body></html>`;
        const pdfBuffer = await htmlToPdf(html);
        const key = `reservations/pdf-${res.merchantOrder}-${Date.now()}.pdf`;
        const { url } = await storagePut(key, pdfBuffer, "application/pdf");
        return { url };
      }),
  }),
  // ─── INVOICES ──────────────────────────────────────────────────────────────

  invoices: router({
    list: staff
      .input(z.object({ quoteId: z.number().optional(), limit: z.number().default(50), offset: z.number().default(0) }))
      .query(async ({ input }) => {
        const conditions = input.quoteId ? [eq(invoices.quoteId, input.quoteId)] : [];
        return db
          .select()
          .from(invoices)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(invoices.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.id));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        return invoice;
      }),

    // ─── Regenerar PDF de factura existente ───────────────────────────────────
    regeneratePdf: staff
      .input(z.object({ invoiceId: z.number() }))
      .mutation(async ({ input }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        const pdf = await generateInvoicePdf({
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName,
          clientEmail: invoice.clientEmail,
          clientPhone: invoice.clientPhone,
          clientNif: invoice.clientNif,
          clientAddress: invoice.clientAddress,
          itemsJson: (invoice.itemsJson as any[]) ?? [],
          subtotal: invoice.subtotal,
          taxRate: invoice.taxRate ?? "21",
          taxAmount: invoice.taxAmount ?? "0",
          taxBreakdown: (invoice.taxBreakdown as any) ?? undefined,
          total: invoice.total,
          issuedAt: invoice.issuedAt,
        });

        await db.update(invoices)
          .set({ pdfUrl: pdf.url, pdfKey: pdf.key, updatedAt: new Date() })
          .where(eq(invoices.id, input.invoiceId));

        return { pdfUrl: pdf.url };
      }),

    // ─── Listado completo con filtros ──────────────────────────────────────────
    listAll: staff
      .input(z.object({
        status: z.enum(["generada", "enviada", "cobrada", "anulada", "abonada"]).optional(),
        invoiceType: z.enum(["factura", "abono"]).optional(),
        paymentMethod: z.enum(["redsys", "transferencia", "efectivo", "otro"]).optional(),
        search: z.string().optional(),
        dateFrom: z.string().optional(), // ISO date string YYYY-MM-DD
        dateTo: z.string().optional(),   // ISO date string YYYY-MM-DD
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const conditions: SQL[] = [];
        if (input.status) conditions.push(eq(invoices.status, input.status));
        if (input.invoiceType) conditions.push(eq(invoices.invoiceType, input.invoiceType));
        if (input.paymentMethod) conditions.push(eq(invoices.paymentMethod, input.paymentMethod));
        if (input.search) {
          const s = `%${input.search}%`;
          conditions.push(or(
            like(invoices.invoiceNumber, s),
            like(invoices.clientName, s),
            like(invoices.clientEmail, s),
            like(invoices.clientPhone, s),
            like(invoices.clientNif, s),
            like(invoices.clientAddress, s),
          ) as SQL);
        }
        if (input.dateFrom) {
          const from = new Date(input.dateFrom);
          from.setHours(0, 0, 0, 0);
          conditions.push(gte(invoices.createdAt, from));
        }
        if (input.dateTo) {
          const to = new Date(input.dateTo);
          to.setHours(23, 59, 59, 999);
          conditions.push(lte(invoices.createdAt, to));
        }
        const whereClause = conditions.length ? and(...conditions) : undefined;

        // Condiciones base solo sobre facturas originales (no abonos) para el cálculo neto
        const facturaOnlyConditions = [...conditions, eq(invoices.invoiceType, "factura")];
        const abonoOnlyConditions = [...conditions, eq(invoices.invoiceType, "abono")];

        const [rows, [{ total }], [{ subtotalSum, taxSum, grandTotal }], [{ abonosTotal }]] = await Promise.all([
          db.select().from(invoices)
            .where(whereClause)
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(invoices).where(whereClause),
          db.select({
            subtotalSum: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`subtotal\` ELSE 0 END), 0)`,
            taxSum: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`taxAmount\` ELSE 0 END), 0)`,
            grandTotal: sql<string>`COALESCE(SUM(CASE WHEN \`invoiceType\` = 'factura' THEN \`total\` ELSE 0 END), 0)`,
          }).from(invoices).where(whereClause),
          db.select({
            abonosTotal: sql<string>`COALESCE(SUM(ABS(\`total\`)), 0)`,
          }).from(invoices).where(and(...(abonoOnlyConditions.length ? abonoOnlyConditions : [eq(invoices.invoiceType, "abono")]))),
        ]);

        // Enriquecer filas: para facturas abonadas → buscar su nº de abono; para abonos → nº de factura original
        const abonadaIds = rows.filter(r => r.status === "abonada").map(r => r.id);
        const abonoRows = rows.filter(r => r.invoiceType === "abono" && r.creditNoteForId);
        const originalIds = abonoRows.map(r => r.creditNoteForId!);

        // Batch-fetch credit notes linked to abonada invoices
        const creditNoteMap: Record<number, string> = {}; // originalInvoiceId → abonoInvoiceNumber
        if (abonadaIds.length > 0) {
          const creditNotes = await db.select({ creditNoteForId: invoices.creditNoteForId, invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(sql`${invoices.creditNoteForId} IN (${sql.join(abonadaIds.map(id => sql`${id}`), sql`, `)})`);
          for (const cn of creditNotes) {
            if (cn.creditNoteForId) creditNoteMap[cn.creditNoteForId] = cn.invoiceNumber;
          }
        }

        // Batch-fetch original invoice numbers for abono rows
        const originalInvoiceMap: Record<number, string> = {}; // abonoId → originalInvoiceNumber
        if (originalIds.length > 0) {
          const originals = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(sql`${invoices.id} IN (${sql.join(originalIds.map(id => sql`${id}`), sql`, `)})`);
          for (const orig of originals) {
            // map by creditNoteForId (the abono's FK pointing to original)
            const abonoRow = abonoRows.find(r => r.creditNoteForId === orig.id);
            if (abonoRow) originalInvoiceMap[abonoRow.id] = orig.invoiceNumber;
          }
        }

        const enrichedRows = rows.map(r => ({
          ...r,
          // Si esta factura está abonada, el nº del abono emitido
          creditNoteNumber: r.status === "abonada" ? (creditNoteMap[r.id] ?? null) : null,
          // Si este documento ES un abono, el nº de la factura original que rectifica
          originalInvoiceNumber: r.invoiceType === "abono" ? (originalInvoiceMap[r.id] ?? null) : null,
        }));

        const grossTotal = Number(grandTotal);
        const abonosAmt = Number(abonosTotal);

        return {
          items: enrichedRows,
          total,
          summary: {
            subtotal: Number(subtotalSum),
            tax: Number(taxSum),
            grandTotal: grossTotal,
            abonosTotal: abonosAmt,
            netTotal: grossTotal - abonosAmt,
          },
        };
      }),

    // ─── Confirmar pago manual (transferencia / efectivo) ──────────────────────
    confirmManualPayment: staff
      .input(z.object({
        invoiceId: z.number(),
        paymentMethod: z.enum(["transferencia", "efectivo", "otro"]),
        transferProofUrl: z.string().url().optional(),
        transferProofKey: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        if (invoice.status === "cobrada") throw new TRPCError({ code: "BAD_REQUEST", message: "La factura ya está marcada como cobrada" });

        const now = new Date();
        await db.update(invoices).set({
          status: "cobrada",
          paymentMethod: input.paymentMethod,
          paymentValidatedBy: ctx.user.id,
          paymentValidatedAt: now,
          transferProofUrl: input.transferProofUrl ?? null,
          transferProofKey: input.transferProofKey ?? null,
          isAutomatic: false,
          updatedAt: now,
        }).where(eq(invoices.id, input.invoiceId));

        // Update linked reservation if exists
        if (invoice.reservationId) {
          await db.update(reservations).set({
            status: "paid",
            paymentMethod: input.paymentMethod,
            paymentValidatedBy: ctx.user.id,
            paymentValidatedAt: Date.now(),
            transferProofUrl: input.transferProofUrl ?? null,
            paidAt: Date.now(),
            updatedAt: Date.now(),
          }).where(eq(reservations.id, invoice.reservationId));
        }
        // Update linked quote if exists
        if (invoice.quoteId) {
          await db.update(quotes).set({
            status: "aceptado",
            paidAt: now,
            updatedAt: now,
          }).where(eq(quotes.id, invoice.quoteId));
        }

        // Send confirmation email to client
        try {
          const [linkedQuote] = invoice.quoteId
            ? await db.select().from(quotes).where(eq(quotes.id, invoice.quoteId))
            : [null];
          const [linkedLead] = linkedQuote?.leadId
            ? await db.select().from(leads).where(eq(leads.id, linkedQuote.leadId))
            : [null];
          if (invoice.clientEmail) {
            const reservationRef = invoice.invoiceNumber.replace("FAC", "RES");
            await sendConfirmationEmail({
              clientName: invoice.clientName ?? "Cliente",
              clientEmail: invoice.clientEmail,
              reservationRef,
              quoteTitle: invoice.invoiceNumber,
              total: Number(invoice.total).toFixed(2),
              items: (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [],
              invoiceUrl: invoice.pdfUrl ?? undefined,
            });
          }
        } catch (emailErr) {
          console.error("[confirmManualPayment] Email error:", emailErr);
        }

        await logActivity("invoice", invoice.id, "payment_confirmed_manual", ctx.user.id, ctx.user.name, {
          paymentMethod: input.paymentMethod,
          transferProofUrl: input.transferProofUrl,
          notes: input.notes,
        });
        // ── PARIDAD: Generar PDF de factura si no existe ya ──────────────────────
        const items = (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; productId?: number }[]) ?? [];
        let finalPdfUrl = invoice.pdfUrl ?? null;
        let finalPdfKey = invoice.pdfKey ?? null;
        // Regenerar si no hay URL o si apunta a /local-storage (archivo temporal ya perdido)
        if (!finalPdfUrl || finalPdfUrl.startsWith("/local-storage")) {
          try {
            const pdf = await generateInvoicePdf({
              invoiceNumber: invoice.invoiceNumber,
              clientName: invoice.clientName ?? "Cliente",
              clientEmail: invoice.clientEmail ?? undefined,
              clientPhone: invoice.clientPhone ?? undefined,
              itemsJson: items,
              subtotal: invoice.subtotal ?? "0",
              taxRate: invoice.taxRate ?? "21",
              taxAmount: invoice.taxAmount ?? "0",
              total: invoice.total ?? "0",
              issuedAt: now,
            });
            finalPdfUrl = pdf.url;
            finalPdfKey = pdf.key;
            await db.update(invoices).set({ pdfUrl: finalPdfUrl, pdfKey: finalPdfKey, updatedAt: now }).where(eq(invoices.id, input.invoiceId));
            await logActivity("invoice", invoice.id, "pdf_generated", ctx.user.id, ctx.user.name, { pdfUrl: finalPdfUrl });
          } catch (pdfErr) {
            console.error("[confirmManualPayment] PDF generation failed:", pdfErr);
          }
        }

        // ── PARIDAD: Crear expediente REAV si hay líneas REAV ─────────────────────
        const reavLines = items.filter(i => i.fiscalRegime === "reav");
        let reavExpedientId: number | undefined;
        let reavExpedientNumber: string | undefined;
        if (reavLines.length > 0 && invoice.reservationId) {
          try {
            // Comprobar si ya existe un expediente REAV para esta reserva (evitar duplicados)
            const [existingReav] = await db.select({ id: reavExpedients.id })
              .from(reavExpedients)
              .where(eq(reavExpedients.reservationId, invoice.reservationId))
              .limit(1);
            if (!existingReav) {
              const reavSaleAmount = reavLines.reduce((s, i) => s + i.total, 0);
              let reavCostePct = 60;
              let reavMargenPct = 40;
              const firstReavLine = reavLines[0] as any;
              const reavProductId = firstReavLine?.productId;
              if (reavProductId) {
                const [reavProduct] = await db.select({
                  providerPercent: experiences.providerPercent,
                  agencyMarginPercent: experiences.agencyMarginPercent,
                  fiscalRegime: experiences.fiscalRegime,
                }).from(experiences).where(eq(experiences.id, reavProductId)).limit(1);
                if (reavProduct && reavProduct.fiscalRegime === "reav") {
                  const errores = validarConfiguracionREAV(reavProduct);
                  if (errores.length === 0) {
                    reavCostePct = parseFloat(String(reavProduct.providerPercent ?? 60));
                    reavMargenPct = parseFloat(String(reavProduct.agencyMarginPercent ?? 40));
                  } else {
                    console.warn("[confirmManualPayment] Configuración REAV inválida, usando fallback 60/40:", errores);
                  }
                }
              }
              const reavCalc = calcularREAVSimple(reavSaleAmount, reavCostePct, reavMargenPct);
              const [res] = await db.select().from(reservations).where(eq(reservations.id, invoice.reservationId));
              const serviceDate = res?.bookingDate ?? now.toISOString().split("T")[0];
              const reavResult = await createReavExpedient({
                invoiceId: invoice.id,
                reservationId: invoice.reservationId,
                quoteId: invoice.quoteId ?? undefined,
                serviceDescription: reavLines.map(i => i.description).join(" | "),
                serviceDate,
                numberOfPax: res?.people ?? 1,
                saleAmountTotal: String(reavSaleAmount),
                providerCostEstimated: String(reavCalc.costeProveedor),
                agencyMarginEstimated: String(reavCalc.margenAgencia),
                clientName: invoice.clientName ?? undefined,
                clientEmail: invoice.clientEmail ?? undefined,
                clientPhone: invoice.clientPhone ?? undefined,
                channel: "crm",
                sourceRef: invoice.invoiceNumber,
                internalNotes: [
                  `Expediente creado automáticamente al confirmar pago manual de la factura ${invoice.invoiceNumber}.`,
                  invoice.clientName ? `Cliente: ${invoice.clientName}` : null,
                  invoice.clientEmail ? `Email: ${invoice.clientEmail}` : null,
                  invoice.clientPhone ? `Teléfono: ${invoice.clientPhone}` : null,
                  `Importe REAV: ${reavSaleAmount.toFixed(2)}€`,
                  `Agente: ${ctx.user.name ?? ctx.user.email}`,
                ].filter(Boolean).join(" · "),
              });
              reavExpedientId = reavResult.id;
              reavExpedientNumber = reavResult.expedientNumber;
              // Adjuntar factura PDF al expediente
              if (finalPdfUrl && reavExpedientId) {
                await attachReavDocument({
                  expedientId: reavExpedientId,
                  side: "client",
                  docType: "factura_emitida",
                  title: `Factura ${invoice.invoiceNumber}`,
                  fileUrl: finalPdfUrl,
                  mimeType: "application/pdf",
                  notes: `Factura generada al confirmar pago manual. Método: ${input.paymentMethod}.`,
                  uploadedBy: ctx.user.id,
                });
              }
              // Adjuntar presupuesto PDF al expediente si existe
              const [linkedQuoteForReav] = invoice.quoteId
                ? await db.select().from(quotes).where(eq(quotes.id, invoice.quoteId))
                : [null];
              if (linkedQuoteForReav && (linkedQuoteForReav as any).pdfUrl && reavExpedientId) {
                await attachReavDocument({
                  expedientId: reavExpedientId,
                  side: "client",
                  docType: "otro",
                  title: `Presupuesto ${(linkedQuoteForReav as any).quoteNumber ?? invoice.quoteId}`,
                  fileUrl: (linkedQuoteForReav as any).pdfUrl,
                  mimeType: "application/pdf",
                  notes: `Presupuesto original aceptado por el cliente.`,
                  uploadedBy: ctx.user.id,
                });
              }
              await logActivity("invoice", invoice.id, "reav_expedient_created", ctx.user.id, ctx.user.name, { expedientId: reavExpedientId, expedientNumber: reavExpedientNumber });
            }
          } catch (reavErr) {
            console.error("[confirmManualPayment] Error al crear expediente REAV:", reavErr);
          }
        }

        // ── Crear booking operativo + transacción contable ────────────────────────
        if (invoice.reservationId) {
          try {
            const [res] = await db.select().from(reservations).where(eq(reservations.id, invoice.reservationId));
            if (res) {
              const generalSubtotalForTx = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
              const reavSubtotalForTx = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
              const taxAmountForTx = totalTaxAmount(groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav")));
              const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
                : reavSubtotalForTx > 0 ? "reav" : "general";
              await postConfirmOperation({
                reservationId: res.id,
                productId: res.productId,
                productName: res.productName,
                serviceDate: res.bookingDate ?? now.toISOString().split("T")[0],
                people: res.people,
                amountCents: res.amountPaid ?? res.amountTotal,
                customerName: res.customerName,
                customerEmail: res.customerEmail ?? "",
                customerPhone: res.customerPhone,
                totalAmount: parseFloat(invoice.total ?? "0"),
                paymentMethod: input.paymentMethod as "transferencia" | "efectivo" | "otro",
                saleChannel: "admin",
                invoiceNumber: invoice.invoiceNumber,
                reservationRef: invoice.invoiceNumber.replace("FAC", "RES"),
                sellerUserId: ctx.user.id,
                sellerName: ctx.user.name ?? undefined,
                taxBase: generalSubtotalForTx,
                taxAmount: taxAmountForTx,
                reavMargin: reavSubtotalForTx,
                fiscalRegime: fiscalRegimeForTx,
                description: `Pago manual — ${invoice.invoiceNumber} — ${res.customerName}`,
                quoteId: invoice.quoteId ?? null,
                sourceChannel: input.paymentMethod as "transferencia" | "efectivo" | "otro",
              });
            }
          } catch (e) { console.error("[confirmManualPayment] Error en postConfirmOperation:", e); }
        }
        return { success: true, pdfUrl: finalPdfUrl, reavExpedientId, reavExpedientNumber };
      }),
    // ─── Generar factura de abonono (rectificativa) ──────────────────────────────
    createCreditNote: staff
      .input(z.object({
        invoiceId: z.number(),
        reason: z.string().min(1),
        partialAmount: z.number().optional(), // if undefined → full credit note
      }))
      .mutation(async ({ input, ctx }) => {
        const [original] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });
        if (original.invoiceType === "abono") throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede abonar una factura de abono" });
        if (original.status === "anulada") throw new TRPCError({ code: "BAD_REQUEST", message: "La factura ya está anulada" });

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const seq = await db.select({ cnt: count() }).from(invoices)
          .where(and(like(invoices.invoiceNumber, `ABO-${year}-${month}-%`), eq(invoices.invoiceType, "abono")));
        const seqNum = String((seq[0]?.cnt ?? 0) + 1).padStart(4, "0");
        const creditNoteNumber = `ABO-${year}-${month}-${seqNum}`;

        const creditTotal = input.partialAmount ?? Number(original.total);
        const origTaxRate = parseFloat(String(original.taxRate ?? "21"));
        const creditDivisor = 1 + origTaxRate / 100;
        const creditSubtotal = creditTotal / creditDivisor;
        const creditTax = creditTotal - creditSubtotal;

        // Negate items for credit note
        const creditItems = (original.itemsJson as { description: string; quantity: number; unitPrice: number; total: number }[]).map(item => ({
          ...item,
          unitPrice: -Math.abs(item.unitPrice),
          total: -Math.abs(item.total),
        }));

        const [result] = await db.insert(invoices).values({
          invoiceNumber: creditNoteNumber,
          invoiceType: "abono",
          quoteId: original.quoteId,
          reservationId: original.reservationId,
          clientName: original.clientName,
          clientEmail: original.clientEmail,
          clientPhone: original.clientPhone,
          clientNif: original.clientNif,
          clientAddress: original.clientAddress,
          itemsJson: creditItems,
          subtotal: String(-creditSubtotal),
          taxRate: original.taxRate,
          taxAmount: String(-creditTax),
          total: String(-creditTotal),
          currency: original.currency,
          status: "generada",
          creditNoteForId: original.id,
          creditNoteReason: input.reason,
          isAutomatic: false,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const creditNoteId = (result as any).insertId;

        // Mark original as abonada
        await db.update(invoices).set({
          status: "abonada",
          updatedAt: now,
        }).where(eq(invoices.id, input.invoiceId));

        await logActivity("invoice", input.invoiceId, "credit_note_created", ctx.user.id, ctx.user.name, { creditNoteId, creditNoteNumber, reason: input.reason });

        return { success: true, creditNoteId, creditNoteNumber };
      }),

    // ─── Reenviar factura por email ────────────────────────────────────────────
    resend: staff
      .input(z.object({
        invoiceId: z.number(),
        toEmail: z.string().email().optional(), // override recipient
      }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        const COPY_EMAIL = await getBusinessEmail('reservations');
        const recipient = input.toEmail ?? invoice.clientEmail;
        const now = new Date();

        try {
          const subject = invoice.invoiceType === "abono"
            ? `Factura de abono ${invoice.invoiceNumber} — Náyade Experiences`
            : `Tu factura ${invoice.invoiceNumber} — Náyade Experiences`;

          const items = (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
          const htmlBody = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#f97316;">Náyade Experiences</h2>
              <p>Estimado/a <strong>${invoice.clientName}</strong>,</p>
              <p>Adjuntamos ${invoice.invoiceType === "abono" ? "la factura de abono" : "tu factura"} <strong>${invoice.invoiceNumber}</strong>.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Descripción</th><th style="padding:8px;text-align:right;">Cant.</th><th style="padding:8px;text-align:right;">Precio</th><th style="padding:8px;text-align:right;">Total</th></tr>
                ${items.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${i.description}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;">${i.quantity}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;">${Number(i.unitPrice).toFixed(2)} €</td><td style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;">${Number(i.total).toFixed(2)} €</td></tr>`).join("")}
              </table>
              <p><strong>Subtotal:</strong> ${Number(invoice.subtotal).toFixed(2)} € | <strong>IVA (${invoice.taxRate}%):</strong> ${Number(invoice.taxAmount).toFixed(2)} € | <strong>TOTAL: ${Number(invoice.total).toFixed(2)} €</strong></p>
              ${invoice.pdfUrl ? `<p><a href="${invoice.pdfUrl}" style="color:#f97316;">Descargar PDF de la factura</a></p>` : ""}
              <hr/><p style="color:#6b7280;font-size:12px;">Náyade Experiences · ${COPY_EMAIL} · +34 911 67 51 89 (también WhatsApp)</p>
            </div>`;

          await sharedSendEmail({ to: recipient, subject, html: htmlBody });
          await sharedSendEmail({ to: COPY_EMAIL, subject: `[COPIA] ${subject}`, html: htmlBody });

          await db.update(invoices).set({
            status: invoice.status === "generada" ? "enviada" : invoice.status,
            sentAt: invoice.sentAt ?? now,
            lastSentAt: now,
            sentCount: (invoice.sentCount ?? 0) + 1,
            updatedAt: now,
          }).where(eq(invoices.id, input.invoiceId));

          await logActivity("invoice", invoice.id, "invoice_resent", ctx.user.id, ctx.user.name, { recipient });

          return { success: true, sentTo: recipient };
          } catch (e) {
          console.error("[Invoice Resend] Error:", e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al enviar el email" });
        }
      }),


    // ─── Anular factura ────────────────────────────────────────────────────────
    void: staff
      .input(z.object({ invoiceId: z.number(), reason: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
        if (["anulada", "abonada"].includes(invoice.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `La factura ya está ${invoice.status}` });
        }
        const now = new Date();
        await db.update(invoices).set({ status: "anulada", updatedAt: now }).where(eq(invoices.id, input.invoiceId));
        await logActivity("invoice", invoice.id, "invoice_voided", ctx.user.id, ctx.user.name, { reason: input.reason });
        return { success: true };
      }),

    delete: staff
      .input(z.object({ invoiceId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

        // Desvincular reservas asociadas (limpiar invoiceId e invoiceNumber)
        await db.update(reservations)
          .set({ invoiceId: null, invoiceNumber: null, updatedAt: Date.now() } as any)
          .where(eq(reservations.invoiceId, input.invoiceId));

        // Si hay presupuesto vinculado, revertir a estado anterior al pago
        if (invoice.quoteId) {
          await db.update(quotes)
            .set({ status: "enviado", paidAt: null, invoiceNumber: null, updatedAt: new Date() } as any)
            .where(eq(quotes.id, invoice.quoteId));
        }

        // Eliminar la factura
        await db.delete(invoices).where(eq(invoices.id, input.invoiceId));

        await logActivity("invoice", invoice.id, "invoice_deleted", ctx.user.id, ctx.user.name, {
          invoiceNumber: invoice.invoiceNumber,
          quoteId: invoice.quoteId ?? null,
        });
        return { success: true };
      }),
  }),

  // ─── CLIENTS ────────────────────────────────────────────────────────────────
  clients: router({
    list: staff.input(z.object({
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    })).query(async ({ input }) => {
      const conditions: ReturnType<typeof like>[] = [];
      if (input.search) {
        conditions.push(or(
          like(clients.name, `%${input.search}%`),
          like(clients.email, `%${input.search}%`),
          like(clients.company, `%${input.search}%`),
        ) as ReturnType<typeof like>);
      }
      const rows = await db.select().from(clients)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(clients.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [{ total }] = await db.select({ total: count() }).from(clients)
        .where(conditions.length ? and(...conditions) : undefined);
      return { items: rows, total };
    }),
    get: staff.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const [client] = await db.select().from(clients).where(eq(clients.id, input.id));
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      // Get associated quotes
      const clientQuotes = await db.select().from(quotes)
        .where(like(quotes.title, `%${client.name}%`))
        .orderBy(desc(quotes.createdAt)).limit(20);
      return { ...client, quotes: clientQuotes };
    }),
    create: staff.input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      company: z.string().optional(),
      nif: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const [result] = await db.insert(clients).values({
        name: input.name,
        email: input.email,
        phone: input.phone ?? "",
        company: input.company ?? "",
        nif: input.nif ?? "",
        address: input.address,
        notes: input.notes,
        source: "manual",
      });
      return { id: (result as any).insertId };
    }),
    update: staff.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      birthDate: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;

      // Get current client to find its leadId for cascade
      const [current] = await db.select({ leadId: clients.leadId }).from(clients).where(eq(clients.id, id));

      await db.update(clients).set(data as any).where(eq(clients.id, id));

      // Propagate name/email/phone changes to lead, quotes and reservations
      if (current?.leadId) {
        const leadUpdate: Record<string, string> = {};
        if (data.name) leadUpdate.name = data.name;
        if (data.email) leadUpdate.email = data.email;
        if (data.phone !== undefined) leadUpdate.phone = data.phone as string;

        if (Object.keys(leadUpdate).length > 0) {
          await db.update(leads).set(leadUpdate as any).where(eq(leads.id, current.leadId));

          // Propagate to reservations linked through quotes
          const relatedQuotes = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.leadId, current.leadId));
          if (relatedQuotes.length > 0) {
            const qIds = relatedQuotes.map((q) => q.id);
            const resUpdate: Record<string, string> = {};
            if (data.name) resUpdate.customerName = data.name;
            if (data.email) resUpdate.customerEmail = data.email;
            if (data.phone !== undefined) resUpdate.customerPhone = data.phone as string;
            await db.update(reservations).set(resUpdate as any).where(inArray(reservations.quoteId, qIds));
          }
        }
      }

      return { success: true };
    }),
    // Ampliar datos del cliente cuando se convierte (presupuesto → reserva)
    expand: staff.input(z.object({
      id: z.number(),
      nif: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      birthDate: z.string().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(clients)
        .set({ ...data as any, isConverted: true })
        .where(eq(clients.id, id));
      return { success: true };
    }),
    delete: staff.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.delete(clients).where(eq(clients.id, input.id));
      return { success: true };
    }),

    getHistory: staff.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const [client] = await db.select().from(clients).where(eq(clients.id, input.id));
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });

      // Lead vinculado
      const lead = client.leadId
        ? (await db.select().from(leads).where(eq(leads.id, client.leadId)))[0] ?? null
        : null;

      // Presupuestos vinculados al lead (o por email si no hay lead directo)
      let clientQuotes: typeof quotes.$inferSelect[] = [];
      let resolvedLeadId = client.leadId;
      if (!resolvedLeadId && client.email) {
        const [leadByEmail] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, client.email)).limit(1);
        if (leadByEmail) resolvedLeadId = leadByEmail.id;
      }
      if (resolvedLeadId) {
        clientQuotes = await db.select().from(quotes)
          .where(eq(quotes.leadId, resolvedLeadId))
          .orderBy(desc(quotes.createdAt));
      }

      const quoteIds = clientQuotes.map((q) => q.id);

      // Reservas, facturas, anulaciones en paralelo
      // Reservas: por quoteId O por email del cliente (cubre reservas directas sin presupuesto)
      const reservationCondition = quoteIds.length && client.email
        ? or(inArray(reservations.quoteId, quoteIds), eq(reservations.customerEmail, client.email))
        : quoteIds.length
          ? inArray(reservations.quoteId, quoteIds)
          : client.email
            ? eq(reservations.customerEmail, client.email)
            : null;

      // Reservas primero — necesitamos sus IDs para ampliar la búsqueda de facturas
      const clientReservations = reservationCondition
        ? await db.select().from(reservations).where(reservationCondition).orderBy(desc(reservations.createdAt))
        : [];

      const reservationIds = clientReservations.map((r) => r.id);

      // Facturas: por quoteId (flujo CRM) OR por reservationId (flujo Redsys/TPV directo)
      // Las reservas online no pasan por presupuesto → quoteId = null en la factura
      const invoiceConditions: ReturnType<typeof inArray>[] = [];
      if (quoteIds.length) invoiceConditions.push(inArray(invoices.quoteId, quoteIds));
      if (reservationIds.length) invoiceConditions.push(inArray(invoices.reservationId, reservationIds));

      // Condiciones de anulaciones: por quoteId O por reservationId (las creadas manualmente usan linkedReservationId)
      const cancellationConditions: ReturnType<typeof inArray>[] = [];
      if (quoteIds.length) cancellationConditions.push(inArray(cancellationRequests.linkedQuoteId, quoteIds));
      if (reservationIds.length) cancellationConditions.push(inArray(cancellationRequests.linkedReservationId, reservationIds));

      const [clientInvoices, clientCancellations] = await Promise.all([
        invoiceConditions.length
          ? db.select().from(invoices)
              .where(invoiceConditions.length === 1 ? invoiceConditions[0] : or(...invoiceConditions))
              .orderBy(desc(invoices.createdAt))
          : Promise.resolve([]),
        cancellationConditions.length
          ? db.select().from(cancellationRequests)
              .where(cancellationConditions.length === 1 ? cancellationConditions[0] : or(...cancellationConditions))
              .orderBy(desc(cancellationRequests.createdAt))
          : Promise.resolve([]),
      ]);

      // Deduplicar facturas por si aparecen por ambas condiciones (quoteId y reservationId)
      const seenInvoiceIds = new Set<number>();
      const dedupedInvoices = clientInvoices.filter((inv) => {
        if (seenInvoiceIds.has(inv.id)) return false;
        seenInvoiceIds.add(inv.id);
        return true;
      });

      // Usos de descuento vinculados a las reservas
      const clientDiscountUses = reservationIds.length
        ? await db.select().from(discountCodeUses).where(inArray(discountCodeUses.reservationId, reservationIds)).orderBy(desc(discountCodeUses.appliedAt))
        : [];

      // Activity log para todas las entidades relacionadas
      const invoiceIds = dedupedInvoices.map((i) => i.id);
      const leadIds = lead ? [lead.id] : [];

      const activityConditions = [];
      if (leadIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "lead"), inArray(crmActivityLog.entityId, leadIds)));
      if (quoteIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "quote"), inArray(crmActivityLog.entityId, quoteIds)));
      if (reservationIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "reservation"), inArray(crmActivityLog.entityId, reservationIds)));
      if (invoiceIds.length) activityConditions.push(and(eq(crmActivityLog.entityType, "invoice"), inArray(crmActivityLog.entityId, invoiceIds)));

      const activityLog = activityConditions.length
        ? await db.select().from(crmActivityLog)
            .where(or(...activityConditions))
            .orderBy(desc(crmActivityLog.createdAt))
            .limit(200)
        : [];

      // KPIs — totalSpentCents desde facturas activas (fuente de verdad del cobro real)
      const totalSpentCents = dedupedInvoices
        .filter((inv) => inv.status !== "anulada" && inv.status !== "abonada")
        .reduce((acc, inv) => acc + Math.round(parseFloat(inv.total ?? "0") * 100), 0);

      // ── Conversaciones WhatsApp (por teléfono o email) ────────────────────
      // GHL puede guardar teléfonos con o sin '+'; se normaliza eliminándolo en ambos lados.
      const waConditions: any[] = [];
      if (client.phone) {
        const normalizedPhone = client.phone.replace(/^\+/, "");
        waConditions.push(sql`REPLACE(${ghlConversations.phone}, '+', '') = ${normalizedPhone}`);
      }
      if (client.email) waConditions.push(eq(ghlConversations.email, client.email));
      const clientWhatsApp = waConditions.length
        ? await db.select({
            ghlConversationId: ghlConversations.ghlConversationId,
            customerName: ghlConversations.customerName,
            phone: ghlConversations.phone,
            lastMessagePreview: ghlConversations.lastMessagePreview,
            lastMessageAt: ghlConversations.lastMessageAt,
            status: ghlConversations.status,
            unreadCount: ghlConversations.unreadCount,
          }).from(ghlConversations)
            .where(waConditions.length === 1 ? waConditions[0] : or(...waConditions))
            .orderBy(desc(ghlConversations.lastMessageAt))
        : [];

      // ── Llamadas Vapi (por leadId, teléfono o email) ──────────────────────
      const vapiConditions: any[] = [];
      if (resolvedLeadId) vapiConditions.push(eq(vapiCalls.linkedLeadId, resolvedLeadId));
      if (client.phone) vapiConditions.push(eq(vapiCalls.phoneNumber, client.phone));
      if (client.email) vapiConditions.push(eq(vapiCalls.customerEmail, client.email));
      const rawVapiCalls = vapiConditions.length
        ? await db.select({
            id: vapiCalls.id,
            vapiCallId: vapiCalls.vapiCallId,
            phoneNumber: vapiCalls.phoneNumber,
            customerName: vapiCalls.customerName,
            startedAt: vapiCalls.startedAt,
            durationSeconds: vapiCalls.durationSeconds,
            status: vapiCalls.status,
            endedReason: vapiCalls.endedReason,
            summary: vapiCalls.summary,
            recordingUrl: vapiCalls.recordingUrl,
          }).from(vapiCalls)
            .where(vapiConditions.length === 1 ? vapiConditions[0] : or(...vapiConditions))
            .orderBy(desc(vapiCalls.startedAt))
        : [];
      // Deduplicar por vapiCallId
      const seenVapi = new Set<string>();
      const clientVapiCalls = rawVapiCalls.filter(c => {
        if (seenVapi.has(c.vapiCallId)) return false;
        seenVapi.add(c.vapiCallId);
        return true;
      });

      return {
        client,
        lead,
        quotes: clientQuotes,
        reservations: clientReservations,
        invoices: dedupedInvoices,
        cancellations: clientCancellations,
        discountUses: clientDiscountUses,
        activityLog,
        whatsappConversations: clientWhatsApp,
        vapiCalls: clientVapiCalls,
        kpis: {
          totalQuotes: clientQuotes.length,
          totalReservations: clientReservations.length,
          totalInvoices: dedupedInvoices.length,
          totalCancellations: clientCancellations.length,
          totalSpentCents,
          paidReservations: clientReservations.filter((r) => r.status === "paid").length,
          totalWhatsApp: clientWhatsApp.length,
          totalVapiCalls: clientVapiCalls.length,
        },
      };
    }),
  }),

  // ─── PRODUCTS SEARCH (para líneas de presupuesto) ────────────────────────────
  products: router({
    search: staff.input(z.object({
      q: z.string().optional(),
      limit: z.number().default(20),
      sourceType: z.enum(["all", "experience", "legoPack"]).default("all"),
    })).query(async ({ input }) => {
      const expConditions = input.q
        ? [or(like(experiences.title, `%${input.q}%`), like(experiences.shortDescription, `%${input.q}%`))]
        : [];
      const legoConditions = input.q
        ? [like(legoPacks.title, `%${input.q}%`)]
        : [];
      const fetchExp = input.sourceType === "all" || input.sourceType === "experience";
      const fetchLego = input.sourceType === "all" || input.sourceType === "legoPack";
      const [expRows, legoRows] = await Promise.all([
        fetchExp
          ? db.select({
              id: experiences.id,
              title: experiences.title,
              basePrice: experiences.basePrice,
              image: experiences.image1,
              coverImage: experiences.coverImageUrl,
              fiscalRegime: experiences.fiscalRegime,
              taxRate: experiences.taxRate,
              category: sql<string>`'experience'`,
              productType: sql<string>`'experience'`,
            }).from(experiences)
              .where(and(eq(experiences.isActive, true), ...(expConditions as any[])))
              .orderBy(experiences.title)
              .limit(input.limit)
          : Promise.resolve([]),
        fetchLego
          ? db.select({
              id: legoPacks.id,
              title: legoPacks.title,
              basePrice: sql<string>`'0'`,
              image: legoPacks.coverImageUrl,
              coverImage: legoPacks.coverImageUrl,
              fiscalRegime: sql<string>`'general'`,
              taxRate: sql<string>`'21'`,
              category: legoPacks.category,
              productType: sql<string>`'legoPack'`,
            }).from(legoPacks)
              .where(and(eq(legoPacks.isActive, true), ...(legoConditions as any[])))
              .orderBy(legoPacks.title)
              .limit(input.limit)
          : Promise.resolve([]),
      ]);

      // Attach variants to experience rows
      const expIds = (expRows as any[]).map((r: any) => r.id as number);
      const variantsByExpId: Record<number, any[]> = {};
      if (expIds.length > 0) {
        const varRows = await db.select({
          id: experienceVariants.id,
          experienceId: experienceVariants.experienceId,
          name: experienceVariants.name,
          description: experienceVariants.description,
          priceModifier: experienceVariants.priceModifier,
          priceType: experienceVariants.priceType,
          isRequired: experienceVariants.isRequired,
          sortOrder: experienceVariants.sortOrder,
        }).from(experienceVariants)
          .where(inArray(experienceVariants.experienceId, expIds))
          .orderBy(experienceVariants.sortOrder);
        for (const v of varRows) {
          if (!variantsByExpId[v.experienceId]) variantsByExpId[v.experienceId] = [];
          variantsByExpId[v.experienceId].push(v);
        }
      }
      return [
        ...(expRows as any[]).map((r: any) => ({ ...r, variants: variantsByExpId[r.id] ?? [] })),
        ...(legoRows as any[]),
      ];
    }),
  }),

  // --- PIPELINE (embudo comercial) ---
  pipeline: router({
    summary: staff.query(async () => {
      const [leadsData, quotesData, reservationsData] = await Promise.all([
        db.select({ cnt: count(), status: leads.opportunityStatus }).from(leads).groupBy(leads.opportunityStatus),
        db.select({ cnt: count(), status: quotes.status, total: sum(quotes.total) }).from(quotes).groupBy(quotes.status),
        db.select({ cnt: count(), total: sum(reservations.amountPaid) }).from(reservations).where(eq(reservations.status, "paid")),
      ]);

      return { leads: leadsData, quotes: quotesData, reservations: reservationsData };
    }),
  }),

  // ─── PAGOS PENDIENTES ──────────────────────────────────────────────────────
  pendingPayments: router({
    create: staff
      .input(z.object({
        quoteId: z.number(),
        reservationId: z.number().optional(),
        clientName: z.string(),
        clientEmail: z.string().optional(),
        clientPhone: z.string().optional(),
        productName: z.string(),
        amountCents: z.number(),
        dueDate: z.string(),
        reason: z.string(),
        origin: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const now = Date.now();

        // Si no se pasa reservationId, buscar una existente para este quote antes de crear una nueva
        let resolvedReservationId = input.reservationId;
        if (!resolvedReservationId) {
          // Reutilizar reserva existente no cancelada del mismo presupuesto
          const [existingRes] = await db.select({ id: reservations.id })
            .from(reservations)
            .where(and(eq(reservations.quoteId, input.quoteId), sql`${reservations.status} != 'cancelled'`))
            .orderBy(desc(reservations.createdAt))
            .limit(1);

          if (existingRes) {
            resolvedReservationId = existingRes.id;
          } else {
            // Solo crear placeholder si no hay ninguna reserva para este presupuesto
            const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
            const reservationRef = `PP-${Date.now().toString(36).toUpperCase()}`;
            const reservationNumberPP = await generateReservationNum("crm:pagoPendiente", String(ctx.user.id));
            const [resResult] = await db.insert(reservations).values({
              productId: 0,
              productName: input.productName,
              bookingDate: new Date().toISOString().split("T")[0],
              people: 1,
              amountTotal: input.amountCents,
              amountPaid: 0,
              status: "pending_payment",
              statusReservation: "CONFIRMADA",
              statusPayment: "PENDIENTE",
              customerName: input.clientName,
              customerEmail: input.clientEmail,
              customerPhone: input.clientPhone,
              merchantOrder: reservationRef.substring(0, 12),
              reservationNumber: reservationNumberPP,
              channel: "ONLINE_ASISTIDO",
              quoteId: input.quoteId,
              quoteSource: "presupuesto",
              notes: `Pago pendiente desde presupuesto ${quote?.quoteNumber ?? input.quoteId}`,
              createdAt: now,
              updatedAt: now,
            });
            resolvedReservationId = (resResult as { insertId: number }).insertId;
          }
        }

        const [result] = await db.insert(pendingPayments).values({
          quoteId: input.quoteId,
          reservationId: resolvedReservationId,
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          clientPhone: input.clientPhone,
          productName: input.productName,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          reason: input.reason,
          status: "pending",
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        });
        const ppId = (result as { insertId: number }).insertId;
        if (input.clientEmail) {
          const legal = await getLegalCompanySettings();
          const dueDateFormatted = new Date(input.dueDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
          const html = buildPendingPaymentHtml({
            clientName: input.clientName,
            productName: input.productName,
            amountFormatted: (input.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €",
            dueDate: dueDateFormatted,
            ibanInfo: legal.iban ? `Banco: Nayade Experiences\nIBAN: ${legal.iban}\nConcepto: Reserva ${input.productName}` : undefined,
            origin: input.origin ?? "",
          });
          await sendEmail({ to: input.clientEmail, subject: `Reserva confirmada — Pago pendiente hasta el ${dueDateFormatted}`, html });
        }
        await logActivity("quote", input.quoteId, "pending_payment_created", ctx.user.id, ctx.user.name, { ppId, dueDate: input.dueDate, amountCents: input.amountCents });
        return { success: true, id: ppId };
      }),

    list: staff
      .input(z.object({
        status: z.enum(["pending", "paid", "cancelled", "incidentado"]).optional(),
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const conditions = [];
        if (input.status) conditions.push(eq(pendingPayments.status, input.status));
        if (input.search) {
          conditions.push(or(
            like(pendingPayments.clientName, `%${input.search}%`),
            like(pendingPayments.clientEmail ?? "", `%${input.search}%`),
            like(pendingPayments.productName ?? "", `%${input.search}%`),
          ) as ReturnType<typeof and>);
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [items, [{ total }]] = await Promise.all([
          db.select().from(pendingPayments).where(whereClause).orderBy(desc(pendingPayments.createdAt)).limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(pendingPayments).where(whereClause),
        ]);
        const [kpis] = await db.select({ totalPending: count(), totalAmountCents: sum(pendingPayments.amountCents) }).from(pendingPayments).where(eq(pendingPayments.status, "pending"));
        return { items, total, kpis };
      }),

    confirm: staff
      .input(z.object({
        id: z.number(),
        paymentMethod: z.enum(["efectivo", "transferencia", "tarjeta_fisica"]),
        paymentNote: z.string().optional(),
        transferProofUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        if (pp.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Este pago ya no está pendiente" });
        await db.update(pendingPayments).set({
          status: "paid",
          paymentMethod: input.paymentMethod,
          paymentNote: input.paymentNote,
          transferProofUrl: input.transferProofUrl,
          paidAt: Date.now(),
          updatedAt: Date.now(),
        }).where(eq(pendingPayments.id, input.id));
        if (pp.reservationId) {
          // Obtener datos completos de la reserva para postConfirmOperation
          const [existingRes] = await db.select().from(reservations).where(eq(reservations.id, pp.reservationId));
          const legacyChannels = ["web", "crm", "telefono", "email", "otro", "tpv", "groupon", null, undefined];
          const currentChannel = existingRes?.channel;
          const channelToSet = legacyChannels.includes(currentChannel as string) ? "ONLINE_ASISTIDO" : currentChannel;

          // 1. Actualizar estado de la reserva
          await db.update(reservations).set({
            status: "paid",
            amountPaid: pp.amountCents,
            statusReservation: "CONFIRMADA",
            statusPayment: "PAGADO",
            channel: channelToSet as "ONLINE_ASISTIDO",
            paidAt: Date.now(),
            updatedAt: Date.now(),
          }).where(eq(reservations.id, pp.reservationId));

          // 2. Registrar transacción contable + booking operativo (igual que todos los demás flujos de cobro)
          try {
            await postConfirmOperation({
              reservationId: pp.reservationId,
              productId: existingRes?.productId ?? 0,
              productName: pp.productName ?? "Experiencia",
              serviceDate: existingRes?.bookingDate ?? new Date().toISOString().split("T")[0],
              people: existingRes?.people ?? 1,
              amountCents: pp.amountCents,
              customerName: pp.clientName,
              customerEmail: pp.clientEmail ?? "",  // postConfirmOperation requiere string
              customerPhone: pp.clientPhone ?? null,
              totalAmount: pp.amountCents / 100,
              paymentMethod: input.paymentMethod,
              saleChannel: "crm",
              quoteId: pp.quoteId ?? null,
              description: `Pago pendiente confirmado — ${pp.productName} — ${pp.clientName}`,
              sellerUserId: ctx.user.id,
              sellerName: ctx.user.name,
            });
          } catch (e) {
            console.error("[pendingPayments.confirm] Error en postConfirmOperation:", e);
          }
        }
        // Generar factura si la reserva no tiene una aún
        if (pp.reservationId) {
          try {
            const [resForInv] = await db.select().from(reservations).where(eq(reservations.id, pp.reservationId));
            if (resForInv && !resForInv.invoiceId) {
              const now = new Date();
              const invoiceNumber = await generateInvoiceNumber("crm:pendingPayment", String(ctx.user.id));
              const amountEur = pp.amountCents / 100;
              const items = [{ description: pp.productName ?? resForInv.productName, quantity: resForInv.people, unitPrice: amountEur / resForInv.people, total: amountEur }];
              const subtotal = amountEur;
              const bdPp = groupTaxBreakdown(items);
              const taxAmount = totalTaxAmount(bdPp);
              const taxRatePp = bdPp.length === 1 ? bdPp[0].rate : 21;
              const total = parseFloat((subtotal + taxAmount).toFixed(2));
              let pdfUrl: string | null = null;
              let pdfKey: string | null = null;
              try {
                const pdf = await generateInvoicePdf({ invoiceNumber, clientName: pp.clientName, clientEmail: pp.clientEmail ?? "", clientPhone: pp.clientPhone, itemsJson: items, subtotal: String(subtotal.toFixed(2)), taxRate: String(taxRatePp), taxAmount: String(taxAmount), taxBreakdown: bdPp, total: String(total.toFixed(2)), issuedAt: now });
                pdfUrl = pdf.url;
                pdfKey = pdf.key;
              } catch (pdfErr) {
                console.error("[pendingPayments.confirm] PDF generation failed:", pdfErr);
              }
              const [invRes] = await db.insert(invoices).values({ invoiceNumber, reservationId: pp.reservationId, quoteId: pp.quoteId ?? null, clientName: pp.clientName, clientEmail: pp.clientEmail ?? "", clientPhone: pp.clientPhone, itemsJson: items, subtotal: String(subtotal.toFixed(2)), taxRate: String(taxRatePp), taxAmount: String(taxAmount), taxBreakdown: bdPp.length > 0 ? bdPp : undefined, total: String(total.toFixed(2)), pdfUrl, pdfKey, isAutomatic: true, status: "cobrada", paymentMethod: input.paymentMethod as any, issuedAt: now, createdAt: now, updatedAt: now });
              const invoiceId = (invRes as { insertId: number }).insertId;
              await db.update(reservations).set({ invoiceId, invoiceNumber, updatedAt: Date.now() } as any).where(eq(reservations.id, pp.reservationId));
              console.log(`[pendingPayments.confirm] Factura ${invoiceNumber} generada para reserva ${pp.reservationId}`);

              // Crear expediente REAV si el producto tiene régimen REAV
              try {
                const productId = resForInv.productId;
                if (productId && productId > 0) {
                  const [prod] = await db.select({
                    fiscalRegime: experiences.fiscalRegime,
                    providerPercent: experiences.providerPercent,
                    agencyMarginPercent: experiences.agencyMarginPercent,
                  }).from(experiences).where(eq(experiences.id, productId)).limit(1);

                  if (prod?.fiscalRegime === "reav") {
                    const reavErrors = validarConfiguracionREAV(prod);
                    const costePct = reavErrors.length === 0 ? parseFloat(String(prod.providerPercent)) : 0;
                    const margenPct = reavErrors.length === 0 ? parseFloat(String(prod.agencyMarginPercent)) : 0;
                    const calc = calcularREAVSimple(amountEur, costePct, margenPct);
                    const reavResult = await createReavExpedient({
                      invoiceId,
                      reservationId: pp.reservationId!,
                      quoteId: pp.quoteId ?? undefined,
                      serviceDescription: resForInv.productName,
                      serviceDate: resForInv.bookingDate,
                      numberOfPax: resForInv.people,
                      saleAmountTotal: String(amountEur.toFixed(2)),
                      providerCostEstimated: String(calc.costeProveedor.toFixed(2)),
                      agencyMarginEstimated: String(calc.margenAgencia.toFixed(2)),
                      clientName: pp.clientName,
                      clientEmail: pp.clientEmail ?? undefined,
                      clientPhone: pp.clientPhone ?? undefined,
                      channel: "crm",
                      sourceRef: invoiceNumber,
                      internalNotes: [
                        `Expediente creado automáticamente al confirmar pago pendiente.`,
                        `Cliente: ${pp.clientName}`,
                        pp.clientEmail ? `Email: ${pp.clientEmail}` : null,
                        `Factura: ${invoiceNumber}`,
                        `Agente: ${ctx.user.name ?? ctx.user.email}`,
                        reavErrors.length > 0 ? `⚠ Config REAV incompleta — revisar producto ${productId}` : null,
                      ].filter(Boolean).join(" · "),
                    });
                    if (pdfUrl && reavResult?.id) {
                      await attachReavDocument({
                        expedientId: reavResult.id,
                        side: "client",
                        docType: "factura_emitida",
                        title: `Factura ${invoiceNumber}`,
                        fileUrl: pdfUrl,
                        mimeType: "application/pdf",
                        notes: `Generada al confirmar pago pendiente.`,
                        uploadedBy: ctx.user.id,
                      });
                    }
                    console.log(`[pendingPayments.confirm] Expediente REAV ${reavResult?.expedientNumber} creado para reserva ${pp.reservationId}`);
                  }
                }
              } catch (reavErr) {
                console.error("[pendingPayments.confirm] Error creando expediente REAV:", reavErr);
              }
            }
          } catch (invErr) {
            console.error("[pendingPayments.confirm] Error generando factura:", invErr);
          }
        }

        await logActivity("quote", pp.quoteId, "pending_payment_confirmed", ctx.user.id, ctx.user.name, { ppId: input.id, method: input.paymentMethod });
        return { success: true };
      }),

    cancel: staff
      .input(z.object({
        id: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(pendingPayments).set({ status: "cancelled", paymentNote: input.reason, updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_cancelled", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),

    resendReminder: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        if (!pp.clientEmail) throw new TRPCError({ code: "BAD_REQUEST", message: "El cliente no tiene email registrado" });
        const legal = await getLegalCompanySettings();
        const dueDateFormatted = new Date(pp.dueDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
        const html = buildPendingPaymentReminderHtml({
          clientName: pp.clientName,
          productName: pp.productName ?? "Actividad Nayade",
          amountFormatted: (pp.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €",
          dueDate: dueDateFormatted,
          ibanInfo: legal.iban ? `Banco: Nayade Experiences\nIBAN: ${legal.iban}\nConcepto: Reserva ${pp.productName}` : undefined,
          origin: "",
        });
        await sendEmail({ to: pp.clientEmail, subject: `Recordatorio urgente: pago pendiente hasta el ${dueDateFormatted}`, html });
        await db.update(pendingPayments).set({ reminderSentAt: Date.now(), updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_reminder_sent", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),

    markIncident: staff
      .input(z.object({
        id: z.number(),
        note: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(pendingPayments).set({ status: "incidentado", paymentNote: input.note, updatedAt: Date.now() }).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_incident", ctx.user.id, ctx.user.name, { ppId: input.id, note: input.note });
        return { success: true };
      }),

    delete: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [pp] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, input.id));
        if (!pp) throw new TRPCError({ code: "NOT_FOUND" });
        await db.delete(pendingPayments).where(eq(pendingPayments.id, input.id));
        await logActivity("quote", pp.quoteId, "pending_payment_deleted", ctx.user.id, ctx.user.name, { ppId: input.id });
        return { success: true };
      }),
  }),

  // ─── CATALOG SEARCH (autocomplete en líneas de presupuesto) ──────────────────
  catalog: router({
    search: staff
      .input(z.object({ q: z.string().min(1) }))
      .query(async ({ input }) => {
        const term = `%${input.q}%`;
        // Buscar en experiences
        const expRows = await db
          .select({
            id: experiences.id,
            title: experiences.title,
            basePrice: experiences.basePrice,
            fiscalRegime: experiences.fiscalRegime,
          })
          .from(experiences)
          .where(and(eq(experiences.isActive, true), like(experiences.title, term)))
          .limit(8);
        // Buscar en packs
        const packRows = await db
          .select({
            id: packs.id,
            title: packs.title,
            basePrice: packs.basePrice,
            fiscalRegime: packs.fiscalRegime,
          })
          .from(packs)
          .where(like(packs.title, term))
          .limit(6);
        // Buscar en legoPacks (sin basePrice — precio 0 por defecto, se edita manualmente)
        const legoRows = await db
          .select({
            id: legoPacks.id,
            title: legoPacks.title,
            priceLabel: legoPacks.priceLabel,
          })
          .from(legoPacks)
          .where(and(eq(legoPacks.isActive, true), like(legoPacks.title, term)))
          .limit(6);
        const results = [
          ...expRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: parseFloat(String(r.basePrice ?? "0")),
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
            type: "experience" as const,
          })),
          ...packRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: parseFloat(String(r.basePrice ?? "0")),
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
            type: "pack" as const,
          })),
          ...legoRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: 0,
            fiscalRegime: "general" as "reav" | "general",
            type: "legopack" as const,
          })),
        ];
        return { results };
      }),
  }),
});
