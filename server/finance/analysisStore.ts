/**
 * Almacén de la fase 4 (CRM 0038). Lectura AGREGADA de las fases 1–3 y escritura solo de la revisión diaria y de la
 * marca de coste directo de las categorías. Garantías:
 *  - las agregaciones del libro se hacen en la BD (GROUP BY por mes, cuenta y dimensiones): nunca se cargan todas las
 *    líneas en memoria; solo se leen asientos contabilizados;
 *  - una revisión por día (`review_day` único): dos revisiones simultáneas dejan una sola fila; la nota se edita con
 *    una escritura condicional sobre la nota anterior y cada edición queda en la bitácora (solo inserción).
 * La versión en memoria lee las listas públicas de los almacenes en memoria de las fases 1–2 (pruebas).
 */
import type mysql from "mysql2/promise";
import type { MemoryFinanceOpsStore } from "./opsStore";
import type { MemoryFinanceStore } from "./store";
import type { MemoryFinanceStripeStore } from "./stripeStore";
import { madridDateKey, madridEndOfDayUtc, madridStartOfDayUtc } from "../utils/timezone";
import type { DailyReview, DailyReviewLog, DueBuckets, LedgerFact, LedgerFactQuery, NewDailyReview, PayableDoc, PaymentEventMonth, PendingMovementAges, StripeMonthFact, TransferMonthFact, TreasuryFact } from "./analysisTypes";
import { addDays, daysBetween } from "./opsRules";
import { FinanceError, type EntryOrigin } from "./types";

/** Orígenes que no son flujo ni actividad del periodo (cierre y apertura se anulan entre sí). */
export const NON_FLOW_ORIGINS: EntryOrigin[] = ["regularization", "closing", "opening"];
export const MAX_PAYABLE_DOCS = 5_000;

export interface FinanceAnalysisStore {
  ledgerFacts(q: LedgerFactQuery): Promise<LedgerFact[]>;
  /** Líneas de tesorería (57…) por mes y cuenta, sin regularización, cierre, apertura ni diario APE. */
  treasuryFacts(from: string, to: string): Promise<TreasuryFact[]>;
  /** Transacciones de Stripe en euros por mes de cobro y tipo (CRM 0036). */
  stripeMonthly(from: string, to: string): Promise<StripeMonthFact[]>;
  /** Cobros de facturas por transferencia conciliados, por mes del banco (CRM 0035). */
  transfersMonthly(from: string, to: string): Promise<TransferMonthFact[]>;
  /** Gastos registrados con pendiente a una fecha (pagos vigentes hasta esa fecha). */
  payableDocs(asOf: string): Promise<PayableDoc[]>;
  /** Pagos pendientes vencidos, que vencen hoy y en los 7 días siguientes (estado actual). */
  dueBuckets(day: string): Promise<DueBuckets>;
  /** Movimientos bancarios sin conciliar hasta un día, con su antigüedad. */
  pendingMovements(day: string): Promise<PendingMovementAges>;
  /** Gastos registrados en un intervalo de marcas de tiempo (control diario). */
  expensesRegistered(fromMs: number, toMs: number): Promise<{ count: number; totalCents: number }>;
  categoryFlags(): Promise<Map<number, boolean | null>>;
  /** Fija la marca (null = según cuenta); false si la categoría no existe. */
  setCategoryFlag(id: number, value: boolean | null): Promise<boolean>;
  supplierNames(ids: number[]): Promise<Map<number, string>>;

  getReview(day: string): Promise<DailyReview | null>;
  reviewLog(reviewId: number): Promise<DailyReviewLog[]>;
  listReviews(q: { from?: string; to?: string; limit: number; offset: number }): Promise<{ items: DailyReview[]; total: number }>;
  /** Alta de la revisión de un día; si ya existía (también en carrera), la devuelve con `created: false`. */
  insertReview(r: NewDailyReview): Promise<{ review: DailyReview; created: boolean }>;
  /** Cambia la nota si sigue siendo `before` y deja su fila en la bitácora; false si otra edición se adelantó. */
  editReviewNote(id: number, before: string | null, after: string | null, o: { by: string; at: number; requestId: string | null }): Promise<boolean>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ym = (d: string) => d.slice(0, 7);
const matchesPrefixes = (code: string, prefixes?: string[]) => !prefixes?.length || prefixes.some((p) => code.startsWith(p));

// ── Memoria ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class MemoryFinanceAnalysisStore implements FinanceAnalysisStore {
  flags = new Map<number, boolean | null>();
  reviews: DailyReview[] = [];
  logs: Array<DailyReviewLog & { reviewId: number }> = [];
  constructor(private readonly src: { ledger: MemoryFinanceStore; ops: MemoryFinanceOpsStore; stripe?: MemoryFinanceStripeStore | null }) {}
  private c = <T>(x: T): T => structuredClone(x);

  async ledgerFacts(q: LedgerFactQuery) {
    const out = new Map<string, LedgerFact>();
    for (const e of this.src.ledger.entries) {
      if (e.status !== "posted" || e.number === null) continue;
      if ((q.from && e.date < q.from) || (q.to && e.date > q.to) || q.excludeOrigins?.includes(e.origin) || q.excludeJournals?.includes(e.journalCode) || (q.onlyJournals && !q.onlyJournals.includes(e.journalCode))) continue;
      if (q.withTreasury && !e.lines.some((l) => l.accountCode.startsWith("57"))) continue;
      const expense = this.src.ops.expenses.find((x) => x.entryId !== null && x.entryId === (e.reversesEntryId ?? e.id));
      for (const l of e.lines) {
        if (!matchesPrefixes(l.accountCode, q.accountPrefixes) || (q.excludeAccountPrefixes?.length && matchesPrefixes(l.accountCode, q.excludeAccountPrefixes))) continue;
        if (q.costCenterId !== undefined && l.costCenterId !== q.costCenterId) continue;
        const f: LedgerFact = { month: ym(e.date), accountCode: l.accountCode, origin: e.origin, costCenterId: l.costCenterId, supplierId: l.supplierId ?? expense?.supplierId ?? null, categoryId: expense?.categoryId ?? null, debitCents: 0, creditCents: 0 };
        const k = [f.month, f.accountCode, f.origin, f.costCenterId, f.supplierId, f.categoryId].join("|");
        const cur = out.get(k) ?? f;
        cur.debitCents += l.debitCents;
        cur.creditCents += l.creditCents;
        out.set(k, cur);
      }
    }
    return Array.from(out.values());
  }

  async treasuryFacts(from: string, to: string) {
    const out = new Map<string, TreasuryFact>();
    for (const e of this.src.ledger.entries) {
      if (e.status !== "posted" || e.number === null || e.date < from || e.date > to || NON_FLOW_ORIGINS.includes(e.origin) || e.journalCode === "APE") continue;
      const internal = e.lines.every((l) => l.accountCode.startsWith("57"));
      for (const l of e.lines.filter((x) => x.accountCode.startsWith("57"))) {
        const k = [ym(e.date), l.accountCode, internal].join("|");
        const cur = out.get(k) ?? { month: ym(e.date), accountCode: l.accountCode, internal, debitCents: 0, creditCents: 0 };
        cur.debitCents += l.debitCents;
        cur.creditCents += l.creditCents;
        out.set(k, cur);
      }
    }
    return Array.from(out.values());
  }

  async stripeMonthly(from: string, to: string) {
    const out = new Map<string, StripeMonthFact>();
    for (const t of this.src.stripe?.txns ?? []) {
      if (t.currency !== "EUR" || t.createdOn < from || t.createdOn > to) continue;
      const noInvoice = t.type === "charge" && t.ownInvoiceId === null;
      const k = [ym(t.createdOn), t.type, noInvoice].join("|");
      const cur = out.get(k) ?? { month: ym(t.createdOn), type: t.type, noInvoice, count: 0, grossCents: 0, feeCents: 0, netCents: 0 };
      cur.count++;
      cur.grossCents += t.grossCents;
      cur.feeCents += t.feeCents;
      cur.netCents += t.netCents;
      out.set(k, cur);
    }
    return Array.from(out.values());
  }

  async transfersMonthly(from: string, to: string) {
    const out = new Map<string, TransferMonthFact>();
    for (const m of this.src.ops.movements) {
      if (m.status !== "matched" || m.matchType !== "invoice_payment" || m.bookingDate < from || m.bookingDate > to) continue;
      const cur = out.get(ym(m.bookingDate)) ?? { month: ym(m.bookingDate), count: 0, amountCents: 0 };
      cur.count++;
      cur.amountCents += m.amountCents;
      out.set(cur.month, cur);
    }
    return Array.from(out.values());
  }

  async payableDocs(asOf: string) {
    const out: PayableDoc[] = [];
    for (const x of this.src.ops.expenses) {
      if (x.status !== "registered" || x.invoiceDate > asOf) continue;
      const paid = sum(this.src.ops.payments.filter((p) => p.expenseId === x.id && p.status === "posted" && p.paidOn <= asOf).map((p) => p.amountCents));
      const pending = x.totalCents - x.withholdingCents - paid;
      if (pending === 0) continue;
      out.push({ id: x.id, supplierId: x.supplierId, supplierName: this.src.ops.suppliers.find((s) => s.id === x.supplierId)?.name ?? null, invoiceNumber: x.invoiceNumber, invoiceDate: x.invoiceDate, dueDate: x.dueDate, totalCents: x.totalCents, pendingCents: pending });
    }
    return out.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id - b.id).slice(0, MAX_PAYABLE_DOCS);
  }

  async dueBuckets(day: string) {
    const b: DueBuckets = { overdue: { count: 0, amountCents: 0 }, today: { count: 0, amountCents: 0 }, next7: { count: 0, amountCents: 0 } };
    const last = addDays(day, 7);
    for (const x of this.src.ops.expenses) {
      if (x.status !== "registered" || x.paymentStatus === "paid" || !x.dueDate) continue;
      const k = x.dueDate < day ? "overdue" : x.dueDate === day ? "today" : x.dueDate <= last ? "next7" : null;
      if (!k) continue;
      b[k].count++;
      b[k].amountCents += x.totalCents - x.withholdingCents - x.paidCents;
    }
    return b;
  }

  async pendingMovements(day: string) {
    const list = this.src.ops.movements.filter((m) => m.status === "pending" && m.bookingDate <= day);
    const ages = list.map((m) => daysBetween(m.bookingDate, day));
    return {
      count: list.length,
      amountCents: sum(list.map((m) => Math.abs(m.amountCents))),
      oldestDate: list.map((m) => m.bookingDate).sort()[0] ?? null,
      buckets: { d0_7: ages.filter((a) => a <= 7).length, d8_30: ages.filter((a) => a > 7 && a <= 30).length, d30_plus: ages.filter((a) => a > 30).length },
    };
  }

  async expensesRegistered(fromMs: number, toMs: number) {
    const list = this.src.ops.expenses.filter((x) => x.registeredAt !== null && x.registeredAt >= fromMs && x.registeredAt <= toMs);
    return { count: list.length, totalCents: sum(list.map((x) => x.totalCents)) };
  }

  async categoryFlags() {
    return new Map(this.src.ops.categories.map((c) => [c.id, this.flags.get(c.id) ?? null]));
  }
  async setCategoryFlag(id: number, value: boolean | null) {
    if (!this.src.ops.categories.some((c) => c.id === id)) return false;
    this.flags.set(id, value);
    return true;
  }
  async supplierNames(ids: number[]) {
    return new Map(this.src.ops.suppliers.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.name]));
  }

  async getReview(day: string) {
    return this.c(this.reviews.find((r) => r.day === day) ?? null);
  }
  async reviewLog(reviewId: number) {
    return this.c(this.logs.filter((l) => l.reviewId === reviewId).map(({ reviewId: _r, ...l }) => l));
  }
  async listReviews(q: { from?: string; to?: string; limit: number; offset: number }) {
    const all = this.reviews.filter((r) => (!q.from || r.day >= q.from) && (!q.to || r.day <= q.to)).sort((a, b) => b.day.localeCompare(a.day));
    return { items: this.c(all.slice(q.offset, q.offset + q.limit)), total: all.length };
  }
  async insertReview(r: NewDailyReview) {
    const cur = this.reviews.find((x) => x.day === r.day);
    if (cur) return { review: this.c(cur), created: false };
    const review: DailyReview = { id: this.reviews.length + 1, day: r.day, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, note: r.note, snapshot: this.c(r.snapshot), noteEditedBy: null, noteEditedAt: null, requestId: r.requestId };
    this.reviews.push(review);
    this.logs.push({ id: this.logs.length + 1, reviewId: review.id, at: r.reviewedAt, actor: r.reviewedBy, requestId: r.requestId, action: "review", noteBefore: null, noteAfter: r.note });
    return { review: this.c(review), created: true };
  }
  async editReviewNote(id: number, before: string | null, after: string | null, o: { by: string; at: number; requestId: string | null }) {
    const r = this.reviews.find((x) => x.id === id);
    if (!r || r.note !== before) return false;
    Object.assign(r, { note: after, noteEditedBy: o.by, noteEditedAt: o.at });
    this.logs.push({ id: this.logs.length + 1, reviewId: id, at: o.at, actor: o.by, requestId: o.requestId, action: "note", noteBefore: before, noteAfter: after });
    return true;
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const prefixClause = (col: string, prefixes: string[], negate = false) => ({ sql: `${negate ? "NOT " : ""}(${prefixes.map(() => `${col} LIKE ?`).join(" OR ")})`, args: prefixes.map((p) => `${p.replace(/[\\%_]/g, (m) => `\\${m}`)}%`) });
const parseJson = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  try {
    return typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const REVIEW_COLS = "id, DATE_FORMAT(review_day, '%Y-%m-%d') AS day_key, reviewed_by, reviewed_at, note, snapshot_json, note_edited_by, note_edited_at, request_id";
const reviewRow = (r: Row): DailyReview => ({ id: num(r.id), day: String(r.day_key), reviewedBy: String(r.reviewed_by), reviewedAt: num(r.reviewed_at), note: strOrNull(r.note), snapshot: parseJson(r.snapshot_json), noteEditedBy: strOrNull(r.note_edited_by), noteEditedAt: numOrNull(r.note_edited_at), requestId: strOrNull(r.request_id) });

export class MysqlFinanceAnalysisStore implements FinanceAnalysisStore {
  constructor(private pool: mysql.Pool) {}

  async ledgerFacts(q: LedgerFactQuery) {
    const w = ["e.status = 'posted'"];
    const a: unknown[] = [];
    if (q.from) (w.push("e.entry_date >= ?"), a.push(q.from));
    if (q.to) (w.push("e.entry_date <= ?"), a.push(q.to));
    if (q.excludeOrigins?.length) (w.push("e.origin NOT IN (?)"), a.push(q.excludeOrigins));
    if (q.excludeJournals?.length) (w.push("e.journal_code NOT IN (?)"), a.push(q.excludeJournals));
    if (q.onlyJournals?.length) (w.push("e.journal_code IN (?)"), a.push(q.onlyJournals));
    else if (q.onlyJournals) w.push("1 = 0");
    if (q.accountPrefixes?.length) {
      const p = prefixClause("l.account_code", q.accountPrefixes);
      w.push(p.sql);
      a.push(...p.args);
    }
    if (q.excludeAccountPrefixes?.length) {
      const p = prefixClause("l.account_code", q.excludeAccountPrefixes, true);
      w.push(p.sql);
      a.push(...p.args);
    }
    if (q.costCenterId !== undefined) (w.push("l.cost_center_id = ?"), a.push(q.costCenterId));
    if (q.withTreasury) w.push("EXISTS (SELECT 1 FROM fin_entry_lines t WHERE t.entry_id = e.id AND t.account_code LIKE '57%')");
    // Agregado en la BD: una fila por mes, cuenta, origen, centro, proveedor y categoría (la del gasto cuyo asiento, o
    // cuya reversión, contiene la línea)
    const [rows] = await this.pool.query<Row[]>(
      `SELECT DATE_FORMAT(e.entry_date, '%Y-%m') AS ym, l.account_code AS acc, e.origin AS org, l.cost_center_id AS cc,
              COALESCE(l.supplier_id, x.supplier_id) AS sup, x.category_id AS cat,
              SUM(l.debit_cents) AS d, SUM(l.credit_cents) AS c
         FROM fin_entry_lines l
         JOIN fin_entries e ON e.id = l.entry_id
         LEFT JOIN fin_expenses x ON x.entry_id = COALESCE(e.reverses_entry_id, e.id)
        WHERE ${w.join(" AND ")}
        GROUP BY ym, acc, org, cc, sup, cat`,
      a,
    );
    return rows.map((r) => ({ month: String(r.ym), accountCode: String(r.acc), origin: r.org as EntryOrigin, costCenterId: numOrNull(r.cc), supplierId: numOrNull(r.sup), categoryId: numOrNull(r.cat), debitCents: num(r.d), creditCents: num(r.c) }));
  }

  async treasuryFacts(from: string, to: string) {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT DATE_FORMAT(e.entry_date, '%Y-%m') AS ym, l.account_code AS acc,
              NOT EXISTS (SELECT 1 FROM fin_entry_lines o WHERE o.entry_id = e.id AND o.account_code NOT LIKE '57%') AS internal_flag,
              SUM(l.debit_cents) AS d, SUM(l.credit_cents) AS c
         FROM fin_entry_lines l
         JOIN fin_entries e ON e.id = l.entry_id
        WHERE e.status = 'posted' AND e.entry_date >= ? AND e.entry_date <= ? AND e.origin NOT IN (?) AND e.journal_code <> 'APE' AND l.account_code LIKE '57%'
        GROUP BY ym, acc, internal_flag`,
      [from, to, NON_FLOW_ORIGINS],
    );
    return rows.map((r) => ({ month: String(r.ym), accountCode: String(r.acc), internal: num(r.internal_flag) === 1, debitCents: num(r.d), creditCents: num(r.c) }));
  }

  async stripeMonthly(from: string, to: string) {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT DATE_FORMAT(created_on, '%Y-%m') AS ym, type AS t, (type = 'charge' AND own_invoice_id IS NULL) AS no_inv,
              COUNT(*) AS n, SUM(gross_cents) AS g, SUM(fee_cents) AS f, SUM(net_cents) AS nt
         FROM fin_stripe_transactions
        WHERE currency = 'EUR' AND created_on >= ? AND created_on <= ?
        GROUP BY ym, t, no_inv`,
      [from, to],
    );
    return rows.map((r) => ({ month: String(r.ym), type: String(r.t), noInvoice: num(r.no_inv) === 1, count: num(r.n), grossCents: num(r.g), feeCents: num(r.f), netCents: num(r.nt) }));
  }

  async transfersMonthly(from: string, to: string) {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT DATE_FORMAT(booking_date, '%Y-%m') AS ym, COUNT(*) AS n, SUM(amount_cents) AS amt
         FROM fin_bank_movements
        WHERE status = 'matched' AND match_type = 'invoice_payment' AND booking_date >= ? AND booking_date <= ?
        GROUP BY ym`,
      [from, to],
    );
    return rows.map((r) => ({ month: String(r.ym), count: num(r.n), amountCents: num(r.amt) }));
  }

  async payableDocs(asOf: string) {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT x.id, x.supplier_id, s.name AS supplier_name, x.invoice_number, DATE_FORMAT(x.invoice_date, '%Y-%m-%d') AS inv_day,
              DATE_FORMAT(x.due_date, '%Y-%m-%d') AS due_day, x.total_cents,
              x.total_cents - x.withholding_cents - COALESCE(p.paid, 0) AS pending
         FROM fin_expenses x
         LEFT JOIN fin_suppliers s ON s.id = x.supplier_id
         LEFT JOIN (SELECT expense_id, SUM(amount_cents) AS paid FROM fin_expense_payments WHERE status = 'posted' AND paid_on <= ? GROUP BY expense_id) p ON p.expense_id = x.id
        WHERE x.status = 'registered' AND x.invoice_date <= ?
       HAVING pending <> 0
        ORDER BY x.invoice_date, x.id
        LIMIT ?`,
      [asOf, asOf, MAX_PAYABLE_DOCS],
    );
    return rows.map((r) => ({ id: num(r.id), supplierId: numOrNull(r.supplier_id), supplierName: strOrNull(r.supplier_name), invoiceNumber: strOrNull(r.invoice_number), invoiceDate: String(r.inv_day), dueDate: strOrNull(r.due_day), totalCents: num(r.total_cents), pendingCents: num(r.pending) }));
  }

  async dueBuckets(day: string) {
    const [[r]] = await this.pool.query<Row[]>(
      `SELECT COALESCE(SUM(due_date < ?), 0) AS n_over, COALESCE(SUM(CASE WHEN due_date < ? THEN pend END), 0) AS a_over,
              COALESCE(SUM(due_date = ?), 0) AS n_today, COALESCE(SUM(CASE WHEN due_date = ? THEN pend END), 0) AS a_today,
              COALESCE(SUM(due_date > ? AND due_date <= ?), 0) AS n_next, COALESCE(SUM(CASE WHEN due_date > ? AND due_date <= ? THEN pend END), 0) AS a_next
         FROM (SELECT due_date, total_cents - withholding_cents - paid_cents AS pend FROM fin_expenses
                WHERE status = 'registered' AND payment_status <> 'paid' AND due_date IS NOT NULL AND due_date <= ?) d`,
      [day, day, day, day, day, addDays(day, 7), day, addDays(day, 7), addDays(day, 7)],
    );
    return { overdue: { count: num(r.n_over), amountCents: num(r.a_over) }, today: { count: num(r.n_today), amountCents: num(r.a_today) }, next7: { count: num(r.n_next), amountCents: num(r.a_next) } };
  }

  async pendingMovements(day: string) {
    const [[r]] = await this.pool.query<Row[]>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ABS(amount_cents)), 0) AS amt, DATE_FORMAT(MIN(booking_date), '%Y-%m-%d') AS oldest,
              COALESCE(SUM(DATEDIFF(?, booking_date) <= 7), 0) AS b7,
              COALESCE(SUM(DATEDIFF(?, booking_date) > 7 AND DATEDIFF(?, booking_date) <= 30), 0) AS b30,
              COALESCE(SUM(DATEDIFF(?, booking_date) > 30), 0) AS bmore
         FROM fin_bank_movements WHERE status = 'pending' AND booking_date <= ?`,
      [day, day, day, day, day],
    );
    return { count: num(r.n), amountCents: num(r.amt), oldestDate: strOrNull(r.oldest), buckets: { d0_7: num(r.b7), d8_30: num(r.b30), d30_plus: num(r.bmore) } };
  }

  async expensesRegistered(fromMs: number, toMs: number) {
    const [[r]] = await this.pool.query<Row[]>("SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS t FROM fin_expenses WHERE registered_at >= ? AND registered_at <= ?", [fromMs, toMs]);
    return { count: num(r.n), totalCents: num(r.t) };
  }

  async categoryFlags() {
    const [rows] = await this.pool.query<Row[]>("SELECT id, is_direct_cost FROM fin_expense_categories");
    return new Map(rows.map((r) => [num(r.id), r.is_direct_cost === null || r.is_direct_cost === undefined ? null : num(r.is_direct_cost) === 1]));
  }
  async setCategoryFlag(id: number, value: boolean | null) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_expense_categories SET is_direct_cost = ? WHERE id = ?", [value === null ? null : value ? 1 : 0, id]);
    if (r.affectedRows) return true;
    const [rows] = await this.pool.query<Row[]>("SELECT id FROM fin_expense_categories WHERE id = ?", [id]);
    return rows.length > 0;
  }
  async supplierNames(ids: number[]) {
    if (!ids.length) return new Map<number, string>();
    const [rows] = await this.pool.query<Row[]>("SELECT id, name FROM fin_suppliers WHERE id IN (?)", [ids]);
    return new Map(rows.map((r) => [num(r.id), String(r.name)]));
  }

  async getReview(day: string) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${REVIEW_COLS} FROM fin_daily_reviews WHERE review_day = ?`, [day]);
    return rows[0] ? reviewRow(rows[0]) : null;
  }
  async reviewLog(reviewId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_daily_review_log WHERE review_id = ? ORDER BY id", [reviewId]);
    return rows.map((r) => ({ id: num(r.id), at: num(r.at), actor: String(r.actor), requestId: strOrNull(r.request_id), action: r.action as DailyReviewLog["action"], noteBefore: strOrNull(r.note_before), noteAfter: strOrNull(r.note_after) }));
  }
  async listReviews(q: { from?: string; to?: string; limit: number; offset: number }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.from) (w.push("review_day >= ?"), a.push(q.from));
    if (q.to) (w.push("review_day <= ?"), a.push(q.to));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_daily_reviews ${where}`, a);
    const [rows] = await this.pool.query<Row[]>(`SELECT ${REVIEW_COLS} FROM fin_daily_reviews ${where} ORDER BY review_day DESC LIMIT ? OFFSET ?`, [...a, q.limit, q.offset]);
    return { items: rows.map(reviewRow), total: num(count.n) };
  }
  async insertReview(r: NewDailyReview) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query<mysql.ResultSetHeader>("INSERT INTO fin_daily_reviews (review_day, reviewed_by, reviewed_at, note, snapshot_json, request_id) VALUES (?,?,?,?,?,?)", [r.day, r.reviewedBy, r.reviewedAt, r.note, JSON.stringify(r.snapshot), r.requestId?.slice(0, 100) ?? null]);
      await conn.query("INSERT INTO fin_daily_review_log (review_id, at, actor, request_id, action, note_before, note_after) VALUES (?,?,?,?, 'review', NULL, ?)", [res.insertId, r.reviewedAt, r.reviewedBy, r.requestId?.slice(0, 100) ?? null, r.note]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      const cur = await this.getReview(r.day);
      if (!cur) throw new FinanceError("conflict", "La revisión del día está en curso: inténtalo de nuevo");
      return { review: cur, created: false };
    } finally {
      conn.release();
    }
    return { review: (await this.getReview(r.day))!, created: true };
  }
  async editReviewNote(id: number, before: string | null, after: string | null, o: { by: string; at: number; requestId: string | null }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query<mysql.ResultSetHeader>("UPDATE fin_daily_reviews SET note = ?, note_edited_by = ?, note_edited_at = ? WHERE id = ? AND note <=> ?", [after, o.by, o.at, id, before]);
      if (!res.affectedRows) {
        await conn.rollback();
        return false;
      }
      await conn.query("INSERT INTO fin_daily_review_log (review_id, at, actor, request_id, action, note_before, note_after) VALUES (?,?,?,?, 'note', ?, ?)", [id, o.at, o.by, o.requestId?.slice(0, 100) ?? null, before, after]);
      await conn.commit();
      return true;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
}

/** Tipos del registro comercial que cuentan como intento de cobro (los avisos de impago, `order.dunning_notice`, no). */
export const PAYMENT_FAILED_TYPES = ["payment.failed", "renewal.failed"] as const;
export const PAYMENT_SUCCEEDED_TYPES = ["payment.succeeded", "renewal.paid"] as const;

/**
 * Eventos de cobro del registro comercial (`commercial_events`, CRM 0015) en SOLO LECTURA, del entorno comercial del
 * plano de control, agregados en la BD por hora (los meses de Madrid se forman con horas completas). null si la tabla no
 * se puede leer.
 */
export class MysqlPaymentEventSource {
  constructor(
    private pool: Pick<mysql.Pool, "query">,
    private environment: "test" | "live",
  ) {}
  async monthly(from: string, to: string) {
    const start = madridStartOfDayUtc(from).getTime();
    const end = madridEndOfDayUtc(to).getTime();
    try {
      const [rows] = await this.pool.query<Row[]>(
        "SELECT type AS t, FLOOR(occurred_at / 3600000) AS h, COUNT(*) AS n FROM commercial_events WHERE environment = ? AND type IN (?) AND occurred_at >= ? AND occurred_at <= ? GROUP BY t, h",
        [this.environment, [...PAYMENT_FAILED_TYPES, ...PAYMENT_SUCCEEDED_TYPES], start, end],
      );
      return paymentMonths(rows.map((r) => ({ type: String(r.t), at: num(r.h) * 3_600_000, count: num(r.n) })));
    } catch {
      return null;
    }
  }
}

/** Intentos fallidos y cobrados por mes de Madrid. */
export function paymentMonths(rows: Array<{ type: string; at: number; count: number }>): PaymentEventMonth[] {
  const out = new Map<string, PaymentEventMonth>();
  for (const r of rows) {
    const month = madridDateKey(new Date(r.at)).slice(0, 7);
    const cur = out.get(month) ?? { month, failed: 0, succeeded: 0 };
    if ((PAYMENT_FAILED_TYPES as readonly string[]).includes(r.type)) cur.failed += r.count;
    else if ((PAYMENT_SUCCEEDED_TYPES as readonly string[]).includes(r.type)) cur.succeeded += r.count;
    out.set(month, cur);
  }
  return Array.from(out.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/** ¿Existe la migración 0038 (análisis)? Tablas de la revisión diaria y columna de coste directo. */
export async function finAnalysisTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const sql of ["SELECT 1 FROM fin_daily_reviews LIMIT 0", "SELECT 1 FROM fin_daily_review_log LIMIT 0", "SELECT is_direct_cost FROM fin_expense_categories LIMIT 0"]) {
    const ok = await pool.query(sql).then(() => true, () => false);
    if (!ok) return false;
  }
  return true;
}
