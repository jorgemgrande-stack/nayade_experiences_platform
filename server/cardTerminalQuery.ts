/**
 * Consultas de solo lectura del TPV: Operaciones, Remesas y estado de la conciliación, sobre el filtro COMPLETO.
 *
 * El listado y el resumen de cada pantalla construyen su `where` con la misma función (`buildOperationConditions`,
 * `buildBatchConditions`): las cifras del resumen son exactamente las del conjunto que el listado pagina. Los importes
 * se suman en SQL sobre columnas decimales (nunca en coma flotante) y vuelven como texto decimal exacto
 * («-1234567.89»). El aislamiento por empresa es el de la conexión recibida (`legacyDb()` del tenant en curso): ninguna
 * consulta nombra empresas.
 *
 * Nada de aquí escribe en la base de datos ni cambia estados, vínculos o el algoritmo de matching/conciliación: solo
 * cuenta y suma lo que ya existe.
 *
 * Contadores por estado: se calculan sobre el filtro SIN el estado elegido (fecha, tipo, búsqueda…), para que un filtro
 * rápido («Pendientes») muestre cuántas hay aunque ahora esté seleccionado otro estado. Las cifras de totales
 * (`count`, importes) sí respetan el estado elegido.
 */
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
import { cardTerminalBatches, cardTerminalOperations, type CardTerminalBatch, type CardTerminalOperation } from "../drizzle/schema";
import { escapeLike } from "./expensesQuery";
import { madridEndOfDayUtc, madridStartOfDayUtc } from "./utils/timezone";

export { escapeLike };

const dec = (e: SQL) => sql`CAST(COALESCE(${e}, 0) AS CHAR)`;
const cnt = (cond: SQL) => sql`CAST(COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0) AS CHAR)`;

/** Suma de textos decimales con 2 decimales en céntimos enteros (sin coma flotante). */
export function addDecimals(...values: Array<string | null | undefined>): string {
  const ZERO = BigInt(0);
  const H = BigInt(100);
  let cents = ZERO;
  for (const v of values) {
    const s = String(v ?? "0").trim();
    const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
    if (!m) continue;
    const c = BigInt(m[2]) * H + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    cents += m[1] ? -c : c;
  }
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / H}.${String(abs % H).padStart(2, "0")}`;
}

// ─── Operaciones del datáfono ────────────────────────────────────────────────────────────────────────────────────────

export type OperationStatus = "pendiente" | "conciliado" | "incidencia" | "ignorado";
export type OperationType = "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO";

export type OperationFilters = {
  status?: OperationStatus | "todos";
  operationType?: OperationType | "todos";
  importId?: number;
  /** AAAA-MM-DD (día de Madrid). */
  dateFrom?: string;
  dateTo?: string;
  /** Texto libre: nº de operación, tarjeta, terminal, comercio o autorización. */
  search?: string;
};

/** Condiciones del filtro; `withStatus: false` omite el estado (para repartir el filtro por estados). */
export function buildOperationConditions(input: OperationFilters, opts: { withStatus?: boolean } = {}): SQL | undefined {
  const c: SQL[] = [];
  if (opts.withStatus !== false && input.status && input.status !== "todos") c.push(eq(cardTerminalOperations.status, input.status));
  if (input.operationType && input.operationType !== "todos") c.push(eq(cardTerminalOperations.operationType, input.operationType));
  if (input.importId) c.push(eq(cardTerminalOperations.importId, input.importId));
  if (input.dateFrom) c.push(gte(cardTerminalOperations.operationDatetime, madridStartOfDayUtc(input.dateFrom)));
  if (input.dateTo) c.push(lte(cardTerminalOperations.operationDatetime, madridEndOfDayUtc(input.dateTo)));
  const q = input.search?.trim();
  if (q) {
    const p = `%${escapeLike(q)}%`;
    c.push(
      or(
        like(cardTerminalOperations.operationNumber, p),
        like(cardTerminalOperations.card, p),
        like(cardTerminalOperations.terminalCode, p),
        like(cardTerminalOperations.commerceCode, p),
        like(cardTerminalOperations.authorizationCode, p),
      )!,
    );
  }
  return c.length ? and(...c) : undefined;
}

export type OperationsSummary = {
  /** Operaciones del filtro (con el estado elegido). */
  count: number;
  /** Ventas del filtro sin ignoradas, texto decimal. */
  ventas: string;
  /** Devoluciones del filtro sin ignoradas, texto decimal. */
  devoluciones: string;
  /** Ventas − devoluciones, texto decimal (puede ser negativo). */
  neto: string;
  /** Reparto por estado del filtro sin el estado elegido. `otros` = incluidas en remesa o liquidadas. */
  byStatus: { pendiente: number; conciliado: number; incidencia: number; ignorado: number; otros: number; total: number };
};

export async function summarizeOperations(db: any, input: OperationFilters): Promise<OperationsSummary> {
  const where = buildOperationConditions(input, { withStatus: false });
  const t = cardTerminalOperations;
  const chosen: SQL = input.status && input.status !== "todos" ? sql`${t.status} = ${input.status}` : sql`1 = 1`;
  const notIgn = sql`${t.status} <> 'ignorado'`;
  const isVenta = sql`${t.operationType} = 'VENTA'`;
  const isDev = sql`${t.operationType} = 'DEVOLUCION'`;
  const cols: Record<string, SQL> = {
    count: cnt(chosen),
    ventas: dec(sql`SUM(CASE WHEN ${chosen} AND ${notIgn} AND ${isVenta} THEN ${t.amount} ELSE 0 END)`),
    dev: dec(sql`SUM(CASE WHEN ${chosen} AND ${notIgn} AND ${isDev} THEN ${t.amount} ELSE 0 END)`),
    neto: dec(sql`SUM(CASE WHEN ${chosen} AND ${notIgn} AND ${isVenta} THEN ${t.amount} WHEN ${chosen} AND ${notIgn} AND ${isDev} THEN -${t.amount} ELSE 0 END)`),
    pen: cnt(sql`${t.status} = 'pendiente'`),
    con: cnt(sql`${t.status} = 'conciliado'`),
    inc: cnt(sql`${t.status} = 'incidencia'`),
    ign: cnt(sql`${t.status} = 'ignorado'`),
    tot: sql`CAST(COUNT(*) AS CHAR)`,
  };
  const q = db.select(cols).from(t);
  const [row] = await (where ? q.where(where) : q);
  const r = (row ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0);
  const total = n("tot");
  return {
    count: n("count"),
    ventas: String(r.ventas ?? "0"),
    devoluciones: String(r.dev ?? "0"),
    neto: String(r.neto ?? "0"),
    byStatus: { pendiente: n("pen"), conciliado: n("con"), incidencia: n("inc"), ignorado: n("ign"), otros: total - n("pen") - n("con") - n("inc") - n("ign"), total },
  };
}

/** Página del listado (más recientes primero) y total del filtro. */
export async function listOperationsPage(db: any, input: OperationFilters & { page: number; pageSize: number }) {
  const where = buildOperationConditions(input);
  const offset = Math.max(0, (input.page - 1) * input.pageSize);
  const q = db.select().from(cardTerminalOperations);
  const rows = await (where ? q.where(where) : q)
    .orderBy(desc(cardTerminalOperations.operationDatetime), desc(cardTerminalOperations.id))
    .limit(input.pageSize)
    .offset(offset);
  const summary = await summarizeOperations(db, input);
  return { rows: rows as CardTerminalOperation[], total: summary.count, summary };
}

// ─── Remesas y estado de la conciliación ─────────────────────────────────────────────────────────────────────────────

export type BatchStatus = "pending" | "suggested" | "auto_ready" | "reconciled" | "difference" | "ignored" | "review_required";
export const BATCH_STATUSES: readonly BatchStatus[] = ["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"];

export type BatchFilters = {
  /** AAAA-MM-DD, sobre la fecha de la remesa. */
  fromDate?: string;
  toDate?: string;
  status?: BatchStatus;
  terminalCode?: string;
};

export function buildBatchConditions(input: BatchFilters, opts: { withStatus?: boolean } = {}): SQL | undefined {
  const c: SQL[] = [];
  if (input.fromDate) c.push(gte(cardTerminalBatches.batchDate, input.fromDate));
  if (input.toDate) c.push(lte(cardTerminalBatches.batchDate, input.toDate));
  if (opts.withStatus !== false && input.status) c.push(eq(cardTerminalBatches.status, input.status));
  if (input.terminalCode) c.push(eq(cardTerminalBatches.terminalCode, input.terminalCode));
  return c.length ? and(...c) : undefined;
}

export type BatchBucket = { count: number; /** Neto de las remesas, texto decimal. */ amount: string };

export type BatchesSummary = {
  /** Remesas del filtro (con el estado elegido) y su neto. */
  count: number;
  net: string;
  /** Reparto por estado del filtro sin el estado elegido. */
  byStatus: Record<BatchStatus, BatchBucket & { /** Suma de «diferencia con banco» de esas remesas, texto decimal. */ difference: string }>;
  /**
   * Estado de la conciliación del filtro (sin el estado elegido), con UN criterio por cifra:
   *  - conciliadas = conciliada + con diferencia;
   *  - pendientes = pendiente + sugerida + lista + por revisar (todo lo que falta por conciliar; las ignoradas no cuentan);
   *  - diferencias = remesas con diferencia y suma de su diferencia con el banco;
   *  - % conciliado = conciliadas / todas las del periodo (como el panel de conciliación de siempre).
   */
  conciliation: {
    total: BatchBucket;
    reconciled: BatchBucket;
    pending: BatchBucket;
    difference: { count: number; amount: string };
    attention: { autoReady: BatchBucket; suggested: BatchBucket; reviewRequired: BatchBucket };
    pctReconciled: number;
  };
};

export async function summarizeBatches(db: any, input: BatchFilters): Promise<BatchesSummary> {
  const where = buildBatchConditions(input, { withStatus: false });
  const t = cardTerminalBatches;
  const chosen: SQL = input.status ? sql`${t.status} = ${input.status}` : sql`1 = 1`;
  const cols: Record<string, SQL> = {
    count: cnt(chosen),
    net: dec(sql`SUM(CASE WHEN ${chosen} THEN ${t.totalNet} ELSE 0 END)`),
  };
  for (const s of BATCH_STATUSES) {
    const cond = sql`${t.status} = ${s}`;
    cols[`n_${s}`] = cnt(cond);
    cols[`a_${s}`] = dec(sql`SUM(CASE WHEN ${cond} THEN ${t.totalNet} ELSE 0 END)`);
    cols[`d_${s}`] = dec(sql`SUM(CASE WHEN ${cond} THEN ${t.differenceAmount} ELSE 0 END)`);
  }
  const q = db.select(cols).from(t);
  const [row] = await (where ? q.where(where) : q);
  const r = (row ?? {}) as Record<string, unknown>;
  const byStatus = {} as BatchesSummary["byStatus"];
  for (const s of BATCH_STATUSES) byStatus[s] = { count: Number(r[`n_${s}`] ?? 0), amount: String(r[`a_${s}`] ?? "0"), difference: String(r[`d_${s}`] ?? "0") };
  const sum = (...ss: BatchStatus[]): BatchBucket => ({ count: ss.reduce((a, s) => a + byStatus[s].count, 0), amount: addDecimals(...ss.map((s) => byStatus[s].amount)) });
  const total = sum(...BATCH_STATUSES);
  const reconciled = sum("reconciled", "difference");
  return {
    count: Number(r.count ?? 0),
    net: String(r.net ?? "0"),
    byStatus,
    conciliation: {
      total,
      reconciled,
      pending: sum("pending", "suggested", "auto_ready", "review_required"),
      difference: { count: byStatus.difference.count, amount: byStatus.difference.difference },
      attention: { autoReady: sum("auto_ready"), suggested: sum("suggested"), reviewRequired: sum("review_required") },
      pctReconciled: total.count > 0 ? Math.round((reconciled.count / total.count) * 100) : 0,
    },
  };
}

/** Página de remesas (más recientes primero) y total del filtro. */
export async function listBatchesPage(db: any, input: BatchFilters & { page: number; pageSize: number }) {
  const where = buildBatchConditions(input);
  const offset = Math.max(0, (input.page - 1) * input.pageSize);
  const q = db.select().from(cardTerminalBatches);
  const rows = await (where ? q.where(where) : q)
    .orderBy(desc(cardTerminalBatches.batchDate), desc(cardTerminalBatches.createdAt), desc(cardTerminalBatches.id))
    .limit(input.pageSize)
    .offset(offset);
  const summary = await summarizeBatches(db, input);
  return { rows: rows as CardTerminalBatch[], total: summary.count, summary };
}
