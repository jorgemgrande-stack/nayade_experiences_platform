/**
 * Lectura de la BD de la empresa para el resumen contable (server/accountingSummary.ts).
 * Solo datos de la propia empresa: pedidos y tickets cobrados, libro de cobros, documentos fiscales emitidos
 * (server/fiscalDocumentsDb.ts, la misma regla que Informes y el Modelo 303), gastos y presupuestos.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { categories, expenses, experiences, quotes, reservations, tpvSaleItems, tpvSales, transactions } from "../drizzle/schema";
import { getDb } from "./db";
import { listFiscalDocuments } from "./fiscalDocumentsDb";
import { buildAccountingSummary, lastMonthKeys, periodStartMs, prorateTicket, type AccountingSummary, type SummaryInput } from "./accountingSummary";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : num(v));

export async function getAccountingSummary(opts: { now?: number; withQuotes?: boolean } = {}): Promise<AccountingSummary> {
  const now = opts.now ?? Date.now();
  const months = lastMonthKeys(now);
  const fromMs = periodStartMs(months);
  const from = new Date(fromMs);
  const db = await getDb();
  const empty: SummaryInput = { now, sales: [], payments: [], invoices: [], expenses: null, categories: [], pendingQuotes: opts.withQuotes ? 0 : null };
  if (!db) return buildAccountingSummary(empty);

  const paidAt = sql<number>`COALESCE(${reservations.paidAt}, ${reservations.createdAt})`;
  const [salesRows, payRows, fiscalDocs, tpvRows] = await Promise.all([
    db.select({ id: reservations.id, merchantOrder: reservations.merchantOrder, at: paidAt, amountTotal: reservations.amountTotal, amountPaid: reservations.amountPaid, productId: reservations.productId, channel: reservations.channel, category: categories.name })
      .from(reservations)
      .leftJoin(experiences, eq(experiences.id, reservations.productId))
      .leftJoin(categories, eq(categories.id, experiences.categoryId))
      .where(and(eq(reservations.status, "paid"), sql`${paidAt} >= ${fromMs}`)),
    db.select({ at: transactions.createdAt, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(and(inArray(transactions.type, ["ingreso", "reembolso"]), eq(transactions.status, "completado"), gte(transactions.createdAt, from))),
    // Facturado: facturas y tickets de caja emitidos menos abonos; un ticket con su factura completa, una vez
    listFiscalDocuments({ fromMs, toMsExclusive: now + 24 * 3600 * 1000 }),
    db.select({ id: tpvSales.id, reservationId: tpvSales.reservationId, total: tpvSales.total })
      .from(tpvSales)
      .where(and(eq(tpvSales.status, "paid"), sql`COALESCE(${tpvSales.paidAt}, ${tpvSales.createdAt}) >= ${fromMs}`)),
  ]);

  // Una operación por pedido: las líneas de un pedido de la tienda comparten su número de pedido
  const sales = salesRows.map((r) => ({ at: num(r.at), amount: (num(r.amountPaid) > 0 ? num(r.amountPaid) : num(r.amountTotal)) / 100, key: r.merchantOrder ? `p:${r.merchantOrder}` : `r:${r.id}` }));

  // Categorías: los tickets de caja por sus líneas (cada una con su producto); el resto, por el producto del pedido
  const cats: SummaryInput["categories"] = [];
  const tpvReservationIds = new Set(tpvRows.map((t) => t.reservationId).filter((id): id is number => id != null));
  for (const r of salesRows) {
    if (tpvReservationIds.has(r.id)) continue;
    cats.push({ category: r.category ?? null, amount: (num(r.amountPaid) > 0 ? num(r.amountPaid) : num(r.amountTotal)) / 100 });
  }
  if (tpvRows.length) {
    const items = await db.select({ saleId: tpvSaleItems.saleId, subtotal: tpvSaleItems.subtotal, category: categories.name })
      .from(tpvSaleItems)
      .leftJoin(experiences, and(eq(tpvSaleItems.productType, "experience"), eq(experiences.id, tpvSaleItems.productId)))
      .leftJoin(categories, eq(categories.id, experiences.categoryId))
      .where(inArray(tpvSaleItems.saleId, tpvRows.map((t) => t.id)));
    for (const t of tpvRows) {
      const lines = items.filter((i) => i.saleId === t.id);
      const net = prorateTicket(num(t.total), lines.map((l) => num(l.subtotal)));
      lines.forEach((l, i) => cats.push({ category: l.category ?? null, amount: net[i] }));
    }
  }

  // Gastos: solo si la empresa lleva gastos (sin la tabla, la sección no aparece)
  let expenseRows: SummaryInput["expenses"] = null;
  try {
    const rows = await db.select({ month: sql<string>`LEFT(${expenses.date}, 7)`, amount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .where(sql`${expenses.date} >= ${months[0]}`)
      .groupBy(sql`LEFT(${expenses.date}, 7)`);
    expenseRows = rows.map((r) => ({ month: String(r.month), amount: num(r.amount) }));
  } catch {
    expenseRows = null;
  }

  let pendingQuotes: number | null = null;
  if (opts.withQuotes) {
    const [q] = await db.select({ n: sql<number>`COUNT(*)` }).from(quotes).where(eq(quotes.status, "enviado"));
    pendingQuotes = num(q?.n);
  }

  return buildAccountingSummary({
    now,
    sales,
    payments: payRows.map((p) => ({ at: ms(p.at), amount: (p.type === "reembolso" ? -1 : 1) * Math.abs(num(p.amount)) })),
    invoices: fiscalDocs.filter((d) => d.counts).map((d) => ({ at: d.issuedAt.getTime(), amount: d.total, kind: d.kind })),
    expenses: expenseRows,
    categories: cats,
    pendingQuotes,
  });
}
