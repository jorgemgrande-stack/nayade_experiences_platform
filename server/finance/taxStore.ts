/**
 * Almacén de la fase 3 (gestoría e impuestos, CRM 0037): memoria (pruebas) y MySQL. Garantías:
 *  - una obligación por modelo y periodo (`obligation_key` única): generar el calendario dos veces no duplica nada;
 *  - transiciones de estado CONDICIONALES (`… WHERE status IN (…)`): dos peticiones simultáneas no ganan las dos;
 *  - la configuración guarda versión optimista y cada versión en su historial; bitácoras de solo inserción;
 *  - nada se borra: los ajustes se anulan, las obligaciones cambian de estado y el borrador presentado no se pisa.
 */
import type mysql from "mysql2/promise";
import type { ObligationSpec } from "./taxRules";
import type {
  AdjustmentKind,
  CorporateAdjustment,
  Deferral,
  DeferralInstallment,
  DeferralStatus,
  Dossier,
  DossierKind,
  DossierLogRow,
  DossierStatus,
  Obligation,
  ObligationLogRow,
  ObligationStatus,
  Outcome,
  Payroll,
  PayrollStatus,
  StaleInfo,
  TaxDraft,
  TaxModel,
  TaxSettings,
  TaxSettingsLogRow,
} from "./taxTypes";
import { FinanceError } from "./types";

export const TAX_MAX_PAGE = 500;

export interface ObligationQuery {
  year?: number;
  model?: TaxModel;
  status?: ObligationStatus;
  statuses?: ObligationStatus[];
  dueFrom?: string;
  dueTo?: string;
  /** Obligaciones cuyo periodo toca este rango. */
  periodFrom?: string;
  periodTo?: string;
  limit?: number;
  offset?: number;
}

export type SettingsValues = Omit<TaxSettings, "configured" | "version" | "updatedBy" | "updatedAt">;
export type ObligationPatch = Partial<Pick<Obligation, "reviewedAt" | "reviewedBy" | "presentedAt" | "presentedBy" | "presentedOn" | "presentedAmountCents" | "receiptRef" | "receiptDocumentId" | "paidAt" | "paidBy" | "paidOn" | "paidAmountCents" | "paymentEntryId" | "settlementEntryId" | "frozenAt" | "frozenBy" | "notes" | "outcome" | "amountCents" | "stale" | "staleDetail">>;
export type NewPayroll = Omit<Payroll, "id" | "status" | "entryId" | "paymentEntryId" | "paidOn" | "bankAccountId" | "updatedAt">;
export type NewDeferral = Omit<Deferral, "id" | "installments" | "updatedAt">;
export type NewDossier = Omit<Dossier, "id" | "updatedAt" | "closedAt">;
export type DossierPatch = Partial<Pick<Dossier, "kind" | "agency" | "reference" | "subject" | "notifiedOn" | "responseDueOn" | "status" | "obligationId" | "notes">>;

export interface FinanceTaxStore {
  /** null mientras nadie haya guardado la configuración. */
  getSettings(): Promise<TaxSettings | null>;
  /** Guarda la versión siguiente (`conflict` si `expectedVersion` no es la vigente) y su fila de historial. */
  saveSettings(v: SettingsValues, o: { by: string; at: number; requestId: string | null; expectedVersion: number | null; before: TaxSettings | null }): Promise<TaxSettings>;
  settingsLog(limit: number): Promise<TaxSettingsLogRow[]>;

  listObligations(q: ObligationQuery): Promise<{ items: Obligation[]; total: number }>;
  getObligation(id: number): Promise<Obligation | null>;
  getObligationByKey(key: string): Promise<Obligation | null>;
  getDraft(id: number): Promise<TaxDraft | null>;
  /** Da de alta las que no existen (clave única); devuelve las creadas. */
  insertObligations(specs: ObligationSpec[], by: string, at: number): Promise<Obligation[]>;
  /** Guarda el borrador si el estado sigue siendo uno de `from` (y pasa a `to`); false si no. */
  saveDraft(id: number, draft: TaxDraft, o: { from: ObligationStatus[]; to: ObligationStatus; amountCents: number | null; outcome: Outcome | null; at: number }): Promise<boolean>;
  /** Cambia el estado si sigue siendo uno de `from`; aplica `patch` en la misma escritura. */
  transition(id: number, from: ObligationStatus[], to: ObligationStatus, patch: ObligationPatch, at: number): Promise<boolean>;
  patchObligation(id: number, patch: ObligationPatch, at: number): Promise<void>;
  /** Marca el umbral avisado si es menor que el anterior (o no había); false si otra réplica se adelantó. */
  markReminder(id: number, bucket: number): Promise<boolean>;
  addObligationLog(r: Omit<ObligationLogRow, "id">): Promise<void>;
  obligationLog(id: number): Promise<ObligationLogRow[]>;

  listPayrolls(q: { period?: string; from?: string; to?: string; status?: PayrollStatus }): Promise<Payroll[]>;
  getPayroll(id: number): Promise<Payroll | null>;
  /** Crea la nómina o reemplaza la del mismo mes y alias si sigue en borrador; `conflict` si ya se registró. */
  upsertDraftPayroll(p: NewPayroll): Promise<{ payroll: Payroll; created: boolean }>;
  markPayrollPosted(id: number, entryId: number, at: number): Promise<boolean>;
  markPayrollPaid(id: number, o: { entryId: number; paidOn: string; bankAccountId: number; at: number }): Promise<boolean>;

  listDeferrals(q: { status?: DeferralStatus; obligationId?: number }): Promise<Deferral[]>;
  getDeferral(id: number): Promise<Deferral | null>;
  insertDeferral(d: NewDeferral, installments: Array<Pick<DeferralInstallment, "number" | "dueDate" | "amountCents" | "interestCents">>): Promise<Deferral>;
  patchDeferral(id: number, p: Partial<Pick<Deferral, "status" | "resolutionOn" | "reference" | "notes">>, at: number): Promise<Deferral | null>;
  /** Marca pagada una cuota pendiente; false si ya lo estaba. */
  payInstallment(deferralId: number, n: number, o: { entryId: number; paidOn: string; by: string; at: number }): Promise<boolean>;

  listDossiers(q: { status?: DossierStatus }): Promise<Dossier[]>;
  getDossier(id: number): Promise<Dossier | null>;
  insertDossier(d: NewDossier): Promise<Dossier>;
  patchDossier(id: number, p: DossierPatch, at: number): Promise<Dossier | null>;
  addDossierLog(r: Omit<DossierLogRow, "id">): Promise<void>;
  dossierLog(id: number): Promise<DossierLogRow[]>;

  listAdjustments(year: number): Promise<CorporateAdjustment[]>;
  insertAdjustment(a: Omit<CorporateAdjustment, "id" | "status" | "voidedBy" | "voidedAt" | "voidReason">): Promise<CorporateAdjustment>;
  voidAdjustment(id: number, o: { by: string; at: number; reason: string }): Promise<boolean>;
}

const page = (limit?: number, offset?: number) => ({ limit: Math.max(1, Math.min(limit ?? 200, TAX_MAX_PAGE)), offset: Math.max(0, offset ?? 0) });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const PAYROLL_LOCKED = () => new FinanceError("conflict", "La nómina de ese mes y empleado ya está registrada: no se puede sustituir");

function matches(o: Obligation, q: ObligationQuery) {
  if (q.year !== undefined && o.year !== q.year) return false;
  if (q.model && o.model !== q.model) return false;
  if (q.status && o.status !== q.status) return false;
  if (q.statuses && !q.statuses.includes(o.status)) return false;
  if (q.dueFrom && o.dueDate < q.dueFrom) return false;
  if (q.dueTo && o.dueDate > q.dueTo) return false;
  if (q.periodFrom && o.periodTo < q.periodFrom) return false;
  if (q.periodTo && o.periodFrom > q.periodTo) return false;
  return true;
}
const byDue = (a: Obligation, b: Obligation) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key);

function newObligation(id: number, s: ObligationSpec, by: string, at: number): Obligation {
  return {
    id,
    key: s.key,
    model: s.model,
    year: s.year,
    period: s.period,
    periodFrom: s.from,
    periodTo: s.to,
    dueDate: s.dueDate,
    status: "pendiente",
    amountCents: null,
    outcome: null,
    draftHash: null,
    draftAt: null,
    stale: false,
    staleDetail: null,
    reviewedAt: null,
    reviewedBy: null,
    presentedAt: null,
    presentedBy: null,
    presentedOn: null,
    presentedAmountCents: null,
    receiptRef: null,
    receiptDocumentId: null,
    paidAt: null,
    paidBy: null,
    paidOn: null,
    paidAmountCents: null,
    paymentEntryId: null,
    settlementEntryId: null,
    frozenAt: null,
    frozenBy: null,
    lastReminderDays: null,
    notes: null,
    createdBy: by,
    createdAt: at,
    updatedAt: at,
  };
}

// ── Memoria ───────────────────────────────────────────────────────────────────────────────────────────────────────

export class MemoryFinanceTaxStore implements FinanceTaxStore {
  settings: TaxSettings | null = null;
  settingsRows: TaxSettingsLogRow[] = [];
  obligations: Obligation[] = [];
  drafts = new Map<number, TaxDraft>();
  logs: ObligationLogRow[] = [];
  payrolls: Payroll[] = [];
  deferrals: Deferral[] = [];
  dossiers: Dossier[] = [];
  dossierLogs: DossierLogRow[] = [];
  adjustments: CorporateAdjustment[] = [];
  private seq = 0;
  private next() {
    return ++this.seq;
  }

  async getSettings() {
    return this.settings ? clone(this.settings) : null;
  }
  async saveSettings(v: SettingsValues, o: { by: string; at: number; requestId: string | null; expectedVersion: number | null; before: TaxSettings | null }) {
    const cur = this.settings?.version ?? 0;
    if (o.expectedVersion !== null && o.expectedVersion !== cur) throw new FinanceError("conflict", "La configuración fiscal ha cambiado mientras la editabas: recárgala");
    this.settings = { ...clone(v), configured: true, version: cur + 1, updatedBy: o.by, updatedAt: o.at };
    this.settingsRows.push({ id: this.next(), at: o.at, actor: o.by, requestId: o.requestId, before: o.before ? clone(o.before) : null, after: clone(this.settings) });
    return clone(this.settings);
  }
  async settingsLog(limit: number) {
    return clone([...this.settingsRows].reverse().slice(0, limit));
  }

  async listObligations(q: ObligationQuery) {
    const p = page(q.limit, q.offset);
    const all = this.obligations.filter((o) => matches(o, q)).sort(byDue);
    return { items: clone(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async getObligation(id: number) {
    const o = this.obligations.find((x) => x.id === id);
    return o ? clone(o) : null;
  }
  async getObligationByKey(key: string) {
    const o = this.obligations.find((x) => x.key === key);
    return o ? clone(o) : null;
  }
  async getDraft(id: number) {
    const d = this.drafts.get(id);
    return d ? clone(d) : null;
  }
  async insertObligations(specs: ObligationSpec[], by: string, at: number) {
    const created: Obligation[] = [];
    for (const s of specs) {
      if (this.obligations.some((o) => o.key === s.key)) continue;
      const o = newObligation(this.next(), s, by, at);
      this.obligations.push(o);
      created.push(clone(o));
    }
    return created;
  }
  async saveDraft(id: number, draft: TaxDraft, o: { from: ObligationStatus[]; to: ObligationStatus; amountCents: number | null; outcome: Outcome | null; at: number }) {
    const ob = this.obligations.find((x) => x.id === id);
    if (!ob || !o.from.includes(ob.status)) return false;
    Object.assign(ob, { status: o.to, amountCents: o.amountCents, outcome: o.outcome, draftHash: draft.hash, draftAt: draft.computedAt, stale: false, staleDetail: null, updatedAt: o.at });
    this.drafts.set(id, clone(draft));
    return true;
  }
  async transition(id: number, from: ObligationStatus[], to: ObligationStatus, patch: ObligationPatch, at: number) {
    const ob = this.obligations.find((x) => x.id === id);
    if (!ob || !from.includes(ob.status)) return false;
    Object.assign(ob, clone(patch), { status: to, updatedAt: at });
    return true;
  }
  async patchObligation(id: number, patch: ObligationPatch, at: number) {
    const ob = this.obligations.find((x) => x.id === id);
    if (ob) Object.assign(ob, clone(patch), { updatedAt: at });
  }
  async markReminder(id: number, bucket: number) {
    const ob = this.obligations.find((x) => x.id === id);
    if (!ob || (ob.lastReminderDays !== null && ob.lastReminderDays <= bucket)) return false;
    ob.lastReminderDays = bucket;
    return true;
  }
  async addObligationLog(r: Omit<ObligationLogRow, "id">) {
    this.logs.push({ id: this.next(), ...clone(r) });
  }
  async obligationLog(id: number) {
    return clone(this.logs.filter((l) => l.obligationId === id));
  }

  async listPayrolls(q: { period?: string; from?: string; to?: string; status?: PayrollStatus }) {
    return clone(this.payrolls.filter((p) => (!q.period || p.period === q.period) && (!q.from || p.period >= q.from) && (!q.to || p.period <= q.to) && (!q.status || p.status === q.status)).sort((a, b) => a.period.localeCompare(b.period) || a.employeeAlias.localeCompare(b.employeeAlias)));
  }
  async getPayroll(id: number) {
    const p = this.payrolls.find((x) => x.id === id);
    return p ? clone(p) : null;
  }
  async upsertDraftPayroll(p: NewPayroll) {
    const cur = this.payrolls.find((x) => x.period === p.period && x.employeeAlias === p.employeeAlias);
    if (cur) {
      if (cur.status !== "draft") throw PAYROLL_LOCKED();
      Object.assign(cur, clone(p), { createdBy: cur.createdBy, createdAt: cur.createdAt, updatedAt: p.createdAt });
      return { payroll: clone(cur), created: false };
    }
    const row: Payroll = { ...clone(p), id: this.next(), status: "draft", entryId: null, paymentEntryId: null, paidOn: null, bankAccountId: null, updatedAt: p.createdAt };
    this.payrolls.push(row);
    return { payroll: clone(row), created: true };
  }
  async markPayrollPosted(id: number, entryId: number, at: number) {
    const p = this.payrolls.find((x) => x.id === id);
    if (!p || p.status !== "draft") return false;
    Object.assign(p, { status: "posted", entryId, updatedAt: at });
    return true;
  }
  async markPayrollPaid(id: number, o: { entryId: number; paidOn: string; bankAccountId: number; at: number }) {
    const p = this.payrolls.find((x) => x.id === id);
    if (!p || p.status !== "posted") return false;
    Object.assign(p, { status: "paid", paymentEntryId: o.entryId, paidOn: o.paidOn, bankAccountId: o.bankAccountId, updatedAt: o.at });
    return true;
  }

  async listDeferrals(q: { status?: DeferralStatus; obligationId?: number }) {
    return clone(this.deferrals.filter((d) => (!q.status || d.status === q.status) && (q.obligationId === undefined || d.obligationId === q.obligationId)).sort((a, b) => b.id - a.id));
  }
  async getDeferral(id: number) {
    const d = this.deferrals.find((x) => x.id === id);
    return d ? clone(d) : null;
  }
  async insertDeferral(d: NewDeferral, installments: Array<Pick<DeferralInstallment, "number" | "dueDate" | "amountCents" | "interestCents">>) {
    const row: Deferral = { ...clone(d), id: this.next(), updatedAt: d.createdAt, installments: installments.map((x) => ({ ...x, status: "pendiente", paidOn: null, paidAt: null, entryId: null })) };
    this.deferrals.push(row);
    return clone(row);
  }
  async patchDeferral(id: number, p: Partial<Pick<Deferral, "status" | "resolutionOn" | "reference" | "notes">>, at: number) {
    const d = this.deferrals.find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, clone(p), { updatedAt: at });
    return clone(d);
  }
  async payInstallment(deferralId: number, n: number, o: { entryId: number; paidOn: string; by: string; at: number }) {
    const inst = this.deferrals.find((x) => x.id === deferralId)?.installments.find((x) => x.number === n);
    if (!inst || inst.status !== "pendiente") return false;
    Object.assign(inst, { status: "pagada", entryId: o.entryId, paidOn: o.paidOn, paidAt: o.at });
    return true;
  }

  async listDossiers(q: { status?: DossierStatus }) {
    return clone(this.dossiers.filter((d) => !q.status || d.status === q.status).sort((a, b) => b.id - a.id));
  }
  async getDossier(id: number) {
    const d = this.dossiers.find((x) => x.id === id);
    return d ? clone(d) : null;
  }
  async insertDossier(d: NewDossier) {
    const row: Dossier = { ...clone(d), id: this.next(), updatedAt: d.createdAt, closedAt: d.status === "cerrado" ? d.createdAt : null };
    this.dossiers.push(row);
    return clone(row);
  }
  async patchDossier(id: number, p: DossierPatch, at: number) {
    const d = this.dossiers.find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, clone(p), { updatedAt: at });
    if (p.status) d.closedAt = p.status === "cerrado" ? (d.closedAt ?? at) : null;
    return clone(d);
  }
  async addDossierLog(r: Omit<DossierLogRow, "id">) {
    this.dossierLogs.push({ id: this.next(), ...clone(r) });
  }
  async dossierLog(id: number) {
    return clone(this.dossierLogs.filter((l) => l.dossierId === id));
  }

  async listAdjustments(year: number) {
    return clone(this.adjustments.filter((a) => a.year === year));
  }
  async insertAdjustment(a: Omit<CorporateAdjustment, "id" | "status" | "voidedBy" | "voidedAt" | "voidReason">) {
    const row: CorporateAdjustment = { ...clone(a), id: this.next(), status: "active", voidedBy: null, voidedAt: null, voidReason: null };
    this.adjustments.push(row);
    return clone(row);
  }
  async voidAdjustment(id: number, o: { by: string; at: number; reason: string }) {
    const a = this.adjustments.find((x) => x.id === id);
    if (!a || a.status !== "active") return false;
    Object.assign(a, { status: "void", voidedBy: o.by, voidedAt: o.at, voidReason: o.reason });
    return true;
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => Number(v) === 1;
const json = <T>(v: unknown): T | null => {
  if (v === null || v === undefined || v === "") return null;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
};
const day = (col: string, as = col) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${as}`;

const settingsRow = (r: Row): TaxSettings => ({
  configured: true,
  legalName: strOrNull(r.legal_name),
  taxId: strOrNull(r.tax_id),
  fiscalYearStartMonth: num(r.fiscal_year_start_month),
  vatRegime: String(r.vat_regime) as TaxSettings["vatRegime"],
  vatPeriod: String(r.vat_period) as TaxSettings["vatPeriod"],
  redeme: bool(r.redeme),
  sii: bool(r.sii),
  vat390Exempt: bool(r.vat390_exempt),
  openingVatCompensationCents: numOrNull(r.opening_vat_compensation_cents),
  corporateTaxRateBp: num(r.corporate_tax_rate_bp),
  newEntityFirstProfitYear: numOrNull(r.new_entity_first_profit_year),
  hasEmployees: bool(r.has_employees),
  hasProfessionalWithholdings: bool(r.has_professional_withholdings),
  hasRentWithholdings: bool(r.has_rent_withholdings),
  intraEuOperations: bool(r.intra_eu_operations),
  operations347: bool(r.operations_347),
  installmentPaymentsMethod: String(r.installment_payments_method) as TaxSettings["installmentPaymentsMethod"],
  stripeVatId: strOrNull(r.stripe_vat_id),
  extraHolidays: json<string[]>(r.extra_holidays_json) ?? [],
  gestoriaEmail: strOrNull(r.gestoria_email),
  notes: strOrNull(r.notes),
  version: num(r.version),
  updatedBy: strOrNull(r.updated_by),
  updatedAt: numOrNull(r.updated_at),
});

const OBLIGATION_COLS = `id, obligation_key, model, year, period, ${day("period_from")}, ${day("period_to")}, ${day("due_date")}, status, amount_cents, outcome, draft_hash, draft_at, stale, stale_json, reviewed_at, reviewed_by, presented_at, presented_by, ${day("presented_on")}, presented_amount_cents, receipt_ref, receipt_document_id, paid_at, paid_by, ${day("paid_on")}, paid_amount_cents, payment_entry_id, settlement_entry_id, frozen_at, frozen_by, last_reminder_days, notes, created_by, created_at, updated_at`;

const obligationRow = (r: Row): Obligation => ({
  id: num(r.id),
  key: String(r.obligation_key),
  model: String(r.model) as TaxModel,
  year: num(r.year),
  period: String(r.period),
  periodFrom: String(r.period_from),
  periodTo: String(r.period_to),
  dueDate: String(r.due_date),
  status: String(r.status) as ObligationStatus,
  amountCents: numOrNull(r.amount_cents),
  outcome: (strOrNull(r.outcome) as Outcome | null) ?? null,
  draftHash: strOrNull(r.draft_hash),
  draftAt: numOrNull(r.draft_at),
  stale: bool(r.stale),
  staleDetail: json<StaleInfo>(r.stale_json),
  reviewedAt: numOrNull(r.reviewed_at),
  reviewedBy: strOrNull(r.reviewed_by),
  presentedAt: numOrNull(r.presented_at),
  presentedBy: strOrNull(r.presented_by),
  presentedOn: strOrNull(r.presented_on),
  presentedAmountCents: numOrNull(r.presented_amount_cents),
  receiptRef: strOrNull(r.receipt_ref),
  receiptDocumentId: numOrNull(r.receipt_document_id),
  paidAt: numOrNull(r.paid_at),
  paidBy: strOrNull(r.paid_by),
  paidOn: strOrNull(r.paid_on),
  paidAmountCents: numOrNull(r.paid_amount_cents),
  paymentEntryId: numOrNull(r.payment_entry_id),
  settlementEntryId: numOrNull(r.settlement_entry_id),
  frozenAt: numOrNull(r.frozen_at),
  frozenBy: strOrNull(r.frozen_by),
  lastReminderDays: numOrNull(r.last_reminder_days),
  notes: strOrNull(r.notes),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

/** Columna de cada campo modificable de una obligación. */
const PATCH_COLS: Record<keyof ObligationPatch, string> = {
  reviewedAt: "reviewed_at",
  reviewedBy: "reviewed_by",
  presentedAt: "presented_at",
  presentedBy: "presented_by",
  presentedOn: "presented_on",
  presentedAmountCents: "presented_amount_cents",
  receiptRef: "receipt_ref",
  receiptDocumentId: "receipt_document_id",
  paidAt: "paid_at",
  paidBy: "paid_by",
  paidOn: "paid_on",
  paidAmountCents: "paid_amount_cents",
  paymentEntryId: "payment_entry_id",
  settlementEntryId: "settlement_entry_id",
  frozenAt: "frozen_at",
  frozenBy: "frozen_by",
  notes: "notes",
  outcome: "outcome",
  amountCents: "amount_cents",
  stale: "stale",
  staleDetail: "stale_json",
};
function patchSql(patch: ObligationPatch): { sets: string[]; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch) as Array<[keyof ObligationPatch, unknown]>) {
    if (v === undefined) continue;
    sets.push(`${PATCH_COLS[k]} = ?`);
    args.push(k === "staleDetail" ? (v === null ? null : JSON.stringify(v)) : k === "stale" ? (v ? 1 : 0) : v);
  }
  return { sets, args };
}

const PAYROLL_COLS = `id, period, employee_alias, gross_cents, irpf_cents, ss_employee_cents, ss_company_cents, net_cents, ${day("pay_date")}, status, entry_id, payment_entry_id, ${day("paid_on")}, bank_account_id, notes, created_by, created_at, updated_at`;
const payrollRow = (r: Row): Payroll => ({
  id: num(r.id),
  period: String(r.period),
  employeeAlias: String(r.employee_alias),
  grossCents: num(r.gross_cents),
  irpfCents: num(r.irpf_cents),
  ssEmployeeCents: num(r.ss_employee_cents),
  ssCompanyCents: num(r.ss_company_cents),
  netCents: num(r.net_cents),
  payDate: strOrNull(r.pay_date),
  status: String(r.status) as PayrollStatus,
  entryId: numOrNull(r.entry_id),
  paymentEntryId: numOrNull(r.payment_entry_id),
  paidOn: strOrNull(r.paid_on),
  bankAccountId: numOrNull(r.bank_account_id),
  notes: strOrNull(r.notes),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

const DEFERRAL_COLS = `id, obligation_id, status, ${day("requested_on")}, ${day("resolution_on")}, reference, principal_cents, interest_cents, notes, created_by, created_at, updated_at`;
const INSTALLMENT_COLS = `deferral_id, number, ${day("due_date")}, amount_cents, interest_cents, status, ${day("paid_on")}, paid_at, entry_id`;
const DOSSIER_COLS = `id, kind, agency, reference, subject, ${day("notified_on")}, ${day("response_due_on")}, status, obligation_id, notes, created_by, created_at, updated_at, closed_at`;
const dossierRow = (r: Row): Dossier => ({
  id: num(r.id),
  kind: String(r.kind) as DossierKind,
  agency: String(r.agency),
  reference: strOrNull(r.reference),
  subject: String(r.subject),
  notifiedOn: strOrNull(r.notified_on),
  responseDueOn: strOrNull(r.response_due_on),
  status: String(r.status) as DossierStatus,
  obligationId: numOrNull(r.obligation_id),
  notes: strOrNull(r.notes),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  closedAt: numOrNull(r.closed_at),
});
const adjustmentRow = (r: Row): CorporateAdjustment => ({
  id: num(r.id),
  year: num(r.year),
  kind: String(r.kind) as AdjustmentKind,
  description: String(r.description),
  amountCents: num(r.amount_cents),
  originYear: numOrNull(r.origin_year),
  status: String(r.status) as "active" | "void",
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  voidedBy: strOrNull(r.voided_by),
  voidedAt: numOrNull(r.voided_at),
  voidReason: strOrNull(r.void_reason),
});
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

export class MysqlFinanceTaxStore implements FinanceTaxStore {
  constructor(private pool: mysql.Pool) {}

  private async rows<T>(sql: string, args: unknown[], map: (r: Row) => T): Promise<T[]> {
    const [rows] = await this.pool.query<Row[]>(sql, args);
    return rows.map(map);
  }

  async getSettings() {
    return (await this.rows("SELECT * FROM fin_tax_settings WHERE id = 1", [], settingsRow))[0] ?? null;
  }
  async saveSettings(v: SettingsValues, o: { by: string; at: number; requestId: string | null; expectedVersion: number | null; before: TaxSettings | null }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [cur] = await conn.query<Row[]>("SELECT version FROM fin_tax_settings WHERE id = 1 FOR UPDATE");
      const version = cur[0] ? num(cur[0].version) : 0;
      if (o.expectedVersion !== null && o.expectedVersion !== version) throw new FinanceError("conflict", "La configuración fiscal ha cambiado mientras la editabas: recárgala");
      const cols = ["legal_name", "tax_id", "fiscal_year_start_month", "vat_regime", "vat_period", "redeme", "sii", "vat390_exempt", "opening_vat_compensation_cents", "corporate_tax_rate_bp", "new_entity_first_profit_year", "has_employees", "has_professional_withholdings", "has_rent_withholdings", "intra_eu_operations", "operations_347", "installment_payments_method", "stripe_vat_id", "extra_holidays_json", "gestoria_email", "notes"];
      const vals = [v.legalName, v.taxId, v.fiscalYearStartMonth, v.vatRegime, v.vatPeriod, v.redeme ? 1 : 0, v.sii ? 1 : 0, v.vat390Exempt ? 1 : 0, v.openingVatCompensationCents, v.corporateTaxRateBp, v.newEntityFirstProfitYear, v.hasEmployees ? 1 : 0, v.hasProfessionalWithholdings ? 1 : 0, v.hasRentWithholdings ? 1 : 0, v.intraEuOperations ? 1 : 0, v.operations347 ? 1 : 0, v.installmentPaymentsMethod, v.stripeVatId, JSON.stringify(v.extraHolidays ?? []), v.gestoriaEmail, v.notes];
      await conn.query(
        `INSERT INTO fin_tax_settings (id, ${cols.join(", ")}, version, updated_by, updated_at) VALUES (1, ${cols.map(() => "?").join(", ")}, ?, ?, ?) ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}, version = VALUES(version), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
        [...vals, version + 1, o.by, o.at],
      );
      const [after] = await conn.query<Row[]>("SELECT * FROM fin_tax_settings WHERE id = 1");
      const saved = settingsRow(after[0]);
      await conn.query("INSERT INTO fin_tax_settings_log (at, actor, request_id, before_json, after_json) VALUES (?,?,?,?,?)", [o.at, o.by, o.requestId, o.before ? JSON.stringify(o.before) : null, JSON.stringify(saved)]);
      await conn.commit();
      return saved;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
  async settingsLog(limit: number) {
    return this.rows("SELECT * FROM fin_tax_settings_log ORDER BY id DESC LIMIT ?", [limit], (r) => ({ id: num(r.id), at: num(r.at), actor: String(r.actor), requestId: strOrNull(r.request_id), before: json<Partial<TaxSettings>>(r.before_json), after: json<Partial<TaxSettings>>(r.after_json) ?? {} }));
  }

  async listObligations(q: ObligationQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.year !== undefined) (w.push("year = ?"), a.push(q.year));
    if (q.model) (w.push("model = ?"), a.push(q.model));
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.statuses?.length) (w.push("status IN (?)"), a.push(q.statuses));
    if (q.dueFrom) (w.push("due_date >= ?"), a.push(q.dueFrom));
    if (q.dueTo) (w.push("due_date <= ?"), a.push(q.dueTo));
    if (q.periodFrom) (w.push("period_to >= ?"), a.push(q.periodFrom));
    if (q.periodTo) (w.push("period_from <= ?"), a.push(q.periodTo));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const [[c]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_tax_obligations ${where}`, a);
    const items = await this.rows(`SELECT ${OBLIGATION_COLS} FROM fin_tax_obligations ${where} ORDER BY due_date, obligation_key LIMIT ? OFFSET ?`, [...a, p.limit, p.offset], obligationRow);
    return { items, total: num(c.n) };
  }
  async getObligation(id: number) {
    return (await this.rows(`SELECT ${OBLIGATION_COLS} FROM fin_tax_obligations WHERE id = ?`, [id], obligationRow))[0] ?? null;
  }
  async getObligationByKey(key: string) {
    return (await this.rows(`SELECT ${OBLIGATION_COLS} FROM fin_tax_obligations WHERE obligation_key = ?`, [key], obligationRow))[0] ?? null;
  }
  async getDraft(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT draft_json FROM fin_tax_obligations WHERE id = ?", [id]);
    return rows[0] ? json<TaxDraft>(rows[0].draft_json) : null;
  }
  async insertObligations(specs: ObligationSpec[], by: string, at: number) {
    if (!specs.length) return [];
    const before = new Set(await this.rows("SELECT obligation_key FROM fin_tax_obligations WHERE obligation_key IN (?)", [specs.map((s) => s.key)], (r) => String(r.obligation_key)));
    const created: number[] = [];
    // Una fila por sentencia: la clave única decide y `affectedRows` dice si la creó ESTA llamada (dos generaciones
    // simultáneas no se bloquean entre sí ni cuentan dos veces la misma obligación)
    for (const s of specs.filter((x) => !before.has(x.key))) {
      const [r] = await this.pool.query<mysql.ResultSetHeader>("INSERT IGNORE INTO fin_tax_obligations (obligation_key, model, year, period, period_from, period_to, due_date, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'pendiente',?,?,?)", [s.key, s.model, s.year, s.period, s.from, s.to, s.dueDate, by, at, at]);
      if (r.affectedRows === 1) created.push(r.insertId);
    }
    if (!created.length) return [];
    return this.rows(`SELECT ${OBLIGATION_COLS} FROM fin_tax_obligations WHERE id IN (?) ORDER BY due_date, obligation_key`, [created], obligationRow);
  }
  async saveDraft(id: number, draft: TaxDraft, o: { from: ObligationStatus[]; to: ObligationStatus; amountCents: number | null; outcome: Outcome | null; at: number }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "UPDATE fin_tax_obligations SET status = ?, amount_cents = ?, outcome = ?, draft_json = ?, draft_hash = ?, draft_at = ?, stale = 0, stale_json = NULL, updated_at = ? WHERE id = ? AND status IN (?)",
      [o.to, o.amountCents, o.outcome, JSON.stringify(draft), draft.hash, draft.computedAt, o.at, id, o.from],
    );
    return r.affectedRows === 1;
  }
  async transition(id: number, from: ObligationStatus[], to: ObligationStatus, patch: ObligationPatch, at: number) {
    const { sets, args } = patchSql(patch);
    const [r] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE fin_tax_obligations SET ${[...sets, "status = ?", "updated_at = ?"].join(", ")} WHERE id = ? AND status IN (?)`, [...args, to, at, id, from]);
    return r.affectedRows === 1;
  }
  async patchObligation(id: number, patch: ObligationPatch, at: number) {
    const { sets, args } = patchSql(patch);
    if (!sets.length) return;
    await this.pool.query(`UPDATE fin_tax_obligations SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`, [...args, at, id]);
  }
  async markReminder(id: number, bucket: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_tax_obligations SET last_reminder_days = ? WHERE id = ? AND (last_reminder_days IS NULL OR last_reminder_days > ?)", [bucket, id, bucket]);
    return r.affectedRows === 1;
  }
  async addObligationLog(r: Omit<ObligationLogRow, "id">) {
    await this.pool.query("INSERT INTO fin_tax_obligation_log (obligation_id, at, actor, request_id, action, from_status, to_status, note, detail_json) VALUES (?,?,?,?,?,?,?,?,?)", [r.obligationId, r.at, r.actor, r.requestId, r.action, r.fromStatus, r.toStatus, r.note?.slice(0, 500) ?? null, r.detail ? JSON.stringify(r.detail) : null]);
  }
  async obligationLog(id: number) {
    return this.rows("SELECT * FROM fin_tax_obligation_log WHERE obligation_id = ? ORDER BY id", [id], (r) => ({ id: num(r.id), obligationId: num(r.obligation_id), at: num(r.at), actor: String(r.actor), requestId: strOrNull(r.request_id), action: String(r.action), fromStatus: strOrNull(r.from_status) as ObligationStatus | null, toStatus: strOrNull(r.to_status) as ObligationStatus | null, note: strOrNull(r.note), detail: json<Record<string, unknown>>(r.detail_json) }));
  }

  async listPayrolls(q: { period?: string; from?: string; to?: string; status?: PayrollStatus }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.period) (w.push("period = ?"), a.push(q.period));
    if (q.from) (w.push("period >= ?"), a.push(q.from));
    if (q.to) (w.push("period <= ?"), a.push(q.to));
    if (q.status) (w.push("status = ?"), a.push(q.status));
    return this.rows(`SELECT ${PAYROLL_COLS} FROM fin_payrolls ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY period, employee_alias LIMIT 5000`, a, payrollRow);
  }
  async getPayroll(id: number) {
    return (await this.rows(`SELECT ${PAYROLL_COLS} FROM fin_payrolls WHERE id = ?`, [id], payrollRow))[0] ?? null;
  }
  async upsertDraftPayroll(p: NewPayroll) {
    const vals = [p.grossCents, p.irpfCents, p.ssEmployeeCents, p.ssCompanyCents, p.netCents, p.payDate, p.notes];
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(
        "INSERT INTO fin_payrolls (period, employee_alias, gross_cents, irpf_cents, ss_employee_cents, ss_company_cents, net_cents, pay_date, notes, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?,?)",
        [p.period, p.employeeAlias, ...vals, p.createdBy, p.createdAt, p.createdAt],
      );
      return { payroll: (await this.getPayroll(r.insertId))!, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
    }
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "UPDATE fin_payrolls SET gross_cents = ?, irpf_cents = ?, ss_employee_cents = ?, ss_company_cents = ?, net_cents = ?, pay_date = ?, notes = ?, updated_at = ? WHERE period = ? AND employee_alias = ? AND status = 'draft'",
      [...vals, p.createdAt, p.period, p.employeeAlias],
    );
    if (r.affectedRows !== 1) throw PAYROLL_LOCKED();
    return { payroll: (await this.rows(`SELECT ${PAYROLL_COLS} FROM fin_payrolls WHERE period = ? AND employee_alias = ?`, [p.period, p.employeeAlias], payrollRow))[0], created: false };
  }
  async markPayrollPosted(id: number, entryId: number, at: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_payrolls SET status = 'posted', entry_id = ?, updated_at = ? WHERE id = ? AND status = 'draft'", [entryId, at, id]);
    return r.affectedRows === 1;
  }
  async markPayrollPaid(id: number, o: { entryId: number; paidOn: string; bankAccountId: number; at: number }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_payrolls SET status = 'paid', payment_entry_id = ?, paid_on = ?, bank_account_id = ?, updated_at = ? WHERE id = ? AND status = 'posted'", [o.entryId, o.paidOn, o.bankAccountId, o.at, id]);
    return r.affectedRows === 1;
  }

  private async withInstallments(rows: Row[]): Promise<Deferral[]> {
    if (!rows.length) return [];
    const inst = await this.rows(`SELECT ${INSTALLMENT_COLS} FROM fin_tax_deferral_installments WHERE deferral_id IN (?) ORDER BY deferral_id, number`, [rows.map((r) => num(r.id))], (r) => ({ deferralId: num(r.deferral_id), number: num(r.number), dueDate: String(r.due_date), amountCents: num(r.amount_cents), interestCents: num(r.interest_cents), status: String(r.status) as "pendiente" | "pagada", paidOn: strOrNull(r.paid_on), paidAt: numOrNull(r.paid_at), entryId: numOrNull(r.entry_id) }));
    return rows.map((r) => ({
      id: num(r.id),
      obligationId: num(r.obligation_id),
      status: String(r.status) as DeferralStatus,
      requestedOn: String(r.requested_on),
      resolutionOn: strOrNull(r.resolution_on),
      reference: strOrNull(r.reference),
      principalCents: num(r.principal_cents),
      interestCents: num(r.interest_cents),
      notes: strOrNull(r.notes),
      createdBy: String(r.created_by),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
      installments: inst.filter((x) => x.deferralId === num(r.id)).map(({ deferralId: _d, ...x }) => x),
    }));
  }
  async listDeferrals(q: { status?: DeferralStatus; obligationId?: number }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.obligationId !== undefined) (w.push("obligation_id = ?"), a.push(q.obligationId));
    const [rows] = await this.pool.query<Row[]>(`SELECT ${DEFERRAL_COLS} FROM fin_tax_deferrals ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 500`, a);
    return this.withInstallments(rows);
  }
  async getDeferral(id: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${DEFERRAL_COLS} FROM fin_tax_deferrals WHERE id = ?`, [id]);
    return (await this.withInstallments(rows))[0] ?? null;
  }
  async insertDeferral(d: NewDeferral, installments: Array<Pick<DeferralInstallment, "number" | "dueDate" | "amountCents" | "interestCents">>) {
    const conn = await this.pool.getConnection();
    let id: number;
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<mysql.ResultSetHeader>(
        "INSERT INTO fin_tax_deferrals (obligation_id, status, requested_on, resolution_on, reference, principal_cents, interest_cents, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [d.obligationId, d.status, d.requestedOn, d.resolutionOn, d.reference, d.principalCents, d.interestCents, d.notes, d.createdBy, d.createdAt, d.createdAt],
      );
      id = r.insertId;
      await conn.query("INSERT INTO fin_tax_deferral_installments (deferral_id, number, due_date, amount_cents, interest_cents, status) VALUES ?", [installments.map((x) => [id, x.number, x.dueDate, x.amountCents, x.interestCents, "pendiente"])]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
    return (await this.getDeferral(id))!;
  }
  async patchDeferral(id: number, p: Partial<Pick<Deferral, "status" | "resolutionOn" | "reference" | "notes">>, at: number) {
    const map: Record<string, string> = { status: "status", resolutionOn: "resolution_on", reference: "reference", notes: "notes" };
    const entries = Object.entries(p).filter(([, v]) => v !== undefined);
    if (entries.length) await this.pool.query(`UPDATE fin_tax_deferrals SET ${entries.map(([k]) => `${map[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...entries.map(([, v]) => v), at, id]);
    return this.getDeferral(id);
  }
  async payInstallment(deferralId: number, n: number, o: { entryId: number; paidOn: string; by: string; at: number }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_tax_deferral_installments SET status = 'pagada', entry_id = ?, paid_on = ?, paid_by = ?, paid_at = ? WHERE deferral_id = ? AND number = ? AND status = 'pendiente'", [o.entryId, o.paidOn, o.by, o.at, deferralId, n]);
    return r.affectedRows === 1;
  }

  async listDossiers(q: { status?: DossierStatus }) {
    return this.rows(`SELECT ${DOSSIER_COLS} FROM fin_tax_dossiers ${q.status ? "WHERE status = ?" : ""} ORDER BY id DESC LIMIT 500`, q.status ? [q.status] : [], dossierRow);
  }
  async getDossier(id: number) {
    return (await this.rows(`SELECT ${DOSSIER_COLS} FROM fin_tax_dossiers WHERE id = ?`, [id], dossierRow))[0] ?? null;
  }
  async insertDossier(d: NewDossier) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT INTO fin_tax_dossiers (kind, agency, reference, subject, notified_on, response_due_on, status, obligation_id, notes, created_by, created_at, updated_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [d.kind, d.agency, d.reference, d.subject, d.notifiedOn, d.responseDueOn, d.status, d.obligationId, d.notes, d.createdBy, d.createdAt, d.createdAt, d.status === "cerrado" ? d.createdAt : null],
    );
    return (await this.getDossier(r.insertId))!;
  }
  async patchDossier(id: number, p: DossierPatch, at: number) {
    const map: Record<keyof DossierPatch, string> = { kind: "kind", agency: "agency", reference: "reference", subject: "subject", notifiedOn: "notified_on", responseDueOn: "response_due_on", status: "status", obligationId: "obligation_id", notes: "notes" };
    const entries = (Object.entries(p) as Array<[keyof DossierPatch, unknown]>).filter(([, v]) => v !== undefined);
    const sets = entries.map(([k]) => `${map[k]} = ?`);
    const args = entries.map(([, v]) => v);
    if (p.status) {
      sets.push(p.status === "cerrado" ? "closed_at = COALESCE(closed_at, ?)" : "closed_at = NULL");
      if (p.status === "cerrado") args.push(at);
    }
    await this.pool.query(`UPDATE fin_tax_dossiers SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`, [...args, at, id]);
    return this.getDossier(id);
  }
  async addDossierLog(r: Omit<DossierLogRow, "id">) {
    await this.pool.query("INSERT INTO fin_tax_dossier_log (dossier_id, at, actor, request_id, action, note, detail_json) VALUES (?,?,?,?,?,?,?)", [r.dossierId, r.at, r.actor, r.requestId, r.action, r.note?.slice(0, 2000) ?? null, r.detail ? JSON.stringify(r.detail) : null]);
  }
  async dossierLog(id: number) {
    return this.rows("SELECT * FROM fin_tax_dossier_log WHERE dossier_id = ? ORDER BY id", [id], (r) => ({ id: num(r.id), dossierId: num(r.dossier_id), at: num(r.at), actor: String(r.actor), requestId: strOrNull(r.request_id), action: String(r.action), note: strOrNull(r.note), detail: json<Record<string, unknown>>(r.detail_json) }));
  }

  async listAdjustments(year: number) {
    return this.rows("SELECT * FROM fin_tax_corporate_adjustments WHERE year = ? ORDER BY id", [year], adjustmentRow);
  }
  async insertAdjustment(a: Omit<CorporateAdjustment, "id" | "status" | "voidedBy" | "voidedAt" | "voidReason">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("INSERT INTO fin_tax_corporate_adjustments (year, kind, description, amount_cents, origin_year, status, created_by, created_at) VALUES (?,?,?,?,?,'active',?,?)", [a.year, a.kind, a.description, a.amountCents, a.originYear, a.createdBy, a.createdAt]);
    return (await this.rows("SELECT * FROM fin_tax_corporate_adjustments WHERE id = ?", [r.insertId], adjustmentRow))[0];
  }
  async voidAdjustment(id: number, o: { by: string; at: number; reason: string }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_tax_corporate_adjustments SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ? AND status = 'active'", [o.by, o.at, o.reason, id]);
    return r.affectedRows === 1;
  }
}

/** ¿Existe la migración 0037 (gestoría e impuestos)? */
export async function finTaxTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["fin_tax_settings", "fin_tax_obligations", "fin_tax_obligation_log", "fin_payrolls", "fin_tax_deferrals", "fin_tax_dossiers", "fin_tax_corporate_adjustments"]) {
    const ok = await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(
      () => true,
      () => false,
    );
    if (!ok) return false;
  }
  return true;
}
