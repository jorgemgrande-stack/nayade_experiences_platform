/**
 * Tipo de cada movimiento manual de la caja del TPV (`cash_movements`), para contabilizarlo una sola vez y contra su
 * contrapartida real (server/accountingGeneral). Se guarda aparte, en `acc_cash_movement_kinds`
 * (db/migrations/0060_extra_contabilidad), sin tocar `cash_movements`: si la tabla aún no existe, el TPV sigue igual.
 *
 *  - salida «gasto»: compra o proveedor (el TPV crea además el gasto, `expenses.source = tpv`);
 *  - salida «devolucion»: devolución de efectivo a un cliente (sin gasto);
 *  - salida «traspaso»: a la Caja Central (sin gasto);
 *  - entrada «fondo»: fondo o reposición desde la Caja Central;
 *  - entrada «cobro»: cobro pendiente de un cliente.
 */
import { sql } from "drizzle-orm";
import { legacyDb } from "./_core/legacyDb";

export const CASH_OUT_KINDS = ["gasto", "devolucion", "traspaso"] as const;
export const CASH_IN_KINDS = ["fondo", "cobro"] as const;
export type CashOutKind = (typeof CASH_OUT_KINDS)[number];
export type CashInKind = (typeof CASH_IN_KINDS)[number];
export type CashMoveKind = CashOutKind | CashInKind;

/** ¿El motivo es el de una devolución de efectivo («Devolución efectivo», «reembolso»…)? */
export const looksLikeRefund = (reason: string) => /devoluci[oó]n|reembols/i.test(reason);

/**
 * Tipo efectivo de un movimiento. Una devolución registrada como «gasto» (la opción que el TPV traía por defecto) se
 * detecta por su motivo y queda como devolución: nunca se inventa un gasto del grupo 6.
 */
export function resolveCashMoveKind(m: { type: "in" | "out"; outKind?: CashOutKind | null; inKind?: CashInKind | null; reason: string }): CashMoveKind {
  if (m.type === "in") return m.inKind ?? "fondo";
  if (m.outKind === "traspaso") return "traspaso";
  if (m.outKind === "devolucion" || looksLikeRefund(m.reason)) return "devolucion";
  return "gasto";
}

/** Guarda el tipo del movimiento (idempotente). Sin la tabla (empresa sin la 0060), no hace nada. */
export async function recordCashMovementKind(movementId: number, kind: CashMoveKind): Promise<void> {
  try {
    await legacyDb().execute(sql`INSERT IGNORE INTO acc_cash_movement_kinds (movement_id, kind) VALUES (${movementId}, ${kind})`);
  } catch (e) {
    console.error("[TPV] No se pudo guardar el tipo del movimiento de caja:", e instanceof Error ? e.message : e);
  }
}
