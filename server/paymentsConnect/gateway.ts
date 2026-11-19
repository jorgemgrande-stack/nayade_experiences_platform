/**
 * Pasarela mínima de Stripe Connect para los cobros por empresa. Interfaz inyectable (el doble de pruebas la cumple) y
 * una implementación real con el SDK. Importe, moneda y cuenta los fija SIEMPRE el servidor, nunca el navegador.
 * Los errores no incluyen claves ni datos del cliente.
 */
import Stripe from "stripe";
import type { StripeAccountFacts } from "../../shared/paymentAccounts";
import type { ConnectConfig } from "./config";

export class ConnectGatewayError extends Error {
  constructor(message: string, readonly code: string = "stripe_error") {
    super(message);
    this.name = "ConnectGatewayError";
  }
}

export interface CheckoutParams {
  accountId: string;
  /** Idempotencia: un mismo intento no crea dos sesiones. */
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Metadatos NUESTROS (empresa y presupuesto); el webhook los contrasta con la base de la empresa. */
  metadata: Record<string, string>;
}

export interface ConnectGateway {
  /** Crea la cuenta conectada de la empresa (idempotente por clave). */
  createAccount(p: { tenantId: string; email?: string | null; country: string; idempotencyKey: string }): Promise<{ accountId: string }>;
  /** Enlace de alta/continuación (Account Link): en esa URL la empresa autoriza la conexión en Stripe. */
  createAccountLink(p: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string; expiresAt: number }>;
  retrieveAccount(accountId: string): Promise<StripeAccountFacts>;
  createCheckoutSession(p: CheckoutParams): Promise<{ id: string; url: string }>;
}

export function factsFromStripeAccount(a: Pick<Stripe.Account, "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements">): StripeAccountFacts {
  const r = a.requirements;
  return {
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    detailsSubmitted: !!a.details_submitted,
    requirementsDue: Array.from(new Set([...(r?.currently_due ?? []), ...(r?.past_due ?? [])])),
    disabledReason: r?.disabled_reason ?? null,
  };
}

function wrap(e: unknown): never {
  if (e instanceof ConnectGatewayError) throw e;
  const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : "stripe_error";
  throw new ConnectGatewayError("Stripe rechazó la operación", code);
}

export function stripeConnectGateway(config: ConnectConfig): ConnectGateway {
  const stripe = new Stripe(config.apiKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    async createAccount(p) {
      try {
        const a = await stripe.accounts.create(
          {
            country: p.country,
            email: p.email ?? undefined,
            // La empresa conserva su panel de Stripe completo, paga las comisiones y responde de reembolsos y
            // disputas; Stripe recoge sus datos y verifica la identidad.
            controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            metadata: { tenant_id: p.tenantId },
          },
          { idempotencyKey: p.idempotencyKey },
        );
        return { accountId: a.id };
      } catch (e) {
        return wrap(e);
      }
    },
    async createAccountLink(p) {
      try {
        const l = await stripe.accountLinks.create({ account: p.accountId, type: "account_onboarding", return_url: p.returnUrl, refresh_url: p.refreshUrl });
        return { url: l.url, expiresAt: l.expires_at * 1000 };
      } catch (e) {
        return wrap(e);
      }
    },
    async retrieveAccount(accountId) {
      try {
        return factsFromStripeAccount(await stripe.accounts.retrieve(accountId));
      } catch (e) {
        return wrap(e);
      }
    },
    async createCheckoutSession(p) {
      try {
        const s = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [{ quantity: 1, price_data: { currency: p.currency, unit_amount: p.amountCents, product_data: { name: p.description.slice(0, 250) } } }],
            customer_email: p.customerEmail || undefined,
            success_url: p.successUrl,
            cancel_url: p.cancelUrl,
            client_reference_id: p.metadata.quote_id,
            metadata: p.metadata,
            payment_intent_data: { metadata: p.metadata },
          },
          { stripeAccount: p.accountId, idempotencyKey: p.idempotencyKey },
        );
        if (!s.url) throw new ConnectGatewayError("Stripe no devolvió la dirección de pago", "no_url");
        return { id: s.id, url: s.url };
      } catch (e) {
        return wrap(e);
      }
    },
  };
}

/** Verifica la firma sobre los bytes originales (función oficial del SDK, tolerancia de 300 s). */
export function verifyConnectEvent(config: Pick<ConnectConfig, "webhookSecret">, rawBody: Buffer, signature: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret, 300);
}
