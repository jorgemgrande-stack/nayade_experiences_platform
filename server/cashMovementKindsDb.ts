/**
 * Tipo de cada movimiento manual de la caja del TPV (`cash_movements`), para que la contabilidad general
 * (server/accountingGeneral) lo contabilice una sola vez y contra su contrapartida real. Se guarda aparte, en
 * `acc_cash_movement_kinds` (db/migrations/0060_extra_contabilidad), sin tocar `cash_movements` ni el comportamiento del
 * TPV: el gasto, el traspaso y la caja corporativa siguen igual para todas las empresas.
 *
 * Solo se guarda el tipo que el cajero elige de forma EXPLÍCITA:
 *  - salida «gasto» (compra o proveedor), «devolucion» (a un cliente) o «traspaso» (a la Caja Central);
 *  - entrada «fondo» (desde la Caja Central) o «cobro» (cobro pendiente de un cliente).
 * Sin tipo (llamadas por API sin `outKind`/`inKind`), la fila queda con `kind` NULL y la contabilidad lo decide por sus
 * propias reglas, sin cambiar nada del Core.
 */
import { sql, type SQL } from "drizzle-orm";
import { legacyDb } from "./_core/legacyDb";

export const CASH_OUT_KINDS = ["gasto", "devolucion", "traspaso"] as const;
export const CASH_IN_KINDS = ["fondo", "cobro"] as const;
export type CashOutKind = (typeof CASH_OUT_KINDS)[number];
export type CashInKind = (typeof CASH_IN_KINDS)[number];
/** Fianzas del alquiler (server/skiRental/depositStore.ts): cobro y devolución, contra fianzas recibidas. */
export const CASH_DEPOSIT_KIND = "fianza" as const;
export type CashMoveKind = CashOutKind | CashInKind | typeof CASH_DEPOSIT_KIND;

/** Tipo explícito de un movimiento (el que eligió el cajero) o null si no se indicó. */
export function explicitCashMoveKind(m: { type: "in" | "out"; outKind?: CashOutKind | null; inKind?: CashInKind | null }): CashMoveKind | null {
  return (m.type === "in" ? m.inKind : m.outKind) ?? null;
}

type Exec = { execute: (q: SQL) => Promise<unknown> };

/** ¿Falta la tabla de la 0060 en esta empresa? (la contabilidad general aún no está instalada) */
function isMissingTable(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) return true;
  return false;
}
let warnedMissing = false;

/**
 * Guarda el tipo del movimiento DENTRO de la transacción que lo crea (`tx`): si no se puede guardar, el movimiento
 * tampoco se crea, salvo que falte la tabla (empresa sin la 0060). Entonces no hace nada y solo avisa una vez.
 */
export async function recordCashMovementKind(tx: Exec, movementId: number, kind: CashMoveKind | null): Promise<void> {
  try {
    await tx.execute(sql`INSERT INTO acc_cash_movement_kinds (movement_id, kind) VALUES (${movementId}, ${kind})`);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[TPV] Sin la migración 0060 no se guarda el tipo de los movimientos de caja (solo lo usa la contabilidad general)");
    }
  }
}

/** Enlaza el gasto que el TPV crea para una salida «gasto» con su movimiento. Sin la tabla, no hace nada. */
export async function linkCashMovementExpense(movementId: number, expenseId: number): Promise<void> {
  try {
    await legacyDb().execute(sql`UPDATE acc_cash_movement_kinds SET expense_id = ${expenseId} WHERE movement_id = ${movementId}`);
  } catch (e) {
    if (!isMissingTable(e)) console.error("[TPV] No se pudo enlazar el gasto con su movimiento de caja:", e instanceof Error ? e.message : e);
  }
}
