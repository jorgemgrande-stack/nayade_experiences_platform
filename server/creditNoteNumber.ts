/**
 * Numeración de facturas de abono en la serie vigente «ABO-AAAA-MM-nnnn» (sin cambiar el formato de los
 * documentos fiscales ya emitidos; un cambio de serie requiere validación de la gestoría).
 *
 * El siguiente número es el MÁXIMO existente del mes + 1 (no un recuento de filas, que con huecos o con
 * duplicados antiguos repetiría números). Se lee con bloqueo (`FOR UPDATE` sobre el rango del índice único),
 * así que dos abonos simultáneos se serializan. La unicidad la garantiza el índice único de
 * `invoices.invoiceNumber`: si aun así dos calculan el mismo número (o MySQL resuelve un interbloqueo), la
 * transacción completa se reintenta (`withCreditNoteNumberRetry`).
 */
import { sql } from "drizzle-orm";
import { invoices } from "../drizzle/schema";
import { madridMonth, madridYear } from "./utils/timezone";

/** Año y mes de Madrid (no los de la zona del servidor): el abono del 1 de enero a las 00:30 es de enero. */
export function creditNotePrefix(date: Date): string {
  return `ABO-${madridYear(date)}-${String(madridMonth(date)).padStart(2, "0")}-`;
}

export function formatCreditNoteNumber(date: Date, seq: number): string {
  return `${creditNotePrefix(date)}${String(seq).padStart(4, "0")}`;
}

type Selectable = { select: (fields: any) => any };

export async function nextCreditNoteNumber(tx: Selectable, date: Date): Promise<string> {
  const prefix = creditNotePrefix(date);
  const [row] = await tx
    .select({ last: sql<number | null>`MAX(CAST(SUBSTRING(${invoices.invoiceNumber}, ${prefix.length + 1}) AS UNSIGNED))` })
    .from(invoices)
    .where(sql`${invoices.invoiceNumber} LIKE ${prefix + "%"}`)
    .for("update");
  return formatCreditNoteNumber(date, Number(row?.last ?? 0) + 1);
}

/** Clave duplicada en el número de factura (MySQL ER_DUP_ENTRY), también envuelta por el ORM. */
export function isDuplicateInvoiceNumber(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return /invoiceNumber/i.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

/** Interbloqueo resuelto por MySQL (ER_LOCK_DEADLOCK): la transacción se revirtió entera y puede repetirse. */
export function isDeadlock(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_LOCK_DEADLOCK" || e.errno === 1213) return true;
  }
  return false;
}

export async function withCreditNoteNumberRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !(isDuplicateInvoiceNumber(err) || isDeadlock(err))) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * i));
    }
  }
}
