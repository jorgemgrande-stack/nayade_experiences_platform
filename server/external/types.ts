/**
 * Servicios recurrentes de clientes externos (tecnología propia, fuera de Elephant Core): contrato del CRM, aceptación
 * digital, autorización del método de pago sin cargo y cobro recurrente con Stripe Billing. Ver
 * docs/elephant-source/CLIENTES_EXTERNOS.md.
 */

export type ExternalStatus =
  /** Contrato preparado, pendiente de enviar o de aceptar. */
  | "awaiting_acceptance"
  /** Contrato aceptado; falta que el cliente autorice el método de pago. */
  | "awaiting_payment_method"
  /** Método autorizado y suscripción programada: el primer cargo será en `firstChargeAt`. */
  | "scheduled"
  /** Al día: el último periodo está cobrado. */
  | "active"
  /** Factura del periodo pendiente (días 1 a 5: reintentos de Stripe). */
  | "past_due"
  /** El método de pago llegó después del primer vencimiento: no se cobra con retroactividad sin decisión. */
  | "needs_decision"
  | "canceled";

export interface ExternalSubscription {
  id: number;
  contractId: number;
  companyId: number;
  serviceKey: string;
  serviceName: string;
  /** Cuota neta por periodo (sin IVA), en céntimos. */
  amountCents: number;
  currency: string;
  /** IVA en puntos básicos (2100 = 21 %). */
  taxRateBp: number;
  interval: "month";
  billingDay: number;
  billingHour: number;
  timezone: string;
  /** Días de margen para el cobro de cada periodo (del día 1 al día 1 + graceDays). */
  graceDays: number;
  /** Primer cargo (ms). */
  firstChargeAt: number;
  externalRef: string | null;
  status: ExternalStatus;
  stripeCustomerId: string | null;
  stripeSetupSessionId: string | null;
  /** Solo el id del método de pago en Stripe (nunca datos de la tarjeta). */
  stripePaymentMethodId: string | null;
  stripeSubscriptionId: string | null;
  stripeTestClockId: string | null;
  lastInvoiceId: string | null;
  lastInvoiceStatus: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  /** Fin del margen de cobro de la factura pendiente (ms). */
  graceUntil: number | null;
  decisionReason: string | null;
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type AcceptanceStatus = "pending" | "accepted" | "revoked" | "expired";

export interface ContractAcceptance {
  id: number;
  contractId: number;
  contractVersion: number;
  /** Huella SHA-256 del documento exacto que se presenta y se acepta. */
  documentSha256: string;
  status: AcceptanceStatus;
  signerName: string;
  signerEmail: string;
  signerRole: string | null;
  signerTaxId: string | null;
  acceptedName: string | null;
  acceptedTaxId: string | null;
  acceptedAt: number | null;
  /** IP seudonimizada (SHA-256 con sal del entorno). */
  acceptedIpHash: string | null;
  acceptedUserAgent: string | null;
  consentText: string | null;
  expiresAt: number;
  createdBy: string;
  createdAt: number;
}

export interface ExternalEvent {
  id: number;
  externalId: number;
  kind: string;
  /** Referencia única por tipo (p. ej. la factura de Stripe): el mismo evento nunca se registra dos veces. */
  ref: string | null;
  detail: Record<string, unknown> | null;
  actor: string;
  at: number;
}

export class ExternalError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ExternalError";
  }
}
