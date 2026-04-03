/**
 * CRM Router — Nayade Experiences
 * Ciclo completo: Lead → Presupuesto → Pago Redsys → Reserva → Factura PDF
 */import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { createLead, createBookingFromReservation, createReavExpedient, attachReavDocument, upsertClientFromReservation, postConfirmOperation } from "../db";
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
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, like, or, sql, count, sum, isNull, max } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { generateDocumentNumber } from "../documentNumbers";
import { htmlToPdf } from "../pdfGenerator";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";
import { storagePut } from "../storage";
import {
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildQuotePdfHtml,
  buildPendingPaymentHtml,
  buildPendingPaymentReminderHtml,
} from "../emailTemplates";

// DB helper — usa la misma pool que el resto del servidor
const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// Email helper — delega en el helper compartido mailer.ts
const COPY_EMAIL = "reservas@nayadeexperiences.es";
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const sent = await sharedSendEmail({ to, subject, html });
  if (!sent) { console.warn("SMTP not configured, skipping email"); return; }
  // Enviar copia BCC a reservas@nayadeexperiences.es
  await sharedSendEmail({ to: COPY_EMAIL, subject: `[COPIA] ${subject}`, html });
}
// ─── HELPERS ─────────────────────────────────────────────────────────────────

function staffProcedure() {
  return protectedProcedure.use(({ ctx, next }) => {
    const allowed = ["admin", "agente"];
    if (!allowed.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido al equipo comercial" });
    }
    return next({ ctx });
  });
}

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

// ─── LEGAL COMPANY SETTINGS ─────────────────────────────────────────────────
async function getLegalCompanySettings(): Promise<{
  name: string; cif: string; address: string; city: string;
  zip: string; province: string; email: string; phone: string; iban: string;
}> {
  const rows = await db.select().from(siteSettings)
    .where(sql`\`key\` IN ('legalCompanyName','legalCompanyCif','legalCompanyAddress','legalCompanyCity','legalCompanyZip','legalCompanyProvince','legalCompanyEmail','legalCompanyPhone','legalCompanyIban')`);
  const s: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
  return {
    name:     s.legalCompanyName     || "NEXTAIR, S.L.",
    cif:      s.legalCompanyCif      || "B16408031",
    address:  s.legalCompanyAddress  || "C/JOSE LUIS PEREZ PUJADAS, Nº 14, PLTA.1, PUERTA D EDIFICIO FORUM",
    city:     s.legalCompanyCity     || "GRANADA",
    zip:      s.legalCompanyZip      || "18006",
    province: s.legalCompanyProvince || "Granada",
    email:    s.legalCompanyEmail    || "",
    phone:    s.legalCompanyPhone    || "",
    iban:     s.legalCompanyIban     || "",
  };
}

// ─── INVOICE PDF GENERATION ──────────────────────────────────────────────────
async function generateInvoicePdf(invoice: {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[];
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  issuedAt: Date;
}): Promise<{ url: string; key: string }> {
  // Obtener datos de empresa facturadora desde BD
  const legal = await getLegalCompanySettings();
  const legalAddressFull = `${legal.address}, ${legal.zip} ${legal.city} (${legal.province})`;
  // Separar líneas REAV y régimen general
  const reavItems = invoice.itemsJson.filter(i => i.fiscalRegime === "reav");
  const generalItems = invoice.itemsJson.filter(i => i.fiscalRegime !== "reav");
  const hasReav = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  // Build HTML invoice
  const buildItemRows = (items: typeof invoice.itemsJson, isReav: boolean) =>
    items.map((item) =>
      `<tr${isReav ? ' class="reav-row"' : ''}>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}${isReav ? ' <span style="font-size:10px;color:#6b7280;font-style:italic;">(REAV)</span>' : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.unitPrice).toFixed(2)} €</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.total).toFixed(2)} €</td>
      </tr>`
    ).join("");

  // Combinar: primero líneas generales, luego REAV (con separador visual si hay ambas)
  let itemRows = "";
  if (hasGeneral && hasReav) {
    itemRows = buildItemRows(generalItems, false);
    itemRows += `<tr><td colspan="4" style="padding:6px 12px;background:#f0f4ff;font-size:11px;font-weight:600;color:#1a3a6b;letter-spacing:0.5px;">RÉGIMEN ESPECIAL AGENCIAS DE VIAJE (REAV) — Operaciones no sujetas a IVA</td></tr>`;
    itemRows += buildItemRows(reavItems, true);
  } else {
    itemRows = buildItemRows(invoice.itemsJson, hasReav && !hasGeneral);
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; }
  /* ── ENCABEZADO ── */
  .doc-header { background: #1a3a6b; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .logo-block { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  .logo-block img { width: 90px; height: 90px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.85); object-fit: cover; display: block; }
  .brand-text .brand-name { font-size: 20px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #fff; line-height: 1.1; }
  .brand-text .brand-sub { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.65); margin-top: 3px; }
  .company-info { text-align: right; color: rgba(255,255,255,0.80); font-size: 11.5px; line-height: 1.7; }
  .company-info strong { color: #fff; font-size: 12.5px; display: block; }
  .doc-type-band { background: #f97316; padding: 8px 40px; display: flex; align-items: center; justify-content: space-between; }
  .doc-type-band .doc-label { color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  .doc-type-band .doc-ref { color: #fff; font-size: 13px; font-weight: 700; }
  /* ── CUERPO ── */
  .body-content { padding: 28px 40px; }
  .parties { display: flex; gap: 28px; margin-bottom: 24px; }
  .party { flex: 1; background: #f8fafc; border-radius: 8px; padding: 14px 16px; border: 1px solid #e5e7eb; }
  .party h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #1a3a6b; margin-bottom: 8px; font-weight: 700; }
  .party p { font-size: 13px; line-height: 1.7; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
  thead tr { background: #1a3a6b; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  thead th:last-child, thead th:nth-child(2), thead th:nth-child(3) { text-align: right; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
  .totals { width: 300px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .totals tr td { padding: 8px 14px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }
  .totals .total-row { background: #1a3a6b; color: #fff; }
  .totals .total-row td { padding: 11px 14px; font-size: 15px; font-weight: 700; border-bottom: none; }
  .footer { padding: 16px 40px; border-top: 2px solid #1a3a6b; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.8; }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="logo-block">
      <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_20a42bc4.jpg" alt="Náyade" />
      <div class="brand-text">
        <div class="brand-name">Náyade</div>
        <div class="brand-sub">Experiences</div>
      </div>
    </div>
    <div class="company-info">
      <strong>${legal.name}</strong>
      ${legalAddressFull}<br/>
      CIF: ${legal.cif}${legal.phone ? ` &middot; Tel: ${legal.phone}` : ""}${legal.email ? `<br/>${legal.email}` : ""}
    </div>
  </div>
  <div class="doc-type-band">
    <span class="doc-label">Factura</span>
    <span class="doc-ref">${invoice.invoiceNumber} &nbsp;&middot;&nbsp; ${invoice.issuedAt.toLocaleDateString("es-ES")}</span>
  </div>

  <div class="body-content">
  <div class="parties">
    <div class="party">
      <h3>Emisor</h3>
      <p><strong>${legal.name}</strong><br/>
      ${legalAddressFull}<br/>
      CIF: ${legal.cif}${legal.iban ? `<br/>IBAN: ${legal.iban}` : ""}</p>
    </div>
    <div class="party">
      <h3>Cliente</h3>
      <p><strong>${invoice.clientName}</strong><br/>
      ${invoice.clientEmail}<br/>
      ${invoice.clientPhone ? invoice.clientPhone + "<br/>" : ""}
      ${invoice.clientNif ? "NIF: " + invoice.clientNif + "<br/>" : ""}
      ${invoice.clientAddress || ""}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">Precio unit.</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap"><table class="totals">
    ${hasGeneral && hasReav ? `
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal rég. general</td><td>${generalItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal REAV (sin IVA)</td><td>${reavItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    ` : `<tr><td>Subtotal</td><td>${Number(invoice.subtotal).toFixed(2)} €</td></tr>`}
    ${hasGeneral ? `<tr><td>IVA (${invoice.taxRate}%)</td><td>${Number(invoice.taxAmount).toFixed(2)} €</td></tr>` : ''}
    ${hasReav && !hasGeneral ? `<tr><td style="font-size:12px;color:#6b7280;font-style:italic;" colspan="2">Operación sujeta al Régimen Especial de Agencias de Viaje (REAV). No procede repercusión de IVA al cliente.</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td>${Number(invoice.total).toFixed(2)} €</td></tr>
  </table></div>
  </div>
  <div class="footer">
    <p>Gracias por confiar en Náyade Experiences &middot; www.nayadeexperiences.es</p>
    <p>Documento emitido por <strong>${legal.name}</strong> &mdash; CIF: ${legal.cif} &mdash; ${legalAddressFull}</p>
  </div>
</body>
</html>`;

  // Generar PDF con puppeteer-core (funciona en producción desplegada)
  try {
    const pdfBuffer = await htmlToPdf(html);
    const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.pdf`;
    const { url } = await storagePut(key, pdfBuffer, "application/pdf");
    return { url, key };
  } catch (pdfErr) {
    console.error("[PDF] Error generando factura PDF, guardando HTML como fallback:", pdfErr);
    // Fallback: guardar HTML (el cliente puede imprimir desde el navegador)
    const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.html`;
    const { url } = await storagePut(key, Buffer.from(html), "text/html");
    return { url, key };
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
    to: "reservas@nayadeexperiences.es",
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

const staff = staffProcedure();

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

        const rows = await db
          .select()
          .from(leads)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(leads.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        return rows;
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());

      const [total, nueva, enviada, ganada, perdida, hoy, semana, sinLeer] = await Promise.all([
        db.select({ cnt: count() }).from(leads),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "nueva")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "enviada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "ganada")),
        db.select({ cnt: count() }).from(leads).where(eq(leads.opportunityStatus, "perdida")),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfDay)),
        db.select({ cnt: count() }).from(leads).where(gte(leads.createdAt, startOfWeek)),
        db.select({ cnt: count() }).from(leads).where(isNull(leads.seenAt)),
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
              fiscalRegime: z.enum(["reav", "general_21"]).optional(),
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
        const taxAmount = (input.subtotal - input.discount) * (input.taxRate / 100);

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
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21"; productId?: number }[] = [];

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
              fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21",
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
                fiscalRegime: "general_21",
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
                  fiscalRegime: foundExp.fiscalRegime === "reav" ? "reav" : "general_21",
                  productId: foundExp.id,
                });
              } else {
                // Producto no encontrado en BD: crear línea vacía con nombre del producto
                quoteItems.push({
                  description: productName,
                  quantity: qty,
                  unitPrice: 0,
                  total: 0,
                  fiscalRegime: "general_21",
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
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general_21";
          quoteItems.push({ description, quantity, unitPrice: parseFloat(unitPrice.toFixed(2)), total, fiscalRegime: itemFiscalRegime, productId: act.experienceId });
        }
        // 3. Calcular totales — solo líneas general_21 llevan IVA
        const subtotal = parseFloat(quoteItems.reduce((s, i) => s + i.total, 0).toFixed(2));
        const generalSubtotal = parseFloat(quoteItems.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0).toFixed(2));
        const taxAmount = parseFloat((generalSubtotal * (input.taxRate / 100)).toFixed(2));
        const total = parseFloat((subtotal + taxAmount).toFixed(2));;

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
    previewFromLead: staffProcedure()
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
            return { items: [{ description: `${foundPack.title}${foundPack.subtitle ? ` — ${foundPack.subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21", productId: foundPack.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundLego] = await db.select().from(legoPacks)
            .where(and(eq(legoPacks.title, productName), eq(legoPacks.isActive, true))).limit(1);
          if (foundLego) {
            const unitPrice = parseFloat(String((foundLego as any).basePrice ?? (foundLego as any).price ?? 0));
            return { items: [{ description: `${foundLego.title}${(foundLego as any).subtitle ? ` — ${(foundLego as any).subtitle}` : ""}`, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: "general_21" as const, productId: foundLego.id }], hasActivities: true, fromSelectedProduct: true };
          }
          const [foundExp] = await db.select().from(experiences)
            .where(and(eq(experiences.title, productName), eq(experiences.isActive, true))).limit(1);
          if (foundExp) {
            const unitPrice = parseFloat(String(foundExp.basePrice));
            return { items: [{ description: foundExp.title, quantity: qty, unitPrice, total: parseFloat((unitPrice * qty).toFixed(2)), fiscalRegime: (foundExp.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21", productId: foundExp.id }], hasActivities: true, fromSelectedProduct: true };
          }
          return { items: [{ description: productName, quantity: qty, unitPrice: 0, total: 0, fiscalRegime: "general_21" as const }], hasActivities: true, fromSelectedProduct: true };
        }
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21"; productId?: number }[] = [];
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
          const itemFiscalRegime = exp?.fiscalRegime === "reav" ? "reav" : "general_21";
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
  }),
  // ─── QUOTESES ────────────────────────────────────────────────────────────────

  quotes: router({
    list: staff
      .input(
        z.object({
          status: z.enum(["borrador", "enviado", "aceptado", "rechazado", "expirado", "perdido"]).optional(),
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
            paidAt: quotes.paidAt,
            sentAt: quotes.sentAt,
            invoiceNumber: quotes.invoiceNumber,
            invoicePdfUrl: quotes.invoicePdfUrl,
            createdAt: quotes.createdAt,
            updatedAt: quotes.updatedAt,
            leadId: quotes.leadId,
            agentId: quotes.agentId,
            // Datos del cliente (desde el lead)
            clientName: leads.name,
            clientEmail: leads.email,
            clientPhone: leads.phone,
            clientCompany: leads.company,
          })
          .from(quotes)
          .leftJoin(leads, eq(quotes.leadId, leads.id));
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
        const rows = await baseQuery
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(quotes.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        return rows;
      }),

    counters: staff.query(async () => {
      const [borrador, enviado, pendientePago, ganado, perdido, totalImporte] = await Promise.all([
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "borrador")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "enviado")),
        db.select({ cnt: count() }).from(quotes).where(and(eq(quotes.status, "enviado"), sql`${quotes.paidAt} IS NULL`)),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "aceptado")),
        db.select({ cnt: count() }).from(quotes).where(eq(quotes.status, "perdido")),
        db.select({ total: sum(quotes.total) }).from(quotes).where(eq(quotes.status, "aceptado")),
      ]);

      const totalEnviados = (enviado[0]?.cnt ?? 0);
      const totalGanados = (ganado[0]?.cnt ?? 0);
      const ratio = totalEnviados > 0 ? Math.round((totalGanados / totalEnviados) * 100) : 0;

      return {
        borrador: borrador[0]?.cnt ?? 0,
        enviado: enviado[0]?.cnt ?? 0,
        pendientePago: pendientePago[0]?.cnt ?? 0,
        ganado: totalGanados,
        perdido: perdido[0]?.cnt ?? 0,
        importeTotal: Number(totalImporte[0]?.total ?? 0).toFixed(2),
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
                fiscalRegime: z.enum(["reav", "general_21"]).optional(),
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
          .set({ opportunityStatus: "enviada", status: "contactado", updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        // Send email con el enlace de aceptación
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
        });

        await logActivity("quote", input.id, "quote_sent", ctx.user.id, ctx.user.name, { email: lead.email, acceptUrl });
        await logActivity("lead", quote.leadId, "quote_sent_to_client", ctx.user.id, ctx.user.name, { quoteId: input.id });

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
        });
        await logActivity("quote", input.id, "quote_resent", ctx.user.id, ctx.user.name, { paymentLinkUrl });
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
          paymentMethod: z.enum(["redsys", "transferencia", "efectivo", "otro"]).optional(),
          tpvOperationNumber: z.string().optional(), // Nº operación TPV (tarjeta)
          paymentNote: z.string().optional(),        // Justificación (efectivo) o nota interna
          transferProofUrl: z.string().optional(),   // URL S3 del justificante de transferencia
          transferProofKey: z.string().optional(),   // Key S3 del justificante de transferencia
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        const now = new Date();

        // Generate invoice
         const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]) ?? [];
        const taxRate = 21;
        const subtotal = Number(quote.subtotal);
        // Solo líneas general_21 llevan IVA
        const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
        const taxAmount = parseFloat((generalSubtotal * (taxRate / 100)).toFixed(2));
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
          const generalSubtotalForTx = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
          const reavSubtotalForTx = items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
          const taxAmountForTx = parseFloat((generalSubtotalForTx * 0.21).toFixed(2));
          const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
            : reavSubtotalForTx > 0 ? "reav" : "general_21";
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
          });
          await logActivity("reservation", reservationId, "booking_and_transaction_created", ctx.user.id, ctx.user.name, { invoiceNumber, serviceDate });
        } catch (e) {
          console.error("[confirmPayment] Error en postConfirmOperation:", e);
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
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const proofUrl = (quote as Record<string, unknown>).transferProofUrl as string | null;
        if (!proofUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Debes adjuntar el justificante de transferencia antes de confirmar el pago.",
          });
        }
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]) ?? [];
        const taxRate = 21;
        const subtotal = Number(quote.subtotal);
        // Solo líneas general_21 llevan IVA
        const generalSubtotalTransfer = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
        const taxAmount = parseFloat((generalSubtotalTransfer * (taxRate / 100)).toFixed(2));
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
          const taxAmountT = parseFloat((generalSubtotalT * 0.21).toFixed(2));
          const fiscalRegimeT = reavSubtotalT > 0 && generalSubtotalT > 0 ? "mixed"
            : reavSubtotalT > 0 ? "reav" : "general_21";
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
              fiscalRegime: z.enum(["reav", "general_21"]).optional(),
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
        // 1. Buscar si ya existe un lead con ese email, o crear uno nuevo
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
          // Crear lead silencioso con source="presupuesto_directo"
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

        // 2. Upsert de cliente — MISMO PATRÓN ROBUSTO que createLead en db.ts
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
              leadId,
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
          await db.update(leads).set({ opportunityStatus: "enviada", status: "contactado", updatedAt: new Date() }).where(eq(leads.id, leadId));
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

        // Marcar como visualizado si llega por primera vez
        if (quote.status === "enviado") {
          await db
            .update(quotes)
            .set({ status: "visualizado", viewedAt: new Date(), updatedAt: new Date() })
            .where(eq(quotes.id, quote.id));
          await logActivity("quote", quote.id, "quote_viewed_by_client", null, null, { token: input.token });
        }

        // Obtener datos del lead/cliente
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);

        // Verificar si ha expirado
        const isExpired = quote.validUntil && new Date(quote.validUntil) < new Date();
        const isPaid = !!quote.paidAt;
        const isRejected = quote.status === "rechazado";

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

        // Precios CONGELADOS del presupuesto — nunca recalculados
        const totalEuros = Number(quote.total);
        const amountCents = Math.round(totalEuros * 100);

        // Generar merchantOrder único para Redsys (máx 12 chars)
        const merchantOrder = generateMerchantOrder();

        // Guardar pre-reserva con estado pending_payment
        const customerName = input.customerName ?? lead.name;
        const customerEmail = input.customerEmail ?? lead.email ?? "";
        const customerPhone = input.customerPhone ?? lead.phone ?? "";
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

        // Actualizar quote: estado convertido_carrito + merchantOrder de referencia
        await db
          .update(quotes)
          .set({
            status: "convertido_carrito",
            acceptedAt: new Date(),
            redsysOrderId: merchantOrder,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, quote.id));

        await logActivity("quote", quote.id, "payment_initiated", null, null, { merchantOrder, reservationId });

        // Construir formulario Redsys
        const redsysForm = buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `Presupuesto ${quote.quoteNumber} — ${quote.title}`,
          notifyUrl: `${input.origin}/api/redsys/notification`,
          okUrl: `${input.origin}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${input.origin}/reserva/error?order=${merchantOrder}`,
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
        if (input.status) conditions.push(eq(reservations.status, input.status as "draft" | "pending_payment" | "paid" | "failed" | "cancelled"));
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

        return db
          .select()
          .from(reservations)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(reservations.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      }),

    counters: staff.query(async () => {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).getTime();

      const [confirmadas, hoy, proximas, ingresos, facturas] = await Promise.all([
        db.select({ cnt: count() }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ cnt: count() }).from(reservations).where(and(eq(reservations.status, "paid"), eq(reservations.bookingDate, todayStr))),
        db.select({ cnt: count() }).from(reservations).where(and(eq(reservations.status, "paid"), gte(reservations.createdAt, startOfDay), lte(reservations.createdAt, nextWeek))),
        db.select({ total: sum(reservations.amountPaid) }).from(reservations).where(eq(reservations.status, "paid")),
        db.select({ cnt: count() }).from(invoices).where(eq(invoices.status, "generada")),
      ]);

      return {
        confirmadas: confirmadas[0]?.cnt ?? 0,
        hoy: hoy[0]?.cnt ?? 0,
        proximas: proximas[0]?.cnt ?? 0,
        ingresos: ((ingresos[0]?.total ?? 0) as number) / 100,
        facturas: facturas[0]?.cnt ?? 0,
      };
    }),

    get: staff
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const [reservation] = await db.select().from(reservations).where(eq(reservations.id, input.id));
        if (!reservation) throw new TRPCError({ code: "NOT_FOUND" });

        const relatedInvoices = await db.select().from(invoices).where(eq(invoices.reservationId, input.id));
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
        // Si se anula la reserva, sincronizar con status legacy
        if (input.statusReservation === "ANULADA") updateData.status = "cancelled";
        // Si se paga, sincronizar con status legacy y statusPayment
        if (input.statusPayment === "PAGADO") {
          updateData.status = "paid";
          updateData.paidAt = now;
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
            contactEmail: "reservas@nayadeexperiences.es",
            contactPhone: "+34 930 34 77 91",
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
        let items: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[] = [];

        if (tpvSale) {
          const saleItems = await db.select().from(tpvSaleItems).where(eq(tpvSaleItems.saleId, tpvSale.id));
          items = saleItems.map(i => ({
            description: i.productName,
            quantity: i.quantity,
            unitPrice: parseFloat(String(i.unitPrice)),
            total: parseFloat(String(i.subtotal)),
            fiscalRegime: (i.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21",
          }));
        } else {
          // Fallback: single line from reservation data
          const amountEur = (res.amountPaid ?? res.amountTotal) / 100;
          items = [{ description: res.productName, quantity: res.people, unitPrice: amountEur / res.people, total: amountEur }];
        }

        const now = new Date();
        const invoiceNumber = await generateInvoiceNumber("crm:invoice", String(ctx.user.id));
        const subtotal = items.reduce((s, i) => s + i.total, 0);
        const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
        const taxRate = 21;
        const taxAmount = parseFloat((generalSubtotal * (taxRate / 100)).toFixed(2));
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
          fiscalRegime: "general_21" as const,
        }];
        const subtotal = input.amountTotal;
        const taxRate = 21;
        const taxAmount = parseFloat((subtotal * (taxRate / 100)).toFixed(2));
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
            paymentMethod: input.paymentMethod === "redsys" ? "redsys" : input.paymentMethod === "transferencia" ? "transferencia" : input.paymentMethod === "efectivo" ? "efectivo" : "otro",
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
              contactEmail: "reservas@nayadeexperiences.es",
              contactPhone: "+34 930 34 77 91",
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
              <div class="row"><span class="label">Método de pago</span><span class="value">${res.paymentMethod ?? "—"}</span></div>
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
        const [rows, [{ total }], [{ subtotalSum, taxSum, grandTotal }]] = await Promise.all([
          db.select().from(invoices)
            .where(whereClause)
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit).offset(input.offset),
          db.select({ total: count() }).from(invoices).where(whereClause),
          db.select({
            subtotalSum: sql<string>`COALESCE(SUM(subtotal), 0)`,
            taxSum: sql<string>`COALESCE(SUM(taxAmount), 0)`,
            grandTotal: sql<string>`COALESCE(SUM(total), 0)`,
          }).from(invoices).where(whereClause),
        ]);
        return {
          items: rows,
          total,
          summary: {
            subtotal: Number(subtotalSum),
            tax: Number(taxSum),
            grandTotal: Number(grandTotal),
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
        const items = (invoice.itemsJson as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21"; productId?: number }[]) ?? [];
        let finalPdfUrl = invoice.pdfUrl ?? null;
        let finalPdfKey = invoice.pdfKey ?? null;
        if (!finalPdfUrl) {
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
              const taxAmountForTx = parseFloat((generalSubtotalForTx * 0.21).toFixed(2));
              const fiscalRegimeForTx = reavSubtotalForTx > 0 && generalSubtotalForTx > 0 ? "mixed"
                : reavSubtotalForTx > 0 ? "reav" : "general_21";
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
        const creditSubtotal = creditTotal / 1.21;
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

        const COPY_EMAIL = "reservas@nayadeexperiences.es";
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
              <hr/><p style="color:#6b7280;font-size:12px;">Náyade Experiences · reservas@nayadeexperiences.es · +34 930 34 77 91</p>
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
      await db.update(clients).set(data as any).where(eq(clients.id, id));
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
  }),

  // ─── PRODUCTS SEARCH (para líneas de presupuesto) ────────────────────────────
  products: router({
    search: staff.input(z.object({
      q: z.string().optional(),
      limit: z.number().default(20),
    })).query(async ({ input }) => {
      const expConditions = input.q
        ? [or(like(experiences.title, `%${input.q}%`), like(experiences.shortDescription, `%${input.q}%`))]
        : [];
      const legoConditions = input.q
        ? [like(legoPacks.title, `%${input.q}%`)]
        : [];
      const [expRows, legoRows] = await Promise.all([
        db.select({
          id: experiences.id,
          title: experiences.title,
          basePrice: experiences.basePrice,
          image: experiences.image1,
          coverImage: experiences.coverImageUrl,
          productType: sql<string>`'experience'`,
        }).from(experiences)
          .where(and(eq(experiences.isActive, true), ...(expConditions as any[])))
          .orderBy(experiences.title)
          .limit(input.limit),
        db.select({
          id: legoPacks.id,
          title: legoPacks.title,
          basePrice: sql<string>`'0'`,
          image: legoPacks.coverImageUrl,
          coverImage: legoPacks.coverImageUrl,
          productType: sql<string>`'legoPack'`,
        }).from(legoPacks)
          .where(and(eq(legoPacks.isActive, true), ...(legoConditions as any[])))
          .orderBy(legoPacks.title)
          .limit(input.limit),
      ]);
      return [...expRows, ...legoRows];
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

        // Si no se pasa reservationId, crear la reserva automáticamente como CONFIRMADA
        let resolvedReservationId = input.reservationId;
        if (!resolvedReservationId) {
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
        paymentMethod: z.enum(["efectivo", "transferencia", "tarjeta"]),
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
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21",
            type: "experience" as const,
          })),
          ...packRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: parseFloat(String(r.basePrice ?? "0")),
            fiscalRegime: (r.fiscalRegime === "reav" ? "reav" : "general_21") as "reav" | "general_21",
            type: "pack" as const,
          })),
          ...legoRows.map(r => ({
            id: r.id,
            title: r.title,
            unitPrice: 0,
            fiscalRegime: "general_21" as "reav" | "general_21",
            type: "legopack" as const,
          })),
        ];
        return { results };
      }),
  }),
});