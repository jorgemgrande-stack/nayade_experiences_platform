/**
 * Procesamiento DURADERO de los eventos de Stripe (Fase C). SOLO MODO PRUEBAS.
 *
 * Principios (docs/elephant-source/STRIPE_FASE_A.md §6, §16.4 y §17.5):
 *  - El evento solo dice «mira este objeto». El efecto se calcula SIEMPRE releyendo el objeto en la
 *    API de Stripe y aplicando su estado ACTUAL: un evento repetido, retrasado o fuera de orden no cambia
 *    nada que no deba cambiar.
 *  - Cada evento se registra una vez (`stripe_events`) y se procesa con arrendamiento: con varias
 *    réplicas no se procesa dos veces a la vez. Un fallo se reintenta con espera creciente; al agotar los
 *    intentos queda `failed` con alerta y la conciliación lo puede retomar.
 *  - Un cobro solo cuenta si la FACTURA releída está `paid`, pertenece a esa suscripción y la
 *    suscripción es de un pedido de Elephant Source con el Customer de esa empresa. Entonces se registra
 *    como pago verificado del pedido (`commercial_payments`, proveedor `stripe_test`, clave idempotente
 *    por factura) y el circuito existente confirma → aprovisiona → suscribe → licencia → activa.
 *  - Impago, suspensión, recuperación, cancelación programada, reactivación y fin se aplican con
 *    `applyExternalBilling` del orquestador. Nunca se borran datos.
 */
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder } from "../orchestrator/types";
import { STRIPE_PAYMENT_PROVIDER } from "../orchestrator/service";
import type { GwInvoice, GwSubscription, StripeGateway } from "./gateway";
import type { StripeEventRow, StripeStore } from "./store";

/** Eventos que se aceptan y procesan (nombres de la API 2026-09-30.endive). */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;
export const HANDLED = new Set<string>(HANDLED_EVENTS);

/** Esperas entre reintentos de un evento fallido (ms). Al agotarlas queda fallido definitivo. */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000];
const LEASE_MS = 5 * 60_000;
const PIPELINE: CommercialOrder["state"][] = ["contracted", "confirmed", "subscribed", "licensed"];
const LIVE_OR_SCHEDULED: CommercialOrder["state"][] = ["active", "past_due", "suspended", "cancel_scheduled"];

/** Lo que el procesador necesita del orquestador (público y probado allí). */
export interface OrchestratorPort {
  advance(id: number, actor: string): Promise<{ order: CommercialOrder; error: string | null }>;
  renew(id: number, actor: string): Promise<unknown>;
  applyExternalBilling(id: number, s: { status: "active" | "past_due" | "unpaid" | "canceled"; cancelAt: number | null }, actor: string): Promise<{ order: CommercialOrder; changed: string[] }>;
}

export interface ProcessorDeps {
  store: StripeStore;
  gateway: StripeGateway;
  orders: Pick<OrderStore, "get" | "insertPayment" | "payments">;
  orchestrator: OrchestratorPort;
  now?: () => number;
  maxAttempts?: number;
}

export type Outcome = { outcome: "processed" | "ignored"; detail: string | null };

/** Error que no se resuelve reintentando (datos que no corresponden): el evento queda ignorado y con alerta. */
export class StripeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeMismatchError";
  }
}

export class StripeEventProcessor {
  private now: () => number;
  private actor = "system:stripe";
  constructor(private d: ProcessorDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Procesa hasta `limit` eventos pendientes. Devuelve el recuento por resultado. */
  async processDue(limit = 25): Promise<{ processed: number; ignored: number; failed: number; retried: number }> {
    const out = { processed: 0, ignored: 0, failed: 0, retried: 0 };
    const rows = await this.d.store.claimEvents(this.now(), limit, LEASE_MS);
    for (const row of rows) {
      try {
        const r = await this.process(row);
        await this.d.store.finishEvent(row.eventId, r.outcome, r.detail, this.now());
        out[r.outcome]++;
      } catch (e) {
        if (e instanceof StripeMismatchError) {
          opsLog("warn", "StripeEvents", "mismatch", { eventId: row.eventId, type: row.type });
          recordFailure("stripe.event_mismatch");
          await this.d.store.finishEvent(row.eventId, "ignored", e.message, this.now());
          out.ignored++;
          continue;
        }
        const max = this.d.maxAttempts ?? RETRY_BACKOFF_MS.length + 1;
        const msg = (e instanceof Error ? `${e.name}: ${e.message}` : "error").slice(0, 300);
        const wait = RETRY_BACKOFF_MS[Math.min(row.attempts - 1, RETRY_BACKOFF_MS.length - 1)];
        if (row.attempts >= max) {
          await this.d.store.failEvent(row.eventId, msg, null);
          recordFailure("stripe.event_failed");
          opsLog("error", "StripeEvents", "failed_final", { eventId: row.eventId, type: row.type, attempts: row.attempts });
          out.failed++;
        } else {
          await this.d.store.failEvent(row.eventId, msg, this.now() + wait);
          opsLog("warn", "StripeEvents", "retry_scheduled", { eventId: row.eventId, type: row.type, attempts: row.attempts, waitMs: wait });
          out.retried++;
        }
      }
    }
    return out;
  }

  /** Un evento: relee su objeto y aplica el estado actual. */
  async process(row: Pick<StripeEventRow, "eventId" | "type" | "objectId">): Promise<Outcome> {
    if (!HANDLED.has(row.type)) return { outcome: "ignored", detail: "Tipo no gestionado" };
    if (!row.objectId) return { outcome: "ignored", detail: "Evento sin objeto" };
    if (row.type.startsWith("checkout.session.")) return this.handleSession(row.objectId);
    if (row.type.startsWith("invoice.")) return this.handleInvoice(row.objectId);
    return this.handleSubscription(row.objectId);
  }

  private async handleSession(id: string): Promise<Outcome> {
    const local = await this.d.store.session(id);
    if (!local) return { outcome: "ignored", detail: "Sesión no creada por Elephant Source" };
    const s = await this.d.gateway.checkoutSession(id);
    if (!s) return { outcome: "ignored", detail: "La sesión no existe en Stripe" };
    if (s.metadata.es_order_id !== String(local.orderId) || s.clientReferenceId !== `es-order-${local.orderId}`) throw new StripeMismatchError("La sesión no corresponde a su pedido");
    const status = s.status === "complete" ? "complete" : s.status === "expired" ? "expired" : "open";
    await this.d.store.updateSession(id, { status, paymentStatus: s.paymentStatus, completedAt: status === "complete" ? this.now() : null });
    if (status === "complete" && s.subscriptionId) return this.handleSubscription(s.subscriptionId);
    return { outcome: "processed", detail: `Sesión ${status}` };
  }

  private async handleInvoice(id: string): Promise<Outcome> {
    const inv = await this.d.gateway.invoice(id);
    if (!inv) return { outcome: "ignored", detail: "La factura no existe en Stripe" };
    if (!inv.subscriptionId) return { outcome: "ignored", detail: "Factura sin suscripción" };
    return this.handleSubscription(inv.subscriptionId, inv);
  }

  /** Núcleo: relee la suscripción, comprueba que es nuestra y aplica su estado actual. */
  async handleSubscription(id: string, hint?: GwInvoice): Promise<Outcome> {
    const sub = await this.d.gateway.subscription(id);
    if (!sub) return { outcome: "ignored", detail: "La suscripción no existe en Stripe" };
    const orderId = Number(sub.metadata.es_order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) return { outcome: "ignored", detail: "Suscripción no creada por Elephant Source" };
    const order = await this.d.orders.get(orderId);
    if (!order) throw new StripeMismatchError("La suscripción apunta a un pedido inexistente");
    const link = await this.d.store.customerByCompany(order.companyId);
    if (!link || link.stripeCustomerId !== sub.customerId) throw new StripeMismatchError("El cliente de Stripe no es el de la empresa del pedido");
    const linked = new Set((await this.d.store.listPrices()).filter((p) => p.status === "active").map((p) => p.stripePriceId));
    if (!sub.priceIds.length || sub.priceIds.some((p) => !linked.has(p))) throw new StripeMismatchError("La suscripción incluye precios que no son del catálogo enlazado");
    const { metadata: _m, ...mirror } = sub;
    await this.d.store.upsertSubscription({ ...mirror, companyId: order.companyId, orderId, tenantId: link.tenantId, syncedAt: this.now() });

    const payment = await this.recordPaidInvoice(order, sub, hint);

    if (PIPELINE.includes(order.state)) {
      if (sub.status !== "active" || !(await this.hasInitialPayment(order, payment))) return { outcome: "processed", detail: `Pedido en ${order.state}: suscripción ${sub.status}, sin pago inicial verificado` };
      const r = await this.d.orchestrator.advance(orderId, this.actor);
      // Un paso del alta falló (p. ej. aprovisionamiento): se reintenta el evento; nunca se da por hecho
      if (r.error) throw new Error(`Alta pendiente: ${r.error}`);
      return { outcome: "processed", detail: `Pedido ${r.order.state}` };
    }
    if (!LIVE_OR_SCHEDULED.includes(order.state)) return { outcome: "processed", detail: `Pedido en ${order.state}: sin cambios` };
    if (payment?.created && payment.purpose === "renewal") await this.d.orchestrator.renew(orderId, this.actor).catch((e) => opsLog("warn", "StripeEvents", "renew_skipped", { orderId, error: e instanceof Error ? e.name : "error" }));
    const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : sub.status === "unpaid" || sub.status === "paused" ? "unpaid" : sub.status === "canceled" || sub.status === "incomplete_expired" ? "canceled" : null;
    if (!status) return { outcome: "processed", detail: `Suscripción ${sub.status}: sin cambios` };
    const cancelAt = sub.cancelAt ?? (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null);
    const r = await this.d.orchestrator.applyExternalBilling(orderId, { status, cancelAt: cancelAt === null ? null : cancelAt * 1000 }, this.actor);
    return { outcome: "processed", detail: r.changed.length ? `Pedido: ${r.changed.join(" → ")}` : "Sin cambios" };
  }

  /** Registra como pago verificado la última factura PAGADA de la suscripción (idempotente por factura). */
  private async recordPaidInvoice(order: CommercialOrder, sub: GwSubscription, hint?: GwInvoice) {
    if (!sub.latestInvoiceId) return null;
    const inv = hint && hint.id === sub.latestInvoiceId ? hint : await this.d.gateway.invoice(sub.latestInvoiceId);
    if (!inv || inv.status !== "paid" || inv.subscriptionId !== sub.id || inv.customerId !== sub.customerId || inv.amountPaid <= 0) return null;
    const purpose = inv.billingReason === "subscription_cycle" ? ("renewal" as const) : inv.billingReason === "subscription_update" ? ("change" as const) : ("initial" as const);
    const r = await this.d.orders.insertPayment({
      orderId: order.id,
      idempotencyKey: `stripe:inv:${inv.id}`,
      purpose,
      periodStart: inv.periodStart === null ? null : inv.periodStart * 1000,
      amountCents: inv.amountPaid,
      currency: inv.currency,
      status: "succeeded",
      provider: STRIPE_PAYMENT_PROVIDER,
      mode: "test",
      providerRef: inv.id,
      dueAt: null,
      createdAt: this.now(),
      settledAt: this.now(),
    });
    if (r.created) opsLog("info", "StripeEvents", "payment_verified", { orderId: order.id, invoiceId: inv.id, purpose });
    return { created: r.created, purpose };
  }

  private async hasInitialPayment(order: CommercialOrder, just: { purpose: string } | null) {
    if (just && just.purpose !== "renewal") return true;
    return (await this.d.orders.payments(order.id)).some((p) => p.provider === STRIPE_PAYMENT_PROVIDER && p.status === "succeeded" && p.purpose !== "renewal");
  }
}
