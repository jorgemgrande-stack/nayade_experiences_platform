/**
 * Adaptadores de proveedor de pagos y fábrica configurable.
 *
 * Doble candado para cobrar de verdad:
 *   BILLING_PROVIDER=stripe            (qué proveedor)
 *   BILLING_CHARGES_ENABLED=true       (autorización explícita de cobros)
 * Sin ambos, la fábrica devuelve `chargesEnabled: false` y el motor emite facturas sin cobrar.
 *
 * Los adaptadores no usan SDK: HTTP directo con `fetch` inyectable, claves de idempotencia
 * por cobro y verificación HMAC (tiempo constante, con tolerancia) de los webhooks.
 */
import crypto from "node:crypto";
import type { ChargeResult, PaymentProvider, ProviderEvent } from "./ports";
import { BillingError } from "./types";

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

/** Proveedor «apagado»: nunca cobra; los webhooks no se aceptan. */
export class DisabledProvider implements PaymentProvider {
  async charge(): Promise<ChargeResult> {
    return { ok: false, chargeId: "disabled", failure: "charges_disabled" };
  }
  verifyWebhook(): ProviderEvent {
    throw new BillingError("invalid_signature", "Proveedor de pagos no configurado");
  }
  async listCharges() {
    return [];
  }
}

export interface StripeOptions {
  secretKey: string;
  webhookSecret: string;
  fetchImpl?: Fetch;
  now?: () => number;
  /** Tolerancia de marca de tiempo del webhook (s). */
  toleranceSeconds?: number;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

export class StripeProvider implements PaymentProvider {
  private f: Fetch;
  private now: () => number;
  constructor(private o: StripeOptions) {
    if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(o.secretKey)) throw new Error("Clave secreta de Stripe no válida");
    if (!o.webhookSecret.startsWith("whsec_")) throw new Error("Secreto de webhook no válido");
    this.f = o.fetchImpl ?? (fetch as unknown as Fetch);
    this.now = o.now ?? Date.now;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.o.secretKey}`, "Content-Type": "application/x-www-form-urlencoded", ...extra };
  }

  async charge(input: Parameters<PaymentProvider["charge"]>[0]): Promise<ChargeResult> {
    if (!input.customerId) return { ok: false, chargeId: "no_customer", failure: "no_customer" };
    try {
      const r = await this.f("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: this.headers({ "Idempotency-Key": input.idempotencyKey }),
        body: form({
          amount: String(input.amountCents),
          currency: input.currency.toLowerCase(),
          customer: input.customerId,
          confirm: "true",
          off_session: "true",
          description: input.description.slice(0, 200),
          "metadata[invoiceId]": input.invoiceId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.status === "succeeded") return { ok: true, chargeId: String(j.latest_charge ?? j.id) };
      const code = j?.error?.decline_code ?? j?.error?.code ?? j?.status ?? "declined";
      return { ok: false, chargeId: String(j?.error?.payment_intent?.id ?? j?.id ?? "failed"), failure: String(code).slice(0, 60) };
    } catch {
      return { ok: false, chargeId: "network_error", failure: "network_error" };
    }
  }

  verifyWebhook(rawBody: string, signature: string): ProviderEvent {
    const parts = Object.fromEntries(
      signature.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      }),
    ) as Record<string, string>;
    const t = Number(parts.t);
    if (!parts.t || !parts.v1 || !Number.isFinite(t)) throw new BillingError("invalid_signature", "Firma de webhook no válida");
    const age = Math.abs(this.now() / 1000 - t);
    if (age > (this.o.toleranceSeconds ?? 300)) throw new BillingError("invalid_signature", "Webhook fuera de tolerancia");
    const expected = Buffer.from(crypto.createHmac("sha256", this.o.webhookSecret).update(`${parts.t}.${rawBody}`).digest("hex"));
    const got = Buffer.from(parts.v1);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      throw new BillingError("invalid_signature", "Firma de webhook no válida");
    }
    const ev = JSON.parse(rawBody) as { id: string; type: string; created?: number; data?: { object?: any } };
    const obj = ev.data?.object ?? {};
    const invoiceId = String(obj.metadata?.invoiceId ?? "");
    const type =
      ev.type === "payment_intent.succeeded" ? "payment.succeeded" : ev.type === "payment_intent.payment_failed" ? "payment.failed" : null;
    if (!type || !invoiceId) {
      // Evento irrelevante: se acepta y se ignora (no es un error del proveedor)
      return { id: ev.id, type: "payment.failed", invoiceId: "", chargeId: "", at: (ev.created ?? t) * 1000 };
    }
    return { id: ev.id, type, invoiceId, chargeId: String(obj.latest_charge ?? obj.id ?? ""), at: (ev.created ?? t) * 1000 };
  }

  async listCharges(from: number, to: number) {
    const out: Array<{ chargeId: string; invoiceId: string; amountCents: number; ok: boolean }> = [];
    let startingAfter = "";
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(from / 1000)), "created[lt]": String(Math.floor(to / 1000)) });
      if (startingAfter) q.set("starting_after", startingAfter);
      const r = await this.f(`https://api.stripe.com/v1/charges?${q}`, { headers: this.headers() });
      const j = await r.json();
      if (!r.ok) throw new Error("No se pudieron listar los cobros");
      for (const c of j.data ?? []) {
        out.push({ chargeId: c.id, invoiceId: String(c.metadata?.invoiceId ?? ""), amountCents: Number(c.amount), ok: c.status === "succeeded" });
      }
      if (!j.has_more || !j.data?.length) break;
      startingAfter = j.data[j.data.length - 1].id;
    }
    return out;
  }
}

export interface ProviderConfig {
  provider: PaymentProvider;
  chargesEnabled: boolean;
  /** Identificador legible (sin secretos) para diagnóstico. */
  kind: "disabled" | "stripe";
}

export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env, fetchImpl?: Fetch): ProviderConfig {
  const which = (env.BILLING_PROVIDER ?? "").toLowerCase();
  const enabled = env.BILLING_CHARGES_ENABLED === "true";
  if (which === "stripe") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("BILLING_PROVIDER=stripe requiere STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET");
    }
    return {
      provider: new StripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, fetchImpl }),
      chargesEnabled: enabled,
      kind: "stripe",
    };
  }
  return { provider: new DisabledProvider(), chargesEnabled: false, kind: "disabled" };
}
