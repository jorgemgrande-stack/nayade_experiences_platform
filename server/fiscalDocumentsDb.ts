/**
 * Lectura de los documentos fiscales emitidos (facturas, abonos y tickets de caja) de la empresa en curso,
 * siempre de su propia base de datos (`getDb()` resuelve la del contexto de la petición). Solo lee: ningún
 * documento emitido se modifica. La regla de cálculo y la de no duplicar están en server/fiscalDocuments.ts.
 */
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { invoices, tpvSaleItems, tpvSalePayments, tpvSales } from "../drizzle/schema";
import { getDb } from "./db";
import {
  invoiceDocument,
  sortFiscalDocuments,
  substitutingInvoice,
  summarizeFiscalDocuments,
  ticketDocument,
  type FiscalDocument,
  type FiscalInvoiceRow,
  type FiscalSummary,
  type FiscalTicketRow,
  type SubstituteInvoice,
} from "./fiscalDocuments";
import { madridMidnightMs, nextDateKey } from "./utils/timezone";

/** Rango de fechas en milisegundos, con el fin exclusivo. */
export interface FiscalRange {
  fromMs: number;
  toMsExclusive: number;
}

/** De AAAA-MM-DD a AAAA-MM-DD (ambos incluidos), en hora de Madrid. */
export function madridDayRange(from: string, to: string): FiscalRange {
  return { fromMs: madridMidnightMs(from), toMsExclusive: madridMidnightMs(nextDateKey(to)) };
}

const CHUNK = 1000;
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

const parseJson = <T>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

/** Facturas y abonos expedidos en el rango (también los anulados: se listan, no cuentan). */
async function invoiceRows(range: FiscalRange): Promise<FiscalInvoiceRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceType: invoices.invoiceType,
      status: invoices.status,
      clientName: invoices.clientName,
      clientNif: invoices.clientNif,
      itemsJson: invoices.itemsJson,
      subtotal: invoices.subtotal,
      taxRate: invoices.taxRate,
      taxAmount: invoices.taxAmount,
      taxBreakdown: invoices.taxBreakdown,
      total: invoices.total,
      creditNoteForId: invoices.creditNoteForId,
      issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(and(gte(invoices.issuedAt, new Date(range.fromMs)), lt(invoices.issuedAt, new Date(range.toMsExclusive))));
  return rows.map((r) => ({ ...r, itemsJson: parseJson(r.itemsJson), taxBreakdown: parseJson(r.taxBreakdown) }) as FiscalInvoiceRow);
}

/** Número de las facturas que rectifican los abonos (pueden ser de otro periodo). */
async function originalNumbersOf(rows: FiscalInvoiceRow[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.creditNoteForId).filter((v): v is number => typeof v === "number")));
  if (!ids.length) return new Map();
  const db = await getDb();
  if (!db) return new Map();
  const found = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(inArray(invoices.id, ids));
  return new Map(found.map((f) => [f.id, f.invoiceNumber]));
}

/**
 * Tickets de caja del rango (por fecha de cobro o, si no consta, de creación): los cobrados y los anulados o
 * devueltos que llegaron a cobrarse (el mismo criterio que los informes de caja), con la factura completa que
 * los sustituye si la hay (en cualquier fecha).
 */
export async function listTicketDocuments(range: FiscalRange): Promise<FiscalDocument[]> {
  const db = await getDb();
  if (!db) return [];
  const at = sql<number>`COALESCE(${tpvSales.paidAt}, ${tpvSales.createdAt})`;
  const sales = await db
    .select({
      id: tpvSales.id,
      ticketNumber: tpvSales.ticketNumber,
      status: tpvSales.status,
      total: tpvSales.total,
      at,
      customerName: tpvSales.customerName,
      invoiceId: tpvSales.invoiceId,
      reservationId: tpvSales.reservationId,
      taxBase: tpvSales.taxBase,
      taxAmount: tpvSales.taxAmount,
      taxRate: tpvSales.taxRate,
    })
    .from(tpvSales)
    .where(and(
      sql`${at} >= ${range.fromMs}`,
      sql`${at} < ${range.toMsExclusive}`,
      or(
        eq(tpvSales.status, "paid"),
        and(
          inArray(tpvSales.status, ["cancelled", "refunded"]),
          sql`EXISTS (SELECT 1 FROM ${tpvSalePayments} WHERE ${tpvSalePayments.saleId} = ${tpvSales.id} AND ${tpvSalePayments.status} = 'completed')`,
        ),
      ),
    ));
  if (!sales.length) return [];

  const lines = new Map<number, FiscalTicketRow["lines"]>();
  const substitutes: SubstituteInvoice[] = [];
  for (const part of chunks(sales)) {
    const ids = part.map((s) => s.id);
    const invoiceIds = part.map((s) => s.invoiceId).filter((v): v is number => v != null);
    const reservationIds = part.map((s) => s.reservationId).filter((v): v is number => v != null);
    const [items, invs] = await Promise.all([
      db
        .select({ saleId: tpvSaleItems.saleId, subtotal: tpvSaleItems.subtotal, fiscalRegime: tpvSaleItems.fiscalRegime, taxRate: tpvSaleItems.taxRate })
        .from(tpvSaleItems)
        .where(inArray(tpvSaleItems.saleId, ids)),
      invoiceIds.length || reservationIds.length
        ? db
            .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, invoiceType: invoices.invoiceType, status: invoices.status, reservationId: invoices.reservationId })
            .from(invoices)
            .where(or(
              invoiceIds.length ? inArray(invoices.id, invoiceIds) : undefined,
              reservationIds.length ? inArray(invoices.reservationId, reservationIds) : undefined,
            ))
        : Promise.resolve([] as SubstituteInvoice[]),
    ]);
    for (const it of items) {
      const arr = lines.get(it.saleId) ?? [];
      arr.push({ subtotal: it.subtotal, fiscalRegime: it.fiscalRegime, taxRate: it.taxRate });
      lines.set(it.saleId, arr);
    }
    substitutes.push(...(invs as SubstituteInvoice[]));
  }

  return sales.map((s) => {
    const row: FiscalTicketRow = { ...s, at: Number(s.at), lines: lines.get(s.id) ?? [] };
    return ticketDocument(row, substitutingInvoice(row, substitutes));
  });
}

/** Todos los documentos fiscales emitidos en el rango, en el orden del libro. */
export async function listFiscalDocuments(range: FiscalRange): Promise<FiscalDocument[]> {
  const rows = await invoiceRows(range);
  const [originals, tickets] = await Promise.all([originalNumbersOf(rows), listTicketDocuments(range)]);
  return sortFiscalDocuments([...rows.map((r) => invoiceDocument(r, originals)), ...tickets]);
}

/** IVA repercutido y base del rango: lo que muestran Informes, el Resumen y el Modelo 303. */
export async function fiscalSummary(range: FiscalRange): Promise<FiscalSummary> {
  return summarizeFiscalDocuments(await listFiscalDocuments(range));
}
