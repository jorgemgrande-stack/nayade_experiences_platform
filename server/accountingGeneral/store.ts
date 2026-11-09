/**
 * Contabilidad general — acceso a datos en la BD de la empresa en curso (tablas `acc_*` de
 * db/migrations/0060_extra_contabilidad, fuera de `drizzle/schema.ts` a propósito). SQL siempre parametrizado (plantilla
 * `sql` de drizzle). Los asientos son inmutables: solo se insertan y se enlazan con su reversión.
 */
import { sql, type SQL } from "drizzle-orm";
import type { EntryLine, PostedLine } from "../finance/types";
import { ACC_TAX_REVIEW_RETRACTED, ACC_DEFAULT_MAP, ACC_MAP_KEYS, ACC_PGC_SEED, type AccAccountMap, type AccAccountType, type AccJournal, type AccOrigin } from "../../shared/accountingGeneral";
import type { AccAccount, AccDraft } from "./rules";

export interface Exec {
  execute(q: SQL): Promise<unknown>;
}
export interface TxExec extends Exec {
  transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T>;
}

export async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
/** DATE de MySQL (Date o texto) → «AAAA-MM-DD». */
export const day = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v).replace(" ", "T") + "Z").toISOString());
const json = <T>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};

/** Falta la migración 0060 (o una de sus tablas) en esta empresa. */
export function isMissingAccSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /acc_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}
/** Clave única duplicada o interbloqueo: otra generación hizo lo mismo a la vez. */
export function isConcurrent(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062 || x.code === "ER_LOCK_DEADLOCK" || x.errno === 1213) return true;
  }
  return false;
}

// ─── Ajustes y siembra ────────────────────────────────────────────────────────

export interface AccSettings {
  startDate: string;
  lockedUntil: string | null;
  map: AccAccountMap;
  lastSyncAt: string | null;
  lastSync: unknown;
}

const mapOf = (v: unknown): AccAccountMap => {
  const m = json<Partial<AccAccountMap>>(v) ?? {};
  const out = { ...ACC_DEFAULT_MAP };
  for (const k of ACC_MAP_KEYS) if (typeof m[k] === "string" && m[k]) out[k] = m[k]!;
  return out;
};

export async function getSettings(exec: Exec): Promise<AccSettings | null> {
  const [r] = await rows(exec, sql`SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(locked_until, '%Y-%m-%d') AS locked_until, account_map, last_sync_at, last_sync FROM acc_settings WHERE id = 1`);
  if (!r) return null;
  return { startDate: day(r.start_date), lockedUntil: r.locked_until == null ? null : day(r.locked_until), map: mapOf(r.account_map), lastSyncAt: iso(r.last_sync_at), lastSync: json(r.last_sync) };
}

/**
 * Primera vez en la empresa: siembra el plan de cuentas (PGC de pymes) y los ajustes (inicio = 1 de enero del año en
 * curso). Idempotente: INSERT IGNORE, nunca pisa lo que la empresa ya cambió.
 */
export async function seed(exec: TxExec, startDate: string): Promise<void> {
  await exec.transaction(async (tx) => {
    await seedAccounts(tx);
    await tx.execute(sql`INSERT IGNORE INTO acc_settings (id, start_date, account_map) VALUES (1, ${startDate}, ${JSON.stringify(ACC_DEFAULT_MAP)})`);
  });
}

/** Cuentas del plan que falten (INSERT IGNORE: nunca toca las existentes ni lo que la empresa cambió). */
export async function seedAccounts(exec: Exec): Promise<void> {
  const values = ACC_PGC_SEED.map((a) => sql`(${a.code}, ${a.name}, ${a.type}, ${a.parentCode ?? null}, 1, 1, 1)`);
  await exec.execute(sql`INSERT IGNORE INTO acc_accounts (code, name, type, parent_code, is_postable, active, is_seed) VALUES ${sql.join(values, sql`, `)}`);
}

export async function saveSettings(exec: Exec, s: { startDate: string; lockedUntil: string | null; map: AccAccountMap }, userId: number | null): Promise<void> {
  await exec.execute(sql`UPDATE acc_settings SET start_date = ${s.startDate}, locked_until = ${s.lockedUntil}, account_map = ${JSON.stringify(s.map)}, updated_by = ${userId} WHERE id = 1`);
}

export async function saveLastSync(exec: Exec, summary: unknown): Promise<void> {
  await exec.execute(sql`UPDATE acc_settings SET last_sync_at = CURRENT_TIMESTAMP(3), last_sync = ${JSON.stringify(summary)} WHERE id = 1`);
}

// ─── Plan de cuentas ──────────────────────────────────────────────────────────

const accountOf = (r: any): AccAccount & { isSeed: boolean } => ({
  code: String(r.code),
  name: String(r.name),
  type: String(r.type) as AccAccountType,
  parentCode: str(r.parent_code),
  isPostable: num(r.is_postable) === 1,
  active: num(r.active) === 1,
  isSeed: num(r.is_seed) === 1,
});

export async function listAccounts(exec: Exec): Promise<Array<AccAccount & { isSeed: boolean }>> {
  return (await rows(exec, sql`SELECT code, name, type, parent_code, is_postable, active, is_seed FROM acc_accounts ORDER BY code`)).map(accountOf);
}
export async function accountMap(exec: Exec): Promise<Map<string, AccAccount>> {
  return new Map((await listAccounts(exec)).map((a) => [a.code, a]));
}
export async function insertAccount(exec: Exec, a: AccAccount): Promise<void> {
  await exec.execute(sql`INSERT INTO acc_accounts (code, name, type, parent_code, is_postable, active, is_seed) VALUES (${a.code}, ${a.name}, ${a.type}, ${a.parentCode}, ${a.isPostable ? 1 : 0}, ${a.active ? 1 : 0}, 0)`);
}
export async function updateAccount(exec: Exec, code: string, p: { name: string; active: boolean }): Promise<number> {
  return (await header(exec, sql`UPDATE acc_accounts SET name = ${p.name}, active = ${p.active ? 1 : 0} WHERE code = ${code}`)).affectedRows;
}
export async function accountHasLines(exec: Exec, code: string): Promise<boolean> {
  return (await rows(exec, sql`SELECT 1 AS x FROM acc_entry_lines WHERE account_code = ${code} LIMIT 1`)).length > 0;
}

// ─── Cuentas de las categorías de gasto ───────────────────────────────────────

export async function categoryAccounts(exec: Exec): Promise<Map<number, string>> {
  return new Map((await rows(exec, sql`SELECT category_id, account_code FROM acc_category_accounts WHERE account_code <> ''`)).map((r) => [num(r.category_id), String(r.account_code)]));
}
export async function setCategoryAccount(exec: Exec, categoryId: number, code: string | null, userId: number | null): Promise<void> {
  if (code == null) {
    // Sin fila = la cuenta por defecto: se guarda la de por defecto explícitamente vacía (no se borran filas)
    await exec.execute(sql`UPDATE acc_category_accounts SET account_code = '', updated_by = ${userId} WHERE category_id = ${categoryId}`);
    return;
  }
  await exec.execute(sql`INSERT INTO acc_category_accounts (category_id, account_code, updated_by) VALUES (${categoryId}, ${code}, ${userId})
    ON DUPLICATE KEY UPDATE account_code = VALUES(account_code), updated_by = VALUES(updated_by)`);
}

// ─── IVA confirmado de los gastos ─────────────────────────────────────────────

export async function upsertTaxReview(exec: Exec, r: { expenseId: number; amountCents: number; taxRateBp: number; taxCents: number; invoiceType: string | null }, userId: number | null): Promise<void> {
  await exec.execute(sql`INSERT INTO acc_expense_tax_reviews (expense_id, amount_cents, tax_rate_bp, tax_cents, invoice_type, confirmed_by)
    VALUES (${r.expenseId}, ${r.amountCents}, ${r.taxRateBp}, ${r.taxCents}, ${r.invoiceType}, ${userId})
    ON DUPLICATE KEY UPDATE amount_cents = VALUES(amount_cents), tax_rate_bp = VALUES(tax_rate_bp), tax_cents = VALUES(tax_cents),
      invoice_type = VALUES(invoice_type), confirmed_by = VALUES(confirmed_by), confirmed_at = CURRENT_TIMESTAMP(3)`);
}
/** Retira la confirmación sin borrarla: queda anulada (ACC_TAX_REVIEW_RETRACTED) con quién la retiró y cuándo. */
export async function retractTaxReview(exec: Exec, expenseId: number, userId: number | null): Promise<void> {
  await exec.execute(sql`UPDATE acc_expense_tax_reviews SET invoice_type = ${ACC_TAX_REVIEW_RETRACTED}, confirmed_by = ${userId}, confirmed_at = CURRENT_TIMESTAMP(3)
    WHERE expense_id = ${expenseId}`);
}

// ─── Estado contable de los documentos ────────────────────────────────────────

export async function listSources(exec: Exec): Promise<Map<string, { entryId: number | null; hash: string | null }>> {
  const r = await rows(exec, sql`SELECT source_key, entry_id, hash FROM acc_sources`);
  return new Map(r.map((x) => [String(x.source_key), { entryId: x.entry_id == null ? null : num(x.entry_id), hash: str(x.hash) }]));
}
export async function lockSource(tx: Exec, key: string): Promise<{ entryId: number | null; hash: string | null; version: number } | null> {
  const [r] = await rows(tx, sql`SELECT entry_id, hash, version FROM acc_sources WHERE source_key = ${key} FOR UPDATE`);
  return r ? { entryId: r.entry_id == null ? null : num(r.entry_id), hash: str(r.hash), version: num(r.version) } : null;
}
export async function insertSource(tx: Exec, key: string): Promise<void> {
  await tx.execute(sql`INSERT INTO acc_sources (source_key, version) VALUES (${key}, 0)`);
}
export async function setSource(tx: Exec, key: string, entryId: number | null, hash: string | null, version: number): Promise<void> {
  await tx.execute(sql`UPDATE acc_sources SET entry_id = ${entryId}, hash = ${hash}, version = ${version} WHERE source_key = ${key}`);
}

// ─── Asientos ─────────────────────────────────────────────────────────────────

/** Número siguiente del ejercicio (la fila queda bloqueada hasta el final de la transacción: sin huecos ni carreras). */
async function nextNumber(tx: Exec, year: number): Promise<number> {
  await tx.execute(sql`INSERT INTO acc_sequences (year, last_number) VALUES (${year}, 1) ON DUPLICATE KEY UPDATE last_number = last_number + 1`);
  const [r] = await rows(tx, sql`SELECT last_number FROM acc_sequences WHERE year = ${year}`);
  return num(r.last_number);
}

/** Inserta un asiento ya validado (dentro de una transacción). */
export async function insertEntry(
  tx: Exec,
  d: AccDraft,
  lines: EntryLine[],
  meta: { sourceKey: string | null; reversesEntryId: number | null; userId: number | null },
): Promise<{ id: number; year: number; number: number }> {
  const year = Number(d.date.slice(0, 4));
  const number = await nextNumber(tx, year);
  const total = lines.reduce((a, l) => a + l.debitCents, 0);
  const r = await header(tx, sql`INSERT INTO acc_entries (year, number, entry_date, journal, description, origin, source_key, total_cents, reverses_entry_id, created_by)
    VALUES (${year}, ${number}, ${d.date}, ${d.journal}, ${d.description}, ${d.origin}, ${meta.sourceKey}, ${total}, ${meta.reversesEntryId}, ${meta.userId})`);
  const values = lines.map((l) => sql`(${r.insertId}, ${l.lineNo}, ${l.accountCode}, ${l.debitCents}, ${l.creditCents}, ${l.description}, ${l.taxRateBp}, ${l.taxBaseCents})`);
  await tx.execute(sql`INSERT INTO acc_entry_lines (entry_id, line_no, account_code, debit_cents, credit_cents, description, tax_rate_bp, tax_base_cents) VALUES ${sql.join(values, sql`, `)}`);
  if (meta.reversesEntryId != null) {
    const u = await header(tx, sql`UPDATE acc_entries SET reversed_by_entry_id = ${r.insertId} WHERE id = ${meta.reversesEntryId} AND reversed_by_entry_id IS NULL`);
    if (u.affectedRows !== 1) throw Object.assign(new Error("El asiento ya estaba revertido"), { code: "ER_DUP_ENTRY" });
  }
  return { id: r.insertId, year, number };
}

export interface StoredEntry {
  id: number;
  year: number;
  number: number;
  date: string;
  journal: AccJournal;
  description: string;
  origin: AccOrigin;
  sourceKey: string | null;
  totalCents: number;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  createdAt: string | null;
  lines: EntryLine[];
}

const lineOf = (r: any): EntryLine => ({
  lineNo: num(r.line_no),
  accountCode: String(r.account_code),
  debitCents: num(r.debit_cents),
  creditCents: num(r.credit_cents),
  description: str(r.description),
  costCenterId: null,
  supplierId: null,
  companyId: null,
  taxRateBp: r.tax_rate_bp == null ? null : num(r.tax_rate_bp),
  taxBaseCents: r.tax_base_cents == null ? null : num(r.tax_base_cents),
});
const entryOf = (r: any, lines: EntryLine[]): StoredEntry => ({
  id: num(r.id),
  year: num(r.year),
  number: num(r.number),
  date: day(r.entry_date),
  journal: String(r.journal) as AccJournal,
  description: String(r.description),
  origin: String(r.origin) as AccOrigin,
  sourceKey: str(r.source_key),
  totalCents: num(r.total_cents),
  reversesEntryId: r.reverses_entry_id == null ? null : num(r.reverses_entry_id),
  reversedByEntryId: r.reversed_by_entry_id == null ? null : num(r.reversed_by_entry_id),
  createdAt: iso(r.created_at),
  lines,
});

async function withLines(exec: Exec, entries: any[]): Promise<StoredEntry[]> {
  if (!entries.length) return [];
  const ids = entries.map((e) => num(e.id));
  const ls = await rows(exec, sql`SELECT entry_id, line_no, account_code, debit_cents, credit_cents, description, tax_rate_bp, tax_base_cents
    FROM acc_entry_lines WHERE entry_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY entry_id, line_no`);
  const by = new Map<number, EntryLine[]>();
  for (const l of ls) {
    const arr = by.get(num(l.entry_id)) ?? [];
    arr.push(lineOf(l));
    by.set(num(l.entry_id), arr);
  }
  return entries.map((e) => entryOf(e, by.get(num(e.id)) ?? []));
}

const ENTRY_COLS = sql`id, year, number, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, journal, description, origin, source_key, total_cents, reverses_entry_id, reversed_by_entry_id, created_at`;

export async function getEntry(exec: Exec, id: number, lock = false): Promise<StoredEntry | null> {
  const r = await rows(exec, lock ? sql`SELECT ${ENTRY_COLS} FROM acc_entries WHERE id = ${id} FOR UPDATE` : sql`SELECT ${ENTRY_COLS} FROM acc_entries WHERE id = ${id}`);
  return (await withLines(exec, r))[0] ?? null;
}

/** Asientos del periodo en el orden del libro (fecha, ejercicio, número), paginados. */
export async function listEntries(exec: Exec, f: { from: string; to: string; origin?: AccOrigin | null; limit: number; offset: number }): Promise<{ total: number; items: StoredEntry[] }> {
  const where = f.origin ? sql`entry_date BETWEEN ${f.from} AND ${f.to} AND origin = ${f.origin}` : sql`entry_date BETWEEN ${f.from} AND ${f.to}`;
  const [c] = await rows(exec, sql`SELECT COUNT(*) AS n FROM acc_entries WHERE ${where}`);
  const r = await rows(exec, sql`SELECT ${ENTRY_COLS} FROM acc_entries WHERE ${where} ORDER BY entry_date, year, number LIMIT ${f.limit} OFFSET ${f.offset}`);
  return { total: num(c?.n), items: await withLines(exec, r) };
}

/** Líneas contabilizadas con los datos de su asiento (para el mayor, sumas y saldos y exportaciones). */
export async function postedLines(exec: Exec, f: { from?: string | null; to?: string | null; before?: string | null; accountPrefix?: string | null }): Promise<PostedLine[]> {
  const conds: SQL[] = [];
  if (f.from) conds.push(sql`e.entry_date >= ${f.from}`);
  if (f.to) conds.push(sql`e.entry_date <= ${f.to}`);
  if (f.before) conds.push(sql`e.entry_date < ${f.before}`);
  if (f.accountPrefix) conds.push(sql`l.account_code LIKE ${`${f.accountPrefix}%`}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await rows(exec, sql`SELECT e.id, e.year, e.number, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date, e.journal, e.origin, e.description AS entry_description,
      l.line_no, l.account_code, l.debit_cents, l.credit_cents, l.description, l.tax_rate_bp, l.tax_base_cents
    FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id ${where}
    ORDER BY e.entry_date, e.year, e.number, l.line_no`);
  return r.map((x) => ({
    ...lineOf(x),
    entryId: num(x.id),
    year: num(x.year),
    number: num(x.number),
    date: day(x.entry_date),
    journalCode: String(x.journal) as PostedLine["journalCode"],
    origin: "manual",
    entryDescription: String(x.entry_description),
  }));
}

/** Comprobación de integridad: asientos cuyas líneas no cuadran (debe ser siempre cero). */
export async function unbalancedEntries(exec: Exec): Promise<number[]> {
  const r = await rows(exec, sql`SELECT entry_id FROM acc_entry_lines GROUP BY entry_id HAVING SUM(debit_cents) <> SUM(credit_cents) LIMIT 20`);
  return r.map((x) => num(x.entry_id));
}

export async function counts(exec: Exec): Promise<{ entries: number; automatic: number; manual: number; reversals: number }> {
  const [r] = await rows(exec, sql`SELECT COUNT(*) AS n, SUM(origin = 'manual') AS manual, SUM(origin = 'reversal') AS rev FROM acc_entries`);
  const entries = num(r?.n);
  const manual = num(r?.manual);
  const reversals = num(r?.rev);
  return { entries, manual, reversals, automatic: entries - manual - reversals };
}

/** Sumas del debe y del haber por cuenta en un periodo (agregadas en la BD: sumas y saldos, resultados, resumen). */
export async function accountTotals(exec: Exec, f: { from?: string | null; to?: string | null }): Promise<Array<{ accountCode: string; debitCents: number; creditCents: number }>> {
  const conds: SQL[] = [];
  if (f.from) conds.push(sql`e.entry_date >= ${f.from}`);
  if (f.to) conds.push(sql`e.entry_date <= ${f.to}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await rows(exec, sql`SELECT l.account_code, SUM(l.debit_cents) AS d, SUM(l.credit_cents) AS c
    FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id ${where} GROUP BY l.account_code ORDER BY l.account_code`);
  return r.map((x) => ({ accountCode: String(x.account_code), debitCents: num(x.d), creditCents: num(x.c) }));
}
