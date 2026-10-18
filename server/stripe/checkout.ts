/**
 * Checkout de Stripe para pedidos del orquestador (SOLO MODO PRUEBAS).
 *
 *  - Un pedido en `contracted` (alta nueva o conversión de prueba) de Essential o Business, sin
 *    complementos, abre una Checkout Session en modo suscripción. El Price sale del catálogo aprobado
 *    y enlazado (`stripe_prices`); NUNCA del navegador.
 *  - Un Customer de Stripe por empresa (`stripe_customers`), resuelto en el servidor.
 *  - Como mucho una sesión abierta por pedido: se reutiliza mientras siga viva; una caducada se
 *    sustituye por otra con una clave de idempotencia nueva.
 *  - Claves de idempotencia con el prefijo del entorno (`es-<ns>-…`) y `metadata.es_env`: dos entornos
 *    que compartan sandbox no reciben los objetos del otro (B9).
 *  - Si Stripe devuelve, por una clave ya usada, una sesión que no llegó a registrarse (caída entre crearla y
 *    guardarla) y que ya no sirve, se registra como cerrada y se pide otra con la clave siguiente (B2).
 *  - `sync` relee la sesión y su suscripción en Stripe y actualiza la copia local, pero NO confirma el
 *    pedido ni activa nada: la confirmación llega con los webhooks firmados (Fase C). La URL de vuelta
 *    del navegador nunca da acceso.
 */
import crypto from "node:crypto";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CrmStore } from "../crm/store";
import type { OrderStore } from "../orchestrator/store";
import type { CatalogPort } from "../subscriptions/ports";
import { SELF_SERVICE_PLANS, desiredCatalog, type SelfServicePlan } from "./catalog";
import { issuerLine } from "./issuer";
import { StripeGatewayError, type StripeGateway } from "./gateway";
import { StripeStoreError, type StripeStore } from "./store";

/** Etiqueta de Stripe para seguir este flujo en el Dashboard (sufijo de 8 letras, recomendación de Stripe). */
export const INTEGRATION_IDENTIFIER = "elephant-source-checkout-rqzmvtak";
/**
 * Tratamiento fiscal ÚNICO admitido mientras no haya política fiscal: importe NETO del catálogo, sin IVA
 * y sin factura fiscal (modo pruebas). Viaja en los metadatos y se muestra en la página de Stripe.
 */
export const TEST_TAX_TREATMENT = "test_net_no_tax";
export const TEST_TAX_NOTICE = `Entorno de pruebas de Elephant Source. Emisor: ${issuerLine()}. El importe se cobra sin IVA y no se emite factura fiscal.`;
/** Vida de una sesión: 2 h (Stripe admite de 30 min a 24 h). */
export const SESSION_TTL_MS = 2 * 3600_000;
/** Por debajo de este margen, una sesión abierta se sustituye en lugar de reutilizarse. */
const REUSE_MARGIN_MS = 10 * 60_000;

export interface CheckoutUrls {
  /** Base https de la página de estado; se le añade `session_id={CHECKOUT_SESSION_ID}`. */
  success: string;
  cancel: string;
  portalReturn: string;
}

export class StripeCheckoutError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_state" | "unsupported" | "unavailable" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "StripeCheckoutError";
  }
}

const HTTPS = /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s?#]*)?$/i;

/**
 * URLs de vuelta, solo desde el entorno (nunca desde la petición). `null` si faltan: Checkout apagado.
 * Variables: CP_STRIPE_SUCCESS_URL, CP_STRIPE_CANCEL_URL, CP_STRIPE_PORTAL_RETURN_URL (https, sin query).
 */
export function checkoutUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): CheckoutUrls | null {
  const success = (env.CP_STRIPE_SUCCESS_URL ?? "").trim();
  const cancel = (env.CP_STRIPE_CANCEL_URL ?? "").trim();
  const portalReturn = (env.CP_STRIPE_PORTAL_RETURN_URL ?? "").trim();
  if (!success && !cancel && !portalReturn) return null;
  for (const [k, v] of Object.entries({ CP_STRIPE_SUCCESS_URL: success, CP_STRIPE_CANCEL_URL: cancel, CP_STRIPE_PORTAL_RETURN_URL: portalReturn })) {
    if (!HTTPS.test(v)) throw new Error(`${k} debe ser una URL https sin parámetros`);
  }
  return { success, cancel, portalReturn };
}

export interface CheckoutDeps {
  store: StripeStore;
  gateway: StripeGateway;
  orders: Pick<OrderStore, "get">;
  crmStore: Pick<CrmStore, "get" | "list">;
  catalog: CatalogPort;
  urls: CheckoutUrls;
  now?: () => number;
  /** Prefijo del entorno (StripeConfig.namespace). */
  namespace?: string;
}

/** Intentos con claves sucesivas cuando Stripe repite una sesión huérfana ya inservible. */
const MAX_KEY_ATTEMPTS = 3;

export interface CheckoutStart {
  orderId: number;
  sessionId: string;
  url: string | null;
  expiresAt: number;
  reused: boolean;
  /** Lo que cobrará Stripe en el primer periodo (céntimos, neto) y con qué tratamiento fiscal. */
  amountCents?: number;
  currency?: string;
  taxTreatment?: typeof TEST_TAX_TREATMENT;
}

export interface CheckoutSync {
  orderId: number;
  sessionId: string;
  sessionStatus: string | null;
  paymentStatus: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  /** Siempre false en esta fase: el pedido solo se confirma con el webhook firmado (Fase C). */
  orderConfirmed: false;
}

export class StripeCheckoutService {
  private now: () => number;
  private ns: string;
  constructor(private d: CheckoutDeps) {
    this.now = d.now ?? Date.now;
    this.ns = d.namespace ?? "local";
  }

  /** Abre (o reutiliza) la Checkout Session del pedido. */
  async start(orderId: number, actor: string): Promise<CheckoutStart> {
    const o = await this.d.orders.get(orderId);
    if (!o) throw new StripeCheckoutError("not_found", "Pedido no encontrado");
    if (o.kind === "change") throw new StripeCheckoutError("unsupported", "Los cambios de plan o periodicidad se hacen en el Customer Portal");
    if (o.state !== "contracted" || o.confirmation) throw new StripeCheckoutError("invalid_state", `El pedido está en «${o.state}»: solo se paga un pedido contratado y sin confirmar`);
    const plan = o.request.plan as SelfServicePlan;
    if (!SELF_SERVICE_PLANS.includes(plan)) throw new StripeCheckoutError("unsupported", "Este plan se contrata por propuesta comercial, no por Checkout");
    if (o.request.interval !== "month" && o.request.interval !== "year") throw new StripeCheckoutError("unsupported", "Periodicidad no admitida");
    const r = o.request as typeof o.request & { users?: number; sites?: number; storageGb?: number; fiscalEntities?: number };
    if ((o.request.items ?? []).length || r.users != null || r.sites != null || r.storageGb != null || r.fiscalEntities != null) {
      throw new StripeCheckoutError("unsupported", "Los complementos y ampliaciones todavía no se contratan por Checkout");
    }
    const kind = o.request.interval === "year" ? "yearly" : "monthly";
    const desired = (await desiredCatalog(this.d.catalog)).find((x) => x.productKey === plan && x.kind === kind);
    if (!desired) throw new StripeCheckoutError("unavailable", "El catálogo no tiene precio para este plan");
    const link = await this.d.store.priceForWebPrice(desired.webPriceId);
    if (!link) throw new StripeCheckoutError("unavailable", "El catálogo de Stripe no está sincronizado para este precio");
    // Presupuesto y Stripe nunca muestran importes distintos: el neto del presupuesto es el precio de Stripe
    if (!o.quote) throw new StripeCheckoutError("invalid_state", "El pedido no tiene presupuesto");
    // Se compara con el Price REAL de Stripe (lo que se cobrará), no solo con el catálogo web
    const live = (await this.d.gateway.pricesByLookupKeys([link.lookupKey])).find((p) => p.id === link.stripePriceId);
    const quoteCur = o.quote.currency.toUpperCase();
    if (!live || !live.active || live.unitAmount !== o.quote.contractAmountCents || live.currency.toUpperCase() !== quoteCur || desired.amountCents !== o.quote.contractAmountCents) {
      throw new StripeCheckoutError("conflict", `El importe del presupuesto (${o.quote.contractAmountCents} ${quoteCur}, sin IVA) no coincide con el precio de Stripe (${live?.unitAmount ?? "?"} ${live?.currency ?? ""})`);
    }
    const charge = { amountCents: live.unitAmount, currency: quoteCur, taxTreatment: TEST_TAX_TREATMENT } as const;

    const company = await this.d.crmStore.get("companies", o.companyId);
    if (!company) throw new StripeCheckoutError("not_found", "Empresa no encontrada");
    const tenantId = (company as { tenantId?: string | null }).tenantId ?? o.tenantId ?? null;
    const customerId = await this.ensureCustomer(o.companyId, (company as { name: string }).name, tenantId);

    const now = this.now();
    await this.adoptOrphans(orderId, customerId, link.stripePriceId, now);
    if (await this.d.store.hasCompletedSession(orderId)) throw new StripeCheckoutError("invalid_state", "El pago de este pedido ya se completó en Stripe; falta su confirmación (webhook)");
    const open = await this.d.store.openSession(orderId);
    if (open) {
      const s = await this.d.gateway.checkoutSession(open.stripeSessionId);
      if (s && s.status === "open" && s.expiresAt * 1000 > now + REUSE_MARGIN_MS) {
        return { orderId, sessionId: s.id, url: s.url, expiresAt: s.expiresAt * 1000, reused: true, ...charge };
      }
      if (s && s.status === "complete") {
        await this.d.store.updateSession(s.id, { status: "complete", paymentStatus: s.paymentStatus, completedAt: now });
        throw new StripeCheckoutError("invalid_state", "El pago de este pedido ya se completó en Stripe; falta su confirmación (webhook)");
      }
      const closed = s && s.status === "open" ? await this.d.gateway.expireCheckoutSession(s.id) : s;
      await this.d.store.updateSession(open.stripeSessionId, { status: closed?.status === "complete" ? "complete" : "expired", paymentStatus: closed?.paymentStatus ?? null, completedAt: null });
      if (closed?.status === "complete") throw new StripeCheckoutError("invalid_state", "El pago de este pedido ya se completó en Stripe; falta su confirmación (webhook)");
    }

    const metadata: Record<string, string> = { es_order_id: String(orderId), es_company_id: String(o.companyId), es_env: this.ns, es_tax_treatment: TEST_TAX_TREATMENT, ...(tenantId ? { es_tenant_id: tenantId } : {}) };
    let n = (await this.d.store.countSessions(orderId)) + 1;
    let idempotencyKey = "";
    let session: Awaited<ReturnType<StripeGateway["createCheckoutSession"]>> | null = null;
    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++, n++) {
      idempotencyKey = `es-${this.ns}-checkout-${orderId}-${n}`;
      let s: Awaited<ReturnType<StripeGateway["createCheckoutSession"]>>;
      try {
        s = await this.d.gateway.createCheckoutSession(
          {
            customerId,
            priceId: link.stripePriceId,
            clientReferenceId: `es-order-${orderId}`,
            metadata,
            successUrl: `${this.d.urls.success}?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: this.d.urls.cancel,
            expiresAt: Math.floor((now + SESSION_TTL_MS) / 1000),
            integrationIdentifier: INTEGRATION_IDENTIFIER,
            notice: TEST_TAX_NOTICE,
          },
          idempotencyKey,
        );
      } catch (e) {
        // Clave ya usada con otros parámetros (una sesión que no llegó a registrarse): se usa la siguiente
        if (e instanceof StripeGatewayError && e.code === "idempotency_error") {
          opsLog("warn", "StripeCheckout", "idempotency_key_skipped", { orderId, attempt: n });
          continue;
        }
        throw e;
      }
      if (s.status === "open" && s.expiresAt * 1000 > now + REUSE_MARGIN_MS) {
        session = s;
        break;
      }
      // Respuesta repetida de una sesión huérfana (B2): Stripe repite la respuesta ORIGINAL, así que se relee
      const closed = await this.closeOrphan(s.id);
      const status = closed.status === "complete" ? "complete" : "expired";
      await this.d.store
        .insertSession({ orderId, stripeSessionId: s.id, idempotencyKey, priceIds: [link.stripePriceId], status, paymentStatus: closed.paymentStatus, expiresAt: s.expiresAt * 1000, createdAt: now, completedAt: status === "complete" ? now : null })
        .catch((e) => {
          if (!(e instanceof StripeStoreError)) throw e;
        });
      opsLog("warn", "StripeCheckout", "orphan_session_recovered", { orderId, sessionId: s.id, status });
      if (status === "complete") throw new StripeCheckoutError("invalid_state", "El pago de este pedido ya se completó en Stripe; falta su confirmación (webhook)");
    }
    if (!session) throw new StripeCheckoutError("unavailable", "Stripe no devolvió una sesión utilizable: inténtalo de nuevo");
    try {
      await this.d.store.insertSession({ orderId, stripeSessionId: session.id, idempotencyKey, priceIds: [link.stripePriceId], status: "open", paymentStatus: session.paymentStatus, expiresAt: session.expiresAt * 1000, createdAt: now, completedAt: null });
    } catch (e) {
      if (e instanceof StripeStoreError && e.code === "open_session_exists") {
        // Otra petición simultánea abrió antes la suya. Si Stripe devolvió la MISMA (misma clave), es esa
        const winner = await this.d.store.openSession(orderId);
        if (winner && winner.stripeSessionId === session.id) return { orderId, sessionId: session.id, url: session.url, expiresAt: session.expiresAt * 1000, reused: true, ...charge };
        // Si es otra, esta se cierra para no dejar dos vivas
        await this.d.gateway.expireCheckoutSession(session.id).catch(() => undefined);
        throw new StripeCheckoutError("conflict", "Ya hay una sesión de pago abierta para este pedido");
      }
      throw e;
    }
    opsLog("info", "StripeCheckout", "session_created", { orderId, sessionId: session.id, actor });
    return { orderId, sessionId: session.id, url: session.url, expiresAt: session.expiresAt * 1000, reused: false, ...charge };
  }

  /**
   * B2: sesiones de ESTE pedido y entorno que existen en Stripe pero no constan aquí (caída entre crearlas y
   * guardarlas). Se cierran si siguen abiertas y se registran; una pagada queda completada.
   */
  private async adoptOrphans(orderId: number, customerId: string, priceId: string, now: number) {
    for (const s of await this.d.gateway.sessionsOfCustomer(customerId)) {
      if (s.metadata.es_order_id !== String(orderId) || s.metadata.es_env !== this.ns || (await this.d.store.session(s.id))) continue;
      const closed = await this.closeOrphan(s.id);
      const status = closed.status === "complete" ? "complete" : "expired";
      await this.d.store
        .insertSession({ orderId, stripeSessionId: s.id, idempotencyKey: `orphan:${s.id}`.slice(0, 80), priceIds: [priceId], status, paymentStatus: closed.paymentStatus, expiresAt: s.expiresAt * 1000, createdAt: now, completedAt: status === "complete" ? now : null })
        .catch((e) => {
          if (!(e instanceof StripeStoreError)) throw e;
        });
      opsLog("warn", "StripeCheckout", "orphan_session_recovered", { orderId, sessionId: s.id, status });
    }
  }

  /** Relee la sesión y la cierra si sigue abierta (si se pagó justo ahora, la relectura lo dice). */
  private async closeOrphan(id: string) {
    const cur = await this.d.gateway.checkoutSession(id);
    if (!cur) throw new StripeCheckoutError("not_found", "La sesión ya no existe en Stripe");
    if (cur.status !== "open") return cur;
    try {
      return await this.d.gateway.expireCheckoutSession(id);
    } catch {
      return (await this.d.gateway.checkoutSession(id)) ?? cur;
    }
  }

  /** Relee la sesión y su suscripción. Comprueba que son de este pedido y empresa. No confirma nada. */
  async sync(stripeSessionId: string): Promise<CheckoutSync> {
    const row = await this.d.store.session(stripeSessionId);
    if (!row) throw new StripeCheckoutError("not_found", "Sesión no registrada");
    const s = await this.d.gateway.checkoutSession(stripeSessionId);
    if (!s) throw new StripeCheckoutError("not_found", "La sesión no existe en Stripe");
    const o = await this.d.orders.get(row.orderId);
    const link = o ? await this.d.store.customerByCompany(o.companyId) : null;
    const consistent = !!o && !!link && s.metadata.es_order_id === String(row.orderId) && s.clientReferenceId === `es-order-${row.orderId}` && s.customerId === link.stripeCustomerId;
    if (!consistent) {
      opsLog("warn", "StripeCheckout", "session_mismatch", { orderId: row.orderId, sessionId: s.id });
      recordFailure("stripe.session_mismatch");
      throw new StripeCheckoutError("conflict", "La sesión de Stripe no corresponde a este pedido o empresa");
    }
    const now = this.now();
    const status = s.status === "complete" ? "complete" : s.status === "expired" ? "expired" : "open";
    await this.d.store.updateSession(s.id, { status, paymentStatus: s.paymentStatus, completedAt: status === "complete" ? now : null });
    let sub: Awaited<ReturnType<StripeGateway["subscription"]>> = null;
    if (s.subscriptionId) {
      sub = await this.d.gateway.subscription(s.subscriptionId);
      if (sub && (sub.customerId !== s.customerId || sub.metadata.es_order_id !== String(row.orderId))) {
        recordFailure("stripe.session_mismatch");
        throw new StripeCheckoutError("conflict", "La suscripción de Stripe no corresponde a este pedido");
      }
      if (sub) {
        const { metadata: _m, ...rest } = sub;
        await this.d.store.upsertSubscription({ ...rest, companyId: o!.companyId, orderId: row.orderId, tenantId: link!.tenantId, syncedAt: now });
      }
    }
    return { orderId: row.orderId, sessionId: s.id, sessionStatus: s.status, paymentStatus: s.paymentStatus, subscriptionId: sub?.id ?? null, subscriptionStatus: sub?.status ?? null, orderConfirmed: false };
  }

  /** Cierra la sesión abierta del pedido (p. ej. al rechazar el pedido o cambiar sus condiciones). */
  async expire(orderId: number, actor: string): Promise<{ expired: boolean }> {
    const open = await this.d.store.openSession(orderId);
    if (!open) return { expired: false };
    const s = await this.d.gateway.expireCheckoutSession(open.stripeSessionId);
    await this.d.store.updateSession(s.id, { status: s.status === "complete" ? "complete" : "expired", paymentStatus: s.paymentStatus, completedAt: null });
    opsLog("info", "StripeCheckout", "session_expired", { orderId, sessionId: s.id, actor });
    return { expired: s.status === "expired" };
  }

  /**
   * URL del Customer Portal para una empresa YA resuelta en el servidor (nunca desde el cuerpo de la
   * petición). No se expone todavía: los cambios del Portal se sincronizan con los webhooks (Fase C/E).
   */
  async portalUrl(companyId: number): Promise<string> {
    const link = await this.d.store.customerByCompany(companyId);
    if (!link) throw new StripeCheckoutError("not_found", "La empresa no tiene cliente en Stripe");
    return (await this.d.gateway.createPortalSession({ customerId: link.stripeCustomerId, returnUrl: this.d.urls.portalReturn })).url;
  }

  private async ensureCustomer(companyId: number, name: string, tenantId: string | null): Promise<string> {
    const cur = await this.d.store.customerByCompany(companyId);
    if (cur) {
      const c = await this.d.gateway.customer(cur.stripeCustomerId);
      if (!c || c.deleted) throw new StripeCheckoutError("conflict", "El cliente de Stripe de esta empresa ya no existe: requiere revisión");
      return cur.stripeCustomerId;
    }
    const contacts = (await this.d.crmStore.list("contacts", { companyId })) as Array<{ email?: string | null; status?: string; isPrimary?: boolean }>;
    const active = contacts.filter((c) => c.status !== "inactive" && c.email);
    const email = (active.find((c) => c.isPrimary) ?? active[0])?.email ?? null;
    // Clave estable por empresa: dos peticiones simultáneas reciben el mismo Customer de Stripe
    const idem = `es-${this.ns}-customer-${companyId}-${crypto.createHash("sha256").update(`${this.ns}:${companyId}`).digest("hex").slice(0, 8)}`;
    const created = await this.d.gateway.createCustomer({ name, email, metadata: { es_company_id: String(companyId), es_env: this.ns, ...(tenantId ? { es_tenant_id: tenantId } : {}) } }, idem);
    const { link } = await this.d.store.linkCustomer({ companyId, tenantId, stripeCustomerId: created.id, now: this.now() });
    return link.stripeCustomerId;
  }
}
