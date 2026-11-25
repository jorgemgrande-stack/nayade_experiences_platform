/**
 * Consultas de solo lectura de Movimientos bancarios: filtros, página y totales del filtro COMPLETO.
 *
 * El listado (`bankMovements.listMovements`) y el resumen (`bankMovements.movementsSummary`) construyen su `where` con la
 * misma función (`buildBankConditions`): las cifras del resumen son exactamente las del conjunto que el listado pagina.
 * Los importes se suman en SQL sobre la columna decimal (nunca en coma flotante) y vuelven como texto decimal exacto
 * («-1234567.89»). El aislamiento por empresa es el de la conexión recibida (`legacyDb()` del tenant en curso): ninguna
 * consulta nombra empresas.
 *
 * Nada de aquí escribe en la base de datos ni cambia estados, vínculos o algoritmos de conciliación.
 */
import { and, desc, eq, gte, like, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { bankMovements } from "../drizzle/schema";
import { escapeLike } from "./expensesQuery";

/** Estado de conciliación que se ve en pantalla (una sola insignia por movimiento). */
export type BankConciliationFilter = "todos" | "sin_conciliar" | "conciliado" | "gasto_vinculado" | "ignorado";

export type BankFilters = {
  importId?: number;
  /** Filtro histórico por estado del movimiento (pendiente / ignorado). */
  status?: "pendiente" | "ignorado" | "todos";
  /** Estado de conciliación (excluyentes entre sí: ignorado > gasto vinculado > conciliado > sin conciliar). */
  conciliation?: BankConciliationFilter;
  fechaFrom?: string;
  fechaTo?: string;
  /** Texto libre: movimiento o más datos (sin distinguir mayúsculas). */
  search?: string;
};

export { escapeLike };

export function buildBankConditions(input: BankFilters): SQL | undefined {
  const c: SQL[] = [];
  if (input.importId) c.push(eq(bankMovements.importId, input.importId));
  if (input.status && input.status !== "todos") c.push(eq(bankMovements.status, input.status));
  switch (input.conciliation) {
    case "sin_conciliar":
      c.push(eq(bankMovements.status, "pendiente"), eq(bankMovements.conciliationStatus, "pendiente"));
      break;
    case "conciliado":
      c.push(eq(bankMovements.status, "pendiente"), eq(bankMovements.conciliationStatus, "conciliado"), gte(bankMovements.importe, "0"));
      break;
    case "gasto_vinculado":
      c.push(eq(bankMovements.status, "pendiente"), eq(bankMovements.conciliationStatus, "conciliado"), lt(bankMovements.importe, "0"));
      break;
    case "ignorado":
      c.push(eq(bankMovements.status, "ignorado"));
      break;
    default:
  }
  if (input.fechaFrom) c.push(gte(bankMovements.fecha, input.fechaFrom));
  if (input.fechaTo) c.push(lte(bankMovements.fecha, input.fechaTo));
  const q = input.search?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    c.push(or(like(bankMovements.movimiento, pattern), like(bankMovements.masDatos, pattern))!);
  }
  return c.length ? and(...c) : undefined;
}

/** Página del listado (más recientes primero) y total del filtro. */
export async function listBankMovements(db: any, input: BankFilters & { page: number; pageSize: number }) {
  const where = buildBankConditions(input);
  const offset = Math.max(0, (input.page - 1) * input.pageSize);
  const q = db.select().from(bankMovements);
  const rows = await (where ? q.where(where) : q)
    .orderBy(desc(bankMovements.fecha), desc(bankMovements.id))
    .limit(input.pageSize)
    .offset(offset);
  const s = await summarizeBankMovements(db, input);
  return { data: rows, total: s.count, totals: s };
}

export type BankBucket = {
  count: number;
  /** Suma con signo, texto decimal. */
  amount: string;
  /** Suma de importes en valor absoluto, texto decimal. */
  amountAbs: string;
};
export type BankSummary = {
  count: number;
  /** Abonos del filtro (sin ignorados), texto decimal. */
  ingresado: string;
  /** Cargos del filtro (sin ignorados), texto decimal negativo. */
  cargado: string;
  sinConciliar: BankBucket;
  conciliados: BankBucket;
  gastoVinculado: BankBucket;
  ignorados: BankBucket;
};

const IGN = sql`${bankMovements.status} = 'ignorado'`;
const PEN = sql`${bankMovements.status} = 'pendiente'`;
const CONC = sql`${bankMovements.conciliationStatus} = 'conciliado'`;
const NEG = sql`${bankMovements.importe} < 0`;
const BUCKETS: Record<string, SQL> = {
  sin: sql`(${PEN} AND NOT ${CONC})`,
  con: sql`(${PEN} AND ${CONC} AND NOT ${NEG})`,
  gas: sql`(${PEN} AND ${CONC} AND ${NEG})`,
  ign: sql`(${IGN})`,
};

export async function summarizeBankMovements(db: any, input: BankFilters): Promise<BankSummary> {
  const where = buildBankConditions(input);
  const dec = (e: SQL) => sql`CAST(COALESCE(${e}, 0) AS CHAR)`;
  const cols: Record<string, SQL> = {
    count: sql`CAST(COUNT(*) AS CHAR)`,
    ing: dec(sql`SUM(CASE WHEN NOT ${IGN} AND ${bankMovements.importe} > 0 THEN ${bankMovements.importe} ELSE 0 END)`),
    car: dec(sql`SUM(CASE WHEN NOT ${IGN} AND ${NEG} THEN ${bankMovements.importe} ELSE 0 END)`),
  };
  for (const [k, cond] of Object.entries(BUCKETS)) {
    cols[`n_${k}`] = sql`CAST(COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0) AS CHAR)`;
    cols[`a_${k}`] = dec(sql`SUM(CASE WHEN ${cond} THEN ${bankMovements.importe} ELSE 0 END)`);
    cols[`b_${k}`] = dec(sql`SUM(CASE WHEN ${cond} THEN ABS(${bankMovements.importe}) ELSE 0 END)`);
  }
  const q = db.select(cols).from(bankMovements);
  const [row] = await (where ? q.where(where) : q);
  const r = (row ?? {}) as Record<string, unknown>;
  const bucket = (k: string): BankBucket => ({ count: Number(r[`n_${k}`] ?? 0), amount: String(r[`a_${k}`] ?? "0"), amountAbs: String(r[`b_${k}`] ?? "0") });
  return {
    count: Number(r.count ?? 0),
    ingresado: String(r.ing ?? "0"),
    cargado: String(r.car ?? "0"),
    sinConciliar: bucket("sin"),
    conciliados: bucket("con"),
    gastoVinculado: bucket("gas"),
    ignorados: bucket("ign"),
  };
}
