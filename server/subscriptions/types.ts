/**
 * Suscripciones v1 (Big Elephant): la suscripción es una COMPOSICIÓN de partidas (Core, Extensions,
 * Industries, consumos y servicios), cada una con su propia instantánea inmutable de las condiciones
 * económicas aceptadas. Diseño: docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md.
 *
 * Modo único en v1: «shadow». Se calcula y se registra; nunca se cobra, nunca se emite una factura
 * fiscal y nunca se concede o retira una licencia.
 */
export type SubscriptionStatus = "trialing" | "active" | "canceled";
export type Interval = "month" | "year";
export type Family = "core_plan" | "extension" | "industry_module" | "usage" | "service";
export type PriceKind = "monthly" | "yearly" | "one_time" | "usage";
export type PriceSource = "catalog" | "contract" | "manual_review";

export interface Discount {
  kind: "percent" | "amount";
  /** Porcentaje entero (1–100) o importe en céntimos por periodo. */
  value: number;
  /** Instante (ms) a partir del cual deja de aplicarse; null = sin fin. */
  endsAt: number | null;
  note: string | null;
}

export interface Subscription {
  id: number;
  reference: string | null;
  companyId: number;
  contractId: number | null;
  tenantId: string | null;
  status: SubscriptionStatus;
  mode: "shadow";
  currency: string;
  interval: Interval;
  pendingInterval: Interval | null;
  startedAt: number;
  /** Día del mes (UTC) de anclaje de las renovaciones. */
  anchorDay: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialEnd: number | null;
  cancelAt: number | null;
  canceledAt: number | null;
  version: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

/** Partida contratada: instantánea inmutable (un cambio la cierra y crea otra). */
export interface SubscriptionItem {
  id: number;
  subscriptionId: number;
  family: Family;
  productKey: string;
  productName: string;
  activationKind: string;
  activationRef: string | null;
  /** Versión de precio aceptada (web_prices.id). */
  priceId: number | null;
  priceSource: PriceSource;
  priceKind: PriceKind;
  unitAmountCents: number;
  unit: string | null;
  quantity: number;
  taxRateBp: number;
  taxIncluded: boolean;
  discount: Discount | null;
  effectiveFrom: number;
  effectiveTo: number | null;
  createdAt: number;
  createdBy: string;
}

export type EventKind =
  | "created"
  | "plan_changed"
  | "item_added"
  | "item_removed"
  | "cancel_scheduled"
  | "cancel_undone"
  | "reactivated"
  | "interval_change_scheduled"
  | "renewed"
  | "canceled";

export interface SubscriptionEvent {
  id: number;
  subscriptionId: number;
  kind: EventKind;
  /** Versión de la suscripción tras el cambio. */
  version: number;
  before: unknown;
  after: unknown;
  reason: string | null;
  actor: string;
  createdAt: number;
}

export interface UsageRecord {
  id: number;
  itemId: number;
  periodStart: number;
  quantity: number;
  source: string;
  idempotencyKey: string;
  createdAt: number;
}

export type ShadowInvoiceKind = "renewal" | "proration" | "one_time" | "usage";
export type PaymentStatus = "none" | "pending" | "paid" | "failed" | "review";

export interface ShadowLine {
  itemId: number;
  productKey: string;
  productName: string;
  family: Family;
  priceId: number | null;
  description: string;
  quantity: number;
  unitAmountCents: number;
  /** Fracción del periodo facturada (1 = periodo completo). */
  fraction: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
}

export interface ShadowInvoice {
  id: number;
  subscriptionId: number;
  kind: ShadowInvoiceKind;
  periodStart: number;
  periodEnd: number;
  dedupeKey: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  lines: ShadowLine[];
  inputHash: string;
  contractAmountCents: number | null;
  contractDiffCents: number | null;
  paymentStatus: PaymentStatus;
  createdAt: number;
  createdBy: string;
}

export type ChargeStatus = "pending" | "processing" | "succeeded" | "failed" | "unknown";
export interface ShadowCharge {
  id: number;
  invoiceId: number;
  idempotencyKey: string;
  attempt: number;
  status: ChargeStatus;
  providerRef: string | null;
  error: string | null;
  createdAt: number;
  settledAt: number | null;
}

export class SubscriptionError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "version_conflict" | "conflict",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}
