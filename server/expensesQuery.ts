/**
 * Consultas de solo lectura del listado de gastos: filtros, página y totales del filtro COMPLETO.
 *
 * El listado (`financial.expenses.list`) y el resumen (`financial.expenses.summary`) construyen su `where` con la misma
 * función (`buildExpenseConditions`), de modo que las cifras del resumen son exactamente las del conjunto que el listado
 * pagina. Los importes se suman en SQL sobre las columnas decimales (nunca en coma flotante) y vuelven como texto
 * decimal exacto («1234567.89»). El aislamiento por empresa es el de la conexión recibida (`legacyDb()` del tenant en
 * curso): ninguna consulta nombra empresas.
 *
 * Nada de aquí escribe en la base de datos ni cambia importes, impuestos o estados.
 */
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
import { expenseFiles, expenses } from "../drizzle/schema";

export type ExpenseFilters = {
  dateFrom?: string;
  dateTo?: string;
  categoryId?: number;
  costCenterId?: number;
  supplierId?: number;
  status?: "pending" | "justified" | "accounted" | "conciliado";
  paymentMethod?: "cash" | "card" | "transfer" | "direct_debit" | "tpv_cash";
  treatment?: "all" | "operational" | "tax_only";
  /** Texto libre: concepto o nombre del proveedor del gasto (sin distinguir mayúsculas). */
  search?: string;
  /** Origen del gasto («email», «manual», «tpv»…). */
  source?: string;
  /** «missing»: solo los gastos marcados «sin adjunto». */
  attachment?: "missing";
};

/** Escapa los comodines de LIKE para que el texto buscado se tome literalmente. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildExpenseConditions(input: ExpenseFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (input.dateFrom) conditions.push(gte(expenses.date, input.dateFrom));
  if (input.dateTo) conditions.push(lte(expenses.date, input.dateTo));
  if (input.categoryId) conditions.push(eq(expenses.categoryId, input.categoryId));
  if (input.costCenterId) conditions.push(eq(expenses.costCenterId, input.costCenterId));
  if (input.supplierId) conditions.push(eq(expenses.supplierId, input.supplierId));
  if (input.status) conditions.push(eq(expenses.status, input.status));
  if (input.paymentMethod) conditions.push(eq(expenses.paymentMethod, input.paymentMethod));
  if (input.treatment === "operational") conditions.push(eq(expenses.isOperational, true));
  else if (input.treatment === "tax_only") conditions.push(eq(expenses.isOperational, false));
  const q = input.search?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(or(like(expenses.concept, pattern), like(expenses.supplierName, pattern))!);
  }
  if (input.source) conditions.push(eq(expenses.source, input.source));
  if (input.attachment === "missing") conditions.push(eq(expenses.missingAttachment, true));
  return conditions.length ? and(...conditions) : undefined;
}

/** Página del listado y total del filtro (comportamiento histórico de `expenses.list`, con los filtros nuevos). */
export async function listExpenses(db: any, input: ExpenseFilters & { limit: number; offset: number }) {
  const where = buildExpenseConditions(input);
  const rows = await db
    .select()
    .from(expenses)
    .where(where)
    .orderBy(desc(expenses.date), desc(expenses.id))
    .limit(input.limit)
    .offset(input.offset);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(expenses).where(where);

  const ids: number[] = rows.map((r: { id: number }) => r.id);
  const files = ids.length
    ? await db.select().from(expenseFiles).where(
        sql`${expenseFiles.expenseId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
      )
    : [];
  const filesByExpense: Record<number, any[]> = {};
  for (const f of files as Array<{ expenseId: number }>) {
    (filesByExpense[f.expenseId] ??= []).push(f);
  }
  return {
    items: rows.map((r: { id: number }) => ({ ...r, files: filesByExpense[r.id] ?? [] })),
    total: Number(total),
  };
}

/**
 * IVA soportado (cuota) de un gasto en SQL. Misma regla que la pantalla: los gastos de origen RRHH no llevan IVA; si el
 * gasto tiene el desglose guardado se usa su cuota; si no, se deriva del total y del tipo (21 % si falta).
 */
const IVA_SOPORTADO = sql`(CASE
  WHEN ${expenses.source} LIKE 'hr\\_%' THEN 0
  WHEN ${expenses.taxAmount} IS NOT NULL THEN ${expenses.taxAmount}
  WHEN COALESCE(${expenses.taxRate}, 21) > 0 THEN ROUND(${expenses.amount} - ${expenses.amount} / (1 + COALESCE(${expenses.taxRate}, 21) / 100), 2)
  ELSE 0 END)`;

const STATUSES = ["pending", "justified", "accounted", "conciliado"] as const;
export type ExpenseStatus = (typeof STATUSES)[number];
export type ExpensesSummary = {
  count: number;
  /** Importe total (con IVA) del filtro, texto decimal. */
  total: string;
  /** IVA soportado del filtro, texto decimal. */
  ivaSoportado: string;
  byStatus: Record<ExpenseStatus, { count: number; amount: string }>;
  /** Gastos «solo fiscales» (no computan en el resultado operativo). */
  taxOnlyCount: number;
  /** Gastos marcados «sin adjunto». */
  missingAttachmentCount: number;
  /** Gastos recibidos por email. */
  emailCount: number;
};

export async function summarizeExpenses(db: any, input: ExpenseFilters): Promise<ExpensesSummary> {
  const where = buildExpenseConditions(input);
  const cols: Record<string, SQL> = {
    count: sql`CAST(COUNT(*) AS CHAR)`,
    total: sql`CAST(COALESCE(SUM(${expenses.amount}), 0) AS CHAR)`,
    iva: sql`CAST(COALESCE(SUM(${IVA_SOPORTADO}), 0) AS CHAR)`,
    taxOnly: sql`CAST(COALESCE(SUM(CASE WHEN ${expenses.isOperational} = 0 THEN 1 ELSE 0 END), 0) AS CHAR)`,
    missing: sql`CAST(COALESCE(SUM(CASE WHEN ${expenses.missingAttachment} = 1 THEN 1 ELSE 0 END), 0) AS CHAR)`,
    email: sql`CAST(COALESCE(SUM(CASE WHEN ${expenses.source} = 'email' THEN 1 ELSE 0 END), 0) AS CHAR)`,
  };
  for (const s of STATUSES) {
    cols[`n_${s}`] = sql.raw(`CAST(COALESCE(SUM(CASE WHEN \`expenses\`.\`status\` = '${s}' THEN 1 ELSE 0 END), 0) AS CHAR)`);
    cols[`a_${s}`] = sql.raw(`CAST(COALESCE(SUM(CASE WHEN \`expenses\`.\`status\` = '${s}' THEN \`expenses\`.\`amount\` ELSE 0 END), 0) AS CHAR)`);
  }
  const q = db.select(cols).from(expenses);
  const [row] = await (where ? q.where(where) : q);
  const r = (row ?? {}) as Record<string, unknown>;
  const byStatus = Object.fromEntries(
    STATUSES.map((s) => [s, { count: Number(r[`n_${s}`] ?? 0), amount: String(r[`a_${s}`] ?? "0") }]),
  ) as ExpensesSummary["byStatus"];
  return {
    count: Number(r.count ?? 0),
    total: String(r.total ?? "0"),
    ivaSoportado: String(r.iva ?? "0"),
    byStatus,
    taxOnlyCount: Number(r.taxOnly ?? 0),
    missingAttachmentCount: Number(r.missing ?? 0),
    emailCount: Number(r.email ?? 0),
  };
}
