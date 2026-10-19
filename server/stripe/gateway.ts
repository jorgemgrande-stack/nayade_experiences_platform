/**
 * Acceso a Stripe detrás de un puerto con SOLO las operaciones que usa Elephant Source. Así:
 *  - las pruebas usan un doble sin red ni claves (`FakeStripeGateway` en `server/stripe/testing.ts`);
 *  - cada objeto devuelto se comprueba con `assertModeObject` (livemode === (modo === "live")) antes de
 *    usarse: un entorno de pruebas nunca acepta un objeto live, ni uno live un objeto de pruebas;
 *  - el catálogo NO se escribe desde aquí: Products y Prices los crea una persona (§16.3 de
 *    docs/elephant-source/STRIPE_FASE_A.md); el servicio solo los lee por `lookup_key`.
 *
 * Adaptador real: SDK oficial `stripe` (instancia propia, nunca la clave global), versión de API fijada,
 * reintentos de red del SDK e `Idempotency-Key` en cada creación.
 */
import Stripe from "stripe";
import type { GwPortalConfig } from "./portal";
import { StripeConfigError, assertModeObject, type StripeConfig, type StripeMode } from "./config";

export interface GwPrice {
  id: string;
  productId: string;
  lookupKey: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | null;
  type: "recurring" | "one_time";
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  taxBehavior: "exclusive" | "inclusive" | "unspecified" | null;
  metadata: Record<string, string>;
}

export interface GwProduct {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
}

export interface GwCheckoutSession {
  id: string;
  status: "open" | "complete" | "expired" | null;
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | null;
  url: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  expiresAt: number;
}

export interface GwSubscription {
  id: string;
  customerId: string;
  status: "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  /** Máximo de items.data[].current_period_end (desde la API 2025-03-31 el periodo está en los items). */
  currentPeriodEnd: number | null;
  latestInvoiceId: string | null;
  priceIds: string[];
  metadata: Record<string, string>;
}

export interface GwInvoice {
  id: string;
  status: "draft" | "open" | "paid" | "uncollectible" | "void" | null;
  /** Desde la API 2025-03-31 la suscripción está en parent.subscription_details.subscription. */
  subscriptionId: string | null;
  customerId: string | null;
  amountPaid: number;
  currency: string;
  /** subscription_create (primera), subscription_cycle (renovación), subscription_update (cambio)… */
  billingReason: string | null;
  periodStart: number | null;
  /** Antes de impuestos, descuentos aplicados en factura y saldo a favor del cliente. */
  subtotal: number | null;
  /** Dirección del cliente fijada en la factura al finalizarla (la que usó Stripe Tax). */
  customerCountry?: string | null;
  customerPostalCode?: string | null;
  /** Identificadores fiscales del cliente que constan en la factura. */
  customerTaxIds?: number;
  /** Impuestos de la factura (céntimos), para la trazabilidad; null si Stripe no los informa. */
  taxCents?: number | null;
  /** Número de la factura en Stripe (al finalizarla) y total con impuestos. */
  number?: string | null;
  total?: number | null;
}

/** Evento de Stripe reducido a lo que usamos: el efecto siempre se calcula releyendo el objeto. */
export interface GwEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  apiVersion: string | null;
  objectType: string | null;
  objectId: string | null;
}

/** Cargo releído con lo necesario para reembolsos y disputas (sin datos de la tarjeta). */
export interface GwCharge {
  id: string;
  customerId: string | null;
  amount: number;
  amountRefunded: number;
  refunded: boolean;
  currency: string;
  /** Factura que pagó este cargo (vía InvoicePayments en la API actual). */
  invoiceId: string | null;
  /** Estado de la disputa más reciente del cargo, si la hay. */
  disputeStatus: string | null;
}

export interface CheckoutSessionInput {
  customerId: string;
  priceId: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  /** Segundos desde epoch (entre 30 min y 24 h desde ahora, regla de Stripe). */
  expiresAt: number;
  integrationIdentifier: string;
  /** Aviso visible junto al botón de pago (tratamiento fiscal y emisor). */
  notice?: string;
  /** Stripe Tax calcula el impuesto sobre el precio sin IVA (`automatic_tax`). Solo con política fiscal live. */
  automaticTax?: boolean;
  /** Identificador fiscal obligatorio en la página de pago (empresas y profesionales). Sin él, es opcional. */
  taxIdRequired?: boolean;
}

/** Datos del Customer al crearlo. La dirección completa la pide y confirma Checkout. */
export interface CustomerInput {
  name: string;
  email: string | null;
  metadata: Record<string, string>;
  address?: { country: string; postalCode: string | null };
}

export interface StripeGateway {
  pricesByLookupKeys(keys: string[]): Promise<GwPrice[]>;
  product(id: string): Promise<GwProduct | null>;
  createCustomer(input: CustomerInput, idempotencyKey: string): Promise<{ id: string }>;
  customer(id: string): Promise<{ id: string; deleted: boolean } | null>;
  createCheckoutSession(input: CheckoutSessionInput, idempotencyKey: string): Promise<GwCheckoutSession>;
  checkoutSession(id: string): Promise<GwCheckoutSession | null>;
  /** Sesiones recientes de un cliente (para recuperar las que no llegaron a registrarse). */
  sessionsOfCustomer(customerId: string): Promise<GwCheckoutSession[]>;
  expireCheckoutSession(id: string): Promise<GwCheckoutSession>;
  subscription(id: string): Promise<GwSubscription | null>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Configuraciones del Customer Portal (solo lectura). */
  portalConfigurations(): Promise<GwPortalConfig[]>;
  invoice(id: string): Promise<GwInvoice | null>;
  charge(id: string): Promise<GwCharge | null>;
  /** Cargo de un reembolso o de una disputa (para releerlo). */
  chargeIdOf(objectType: "refund" | "dispute", id: string): Promise<string | null>;
  /** Conciliación: eventos desde un momento (segundos), filtrados por tipo, paginados. */
  listEvents(q: { createdGte?: number; types?: string[]; startingAfter?: string; limit?: number }): Promise<{ events: GwEvent[]; hasMore: boolean }>;
}

export class StripeGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StripeGatewayError";
  }
}

const meta = (m: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return out;
};
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

export function toPrice(p: Stripe.Price, mode: StripeMode = "test"): GwPrice {
  assertModeObject(p, mode);
  return {
    id: p.id,
    productId: idOf(p.product) ?? "",
    lookupKey: p.lookup_key ?? null,
    active: p.active,
    currency: p.currency.toUpperCase(),
    unitAmount: p.unit_amount ?? null,
    type: p.type as GwPrice["type"],
    interval: (p.recurring?.interval ?? null) as GwPrice["interval"],
    intervalCount: p.recurring?.interval_count ?? null,
    taxBehavior: (p.tax_behavior ?? null) as GwPrice["taxBehavior"],
    metadata: meta(p.metadata),
  };
}

export function toSession(s: Stripe.Checkout.Session, mode: StripeMode = "test"): GwCheckoutSession {
  assertModeObject(s, mode);
  return {
    id: s.id,
    status: (s.status ?? null) as GwCheckoutSession["status"],
    paymentStatus: (s.payment_status ?? null) as GwCheckoutSession["paymentStatus"],
    url: s.url ?? null,
    customerId: idOf(s.customer),
    subscriptionId: idOf(s.subscription),
    clientReferenceId: s.client_reference_id ?? null,
    metadata: meta(s.metadata),
    expiresAt: s.expires_at,
  };
}

export function toSubscription(s: Stripe.Subscription, mode: StripeMode = "test"): GwSubscription {
  assertModeObject(s, mode);
  const items = s.items?.data ?? [];
  const ends = items.map((i) => (i as unknown as { current_period_end?: number }).current_period_end).filter((x): x is number => typeof x === "number");
  return {
    id: s.id,
    customerId: idOf(s.customer) ?? "",
    status: s.status as GwSubscription["status"],
    cancelAt: s.cancel_at ?? null,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
    currentPeriodEnd: ends.length ? Math.max(...ends) : null,
    latestInvoiceId: idOf(s.latest_invoice),
    priceIds: items.map((i) => i.price?.id).filter((x): x is string => !!x),
    metadata: meta(s.metadata),
  };
}

export function toInvoice(i: Stripe.Invoice, mode: StripeMode = "test"): GwInvoice {
  assertModeObject(i, mode);
  const parent = (i as unknown as { parent?: { subscription_details?: { subscription?: unknown } | null } | null }).parent;
  const legacy = (i as unknown as { subscription?: unknown }).subscription;
  return {
    id: i.id ?? "",
    status: (i.status ?? null) as GwInvoice["status"],
    subscriptionId: idOf(parent?.subscription_details?.subscription) ?? idOf(legacy),
    customerId: idOf(i.customer),
    amountPaid: i.amount_paid ?? 0,
    currency: (i.currency ?? "").toUpperCase(),
    billingReason: (i.billing_reason as string | null) ?? null,
    periodStart: typeof i.period_start === "number" ? i.period_start : null,
    subtotal: typeof i.subtotal === "number" ? i.subtotal : null,
    customerCountry: i.customer_address?.country ?? null,
    customerPostalCode: i.customer_address?.postal_code ?? null,
    customerTaxIds: Array.isArray(i.customer_tax_ids) ? i.customer_tax_ids.length : 0,
    taxCents: taxOf(i),
    number: i.number ?? null,
    total: typeof i.total === "number" ? i.total : null,
  };
}

/** Impuestos de la factura: desde la API 2025-03-31 en `total_taxes` (lista); antes, en `tax`. */
function taxOf(i: Stripe.Invoice): number | null {
  const x = i as unknown as { total_taxes?: Array<{ amount?: number }> | null; tax?: number | null };
  if (Array.isArray(x.total_taxes)) return x.total_taxes.reduce((s, t) => s + (t.amount ?? 0), 0);
  return typeof x.tax === "number" ? x.tax : null;
}

export function toEvent(e: { id: string; type: string; created: number; livemode: boolean; api_version?: string | null; data?: { object?: unknown } }): GwEvent {
  const obj = (e.data?.object ?? null) as { id?: unknown; object?: unknown } | null;
  return {
    id: e.id,
    type: e.type,
    created: e.created,
    livemode: e.livemode,
    apiVersion: e.api_version ?? null,
    objectType: typeof obj?.object === "string" ? obj.object : null,
    objectId: typeof obj?.id === "string" ? obj.id : null,
  };
}

/** Traduce un error del SDK a uno propio sin datos sensibles (solo tipo, código y estado HTTP). */
function wrapError(e: unknown): never {
  // Un objeto del otro modo no es un fallo de Stripe ni se arregla reintentando: se rechaza tal cual
  if (e instanceof StripeConfigError) throw e;
  const err = e as { type?: string; code?: string; statusCode?: number; name?: string };
  const status = err.statusCode ?? 0;
  const code = err.code || err.type || err.name || "stripe_error";
  const retryable = status === 0 || status === 429 || status >= 500 || err.type === "StripeConnectionError" || err.type === "StripeAPIError";
  throw new StripeGatewayError(String(code).slice(0, 60), `Stripe respondió ${status || "sin conexión"} (${String(code).slice(0, 60)})`, retryable);
}

const notFound = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404;

/** Adaptador con el SDK oficial. Solo se crea con una configuración validada; comprueba cada objeto con su modo. */
export function stripeGateway(
  config: StripeConfig,
  o: {
    timeoutMs?: number;
    maxNetworkRetries?: number;
    /** SOLO PRUEBAS: servidor local que imita la API (nunca se configura desde el entorno). */
    apiBase?: { host: string; port: number; protocol: "http" | "https" };
  } = {},
): StripeGateway {
  // Con la clave real nunca se habla con otro servidor que no sea Stripe
  if (o.apiBase && config.mode === "live") throw new StripeConfigError("apiBase solo se admite en modo pruebas");
  const client = new Stripe(config.apiKey, {
    apiVersion: config.apiVersion as Stripe.LatestApiVersion,
    maxNetworkRetries: o.maxNetworkRetries ?? 2,
    timeout: o.timeoutMs ?? 15_000,
    telemetry: false,
    appInfo: { name: "Elephant Source Controlplane" },
    ...(o.apiBase ?? {}),
  });
  const mode = config.mode;
  return {
    async pricesByLookupKeys(keys) {
      if (!keys.length) return [];
      const out: GwPrice[] = [];
      try {
        // Stripe admite como máximo 10 lookup_keys por petición
        for (let i = 0; i < keys.length; i += 10) {
          const page = await client.prices.list({ lookup_keys: keys.slice(i, i + 10), limit: 100 });
          out.push(...page.data.map((x) => toPrice(x, mode)));
        }
      } catch (e) {
        wrapError(e);
      }
      return out;
    },
    async product(id) {
      try {
        const p = await client.products.retrieve(id);
        assertModeObject(p, mode);
        return { id: p.id, name: p.name, active: p.active, metadata: meta(p.metadata) };
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async createCustomer(input, idempotencyKey) {
      try {
        const c = await client.customers.create(
          {
            name: input.name,
            ...(input.email ? { email: input.email } : {}),
            metadata: input.metadata,
            ...(input.address ? { address: { country: input.address.country, ...(input.address.postalCode ? { postal_code: input.address.postalCode } : {}) } } : {}),
          },
          { idempotencyKey },
        );
        assertModeObject(c, mode);
        return { id: c.id };
      } catch (e) {
        wrapError(e);
      }
    },
    async customer(id) {
      try {
        const c = await client.customers.retrieve(id);
        assertModeObject(c as { livemode?: unknown }, mode);
        return { id: c.id, deleted: !!(c as { deleted?: boolean }).deleted };
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async createCheckoutSession(i, idempotencyKey) {
      const params: Stripe.Checkout.SessionCreateParams & { integration_identifier?: string } = {
        mode: "subscription",
        customer: i.customerId,
        line_items: [{ price: i.priceId, quantity: 1 }],
        client_reference_id: i.clientReferenceId,
        metadata: i.metadata,
        subscription_data: {
          metadata: i.metadata,
          billing_mode: { type: "flexible" },
        } as Stripe.Checkout.SessionCreateParams.SubscriptionData,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        expires_at: i.expiresAt,
        billing_address_collection: "required",
        tax_id_collection: i.taxIdRequired ? { enabled: true, required: "if_supported" } : { enabled: true },
        customer_update: { address: "auto", name: "auto" },
        locale: "es",
        ...(i.notice ? { custom_text: { submit: { message: i.notice.slice(0, 1200) } } } : {}),
        ...(i.automaticTax ? { automatic_tax: { enabled: true } } : {}),
        integration_identifier: i.integrationIdentifier,
      };
      try {
        return toSession(await client.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { idempotencyKey }), mode);
      } catch (e) {
        wrapError(e);
      }
    },
    async checkoutSession(id) {
      try {
        return toSession(await client.checkout.sessions.retrieve(id), mode);
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async sessionsOfCustomer(customerId) {
      try {
        return (await client.checkout.sessions.list({ customer: customerId, limit: 100 })).data.map((x) => toSession(x, mode));
      } catch (e) {
        wrapError(e);
      }
    },
    async expireCheckoutSession(id) {
      try {
        return toSession(await client.checkout.sessions.expire(id), mode);
      } catch (e) {
        wrapError(e);
      }
    },
    async subscription(id) {
      try {
        return toSubscription(await client.subscriptions.retrieve(id), mode);
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async invoice(id) {
      try {
        return toInvoice(await client.invoices.retrieve(id), mode);
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async charge(id) {
      try {
        const c = await client.charges.retrieve(id);
        assertModeObject(c, mode);
        const pi = idOf(c.payment_intent);
        let invoiceId = idOf((c as unknown as { invoice?: unknown }).invoice);
        if (!invoiceId && pi) {
          const ip = await client.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
          invoiceId = idOf(ip.data[0]?.invoice);
        }
        let disputeStatus: string | null = null;
        if (c.disputed) {
          const ds = await client.disputes.list({ charge: c.id, limit: 10 });
          const last = ds.data.slice().sort((a, b) => b.created - a.created)[0];
          disputeStatus = last ? String(last.status) : null;
        }
        return { id: c.id, customerId: idOf(c.customer), amount: c.amount, amountRefunded: c.amount_refunded ?? 0, refunded: !!c.refunded, currency: c.currency.toUpperCase(), invoiceId, disputeStatus };
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async chargeIdOf(objectType, id) {
      try {
        const o = objectType === "refund" ? await client.refunds.retrieve(id) : await client.disputes.retrieve(id);
        assertModeObject(o as { livemode?: unknown }, mode);
        return idOf((o as { charge?: unknown }).charge);
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async listEvents(q) {
      try {
        const page = await client.events.list({ limit: q.limit ?? 100, ...(q.createdGte ? { created: { gte: q.createdGte } } : {}), ...(q.types?.length ? { types: q.types } : {}), ...(q.startingAfter ? { starting_after: q.startingAfter } : {}) });
        return { events: page.data.map(toEvent), hasMore: page.has_more };
      } catch (e) {
        wrapError(e);
      }
    },
    async portalConfigurations() {
      try {
        const list = await client.billingPortal.configurations.list({ limit: 20 });
        return list.data.map((c) => {
          assertModeObject(c as { livemode?: unknown }, mode);
          const f = c.features;
          const su = f.subscription_update as unknown as { enabled: boolean; default_allowed_updates?: string[]; products?: Array<{ product: string; prices: string[] }> | null; proration_behavior?: string | null; schedule_at_period_end?: { conditions?: Array<{ type: string }> } | null };
          return {
            id: c.id,
            isDefault: c.is_default,
            active: c.active,
            invoiceHistory: f.invoice_history.enabled,
            paymentMethodUpdate: f.payment_method_update.enabled,
            customerUpdate: { enabled: f.customer_update.enabled, allowedUpdates: [...(f.customer_update.allowed_updates ?? [])] },
            cancel: { enabled: f.subscription_cancel.enabled, mode: f.subscription_cancel.mode ?? null, prorationBehavior: f.subscription_cancel.proration_behavior ?? null },
            update: {
              enabled: su.enabled,
              defaultAllowedUpdates: [...(su.default_allowed_updates ?? [])],
              products: (su.products ?? []).map((p) => ({ product: p.product, prices: [...p.prices] })),
              prorationBehavior: su.proration_behavior ?? null,
              scheduleAtPeriodEnd: (su.schedule_at_period_end?.conditions ?? []).map((x) => x.type),
            },
            termsUrl: c.business_profile?.terms_of_service_url ?? null,
            privacyUrl: c.business_profile?.privacy_policy_url ?? null,
          } satisfies GwPortalConfig;
        });
      } catch (e) {
        wrapError(e);
      }
    },
    async createPortalSession(input) {
      try {
        const s = await client.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
        assertModeObject(s, mode);
        return { url: s.url };
      } catch (e) {
        wrapError(e);
      }
    },
  };
}

/**
 * Verificación OFICIAL de la firma de un webhook (`stripe.webhooks.constructEvent`) sobre el cuerpo
 * HTTP original, sin reinterpretarlo: admite varios `v1` (rotación del secreto), ignora `v0` y rechaza
 * marcas de tiempo fuera de la tolerancia (300 s) frente a repeticiones. Lanza si la firma no vale.
 * No hace ninguna llamada de red.
 */
export function stripeWebhookVerifier(config: StripeConfig, toleranceSeconds = 300): (rawBody: Buffer, signature: string) => GwEvent {
  const client = new Stripe(config.apiKey, { apiVersion: config.apiVersion as Stripe.LatestApiVersion, telemetry: false });
  return (rawBody, signature) => toEvent(client.webhooks.constructEvent(rawBody, signature, config.webhookSecret, toleranceSeconds) as never);
}
