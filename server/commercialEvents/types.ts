/**
 * Registro central de eventos comerciales (BD del CRM, migración 0015).
 *
 * Cada almacén del circuito comercial (pedidos y pagos, pruebas, suscripciones, ajustes de cargos de
 * Stripe) escribe aquí sus hechos en la MISMA transacción que su cambio de estado. El registro no decide
 * nada: es la fuente para la traza de una operación y para el futuro despachador de notificaciones.
 *
 * Reglas:
 *  - Sin datos personales: solo identificadores, importes, claves de catálogo y estados.
 *  - Idempotente: `key` identifica el hecho (agregado + versión, o estado alcanzado); repetirlo no
 *    añade una fila.
 *  - Orden: `aggregate.version` ordena los hechos de un mismo agregado; el id de la fila, el orden global
 *    de escritura.
 *  - Entorno: cada fila lleva el entorno comercial (test | live) que la escribió.
 */

export const COMMERCIAL_EVENT_SCHEMA_VERSION = 1;

export const COMMERCIAL_EVENT_TYPES = [
  // Prueba gratuita
  "trial.requested",
  "trial.verified",
  "trial.started",
  "trial.provisioning_failed",
  "trial.extended",
  "trial.expired",
  "trial.suspended",
  "trial.reactivated",
  "trial.converted",
  "trial.rejected",
  "trial.cancelled",
  // Pedido (contratación, impago, cancelación)
  "order.created",
  "order.quoted",
  "order.contracted",
  "order.confirmed",
  "order.subscribed",
  "order.licensed",
  "order.activated",
  "order.past_due",
  "order.suspended",
  // Recordatorio durante la gracia de un impago (días 3 y 6 por defecto; el día 0 lo avisa el orquestador)
  "order.dunning_notice",
  "order.recovered",
  "order.cancel_scheduled",
  "order.reactivated",
  "order.cancelled",
  "order.superseded",
  "order.rejected",
  // Desistimiento de consumidores (server/withdrawals): solicitud recibida y cada resolución
  "order.withdrawal_requested",
  "order.withdrawal_resolved",
  // Cobros (alta o cambio) y renovaciones
  "payment.requested",
  "payment.succeeded",
  "payment.failed",
  "renewal.requested",
  "renewal.paid",
  "renewal.failed",
  // Suscripción (plan, módulos, periodicidad, ciclo)
  "subscription.created",
  "subscription.plan_changed",
  "subscription.module_added",
  "subscription.module_removed",
  // Baja efectiva: la sincronización de licencias retira el módulo al cumplirse la fecha de baja programada
  "subscription.module_removal_effective",
  "subscription.quantity_changed",
  "subscription.interval_change_scheduled",
  "subscription.cancel_scheduled",
  "subscription.cancel_undone",
  "subscription.reactivated",
  "subscription.trial_ended",
  "subscription.trial_converted",
  "subscription.renewed",
  "subscription.canceled",
  // Reembolsos y disputas (Stripe)
  "refund.recorded",
  "coverage.lost",
  "coverage.restored",
  "dispute.status_changed",
  // Estado de la empresa en el registro (consecuencia de su situación comercial)
  "tenant.status_changed",
  // Límites contratados de la empresa (usuarios, sedes, almacenamiento)
  "entitlement.limit_changed",
  // Acceso tras terminar: solo lectura (consulta y exportación) durante un plazo y fin de ese plazo
  "access.read_only_started",
  "access.read_only_ended",
  "access.archive_notice",
] as const;
export type CommercialEventType = (typeof COMMERCIAL_EVENT_TYPES)[number];

export type CommercialEnvironment = "test" | "live";
export type CommercialSource = "system" | "operator" | "customer" | "stripe";
export type AggregateType = "order" | "payment" | "trial" | "subscription" | "charge";

/** Valor admitido en `data`: primitivas, listas y objetos pequeños (sin datos personales). */
export type EventValue = string | number | boolean | null | EventValue[] | { [k: string]: EventValue };

/** Lo que aporta el almacén; el registro completa entorno, origen y causa. */
export interface CommercialEventDraft {
  key: string;
  type: CommercialEventType;
  aggregate: { type: AggregateType; id: string; version: number | null };
  correlationId: string;
  tenantId: string | null;
  companyId: number | null;
  orderId: number | null;
  subscriptionId: number | null;
  trialId: number | null;
  paymentId: number | null;
  stripeRef: string | null;
  fromState: string | null;
  toState: string | null;
  actor: string;
  occurredAt: number;
  data: Record<string, EventValue>;
}

export interface CommercialEvent extends CommercialEventDraft {
  id: number;
  schemaVersion: number;
  environment: CommercialEnvironment;
  source: CommercialSource;
  causationId: string | null;
  dispatchStatus: "pending" | "done" | "skipped" | "dead";
}

export interface CommercialEventFilter {
  correlationId?: string;
  tenantId?: string;
  companyId?: number;
  orderId?: number;
  subscriptionId?: number;
  trialId?: number;
  types?: CommercialEventType[];
  /** Solo filas con id mayor (paginación hacia delante). */
  afterId?: number;
  limit?: number;
}

/** Transacción en curso del almacén que escribe (MySQL); null en los almacenes en memoria. */
export interface SqlTx {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Destino de los eventos. Los almacenes lo llaman DENTRO de su transacción: si la escritura falla, el
 * cambio de estado tampoco se guarda (y al revés).
 */
export interface CommercialEventSink {
  readonly environment: CommercialEnvironment;
  append(tx: SqlTx | null, drafts: CommercialEventDraft[]): Promise<{ written: number; duplicates: number }>;
}
