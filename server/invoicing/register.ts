/**
 * Libro registro de facturas expedidas (para la contabilidad y la gestoría), en CSV de hoja de cálculo española (separador
 * «;», coma decimal, UTF-8 con BOM). Una fila por tipo de IVA de cada factura EXPEDIDA del periodo (por fecha de
 * expedición): fechas de expedición y de operación, serie y número, tipo (F1 factura, R1 rectificativa), destinatario,
 * base, tipo y cuota de IVA, total, factura rectificada y estado de cobro. Los borradores no se registran. Función pura.
 */
import type { Invoice } from "./types";

const HEADER = ["Fecha de expedición", "Fecha de operación", "Serie", "Número", "Tipo", "NIF del destinatario", "Nombre o razón social", "Base imponible", "Tipo de IVA (%)", "Cuota de IVA", "Total de la factura", "Factura rectificada", "Estado de cobro"];
const PAYMENT: Record<Invoice["paymentStatus"], string> = { pending: "Pendiente", paid: "Cobrada", failed: "Cobro fallido", refunded: "Reembolsada" };

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const pct = (bp: number) => (bp / 100).toFixed(2).replace(".", ",");
const date = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "");
/** Campo CSV: entre comillas si lleva separador, comillas o saltos; las fórmulas no se interpretan (=, +, -, @). */
const cell = (v: string) => {
  const safe = /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registerCsv(invoices: Invoice[], byId: Map<number, Invoice> = new Map(invoices.map((i) => [i.id, i]))): string {
  const rows: string[][] = [];
  const issued = invoices.filter((i) => i.number && i.issueDate && (i.status === "issued" || i.status === "rectified")).sort((a, b) => (a.issueDate! + a.number!).localeCompare(b.issueDate! + b.number!));
  for (const inv of issued) {
    const byRate = new Map<number, { base: number; tax: number }>();
    for (const l of inv.lines) {
      const r = byRate.get(l.taxRateBp) ?? { base: 0, tax: 0 };
      byRate.set(l.taxRateBp, { base: r.base + l.baseCents, tax: r.tax + l.taxCents });
    }
    const original = inv.originalInvoiceId ? byId.get(inv.originalInvoiceId) : undefined;
    for (const [rate, t] of Array.from(byRate))
      rows.push([
        date(inv.issueDate),
        date(inv.operationDate),
        inv.seriesCode ?? "",
        inv.number!,
        inv.kind === "rectification" ? "R1" : "F1",
        inv.customer?.taxId ?? "",
        inv.customer?.legalName ?? "",
        money(t.base),
        pct(rate),
        money(t.tax),
        money(inv.totalCents),
        original?.number ?? "",
        PAYMENT[inv.paymentStatus],
      ]);
  }
  return "﻿" + [HEADER, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
