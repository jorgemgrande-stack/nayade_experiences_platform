/**
 * Consultas de solo lectura de Caja: página de movimientos con búsqueda en servidor, totales del filtro completo y
 * resumen de saldo, neto de hoy, cierres con descuadre e incidencias.
 *
 * El listado paginado (`cashRegister.listMovementsPage`) y el resumen (`cashRegister.movementsSummary`) construyen su
 * `where` con la misma función (`buildCashMovementConditions`). Los importes se suman en SQL sobre columnas decimales y
 * vuelven como texto decimal exacto. El aislamiento por empresa es el de la conexión recibida (`legacyDb()` del tenant):
 * ninguna consulta nombra empresas. Las reglas de saldo son las existentes (ingresos = income, transfer_in,
 * opening_balance; salidas = expense, transfer_out; un «ajuste» (adjustment) no mueve el saldo): aquí no se cambian.
 */
import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { finCashAccounts, finCashAlerts, finCashClosures, finCashMovements } from "../drizzle/schema";
import { escapeLike } from "./expensesQuery";

export const CASH_INCOME_TYPES = ["income", "transfer_in", "opening_balance"] as const;
export const CASH_EXPENSE_TYPES = ["expense", "transfer_out"] as const;

export type CashMovementFilters = {
  accountId?: number;
  dateFrom?: string;
  dateTo?: string;
  /** Texto libre: concepto, contraparte o notas (sin distinguir mayúsculas). */
  search?: string;
};

export { escapeLike };

export function buildCashMovementConditions(input: CashMovementFilters): SQL | undefined {
  const c: SQL[] = [];
  if (input.accountId) c.push(eq(finCashMovements.accountId, input.accountId));
  if (input.dateFrom) c.push(gte(finCashMovements.date, input.dateFrom));
  if (input.dateTo) c.push(lte(finCashMovements.date, input.dateTo));
  const q = input.search?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    c.push(or(like(finCashMovements.concept, pattern), like(finCashMovements.counterparty, pattern), like(finCashMovements.notes, pattern))!);
  }
  return c.length ? and(...c) : undefined;
}

export async function listCashMovementsPage(db: any, input: CashMovementFilters & { limit: number; offset: number }) {
  const where = buildCashMovementConditions(input);
  const q = db.select().from(finCashMovements);
  const items = await (where ? q.where(where) : q)
    .orderBy(desc(finCashMovements.date), desc(finCashMovements.id))
    .limit(input.limit)
    .offset(input.offset);
  const cq = db.select({ n: sql<string>`CAST(COUNT(*) AS CHAR)` }).from(finCashMovements);
  const [row] = await (where ? cq.where(where) : cq);
  return { items, total: Number(row?.n ?? 0) };
}

export type CashMovementsSummary = {
  count: number;
  /** Entradas (ingresos, traspasos de entrada y saldo inicial), texto decimal. */
  inflow: string;
  /** Salidas (gastos y traspasos de salida), texto decimal. */
  outflow: string;
  /** Entradas − salidas. */
  net: string;
  /** Ajustes (no mueven el saldo): nº e importe sin signo. */
  adjustmentCount: number;
  adjustmentAmount: string;
};

const typeIn = (types: readonly string[]) => sql`${finCashMovements.type} IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})`;

export async function summarizeCashMovements(db: any, input: CashMovementFilters): Promise<CashMovementsSummary> {
  const where = buildCashMovementConditions(input);
  const dec = (e: SQL) => sql`CAST(COALESCE(${e}, 0) AS CHAR)`;
  const cols = {
    count: sql`CAST(COUNT(*) AS CHAR)`,
    inflow: dec(sql`SUM(CASE WHEN ${typeIn(CASH_INCOME_TYPES)} THEN ${finCashMovements.amount} ELSE 0 END)`),
    outflow: dec(sql`SUM(CASE WHEN ${typeIn(CASH_EXPENSE_TYPES)} THEN ${finCashMovements.amount} ELSE 0 END)`),
    net: dec(sql`SUM(CASE WHEN ${typeIn(CASH_INCOME_TYPES)} THEN ${finCashMovements.amount} WHEN ${typeIn(CASH_EXPENSE_TYPES)} THEN -${finCashMovements.amount} ELSE 0 END)`),
    adjN: sql`CAST(COALESCE(SUM(CASE WHEN ${finCashMovements.type} = 'adjustment' THEN 1 ELSE 0 END), 0) AS CHAR)`,
    adjA: dec(sql`SUM(CASE WHEN ${finCashMovements.type} = 'adjustment' THEN ${finCashMovements.amount} ELSE 0 END)`),
  };
  const q = db.select(cols).from(finCashMovements);
  const [r] = await (where ? q.where(where) : q);
  return {
    count: Number(r?.count ?? 0),
    inflow: String(r?.inflow ?? "0"),
    outflow: String(r?.outflow ?? "0"),
    net: String(r?.net ?? "0"),
    adjustmentCount: Number(r?.adjN ?? 0),
    adjustmentAmount: String(r?.adjA ?? "0"),
  };
}

export type CashOverview = {
  /** Saldo de las cuentas activas, texto decimal. */
  totalBalance: string;
  activeAccounts: number;
  /** Neto del día indicado: (ingresos + saldo inicial) − gastos; los traspasos entre cuentas no cuentan (como el resumen histórico). */
  todayNet: string;
  /** Cierres pendientes de resolver (con descuadre o revisados sin resolver) y su diferencia absoluta. */
  closures: { total: number; pending: number; pendingAbs: string };
  /** Incidencias de caja sin resolver. */
  alerts: { open: number; critical: number };
};

export async function cashOverview(db: any, input: { today: string; accountId?: number }): Promise<CashOverview> {
  const dec = (e: SQL) => sql`CAST(COALESCE(${e}, 0) AS CHAR)`;
  const [acc] = await db
    .select({ total: dec(sql`SUM(${finCashAccounts.currentBalance})`), n: sql`CAST(COUNT(*) AS CHAR)` })
    .from(finCashAccounts)
    .where(eq(finCashAccounts.isActive, true));
  const [net] = await db
    .select({
      v: dec(sql`SUM(CASE WHEN ${finCashMovements.type} IN ('income', 'opening_balance') THEN ${finCashMovements.amount} WHEN ${finCashMovements.type} = 'expense' THEN -${finCashMovements.amount} ELSE 0 END)`),
    })
    .from(finCashMovements)
    .where(eq(finCashMovements.date, input.today));
  const cWhere = input.accountId ? eq(finCashClosures.accountId, input.accountId) : undefined;
  const cq = db
    .select({
      total: sql`CAST(COUNT(*) AS CHAR)`,
      pending: sql`CAST(COALESCE(SUM(CASE WHEN ${inArray(finCashClosures.status, ["difference", "reviewed"])} THEN 1 ELSE 0 END), 0) AS CHAR)`,
      abs: dec(sql`SUM(CASE WHEN ${inArray(finCashClosures.status, ["difference", "reviewed"])} THEN ABS(${finCashClosures.difference}) ELSE 0 END)`),
    })
    .from(finCashClosures);
  const [cl] = await (cWhere ? cq.where(cWhere) : cq);
  const [al] = await db
    .select({
      open: sql`CAST(COUNT(*) AS CHAR)`,
      critical: sql`CAST(COALESCE(SUM(CASE WHEN ${finCashAlerts.severity} = 'critical' THEN 1 ELSE 0 END), 0) AS CHAR)`,
    })
    .from(finCashAlerts)
    .where(isNull(finCashAlerts.resolvedAt));
  return {
    totalBalance: String(acc?.total ?? "0"),
    activeAccounts: Number(acc?.n ?? 0),
    todayNet: String(net?.v ?? "0"),
    closures: { total: Number(cl?.total ?? 0), pending: Number(cl?.pending ?? 0), pendingAbs: String(cl?.abs ?? "0") },
    alerts: { open: Number(al?.open ?? 0), critical: Number(al?.critical ?? 0) },
  };
}
