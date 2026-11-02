/**
 * Estado de activación de cada producto para el panel de una empresa (solo lectura), a partir de sus pedidos
 * comerciales: la licencia solo existe cuando el circuito de siempre (cobro verificado → confirmar → suscripción →
 * licencias) deja el pedido activo. Aquí no se cambia nada.
 *
 *  - active: lo incluye el pedido vigente (activo, impagado dentro de la gracia o con baja programada) o es un
 *    módulo retirado cuya partida sigue vigente hasta `activeUntil`. Nunca «none» mientras la licencia siga vigente.
 *  - suspended: el pedido vigente está suspendido (impago tras la gracia o cobro revertido): sin acceso.
 *  - pending: compra iniciada que espera el cobro (pedido solicitado, presupuestado o contratado).
 *  - processing: cobro verificado; se están concediendo la suscripción y las licencias.
 *  - error: la última compra de ese producto se rechazó o falló hace menos de ERROR_WINDOW_MS, o su activación
 *    falló de forma definitiva o agotó los reintentos automáticos.
 *  - none: nada de lo anterior.
 *
 * Contrato ADITIVO (el Core actual solo lee `state`, `retryable` y `updatedAt`):
 *  - payment: estado del cobro: pending (esperando), failed (rechazado o revertido), expired (caducado),
 *    confirmed (cobro verificado), overdue (impago: dentro de la gracia o suspendido); null si no aplica.
 *  - error: { kind: "activation" | "payment", transient } o null.
 *  - retryable: true solo si reintentar es seguro (activación: cobro confirmado y pasos idempotentes; pago: se puede
 *    iniciar una compra nueva).
 *  - nextRetryAt: próximo reintento automático de la activación (processing), o null.
 *  - activeUntil: fin del acceso con baja programada (de toda la suscripción o de ese módulo), o null.
 *  - renewal: active (se renueva), cancelled (baja programada) o null.
 *  - canReactivate: la baja programada de TODA la suscripción se puede deshacer (Stripe, `cancel_at_period_end`).
 */
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import type { CrmStore } from "../crm/store";
import type { OrderStore } from "../orchestrator/store";
import { OrderError, rejectCodeOf, type CommercialOrder, type OrderEvent, type OrderPayment, type OrderState } from "../orchestrator/types";
import type { SubscriptionItem } from "../subscriptions/types";
import { planFromOrders } from "./panelMarketplace";

export type ActivationState = "none" | "pending" | "processing" | "active" | "suspended" | "error";
export type ActivationPayment = "pending" | "failed" | "expired" | "confirmed" | "overdue";
export interface ActivationError {
  kind: "activation" | "payment";
  transient: boolean;
}
export interface PanelActivation {
  state: ActivationState;
  payment: ActivationPayment | null;
  error: ActivationError | null;
  retryable: boolean;
  nextRetryAt: number | null;
  activeUntil: number | null;
  renewal: "active" | "cancelled" | null;
  canReactivate: boolean;
  updatedAt: number | null;
}

/** Suscripción de cobro (Stripe) del pedido vigente, en milisegundos. */
export interface BillingView {
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
}
/** Suscripción interna del pedido vigente: fecha de cancelación programada y fin del periodo. */
export interface SubscriptionView {
  cancelAt: number | null;
  currentPeriodEnd: number | null;
}
/** Activación en curso (processing): lo calcula la recuperación del orquestador. */
export interface ProcessingView {
  /** Fallo definitivo o reintentos agotados: «Error de activación». */
  failed: boolean;
  transient: boolean | null;
  retryable: boolean;
  nextRetryAt: number | null;
  /** `payment_reversed`: el cobro se revirtió (reembolso o disputa): es un error de pago, no de activación. */
  code?: string | null;
}
type ItemView = Pick<SubscriptionItem, "productKey" | "family" | "effectiveFrom" | "effectiveTo">;

/** Datos adicionales para el estado. Todo opcional: sin ellos, los campos nuevos quedan en su valor neutro. */
export interface ActivationContext {
  /** Eventos de los pedidos que lo necesitan (rechazados, en activación y con baja programada). */
  events?: ReadonlyMap<number, readonly OrderEvent[]>;
  /** Pagos de los pedidos contratados que esperan el cobro. */
  payments?: ReadonlyMap<number, readonly OrderPayment[]>;
  /** Partidas de la suscripción del pedido vigente (bajas de módulos con fecha de fin). */
  items?: readonly ItemView[];
  subscription?: SubscriptionView | null;
  billing?: BillingView | null;
  /** Recuperación de las activaciones en curso (por pedido). */
  processing?: (o: CommercialOrder) => ProcessingView | null;
}

/** Cuánto tiempo se muestra una compra fallida como error recuperable. */
export const ERROR_WINDOW_MS = 7 * 24 * 3600 * 1000;
const CURRENT: ReadonlySet<OrderState> = new Set<OrderState>(["active", "past_due", "suspended", "cancel_scheduled"]);
const PENDING: ReadonlySet<OrderState> = new Set<OrderState>(["requested", "quoted", "contracted"]);
const PROCESSING: ReadonlySet<OrderState> = new Set<OrderState>(["confirmed", "subscribed", "licensed"]);
/** Estado sin dato (producto sin pedidos). */
export const NO_ACTIVATION: PanelActivation = { state: "none", payment: null, error: null, retryable: false, nextRetryAt: null, activeUntil: null, renewal: null, canReactivate: false, updatedAt: null };

const keysOf = (o: CommercialOrder) => (o.request?.items ?? []).map((i) => i.key).filter((k, i, a) => a.indexOf(k) === i);
const at = (o: CommercialOrder) => o.updatedAt ?? o.createdAt;
const own = (orders: readonly CommercialOrder[], tenantId: string) => orders.filter((o) => o.tenantId === tenantId || (o.tenantId === null && (PENDING.has(o.state) || PROCESSING.has(o.state) || o.state === "rejected")));
const currentOf = (orders: readonly CommercialOrder[]) => orders.filter((o) => CURRENT.has(o.state)).sort((a, b) => b.id - a.id)[0];
const confirmedBy = (o: CommercialOrder): ActivationPayment | null => (o.confirmation?.kind === "payment" ? "confirmed" : null);

/** Fin del acceso con la baja programada de TODA la suscripción: Stripe → suscripción interna → evento de la baja. */
function cancelEnd(o: CommercialOrder, ctx: ActivationContext): number | null {
  const b = ctx.billing;
  if (b && (b.cancelAt !== null || b.cancelAtPeriodEnd)) return b.cancelAt ?? b.currentPeriodEnd;
  if (ctx.subscription?.cancelAt) return ctx.subscription.cancelAt;
  const ev = (ctx.events?.get(o.id) ?? []).filter((e) => e.kind === "cancel").pop();
  const fromEvent = ev?.detail?.cancelAt;
  if (typeof fromEvent === "number") return fromEvent;
  return ctx.subscription?.currentPeriodEnd ?? null;
}

/** Fin de la partida de un módulo dado de baja a fin de periodo que sigue vigente; null si no se retira. */
function removalEnd(key: string, items: readonly ItemView[] | undefined, now: number): number | null {
  if (!items) return null;
  const live = items.filter((i) => i.productKey === key && i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now));
  if (!live.length || live.some((i) => i.effectiveTo === null)) return null;
  const end = Math.max(...live.map((i) => i.effectiveTo!));
  // Un cambio de precio cierra la partida y abre otra desde su fin: eso no es una baja
  if (items.some((i) => i.productKey === key && i.effectiveFrom >= end)) return null;
  return end;
}

/** Estado de los productos del pedido vigente. */
function currentActivation(o: CommercialOrder, ctx: ActivationContext): PanelActivation {
  const base: PanelActivation = { ...NO_ACTIVATION, updatedAt: at(o), renewal: "active" };
  switch (o.state) {
    case "suspended":
      return { ...base, state: "suspended", payment: "overdue" };
    case "past_due":
      return { ...base, state: "active", payment: "overdue" };
    case "cancel_scheduled":
      // Solo la baja «a fin de periodo» de Stripe se deshace (transición `reactivate`); una fecha fijada por el equipo no
      return { ...base, state: "active", payment: confirmedBy(o), activeUntil: cancelEnd(o, ctx), renewal: "cancelled", canReactivate: !!ctx.billing?.cancelAtPeriodEnd };
    default:
      return { ...base, state: "active", payment: confirmedBy(o) };
  }
}

/** Compra pendiente del cobro: el último intento de pago (si lo hay) decide si consta como fallido. */
function pendingActivation(o: CommercialOrder, ctx: ActivationContext): PanelActivation {
  const last = (ctx.payments?.get(o.id) ?? []).filter((p) => p.purpose !== "renewal").pop();
  if (last?.status === "failed") return { ...NO_ACTIVATION, state: "pending", payment: "failed", error: { kind: "payment", transient: true }, retryable: true, updatedAt: at(o) };
  return { ...NO_ACTIVATION, state: "pending", payment: "pending", updatedAt: at(o) };
}

/** Compra rechazada: el motivo tipificado (si lo hay) distingue el pago fallido o caducado. Sin motivo: como antes. */
function rejectedActivation(o: CommercialOrder, ctx: ActivationContext): PanelActivation {
  const code = rejectCodeOf(ctx.events?.get(o.id) ?? []);
  const payment: ActivationPayment | null = code === "payment_failed" || code === "payment_reversed" ? "failed" : code === "payment_expired" || code === "expired" ? "expired" : null;
  const kind = code === "activation" || code === "conflict" ? "activation" : "payment";
  return { ...NO_ACTIVATION, state: "error", payment, error: { kind, transient: false }, retryable: true, updatedAt: at(o) };
}

/** Activación en curso: con fallo definitivo o reintentos agotados, «Error de activación». */
function processingActivation(o: CommercialOrder, ctx: ActivationContext): PanelActivation {
  const p = ctx.processing?.(o) ?? null;
  const base: PanelActivation = { ...NO_ACTIVATION, payment: confirmedBy(o), updatedAt: at(o) };
  if (p?.failed && p.code === "payment_reversed") return { ...base, state: "error", payment: "failed", error: { kind: "payment", transient: false }, retryable: false };
  if (p?.failed) return { ...base, state: "error", error: { kind: "activation", transient: p.transient ?? false }, retryable: p.retryable };
  return { ...base, state: "processing", retryable: !!p?.retryable, nextRetryAt: p?.nextRetryAt ?? null };
}

/** Estado por clave de producto de los pedidos de UNA empresa (ya filtrados por empresa). */
export function activationFromOrders(orders: readonly CommercialOrder[], tenantId: string, now: number, ctx: ActivationContext = {}): Map<string, PanelActivation> {
  const mine = own(orders, tenantId);
  const out = new Map<string, PanelActivation>();
  const current = currentOf(mine);
  if (current) {
    const state = currentActivation(current, ctx);
    const whole = current.state === "cancel_scheduled";
    for (const k of keysOf(current)) {
      // Módulo del pedido vigente con su partida dada de baja a fin de periodo: vigente hasta su fin
      const end = whole || current.state === "suspended" ? null : removalEnd(k, ctx.items, now);
      out.set(k, end === null ? state : { ...state, activeUntil: end, renewal: "cancelled", canReactivate: false });
    }
    // Módulos retirados en un cambio cuya partida sigue vigente: activos hasta su fin, nunca «none»
    for (const i of ctx.items ?? []) {
      if (i.family === "core_plan" || out.has(i.productKey)) continue;
      const end = removalEnd(i.productKey, ctx.items, now);
      if (end === null) continue;
      const until = whole && state.activeUntil !== null ? Math.min(end, state.activeUntil) : end;
      out.set(i.productKey, { ...state, activeUntil: until, renewal: "cancelled", canReactivate: false });
    }
  }
  // Lo más reciente manda entre las compras en curso o fallidas de cada producto que no está ya vigente
  for (const o of [...mine].sort((a, b) => a.id - b.id)) {
    if (current && o.id <= current.id) continue;
    const next = PENDING.has(o.state)
      ? pendingActivation(o, ctx)
      : PROCESSING.has(o.state)
        ? processingActivation(o, ctx)
        : o.state === "rejected" && now - at(o) <= ERROR_WINDOW_MS
          ? rejectedActivation(o, ctx)
          : null;
    if (!next) continue;
    for (const k of keysOf(o)) {
      const prev = out.get(k)?.state;
      if (prev !== "active" && prev !== "suspended") out.set(k, next);
    }
  }
  return out;
}

/** Pedidos cuyo estado necesita eventos o pagos (los demás se resuelven solo con el pedido). */
function needs(orders: readonly CommercialOrder[], tenantId: string, now: number) {
  const mine = own(orders, tenantId);
  const current = currentOf(mine);
  const later = mine.filter((o) => !current || o.id > current.id);
  return {
    current,
    events: [...(current?.state === "cancel_scheduled" ? [current] : []), ...later.filter((o) => PROCESSING.has(o.state) || (o.state === "rejected" && now - at(o) <= ERROR_WINDOW_MS))],
    payments: later.filter((o) => o.state === "contracted"),
  };
}

/** Plan vigente de la empresa del tenant (audiencia de las campañas del carrusel), o null. */
export function orderPlan(d: { crm: CrmStore; orders: OrderStore }) {
  return async (tenantId: string): Promise<string | null> => {
    const company = (await d.crm.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number } | undefined;
    return company ? planFromOrders(await d.orders.list({ companyId: company.id }), tenantId) : null;
  };
}

export interface ActivationReaderDeps {
  crm: CrmStore;
  orders: OrderStore;
  now?: () => number;
  /** Suscripción interna y sus partidas (fecha de baja programada y bajas de módulos). */
  subscriptions?: { get(id: number): Promise<SubscriptionView | null>; items(id: number): Promise<readonly ItemView[]> };
  /** Suscripción de cobro (Stripe) del pedido vigente con baja programada, en milisegundos; null si no tiene. */
  billing?: (o: CommercialOrder) => Promise<BillingView | null>;
  /** Recuperación de las activaciones en curso a partir de sus eventos (orquestador). */
  processing?: (o: CommercialOrder, events: readonly OrderEvent[], now: number) => ProcessingView | null;
}

/** Lector para el catálogo del panel: empresa del tenant → sus pedidos → estado por producto. */
export function orderActivation(d: ActivationReaderDeps) {
  return async (tenantId: string): Promise<Map<string, PanelActivation>> => {
    const company = (await d.crm.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number } | undefined;
    if (!company) return new Map();
    const now = (d.now ?? Date.now)();
    const orders = await d.orders.list({ companyId: company.id });
    const n = needs(orders, tenantId, now);
    const events = new Map<number, OrderEvent[]>();
    const payments = new Map<number, OrderPayment[]>();
    await Promise.all([
      ...n.events.map(async (o) => void events.set(o.id, await d.orders.events(o.id))),
      ...n.payments.map(async (o) => void payments.set(o.id, await d.orders.payments(o.id))),
    ]);
    const ctx: ActivationContext = { events, payments };
    const subId = n.current?.subscriptionId ?? null;
    if (subId !== null && d.subscriptions) {
      const [sub, items] = await Promise.all([d.subscriptions.get(subId), d.subscriptions.items(subId)]);
      ctx.subscription = sub ? { cancelAt: sub.cancelAt, currentPeriodEnd: sub.currentPeriodEnd } : null;
      ctx.items = items;
    }
    if (n.current?.state === "cancel_scheduled" && d.billing) ctx.billing = await d.billing(n.current);
    const processing = d.processing;
    if (processing) ctx.processing = (o) => processing(o, events.get(o.id) ?? [], now);
    return activationFromOrders(orders, tenantId, now, ctx);
  };
}

// ── Botón «Reintentar» del panel ───────────────────────────────────────────────

/** Reanudación de una activación (lo implementa el orquestador: `retryActivation`). */
export type RetryActivation = (tenantId: string, input: { key?: string }, actor: string) => Promise<{ status: "resumed" | "active" | "in_progress" | "throttled"; order: CommercialOrder; error: string | null; retryAt: number | null }>;

const tenantParam = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const retryBody = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional() }).strict();
/** Una petición por empresa cada este tiempo como mucho (además del límite por pedido del orquestador). */
export const RETRY_TENANT_INTERVAL_MS = 5_000;

/**
 * `POST /commerce/tenants/:t/activation/retry` (token del Core con `commerce:purchase`): reanuda la activación tras el
 * cobro de un producto de ESA empresa (`key`) o la más reciente reintentable. Nunca cobra ni crea otro pedido.
 * Respuestas: 200 `active` (ya estaba o quedó activo) · 202 `resumed`/`in_progress` · 429 `throttled` · 409 sin nada
 * que reintentar · 404 empresa o producto sin pedido.
 */
export function createPanelRetryRouter(d: { retry: RetryActivation; now?: () => number }): Router {
  const r = express.Router();
  const now = d.now ?? Date.now;
  const last = new Map<string, number>();
  r.post("/tenants/:tenantId/activation/retry", express.json({ limit: "4kb" }), (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const scopes = getAuth(req)?.scopes;
    if (!scopes?.has("commerce:purchase")) return void res.status(403).json({ error: "forbidden", scope: "commerce:purchase" });
    const t = tenantParam.safeParse(req.params.tenantId);
    const b = retryBody.safeParse(req.body ?? {});
    if (!t.success || !b.success) return void res.status(400).json({ error: "invalid_request", message: t.success ? "key" : "tenantId" });
    const at = now();
    const prev = last.get(t.data);
    if (prev !== undefined && at - prev < RETRY_TENANT_INTERVAL_MS) return void res.status(429).json({ error: "throttled", retryAt: prev + RETRY_TENANT_INTERVAL_MS });
    last.set(t.data, at);
    if (last.size > 5000) last.clear();
    const actor = getAuth(req)!.actor;
    d.retry(t.data, b.data, `${actor.type}:${actor.id}`).then(
      (x) => {
        const body = { status: x.status, orderId: x.order.id, state: x.order.state, error: x.error, retryAt: x.retryAt };
        res.status(x.status === "throttled" ? 429 : x.status === "active" ? 200 : 202).json(body);
      },
      (e) => {
        if (e instanceof OrderError) return void res.status(e.code === "not_found" ? 404 : 409).json({ error: e.code, message: e.message });
        opsLog("error", "Commerce", "activation_retry_failed", { error: e instanceof Error ? e.name : "error" });
        res.status(500).json({ error: "internal_error", message: "Error interno" });
      },
    );
  });
  return r;
}
