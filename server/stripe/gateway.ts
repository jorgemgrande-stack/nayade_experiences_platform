/**
 * Acceso a Stripe detrás de un puerto con SOLO las operaciones que usa Elephant Source. Así:
 *  - las pruebas usan un doble sin red ni claves (`FakeStripeGateway` en `server/stripe/testing.ts`);
 *  - cada objeto devuelto se comprueba con `assertTestObject` (livemode === false) antes de usarse;
 *  - el catálogo NO se escribe desde aquí: Products y Prices los crea una persona (§16.3 de
 *    docs/elephant-source/STRIPE_FASE_A.md); el servicio solo los lee por `lookup_key`.
 *
 * Adaptador real: SDK oficial `stripe` (instancia propia, nunca la clave global), versión de API fijada,
 * reintentos de red del SDK e `Idempotency-Key` en cada creación.
 */
import Stripe from "stripe";
import { assertTestObject, type StripeConfig } from "./config";

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
}

export interface StripeGateway {
  pricesByLookupKeys(keys: string[]): Promise<GwPrice[]>;
  product(id: string): Promise<GwProduct | null>;
  createCustomer(input: { name: string; email: string | null; metadata: Record<string, string> }, idempotencyKey: string): Promise<{ id: string }>;
  customer(id: string): Promise<{ id: string; deleted: boolean } | null>;
  createCheckoutSession(input: CheckoutSessionInput, idempotencyKey: string): Promise<GwCheckoutSession>;
  checkoutSession(id: string): Promise<GwCheckoutSession | null>;
  expireCheckoutSession(id: string): Promise<GwCheckoutSession>;
  subscription(id: string): Promise<GwSubscription | null>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
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

export function toPrice(p: Stripe.Price): GwPrice {
  assertTestObject(p);
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

export function toSession(s: Stripe.Checkout.Session): GwCheckoutSession {
  assertTestObject(s);
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

export function toSubscription(s: Stripe.Subscription): GwSubscription {
  assertTestObject(s);
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

/** Traduce un error del SDK a uno propio sin datos sensibles (solo tipo, código y estado HTTP). */
function wrapError(e: unknown): never {
  const err = e as { type?: string; code?: string; statusCode?: number; name?: string };
  const status = err.statusCode ?? 0;
  const code = err.code || err.type || err.name || "stripe_error";
  const retryable = status === 0 || status === 429 || status >= 500 || err.type === "StripeConnectionError" || err.type === "StripeAPIError";
  throw new StripeGatewayError(String(code).slice(0, 60), `Stripe respondió ${status || "sin conexión"} (${String(code).slice(0, 60)})`, retryable);
}

const notFound = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404;

/** Adaptador con el SDK oficial. Solo se crea con una configuración validada de pruebas. */
export function stripeGateway(config: StripeConfig, o: { timeoutMs?: number; maxNetworkRetries?: number } = {}): StripeGateway {
  const client = new Stripe(config.apiKey, {
    apiVersion: config.apiVersion as Stripe.LatestApiVersion,
    maxNetworkRetries: o.maxNetworkRetries ?? 2,
    timeout: o.timeoutMs ?? 15_000,
    telemetry: false,
    appInfo: { name: "Elephant Source Controlplane" },
  });
  return {
    async pricesByLookupKeys(keys) {
      if (!keys.length) return [];
      const out: GwPrice[] = [];
      try {
        // Stripe admite como máximo 10 lookup_keys por petición
        for (let i = 0; i < keys.length; i += 10) {
          const page = await client.prices.list({ lookup_keys: keys.slice(i, i + 10), limit: 100 });
          out.push(...page.data.map(toPrice));
        }
      } catch (e) {
        wrapError(e);
      }
      return out;
    },
    async product(id) {
      try {
        const p = await client.products.retrieve(id);
        assertTestObject(p);
        return { id: p.id, name: p.name, active: p.active, metadata: meta(p.metadata) };
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async createCustomer(input, idempotencyKey) {
      try {
        const c = await client.customers.create({ name: input.name, ...(input.email ? { email: input.email } : {}), metadata: input.metadata }, { idempotencyKey });
        assertTestObject(c);
        return { id: c.id };
      } catch (e) {
        wrapError(e);
      }
    },
    async customer(id) {
      try {
        const c = await client.customers.retrieve(id);
        assertTestObject(c as { livemode?: unknown });
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
        tax_id_collection: { enabled: true },
        customer_update: { address: "auto", name: "auto" },
        locale: "es",
        integration_identifier: i.integrationIdentifier,
      };
      try {
        return toSession(await client.checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { idempotencyKey }));
      } catch (e) {
        wrapError(e);
      }
    },
    async checkoutSession(id) {
      try {
        return toSession(await client.checkout.sessions.retrieve(id));
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async expireCheckoutSession(id) {
      try {
        return toSession(await client.checkout.sessions.expire(id));
      } catch (e) {
        wrapError(e);
      }
    },
    async subscription(id) {
      try {
        return toSubscription(await client.subscriptions.retrieve(id));
      } catch (e) {
        if (notFound(e)) return null;
        wrapError(e);
      }
    },
    async createPortalSession(input) {
      try {
        const s = await client.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
        assertTestObject(s);
        return { url: s.url };
      } catch (e) {
        wrapError(e);
      }
    },
  };
}
