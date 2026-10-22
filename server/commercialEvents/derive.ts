/**
 * Traducción de los cambios de cada almacén a eventos comerciales. Funciones puras: reciben el estado
 * anterior y el posterior que el almacén ya tiene dentro de su transacción. Una anotación sin cambio de
 * estado (paso fallido, contrato redactado, pago solicitado como nota…) no produce evento: el hecho ya
 * consta en su historial propio y, si importa, en el evento del agregado que sí cambia (el pago).
 */
import type { CommercialOrder, OrderPayment, OrderState, PaymentStatus } from "../orchestrator/types";
import type { TrialRequest } from "../trials/store";
import type { Subscription, EventKind as SubscriptionEventKind } from "../subscriptions/types";
import type { CommercialEventDraft, CommercialEventType, EventValue } from "./types";

// ── Limpieza de datos (sin datos personales) ─────────────────────────────────

/** Claves que nunca se guardan aunque lleguen en un detalle. */
const PERSONAL = /(e-?mail|name|nombre|phone|telefono|address|direccion|token|secret|password|iban|card|tax_?id|^nif$|^cif$|^ip$|^ip_?hash$)/i;
/** Texto libre: solo códigos (letras, cifras, guiones y _ : .), nunca frases escritas por personas ni correos. */
const CODE = /^[A-Za-z0-9_:.\-]{1,80}$/;

function clean(v: unknown, depth = 0): EventValue | undefined {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return CODE.test(v) ? v : undefined;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) {
    const out = v.slice(0, 50).map((x) => clean(x, depth + 1)).filter((x): x is EventValue => x !== undefined);
    return out;
  }
  if (typeof v === "object") {
    const out: Record<string, EventValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      if (PERSONAL.test(k)) continue;
      const c = clean(x, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

/** Datos del evento: solo valores limpios; lo demás se descarta en silencio. */
export function cleanData(d: Record<string, unknown> | null | undefined): Record<string, EventValue> {
  const c = clean(d ?? {});
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
}

const blank = (): Pick<CommercialEventDraft, "tenantId" | "companyId" | "orderId" | "subscriptionId" | "trialId" | "paymentId" | "stripeRef" | "fromState" | "toState"> => ({
  tenantId: null,
  companyId: null,
  orderId: null,
  subscriptionId: null,
  trialId: null,
  paymentId: null,
  stripeRef: null,
  fromState: null,
  toState: null,
});

// ── Pedidos ──────────────────────────────────────────────────────────────────

const ORDER_EVENT: Record<string, CommercialEventType> = {
  quote: "order.quoted",
  sign: "order.contracted",
  confirm: "order.confirmed",
  subscribe: "order.subscribed",
  license: "order.licensed",
  activate: "order.activated",
  payment_failed: "order.past_due",
  payment_recovered: "order.recovered",
  suspend: "order.suspended",
  cancel: "order.cancel_scheduled",
  cancelled: "order.cancelled",
  reactivate: "order.reactivated",
  supersede: "order.superseded",
  reject: "order.rejected",
};

/** Claves del detalle de una transición de pedido que se conservan. */
const ORDER_DETAIL_KEYS = ["basis", "graceEndsAt", "cancelAt", "canceledAt", "reason", "source", "paymentId", "subscriptionId", "contractId", "by", "from", "changes", "capabilities", "licencesReadOnly", "licencesCancelled", "readOnlyUntil", "firstPeriodCents", "currency", "catalogVersion"];

function orderBase(o: CommercialOrder) {
  return { ...blank(), tenantId: o.tenantId, companyId: o.companyId, orderId: o.id, subscriptionId: o.subscriptionId, trialId: o.trialId, correlationId: `order:${o.id}` };
}

/** Qué contrata el pedido (claves de catálogo; sin importes negociados ni datos del cliente). */
function orderShape(o: CommercialOrder): Record<string, unknown> {
  const r = o.request as unknown as Record<string, unknown>;
  return {
    kind: o.kind,
    previousOrderId: o.previousOrderId,
    plan: r.plan ?? null,
    interval: r.interval ?? null,
    items: (o.request.items ?? []).map((i) => (i.quantity && i.quantity !== 1 ? `${i.key}x${i.quantity}` : i.key)),
  };
}

export function orderCreated(o: CommercialOrder, actor: string, at: number): CommercialEventDraft[] {
  return [
    {
      ...orderBase(o),
      key: `order:${o.id}:v1:created`,
      type: "order.created",
      aggregate: { type: "order", id: String(o.id), version: 1 },
      toState: o.state,
      actor,
      occurredAt: at,
      data: cleanData(orderShape(o)),
    },
  ];
}

/** Transición de un pedido. Solo produce evento si cambia el estado. */
export function orderTransition(before: CommercialOrder, after: CommercialOrder, e: { kind: string; detail: Record<string, unknown> | null; actor: string; at: number }): CommercialEventDraft[] {
  if (before.state === after.state) return [];
  const type = ORDER_EVENT[e.kind];
  if (!type) return [];
  const d = e.detail ?? {};
  const kept: Record<string, unknown> = {};
  for (const k of ORDER_DETAIL_KEYS) if (k in d) kept[k] = d[k];
  // En la activación queda constancia de lo contratado (alta, conversión o cambio de plan/módulos)
  const data = type === "order.activated" ? { ...orderShape(after), ...kept } : { kind: after.kind, ...kept };
  const out: CommercialEventDraft[] = [
    {
      ...orderBase(after),
      key: `order:${after.id}:v${after.version}:${e.kind}`,
      type,
      aggregate: { type: "order", id: String(after.id), version: after.version },
      fromState: before.state,
      toState: after.state,
      actor: e.actor,
      occurredAt: e.at,
      data: cleanData(data),
    },
  ];
  // Fin de la suscripción con plazo de solo lectura: el inicio de ese acceso queda como hecho propio
  if (type === "order.cancelled" && typeof d.readOnlyUntil === "number") {
    out.push({
      ...orderBase(after),
      key: `order:${after.id}:v${after.version}:read_only_started`,
      type: "access.read_only_started",
      aggregate: { type: "order", id: String(after.id), version: after.version },
      fromState: null,
      toState: "read_only",
      actor: e.actor,
      occurredAt: e.at,
      data: cleanData({ readOnlyUntil: d.readOnlyUntil, licences: d.licencesReadOnly ?? null }),
    });
  }
  return out;
}

// ── Pagos ────────────────────────────────────────────────────────────────────

const PAYMENT_EVENT: Record<"initial" | "change" | "renewal", Record<PaymentStatus, CommercialEventType>> = {
  initial: { pending: "payment.requested", succeeded: "payment.succeeded", failed: "payment.failed" },
  change: { pending: "payment.requested", succeeded: "payment.succeeded", failed: "payment.failed" },
  renewal: { pending: "renewal.requested", succeeded: "renewal.paid", failed: "renewal.failed" },
};

/** Referencia de Stripe guardada en el pago (`stripe:inv:in_…` → `inv:in_…`). */
function stripeRefOf(p: OrderPayment): string | null {
  if (!p.providerRef || !p.provider.startsWith("stripe")) return null;
  return p.providerRef.replace(/^stripe:/, "").slice(0, 120);
}

/**
 * Pago creado o con estado nuevo. `previous` es el estado anterior (null si se acaba de crear). Un
 * estado ya alcanzado no se repite: la clave es el pago y su estado.
 */
export function paymentChanged(p: OrderPayment, previous: PaymentStatus | null, order: Pick<CommercialOrder, "companyId" | "tenantId" | "subscriptionId" | "trialId"> | null, actor: string, at: number): CommercialEventDraft[] {
  if (previous === p.status) return [];
  return [
    {
      ...blank(),
      key: `payment:${p.id}:${p.status}`,
      type: PAYMENT_EVENT[p.purpose][p.status],
      aggregate: { type: "payment", id: String(p.id), version: null },
      correlationId: `order:${p.orderId}`,
      tenantId: order?.tenantId ?? null,
      companyId: order?.companyId ?? null,
      orderId: p.orderId,
      subscriptionId: order?.subscriptionId ?? null,
      trialId: order?.trialId ?? null,
      paymentId: p.id,
      stripeRef: stripeRefOf(p),
      fromState: previous,
      toState: p.status,
      actor,
      occurredAt: at,
      data: cleanData({ purpose: p.purpose, amountCents: p.amountCents, currency: p.currency, provider: p.provider, mode: p.mode, periodStart: p.periodStart }),
    },
  ];
}

// ── Pruebas ──────────────────────────────────────────────────────────────────

const TRIAL_EVENT: Record<string, CommercialEventType> = {
  registered: "trial.requested",
  verify: "trial.verified",
  provisioned: "trial.started",
  provisioning_failed: "trial.provisioning_failed",
  approve_extension: "trial.extended",
  mark_expired: "trial.expired",
  suspend: "trial.suspended",
  reactivate: "trial.reactivated",
  convert: "trial.converted",
  reject: "trial.rejected",
  cancel: "trial.cancelled",
  expire_verification: "trial.cancelled",
};

function trialData(t: TrialRequest) {
  return cleanData({ plan: t.configuration?.plan ?? null, addons: t.configuration?.addons ?? [], startsAt: t.startsAt, endsAt: t.endsAt, extensionsUsed: t.extensionsUsed, convertedSubscriptionId: t.convertedSubscriptionId });
}

/** Alta o transición de una prueba (`action` = acción de la máquina, o `registered` en el alta). */
export function trialChanged(t: TrialRequest, action: string, fromState: string | null, actor: string, at: number): CommercialEventDraft[] {
  const type = TRIAL_EVENT[action];
  if (!type) return [];
  return [
    {
      ...blank(),
      key: `trial:${t.id}:v${t.version}:${action}`,
      type,
      aggregate: { type: "trial", id: String(t.id), version: t.version },
      correlationId: `trial:${t.id}`,
      tenantId: t.tenantId,
      trialId: t.id,
      subscriptionId: t.convertedSubscriptionId,
      fromState,
      toState: t.state,
      actor,
      occurredAt: at,
      data: trialData(t),
    },
  ];
}

// ── Suscripciones ────────────────────────────────────────────────────────────

const SUBSCRIPTION_EVENT: Partial<Record<SubscriptionEventKind, CommercialEventType>> = {
  created: "subscription.created",
  plan_changed: "subscription.plan_changed",
  item_added: "subscription.module_added",
  item_removed: "subscription.module_removed",
  quantity_changed: "subscription.quantity_changed",
  interval_change_scheduled: "subscription.interval_change_scheduled",
  cancel_scheduled: "subscription.cancel_scheduled",
  cancel_undone: "subscription.cancel_undone",
  reactivated: "subscription.reactivated",
  trial_ended: "subscription.trial_ended",
  trial_converted: "subscription.trial_converted",
  renewed: "subscription.renewed",
  canceled: "subscription.canceled",
};

/** Evento de la suscripción interna (antes/después del propio historial, sin el motivo escrito). */
export function subscriptionChanged(before: Pick<Subscription, "status"> | null, after: Subscription, e: { kind: SubscriptionEventKind; before: unknown; after: unknown }, actor: string, at: number): CommercialEventDraft[] {
  // Alta o baja de una ampliación por cantidad: es un cambio de cantidad (de 0 o a 0), no un módulo
  const lineKindIn = (x: unknown) => (x && typeof x === "object" ? (x as { lineKind?: unknown }).lineKind : undefined);
  const isQuantity = (e.kind === "item_added" && lineKindIn(e.after) === "quantity") || (e.kind === "item_removed" && lineKindIn(e.before) === "quantity");
  const type = isQuantity ? "subscription.quantity_changed" : SUBSCRIPTION_EVENT[e.kind];
  if (!type) return [];
  return [
    {
      ...blank(),
      key: `subscription:${after.id}:v${after.version}:${e.kind}`,
      type,
      aggregate: { type: "subscription", id: String(after.id), version: after.version },
      correlationId: `subscription:${after.id}`,
      tenantId: after.tenantId,
      companyId: after.companyId,
      subscriptionId: after.id,
      fromState: before?.status ?? null,
      toState: after.status,
      actor,
      occurredAt: at,
      data: cleanData({ interval: after.interval, before: e.before as Record<string, unknown>, after: e.after as Record<string, unknown> }),
    },
  ];
}

// ── Cargos de Stripe: reembolsos y disputas ──────────────────────────────────

export interface AdjustmentView {
  chargeId: string;
  invoiceId: string | null;
  subscriptionId: string | null;
  orderId: number;
  companyId: number;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  disputeStatus: string | null;
  coverageLost: boolean;
}

/** Cambios de un cargo releído: reembolso nuevo, cobertura perdida o recuperada, disputa. */
export function chargeAdjusted(prev: AdjustmentView | null, cur: AdjustmentView, order: Pick<CommercialOrder, "tenantId" | "subscriptionId"> | null, actor: string, at: number): CommercialEventDraft[] {
  const base = {
    ...blank(),
    aggregate: { type: "charge" as const, id: cur.chargeId.slice(0, 80), version: null },
    correlationId: `order:${cur.orderId}`,
    tenantId: order?.tenantId ?? null,
    companyId: cur.companyId,
    orderId: cur.orderId,
    subscriptionId: order?.subscriptionId ?? null,
    stripeRef: cur.chargeId.slice(0, 120),
    actor,
    occurredAt: at,
  };
  const money = { amountCents: cur.amountCents, currency: cur.currency, invoice: cur.invoiceId };
  const out: CommercialEventDraft[] = [];
  const before = prev?.amountRefundedCents ?? 0;
  if (cur.amountRefundedCents > before) {
    out.push({
      ...base,
      key: `charge:${cur.chargeId}:refunded:${cur.amountRefundedCents}`,
      type: "refund.recorded",
      data: cleanData({ ...money, amountRefundedCents: cur.amountRefundedCents, deltaCents: cur.amountRefundedCents - before, full: cur.amountRefundedCents >= cur.amountCents }),
    });
  }
  if (cur.coverageLost && !prev?.coverageLost) {
    out.push({ ...base, key: `charge:${cur.chargeId}:coverage_lost:${at}`, type: "coverage.lost", fromState: "covered", toState: "lost", data: cleanData({ ...money, dispute: cur.disputeStatus }) });
  } else if (!cur.coverageLost && prev?.coverageLost) {
    out.push({ ...base, key: `charge:${cur.chargeId}:coverage_restored:${at}`, type: "coverage.restored", fromState: "lost", toState: "covered", data: cleanData({ ...money, dispute: cur.disputeStatus }) });
  }
  if (cur.disputeStatus && cur.disputeStatus !== (prev?.disputeStatus ?? null)) {
    out.push({ ...base, key: `charge:${cur.chargeId}:dispute:${cur.disputeStatus}`, type: "dispute.status_changed", fromState: prev?.disputeStatus ?? null, toState: cur.disputeStatus, data: cleanData(money) });
  }
  return out;
}

export type { OrderState };
