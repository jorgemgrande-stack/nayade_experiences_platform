/**
 * Importes de una factura libre (lógica pura, compartida por el servidor que la emite y el formulario
 * que la muestra antes de emitirla).
 *
 * Los precios se escriben CON IVA incluido (como en productos y presupuestos) o SIN IVA, a elección:
 *  - con IVA incluido: el importe de cada línea es cantidad × precio (redondeado a céntimos); por cada tipo,
 *    la cuota se extrae del importe total de ese tipo (importe × tipo / (100 + tipo)) y la base es el resto;
 *  - sin IVA: la base de cada línea es cantidad × precio y su cuota base × tipo (redondeadas por línea).
 * En los dos casos líneas, desglose y total cuadran al céntimo. En `items` cada línea guarda, como el resto de
 * facturas de la plataforma, su importe CON IVA (`total`) y su tipo (`taxRate`); una línea al 0 % guarda
 * además el motivo de la exención (`exemptionReason`), que figura en la factura.
 */

import { isValidSpanishTaxId, normalizeTaxId, validateEmail, validatePhone } from "./formValidation";

/** Tipos de IVA admitidos en una factura libre. */
export const DIRECT_INVOICE_TAX_RATES = [21, 10, 4, 0] as const;
export type DirectInvoiceTaxRate = (typeof DIRECT_INVOICE_TAX_RATES)[number];

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface DirectInvoiceLine {
  description: string;
  quantity: number;
  /** Precio unitario: CON IVA si `pricesIncludeTax`, si no SIN IVA. */
  unitPrice: number;
  taxRate: DirectInvoiceTaxRate;
  /** Motivo de la exención (obligatorio con tipo 0 %). */
  exemptionReason?: string;
}

/** Motivos habituales de exención o no sujeción para una línea al 0 % (se puede escribir otro). */
export const EXEMPTION_REASON_SUGGESTIONS = [
  "Operación exenta de IVA (art. 20 de la Ley 37/1992 del IVA)",
  "Entrega intracomunitaria exenta (art. 25 de la Ley 37/1992 del IVA)",
  "Exportación exenta (art. 21 de la Ley 37/1992 del IVA)",
  "Operación no sujeta a IVA (art. 7 de la Ley 37/1992 del IVA)",
  "Inversión del sujeto pasivo (art. 84 de la Ley 37/1992 del IVA)",
] as const;

/** Tipo 0 % sin motivo de exención. */
export const needsExemptionReason = (l: { taxRate: number; exemptionReason?: string | null }) => Number(l.taxRate) === 0 && !(l.exemptionReason ?? "").trim();

export interface DirectInvoiceItem {
  description: string;
  quantity: number;
  /** Precio unitario CON IVA (redondeado a céntimos). */
  unitPrice: number;
  /** Importe de la línea CON IVA. */
  total: number;
  fiscalRegime: "general";
  taxRate: number;
  /** Solo en líneas al 0 %: motivo de la exención. */
  exemptionReason?: string;
}

export interface DirectInvoiceAmounts {
  items: DirectInvoiceItem[];
  taxBreakdown: { rate: number; base: number; amount: number }[];
  subtotal: number;
  taxAmount: number;
  total: number;
  /** Tipo único de la factura (campo heredado `taxRate`): el del desglose si solo hay uno, si no 21. */
  taxRate: number;
}

export function computeDirectInvoice(lines: DirectInvoiceLine[], opts: { pricesIncludeTax?: boolean } = {}): DirectInvoiceAmounts {
  const byRate = new Map<number, { base: number; amount: number; gross: number }>();
  const items: DirectInvoiceItem[] = lines.map((l) => {
    const cur = byRate.get(l.taxRate) ?? { base: 0, amount: 0, gross: 0 };
    let gross: number;
    if (opts.pricesIncludeTax) {
      // Precio con IVA: el importe es lo que paga el cliente; base y cuota se extraen por tipo (abajo)
      gross = round2(l.quantity * l.unitPrice);
    } else {
      const base = round2(l.quantity * l.unitPrice);
      const amount = round2((base * l.taxRate) / 100);
      gross = round2(base + amount);
      cur.base = round2(cur.base + base);
      cur.amount = round2(cur.amount + amount);
    }
    cur.gross = round2(cur.gross + gross);
    byRate.set(l.taxRate, cur);
    const reason = l.taxRate === 0 ? (l.exemptionReason ?? "").trim() : "";
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.quantity ? round2(gross / l.quantity) : gross,
      total: gross,
      fiscalRegime: "general" as const,
      taxRate: l.taxRate,
      ...(reason ? { exemptionReason: reason } : {}),
    };
  });
  if (opts.pricesIncludeTax) {
    for (const [rate, v] of Array.from(byRate.entries())) {
      v.amount = round2((v.gross * rate) / (100 + rate));
      v.base = round2(v.gross - v.amount);
    }
  }
  const taxBreakdown = Array.from(byRate.entries())
    .map(([rate, v]) => ({ rate, base: v.base, amount: v.amount }))
    .sort((a, b) => b.rate - a.rate);
  const subtotal = round2(taxBreakdown.reduce((s, b) => s + b.base, 0));
  const taxAmount = round2(taxBreakdown.reduce((s, b) => s + b.amount, 0));
  return {
    items,
    taxBreakdown,
    subtotal,
    taxAmount,
    total: round2(subtotal + taxAmount),
    taxRate: taxBreakdown.length === 1 ? taxBreakdown[0].rate : 21,
  };
}

/** Precio escrito en el otro modo (con IVA ↔ sin IVA), redondeado a céntimos: al cambiar el selector. */
export function convertUnitPrice(price: number, taxRate: number, toIncludeTax: boolean): number {
  if (!Number.isFinite(price)) return price;
  return round2(toIncludeTax ? price * (1 + taxRate / 100) : price / (1 + taxRate / 100));
}

// ─── Formulario «Nueva factura» ──────────────────────────────────────────────

export type InvoiceLineDraft = { description: string; quantity: string; unitPrice: string; taxRate: DirectInvoiceTaxRate; exemptionReason?: string };
export type InvoiceClientDraft = { name: string; nif: string; email: string; phone: string; address: string };
export type InvoiceFormErrors = Record<string, string>;

/** Número escrito con coma o punto decimal; NaN si no es un número. */
export const parseAmount = (v: string) => (v.trim() === "" ? NaN : Number(v.trim().replace(/\s/g, "").replace(",", ".")));

/** NIF español válido o número de IVA intracomunitario (dos letras de país y de 2 a 12 caracteres). */
export function validateNif(v: string): string | null {
  if (!v.trim()) return null;
  const n = normalizeTaxId(v);
  if (isValidSpanishTaxId(n)) return null;
  if (/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(n) && !n.startsWith("ES")) return null;
  return "El NIF no es válido";
}

/** Errores por campo del formulario (vacío = se puede emitir). */
export function validateNewInvoice(mode: "existing" | "new", clientId: number | null, client: InvoiceClientDraft, lines: InvoiceLineDraft[]): InvoiceFormErrors {
  const e: InvoiceFormErrors = {};
  if (mode === "existing") {
    if (!clientId) e.clientId = "Elige un cliente";
  } else {
    if (!client.name.trim()) e.name = "Indica el nombre o la razón social";
    const nif = validateNif(client.nif);
    if (nif) e.nif = nif;
    const email = validateEmail(client.email);
    if (email) e.email = email;
    const phone = validatePhone(client.phone);
    if (phone) e.phone = phone;
  }
  if (!lines.length) e.lines = "Añade al menos una línea";
  lines.forEach((l, i) => {
    if (!l.description.trim()) e[`line${i}.description`] = "Indica el concepto";
    const q = parseAmount(l.quantity);
    if (!(q > 0)) e[`line${i}.quantity`] = "Debe ser mayor que cero";
    const p = parseAmount(l.unitPrice);
    if (!Number.isFinite(p)) e[`line${i}.unitPrice`] = "Indica el precio";
    else if (p < 0) e[`line${i}.unitPrice`] = "No puede ser negativo";
    if (needsExemptionReason(l)) e[`line${i}.exemptionReason`] = "Con IVA al 0 % indica el motivo de la exención";
  });
  return e;
}

