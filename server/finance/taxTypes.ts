/**
 * Finanzas corporativas de Big Elephant, fase 3 (CRM 0037): gestoría e impuestos. Configuración fiscal con historial,
 * libros registro de IVA, cálculo de los modelos (303, 390, 349, 347, 111, 190, 115, 180, 200, 202), nóminas,
 * calendario de obligaciones con su bitácora, presentación y pago registrados (el sistema NUNCA presenta nada ante la
 * AEAT ni la Seguridad Social), aplazamientos y expedientes. Mismos convenios que las fases 1 y 2: céntimos enteros,
 * puntos básicos, fechas «AAAA-MM-DD» en Europe/Madrid. Ver docs/elephant-source/FINANZAS_CORPORATIVAS.md §Fase 3.
 */

/** Texto obligatorio en cada borrador (lo muestra el CRM). */
export const DRAFT_NOTICE = "Borrador calculado por el sistema. Revísalo con tu gestoría: el sistema no presenta declaraciones.";

export const TAX_MODELS = ["303", "390", "349", "347", "111", "190", "115", "180", "200", "202", "SS"] as const;
export type TaxModel = (typeof TAX_MODELS)[number];

export const MODEL_NAMES: Record<TaxModel, string> = {
  "303": "IVA, autoliquidación",
  "390": "IVA, resumen anual",
  "349": "Operaciones intracomunitarias",
  "347": "Operaciones con terceras personas",
  "111": "Retenciones del trabajo y de actividades económicas",
  "190": "Retenciones del trabajo y de actividades económicas, resumen anual",
  "115": "Retenciones de arrendamientos de inmuebles urbanos",
  "180": "Retenciones de arrendamientos, resumen anual",
  "200": "Impuesto sobre Sociedades",
  "202": "Impuesto sobre Sociedades, pago fraccionado",
  SS: "Seguros sociales (RLC)",
};

/** Modelos que solo informan (no tienen importe que pagar). */
export const INFORMATIVE_MODELS: readonly TaxModel[] = ["390", "349", "347", "190", "180"];

/** Cuenta que salda el pago de cada modelo con resultado a ingresar (Debe cuenta · Haber banco). */
export const PAYMENT_ACCOUNT: Partial<Record<TaxModel, string>> = { "303": "4750", "111": "4751", "115": "4751", "200": "4752", "202": "473", SS: "476" };

export const OBLIGATION_STATUSES = ["no_aplica", "pendiente", "borrador", "revisado", "presentado", "pagado", "domiciliado", "aplazado", "a_compensar", "sin_actividad"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];
/** Estados posteriores a la presentación (el borrador ya no se sobrescribe: si cambian los datos, `stale`). */
export const PRESENTED_STATUSES: readonly ObligationStatus[] = ["presentado", "pagado", "domiciliado", "aplazado", "a_compensar", "sin_actividad"];
/** Estados en los que todavía hay trabajo antes del vencimiento (avisos). */
export const OPEN_STATUSES: readonly ObligationStatus[] = ["pendiente", "borrador", "revisado"];

export const OUTCOMES = ["a_ingresar", "a_compensar", "a_devolver", "sin_actividad", "cero"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const VAT_REGIMES = ["general", "exento", "mixto"] as const;
export type VatRegime = (typeof VAT_REGIMES)[number];
export const VAT_PERIODS = ["quarterly", "monthly"] as const;
export type VatPeriod = (typeof VAT_PERIODS)[number];
export const INSTALLMENT_METHODS = ["art40_2", "art40_3"] as const;
export type InstallmentMethod = (typeof INSTALLMENT_METHODS)[number];

export interface TaxSettings {
  /** false mientras nadie la ha guardado (valores neutros precargados con el emisor). */
  configured: boolean;
  legalName: string | null;
  taxId: string | null;
  fiscalYearStartMonth: number;
  vatRegime: VatRegime;
  vatPeriod: VatPeriod;
  redeme: boolean;
  /** Solo informativo: el sistema no envía nada al SII. */
  sii: boolean;
  /** Exonerada del 390 (lo marca el administrador; por defecto no). */
  vat390Exempt: boolean;
  /** Cuotas de IVA a compensar de antes de usar el sistema (casilla 110 del primer 303 sin anterior). */
  openingVatCompensationCents: number | null;
  corporateTaxRateBp: number;
  /** Primer ejercicio con base imponible positiva de una entidad de nueva creación (15 % ese y el siguiente). */
  newEntityFirstProfitYear: number | null;
  hasEmployees: boolean;
  hasProfessionalWithholdings: boolean;
  hasRentWithholdings: boolean;
  intraEuOperations: boolean;
  operations347: boolean;
  installmentPaymentsMethod: InstallmentMethod;
  /** NIF-IVA de Stripe Payments Europe para el 349 (adquisición de servicios con inversión del sujeto pasivo). */
  stripeVatId: string | null;
  /** Festivos adicionales (autonómicos, locales…) que trasladan un vencimiento: «AAAA-MM-DD». */
  extraHolidays: string[];
  gestoriaEmail: string | null;
  notes: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: number | null;
}

export type TaxSettingsInput = Partial<Omit<TaxSettings, "configured" | "version" | "updatedBy" | "updatedAt">>;

export interface TaxSettingsLogRow {
  id: number;
  at: number;
  actor: string;
  requestId: string | null;
  before: Partial<TaxSettings> | null;
  after: Partial<TaxSettings>;
}

// ── Borradores ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TaxBox {
  box: string;
  label: string;
  /** null = sin datos (nunca 0 por falta de datos). En céntimos salvo `unit` («count»: número; «bp»: puntos básicos). */
  valueCents: number | null;
  unit: "cents" | "count" | "bp";
}

/** De dónde sale una cifra: asiento, factura, gasto, nómina, otra obligación, ajuste o transacción de Stripe. */
export type DetailSource = "entry" | "invoice" | "expense" | "payroll" | "obligation" | "adjustment" | "stripe" | "settings";

export interface TaxDetail {
  box: string;
  source: DetailSource;
  ref: string;
  date: string | null;
  description: string;
  baseCents: number | null;
  taxCents: number | null;
  rateBp: number | null;
  taxId?: string | null;
  /** Número de la factura, del gasto o del asiento. */
  number?: string | null;
}

/** Declarado de un modelo informativo (349, 347, 190, 180): uno por tercero y clave. */
export interface Declarant {
  taxId: string | null;
  name: string;
  country: string | null;
  key: string;
  amountCents: number;
  withholdingCents?: number;
  quarters?: [number, number, number, number];
}

export interface TaxDraft {
  model: TaxModel;
  year: number;
  period: string;
  from: string;
  to: string;
  applicable: boolean;
  /** Por qué no aplica (o null). */
  reason: string | null;
  /** false = faltan datos: el resultado es null («sin datos»). */
  hasData: boolean;
  boxes: TaxBox[];
  details: TaxDetail[];
  declarants: Declarant[];
  warnings: string[];
  outcome: Outcome | null;
  resultCents: number | null;
  /** Datos auxiliares del modelo (p. ej. `carryForwardCents` del 303, `pendingLossesAfterCents` del 200). */
  extra: Record<string, number | string | boolean | null>;
  hash: string;
  computedAt: number;
  notice: string;
}

export interface StaleInfo {
  detectedAt: number;
  previousHash: string;
  currentHash: string;
  resultBefore: number | null;
  resultAfter: number | null;
  differences: Array<{ box: string; label: string; before: number | null; after: number | null }>;
}

// ── Obligaciones ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Obligation {
  id: number;
  key: string;
  model: TaxModel;
  year: number;
  period: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  status: ObligationStatus;
  amountCents: number | null;
  outcome: Outcome | null;
  draftHash: string | null;
  draftAt: number | null;
  stale: boolean;
  staleDetail: StaleInfo | null;
  reviewedAt: number | null;
  reviewedBy: string | null;
  presentedAt: number | null;
  presentedBy: string | null;
  presentedOn: string | null;
  presentedAmountCents: number | null;
  receiptRef: string | null;
  receiptDocumentId: number | null;
  paidAt: number | null;
  paidBy: string | null;
  paidOn: string | null;
  paidAmountCents: number | null;
  paymentEntryId: number | null;
  settlementEntryId: number | null;
  frozenAt: number | null;
  frozenBy: string | null;
  lastReminderDays: number | null;
  notes: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ObligationLogRow {
  id: number;
  obligationId: number;
  at: number;
  actor: string;
  requestId: string | null;
  action: string;
  fromStatus: ObligationStatus | null;
  toStatus: ObligationStatus | null;
  note: string | null;
  detail: Record<string, unknown> | null;
}

// ── Nóminas ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const PAYROLL_STATUSES = ["draft", "posted", "paid"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export interface Payroll {
  id: number;
  /** «AAAA-MM». */
  period: string;
  /** Alias del empleado (sin datos personales innecesarios). */
  employeeAlias: string;
  grossCents: number;
  irpfCents: number;
  ssEmployeeCents: number;
  ssCompanyCents: number;
  netCents: number;
  payDate: string | null;
  status: PayrollStatus;
  entryId: number | null;
  paymentEntryId: number | null;
  paidOn: string | null;
  bankAccountId: number | null;
  notes: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ── Aplazamientos ─────────────────────────────────────────────────────────────────────────────────────────────────

export const DEFERRAL_STATUSES = ["solicitado", "concedido", "denegado", "en_curso", "pagado", "cancelado"] as const;
export type DeferralStatus = (typeof DEFERRAL_STATUSES)[number];

export interface DeferralInstallment {
  number: number;
  dueDate: string;
  amountCents: number;
  interestCents: number;
  status: "pendiente" | "pagada";
  paidOn: string | null;
  paidAt: number | null;
  entryId: number | null;
}

export interface Deferral {
  id: number;
  obligationId: number;
  status: DeferralStatus;
  requestedOn: string;
  resolutionOn: string | null;
  reference: string | null;
  principalCents: number;
  interestCents: number;
  notes: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  installments: DeferralInstallment[];
}

// ── Expedientes ───────────────────────────────────────────────────────────────────────────────────────────────────

export const DOSSIER_KINDS = ["requerimiento", "comprobacion", "inspeccion", "recurso", "otro"] as const;
export type DossierKind = (typeof DOSSIER_KINDS)[number];
export const DOSSIER_STATUSES = ["abierto", "respondido", "en_tramite", "cerrado"] as const;
export type DossierStatus = (typeof DOSSIER_STATUSES)[number];

export interface Dossier {
  id: number;
  kind: DossierKind;
  /** Organismo (AEAT, Seguridad Social, ayuntamiento…). */
  agency: string;
  reference: string | null;
  subject: string;
  notifiedOn: string | null;
  responseDueOn: string | null;
  status: DossierStatus;
  obligationId: number | null;
  notes: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface DossierLogRow {
  id: number;
  dossierId: number;
  at: number;
  actor: string;
  requestId: string | null;
  action: string;
  note: string | null;
  detail: Record<string, unknown> | null;
}

// ── Impuesto sobre Sociedades ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Ajustes manuales del 200 (claves del CRM): aumentos (`increase`) y disminuciones (`decrease`) extracontables, bases
 * imponibles negativas pendientes (`negative_base`, con su ejercicio de origen; registro manual), deducciones y
 * bonificaciones en cuota (`deduction`) y retenciones o ingresos a cuenta que no estén en la cuenta 473 (`withholding`).
 */
export const ADJUSTMENT_KINDS = ["increase", "decrease", "negative_base", "deduction", "withholding"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export interface CorporateAdjustment {
  id: number;
  year: number;
  kind: AdjustmentKind;
  description: string;
  amountCents: number;
  originYear: number | null;
  status: "active" | "void";
  createdBy: string;
  createdAt: number;
  voidedBy: string | null;
  voidedAt: number | null;
  voidReason: string | null;
}
