/**
 * Finanzas corporativas de Big Elephant, fase 4 (CRM 0038): control diario, cuenta de resultados, balance, tesorería y
 * previsión, antigüedad de saldos, gastos, Revenue & Margin y Conversion Health. Es LECTURA de las fases 1–3: aquí solo
 * se guardan la revisión diaria (con bitácora) y la marca de coste directo de las categorías. Mismos convenios:
 * céntimos enteros, fechas «AAAA-MM-DD» (Europe/Madrid), meses «AAAA-MM» y `null` = no disponible (nunca 0).
 */
import type { BankFeeNature } from "./opsTypes";
import type { EntryOrigin } from "./types";

/** Agregado del libro por mes, cuenta y dimensiones (lo que devuelve el GROUP BY de MySQL). */
export interface LedgerFact {
  month: string;
  accountCode: string;
  origin: EntryOrigin;
  costCenterId: number | null;
  supplierId: number | null;
  /** Categoría del gasto cuyo asiento (o su reversión) contiene la línea; null en el resto. */
  categoryId: number | null;
  debitCents: number;
  creditCents: number;
}

export interface LedgerFactQuery {
  from?: string;
  to?: string;
  /** Cuentas que empiezan por alguno de estos prefijos (vacío o ausente = todas). */
  accountPrefixes?: string[];
  excludeAccountPrefixes?: string[];
  excludeOrigins?: EntryOrigin[];
  excludeJournals?: string[];
  onlyJournals?: string[];
  costCenterId?: number;
  /** Solo líneas de asientos que tocan alguna cuenta de tesorería (57…). */
  withTreasury?: boolean;
}

/** Líneas de tesorería (57…) por mes y cuenta; `internal` = asiento solo con cuentas de tesorería (traspaso). */
export interface TreasuryFact {
  month: string;
  accountCode: string;
  internal: boolean;
  debitCents: number;
  creditCents: number;
}

/** Transacciones de Stripe en euros por mes y tipo; `noInvoice` = cobro sin factura propia. */
export interface StripeMonthFact {
  month: string;
  type: string;
  noInvoice: boolean;
  count: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/** Cobros de facturas por transferencia conciliados, por mes de la fecha del banco. */
export interface TransferMonthFact {
  month: string;
  count: number;
  amountCents: number;
}

/** Gasto registrado con lo pendiente a una fecha (pagos vigentes hasta esa fecha). */
export interface PayableDoc {
  id: number;
  supplierId: number | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  totalCents: number;
  pendingCents: number;
}

export interface DueBuckets {
  overdue: { count: number; amountCents: number };
  today: { count: number; amountCents: number };
  next7: { count: number; amountCents: number };
}

export interface PendingMovementAges {
  count: number;
  amountCents: number;
  oldestDate: string | null;
  buckets: { d0_7: number; d8_30: number; d30_plus: number };
}

/** Recuentos del control diario: es lo que se congela en la instantánea de la revisión. */
export interface DailyCounts {
  invoicesIssued: number;
  stripeCharges: number;
  payoutsArriving: number;
  payoutsWithoutBank: number;
  bankMovements: number;
  bankPending: number;
  expensesRegistered: number;
  paymentsOverdue: number;
  paymentsDueToday: number;
  paymentsDueNext7: number;
  receivablesOverdue: number;
  stripeIssuesOpen: number;
  taxDueNext15: number;
  taxOverdue: number;
  draftEntries: number;
  /** CRM 0039: transacciones de Stripe pendientes por no tener decidido el IVA de su comisión (solo con la migración). */
  stripeFeeVatUnset?: number;
}

/**
 * Configuración del análisis (CRM 0039, `fin_analysis_settings`, una fila): dónde van las comisiones de Stripe en
 * Revenue & Margin (`direct_cost`: coste del cobro de las ventas, por defecto; `structure`; `financial`: resultado
 * financiero, fuera del margen) y la cuenta de cada naturaleza de comisión bancaria.
 */
export const STRIPE_FEES_TREATMENTS = ["direct_cost", "structure", "financial"] as const;
export type StripeFeesTreatment = (typeof STRIPE_FEES_TREATMENTS)[number];

export interface AnalysisSettings {
  stripeFeesTreatment: StripeFeesTreatment;
  bankFeeAccounts: Record<BankFeeNature, string>;
  configuredBy: string | null;
  configuredAt: number | null;
}

export interface DailyReviewLog {
  id: number;
  at: number;
  actor: string;
  requestId: string | null;
  action: "review" | "note";
  noteBefore: string | null;
  noteAfter: string | null;
}

export interface DailyReview {
  id: number;
  day: string;
  reviewedBy: string;
  reviewedAt: number;
  note: string | null;
  snapshot: Partial<DailyCounts> & Record<string, unknown>;
  noteEditedBy: string | null;
  noteEditedAt: number | null;
  requestId: string | null;
}

export interface NewDailyReview {
  day: string;
  reviewedBy: string;
  reviewedAt: number;
  note: string | null;
  snapshot: Record<string, unknown>;
  requestId: string | null;
}

/** Eventos de cobro del registro comercial (solo lectura), por mes: intentos fallidos y cobrados. */
export interface PaymentEventMonth {
  month: string;
  failed: number;
  succeeded: number;
}
