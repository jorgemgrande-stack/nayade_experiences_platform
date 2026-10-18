/**
 * Orquestador comercial: un PEDIDO recorre la contratación de punta a punta con estados explícitos.
 *
 *   requested ─quote→ quoted ─sign→ contracted ─confirm→ confirmed ─subscribe→ subscribed
 *     ─license→ licensed ─activate→ active
 *
 *   active ⇄ past_due (impago: 7 días de gracia) → suspended (reversible al pagar)
 *   active|past_due|suspended ─cancel→ cancel_scheduled ─(fin de periodo)→ cancelled
 *   active|past_due|suspended|cancel_scheduled ─supersede→ superseded (un cambio de plan toma el relevo)
 *   requested|quoted|contracted ─reject→ rejected (abandono antes de confirmar)
 *
 * Diseño: docs/architecture/ORQUESTADOR_CONTRATACION.md.
 */
import type { QuoteRequest } from "../catalog/quote";

export const ORDER_STATES = [
  "requested",
  "quoted",
  "contracted",
  "confirmed",
  "subscribed",
  "licensed",
  "active",
  "past_due",
  "suspended",
  "cancel_scheduled",
  "cancelled",
  "superseded",
  "rejected",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const TERMINAL_STATES: ReadonlySet<OrderState> = new Set<OrderState>(["cancelled", "superseded", "rejected"]);
/** Estados del recorrido de alta (antes de quedar activo). */
export const PIPELINE: readonly OrderState[] = ["requested", "quoted", "contracted", "confirmed", "subscribed", "licensed"];

/** `new`: cliente nuevo; `trial_conversion`: prueba que pasa a pago; `change`: cambio sobre un pedido activo. */
export type OrderKind = "new" | "trial_conversion" | "change";

/**
 * Base que autoriza activar licencias de pago. SOLO estas: pago verificado (evento firmado del
 * proveedor), aprobación administrativa registrada o, en un cambio sin importe a pagar que no añade
 * ninguna capacidad nueva, la base del pedido al que sustituye («inherited»).
 */
export type ConfirmationKind = "payment" | "admin_approval" | "inherited";
export interface Confirmation {
  kind: ConfirmationKind;
  /** Pago (id) o pedido del que se hereda. */
  ref: string | null;
  actor: string;
  reason: string | null;
  at: number;
}

export interface OrderQuote {
  catalogVersion: string;
  currency: string;
  /** Importe recurrente del contrato (mensual, o coste anualizado si es anual). Sin IVA. */
  contractAmountCents: number;
  /** Importe del primer periodo a pagar (con IVA). */
  firstPeriodCents: number;
  capabilities: string[];
  blocking: string[];
  /** Productos «bajo solicitud»: exigen aprobación motivada al firmar. */
  onRequest: string[];
  contractable: string;
}

export interface CommercialOrder {
  id: number;
  reference: string | null;
  idempotencyKey: string;
  payloadHash: string;
  kind: OrderKind;
  state: OrderState;
  companyId: number;
  leadRequestId: number | null;
  trialId: number | null;
  previousOrderId: number | null;
  request: QuoteRequest & { items: Array<{ key: string; quantity?: number }> };
  quote: OrderQuote | null;
  contractId: number | null;
  subscriptionId: number | null;
  tenantId: string | null;
  confirmation: Confirmation | null;
  graceEndsAt: number | null;
  attempts: number;
  lastError: string | null;
  version: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

export type OrderPatch = Partial<
  Pick<CommercialOrder, "state" | "quote" | "contractId" | "subscriptionId" | "tenantId" | "confirmation" | "graceEndsAt" | "attempts" | "lastError">
>;

export interface OrderEvent {
  id: number;
  orderId: number;
  kind: string;
  fromState: OrderState | null;
  toState: OrderState;
  version: number;
  detail: Record<string, unknown> | null;
  actor: string;
  createdAt: number;
}

export type PaymentPurpose = "initial" | "change" | "renewal";
/** Modo del pago: «test» (pruebas o simulado) o «live» (Stripe en la cuenta real; CRM 0013). */
export type PaymentMode = "test" | "live";
export const PAYMENT_MODES: readonly PaymentMode[] = ["test", "live"];
export type PaymentStatus = "pending" | "succeeded" | "failed";
export interface OrderPayment {
  id: number;
  orderId: number;
  idempotencyKey: string;
  purpose: PaymentPurpose;
  periodStart: number | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  /** «test» o «live» según el entorno (la BD solo admite esos dos). Los pagos simulados son siempre «test». */
  mode: PaymentMode;
  providerRef: string | null;
  dueAt: number | null;
  createdAt: number;
  settledAt: number | null;
}

export type PaymentEventOutcome = "applied" | "ignored" | "rejected";
export interface PaymentEventRecord {
  providerEventId: string;
  paymentId: number | null;
  type: string;
  outcome: PaymentEventOutcome;
  detail: string | null;
  receivedAt: number;
}

export class OrderError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_input" | "invalid_state" | "conflict" | "forbidden" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}
