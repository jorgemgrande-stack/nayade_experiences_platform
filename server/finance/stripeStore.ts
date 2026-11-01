/**
 * Almacén de la fase 2 (Stripe, CRM 0036): memoria (pruebas) y MySQL. Garantías:
 *  - un fichero una sola vez por tipo de informe (sha256) y cada transacción de saldo y cada payout una sola vez
 *    (identificador de Stripe único por proveedor): reimportar no duplica nada;
 *  - transiciones condicionales: un payout se vincula a un movimiento bancario solo si no tenía otro
 *    (`… WHERE bank_movement_id IS NULL`), y un movimiento lo es de un único payout (índice único);
 *  - nada se borra: las transacciones cambian de estado y las incidencias se marcan como revisadas.
 */
import type mysql from "mysql2/promise";
import { FinanceError } from "./types";
import {
  DEFAULT_STRIPE_SETTINGS,
  type FeeVatTreatment,
  type StripeFeeVatRule,
  type ParsedPayout,
  type ParsedStripeTxn,
  type PayoutStatus,
  type StripeImport,
  type StripeImportKind,
  type StripeImportProblem,
  type StripeIssue,
  type StripePayout,
  type StripeSettings,
  type StripeTxn,
  type StripeTxnStatus,
  type StripeTxnType,
} from "./stripeTypes";

export const STRIPE_MAX_PAGE = 500;

export interface TxnQuery {
  type?: StripeTxnType;
  status?: StripeTxnStatus;
  from?: string;
  to?: string;
  /** Identificador de Stripe del payout (po_…) en el que se liquidó. */
  payout?: string;
  q?: string;
  /** Solo las que tienen una incidencia sin revisar. */
  openIssue?: boolean;
  limit?: number;
  offset?: number;
}

export interface PayoutQuery {
  status?: PayoutStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export type NewStripeImport = Pick<StripeImport, "kind" | "filename" | "sha256" | "rows" | "nonEur" | "errors" | "problems" | "importedBy" | "createdAt">;

export interface TxnMark {
  status: StripeTxnStatus;
  entryId?: number | null;
  ownInvoiceId?: number | null;
  issue?: StripeIssue | null;
  issueDetail?: string | null;
  postedAt?: number | null;
}

export interface TxnAggregate {
  type: StripeTxnType;
  count: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/** Estados en los que un payout sigue adelante (los demás no se contabilizan o se revierten). */
export const LIVE_PAYOUT_STATUSES: readonly PayoutStatus[] = ["paid", "pending", "in_transit"];

export interface FinanceStripeStore {
  getSettings(): Promise<StripeSettings>;
  saveSettings(s: Pick<StripeSettings, "stripeFeeVat" | "feeVatRateBp" | "stripePayoutBankAccountId" | "disputeAccountCode">, by: string, at: number): Promise<StripeSettings>;

  findImport(kind: StripeImportKind, sha256: string): Promise<StripeImport | null>;
  /**
   * Guarda el fichero y sus transacciones en una transacción; las ya conocidas cuentan como duplicadas. Las filas de
   * payout dan de alta su payout (origen `balance`) si aún no existía.
   */
  importTransactions(imp: NewStripeImport, rows: ParsedStripeTxn[], statusOf: (r: ParsedStripeTxn) => { status: StripeTxnStatus; issue: StripeIssue | null }): Promise<StripeImport>;
  /** Guarda el fichero y sus payouts: nuevos se insertan; conocidos refrescan su estado (y su llegada si no tienen asiento). */
  importPayouts(imp: NewStripeImport, rows: ParsedPayout[]): Promise<StripeImport>;
  listImports(limit: number): Promise<StripeImport[]>;

  listTransactions(q: TxnQuery): Promise<{ items: StripeTxn[]; total: number }>;
  getTransaction(id: number): Promise<StripeTxn | null>;
  /** Por contabilizar (pendientes o con error), en euros, con fecha hasta `until`; por fecha y orden de alta. */
  postableTransactions(until: string, limit: number): Promise<StripeTxn[]>;
  transactionsByCharge(chargeIds: string[]): Promise<StripeTxn[]>;
  transactionsByPayout(stripePayoutIds: string[]): Promise<StripeTxn[]>;
  transactionsByInvoice(ownInvoiceIds: number[]): Promise<StripeTxn[]>;
  /** Por factura de Stripe (`in_…`): para saber si un cobro confirmado por el webhook ya está importado y contabilizado. */
  transactionsByStripeInvoice(stripeInvoiceIds: string[]): Promise<StripeTxn[]>;
  markTransaction(id: number, m: TxnMark): Promise<void>;
  /** Marca revisada la incidencia (con nota); false si no la tenía o ya estaba revisada. */
  reviewIssue(id: number, by: string, at: number, note: string): Promise<boolean>;
  /** Sumas por tipo de las transacciones en euros con fecha de cobro en el rango. */
  aggregates(from: string, to: string): Promise<TxnAggregate[]>;
  /** Σ neto de todas las transacciones en euros (= saldo según los informes importados). */
  importedNetCents(): Promise<number>;
  /** Incidencias sin revisar y disputas sin revisar. */
  issueCounts(): Promise<{ open: number; disputes: number }>;

  listPayouts(q: PayoutQuery): Promise<{ items: StripePayout[]; total: number }>;
  getPayout(id: number): Promise<StripePayout | null>;
  payoutsByStripeIds(ids: string[]): Promise<StripePayout[]>;
  payoutByBankMovement(movementId: number): Promise<StripePayout | null>;
  /** Sin asiento, vigentes y con llegada hasta `until`. */
  postablePayouts(until: string): Promise<StripePayout[]>;
  /** Fallidos o cancelados: con asiento sin revertir (`posted`) o sin asiento (`unposted`). */
  failedPayouts(): Promise<StripePayout[]>;
  /** Vigentes sin movimiento bancario (para sugerencias). */
  openPayoutsForBank(limit: number): Promise<StripePayout[]>;
  setPayoutEntry(id: number, entryId: number): Promise<void>;
  setPayoutReversal(id: number, entryId: number): Promise<void>;
  /** Vincula si el payout no tenía movimiento; false si ya lo tenía (o el movimiento es de otro payout). */
  linkPayoutBank(id: number, movementId: number, by: string, at: number): Promise<boolean>;
  /** Desvincula si seguía vinculado a ese movimiento. */
  unlinkPayoutBank(id: number, movementId: number): Promise<boolean>;
  /** Payouts vigentes contabilizados sin movimiento bancario y Σ de los que llegan en el rango. */
  payoutStats(from: string, to: string): Promise<{ withoutBank: number; arrivedCents: number }>;

  // CRM 0039: reglas de IVA de las comisiones (sin edición: se anulan) y consultas sin escritura de la vista previa
  listFeeVatRules(): Promise<StripeFeeVatRule[]>;
  getFeeVatRule(id: number): Promise<StripeFeeVatRule | null>;
  insertFeeVatRule(r: NewFeeVatRule): Promise<StripeFeeVatRule>;
  /** Anula la regla si seguía vigente; false si ya estaba anulada. */
  voidFeeVatRule(id: number, o: { by: string; at: number; reason: string }): Promise<boolean>;
  /** Cuáles de estos identificadores de transacción ya están importados. */
  knownTransactionIds(ids: string[]): Promise<Set<string>>;
}

export type NewFeeVatRule = Omit<StripeFeeVatRule, "id" | "voidedBy" | "voidedAt" | "voidReason">;

const page = (limit: number | undefined, offset: number | undefined) => ({ limit: Math.max(1, Math.min(limit ?? 50, STRIPE_MAX_PAGE)), offset: Math.max(0, offset ?? 0) });
const dupConflict = (what: string) => new FinanceError("conflict", what);
const ALREADY = "Este fichero de Stripe ya se importó";
const isPayoutType = (t: StripeTxnType) => t === "payout" || t === "payout_reversal";

/** Alta de payout desde una fila de payout del informe de saldo (si trae su identificador). */
function payoutFromTxn(r: ParsedStripeTxn): ParsedPayout | null {
  if (r.type !== "payout" || !r.stripePayoutId || r.grossCents >= 0) return null;
  return { payoutId: r.stripePayoutId, createdOn: r.createdOn, arrivalOn: r.payoutArrivalOn ?? r.availableOn ?? r.createdOn, currency: r.currency, amountCents: -r.grossCents, feeCents: Math.abs(r.feeCents), status: "paid", description: r.description?.slice(0, 300) ?? null };
}

// ── Memoria ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class MemoryFinanceStripeStore implements FinanceStripeStore {
  settings: StripeSettings = { ...DEFAULT_STRIPE_SETTINGS };
  imports: StripeImport[] = [];
  txns: StripeTxn[] = [];
  payouts: StripePayout[] = [];
  private c = <T>(x: T): T => structuredClone(x);

  async getSettings() {
    return this.c(this.settings);
  }
  async saveSettings(s: Pick<StripeSettings, "stripeFeeVat" | "feeVatRateBp" | "stripePayoutBankAccountId" | "disputeAccountCode">, by: string, at: number) {
    this.settings = { ...s, updatedBy: by, updatedAt: at };
    return this.c(this.settings);
  }

  async findImport(kind: StripeImportKind, sha256: string) {
    return this.c(this.imports.find((x) => x.kind === kind && x.sha256 === sha256) ?? null);
  }
  private newImport(imp: NewStripeImport): StripeImport {
    if (this.imports.some((x) => x.kind === imp.kind && x.sha256 === imp.sha256)) throw dupConflict(ALREADY);
    return { ...imp, id: this.imports.length + 1, inserted: 0, duplicates: 0, refreshed: 0 };
  }
  private addPayout(p: ParsedPayout, importId: number | null, origin: StripePayout["origin"], at: number) {
    const row: StripePayout = { ...p, id: this.payouts.length + 1, provider: "stripe", importId, origin, entryId: null, reversalEntryId: null, bankMovementId: null, bankLinkedBy: null, bankLinkedAt: null, createdAt: at, updatedAt: at };
    this.payouts.push(row);
  }
  async importTransactions(imp: NewStripeImport, rows: ParsedStripeTxn[], statusOf: (r: ParsedStripeTxn) => { status: StripeTxnStatus; issue: StripeIssue | null }) {
    const row = this.newImport(imp);
    for (const r of rows) {
      if (this.txns.some((x) => x.balanceTransactionId === r.balanceTransactionId)) {
        row.duplicates++;
        continue;
      }
      const { payoutArrivalOn: _a, ...rest } = r;
      const st = statusOf(r);
      this.txns.push({ ...rest, id: this.txns.length + 1, provider: "stripe", importId: row.id, ownInvoiceId: null, status: st.status, issue: st.issue, issueDetail: null, issueReviewedBy: null, issueReviewedAt: null, issueNote: null, entryId: null, postedAt: null, createdAt: imp.createdAt });
      row.inserted++;
      const p = payoutFromTxn(r);
      if (p && !this.payouts.some((x) => x.payoutId === p.payoutId)) this.addPayout(p, row.id, "balance", imp.createdAt);
    }
    // Una reversión de payout en el saldo = el payout falló o se canceló
    for (const r of rows) if (r.type === "payout_reversal" && r.stripePayoutId) for (const x of this.payouts) if (x.payoutId === r.stripePayoutId && LIVE_PAYOUT_STATUSES.includes(x.status)) Object.assign(x, { status: "failed", updatedAt: imp.createdAt });
    this.imports.push(row);
    return this.c(row);
  }
  async importPayouts(imp: NewStripeImport, rows: ParsedPayout[]) {
    const row = this.newImport(imp);
    for (const p of rows) {
      const cur = this.payouts.find((x) => x.payoutId === p.payoutId);
      if (!cur) {
        this.addPayout(p, row.id, "report", imp.createdAt);
        row.inserted++;
        continue;
      }
      const arrival = cur.entryId === null ? p.arrivalOn : cur.arrivalOn;
      if (cur.status !== p.status || cur.arrivalOn !== arrival) {
        Object.assign(cur, { status: p.status, arrivalOn: arrival, updatedAt: imp.createdAt });
        row.refreshed++;
      } else row.duplicates++;
    }
    this.imports.push(row);
    return this.c(row);
  }
  async listImports(limit: number) {
    return this.c([...this.imports].sort((a, b) => b.id - a.id).slice(0, limit));
  }

  private filterTxns(q: TxnQuery) {
    const t = q.q?.toLowerCase();
    return this.txns
      .filter(
        (x) =>
          (!q.type || x.type === q.type) &&
          (!q.status || x.status === q.status) &&
          (!q.from || x.createdOn >= q.from) &&
          (!q.to || x.createdOn <= q.to) &&
          (!q.payout || x.stripePayoutId === q.payout) &&
          (!q.openIssue || (x.issue !== null && x.issueReviewedAt === null)) &&
          (!t || [x.balanceTransactionId, x.description ?? "", x.customerEmail ?? "", x.chargeId ?? "", x.stripeInvoiceId ?? "", x.sourceId ?? ""].some((v) => v.toLowerCase().includes(t))),
      )
      .sort((a, b) => b.createdOn.localeCompare(a.createdOn) || b.id - a.id);
  }
  async listTransactions(q: TxnQuery) {
    const all = this.filterTxns(q);
    const p = page(q.limit, q.offset);
    return { items: this.c(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async getTransaction(id: number) {
    return this.c(this.txns.find((x) => x.id === id) ?? null);
  }
  async postableTransactions(until: string, limit: number) {
    return this.c(
      this.txns
        .filter((x) => (x.status === "pending" || x.status === "error") && x.currency === "EUR" && x.createdOn <= until)
        .sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.id - b.id)
        .slice(0, limit),
    );
  }
  async transactionsByCharge(ids: string[]) {
    return this.c(this.txns.filter((x) => x.chargeId !== null && ids.includes(x.chargeId)));
  }
  async transactionsByPayout(ids: string[]) {
    return this.c(this.txns.filter((x) => x.stripePayoutId !== null && ids.includes(x.stripePayoutId)));
  }
  async transactionsByInvoice(ids: number[]) {
    return this.c(this.txns.filter((x) => x.ownInvoiceId !== null && ids.includes(x.ownInvoiceId)));
  }
  async transactionsByStripeInvoice(ids: string[]) {
    return this.c(this.txns.filter((x) => x.stripeInvoiceId !== null && ids.includes(x.stripeInvoiceId)));
  }
  async markTransaction(id: number, m: TxnMark) {
    const x = this.txns.find((r) => r.id === id);
    if (x) Object.assign(x, Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)));
  }
  async reviewIssue(id: number, by: string, at: number, note: string) {
    const x = this.txns.find((r) => r.id === id);
    if (!x || x.issue === null || x.issueReviewedAt !== null) return false;
    Object.assign(x, { issueReviewedBy: by, issueReviewedAt: at, issueNote: note });
    return true;
  }
  async aggregates(from: string, to: string) {
    const m = new Map<StripeTxnType, TxnAggregate>();
    for (const x of this.txns) {
      if (x.currency !== "EUR" || x.createdOn < from || x.createdOn > to) continue;
      const a = m.get(x.type) ?? { type: x.type, count: 0, grossCents: 0, feeCents: 0, netCents: 0 };
      a.count++;
      a.grossCents += x.grossCents;
      a.feeCents += x.feeCents;
      a.netCents += x.netCents;
      m.set(x.type, a);
    }
    return Array.from(m.values());
  }
  async importedNetCents() {
    return this.txns.filter((x) => x.currency === "EUR").reduce((a, x) => a + x.netCents, 0);
  }
  async issueCounts() {
    const open = this.txns.filter((x) => x.issue !== null && x.issueReviewedAt === null);
    return { open: open.length, disputes: open.filter((x) => x.type === "dispute").length };
  }

  async listPayouts(q: PayoutQuery) {
    const all = this.payouts.filter((x) => (!q.status || x.status === q.status) && (!q.from || x.arrivalOn >= q.from) && (!q.to || x.arrivalOn <= q.to)).sort((a, b) => b.arrivalOn.localeCompare(a.arrivalOn) || b.id - a.id);
    const p = page(q.limit, q.offset);
    return { items: this.c(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async getPayout(id: number) {
    return this.c(this.payouts.find((x) => x.id === id) ?? null);
  }
  async payoutsByStripeIds(ids: string[]) {
    return this.c(this.payouts.filter((x) => ids.includes(x.payoutId)));
  }
  async payoutByBankMovement(movementId: number) {
    return this.c(this.payouts.find((x) => x.bankMovementId === movementId) ?? null);
  }
  async postablePayouts(until: string) {
    return this.c(this.payouts.filter((x) => x.entryId === null && LIVE_PAYOUT_STATUSES.includes(x.status) && x.arrivalOn <= until).sort((a, b) => a.arrivalOn.localeCompare(b.arrivalOn) || a.id - b.id));
  }
  async failedPayouts() {
    return this.c(this.payouts.filter((x) => !LIVE_PAYOUT_STATUSES.includes(x.status) && x.reversalEntryId === null));
  }
  async openPayoutsForBank(limit: number) {
    return this.c(this.payouts.filter((x) => x.bankMovementId === null && LIVE_PAYOUT_STATUSES.includes(x.status)).slice(0, limit));
  }
  async setPayoutEntry(id: number, entryId: number) {
    Object.assign(this.payouts.find((x) => x.id === id)!, { entryId });
  }
  async setPayoutReversal(id: number, entryId: number) {
    Object.assign(this.payouts.find((x) => x.id === id)!, { reversalEntryId: entryId });
  }
  async linkPayoutBank(id: number, movementId: number, by: string, at: number) {
    const x = this.payouts.find((r) => r.id === id);
    if (!x || x.bankMovementId !== null || this.payouts.some((r) => r.bankMovementId === movementId)) return false;
    Object.assign(x, { bankMovementId: movementId, bankLinkedBy: by, bankLinkedAt: at });
    return true;
  }
  async unlinkPayoutBank(id: number, movementId: number) {
    const x = this.payouts.find((r) => r.id === id);
    if (!x || x.bankMovementId !== movementId) return false;
    Object.assign(x, { bankMovementId: null, bankLinkedBy: null, bankLinkedAt: null });
    return true;
  }
  async payoutStats(from: string, to: string) {
    const live = this.payouts.filter((x) => LIVE_PAYOUT_STATUSES.includes(x.status));
    return { withoutBank: live.filter((x) => x.entryId !== null && x.bankMovementId === null).length, arrivedCents: live.filter((x) => x.arrivalOn >= from && x.arrivalOn <= to).reduce((a, x) => a + x.amountCents, 0) };
  }

  rules: StripeFeeVatRule[] = [];
  async listFeeVatRules() {
    return this.c([...this.rules].sort((a, b) => b.id - a.id));
  }
  async getFeeVatRule(id: number) {
    return this.c(this.rules.find((r) => r.id === id) ?? null);
  }
  async insertFeeVatRule(r: NewFeeVatRule) {
    const row: StripeFeeVatRule = { ...r, id: this.rules.length + 1, voidedBy: null, voidedAt: null, voidReason: null };
    this.rules.push(row);
    return this.c(row);
  }
  async voidFeeVatRule(id: number, o: { by: string; at: number; reason: string }) {
    const r = this.rules.find((x) => x.id === id);
    if (!r || r.voidedAt !== null) return false;
    Object.assign(r, { voidedBy: o.by, voidedAt: o.at, voidReason: o.reason });
    return true;
  }
  async knownTransactionIds(ids: string[]) {
    const want = new Set(ids);
    return new Set(this.txns.filter((t) => want.has(t.balanceTransactionId)).map((t) => t.balanceTransactionId));
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const isDup = (e: unknown) => (e as { code?: string }).code === "ER_DUP_ENTRY";
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const day = (col: string, alias = col) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${alias}`;
const LIVE_SQL = `('${LIVE_PAYOUT_STATUSES.join("','")}')`;

const importRow = (r: Row): StripeImport => ({
  id: num(r.id),
  kind: r.kind as StripeImportKind,
  filename: String(r.filename),
  sha256: String(r.sha256),
  rows: num(r.row_count),
  inserted: num(r.inserted_count),
  duplicates: num(r.duplicate_count),
  refreshed: num(r.refreshed_count),
  nonEur: num(r.non_eur_count),
  errors: num(r.error_count),
  problems: typeof r.problems_json === "string" && r.problems_json ? (JSON.parse(r.problems_json) as StripeImportProblem[]) : [],
  importedBy: String(r.imported_by),
  createdAt: num(r.created_at),
});
const TXN_COLS = `id, provider, balance_transaction_id, import_id, type, raw_type, created_ts, ${day("created_on", "created_day")}, ${day("available_on", "available_day")}, currency, gross_cents, fee_cents, net_cents, source_id, description, customer_id, customer_email, charge_id, payment_intent_id, stripe_invoice_id, stripe_payout_id, own_invoice_id, status, issue, issue_detail, issue_reviewed_by, issue_reviewed_at, issue_note, entry_id, posted_at, created_at`;
const txnRow = (r: Row): StripeTxn => ({
  id: num(r.id),
  provider: "stripe",
  balanceTransactionId: String(r.balance_transaction_id),
  importId: numOrNull(r.import_id),
  type: r.type as StripeTxnType,
  rawType: String(r.raw_type),
  createdTs: numOrNull(r.created_ts),
  createdOn: String(r.created_day),
  availableOn: strOrNull(r.available_day),
  currency: String(r.currency),
  grossCents: num(r.gross_cents),
  feeCents: num(r.fee_cents),
  netCents: num(r.net_cents),
  sourceId: strOrNull(r.source_id),
  description: strOrNull(r.description),
  customerId: strOrNull(r.customer_id),
  customerEmail: strOrNull(r.customer_email),
  chargeId: strOrNull(r.charge_id),
  paymentIntentId: strOrNull(r.payment_intent_id),
  stripeInvoiceId: strOrNull(r.stripe_invoice_id),
  stripePayoutId: strOrNull(r.stripe_payout_id),
  ownInvoiceId: numOrNull(r.own_invoice_id),
  status: r.status as StripeTxnStatus,
  issue: (r.issue as StripeIssue | null) ?? null,
  issueDetail: strOrNull(r.issue_detail),
  issueReviewedBy: strOrNull(r.issue_reviewed_by),
  issueReviewedAt: numOrNull(r.issue_reviewed_at),
  issueNote: strOrNull(r.issue_note),
  entryId: numOrNull(r.entry_id),
  postedAt: numOrNull(r.posted_at),
  createdAt: num(r.created_at),
});
const PAYOUT_COLS = `id, provider, payout_id, import_id, origin, ${day("created_on", "created_day")}, ${day("arrival_on", "arrival_day")}, currency, amount_cents, fee_cents, status, description, entry_id, reversal_entry_id, bank_movement_id, bank_linked_by, bank_linked_at, created_at, updated_at`;
const payoutRow = (r: Row): StripePayout => ({
  id: num(r.id),
  provider: "stripe",
  payoutId: String(r.payout_id),
  importId: numOrNull(r.import_id),
  origin: r.origin as StripePayout["origin"],
  createdOn: strOrNull(r.created_day),
  arrivalOn: String(r.arrival_day),
  currency: String(r.currency),
  amountCents: num(r.amount_cents),
  feeCents: num(r.fee_cents),
  status: r.status as PayoutStatus,
  description: strOrNull(r.description),
  entryId: numOrNull(r.entry_id),
  reversalEntryId: numOrNull(r.reversal_entry_id),
  bankMovementId: numOrNull(r.bank_movement_id),
  bankLinkedBy: strOrNull(r.bank_linked_by),
  bankLinkedAt: numOrNull(r.bank_linked_at),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

export class MysqlFinanceStripeStore implements FinanceStripeStore {
  constructor(private pool: mysql.Pool) {}

  private async rows<T>(sql: string, args: unknown[], map: (r: Row) => T): Promise<T[]> {
    const [rows] = await this.pool.query<Row[]>(sql, args);
    return rows.map(map);
  }

  async getSettings(): Promise<StripeSettings> {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_stripe_settings WHERE id = 1");
    const r = rows[0];
    if (!r) return { ...DEFAULT_STRIPE_SETTINGS };
    return { stripeFeeVat: r.fee_vat as StripeSettings["stripeFeeVat"], feeVatRateBp: num(r.fee_vat_rate_bp), stripePayoutBankAccountId: numOrNull(r.payout_bank_account_id), disputeAccountCode: String(r.dispute_account_code), updatedBy: strOrNull(r.updated_by), updatedAt: numOrNull(r.updated_at) };
  }
  async saveSettings(s: Pick<StripeSettings, "stripeFeeVat" | "feeVatRateBp" | "stripePayoutBankAccountId" | "disputeAccountCode">, by: string, at: number) {
    await this.pool.query(
      "INSERT INTO fin_stripe_settings (id, fee_vat, fee_vat_rate_bp, payout_bank_account_id, dispute_account_code, updated_by, updated_at) VALUES (1,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fee_vat = VALUES(fee_vat), fee_vat_rate_bp = VALUES(fee_vat_rate_bp), payout_bank_account_id = VALUES(payout_bank_account_id), dispute_account_code = VALUES(dispute_account_code), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
      [s.stripeFeeVat, s.feeVatRateBp, s.stripePayoutBankAccountId, s.disputeAccountCode, by, at],
    );
    return this.getSettings();
  }

  async findImport(kind: StripeImportKind, sha256: string) {
    return (await this.rows("SELECT * FROM fin_stripe_imports WHERE kind = ? AND sha256 = ?", [kind, sha256], importRow))[0] ?? null;
  }
  private async inImport(imp: NewStripeImport, body: (conn: mysql.PoolConnection, id: number) => Promise<{ inserted: number; duplicates: number; refreshed: number }>) {
    const conn = await this.pool.getConnection();
    let id: number;
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<mysql.ResultSetHeader>(
        "INSERT INTO fin_stripe_imports (kind, filename, sha256, row_count, non_eur_count, error_count, problems_json, imported_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [imp.kind, imp.filename, imp.sha256, imp.rows, imp.nonEur, imp.errors, imp.problems.length ? JSON.stringify(imp.problems.slice(0, 100)) : null, imp.importedBy, imp.createdAt],
      );
      id = r.insertId;
      const c = await body(conn, id);
      await conn.query("UPDATE fin_stripe_imports SET inserted_count = ?, duplicate_count = ?, refreshed_count = ? WHERE id = ?", [c.inserted, c.duplicates, c.refreshed, id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      if (isDup(e)) throw dupConflict(ALREADY);
      throw e;
    } finally {
      conn.release();
    }
    return (await this.rows("SELECT * FROM fin_stripe_imports WHERE id = ?", [id], importRow))[0];
  }
  private async insertPayouts(conn: mysql.PoolConnection, list: ParsedPayout[], importId: number, origin: StripePayout["origin"], at: number) {
    if (!list.length) return 0;
    const [r] = await conn.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO fin_stripe_payouts (provider, payout_id, import_id, origin, created_on, arrival_on, currency, amount_cents, fee_cents, status, description, created_at, updated_at) VALUES ?",
      [list.map((p) => ["stripe", p.payoutId, importId, origin, p.createdOn, p.arrivalOn, p.currency, p.amountCents, p.feeCents, p.status, p.description, at, at])],
    );
    return r.affectedRows;
  }
  importTransactions(imp: NewStripeImport, rows: ParsedStripeTxn[], statusOf: (r: ParsedStripeTxn) => { status: StripeTxnStatus; issue: StripeIssue | null }) {
    return this.inImport(imp, async (conn, id) => {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        // Las ya importadas (mismo identificador de Stripe) se ignoran: el índice único decide
        const [ins] = await conn.query<mysql.ResultSetHeader>(
          "INSERT IGNORE INTO fin_stripe_transactions (provider, balance_transaction_id, import_id, type, raw_type, created_ts, created_on, available_on, currency, gross_cents, fee_cents, net_cents, source_id, description, customer_id, customer_email, charge_id, payment_intent_id, stripe_invoice_id, stripe_payout_id, status, issue, created_at) VALUES ?",
          [
            chunk.map((r) => {
              const st = statusOf(r);
              return ["stripe", r.balanceTransactionId, id, r.type, r.rawType, r.createdTs, r.createdOn, r.availableOn, r.currency, r.grossCents, r.feeCents, r.netCents, r.sourceId, r.description, r.customerId, r.customerEmail, r.chargeId, r.paymentIntentId, r.stripeInvoiceId, r.stripePayoutId, st.status, st.issue, imp.createdAt];
            }),
          ],
        );
        inserted += ins.affectedRows;
      }
      await this.insertPayouts(conn, rows.map(payoutFromTxn).filter((p): p is ParsedPayout => !!p), id, "balance", imp.createdAt);
      // Una reversión de payout en el saldo = el payout falló o se canceló
      const failed = Array.from(new Set(rows.filter((r) => r.type === "payout_reversal" && r.stripePayoutId).map((r) => r.stripePayoutId!)));
      if (failed.length) await conn.query(`UPDATE fin_stripe_payouts SET status = 'failed', updated_at = ? WHERE provider = 'stripe' AND payout_id IN (?) AND status IN ${LIVE_SQL}`, [imp.createdAt, failed]);
      return { inserted, duplicates: rows.length - inserted, refreshed: 0 };
    });
  }
  importPayouts(imp: NewStripeImport, rows: ParsedPayout[]) {
    return this.inImport(imp, async (conn, id) => {
      const [known] = rows.length ? await conn.query<Row[]>(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE provider = 'stripe' AND payout_id IN (?) FOR UPDATE`, [rows.map((r) => r.payoutId)]) : [[] as Row[]];
      const byId = new Map(known.map(payoutRow).map((p) => [p.payoutId, p]));
      let refreshed = 0;
      let duplicates = 0;
      for (const p of rows) {
        const cur = byId.get(p.payoutId);
        if (!cur) continue;
        const arrival = cur.entryId === null ? p.arrivalOn : cur.arrivalOn;
        if (cur.status === p.status && cur.arrivalOn === arrival) {
          duplicates++;
          continue;
        }
        await conn.query("UPDATE fin_stripe_payouts SET status = ?, arrival_on = ?, updated_at = ? WHERE id = ?", [p.status, arrival, imp.createdAt, cur.id]);
        refreshed++;
      }
      const inserted = await this.insertPayouts(conn, rows.filter((r) => !byId.has(r.payoutId)), id, "report", imp.createdAt);
      return { inserted, duplicates, refreshed };
    });
  }
  listImports(limit: number) {
    return this.rows("SELECT * FROM fin_stripe_imports ORDER BY id DESC LIMIT ?", [limit], importRow);
  }

  async listTransactions(q: TxnQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.type) (w.push("type = ?"), a.push(q.type));
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.from) (w.push("created_on >= ?"), a.push(q.from));
    if (q.to) (w.push("created_on <= ?"), a.push(q.to));
    if (q.payout) (w.push("stripe_payout_id = ?"), a.push(q.payout));
    if (q.openIssue) w.push("issue IS NOT NULL AND issue_reviewed_at IS NULL");
    if (q.q) {
      w.push("(balance_transaction_id LIKE ? OR description LIKE ? OR customer_email LIKE ? OR charge_id LIKE ? OR stripe_invoice_id LIKE ? OR source_id LIKE ?)");
      a.push(...Array.from({ length: 6 }, () => like(q.q!)));
    }
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_stripe_transactions ${where}`, a);
    const items = await this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions ${where} ORDER BY created_on DESC, id DESC LIMIT ? OFFSET ?`, [...a, p.limit, p.offset], txnRow);
    return { items, total: num(count.n) };
  }
  async getTransaction(id: number) {
    return (await this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE id = ?`, [id], txnRow))[0] ?? null;
  }
  postableTransactions(until: string, limit: number) {
    return this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE status IN ('pending','error') AND currency = 'EUR' AND created_on <= ? ORDER BY created_on, id LIMIT ?`, [until, limit], txnRow);
  }
  async transactionsByCharge(ids: string[]) {
    return ids.length ? this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE charge_id IN (?)`, [ids], txnRow) : [];
  }
  async transactionsByPayout(ids: string[]) {
    return ids.length ? this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE stripe_payout_id IN (?)`, [ids], txnRow) : [];
  }
  async transactionsByInvoice(ids: number[]) {
    return ids.length ? this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE own_invoice_id IN (?)`, [ids], txnRow) : [];
  }
  async transactionsByStripeInvoice(ids: string[]) {
    return ids.length ? this.rows(`SELECT ${TXN_COLS} FROM fin_stripe_transactions WHERE stripe_invoice_id IN (?)`, [ids], txnRow) : [];
  }
  async markTransaction(id: number, m: TxnMark) {
    const fields: Record<keyof TxnMark, string> = { status: "status", entryId: "entry_id", ownInvoiceId: "own_invoice_id", issue: "issue", issueDetail: "issue_detail", postedAt: "posted_at" };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(m)) if (v !== undefined) (sets.push(`${fields[k as keyof TxnMark]} = ?`), args.push(v));
    if (sets.length) await this.pool.query(`UPDATE fin_stripe_transactions SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  }
  async reviewIssue(id: number, by: string, at: number, note: string) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_stripe_transactions SET issue_reviewed_by = ?, issue_reviewed_at = ?, issue_note = ? WHERE id = ? AND issue IS NOT NULL AND issue_reviewed_at IS NULL", [by, at, note, id]);
    return r.affectedRows > 0;
  }
  aggregates(from: string, to: string) {
    return this.rows(
      "SELECT type, COUNT(*) AS n, SUM(gross_cents) AS g, SUM(fee_cents) AS f, SUM(net_cents) AS t FROM fin_stripe_transactions WHERE currency = 'EUR' AND created_on BETWEEN ? AND ? GROUP BY type",
      [from, to],
      (r): TxnAggregate => ({ type: r.type as StripeTxnType, count: num(r.n), grossCents: num(r.g), feeCents: num(r.f), netCents: num(r.t) }),
    );
  }
  async importedNetCents() {
    const [[r]] = await this.pool.query<Row[]>("SELECT COALESCE(SUM(net_cents), 0) AS t FROM fin_stripe_transactions WHERE currency = 'EUR'");
    return num(r.t);
  }
  async issueCounts() {
    const [[r]] = await this.pool.query<Row[]>("SELECT COUNT(*) AS n, COALESCE(SUM(type = 'dispute'), 0) AS d FROM fin_stripe_transactions WHERE issue IS NOT NULL AND issue_reviewed_at IS NULL");
    return { open: num(r.n), disputes: num(r.d) };
  }

  async listPayouts(q: PayoutQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.from) (w.push("arrival_on >= ?"), a.push(q.from));
    if (q.to) (w.push("arrival_on <= ?"), a.push(q.to));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_stripe_payouts ${where}`, a);
    const items = await this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts ${where} ORDER BY arrival_on DESC, id DESC LIMIT ? OFFSET ?`, [...a, p.limit, p.offset], payoutRow);
    return { items, total: num(count.n) };
  }
  async getPayout(id: number) {
    return (await this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE id = ?`, [id], payoutRow))[0] ?? null;
  }
  async payoutsByStripeIds(ids: string[]) {
    return ids.length ? this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE provider = 'stripe' AND payout_id IN (?)`, [ids], payoutRow) : [];
  }
  async payoutByBankMovement(movementId: number) {
    return (await this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE bank_movement_id = ?`, [movementId], payoutRow))[0] ?? null;
  }
  postablePayouts(until: string) {
    return this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE entry_id IS NULL AND status IN ${LIVE_SQL} AND arrival_on <= ? ORDER BY arrival_on, id`, [until], payoutRow);
  }
  failedPayouts() {
    return this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE status NOT IN ${LIVE_SQL} AND reversal_entry_id IS NULL`, [], payoutRow);
  }
  openPayoutsForBank(limit: number) {
    return this.rows(`SELECT ${PAYOUT_COLS} FROM fin_stripe_payouts WHERE bank_movement_id IS NULL AND status IN ${LIVE_SQL} ORDER BY arrival_on DESC LIMIT ?`, [limit], payoutRow);
  }
  async setPayoutEntry(id: number, entryId: number) {
    await this.pool.query("UPDATE fin_stripe_payouts SET entry_id = ? WHERE id = ? AND entry_id IS NULL", [entryId, id]);
  }
  async setPayoutReversal(id: number, entryId: number) {
    await this.pool.query("UPDATE fin_stripe_payouts SET reversal_entry_id = ? WHERE id = ? AND reversal_entry_id IS NULL", [entryId, id]);
  }
  async linkPayoutBank(id: number, movementId: number, by: string, at: number) {
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_stripe_payouts SET bank_movement_id = ?, bank_linked_by = ?, bank_linked_at = ? WHERE id = ? AND bank_movement_id IS NULL", [movementId, by, at, id]);
      return r.affectedRows > 0;
    } catch (e) {
      if (isDup(e)) return false;
      throw e;
    }
  }
  async unlinkPayoutBank(id: number, movementId: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_stripe_payouts SET bank_movement_id = NULL, bank_linked_by = NULL, bank_linked_at = NULL WHERE id = ? AND bank_movement_id = ?", [id, movementId]);
    return r.affectedRows > 0;
  }
  async payoutStats(from: string, to: string) {
    const [[r]] = await this.pool.query<Row[]>(
      `SELECT COALESCE(SUM(entry_id IS NOT NULL AND bank_movement_id IS NULL), 0) AS nb, COALESCE(SUM(CASE WHEN arrival_on BETWEEN ? AND ? THEN amount_cents ELSE 0 END), 0) AS arr FROM fin_stripe_payouts WHERE status IN ${LIVE_SQL}`,
      [from, to],
    );
    return { withoutBank: num(r.nb), arrivedCents: num(r.arr) };
  }

  async listFeeVatRules() {
    return this.rows(`SELECT ${RULE_COLS} FROM fin_stripe_fee_vat_rules ORDER BY id DESC LIMIT 500`, [], ruleRow);
  }
  async getFeeVatRule(id: number) {
    return (await this.rows(`SELECT ${RULE_COLS} FROM fin_stripe_fee_vat_rules WHERE id = ?`, [id], ruleRow))[0] ?? null;
  }
  async insertFeeVatRule(r: NewFeeVatRule) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT INTO fin_stripe_fee_vat_rules (fee_kind, issuer_name, issuer_country, issuer_vat_id, treatment, rate_bp, valid_from, valid_to, document_ref, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [r.feeKind, r.issuerName, r.issuerCountry, r.issuerVatId, r.treatment, r.rateBp, r.validFrom, r.validTo, r.documentRef, r.note, r.createdBy, r.createdAt],
    );
    return (await this.getFeeVatRule(res.insertId))!;
  }
  async voidFeeVatRule(id: number, o: { by: string; at: number; reason: string }) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_stripe_fee_vat_rules SET voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL", [o.by, o.at, o.reason, id]);
    return res.affectedRows === 1;
  }
  async knownTransactionIds(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const [rows] = await this.pool.query<Row[]>("SELECT balance_transaction_id FROM fin_stripe_transactions WHERE provider = 'stripe' AND balance_transaction_id IN (?)", [ids.slice(i, i + 1000)]);
      for (const r of rows) out.add(String(r.balance_transaction_id));
    }
    return out;
  }
}

const RULE_COLS = `id, fee_kind, issuer_name, issuer_country, issuer_vat_id, treatment, rate_bp, ${day("valid_from", "valid_from_day")}, ${day("valid_to", "valid_to_day")}, document_ref, note, created_by, created_at, voided_by, voided_at, void_reason`;
const ruleRow = (r: Row): StripeFeeVatRule => ({
  id: num(r.id),
  feeKind: String(r.fee_kind),
  issuerName: String(r.issuer_name),
  issuerCountry: String(r.issuer_country),
  issuerVatId: strOrNull(r.issuer_vat_id),
  treatment: r.treatment as FeeVatTreatment,
  rateBp: numOrNull(r.rate_bp),
  validFrom: String(r.valid_from_day),
  validTo: strOrNull(r.valid_to_day),
  documentRef: strOrNull(r.document_ref),
  note: strOrNull(r.note),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  voidedBy: strOrNull(r.voided_by),
  voidedAt: numOrNull(r.voided_at),
  voidReason: strOrNull(r.void_reason),
});

/** Facturas de Stripe registradas por el cobro (`stripe_invoices`, 0016): solo lectura, para explicar un cobro sin factura propia. */
export class MysqlStripeInvoiceDirectory {
  constructor(private pool: Pick<mysql.Pool, "query">) {}
  async known(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    try {
      const [rows] = await this.pool.query<Row[]>("SELECT stripe_invoice_id FROM stripe_invoices WHERE stripe_invoice_id IN (?)", [ids]);
      return new Set(rows.map((r) => String(r.stripe_invoice_id)));
    } catch {
      return new Set();
    }
  }
}

/** ¿Existe la migración 0036 (Stripe)? */
export async function finStripeTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["fin_stripe_settings", "fin_stripe_imports", "fin_stripe_payouts", "fin_stripe_transactions"]) {
    const ok = await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(
      () => true,
      () => false,
    );
    if (!ok) return false;
  }
  return true;
}

export { isPayoutType };
