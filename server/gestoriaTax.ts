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
import { and, gte, lt, lte, ne, or, isNull, isNotNull, inArray } from "drizzle-orm";
import { invoices, reavExpedients, expenses, hrIrpfLedger } from "../drizzle/schema";
import { calcGeneralTax } from "./taxUtils";

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
    .select({
      amount: expenses.amount,
      taxBase: expenses.taxBase,
      taxAmount: expenses.taxAmount,
      taxRate: expenses.taxRate,
      deductiblePercent: expenses.deductiblePercent,
      source: expenses.source,
    })
    .from(expenses)
    .where(or(
      and(gte(expenses.accrualDate, startStr), lte(expenses.accrualDate, endStr)),
      and(isNull(expenses.accrualDate), gte(expenses.date, startStr), lte(expenses.date, endStr)),
    ));
  let inputBase = 0;
  let inputAmount = 0;
  for (const e of expRows) {
    // Nóminas, Seguridad Social y bonus (origen RRHH) no llevan IVA: no van
    // en el Modelo 303 (se declaran vía 111 / TC).
    if (e.source && e.source.startsWith("hr_")) continue;
    const ded = Number(e.deductiblePercent ?? 100) / 100;
    let base = Number(e.taxBase ?? NaN);
    let cuota = Number(e.taxAmount ?? NaN);
    // Gasto sin desglose fiscal guardado (creado fuera del formulario de
    // gastos): se deriva la base y la cuota de su importe total y su tipo.
    if (!Number.isFinite(base) || !Number.isFinite(cuota)) {
      const d = calcGeneralTax(Number(e.amount ?? 0), Number(e.taxRate ?? 21));
      base = d.taxBase;
      cuota = d.taxAmount;
    }
    inputBase += base * ded;
    inputAmount += cuota * ded;
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

// ─── OBLIGACIONES LABORALES — Modelos 111 y 190 (Fase 3) ─────────────────────

export type Labor111 = {
  periodKey: string;
  workerBase: number;
  workerRetention: number;
  workerCount: number;
  professionalBase: number;
  professionalRetention: number;
  professionalCount: number;
  totalRetention: number;
};

export type Labor190 = {
  year: number;
  quarters: Labor111[];
  workerRetention: number;
  professionalRetention: number;
  totalRetention: number;
};

/**
 * Calcula el Modelo 111 de un trimestre. periodKey = 'YYYY-TX'.
 * Retenciones del trabajo desde hr_irpf_ledger (nóminas y bonus) y
 * retenciones a profesionales desde los gastos con retención practicada.
 */
export async function compute111(periodKey: string): Promise<Labor111> {
  const m = periodKey.match(/^(\d{4})-T([1-4])$/);
  if (!m) throw new Error(`periodKey laboral inválido: ${periodKey}`);
  const year = Number(m[1]);
  const q = Number(m[2]);
  const { startStr, endStr } = quarterRange(year, q);
  const months = [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + 1 + i).padStart(2, "0")}`);

  // Retenciones de rendimientos del trabajo (hr_irpf_ledger).
  const irpfRows = await db
    .select({ taxableBase: hrIrpfLedger.taxableBase, retainedAmount: hrIrpfLedger.retainedAmount })
    .from(hrIrpfLedger)
    .where(inArray(hrIrpfLedger.period, months));
  const workerBase = round2(irpfRows.reduce((s, r) => s + Number(r.taxableBase ?? 0), 0));
  const workerRetention = round2(irpfRows.reduce((s, r) => s + Number(r.retainedAmount ?? 0), 0));

  // Retenciones a profesionales / arrendadores (gastos con retención).
  const expRows = await db
    .select({ taxBase: expenses.taxBase, retentionAmount: expenses.retentionAmount })
    .from(expenses)
    .where(and(
      isNotNull(expenses.retentionAmount),
      or(
        and(gte(expenses.accrualDate, startStr), lte(expenses.accrualDate, endStr)),
        and(isNull(expenses.accrualDate), gte(expenses.date, startStr), lte(expenses.date, endStr)),
      ),
    ));
  const professionalBase = round2(expRows.reduce((s, r) => s + Number(r.taxBase ?? 0), 0));
  const professionalRetention = round2(expRows.reduce((s, r) => s + Number(r.retentionAmount ?? 0), 0));

  return {
    periodKey,
    workerBase,
    workerRetention,
    workerCount: irpfRows.length,
    professionalBase,
    professionalRetention,
    professionalCount: expRows.length,
    totalRetention: round2(workerRetention + professionalRetention),
  };
}

/** Calcula el Modelo 190 (resumen anual de retenciones). */
export async function compute190(year: number): Promise<Labor190> {
  const quarters = await Promise.all([1, 2, 3, 4].map((q) => compute111(`${year}-T${q}`)));
  return {
    year,
    quarters,
    workerRetention: round2(quarters.reduce((s, q) => s + q.workerRetention, 0)),
    professionalRetention: round2(quarters.reduce((s, q) => s + q.professionalRetention, 0)),
    totalRetention: round2(quarters.reduce((s, q) => s + q.totalRetention, 0)),
  };
}

/** Líneas de desglose (tax_obligation_lines) de un resultado 111. */
export function lines111(r: Labor111): { concept: string; base: string; rate: string | null; amount: string; sourceType: string }[] {
  return [
    {
      concept: "Retenciones de rendimientos del trabajo",
      base: String(r.workerBase), rate: null, amount: String(r.workerRetention), sourceType: "hr_irpf",
    },
    {
      concept: "Retenciones a profesionales y arrendadores",
      base: String(r.professionalBase), rate: null, amount: String(r.professionalRetention), sourceType: "expenses",
    },
  ];
}

// ─── IMPUESTO DE SOCIEDADES — Modelos 200 y 202 (Fase 4) ─────────────────────

export type Corporate = {
  year: number;
  income: number;
  expenses: number;
  result: number;
  taxRate: number;
  quota: number;
  installments: { period: "1P" | "2P" | "3P"; cumulativeBase: number; payment: number }[];
};

/**
 * Cuenta de resultados acumulada del ejercicio hasta un mes (inclusive).
 * Ingresos = base de facturas emitidas no anuladas (abonos restan).
 * Gastos = base imponible de los gastos (coste neto deducible).
 * Es una estimación: no contempla amortizaciones formales ni ajustes
 * extracontables, que aplica la gestoría.
 */
async function plUpToMonth(year: number, monthInclusive: number): Promise<{ income: number; expenses: number }> {
  const start = new Date(year, 0, 1);
  const endExcl = new Date(year, monthInclusive, 1);
  const startStr = `${year}-01-01`;
  const lastDay = new Date(year, monthInclusive, 0).getDate();
  const endStr = `${year}-${String(monthInclusive).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const invRows = await db
    .select({ subtotal: invoices.subtotal, invoiceType: invoices.invoiceType })
    .from(invoices)
    .where(and(gte(invoices.issuedAt, start), lt(invoices.issuedAt, endExcl), ne(invoices.status, "anulada")));
  const income = round2(invRows.reduce(
    (s, r) => s + (r.invoiceType === "abono" ? -1 : 1) * Number(r.subtotal ?? 0), 0));

  const expRows = await db
    .select({ taxBase: expenses.taxBase, amount: expenses.amount })
    .from(expenses)
    .where(or(
      and(gte(expenses.accrualDate, startStr), lte(expenses.accrualDate, endStr)),
      and(isNull(expenses.accrualDate), gte(expenses.date, startStr), lte(expenses.date, endStr)),
    ));
  const exp = round2(expRows.reduce(
    (s, r) => s + (r.taxBase != null ? Number(r.taxBase) : Number(r.amount ?? 0)), 0));

  return { income, expenses: exp };
}

/**
 * Estima el Impuesto de Sociedades (Modelo 200) y los pagos fraccionados
 * (Modelo 202, modalidad base). Coeficiente del 202 = 5/7 del tipo, redondeado
 * por defecto (17 % para el tipo general del 25 %).
 */
export async function computeCorporate(year: number, taxRate: number): Promise<Corporate> {
  const annual = await plUpToMonth(year, 12);
  const result = round2(annual.income - annual.expenses);
  const quota = result > 0 ? round2((result * taxRate) / 100) : 0;

  const coef = Math.floor((taxRate * 5) / 7) / 100;
  const [pl3, pl9, pl11] = await Promise.all([
    plUpToMonth(year, 3), plUpToMonth(year, 9), plUpToMonth(year, 11),
  ]);
  const b3 = round2(pl3.income - pl3.expenses);
  const b9 = round2(pl9.income - pl9.expenses);
  const b11 = round2(pl11.income - pl11.expenses);
  const p1 = Math.max(0, round2(b3 * coef));
  const p2 = Math.max(0, round2(b9 * coef - p1));
  const p3 = Math.max(0, round2(b11 * coef - p1 - p2));

  return {
    year,
    income: annual.income,
    expenses: annual.expenses,
    result,
    taxRate,
    quota,
    installments: [
      { period: "1P", cumulativeBase: b3, payment: p1 },
      { period: "2P", cumulativeBase: b9, payment: p2 },
      { period: "3P", cumulativeBase: b11, payment: p3 },
    ],
  };
}

/** Líneas de desglose (tax_obligation_lines) del Modelo 200. */
export function lines200(c: Corporate): { concept: string; base: string; rate: string | null; amount: string; sourceType: string }[] {
  return [
    { concept: "Ingresos devengados", base: String(c.income), rate: null, amount: String(c.income), sourceType: "invoices" },
    { concept: "Gastos deducibles", base: String(c.expenses), rate: null, amount: String(-c.expenses), sourceType: "expenses" },
    { concept: "Cuota Impuesto de Sociedades estimada", base: String(c.result), rate: String(c.taxRate), amount: String(c.quota), sourceType: "calc" },
  ];
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
