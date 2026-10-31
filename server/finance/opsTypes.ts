/**
 * Finanzas corporativas de Big Elephant, fase 1B (CRM 0035): centros de coste, categorías, proveedores, gastos
 * (facturas recibidas) y sus pagos, documentos, gastos recurrentes, bancos (cuentas, extractos, movimientos y
 * conciliación) y caja. Mismos convenios que la fase 1A: céntimos enteros, puntos básicos, fechas «AAAA-MM-DD».
 * Las formas son las que consume el CRM (anexo CRM-ESPERA).
 */

export const EXPENSE_KINDS = ["invoice", "rectification", "ticket"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];
export const EXPENSE_STATUSES = ["draft", "registered", "void"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const PAYMENT_STATUSES = ["pending", "partial", "paid"] as const;
export type ExpensePaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_METHODS = ["bank", "cash", "card", "stripe", "direct_debit", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** `void`: el pago no llegó a contabilizarse (fallo al contabilizar tras guardarlo); no cuenta para nada. */
export type PaymentRowStatus = "posted" | "reversed" | "void";
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const DOCUMENT_OWNERS = ["expense", "supplier", "bank_import", "entry"] as const;
export type DocumentOwner = (typeof DOCUMENT_OWNERS)[number];
export const IMPORT_FORMATS = ["norma43", "caixabank", "csv"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const MOVEMENT_STATUSES = ["pending", "matched", "ignored"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];
export const MATCH_TYPES = ["expense_payment", "invoice_payment", "transfer", "tax", "payroll", "other"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
/** Tipos de conciliación «contra cuenta» (movimiento sin gasto): asiento contra la cuenta que indica el operador. */
export const ACCOUNT_MATCH_TYPES = ["transfer", "tax", "payroll", "other"] as const;
export type AccountMatchType = (typeof ACCOUNT_MATCH_TYPES)[number];

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  accountCode: string;
  defaultTaxRateBp: number | null;
  active: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  legalName: string | null;
  taxId: string | null;
  country: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  paymentTermsDays: number | null;
  defaultCategoryId: number | null;
  defaultCostCenterId: number | null;
  accountCode: "400" | "410";
  notes: string | null;
  active: boolean;
  createdBy: string;
  createdAt: number;
}

export interface Expense {
  id: number;
  supplierId: number | null;
  categoryId: number | null;
  costCenterId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  accrualDate: string | null;
  dueDate: string | null;
  description: string;
  /** Con signo: negativa en las rectificativas. */
  baseCents: number;
  taxRateBp: number;
  taxCents: number;
  /** Parte deducible de la cuota (10000 = 100 %). */
  deductibleBp: number;
  withholdingRateBp: number;
  withholdingCents: number;
  totalCents: number;
  /** Suma de los pagos vigentes (con signo). */
  paidCents: number;
  currency: string;
  kind: ExpenseKind;
  rectifiesExpenseId: number | null;
  status: ExpenseStatus;
  entryId: number | null;
  paymentStatus: ExpensePaymentStatus;
  /** Solo los borradores de gastos recurrentes: `recurring:<plantilla>:<periodo>`. */
  sourceKey: string | null;
  createdBy: string;
  createdAt: number;
  registeredBy: string | null;
  registeredAt: number | null;
  voidedBy: string | null;
  voidedAt: number | null;
  voidReason: string | null;
}

export interface ExpensePayment {
  id: number;
  expenseId: number;
  paidOn: string;
  /** Con el signo de lo pendiente: negativo = devolución del proveedor por una rectificativa. */
  amountCents: number;
  method: PaymentMethod;
  bankAccountId: number | null;
  cashAccountId: number | null;
  reference: string | null;
  bankMovementId: number | null;
  entryId: number | null;
  status: PaymentRowStatus;
  createdBy: string;
  createdAt: number;
  reversedBy: string | null;
  reversedAt: number | null;
  reverseReason: string | null;
}

export interface FinDocument {
  id: number;
  ownerType: DocumentOwner;
  ownerId: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: number;
  archived: boolean;
  archivedAt: number | null;
  archivedBy: string | null;
}

export interface RecurringExpense {
  id: number;
  supplierId: number;
  categoryId: number;
  costCenterId: number | null;
  description: string;
  baseCents: number;
  taxRateBp: number;
  deductibleBp: number;
  withholdingRateBp: number;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextDate: string | null;
  active: boolean;
  createdBy: string;
  createdAt: number;
}

export interface BankAccount {
  id: number;
  name: string;
  iban: string | null;
  bankName: string | null;
  accountCode: string;
  openingDate: string | null;
  active: boolean;
  createdBy: string;
  createdAt: number;
}

export interface BankImport {
  id: number;
  bankAccountId: number;
  format: ImportFormat;
  filename: string;
  sha256: string;
  rows: number;
  inserted: number;
  duplicates: number;
  importedBy: string;
  createdAt: number;
}

export interface BankMovement {
  id: number;
  bankAccountId: number;
  importId: number | null;
  bookingDate: string;
  valueDate: string | null;
  /** Con signo: positivo = abono (entra dinero), negativo = cargo. */
  amountCents: number;
  description: string;
  reference: string | null;
  counterparty: string | null;
  balanceCents: number | null;
  duplicateKey: string;
  status: MovementStatus;
  matchType: MatchType | null;
  matchId: number | null;
  /** Asiento que CREÓ la conciliación (null si solo se vinculó a un pago ya contabilizado). */
  entryId: number | null;
  /** Veces que se ha conciliado creando asiento (la clave de origen cambia tras desvincular). */
  matchCount: number;
  matchedBy: string | null;
  matchedAt: number | null;
  createdAt: number;
}

export interface CashAccount {
  id: number;
  name: string;
  accountCode: string;
  active: boolean;
  createdBy: string;
  createdAt: number;
}

export interface CashMovement {
  id: number;
  cashAccountId: number;
  movedOn: string;
  amountCents: number;
  description: string;
  counterpartAccountCode: string;
  entryId: number | null;
  /** `void`: no llegó a contabilizarse (fallo al contabilizar tras guardarlo). */
  status: "posted" | "void";
  createdBy: string;
  createdAt: number;
}

/** Movimiento leído de un extracto, antes de guardarlo. */
export interface ParsedMovement {
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  description: string;
  reference: string | null;
  counterparty: string | null;
  balanceCents: number | null;
  duplicateKey: string;
}
