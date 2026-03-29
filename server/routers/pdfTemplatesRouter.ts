import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { pdfTemplates } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { buildQuotePdfHtml } from "../emailTemplates";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// ─── System PDF Templates (seed data) ────────────────────────────────────────
const SYSTEM_PDF_TEMPLATES = [
  {
    id: "invoice",
    name: "Factura",
    description: "Documento de factura emitido al cliente tras confirmar el pago de una reserva.",
    category: "facturacion",
    headerColor: "#0a1628",
    accentColor: "#f97316",
    companyName: "Náyade Experiences S.L.",
    companyNif: "B-XXXXXXXX",
    companyAddress: "Embalse de Los Ángeles, Ávila",
    companyPhone: "+34 930 34 77 91",
    companyEmail: "reservas@nayadeexperiences.es",
    footerText: "Gracias por confiar en Náyade Experiences · www.nayadeexperiences.es",
    legalText: "Documento emitido conforme a la normativa fiscal española.",
    showLogo: true,
    showWatermark: false,
    variables: JSON.stringify(["invoiceNumber","clientName","clientEmail","clientNif","items","subtotal","taxRate","taxAmount","total","issuerName","issuerCif","issuerAddress","bookingDate"]),
    bodyHtml: `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; font-family:'Helvetica Neue',Arial,sans-serif; background:#f8f9fa; color:#1f2937; font-size:13px; }
  .page { max-width:800px; margin:0 auto; background:#fff; padding:48px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; padding-bottom:24px; border-bottom:3px solid #0a1628; }
  .logo-area h1 { font-size:28px; font-weight:900; color:#0a1628; margin:0; letter-spacing:-0.5px; }
  .logo-area p { font-size:11px; color:#6b7280; margin:4px 0 0; }
  .invoice-meta { text-align:right; }
  .invoice-meta .invoice-number { font-size:22px; font-weight:800; color:#f97316; }
  .invoice-meta .invoice-date { font-size:12px; color:#6b7280; margin-top:4px; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .party-block h3 { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:1px; margin:0 0 8px; }
  .party-block p { margin:2px 0; font-size:13px; color:#1f2937; }
  .party-block .name { font-weight:700; font-size:15px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  thead tr { background:#0a1628; color:#fff; }
  thead th { padding:10px 12px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.5px; text-transform:uppercase; }
  tbody tr:nth-child(even) { background:#f9fafb; }
  tbody td { padding:10px 12px; border-bottom:1px solid #e5e7eb; font-size:13px; }
  .totals-wrap { display:flex; justify-content:flex-end; }
  .totals { width:280px; }
  .totals td { padding:6px 12px; font-size:13px; }
  .totals .total-row td { font-weight:800; font-size:16px; color:#0a1628; border-top:2px solid #0a1628; padding-top:10px; }
  .footer { margin-top:48px; padding-top:20px; border-top:1px solid #e5e7eb; text-align:center; font-size:11px; color:#9ca3af; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo-area">
      <h1>NÁYADE</h1>
      <p>EXPERIENCES</p>
    </div>
    <div class="invoice-meta">
      <div class="invoice-number">{{invoiceNumber}}</div>
      <div class="invoice-date">Fecha: {{bookingDate}}</div>
      <div style="margin-top:8px;display:inline-block;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;">FACTURA</div>
    </div>
  </div>
  <div class="parties">
    <div class="party-block">
      <h3>Emisor</h3>
      <p class="name">{{issuerName}}</p>
      <p>CIF: {{issuerCif}}</p>
      <p>{{issuerAddress}}</p>
    </div>
    <div class="party-block">
      <h3>Cliente</h3>
      <p class="name">{{clientName}}</p>
      <p>{{clientEmail}}</p>
      {{#if clientNif}}<p>NIF: {{clientNif}}</p>{{/if}}
    </div>
  </div>
  <table>
    <thead><tr><th>Descripción</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio unit.</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>{{itemRows}}</tbody>
  </table>
  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Subtotal</td><td style="text-align:right">{{subtotal}} €</td></tr>
      <tr><td>IVA ({{taxRate}}%)</td><td style="text-align:right">{{taxAmount}} €</td></tr>
      <tr class="total-row"><td>TOTAL</td><td style="text-align:right">{{total}} €</td></tr>
    </table>
  </div>
  <div class="footer">
    <p>Gracias por confiar en Náyade Experiences · www.nayadeexperiences.es</p>
    <p>Documento emitido por <strong>{{issuerName}}</strong> — CIF: {{issuerCif}} — {{issuerAddress}}</p>
  </div>
</div>
</body>
</html>`,
  },
  {
    id: "quote_pdf",
    name: "Presupuesto PDF",
    description: "Documento PDF del presupuesto enviado al cliente con desglose de conceptos, condiciones y enlace de pago.",
    category: "presupuestos",
    headerColor: "#0a1628",
    accentColor: "#f97316",
    companyName: "Náyade Experiences S.L.",
    companyNif: "B-XXXXXXXX",
    companyAddress: "Embalse de Los Ángeles, Ávila",
    companyPhone: "+34 930 34 77 91",
    companyEmail: "reservas@nayadeexperiences.es",
    footerText: "Náyade Experiences · www.nayadeexperiences.es",
    legalText: "Presupuesto válido según condiciones indicadas. Sujeto a disponibilidad.",
    showLogo: true,
    showWatermark: false,
    variables: JSON.stringify(["quoteNumber","title","clientName","clientEmail","items","subtotal","discount","tax","total","validUntil","notes","conditions","paymentLinkUrl","issuerName","issuerCif","issuerAddress"]),
    bodyHtml: buildQuotePdfHtml({
      quoteNumber: "PRE-2026-001",
      title: "Pack Cable Ski Experience + Restaurante",
      clientName: "Carlos Pedraza",
      clientEmail: "carlos@ejemplo.es",
      clientPhone: "+34 600 000 000",
      items: [
        { description: "Pack Cable Ski Experience (5 pax)", quantity: 5, unitPrice: 35, total: 175 },
        { description: "Menú Náyade (8 pax)", quantity: 8, unitPrice: 28, total: 224 },
      ],
      subtotal: "399",
      discount: "0",
      tax: "83.79",
      total: "482.79",
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      notes: "Precio especial por grupo. Incluye alquiler de neopreno.",
      conditions: "Reserva sujeta a disponibilidad. Cancelación gratuita hasta 48h antes.",
      paymentLinkUrl: "https://nayadeexperiences.es/pago/PRE-2026-001",
      createdAt: new Date(),
      issuerName: "Náyade Experiences S.L.",
      issuerCif: "B-XXXXXXXX",
      issuerAddress: "Embalse de Los Ángeles, Ávila",
    }),
  },
  {
    id: "tpv_ticket",
    name: "Ticket TPV",
    description: "Ticket de compra imprimible generado en el punto de venta (TPV) tras una venta presencial.",
    category: "tpv",
    headerColor: "#0a1628",
    accentColor: "#f97316",
    companyName: "Náyade Experiences S.L.",
    companyNif: "B-XXXXXXXX",
    companyAddress: "Embalse de Los Ángeles, Ávila",
    companyPhone: "+34 930 34 77 91",
    companyEmail: "reservas@nayadeexperiences.es",
    footerText: "Gracias por su visita · Náyade Experiences",
    legalText: "Conserve este ticket como justificante de compra.",
    showLogo: true,
    showWatermark: false,
    variables: JSON.stringify(["ticketNumber","clientName","clientEmail","items","total","paidAt","paymentMethod","operatorName"]),
    bodyHtml: `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; font-family:'Helvetica Neue',Arial,sans-serif; background:#f8f9fa; }
  .ticket { max-width:380px; margin:20px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.10); }
  .ticket-header { background:#0a1628; padding:20px 24px; text-align:center; }
  .ticket-header h1 { color:#fff; font-size:20px; font-weight:900; margin:0; letter-spacing:-0.5px; }
  .ticket-header p { color:#94a3b8; font-size:11px; margin:4px 0 0; }
  .ticket-badge { display:inline-block; background:#f97316; color:#fff; padding:4px 14px; border-radius:20px; font-size:11px; font-weight:700; margin-top:10px; letter-spacing:1px; text-transform:uppercase; }
  .ticket-body { padding:20px 24px; }
  .ticket-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed #e5e7eb; font-size:13px; }
  .ticket-row:last-child { border-bottom:none; }
  .ticket-row .label { color:#6b7280; }
  .ticket-row .value { font-weight:600; color:#1f2937; }
  .divider { border:none; border-top:2px dashed #e5e7eb; margin:16px 0; }
  .total-row { display:flex; justify-content:space-between; padding:10px 0; font-size:18px; font-weight:800; color:#0a1628; }
  .ticket-footer { background:#f9fafb; padding:16px 24px; text-align:center; font-size:11px; color:#9ca3af; border-top:1px solid #e5e7eb; }
  .items-table { width:100%; border-collapse:collapse; margin:12px 0; }
  .items-table th { font-size:10px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; padding:4px 0; text-align:left; border-bottom:1px solid #e5e7eb; }
  .items-table td { padding:6px 0; font-size:12px; border-bottom:1px dashed #f3f4f6; }
  .items-table td:last-child { text-align:right; font-weight:600; }
</style>
</head>
<body>
<div class="ticket">
  <div class="ticket-header">
    <h1>NÁYADE</h1>
    <p>EXPERIENCES</p>
    <div class="ticket-badge">Ticket de Compra</div>
  </div>
  <div class="ticket-body">
    <div class="ticket-row"><span class="label">Nº Ticket</span><span class="value">{{ticketNumber}}</span></div>
    <div class="ticket-row"><span class="label">Cliente</span><span class="value">{{clientName}}</span></div>
    <div class="ticket-row"><span class="label">Fecha</span><span class="value">{{paidAt}}</span></div>
    <div class="ticket-row"><span class="label">Forma de pago</span><span class="value">{{paymentMethod}}</span></div>
    <hr class="divider"/>
    <table class="items-table">
      <thead><tr><th>Concepto</th><th>Cant.</th><th>Total</th></tr></thead>
      <tbody>{{itemRows}}</tbody>
    </table>
    <hr class="divider"/>
    <div class="total-row"><span>TOTAL</span><span>{{total}} €</span></div>
    <div class="ticket-row" style="margin-top:8px;"><span class="label">Atendido por</span><span class="value">{{operatorName}}</span></div>
  </div>
  <div class="ticket-footer">
    <p>Gracias por su visita · Náyade Experiences</p>
    <p>Conserve este ticket como justificante de compra</p>
  </div>
</div>
</body>
</html>`,
  },
  {
    id: "settlement",
    name: "Liquidación de Proveedor",
    description: "Documento de liquidación económica emitido a proveedores con desglose de ventas, comisiones y neto a pagar.",
    category: "proveedores",
    headerColor: "#0a1628",
    accentColor: "#f97316",
    companyName: "Náyade Experiences S.L.",
    companyNif: "B-XXXXXXXX",
    companyAddress: "Embalse de Los Ángeles, Ávila",
    companyPhone: "+34 930 34 77 91",
    companyEmail: "reservas@nayadeexperiences.es",
    footerText: "Náyade Experiences · www.nayadeexperiences.es",
    legalText: "Liquidación emitida conforme al contrato de colaboración vigente.",
    showLogo: true,
    showWatermark: false,
    variables: JSON.stringify(["settlementNumber","supplierName","supplierNif","supplierAddress","supplierIban","periodFrom","periodTo","grossAmount","commissionAmount","netAmountProvider","lines","issuedAt"]),
    bodyHtml: `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; font-family:'Helvetica Neue',Arial,sans-serif; background:#f8f9fa; color:#1f2937; font-size:13px; }
  .page { max-width:800px; margin:0 auto; background:#fff; padding:48px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; padding-bottom:24px; border-bottom:3px solid #0a1628; }
  .logo-area h1 { font-size:28px; font-weight:900; color:#0a1628; margin:0; }
  .logo-area p { font-size:11px; color:#6b7280; margin:4px 0 0; }
  .doc-meta { text-align:right; }
  .doc-meta .doc-number { font-size:20px; font-weight:800; color:#f97316; }
  .doc-meta .doc-period { font-size:12px; color:#6b7280; margin-top:4px; }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:32px; }
  .party-block h3 { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:1px; margin:0 0 8px; }
  .party-block p { margin:2px 0; font-size:13px; }
  .party-block .name { font-weight:700; font-size:15px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  thead tr { background:#0a1628; color:#fff; }
  thead th { padding:10px 12px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.5px; text-transform:uppercase; }
  tbody tr:nth-child(even) { background:#f9fafb; }
  tbody td { padding:10px 12px; border-bottom:1px solid #e5e7eb; font-size:12px; }
  .summary-box { background:#f0f4ff; border:1px solid #c7d2fe; border-radius:8px; padding:20px 24px; margin-bottom:32px; }
  .summary-row { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; }
  .summary-row.total { font-weight:800; font-size:16px; color:#0a1628; border-top:2px solid #0a1628; margin-top:8px; padding-top:12px; }
  .footer { margin-top:48px; padding-top:20px; border-top:1px solid #e5e7eb; text-align:center; font-size:11px; color:#9ca3af; }
  .iban-box { background:#fef3c7; border:1px solid #fcd34d; border-radius:6px; padding:12px 16px; margin-top:16px; font-size:13px; }
  .iban-box strong { color:#92400e; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo-area">
      <h1>NÁYADE</h1>
      <p>EXPERIENCES</p>
    </div>
    <div class="doc-meta">
      <div class="doc-number">{{settlementNumber}}</div>
      <div class="doc-period">Período: {{periodFrom}} — {{periodTo}}</div>
      <div style="margin-top:8px;display:inline-block;background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;">LIQUIDACIÓN DE PROVEEDOR</div>
    </div>
  </div>
  <div class="parties">
    <div class="party-block">
      <h3>Emisor</h3>
      <p class="name">{{issuerName}}</p>
      <p>CIF: {{issuerCif}}</p>
      <p>{{issuerAddress}}</p>
    </div>
    <div class="party-block">
      <h3>Proveedor</h3>
      <p class="name">{{supplierName}}</p>
      <p>NIF: {{supplierNif}}</p>
      <p>{{supplierAddress}}</p>
      <div class="iban-box"><strong>IBAN:</strong> {{supplierIban}}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>Servicio</th><th>Fecha</th><th>Pax</th><th style="text-align:right">Venta</th><th style="text-align:right">Comisión</th><th style="text-align:right">Neto</th></tr></thead>
    <tbody>{{settlementRows}}</tbody>
  </table>
  <div class="summary-box">
    <div class="summary-row"><span>Total ventas brutas</span><span>{{grossAmount}} €</span></div>
    <div class="summary-row"><span>Comisión Náyade</span><span>- {{commissionAmount}} €</span></div>
    <div class="summary-row total"><span>NETO A PAGAR AL PROVEEDOR</span><span>{{netAmountProvider}} €</span></div>
  </div>
  <div class="footer">
    <p>Náyade Experiences · www.nayadeexperiences.es</p>
    <p>Liquidación emitida conforme al contrato de colaboración vigente.</p>
  </div>
</div>
</body>
</html>`,
  },
];

// ─── Helper: seed PDF templates to DB if empty ───────────────────────────────
async function ensurePdfTemplatesSeeded() {
  const existing = await db.select({ id: pdfTemplates.id }).from(pdfTemplates).limit(1);
  if (existing.length > 0) return;
  for (const tpl of SYSTEM_PDF_TEMPLATES) {
    await db.insert(pdfTemplates).values({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      category: tpl.category,
      headerColor: tpl.headerColor,
      accentColor: tpl.accentColor,
      companyName: tpl.companyName,
      companyNif: tpl.companyNif,
      companyAddress: tpl.companyAddress,
      companyPhone: tpl.companyPhone,
      companyEmail: tpl.companyEmail,
      footerText: tpl.footerText,
      legalText: tpl.legalText,
      showLogo: tpl.showLogo,
      showWatermark: tpl.showWatermark,
      bodyHtml: tpl.bodyHtml,
      variables: tpl.variables,
      isCustom: false,
      isActive: true,
    }).onDuplicateKeyUpdate({ set: { name: tpl.name } });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const pdfTemplatesRouter = router({
  // ── Listar todas las plantillas PDF ──────────────────────────────────────
  list: adminProcedure.query(async () => {
    await ensurePdfTemplatesSeeded();
    return db.select({
      id: pdfTemplates.id,
      name: pdfTemplates.name,
      description: pdfTemplates.description,
      category: pdfTemplates.category,
      isCustom: pdfTemplates.isCustom,
      isActive: pdfTemplates.isActive,
      updatedAt: pdfTemplates.updatedAt,
    }).from(pdfTemplates).orderBy(pdfTemplates.category, pdfTemplates.name);
  }),

  // ── Obtener una plantilla completa ────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      await ensurePdfTemplatesSeeded();
      const rows = await db.select().from(pdfTemplates).where(eq(pdfTemplates.id, input.id)).limit(1);
      if (!rows[0]) throw new Error("Plantilla PDF no encontrada");
      return rows[0];
    }),

  // ── Guardar cambios en una plantilla ─────────────────────────────────────
  save: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1),
      description: z.string().optional(),
      headerColor: z.string().optional(),
      accentColor: z.string().optional(),
      companyName: z.string().optional(),
      companyNif: z.string().optional(),
      companyAddress: z.string().optional(),
      companyPhone: z.string().optional(),
      companyEmail: z.string().optional(),
      footerText: z.string().optional(),
      legalText: z.string().optional(),
      showLogo: z.boolean().optional(),
      showWatermark: z.boolean().optional(),
      bodyHtml: z.string().min(1),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      await db.update(pdfTemplates)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(pdfTemplates.id, id));
      return { success: true };
    }),

  // ── Crear nueva plantilla personalizada ──────────────────────────────────
  create: adminProcedure
    .input(z.object({
      id: z.string().min(1).regex(/^[a-z0-9_]+$/, "Solo letras minúsculas, números y guiones bajos"),
      name: z.string().min(1),
      description: z.string().optional(),
      category: z.string().default("general"),
      headerColor: z.string().default("#0a1628"),
      accentColor: z.string().default("#f97316"),
      companyName: z.string().optional(),
      companyNif: z.string().optional(),
      companyAddress: z.string().optional(),
      companyPhone: z.string().optional(),
      companyEmail: z.string().optional(),
      footerText: z.string().optional(),
      legalText: z.string().optional(),
      showLogo: z.boolean().default(true),
      showWatermark: z.boolean().default(false),
      bodyHtml: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.select({ id: pdfTemplates.id }).from(pdfTemplates).where(eq(pdfTemplates.id, input.id)).limit(1);
      if (existing.length > 0) throw new Error("Ya existe una plantilla con ese ID");
      await db.insert(pdfTemplates).values({
        ...input,
        variables: "[]",
        isCustom: true,
        isActive: true,
      });
      return { success: true, id: input.id };
    }),

  // ── Eliminar plantilla personalizada ─────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const rows = await db.select({ isCustom: pdfTemplates.isCustom }).from(pdfTemplates).where(eq(pdfTemplates.id, input.id)).limit(1);
      if (!rows[0]) throw new Error("Plantilla no encontrada");
      if (!rows[0].isCustom) throw new Error("No se pueden eliminar plantillas del sistema");
      await db.delete(pdfTemplates).where(eq(pdfTemplates.id, input.id));
      return { success: true };
    }),

  // ── Restaurar plantilla del sistema a valores originales ─────────────────
  restore: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const original = SYSTEM_PDF_TEMPLATES.find(t => t.id === input.id);
      if (!original) throw new Error("No hay datos originales para esta plantilla");
      await db.update(pdfTemplates)
        .set({
          name: original.name,
          description: original.description,
          headerColor: original.headerColor,
          accentColor: original.accentColor,
          companyName: original.companyName,
          companyNif: original.companyNif,
          companyAddress: original.companyAddress,
          companyPhone: original.companyPhone,
          companyEmail: original.companyEmail,
          footerText: original.footerText,
          legalText: original.legalText,
          showLogo: original.showLogo,
          showWatermark: original.showWatermark,
          bodyHtml: original.bodyHtml,
          variables: original.variables,
          updatedAt: new Date(),
        })
        .where(eq(pdfTemplates.id, input.id));
      return { success: true };
    }),
});
