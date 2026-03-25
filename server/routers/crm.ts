/**
 * CRM Router — Nayade Experiences
 * Ciclo completo: Lead → Presupuesto → Pago Redsys → Reserva → Factura PDF
 */import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { createLead, createBookingFromReservation, createReavExpedient, attachReavDocument } from "../db";
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
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, like, or, sql, count, sum, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { sendEmail as sharedSendEmail } from "../mailer";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";
import { storagePut } from "../storage";
import {
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildQuotePdfHtml,
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

async function logActivity(
  entityType: "lead" | "quote" | "reservation" | "invoice",
  entityId: number,
  action: string,
  actorId: number | null,
  actorName: string | null,
  details: Record<string, unknown> = {}
) {
  await db.insert(crmActivityLog).values({
    entityType,
    entityId,
    action,
    actorId,
    actorName,
    details,
    createdAt: new Date(),
  });
}

async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await db
    .select({ cnt: count() })
    .from(invoices)
    .where(like(invoices.invoiceNumber, `FAC-${year}-%`));
  const n = (result[0]?.cnt ?? 0) + 1;
  return `FAC-${year}-${String(n).padStart(4, "0")}`;
}

async function generateQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await db
    .select({ cnt: count() })
    .from(quotes)
    .where(like(quotes.quoteNumber, `PRE-${year}-%`));
  const n = (result[0]?.cnt ?? 0) + 1;
  return `PRE-${year}-${String(n).padStart(4, "0")}`;
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
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 3px solid #1a3a6b; }
  .logo-area h1 { font-size: 28px; font-weight: 800; color: #1a3a6b; letter-spacing: -0.5px; }
  .logo-area p { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .invoice-meta { text-align: right; }
  .invoice-meta .invoice-num { font-size: 22px; font-weight: 700; color: #f97316; }
  .invoice-meta .invoice-date { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .parties { display: flex; gap: 40px; margin-bottom: 32px; }
  .party { flex: 1; }
  .party h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .party p { font-size: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead tr { background: #1a3a6b; color: #fff; }
  thead th { padding: 10px 12px; text-align: left; font-size: 13px; font-weight: 600; }
  thead th:last-child, thead th:nth-child(2), thead th:nth-child(3) { text-align: right; }
  .totals { margin-left: auto; width: 280px; }
  .totals tr td { padding: 6px 12px; font-size: 14px; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }
  .totals .total-row { background: #1a3a6b; color: #fff; font-size: 16px; font-weight: 700; }
  .totals .total-row td { padding: 10px 12px; }
  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <h1>${legal.name.toUpperCase()}</h1>
      <p>${legalAddressFull}</p>
      <p>CIF: ${legal.cif}${legal.phone ? ` &middot; Tel: ${legal.phone}` : ""}${legal.email ? ` &middot; ${legal.email}` : ""}</p>
    </div>
    <div class="invoice-meta">
      <div class="invoice-num">${invoice.invoiceNumber}</div>
      <div class="invoice-date">Fecha: ${invoice.issuedAt.toLocaleDateString("es-ES")}</div>
    </div>
  </div>

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

  <table class="totals">
    ${hasGeneral && hasReav ? `
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal rég. general</td><td>${generalItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    <tr><td style="color:#6b7280;font-size:13px;">Subtotal REAV (sin IVA)</td><td>${reavItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</td></tr>
    ` : `<tr><td>Subtotal</td><td>${Number(invoice.subtotal).toFixed(2)} €</td></tr>`}
    ${hasGeneral ? `<tr><td>IVA (${invoice.taxRate}%)</td><td>${Number(invoice.taxAmount).toFixed(2)} €</td></tr>` : ''}
    ${hasReav && !hasGeneral ? `<tr><td style="font-size:12px;color:#6b7280;font-style:italic;" colspan="2">Operación sujeta al Régimen Especial de Agencias de Viaje (REAV). No procede repercusión de IVA al cliente.</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td>${Number(invoice.total).toFixed(2)} €</td></tr>
  </table>

  <div class="footer">
    <p>Gracias por confiar en Náyade Experiences &middot; www.nayadeexperiences.es</p>
    <p>Documento emitido por <strong>${legal.name}</strong> &mdash; CIF: ${legal.cif} &mdash; ${legalAddressFull}</p>
  </div>
</body>
</html>`;

  // Store HTML invoice (PDF generation via server-side rendering)
  try {
    // Try using the built-in manus PDF generation if available
    const { execSync } = await import("child_process");
    const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    
    const tmpHtml = join(tmpdir(), `invoice-${Date.now()}.html`);
    const tmpPdf = join(tmpdir(), `invoice-${Date.now()}.pdf`);
    writeFileSync(tmpHtml, html);
    
    try {
      execSync(`manus-md-to-pdf ${tmpHtml} ${tmpPdf} 2>/dev/null || chromium-browser --headless --no-sandbox --disable-gpu --print-to-pdf=${tmpPdf} ${tmpHtml} 2>/dev/null`, { timeout: 15000 });
      const pdfBuffer = readFileSync(tmpPdf);
      unlinkSync(tmpHtml);
      unlinkSync(tmpPdf);
      const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.pdf`;
      const { url } = await storagePut(key, pdfBuffer, "application/pdf");
      return { url, key };
    } catch {
      unlinkSync(tmpHtml);
      try { unlinkSync(tmpPdf); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  
  // Fallback: store HTML
  const key = `invoices/${invoice.invoiceNumber}-${Date.now()}.html`;
  const { url } = await storagePut(key, Buffer.from(html), "text/html");
  return { url, key };
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
}) {
  const html = buildConfirmationHtml({
    clientName: data.clientName,
    reservationRef: data.reservationRef,
    quoteTitle: data.quoteTitle,
    items: data.items,
    total: data.total,
    invoiceUrl: data.invoiceUrl ?? undefined,
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
          conditions.push(
            or(
              like(leads.name, `%${input.search}%`),
              like(leads.email, `%${input.search}%`),
              like(leads.phone ?? "", `%${input.search}%`)
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

        const quoteNumber = await generateQuoteNumber();
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

        if (activities.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Este lead no tiene actividades seleccionadas. Añade actividades desde el formulario antes de generar el presupuesto.",
          });
        }

        // 2. Resolver precios para cada actividad
        const quoteItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21"; productId?: number }[] = [];

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
        const quoteNumber = await generateQuoteNumber();
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
        if (activities.length === 0) return { items: [], hasActivities: false };
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
      }))
      .mutation(async ({ input, ctx }) => {
        // Usar createLead de db.ts para que se cree el cliente automáticamente
        const result = await createLead({
          ...input,
          source: input.source ?? "admin",
        });
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
        if (input.search) conditions.push(or(like(quotes.quoteNumber, `%${input.search}%`), like(quotes.title, `%${input.search}%`)));
        if (input.from) conditions.push(gte(quotes.createdAt, new Date(input.from)));
        if (input.to) conditions.push(lte(quotes.createdAt, new Date(input.to)));

        // Join con leads para obtener datos del cliente
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
          .leftJoin(leads, eq(quotes.leadId, leads.id))
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

        const quoteNumber = await generateQuoteNumber();
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
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.quoteId));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

        const now = new Date();

        // Generate invoice
         const invoiceNumber = await generateInvoiceNumber();
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
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const [resResult] = await db.insert(reservations).values({
          productId: 0, // linked via quote
          productName: quote.title,
          bookingDate: now.toISOString().split("T")[0],
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          notes: `Generado desde presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

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
              serviceDate: now.toISOString().split("T")[0],
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmount),
              providerCostEstimated: String((reavSaleAmount * 0.6).toFixed(2)),
              agencyMarginEstimated: String((reavSaleAmount * 0.4).toFixed(2)),
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

        // Crear reserva con estado pending_payment (no pagada)
        const [resResult] = await db.insert(reservations).values({
          productId: 0,
          productName: quote.title,
          bookingDate: now.toISOString().split("T")[0],
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: 0,
          status: "pending_payment",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          notes: input.notes ?? `Convertido manualmente desde presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;

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
        const invoiceNumber = await generateInvoiceNumber();
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
        const reservationRef = `RES-${Date.now().toString(36).toUpperCase()}`;
        const [resResult] = await db.insert(reservations).values({
          productId: 0,
          productName: quote.title,
          bookingDate: now.toISOString().split("T")[0],
          people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
          amountTotal: Math.round(total * 100),
          amountPaid: Math.round((input.paidAmount ?? total) * 100),
          status: "paid",
          customerName: lead.name,
          customerEmail: lead.email,
          customerPhone: lead.phone ?? "",
          merchantOrder: reservationRef.substring(0, 12),
          notes: `Pago por transferencia bancaria confirmado manualmente. Presupuesto ${quote.quoteNumber}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          paidAt: Date.now(),
        });
        const reservationId = (resResult as { insertId: number }).insertId;
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
        // ── Puente automático reservations → bookings (transferencia) ──────────────────
        try {
          await createBookingFromReservation({
            reservationId,
            productId: lead.experienceId ?? 0,
            productName: quote.title,
            bookingDate: now.toISOString().split("T")[0],
            people: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
            amountCents: Math.round((input.paidAmount ?? total) * 100),
            customerName: lead.name,
            customerEmail: lead.email,
            customerPhone: lead.phone ?? undefined,
            quoteId: quote.id,
            sourceChannel: "transferencia",
          });
        } catch (e) { console.error("[confirmTransfer] Error al crear booking operativo:", e); }
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
              serviceDate: now.toISOString().split("T")[0],
              numberOfPax: lead.numberOfPersons ?? lead.numberOfAdults ?? 1,
              saleAmountTotal: String(reavSaleAmountT),
              providerCostEstimated: String((reavSaleAmountT * 0.6).toFixed(2)),
              agencyMarginEstimated: String((reavSaleAmountT * 0.4).toFixed(2)),
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

        // Generate PDF using manus-md-to-pdf (same as invoices)
        try {
          const { execSync } = await import("child_process");
          const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
          const { tmpdir } = await import("os");
          const { join } = await import("path");

          const ts = Date.now();
          const tmpHtml = join(tmpdir(), `quote-${input.id}-${ts}.html`);
          const tmpPdf = join(tmpdir(), `quote-${input.id}-${ts}.pdf`);
          writeFileSync(tmpHtml, html);

          try {
            execSync(
              `manus-md-to-pdf ${tmpHtml} ${tmpPdf} 2>/dev/null || chromium-browser --headless --no-sandbox --disable-gpu --print-to-pdf=${tmpPdf} ${tmpHtml} 2>/dev/null`,
              { timeout: 20000 }
            );
            const pdfBuffer = readFileSync(tmpPdf);
            unlinkSync(tmpHtml);
            try { unlinkSync(tmpPdf); } catch { /* ignore */ }

            // Upload to S3 and return URL for direct download
            const key = `quotes/${quote.quoteNumber}-${ts}.pdf`;
            const { url } = await storagePut(key, pdfBuffer, "application/pdf");
            return {
              success: true,
              pdfUrl: url,
              filename: `Presupuesto-${quote.quoteNumber}.pdf`,
            };
          } catch {
            unlinkSync(tmpHtml);
            try { unlinkSync(tmpPdf); } catch { /* ignore */ }
            // Fallback: store HTML and return URL
            const key = `quotes/${quote.quoteNumber}-${ts}.html`;
            const { url } = await storagePut(key, Buffer.from(html), "text/html");
            return {
              success: true,
              pdfUrl: url,
              filename: `Presupuesto-${quote.quoteNumber}.html`,
            };
          }
        } catch (err) {
          console.error("PDF generation failed:", err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo generar el PDF. Inténtalo de nuevo." });
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
        const quoteNumber = await generateQuoteNumber();
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
        if (input.channel) conditions.push(eq(reservations.channel, input.channel as "web" | "crm" | "telefono" | "email" | "otro" | "tpv"));
        if (input.search) {
          conditions.push(
            or(
              like(reservations.customerName, `%${input.search}%`),
              like(reservations.customerEmail, `%${input.search}%`),
              like(reservations.merchantOrder, `%${input.search}%`),
              like(reservations.invoiceNumber, `%${input.search}%`)
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
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...fields } = input;
        const updateData: Record<string, unknown> = { updatedAt: Date.now() };
        if (fields.status !== undefined) updateData.status = fields.status;
        if (fields.notes !== undefined) updateData.notes = fields.notes;
        if (fields.bookingDate !== undefined) updateData.bookingDate = fields.bookingDate;
        if (fields.people !== undefined) updateData.people = fields.people;
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
        const invoiceNumber = await generateInvoiceNumber();
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
          conditions.push(or(
            like(invoices.invoiceNumber, `%${input.search}%`),
            like(invoices.clientName, `%${input.search}%`),
            like(invoices.clientEmail, `%${input.search}%`),
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
        // ── Puente automático reservations → bookings (pago manual) ──────────────────
        if (invoice.reservationId) {
          try {
            const [res] = await db.select().from(reservations).where(eq(reservations.id, invoice.reservationId));
            if (res) {
              await createBookingFromReservation({
                reservationId: res.id,
                productId: res.productId,
                productName: res.productName,
                bookingDate: res.bookingDate ?? now.toISOString().split("T")[0],
                people: res.people,
                amountCents: res.amountPaid ?? res.amountTotal,
                customerName: res.customerName,
                customerEmail: res.customerEmail ?? "",
                customerPhone: res.customerPhone,
                quoteId: invoice.quoteId ?? null,
                sourceChannel: input.paymentMethod as "transferencia" | "efectivo" | "otro",
              });
            }
          } catch (e) { console.error("[confirmManualPayment] Error al crear booking operativo:", e); }
        }
        return { success: true };
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
          const { createTransporter } = await import("../mailer");
          const transporter = createTransporter();
          if (!transporter) throw new Error("SMTP not configured");

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

          await transporter.sendMail({
            from: process.env.SMTP_FROM ?? `Náyade Experiences <${COPY_EMAIL}>`,
            to: recipient,
            bcc: COPY_EMAIL,
            subject,
            html: htmlBody,
          });

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
      const conditions = input.q
        ? [or(like(experiences.title, `%${input.q}%`), like(experiences.shortDescription, `%${input.q}%`))]
        : [];
      const rows = await db.select({
        id: experiences.id,
        title: experiences.title,
        basePrice: experiences.basePrice,
        image: experiences.image1,
        coverImage: experiences.coverImageUrl,
      }).from(experiences)
        .where(and(eq(experiences.isActive, true), ...(conditions as any[])))
        .orderBy(experiences.title)
        .limit(input.limit);
      return rows;
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
});
