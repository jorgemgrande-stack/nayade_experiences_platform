/**
 * Informes del TPV (cálculo puro, sin base de datos): lo usan `server/tpvReportsDb.ts` y las pruebas.
 *
 * Idea tomada de los informes de caja de Skicenter (ventas por producto, por vendedor con ticket medio y filtro de
 * fechas en hora de Madrid), reescrita para cualquier comercio y ampliada con ventas por día, formas de pago, IVA,
 * anulaciones y cierres de caja con descuadres.
 *
 * Criterios:
 *  - Una venta cuenta si se llegó a cobrar: estado `paid`, `cancelled` o `refunded` con algún cobro completado (el
 *    mismo criterio que el cierre de caja, ver tpvSessionTotals.ts). Las ventas a medias o que no se pudieron grabar
 *    (anuladas sin cobros) no aparecen en ningún informe.
 *  - Ventas netas = las `paid`. Las anuladas y devueltas se listan aparte con su importe.
 *  - La fecha de una venta es la de cobro (si no consta, la de creación) en Europe/Madrid.
 *  - Los importes se suman en céntimos para que no aparezcan descuadres de redondeo.
 *  - El descuento sobre el ticket completo se reparte entre sus líneas en proporción a su importe, de modo que la suma
 *    por producto, por categoría o por IVA coincide con las ventas netas.
 */
import { madridDateKey, madridMidnightMs, nextDateKey } from "./utils/timezone";

export interface ReportSaleRow {
  id: number;
  ticketNumber: string;
  sessionId: number;
  registerId: number;
  registerName: string | null;
  status: string;
  total: string | number | null;
  discountAmount: string | number | null;
  paidAt: number | null;
  createdAt: number;
  sellerUserId: number | null;
  sellerName: string | null;
  cashierName: string | null;
  customerName: string | null;
}

export interface ReportItemRow {
  saleId: number;
  productType: string;
  productId: number;
  productName: string;
  isManual: boolean | number | null;
  conceptText: string | null;
  categoryName: string | null;
  quantity: number;
  subtotal: string | number | null;
  taxRate: string | number | null;
  taxBase: string | number | null;
  taxAmount: string | number | null;
  fiscalRegime: string | null;
}

export interface ReportPaymentRow {
  saleId: number;
  method: string;
  amount: string | number | null;
  status: string;
}

export interface ReportSessionRow {
  id: number;
  registerId: number;
  registerName: string | null;
  cashierName: string | null;
  openedAt: number;
  closedAt: number | null;
  openingAmount: string | number | null;
  closingAmount: string | number | null;
  countedCash: string | number | null;
  cashDifference: string | number | null;
  totalCash: string | number | null;
  totalCard: string | number | null;
  totalBizum: string | number | null;
  totalMixed: string | number | null;
  totalManualIn: string | number | null;
  totalManualOut: string | number | null;
}

export interface TpvReportInput {
  dateFrom: string;
  dateTo: string;
  registerId: number | null;
  sales: ReportSaleRow[];
  items: ReportItemRow[];
  payments: ReportPaymentRow[];
  sessions: ReportSessionRow[];
}

/** Estados de una venta que sí se llegó a cobrar (mismo criterio que el cierre de caja). */
export const REPORT_RECEIVED_STATUSES = ["paid", "cancelled", "refunded"] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro" };
export const SALE_STATUS_LABELS: Record<string, string> = { paid: "Cobrada", cancelled: "Anulada", refunded: "Devuelta" };

/** Grupo de las líneas que no son productos del catálogo propio (solo aparecen si la empresa los vendió). */
const TYPE_GROUP_LABELS: Record<string, string> = {
  pack: "Packs",
  legoPack: "Packs",
  spa: "Tratamientos",
  hotel: "Alojamiento",
  restaurant: "Restaurante",
  extra: "Extras",
};
export const MANUAL_GROUP_LABEL = "Conceptos libres";
export const NO_CATEGORY_LABEL = "Sin categoría";
/** Diferencia de caja a partir de la cual se considera descuadre (un céntimo). */
export const CASH_TOLERANCE_CENTS = 1;
/** Rango máximo de un informe. */
export const MAX_REPORT_DAYS = 366;

/** Importe a céntimos (acepta los DECIMAL que devuelve MySQL como texto). */
export function toCents(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const eur = (cents: number) => cents / 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// El día siguiente y la medianoche de Madrid se comparten con el resto del servidor (utils/timezone).
export { nextDateKey, madridMidnightMs };

/**
 * Instantes [desde, hasta) en milisegundos del rango de días de Madrid. El final es el inicio del día siguiente: así
 * los días de cambio de hora (23 o 25 horas) quedan completos.
 */
export function madridRangeMs(dateFrom: string, dateTo: string): { fromMs: number; toMsExclusive: number } {
  if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo) || Number.isNaN(Date.parse(`${dateFrom}T00:00:00Z`)) || Number.isNaN(Date.parse(`${dateTo}T00:00:00Z`))) {
    throw new Error("Fechas no válidas (AAAA-MM-DD)");
  }
  if (dateFrom > dateTo) throw new Error("La fecha de inicio es posterior a la de fin");
  return { fromMs: madridMidnightMs(dateFrom), toMsExclusive: madridMidnightMs(nextDateKey(dateTo)) };
}

/** Días naturales del rango (ambos incluidos). */
export function rangeDays(dateFrom: string, dateTo: string): number {
  return Math.round((Date.parse(`${dateTo}T12:00:00Z`) - Date.parse(`${dateFrom}T12:00:00Z`)) / 86_400_000) + 1;
}

/** Fecha de la venta en Madrid: la de cobro y, si no consta, la de creación. */
export function saleDateKey(s: Pick<ReportSaleRow, "paidAt" | "createdAt">): string {
  return madridDateKey(new Date(Number(s.paidAt ?? s.createdAt)));
}

/** Reparte `total` céntimos en proporción a `weights` (resto mayor): la suma del reparto es exactamente `total`. */
export function prorateCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length, rest--) out[order[k].i] += 1;
  return out;
}

export interface TpvReport {
  period: { dateFrom: string; dateTo: string; timeZone: "Europe/Madrid"; registerId: number | null };
  summary: {
    tickets: number;
    netSales: number;
    taxBase: number;
    taxAmount: number;
    averageTicket: number;
    ticketDiscounts: number;
    units: number;
    voidedTickets: number;
    voidedAmount: number;
    refundedTickets: number;
    refundedAmount: number;
  };
  byDay: Array<{ date: string; tickets: number; netSales: number; averageTicket: number; voidedTickets: number; voidedAmount: number }>;
  byProduct: Array<{ product: string; category: string; units: number; amount: number; share: number }>;
  byCategory: Array<{ category: string; units: number; amount: number; share: number }>;
  byPaymentMethod: Array<{ method: string; label: string; payments: number; amount: number; share: number }>;
  byTaxRate: Array<{ rate: string; label: string; taxBase: number; taxAmount: number; amount: number }>;
  byCashier: Array<{ cashier: string; tickets: number; netSales: number; averageTicket: number }>;
  voids: Array<{ ticketNumber: string; date: string; status: string; statusLabel: string; amount: number; cashier: string; register: string; customer: string }>;
  closures: {
    sessions: Array<{
      sessionId: number; register: string; cashier: string; openedAt: number; closedAt: number;
      openingAmount: number; expectedCash: number; countedCash: number; difference: number;
      totalCash: number; totalCard: number; totalBizum: number; totalOther: number; manualIn: number; manualOut: number;
    }>;
    count: number;
    withDifference: number;
    shortage: number;
    surplus: number;
    netDifference: number;
  };
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

function itemLabel(it: ReportItemRow): { product: string; category: string; key: string } {
  const manual = it.isManual === true || it.isManual === 1;
  if (manual) {
    const name = (it.conceptText || it.productName || "Concepto libre").trim();
    return { product: name, category: MANUAL_GROUP_LABEL, key: `manual:${name.toLowerCase()}` };
  }
  const category = it.productType === "experience" ? (it.categoryName?.trim() || NO_CATEGORY_LABEL) : (TYPE_GROUP_LABELS[it.productType] ?? NO_CATEGORY_LABEL);
  return { product: it.productName, category, key: `${it.productType}:${it.productId}` };
}

function cashierOf(s: ReportSaleRow): string {
  return (s.sellerName?.trim() || s.cashierName?.trim() || "Sin identificar");
}

/** Informe completo del periodo. Las filas ya vienen filtradas por empresa (BD propia), fechas y caja. */
export function computeTpvReport(input: TpvReportInput): TpvReport {
  const paymentsBySale = new Map<number, ReportPaymentRow[]>();
  for (const p of input.payments) {
    const arr = paymentsBySale.get(p.saleId) ?? [];
    arr.push(p);
    paymentsBySale.set(p.saleId, arr);
  }
  const received = input.sales.filter(
    (s) => (REPORT_RECEIVED_STATUSES as readonly string[]).includes(s.status) && (paymentsBySale.get(s.id) ?? []).some((p) => p.status === "completed"),
  );
  const paid = received.filter((s) => s.status === "paid");
  const paidIds = new Set(paid.map((s) => s.id));

  // ── Resumen y por día ──────────────────────────────────────────────────────
  let netCents = 0, discountCents = 0;
  const days = new Map<string, { tickets: number; net: number; voidedTickets: number; voided: number }>();
  const day = (k: string) => {
    let d = days.get(k);
    if (!d) { d = { tickets: 0, net: 0, voidedTickets: 0, voided: 0 }; days.set(k, d); }
    return d;
  };
  const cashiers = new Map<string, { tickets: number; net: number }>();
  for (const s of paid) {
    const c = toCents(s.total);
    netCents += c;
    discountCents += toCents(s.discountAmount);
    const d = day(saleDateKey(s));
    d.tickets += 1;
    d.net += c;
    const who = cashierOf(s);
    const acc = cashiers.get(who) ?? { tickets: 0, net: 0 };
    acc.tickets += 1;
    acc.net += c;
    cashiers.set(who, acc);
  }

  let voidedTickets = 0, voidedCents = 0, refundedTickets = 0, refundedCents = 0;
  const voids: TpvReport["voids"] = [];
  for (const s of received) {
    if (s.status === "paid") continue;
    const c = toCents(s.total);
    if (s.status === "refunded") { refundedTickets += 1; refundedCents += c; } else { voidedTickets += 1; voidedCents += c; }
    const d = day(saleDateKey(s));
    d.voidedTickets += 1;
    d.voided += c;
    voids.push({
      ticketNumber: s.ticketNumber,
      date: saleDateKey(s),
      status: s.status,
      statusLabel: SALE_STATUS_LABELS[s.status] ?? s.status,
      amount: eur(c),
      cashier: cashierOf(s),
      register: s.registerName ?? "Caja",
      customer: s.customerName ?? "",
    });
  }
  voids.sort((a, b) => a.date.localeCompare(b.date) || a.ticketNumber.localeCompare(b.ticketNumber));

  // ── Líneas: producto, categoría e IVA (con el descuento del ticket repartido) ──
  const itemsBySale = new Map<number, ReportItemRow[]>();
  for (const it of input.items) {
    if (!paidIds.has(it.saleId)) continue;
    const arr = itemsBySale.get(it.saleId) ?? [];
    arr.push(it);
    itemsBySale.set(it.saleId, arr);
  }
  const products = new Map<string, { product: string; category: string; units: number; amount: number }>();
  const categories = new Map<string, { units: number; amount: number }>();
  const taxes = new Map<string, { label: string; base: number; tax: number; amount: number; sort: number }>();
  let units = 0, baseCents = 0, taxCents = 0;
  for (const s of paid) {
    const lines = itemsBySale.get(s.id) ?? [];
    if (lines.length === 0) continue;
    const lineCents = lines.map((l) => toCents(l.subtotal));
    const net = prorateCents(toCents(s.total), lineCents);
    const lineSum = lineCents.reduce((a, b) => a + b, 0);
    const ratio = lineSum > 0 ? toCents(s.total) / lineSum : 0;
    const bases = prorateCents(Math.round(lines.reduce((a, l) => a + toCents(l.taxBase), 0) * ratio), lines.map((l) => toCents(l.taxBase)));
    const taxAmounts = prorateCents(Math.round(lines.reduce((a, l) => a + toCents(l.taxAmount), 0) * ratio), lines.map((l) => toCents(l.taxAmount)));
    lines.forEach((l, i) => {
      const { product, category, key } = itemLabel(l);
      const qty = Number(l.quantity) || 0;
      units += qty;
      const p = products.get(key) ?? { product, category, units: 0, amount: 0 };
      p.units += qty;
      p.amount += net[i];
      products.set(key, p);
      const c = categories.get(category) ?? { units: 0, amount: 0 };
      c.units += qty;
      c.amount += net[i];
      categories.set(category, c);

      const reav = l.fiscalRegime === "reav";
      const rate = Number(parseFloat(String(l.taxRate ?? 0)) || 0);
      const tKey = reav ? "reav" : rate.toFixed(2);
      const label = reav ? "Régimen especial (margen)" : `IVA ${rate.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
      const t = taxes.get(tKey) ?? { label, base: 0, tax: 0, amount: 0, sort: reav ? 1000 : rate };
      t.base += bases[i];
      t.tax += taxAmounts[i];
      t.amount += net[i];
      taxes.set(tKey, t);
      baseCents += bases[i];
      taxCents += taxAmounts[i];
    });
  }

  // ── Formas de pago (cobros completados de las ventas netas) ────────────────
  const methods = new Map<string, { payments: number; amount: number }>();
  for (const s of paid) {
    for (const p of paymentsBySale.get(s.id) ?? []) {
      if (p.status !== "completed") continue;
      const m = methods.get(p.method) ?? { payments: 0, amount: 0 };
      m.payments += 1;
      m.amount += toCents(p.amount);
      methods.set(p.method, m);
    }
  }
  const methodsTotal = Array.from(methods.values()).reduce((a, m) => a + m.amount, 0);

  // ── Cierres de caja ────────────────────────────────────────────────────────
  const closureRows = input.sessions
    .filter((s) => s.closedAt != null)
    .sort((a, b) => Number(a.closedAt) - Number(b.closedAt))
    .map((s) => ({
      sessionId: s.id,
      register: s.registerName ?? "Caja",
      cashier: s.cashierName ?? "",
      openedAt: Number(s.openedAt),
      closedAt: Number(s.closedAt),
      openingAmount: eur(toCents(s.openingAmount)),
      expectedCash: eur(toCents(s.closingAmount)),
      countedCash: eur(toCents(s.countedCash)),
      difference: eur(toCents(s.cashDifference)),
      totalCash: eur(toCents(s.totalCash)),
      totalCard: eur(toCents(s.totalCard)),
      totalBizum: eur(toCents(s.totalBizum)),
      totalOther: eur(toCents(s.totalMixed)),
      manualIn: eur(toCents(s.totalManualIn)),
      manualOut: eur(toCents(s.totalManualOut)),
    }));
  let shortage = 0, surplus = 0, withDifference = 0;
  for (const s of input.sessions) {
    if (s.closedAt == null) continue;
    const d = toCents(s.cashDifference);
    if (Math.abs(d) >= CASH_TOLERANCE_CENTS) withDifference += 1;
    if (d < 0) shortage += -d; else surplus += d;
  }

  const tickets = paid.length;
  return {
    period: { dateFrom: input.dateFrom, dateTo: input.dateTo, timeZone: "Europe/Madrid", registerId: input.registerId },
    summary: {
      tickets,
      netSales: eur(netCents),
      taxBase: eur(baseCents),
      taxAmount: eur(taxCents),
      averageTicket: tickets > 0 ? eur(Math.round(netCents / tickets)) : 0,
      ticketDiscounts: eur(discountCents),
      units,
      voidedTickets,
      voidedAmount: eur(voidedCents),
      refundedTickets,
      refundedAmount: eur(refundedCents),
    },
    byDay: Array.from(days.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, tickets: d.tickets, netSales: eur(d.net), averageTicket: d.tickets > 0 ? eur(Math.round(d.net / d.tickets)) : 0, voidedTickets: d.voidedTickets, voidedAmount: eur(d.voided) })),
    byProduct: Array.from(products.values())
      .sort((a, b) => b.amount - a.amount || a.product.localeCompare(b.product))
      .map((p) => ({ product: p.product, category: p.category, units: p.units, amount: eur(p.amount), share: share(p.amount, netCents) })),
    byCategory: Array.from(categories.entries())
      .sort(([ka, a], [kb, b]) => b.amount - a.amount || ka.localeCompare(kb))
      .map(([category, c]) => ({ category, units: c.units, amount: eur(c.amount), share: share(c.amount, netCents) })),
    byPaymentMethod: Array.from(methods.entries())
      .sort(([, a], [, b]) => b.amount - a.amount)
      .map(([method, m]) => ({ method, label: PAYMENT_METHOD_LABELS[method] ?? method, payments: m.payments, amount: eur(m.amount), share: share(m.amount, methodsTotal) })),
    byTaxRate: Array.from(taxes.entries())
      .sort(([, a], [, b]) => a.sort - b.sort)
      .map(([rate, t]) => ({ rate, label: t.label, taxBase: eur(t.base), taxAmount: eur(t.tax), amount: eur(t.amount) })),
    byCashier: Array.from(cashiers.entries())
      .sort(([ka, a], [kb, b]) => b.net - a.net || ka.localeCompare(kb))
      .map(([cashier, c]) => ({ cashier, tickets: c.tickets, netSales: eur(c.net), averageTicket: c.tickets > 0 ? eur(Math.round(c.net / c.tickets)) : 0 })),
    voids,
    closures: {
      sessions: closureRows,
      count: closureRows.length,
      withDifference,
      shortage: eur(shortage),
      surplus: eur(surplus),
      netDifference: eur(surplus - shortage),
    },
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const REPORT_SECTIONS = ["dias", "productos", "categorias", "pagos", "iva", "cajeros", "anulaciones", "cierres"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const SECTION_TITLES: Record<ReportSection, string> = {
  dias: "Ventas por día",
  productos: "Ventas por producto",
  categorias: "Ventas por categoría",
  pagos: "Ventas por forma de pago",
  iva: "Desglose por IVA",
  cajeros: "Ventas por cajero",
  anulaciones: "Tickets anulados y devoluciones",
  cierres: "Cierres de caja",
};

/** Importe con coma decimal (hojas de cálculo en español). */
function num(n: number): string {
  return n.toFixed(2).replace(".", ",");
}
function madridDateTime(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

/** Celda de texto segura: entre comillas y sin fórmulas (lo que empieza por = + - @ se prefija con '). */
function textCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

type Cell = { t: string } | { n: number } | { i: number };
const T = (t: string): Cell => ({ t });
const N = (n: number): Cell => ({ n });
const I = (i: number): Cell => ({ i });
const renderCell = (c: Cell) => ("t" in c ? textCell(c.t) : "n" in c ? num(c.n) : String(c.i));

/** CSV de una sección del informe (separador «;», UTF-8 con BOM para que Excel lea las tildes). */
export function reportSectionCsv(report: TpvReport, section: ReportSection): string {
  let header: string[] = [];
  let rows: Cell[][] = [];
  switch (section) {
    case "dias":
      header = ["Fecha", "Tickets", "Ventas netas", "Ticket medio", "Anulados", "Importe anulado"];
      rows = report.byDay.map((d) => [T(d.date), I(d.tickets), N(d.netSales), N(d.averageTicket), I(d.voidedTickets), N(d.voidedAmount)]);
      break;
    case "productos":
      header = ["Producto", "Categoría", "Unidades", "Importe", "% sobre ventas"];
      rows = report.byProduct.map((p) => [T(p.product), T(p.category), I(p.units), N(p.amount), N(p.share)]);
      break;
    case "categorias":
      header = ["Categoría", "Unidades", "Importe", "% sobre ventas"];
      rows = report.byCategory.map((c) => [T(c.category), I(c.units), N(c.amount), N(c.share)]);
      break;
    case "pagos":
      header = ["Forma de pago", "Cobros", "Importe", "% sobre cobrado"];
      rows = report.byPaymentMethod.map((m) => [T(m.label), I(m.payments), N(m.amount), N(m.share)]);
      break;
    case "iva":
      header = ["Tipo", "Base imponible", "Cuota", "Total"];
      rows = report.byTaxRate.map((t) => [T(t.label), N(t.taxBase), N(t.taxAmount), N(t.amount)]);
      break;
    case "cajeros":
      header = ["Cajero", "Tickets", "Ventas netas", "Ticket medio"];
      rows = report.byCashier.map((c) => [T(c.cashier), I(c.tickets), N(c.netSales), N(c.averageTicket)]);
      break;
    case "anulaciones":
      header = ["Ticket", "Fecha", "Estado", "Importe", "Cajero", "Caja", "Cliente"];
      rows = report.voids.map((v) => [T(v.ticketNumber), T(v.date), T(v.statusLabel), N(v.amount), T(v.cashier), T(v.register), T(v.customer)]);
      break;
    case "cierres":
      header = ["Caja", "Cajero", "Apertura", "Cierre", "Fondo inicial", "Efectivo esperado", "Efectivo contado", "Descuadre", "Efectivo", "Tarjeta", "Bizum", "Otros", "Entradas manuales", "Salidas manuales"];
      rows = report.closures.sessions.map((s) => [
        T(s.register), T(s.cashier), T(madridDateTime(s.openedAt)), T(madridDateTime(s.closedAt)), N(s.openingAmount), N(s.expectedCash), N(s.countedCash), N(s.difference),
        N(s.totalCash), N(s.totalCard), N(s.totalBizum), N(s.totalOther), N(s.manualIn), N(s.manualOut),
      ]);
      break;
  }
  const lines = [header.map(textCell).join(";"), ...rows.map((r) => r.map(renderCell).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function reportCsvFilename(report: TpvReport, section: ReportSection): string {
  return `tpv-${section}-${report.period.dateFrom}_${report.period.dateTo}.csv`;
}
