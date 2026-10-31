/**
 * Finanzas corporativas de Big Elephant, fase 2 (CRM 0036): Stripe como TPV principal. Transacciones de saldo y payouts
 * importados de los informes del panel de Stripe, su contabilización (diario STR) y la conciliación factura ↔ cobro ↔
 * payout ↔ banco. Mismos convenios que las fases 1A y 1B: céntimos enteros con el signo de Stripe, puntos básicos,
 * fechas «AAAA-MM-DD» en Europe/Madrid. Ver docs/elephant-source/FINANZAS_CORPORATIVAS.md §Fase 2.
 */

/** Pasarelas: solo Stripe. La columna `provider` deja sitio a otras (Redsys queda fuera: Big Elephant no lo usa). */
export type PaymentProvider = "stripe";

/**
 * Tipo normalizado de una transacción de saldo (de `reporting_category` o del `Type` del export clásico):
 *  - charge: cobro (charge, payment);
 *  - refund / refund_failure: reembolso y reembolso fallido;
 *  - dispute / dispute_reversal: retención por disputa (y su comisión) y devolución de la disputa ganada;
 *  - stripe_fee: comisiones y otros servicios facturados por Stripe (fee, stripe_fee, network_cost, tax);
 *  - payout / payout_reversal: liquidación al banco y su fallo o cancelación;
 *  - other: cualquier otra cosa (transferencias de Connect, recargas, ajustes sin disputa…): no se contabiliza sola.
 */
export const STRIPE_TXN_TYPES = ["charge", "refund", "refund_failure", "dispute", "dispute_reversal", "stripe_fee", "payout", "payout_reversal", "other"] as const;
export type StripeTxnType = (typeof STRIPE_TXN_TYPES)[number];

/** posted: con asiento (o cubierta por el de su payout); pending: por contabilizar; ignored: sin efecto; error: falló al contabilizar. */
export const STRIPE_TXN_STATUSES = ["posted", "pending", "ignored", "error"] as const;
export type StripeTxnStatus = (typeof STRIPE_TXN_STATUSES)[number];

/**
 * Incidencias para revisar (no bloquean la contabilización salvo `currency` y `unsupported`):
 *  - no_invoice: cobro sin factura propia que case (no se inventa el cliente);
 *  - amount_mismatch: el bruto cobrado no coincide con el total de la factura;
 *  - refund / dispute: reembolso o disputa sobre un cobro;
 *  - currency: moneda distinta del euro (se importa, no se contabiliza);
 *  - unsupported: tipo que no se contabiliza automáticamente.
 */
export const STRIPE_ISSUES = ["no_invoice", "amount_mismatch", "refund", "dispute", "currency", "unsupported"] as const;
export type StripeIssue = (typeof STRIPE_ISSUES)[number];

export const PAYOUT_STATUSES = ["paid", "pending", "in_transit", "failed", "canceled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const STRIPE_IMPORT_KINDS = ["balance", "payouts"] as const;
export type StripeImportKind = (typeof STRIPE_IMPORT_KINDS)[number];

/**
 * IVA de las comisiones de Stripe (modo global). Fase 2: exentas o inversión del sujeto pasivo. Parametrización fiscal
 * (CRM 0039), nada se presupone:
 *  - unset: sin decidir (por defecto con la migración 0039): las transacciones con comisión NO se contabilizan;
 *  - exempt: exentas (servicios financieros), sin líneas de IVA;
 *  - reverse_charge: emisor de otro Estado de la UE, autoliquidación 472/477 al tipo configurado;
 *  - domestic: la entidad de Stripe factura con IVA español: el IVA soportado sale de su factura registrada como gasto;
 *  - per_invoice: el tratamiento lo da la factura mensual de comisiones registrada como gasto (con su tratamiento).
 * Con `domestic` y `per_invoice` la importación solo lleva la comisión a 626, sin líneas de IVA.
 */
export const FEE_VAT_MODES = ["unset", "exempt", "reverse_charge", "domestic", "per_invoice"] as const;
export type FeeVatMode = (typeof FEE_VAT_MODES)[number];
/** Tratamientos de una regla por tipo de comisión (los del modo global salvo `unset`). */
export const FEE_VAT_TREATMENTS = ["exempt", "reverse_charge", "domestic", "per_invoice"] as const;
export type FeeVatTreatment = (typeof FEE_VAT_TREATMENTS)[number];

/**
 * Regla de IVA de las comisiones de Stripe por tipo de comisión y periodo (CRM 0039, `fin_stripe_fee_vat_rules`). Sin
 * edición: para cambiarla se anula y se crea otra. `feeKind` es el tipo de transacción de saldo o la categoría del
 * informe (`charge`, `refund`, `stripe_fee`, `application_fee`, `adjustment`…) o `*` (cualquiera).
 */
export interface StripeFeeVatRule {
  id: number;
  feeKind: string;
  issuerName: string;
  issuerCountry: string;
  issuerVatId: string | null;
  treatment: FeeVatTreatment;
  rateBp: number | null;
  validFrom: string;
  validTo: string | null;
  /** Factura o condiciones de Stripe que justifican el tratamiento. */
  documentRef: string | null;
  note: string | null;
  createdBy: string;
  createdAt: number;
  voidedBy: string | null;
  voidedAt: number | null;
  voidReason: string | null;
}

/** Tratamiento resuelto para una transacción: regla por tipo exacto, la de `*` o el modo global. */
export interface ResolvedFeeVat {
  treatment: FeeVatMode;
  rateBp: number;
  rule: Pick<StripeFeeVatRule, "id" | "feeKind" | "issuerName" | "issuerCountry" | "issuerVatId"> | null;
  source: "rule" | "wildcard" | "global";
}

export interface StripeSettings {
  stripeFeeVat: FeeVatMode;
  /** Tipo de la autoliquidación con inversión del sujeto pasivo (2100 = 21 %). */
  feeVatRateBp: number;
  /** Cuenta bancaria (fin_bank_accounts) a la que llegan los payouts; sin ella no se contabilizan. */
  stripePayoutBankAccountId: number | null;
  /** Cuenta de las retenciones por disputa: 430 por defecto o una de dudoso cobro (436…). */
  disputeAccountCode: string;
  updatedBy: string | null;
  updatedAt: number | null;
}

export const DEFAULT_STRIPE_SETTINGS: StripeSettings = { stripeFeeVat: "exempt", feeVatRateBp: 2100, stripePayoutBankAccountId: null, disputeAccountCode: "430", updatedBy: null, updatedAt: null };

export interface StripeImportProblem {
  line: number;
  message: string;
}

export interface StripeImport {
  id: number;
  kind: StripeImportKind;
  filename: string;
  sha256: string;
  rows: number;
  inserted: number;
  duplicates: number;
  /** Payouts ya conocidos cuyo estado o fecha se actualizó con este fichero. */
  refreshed: number;
  nonEur: number;
  errors: number;
  problems: StripeImportProblem[];
  importedBy: string;
  createdAt: number;
}

/** Transacción de saldo leída de un informe, antes de guardarla. */
export interface ParsedStripeTxn {
  balanceTransactionId: string;
  type: StripeTxnType;
  rawType: string;
  createdTs: number | null;
  createdOn: string;
  availableOn: string | null;
  currency: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  sourceId: string | null;
  description: string | null;
  customerId: string | null;
  customerEmail: string | null;
  chargeId: string | null;
  paymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripePayoutId: string | null;
  /** Solo filas de payout: fecha efectiva/llegada del payout si el informe la trae. */
  payoutArrivalOn: string | null;
}

export interface StripeTxn extends Omit<ParsedStripeTxn, "payoutArrivalOn"> {
  id: number;
  provider: PaymentProvider;
  importId: number | null;
  ownInvoiceId: number | null;
  status: StripeTxnStatus;
  issue: StripeIssue | null;
  issueDetail: string | null;
  issueReviewedBy: string | null;
  issueReviewedAt: number | null;
  issueNote: string | null;
  entryId: number | null;
  postedAt: number | null;
  createdAt: number;
}

/** Payout leído de un informe, antes de guardarlo. `amountCents` es positivo (lo que sale de Stripe al banco). */
export interface ParsedPayout {
  payoutId: string;
  createdOn: string | null;
  arrivalOn: string;
  currency: string;
  amountCents: number;
  feeCents: number;
  status: PayoutStatus;
  description: string | null;
}

export interface StripePayout extends ParsedPayout {
  id: number;
  provider: PaymentProvider;
  importId: number | null;
  origin: "balance" | "report";
  entryId: number | null;
  reversalEntryId: number | null;
  bankMovementId: number | null;
  bankLinkedBy: string | null;
  bankLinkedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Punto de extensión (sin implementar en la fase 2): lector de transacciones de saldo y payouts por la API de Stripe.
 * Iría detrás de un interruptor NUEVO apagado (CP_FINANCE_STRIPE_SYNC_ENABLED) y con la clave restringida de solo
 * lectura en una variable de entorno, nunca en el código. Devolvería lo mismo que los lectores de CSV, así que el resto
 * del flujo (deduplicación, contabilización y conciliación) no cambiaría.
 */
export interface StripeBalanceSource {
  balanceTransactions(range: { from: string; to: string }): Promise<ParsedStripeTxn[]>;
  payouts(range: { from: string; to: string }): Promise<ParsedPayout[]>;
}
