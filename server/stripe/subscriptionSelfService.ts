/**
 * Autoservicio de la suscripción cobrada en Stripe desde el panel de la empresa: programar o deshacer la baja y
 * cambiar de plan o de periodicidad. Lo pide el Core en nombre de la persona autorizada (el rol lo comprueba el
 * Core) con el token de comercio (`commerce:purchase`); el tenant es el de la SESIÓN, nunca del navegador.
 *
 *   GET  /commerce/tenants/:t/cancellation          estado de la baja (y si se puede programar o deshacer)
 *   POST /commerce/tenants/:t/cancellation          programa el fin al final del periodo pagado (idempotente)
 *   POST /commerce/tenants/:t/cancellation/undo     deshace la baja mientras no haya terminado (idempotente)
 *   GET  /commerce/tenants/:t/plan-change           plan vigente y destinos posibles
 *   POST /commerce/tenants/:t/plan-change/preview   importe prorrateado calculado por Stripe (no cambia nada)
 *   POST /commerce/tenants/:t/plan-change           subida inmediata con cobro del prorrateo; bajada: solicitud registrada
 *
 * Reglas:
 *  - Interruptores apagados por defecto: CP_SELF_SERVICE_CANCEL_ENABLED=1 y CP_SELF_SERVICE_PLAN_CHANGE_ENABLED=1.
 *    Apagados: 503 sin tocar nada.
 *  - Aquí NUNCA se cambia un pedido, un contrato ni una licencia: solo se pide el cambio a Stripe. El reflejo en
 *    Elephant llega por el circuito de siempre (webhook → procesador de eventos): baja → `cancel_scheduled`,
 *    deshacer → `reactivate`, cambio de precio → pedido `change` (applyExternalPlanChange) confirmado por el
 *    cobro verificado del prorrateo. Nunca se borran datos.
 *  - Solo suscripciones de la empresa cobradas en Stripe (cliente enlazado y una única suscripción suya). Las de
 *    servicios externos (`metadata.es_external_id`) no se tocan nunca.
 *  - Cambio de plan: solo a planes «available» del catálogo publicado (misma regla que el autoservicio) y solo con
 *    la suscripción de una sola partida (el plan, sin módulos ni ampliaciones). Subida (plan superior o periodicidad
 *    más larga): ya, con prorrateo `always_invoice` y `pending_if_incomplete` (nada cambia si no se cobra). Bajada:
 *    programarla a fin de periodo exige Subscription Schedules, que el conector no implementa: se registra como
 *    solicitud (tarea en el CRM) para aplicarla al fin del periodo pagado; no cambia nada en Stripe.
 */
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CrmStore } from "../crm/store";
import type { CommercialOrder } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import { SELF_SERVICE_PLANS, type SelfServicePlan } from "./catalog";
import { StripeGatewayError, type GwSubscription, type StripeGateway } from "./gateway";
import { supportsPendingUpdate } from "./multipart";
import type { StripeStore } from "./store";

export type SelfServiceSubscriptionErrorCode = "disabled" | "not_found" | "invalid_input" | "invalid_state" | "unavailable" | "conflict" | "async_payment_method";
export class SelfServiceSubscriptionError extends Error {
  constructor(
    public readonly code: SelfServiceSubscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SelfServiceSubscriptionError";
  }
}

/** Interruptores (leídos en cada petición). */
export interface SelfServiceSubscriptionFlags {
  cancel: boolean;
  planChange: boolean;
}

export interface SelfServiceSubscriptionDeps {
  flags: SelfServiceSubscriptionFlags;
  namespace: string;
  crmStore: Pick<CrmStore, "list">;
  orders: { list(f: { companyId: number }): Promise<CommercialOrder[]> };
  stripeStore: Pick<StripeStore, "customerByCompany" | "subscriptionsOfCompany" | "priceForWebPrice">;
  gateway: StripeGateway;
  catalog: CatalogPort;
  /** Nota en la ficha de la empresa del CRM (motivo de la baja, deshacer, cambio pedido). */
  note?: (companyId: number, summary: string, actor: string) => Promise<void>;
  /** Tarea en la ficha de la empresa del CRM (bajada de plan a aplicar al fin de periodo). */
  task?: (companyId: number, summary: string, dueAt: number, actor: string) => Promise<void>;
  /** Tareas pendientes de la empresa (para no duplicar la solicitud de bajada). */
  openTasks?: (companyId: number) => Promise<string[]>;
  now?: () => number;
}

export interface CancellationView {
  enabled: boolean;
  /** ¿Se cobra en Stripe y se puede gestionar desde el panel? */
  available: boolean;
  /** Motivo por el que no está disponible (para mostrarlo tal cual). */
  message: string | null;
  scheduled: boolean;
  /** Fin del servicio programado (ms) o null. */
  cancelAt: number | null;
  /** Fin del periodo pagado (ms). */
  periodEnd: number | null;
  canCancel: boolean;
  canUndo: boolean;
}

export interface CancellationResult {
  status: "scheduled" | "active";
  cancelAt: number | null;
  periodEnd: number | null;
  /** false: ya estaba así (repetición); no se ha llamado a Stripe. */
  created: boolean;
}

type Interval = "month" | "year";
export interface PlanOption {
  plan: SelfServicePlan;
  interval: Interval;
  direction: "upgrade" | "downgrade";
  /** Importe recurrente del destino (sin impuestos) por periodo. */
  recurringCents: number;
  currency: string;
}
export interface PlanChangeView {
  enabled: boolean;
  available: boolean;
  message: string | null;
  current: { plan: string; interval: Interval } | null;
  periodEnd: number | null;
  options: PlanOption[];
}
export interface PlanChangePreview {
  current: { plan: string; interval: Interval };
  target: { plan: SelfServicePlan; interval: Interval };
  direction: "upgrade" | "downgrade";
  currency: string;
  /** Subida: prorrateo a pagar ahora (con impuestos si Stripe los calcula). Bajada: 0. */
  amountDueCents: number;
  subtotalCents: number;
  taxCents: number | null;
  recurringCents: number;
  /** Desde cuándo: ahora (subida) o el fin del periodo pagado (bajada). ms. */
  effectiveAt: number | null;
}
export interface PlanChangeResult {
  /** applied: Stripe ya lo aplicó (el plan se refleja al confirmarse el cobro); requested: bajada registrada. */
  status: "applied" | "payment_pending" | "failed" | "requested";
  paymentUrl: string | null;
  amountDueCents: number | null;
  effectiveAt: number | null;
  created: boolean;
}

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const PLAN_RANK: Record<string, number> = { essential: 1, business: 2 };
const INTERVAL_RANK: Record<Interval, number> = { month: 1, year: 2 };
const PLAN_NAME: Record<string, string> = { essential: "Essential", business: "Business" };
const LIVE: CommercialOrder["state"][] = ["active", "past_due", "suspended", "cancel_scheduled"];
const ms = (s: number | null | undefined) => (s === null || s === undefined ? null : s * 1000);
const label = (p: { plan: string; interval: Interval }) => `${PLAN_NAME[p.plan] ?? p.plan} ${p.interval === "year" ? "anual" : "mensual"}`;

export class SubscriptionSelfService {
  private now: () => number;
  constructor(private d: SelfServiceSubscriptionDeps) {
    this.now = d.now ?? Date.now;
  }

  get status() {
    return { cancel: this.d.flags.cancel, planChange: this.d.flags.planChange };
  }

  /**
   * Empresa del tenant, su pedido vigente y su suscripción de Stripe releída. Lanza un error claro si la
   * suscripción no se cobra en Stripe o no se puede gestionar desde el panel.
   */
  private async context(tenantId: string) {
    if (!TENANT_RE.test(tenantId)) throw new SelfServiceSubscriptionError("invalid_input", "Empresa no válida");
    const company = (await this.d.crmStore.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number; tenantId?: string | null } | undefined;
    if (!company || company.tenantId !== tenantId) throw new SelfServiceSubscriptionError("not_found", "Empresa no encontrada");
    const link = await this.d.stripeStore.customerByCompany(company.id);
    if (!link) throw new SelfServiceSubscriptionError("unavailable", "Tu suscripción no se cobra en línea: los cambios y la baja se gestionan con tu contacto comercial");
    const subs = await this.d.stripeStore.subscriptionsOfCompany(company.id);
    if (subs.length !== 1) throw new SelfServiceSubscriptionError("unavailable", subs.length ? "Hay más de una suscripción en el sistema de cobros: lo revisa nuestro equipo" : "Tu suscripción no se cobra en línea: los cambios y la baja se gestionan con tu contacto comercial");
    const sub = await this.d.gateway.subscription(subs[0]);
    if (!sub || sub.customerId !== link.stripeCustomerId) throw new SelfServiceSubscriptionError("unavailable", "La suscripción del sistema de cobros no corresponde a tu empresa: lo revisa nuestro equipo");
    // Servicios de clientes externos: circuito propio, nunca desde aquí
    if (sub.metadata.es_external_id) throw new SelfServiceSubscriptionError("unavailable", "Esta suscripción no se gestiona desde el panel");
    const orders = await this.d.orders.list({ companyId: company.id });
    const current = orders.filter((o) => LIVE.includes(o.state) && o.tenantId === tenantId).sort((a, b) => b.id - a.id)[0];
    if (!current) throw new SelfServiceSubscriptionError("invalid_state", "Tu empresa no tiene una suscripción vigente");
    return { company, current, sub };
  }

  private assertCancel() {
    if (!this.d.flags.cancel) throw new SelfServiceSubscriptionError("disabled", "La baja desde el panel no está disponible todavía: escríbenos y la gestionamos");
  }
  private assertPlanChange() {
    if (!this.d.flags.planChange) throw new SelfServiceSubscriptionError("disabled", "El cambio de plan desde el panel no está disponible todavía: escríbenos y lo gestionamos");
  }

  // ── Baja y reactivación ────────────────────────────────────────────────────

  async cancellationStatus(tenantId: string): Promise<CancellationView> {
    const off: CancellationView = { enabled: false, available: false, message: null, scheduled: false, cancelAt: null, periodEnd: null, canCancel: false, canUndo: false };
    if (!this.d.flags.cancel) return off;
    try {
      const { sub } = await this.context(tenantId);
      const scheduled = sub.cancelAtPeriodEnd || sub.cancelAt !== null;
      const live = sub.status === "active" || sub.status === "past_due";
      return {
        enabled: true,
        available: true,
        message: null,
        scheduled,
        cancelAt: ms(sub.cancelAt ?? (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null)),
        periodEnd: ms(sub.currentPeriodEnd),
        canCancel: live && !scheduled && !sub.pendingUpdate,
        // Solo la baja «al final del periodo» se deshace desde aquí (una fecha concreta la puso el equipo)
        canUndo: live && sub.cancelAtPeriodEnd,
      };
    } catch (e) {
      if (e instanceof SelfServiceSubscriptionError && e.code !== "invalid_input") return { ...off, enabled: true, message: e.message };
      throw e;
    }
  }

  /** Programa el fin al final del periodo pagado. Repetirla no vuelve a llamar a Stripe. */
  async cancel(tenantId: string, input: { reason?: string }, opts: { idempotencyKey: string; actor: string }): Promise<CancellationResult> {
    this.assertCancel();
    if (!KEY_RE.test(opts.idempotencyKey ?? "")) throw new SelfServiceSubscriptionError("invalid_input", "Clave de idempotencia no válida");
    const { company, sub } = await this.context(tenantId);
    if (sub.cancelAtPeriodEnd || sub.cancelAt !== null) return this.cancellationResult(sub, false);
    if (sub.status !== "active" && sub.status !== "past_due") throw new SelfServiceSubscriptionError("invalid_state", `La suscripción está en «${sub.status}»: no se puede programar la baja`);
    if (sub.pendingUpdate) throw new SelfServiceSubscriptionError("conflict", "Hay un cambio pendiente de pago: complétalo o espera a que caduque antes de programar la baja");
    const gw = this.gatewayCancel();
    const after = await gw(sub.id, true, `es-${this.d.namespace}-cancel-${sub.id}-${opts.idempotencyKey}`);
    const reason = (input.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
    opsLog("info", "SelfServiceSubscription", "cancel_scheduled", { tenantId, subscriptionId: sub.id });
    await this.d.note?.(company.id, `Baja programada desde el panel al final del periodo pagado${after.currentPeriodEnd ? ` (${new Date(after.currentPeriodEnd * 1000).toISOString().slice(0, 10)})` : ""}. Motivo: ${reason || "no indicado"}`, opts.actor).catch(() => undefined);
    return this.cancellationResult(after, true);
  }

  /** Deshace la baja programada mientras no haya terminado. Repetirla no vuelve a llamar a Stripe. */
  async undoCancel(tenantId: string, opts: { idempotencyKey: string; actor: string }): Promise<CancellationResult> {
    this.assertCancel();
    if (!KEY_RE.test(opts.idempotencyKey ?? "")) throw new SelfServiceSubscriptionError("invalid_input", "Clave de idempotencia no válida");
    const { company, sub } = await this.context(tenantId);
    if (sub.status === "canceled" || sub.status === "incomplete_expired") throw new SelfServiceSubscriptionError("invalid_state", "La suscripción ya terminó: para volver, contrata de nuevo");
    if (!sub.cancelAtPeriodEnd && sub.cancelAt === null) return this.cancellationResult(sub, false);
    if (!sub.cancelAtPeriodEnd) throw new SelfServiceSubscriptionError("invalid_state", "La fecha de fin la fijó nuestro equipo: escríbenos para mantener la suscripción");
    const gw = this.gatewayCancel();
    const after = await gw(sub.id, false, `es-${this.d.namespace}-undo-${sub.id}-${opts.idempotencyKey}`);
    opsLog("info", "SelfServiceSubscription", "cancel_undone", { tenantId, subscriptionId: sub.id });
    await this.d.note?.(company.id, "Baja deshecha desde el panel: la suscripción continúa", opts.actor).catch(() => undefined);
    return this.cancellationResult(after, true);
  }

  private gatewayCancel() {
    const fn = this.d.gateway.setCancelAtPeriodEnd;
    if (!fn) throw new SelfServiceSubscriptionError("unavailable", "La baja desde el panel no está disponible");
    return (id: string, cancel: boolean, key: string) => fn.call(this.d.gateway, id, cancel, key);
  }

  private cancellationResult(sub: GwSubscription, created: boolean): CancellationResult {
    const scheduled = sub.cancelAtPeriodEnd || sub.cancelAt !== null;
    return { status: scheduled ? "scheduled" : "active", cancelAt: scheduled ? ms(sub.cancelAt ?? sub.currentPeriodEnd) : null, periodEnd: ms(sub.currentPeriodEnd), created };
  }

  // ── Cambio de plan ─────────────────────────────────────────────────────────

  /** Precio de Stripe enlazado de un plan «available» del catálogo publicado (o null). */
  private async planPrice(plan: string, interval: Interval) {
    if (!(SELF_SERVICE_PLANS as readonly string[]).includes(plan)) return null;
    const offer = await this.d.catalog.offer();
    const product = offer.find((p) => p.key === plan);
    if (!product || product.commercialStatus !== "available" || product.internalOnly) return null;
    const price = product.prices.find((p) => p.kind === (interval === "year" ? "yearly" : "monthly") && p.status === "approved" && p.currency.toUpperCase() === "EUR");
    const link = price ? await this.d.stripeStore.priceForWebPrice(price.id) : null;
    if (!price || !link || link.status !== "active") return null;
    return { stripePriceId: link.stripePriceId, amountCents: price.amountCents, currency: price.currency.toUpperCase() };
  }

  /** Contexto del cambio de plan: suscripción activa, de una sola partida (el plan vigente), sin cambios pendientes. */
  private async planContext(tenantId: string) {
    const ctx = await this.context(tenantId);
    const { current, sub } = ctx;
    if (current.state !== "active") throw new SelfServiceSubscriptionError("invalid_state", current.state === "cancel_scheduled" ? "La suscripción tiene la baja programada: deshazla antes de cambiar de plan" : "Regulariza el cobro pendiente antes de cambiar de plan");
    if (sub.status !== "active") throw new SelfServiceSubscriptionError("invalid_state", `La suscripción del sistema de cobros está en «${sub.status}»`);
    if (sub.cancelAtPeriodEnd || sub.cancelAt !== null) throw new SelfServiceSubscriptionError("invalid_state", "La suscripción tiene la baja programada: deshazla antes de cambiar de plan");
    if (!(SELF_SERVICE_PLANS as readonly string[]).includes(current.request.plan)) throw new SelfServiceSubscriptionError("unavailable", "Tu plan se gestiona con tu contacto comercial");
    const items = sub.items ?? sub.priceIds.map((p) => ({ id: "", priceId: p, quantity: 1 }));
    if (items.length !== 1 || !items[0].id || items[0].quantity !== 1 || current.request.items.length) throw new SelfServiceSubscriptionError("unavailable", "Con módulos o ampliaciones contratados, el cambio de plan lo gestiona tu contacto comercial");
    const own = await this.planPrice(current.request.plan, current.request.interval);
    if (own && own.stripePriceId !== items[0].priceId) throw new SelfServiceSubscriptionError("conflict", "El precio del sistema de cobros no coincide con tu plan: lo revisa nuestro equipo");
    return { ...ctx, item: items[0] };
  }

  private direction(from: { plan: string; interval: Interval }, to: { plan: string; interval: Interval }): "upgrade" | "downgrade" | null {
    if (from.plan === to.plan && from.interval === to.interval) return null;
    const dp = (PLAN_RANK[to.plan] ?? 0) - (PLAN_RANK[from.plan] ?? 0);
    const di = INTERVAL_RANK[to.interval] - INTERVAL_RANK[from.interval];
    return dp >= 0 && di >= 0 ? "upgrade" : "downgrade";
  }

  async planChangeStatus(tenantId: string): Promise<PlanChangeView> {
    const off: PlanChangeView = { enabled: false, available: false, message: null, current: null, periodEnd: null, options: [] };
    if (!this.d.flags.planChange) return off;
    try {
      const { current, sub } = await this.planContext(tenantId);
      const cur = { plan: current.request.plan, interval: current.request.interval };
      const options: PlanOption[] = [];
      for (const plan of SELF_SERVICE_PLANS)
        for (const interval of ["month", "year"] as const) {
          const direction = this.direction(cur, { plan, interval });
          const price = direction ? await this.planPrice(plan, interval) : null;
          if (direction && price) options.push({ plan, interval, direction, recurringCents: price.amountCents, currency: price.currency });
        }
      return { enabled: true, available: true, message: null, current: cur, periodEnd: ms(sub.currentPeriodEnd), options };
    } catch (e) {
      if (e instanceof SelfServiceSubscriptionError && e.code !== "invalid_input") return { ...off, enabled: true, message: e.message };
      throw e;
    }
  }

  private async target(tenantId: string, input: { plan: string; interval: Interval }) {
    const ctx = await this.planContext(tenantId);
    const cur = { plan: ctx.current.request.plan, interval: ctx.current.request.interval };
    const direction = this.direction(cur, input);
    if (!direction) throw new SelfServiceSubscriptionError("invalid_input", "Ya tienes ese plan");
    const price = await this.planPrice(input.plan, input.interval);
    if (!price) throw new SelfServiceSubscriptionError("unavailable", `${label(input)} no se contrata en línea: escríbenos y te ayudamos`);
    return { ...ctx, cur, direction, price };
  }

  /** Importe del cambio: el prorrateo real lo calcula Stripe (subida); una bajada no cobra ni abona nada. */
  async previewPlanChange(tenantId: string, input: { plan: SelfServicePlan; interval: Interval }): Promise<PlanChangePreview> {
    this.assertPlanChange();
    const t = await this.target(tenantId, input);
    const base = { current: t.cur, target: { plan: input.plan, interval: input.interval }, direction: t.direction, recurringCents: t.price.amountCents };
    if (t.direction === "downgrade") return { ...base, currency: t.price.currency, amountDueCents: 0, subtotalCents: 0, taxCents: null, effectiveAt: ms(t.sub.currentPeriodEnd) };
    const inv = await this.d.gateway.previewSubscriptionChange({ subscriptionId: t.sub.id, items: [{ id: t.item.id, priceId: t.price.stripePriceId }], prorationBehavior: "always_invoice" });
    return { ...base, currency: inv.currency, amountDueCents: inv.amountDue, subtotalCents: inv.subtotal, taxCents: inv.taxCents, effectiveAt: this.now() };
  }

  /**
   * Cambio de plan. Subida: Stripe cambia el precio SOLO si cobra el prorrateo; el pedido de cambio y las licencias
   * llegan por el webhook. Bajada: solicitud registrada en el CRM para el fin del periodo pagado (sin tocar Stripe).
   * Idempotente: repetirla con el cambio ya hecho no vuelve a llamar a Stripe.
   */
  async changePlan(tenantId: string, input: { plan: SelfServicePlan; interval: Interval }, opts: { idempotencyKey: string; actor: string }): Promise<PlanChangeResult> {
    this.assertPlanChange();
    if (!KEY_RE.test(opts.idempotencyKey ?? "")) throw new SelfServiceSubscriptionError("invalid_input", "Clave de idempotencia no válida");
    // Repetición de una subida ya aplicada en Stripe (el pedido puede no reflejarlo todavía)
    const { sub: live } = await this.context(tenantId);
    const wanted = await this.planPrice(input.plan, input.interval);
    if (wanted && live.status === "active" && live.items?.length === 1 && live.items[0].priceId === wanted.stripePriceId && !live.pendingUpdate) {
      return { status: "applied", paymentUrl: null, amountDueCents: null, effectiveAt: null, created: false };
    }
    if (live.pendingUpdate) throw new SelfServiceSubscriptionError("conflict", "Hay un cambio pendiente de pago: complétalo con el enlace de pago o espera a que caduque");
    const t = await this.target(tenantId, input);
    if (t.direction === "downgrade") {
      const effectiveAt = ms(t.sub.currentPeriodEnd);
      const summary = `Bajada de plan solicitada desde el panel: de ${label(t.cur)} a ${label(input)}, a aplicar al fin del periodo pagado${effectiveAt ? ` (${new Date(effectiveAt).toISOString().slice(0, 10)})` : ""}`;
      if (!this.d.task) throw new SelfServiceSubscriptionError("unavailable", "La bajada de plan la gestiona tu contacto comercial: escríbenos");
      const open = this.d.openTasks ? await this.d.openTasks(t.company.id) : [];
      if (open.includes(summary)) return { status: "requested", paymentUrl: null, amountDueCents: 0, effectiveAt, created: false };
      const due = Math.max(this.now() + 86_400_000, (effectiveAt ?? this.now()) - 3 * 86_400_000);
      await this.d.task(t.company.id, summary, due, opts.actor);
      opsLog("info", "SelfServiceSubscription", "downgrade_requested", { tenantId, plan: input.plan, interval: input.interval });
      return { status: "requested", paymentUrl: null, amountDueCents: 0, effectiveAt, created: true };
    }
    const type = await this.d.gateway.paymentMethodTypeOf(t.sub.id);
    if (!supportsPendingUpdate(type))
      throw new SelfServiceSubscriptionError("async_payment_method", type ? "Tu método de pago (adeudo bancario) no permite cambiar de plan en línea: añade una tarjeta o escríbenos" : "No hay método de pago: añade una tarjeta en el portal de facturación");
    let r: Awaited<ReturnType<StripeGateway["updateSubscriptionItems"]>>;
    try {
      r = await this.d.gateway.updateSubscriptionItems(
        { subscriptionId: t.sub.id, items: [{ id: t.item.id, priceId: t.price.stripePriceId }], prorationBehavior: "always_invoice", paymentBehavior: "pending_if_incomplete" },
        `es-${this.d.namespace}-plan-${t.sub.id}-${opts.idempotencyKey}`,
      );
    } catch (e) {
      if (e instanceof StripeGatewayError && !e.retryable) {
        opsLog("warn", "SelfServiceSubscription", "plan_change_rejected", { tenantId, code: e.code });
        return { status: "failed", paymentUrl: null, amountDueCents: null, effectiveAt: null, created: true };
      }
      throw e;
    }
    await this.d.note?.(t.company.id, `Cambio de plan pedido desde el panel: de ${label(t.cur)} a ${label(input)}`, opts.actor).catch(() => undefined);
    const inv = r.invoice;
    const amountDueCents = inv ? (inv.total ?? inv.subtotal ?? null) : 0;
    if (r.subscription.pendingUpdate) {
      opsLog("info", "SelfServiceSubscription", "plan_change_payment_pending", { tenantId });
      return { status: "payment_pending", paymentUrl: inv?.hostedInvoiceUrl ?? null, amountDueCents, effectiveAt: null, created: true };
    }
    opsLog("info", "SelfServiceSubscription", "plan_change_applied", { tenantId, plan: input.plan, interval: input.interval });
    return { status: "applied", paymentUrl: null, amountDueCents, effectiveAt: this.now(), created: true };
  }
}

// ── Rutas ─────────────────────────────────────────────────────────────────────

const STATUS: Record<SelfServiceSubscriptionErrorCode, number> = { disabled: 503, not_found: 404, invalid_input: 400, invalid_state: 409, unavailable: 409, conflict: 409, async_payment_method: 409 };
const tenant = z.string().regex(TENANT_RE);
/** Usuario del Core que lo pide (solo auditoría: el permiso lo comprueba el Core). */
const user = z.string().regex(/^[A-Za-z0-9:_.@-]{1,80}$/);
const planBody = z.object({ plan: z.enum(SELF_SERVICE_PLANS), interval: z.enum(["month", "year"]) }).strict();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch((e) => {
      if (e instanceof SelfServiceSubscriptionError) return void res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Parámetros no válidos" });
      if (e instanceof StripeGatewayError) {
        opsLog("warn", "SelfServiceSubscription", "gateway_error", { code: e.code, retryable: e.retryable });
        recordFailure("stripe.gateway_error");
        return void res.status(e.retryable ? 503 : 502).json({ error: "stripe_error", code: e.code, retryable: e.retryable, message: "El sistema de cobros no responde. Inténtalo de nuevo en unos minutos." });
      }
      opsLog("error", "SelfServiceSubscription", "internal_error", { method: req.method, error: e instanceof Error ? e.name : "error" });
      recordFailure("stripe.failed");
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  };

export function createSubscriptionSelfServiceRouter(svc: SubscriptionSelfService): Router {
  const r = express.Router();
  const actor = (req: Request, who: string) => `${getAuth(req)!.actor.type}:${getAuth(req)!.actor.id}/${who}`.slice(0, 100);
  r.get("/self-service/status", requireScope("commerce:purchase"), (_req, res) => void res.json(svc.status));
  r.get("/tenants/:tenantId/cancellation", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.json({ cancellation: await svc.cancellationStatus(tenant.parse(req.params.tenantId)) });
  }));
  r.post("/tenants/:tenantId/cancellation", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const b = z.object({ idempotencyKey: z.string(), user, reason: z.string().max(500).optional() }).strict().parse(req.body ?? {});
    const result = await svc.cancel(t, { reason: b.reason }, { idempotencyKey: b.idempotencyKey, actor: actor(req, b.user) });
    res.status(result.created ? 201 : 200).json({ cancellation: result });
  }));
  r.post("/tenants/:tenantId/cancellation/undo", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const b = z.object({ idempotencyKey: z.string(), user }).strict().parse(req.body ?? {});
    const result = await svc.undoCancel(t, { idempotencyKey: b.idempotencyKey, actor: actor(req, b.user) });
    res.status(result.created ? 201 : 200).json({ cancellation: result });
  }));
  r.get("/tenants/:tenantId/plan-change", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.json({ planChange: await svc.planChangeStatus(tenant.parse(req.params.tenantId)) });
  }));
  r.post("/tenants/:tenantId/plan-change/preview", requireScope("commerce:purchase"), wrap(async (req, res) => {
    res.json({ preview: await svc.previewPlanChange(tenant.parse(req.params.tenantId), planBody.parse(req.body ?? {})) });
  }));
  r.post("/tenants/:tenantId/plan-change", requireScope("commerce:purchase"), wrap(async (req, res) => {
    const t = tenant.parse(req.params.tenantId);
    const { idempotencyKey, user: who, ...what } = planBody.extend({ idempotencyKey: z.string(), user }).strict().parse(req.body ?? {});
    const result = await svc.changePlan(t, what, { idempotencyKey, actor: actor(req, who) });
    res.status(result.created ? 201 : 200).json({ planChange: result });
  }));
  return r;
}
