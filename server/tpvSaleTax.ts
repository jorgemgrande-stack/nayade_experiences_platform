/**
 * IVA de una venta de caja con el criterio de las facturas de presupuestos (server/invoiceCalc.ts): las líneas
 * llevan el IVA incluido y no reflejan el descuento global del ticket, así que el descuento se reparte entre
 * los tipos de IVA (y la parte sin IVA repercutido) en proporción a su importe ANTES de desglosar. El total es
 * lo cobrado y base + IVA de cada tipo cuadran al céntimo con él.
 *
 * Las líneas del ticket guardan su fiscalidad sin el descuento global (el informe de caja la reparte con el
 * total de la venta); la venta, el asiento y la factura guardan la ya descontada y su desglose por tipo.
 */
import { chargedInvoiceAmounts, round2 } from "./invoiceCalc";
import type { TaxBreakdownLine } from "./taxUtils";

export interface TpvTaxLine {
  /** Importe de la línea con IVA, sin el descuento global. */
  lineSubtotal: number;
  fiscalRegime: "reav" | "general" | "mixed" | string | null | undefined;
  taxRate: number | string | null | undefined;
}

export interface TpvSaleTax {
  /** Base y cuota por tipo de IVA, ya con el descuento (sin la parte REAV). */
  taxBreakdown: TaxBreakdownLine[];
  /** Base imponible del IVA (suma de las bases del desglose). */
  taxBase: number;
  taxAmount: number;
  /** Tipo único si solo hay uno; si mezcla tipos, el efectivo (cuota / base). */
  taxRate: number;
  /** Base de todo lo cobrado (incluida la parte sin IVA repercutido): subtotal + taxAmount = total. */
  subtotal: number;
  total: number;
  /** Lo cobrado / la suma de las líneas (1 sin descuento global): reparte entre las líneas lo que no es IVA. */
  ratio: number;
}

export function tpvSaleTax(lines: TpvTaxLine[], total: number): TpvSaleTax {
  const items = lines.map((l) => ({
    total: Number(l.lineSubtotal) || 0,
    fiscalRegime: l.fiscalRegime === "reav" ? "reav" : "general",
    taxRate: l.fiscalRegime === "reav" ? 0 : Number(l.taxRate ?? 21),
  }));
  const linesSum = round2(items.reduce((s, i) => s + i.total, 0));
  const a = chargedInvoiceAmounts(items, total);
  const taxBase = round2(a.taxBreakdown.reduce((s, b) => s + b.base, 0));
  const taxRate = a.taxBreakdown.length === 1
    ? a.taxBreakdown[0].rate
    : taxBase > 0 ? round2((a.taxAmount / taxBase) * 100) : 0;
  return {
    taxBreakdown: a.taxBreakdown,
    taxBase,
    taxAmount: a.taxAmount,
    taxRate,
    subtotal: a.subtotal,
    total: a.total,
    ratio: linesSum > 0 ? a.total / linesSum : 1,
  };
}
