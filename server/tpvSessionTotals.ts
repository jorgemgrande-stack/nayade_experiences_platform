/**
 * Totales de cobro de una sesión de caja del TPV (adaptado de Skicenter, server/tpvSessionTotals.ts, commit 3cdc678f).
 *
 * El cierre de caja y el resumen previo contaban SOLO las ventas `paid`. Una venta anulada o devuelta en la misma
 * sesión pasa a `cancelled`/`refunded`, pero su efectivo ya entró en el cajón y lo devuelto sale como movimiento manual
 * de salida (`cash_movements`, type "out"). Con el filtro anterior el efectivo de esa venta desaparecía del esperado y
 * además se restaba la salida: una devolución de 30 € sobre una venta de 100 € daba un sobrante falso de 100 €.
 *
 * Regla: el dinero cobrado es el de TODAS las ventas no pendientes de la sesión con cobros completados; lo devuelto en
 * efectivo se resta con su movimiento de salida. Las ventas `pending` (a medias) y las anuladas por un fallo al
 * grabarlas (sin cobros: la transacción se deshizo) nunca cuentan.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { tpvSales, tpvSalePayments } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";

export interface SessionPaymentTotals {
  totalCash: number;
  totalCard: number;
  totalBizum: number;
  totalMixed: number;
}

/** Estados de venta cuyo cobro físico o electrónico sí ocurrió. */
export const RECEIVED_SALE_STATUSES = ["paid", "cancelled", "refunded"] as const;

/** Suma por método (pura: la usan las consultas y las pruebas). */
export function sumPaymentsByMethod(rows: Array<{ method: string; amount: string | number | null }>): SessionPaymentTotals {
  const totals: SessionPaymentTotals = { totalCash: 0, totalCard: 0, totalBizum: 0, totalMixed: 0 };
  for (const p of rows) {
    const amt = parseFloat(String(p.amount ?? 0)) || 0;
    if (p.method === "cash") totals.totalCash += amt;
    else if (p.method === "card") totals.totalCard += amt;
    else if (p.method === "bizum") totals.totalBizum += amt;
    else totals.totalMixed += amt;
  }
  return totals;
}

/**
 * Condición «venta cobrada»: estado recibido y algún cobro completado. Excluye las ventas anuladas porque no se
 * pudieron grabar (la transacción se deshizo y no tienen cobros).
 */
export function receivedSaleCondition() {
  return and(
    inArray(tpvSales.status, [...RECEIVED_SALE_STATUSES]),
    sql`EXISTS (SELECT 1 FROM tpv_sale_payments p WHERE p.saleId = ${tpvSales.id} AND p.status_tsp = 'completed')`,
  );
}

export async function computeSessionPaymentTotals(sessionId: number): Promise<SessionPaymentTotals> {
  const db = legacyDb();
  const rows = await db
    .select({ method: tpvSalePayments.method, amount: tpvSalePayments.amount })
    .from(tpvSalePayments)
    .innerJoin(tpvSales, eq(tpvSales.id, tpvSalePayments.saleId))
    .where(and(
      eq(tpvSales.sessionId, sessionId),
      inArray(tpvSales.status, [...RECEIVED_SALE_STATUSES]),
      eq(tpvSalePayments.status, "completed"),
    ));
  return sumPaymentsByMethod(rows);
}
