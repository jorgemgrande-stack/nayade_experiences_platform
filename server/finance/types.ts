/**
 * Finanzas corporativas de Big Elephant (IRON ELEPHANT CONSULTING, S.L.), fase 1A: libro contable de partida doble
 * (CRM 0033). Datos SOLO en la base del CRM, tablas `fin_*`. Importes en céntimos enteros, tipos en puntos básicos
 * (2100 = 21 %), fechas contables «AAAA-MM-DD» en Europe/Madrid. Ver docs/elephant-source/FINANZAS_CORPORATIVAS.md.
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_CODES = ["GEN", "VEN", "COM", "BAN", "CAJ", "STR", "NOM", "IMP", "APE", "REG", "CIE"] as const;
export type JournalCode = (typeof JOURNAL_CODES)[number];

export const ENTRY_ORIGINS = ["manual", "invoice", "expense", "expense_payment", "bank", "cash", "recurring", "reversal", "closing", "opening", "regularization", "stripe", "tax", "payroll"] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

export const ENTRY_STATUSES = ["draft", "posted", "void"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export type OpenClosed = "open" | "closed";

export interface Account {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  parentCode: string | null;
  isPostable: boolean;
  active: boolean;
  createdAt: number;
}

export interface Journal {
  code: JournalCode;
  name: string;
}

export interface Period {
  year: number;
  month: number;
  status: OpenClosed;
  closedAt: number | null;
  closedBy: string | null;
}

export interface FiscalYear {
  year: number;
  status: OpenClosed;
  createdAt: number;
  createdBy: string;
  closedAt: number | null;
  closedBy: string | null;
  periods: Period[];
}

/** Línea de un asiento tal y como se propone (sin identificadores). Exactamente uno de debe o haber es > 0. */
export interface EntryLineInput {
  accountCode: string;
  debitCents: number;
  creditCents: number;
  description?: string | null;
  costCenterId?: number | null;
  supplierId?: number | null;
  /** Empresa cliente del CRM: solo referencia, nunca datos del tenant. */
  companyId?: number | null;
  taxRateBp?: number | null;
  taxBaseCents?: number | null;
}

export interface EntryLine {
  lineNo: number;
  accountCode: string;
  debitCents: number;
  creditCents: number;
  description: string | null;
  costCenterId: number | null;
  supplierId: number | null;
  companyId: number | null;
  taxRateBp: number | null;
  taxBaseCents: number | null;
}

export interface Entry {
  id: number;
  year: number;
  /** Correlativo por ejercicio; null mientras es borrador o si se anuló sin contabilizar. */
  number: number | null;
  journalCode: JournalCode;
  date: string;
  description: string;
  origin: EntryOrigin;
  sourceKey: string | null;
  status: EntryStatus;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  createdBy: string;
  createdAt: number;
  postedBy: string | null;
  postedAt: number | null;
  voidedBy: string | null;
  voidedAt: number | null;
  voidReason: string | null;
  lines: EntryLine[];
}

/** Asiento propuesto (manual o generado), antes de guardarlo. */
export interface EntryDraft {
  journalCode: JournalCode;
  date: string;
  description: string;
  origin: EntryOrigin;
  sourceKey: string | null;
  lines: EntryLineInput[];
}

/** Línea contabilizada con los datos de su asiento (para el mayor, sumas y saldos y exportaciones). */
export interface PostedLine extends EntryLine {
  entryId: number;
  year: number;
  number: number;
  date: string;
  journalCode: JournalCode;
  origin: EntryOrigin;
  entryDescription: string;
}

export interface AuditRow {
  at: number;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: Record<string, unknown> | null;
  requestId: string | null;
}

/** Quién actúa: «tipo:id» como en el resto del plano de control, más el identificador de correlación. */
export interface FinanceActor {
  by: string;
  requestId: string | null;
}

export type FinanceErrorCode =
  | "not_found"
  | "invalid_input"
  | "unbalanced"
  | "invalid_account"
  | "period_closed"
  | "invalid_state"
  | "conflict"
  | "exceeds_pending"
  | "forbidden"
  | "unavailable"
  // Parametrización fiscal (CRM 0039)
  | "tax_config_not_validated"
  | "corporate_year_unset"
  | "vat_id_required"
  | "invalid_rule";

/** Estado HTTP de cada código (la API los traduce; el servicio solo lanza). */
export const FINANCE_ERROR_STATUS: Record<FinanceErrorCode, number> = {
  not_found: 404,
  invalid_input: 400,
  unbalanced: 422,
  invalid_account: 422,
  period_closed: 409,
  invalid_state: 409,
  conflict: 409,
  /** Un pago que supera lo pendiente del gasto (comprobado con la fila del gasto bloqueada). */
  exceeds_pending: 409,
  forbidden: 403,
  unavailable: 503,
  /** La configuración fiscal no está validada con la gestoría: los borradores se ven, pero no se revisan ni se presentan. */
  tax_config_not_validated: 409,
  /** El Impuesto sobre Sociedades del ejercicio no está configurado (régimen y tramos): el 200 no se revisa. */
  corporate_year_unset: 409,
  /** Operación intracomunitaria sin el NIF-IVA del proveedor. */
  vat_id_required: 400,
  /** Regla de IVA de las comisiones de Stripe incoherente (p. ej. inversión del sujeto pasivo con un emisor español). */
  invalid_rule: 400,
};

export class FinanceError extends Error {
  constructor(
    public readonly code: FinanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FinanceError";
  }
}
