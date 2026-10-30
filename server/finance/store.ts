/**
 * Almacén del libro contable (CRM 0033). Garantías:
 *  - un asiento por hecho económico: `source_key` única; insertar dos veces el mismo hecho devuelve el existente;
 *  - numeración correlativa por ejercicio, asignada al CONTABILIZAR en una transacción que bloquea la fila del
 *    ejercicio (`SELECT … FOR UPDATE`); los cierres y reaperturas de periodos bloquean la misma fila, así que nunca se
 *    contabiliza en un periodo que se está cerrando;
 *  - inmutabilidad: un asiento contabilizado no se edita; solo cambia su enlace `reversed_by_entry_id` al revertirlo.
 *    Los borradores se anulan (estado `void`). Nada se borra.
 */
import type mysql from "mysql2/promise";
import { monthOf, yearOf } from "./rules";
import {
  FinanceError,
  type Account,
  type AuditRow,
  type Entry,
  type EntryDraft,
  type EntryLine,
  type EntryOrigin,
  type EntryStatus,
  type FiscalYear,
  type Journal,
  type JournalCode,
  type OpenClosed,
  type Period,
  type PostedLine,
} from "./types";

export interface PostOptions {
  by: string;
  at: number;
  /** Solo para la regularización y el cierre: se contabilizan el 31/12 con los periodos ya cerrados. */
  allowClosedPeriod?: boolean;
}

export interface InsertOptions {
  createdBy: string;
  at: number;
  /** Contabilizar en la misma transacción (número y comprobación de periodo). */
  post?: PostOptions;
  /** Asiento al que revierte: debe estar contabilizado y sin revertir; queda enlazado. */
  reverses?: number;
}

export interface EntryQuery {
  from?: string;
  to?: string;
  journal?: JournalCode;
  origin?: EntryOrigin;
  /** Asientos con alguna línea en esta cuenta exacta. */
  account?: string;
  /** Asientos con alguna línea en una cuenta que empieza por este prefijo (cuentas de mayor y grupos). */
  accountPrefix?: string;
  status?: EntryStatus;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: "date" | "number" | "id";
  dir?: "asc" | "desc";
}

export interface PostedLineQuery {
  from?: string;
  to?: string;
  /** Solo líneas estrictamente anteriores a esta fecha (saldo anterior del mayor). */
  before?: string;
  /** Solo esta cuenta (exacta). */
  accountCode?: string;
  /** Cuentas que empiezan por este prefijo (cuentas de mayor y grupos). */
  accountPrefix?: string;
  excludeOrigins?: EntryOrigin[];
}

export interface FinanceStore {
  listAccounts(): Promise<Account[]>;
  insertAccount(a: Omit<Account, "id">): Promise<Account>;
  patchAccount(code: string, p: { name?: string; active?: boolean }): Promise<Account | null>;
  listJournals(): Promise<Journal[]>;
  listFiscalYears(): Promise<FiscalYear[]>;
  getFiscalYear(year: number): Promise<FiscalYear | null>;
  /** Crea el ejercicio con sus doce periodos abiertos; `conflict` si ya existe. */
  createFiscalYear(year: number, at: number, by: string): Promise<FiscalYear>;
  /** Cierra o reabre un periodo; `invalid_state` si el ejercicio está cerrado. */
  setPeriodStatus(year: number, month: number, status: OpenClosed, at: number, by: string): Promise<Period>;
  /** Cierra el ejercicio; `invalid_state` si queda algún periodo abierto. */
  closeFiscalYear(year: number, at: number, by: string): Promise<FiscalYear>;
  insertEntry(d: EntryDraft, lines: EntryLine[], o: InsertOptions): Promise<{ entry: Entry; created: boolean }>;
  postEntry(id: number, o: PostOptions): Promise<Entry>;
  voidEntry(id: number, o: { by: string; at: number; reason: string }): Promise<Entry>;
  getEntry(id: number): Promise<Entry | null>;
  bySource(sourceKey: string): Promise<Entry | null>;
  /** Cuáles de estas claves de origen ya tienen asiento. */
  existingSources(keys: string[]): Promise<Set<string>>;
  listEntries(q: EntryQuery): Promise<{ items: Entry[]; total: number }>;
  postedLines(q: PostedLineQuery): Promise<PostedLine[]>;
  addAudit(r: AuditRow): Promise<void>;
  lastAudit(action: string): Promise<(AuditRow & { id: number }) | null>;
}

export const MAX_PAGE = 200;

/** ¿Se puede contabilizar en esta fecha? (mismo criterio en memoria y en MySQL) */
export function postingProblem(fy: Pick<FiscalYear, "year" | "status" | "periods"> | null, date: string, allowClosedPeriod = false): FinanceError | null {
  const year = yearOf(date);
  if (!fy) return new FinanceError("invalid_state", `El ejercicio ${year} no está dado de alta`);
  if (fy.status !== "open") return new FinanceError("period_closed", `El ejercicio ${year} está cerrado`);
  const p = fy.periods.find((x) => x.month === monthOf(date));
  if (!p) return new FinanceError("invalid_state", `El periodo ${year}-${String(monthOf(date)).padStart(2, "0")} no existe`);
  if (p.status !== "open" && !allowClosedPeriod) return new FinanceError("period_closed", `El periodo ${year}-${String(p.month).padStart(2, "0")} está cerrado`);
  return null;
}

const notFound = () => new FinanceError("not_found", "Asiento no encontrado");

function matchesEntry(e: Entry, q: EntryQuery): boolean {
  if (q.from && e.date < q.from) return false;
  if (q.to && e.date > q.to) return false;
  if (q.journal && e.journalCode !== q.journal) return false;
  if (q.origin && e.origin !== q.origin) return false;
  if (q.status && e.status !== q.status) return false;
  if (q.account && !e.lines.some((l) => l.accountCode === q.account)) return false;
  if (q.accountPrefix && !e.lines.some((l) => l.accountCode.startsWith(q.accountPrefix!))) return false;
  if (q.q) {
    const t = q.q.toLowerCase();
    if (!(e.description.toLowerCase().includes(t) || e.sourceKey === q.q || String(e.number ?? "") === q.q)) return false;
  }
  return true;
}

function compareEntries(sort: EntryQuery["sort"], dir: EntryQuery["dir"]) {
  const k = dir === "asc" ? 1 : -1;
  return (a: Entry, b: Entry) => {
    const c = sort === "number" ? a.year - b.year || (a.number ?? 0) - (b.number ?? 0) : sort === "id" ? 0 : a.date.localeCompare(b.date);
    return k * (c || a.id - b.id);
  };
}

export class MemoryFinanceStore implements FinanceStore {
  accounts: Account[] = [];
  journals: Journal[] = [];
  years: FiscalYear[] = [];
  nextNumber = new Map<number, number>();
  entries: Entry[] = [];
  audit: Array<AuditRow & { id: number }> = [];
  constructor(seed?: { accounts?: Array<Omit<Account, "id">>; journals?: Journal[] }) {
    for (const a of seed?.accounts ?? []) this.accounts.push({ ...a, id: this.accounts.length + 1 });
    this.journals = [...(seed?.journals ?? [])];
  }
  private c = <T>(x: T): T => structuredClone(x);
  async listAccounts() {
    return this.c([...this.accounts].sort((a, b) => a.code.localeCompare(b.code)));
  }
  async insertAccount(a: Omit<Account, "id">) {
    if (this.accounts.some((x) => x.code === a.code)) throw new FinanceError("conflict", `La cuenta ${a.code} ya existe`);
    const row = { ...a, id: this.accounts.length + 1 };
    this.accounts.push(row);
    return this.c(row);
  }
  async patchAccount(code: string, p: { name?: string; active?: boolean }) {
    const a = this.accounts.find((x) => x.code === code);
    if (!a) return null;
    if (p.name !== undefined) a.name = p.name;
    if (p.active !== undefined) a.active = p.active;
    return this.c(a);
  }
  async listJournals() {
    return this.c(this.journals);
  }
  async listFiscalYears() {
    return this.c([...this.years].sort((a, b) => b.year - a.year));
  }
  async getFiscalYear(year: number) {
    const y = this.years.find((x) => x.year === year);
    return y ? this.c(y) : null;
  }
  async createFiscalYear(year: number, at: number, by: string) {
    if (this.years.some((x) => x.year === year)) throw new FinanceError("conflict", `El ejercicio ${year} ya existe`);
    const fy: FiscalYear = { year, status: "open", createdAt: at, createdBy: by, closedAt: null, closedBy: null, periods: Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, status: "open" as const, closedAt: null, closedBy: null })) };
    this.years.push(fy);
    this.nextNumber.set(year, 1);
    return this.c(fy);
  }
  async setPeriodStatus(year: number, month: number, status: OpenClosed, at: number, by: string) {
    const fy = this.years.find((x) => x.year === year);
    const p = fy?.periods.find((x) => x.month === month);
    if (!fy || !p) throw new FinanceError("not_found", "Periodo no encontrado");
    if (fy.status !== "open") throw new FinanceError("invalid_state", `El ejercicio ${year} está cerrado: sus periodos no se reabren`);
    Object.assign(p, status === "closed" ? { status, closedAt: at, closedBy: by } : { status, closedAt: null, closedBy: null });
    return this.c(p);
  }
  async closeFiscalYear(year: number, at: number, by: string) {
    const fy = this.years.find((x) => x.year === year);
    if (!fy) throw new FinanceError("not_found", "Ejercicio no encontrado");
    if (fy.periods.some((p) => p.status !== "closed")) throw new FinanceError("invalid_state", "Antes de cerrar el ejercicio hay que cerrar sus doce periodos");
    if (fy.status === "open") Object.assign(fy, { status: "closed", closedAt: at, closedBy: by });
    return this.c(fy);
  }
  private assignNumber(e: Entry, o: PostOptions) {
    const fy = this.years.find((x) => x.year === e.year) ?? null;
    const problem = postingProblem(fy, e.date, o.allowClosedPeriod);
    if (problem) throw problem;
    const n = this.nextNumber.get(e.year) ?? 1;
    this.nextNumber.set(e.year, n + 1);
    Object.assign(e, { status: "posted", number: n, postedBy: o.by, postedAt: o.at });
  }
  async insertEntry(d: EntryDraft, lines: EntryLine[], o: InsertOptions) {
    const dup = d.sourceKey ? this.entries.find((x) => x.sourceKey === d.sourceKey) : undefined;
    if (dup) return { entry: this.c(dup), created: false };
    const year = yearOf(d.date);
    if (!this.years.some((x) => x.year === year)) throw new FinanceError("invalid_state", `El ejercicio ${year} no está dado de alta`);
    const original = o.reverses !== undefined ? this.entries.find((x) => x.id === o.reverses) : undefined;
    if (o.reverses !== undefined) {
      if (!original) throw notFound();
      if (original.status !== "posted" || original.reversedByEntryId !== null) throw new FinanceError("invalid_state", "Solo se revierte un asiento contabilizado y sin revertir");
    }
    const e: Entry = { id: this.entries.length + 1, year, number: null, journalCode: d.journalCode, date: d.date, description: d.description, origin: d.origin, sourceKey: d.sourceKey, status: "draft", reversesEntryId: o.reverses ?? null, reversedByEntryId: null, createdBy: o.createdBy, createdAt: o.at, postedBy: null, postedAt: null, voidedBy: null, voidedAt: null, voidReason: null, lines: this.c(lines) };
    if (o.post) this.assignNumber(e, o.post);
    this.entries.push(e);
    if (original) original.reversedByEntryId = e.id;
    return { entry: this.c(e), created: true };
  }
  async postEntry(id: number, o: PostOptions) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw notFound();
    if (e.status !== "draft") throw new FinanceError("invalid_state", e.status === "posted" ? "El asiento ya está contabilizado" : "El asiento está anulado");
    this.assignNumber(e, o);
    return this.c(e);
  }
  async voidEntry(id: number, o: { by: string; at: number; reason: string }) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw notFound();
    if (e.status !== "draft") throw new FinanceError("invalid_state", e.status === "posted" ? "Un asiento contabilizado no se anula: se revierte" : "El asiento ya está anulado");
    Object.assign(e, { status: "void", voidedBy: o.by, voidedAt: o.at, voidReason: o.reason });
    return this.c(e);
  }
  async getEntry(id: number) {
    const e = this.entries.find((x) => x.id === id);
    return e ? this.c(e) : null;
  }
  async bySource(sourceKey: string) {
    const e = this.entries.find((x) => x.sourceKey === sourceKey);
    return e ? this.c(e) : null;
  }
  async existingSources(keys: string[]) {
    const set = new Set(keys);
    return new Set(this.entries.filter((e) => e.sourceKey && set.has(e.sourceKey)).map((e) => e.sourceKey!));
  }
  async listEntries(q: EntryQuery) {
    const all = this.entries.filter((e) => matchesEntry(e, q)).sort(compareEntries(q.sort, q.dir));
    const off = q.offset ?? 0;
    return { items: this.c(all.slice(off, off + Math.min(q.limit ?? 50, MAX_PAGE))), total: all.length };
  }
  async postedLines(q: PostedLineQuery) {
    const out: PostedLine[] = [];
    for (const e of this.entries) {
      if (e.status !== "posted" || e.number === null) continue;
      if ((q.from && e.date < q.from) || (q.to && e.date > q.to) || (q.before && e.date >= q.before) || q.excludeOrigins?.includes(e.origin)) continue;
      for (const l of e.lines) if ((!q.accountPrefix || l.accountCode.startsWith(q.accountPrefix)) && (!q.accountCode || l.accountCode === q.accountCode)) out.push({ ...l, entryId: e.id, year: e.year, number: e.number, date: e.date, journalCode: e.journalCode, origin: e.origin, entryDescription: e.description });
    }
    return this.c(out);
  }
  async addAudit(r: AuditRow) {
    this.audit.push({ ...this.c(r), id: this.audit.length + 1 });
  }
  async lastAudit(action: string) {
    const r = [...this.audit].reverse().find((x) => x.action === action);
    return r ? this.c(r) : null;
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
type Conn = mysql.PoolConnection;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));

const accountRow = (r: Row): Account => ({ id: Number(r.id), code: String(r.code), name: String(r.name), type: r.type as Account["type"], parentCode: strOrNull(r.parent_code), isPostable: Number(r.is_postable) === 1, active: Number(r.active) === 1, createdAt: Number(r.created_at) });
const periodRow = (r: Row): Period => ({ year: Number(r.year), month: Number(r.month), status: r.status as OpenClosed, closedAt: numOrNull(r.closed_at), closedBy: strOrNull(r.closed_by) });
const lineRow = (r: Row): EntryLine => ({
  lineNo: Number(r.line_no),
  accountCode: String(r.account_code),
  debitCents: Number(r.debit_cents),
  creditCents: Number(r.credit_cents),
  description: strOrNull(r.description),
  costCenterId: numOrNull(r.cost_center_id),
  supplierId: numOrNull(r.supplier_id),
  companyId: numOrNull(r.company_id),
  taxRateBp: numOrNull(r.tax_rate_bp),
  taxBaseCents: numOrNull(r.tax_base_cents),
});
const entryRow = (r: Row, lines: EntryLine[]): Entry => ({
  id: Number(r.id),
  year: Number(r.year),
  number: numOrNull(r.number),
  journalCode: r.journal_code as JournalCode,
  date: String(r.entry_day),
  description: String(r.description),
  origin: r.origin as EntryOrigin,
  sourceKey: strOrNull(r.source_key),
  status: r.status as EntryStatus,
  reversesEntryId: numOrNull(r.reverses_entry_id),
  reversedByEntryId: numOrNull(r.reversed_by_entry_id),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  postedBy: strOrNull(r.posted_by),
  postedAt: numOrNull(r.posted_at),
  voidedBy: strOrNull(r.voided_by),
  voidedAt: numOrNull(r.voided_at),
  voidReason: strOrNull(r.void_reason),
  lines,
});
/** Fecha contable como texto: mysql2 convertiría DATE a un Date en la zona del proceso. */
const ENTRY_COLS = "e.*, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_day";
const SORT: Record<NonNullable<EntryQuery["sort"]>, (d: string) => string> = {
  date: (d) => `e.entry_date ${d}, e.id ${d}`,
  number: (d) => `e.year ${d}, e.number ${d}, e.id ${d}`,
  id: (d) => `e.id ${d}`,
};

export class MysqlFinanceStore implements FinanceStore {
  constructor(private pool: mysql.Pool) {}

  private async tx<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        const out = await fn(conn);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback().catch(() => undefined);
        if ((e as { code?: string }).code !== "ER_LOCK_DEADLOCK" || attempt >= 4) throw e;
      } finally {
        conn.release();
      }
    }
  }

  async listAccounts() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_accounts ORDER BY code");
    return rows.map(accountRow);
  }
  async insertAccount(a: Omit<Account, "id">) {
    try {
      await this.pool.query("INSERT INTO fin_accounts (code, name, type, parent_code, is_postable, active, created_at) VALUES (?,?,?,?,?,?,?)", [a.code, a.name, a.type, a.parentCode, a.isPostable ? 1 : 0, a.active ? 1 : 0, a.createdAt]);
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new FinanceError("conflict", `La cuenta ${a.code} ya existe`);
      throw e;
    }
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_accounts WHERE code = ?", [a.code]);
    return accountRow(rows[0]);
  }
  async patchAccount(code: string, p: { name?: string; active?: boolean }) {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (p.name !== undefined) (sets.push("name = ?"), args.push(p.name));
    if (p.active !== undefined) (sets.push("active = ?"), args.push(p.active ? 1 : 0));
    if (sets.length) await this.pool.query(`UPDATE fin_accounts SET ${sets.join(", ")} WHERE code = ?`, [...args, code]);
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_accounts WHERE code = ?", [code]);
    return rows[0] ? accountRow(rows[0]) : null;
  }
  async listJournals() {
    const [rows] = await this.pool.query<Row[]>("SELECT code, name FROM fin_journals ORDER BY FIELD(code, 'GEN','VEN','COM','BAN','CAJ','STR','NOM','IMP','APE','REG','CIE'), code");
    return rows.map((r) => ({ code: r.code as JournalCode, name: String(r.name) }));
  }

  private async years(where: string, args: unknown[], q: Pick<mysql.Pool, "query"> = this.pool): Promise<FiscalYear[]> {
    const [ys] = await q.query<Row[]>(`SELECT * FROM fin_fiscal_years ${where} ORDER BY year DESC`, args);
    if (!ys.length) return [];
    const [ps] = await q.query<Row[]>("SELECT * FROM fin_periods WHERE year IN (?) ORDER BY year, month", [ys.map((y) => Number(y.year))]);
    return ys.map((y) => ({
      year: Number(y.year),
      status: y.status as OpenClosed,
      createdAt: Number(y.created_at),
      createdBy: String(y.created_by),
      closedAt: numOrNull(y.closed_at),
      closedBy: strOrNull(y.closed_by),
      periods: ps.filter((p) => Number(p.year) === Number(y.year)).map(periodRow),
    }));
  }
  async listFiscalYears() {
    return this.years("", []);
  }
  async getFiscalYear(year: number) {
    return (await this.years("WHERE year = ?", [year]))[0] ?? null;
  }
  async createFiscalYear(year: number, at: number, by: string) {
    try {
      await this.tx(async (c) => {
        await c.query("INSERT INTO fin_fiscal_years (year, status, next_entry_number, created_at, created_by) VALUES (?, 'open', 1, ?, ?)", [year, at, by]);
        await c.query("INSERT INTO fin_periods (year, month, status) VALUES ?", [Array.from({ length: 12 }, (_, i) => [year, i + 1, "open"])]);
      });
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new FinanceError("conflict", `El ejercicio ${year} ya existe`);
      throw e;
    }
    return (await this.getFiscalYear(year))!;
  }
  /** Bloquea la fila del ejercicio (serializa numeración, contabilizaciones y cierres del mismo ejercicio). */
  private async lockYear(c: Conn, year: number): Promise<FiscalYear | null> {
    const [ys] = await c.query<Row[]>("SELECT year FROM fin_fiscal_years WHERE year = ? FOR UPDATE", [year]);
    if (!ys.length) return null;
    return (await this.years("WHERE year = ?", [year], c))[0] ?? null;
  }
  async setPeriodStatus(year: number, month: number, status: OpenClosed, at: number, by: string) {
    return this.tx(async (c) => {
      const fy = await this.lockYear(c, year);
      if (!fy || !fy.periods.some((p) => p.month === month)) throw new FinanceError("not_found", "Periodo no encontrado");
      if (fy.status !== "open") throw new FinanceError("invalid_state", `El ejercicio ${year} está cerrado: sus periodos no se reabren`);
      await c.query("UPDATE fin_periods SET status = ?, closed_at = ?, closed_by = ? WHERE year = ? AND month = ?", status === "closed" ? [status, at, by, year, month] : [status, null, null, year, month]);
      const [ps] = await c.query<Row[]>("SELECT * FROM fin_periods WHERE year = ? AND month = ?", [year, month]);
      return periodRow(ps[0]);
    });
  }
  async closeFiscalYear(year: number, at: number, by: string) {
    await this.tx(async (c) => {
      const fy = await this.lockYear(c, year);
      if (!fy) throw new FinanceError("not_found", "Ejercicio no encontrado");
      if (fy.periods.some((p) => p.status !== "closed")) throw new FinanceError("invalid_state", "Antes de cerrar el ejercicio hay que cerrar sus doce periodos");
      if (fy.status === "open") await c.query("UPDATE fin_fiscal_years SET status = 'closed', closed_at = ?, closed_by = ? WHERE year = ? AND status = 'open'", [at, by, year]);
    });
    return (await this.getFiscalYear(year))!;
  }

  /** Número correlativo y estado contabilizado, con el ejercicio ya bloqueado por la transacción. */
  private async assignNumber(c: Conn, fy: FiscalYear | null, id: number, date: string, o: PostOptions) {
    const problem = postingProblem(fy, date, o.allowClosedPeriod);
    if (problem) throw problem;
    const [n] = await c.query<Row[]>("SELECT next_entry_number FROM fin_fiscal_years WHERE year = ?", [fy!.year]);
    const number = Number(n[0].next_entry_number);
    await c.query("UPDATE fin_fiscal_years SET next_entry_number = next_entry_number + 1 WHERE year = ?", [fy!.year]);
    const [r] = await c.query<mysql.ResultSetHeader>("UPDATE fin_entries SET status = 'posted', number = ?, posted_by = ?, posted_at = ? WHERE id = ? AND status = 'draft'", [number, o.by, o.at, id]);
    if (!r.affectedRows) throw new FinanceError("invalid_state", "El asiento ya no es un borrador");
  }

  async insertEntry(d: EntryDraft, lines: EntryLine[], o: InsertOptions) {
    if (d.sourceKey) {
      const cur = await this.bySource(d.sourceKey);
      if (cur) return { entry: cur, created: false };
    }
    const year = yearOf(d.date);
    let id: number;
    try {
      id = await this.tx(async (c) => {
        // Orden de bloqueo fijo: ejercicio → asiento revertido
        const fy = await this.lockYear(c, year);
        if (!fy) throw new FinanceError("invalid_state", `El ejercicio ${year} no está dado de alta`);
        if (o.reverses !== undefined) {
          const [orig] = await c.query<Row[]>("SELECT status, reversed_by_entry_id FROM fin_entries WHERE id = ? FOR UPDATE", [o.reverses]);
          if (!orig[0]) throw notFound();
          if (orig[0].status !== "posted" || orig[0].reversed_by_entry_id !== null) throw new FinanceError("invalid_state", "Solo se revierte un asiento contabilizado y sin revertir");
        }
        const [r] = await c.query<mysql.ResultSetHeader>(
          "INSERT INTO fin_entries (year, number, journal_code, entry_date, description, origin, source_key, status, reverses_entry_id, created_by, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
          [year, d.journalCode, d.date, d.description, d.origin, d.sourceKey, o.reverses ?? null, o.createdBy, o.at],
        );
        const newId = r.insertId;
        await c.query(
          "INSERT INTO fin_entry_lines (entry_id, line_no, account_code, debit_cents, credit_cents, description, cost_center_id, supplier_id, company_id, tax_rate_bp, tax_base_cents) VALUES ?",
          [lines.map((l) => [newId, l.lineNo, l.accountCode, l.debitCents, l.creditCents, l.description, l.costCenterId, l.supplierId, l.companyId, l.taxRateBp, l.taxBaseCents])],
        );
        if (o.post) await this.assignNumber(c, fy, newId, d.date, o.post);
        if (o.reverses !== undefined) await c.query("UPDATE fin_entries SET reversed_by_entry_id = ? WHERE id = ? AND reversed_by_entry_id IS NULL", [newId, o.reverses]);
        return newId;
      });
    } catch (e) {
      // Carrera con otra petición del mismo hecho (clave duplicada, o el asiento ya revertido por la otra mientras esta
      // esperaba el bloqueo): gana la primera y esta devuelve su asiento
      const raced = (e as { code?: string }).code === "ER_DUP_ENTRY" || (e instanceof FinanceError && e.code === "invalid_state" && o.reverses !== undefined);
      if (raced && d.sourceKey) {
        const cur = await this.bySource(d.sourceKey);
        if (cur) return { entry: cur, created: false };
      }
      throw e;
    }
    return { entry: (await this.getEntry(id))!, created: true };
  }
  async postEntry(id: number, o: PostOptions) {
    const cur = await this.getEntry(id);
    if (!cur) throw notFound();
    if (cur.status !== "draft") throw new FinanceError("invalid_state", cur.status === "posted" ? "El asiento ya está contabilizado" : "El asiento está anulado");
    await this.tx(async (c) => {
      const fy = await this.lockYear(c, cur.year);
      await this.assignNumber(c, fy, id, cur.date, o);
    });
    return (await this.getEntry(id))!;
  }
  async voidEntry(id: number, o: { by: string; at: number; reason: string }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_entries SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ? AND status = 'draft'", [o.by, o.at, o.reason, id]);
    const e = await this.getEntry(id);
    if (!e) throw notFound();
    if (!r.affectedRows) throw new FinanceError("invalid_state", e.status === "posted" ? "Un asiento contabilizado no se anula: se revierte" : "El asiento ya está anulado");
    return e;
  }

  private async withLines(rows: Row[]): Promise<Entry[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => Number(r.id));
    const [ls] = await this.pool.query<Row[]>("SELECT * FROM fin_entry_lines WHERE entry_id IN (?) ORDER BY entry_id, line_no", [ids]);
    const by = new Map<number, EntryLine[]>();
    for (const l of ls) by.set(Number(l.entry_id), [...(by.get(Number(l.entry_id)) ?? []), lineRow(l)]);
    return rows.map((r) => entryRow(r, by.get(Number(r.id)) ?? []));
  }
  async getEntry(id: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${ENTRY_COLS} FROM fin_entries e WHERE e.id = ?`, [id]);
    return (await this.withLines(rows))[0] ?? null;
  }
  async bySource(sourceKey: string) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${ENTRY_COLS} FROM fin_entries e WHERE e.source_key = ?`, [sourceKey]);
    return (await this.withLines(rows))[0] ?? null;
  }
  async existingSources(keys: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const [rows] = await this.pool.query<Row[]>("SELECT source_key FROM fin_entries WHERE source_key IN (?)", [chunk]);
      for (const r of rows) out.add(String(r.source_key));
    }
    return out;
  }
  async listEntries(q: EntryQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.from) (w.push("e.entry_date >= ?"), a.push(q.from));
    if (q.to) (w.push("e.entry_date <= ?"), a.push(q.to));
    if (q.journal) (w.push("e.journal_code = ?"), a.push(q.journal));
    if (q.origin) (w.push("e.origin = ?"), a.push(q.origin));
    if (q.status) (w.push("e.status = ?"), a.push(q.status));
    if (q.account) (w.push("EXISTS (SELECT 1 FROM fin_entry_lines l WHERE l.entry_id = e.id AND l.account_code = ?)"), a.push(q.account));
    if (q.accountPrefix) (w.push("EXISTS (SELECT 1 FROM fin_entry_lines l WHERE l.entry_id = e.id AND l.account_code LIKE ?)"), a.push(`${q.accountPrefix}%`));
    if (q.q) (w.push("(e.description LIKE ? OR e.source_key = ? OR CAST(e.number AS CHAR) = ?)"), a.push(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, q.q, q.q));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_entries e ${where}`, a);
    const limit = Math.max(1, Math.min(q.limit ?? 50, MAX_PAGE));
    const offset = Math.max(0, q.offset ?? 0);
    const [rows] = await this.pool.query<Row[]>(`SELECT ${ENTRY_COLS} FROM fin_entries e ${where} ORDER BY ${SORT[q.sort ?? "date"](q.dir === "asc" ? "ASC" : "DESC")} LIMIT ? OFFSET ?`, [...a, limit, offset]);
    return { items: await this.withLines(rows), total: Number(count.n) };
  }
  async postedLines(q: PostedLineQuery) {
    const w = ["e.status = 'posted'"];
    const a: unknown[] = [];
    if (q.from) (w.push("e.entry_date >= ?"), a.push(q.from));
    if (q.to) (w.push("e.entry_date <= ?"), a.push(q.to));
    if (q.before) (w.push("e.entry_date < ?"), a.push(q.before));
    if (q.accountPrefix) (w.push("l.account_code LIKE ?"), a.push(`${q.accountPrefix}%`));
    if (q.accountCode) (w.push("l.account_code = ?"), a.push(q.accountCode));
    if (q.excludeOrigins?.length) (w.push("e.origin NOT IN (?)"), a.push(q.excludeOrigins));
    const [rows] = await this.pool.query<Row[]>(
      `SELECT l.*, e.year, e.number, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_day, e.journal_code, e.origin, e.description AS entry_description
       FROM fin_entry_lines l JOIN fin_entries e ON e.id = l.entry_id WHERE ${w.join(" AND ")} ORDER BY e.entry_date, e.year, e.number, l.line_no`,
      a,
    );
    return rows.map((r) => ({ ...lineRow(r), entryId: Number(r.entry_id), year: Number(r.year), number: Number(r.number), date: String(r.entry_day), journalCode: r.journal_code as JournalCode, origin: r.origin as EntryOrigin, entryDescription: String(r.entry_description) }));
  }
  async addAudit(r: AuditRow) {
    await this.pool.query("INSERT INTO fin_audit_log (at, actor, action, entity, entity_id, summary, request_id) VALUES (?,?,?,?,?,?,?)", [r.at, r.actor.slice(0, 100), r.action, r.entity, r.entityId, r.summary ? JSON.stringify(r.summary) : null, r.requestId?.slice(0, 64) ?? null]);
  }
  async lastAudit(action: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1", [action]);
    const r = rows[0];
    if (!r) return null;
    const summary = typeof r.summary === "string" ? (JSON.parse(r.summary) as Record<string, unknown>) : ((r.summary as Record<string, unknown> | null) ?? null);
    return { id: Number(r.id), at: Number(r.at), actor: String(r.actor), action: String(r.action), entity: String(r.entity), entityId: strOrNull(r.entity_id), summary, requestId: strOrNull(r.request_id) };
  }
}

/** ¿Existe la migración 0033 (libro contable)? */
export async function finTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["fin_accounts", "fin_fiscal_years", "fin_periods", "fin_journals", "fin_entries", "fin_entry_lines", "fin_audit_log"]) {
    const ok = await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false);
    if (!ok) return false;
  }
  return true;
}
