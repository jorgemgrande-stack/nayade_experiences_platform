/**
 * Procesamiento DURADERO de los eventos de Stripe (Fase C), en modo pruebas o live.
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
 *    como pago verificado del pedido (`commercial_payments`, proveedor `stripe_test` y modo `test` en
 *    pruebas, `stripe` y `live` en live; clave idempotente por factura) y el circuito existente
 *    confirma → aprovisiona → suscribe → licencia → activa.
 *  - Impago, suspensión, recuperación, cancelación programada, reactivación y fin se aplican con
 *    `applyExternalBilling` del orquestador. Nunca se borran datos.
 *  - Reembolsos y disputas: se relee el CARGO y se guarda su estado (`stripe_charge_adjustments`). Si la
 *    cobertura se pierde del todo (reembolso total o disputa perdida), el pedido queda retenido: suspendido
 *    aunque Stripe muestre la suscripción activa, hasta un pago nuevo, una disputa ganada o un operador.
 *    Un reembolso parcial o una disputa abierta solo avisan.
 *  - Cada entorno solo atiende sus objetos (`metadata.es_env`): dos entornos pueden compartir sandbox.
 *  - Los eventos comerciales que se registren al procesar un evento llevan su id como causa.
 */
import { opsLog } from "../_core/ops/log";
import { withCommercialCause } from "../commercialEvents/context";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder } from "../orchestrator/types";
import { stripePaymentProvider } from "../orchestrator/service";
import type { StripeMode } from "./config";
import type { GwCharge, GwInvoice, GwSubscription, StripeGateway } from "./gateway";
import type { StripeEventRow, StripeStore } from "./store";
import { classifyTerritory, territoryGroup } from "./buyerProfile";

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
  "charge.refunded",
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_reinstated",
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
  applyExternalBilling(id: number, s: { status: "active" | "past_due" | "unpaid" | "canceled"; cancelAt: number | null; coverageLost?: boolean }, actor: string): Promise<{ order: CommercialOrder; changed: string[] }>;
  /** Aviso (correo) de un cobro verificado de renovación o de cambio. Opcional: sin él no se avisa. */
  paymentRecorded?(orderId: number, paymentId: number): Promise<void>;
}

export interface ProcessorDeps {
  store: StripeStore;
  gateway: StripeGateway;
  orders: Pick<OrderStore, "get" | "insertPayment" | "payments">;
  orchestrator: OrchestratorPort;
  now?: () => number;
  maxAttempts?: number;
  /** Prefijo de este entorno (`metadata.es_env`); los objetos de otro entorno se ignoran. */
  namespace?: string;
  /** Modo del entorno (por defecto «test»): fija el proveedor y el modo de los pagos verificados. */
  mode?: StripeMode;
}

/** Estado de un cargo que deja sin cobertura el periodo que pagó. */
export const coverageLostOf = (c: { amount: number; amountRefunded: number; refunded: boolean; disputeStatus: string | null }) =>
  c.refunded || (c.amount > 0 && c.amountRefunded >= c.amount) || c.disputeStatus === "lost";
const OPEN_DISPUTE = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review"]);

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
  private namespace: string;
  private mode: StripeMode;
  /** Proveedor de los pagos verificados de ESTE modo (`stripe_test` o `stripe`). */
  private provider: string;
  constructor(private d: ProcessorDeps) {
    this.now = d.now ?? Date.now;
    this.namespace = d.namespace ?? "local";
    this.mode = d.mode ?? "test";
    this.provider = stripePaymentProvider(this.mode);
  }

  /** Procesa hasta `limit` eventos pendientes. Devuelve el recuento por resultado. */
  async processDue(limit = 25): Promise<{ processed: number; ignored: number; failed: number; retried: number }> {
    const out = { processed: 0, ignored: 0, failed: 0, retried: 0 };
    const rows = await this.d.store.claimEvents(this.now(), limit, LEASE_MS);
    for (const row of rows) {
      try {
        const r = await withCommercialCause({ source: "stripe", causationId: `stripe:${row.eventId}` }, () => this.process(row));
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
    if (row.type.startsWith("charge.refund.")) return this.handleChargeOf("refund", row.objectId);
    if (row.type.startsWith("charge.dispute.")) return this.handleChargeOf("dispute", row.objectId);
    if (row.type.startsWith("charge.")) return this.handleCharge(row.objectId);
    return this.handleSubscription(row.objectId);
  }

  private async handleChargeOf(kind: "refund" | "dispute", id: string): Promise<Outcome> {
    const chargeId = await this.d.gateway.chargeIdOf(kind, id);
    if (!chargeId) return { outcome: "ignored", detail: kind === "refund" ? "El reembolso no existe en Stripe" : "La disputa no existe en Stripe" };
    return this.handleCharge(chargeId);
  }

  /**
   * Reembolso o disputa. El cargo se relee DENTRO del bloqueo del pedido y se aplica sin soltarlo: dos
   * eventos del mismo cargo a la vez nunca guardan una lectura antigua encima de una nueva.
   */
  async handleCharge(id: string): Promise<Outcome> {
    const first = await this.chargeContext(id);
    if ("ignored" in first) return first.ignored;
    const v = await this.verified(first.sub);
    if ("ignored" in v) return v.ignored;
    return this.withOrder(v.order.id, async () => {
      const ctx = await this.chargeContext(id);
      if ("ignored" in ctx) return ctx.ignored;
      const { c, inv, sub } = ctx;
      if (sub.id !== first.sub.id) throw new StripeMismatchError("El cargo ya no es de la misma suscripción");
      if (c.customerId !== sub.customerId || inv.customerId !== sub.customerId) throw new StripeMismatchError("El cargo no es del cliente de la suscripción");
      const previous = await this.d.store.adjustment(c.id);
      // Una disputa perdida es definitiva: una lectura que diga otra cosa no la deshace
      const disputeStatus = previous?.disputeStatus === "lost" && c.disputeStatus !== "lost" ? "lost" : c.disputeStatus;
      const lost = coverageLostOf({ ...c, disputeStatus });
      const { current } = await this.d.store.upsertAdjustment(
        { chargeId: c.id, invoiceId: inv.id, subscriptionId: sub.id, orderId: v.order.id, companyId: v.order.companyId, amountCents: c.amount, amountRefundedCents: c.amountRefunded, currency: c.currency, disputeStatus, coverageLost: lost },
        this.now(),
      );
      const log = { orderId: v.order.id, chargeId: c.id, refunded: c.amountRefunded, amount: c.amount, dispute: disputeStatus };
      if (lost && !previous?.coverageLost) {
        opsLog("warn", "StripeEvents", "coverage_lost", log);
        recordFailure("stripe.coverage_lost");
      } else if (!lost && c.amountRefunded > 0 && c.amountRefunded !== previous?.amountRefundedCents) {
        opsLog("warn", "StripeEvents", "partial_refund", log);
        recordFailure("stripe.partial_refund");
      }
      if (disputeStatus && OPEN_DISPUTE.has(disputeStatus) && disputeStatus !== previous?.disputeStatus) {
        opsLog("warn", "StripeEvents", "dispute_open", log);
        recordFailure("stripe.dispute_open");
      }
      // Disputa ganada o reembolso anulado: la cobertura vuelve sola (la retención deja de existir)
      if (!lost && previous?.coverageLost && previous.resolvedAt === null) await this.d.store.resolveHolds({ chargeId: c.id }, `Cobertura restablecida en Stripe (${disputeStatus ?? "reembolso anulado"})`, this.now());
      const r = await this.applySubscription(v.order, sub, v.link.tenantId);
      return { outcome: r.outcome, detail: `Cargo ${lost ? "sin cobertura" : current.amountRefundedCents ? "reembolsado en parte" : "al corriente"}; ${r.detail ?? ""}`.slice(0, 300) };
    });
  }

  /** Cargo → factura → suscripción, releídos en Stripe. */
  private async chargeContext(id: string): Promise<{ c: GwCharge; inv: GwInvoice; sub: GwSubscription } | { ignored: Outcome }> {
    const c = await this.d.gateway.charge(id);
    if (!c) return { ignored: { outcome: "ignored", detail: "El cargo no existe en Stripe" } };
    if (!c.invoiceId) return { ignored: { outcome: "ignored", detail: "Cargo sin factura de suscripción" } };
    const inv = await this.d.gateway.invoice(c.invoiceId);
    if (!inv?.subscriptionId) return { ignored: { outcome: "ignored", detail: "Cargo sin suscripción" } };
    const sub = await this.d.gateway.subscription(inv.subscriptionId);
    if (!sub) return { ignored: { outcome: "ignored", detail: "La suscripción no existe en Stripe" } };
    return { c, inv, sub };
  }

  /** ¿La suscripción es de un pedido de ESTE entorno y del cliente de su empresa? */
  private async ownership(sub: GwSubscription): Promise<{ order: CommercialOrder; link: { tenantId: string | null; stripeCustomerId: string } } | { ignored: Outcome }> {
    const orderId = Number(sub.metadata.es_order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) return { ignored: { outcome: "ignored", detail: "Suscripción no creada por Elephant Source" } };
    const order = await this.d.orders.get(orderId);
    const link = order ? await this.d.store.customerByCompany(order.companyId) : null;
    if (sub.metadata.es_env !== this.namespace) {
      // De otro entorno, salvo que apunte a un pedido NUESTRO con su cliente: entonces algo cambió el prefijo y se avisa
      if (order && link && link.stripeCustomerId === sub.customerId) {
        opsLog("error", "StripeEvents", "namespace_mismatch", { orderId, subscriptionId: sub.id });
        recordFailure("stripe.namespace_mismatch");
      }
      return { ignored: { outcome: "ignored", detail: "Suscripción de otro entorno" } };
    }
    if (!order) throw new StripeMismatchError("La suscripción apunta a un pedido inexistente");
    if (!link || link.stripeCustomerId !== sub.customerId) throw new StripeMismatchError("El cliente de Stripe no es el de la empresa del pedido");
    return { order, link };
  }

  /** Pertenencia y precios: exactamente los que el servidor envió en un Checkout de ESTE pedido. */
  private async verified(sub: GwSubscription): Promise<{ order: CommercialOrder; link: { tenantId: string | null; stripeCustomerId: string } } | { ignored: Outcome }> {
    const own = await this.ownership(sub);
    if ("ignored" in own) return own;
    const linked = new Set((await this.d.store.listPrices()).filter((p) => p.status === "active").map((p) => p.stripePriceId));
    if (!sub.priceIds.length || sub.priceIds.some((p) => !linked.has(p))) throw new StripeMismatchError("La suscripción incluye precios que no son del catálogo enlazado");
    // Un cambio de plan sin aplicar no da otras licencias. Vale aunque el evento de Checkout aún no haya llegado
    const sets = await this.d.store.sessionPriceSets(own.order.id);
    const same = (a: string[]) => a.length === sub.priceIds.length && a.every((p) => sub.priceIds.includes(p));
    if (!sets.some(same)) throw new StripeMismatchError("Los precios de la suscripción no son los del pedido (¿cambio de plan sin aplicar?)");
    return own;
  }

  /** Un pedido a la vez: dos eventos del mismo pedido no lo avanzan en paralelo. */
  private async withOrder<T>(orderId: number, fn: () => Promise<T>): Promise<T> {
    const lease = `order:${orderId}`;
    const until = this.now() + 2 * 60_000;
    if (!(await this.d.store.acquireLease(lease, until, this.now()))) throw new Error("El pedido se está procesando: se reintenta");
    try {
      return await fn();
    } finally {
      await this.d.store.releaseLease(lease, until);
    }
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
    const v = await this.verified(sub);
    if ("ignored" in v) return v.ignored;
    return this.withOrder(v.order.id, () => this.applySubscription(v.order, sub, v.link.tenantId, hint));
  }

  private async applySubscription(stale: CommercialOrder, sub: GwSubscription, tenantId: string | null, hint?: GwInvoice): Promise<Outcome> {
    const orderId = stale.id;
    // Releído ya con el bloqueo del pedido: otra ejecución pudo avanzarlo mientras tanto
    const order = (await this.d.orders.get(orderId)) ?? stale;
    const { metadata: _m, ...mirror } = sub;
    await this.d.store.upsertSubscription({ ...mirror, companyId: order.companyId, orderId, tenantId, syncedAt: this.now() });

    const payment = await this.recordPaidInvoice(order, sub, hint);
    const lastPaid = (await this.d.orders.payments(orderId))
      // Solo los cobros de periodo (alta y renovaciones): un prorrateo no es un periodo nuevo
      .filter((p) => p.provider === this.provider && p.status === "succeeded" && p.purpose !== "change")
      .sort((a, b) => (b.periodStart ?? 0) - (a.periodStart ?? 0) || b.createdAt - a.createdAt)[0]?.providerRef ?? null;
    // Solo el cobro de un periodo NUEVO devuelve la cobertura perdida por un reembolso o una disputa
    if (payment?.created && payment.purpose === "renewal") await this.d.store.resolveHolds({ orderId, exceptInvoiceId: payment.invoiceId }, `Nuevo periodo pagado (factura ${payment.invoiceId})`, this.now());
    // Retiene el cobro revertido del ÚLTIMO periodo pagado. Una factura nueva aún sin pagar no la levanta;
    // un cobro revertido anterior a otro periodo ya pagado no deja sin cobertura el vigente
    const held = (await this.d.store.activeHolds(orderId)).some((h) => h.invoiceId !== null && h.invoiceId === lastPaid);

    if (PIPELINE.includes(order.state)) {
      if (held) return { outcome: "processed", detail: `Pedido en ${order.state}: el cobro se revirtió, no se activa` };
      if (sub.status !== "active" || !(await this.hasInitialPayment(order, payment))) return { outcome: "processed", detail: `Pedido en ${order.state}: suscripción ${sub.status}, sin pago inicial verificado` };
      const r = await this.d.orchestrator.advance(orderId, this.actor);
      // Un paso del alta falló (p. ej. aprovisionamiento): se reintenta el evento; nunca se da por hecho
      if (r.error) throw new Error(`Alta pendiente: ${r.error}`);
      return { outcome: "processed", detail: `Pedido ${r.order.state}` };
    }
    if (!LIVE_OR_SCHEDULED.includes(order.state)) return { outcome: "processed", detail: `Pedido en ${order.state}: sin cambios` };
    if (payment?.created && payment.purpose === "renewal") await this.d.orchestrator.renew(orderId, this.actor).catch((e) => opsLog("warn", "StripeEvents", "renew_skipped", { orderId, error: e instanceof Error ? e.name : "error" }));
    // Aviso de la renovación (o del cambio) cobrada y de su factura: solo la primera vez que se registra el pago
    if (payment?.created && payment.purpose !== "initial" && this.d.orchestrator.paymentRecorded)
      await this.d.orchestrator.paymentRecorded(orderId, payment.paymentId).catch((e) => opsLog("warn", "StripeEvents", "payment_notice_skipped", { orderId, error: e instanceof Error ? e.name : "error" }));
    const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : sub.status === "unpaid" || sub.status === "paused" ? "unpaid" : sub.status === "canceled" || sub.status === "incomplete_expired" ? "canceled" : null;
    if (!status) return { outcome: "processed", detail: `Suscripción ${sub.status}: sin cambios` };
    const cancelAt = sub.cancelAt ?? (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null);
    const r = await this.d.orchestrator.applyExternalBilling(orderId, { status, cancelAt: cancelAt === null ? null : cancelAt * 1000, coverageLost: held }, this.actor);
    return { outcome: "processed", detail: r.changed.length ? `Pedido: ${r.changed.join(" → ")}` : "Sin cambios" };
  }

  /** Registra como pago verificado la última factura PAGADA de la suscripción (idempotente por factura). */
  private async recordPaidInvoice(order: CommercialOrder, sub: GwSubscription, hint?: GwInvoice) {
    if (!sub.latestInvoiceId) return null;
    const inv = hint && hint.id === sub.latestInvoiceId ? hint : await this.d.gateway.invoice(sub.latestInvoiceId);
    if (!inv || inv.status !== "paid" || inv.subscriptionId !== sub.id || inv.customerId !== sub.customerId || (inv.amountPaid <= 0 && (inv.subtotal ?? 0) <= 0)) return null;
    if (order.quote && inv.currency !== order.quote.currency.toUpperCase()) throw new StripeMismatchError("La moneda de la factura no es la del pedido");
    const purpose = inv.billingReason === "subscription_cycle" ? ("renewal" as const) : inv.billingReason === "subscription_update" ? ("change" as const) : ("initial" as const);
    // El primer periodo facturado es exactamente el neto del presupuesto (subtotal: antes de impuestos y del
    // saldo a favor que el cliente pudiera tener en Stripe). Vale para pruebas (sin IVA) y para live con
    // Stripe Tax sobre precios sin IVA (el impuesto se suma después del subtotal)
    if (purpose === "initial" && order.quote && (inv.subtotal ?? inv.amountPaid) !== order.quote.contractAmountCents) throw new StripeMismatchError("El importe facturado no es el del presupuesto (sin IVA)");
    const r = await this.d.orders.insertPayment({
      orderId: order.id,
      idempotencyKey: `stripe:inv:${inv.id}`,
      purpose,
      periodStart: inv.periodStart === null ? null : inv.periodStart * 1000,
      amountCents: inv.amountPaid,
      currency: inv.currency,
      status: "succeeded",
      provider: this.provider,
      mode: this.mode,
      providerRef: inv.id,
      dueAt: null,
      createdAt: this.now(),
      settledAt: this.now(),
    });
    if (r.created) {
      opsLog("info", "StripeEvents", "payment_verified", { orderId: order.id, invoiceId: inv.id, purpose, ...(inv.taxCents != null ? { taxCents: inv.taxCents } : {}) });
      if (purpose === "initial") await this.checkBuyer(order.id, inv);
    }
    return { created: r.created, purpose, invoiceId: inv.id, paymentId: r.payment.id };
  }

  /**
   * Primer cobro: la dirección y los identificadores fiscales de la factura (los que usó Stripe Tax) deben
   * casar con el perfil fiscal declarado. Checkout permite cambiar la dirección, así que una discrepancia es
   * posible: se AVISA (el pago ya está cobrado; qué hacer es una decisión del equipo, no de este proceso).
   */
  private async checkBuyer(orderId: number, inv: GwInvoice) {
    const profile = await this.d.store.buyerProfile(orderId).catch(() => null);
    if (!profile) return;
    const t = inv.customerCountry ? classifyTerritory(inv.customerCountry, inv.customerPostalCode) : null;
    if (!t || territoryGroup(t) !== territoryGroup(profile.territory)) {
      opsLog("warn", "StripeEvents", "buyer_territory_mismatch", { orderId, invoiceId: inv.id, declared: profile.scenario, invoiced: t ?? "unknown" });
      recordFailure("stripe.buyer_territory_mismatch");
    }
    if (profile.type === "business" && !inv.customerTaxIds) {
      opsLog("warn", "StripeEvents", "buyer_tax_id_missing", { orderId, invoiceId: inv.id });
      recordFailure("stripe.buyer_tax_id_missing");
    }
  }

  private async hasInitialPayment(order: CommercialOrder, just: { purpose: string } | null) {
    if (just && just.purpose !== "renewal") return true;
    return (await this.d.orders.payments(order.id)).some((p) => p.provider === this.provider && p.status === "succeeded" && p.purpose !== "renewal");
  }
}
