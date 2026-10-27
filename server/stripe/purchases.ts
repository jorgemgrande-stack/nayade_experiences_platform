/**
 * Compra de módulos y ampliaciones desde la plataforma (PR 5 del diseño DISENO_COMPRA_MODULOS.md).
 *
 *   petición (empresa de la SESIÓN) → validación → pedido de cambio → cambio de partidas en Stripe con cobro
 *   condicionado → cobro verificado (factura releída) → derechos → evento → aviso
 *
 * Reglas:
 *  - La empresa sale siempre de la sesión del Core (tenant), nunca del cuerpo. Importes, precios y derechos los
 *    calcula el servidor con el catálogo aprobado y el cotizador: el navegador solo dice QUÉ quiere.
 *  - Solo se vende lo que está en estado comercial «available» (terminado, probado y aprobado para venta libre)
 *    y tiene Price enlazado en Stripe. Lo «bajo solicitud» o «próximamente» queda deshabilitado.
 *  - Solo ALTAS y AUMENTOS (módulo nuevo, más usuarios, sedes o almacenamiento). Bajas y reducciones van por el
 *    camino de fin de periodo (PR 6), nunca por aquí.
 *  - Stripe aplica el cambio SOLO si cobra el prorrateo (`pending_if_incomplete` + `always_invoice`). Ningún
 *    derecho se concede antes: lo concede el circuito de siempre (pago verificado → confirmar → suscripción →
 *    licencias) cuando el procesador de eventos relee la factura PAGADA y las partidas esperadas.
 *  - Cobro pendiente (autenticación 3DS o fallo): no cambia nada; se devuelve la página de pago de Stripe. Si
 *    caduca (23 h) el pedido se rechaza y no se concede nada. Reintentar no cobra dos veces (idempotencia por
 *    pedido; un solo cambio pendiente por suscripción).
 *  - Métodos asíncronos (adeudo SEPA): `pending_if_incomplete` no los admite. No se compra en línea con ellos
 *    salvo que se habilite la vía asíncrona (`asyncPayments`, desactivada; ver diseño §14): nunca se concede
 *    nada antes de confirmar el cobro.
 */
import type { QuoteRequest, QuoteResult } from "../catalog/quote";
import type { CrmStore } from "../crm/store";
import type { CommercialOrchestrator } from "../orchestrator/service";
import type { OrderStore } from "../orchestrator/store";
import { OrderError, type CommercialOrder } from "../orchestrator/types";
import type { CatalogPort } from "../subscriptions/ports";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { SubscriptionService } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { PURCHASABLE_FAMILIES } from "./catalog";
import type { StripeBillingMode, StripeMode } from "./config";
import type { GwInvoice, GwSubscription, StripeGateway } from "./gateway";
import { intervalCompatible, itemChanges, supportsPendingUpdate } from "./multipart";
import type { StripeStore } from "./store";
import { SubscriptionChangeError, sameItems, type ExpectedItem, type SubscriptionChange, type SubscriptionChangeStore } from "./changes";

export type PurchaseErrorCode = "disabled" | "not_found" | "invalid_input" | "invalid_state" | "unavailable" | "conflict" | "async_payment_method";
export class PurchaseError extends Error {
  constructor(
    public readonly code: PurchaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

/** Lo que pide el cliente: módulos a añadir y totales deseados de usuarios, sedes y almacenamiento. */
export interface PurchaseInput {
  add?: string[];
  users?: number;
  sites?: number;
  storageGb?: number;
}

/** Lo que se quita a fin de periodo: módulos y totales deseados (menores) de usuarios, sedes y almacenamiento. */
export interface ReductionInput {
  remove?: string[];
  users?: number;
  sites?: number;
  storageGb?: number;
}

export interface PurchaseLine {
  productKey: string;
  name: string;
  kind: "module" | "quantity";
  stripePriceId: string;
  fromQuantity: number;
  toQuantity: number;
  /** Periodicidad de la partida (puede ser mensual con un plan anual) y precio unitario aprobado (sin IVA). */
  interval?: "month" | "year";
  unitAmountCents?: number;
}

export interface PurchasePreview {
  orderId: number;
  subscriptionId: string;
  currency: string;
  /** Prorrateo a pagar ahora (céntimos, con impuestos si Stripe los calcula). */
  amountDueCents: number;
  subtotalCents: number;
  taxCents: number | null;
  lines: PurchaseLine[];
  /** Importe recurrente de las partidas nuevas por periodo (sin impuestos). */
  recurringDeltaCents: number;
  /** El mismo importe separado por periodicidad (un plan anual puede llevar partidas mensuales). */
  recurringDelta: { monthlyCents: number; yearlyCents: number };
  interval: "month" | "year";
}

export type PurchaseStatus = "applied" | "payment_pending" | "processing" | "expired" | "failed";
export interface PurchaseResult {
  status: PurchaseStatus;
  orderId: number;
  changeId: number;
  /** Página de Stripe para pagar o autenticar (solo con cobro pendiente). */
  paymentUrl: string | null;
  expiresAt: number | null;
  amountDueCents: number | null;
  created: boolean;
}

export interface PurchaseDeps {
  /** Interruptor de la compra en línea (CP_COMMERCE_PURCHASES_ENABLED). Apagado: 503 sin tocar nada. */
  enabled: boolean;
  /** Empresas de prueba que pueden comprar productos internos (`catalog.internalOnly`). Vacío: ninguna. */
  internalTenants?: ReadonlySet<string>;
  /** Vía asíncrona (SEPA). Desactivada: con un método asíncrono no se compra en línea. */
  asyncPayments?: boolean;
  mode: StripeMode;
  namespace: string;
  billingMode: StripeBillingMode;
  orchestrator: Pick<CommercialOrchestrator, "create" | "accept" | "advance" | "reject" | "must" | "list">;
  orders: Pick<OrderStore, "byKey">;
  crmStore: Pick<CrmStore, "list">;
  catalog: CatalogPort;
  quote: (r: QuoteRequest) => Promise<QuoteResult>;
  gateway: StripeGateway;
  stripeStore: Pick<StripeStore, "priceForWebPrice" | "customerByCompany" | "subscriptionsOfCompany">;
  changes: SubscriptionChangeStore;
  /** Comprobación previa de uso real (reducciones) y partidas internas (bajas programadas). */
  subscriptions?: Pick<SubscriptionService, "checkReduction" | "must">;
  subscriptionItems?: Pick<SubscriptionStore, "items">;
  /** Procesa ya la suscripción releída (el procesador de eventos): el webhook lo repetiría igual. */
  settle?: (subscriptionId: string, invoice?: GwInvoice) => Promise<unknown>;
  now?: () => number;
}

/**
 * Empresas de prueba que pueden comprar productos internos (`CP_COMMERCE_INTERNAL_TENANTS`, ids separados por comas).
 * Vacío o sin definir: ninguna. Un id con forma no válida impide arrancar (mejor que abrir la compra a quien no es).
 */
export function internalTenantsFromEnv(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const ids = (env.CP_COMMERCE_INTERNAL_TENANTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const bad = ids.filter((x) => !/^[a-z0-9][a-z0-9-]{1,62}$/.test(x));
  if (bad.length) throw new Error("CP_COMMERCE_INTERNAL_TENANTS contiene ids de empresa no válidos");
  return new Set(ids);
}

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const METRICS = { users: "users", sites: "sites", storageGb: "storage_gb" } as const;
const HOUR = 3600_000;

export class ModulePurchaseService {
  private now: () => number;
  constructor(private d: PurchaseDeps) {
    this.now = d.now ?? Date.now;
  }

  get status() {
    return { enabled: this.d.enabled, asyncPayments: !!this.d.asyncPayments, billingMode: this.d.billingMode, mode: this.d.mode };
  }

  /** ¿Puede esta empresa comprar productos internos de pruebas? Solo las de la lista explícita. */
  private internalAllowed(tenantId: string | null) {
    return !!tenantId && !!this.d.internalTenants?.has(tenantId);
  }

  private assertEnabled() {
    if (!this.d.enabled) throw new PurchaseError("disabled", "La compra de módulos en línea no está habilitada");
  }

  /** Tenant de una empresa (compras de un operador desde el CRM). Sin plataforma todavía, no hay nada que ampliar. */
  async tenantOfCompany(companyId: number): Promise<string> {
    const c = (await this.d.crmStore.list("companies", { id: companyId }, { limit: 2 }))[0] as { id: number; tenantId?: string | null } | undefined;
    if (!c || c.id !== companyId) throw new PurchaseError("not_found", "Empresa no encontrada");
    if (!c.tenantId) throw new PurchaseError("invalid_state", "La empresa todavía no tiene plataforma: contrata primero el plan");
    return c.tenantId;
  }

  /** Empresa del tenant de la sesión y su pedido vigente (solo activo: en gracia, suspendido o en baja no se compra). */
  private async context(tenantId: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantId)) throw new PurchaseError("invalid_input", "Empresa no válida");
    const company = (await this.d.crmStore.list("companies", { tenantId }, { limit: 2 }))[0];
    if (!company) throw new PurchaseError("not_found", "Empresa no encontrada");
    const orders = await this.d.orchestrator.list({ companyId: company.id });
    const current = orders.filter((o) => o.state === "active" && o.tenantId === tenantId).sort((a, b) => b.id - a.id)[0];
    if (!current) {
      const blocked = orders.find((o) => ["past_due", "suspended", "cancel_scheduled"].includes(o.state));
      throw new PurchaseError("invalid_state", blocked ? `La suscripción está en «${blocked.state}»: regulariza el cobro o reactívala antes de comprar` : "La empresa no tiene una suscripción activa");
    }
    const link = await this.d.stripeStore.customerByCompany(company.id);
    if (!link) throw new PurchaseError("unavailable", "La suscripción no se cobra en Stripe: las ampliaciones se contratan con tu gestor");
    const subs = await this.d.stripeStore.subscriptionsOfCompany(company.id);
    if (subs.length !== 1) throw new PurchaseError("unavailable", subs.length ? "Hay más de una suscripción en Stripe: lo revisa el equipo" : "La suscripción no se cobra en Stripe");
    const sub = await this.d.gateway.subscription(subs[0]);
    if (!sub || sub.customerId !== link.stripeCustomerId) throw new PurchaseError("unavailable", "La suscripción de Stripe no corresponde a la empresa");
    if (sub.status !== "active") throw new PurchaseError("invalid_state", `La suscripción de Stripe está en «${sub.status}»`);
    if (sub.pendingUpdate) throw new PurchaseError("conflict", "Hay un cambio pendiente de pago: complétalo o espera a que caduque");
    if (sub.cancelAtPeriodEnd || sub.cancelAt) throw new PurchaseError("invalid_state", "La suscripción tiene la baja programada: reactívala antes de comprar");
    // Con una renovación vencida sin aplicar, el cambio interno no se podría hacer: se cobraría sin conceder nada
    if (current.subscriptionId && this.d.subscriptions) {
      const internal = await this.d.subscriptions.must(current.subscriptionId);
      if (internal.currentPeriodEnd <= this.now()) throw new PurchaseError("conflict", "Estamos aplicando la renovación de tu suscripción: inténtalo de nuevo en unos minutos");
    }
    return { company, current, sub };
  }

  /** Petición nueva (la vigente + lo pedido), validada con el catálogo y el cotizador. */
  private async plan(current: CommercialOrder, sub: GwSubscription, input: PurchaseInput) {
    const add = Array.from(new Set((input.add ?? []).map((k) => String(k).trim()).filter(Boolean)));
    if (add.length > 20) throw new PurchaseError("invalid_input", "Demasiados productos en una compra");
    const have = new Set(current.request.items.map((i) => i.key));
    for (const key of add) {
      if (have.has(key)) throw new PurchaseError("invalid_input", `«${key}» ya está contratado`);
      if (current.subscriptionId && this.d.subscriptionItems) {
        const at = this.now();
        const live = (await this.d.subscriptionItems.items(current.subscriptionId)).find((i) => i.productKey === key && i.effectiveFrom <= at && (i.effectiveTo === null || i.effectiveTo > at));
        if (live) throw new PurchaseError("invalid_state", `«${key}» tiene la baja programada y sigue activo hasta el fin del periodo: se podrá volver a contratar después`);
      }
      const p = await this.d.catalog.product(key);
      if (!p || p.commercialStatus !== "available" || !PURCHASABLE_FAMILIES.has(p.family) || p.addonFor || (p.internalOnly && !this.internalAllowed(current.tenantId))) throw new PurchaseError("unavailable", `«${key}» no está disponible para compra en línea`);
    }
    const r = current.request as CommercialOrder["request"] & { users?: number; sites?: number; storageGb?: number };
    const request: CommercialOrder["request"] & { users?: number; sites?: number; storageGb?: number } = { ...structuredClone(r), items: [...r.items, ...add.map((key) => ({ key }))] };
    for (const f of Object.keys(METRICS) as Array<keyof typeof METRICS>) {
      const v = input[f];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new PurchaseError("invalid_input", `Cantidad no válida (${METRICS[f]})`);
      request[f] = v;
    }
    const q = await this.d.quote(request);
    if (!q.ok) throw new PurchaseError("invalid_input", `Configuración no válida: ${q.errors.join("; ")}`);
    if (q.blocking.length) throw new PurchaseError("unavailable", `Incluye productos que aún no se pueden contratar: ${q.blocking.join(", ")}`);
    const before = await this.d.quote(r);
    const qtyBefore = new Map(before.ok ? before.lines.filter((l) => l.family === "addon").map((l) => [l.key, l.quantity]) : []);
    const offer = await this.d.catalog.offer();
    const curItems = new Map((sub.items ?? []).map((i) => [i.priceId, i.quantity]));
    const desired = new Map(curItems);
    const lines: PurchaseLine[] = [];
    let recurringDeltaCents = 0;
    const recurringDelta = { monthlyCents: 0, yearlyCents: 0 };
    for (const l of q.lines) {
      const isAddon = l.family === "addon";
      if (!isAddon && !add.includes(l.key)) continue;
      const product = offer.find((p) => p.key === l.key);
      if (!product || product.commercialStatus !== "available" || (product.internalOnly && !this.internalAllowed(current.tenantId))) throw new PurchaseError("unavailable", `«${l.name}» no está disponible para compra en línea`);
      // Cada partida con el precio de SU periodicidad (un módulo sin tarifa anual es mensual también en un plan anual)
      const kind = l.interval === "year" ? "yearly" : "monthly";
      const price = product.prices.find((p) => p.kind === kind && p.status === "approved" && p.currency.toUpperCase() === "EUR");
      if (!price) throw new PurchaseError("unavailable", `«${l.name}» no tiene precio ${l.interval === "year" ? "anual" : "mensual"} aprobado`);
      // Mezclar periodicidades exige el modo flexible de Stripe (las suscripciones de Checkout lo están; las antiguas, no)
      if (!intervalCompatible(sub.billingMode ?? "classic", request.interval, l.interval)) throw new PurchaseError("unavailable", `«${l.name}» se cobra ${l.interval === "year" ? "anualmente" : "mensualmente"} y esta suscripción de Stripe no admite periodicidades distintas: lo contrata tu gestor`);
      const link = await this.d.stripeStore.priceForWebPrice(price.id);
      if (!link || link.status !== "active") throw new PurchaseError("unavailable", `«${l.name}» no tiene precio enlazado en Stripe`);
      const from = isAddon ? (qtyBefore.get(l.key) ?? 0) : 0;
      if (l.quantity < from) throw new PurchaseError("invalid_input", `Para reducir «${l.name}» usa la reducción a fin de periodo`);
      if (l.quantity === from) continue;
      if (isAddon && (curItems.get(link.stripePriceId) ?? 0) !== from) throw new PurchaseError("conflict", `Las unidades de «${l.name}» en Stripe no coinciden con las contratadas: lo revisa el equipo`);
      desired.set(link.stripePriceId, l.quantity);
      lines.push({ productKey: l.key, name: l.name, kind: isAddon ? "quantity" : "module", stripePriceId: link.stripePriceId, fromQuantity: from, toQuantity: l.quantity, interval: l.interval, unitAmountCents: price.amountCents });
      recurringDeltaCents += price.amountCents * (l.quantity - from);
      recurringDelta[l.interval === "year" ? "yearlyCents" : "monthlyCents"] += price.amountCents * (l.quantity - from);
    }
    // Una reducción declarada (menos usuarios que ahora) nunca entra por aquí
    for (const [key, qty] of Array.from(qtyBefore.entries())) if (!q.lines.some((l) => l.key === key && l.quantity >= qty)) throw new PurchaseError("invalid_input", "Para reducir una ampliación usa la reducción a fin de periodo");
    if (!lines.length) throw new PurchaseError("invalid_input", "No hay nada nuevo que comprar");
    const expected: ExpectedItem[] = Array.from(desired.entries()).map(([priceId, quantity]) => ({ priceId, quantity }));
    const items = itemChanges(sub.items ?? [], expected);
    if (items.some((i) => i.deleted)) throw new PurchaseError("invalid_state", "La compra quitaría partidas de la suscripción: lo revisa el equipo");
    // «Bajo solicitud» solo puede ser lo ya contratado (aprobado en el pedido vigente): lo nuevo es «available»
    const owned = new Set([current.request.plan, ...current.request.items.map((i) => i.key)]);
    const onRequest = q.lines.filter((l) => l.commercialStatus === "on_request");
    if (onRequest.some((l) => !owned.has(l.key))) throw new PurchaseError("unavailable", "La compra incluye productos que requieren aprobación comercial");
    const approvalReason = onRequest.length ? `Ya aprobado en el pedido vigente ${current.reference ?? current.id}; la compra solo añade productos disponibles` : undefined;
    return { request, lines, expected, items, recurringDeltaCents, recurringDelta, approvalReason };
  }

  private async assertPaymentMethod(sub: GwSubscription) {
    const type = await this.d.gateway.paymentMethodTypeOf(sub.id);
    if (supportsPendingUpdate(type)) return;
    if (this.d.asyncPayments) throw new PurchaseError("unavailable", "La vía de pago asíncrona aún no está implementada");
    throw new PurchaseError("async_payment_method", type ? "Tu método de pago (adeudo bancario) no permite comprar en línea: añade una tarjeta o pídeselo a tu gestor" : "No hay método de pago: añade una tarjeta en el portal de facturación");
  }

  /** Importe y partidas de la compra, calculados por Stripe con el prorrateo real. No cambia nada. */
  async preview(tenantId: string, input: PurchaseInput): Promise<PurchasePreview> {
    this.assertEnabled();
    const { current, sub } = await this.context(tenantId);
    const p = await this.plan(current, sub, input);
    const inv = await this.d.gateway.previewSubscriptionChange({ subscriptionId: sub.id, items: p.items, prorationBehavior: "always_invoice" });
    return { orderId: current.id, subscriptionId: sub.id, currency: inv.currency, amountDueCents: inv.amountDue, subtotalCents: inv.subtotal, taxCents: inv.taxCents, lines: p.lines, recurringDeltaCents: p.recurringDeltaCents, recurringDelta: p.recurringDelta, interval: current.request.interval };
  }

  /**
   * Compra. Idempotente por `idempotencyKey` (del cliente): repetirla devuelve el mismo pedido y el mismo cambio,
   * nunca otro cobro.
   */
  async purchase(tenantId: string, input: PurchaseInput, opts: { idempotencyKey: string; actor: string }): Promise<PurchaseResult> {
    this.assertEnabled();
    if (!KEY_RE.test(opts.idempotencyKey ?? "")) throw new PurchaseError("invalid_input", "Clave de idempotencia no válida");
    const orderKey = `purchase-${tenantId}-${opts.idempotencyKey}`.slice(0, 80);
    // Repetición de una compra ya enviada (antes de mirar la suscripción: ahora puede tener el cambio pendiente)
    const replay = await this.replay(tenantId, orderKey);
    if (replay) return replay;
    const { company, current, sub } = await this.context(tenantId);
    const p = await this.plan(current, sub, input);
    await this.assertPaymentMethod(sub);
    let order: CommercialOrder;
    try {
      const created = await this.d.orchestrator.create({ idempotencyKey: orderKey, changeOf: current.id, request: p.request }, opts.actor);
      order = created.order;
      if (order.state === "requested" || order.state === "quoted") order = (await this.d.orchestrator.accept(order.id, { signatureRef: `platform-purchase:${opts.actor}`.slice(0, 120), ...(p.approvalReason ? { approvalReason: p.approvalReason } : {}) }, opts.actor)).order;
    } catch (e) {
      if (e instanceof OrderError) throw new PurchaseError(e.code === "conflict" ? "conflict" : e.code === "invalid_input" ? "invalid_input" : "invalid_state", e.message);
      throw e;
    }
    if (order.state !== "contracted") throw new PurchaseError("invalid_state", `El pedido de la compra quedó en «${order.state}»${order.lastError ? `: ${order.lastError}` : ""}`);
    let change: SubscriptionChange;
    try {
      change = (
        await this.d.changes.insert({
          orderId: order.id,
          companyId: company.id,
          stripeSubscriptionId: sub.id,
          idempotencyKey: `es-${this.d.namespace}-order-${order.id}-items-v1`,
          items: p.items,
          expectedItems: p.expected,
          createdBy: opts.actor,
          createdAt: this.now(),
        })
      ).change;
    } catch (e) {
      if (e instanceof SubscriptionChangeError) {
        await this.d.orchestrator.reject(order.id, { reason: "Otra compra pendiente de pago en la misma suscripción" }, "system:purchases").catch(() => undefined);
        throw new PurchaseError("conflict", e.message);
      }
      throw e;
    }
    return { ...(await this.send(change, order.id)), created: true };
  }

  /** Envía (o reenvía, con la misma clave: Stripe devuelve lo mismo) el cambio a Stripe y lee el resultado. */
  private async send(change: SubscriptionChange, orderId: number): Promise<PurchaseResult> {
    let r: { subscription: GwSubscription; invoice: GwInvoice | null };
    try {
      r = await this.d.gateway.updateSubscriptionItems(
        { subscriptionId: change.stripeSubscriptionId, items: change.items, prorationBehavior: "always_invoice", paymentBehavior: "pending_if_incomplete", metadata: { es_change_order_id: String(orderId) } },
        change.idempotencyKey,
      );
    } catch (e) {
      const retryable = (e as { retryable?: boolean }).retryable === true;
      if (retryable) {
        // No se sabe si llegó: el cambio queda pendiente y la conciliación (`sync`) lo resuelve releyendo Stripe
        opsLog("warn", "Purchases", "send_uncertain", { orderId, changeId: change.id });
        return this.result(change, orderId, "processing", false);
      }
      await this.d.changes.resolve(change.id, "failed", e instanceof Error ? e.message : "error", this.now());
      await this.d.orchestrator.reject(orderId, { reason: `Stripe rechazó el cambio: ${e instanceof Error ? e.message : "error"}`.slice(0, 300) }, "system:purchases").catch(() => undefined);
      opsLog("warn", "Purchases", "change_rejected", { orderId, changeId: change.id });
      return this.result({ ...change, status: "failed" }, orderId, "failed", true);
    }
    const inv = r.invoice;
    const pending = !!r.subscription.pendingUpdate;
    change = await this.d.changes.setInvoice(
      change.id,
      { stripeInvoiceId: inv?.id ?? null, amountDueCents: inv ? (inv.total ?? inv.subtotal ?? null) : 0, expiresAt: pending ? r.subscription.pendingUpdate!.expiresAt * 1000 : null },
      this.now(),
    );
    if (pending) {
      opsLog("info", "Purchases", "payment_pending", { orderId, changeId: change.id });
      return { ...this.result(change, orderId, "payment_pending", true), paymentUrl: inv?.hostedInvoiceUrl ?? null };
    }
    if (sameItems(r.subscription.items ?? [], change.expectedItems) && inv?.status === "paid" && this.d.settle) {
      await this.d.settle(change.stripeSubscriptionId, inv).catch((e) => opsLog("warn", "Purchases", "settle_deferred", { orderId, error: e instanceof Error ? e.name : "error" }));
    }
    return this.sync(change.id, orderId);
  }

  /**
   * Estado de una compra releyendo Stripe (también lo usa la conciliación): aplicada (pedido activo), pendiente
   * de pago, caducada (pedido rechazado, nada concedido) o en proceso.
   */
  async sync(changeId: number, orderId: number): Promise<PurchaseResult> {
    const change = (await this.d.changes.byOrder(orderId))!;
    if (change.id !== changeId) throw new PurchaseError("conflict", "Cambio y pedido no corresponden");
    let order = await this.d.orchestrator.must(orderId);
    if (change.status !== "pending") return this.result(change, orderId, change.status === "applied" ? "applied" : change.status, false);
    const sub = await this.d.gateway.subscription(change.stripeSubscriptionId);
    if (!sub) return this.result(change, orderId, "processing", false);
    if (sameItems(sub.items ?? [], change.expectedItems)) {
      if (order.state !== "active" && this.d.settle) {
        await this.d.settle(sub.id).catch(() => undefined);
        order = await this.d.orchestrator.must(orderId);
      }
      if (order.state === "active" || order.state === "superseded") {
        await this.d.changes.resolve(change.id, "applied", null, this.now());
        return this.result({ ...change, status: "applied" }, orderId, "applied", false);
      }
      return this.result(change, orderId, "processing", false);
    }
    // Pedido ya vigente y Stripe sin las partidas: solo puede ser una reducción (una compra no se activa sin
    // cobro). Se reenvía con la misma clave; nunca caduca
    if (["active", "past_due", "suspended", "cancel_scheduled"].includes(order.state)) return this.sendReduction(change, orderId);
    if (sub.pendingUpdate) {
      const inv = change.stripeInvoiceId ? await this.d.gateway.invoice(change.stripeInvoiceId) : null;
      return { ...this.result(change, orderId, "payment_pending", false), paymentUrl: inv?.hostedInvoiceUrl ?? null };
    }
    // Sin cambio pendiente en Stripe y sin las partidas esperadas: caducó (o se anuló) sin cobro
    const inv = change.stripeInvoiceId ? await this.d.gateway.invoice(change.stripeInvoiceId) : null;
    if (change.stripeInvoiceId && inv && inv.status !== "void" && inv.status !== "uncollectible") return this.result(change, orderId, "processing", false);
    if (!change.stripeInvoiceId && change.updatedAt === change.createdAt && this.now() - change.createdAt < HOUR) return this.result(change, orderId, "processing", false);
    if (await this.d.changes.resolve(change.id, "expired", "El cambio caducó en Stripe sin cobrarse", this.now())) {
      if (["requested", "quoted", "contracted"].includes(order.state)) await this.d.orchestrator.reject(orderId, { reason: "Pago de la compra no completado: el cambio caducó en Stripe" }, "system:purchases").catch(() => undefined);
      opsLog("info", "Purchases", "change_expired", { orderId, changeId: change.id });
    }
    return this.result({ ...change, status: "expired" }, orderId, "expired", false);
  }

  // ── Bajas y reducciones (PR 6) ─────────────────────────────────────────────

  /**
   * Petición reducida (la vigente − módulos quitados − unidades de menos). Nunca por debajo del uso real (se
   * comprueba ANTES de crear nada), nunca el plan y nunca un aumento en la misma operación.
   */
  private async planReduction(current: CommercialOrder, sub: GwSubscription, input: ReductionInput) {
    const remove = Array.from(new Set((input.remove ?? []).map((k) => String(k).trim()).filter(Boolean)));
    const have = new Set(current.request.items.map((i) => i.key));
    for (const key of remove) {
      if (key === current.request.plan) throw new PurchaseError("invalid_input", "El plan no se quita: cambia de plan o cancela la suscripción");
      if (!have.has(key)) throw new PurchaseError("invalid_input", `«${key}» no está contratado`);
    }
    const r = current.request as CommercialOrder["request"] & { users?: number; sites?: number; storageGb?: number };
    const request: typeof r = { ...structuredClone(r), items: r.items.filter((i) => !remove.includes(i.key)) };
    for (const f of Object.keys(METRICS) as Array<keyof typeof METRICS>) {
      const v = input[f];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new PurchaseError("invalid_input", `Cantidad no válida (${METRICS[f]})`);
      request[f] = v;
    }
    const q = await this.d.quote(request);
    if (!q.ok) throw new PurchaseError("invalid_input", `Configuración no válida: ${q.errors.join("; ")}`);
    const before = await this.d.quote(r);
    const qtyBefore = new Map(before.ok ? before.lines.filter((l) => l.family === "addon").map((l) => [l.key, l.quantity]) : []);
    const qtyAfter = new Map(q.lines.filter((l) => l.family === "addon").map((l) => [l.key, l.quantity]));
    for (const [key, n] of Array.from(qtyAfter.entries())) if (n > (qtyBefore.get(key) ?? 0)) throw new PurchaseError("invalid_input", "Para ampliar usa la compra (se cobra el prorrateo)");
    const offer = await this.d.catalog.offer();
    // Periodicidad de cada partida contratada (un módulo mensual en un plan anual se busca con su precio mensual)
    const intervalOf = new Map(before.ok ? before.lines.map((l) => [l.key, l.interval]) : []);
    const linkOf = async (key: string) => {
      const kind = (intervalOf.get(key) ?? request.interval) === "year" ? "yearly" : "monthly";
      const price = offer.find((p) => p.key === key)?.prices.find((p) => p.kind === kind && p.status === "approved" && p.currency.toUpperCase() === "EUR");
      const link = price ? await this.d.stripeStore.priceForWebPrice(price.id) : null;
      return link ? { link, price: price! } : null;
    };
    const curItems = new Map((sub.items ?? []).map((i) => [i.priceId, i.quantity]));
    const desired = new Map(curItems);
    const lines: PurchaseLine[] = [];
    let recurringDeltaCents = 0;
    const reduce = async (key: string, name: string, kindOf: PurchaseLine["kind"], from: number, to: number) => {
      const l = await linkOf(key);
      if (!l || (curItems.get(l.link.stripePriceId) ?? 0) !== from) throw new PurchaseError("conflict", `«${name}» en Stripe no coincide con lo contratado: lo revisa el equipo`);
      // Nunca por debajo del uso real: se comprueba antes de crear el pedido
      if (kindOf === "quantity" && current.subscriptionId && this.d.subscriptions) {
        try {
          await this.d.subscriptions.checkReduction(current.subscriptionId, { productKey: key, quantity: to });
        } catch (e) {
          throw new PurchaseError("invalid_state", e instanceof Error ? e.message : "No se puede reducir por debajo del uso real");
        }
      }
      if (to === 0) desired.delete(l.link.stripePriceId);
      else desired.set(l.link.stripePriceId, to);
      lines.push({ productKey: key, name, kind: kindOf, stripePriceId: l.link.stripePriceId, fromQuantity: from, toQuantity: to, interval: intervalOf.get(key) ?? request.interval, unitAmountCents: l.price.amountCents });
      recurringDeltaCents -= l.price.amountCents * (from - to);
    };
    for (const key of remove) await reduce(key, offer.find((p) => p.key === key)?.name ?? key, "module", 1, 0);
    for (const [key, from] of Array.from(qtyBefore.entries())) {
      const to = qtyAfter.get(key) ?? 0;
      if (to < from) await reduce(key, offer.find((p) => p.key === key)?.name ?? key, "quantity", from, to);
    }
    if (!lines.length) throw new PurchaseError("invalid_input", "No hay nada que reducir");
    const expected: ExpectedItem[] = Array.from(desired.entries()).map(([priceId, quantity]) => ({ priceId, quantity }));
    const items = itemChanges(sub.items ?? [], expected);
    const owned = new Set([current.request.plan, ...current.request.items.map((i) => i.key)]);
    const onRequest = q.lines.filter((l) => l.commercialStatus === "on_request");
    if (onRequest.some((l) => !owned.has(l.key))) throw new PurchaseError("invalid_state", "La reducción dejaría productos sin aprobar: lo revisa el equipo");
    const approvalReason = onRequest.length ? `Ya aprobado en el pedido vigente ${current.reference ?? current.id}; la reducción solo quita partidas` : undefined;
    return { request, lines, expected, items, recurringDeltaCents, approvalReason };
  }

  /** Qué cambiaría una reducción (sin cambiar nada). Sin abonos: lo pagado se disfruta hasta el fin del periodo. */
  async previewReduction(tenantId: string, input: ReductionInput) {
    this.assertEnabled();
    const { current, sub } = await this.context(tenantId);
    const p = await this.planReduction(current, sub, input);
    return { orderId: current.id, subscriptionId: sub.id, lines: p.lines, recurringDeltaCents: p.recurringDeltaCents, effectiveAt: sub.currentPeriodEnd === null || sub.currentPeriodEnd === undefined ? null : sub.currentPeriodEnd * 1000, interval: current.request.interval };
  }

  /**
   * Baja de módulos o reducción de ampliaciones a FIN DE PERIODO, sin abonos (lo pagado se disfruta hasta el
   * final). Internamente: pedido de cambio sin importe (confirmación heredada) que programa las bajas al fin de
   * periodo (derechos y límites siguen hasta entonces). En Stripe: las partidas se ajustan YA sin prorrateo, de
   * modo que la próxima renovación ya no las cobra. Nunca por debajo del uso real; nunca borra datos ni
   * desactiva usuarios. Idempotente por clave.
   */
  async reduce(tenantId: string, input: ReductionInput, opts: { idempotencyKey: string; actor: string }): Promise<PurchaseResult> {
    this.assertEnabled();
    if (!KEY_RE.test(opts.idempotencyKey ?? "")) throw new PurchaseError("invalid_input", "Clave de idempotencia no válida");
    const orderKey = `reduce-${tenantId}-${opts.idempotencyKey}`.slice(0, 80);
    const replay = await this.replay(tenantId, orderKey);
    if (replay) return replay;
    const { company, current, sub } = await this.context(tenantId);
    const p = await this.planReduction(current, sub, input);
    let order: CommercialOrder;
    try {
      const created = await this.d.orchestrator.create({ idempotencyKey: orderKey, changeOf: current.id, request: p.request }, opts.actor);
      order = created.order;
      if (order.state === "requested" || order.state === "quoted") order = (await this.d.orchestrator.accept(order.id, { signatureRef: `platform-reduction:${opts.actor}`.slice(0, 120), ...(p.approvalReason ? { approvalReason: p.approvalReason } : {}) }, opts.actor)).order;
    } catch (e) {
      if (e instanceof OrderError) throw new PurchaseError(e.code === "conflict" ? "conflict" : e.code === "invalid_input" ? "invalid_input" : "invalid_state", e.message);
      throw e;
    }
    // Sin importe y sin capacidades nuevas: la confirmación es la heredada y el pedido queda activo ya
    if (order.state !== "active") {
      opsLog("error", "Purchases", "reduction_not_applied", { orderId: order.id, state: order.state });
      recordFailure("purchases.reduction_stuck");
      throw new PurchaseError("invalid_state", `La reducción quedó en «${order.state}»${order.lastError ? `: ${order.lastError}` : ""}`);
    }
    const change = (
      await this.d.changes.insert({
        orderId: order.id,
        companyId: company.id,
        stripeSubscriptionId: sub.id,
        idempotencyKey: `es-${this.d.namespace}-order-${order.id}-items-v1`,
        items: p.items,
        expectedItems: p.expected,
        createdBy: opts.actor,
        createdAt: this.now(),
      })
    ).change;
    return { ...(await this.sendReduction(change, order.id)), created: true };
  }

  /** Ajusta las partidas en Stripe sin prorrateo (ni cobro ni abono). Reenviable: misma clave, mismo resultado. */
  private async sendReduction(change: SubscriptionChange, orderId: number): Promise<PurchaseResult> {
    try {
      const r = await this.d.gateway.updateSubscriptionItems(
        { subscriptionId: change.stripeSubscriptionId, items: change.items, prorationBehavior: "none", paymentBehavior: "error_if_incomplete", metadata: { es_change_order_id: String(orderId) } },
        change.idempotencyKey,
      );
      await this.d.changes.setInvoice(change.id, { stripeInvoiceId: r.invoice?.id ?? null, amountDueCents: 0, expiresAt: null }, this.now());
      if (sameItems(r.subscription.items ?? [], change.expectedItems)) {
        await this.d.changes.resolve(change.id, "applied", null, this.now());
        return this.result({ ...change, status: "applied" }, orderId, "applied", false);
      }
      return this.result(change, orderId, "processing", false);
    } catch (e) {
      // La reducción interna YA está programada: Stripe debe seguirla. Queda pendiente (la conciliación reenvía)
      // y con alerta; nunca se deshace lo interno en silencio
      opsLog("error", "Purchases", "reduction_stripe_pending", { orderId, changeId: change.id, retryable: (e as { retryable?: boolean }).retryable === true });
      recordFailure("purchases.reduction_stripe_pending");
      return this.result(change, orderId, "processing", false);
    }
  }

  /** Estado de una compra de ESA empresa (un pedido de otra empresa no existe para ella). */
  async statusOf(tenantId: string, orderId: number): Promise<PurchaseResult> {
    const o = await this.d.orchestrator.must(orderId).catch(() => null);
    const change = o && o.tenantId === tenantId ? await this.d.changes.byOrder(orderId) : null;
    if (!change) throw new PurchaseError("not_found", "Compra no encontrada");
    return this.sync(change.id, orderId);
  }

  /** Compra ya enviada con esa clave (repetición del cliente). */
  private async replay(tenantId: string, orderKey: string): Promise<PurchaseResult | null> {
    const o = await this.d.orders.byKey(orderKey);
    if (!o || o.tenantId !== tenantId) return null;
    const change = await this.d.changes.byOrder(o.id);
    if (!change) return null;
    return { ...(await this.sync(change.id, o.id)), created: false };
  }

  /** Pendientes de la conciliación (cambios de los que no se sabe el desenlace). */
  async syncPending(limit = 25) {
    const out = { applied: 0, expired: 0, pending: 0 };
    for (const c of await this.d.changes.pending(limit)) {
      const r = await this.sync(c.id, c.orderId).catch(() => null);
      if (r?.status === "applied") out.applied++;
      else if (r?.status === "expired") out.expired++;
      else out.pending++;
    }
    return out;
  }

  private result(c: SubscriptionChange, orderId: number, status: PurchaseStatus, created: boolean): PurchaseResult {
    return { status, orderId, changeId: c.id, paymentUrl: null, expiresAt: c.expiresAt, amountDueCents: c.amountDueCents, created };
  }
}
