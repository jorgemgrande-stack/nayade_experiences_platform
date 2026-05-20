// Gestoría e Impuestos — motor de cálculo del IVA (Fase 2).
//
// Modelo 303 (trimestral) y 390 (resumen anual). El IVA repercutido se calcula
// sobre las FACTURAS EMITIDAS no anuladas (fuente fiscal correcta); las
// operaciones REAV se computan aparte (IVA sobre margen, no sobre venta); el
// IVA soportado deducible sale de los gastos con su desglose y % deducible.
//
// Es una ESTIMACIÓN: la liquidación oficial la realiza la gestoría.

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { and, gte, lt, lte, ne, or, isNull } from "drizzle-orm";
import { invoices, reavExpedients, expenses } from "../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type Vat303 = {
  periodKey: string;
  outputByRate: { rate: number; base: number; amount: number }[];
  outputBase: number;
  outputAmount: number;
  reavBase: number;
  reavAmount: number;
  inputBase: number;
  inputAmount: number;
  result: number;
};

export type Vat390 = {
  year: number;
  quarters: Vat303[];
  outputAmount: number;
  reavAmount: number;
  inputAmount: number;
  result: number;
};

/** Rango de fechas de un trimestre (q = 1..4) de un ejercicio. */
function quarterRange(year: number, q: number) {
  const startMonth = (q - 1) * 3; // 0-indexed
  const start = new Date(year, startMonth, 1);
  const endExcl = new Date(year, startMonth + 3, 1);
  const lastDay = new Date(year, startMonth + 3, 0).getDate();
  const startStr = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const endStr = `${year}-${String(startMonth + 3).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, endExcl, startStr, endStr };
}

/** Calcula el Modelo 303 de un trimestre. periodKey = 'YYYY-TX'. */
export async function compute303(periodKey: string): Promise<Vat303> {
  const m = periodKey.match(/^(\d{4})-T([1-4])$/);
  if (!m) throw new Error(`periodKey de IVA inválido: ${periodKey}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  const { start, endExcl, startStr, endStr } = quarterRange(year, q);

  // ── IVA repercutido — facturas emitidas no anuladas (abonos restan) ──
  const invRows = await db
    .select({
      taxBreakdown: invoices.taxBreakdown,
      subtotal: invoices.subtotal,
      taxRate: invoices.taxRate,
      taxAmount: invoices.taxAmount,
      invoiceType: invoices.invoiceType,
    })
    .from(invoices)
    .where(and(gte(invoices.issuedAt, start), lt(invoices.issuedAt, endExcl), ne(invoices.status, "anulada")));

  const byRate = new Map<number, { base: number; amount: number }>();
  for (const inv of invRows) {
    const sign = inv.invoiceType === "abono" ? -1 : 1;
    const breakdown = inv.taxBreakdown && inv.taxBreakdown.length > 0
      ? inv.taxBreakdown
      : [{ rate: Number(inv.taxRate ?? 21), base: Number(inv.subtotal ?? 0), amount: Number(inv.taxAmount ?? 0) }];
    for (const line of breakdown) {
      const rate = Number(line.rate) || 0;
      const cur = byRate.get(rate) ?? { base: 0, amount: 0 };
      cur.base += sign * (Number(line.base) || 0);
      cur.amount += sign * (Number(line.amount) || 0);
      byRate.set(rate, cur);
    }
  }
  const outputByRate = Array.from(byRate.entries())
    .map(([rate, v]) => ({ rate, base: round2(v.base), amount: round2(v.amount) }))
    .sort((a, b) => b.rate - a.rate);
  const outputBase = round2(outputByRate.reduce((s, l) => s + l.base, 0));
  const outputAmount = round2(outputByRate.reduce((s, l) => s + l.amount, 0));

  // ── IVA REAV — expedientes del periodo (por fecha de servicio) ──
  const reavRows = await db
    .select({ reavTaxBase: reavExpedients.reavTaxBase, reavTaxAmount: reavExpedients.reavTaxAmount })
    .from(reavExpedients)
    .where(and(
      gte(reavExpedients.serviceDate, startStr),
      lte(reavExpedients.serviceDate, endStr),
      ne(reavExpedients.operativeStatus, "anulado"),
    ));
  const reavBase = round2(reavRows.reduce((s, r) => s + Number(r.reavTaxBase ?? 0), 0));
  const reavAmount = round2(reavRows.reduce((s, r) => s + Number(r.reavTaxAmount ?? 0), 0));

  // ── IVA soportado deducible — gastos del periodo (por devengo) ──
  const expRows = await db
    .select({ taxBase: expenses.taxBase, taxAmount: expenses.taxAmount, deductiblePercent: expenses.deductiblePercent })
    .from(expenses)
    .where(or(
      and(gte(expenses.accrualDate, startStr), lte(expenses.accrualDate, endStr)),
      and(isNull(expenses.accrualDate), gte(expenses.date, startStr), lte(expenses.date, endStr)),
    ));
  let inputBase = 0;
  let inputAmount = 0;
  for (const e of expRows) {
    const ded = Number(e.deductiblePercent ?? 100) / 100;
    inputBase += Number(e.taxBase ?? 0) * ded;
    inputAmount += Number(e.taxAmount ?? 0) * ded;
  }
  inputBase = round2(inputBase);
  inputAmount = round2(inputAmount);

  const result = round2(outputAmount + reavAmount - inputAmount);
  return { periodKey, outputByRate, outputBase, outputAmount, reavBase, reavAmount, inputBase, inputAmount, result };
}

/** Calcula el Modelo 390 (resumen anual) agregando los cuatro trimestres. */
export async function compute390(year: number): Promise<Vat390> {
  const quarters = await Promise.all([1, 2, 3, 4].map((q) => compute303(`${year}-T${q}`)));
  return {
    year,
    quarters,
    outputAmount: round2(quarters.reduce((s, q) => s + q.outputAmount, 0)),
    reavAmount: round2(quarters.reduce((s, q) => s + q.reavAmount, 0)),
    inputAmount: round2(quarters.reduce((s, q) => s + q.inputAmount, 0)),
    result: round2(quarters.reduce((s, q) => s + q.result, 0)),
  };
}

/** Líneas de desglose (tax_obligation_lines) de un resultado 303. */
export function lines303(r: Vat303): { concept: string; base: string; rate: string | null; amount: string; sourceType: string }[] {
  const out: { concept: string; base: string; rate: string | null; amount: string; sourceType: string }[] = [];
  for (const l of r.outputByRate) {
    out.push({
      concept: `IVA repercutido ${l.rate}%`,
      base: String(l.base), rate: String(l.rate), amount: String(l.amount), sourceType: "invoices",
    });
  }
  if (r.reavAmount !== 0 || r.reavBase !== 0) {
    out.push({
      concept: "IVA REAV (sobre margen)",
      base: String(r.reavBase), rate: "21", amount: String(r.reavAmount), sourceType: "reav",
    });
  }
  out.push({
    concept: "IVA soportado deducible",
    base: String(r.inputBase), rate: null, amount: String(-r.inputAmount), sourceType: "expenses",
  });
  return out;
}
