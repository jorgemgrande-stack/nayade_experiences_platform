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
 *  - Compras desde la plataforma (./purchases.ts): una suscripción con EXACTAMENTE las partidas que pidió un
 *    cambio registrado (CRM 0018) es de ese pedido de cambio; su factura pagada lo confirma por el circuito de
 *    siempre. Un cambio que Stripe descartó sin cobro (sin cambio pendiente, factura anulada) caduca y su pedido
 *    se rechaza: nunca se concede nada sin cobro.
 */
import type { VatVerifier } from "./vies";
import { opsLog } from "../_core/ops/log";
import { withCommercialCause } from "../commercialEvents/context";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder } from "../orchestrator/types";
import { stripePaymentProvider } from "../orchestrator/service";
import type { StripeMode } from "./config";
import type { GwCharge, GwInvoice, GwSubscription, StripeGateway } from "./gateway";
import type { StripeEventRow, StripeStore } from "./store";
import { checkInvoiceTax, classifyTerritory, territoryGroup, type FiscalScenario, type TaxTreatment } from "./buyerProfile";
import { invoiceDocumentOf, invoiceRecordOf, invoiceSourceKey, pendingSink, rectificationOf, type FiscalDocument, type FiscalDocumentSink, type InvoicePurpose } from "./fiscalDocuments";
import type { CatalogPort } from "../subscriptions/ports";
import { SELF_SERVICE_PLANS, desiredCatalog } from "./catalog";
import { sameItems, type SubscriptionChangeStore } from "./changes";
import { allocateRefund, itemsDrift, linesOf, type InvoiceLineStore, type PriceResolver } from "./invoiceLines";

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
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "invoice.paid",
  "invoice.voided",
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
  /** Cambio de plan o periodicidad hecho en el Customer Portal (orchestrator.applyExternalPlanChange). Opcional. */
  applyExternalPlanChange?(id: number, target: { plan: string; interval: "month" | "year" }, signatureRef: string, actor: string): Promise<{ order: CommercialOrder; created: boolean; noop: boolean; error: string | null }>;
  /** Rechazo de un pedido de compra cuyo cambio caducó sin cobro. Opcional: sin él solo se marca el cambio. */
  reject?(id: number, input: { reason: string }, actor: string): Promise<unknown>;
}

export interface ProcessorDeps {
  store: StripeStore;
  gateway: StripeGateway;
  orders: Pick<OrderStore, "get" | "insertPayment" | "payments"> & Partial<Pick<OrderStore, "list">>;
  /**
   * Catálogo (para traducir un precio de Stripe a plan y periodicidad). Con él y `orders.list`, un cambio de
   * precio hecho en el Customer Portal se refleja como pedido de cambio; sin ellos, se rechaza como discordancia.
   */
  catalog?: CatalogPort;
  orchestrator: OrchestratorPort;
  now?: () => number;
  maxAttempts?: number;
  /** Prefijo de este entorno (`metadata.es_env`); los objetos de otro entorno se ignoran. */
  namespace?: string;
  /** Modo del entorno (por defecto «test»): fija el proveedor y el modo de los pagos verificados. */
  mode?: StripeMode;
  /** Tratamiento del impuesto declarado por escenario: el impuesto de cada factura cobrada se contrasta con él. */
  taxExpectations?: Map<FiscalScenario, TaxTreatment>;
  /** VIES: en cada renovación con inversión del sujeto pasivo, revalida el NIF-IVA si su comprobación caducó. */
  vat?: Pick<VatVerifier, "verify">;
  /** Sistema de facturación legal (cuando se apruebe). Por defecto ninguno: los documentos quedan pendientes. */
  fiscalSink?: FiscalDocumentSink;
  /** Cambios de partidas pedidos por las compras (CRM 0018). Sin él, una suscripción multipartida es una discordancia. */
  changes?: SubscriptionChangeStore;
  /** Detalle por línea de las facturas cobradas y reparto de reembolsos (CRM 0019). Opcional. */
  invoiceLines?: InvoiceLineStore;
  /**
   * Partidas contratadas para el PRÓXIMO periodo (producto → cantidad) de la suscripción interna del pedido. Con
   * ella se avisa de descuadres entre Stripe y lo contratado (nunca se corrigen solos).
   */
  contractedItems?: (order: CommercialOrder) => Promise<Map<string, number> | null>;
  /**
   * Partidas mensuales de un plan anual cobradas como primer mes en el Checkout del alta: se añaden a la suscripción
   * al activarse el pedido (`DeferredItemsService.attach`). Sin ella no se añaden.
   */
  deferredItems?: (order: CommercialOrder, sub: GwSubscription) => Promise<string>;
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
      // Reembolso nuevo: rectificativa por el importe añadido, ligada al documento de la factura original
      if (c.amountRefunded > (previous?.amountRefundedCents ?? 0)) await this.recordRefund(v.order.id, inv, c, previous?.amountRefundedCents ?? 0);
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

  /**
   * Pertenencia y precios. Se aplica sobre el pedido VIGENTE de la suscripción (el original o el último cambio).
   * Los precios deben ser los del Checkout de su alta o los del plan vigente. Un único precio distinto del
   * catálogo enlazado (Essential o Business) es un cambio hecho en el Customer Portal: se devuelve como `change`
   * para reflejarlo con un pedido de cambio. Cualquier otra cosa es una discordancia.
   */
  private async verified(sub: GwSubscription): Promise<
    { order: CommercialOrder; link: { tenantId: string | null; stripeCustomerId: string }; change?: { plan: string; interval: "month" | "year" } } | { ignored: Outcome }
  > {
    const own = await this.ownership(sub);
    if ("ignored" in own) return own;
    const linked = new Set((await this.d.store.listPrices()).filter((p) => p.status === "active").map((p) => p.stripePriceId));
    if (!sub.priceIds.length || sub.priceIds.some((p) => !linked.has(p))) throw new StripeMismatchError("La suscripción incluye precios que no son del catálogo enlazado");
    const current = await this.currentOrder(own.order);
    // Compra desde la plataforma: exactamente las partidas (precio y cantidad) que pidió un cambio registrado
    const purchase = await this.purchaseOf(sub, own.order.companyId, current);
    if (purchase) return { order: purchase, link: own.link };
    // Alta: exactamente los precios del Checkout del pedido. Vale aunque el evento de Checkout aún no haya llegado
    const sets = await this.d.store.sessionPriceSets(own.order.id);
    const same = (a: string[]) => a.length === sub.priceIds.length && a.every((p) => sub.priceIds.includes(p));
    if (current.id === own.order.id && sets.some(same)) return { order: current, link: own.link };
    const target = await this.planOfPrices(sub.priceIds);
    if (target && current.request.plan === target.plan && current.request.interval === target.interval) return { order: current, link: own.link };
    // Cambio hecho en el Customer Portal: solo sobre un pedido vigente y con el orquestador preparado para ello
    if (target && this.d.orchestrator.applyExternalPlanChange && ["active", "past_due", "suspended"].includes(current.state)) return { order: current, link: own.link, change: target };
    throw new StripeMismatchError("Los precios de la suscripción no son los del pedido (¿cambio de plan sin aplicar?)");
  }

  /**
   * Pedido de una compra cuyas partidas esperadas tiene ahora la suscripción: el de cambio si aún está en el
   * circuito (pendiente de confirmar), o el vigente si es ese mismo cambio ya aplicado.
   */
  private async purchaseOf(sub: GwSubscription, companyId: number, current: CommercialOrder): Promise<CommercialOrder | null> {
    if (!this.d.changes || !sub.items?.length) return null;
    for (const c of await this.d.changes.ofSubscription(sub.id)) {
      if ((c.status !== "pending" && c.status !== "applied") || c.companyId !== companyId || !sameItems(sub.items, c.expectedItems)) continue;
      const o = await this.d.orders.get(c.orderId);
      if (!o || o.companyId !== companyId) continue;
      if (c.status === "pending" && PIPELINE.includes(o.state)) return o;
      // Ya vigente (compra aplicada o reducción, que se activa sin cobro antes de llegar a Stripe)
      if (o.id === current.id && LIVE_OR_SCHEDULED.includes(o.state)) return o;
    }
    return null;
  }

  /**
   * Cambios de compra resueltos con la suscripción releída: aplicado si ya tiene sus partidas y el pedido está
   * vivo; caducado si Stripe no tiene cambio pendiente, no tiene las partidas y la factura del prorrateo está
   * anulada (Stripe la anula al caducar el cambio). Un caducado rechaza su pedido: no se concede nada.
   */
  private async settleChanges(sub: GwSubscription) {
    if (!this.d.changes || !sub.items) return;
    for (const c of (await this.d.changes.ofSubscription(sub.id)).filter((x) => x.status === "pending")) {
      const o = await this.d.orders.get(c.orderId);
      if (!o) continue;
      if (sameItems(sub.items, c.expectedItems)) {
        if (LIVE_OR_SCHEDULED.includes(o.state) || o.state === "superseded") await this.d.changes.resolve(c.id, "applied", null, this.now());
        continue;
      }
      if (sub.pendingUpdate || !c.stripeInvoiceId) continue;
      const inv = await this.d.gateway.invoice(c.stripeInvoiceId);
      if (!inv || (inv.status !== "void" && inv.status !== "uncollectible")) continue;
      if (!(await this.d.changes.resolve(c.id, "expired", "El cambio caducó en Stripe sin cobrarse", this.now()))) continue;
      opsLog("info", "StripeEvents", "purchase_expired", { orderId: o.id, changeId: c.id });
      if (["requested", "quoted", "contracted"].includes(o.state) && this.d.orchestrator.reject)
        await this.d.orchestrator.reject(o.id, { reason: "Pago de la compra no completado: el cambio caducó en Stripe" }, this.actor);
    }
  }

  /**
   * Pedido vigente de una suscripción: el último pedido vivo de la MISMA empresa que comparte la suscripción
   * interna (un cambio sustituye al anterior). Sin cambios, el propio pedido.
   */
  private async currentOrder(order: CommercialOrder): Promise<CommercialOrder> {
    if (!order.subscriptionId || !this.d.orders.list) return order;
    const chain = (await this.d.orders.list({ subscriptionId: order.subscriptionId })).filter((o) => o.companyId === order.companyId);
    const byId = (a: CommercialOrder, b: CommercialOrder) => b.id - a.id;
    return chain.filter((o) => LIVE_OR_SCHEDULED.includes(o.state)).sort(byId)[0] ?? chain.filter((o) => o.state !== "superseded" && o.state !== "rejected").sort(byId)[0] ?? order;
  }

  /** Plan y periodicidad de un precio enlazado de autoservicio (un solo precio), o null. */
  private async planOfPrices(priceIds: string[]): Promise<{ plan: string; interval: "month" | "year" } | null> {
    if (!this.d.catalog || priceIds.length !== 1) return null;
    const link = (await this.d.store.listPrices()).find((p) => p.stripePriceId === priceIds[0] && p.status === "active");
    if (!link) return null;
    const d = (await desiredCatalog(this.d.catalog)).find((x) => x.webPriceId === link.webPriceId);
    if (!d || !(SELF_SERVICE_PLANS as readonly string[]).includes(d.productKey)) return null;
    return { plan: d.productKey, interval: d.interval === "year" ? "year" : "month" };
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
    if (v.change) return this.withOrder(v.order.id, () => this.applyPlanChange(v.order, sub, v.change!, v.link.tenantId, hint));
    const r = await this.withOrder(v.order.id, () => this.applySubscription(v.order, sub, v.link.tenantId, hint));
    await this.settleChanges(sub);
    return r;
  }

  /**
   * Cambio de plan hecho en el Customer Portal → pedido de cambio con los contratos existentes. Una subida
   * espera el cobro del prorrateo: si la última factura ya está pagada se anota en el pedido de cambio (no en
   * el anterior) y lo confirma. Después, el estado de cobro se aplica al pedido que quede vigente.
   */
  private async applyPlanChange(cur: CommercialOrder, sub: GwSubscription, change: { plan: string; interval: "month" | "year" }, tenantId: string | null, hint?: GwInvoice): Promise<Outcome> {
    const r = await this.d.orchestrator.applyExternalPlanChange!(cur.id, change, `stripe-portal:${sub.id}`, this.actor);
    if (r.error) throw new Error(`Cambio de plan pendiente: ${r.error}`);
    let target = r.order;
    if (PIPELINE.includes(target.state)) {
      const pay = await this.recordPaidInvoice(target, sub, hint);
      if (pay) {
        const a = await this.d.orchestrator.advance(target.id, this.actor);
        if (a.error) throw new Error(`Cambio de plan pendiente: ${a.error}`);
        target = a.order;
      }
    }
    if (r.created) opsLog("info", "StripeEvents", "plan_change", { from: cur.id, to: target.id, plan: change.plan, interval: change.interval, state: target.state });
    const vigente = LIVE_OR_SCHEDULED.includes(target.state) ? target : cur;
    const applied = await this.applySubscription(vigente, sub, tenantId, hint);
    return { outcome: applied.outcome, detail: `Cambio a ${change.plan}/${change.interval}: pedido ${target.id} en ${target.state}; ${applied.detail ?? ""}`.slice(0, 300) };
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
      if (LIVE_OR_SCHEDULED.includes(r.order.state)) await this.attachDeferred(r.order, sub);
      return { outcome: "processed", detail: `Pedido ${r.order.state}` };
    }
    if (!LIVE_OR_SCHEDULED.includes(order.state)) return { outcome: "processed", detail: `Pedido en ${order.state}: sin cambios` };
    // Recién añadidas o pendientes de añadir, la copia leída aún no las tiene: no es un descuadre
    const deferred = await this.attachDeferred(order, sub);
    if (deferred !== "attached" && deferred !== "pending") await this.checkItems(order, sub);
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
    // Stripe Tax sobre precios sin IVA (el impuesto se suma después del subtotal). Con un plan anual y partidas
    // mensuales, el primer periodo es lo anual + el primer mes de lo mensual (no el coste anualizado)
    if (purpose === "initial" && order.quote && (inv.subtotal ?? inv.amountPaid) !== (order.quote.firstPeriodNetCents ?? order.quote.contractAmountCents)) throw new StripeMismatchError("El importe facturado no es el del presupuesto (sin IVA)");
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
      await this.checkBuyer(order.id, inv, purpose);
    }
    // Siempre (idempotente): si un intento anterior se cortó tras guardar el pago, el reintento lo completa
    await this.recordInvoice(order.id, inv, purpose);
    return { created: r.created, purpose, invoiceId: inv.id, paymentId: r.payment.id };
  }

  /**
   * Registro de la factura cobrada y su documento fiscal pendiente (0016). Sin la migración se avisa y se
   * sigue: el cobro y la activación nunca dependen del registro documental.
   */
  private async recordInvoice(orderId: number, inv: GwInvoice, purpose: InvoicePurpose, refundedCents = 0): Promise<FiscalDocument | null> {
    try {
      const profile = await this.d.store.buyerProfile(orderId).catch(() => null);
      const rec = invoiceRecordOf(inv, { orderId, purpose, buyerScenario: profile?.scenario ?? null, now: this.now(), refundedCents });
      await this.d.store.upsertInvoiceRecord(rec);
      if (this.d.invoiceLines && inv.lines?.length) await this.d.invoiceLines.upsertLines(await linesOf(inv.id, orderId, inv.lines, this.priceResolver()), this.now());
      const { created, document } = await this.d.store.enqueueFiscalDocument(invoiceDocumentOf(rec, this.now()));
      if (created) {
        opsLog("info", "StripeEvents", "fiscal_document_queued", { orderId, kind: "invoice", documentId: document.id, invoiceId: inv.id });
        await this.submitFiscal(document);
      }
      return document;
    } catch (e) {
      if ((e as { code?: string })?.code === "ER_NO_SUCH_TABLE") {
        opsLog("warn", "StripeEvents", "fiscal_registry_missing", { orderId, invoiceId: inv.id });
        return null;
      }
      throw e;
    }
  }

  /** Reembolso: rectificativa por lo reembolsado desde la última lectura (idempotente por cargo y total). */
  private async recordRefund(orderId: number, inv: GwInvoice, c: GwCharge, previousRefunded: number) {
    try {
      // La factura original debe tener su documento (también si es anterior a este registro)
      const purpose: InvoicePurpose = inv.billingReason === "subscription_cycle" ? "renewal" : inv.billingReason === "subscription_update" ? "change" : "initial";
      const original = (await this.d.store.fiscalDocumentBySource(invoiceSourceKey(inv.id))) ?? (await this.recordInvoice(orderId, inv, purpose));
      if (!original) return;
      const draft = rectificationOf(original, { chargeId: c.id, refundedTotalCents: c.amountRefunded, previousRefundedCents: previousRefunded, now: this.now() });
      await this.d.store.setInvoiceRefunded(inv.id, c.amountRefunded, this.now());
      await this.allocateLines(orderId, inv.id, c.amountRefunded);
      if (!draft) return;
      const { created, document } = await this.d.store.enqueueFiscalDocument(draft);
      if (created) {
        opsLog("info", "StripeEvents", "fiscal_document_queued", { orderId, kind: "rectification", documentId: document.id, originalDocumentId: original.id, totalCents: document.totalCents });
        await this.submitFiscal(document);
      }
    } catch (e) {
      if ((e as { code?: string })?.code === "ER_NO_SUCH_TABLE") return void opsLog("warn", "StripeEvents", "fiscal_registry_missing", { orderId, chargeId: c.id });
      throw e;
    }
  }

  /** Price de Stripe → precio aprobado y producto (catálogo enlazado). */
  private priceResolver(): PriceResolver {
    let links: Promise<Array<{ stripePriceId: string; webPriceId: number }>> | null = null;
    return async (stripePriceId) => {
      links ??= this.d.store.listPrices();
      const l = (await links).find((x) => x.stripePriceId === stripePriceId);
      if (!l) return null;
      const p = this.d.catalog ? await this.d.catalog.price(l.webPriceId).catch(() => null) : null;
      return { webPriceId: l.webPriceId, productKey: p?.productKey ?? null };
    };
  }

  /**
   * Reparte entre las líneas lo reembolsado que aún no está asignado (total del cargo − ya asignado): repetirlo no
   * asigna dos veces y un intento cortado se completa en el siguiente.
   */
  private async allocateLines(orderId: number, invoiceId: string, refundedTotal: number) {
    if (!this.d.invoiceLines) return;
    const lines = await this.d.invoiceLines.linesOf(invoiceId);
    if (!lines.length) return;
    const pending = refundedTotal - lines.reduce((a, l) => a + l.refundedCents, 0);
    if (pending <= 0) return;
    const { allocation, unallocated } = allocateRefund(lines, pending);
    await this.d.invoiceLines.addRefunded(allocation, this.now());
    if (unallocated > 0) {
      opsLog("warn", "StripeEvents", "refund_unallocated", { orderId, invoiceId, unallocated });
      recordFailure("stripe.refund_unallocated");
    }
  }

  /** Partidas mensuales pendientes del alta (plan anual). Un fallo no detiene el evento: la conciliación lo reintenta. */
  private async attachDeferred(order: CommercialOrder, sub: GwSubscription): Promise<string> {
    if (!this.d.deferredItems || sub.pendingUpdate) return "none";
    return this.d.deferredItems(order, sub).catch((e) => {
      opsLog("warn", "StripeEvents", "deferred_items_failed", { orderId: order.id, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.deferred_items_pending");
      return "pending";
    });
  }

  /** Avisa si las partidas de Stripe no son las contratadas para el próximo periodo (no corrige nada). */
  private async checkItems(order: CommercialOrder, sub: GwSubscription) {
    if (!this.d.contractedItems || !sub.items?.length || sub.pendingUpdate || !LIVE_OR_SCHEDULED.includes(order.state)) return;
    const contracted = await this.d.contractedItems(order).catch(() => null);
    if (!contracted) return;
    const drift = await itemsDrift(sub.items, contracted, this.priceResolver());
    if (!drift.differences.length && !drift.unknownPrices.length) return;
    opsLog("warn", "StripeEvents", "items_drift", { orderId: order.id, subscriptionId: sub.id, differences: drift.differences, unknownPrices: drift.unknownPrices.length });
    recordFailure("stripe.items_drift");
  }

  /** Entrega al sistema de facturación legal aprobado (por defecto ninguno: queda pendiente). */
  private async submitFiscal(doc: FiscalDocument) {
    const sink = this.d.fiscalSink ?? pendingSink;
    if (sink === pendingSink) return;
    const r = await sink.submit(doc).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.name : "error" }));
    if (r.status === "issued") await this.d.store.markFiscalDocumentIssued(doc.id, r.externalRef, `sink:${sink.name}`, this.now());
    else if (r.status === "failed") {
      opsLog("warn", "StripeEvents", "fiscal_document_failed", { documentId: doc.id, sink: sink.name, error: r.error.slice(0, 120) });
      recordFailure("stripe.fiscal_document_failed");
    }
  }

  /**
   * Primer cobro: la dirección y los identificadores fiscales de la factura (los que usó Stripe Tax) deben
   * casar con el perfil fiscal declarado. Checkout permite cambiar la dirección, así que una discrepancia es
   * posible: se AVISA (el pago ya está cobrado; qué hacer es una decisión del equipo, no de este proceso).
   */
  private async checkBuyer(orderId: number, inv: GwInvoice, purpose: "initial" | "renewal" | "change") {
    const profile = await this.d.store.buyerProfile(orderId).catch(() => null);
    if (!profile) return;
    // Cada factura cobrada: el impuesto de Stripe frente al tratamiento declarado para el escenario
    const expected = this.d.taxExpectations?.get(profile.scenario);
    const taxProblem = expected ? checkInvoiceTax(expected, inv.taxCents) : null;
    if (taxProblem) {
      opsLog("warn", "StripeEvents", "invoice_tax_mismatch", { orderId, invoiceId: inv.id, scenario: profile.scenario, expected, problem: taxProblem, purpose });
      recordFailure("stripe.invoice_tax_mismatch");
    }
    // Inversión del sujeto pasivo: en cada renovación, el NIF-IVA debe seguir siendo válido en VIES. Se reutiliza una
    // comprobación reciente; si caducó, se repite. Un NIF-IVA que deja de ser válido se AVISA (no se cambia nada solo)
    if (purpose !== "initial" && expected === "reverse_charge" && profile.taxId && this.d.vat) {
      const v = await this.d.vat.verify(profile.country, profile.taxId, { orderId }).catch(() => null);
      if (v?.status === "invalid") {
        opsLog("warn", "StripeEvents", "vat_no_longer_valid", { orderId, invoiceId: inv.id, country: profile.country });
        recordFailure("stripe.vat_no_longer_valid");
      } else if (!v || v.status === "unavailable") opsLog("warn", "StripeEvents", "vat_revalidation_unavailable", { orderId, invoiceId: inv.id });
    }
    // Dirección e identificador fiscal: solo en el alta (después pueden cambiar por el Portal y se revisan aparte)
    if (purpose !== "initial") return;
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
