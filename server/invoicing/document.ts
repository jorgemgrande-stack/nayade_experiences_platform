/**
 * Documento de la factura (HTML imprimible; el PDF sale de imprimirlo). Contenido mínimo de una factura completa
 * (art. 6 del Real Decreto 1619/2012): número y serie, fecha de expedición, fecha de operación si es distinta, razón
 * social, NIF y domicilio del emisor y del destinatario, descripción, base imponible, tipo y cuota de IVA y total.
 * Un borrador lleva la marca «BORRADOR — sin validez fiscal» y no tiene número.
 */
import type { FiscalParty, Invoice } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const date = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "—");
const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES")} %`;
const party = (title: string, p: FiscalParty | null) =>
  p
    ? `<div class="party"><h3>${title}</h3><p><strong>${esc(p.legalName)}</strong><br>NIF ${esc(p.taxId)}<br>${esc(p.address)}<br>${esc(p.postalCode)} ${esc(p.city)} (${esc(p.country)})</p></div>`
    : `<div class="party"><h3>${title}</h3><p class="missing">Datos fiscales pendientes de verificar</p></div>`;

export function invoiceHtml(inv: Invoice, issuerDraft: FiscalParty): string {
  const draft = inv.status === "draft";
  const title = inv.kind === "rectification" ? "Factura rectificativa" : "Factura";
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.concept)}</td><td class="n">${l.quantity}</td><td class="n">${money(l.unitCents, inv.currency)}</td><td class="n">${money(l.baseCents, inv.currency)}</td><td class="n">${pct(l.taxRateBp)}</td><td class="n">${money(l.taxCents, inv.currency)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title} ${esc(inv.number ?? "(borrador)")}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;max-width:820px;margin:32px auto;padding:0 16px}h1{margin:0 0 4px}h3{margin:0 0 4px;font-size:13px;text-transform:uppercase;color:#555}.parties{display:flex;gap:32px;margin:24px 0}.party{flex:1}.missing{color:#b00}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}.n{text-align:right;white-space:nowrap}.tot td{border:0}.draft{border:2px solid #b00;color:#b00;padding:8px;font-weight:700;text-align:center}.meta td{border:0;padding:2px 8px 2px 0}.small{color:#555;font-size:12px}</style></head><body>
${draft ? '<p class="draft">BORRADOR — sin validez fiscal (no se ha expedido)</p>' : ""}
<h1>${title}</h1>
<table class="meta"><tr><td>Número</td><td><strong>${esc(inv.number ?? "—")}</strong></td></tr><tr><td>Fecha de expedición</td><td>${date(inv.issueDate)}</td></tr><tr><td>Fecha de operación</td><td>${date(inv.operationDate)}${inv.periodLabel ? ` · periodo: ${esc(inv.periodLabel)}` : ""}</td></tr></table>
<div class="parties">${party("Emisor", inv.issuer ?? issuerDraft)}${party("Cliente", inv.customer)}</div>
<table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Base imponible</th><th class="n">IVA</th><th class="n">Cuota</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td class="n">Base imponible</td><td class="n">${money(inv.baseCents, inv.currency)}</td></tr><tr><td class="n">IVA</td><td class="n">${money(inv.taxCents, inv.currency)}</td></tr><tr><td class="n"><strong>Total</strong></td><td class="n"><strong>${money(inv.totalCents, inv.currency)}</strong></td></tr></table>
${inv.notes ? `<p class="small">${esc(inv.notes)}</p>` : ""}
<p class="small">Estado de cobro: ${{ pending: "pendiente", paid: "cobrada", failed: "cobro fallido, pendiente", refunded: "reembolsada" }[inv.paymentStatus]}${inv.hash ? ` · Huella ${inv.hash.slice(0, 16)}` : ""}</p>
</body></html>`;
}
