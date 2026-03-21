/**
 * CRM Router — Nayade Experiences
 * Ciclo completo: Lead → Presupuesto → Pago Redsys → Reserva → Factura PDF
 */import { router, protectedProcedure } from "../\_core/trpc";
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
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte, like, or, sql, count, sum, isNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { storagePut } from "../storage";

// DB helper
function getDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}
const db = getDb();

// Email helper
const COPY_EMAIL = "reservas@hotelnayade.es";
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) { console.warn("SMTP not configured, skipping email"); return; }
  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
  // Siempre enviar copia a reservas@hotelnayade.es
  await transporter.sendMail({ from: process.env.SMTP_FROM ?? user, to, bcc: COPY_EMAIL, subject, html });
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

// ─── INVOICE PDF GENERATION ──────────────────────────────────────────────────

async function generateInvoicePdf(invoice: {
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientNif?: string | null;
  clientAddress?: string | null;
  itemsJson: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  issuedAt: Date;
}): Promise<{ url: string; key: string }> {
  // Build HTML invoice
  const itemRows = invoice.itemsJson
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.unitPrice).toFixed(2)} €</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

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
      <h1>NÁYADE EXPERIENCES</h1>
      <p>Los Ángeles de San Rafael, Segovia · reservas@nayadeexperiences.es</p>
      <p>CIF: [CIF_EMPRESA] · Tel: +34 930 34 77 91</p>
    </div>
    <div class="invoice-meta">
      <div class="invoice-num">${invoice.invoiceNumber}</div>
      <div class="invoice-date">Fecha: ${invoice.issuedAt.toLocaleDateString("es-ES")}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Emisor</h3>
      <p><strong>Náyade Experiences S.L.</strong><br/>
      Los Ángeles de San Rafael, Segovia<br/>
      CIF: [CIF_EMPRESA]</p>
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
    <tr><td>Subtotal</td><td>${Number(invoice.subtotal).toFixed(2)} €</td></tr>
    <tr><td>IVA (${invoice.taxRate}%)</td><td>${Number(invoice.taxAmount).toFixed(2)} €</td></tr>
    <tr class="total-row"><td>TOTAL</td><td>${Number(invoice.total).toFixed(2)} €</td></tr>
  </table>

  <div class="footer">
    <p>Gracias por confiar en Náyade Experiences · www.nayadeexperiences.es</p>
    <p>Este documento es una factura oficial emitida por Náyade Experiences S.L.</p>
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
  const itemRows = quote.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:14px;">${item.description}</td>
          <td style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:center;font-size:14px;">${item.quantity}</td>
          <td style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;font-size:14px;">${Number(item.unitPrice).toFixed(2)} €</td>
          <td style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;font-size:14px;font-weight:600;color:#f97316;">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#0d1526;">
    <!-- Wave header -->
    <div style="background:linear-gradient(135deg,#1a3a6b 0%,#0d1f3c 60%,#1a3a6b 100%);padding:40px 40px 0;position:relative;">
      <div style="margin-bottom:24px;">
        <div style="display:inline-block;background:rgba(249,115,22,0.15);border:1px solid rgba(249,115,22,0.3);border-radius:20px;padding:4px 14px;font-size:11px;color:#f97316;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:16px;">Tu Propuesta Personalizada</div>
        <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 8px;letter-spacing:-0.5px;">Hola, ${quote.clientName} 👋</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:15px;margin:0;">Hemos preparado tu propuesta <strong style="color:#f97316;">${quote.quoteNumber}</strong> con todo el detalle.</p>
      </div>
      <svg viewBox="0 0 620 40" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-bottom:-1px;"><path d="M0,20 C155,40 465,0 620,20 L620,40 L0,40 Z" fill="#0d1526"/></svg>
    </div>

    <!-- Body -->
    <div style="padding:32px 40px;">
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px;margin-bottom:24px;">
        <h2 style="color:#ffffff;font-size:18px;font-weight:700;margin:0 0 16px;">${quote.title}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:rgba(249,115,22,0.1);">
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#f97316;text-transform:uppercase;letter-spacing:1px;">Descripción</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#f97316;text-transform:uppercase;letter-spacing:1px;">Cant.</th>
              <th style="padding:10px 16px;text-align:right;font-size:12px;color:#f97316;text-transform:uppercase;letter-spacing:1px;">Precio</th>
              <th style="padding:10px 16px;text-align:right;font-size:12px;color:#f97316;text-transform:uppercase;letter-spacing:1px;">Total</th>
            </tr>
          </thead>
          <tbody style="color:rgba(255,255,255,0.85);">${itemRows}</tbody>
        </table>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
          ${Number(quote.discount) > 0 ? `<div style="display:flex;justify-content:space-between;color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:6px;"><span>Descuento</span><span>-${Number(quote.discount).toFixed(2)} €</span></div>` : ""}
          ${Number(quote.tax) > 0 ? `<div style="display:flex;justify-content:space-between;color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:6px;"><span>IVA</span><span>${Number(quote.tax).toFixed(2)} €</span></div>` : ""}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
            <span style="color:#ffffff;font-size:16px;font-weight:700;">TOTAL</span>
            <span style="color:#f97316;font-size:24px;font-weight:800;">${Number(quote.total).toFixed(2)} €</span>
          </div>
        </div>
      </div>

      ${quote.validUntil ? `<p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:24px;">⏳ Esta propuesta es válida hasta el <strong style="color:rgba(255,255,255,0.8);">${new Date(quote.validUntil).toLocaleDateString("es-ES")}</strong></p>` : ""}

      ${quote.notes ? `<div style="background:rgba(255,255,255,0.04);border-left:3px solid #f97316;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;"><p style="color:rgba(255,255,255,0.8);font-size:14px;margin:0;">${quote.notes}</p></div>` : ""}

      ${
        quote.paymentLinkUrl
          ? `<div style="text-align:center;margin:32px 0;">
          <a href="${quote.paymentLinkUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:16px;font-weight:700;letter-spacing:0.5px;box-shadow:0 8px 24px rgba(249,115,22,0.4);">
            💳 Confirmar y Pagar Ahora
          </a>
          <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:12px;">Pago 100% seguro · Redsys · SSL</p>
        </div>`
          : `<div style="text-align:center;margin:32px 0;padding:20px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);border-radius:12px;">
          <p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;">Para confirmar tu reserva, contacta con nosotros:<br/><strong style="color:#f97316;">reservas@nayadeexperiences.es · +34 930 34 77 91</strong></p>
        </div>`
      }

      ${quote.conditions ? `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;"><h4 style="color:rgba(255,255,255,0.6);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Condiciones</h4><p style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.6;margin:0;">${quote.conditions}</p></div>` : ""}
    </div>

    <!-- Footer -->
    <div style="background:#060c1a;padding:24px 40px;text-align:center;">
      <svg viewBox="0 0 620 30" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-bottom:20px;margin-top:-1px;"><path d="M0,0 C155,30 465,0 620,15 L620,0 Z" fill="#0d1526"/></svg>
      <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0 0 8px;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
      <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:0;">reservas@nayadeexperiences.es · +34 930 34 77 91</p>
    </div>
  </div>
</body>
</html>`;

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
  const itemRows = data.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:14px;color:rgba(255,255,255,0.85);">${item.description}</td>
          <td style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;font-size:14px;color:#f97316;font-weight:600;">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#0d1526;">
    <div style="background:linear-gradient(135deg,#1a3a6b 0%,#0d1f3c 60%,#1a3a6b 100%);padding:40px 40px 0;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:6px 18px;font-size:12px;color:#22c55e;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:16px;">✓ Reserva Confirmada</div>
        <h1 style="color:#ffffff;font-size:26px;font-weight:800;margin:0 0 8px;">¡Tu aventura está confirmada!</h1>
        <p style="color:rgba(255,255,255,0.7);font-size:15px;margin:0;">Hola <strong style="color:#f97316;">${data.clientName}</strong>, tu reserva <strong>${data.reservationRef}</strong> ha sido procesada con éxito.</p>
      </div>
      <svg viewBox="0 0 620 40" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-bottom:-1px;"><path d="M0,20 C155,40 465,0 620,20 L620,40 L0,40 Z" fill="#0d1526"/></svg>
    </div>
    <div style="padding:32px 40px;">
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px;margin-bottom:24px;">
        <h3 style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 16px;">${data.quoteTitle}</h3>
        <table style="width:100%;border-collapse:collapse;">${itemRows}</table>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
          <span style="color:#ffffff;font-size:16px;font-weight:700;">Total pagado</span>
          <span style="color:#22c55e;font-size:22px;font-weight:800;">${Number(data.total).toFixed(2)} €</span>
        </div>
      </div>
      ${
        data.invoiceUrl
          ? `<div style="text-align:center;margin:24px 0;">
          <a href="${data.invoiceUrl}" style="display:inline-block;background:rgba(255,255,255,0.08);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:50px;font-size:14px;font-weight:600;border:1px solid rgba(255,255,255,0.15);">
            📄 Descargar Factura
          </a>
        </div>`
          : ""
      }
      <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.2);border-radius:12px;padding:20px;text-align:center;">
        <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:0 0 8px;">¿Tienes alguna pregunta? Estamos aquí para ayudarte.</p>
        <p style="color:#f97316;font-size:14px;font-weight:600;margin:0;">reservas@nayadeexperiences.es · +34 930 34 77 91</p>
      </div>
    </div>
    <div style="background:#060c1a;padding:24px 40px;text-align:center;">
      <svg viewBox="0 0 620 30" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-bottom:20px;margin-top:-1px;"><path d="M0,0 C155,30 465,0 620,15 L620,0 Z" fill="#0d1526"/></svg>
      <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0;">Náyade Experiences · reservas@nayadeexperiences.es · +34 930 34 77 91</p>
    </div>
  </div>
</body>
</html>`;

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

        return db
          .select()
          .from(quotes)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(quotes.createdAt))
          .limit(input.limit)
          .offset(input.offset);
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
          paymentLinkUrl: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead asociado no encontrado" });

        // Update quote
        await db
          .update(quotes)
          .set({
            status: "enviado",
            sentAt: new Date(),
            paymentLinkUrl: input.paymentLinkUrl,
            updatedAt: new Date(),
          })
          .where(eq(quotes.id, input.id));

        // Update lead opportunity status
        await db
          .update(leads)
          .set({ opportunityStatus: "enviada", status: "contactado", updatedAt: new Date() })
          .where(eq(leads.id, quote.leadId));

        // Send email
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
          paymentLinkUrl: input.paymentLinkUrl,
        });

        await logActivity("quote", input.id, "quote_sent", ctx.user.id, ctx.user.name, { email: lead.email });
        await logActivity("lead", quote.leadId, "quote_sent_to_client", ctx.user.id, ctx.user.name, { quoteId: input.id });

        return { success: true };
      }),

    resend: staff
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const [quote] = await db.select().from(quotes).where(eq(quotes.id, input.id));
        if (!quote) throw new TRPCError({ code: "NOT_FOUND" });
        const [lead] = await db.select().from(leads).where(eq(leads.id, quote.leadId));
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });

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
          paymentLinkUrl: quote.paymentLinkUrl,
        });

        await logActivity("quote", input.id, "quote_resent", ctx.user.id, ctx.user.name, {});
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
        const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
        const taxRate = 21;
        const subtotal = Number(quote.subtotal);
        const taxAmount = subtotal * (taxRate / 100);
        const total = Number(quote.total);

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

        return { success: true, invoiceId, invoiceNumber, reservationId, pdfUrl };
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
  }),
  // ─── RESERVATIONSS ──────────────────────────────────────────────────────────

  reservations: router({
    list: staff
      .input(
        z.object({
          status: z.string().optional(),
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
        if (input.search) {
          conditions.push(
            or(
              like(reservations.customerName, `%${input.search}%`),
              like(reservations.customerEmail, `%${input.search}%`),
              like(reservations.merchantOrder, `%${input.search}%`)
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
  }),

  // ─── PIPELINE (embudo comercial) ───────────────────────────────────────────

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
