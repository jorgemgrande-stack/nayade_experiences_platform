/**
 * Almacén de las operaciones (CRM 0035): memoria (pruebas) y MySQL. Garantías:
 *  - nada se borra: los gastos y pagos se anulan o revierten, los documentos se archivan;
 *  - transiciones de estado CONDICIONALES (`… WHERE status = ?`): dos peticiones simultáneas sobre el mismo gasto,
 *    pago o movimiento no pueden ganar las dos;
 *  - un extracto una sola vez por cuenta (sha256) y cada movimiento una sola vez por cuenta (clave de duplicado);
 *  - una factura por proveedor y número mientras no esté anulada; un borrador por periodo de cada plantilla recurrente.
 */
import type mysql from "mysql2/promise";
import { payableOf, paymentStatusOf } from "./opsRules";
import {
  type BankAccount,
  type BankImport,
  type BankMovement,
  type CashAccount,
  type CashMovement,
  type CostCenter,
  type DocumentOwner,
  type Expense,
  type ExpenseCategory,
  type ExpensePayment,
  type ExpenseStatus,
  type ExpensePaymentStatus,
  type FinDocument,
  type MatchType,
  type MovementStatus,
  type ParsedMovement,
  type PaymentRowStatus,
  type RecurringExpense,
  type Supplier,
  type VatTreatment,
} from "./opsTypes";
import { FinanceError } from "./types";

export const OPS_MAX_PAGE = 500;

export interface ExpenseRow extends Expense {
  supplierName: string | null;
}

export interface ExpenseQuery {
  status?: ExpenseStatus;
  paymentStatus?: ExpensePaymentStatus;
  supplierId?: number;
  categoryId?: number;
  costCenterId?: number;
  from?: string;
  to?: string;
  q?: string;
  /** Solo registrados, sin pagar del todo y con vencimiento anterior a esta fecha. */
  overdueBefore?: string;
  sort?: "invoiceDate" | "dueDate" | "totalCents" | "supplier";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface MovementQuery {
  bankAccountId?: number;
  status?: MovementStatus;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export type NewExpense = Omit<Expense, "id" | "registeredBy" | "registeredAt" | "voidedBy" | "voidedAt" | "voidReason" | "entryId" | "paidCents" | "paymentStatus" | "status"> & { status?: "draft" };
export type ExpenseEdit = Partial<Pick<Expense, "supplierId" | "categoryId" | "costCenterId" | "invoiceNumber" | "invoiceDate" | "accrualDate" | "dueDate" | "description" | "baseCents" | "taxRateBp" | "taxCents" | "deductibleBp" | "withholdingRateBp" | "withholdingCents" | "totalCents" | "kind" | "rectifiesExpenseId" | "vatTreatment" | "reverseChargeRateBp" | "settlesStripeFees">>;
export type SupplierEdit = Partial<Omit<Supplier, "id" | "createdAt" | "createdBy">>;
export type RecurringEdit = Partial<Omit<RecurringExpense, "id" | "createdAt" | "createdBy">>;

export interface FinanceOpsStore {
  listCostCenters(): Promise<CostCenter[]>;
  getCostCenter(id: number): Promise<CostCenter | null>;
  insertCostCenter(c: { code: string; name: string; createdAt: number }): Promise<CostCenter>;
  patchCostCenter(id: number, p: { code?: string; name?: string; active?: boolean }): Promise<CostCenter | null>;

  listCategories(): Promise<ExpenseCategory[]>;
  getCategory(id: number): Promise<ExpenseCategory | null>;
  insertCategory(c: { name: string; accountCode: string; defaultTaxRateBp: number | null; createdAt: number }): Promise<ExpenseCategory>;
  patchCategory(id: number, p: { name?: string; accountCode?: string; defaultTaxRateBp?: number | null; active?: boolean }): Promise<ExpenseCategory | null>;

  listSuppliers(q: { q?: string; active?: boolean; limit?: number; offset?: number }): Promise<{ items: Supplier[]; total: number }>;
  getSupplier(id: number): Promise<Supplier | null>;
  insertSupplier(s: Omit<Supplier, "id">): Promise<Supplier>;
  patchSupplier(id: number, p: SupplierEdit): Promise<Supplier | null>;

  listExpenses(q: ExpenseQuery): Promise<{ items: ExpenseRow[]; total: number }>;
  getExpense(id: number): Promise<ExpenseRow | null>;
  getExpensesByIds(ids: number[]): Promise<ExpenseRow[]>;
  /** Borrador nuevo. Con `sourceKey` ya usada devuelve el existente (`created: false`). */
  insertExpense(e: NewExpense): Promise<{ expense: ExpenseRow; created: boolean }>;
  /** Solo borradores; `invalid_state` si ya no lo es. */
  patchDraftExpense(id: number, p: ExpenseEdit): Promise<ExpenseRow>;
  /** draft → registered con su asiento; false si ya no era borrador. */
  markExpenseRegistered(id: number, entryId: number, by: string, at: number): Promise<boolean>;
  /** CRM 0039: factura de comisiones de Stripe registrada: pagada con el saldo de Stripe (sin pagos). */
  markExpenseSettled(id: number): Promise<void>;
  /** `from` → void; false si ya no estaba en ese estado. */
  markExpenseVoid(id: number, from: ExpenseStatus, o: { by: string; at: number; reason: string }): Promise<boolean>;
  /** Recalcula lo pagado (pagos vigentes) y el estado de pago. */
  refreshExpensePaid(id: number): Promise<ExpenseRow>;
  existingExpenseSources(keys: string[]): Promise<Set<string>>;
  /** Registrados con algo pendiente (para sugerencias), como mucho `limit`. */
  openExpenses(limit: number): Promise<ExpenseRow[]>;
  /** Tratamiento del IVA de los gastos cuyo asiento es uno de estos (CRM 0039; null = interior). */
  expenseTreatmentsByEntries(entryIds: number[]): Promise<Map<number, VatTreatment | null>>;

  listPayments(expenseIds: number[]): Promise<ExpensePayment[]>;
  getPayment(id: number): Promise<ExpensePayment | null>;
  /**
   * Guarda un pago vigente COMPROBANDO lo pendiente con la fila del gasto bloqueada (`SELECT … FOR UPDATE` en MySQL;
   * en memoria, sin esperas entre la comprobación y el alta): dos pagos simultáneos no pueden superar lo pendiente.
   * `invalid_state` si el gasto no está registrado; `invalid_input` si el signo no es el de lo pendiente;
   * `exceeds_pending` (409) si el importe supera lo pendiente (total − retención − pagos vigentes).
   */
  insertPayment(p: Omit<ExpensePayment, "id" | "reversedBy" | "reversedAt" | "reverseReason" | "entryId" | "status">): Promise<ExpensePayment>;
  setPaymentEntry(id: number, entryId: number): Promise<void>;
  /** posted → reversed | void; false si ya no estaba vigente. */
  markPayment(id: number, status: Exclude<PaymentRowStatus, "posted">, o: { by: string; at: number; reason: string }): Promise<boolean>;
  /** Vincula (o desvincula con null) un pago y un movimiento; condicional al vínculo actual `expect`. */
  linkPaymentMovement(id: number, movementId: number | null, expect: number | null): Promise<boolean>;
  /** Pagos vigentes sin movimiento bancario de esa cuenta (o sin cuenta), para sugerencias. */
  openPayments(bankAccountId: number, limit: number): Promise<ExpensePayment[]>;

  insertDocument(d: Omit<FinDocument, "id" | "archived" | "archivedAt" | "archivedBy">, content: Buffer): Promise<FinDocument>;
  listDocuments(ownerType: DocumentOwner, ownerId: number): Promise<FinDocument[]>;
  getDocument(id: number): Promise<FinDocument | null>;
  getDocumentContent(id: number): Promise<Buffer | null>;
  archiveDocument(id: number, by: string, at: number): Promise<FinDocument | null>;

  listRecurring(): Promise<RecurringExpense[]>;
  getRecurring(id: number): Promise<RecurringExpense | null>;
  insertRecurring(r: Omit<RecurringExpense, "id">): Promise<RecurringExpense>;
  patchRecurring(id: number, p: RecurringEdit): Promise<RecurringExpense | null>;

  listBankAccounts(): Promise<BankAccount[]>;
  getBankAccount(id: number): Promise<BankAccount | null>;
  insertBankAccount(b: Omit<BankAccount, "id">): Promise<BankAccount>;
  patchBankAccount(id: number, p: { name?: string; bankName?: string | null; active?: boolean }): Promise<BankAccount | null>;

  findImport(bankAccountId: number, sha256: string): Promise<BankImport | null>;
  /** Guarda el extracto y sus movimientos en una transacción; los repetidos (misma clave por cuenta) se cuentan. */
  importMovements(imp: Omit<BankImport, "id" | "inserted" | "duplicates">, rows: ParsedMovement[]): Promise<BankImport>;
  listImports(bankAccountId?: number): Promise<BankImport[]>;
  getImport(id: number): Promise<BankImport | null>;
  listMovements(q: MovementQuery): Promise<{ items: BankMovement[]; total: number }>;
  getMovement(id: number): Promise<BankMovement | null>;
  /** Cambio de estado condicional (`from` → `to`); con `bump` suma una conciliación. Null si ya no estaba en `from`. */
  claimMovement(id: number, o: { from: MovementStatus; to: MovementStatus; matchType: MatchType | null; by: string; at: number; bump: boolean }): Promise<BankMovement | null>;
  setMovementMatch(id: number, matchId: number | null, entryId: number | null): Promise<void>;
  /** Vuelve a pendiente (sin conciliación) si estaba en `from`. */
  releaseMovement(id: number, from: MovementStatus): Promise<boolean>;
  /** Movimientos conciliados de un tipo con estos destinos (fase 2: cobros de facturas por transferencia). */
  movementsByMatch(matchType: MatchType, matchIds: number[]): Promise<BankMovement[]>;
  getMovementsByIds(ids: number[]): Promise<BankMovement[]>;

  listCashAccounts(): Promise<CashAccount[]>;
  getCashAccount(id: number): Promise<CashAccount | null>;
  insertCashAccount(c: Omit<CashAccount, "id">): Promise<CashAccount>;
  listCashMovements(q: { cashAccountId?: number; limit?: number; offset?: number }): Promise<{ items: CashMovement[]; total: number }>;
  insertCashMovement(m: Omit<CashMovement, "id" | "entryId" | "status">): Promise<CashMovement>;
  setCashMovementEntry(id: number, entryId: number): Promise<void>;
  voidCashMovement(id: number): Promise<void>;
}

const page = (limit: number | undefined, offset: number | undefined) => ({ limit: Math.max(1, Math.min(limit ?? 50, OPS_MAX_PAGE)), offset: Math.max(0, offset ?? 0) });
const dupConflict = (what: string) => new FinanceError("conflict", what);
const liveNumber = (e: Pick<Expense, "status" | "invoiceNumber">) => (e.status === "void" ? null : e.invoiceNumber);
const NUMBER_TAKEN = "Ya hay una factura de este proveedor con ese número";

/** Comprobación de un pago frente al gasto (bajo bloqueo). `paid` = suma de los pagos vigentes. */
export function paymentProblem(e: Pick<Expense, "status" | "totalCents" | "withholdingCents"> | null, paid: number, amountCents: number): FinanceError | null {
  if (!e) return new FinanceError("not_found", "Gasto no encontrado");
  if (e.status !== "registered") return new FinanceError("invalid_state", "Solo se pagan gastos registrados");
  const pending = payableOf(e) - paid;
  if (pending === 0) return new FinanceError("exceeds_pending", "El gasto ya está pagado");
  if (Math.sign(amountCents) !== Math.sign(pending)) return new FinanceError("invalid_input", pending > 0 ? "El importe del pago es positivo" : "En una rectificativa el importe (devolución) es negativo");
  if (Math.abs(amountCents) > Math.abs(pending)) return new FinanceError("exceeds_pending", `El importe supera lo pendiente de pago (${(pending / 100).toFixed(2).replace(".", ",")} €)`);
  return null;
}

// ── Memoria ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class MemoryFinanceOpsStore implements FinanceOpsStore {
  costCenters: CostCenter[] = [];
  categories: ExpenseCategory[] = [];
  suppliers: Supplier[] = [];
  expenses: Expense[] = [];
  payments: ExpensePayment[] = [];
  documents: Array<FinDocument & { content: Buffer }> = [];
  recurring: RecurringExpense[] = [];
  banks: BankAccount[] = [];
  imports: BankImport[] = [];
  movements: BankMovement[] = [];
  cash: CashAccount[] = [];
  cashMovements: CashMovement[] = [];

  constructor(seed?: { costCenters?: Array<Omit<CostCenter, "id">>; categories?: Array<Omit<ExpenseCategory, "id">> }) {
    for (const c of seed?.costCenters ?? []) this.costCenters.push({ ...c, id: this.costCenters.length + 1 });
    for (const c of seed?.categories ?? []) this.categories.push({ ...c, id: this.categories.length + 1 });
  }
  private c = <T>(x: T): T => structuredClone(x);
  private row(e: Expense): ExpenseRow {
    return this.c({ ...e, supplierName: this.suppliers.find((s) => s.id === e.supplierId)?.name ?? null });
  }

  async listCostCenters() {
    return this.c([...this.costCenters].sort((a, b) => a.code.localeCompare(b.code)));
  }
  async getCostCenter(id: number) {
    return this.c(this.costCenters.find((x) => x.id === id) ?? null);
  }
  async insertCostCenter(c: { code: string; name: string; createdAt: number }) {
    if (this.costCenters.some((x) => x.code === c.code)) throw dupConflict(`Ya existe el centro de coste ${c.code}`);
    const row = { id: this.costCenters.length + 1, code: c.code, name: c.name, active: true };
    this.costCenters.push(row);
    return this.c(row);
  }
  async patchCostCenter(id: number, p: { code?: string; name?: string; active?: boolean }) {
    const x = this.costCenters.find((r) => r.id === id);
    if (!x) return null;
    if (p.code !== undefined && this.costCenters.some((r) => r.code === p.code && r.id !== id)) throw dupConflict(`Ya existe el centro de coste ${p.code}`);
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return this.c(x);
  }

  async listCategories() {
    return this.c([...this.categories].sort((a, b) => a.name.localeCompare(b.name, "es")));
  }
  async getCategory(id: number) {
    return this.c(this.categories.find((x) => x.id === id) ?? null);
  }
  async insertCategory(c: { name: string; accountCode: string; defaultTaxRateBp: number | null; createdAt: number }) {
    if (this.categories.some((x) => x.name === c.name)) throw dupConflict(`Ya existe la categoría «${c.name}»`);
    const row = { id: this.categories.length + 1, name: c.name, accountCode: c.accountCode, defaultTaxRateBp: c.defaultTaxRateBp, active: true };
    this.categories.push(row);
    return this.c(row);
  }
  async patchCategory(id: number, p: { name?: string; accountCode?: string; defaultTaxRateBp?: number | null; active?: boolean }) {
    const x = this.categories.find((r) => r.id === id);
    if (!x) return null;
    if (p.name !== undefined && this.categories.some((r) => r.name === p.name && r.id !== id)) throw dupConflict(`Ya existe la categoría «${p.name}»`);
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return this.c(x);
  }

  async listSuppliers(q: { q?: string; active?: boolean; limit?: number; offset?: number }) {
    const t = q.q?.toLowerCase();
    const all = this.suppliers
      .filter((s) => (q.active === undefined || s.active === q.active) && (!t || [s.name, s.legalName ?? "", s.taxId ?? ""].some((v) => v.toLowerCase().includes(t))))
      .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id - b.id);
    const p = page(q.limit, q.offset);
    return { items: this.c(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async getSupplier(id: number) {
    return this.c(this.suppliers.find((x) => x.id === id) ?? null);
  }
  async insertSupplier(s: Omit<Supplier, "id">) {
    if (s.taxId && this.suppliers.some((x) => x.taxId === s.taxId)) throw dupConflict(`Ya existe un proveedor con el NIF ${s.taxId}`);
    const row = { ...s, id: this.suppliers.length + 1 };
    this.suppliers.push(row);
    return this.c(row);
  }
  async patchSupplier(id: number, p: SupplierEdit) {
    const x = this.suppliers.find((r) => r.id === id);
    if (!x) return null;
    if (p.taxId && this.suppliers.some((r) => r.taxId === p.taxId && r.id !== id)) throw dupConflict(`Ya existe un proveedor con el NIF ${p.taxId}`);
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return this.c(x);
  }

  async listExpenses(q: ExpenseQuery) {
    const t = q.q?.toLowerCase();
    const rows = this.expenses.map((e) => this.row(e));
    const all = rows.filter(
      (e) =>
        (!q.status || e.status === q.status) &&
        (!q.paymentStatus || e.paymentStatus === q.paymentStatus) &&
        (!q.supplierId || e.supplierId === q.supplierId) &&
        (!q.categoryId || e.categoryId === q.categoryId) &&
        (!q.costCenterId || e.costCenterId === q.costCenterId) &&
        (!q.from || e.invoiceDate >= q.from) &&
        (!q.to || e.invoiceDate <= q.to) &&
        (!q.overdueBefore || (e.status === "registered" && e.paymentStatus !== "paid" && !!e.dueDate && e.dueDate < q.overdueBefore)) &&
        (!t || [e.invoiceNumber ?? "", e.description, e.supplierName ?? ""].some((v) => v.toLowerCase().includes(t))),
    );
    const k = q.dir === "asc" ? 1 : -1;
    const key = q.sort ?? "invoiceDate";
    all.sort((a, b) => {
      const c = key === "totalCents" ? a.totalCents - b.totalCents : key === "supplier" ? (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "es") : key === "dueDate" ? (a.dueDate ?? "").localeCompare(b.dueDate ?? "") : a.invoiceDate.localeCompare(b.invoiceDate);
      return k * (c || a.id - b.id);
    });
    const p = page(q.limit, q.offset);
    return { items: all.slice(p.offset, p.offset + p.limit), total: all.length };
  }
  async getExpense(id: number) {
    const e = this.expenses.find((x) => x.id === id);
    return e ? this.row(e) : null;
  }
  async getExpensesByIds(ids: number[]) {
    const set = new Set(ids);
    return this.expenses.filter((e) => set.has(e.id)).map((e) => this.row(e));
  }
  async insertExpense(e: NewExpense) {
    if (e.sourceKey) {
      const dup = this.expenses.find((x) => x.sourceKey === e.sourceKey);
      if (dup) return { expense: this.row(dup), created: false };
    }
    const row: Expense = { ...e, id: this.expenses.length + 1, status: "draft", entryId: null, paidCents: 0, paymentStatus: "pending", registeredBy: null, registeredAt: null, voidedBy: null, voidedAt: null, voidReason: null };
    this.assertNumberFree(row);
    this.expenses.push(row);
    return { expense: this.row(row), created: true };
  }
  private assertNumberFree(e: Expense) {
    const n = liveNumber(e);
    if (n !== null && e.supplierId !== null && this.expenses.some((x) => x.id !== e.id && x.supplierId === e.supplierId && liveNumber(x) === n)) throw dupConflict(NUMBER_TAKEN);
  }
  async patchDraftExpense(id: number, p: ExpenseEdit) {
    const e = this.expenses.find((x) => x.id === id);
    if (!e) throw new FinanceError("not_found", "Gasto no encontrado");
    if (e.status !== "draft") throw new FinanceError("invalid_state", "Solo se edita un gasto en borrador");
    const next = { ...e, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Expense;
    this.assertNumberFree(next);
    Object.assign(e, next);
    return this.row(e);
  }
  async markExpenseRegistered(id: number, entryId: number, by: string, at: number) {
    const e = this.expenses.find((x) => x.id === id);
    if (!e || e.status !== "draft") return false;
    Object.assign(e, { status: "registered", entryId, registeredBy: by, registeredAt: at });
    return true;
  }
  async markExpenseSettled(id: number) {
    const e = this.expenses.find((x) => x.id === id);
    if (e) Object.assign(e, { paidCents: e.totalCents - e.withholdingCents, paymentStatus: "paid" });
  }
  async markExpenseVoid(id: number, from: ExpenseStatus, o: { by: string; at: number; reason: string }) {
    const e = this.expenses.find((x) => x.id === id);
    if (!e || e.status !== from) return false;
    Object.assign(e, { status: "void", voidedBy: o.by, voidedAt: o.at, voidReason: o.reason });
    return true;
  }
  async refreshExpensePaid(id: number) {
    const e = this.expenses.find((x) => x.id === id)!;
    e.paidCents = this.payments.filter((p) => p.expenseId === id && p.status === "posted").reduce((a, p) => a + p.amountCents, 0);
    e.paymentStatus = paymentStatusOf(payableOf(e), e.paidCents);
    return this.row(e);
  }
  async existingExpenseSources(keys: string[]) {
    const set = new Set(keys);
    return new Set(this.expenses.filter((e) => e.sourceKey && set.has(e.sourceKey)).map((e) => e.sourceKey!));
  }
  async expenseTreatmentsByEntries(entryIds: number[]) {
    const want = new Set(entryIds);
    return new Map(this.expenses.filter((e) => e.entryId !== null && want.has(e.entryId)).map((e) => [e.entryId!, e.vatTreatment ?? null]));
  }
  async openExpenses(limit: number) {
    return this.expenses
      .filter((e) => e.status === "registered" && e.paymentStatus !== "paid")
      .slice(-limit)
      .map((e) => this.row(e));
  }

  async listPayments(expenseIds: number[]) {
    const set = new Set(expenseIds);
    return this.c(this.payments.filter((p) => set.has(p.expenseId)).sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id));
  }
  async getPayment(id: number) {
    return this.c(this.payments.find((x) => x.id === id) ?? null);
  }
  async insertPayment(p: Omit<ExpensePayment, "id" | "reversedBy" | "reversedAt" | "reverseReason" | "entryId" | "status">) {
    // Sin `await` entre la comprobación y el alta: serializado frente a otros pagos del mismo gasto
    const e = this.expenses.find((x) => x.id === p.expenseId) ?? null;
    const paid = this.payments.filter((x) => x.expenseId === p.expenseId && x.status === "posted").reduce((a, x) => a + x.amountCents, 0);
    const problem = paymentProblem(e, paid, p.amountCents);
    if (problem) throw problem;
    const row: ExpensePayment = { ...p, id: this.payments.length + 1, entryId: null, status: "posted", reversedBy: null, reversedAt: null, reverseReason: null };
    this.payments.push(row);
    return this.c(row);
  }
  async setPaymentEntry(id: number, entryId: number) {
    this.payments.find((x) => x.id === id)!.entryId = entryId;
  }
  async markPayment(id: number, status: Exclude<PaymentRowStatus, "posted">, o: { by: string; at: number; reason: string }) {
    const p = this.payments.find((x) => x.id === id);
    if (!p || p.status !== "posted") return false;
    Object.assign(p, { status, reversedBy: o.by, reversedAt: o.at, reverseReason: o.reason });
    return true;
  }
  async linkPaymentMovement(id: number, movementId: number | null, expect: number | null) {
    const p = this.payments.find((x) => x.id === id);
    if (!p || p.bankMovementId !== expect || (movementId !== null && p.status !== "posted")) return false;
    p.bankMovementId = movementId;
    return true;
  }
  async openPayments(bankAccountId: number, limit: number) {
    return this.c(this.payments.filter((p) => p.status === "posted" && p.bankMovementId === null && (p.bankAccountId === bankAccountId || (p.bankAccountId === null && p.cashAccountId === null))).slice(-limit));
  }

  async insertDocument(d: Omit<FinDocument, "id" | "archived" | "archivedAt" | "archivedBy">, content: Buffer) {
    const row = { ...d, id: this.documents.length + 1, archived: false, archivedAt: null, archivedBy: null, content: Buffer.from(content) };
    this.documents.push(row);
    const { content: _c, ...doc } = row;
    return this.c(doc);
  }
  async listDocuments(ownerType: DocumentOwner, ownerId: number) {
    return this.documents.filter((d) => d.ownerType === ownerType && d.ownerId === ownerId).map(({ content: _c, ...d }) => this.c(d));
  }
  async getDocument(id: number) {
    const d = this.documents.find((x) => x.id === id);
    if (!d) return null;
    const { content: _c, ...doc } = d;
    return this.c(doc);
  }
  async getDocumentContent(id: number) {
    const d = this.documents.find((x) => x.id === id);
    return d ? Buffer.from(d.content) : null;
  }
  async archiveDocument(id: number, by: string, at: number) {
    const d = this.documents.find((x) => x.id === id);
    if (!d) return null;
    if (!d.archived) Object.assign(d, { archived: true, archivedAt: at, archivedBy: by });
    return this.getDocument(id);
  }

  async listRecurring() {
    return this.c(this.recurring);
  }
  async getRecurring(id: number) {
    return this.c(this.recurring.find((x) => x.id === id) ?? null);
  }
  async insertRecurring(r: Omit<RecurringExpense, "id">) {
    const row = { ...r, id: this.recurring.length + 1 };
    this.recurring.push(row);
    return this.c(row);
  }
  async patchRecurring(id: number, p: RecurringEdit) {
    const x = this.recurring.find((r) => r.id === id);
    if (!x) return null;
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return this.c(x);
  }

  async listBankAccounts() {
    return this.c(this.banks);
  }
  async getBankAccount(id: number) {
    return this.c(this.banks.find((x) => x.id === id) ?? null);
  }
  async insertBankAccount(b: Omit<BankAccount, "id">) {
    if (b.iban && this.banks.some((x) => x.iban === b.iban)) throw dupConflict("Ya hay una cuenta bancaria con ese IBAN");
    if (this.banks.some((x) => x.accountCode === b.accountCode)) throw dupConflict(`La subcuenta ${b.accountCode} ya tiene banco`);
    const row = { ...b, id: this.banks.length + 1 };
    this.banks.push(row);
    return this.c(row);
  }
  async patchBankAccount(id: number, p: { name?: string; bankName?: string | null; active?: boolean }) {
    const x = this.banks.find((r) => r.id === id);
    if (!x) return null;
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return this.c(x);
  }

  async findImport(bankAccountId: number, sha256: string) {
    return this.c(this.imports.find((x) => x.bankAccountId === bankAccountId && x.sha256 === sha256) ?? null);
  }
  async importMovements(imp: Omit<BankImport, "id" | "inserted" | "duplicates">, rows: ParsedMovement[]) {
    if (this.imports.some((x) => x.bankAccountId === imp.bankAccountId && x.sha256 === imp.sha256)) throw dupConflict("Este extracto ya se importó en esta cuenta");
    const row: BankImport = { ...imp, id: this.imports.length + 1, inserted: 0, duplicates: 0 };
    for (const m of rows) {
      if (this.movements.some((x) => x.bankAccountId === imp.bankAccountId && x.duplicateKey === m.duplicateKey)) {
        row.duplicates++;
        continue;
      }
      this.movements.push({ ...m, id: this.movements.length + 1, bankAccountId: imp.bankAccountId, importId: row.id, status: "pending", matchType: null, matchId: null, entryId: null, matchCount: 0, matchedBy: null, matchedAt: null, createdAt: imp.createdAt });
      row.inserted++;
    }
    this.imports.push(row);
    return this.c(row);
  }
  async listImports(bankAccountId?: number) {
    return this.c(this.imports.filter((x) => !bankAccountId || x.bankAccountId === bankAccountId).sort((a, b) => b.id - a.id));
  }
  async getImport(id: number) {
    return this.c(this.imports.find((x) => x.id === id) ?? null);
  }
  async listMovements(q: MovementQuery) {
    const t = q.q?.toLowerCase();
    const all = this.movements
      .filter(
        (m) =>
          (!q.bankAccountId || m.bankAccountId === q.bankAccountId) &&
          (!q.status || m.status === q.status) &&
          (!q.from || m.bookingDate >= q.from) &&
          (!q.to || m.bookingDate <= q.to) &&
          (!t || [m.description, m.reference ?? "", m.counterparty ?? ""].some((v) => v.toLowerCase().includes(t)) || String(Math.abs(m.amountCents)) === q.q),
      )
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || b.id - a.id);
    const p = page(q.limit, q.offset);
    return { items: this.c(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async getMovement(id: number) {
    return this.c(this.movements.find((x) => x.id === id) ?? null);
  }
  async claimMovement(id: number, o: { from: MovementStatus; to: MovementStatus; matchType: MatchType | null; by: string; at: number; bump: boolean }) {
    const m = this.movements.find((x) => x.id === id);
    if (!m || m.status !== o.from) return null;
    Object.assign(m, { status: o.to, matchType: o.matchType, matchId: null, entryId: null, matchedBy: o.by, matchedAt: o.at, matchCount: m.matchCount + (o.bump ? 1 : 0) });
    return this.c(m);
  }
  async setMovementMatch(id: number, matchId: number | null, entryId: number | null) {
    Object.assign(this.movements.find((x) => x.id === id)!, { matchId, entryId });
  }
  async releaseMovement(id: number, from: MovementStatus) {
    const m = this.movements.find((x) => x.id === id);
    if (!m || m.status !== from) return false;
    Object.assign(m, { status: "pending", matchType: null, matchId: null, entryId: null, matchedBy: null, matchedAt: null });
    return true;
  }
  async movementsByMatch(matchType: MatchType, matchIds: number[]) {
    return this.c(this.movements.filter((m) => m.status === "matched" && m.matchType === matchType && m.matchId !== null && matchIds.includes(m.matchId)));
  }
  async getMovementsByIds(ids: number[]) {
    return this.c(this.movements.filter((m) => ids.includes(m.id)));
  }

  async listCashAccounts() {
    return this.c(this.cash);
  }
  async getCashAccount(id: number) {
    return this.c(this.cash.find((x) => x.id === id) ?? null);
  }
  async insertCashAccount(c: Omit<CashAccount, "id">) {
    const row = { ...c, id: this.cash.length + 1 };
    this.cash.push(row);
    return this.c(row);
  }
  async listCashMovements(q: { cashAccountId?: number; limit?: number; offset?: number }) {
    const all = this.cashMovements.filter((m) => !q.cashAccountId || m.cashAccountId === q.cashAccountId).sort((a, b) => b.movedOn.localeCompare(a.movedOn) || b.id - a.id);
    const p = page(q.limit, q.offset);
    return { items: this.c(all.slice(p.offset, p.offset + p.limit)), total: all.length };
  }
  async insertCashMovement(m: Omit<CashMovement, "id" | "entryId" | "status">) {
    const row: CashMovement = { ...m, id: this.cashMovements.length + 1, entryId: null, status: "posted" };
    this.cashMovements.push(row);
    return this.c(row);
  }
  async setCashMovementEntry(id: number, entryId: number) {
    this.cashMovements.find((x) => x.id === id)!.entryId = entryId;
  }
  async voidCashMovement(id: number) {
    this.cashMovements.find((x) => x.id === id)!.status = "void";
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => Number(v) === 1;
const isDup = (e: unknown) => (e as { code?: string }).code === "ER_DUP_ENTRY";
const dupKeyOf = (e: unknown) => String((e as { message?: string }).message ?? "");
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
/** Fecha como texto: mysql2 convertiría DATE a un Date en la zona del proceso. */
const day = (col: string, alias = col) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${alias}`;

const costCenterRow = (r: Row): CostCenter => ({ id: num(r.id), code: String(r.code), name: String(r.name), active: bool(r.active) });
const categoryRow = (r: Row): ExpenseCategory => ({ id: num(r.id), name: String(r.name), accountCode: String(r.account_code), defaultTaxRateBp: numOrNull(r.default_tax_rate_bp), active: bool(r.active) });
const supplierRow = (r: Row): Supplier => ({
  id: num(r.id),
  name: String(r.name),
  legalName: strOrNull(r.legal_name),
  taxId: strOrNull(r.tax_id),
  country: String(r.country),
  address: strOrNull(r.address),
  email: strOrNull(r.email),
  phone: strOrNull(r.phone),
  iban: strOrNull(r.iban),
  paymentTermsDays: numOrNull(r.payment_terms_days),
  defaultCategoryId: numOrNull(r.default_category_id),
  defaultCostCenterId: numOrNull(r.default_cost_center_id),
  accountCode: String(r.account_code) as Supplier["accountCode"],
  notes: strOrNull(r.notes),
  active: bool(r.active),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
});
const EXPENSE_COLS = `x.id, x.supplier_id, x.category_id, x.cost_center_id, x.invoice_number, ${day("x.invoice_date", "invoice_day")}, ${day("x.accrual_date", "accrual_day")}, ${day("x.due_date", "due_day")}, x.description, x.base_cents, x.tax_rate_bp, x.tax_cents, x.deductible_bp, x.withholding_rate_bp, x.withholding_cents, x.total_cents, x.paid_cents, x.currency, x.kind, x.rectifies_expense_id, x.status, x.entry_id, x.payment_status, x.source_key, x.created_by, x.created_at, x.registered_by, x.registered_at, x.voided_by, x.voided_at, x.void_reason, s.name AS supplier_name`;
const EXPENSE_FROM = "fin_expenses x LEFT JOIN fin_suppliers s ON s.id = x.supplier_id";
const expenseRow = (r: Row): ExpenseRow => ({
  id: num(r.id),
  supplierId: numOrNull(r.supplier_id),
  supplierName: strOrNull(r.supplier_name),
  categoryId: numOrNull(r.category_id),
  costCenterId: numOrNull(r.cost_center_id),
  invoiceNumber: strOrNull(r.invoice_number),
  invoiceDate: String(r.invoice_day),
  accrualDate: strOrNull(r.accrual_day),
  dueDate: strOrNull(r.due_day),
  description: String(r.description),
  baseCents: num(r.base_cents),
  taxRateBp: num(r.tax_rate_bp),
  taxCents: num(r.tax_cents),
  deductibleBp: num(r.deductible_bp),
  withholdingRateBp: num(r.withholding_rate_bp),
  withholdingCents: num(r.withholding_cents),
  totalCents: num(r.total_cents),
  paidCents: num(r.paid_cents),
  currency: String(r.currency),
  kind: r.kind as Expense["kind"],
  rectifiesExpenseId: numOrNull(r.rectifies_expense_id),
  // CRM 0039: sin la migración las columnas no se leen y quedan en null (interior)
  vatTreatment: (strOrNull(r.vat_treatment) as VatTreatment | null) ?? null,
  reverseChargeRateBp: numOrNull(r.reverse_charge_rate_bp),
  settlesStripeFees: Number(r.settles_stripe_fees ?? 0) === 1,
  status: r.status as ExpenseStatus,
  entryId: numOrNull(r.entry_id),
  paymentStatus: r.payment_status as ExpensePaymentStatus,
  sourceKey: strOrNull(r.source_key),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  registeredBy: strOrNull(r.registered_by),
  registeredAt: numOrNull(r.registered_at),
  voidedBy: strOrNull(r.voided_by),
  voidedAt: numOrNull(r.voided_at),
  voidReason: strOrNull(r.void_reason),
});
const PAYMENT_COLS = `p.id, p.expense_id, ${day("p.paid_on", "paid_day")}, p.amount_cents, p.method, p.bank_account_id, p.cash_account_id, p.reference, p.bank_movement_id, p.entry_id, p.status, p.created_by, p.created_at, p.reversed_by, p.reversed_at, p.reverse_reason`;
const paymentRow = (r: Row): ExpensePayment => ({
  id: num(r.id),
  expenseId: num(r.expense_id),
  paidOn: String(r.paid_day),
  amountCents: num(r.amount_cents),
  method: r.method as ExpensePayment["method"],
  bankAccountId: numOrNull(r.bank_account_id),
  cashAccountId: numOrNull(r.cash_account_id),
  reference: strOrNull(r.reference),
  bankMovementId: numOrNull(r.bank_movement_id),
  entryId: numOrNull(r.entry_id),
  status: r.status as PaymentRowStatus,
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
  reversedBy: strOrNull(r.reversed_by),
  reversedAt: numOrNull(r.reversed_at),
  reverseReason: strOrNull(r.reverse_reason),
});
const DOCUMENT_COLS = "id, owner_type, owner_id, filename, mime, size_bytes, sha256, uploaded_by, created_at, archived_at, archived_by";
const documentRow = (r: Row): FinDocument => ({
  id: num(r.id),
  ownerType: r.owner_type as DocumentOwner,
  ownerId: num(r.owner_id),
  filename: String(r.filename),
  mime: String(r.mime),
  sizeBytes: num(r.size_bytes),
  sha256: String(r.sha256),
  uploadedBy: String(r.uploaded_by),
  createdAt: num(r.created_at),
  archived: r.archived_at !== null && r.archived_at !== undefined,
  archivedAt: numOrNull(r.archived_at),
  archivedBy: strOrNull(r.archived_by),
});
const RECURRING_COLS = `id, supplier_id, category_id, cost_center_id, description, base_cents, tax_rate_bp, deductible_bp, withholding_rate_bp, frequency, day_of_month, ${day("start_date", "start_day")}, ${day("end_date", "end_day")}, ${day("next_date", "next_day")}, active, created_by, created_at`;
const recurringRow = (r: Row): RecurringExpense => ({
  id: num(r.id),
  supplierId: num(r.supplier_id),
  categoryId: num(r.category_id),
  costCenterId: numOrNull(r.cost_center_id),
  description: String(r.description),
  baseCents: num(r.base_cents),
  taxRateBp: num(r.tax_rate_bp),
  deductibleBp: num(r.deductible_bp),
  withholdingRateBp: num(r.withholding_rate_bp),
  frequency: r.frequency as RecurringExpense["frequency"],
  dayOfMonth: num(r.day_of_month),
  startDate: String(r.start_day),
  endDate: strOrNull(r.end_day),
  nextDate: strOrNull(r.next_day),
  active: bool(r.active),
  createdBy: String(r.created_by),
  createdAt: num(r.created_at),
});
const BANK_COLS = `id, name, iban, bank_name, account_code, ${day("opening_date", "opening_day")}, active, created_by, created_at`;
const bankRow = (r: Row): BankAccount => ({ id: num(r.id), name: String(r.name), iban: strOrNull(r.iban), bankName: strOrNull(r.bank_name), accountCode: String(r.account_code), openingDate: strOrNull(r.opening_day), active: bool(r.active), createdBy: String(r.created_by), createdAt: num(r.created_at) });
const importRow = (r: Row): BankImport => ({ id: num(r.id), bankAccountId: num(r.bank_account_id), format: r.format as BankImport["format"], filename: String(r.filename), sha256: String(r.sha256), rows: num(r.row_count), inserted: num(r.inserted_count), duplicates: num(r.duplicate_count), importedBy: String(r.imported_by), createdAt: num(r.created_at) });
const MOVEMENT_COLS = `id, bank_account_id, import_id, ${day("booking_date", "booking_day")}, ${day("value_date", "value_day")}, amount_cents, description, reference, counterparty, balance_cents, duplicate_key, status, match_type, match_id, entry_id, match_count, matched_by, matched_at, created_at`;
const movementRow = (r: Row): BankMovement => ({
  id: num(r.id),
  bankAccountId: num(r.bank_account_id),
  importId: numOrNull(r.import_id),
  bookingDate: String(r.booking_day),
  valueDate: strOrNull(r.value_day),
  amountCents: num(r.amount_cents),
  description: String(r.description),
  reference: strOrNull(r.reference),
  counterparty: strOrNull(r.counterparty),
  balanceCents: numOrNull(r.balance_cents),
  duplicateKey: String(r.duplicate_key),
  status: r.status as MovementStatus,
  matchType: (r.match_type as MatchType | null) ?? null,
  matchId: numOrNull(r.match_id),
  entryId: numOrNull(r.entry_id),
  matchCount: num(r.match_count),
  matchedBy: strOrNull(r.matched_by),
  matchedAt: numOrNull(r.matched_at),
  createdAt: num(r.created_at),
});
const cashRow = (r: Row): CashAccount => ({ id: num(r.id), name: String(r.name), accountCode: String(r.account_code), active: bool(r.active), createdBy: String(r.created_by), createdAt: num(r.created_at) });
const CASH_MOVEMENT_COLS = `id, cash_account_id, ${day("moved_on", "moved_day")}, amount_cents, description, counterpart_account_code, entry_id, status, created_by, created_at`;
const cashMovementRow = (r: Row): CashMovement => ({ id: num(r.id), cashAccountId: num(r.cash_account_id), movedOn: String(r.moved_day), amountCents: num(r.amount_cents), description: String(r.description), counterpartAccountCode: String(r.counterpart_account_code), entryId: numOrNull(r.entry_id), status: r.status as CashMovement["status"], createdBy: String(r.created_by), createdAt: num(r.created_at) });

const EXPENSE_SORT: Record<NonNullable<ExpenseQuery["sort"]>, string> = { invoiceDate: "x.invoice_date", dueDate: "x.due_date", totalCents: "x.total_cents", supplier: "s.name" };
const EXPENSE_FIELDS: Record<keyof ExpenseEdit, string> = {
  supplierId: "supplier_id",
  categoryId: "category_id",
  costCenterId: "cost_center_id",
  invoiceNumber: "invoice_number",
  invoiceDate: "invoice_date",
  accrualDate: "accrual_date",
  dueDate: "due_date",
  description: "description",
  baseCents: "base_cents",
  taxRateBp: "tax_rate_bp",
  taxCents: "tax_cents",
  deductibleBp: "deductible_bp",
  withholdingRateBp: "withholding_rate_bp",
  withholdingCents: "withholding_cents",
  totalCents: "total_cents",
  kind: "kind",
  rectifiesExpenseId: "rectifies_expense_id",
  vatTreatment: "vat_treatment",
  reverseChargeRateBp: "reverse_charge_rate_bp",
  settlesStripeFees: "settles_stripe_fees",
};
/** Columnas de la parametrización fiscal (CRM 0039): solo se leen y escriben con la migración aplicada. */
const FISCAL_EXPENSE_COLS = ", x.vat_treatment, x.reverse_charge_rate_bp, x.settles_stripe_fees";
const { vatTreatment: _vt, reverseChargeRateBp: _rc, settlesStripeFees: _sf, ...LEGACY_EXPENSE_FIELDS } = EXPENSE_FIELDS;
const SUPPLIER_FIELDS: Record<keyof SupplierEdit, string> = {
  name: "name",
  legalName: "legal_name",
  taxId: "tax_id",
  country: "country",
  address: "address",
  email: "email",
  phone: "phone",
  iban: "iban",
  paymentTermsDays: "payment_terms_days",
  defaultCategoryId: "default_category_id",
  defaultCostCenterId: "default_cost_center_id",
  accountCode: "account_code",
  notes: "notes",
  active: "active",
};
const RECURRING_FIELDS: Record<keyof RecurringEdit, string> = {
  supplierId: "supplier_id",
  categoryId: "category_id",
  costCenterId: "cost_center_id",
  description: "description",
  baseCents: "base_cents",
  taxRateBp: "tax_rate_bp",
  deductibleBp: "deductible_bp",
  withholdingRateBp: "withholding_rate_bp",
  frequency: "frequency",
  dayOfMonth: "day_of_month",
  startDate: "start_date",
  endDate: "end_date",
  nextDate: "next_date",
  active: "active",
};

/** `SET a = ?, b = ?` de los campos definidos de un parche (booleanos como 0/1). */
function setClause<T extends object>(p: T, fields: Record<string, string>): { sql: string; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || !fields[k]) continue;
    sets.push(`${fields[k]} = ?`);
    args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  return { sql: sets.join(", "), args };
}

export class MysqlFinanceOpsStore implements FinanceOpsStore {
  /** `fiscal`: la migración 0039 está aplicada (tratamiento del IVA de los gastos); sin ella, el esquema anterior. */
  constructor(
    private pool: mysql.Pool,
    private readonly opts: { fiscal?: boolean } = {},
  ) {}
  private get expenseCols() {
    return this.opts.fiscal ? EXPENSE_COLS + FISCAL_EXPENSE_COLS : EXPENSE_COLS;
  }
  private get expenseFields(): Partial<Record<keyof ExpenseEdit, string>> {
    return this.opts.fiscal ? EXPENSE_FIELDS : LEGACY_EXPENSE_FIELDS;
  }

  private async one<T>(sql: string, args: unknown[], map: (r: Row) => T): Promise<T | null> {
    const [rows] = await this.pool.query<Row[]>(sql, args);
    return rows[0] ? map(rows[0]) : null;
  }
  private async insert(sql: string, args: unknown[], conflict: string | ((e: unknown) => string)): Promise<number> {
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(sql, args);
      return r.insertId;
    } catch (e) {
      if (isDup(e)) throw dupConflict(typeof conflict === "string" ? conflict : conflict(e));
      throw e;
    }
  }
  private async patch(table: string, id: number, p: object, fields: Record<string, string>, conflict: string) {
    const s = setClause(p, fields);
    if (!s.sql) return;
    try {
      await this.pool.query(`UPDATE ${table} SET ${s.sql} WHERE id = ?`, [...s.args, id]);
    } catch (e) {
      if (isDup(e)) throw dupConflict(conflict);
      throw e;
    }
  }

  // Centros de coste
  async listCostCenters() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_cost_centers ORDER BY code");
    return rows.map(costCenterRow);
  }
  getCostCenter(id: number) {
    return this.one("SELECT * FROM fin_cost_centers WHERE id = ?", [id], costCenterRow);
  }
  async insertCostCenter(c: { code: string; name: string; createdAt: number }) {
    const id = await this.insert("INSERT INTO fin_cost_centers (code, name, active, created_at) VALUES (?, ?, 1, ?)", [c.code, c.name, c.createdAt], `Ya existe el centro de coste ${c.code}`);
    return (await this.getCostCenter(id))!;
  }
  async patchCostCenter(id: number, p: { code?: string; name?: string; active?: boolean }) {
    await this.patch("fin_cost_centers", id, p, { code: "code", name: "name", active: "active" }, `Ya existe el centro de coste ${p.code}`);
    return this.getCostCenter(id);
  }

  // Categorías
  async listCategories() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_expense_categories ORDER BY name");
    return rows.map(categoryRow);
  }
  getCategory(id: number) {
    return this.one("SELECT * FROM fin_expense_categories WHERE id = ?", [id], categoryRow);
  }
  async insertCategory(c: { name: string; accountCode: string; defaultTaxRateBp: number | null; createdAt: number }) {
    const id = await this.insert("INSERT INTO fin_expense_categories (name, account_code, default_tax_rate_bp, active, created_at) VALUES (?, ?, ?, 1, ?)", [c.name, c.accountCode, c.defaultTaxRateBp, c.createdAt], `Ya existe la categoría «${c.name}»`);
    return (await this.getCategory(id))!;
  }
  async patchCategory(id: number, p: { name?: string; accountCode?: string; defaultTaxRateBp?: number | null; active?: boolean }) {
    await this.patch("fin_expense_categories", id, p, { name: "name", accountCode: "account_code", defaultTaxRateBp: "default_tax_rate_bp", active: "active" }, `Ya existe la categoría «${p.name}»`);
    return this.getCategory(id);
  }

  // Proveedores
  async listSuppliers(q: { q?: string; active?: boolean; limit?: number; offset?: number }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.active !== undefined) (w.push("active = ?"), a.push(q.active ? 1 : 0));
    if (q.q) (w.push("(name LIKE ? OR legal_name LIKE ? OR tax_id LIKE ?)"), a.push(like(q.q), like(q.q), like(q.q)));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_suppliers ${where}`, a);
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM fin_suppliers ${where} ORDER BY name, id LIMIT ? OFFSET ?`, [...a, p.limit, p.offset]);
    return { items: rows.map(supplierRow), total: num(count.n) };
  }
  getSupplier(id: number) {
    return this.one("SELECT * FROM fin_suppliers WHERE id = ?", [id], supplierRow);
  }
  async insertSupplier(s: Omit<Supplier, "id">) {
    const id = await this.insert(
      "INSERT INTO fin_suppliers (name, legal_name, tax_id, country, address, email, phone, iban, payment_terms_days, default_category_id, default_cost_center_id, account_code, notes, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [s.name, s.legalName, s.taxId, s.country, s.address, s.email, s.phone, s.iban, s.paymentTermsDays, s.defaultCategoryId, s.defaultCostCenterId, s.accountCode, s.notes, s.active ? 1 : 0, s.createdBy, s.createdAt],
      `Ya existe un proveedor con el NIF ${s.taxId}`,
    );
    return (await this.getSupplier(id))!;
  }
  async patchSupplier(id: number, p: SupplierEdit) {
    await this.patch("fin_suppliers", id, p, SUPPLIER_FIELDS, `Ya existe un proveedor con el NIF ${p.taxId}`);
    return this.getSupplier(id);
  }

  // Gastos
  async listExpenses(q: ExpenseQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.status) (w.push("x.status = ?"), a.push(q.status));
    if (q.paymentStatus) (w.push("x.payment_status = ?"), a.push(q.paymentStatus));
    if (q.supplierId) (w.push("x.supplier_id = ?"), a.push(q.supplierId));
    if (q.categoryId) (w.push("x.category_id = ?"), a.push(q.categoryId));
    if (q.costCenterId) (w.push("x.cost_center_id = ?"), a.push(q.costCenterId));
    if (q.from) (w.push("x.invoice_date >= ?"), a.push(q.from));
    if (q.to) (w.push("x.invoice_date <= ?"), a.push(q.to));
    if (q.overdueBefore) (w.push("x.status = 'registered' AND x.payment_status <> 'paid' AND x.due_date < ?"), a.push(q.overdueBefore));
    if (q.q) (w.push("(x.invoice_number LIKE ? OR x.description LIKE ? OR s.name LIKE ?)"), a.push(like(q.q), like(q.q), like(q.q)));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const dir = q.dir === "asc" ? "ASC" : "DESC";
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM ${EXPENSE_FROM} ${where}`, a);
    const [rows] = await this.pool.query<Row[]>(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} ${where} ORDER BY ${EXPENSE_SORT[q.sort ?? "invoiceDate"]} ${dir}, x.id ${dir} LIMIT ? OFFSET ?`, [...a, p.limit, p.offset]);
    return { items: rows.map(expenseRow), total: num(count.n) };
  }
  getExpense(id: number) {
    return this.one(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} WHERE x.id = ?`, [id], expenseRow);
  }
  async getExpensesByIds(ids: number[]) {
    if (!ids.length) return [];
    const [rows] = await this.pool.query<Row[]>(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} WHERE x.id IN (?)`, [ids]);
    return rows.map(expenseRow);
  }
  async insertExpense(e: NewExpense) {
    if (e.sourceKey) {
      const cur = await this.one(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} WHERE x.source_key = ?`, [e.sourceKey], expenseRow);
      if (cur) return { expense: cur, created: false };
    }
    try {
      const fiscal = this.opts.fiscal ? { cols: ", vat_treatment, reverse_charge_rate_bp, settles_stripe_fees", marks: ",?,?,?", args: [e.vatTreatment ?? null, e.reverseChargeRateBp ?? null, e.settlesStripeFees ? 1 : 0] } : { cols: "", marks: "", args: [] };
      const [r] = await this.pool.query<mysql.ResultSetHeader>(
        `INSERT INTO fin_expenses (supplier_id, category_id, cost_center_id, invoice_number, invoice_date, accrual_date, due_date, description, base_cents, tax_rate_bp, tax_cents, deductible_bp, withholding_rate_bp, withholding_cents, total_cents, paid_cents, currency, kind, rectifies_expense_id, status, payment_status, source_key, created_by, created_at${fiscal.cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,'draft','pending',?,?,?${fiscal.marks})`,
        [e.supplierId, e.categoryId, e.costCenterId, e.invoiceNumber, e.invoiceDate, e.accrualDate, e.dueDate, e.description, e.baseCents, e.taxRateBp, e.taxCents, e.deductibleBp, e.withholdingRateBp, e.withholdingCents, e.totalCents, e.currency, e.kind, e.rectifiesExpenseId, e.sourceKey, e.createdBy, e.createdAt, ...fiscal.args],
      );
      return { expense: (await this.getExpense(r.insertId))!, created: true };
    } catch (err) {
      if (isDup(err) && e.sourceKey && dupKeyOf(err).includes("uq_fin_expense_source")) {
        const cur = await this.one(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} WHERE x.source_key = ?`, [e.sourceKey], expenseRow);
        if (cur) return { expense: cur, created: false };
      }
      if (isDup(err)) throw dupConflict(NUMBER_TAKEN);
      throw err;
    }
  }
  async patchDraftExpense(id: number, p: ExpenseEdit) {
    const s = setClause(p, this.expenseFields);
    if (s.sql) {
      let r: mysql.ResultSetHeader;
      try {
        [r] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE fin_expenses SET ${s.sql} WHERE id = ? AND status = 'draft'`, [...s.args, id]);
      } catch (e) {
        if (isDup(e)) throw dupConflict(NUMBER_TAKEN);
        throw e;
      }
      if (!r.affectedRows) {
        const cur = await this.getExpense(id);
        if (!cur) throw new FinanceError("not_found", "Gasto no encontrado");
        throw new FinanceError("invalid_state", "Solo se edita un gasto en borrador");
      }
    }
    const e = await this.getExpense(id);
    if (!e) throw new FinanceError("not_found", "Gasto no encontrado");
    return e;
  }
  async markExpenseRegistered(id: number, entryId: number, by: string, at: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_expenses SET status = 'registered', entry_id = ?, registered_by = ?, registered_at = ? WHERE id = ? AND status = 'draft'", [entryId, by, at, id]);
    return r.affectedRows > 0;
  }
  async markExpenseSettled(id: number) {
    await this.pool.query("UPDATE fin_expenses SET paid_cents = total_cents - withholding_cents, payment_status = 'paid' WHERE id = ? AND status = 'registered'", [id]);
  }
  async markExpenseVoid(id: number, from: ExpenseStatus, o: { by: string; at: number; reason: string }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_expenses SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ? AND status = ?", [o.by, o.at, o.reason, id, from]);
    return r.affectedRows > 0;
  }
  async refreshExpensePaid(id: number) {
    await this.pool.query(
      `UPDATE fin_expenses x
         JOIN (SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM fin_expense_payments WHERE expense_id = ? AND status = 'posted') p
         SET x.paid_cents = p.paid,
             x.payment_status = CASE WHEN p.paid = 0 THEN 'pending' WHEN ABS(p.paid) >= ABS(x.total_cents - x.withholding_cents) THEN 'paid' ELSE 'partial' END
       WHERE x.id = ?`,
      [id, id],
    );
    return (await this.getExpense(id))!;
  }
  async existingExpenseSources(keys: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const [rows] = await this.pool.query<Row[]>("SELECT source_key FROM fin_expenses WHERE source_key IN (?)", [keys.slice(i, i + 500)]);
      for (const r of rows) out.add(String(r.source_key));
    }
    return out;
  }
  async expenseTreatmentsByEntries(entryIds: number[]) {
    const out = new Map<number, VatTreatment | null>();
    if (!entryIds.length) return out;
    const [rows] = await this.pool.query<Row[]>(`SELECT entry_id${this.opts.fiscal ? ", vat_treatment" : ""} FROM fin_expenses WHERE entry_id IN (?)`, [Array.from(new Set(entryIds))]);
    for (const r of rows) out.set(num(r.entry_id), (strOrNull(r.vat_treatment) as VatTreatment | null) ?? null);
    return out;
  }
  async openExpenses(limit: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${this.expenseCols} FROM ${EXPENSE_FROM} WHERE x.status = 'registered' AND x.payment_status <> 'paid' ORDER BY x.id DESC LIMIT ?`, [limit]);
    return rows.map(expenseRow);
  }

  // Pagos
  async listPayments(expenseIds: number[]) {
    if (!expenseIds.length) return [];
    const [rows] = await this.pool.query<Row[]>(`SELECT ${PAYMENT_COLS} FROM fin_expense_payments p WHERE p.expense_id IN (?) ORDER BY p.paid_on, p.id`, [expenseIds]);
    return rows.map(paymentRow);
  }
  getPayment(id: number) {
    return this.one(`SELECT ${PAYMENT_COLS} FROM fin_expense_payments p WHERE p.id = ?`, [id], paymentRow);
  }
  async insertPayment(p: Omit<ExpensePayment, "id" | "reversedBy" | "reversedAt" | "reverseReason" | "entryId" | "status">) {
    const conn = await this.pool.getConnection();
    let id: number;
    try {
      await conn.beginTransaction();
      // La fila del gasto bloqueada serializa los pagos del mismo gasto hasta el COMMIT
      const [es] = await conn.query<Row[]>("SELECT status, total_cents, withholding_cents FROM fin_expenses WHERE id = ? FOR UPDATE", [p.expenseId]);
      const [[sum]] = await conn.query<Row[]>("SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM fin_expense_payments WHERE expense_id = ? AND status = 'posted'", [p.expenseId]);
      const e = es[0] ? { status: es[0].status as ExpenseStatus, totalCents: num(es[0].total_cents), withholdingCents: num(es[0].withholding_cents) } : null;
      const problem = paymentProblem(e, num(sum.paid), p.amountCents);
      if (problem) throw problem;
      const [r] = await conn.query<mysql.ResultSetHeader>(
        "INSERT INTO fin_expense_payments (expense_id, paid_on, amount_cents, method, bank_account_id, cash_account_id, reference, bank_movement_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,'posted',?,?)",
        [p.expenseId, p.paidOn, p.amountCents, p.method, p.bankAccountId, p.cashAccountId, p.reference, p.bankMovementId, p.createdBy, p.createdAt],
      );
      id = r.insertId;
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
    return (await this.getPayment(id))!;
  }
  async setPaymentEntry(id: number, entryId: number) {
    await this.pool.query("UPDATE fin_expense_payments SET entry_id = ? WHERE id = ?", [entryId, id]);
  }
  async markPayment(id: number, status: Exclude<PaymentRowStatus, "posted">, o: { by: string; at: number; reason: string }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_expense_payments SET status = ?, reversed_by = ?, reversed_at = ?, reverse_reason = ? WHERE id = ? AND status = 'posted'", [status, o.by, o.at, o.reason, id]);
    return r.affectedRows > 0;
  }
  async linkPaymentMovement(id: number, movementId: number | null, expect: number | null) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE fin_expense_payments SET bank_movement_id = ? WHERE id = ? AND ${expect === null ? "bank_movement_id IS NULL" : "bank_movement_id = ?"}${movementId !== null ? " AND status = 'posted'" : ""}`,
      expect === null ? [movementId, id] : [movementId, id, expect],
    );
    return r.affectedRows > 0;
  }
  async openPayments(bankAccountId: number, limit: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${PAYMENT_COLS} FROM fin_expense_payments p WHERE p.status = 'posted' AND p.bank_movement_id IS NULL AND (p.bank_account_id = ? OR (p.bank_account_id IS NULL AND p.cash_account_id IS NULL)) ORDER BY p.id DESC LIMIT ?`, [bankAccountId, limit]);
    return rows.map(paymentRow);
  }

  // Documentos
  async insertDocument(d: Omit<FinDocument, "id" | "archived" | "archivedAt" | "archivedBy">, content: Buffer) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("INSERT INTO fin_documents (owner_type, owner_id, filename, mime, size_bytes, sha256, content, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [d.ownerType, d.ownerId, d.filename, d.mime, d.sizeBytes, d.sha256, content, d.uploadedBy, d.createdAt]);
    return (await this.getDocument(r.insertId))!;
  }
  async listDocuments(ownerType: DocumentOwner, ownerId: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${DOCUMENT_COLS} FROM fin_documents WHERE owner_type = ? AND owner_id = ? ORDER BY id`, [ownerType, ownerId]);
    return rows.map(documentRow);
  }
  getDocument(id: number) {
    return this.one(`SELECT ${DOCUMENT_COLS} FROM fin_documents WHERE id = ?`, [id], documentRow);
  }
  async getDocumentContent(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT content FROM fin_documents WHERE id = ?", [id]);
    return rows[0] ? Buffer.from(rows[0].content as Buffer) : null;
  }
  async archiveDocument(id: number, by: string, at: number) {
    await this.pool.query("UPDATE fin_documents SET archived_at = ?, archived_by = ? WHERE id = ? AND archived_at IS NULL", [at, by, id]);
    return this.getDocument(id);
  }

  // Recurrentes
  async listRecurring() {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${RECURRING_COLS} FROM fin_recurring_expenses ORDER BY active DESC, id`);
    return rows.map(recurringRow);
  }
  getRecurring(id: number) {
    return this.one(`SELECT ${RECURRING_COLS} FROM fin_recurring_expenses WHERE id = ?`, [id], recurringRow);
  }
  async insertRecurring(t: Omit<RecurringExpense, "id">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT INTO fin_recurring_expenses (supplier_id, category_id, cost_center_id, description, base_cents, tax_rate_bp, deductible_bp, withholding_rate_bp, frequency, day_of_month, start_date, end_date, next_date, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [t.supplierId, t.categoryId, t.costCenterId, t.description, t.baseCents, t.taxRateBp, t.deductibleBp, t.withholdingRateBp, t.frequency, t.dayOfMonth, t.startDate, t.endDate, t.nextDate, t.active ? 1 : 0, t.createdBy, t.createdAt],
    );
    return (await this.getRecurring(r.insertId))!;
  }
  async patchRecurring(id: number, p: RecurringEdit) {
    await this.patch("fin_recurring_expenses", id, p, RECURRING_FIELDS, "Plantilla repetida");
    return this.getRecurring(id);
  }

  // Bancos
  async listBankAccounts() {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${BANK_COLS} FROM fin_bank_accounts ORDER BY active DESC, id`);
    return rows.map(bankRow);
  }
  getBankAccount(id: number) {
    return this.one(`SELECT ${BANK_COLS} FROM fin_bank_accounts WHERE id = ?`, [id], bankRow);
  }
  async insertBankAccount(b: Omit<BankAccount, "id">) {
    const id = await this.insert(
      "INSERT INTO fin_bank_accounts (name, iban, bank_name, account_code, opening_date, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [b.name, b.iban, b.bankName, b.accountCode, b.openingDate, b.active ? 1 : 0, b.createdBy, b.createdAt],
      (e) => (dupKeyOf(e).includes("iban") ? "Ya hay una cuenta bancaria con ese IBAN" : `La subcuenta ${b.accountCode} ya tiene banco`),
    );
    return (await this.getBankAccount(id))!;
  }
  async patchBankAccount(id: number, p: { name?: string; bankName?: string | null; active?: boolean }) {
    await this.patch("fin_bank_accounts", id, p, { name: "name", bankName: "bank_name", active: "active" }, "Cuenta repetida");
    return this.getBankAccount(id);
  }
  findImport(bankAccountId: number, sha256: string) {
    return this.one("SELECT * FROM fin_bank_imports WHERE bank_account_id = ? AND sha256 = ?", [bankAccountId, sha256], importRow);
  }
  async importMovements(imp: Omit<BankImport, "id" | "inserted" | "duplicates">, rows: ParsedMovement[]) {
    const conn = await this.pool.getConnection();
    let id: number;
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<mysql.ResultSetHeader>("INSERT INTO fin_bank_imports (bank_account_id, format, filename, sha256, row_count, imported_by, created_at) VALUES (?,?,?,?,?,?,?)", [imp.bankAccountId, imp.format, imp.filename, imp.sha256, imp.rows, imp.importedBy, imp.createdAt]);
      id = r.insertId;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        // Las claves repetidas (ya importadas en esta cuenta) se ignoran: el índice único decide
        const [ins] = await conn.query<mysql.ResultSetHeader>(
          "INSERT IGNORE INTO fin_bank_movements (bank_account_id, import_id, booking_date, value_date, amount_cents, description, reference, counterparty, balance_cents, duplicate_key, status, created_at) VALUES ?",
          [chunk.map((m) => [imp.bankAccountId, id, m.bookingDate, m.valueDate, m.amountCents, m.description, m.reference, m.counterparty, m.balanceCents, m.duplicateKey, "pending", imp.createdAt])],
        );
        inserted += ins.affectedRows;
      }
      await conn.query("UPDATE fin_bank_imports SET inserted_count = ?, duplicate_count = ? WHERE id = ?", [inserted, rows.length - inserted, id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      if (isDup(e)) throw dupConflict("Este extracto ya se importó en esta cuenta");
      throw e;
    } finally {
      conn.release();
    }
    return (await this.getImport(id))!;
  }
  async listImports(bankAccountId?: number) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM fin_bank_imports ${bankAccountId ? "WHERE bank_account_id = ?" : ""} ORDER BY id DESC LIMIT 200`, bankAccountId ? [bankAccountId] : []);
    return rows.map(importRow);
  }
  getImport(id: number) {
    return this.one("SELECT * FROM fin_bank_imports WHERE id = ?", [id], importRow);
  }
  async listMovements(q: MovementQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.bankAccountId) (w.push("bank_account_id = ?"), a.push(q.bankAccountId));
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.from) (w.push("booking_date >= ?"), a.push(q.from));
    if (q.to) (w.push("booking_date <= ?"), a.push(q.to));
    if (q.q) (w.push("(description LIKE ? OR reference LIKE ? OR counterparty LIKE ? OR CAST(ABS(amount_cents) AS CHAR) = ?)"), a.push(like(q.q), like(q.q), like(q.q), q.q));
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const p = page(q.limit, q.offset);
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_bank_movements ${where}`, a);
    const [rows] = await this.pool.query<Row[]>(`SELECT ${MOVEMENT_COLS} FROM fin_bank_movements ${where} ORDER BY booking_date DESC, id DESC LIMIT ? OFFSET ?`, [...a, p.limit, p.offset]);
    return { items: rows.map(movementRow), total: num(count.n) };
  }
  getMovement(id: number) {
    return this.one(`SELECT ${MOVEMENT_COLS} FROM fin_bank_movements WHERE id = ?`, [id], movementRow);
  }
  async claimMovement(id: number, o: { from: MovementStatus; to: MovementStatus; matchType: MatchType | null; by: string; at: number; bump: boolean }) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE fin_bank_movements SET status = ?, match_type = ?, match_id = NULL, entry_id = NULL, matched_by = ?, matched_at = ?${o.bump ? ", match_count = match_count + 1" : ""} WHERE id = ? AND status = ?`,
      [o.to, o.matchType, o.by, o.at, id, o.from],
    );
    return r.affectedRows ? this.getMovement(id) : null;
  }
  async setMovementMatch(id: number, matchId: number | null, entryId: number | null) {
    await this.pool.query("UPDATE fin_bank_movements SET match_id = ?, entry_id = ? WHERE id = ?", [matchId, entryId, id]);
  }
  async releaseMovement(id: number, from: MovementStatus) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE fin_bank_movements SET status = 'pending', match_type = NULL, match_id = NULL, entry_id = NULL, matched_by = NULL, matched_at = NULL WHERE id = ? AND status = ?", [id, from]);
    return r.affectedRows > 0;
  }
  async movementsByMatch(matchType: MatchType, matchIds: number[]) {
    if (!matchIds.length) return [];
    const [rows] = await this.pool.query<Row[]>(`SELECT ${MOVEMENT_COLS} FROM fin_bank_movements WHERE status = 'matched' AND match_type = ? AND match_id IN (?)`, [matchType, matchIds]);
    return rows.map(movementRow);
  }
  async getMovementsByIds(ids: number[]) {
    if (!ids.length) return [];
    const [rows] = await this.pool.query<Row[]>(`SELECT ${MOVEMENT_COLS} FROM fin_bank_movements WHERE id IN (?)`, [ids]);
    return rows.map(movementRow);
  }

  // Caja
  async listCashAccounts() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fin_cash_accounts ORDER BY active DESC, id");
    return rows.map(cashRow);
  }
  getCashAccount(id: number) {
    return this.one("SELECT * FROM fin_cash_accounts WHERE id = ?", [id], cashRow);
  }
  async insertCashAccount(c: Omit<CashAccount, "id">) {
    const id = await this.insert("INSERT INTO fin_cash_accounts (name, account_code, active, created_by, created_at) VALUES (?,?,?,?,?)", [c.name, c.accountCode, c.active ? 1 : 0, c.createdBy, c.createdAt], `La subcuenta ${c.accountCode} ya tiene caja`);
    return (await this.getCashAccount(id))!;
  }
  async listCashMovements(q: { cashAccountId?: number; limit?: number; offset?: number }) {
    const where = q.cashAccountId ? "WHERE cash_account_id = ?" : "";
    const a = q.cashAccountId ? [q.cashAccountId] : [];
    const p = page(q.limit, q.offset);
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM fin_cash_movements ${where}`, a);
    const [rows] = await this.pool.query<Row[]>(`SELECT ${CASH_MOVEMENT_COLS} FROM fin_cash_movements ${where} ORDER BY moved_on DESC, id DESC LIMIT ? OFFSET ?`, [...a, p.limit, p.offset]);
    return { items: rows.map(cashMovementRow), total: num(count.n) };
  }
  async insertCashMovement(m: Omit<CashMovement, "id" | "entryId" | "status">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("INSERT INTO fin_cash_movements (cash_account_id, moved_on, amount_cents, description, counterpart_account_code, status, created_by, created_at) VALUES (?,?,?,?,?,'posted',?,?)", [m.cashAccountId, m.movedOn, m.amountCents, m.description, m.counterpartAccountCode, m.createdBy, m.createdAt]);
    return (await this.one(`SELECT ${CASH_MOVEMENT_COLS} FROM fin_cash_movements WHERE id = ?`, [r.insertId], cashMovementRow))!;
  }
  async setCashMovementEntry(id: number, entryId: number) {
    await this.pool.query("UPDATE fin_cash_movements SET entry_id = ? WHERE id = ?", [entryId, id]);
  }
  async voidCashMovement(id: number) {
    await this.pool.query("UPDATE fin_cash_movements SET status = 'void' WHERE id = ? AND entry_id IS NULL", [id]);
  }
}

/** ¿Existe la migración 0035 (operaciones)? */
export async function finOpsTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["fin_cost_centers", "fin_expense_categories", "fin_suppliers", "fin_expenses", "fin_expense_payments", "fin_documents", "fin_recurring_expenses", "fin_bank_accounts", "fin_bank_imports", "fin_bank_movements", "fin_cash_accounts", "fin_cash_movements"]) {
    const ok = await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false);
    if (!ok) return false;
  }
  return true;
}
