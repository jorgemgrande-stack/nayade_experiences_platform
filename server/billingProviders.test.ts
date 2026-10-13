/**
 * Adaptador de pagos: doble candado de cobros, Stripe por HTTP con idempotencia y webhooks
 * firmados, y motor sin cobros (facturas abiertas, sin degradar a nadie).
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { DisabledProvider, StripeProvider, createPaymentProvider } from "./_core/billing/providers";
import { SubscriptionService } from "./_core/billing/service";
import { FakeProvider, MemoryBillingStore, RecordingEffects } from "./_core/billing/memory";
import { DAY, type Catalog } from "./_core/billing/types";

const T0 = Date.UTC(2026, 9, 14, 10);
const SK = "sk_test_abcdef123456";
const WH = "whsec_testsecret";

type Call = { url: string; init: any };
function fakeFetch(plan: Array<{ ok: boolean; status: number; json: any }>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: any) => {
    calls.push({ url, init });
    const r = plan.shift() ?? { ok: false, status: 500, json: {} };
    return { ok: r.ok, status: r.status, json: async () => r.json };
  };
  return { f, calls };
}

describe("fábrica de proveedor", () => {
  it("sin configuración: apagado y sin cobros", () => {
    const c = createPaymentProvider({} as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ kind: "disabled", chargesEnabled: false });
  });

  it("stripe sin autorización explícita no cobra", () => {
    const c = createPaymentProvider({ BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ kind: "stripe", chargesEnabled: false });
    const on = createPaymentProvider({ BILLING_PROVIDER: "stripe", BILLING_CHARGES_ENABLED: "true", STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH } as NodeJS.ProcessEnv);
    expect(on.chargesEnabled).toBe(true);
  });

  it("autorizar cobros sin proveedor sigue sin cobrar; claves incompletas o inválidas fallan", () => {
    expect(createPaymentProvider({ BILLING_CHARGES_ENABLED: "true" } as NodeJS.ProcessEnv).chargesEnabled).toBe(false);
    expect(() => createPaymentProvider({ BILLING_PROVIDER: "stripe" } as NodeJS.ProcessEnv)).toThrow(/requiere/);
    expect(() => new StripeProvider({ secretKey: "no-valida", webhookSecret: WH })).toThrow();
  });
});

describe("StripeProvider", () => {
  it("cobro correcto: clave de idempotencia y metadatos de factura", async () => {
    const { f, calls } = fakeFetch([{ ok: true, status: 200, json: { id: "pi_1", status: "succeeded", latest_charge: "ch_9" } }]);
    const p = new StripeProvider({ secretKey: SK, webhookSecret: WH, fetchImpl: f });
    const r = await p.charge({ customerId: "cus_1", amountCents: 4900, currency: "EUR", idempotencyKey: "charge:inv_1:0", description: "Factura 1", invoiceId: "inv_1" });
    expect(r).toEqual({ ok: true, chargeId: "ch_9" });
    expect(calls[0].init.headers["Idempotency-Key"]).toBe("charge:inv_1:0");
    expect(calls[0].init.body).toContain("metadata%5BinvoiceId%5D=inv_1");
    expect(calls[0].init.body).toContain("amount=4900");
    expect(calls[0].init.body).toContain("currency=eur");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SK}`);
  });

  it("rechazo, error de red y cliente ausente", async () => {
    const declined = fakeFetch([{ ok: false, status: 402, json: { error: { decline_code: "insufficient_funds", payment_intent: { id: "pi_2" } } } }]);
    const p = new StripeProvider({ secretKey: SK, webhookSecret: WH, fetchImpl: declined.f });
    expect(await p.charge({ customerId: "c", amountCents: 1, currency: "EUR", idempotencyKey: "k", description: "d", invoiceId: "i" })).toMatchObject({ ok: false, failure: "insufficient_funds" });
    const net = new StripeProvider({ secretKey: SK, webhookSecret: WH, fetchImpl: async () => { throw new Error("ECONN"); } });
    expect((await net.charge({ customerId: "c", amountCents: 1, currency: "EUR", idempotencyKey: "k", description: "d", invoiceId: "i" })).failure).toBe("network_error");
    expect((await p.charge({ customerId: null, amountCents: 1, currency: "EUR", idempotencyKey: "k", description: "d", invoiceId: "i" })).failure).toBe("no_customer");
  });

  const sign = (body: string, t: number, secret = WH) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const evBody = (type: string) =>
    JSON.stringify({ id: "evt_1", type, created: Math.floor(T0 / 1000), data: { object: { id: "pi_1", latest_charge: "ch_1", metadata: { invoiceId: "inv_7" } } } });

  it("webhook: firma válida, tolerancia y manipulación", () => {
    const p = new StripeProvider({ secretKey: SK, webhookSecret: WH, now: () => T0 });
    const body = evBody("payment_intent.succeeded");
    const t = Math.floor(T0 / 1000);
    expect(p.verifyWebhook(body, sign(body, t))).toMatchObject({ id: "evt_1", type: "payment.succeeded", invoiceId: "inv_7", chargeId: "ch_1" });
    expect(() => p.verifyWebhook(body, sign(body, t, "whsec_otro"))).toThrow(/Firma/);
    expect(() => p.verifyWebhook(body + " ", sign(body, t))).toThrow(/Firma/);
    expect(() => p.verifyWebhook(body, sign(body, t - 3600))).toThrow(/tolerancia/);
    expect(() => p.verifyWebhook(body, "basura")).toThrow();
    expect(p.verifyWebhook(evBody("payment_intent.payment_failed"), sign(evBody("payment_intent.payment_failed"), t)).type).toBe("payment.failed");
  });

  it("DisabledProvider nunca cobra ni acepta webhooks", async () => {
    const d = new DisabledProvider();
    expect((await d.charge()).ok).toBe(false);
    expect(() => d.verifyWebhook()).toThrow();
  });
});

describe("motor con cobros desactivados", () => {
  const catalog: Catalog = {
    trialDays: 15,
    graceDays: 7,
    trial: { maxCustomDomains: 0, integrations: [], quotas: [] },
    plans: [
      { id: "base", name: "Base", kind: "base", interval: "month", priceCents: 4900, currency: "EUR", includedModules: ["cms"], maxCustomDomains: 1, quotas: [] },
      { id: "pro", name: "Pro", kind: "base", interval: "month", priceCents: 9900, currency: "EUR", includedModules: ["cms"], maxCustomDomains: 3, quotas: [] },
    ],
    modules: [{ moduleId: "hotel", interval: "month", priceCents: 1900, currency: "EUR" }],
  };

  function mk() {
    let now = T0;
    const provider = new FakeProvider();
    const store = new MemoryBillingStore();
    const fx = new RecordingEffects();
    const svc = new SubscriptionService({ catalog, store, provider, effects: fx, now: () => now, chargesEnabled: false });
    return { svc, provider, store, fx, advance: (ms: number) => (now += ms) };
  }

  it("contratar emite factura abierta, no cobra y no cambia el estado", async () => {
    const { svc, provider, store } = mk();
    await svc.startTrial({ tenantId: "a", planId: "base" });
    const r = await svc.subscribe("a");
    expect(r).toMatchObject({ paid: false, chargesDisabled: true });
    expect(r.invoice.status).toBe("open");
    expect(provider.charges).toHaveLength(0);
    expect((await store.getSubscriptionByTenant("a"))!.status).toBe("trialing");
  });

  it("la prueba sigue caducando; los periodos activos no se facturan ni se degradan", async () => {
    const { svc, store, fx, advance } = mk();
    await svc.startTrial({ tenantId: "a", planId: "base" });
    advance(16 * DAY);
    expect((await svc.tick()).suspended).toBe(1); // fin de prueba sí se aplica
    expect(fx.status.get("a")).toBe("suspended");

    // una suscripción ya activa (importada) no entra en mora sin cobros
    const sub = (await store.getSubscriptionByTenant("a"))!;
    sub.status = "active";
    sub.currentPeriodEnd = T0;
    await store.putSubscription(sub);
    const r = await svc.tick();
    expect(r).toMatchObject({ renewed: 0, pastDue: 0 });
    expect((await store.getSubscriptionByTenant("a"))!.status).toBe("active");
    expect((await store.listInvoices("a")).length).toBe(0);
  });

  it("cambios que cobran al instante se rechazan", async () => {
    const { svc, store } = mk();
    await svc.startTrial({ tenantId: "a", planId: "base" });
    const sub = (await store.getSubscriptionByTenant("a"))!;
    sub.status = "active";
    await store.putSubscription(sub);
    await expect(svc.changePlan("a", "pro", "now")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.addModule("a", "hotel")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.changePlan("a", "pro", "period_end")).resolves.toBeTruthy(); // diferido sí
  });
});
