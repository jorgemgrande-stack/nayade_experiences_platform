/**
 * Resumen contable del panel (Contabilidad › Resumen) con los datos reales de la empresa, sin acceso a BD.
 *
 * Series por mes (hora de Madrid) de los últimos meses:
 *  - ventas: pedidos y tickets de caja cobrados (importe cobrado, por la fecha de cobro);
 *  - cobros: entradas del libro de cobros (ingresos completados menos devoluciones);
 *  - facturado: facturas emitidas menos abonos (las anuladas no cuentan);
 *  - gastos: gastos registrados (solo si la empresa tiene alguno).
 * Ventas por categoría: la categoría real del producto vendido; las líneas sin producto, «Sin categoría».
 */

export const SUMMARY_MONTHS = 6;
export const NO_CATEGORY = "Sin categoría";

const MONTH_FMT = new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" });
const MONTH_LABEL = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Mes (AAAA-MM) de un instante, en hora de Madrid. */
export function madridMonthKey(at: number | Date): string {
  return MONTH_FMT.format(typeof at === "number" ? new Date(at) : at);
}

/** Los `count` últimos meses (AAAA-MM), del más antiguo al actual. */
export function lastMonthKeys(now: number, count = SUMMARY_MONTHS): string[] {
  const [y, m] = madridMonthKey(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Instante (ms) desde el que hay que leer para cubrir los meses: un día antes del primero, por el huso. */
export function periodStartMs(months: string[]): number {
  const [y, m] = months[0].split("-").map(Number);
  return Date.UTC(y, m - 1, 1) - 24 * 3600 * 1000;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1))).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface SummaryInput {
  now: number;
  /** Pedidos y tickets cobrados: importe cobrado en euros. */
  sales: Array<{ at: number; amount: number }>;
  /** Libro de cobros: importe en euros con signo (las devoluciones en negativo). */
  payments: Array<{ at: number; amount: number }>;
  /** Facturas y abonos emitidos: total en euros con signo (abonos en negativo). */
  invoices: Array<{ at: number; amount: number }>;
  /** Gastos registrados (null = la empresa no lleva gastos). */
  expenses: Array<{ month: string; amount: number }> | null;
  /** Importe vendido por categoría de producto (null = sin categoría). */
  categories: Array<{ category: string | null; amount: number }>;
  /** Presupuestos enviados y aún sin respuesta (null = no aplica). */
  pendingQuotes: number | null;
}

export interface AccountingSummary {
  months: Array<{ key: string; label: string; sales: number; payments: number; invoiced: number; expenses: number }>;
  totals: { sales: number; salesCount: number; averageTicket: number; payments: number; invoiced: number; invoiceCount: number; expenses: number };
  categories: Array<{ name: string; amount: number; percent: number }>;
  hasExpenses: boolean;
  /** Hay algún dato en el periodo (si no, la pantalla muestra la guía para empezar). */
  hasData: boolean;
  pendingQuotes: number | null;
}

export function buildAccountingSummary(input: SummaryInput): AccountingSummary {
  const keys = lastMonthKeys(input.now);
  const inPeriod = new Set(keys);
  const rows = new Map(keys.map((k) => [k, { key: k, label: monthLabel(k), sales: 0, payments: 0, invoiced: 0, expenses: 0 }]));
  let salesCount = 0;
  let invoiceCount = 0;
  const add = (at: number, field: "sales" | "payments" | "invoiced", amount: number) => {
    const k = madridMonthKey(at);
    const r = rows.get(k);
    if (!r || !Number.isFinite(amount)) return false;
    r[field] = round2(r[field] + amount);
    return true;
  };
  for (const s of input.sales) if (add(s.at, "sales", s.amount)) salesCount += 1;
  for (const p of input.payments) add(p.at, "payments", p.amount);
  for (const i of input.invoices) if (add(i.at, "invoiced", i.amount) && i.amount > 0) invoiceCount += 1;
  for (const e of input.expenses ?? []) {
    const r = inPeriod.has(e.month) ? rows.get(e.month) : undefined;
    if (r && Number.isFinite(e.amount)) r.expenses = round2(r.expenses + e.amount);
  }
  const months = keys.map((k) => rows.get(k)!);
  const sum = (f: "sales" | "payments" | "invoiced" | "expenses") => round2(months.reduce((s, m) => s + m[f], 0));
  const totals = {
    sales: sum("sales"),
    salesCount,
    averageTicket: salesCount > 0 ? round2(sum("sales") / salesCount) : 0,
    payments: sum("payments"),
    invoiced: sum("invoiced"),
    invoiceCount,
    expenses: sum("expenses"),
  };

  const byCat = new Map<string, number>();
  for (const c of input.categories) {
    if (!(c.amount > 0)) continue;
    const name = c.category?.trim() || NO_CATEGORY;
    byCat.set(name, round2((byCat.get(name) ?? 0) + c.amount));
  }
  const catTotal = Array.from(byCat.values()).reduce((s, v) => s + v, 0);
  const categories = Array.from(byCat.entries())
    .map(([name, amount]) => ({ name, amount, percent: catTotal > 0 ? Math.round((amount / catTotal) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "es"));

  const hasExpenses = (input.expenses ?? []).some((e) => e.amount !== 0) && totals.expenses !== 0;
  const hasData = months.some((m) => m.sales !== 0 || m.payments !== 0 || m.invoiced !== 0 || m.expenses !== 0);
  return { months, totals, categories, hasExpenses, hasData, pendingQuotes: input.pendingQuotes };
}

/**
 * Reparte el total cobrado de un ticket entre sus líneas en proporción a su importe (el descuento global
 * del ticket reduce cada línea por igual); el céntimo de redondeo va a la línea mayor.
 */
export function prorateTicket(total: number, lines: number[]): number[] {
  const sum = lines.reduce((s, n) => s + (n > 0 ? n : 0), 0);
  if (!(sum > 0)) return lines.map(() => 0);
  const out = lines.map((n) => round2(((n > 0 ? n : 0) * total) / sum));
  const diff = round2(total - out.reduce((s, n) => s + n, 0));
  if (diff !== 0) {
    const i = out.reduce((best, n, idx) => (n > out[best] ? idx : best), 0);
    out[i] = round2(out[i] + diff);
  }
  return out;
}
