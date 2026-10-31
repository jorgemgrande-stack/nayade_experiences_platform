/**
 * Servicio de las operaciones (fase 1B): centros de coste, categorías, proveedores, gastos y pagos, documentos,
 * recurrentes, bancos (extractos, movimientos y conciliación) y caja. Contabiliza SIEMPRE a través del libro de la
 * fase 1A (`FinanceService.postGenerated` / `reverse`), con una `source_key` por hecho económico:
 *
 *   expense:<id>              gasto registrado
 *   expense-payment:<id>      pago registrado a mano
 *   bankmov:<id>[:<n>]        pago nacido de un movimiento bancario, o movimiento contra cuenta (n tras desvincular)
 *   cash:<id>                 movimiento de caja
 *   recurring:<tpl>:<periodo> borrador de gasto recurrente (no contabiliza)
 *
 * Unicidad del hecho económico: un pago registrado a mano y después vinculado a su movimiento NO crea otro asiento; si
 * el movimiento crea el pago, el asiento es `bankmov:<id>`; desvincular revierte el asiento solo si lo creó el vínculo;
 * anular un gasto registrado revierte su asiento y exige revertir antes sus pagos; un extracto no se importa dos veces
 * (sha256 por cuenta) ni un movimiento se repite (clave de duplicado por cuenta). Cada escritura deja su auditoría.
 */
import { madridDateKey } from "../utils/timezone";
import {
  addDays,
  bankCounterpartEntry,
  bankMovementSourceKey,
  cashEntry,
  cashMovementSourceKey,
  checkExpenseAmounts,
  decodeText,
  expenseAmounts,
  expenseEntry,
  expensePaymentSourceKey,
  isValidIban,
  MAX_DOCUMENT_BYTES,
  MAX_IMPORT_ROWS,
  nextSubaccountCode,
  normalizeIban,
  normalizeTaxId,
  OPS_ACCOUNTS,
  parseCaixaBankBuffer,
  parseMappedCsv,
  parseNorma43,
  paymentEntry,
  pendingOf,
  recurringOccurrences,
  recurringPeriod,
  recurringSourceKey,
  safeFilename,
  sha256Hex,
  sniffDocument,
  spanishAccountOfIban,
  suggestMatches,
  taxIdProblem,
  type CsvMapping,
  type MatchSuggestion,
} from "./opsRules";
import type { ExpenseEdit, ExpenseQuery, ExpenseRow, FinanceOpsStore, MovementQuery } from "./opsStore";
import type {
  AccountMatchType,
  BankAccount,
  BankMovement,
  CashAccount,
  DocumentOwner,
  Expense,
  ExpenseKind,
  ExpensePayment,
  Frequency,
  ImportFormat,
  ParsedMovement,
  PaymentMethod,
  RecurringExpense,
  Supplier,
} from "./opsTypes";
import { balancesOf, isValidDate, netMovement, yearOf } from "./rules";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import { FinanceError, type Entry, type EntryOrigin, type FinanceActor } from "./types";

export interface FinanceOpsDeps {
  store: FinanceOpsStore;
  /** El libro de la fase 1A: toda contabilización pasa por él. */
  finance: FinanceService;
  /** Almacén del libro (solo lectura de asientos y saldos). */
  ledger: Pick<FinanceStore, "postedLines" | "bySource" | "getEntry" | "listAccounts">;
  now?: () => number;
}

export interface SupplierInput {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  country?: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  paymentTermsDays?: number | null;
  defaultCategoryId?: number | null;
  defaultCostCenterId?: number | null;
  accountCode?: "400" | "410";
  notes?: string | null;
}

export interface ExpenseInput {
  kind: ExpenseKind;
  supplierId?: number | null;
  categoryId?: number | null;
  costCenterId?: number | null;
  invoiceNumber?: string | null;
  invoiceDate: string;
  accrualDate?: string | null;
  dueDate?: string | null;
  description: string;
  baseCents: number;
  taxRateBp: number;
  deductibleBp?: number;
  withholdingRateBp?: number;
  rectifiesExpenseId?: number | null;
}

export interface PaymentInput {
  paidOn: string;
  amountCents: number;
  method: PaymentMethod;
  bankAccountId?: number | null;
  cashAccountId?: number | null;
  reference?: string | null;
}

export interface RecurringInput {
  supplierId: number;
  categoryId: number;
  costCenterId?: number | null;
  description: string;
  baseCents: number;
  taxRateBp: number;
  deductibleBp?: number;
  withholdingRateBp?: number;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string | null;
}

export type MatchInput =
  | { type: "expense_payment"; expenseId: number; expensePaymentId?: undefined }
  | { type: "expense_payment"; expensePaymentId: number; expenseId?: undefined }
  | { type: AccountMatchType; accountCode: string; description?: string | null };

const bad = (m: string) => new FinanceError("invalid_input", m);
const notFound = (what: string) => new FinanceError("not_found", `${what} no encontrado`);
const text = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const reasonOf = (r: string, what: string) => {
  const why = (r ?? "").trim();
  if (why.length < 3 || why.length > 300) throw bad(`Indica el motivo de ${what} (3 a 300 caracteres)`);
  return why;
};
const CLOSING: EntryOrigin[] = ["regularization", "closing", "opening"];
/** Lo que se lee como mucho para sugerencias y extractos de proveedor. */
const SCAN_LIMIT = 500;
/** Horizonte máximo de los recurrentes: un año y un día desde hoy. */
const RECURRING_HORIZON_DAYS = 366;

export class FinanceOpsService {
  private readonly now: () => number;
  constructor(private readonly d: FinanceOpsDeps) {
    this.now = d.now ?? Date.now;
  }

  today(): string {
    return madridDateKey(new Date(this.now()));
  }
  private get s() {
    return this.d.store;
  }
  private audit(actor: FinanceActor, action: string, entity: string, id: string | number | null, summary: Record<string, unknown> | null) {
    return this.d.finance.recordAudit(actor, action, entity, id, summary);
  }
  /** Fecha de una reversión: hoy, salvo que el asiento sea posterior (no puede revertirse antes de existir). */
  private reversalDate(e: Pick<Entry, "date">) {
    const t = this.today();
    return e.date > t ? e.date : t;
  }
  private async accounts() {
    return new Map((await this.d.ledger.listAccounts()).map((a) => [a.code, a]));
  }

  // ── Centros de coste ──────────────────────────────────────────────────────────────────────────────────────────

  costCenters() {
    return this.s.listCostCenters();
  }

  private ccFields(code: string | undefined, name: string | undefined) {
    const c = code?.trim().toUpperCase();
    if (c !== undefined && !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(c)) throw bad("Código de centro de 1 a 20 caracteres: letras, números, «-» o «_»");
    const n = name?.trim();
    if (n !== undefined && (!n || n.length > 120)) throw bad("El nombre del centro de coste es obligatorio (máximo 120 caracteres)");
    return { code: c, name: n };
  }

  async createCostCenter(i: { code: string; name: string }, actor: FinanceActor) {
    const f = this.ccFields(i.code, i.name);
    const c = await this.s.insertCostCenter({ code: f.code!, name: f.name!, createdAt: this.now() });
    await this.audit(actor, "cost_center.create", "cost_center", c.id, { code: c.code });
    return c;
  }

  async patchCostCenter(id: number, p: { code?: string; name?: string; active?: boolean }, actor: FinanceActor) {
    const f = this.ccFields(p.code, p.name);
    const c = await this.s.patchCostCenter(id, { ...(f.code !== undefined ? { code: f.code } : {}), ...(f.name !== undefined ? { name: f.name } : {}), ...(p.active !== undefined ? { active: p.active } : {}) });
    if (!c) throw notFound("Centro de coste");
    await this.audit(actor, "cost_center.update", "cost_center", id, { ...f, active: p.active });
    return c;
  }

  // ── Categorías ────────────────────────────────────────────────────────────────────────────────────────────────

  categories() {
    return this.s.listCategories();
  }

  private async categoryAccount(code: string) {
    const a = (await this.accounts()).get(code);
    if (!a) throw new FinanceError("invalid_account", `La cuenta ${code} no existe`);
    if (!code.startsWith("6")) throw new FinanceError("invalid_account", "La cuenta de un gasto debe ser del grupo 6");
    if (!a.active || !a.isPostable) throw new FinanceError("invalid_account", `La cuenta ${code} no admite apuntes`);
  }

  async createCategory(i: { name: string; accountCode: string; defaultTaxRateBp?: number | null }, actor: FinanceActor) {
    const name = i.name.trim();
    if (!name || name.length > 120) throw bad("El nombre de la categoría es obligatorio (máximo 120 caracteres)");
    await this.categoryAccount(i.accountCode);
    const c = await this.s.insertCategory({ name, accountCode: i.accountCode, defaultTaxRateBp: i.defaultTaxRateBp ?? null, createdAt: this.now() });
    await this.audit(actor, "category.create", "category", c.id, { name, accountCode: c.accountCode });
    return c;
  }

  async patchCategory(id: number, p: { name?: string; accountCode?: string; defaultTaxRateBp?: number | null; active?: boolean }, actor: FinanceActor) {
    const name = p.name?.trim();
    if (name !== undefined && (!name || name.length > 120)) throw bad("El nombre de la categoría es obligatorio (máximo 120 caracteres)");
    if (p.accountCode !== undefined) await this.categoryAccount(p.accountCode);
    const c = await this.s.patchCategory(id, { name, accountCode: p.accountCode, defaultTaxRateBp: p.defaultTaxRateBp, active: p.active });
    if (!c) throw notFound("Categoría");
    await this.audit(actor, "category.update", "category", id, { name, accountCode: p.accountCode, defaultTaxRateBp: p.defaultTaxRateBp, active: p.active });
    return c;
  }

  // ── Proveedores ───────────────────────────────────────────────────────────────────────────────────────────────

  suppliers(q: { q?: string; active?: boolean; limit?: number; offset?: number }) {
    return this.s.listSuppliers(q);
  }

  async supplier(id: number): Promise<Supplier> {
    const s = await this.s.getSupplier(id);
    if (!s) throw notFound("Proveedor");
    return s;
  }

  /** Ficha normalizada y validada (NIF/CIF con su control en España, IBAN mod 97, cuenta 400/410, referencias). */
  private async supplierFields(i: Partial<SupplierInput>, current: Supplier | null) {
    const out: Partial<Omit<Supplier, "id" | "createdAt" | "createdBy" | "active">> = {};
    if (i.name !== undefined) {
      const n = i.name.trim();
      if (!n || n.length > 160) throw bad("El nombre del proveedor es obligatorio (máximo 160 caracteres)");
      out.name = n;
    }
    const country = (i.country ?? current?.country ?? "ES").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw bad("País en código de dos letras (ES, FR, IE…)");
    if (i.country !== undefined) out.country = country;
    if (i.taxId !== undefined) {
      const t = i.taxId?.trim() ? normalizeTaxId(i.taxId) : null;
      if (t) {
        const problem = taxIdProblem(t, country);
        if (problem) throw bad(problem);
      }
      // En España sin el prefijo «ES» del NIF-IVA (mismo NIF, mismo proveedor)
      out.taxId = t && country === "ES" ? t.replace(/^ES(?=[A-Z0-9]{9}$)/, "") : t;
    } else if (i.country !== undefined && current?.taxId) {
      const problem = taxIdProblem(current.taxId, country);
      if (problem) throw bad(problem);
    }
    if (i.iban !== undefined) {
      const v = i.iban?.trim() ? normalizeIban(i.iban) : null;
      if (v && !isValidIban(v)) throw bad("El IBAN no es válido (revisa los dígitos de control)");
      out.iban = v;
    }
    if (i.email !== undefined) {
      const e = text(i.email, 160);
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad("El correo no es válido");
      out.email = e;
    }
    if (i.paymentTermsDays !== undefined) {
      if (i.paymentTermsDays !== null && (!Number.isInteger(i.paymentTermsDays) || i.paymentTermsDays < 0 || i.paymentTermsDays > 999)) throw bad("Días de pago: número entero entre 0 y 999");
      out.paymentTermsDays = i.paymentTermsDays;
    }
    if (i.defaultCategoryId !== undefined) {
      if (i.defaultCategoryId !== null && !(await this.s.getCategory(i.defaultCategoryId))) throw bad("La categoría por defecto no existe");
      out.defaultCategoryId = i.defaultCategoryId;
    }
    if (i.defaultCostCenterId !== undefined) {
      if (i.defaultCostCenterId !== null && !(await this.s.getCostCenter(i.defaultCostCenterId))) throw bad("El centro de coste por defecto no existe");
      out.defaultCostCenterId = i.defaultCostCenterId;
    }
    if (i.accountCode !== undefined) {
      if (i.accountCode !== "400" && i.accountCode !== "410") throw bad("La cuenta del proveedor es 400 (proveedores) o 410 (acreedores por servicios)");
      out.accountCode = i.accountCode;
    }
    if (i.legalName !== undefined) out.legalName = text(i.legalName, 200);
    if (i.address !== undefined) out.address = text(i.address, 300);
    if (i.phone !== undefined) out.phone = text(i.phone, 40);
    if (i.notes !== undefined) out.notes = text(i.notes, 1000);
    return out;
  }

  async createSupplier(i: SupplierInput, actor: FinanceActor): Promise<Supplier> {
    const f = await this.supplierFields({ country: "ES", accountCode: "410", ...i }, null);
    const s = await this.s.insertSupplier({
      name: f.name!,
      legalName: f.legalName ?? null,
      taxId: f.taxId ?? null,
      country: f.country ?? "ES",
      address: f.address ?? null,
      email: f.email ?? null,
      phone: f.phone ?? null,
      iban: f.iban ?? null,
      paymentTermsDays: f.paymentTermsDays ?? null,
      defaultCategoryId: f.defaultCategoryId ?? null,
      defaultCostCenterId: f.defaultCostCenterId ?? null,
      accountCode: f.accountCode ?? "410",
      notes: f.notes ?? null,
      active: true,
      createdBy: actor.by,
      createdAt: this.now(),
    });
    await this.audit(actor, "supplier.create", "supplier", s.id, { name: s.name, taxId: s.taxId });
    return s;
  }

  async patchSupplier(id: number, p: Partial<SupplierInput> & { active?: boolean }, actor: FinanceActor): Promise<Supplier> {
    const cur = await this.supplier(id);
    const f = await this.supplierFields(p, cur);
    const s = await this.s.patchSupplier(id, { ...f, ...(p.active !== undefined ? { active: p.active } : {}) });
    if (!s) throw notFound("Proveedor");
    await this.audit(actor, "supplier.update", "supplier", id, { fields: Object.keys({ ...f, ...(p.active !== undefined ? { active: p.active } : {}) }) });
    return s;
  }

  /** Extracto del proveedor: facturas del periodo, sus pagos, pendiente y vencido de todo lo registrado y próximos vencimientos. */
  async supplierStatement(id: number, from?: string, to?: string) {
    await this.supplier(id);
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) throw bad("Fechas no válidas (AAAA-MM-DD)");
    const today = this.today();
    const inRange = (await this.s.listExpenses({ supplierId: id, from, to, limit: SCAN_LIMIT, sort: "invoiceDate", dir: "asc" })).items.filter((e) => e.status !== "void");
    const payments = (await this.s.listPayments(inRange.map((e) => e.id))).filter((p) => p.status !== "void");
    const open = (await this.s.listExpenses({ supplierId: id, status: "registered", limit: SCAN_LIMIT })).items.filter((e) => pendingOf(e) !== 0);
    const pendingCents = open.reduce((a, e) => a + pendingOf(e), 0);
    const overdueCents = open.filter((e) => e.dueDate && e.dueDate < today).reduce((a, e) => a + pendingOf(e), 0);
    const upcoming = open
      .filter((e) => e.dueDate && e.dueDate >= today)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.id - b.id)
      .map((e) => ({ expenseId: e.id, invoiceNumber: e.invoiceNumber, dueDate: e.dueDate!, pendingCents: pendingOf(e) }));
    return { expenses: inRange.map((e) => this.expenseDto(e)), payments, pendingCents, overdueCents, upcoming };
  }

  // ── Gastos ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Forma del CRM: el gasto con el nombre del proveedor, lo pagado y lo pendiente (total − retención − pagos). */
  expenseDto(e: ExpenseRow) {
    return { ...e, pendingCents: pendingOf(e) };
  }

  async listExpenses(q: Omit<ExpenseQuery, "overdueBefore"> & { due?: "overdue" }) {
    const { due, ...rest } = q;
    const out = await this.s.listExpenses({ ...rest, ...(due === "overdue" ? { overdueBefore: this.today() } : {}) });
    return { items: out.items.map((e) => this.expenseDto(e)), total: out.total };
  }

  async expense(id: number): Promise<ExpenseRow> {
    const e = await this.s.getExpense(id);
    if (!e) throw notFound("Gasto");
    return e;
  }

  async expenseWithPayments(id: number) {
    const e = await this.expense(id);
    const payments = (await this.s.listPayments([id])).filter((p) => p.status !== "void");
    return { item: this.expenseDto(e), payments };
  }

  /** Campos del gasto validados, con la cuota, la retención y el total calculados en el servidor. */
  private async expenseFields(i: ExpenseInput): Promise<ExpenseEdit & { kind: ExpenseKind }> {
    if (!["invoice", "rectification", "ticket"].includes(i.kind)) throw bad("Clase de gasto no válida");
    if (!isValidDate(i.invoiceDate)) throw bad("La fecha de la factura no es válida (AAAA-MM-DD)");
    for (const [v, what] of [[i.accrualDate, "La fecha de devengo"], [i.dueDate, "El vencimiento"]] as const) if (v && !isValidDate(v)) throw bad(`${what} no es válida (AAAA-MM-DD)`);
    if (i.dueDate && i.dueDate < i.invoiceDate) throw bad("El vencimiento no puede ser anterior a la factura");
    const description = (i.description ?? "").trim();
    if (!description || description.length > 500) throw bad("Describe el gasto (máximo 500 caracteres)");
    const deductibleBp = i.deductibleBp ?? 10_000;
    const withholdingRateBp = i.withholdingRateBp ?? 0;
    checkExpenseAmounts(i.kind, { baseCents: i.baseCents, taxRateBp: i.taxRateBp, deductibleBp, withholdingRateBp });
    const supplier = i.supplierId ? await this.s.getSupplier(i.supplierId) : null;
    if (i.supplierId && !supplier) throw bad("El proveedor no existe");
    if (!i.categoryId) throw bad("Elige la categoría del gasto");
    const cat = await this.s.getCategory(i.categoryId);
    if (!cat) throw bad("La categoría no existe");
    if (i.costCenterId && !(await this.s.getCostCenter(i.costCenterId))) throw bad("El centro de coste no existe");
    const invoiceNumber = text(i.invoiceNumber, 60);
    let rectifiesExpenseId: number | null = null;
    if (i.kind === "rectification") {
      if (!i.rectifiesExpenseId) throw bad("Indica el gasto que rectifica");
      const orig = await this.s.getExpense(i.rectifiesExpenseId);
      if (!orig || orig.status !== "registered" || orig.kind === "rectification") throw bad("La rectificativa debe referirse a una factura registrada");
      if (orig.supplierId !== (i.supplierId ?? null)) throw bad("La rectificativa debe ser del mismo proveedor que la factura que rectifica");
      rectifiesExpenseId = orig.id;
    }
    const a = expenseAmounts({ baseCents: i.baseCents, taxRateBp: i.taxRateBp, deductibleBp, withholdingRateBp });
    const dueDate = i.dueDate ?? (supplier?.paymentTermsDays !== null && supplier?.paymentTermsDays !== undefined ? addDays(i.invoiceDate, supplier.paymentTermsDays) : null);
    return {
      kind: i.kind,
      supplierId: i.supplierId ?? null,
      categoryId: i.categoryId,
      costCenterId: i.costCenterId ?? supplier?.defaultCostCenterId ?? null,
      invoiceNumber,
      invoiceDate: i.invoiceDate,
      accrualDate: i.accrualDate ?? null,
      dueDate,
      description,
      baseCents: a.baseCents,
      taxRateBp: i.taxRateBp,
      taxCents: a.taxCents,
      deductibleBp,
      withholdingRateBp,
      withholdingCents: a.withholdingCents,
      totalCents: a.totalCents,
      rectifiesExpenseId,
    };
  }

  async createExpense(i: ExpenseInput, actor: FinanceActor) {
    const f = await this.expenseFields(i);
    const { expense } = await this.s.insertExpense({ ...(f as Required<typeof f>), currency: "EUR", sourceKey: null, createdBy: actor.by, createdAt: this.now() });
    await this.audit(actor, "expense.create", "expense", expense.id, { kind: expense.kind, totalCents: expense.totalCents, supplierId: expense.supplierId });
    return expense;
  }

  /** Solo borradores. Se recalculan cuota, retención y total con los datos que resulten. */
  async patchExpense(id: number, p: Partial<ExpenseInput>, actor: FinanceActor) {
    const cur = await this.expense(id);
    if (cur.status !== "draft") throw new FinanceError("invalid_state", "Solo se edita un gasto en borrador");
    const merged: ExpenseInput = {
      kind: p.kind ?? cur.kind,
      supplierId: p.supplierId !== undefined ? p.supplierId : cur.supplierId,
      categoryId: p.categoryId !== undefined ? p.categoryId : cur.categoryId,
      costCenterId: p.costCenterId !== undefined ? p.costCenterId : cur.costCenterId,
      invoiceNumber: p.invoiceNumber !== undefined ? p.invoiceNumber : cur.invoiceNumber,
      invoiceDate: p.invoiceDate ?? cur.invoiceDate,
      accrualDate: p.accrualDate !== undefined ? p.accrualDate : cur.accrualDate,
      dueDate: p.dueDate !== undefined ? p.dueDate : cur.dueDate,
      description: p.description ?? cur.description,
      baseCents: p.baseCents ?? cur.baseCents,
      taxRateBp: p.taxRateBp ?? cur.taxRateBp,
      deductibleBp: p.deductibleBp ?? cur.deductibleBp,
      withholdingRateBp: p.withholdingRateBp ?? cur.withholdingRateBp,
      rectifiesExpenseId: p.rectifiesExpenseId !== undefined ? p.rectifiesExpenseId : cur.rectifiesExpenseId,
    };
    const e = await this.s.patchDraftExpense(id, await this.expenseFields(merged));
    await this.audit(actor, "expense.update", "expense", id, { fields: Object.keys(p), totalCents: e.totalCents });
    return e;
  }

  /**
   * Registra el gasto: contabiliza su asiento (`expense:<id>`) y lo marca registrado. Idempotente: repetirlo devuelve el
   * gasto ya registrado. Si mientras tanto se anuló el borrador, el asiento recién creado se revierte.
   */
  async registerExpense(id: number, actor: FinanceActor) {
    const e = await this.expense(id);
    if (e.status === "registered") return e;
    if (e.status === "void") throw new FinanceError("invalid_state", "El gasto está anulado");
    if (e.kind !== "ticket" && !e.supplierId) throw bad("Elige el proveedor antes de registrar el gasto");
    if (e.kind !== "ticket" && !e.invoiceNumber) throw bad("Indica el número de la factura del proveedor antes de registrarla");
    if (!e.categoryId) throw bad("Elige la categoría del gasto");
    const cat = await this.s.getCategory(e.categoryId);
    if (!cat) throw bad("La categoría no existe");
    const supplier = e.supplierId ? await this.s.getSupplier(e.supplierId) : null;
    if (e.kind === "rectification") {
      const orig = e.rectifiesExpenseId ? await this.s.getExpense(e.rectifiesExpenseId) : null;
      if (!orig || orig.status !== "registered") throw new FinanceError("invalid_state", "La factura que se rectifica debe estar registrada");
    }
    const { entry, created } = await this.d.finance.postGenerated(expenseEntry(e, { categoryAccount: cat.accountCode, supplierAccount: supplier?.accountCode ?? "410", supplierName: supplier?.name ?? null }), actor);
    if (!(await this.s.markExpenseRegistered(id, entry.id, actor.by, this.now()))) {
      const cur = await this.expense(id);
      if (cur.status === "registered" && cur.entryId === entry.id) return cur;
      // Anulado a la vez que se registraba: el asiento no puede quedar vivo
      if (created) await this.d.finance.reverse(entry.id, { date: this.reversalDate(entry), reason: "Gasto anulado mientras se registraba" }, actor);
      throw new FinanceError("invalid_state", "El gasto ha cambiado de estado mientras se registraba");
    }
    await this.audit(actor, "expense.register", "expense", id, { entryId: entry.id, totalCents: e.totalCents });
    return this.expense(id);
  }

  /** Anula un gasto. Registrado: revierte su asiento y exige que no tenga pagos vigentes (revertirlos antes). */
  async voidExpense(id: number, reason: string, actor: FinanceActor) {
    const why = reasonOf(reason, "la anulación");
    const e = await this.expense(id);
    if (e.status === "void") throw new FinanceError("invalid_state", "El gasto ya está anulado");
    if (e.status === "registered") {
      const live = (await this.s.listPayments([id])).filter((p) => p.status === "posted");
      if (live.length) throw new FinanceError("invalid_state", `El gasto tiene ${live.length} pago(s) vigente(s): reviértelos antes de anularlo`);
      if (e.entryId) {
        const entry = await this.d.ledger.getEntry(e.entryId);
        if (entry) await this.d.finance.reverse(entry.id, { date: this.reversalDate(entry), reason: `Anulación del gasto: ${why}` }, actor);
      }
    }
    if (!(await this.s.markExpenseVoid(id, e.status, { by: actor.by, at: this.now(), reason: why }))) throw new FinanceError("invalid_state", "El gasto ha cambiado de estado; vuelve a cargarlo");
    await this.audit(actor, "expense.void", "expense", id, { from: e.status, reason: why, reversedEntryId: e.entryId });
    return this.expense(id);
  }

  // ── Pagos ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private async registeredForPayment(expenseId: number, amountCents: number) {
    const e = await this.expense(expenseId);
    if (e.status !== "registered") throw new FinanceError("invalid_state", "Solo se pagan gastos registrados");
    if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw bad("El importe del pago es un número de céntimos distinto de cero");
    const pending = pendingOf(e);
    if (pending === 0) throw new FinanceError("exceeds_pending", "El gasto ya está pagado");
    if (Math.sign(amountCents) !== Math.sign(pending)) throw bad(pending > 0 ? "El importe del pago es positivo" : "En una rectificativa el importe (devolución) es negativo");
    // Comprobación temprana; la definitiva la hace el almacén con la fila del gasto bloqueada
    if (Math.abs(amountCents) > Math.abs(pending)) throw new FinanceError("exceeds_pending", "El importe supera lo pendiente de pago");
    const supplier = e.supplierId ? await this.s.getSupplier(e.supplierId) : null;
    return { e, supplierAccount: supplier?.accountCode ?? "410", supplierName: supplier?.name ?? null };
  }

  /** Cuenta de tesorería del pago: el banco (572000NN), la caja (570000NN) o Stripe (5720). */
  private async treasuryOf(method: PaymentMethod, bankAccountId: number | null | undefined, cashAccountId: number | null | undefined) {
    if (bankAccountId && cashAccountId) throw bad("Un pago sale de un banco o de una caja, no de los dos");
    if (bankAccountId) {
      if (method === "cash") throw bad("Un pago en efectivo sale de una caja");
      const b = await this.s.getBankAccount(bankAccountId);
      if (!b || !b.active) throw bad("La cuenta bancaria no existe o está desactivada");
      return { account: b.accountCode, bankAccountId: b.id, cashAccountId: null };
    }
    if (cashAccountId) {
      if (method !== "cash" && method !== "other") throw bad("Un pago desde caja es en efectivo");
      const c = await this.s.getCashAccount(cashAccountId);
      if (!c || !c.active) throw bad("La caja no existe o está desactivada");
      return { account: c.accountCode, bankAccountId: null, cashAccountId: c.id };
    }
    if (method === "stripe") return { account: OPS_ACCOUNTS.stripe, bankAccountId: null, cashAccountId: null };
    if (method === "cash") throw bad("Elige la caja del pago");
    throw bad("Elige la cuenta bancaria del pago");
  }

  /** Pago registrado a mano: asiento `expense-payment:<id>`. Si no se puede contabilizar, el pago no queda vigente. */
  async addPayment(expenseId: number, i: PaymentInput, actor: FinanceActor) {
    if (!isValidDate(i.paidOn)) throw bad("La fecha del pago no es válida (AAAA-MM-DD)");
    const { e, supplierAccount, supplierName } = await this.registeredForPayment(expenseId, i.amountCents);
    const t = await this.treasuryOf(i.method, i.bankAccountId, i.cashAccountId);
    const label = `Pago ${e.invoiceNumber ?? `gasto #${e.id}`}${supplierName ? ` · ${supplierName}` : ""}`;
    const draft = (key: string) => paymentEntry({ amountCents: i.amountCents, date: i.paidOn, supplierAccount, treasuryAccount: t.account, supplierId: e.supplierId, label, sourceKey: key });
    await this.d.finance.checkPostable(draft("expense-payment:0"));
    const p = await this.s.insertPayment({ expenseId, paidOn: i.paidOn, amountCents: i.amountCents, method: i.method, bankAccountId: t.bankAccountId, cashAccountId: t.cashAccountId, reference: text(i.reference, 140), bankMovementId: null, createdBy: actor.by, createdAt: this.now() });
    let entry: Entry;
    try {
      entry = (await this.d.finance.postGenerated(draft(expensePaymentSourceKey(p.id)), actor)).entry;
    } catch (err) {
      await this.s.markPayment(p.id, "void", { by: actor.by, at: this.now(), reason: "No se pudo contabilizar" });
      throw err;
    }
    await this.s.setPaymentEntry(p.id, entry.id);
    const expense = await this.s.refreshExpensePaid(expenseId);
    await this.audit(actor, "expense_payment.create", "expense_payment", p.id, { expenseId, amountCents: i.amountCents, entryId: entry.id });
    return { item: (await this.s.getPayment(p.id))!, expense: this.expenseDto(expense) };
  }

  /**
   * Revierte un pago: asiento espejo, el pago queda «reversed», el gasto recalcula lo pendiente y, si estaba
   * conciliado con un movimiento bancario, el movimiento vuelve a pendiente.
   */
  async reversePayment(id: number, reason: string, actor: FinanceActor) {
    const why = reasonOf(reason, "la reversión");
    const p = await this.s.getPayment(id);
    if (!p) throw notFound("Pago");
    if (p.status !== "posted") throw new FinanceError("invalid_state", "El pago no está vigente");
    if (p.entryId) {
      const entry = await this.d.ledger.getEntry(p.entryId);
      if (entry) await this.d.finance.reverse(entry.id, { date: this.reversalDate(entry), reason: `Reversión del pago: ${why}` }, actor);
    }
    if (!(await this.s.markPayment(id, "reversed", { by: actor.by, at: this.now(), reason: why }))) throw new FinanceError("invalid_state", "El pago ya no está vigente");
    if (p.bankMovementId) {
      const m = await this.s.getMovement(p.bankMovementId);
      if (m && m.status === "matched" && m.matchType === "expense_payment" && m.matchId === p.id) await this.s.releaseMovement(m.id, "matched");
    }
    await this.s.refreshExpensePaid(p.expenseId);
    await this.audit(actor, "expense_payment.reverse", "expense_payment", id, { expenseId: p.expenseId, entryId: p.entryId, bankMovementId: p.bankMovementId, reason: why });
    return (await this.s.getPayment(id))!;
  }

  // ── Documentos ────────────────────────────────────────────────────────────────────────────────────────────────

  private async ownerExists(ownerType: DocumentOwner, ownerId: number) {
    const found =
      ownerType === "expense" ? await this.s.getExpense(ownerId) : ownerType === "supplier" ? await this.s.getSupplier(ownerId) : ownerType === "bank_import" ? await this.s.getImport(ownerId) : await this.d.ledger.getEntry(ownerId);
    if (!found) throw new FinanceError("not_found", "No existe el elemento al que se adjunta el documento");
  }

  /** Base64 estricto → bytes (sin espacios ni caracteres ajenos). */
  private decodeBase64(b64: string) {
    const clean = (b64 ?? "").replace(/\s+/g, "");
    if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw bad("El contenido no es base64 válido");
    if ((clean.length / 4) * 3 > MAX_DOCUMENT_BYTES + 3) throw bad("El fichero supera el máximo de 10 MB");
    const buf = Buffer.from(clean, "base64");
    if (!buf.length) throw bad("El fichero está vacío");
    if (buf.length > MAX_DOCUMENT_BYTES) throw bad("El fichero supera el máximo de 10 MB");
    return buf;
  }

  async uploadDocument(i: { ownerType: DocumentOwner; ownerId: number; filename: string; contentBase64: string }, actor: FinanceActor) {
    await this.ownerExists(i.ownerType, i.ownerId);
    const buf = this.decodeBase64(i.contentBase64);
    const filename = safeFilename(i.filename);
    const kind = sniffDocument(buf, filename);
    if (!kind) throw bad("Solo se admiten PDF, PNG, JPEG, XML o CSV (se comprueba el contenido, no la extensión)");
    const doc = await this.s.insertDocument({ ownerType: i.ownerType, ownerId: i.ownerId, filename, mime: kind.mime, sizeBytes: buf.length, sha256: sha256Hex(buf), uploadedBy: actor.by, createdAt: this.now() }, buf);
    await this.audit(actor, "document.upload", "document", doc.id, { ownerType: i.ownerType, ownerId: i.ownerId, mime: kind.mime, sizeBytes: buf.length, sha256: doc.sha256 });
    return doc;
  }

  documents(ownerType: DocumentOwner, ownerId: number) {
    return this.s.listDocuments(ownerType, ownerId);
  }

  async documentContent(id: number) {
    const doc = await this.s.getDocument(id);
    const content = doc ? await this.s.getDocumentContent(id) : null;
    if (!doc || !content) throw notFound("Documento");
    return { doc, content };
  }

  async archiveDocument(id: number, actor: FinanceActor) {
    const before = await this.s.getDocument(id);
    if (!before) throw notFound("Documento");
    const doc = (await this.s.archiveDocument(id, actor.by, this.now()))!;
    if (!before.archived) await this.audit(actor, "document.archive", "document", id, { ownerType: doc.ownerType, ownerId: doc.ownerId });
    return doc;
  }

  // ── Gastos recurrentes ────────────────────────────────────────────────────────────────────────────────────────

  private async recurringFields(i: RecurringInput) {
    if (!(await this.s.getSupplier(i.supplierId))) throw bad("El proveedor no existe");
    if (!(await this.s.getCategory(i.categoryId))) throw bad("La categoría no existe");
    if (i.costCenterId && !(await this.s.getCostCenter(i.costCenterId))) throw bad("El centro de coste no existe");
    const description = i.description.trim();
    if (!description || description.length > 400) throw bad("Describe el gasto (máximo 400 caracteres)");
    checkExpenseAmounts("invoice", { baseCents: i.baseCents, taxRateBp: i.taxRateBp, deductibleBp: i.deductibleBp ?? 10_000, withholdingRateBp: i.withholdingRateBp ?? 0 });
    if (!["monthly", "quarterly", "yearly"].includes(i.frequency)) throw bad("Frecuencia no válida");
    if (!Number.isInteger(i.dayOfMonth) || i.dayOfMonth < 1 || i.dayOfMonth > 28) throw bad("Día del mes entre 1 y 28 (vale para todos los meses)");
    if (!isValidDate(i.startDate)) throw bad("La fecha de inicio no es válida (AAAA-MM-DD)");
    if (i.endDate && (!isValidDate(i.endDate) || i.endDate < i.startDate)) throw bad("La fecha de fin no es válida o es anterior al inicio");
    return { supplierId: i.supplierId, categoryId: i.categoryId, costCenterId: i.costCenterId ?? null, description, baseCents: i.baseCents, taxRateBp: i.taxRateBp, deductibleBp: i.deductibleBp ?? 10_000, withholdingRateBp: i.withholdingRateBp ?? 0, frequency: i.frequency, dayOfMonth: i.dayOfMonth, startDate: i.startDate, endDate: i.endDate ?? null };
  }

  /** Próxima fecha de la plantilla aún sin borrador (null si ya no quedan). */
  private async nextPending(t: Pick<RecurringExpense, "id" | "frequency" | "dayOfMonth" | "startDate" | "endDate">) {
    const dates = recurringOccurrences(t, addDays(this.today(), RECURRING_HORIZON_DAYS + 400));
    const keys = dates.map((d) => recurringSourceKey(t.id, recurringPeriod(t.frequency, d)));
    const done = await this.s.existingExpenseSources(keys);
    return dates.find((_, i) => !done.has(keys[i])) ?? null;
  }

  recurring() {
    return this.s.listRecurring();
  }

  async createRecurring(i: RecurringInput, actor: FinanceActor) {
    const f = await this.recurringFields(i);
    let t = await this.s.insertRecurring({ ...f, nextDate: null, active: true, createdBy: actor.by, createdAt: this.now() });
    t = (await this.s.patchRecurring(t.id, { nextDate: await this.nextPending(t) }))!;
    await this.audit(actor, "recurring.create", "recurring", t.id, { frequency: t.frequency, baseCents: t.baseCents });
    return t;
  }

  async patchRecurring(id: number, p: Partial<RecurringInput> & { active?: boolean }, actor: FinanceActor) {
    const cur = await this.s.getRecurring(id);
    if (!cur) throw notFound("Gasto recurrente");
    const { active, ...rest } = p;
    const f = await this.recurringFields({ ...cur, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } as RecurringInput);
    const next = await this.nextPending({ ...f, id });
    const t = (await this.s.patchRecurring(id, { ...f, nextDate: next, ...(active !== undefined ? { active } : {}) }))!;
    await this.audit(actor, "recurring.update", "recurring", id, { fields: Object.keys(p) });
    return t;
  }

  private untilOf(until: string) {
    if (!isValidDate(until)) throw bad("Fecha límite no válida (AAAA-MM-DD)");
    if (until > addDays(this.today(), RECURRING_HORIZON_DAYS)) throw bad("Como mucho se generan los gastos del próximo año");
    return until;
  }

  private async occurrencesUntil(until: string) {
    const out: Array<{ t: RecurringExpense; date: string; sourceKey: string }> = [];
    for (const t of (await this.s.listRecurring()).filter((x) => x.active)) for (const date of recurringOccurrences(t, until)) out.push({ t, date, sourceKey: recurringSourceKey(t.id, recurringPeriod(t.frequency, date)) });
    return out;
  }

  /** Vista previa de los borradores que generaría `run` hasta esa fecha (con los ya generados marcados). */
  async previewRecurring(until: string) {
    const occ = await this.occurrencesUntil(this.untilOf(until));
    const done = await this.s.existingExpenseSources(occ.map((o) => o.sourceKey));
    return occ.map((o) => ({ templateId: o.t.id, date: o.date, description: o.t.description, baseCents: o.t.baseCents, totalCents: expenseAmounts(o.t).totalCents, sourceKey: o.sourceKey, exists: done.has(o.sourceKey) }));
  }

  /**
   * Genera los BORRADORES de gasto de las plantillas activas hasta `until` (no registra ni contabiliza nada).
   * Idempotente: un borrador por plantilla y periodo (`recurring:<plantilla>:<periodo>`, único en la BD).
   */
  async runRecurring(until: string, actor: FinanceActor) {
    const occ = await this.occurrencesUntil(this.untilOf(until));
    const done = await this.s.existingExpenseSources(occ.map((o) => o.sourceKey));
    let created = 0;
    let skipped = 0;
    const suppliers = new Map<number, Supplier | null>();
    for (const o of occ) {
      if (done.has(o.sourceKey)) {
        skipped++;
        continue;
      }
      if (!suppliers.has(o.t.supplierId)) suppliers.set(o.t.supplierId, await this.s.getSupplier(o.t.supplierId));
      const supplier = suppliers.get(o.t.supplierId) ?? null;
      const a = expenseAmounts(o.t);
      const r = await this.s.insertExpense({
        kind: "invoice",
        supplierId: o.t.supplierId,
        categoryId: o.t.categoryId,
        costCenterId: o.t.costCenterId ?? supplier?.defaultCostCenterId ?? null,
        invoiceNumber: null,
        invoiceDate: o.date,
        accrualDate: null,
        dueDate: supplier?.paymentTermsDays !== null && supplier?.paymentTermsDays !== undefined ? addDays(o.date, supplier.paymentTermsDays) : null,
        description: `${o.t.description} · ${recurringPeriod(o.t.frequency, o.date)}`.slice(0, 500),
        baseCents: a.baseCents,
        taxRateBp: o.t.taxRateBp,
        taxCents: a.taxCents,
        deductibleBp: o.t.deductibleBp,
        withholdingRateBp: o.t.withholdingRateBp,
        withholdingCents: a.withholdingCents,
        totalCents: a.totalCents,
        currency: "EUR",
        rectifiesExpenseId: null,
        sourceKey: o.sourceKey,
        createdBy: actor.by,
        createdAt: this.now(),
      });
      if (r.created) created++;
      else skipped++;
    }
    for (const t of (await this.s.listRecurring()).filter((x) => x.active)) {
      const next = await this.nextPending(t);
      if (next !== t.nextDate) await this.s.patchRecurring(t.id, { nextDate: next });
    }
    await this.audit(actor, "recurring.run", "recurring", null, { until, created, skipped });
    return { created, skipped };
  }

  // ── Saldos desde el libro ─────────────────────────────────────────────────────────────────────────────────────

  /** Saldos (debe − haber) hasta hoy de las cuentas que empiezan por estos prefijos. */
  private async balances(prefixes: string[]) {
    const today = this.today();
    const lines = (await Promise.all(prefixes.map((p) => this.d.ledger.postedLines({ to: today, accountPrefix: p })))).flat();
    return balancesOf(lines);
  }

  // ── Bancos ────────────────────────────────────────────────────────────────────────────────────────────────────

  async bankAccounts() {
    const [list, bal] = await Promise.all([this.s.listBankAccounts(), this.balances(["572"])]);
    return list.map((b) => ({ ...b, balanceCents: bal.get(b.accountCode) ?? 0 }));
  }

  private async bank(id: number): Promise<BankAccount> {
    const b = await this.s.getBankAccount(id);
    if (!b) throw notFound("Cuenta bancaria");
    return b;
  }

  /** Alta de una subcuenta 572000NN/570000NN siguiente (reintenta si otra alta simultánea toma el número). */
  private async newSubaccount(prefix: string, name: string, actor: FinanceActor) {
    for (let attempt = 1; ; attempt++) {
      const code = nextSubaccountCode(prefix, (await this.d.ledger.listAccounts()).map((a) => a.code));
      try {
        return await this.d.finance.createAccount({ code, name: name.slice(0, 160) }, actor);
      } catch (e) {
        if (!(e instanceof FinanceError && e.code === "conflict") || attempt >= 5) throw e;
      }
    }
  }

  /** Alta de cuenta bancaria con su subcuenta 572000NN en el plan contable (alta derivada: no exige administración). */
  async createBankAccount(i: { name: string; iban?: string | null; bankName?: string | null; openingDate?: string | null }, actor: FinanceActor) {
    const name = i.name.trim();
    if (!name || name.length > 120) throw bad("Escribe un nombre para la cuenta (máximo 120 caracteres)");
    const iban = i.iban?.trim() ? normalizeIban(i.iban) : null;
    if (iban && !isValidIban(iban)) throw bad("El IBAN no es válido (revisa los dígitos de control)");
    if (i.openingDate && !isValidDate(i.openingDate)) throw bad("La fecha de apertura no es válida (AAAA-MM-DD)");
    if (iban && (await this.s.listBankAccounts()).some((b) => b.iban === iban)) throw new FinanceError("conflict", "Ya hay una cuenta bancaria con ese IBAN");
    const account = await this.newSubaccount(OPS_ACCOUNTS.bankPrefix, `Banco: ${name}`, actor);
    const b = await this.s.insertBankAccount({ name, iban, bankName: text(i.bankName, 120), accountCode: account.code, openingDate: i.openingDate ?? null, active: true, createdBy: actor.by, createdAt: this.now() });
    await this.audit(actor, "bank_account.create", "bank_account", b.id, { accountCode: b.accountCode, iban: iban ? `…${iban.slice(-4)}` : null });
    return { ...b, balanceCents: 0 };
  }

  async patchBankAccount(id: number, p: { name?: string; bankName?: string | null; active?: boolean }, actor: FinanceActor) {
    await this.bank(id);
    const name = p.name?.trim();
    if (name !== undefined && (!name || name.length > 120)) throw bad("Escribe un nombre para la cuenta (máximo 120 caracteres)");
    const b = (await this.s.patchBankAccount(id, { name, bankName: p.bankName === undefined ? undefined : text(p.bankName, 120), active: p.active }))!;
    await this.audit(actor, "bank_account.update", "bank_account", id, { name, active: p.active });
    return { ...b, balanceCents: (await this.balances([b.accountCode])).get(b.accountCode) ?? 0 };
  }

  /**
   * Importa un extracto (Norma 43, CaixaBank o CSV con mapeo) en una cuenta: el mismo fichero dos veces → `conflict`;
   * los movimientos ya importados (misma clave en la cuenta) se cuentan como duplicados. El fichero original queda como
   * documento del extracto.
   */
  async importStatement(i: { bankAccountId: number; format: ImportFormat; filename: string; contentBase64: string; mapping?: CsvMapping | null }, actor: FinanceActor) {
    const b = await this.bank(i.bankAccountId);
    if (!b.active) throw new FinanceError("invalid_state", "La cuenta bancaria está desactivada");
    const buf = this.decodeBase64(i.contentBase64);
    const sha = sha256Hex(buf);
    const prev = await this.s.findImport(b.id, sha);
    if (prev) throw new FinanceError("conflict", `Este extracto ya se importó en esta cuenta (importación n.º ${prev.id}, ${prev.inserted} movimientos)`);
    let rows: ParsedMovement[];
    if (i.format === "norma43") {
      const accounts = parseNorma43(decodeText(buf));
      const own = spanishAccountOfIban(b.iban);
      if (own) for (const a of accounts) if (a.bank !== own.bank || a.branch !== own.branch || a.account !== own.account) throw bad(`El extracto es de la cuenta ${a.bank} ${a.branch} ${a.account}, no de ${b.name}`);
      if (!own && new Set(accounts.map((a) => `${a.bank}${a.branch}${a.account}`)).size > 1) throw bad("El extracto trae varias cuentas: indica el IBAN de la cuenta para comprobar cuál es");
      rows = accounts.flatMap((a) => a.movements);
    } else if (i.format === "caixabank") rows = parseCaixaBankBuffer(buf);
    else {
      if (!i.mapping) throw bad("Para un CSV indica el mapeo de columnas");
      rows = parseMappedCsv(decodeText(buf), i.mapping);
    }
    if (!rows.length) throw bad("El extracto no tiene movimientos");
    if (rows.length > MAX_IMPORT_ROWS) throw bad(`Como mucho ${MAX_IMPORT_ROWS} movimientos por extracto`);
    const filename = safeFilename(i.filename);
    const imp = await this.s.importMovements({ bankAccountId: b.id, format: i.format, filename, sha256: sha, rows: rows.length, importedBy: actor.by, createdAt: this.now() }, rows);
    const mime = i.format === "caixabank" ? (buf[0] === 0x50 && buf[1] === 0x4b ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream") : i.format === "csv" ? "text/csv" : "text/plain";
    await this.s.insertDocument({ ownerType: "bank_import", ownerId: imp.id, filename, mime, sizeBytes: buf.length, sha256: sha, uploadedBy: actor.by, createdAt: this.now() }, buf);
    await this.audit(actor, "bank_import.create", "bank_import", imp.id, { bankAccountId: b.id, format: i.format, rows: imp.rows, inserted: imp.inserted, duplicates: imp.duplicates, sha256: sha });
    return imp;
  }

  imports(bankAccountId?: number) {
    return this.s.listImports(bankAccountId);
  }

  movements(q: MovementQuery) {
    return this.s.listMovements(q);
  }

  private async movement(id: number): Promise<BankMovement> {
    const m = await this.s.getMovement(id);
    if (!m) throw notFound("Movimiento");
    return m;
  }

  /** Sugerencias de conciliación de un movimiento pendiente (importe exacto, fecha ±7 días, proveedor en el concepto). */
  async suggestions(id: number): Promise<Array<Omit<MatchSuggestion, "score">>> {
    const m = await this.movement(id);
    if (m.status !== "pending") return [];
    const [expenses, payments] = await Promise.all([this.s.openExpenses(SCAN_LIMIT), this.s.openPayments(m.bankAccountId, SCAN_LIMIT)]);
    const byId = new Map((await this.s.getExpensesByIds(Array.from(new Set(payments.map((p) => p.expenseId))))).map((e) => [e.id, e]));
    const out = suggestMatches(
      m,
      expenses.map((e) => ({ id: e.id, supplierName: e.supplierName, invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate, dueDate: e.dueDate, pendingCents: pendingOf(e) })),
      payments.map((p) => ({ id: p.id, expenseId: p.expenseId, supplierName: byId.get(p.expenseId)?.supplierName ?? null, invoiceNumber: byId.get(p.expenseId)?.invoiceNumber ?? null, paidOn: p.paidOn, amountCents: p.amountCents })),
    );
    return out.map(({ score: _s, ...x }) => x);
  }

  /** Primera clave libre del movimiento: `bankmov:<id>`, y tras desvincular `bankmov:<id>:2`, `:3`… */
  private async movementKey(id: number) {
    for (let n = 1; ; n++) {
      const key = bankMovementSourceKey(id, n);
      if (!(await this.d.ledger.bySource(key))) return key;
    }
  }

  /**
   * Concilia un movimiento pendiente. El movimiento se RESERVA primero (cambio de estado condicional): dos
   * conciliaciones simultáneas no pueden ganar las dos; si algo falla, vuelve a pendiente.
   *  - `{type: expense_payment, expenseId}`: crea el pago desde el movimiento; asiento `bankmov:<id>`.
   *  - `{type: expense_payment, expensePaymentId}`: vincula un pago registrado a mano; NO crea asiento.
   *  - `{type: transfer|tax|payroll|other, accountCode}`: asiento contra esa cuenta; `bankmov:<id>`.
   */
  async match(id: number, i: MatchInput, actor: FinanceActor): Promise<BankMovement> {
    const m = await this.movement(id);
    if (m.status !== "pending") throw new FinanceError("invalid_state", m.status === "matched" ? "El movimiento ya está conciliado" : "El movimiento está ignorado: desvincúlalo antes");
    const bank = await this.bank(m.bankAccountId);
    if (i.type === "expense_payment" && i.expensePaymentId) return this.linkPayment(m, i.expensePaymentId, actor);
    // Validar antes de reservar: los errores de datos no tocan el movimiento
    let build: (key: string) => Promise<{ draft: Parameters<FinanceService["postGenerated"]>[0]; paymentOf?: Parameters<FinanceOpsStore["insertPayment"]>[0] }>;
    if (i.type === "expense_payment") {
      if (!i.expenseId) throw bad("Indica el gasto o el pago con el que se concilia");
      const { e, supplierAccount, supplierName } = await this.registeredForPayment(i.expenseId, -m.amountCents);
      const label = `Pago ${e.invoiceNumber ?? `gasto #${e.id}`}${supplierName ? ` · ${supplierName}` : ""} (banco)`;
      build = async (key) => ({
        draft: paymentEntry({ amountCents: -m.amountCents, date: m.bookingDate, supplierAccount, treasuryAccount: bank.accountCode, supplierId: e.supplierId, label, sourceKey: key }),
        paymentOf: { expenseId: e.id, paidOn: m.bookingDate, amountCents: -m.amountCents, method: "bank", bankAccountId: bank.id, cashAccountId: null, reference: m.reference ?? text(m.description, 140), bankMovementId: m.id, createdBy: actor.by, createdAt: this.now() },
      });
    } else {
      if (!["transfer", "tax", "payroll", "other"].includes(i.type)) throw bad("Tipo de conciliación no válido");
      const code = (i as { accountCode: string }).accountCode?.trim();
      if (!code) throw bad("Elige la cuenta de contrapartida");
      if (code.startsWith("57") && i.type !== "transfer") throw bad("Contra otra cuenta de tesorería usa «Transferencia interna»");
      const description = (i as { description?: string | null }).description ?? null;
      build = async (key) => ({ draft: bankCounterpartEntry(m, bank.accountCode, code, description, key) });
    }
    await this.d.finance.checkPostable((await build(bankMovementSourceKey(m.id, 1))).draft);
    const claimed = await this.s.claimMovement(m.id, { from: "pending", to: "matched", matchType: i.type, by: actor.by, at: this.now(), bump: true });
    if (!claimed) throw new FinanceError("conflict", "El movimiento ya no está pendiente (otra persona lo ha conciliado)");
    let paymentId: number | null = null;
    try {
      const { draft, paymentOf } = await build(await this.movementKey(m.id));
      if (paymentOf) paymentId = (await this.s.insertPayment(paymentOf)).id;
      const { entry } = await this.d.finance.postGenerated(draft, actor);
      if (paymentId) {
        await this.s.setPaymentEntry(paymentId, entry.id);
        await this.s.refreshExpensePaid(paymentOf!.expenseId);
      }
      await this.s.setMovementMatch(m.id, paymentId, entry.id);
      await this.audit(actor, "bank_movement.match", "bank_movement", m.id, { type: i.type, entryId: entry.id, sourceKey: entry.sourceKey, expensePaymentId: paymentId });
    } catch (err) {
      if (paymentId) await this.s.markPayment(paymentId, "void", { by: actor.by, at: this.now(), reason: "No se pudo contabilizar" });
      await this.s.releaseMovement(m.id, "matched");
      throw err;
    }
    return this.movement(m.id);
  }

  /** Vincula un pago registrado a mano con su movimiento: mismo importe y misma cuenta; sin asiento nuevo. */
  private async linkPayment(m: BankMovement, paymentId: number, actor: FinanceActor) {
    const p = await this.s.getPayment(paymentId);
    if (!p) throw notFound("Pago");
    if (p.status !== "posted") throw new FinanceError("invalid_state", "El pago no está vigente");
    if (p.bankMovementId) throw new FinanceError("invalid_state", "El pago ya está vinculado a otro movimiento");
    if (p.amountCents !== -m.amountCents) throw bad("El importe del pago no coincide con el del movimiento");
    if (p.bankAccountId !== m.bankAccountId) throw bad("El pago se contabilizó contra otra cuenta de tesorería: revierte el pago y concilia el movimiento con el gasto");
    const claimed = await this.s.claimMovement(m.id, { from: "pending", to: "matched", matchType: "expense_payment", by: actor.by, at: this.now(), bump: false });
    if (!claimed) throw new FinanceError("conflict", "El movimiento ya no está pendiente (otra persona lo ha conciliado)");
    if (!(await this.s.linkPaymentMovement(p.id, m.id, null))) {
      await this.s.releaseMovement(m.id, "matched");
      throw new FinanceError("conflict", "El pago acaba de vincularse a otro movimiento");
    }
    await this.s.setMovementMatch(m.id, p.id, null);
    await this.audit(actor, "bank_movement.link", "bank_movement", m.id, { expensePaymentId: p.id, entryId: p.entryId });
    return this.movement(m.id);
  }

  /**
   * Desvincula: si la conciliación CREÓ un asiento, lo revierte (y anula el pago que creó); si solo vinculó un pago
   * manual, deshace el vínculo sin tocar el libro. Un movimiento ignorado vuelve a pendiente.
   */
  async unmatch(id: number, actor: FinanceActor): Promise<BankMovement> {
    const m = await this.movement(id);
    if (m.status === "pending") throw new FinanceError("invalid_state", "El movimiento no está conciliado");
    if (m.status === "ignored") {
      await this.s.releaseMovement(id, "ignored");
      await this.audit(actor, "bank_movement.unignore", "bank_movement", id, null);
      return this.movement(id);
    }
    if (m.entryId) {
      const entry = await this.d.ledger.getEntry(m.entryId);
      if (entry) await this.d.finance.reverse(entry.id, { date: this.reversalDate(entry), reason: "Desvinculación del movimiento bancario" }, actor);
      if (m.matchType === "expense_payment" && m.matchId) {
        const p = await this.s.getPayment(m.matchId);
        if (p && (await this.s.markPayment(p.id, "reversed", { by: actor.by, at: this.now(), reason: "Desvinculación del movimiento bancario" }))) await this.s.refreshExpensePaid(p.expenseId);
      }
    } else if (m.matchType === "expense_payment" && m.matchId) await this.s.linkPaymentMovement(m.matchId, null, m.id);
    await this.s.releaseMovement(id, "matched");
    await this.audit(actor, "bank_movement.unmatch", "bank_movement", id, { matchType: m.matchType, matchId: m.matchId, reversedEntryId: m.entryId });
    return this.movement(id);
  }

  async ignore(id: number, actor: FinanceActor): Promise<BankMovement> {
    const m = await this.movement(id);
    if (m.status === "ignored") return m;
    if (m.status === "matched") throw new FinanceError("invalid_state", "El movimiento está conciliado: desvincúlalo antes");
    if (!(await this.s.claimMovement(id, { from: "pending", to: "ignored", matchType: null, by: actor.by, at: this.now(), bump: false }))) throw new FinanceError("conflict", "El movimiento ha cambiado de estado");
    await this.audit(actor, "bank_movement.ignore", "bank_movement", id, null);
    return this.movement(id);
  }

  // ── Caja ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async cashAccounts() {
    const [list, bal] = await Promise.all([this.s.listCashAccounts(), this.balances(["570"])]);
    return list.map((c) => ({ ...c, balanceCents: bal.get(c.accountCode) ?? 0 }));
  }

  async createCashAccount(i: { name: string }, actor: FinanceActor) {
    const name = i.name.trim();
    if (!name || name.length > 120) throw bad("Escribe un nombre para la caja (máximo 120 caracteres)");
    const account = await this.newSubaccount(OPS_ACCOUNTS.cashPrefix, `Caja: ${name}`, actor);
    const c = await this.s.insertCashAccount({ name, accountCode: account.code, active: true, createdBy: actor.by, createdAt: this.now() });
    await this.audit(actor, "cash_account.create", "cash_account", c.id, { accountCode: c.accountCode });
    return { ...c, balanceCents: 0 };
  }

  cashMovements(q: { cashAccountId?: number; limit?: number; offset?: number }) {
    return this.s.listCashMovements(q);
  }

  /** Movimiento de caja contabilizado (`cash:<id>`) contra la contrapartida indicada. */
  async createCashMovement(i: { cashAccountId: number; movedOn: string; amountCents: number; description: string; counterpartAccountCode: string }, actor: FinanceActor) {
    const c: CashAccount | null = await this.s.getCashAccount(i.cashAccountId);
    if (!c || !c.active) throw bad("La caja no existe o está desactivada");
    if (!isValidDate(i.movedOn)) throw bad("La fecha no es válida (AAAA-MM-DD)");
    if (!Number.isSafeInteger(i.amountCents) || i.amountCents === 0) throw bad("El importe es un número de céntimos distinto de cero (negativo = salida)");
    const description = i.description.trim();
    if (!description || description.length > 300) throw bad("Describe el movimiento (máximo 300 caracteres)");
    const draft = (key: string) => cashEntry({ amountCents: i.amountCents, movedOn: i.movedOn, description }, c.accountCode, i.counterpartAccountCode, key);
    await this.d.finance.checkPostable(draft("cash:0"));
    const row = await this.s.insertCashMovement({ cashAccountId: c.id, movedOn: i.movedOn, amountCents: i.amountCents, description, counterpartAccountCode: i.counterpartAccountCode, createdBy: actor.by, createdAt: this.now() });
    let entry: Entry;
    try {
      entry = (await this.d.finance.postGenerated(draft(cashMovementSourceKey(row.id)), actor)).entry;
    } catch (err) {
      await this.s.voidCashMovement(row.id);
      throw err;
    }
    await this.s.setCashMovementEntry(row.id, entry.id);
    await this.audit(actor, "cash_movement.create", "cash_movement", row.id, { cashAccountId: c.id, amountCents: i.amountCents, entryId: entry.id });
    return { ...row, entryId: entry.id };
  }

  // ── Resumen ───────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Resumen completo del panel (desde el libro): el de la fase 1A más saldos de bancos y caja, acreedores pendientes
   * (saldo acreedor de 400 y 410) e IVA soportado del trimestre (472, sin regularización, cierre ni apertura).
   */
  async summary() {
    const base = await this.d.finance.summary();
    const today = this.today();
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    const quarterFrom = `${yearOf(today)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    const [banks, cash, bal, vat] = await Promise.all([
      this.s.listBankAccounts(),
      this.s.listCashAccounts(),
      this.balances(["57", "400", "410"]),
      this.d.ledger.postedLines({ from: quarterFrom, to: today, accountCode: OPS_ACCOUNTS.vatInput, excludeOrigins: CLOSING }),
    ]);
    const bankRows = banks.map((b) => ({ id: b.id, name: b.name, accountCode: b.accountCode, balanceCents: bal.get(b.accountCode) ?? 0 }));
    const cashRows = cash.map((c) => ({ id: c.id, name: c.name, accountCode: c.accountCode, balanceCents: bal.get(c.accountCode) ?? 0 }));
    let payables = 0;
    for (const [code, v] of Array.from(bal.entries())) if (code.startsWith("400") || code.startsWith("410")) payables -= v;
    return {
      ...base,
      bankBalanceCents: bankRows.reduce((a, b) => a + b.balanceCents, 0),
      cashBalanceCents: cashRows.reduce((a, c) => a + c.balanceCents, 0),
      payablesCents: payables,
      vatInputQuarterCents: netMovement(vat, OPS_ACCOUNTS.vatInput, quarterFrom, today),
      banks: bankRows,
      cash: cashRows,
    };
  }
}

