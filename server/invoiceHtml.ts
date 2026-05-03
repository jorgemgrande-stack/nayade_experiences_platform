/**
 * invoiceHtml.ts — Construcción del HTML de factura on-demand.
 * Usado por generateInvoicePdf (crm.ts) y por el endpoint de vista previa.
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { siteSettings } from "../drizzle/schema";
import { getSystemSettingSync } from "./config";
import { groupTaxBreakdown, totalTaxAmount, type TaxBreakdownLine } from "./taxUtils";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

export interface InvoiceHtmlParams {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string; taxRate?: number }[];
  subtotal: string;
  /** @deprecated Usar taxBreakdown para multi-tipo. Se conserva como fallback. */
  taxRate: string;
  taxAmount: string;
  total: string;
  issuedAt: Date;
  /** Desglose por tipo de IVA (generado automáticamente si no se pasa). */
  taxBreakdown?: TaxBreakdownLine[];
}

export async function getLegalCompanySettings(): Promise<{
  name: string; cif: string; address: string; city: string;
  zip: string; province: string; email: string; phone: string; iban: string;
}> {
  const rows = await db.select().from(siteSettings)
    .where(sql`\`key\` IN ('legalCompanyName','legalCompanyCif','legalCompanyAddress','legalCompanyCity','legalCompanyZip','legalCompanyProvince','legalCompanyEmail','legalCompanyPhone','legalCompanyIban')`);
  const s: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
  return {
    name:     s.legalCompanyName     || "Iron Elephant Consulting S.L.",
    cif:      s.legalCompanyCif      || "B26987875",
    address:  s.legalCompanyAddress  || "C/ Corazón de María 57, 1º D",
    city:     s.legalCompanyCity     || "Madrid",
    zip:      s.legalCompanyZip      || "28002",
    province: s.legalCompanyProvince || "Madrid",
    email:    s.legalCompanyEmail    || "",
    phone:    s.legalCompanyPhone    || "",
    iban:     s.legalCompanyIban     || "",
  };
}

export async function buildInvoiceHtml(invoice: InvoiceHtmlParams): Promise<string> {
  const legal = await getLegalCompanySettings();
  const legalAddressFull = `${legal.address}, ${legal.zip} ${legal.city} (${legal.province})`;

  const reavItems    = invoice.itemsJson.filter(i => i.fiscalRegime === "reav");
  const generalItems = invoice.itemsJson.filter(i => i.fiscalRegime !== "reav");
  const hasReav    = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  // Desglose fiscal: usar el que venga en el param, o calcularlo desde las líneas
  const breakdown: TaxBreakdownLine[] = invoice.taxBreakdown?.length
    ? invoice.taxBreakdown
    : groupTaxBreakdown(invoice.itemsJson);
  const isMultiRate = breakdown.length > 1;

  const buildItemRows = (items: typeof invoice.itemsJson, isReav: boolean) =>
    items.map((item) =>
      `<tr${isReav ? ' class="reav-row"' : ''}>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}${isReav ? ' <span style="font-size:10px;color:#6b7280;font-style:italic;">(REAV)</span>' : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.unitPrice).toFixed(2)} €</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.total).toFixed(2)} €</td>
      </tr>`
    ).join("");

  let itemRows = "";
  if (hasGeneral && hasReav) {
    itemRows = buildItemRows(generalItems, false);
    itemRows += `<tr><td colspan="4" style="padding:6px 12px;background:#f0f4ff;font-size:11px;font-weight:600;color:#1a3a6b;letter-spacing:0.5px;">RÉGIMEN ESPECIAL AGENCIAS DE VIAJE (REAV) — Operaciones no sujetas a IVA</td></tr>`;
    itemRows += buildItemRows(reavItems, true);
  } else {
    itemRows = buildItemRows(invoice.itemsJson, hasReav && !hasGeneral);
  }

  const issuedDate = invoice.issuedAt instanceof Date
    ? invoice.issuedAt.toLocaleDateString("es-ES")
    : new Date(invoice.issuedAt).toLocaleDateString("es-ES");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; background: #fff; }
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
      <img src="${getSystemSettingSync("brand_logo_url", "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_20a42bc4.jpg")}" alt="${getSystemSettingSync("brand_short_name", "Náyade")}" />
      <div class="brand-text">
        <div class="brand-name">${getSystemSettingSync("brand_short_name", "Náyade")}</div>
        <div class="brand-sub">${getSystemSettingSync("brand_name", "Nayade Experiences").replace(getSystemSettingSync("brand_short_name", ""), "").trim() || "Experiences"}</div>
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
    <span class="doc-ref">${invoice.invoiceNumber} &nbsp;&middot;&nbsp; ${issuedDate}</span>
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
    ${hasGeneral && isMultiRate ? breakdown.map(b =>
      `<tr><td style="color:#6b7280;font-size:12px;">Base imponible IVA ${b.rate}%</td><td>${b.base.toFixed(2)} €</td></tr>` +
      `<tr><td>IVA ${b.rate}%</td><td>${b.amount.toFixed(2)} €</td></tr>`
    ).join("") : ""}
    ${hasGeneral && !isMultiRate && breakdown.length === 1 ? `
    <tr><td style="color:#6b7280;font-size:12px;">Base imponible IVA ${breakdown[0].rate}%</td><td>${breakdown[0].base.toFixed(2)} €</td></tr>
    <tr><td>IVA (${breakdown[0].rate}%)</td><td>${breakdown[0].amount.toFixed(2)} €</td></tr>` : ""}
    ${hasGeneral && breakdown.length === 0 ? `<tr><td>IVA (${invoice.taxRate}%)</td><td>${Number(invoice.taxAmount).toFixed(2)} €</td></tr>` : ""}
    ${hasReav && !hasGeneral ? `<tr><td style="font-size:12px;color:#6b7280;font-style:italic;" colspan="2">Operación sujeta al Régimen Especial de Agencias de Viaje (REAV). No procede repercusión de IVA al cliente.</td></tr>` : ''}
    <tr class="total-row"><td>TOTAL</td><td>${Number(invoice.total).toFixed(2)} €</td></tr>
  </table></div>
  </div>
  <div class="footer">
    <p>Gracias por confiar en ${getSystemSettingSync("brand_name", "Nayade Experiences")}${getSystemSettingSync("brand_website_url", "") ? " &middot; " + getSystemSettingSync("brand_website_url", "") : ""}</p>
    <p>Documento emitido por <strong>${legal.name}</strong> &mdash; CIF: ${legal.cif} &mdash; ${legalAddressFull}</p>
  </div>
</body>
</html>`;
}

