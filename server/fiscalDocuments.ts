/**
 * Documentos fiscales emitidos por la empresa y su IVA repercutido: la única regla de cálculo que usan
 * Contabilidad › Informes, Contabilidad › Resumen («Facturado»), el Modelo 303 (server/gestoriaTax.ts) y el
 * libro de facturas emitidas de la exportación para la gestoría (server/gestoriaInvoiceExport.ts). Pura, sin
 * base de datos: la lectura está en server/fiscalDocumentsDb.ts.
 *
 * Qué es un documento fiscal emitido:
 *  - Factura: cuenta con su desglose por tipo de IVA guardado (`taxBreakdown`, ver #550 y #555); en documentos
 *    antiguos sin él, el de sus líneas (reportTaxBreakdown). Las anuladas se listan pero no cuentan.
 *  - Abono (factura rectificativa): igual, siempre en negativo (se guarde en negativo o en positivo).
 *  - Ticket de caja (factura simplificada): las ventas de caja cobradas, con el IVA del ticket calculado como
 *    en la caja (tpvSaleTax: el descuento del ticket se reparte entre los tipos antes de desglosar). Los
 *    tickets anulados o devueltos se listan sin importe.
 *
 * REGLA DE NO DUPLICAR (ticket y factura completa de la misma venta):
 *   Si una venta de caja tiene, además de su ticket, una factura completa vigente (no anulada) — la que se
 *   emite sola al cobrar con tarjeta o la que se pide después canjeando el ticket —, la operación cuenta UNA
 *   sola vez: cuenta la factura y el ticket se lista como «Sustituido por <factura>», sin importe. La factura
 *   de la venta es la que la venta tiene enlazada (`tpv_sales.invoiceId`) o, si no consta, una factura (no
 *   abono) del pedido que la caja generó para esa venta (`invoices.reservationId = tpv_sales.reservationId`).
 *   No se cambia ningún documento emitido: solo cómo se suman.
 */
import { reportTaxBreakdown } from "./invoiceCalc";
import { tpvSaleTax } from "./tpvSaleTax";

export type FiscalDocKind = "factura" | "abono" | "ticket";

export const FISCAL_KIND_LABEL: Record<FiscalDocKind, string> = {
  factura: "Factura",
  abono: "Abono",
  ticket: "Factura simplificada / ticket",
};

export interface RateAmount {
  rate: number;
  base: number;
  amount: number;
}

export interface FiscalDocument {
  kind: FiscalDocKind;
  /** Id de la factura o de la venta de caja. */
  id: number;
  number: string;
  issuedAt: Date;
  clientName: string;
  clientNif: string;
  /** Número de la factura que rectifica un abono. */
  rectifies: string;
  status: string;
  /** Si suma en los totales fiscales (no: factura anulada, ticket sustituido, anulado o devuelto). */
  counts: boolean;
  /** Factura completa que sustituye a un ticket. */
  substitutedBy: string | null;
  /** Importes con signo (abonos en negativo). */
  byRate: RateAmount[];
  base: number;
  tax: number;
  notSubject: number;
  total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  generada: "Emitida",
  enviada: "Enviada",
  cobrada: "Cobrada",
  anulada: "Anulada",
  abonada: "Abonada",
};

const TICKET_STATUS_LABEL: Record<string, string> = { paid: "Cobrado", cancelled: "Anulado", refunded: "Devuelto" };

/** Lo que se lee de cada factura o abono guardado. */
export interface FiscalInvoiceRow {
  id: number;
  invoiceNumber: string;
  invoiceType: "factura" | "abono";
  status: string;
  clientName: string;
  clientNif: string | null;
  itemsJson: { total: number; fiscalRegime?: string; taxRate?: number }[] | null;
  subtotal?: string | number | null;
  taxRate: string | null;
  taxAmount: string | null;
  taxBreakdown: { rate: number; base: number; amount: number }[] | null;
  total: string;
  creditNoteForId: number | null;
  issuedAt: Date;
}

/**
 * Desglose por tipo de IVA de una factura o abono, en positivo: el guardado; en documentos antiguos sin él,
 * el de sus líneas (el mismo criterio para el 303, los informes y el libro).
 */
export function invoiceBreakdown(inv: FiscalInvoiceRow): RateAmount[] {
  const subtotal = inv.subtotal ?? r2(Math.abs(num(inv.total)) - Math.abs(num(inv.taxAmount)));
  return reportTaxBreakdown({ ...inv, subtotal, itemsJson: inv.itemsJson as any }).map((b) => ({ rate: num(b.rate), base: num(b.base), amount: num(b.amount) }));
}

function totalsOf(byRate: RateAmount[], total: number) {
  const base = r2(byRate.reduce((s, b) => s + b.base, 0));
  const tax = r2(byRate.reduce((s, b) => s + b.amount, 0));
  const notSubject = r2(total - base - tax);
  return { base, tax, notSubject: Math.abs(notSubject) < 0.005 ? 0 : notSubject };
}

function addRate(map: Map<number, RateAmount>, rate: number, base: number, amount: number) {
  const prev = map.get(rate) ?? { rate, base: 0, amount: 0 };
  map.set(rate, { rate, base: r2(prev.base + base), amount: r2(prev.amount + amount) });
}

/** Factura o abono como documento fiscal (abonos siempre en negativo). */
export function invoiceDocument(inv: FiscalInvoiceRow, originalNumbers: Map<number, string> = new Map()): FiscalDocument {
  const isCredit = inv.invoiceType === "abono";
  const fix = (n: number) => r2(isCredit ? -Math.abs(n) : n);
  const map = new Map<number, RateAmount>();
  for (const b of invoiceBreakdown(inv)) addRate(map, b.rate, fix(b.base), fix(b.amount));
  const byRate = Array.from(map.values());
  const total = fix(num(inv.total));
  return {
    kind: isCredit ? "abono" : "factura",
    id: inv.id,
    number: inv.invoiceNumber,
    issuedAt: inv.issuedAt,
    clientName: inv.clientName ?? "",
    clientNif: inv.clientNif ?? "",
    rectifies: isCredit && inv.creditNoteForId ? originalNumbers.get(inv.creditNoteForId) ?? "" : "",
    status: INVOICE_STATUS_LABEL[inv.status] ?? inv.status,
    counts: inv.status !== "anulada",
    substitutedBy: null,
    byRate,
    total,
    ...totalsOf(byRate, total),
  };
}

/** Lo que se lee de cada venta de caja con ticket. */
export interface FiscalTicketRow {
  id: number;
  ticketNumber: string;
  status: string;
  total: string | number | null;
  /** Fecha del ticket: la de cobro o, si no consta, la de creación (ms). */
  at: number;
  customerName: string | null;
  invoiceId: number | null;
  reservationId: number | null;
  /** Fiscalidad guardada de la venta (solo para tickets sin líneas). */
  taxBase?: string | number | null;
  taxAmount?: string | number | null;
  taxRate?: string | number | null;
  lines: { subtotal: string | number | null; fiscalRegime: string | null; taxRate: string | number | null }[];
}

/** Las facturas que pueden sustituir a un ticket. */
export interface SubstituteInvoice {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  reservationId: number | null;
}

/** REGLA DE NO DUPLICAR: la factura completa vigente de la venta, si la hay (ver la cabecera del fichero). */
export function substitutingInvoice(ticket: Pick<FiscalTicketRow, "invoiceId" | "reservationId">, invoices: SubstituteInvoice[]): SubstituteInvoice | null {
  const valid = (i: SubstituteInvoice) => i.invoiceType !== "abono" && i.status !== "anulada";
  if (ticket.invoiceId != null) {
    const linked = invoices.find((i) => i.id === ticket.invoiceId);
    if (linked && valid(linked)) return linked;
  }
  if (ticket.reservationId != null) {
    const byOrder = invoices.find((i) => i.reservationId === ticket.reservationId && valid(i));
    if (byOrder) return byOrder;
  }
  return null;
}

/** Desglose por tipo de IVA de un ticket, con el descuento del ticket ya repartido (como en la caja). */
export function ticketBreakdown(t: FiscalTicketRow): RateAmount[] {
  const total = num(t.total);
  if (t.lines.length) {
    return tpvSaleTax(t.lines.map((l) => ({ lineSubtotal: num(l.subtotal), fiscalRegime: l.fiscalRegime, taxRate: l.taxRate })), total).taxBreakdown
      .map((b) => ({ rate: num(b.rate), base: num(b.base), amount: num(b.amount) }));
  }
  const base = num(t.taxBase);
  const amount = num(t.taxAmount);
  if (base === 0 && amount === 0) return [];
  return [{ rate: num(t.taxRate ?? 21), base, amount }];
}

/** Ticket de caja como documento fiscal; sustituido, anulado o devuelto: listado sin importe. */
export function ticketDocument(t: FiscalTicketRow, substitute: Pick<SubstituteInvoice, "invoiceNumber"> | null): FiscalDocument {
  const paid = t.status === "paid";
  const counts = paid && !substitute;
  const byRate = counts ? ticketBreakdown(t) : [];
  const total = counts ? r2(num(t.total)) : 0;
  return {
    kind: "ticket",
    id: t.id,
    number: t.ticketNumber,
    issuedAt: new Date(t.at),
    clientName: t.customerName ?? "",
    clientNif: "",
    rectifies: "",
    status: paid && substitute ? `Sustituido por ${substitute.invoiceNumber}` : TICKET_STATUS_LABEL[t.status] ?? t.status,
    counts,
    substitutedBy: paid && substitute ? substitute.invoiceNumber : null,
    byRate,
    total,
    ...totalsOf(byRate, total),
  };
}

/** Orden del libro: por fecha de expedición y, a igual fecha, por número. */
export function sortFiscalDocuments<T extends { issuedAt: Date; number: string }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.number.localeCompare(b.number, "es", { numeric: true }));
}

export interface FiscalSummary {
  /** Por tipo de IVA, del mayor al menor. */
  byRate: Array<RateAmount & { total: number }>;
  base: number;
  tax: number;
  notSubject: number;
  total: number;
  invoices: number;
  creditNotes: number;
  tickets: number;
  /** Tickets que no cuentan porque la venta tiene su factura completa. */
  substitutedTickets: number;
}

/** IVA repercutido y base de los documentos que cuentan (los demás no suman nada). */
export function summarizeFiscalDocuments(docs: FiscalDocument[]): FiscalSummary {
  const map = new Map<number, RateAmount>();
  let total = 0, notSubject = 0, invoices = 0, creditNotes = 0, tickets = 0, substitutedTickets = 0;
  for (const d of docs) {
    if (d.substitutedBy) substitutedTickets += 1;
    if (!d.counts) continue;
    if (d.kind === "factura") invoices += 1;
    else if (d.kind === "abono") creditNotes += 1;
    else tickets += 1;
    for (const b of d.byRate) addRate(map, b.rate, b.base, b.amount);
    total += d.total;
    notSubject += d.notSubject;
  }
  const byRate = Array.from(map.values())
    .map((b) => ({ ...b, total: r2(b.base + b.amount) }))
    .sort((a, b) => b.rate - a.rate);
  return {
    byRate,
    base: r2(byRate.reduce((s, b) => s + b.base, 0)),
    tax: r2(byRate.reduce((s, b) => s + b.amount, 0)),
    notSubject: r2(notSubject),
    total: r2(total),
    invoices,
    creditNotes,
    tickets,
    substitutedTickets,
  };
}
