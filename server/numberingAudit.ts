/**
 * Auditoría de numeración de SOLO LECTURA (agregados numéricos por serie y año) de la base de datos de UNA empresa.
 *
 * Sirve para comprobar, antes de publicar la serie propia de devoluciones (#955, DEV-AAAA-NNNN), cómo conviven los DEV- históricos
 * (que salían del contador de facturas) con el contador. No escribe nada: todo ocurre en una transacción `READ ONLY` sobre la
 * conexión de la empresa en curso (`legacyPool`, que falla cerrado fuera de un contexto de empresa). No devuelve datos
 * personales ni importes: solo nombres de serie, años y números enteros.
 */
import type mysql from "mysql2/promise";
import { legacyPool } from "./_core/legacyDb";

export const NUMBERING_AUDIT_VERSION = 1;

export type CounterAudit = { documentType: string; year: number; prefix: string; currentNumber: number; rows: number };
export type DevAudit = { year: number; count: number; min: number; max: number; distinct: number; gaps: number };
export type InvoiceSeriesAudit = { prefix: string; year: number; count: number; min: number; max: number; gaps: number };

export type NumberingAudit = {
  version: number;
  counters: CounterAudit[];
  /** Transacciones DEV-AAAA-N (formato válido) por año. */
  devTransactions: DevAudit[];
  /** Transacciones cuyo número empieza por DEV- pero no cumple DEV-AAAA-N (no las cuenta #955). */
  devNonConforming: number;
  /** Facturas con número conforme PREFIJO-AAAA-N por prefijo y año. */
  invoiceSeries: InvoiceSeriesAudit[];
  invoiceNonConforming: number;
  /** Números de la serie de facturas consumidos por devoluciones (registro de numeración, por contexto), por año. */
  facturaNumbersConsumedByRefunds: { year: number; count: number }[];
  /** Conclusiones por año con DEV históricos o contador `devolucion`. */
  assessment: {
    year: number;
    devCounter: number | null;
    devMaxEmitted: number;
    /** El contador DEV es menor que el mayor DEV emitido: #955 lo adelantará (GREATEST) antes de numerar; no es un error. */
    needsAdvance: boolean;
    /** Hay más de una fila de contador `devolucion` para el año (#955 usa la de menor id). */
    duplicateCounterRows: boolean;
    /** Números DEV usados repetidos (imposible con índice único; se informa por si faltara). */
    duplicateDev: boolean;
  }[];
};

const n = (v: unknown) => Number(v ?? 0);

/** Ejecuta la auditoría. Ninguna sentencia modifica datos; la transacción es READ ONLY (MySQL rechazaría cualquier escritura). */
export async function runNumberingAudit(): Promise<NumberingAudit> {
  const conn = await legacyPool().getConnection();
  try {
    await conn.query("START TRANSACTION READ ONLY");
    const q = async (sql: string) => (await conn.query<mysql.RowDataPacket[]>(sql))[0];

    const counters = (
      await q(
        "SELECT document_type AS t, `year` AS y, MIN(prefix) AS p, MAX(current_number) AS c, COUNT(*) AS r FROM document_counters GROUP BY document_type, `year` ORDER BY document_type, `year`"
      )
    ).map((r) => ({ documentType: String(r.t), year: n(r.y), prefix: String(r.p), currentNumber: n(r.c), rows: n(r.r) }));

    const devTransactions = (
      await q(
        `SELECT CAST(SUBSTRING(transactionNumber, 5, 4) AS UNSIGNED) AS y, COUNT(*) AS cnt,
                MIN(CAST(SUBSTRING(transactionNumber, 10) AS UNSIGNED)) AS mn, MAX(CAST(SUBSTRING(transactionNumber, 10) AS UNSIGNED)) AS mx,
                COUNT(DISTINCT CAST(SUBSTRING(transactionNumber, 10) AS UNSIGNED)) AS dst
           FROM transactions WHERE transactionNumber REGEXP '^DEV-[0-9]{4}-[0-9]+$' GROUP BY y ORDER BY y`
      )
    ).map((r) => ({ year: n(r.y), count: n(r.cnt), min: n(r.mn), max: n(r.mx), distinct: n(r.dst), gaps: Math.max(0, n(r.mx) - n(r.dst)) }));

    const [nc] = await q("SELECT COUNT(*) AS c FROM transactions WHERE transactionNumber LIKE 'DEV-%' AND transactionNumber NOT REGEXP '^DEV-[0-9]{4}-[0-9]+$'");
    const devNonConforming = n(nc?.c);

    const invoiceSeries = (
      await q(
        `SELECT SUBSTRING_INDEX(invoiceNumber, '-', 1) AS p, CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(invoiceNumber, '-', 2), '-', -1) AS UNSIGNED) AS y,
                COUNT(*) AS cnt, MIN(CAST(SUBSTRING_INDEX(invoiceNumber, '-', -1) AS UNSIGNED)) AS mn, MAX(CAST(SUBSTRING_INDEX(invoiceNumber, '-', -1) AS UNSIGNED)) AS mx
           FROM invoices WHERE invoiceNumber REGEXP '^[A-Z0-9]+-[0-9]{4}-[0-9]+$' GROUP BY p, y ORDER BY p, y`
      )
    ).map((r) => ({ prefix: String(r.p), year: n(r.y), count: n(r.cnt), min: n(r.mn), max: n(r.mx), gaps: Math.max(0, n(r.mx) - n(r.cnt)) }));
    const [ic] = await q("SELECT COUNT(*) AS c FROM invoices WHERE invoiceNumber IS NOT NULL AND invoiceNumber NOT REGEXP '^[A-Z0-9]+-[0-9]{4}-[0-9]+$'");

    const facturaNumbersConsumedByRefunds = (
      await q(
        "SELECT `year` AS y, COUNT(*) AS c FROM document_number_logs WHERE document_type = 'factura' AND (context LIKE 'cancellations:refundTransaction:%' OR context LIKE 'cancellations:partialLineRefund:%') GROUP BY `year` ORDER BY `year`"
      )
    ).map((r) => ({ year: n(r.y), count: n(r.c) }));

    await conn.query("COMMIT");

    const years = [...new Set([...devTransactions.map((d) => d.year), ...counters.filter((c) => c.documentType === "devolucion").map((c) => c.year)])].sort((a, b) => a - b);
    const assessment = years.map((year) => {
      const dev = devTransactions.find((d) => d.year === year);
      const cs = counters.find((c) => c.documentType === "devolucion" && c.year === year);
      const max = dev?.max ?? 0;
      return {
        year,
        devCounter: cs ? cs.currentNumber : null,
        devMaxEmitted: max,
        needsAdvance: max > (cs?.currentNumber ?? 0),
        duplicateCounterRows: (cs?.rows ?? 0) > 1,
        duplicateDev: !!dev && dev.distinct !== dev.count,
      };
    });

    return { version: NUMBERING_AUDIT_VERSION, counters, devTransactions, devNonConforming, invoiceSeries, invoiceNonConforming: n(ic?.c), facturaNumbersConsumedByRefunds, assessment };
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}
