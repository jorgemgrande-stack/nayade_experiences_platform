import { eq, sql } from "drizzle-orm";
import { transactions } from "../drizzle/schema";
import { legacyDb } from "./_core/legacyDb";
import { generateDocumentNumber, raiseCounterToAtLeast } from "./documentNumbers";
import { madridYear } from "./utils/timezone";

/**
 * Número de una transacción de devolución (DEV-AAAA-NNNN) de su serie PROPIA. Salta los que ya existan como transacción:
 * hasta ahora los DEV- salían del contador de facturas, así que una empresa con devoluciones antiguas conserva números DEV-
 * que la serie nueva no debe repetir.
 */
export async function nextRefundTransactionNumber(context: string, adminUserId: number): Promise<string> {
  // Antes de pedir número, el contador DEV del año se adelanta (sin retroceder nunca) al mayor DEV-AAAA-NNNN que ya exista como
  // transacción: una sola consulta en vez de saltar los ocupados de uno en uno (cada salto consumía un número y tenía tope).
  // `existsCheck` queda como red de seguridad frente a altas simultáneas de una versión anterior.
  const year = madridYear();
  const [top] = await legacyDb()
    .select({ n: sql<number>`MAX(CAST(SUBSTRING(${transactions.transactionNumber}, 10) AS UNSIGNED))` })
    .from(transactions)
    .where(sql`${transactions.transactionNumber} REGEXP ${`^DEV-${year}-[0-9]+$`}`);
  await raiseCounterToAtLeast("devolucion", year, Number(top?.n ?? 0));
  return generateDocumentNumber("devolucion", context, String(adminUserId), async (candidate) => {
    const [hit] = await legacyDb().select({ id: transactions.id }).from(transactions).where(eq(transactions.transactionNumber, candidate)).limit(1);
    return !!hit;
  });
}
