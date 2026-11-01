/**
 * Lectura de los datos de los informes del TPV (BD de la empresa en curso) y cálculo con `server/tpvReports.ts`.
 * Solo consultas sobre las tablas existentes del TPV: no escribe nada.
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { cashRegisters, cashSessions, categories, experiences, tpvSaleItems, tpvSalePayments, tpvSales } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";
import {
  computeTpvReport,
  madridRangeMs,
  MAX_REPORT_DAYS,
  rangeDays,
  REPORT_RECEIVED_STATUSES,
  type ReportItemRow,
  type ReportPaymentRow,
  type ReportSaleRow,
  type ReportSessionRow,
  type TpvReport,
} from "./tpvReports";

export interface TpvReportFilter {
  dateFrom: string;
  dateTo: string;
  registerId?: number | null;
}

export class TpvReportRangeError extends Error {}

/** Valida el filtro y devuelve el rango en milisegundos (fin exclusivo). */
export function resolveReportRange(f: TpvReportFilter) {
  let range;
  try {
    range = madridRangeMs(f.dateFrom, f.dateTo);
  } catch (e) {
    throw new TpvReportRangeError(e instanceof Error ? e.message : "Fechas no válidas");
  }
  if (rangeDays(f.dateFrom, f.dateTo) > MAX_REPORT_DAYS) throw new TpvReportRangeError(`El periodo no puede superar ${MAX_REPORT_DAYS} días`);
  return range;
}

const CHUNK = 1000;
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

export async function getTpvReport(f: TpvReportFilter): Promise<TpvReport> {
  const { fromMs, toMsExclusive } = resolveReportRange(f);
  const db = legacyDb();
  const registerId = f.registerId ?? null;
  const saleAt = sql<number>`COALESCE(${tpvSales.paidAt}, ${tpvSales.createdAt})`;

  const sales: ReportSaleRow[] = await db
    .select({
      id: tpvSales.id,
      ticketNumber: tpvSales.ticketNumber,
      sessionId: tpvSales.sessionId,
      registerId: cashSessions.registerId,
      registerName: cashRegisters.name,
      status: tpvSales.status,
      total: tpvSales.total,
      discountAmount: tpvSales.discountAmount,
      paidAt: tpvSales.paidAt,
      createdAt: tpvSales.createdAt,
      sellerUserId: tpvSales.sellerUserId,
      sellerName: tpvSales.sellerName,
      cashierName: cashSessions.cashierName,
      customerName: tpvSales.customerName,
    })
    .from(tpvSales)
    .innerJoin(cashSessions, eq(cashSessions.id, tpvSales.sessionId))
    .leftJoin(cashRegisters, eq(cashRegisters.id, cashSessions.registerId))
    .where(and(
      inArray(tpvSales.status, [...REPORT_RECEIVED_STATUSES]),
      sql`${saleAt} >= ${fromMs}`,
      sql`${saleAt} < ${toMsExclusive}`,
      registerId != null ? eq(cashSessions.registerId, registerId) : undefined,
    ));

  const ids = sales.map((s) => s.id);
  const items: ReportItemRow[] = [];
  const payments: ReportPaymentRow[] = [];
  for (const part of chunks(ids)) {
    const [it, pay] = await Promise.all([
      db
        .select({
          saleId: tpvSaleItems.saleId,
          productType: tpvSaleItems.productType,
          productId: tpvSaleItems.productId,
          productName: tpvSaleItems.productName,
          isManual: tpvSaleItems.isManual,
          conceptText: tpvSaleItems.conceptText,
          categoryName: categories.name,
          quantity: tpvSaleItems.quantity,
          subtotal: tpvSaleItems.subtotal,
          taxRate: tpvSaleItems.taxRate,
          taxBase: tpvSaleItems.taxBase,
          taxAmount: tpvSaleItems.taxAmount,
          fiscalRegime: tpvSaleItems.fiscalRegime,
        })
        .from(tpvSaleItems)
        .leftJoin(experiences, and(eq(tpvSaleItems.productType, "experience"), eq(experiences.id, tpvSaleItems.productId)))
        .leftJoin(categories, eq(categories.id, experiences.categoryId))
        .where(inArray(tpvSaleItems.saleId, part)),
      db
        .select({ saleId: tpvSalePayments.saleId, method: tpvSalePayments.method, amount: tpvSalePayments.amount, status: tpvSalePayments.status })
        .from(tpvSalePayments)
        .where(inArray(tpvSalePayments.saleId, part)),
    ]);
    items.push(...it);
    payments.push(...pay);
  }

  const sessions: ReportSessionRow[] = await db
    .select({
      id: cashSessions.id,
      registerId: cashSessions.registerId,
      registerName: cashRegisters.name,
      cashierName: cashSessions.cashierName,
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      openingAmount: cashSessions.openingAmount,
      closingAmount: cashSessions.closingAmount,
      countedCash: cashSessions.countedCash,
      cashDifference: cashSessions.cashDifference,
      totalCash: cashSessions.totalCash,
      totalCard: cashSessions.totalCard,
      totalBizum: cashSessions.totalBizum,
      totalMixed: cashSessions.totalMixed,
      totalManualIn: cashSessions.totalManualIn,
      totalManualOut: cashSessions.totalManualOut,
    })
    .from(cashSessions)
    .leftJoin(cashRegisters, eq(cashRegisters.id, cashSessions.registerId))
    .where(and(
      eq(cashSessions.status, "closed"),
      isNotNull(cashSessions.closedAt),
      gte(cashSessions.closedAt, fromMs),
      lt(cashSessions.closedAt, toMsExclusive),
      registerId != null ? eq(cashSessions.registerId, registerId) : undefined,
    ));

  return computeTpvReport({ dateFrom: f.dateFrom, dateTo: f.dateTo, registerId, sales, items, payments, sessions });
}

/** Cajas de la empresa para el filtro del informe (también las desactivadas: tienen historial). */
export async function listReportRegisters() {
  return legacyDb().select({ id: cashRegisters.id, name: cashRegisters.name, isActive: cashRegisters.isActive }).from(cashRegisters).orderBy(cashRegisters.name);
}
