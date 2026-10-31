/**
 * Importes de una factura libre (lógica pura, compartida por el servidor que la emite y el formulario
 * que la muestra antes de emitirla).
 *
 * Regla: el precio se introduce SIN IVA. La base de cada línea es cantidad × precio (redondeada a
 * céntimos) y su cuota es base × tipo (redondeada a céntimos por línea). El desglose suma bases y cuotas
 * por tipo, así que líneas, desglose y total cuadran al céntimo. En `items` cada línea guarda, como el
 * resto de facturas de la plataforma, su importe CON IVA (`total`) y su tipo (`taxRate`).
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
  /** Precio unitario SIN IVA. */
  unitPrice: number;
  taxRate: DirectInvoiceTaxRate;
}

export interface DirectInvoiceItem {
  description: string;
  quantity: number;
  /** Precio unitario CON IVA (redondeado a céntimos). */
  unitPrice: number;
  /** Importe de la línea CON IVA. */
  total: number;
  fiscalRegime: "general";
  taxRate: number;
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

export function computeDirectInvoice(lines: DirectInvoiceLine[]): DirectInvoiceAmounts {
  const byRate = new Map<number, { base: number; amount: number }>();
  const items: DirectInvoiceItem[] = lines.map((l) => {
    const base = round2(l.quantity * l.unitPrice);
    const amount = round2((base * l.taxRate) / 100);
    const gross = round2(base + amount);
    const cur = byRate.get(l.taxRate) ?? { base: 0, amount: 0 };
    cur.base = round2(cur.base + base);
    cur.amount = round2(cur.amount + amount);
    byRate.set(l.taxRate, cur);
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.quantity ? round2(gross / l.quantity) : gross,
      total: gross,
      fiscalRegime: "general" as const,
      taxRate: l.taxRate,
    };
  });
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

// ─── Formulario «Nueva factura» ──────────────────────────────────────────────

export type InvoiceLineDraft = { description: string; quantity: string; unitPrice: string; taxRate: DirectInvoiceTaxRate };
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
  });
  return e;
}

