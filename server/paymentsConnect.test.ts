import { describe, expect, it, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";
import { canEnableOnline, deriveAccountStatus, eurosToCents, type StripeAccountFacts } from "../shared/paymentAccounts";
import { connectConfigFromEnv, type ConnectConfig } from "./paymentsConnect/config";
import { verifyConnectEvent } from "./paymentsConnect/gateway";
import {
  claimedTenantId, connectAccount, handleConnectEvent, PaymentsError, refreshAccount, setOnlineEnabled, startQuoteCheckout,
  type ConnectEvent, type PaymentsDeps,
} from "./paymentsConnect/service";
import { createConnectWebhookRouter, CONNECT_WEBHOOK_PATH } from "./paymentsConnect/webhookRoute";
import { FakeConnectGateway, FakeQuotes, MemoryPaymentStore } from "./paymentsConnect/testing";

const SECRET = "whsec_" + "a".repeat(32);
const CONFIG: ConnectConfig = { mode: "test", apiKey: "rk_test_" + "b".repeat(24), webhookSecret: SECRET };
const ACCT = "acct_1TestQuantum0001";
const OTHER = "acct_1OtraEmpresa0002";
const TOKEN = "t".repeat(40);

const facts = (o: Partial<StripeAccountFacts> = {}): StripeAccountFacts => ({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: [], disabledReason: null, ...o });

function setup(over: { total?: string; plan?: boolean } = {}) {
  const store = new MemoryPaymentStore();
  const gateway = new FakeConnectGateway(ACCT);
  const quotes = new FakeQuotes({ id: 77, token: TOKEN, total: over.total ?? "250.00", status: "enviado", paidAt: null, validUntil: null, hasPaymentPlan: !!over.plan, title: "Quantum — Iniciación", email: "ana@example.com", currency: "EUR" });
  const d: PaymentsDeps = { store, gateway, config: CONFIG, quotes, tenantId: "quantum", now: () => 1_700_000_000_000 };
  return { store, gateway, quotes, d };
}

async function verified(s: ReturnType<typeof setup>) {
  await connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: "indira" });
  s.gateway.accountFacts = facts();
  await refreshAccount(s.d, "indira");
  await setOnlineEnabled(s.d, "test", true, "indira");
}

const completed = (id: string, session: string, account = ACCT, over: Record<string, unknown> = {}): ConnectEvent => ({
  id, type: "checkout.session.completed", livemode: false, account,
  data: { object: { id: session, payment_status: "paid", amount_total: 25000, currency: "eur", payment_intent: "pi_test_1", metadata: { tenant_id: "quantum", quote_id: "77" }, ...over } },
});

describe("estado de la cuenta (derivado de Stripe)", () => {
  it("verificada, pendiente y restringida", () => {
    expect(deriveAccountStatus(facts())).toBe("verificada");
    expect(deriveAccountStatus(facts({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false }))).toBe("pendiente");
    expect(deriveAccountStatus(facts({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true }))).toBe("pendiente");
    expect(deriveAccountStatus(facts({ requirementsDue: ["individual.id_number"] }))).toBe("restringida");
    expect(deriveAccountStatus(facts({ chargesEnabled: false, disabledReason: "rejected.fraud" }))).toBe("restringida");
  });
  it("solo una cuenta verificada puede activar cobros en línea", () => {
    expect(canEnableOnline("verificada")).toBe(true);
    for (const s of ["no_conectada", "pendiente", "restringida"] as const) expect(canEnableOnline(s)).toBe(false);
  });
  it("importes en céntimos sin errores de coma flotante", () => {
    expect(eurosToCents("250.00")).toBe(25000);
    expect(eurosToCents("19.99")).toBe(1999);
    expect(eurosToCents("1.005")).toBe(101);
    expect(Number.isNaN(eurosToCents("abc"))).toBe(true);
  });
});

describe("configuración de Connect (separada del Stripe corporativo)", () => {
  it("apagada sin variables, rechaza live y claves mal formadas", () => {
    expect(connectConfigFromEnv({})).toBeNull();
    expect(() => connectConfigFromEnv({ CONNECT_STRIPE_MODE: "live", CONNECT_STRIPE_API_KEY: "rk_live_" + "x".repeat(20), CONNECT_STRIPE_WEBHOOK_SECRET: SECRET })).toThrow(/no están activados/);
    expect(() => connectConfigFromEnv({ CONNECT_STRIPE_API_KEY: "rk_test_" + "x".repeat(20) })).toThrow(/falta CONNECT_STRIPE_MODE/);
    expect(() => connectConfigFromEnv({ CONNECT_STRIPE_MODE: "test", CONNECT_STRIPE_API_KEY: "no", CONNECT_STRIPE_WEBHOOK_SECRET: SECRET })).toThrow();
    expect(connectConfigFromEnv({ CONNECT_STRIPE_MODE: "test", CONNECT_STRIPE_API_KEY: CONFIG.apiKey, CONNECT_STRIPE_WEBHOOK_SECRET: SECRET })).toEqual(CONFIG);
  });
  it("no lee las variables del Stripe corporativo", () => {
    expect(connectConfigFromEnv({ CP_STRIPE_MODE: "test", CP_STRIPE_API_KEY: "rk_test_" + "x".repeat(20), CP_STRIPE_WEBHOOK_SECRET: SECRET })).toBeNull();
  });
});

describe("conexión de la cuenta", () => {
  it("crea la cuenta una sola vez y devuelve el enlace de alta de Stripe cada vez", async () => {
    const s = setup();
    const a = await connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: "indira" });
    const b = await connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: "indira" });
    expect(a.url).toContain(ACCT);
    expect(b.url).toBe(a.url);
    expect(s.gateway.calls.filter((c) => c === "createAccount")).toHaveLength(1);
    expect((await s.store.getAccount("test"))?.status).toBe("pendiente");
  });
  it("el estado sale de Stripe, no del navegador; perder la verificación apaga el interruptor", async () => {
    const s = setup();
    await verified(s);
    expect((await s.store.getAccount("test"))?.status).toBe("verificada");
    expect((await s.store.getAccount("test"))?.onlineEnabled).toBe(true);
    s.gateway.accountFacts = facts({ chargesEnabled: false, disabledReason: "rejected.fraud" });
    await refreshAccount(s.d, "x");
    const a = await s.store.getAccount("test");
    expect(a?.status).toBe("restringida");
    expect(a?.onlineEnabled).toBe(false);
  });
  it("no se puede encender el interruptor sin cuenta verificada", async () => {
    const s = setup();
    await connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: null });
    await expect(setOnlineEnabled(s.d, "test", true, null)).rejects.toMatchObject({ code: "cannot_enable" });
  });
});

describe("sesión de pago de un presupuesto", () => {
  it("sin cuenta verificada y cobros activados no se crea ninguna sesión", async () => {
    const s = setup();
    const go = () => startQuoteCheckout(s.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    await expect(go()).rejects.toMatchObject({ code: "not_connected" });
    await connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: null });
    await expect(go()).rejects.toMatchObject({ code: "not_verified" });
    s.gateway.accountFacts = facts();
    await refreshAccount(s.d, null);
    await expect(go()).rejects.toMatchObject({ code: "online_disabled" });
    expect(s.gateway.sessions).toHaveLength(0);
  });
  it("importe y moneda salen del presupuesto, en la cuenta de la empresa, con metadatos de empresa y presupuesto", async () => {
    const s = setup({ total: "250.00" });
    await verified(s);
    const r = await startQuoteCheckout(s.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    expect(r.url).toContain("checkout.stripe.test");
    expect(s.gateway.sessions[0]).toMatchObject({ accountId: ACCT, amountCents: 25000, currency: "eur", metadata: { tenant_id: "quantum", quote_id: "77" } });
    expect((await s.store.getCheckout(r.sessionId))?.status).toBe("pending");
  });
  it("rechaza presupuestos pagados, rechazados, caducados y con plan de pagos", async () => {
    const run = async (mut: (q: FakeQuotes) => void, plan = false) => {
      const s = setup({ plan });
      await verified(s);
      mut(s.quotes);
      return startQuoteCheckout(s.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    };
    await expect(run((q) => (q.quote.paidAt = new Date()))).rejects.toBeInstanceOf(PaymentsError);
    await expect(run((q) => (q.quote.status = "rechazado"))).rejects.toBeInstanceOf(PaymentsError);
    await expect(run((q) => (q.quote.validUntil = new Date(1_600_000_000_000)))).rejects.toBeInstanceOf(PaymentsError);
    await expect(run(() => undefined, true)).rejects.toMatchObject({ code: "unsupported_quote" });
    await expect(run((q) => (q.quote.total = "0.00"))).rejects.toMatchObject({ code: "bad_amount" });
  });
});

describe("eventos firmados de Stripe", () => {
  async function withSession() {
    const s = setup();
    await verified(s);
    const r = await startQuoteCheckout(s.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    return { ...s, session: r.sessionId };
  }

  it("la vuelta del navegador no paga: sin evento, el presupuesto sigue pendiente", async () => {
    const s = await withSession();
    expect(s.quotes.paid).toHaveLength(0);
    expect((await s.store.getCheckout(s.session))?.status).toBe("pending");
  });
  it("el evento válido registra el pago y lo aplica al presupuesto una sola vez", async () => {
    const s = await withSession();
    expect(await handleConnectEvent(s.d, completed("evt_1", s.session))).toBe("applied");
    expect(s.quotes.paid).toEqual([{ quoteId: 77, reference: "stripe:pi_test_1" }]);
    expect((await s.store.getCheckout(s.session))?.status).toBe("paid");
    expect((await s.store.getAccount("test"))?.lastEventType).toBe("checkout.session.completed");
  });
  it("un evento repetido (mismo id) o reenviado con otro id no se aplica dos veces", async () => {
    const s = await withSession();
    await handleConnectEvent(s.d, completed("evt_1", s.session));
    expect(await handleConnectEvent(s.d, completed("evt_1", s.session))).toBe("duplicate");
    expect(await handleConnectEvent(s.d, completed("evt_2", s.session))).toBe("duplicate");
    expect(await handleConnectEvent(s.d, { ...completed("evt_3", s.session), type: "checkout.session.async_payment_succeeded" })).toBe("duplicate");
    expect(s.quotes.paid).toHaveLength(1);
  });
  it("un evento de otra cuenta queda aislado: sin pago, sin rastro", async () => {
    const s = await withSession();
    expect(await handleConnectEvent(s.d, completed("evt_x", s.session, OTHER))).toBe("isolated");
    expect(s.quotes.paid).toHaveLength(0);
    expect((await s.store.getCheckout(s.session))?.status).toBe("pending");
    expect(s.store.events.has("evt_x")).toBe(false);
    // …y un evento de la cuenta correcta con una sesión que esta empresa no creó tampoco hace nada
    expect(await handleConnectEvent(s.d, completed("evt_y", "cs_test_ajena"))).toBe("isolated");
    expect(s.quotes.paid).toHaveLength(0);
  });
  it("sin pagar realmente (payment_status distinto de paid) o con importe distinto, no se aplica", async () => {
    const s = await withSession();
    expect(await handleConnectEvent(s.d, completed("evt_u", s.session, ACCT, { payment_status: "unpaid" }))).toBe("ignored");
    expect(await handleConnectEvent(s.d, completed("evt_m", s.session, ACCT, { amount_total: 100 }))).toBe("amount_mismatch");
    expect(s.quotes.paid).toHaveLength(0);
  });
  it("un evento de otro modo (live) no se atiende", async () => {
    const s = await withSession();
    expect(await handleConnectEvent(s.d, { ...completed("evt_l", s.session), livemode: true })).toBe("mode_mismatch");
    expect(s.quotes.paid).toHaveLength(0);
  });
  it("si falla aplicar el pago, el evento se puede reintentar y se aplica entonces una sola vez", async () => {
    const s = await withSession();
    s.quotes.failNext = true;
    await expect(handleConnectEvent(s.d, completed("evt_r", s.session))).rejects.toThrow();
    expect((await s.store.getCheckout(s.session))?.status).toBe("pending");
    expect(await handleConnectEvent(s.d, completed("evt_r", s.session))).toBe("applied");
    expect(await handleConnectEvent(s.d, completed("evt_r", s.session))).toBe("duplicate");
    expect(s.quotes.paid).toHaveLength(1);
  });
  it("account.updated actualiza el estado; la sesión expirada se marca", async () => {
    const s = await withSession();
    const upd: ConnectEvent = { id: "evt_a", type: "account.updated", livemode: false, account: ACCT, data: { object: { id: ACCT, charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { currently_due: ["x"], disabled_reason: "requirements.past_due" } } } };
    expect(await handleConnectEvent(s.d, upd)).toBe("applied");
    expect((await s.store.getAccount("test"))?.status).toBe("restringida");
    expect((await s.store.getAccount("test"))?.onlineEnabled).toBe(false);
    expect(await handleConnectEvent(s.d, { ...completed("evt_e", s.session), type: "checkout.session.expired" })).toBe("applied");
    expect((await s.store.getCheckout(s.session))?.status).toBe("expired");
  });
  it("la empresa se toma del metadato, y solo si es válido", () => {
    expect(claimedTenantId(completed("e", "cs"))).toBe("quantum");
    expect(claimedTenantId({ ...completed("e", "cs"), data: { object: { metadata: { tenant_id: "../x" } } } })).toBeNull();
    expect(claimedTenantId({ ...completed("e", "cs"), data: { object: {} } })).toBeNull();
  });
});

describe("receptor HTTP del webhook (firma real del SDK de Stripe)", () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  async function boot(tenants: Record<string, ReturnType<typeof setup>>) {
    const app = express();
    app.use(
      createConnectWebhookRouter(
        {
          config: () => CONFIG,
          tenantAllowed: async (id) => id in tenants,
          runInTenant: (_id, fn) => fn(),
          paymentsFor: (id) => tenants[id].d,
        },
        { perIpMinute: 1000 },
      ),
    );
    app.use(express.json());
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CONNECT_WEBHOOK_PATH}`;
    const post = (body: string, signature?: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}) }, body });
    const signed = (ev: ConnectEvent) => {
      const body = JSON.stringify(ev);
      return { body, sig: Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) };
    };
    return { post, signed };
  }

  it("firma válida con el SDK; inválida o ausente = 400 sin efecto", async () => {
    const t = setup();
    await verified(t);
    const r = await startQuoteCheckout(t.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    const { post, signed } = await boot({ quantum: t });
    const ev = completed("evt_h1", r.sessionId);
    const { body, sig } = signed(ev);
    expect((await post(body)).status).toBe(400);
    expect((await post(body, "t=1,v1=deadbeef")).status).toBe(400);
    expect((await post(body + " ", sig)).status).toBe(400);
    expect(t.quotes.paid).toHaveLength(0);
    const ok = await post(body, sig);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ outcome: "applied" });
    // Stripe reintenta la misma entrega: 200 y sin duplicar
    expect(await (await post(body, sig)).json()).toMatchObject({ outcome: "duplicate" });
    expect(t.quotes.paid).toHaveLength(1);
  });

  it("aislamiento entre empresas: una dice ser dueña del evento de la cuenta de otra y no se aplica nada", async () => {
    const quantum = setup();
    await verified(quantum);
    const q = await startQuoteCheckout(quantum.d, { token: TOKEN, successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    const otra = setup();
    otra.gateway = new FakeConnectGateway(OTHER);
    otra.d.gateway = otra.gateway;
    await verified(otra);
    const { post, signed } = await boot({ quantum, otra });
    // Evento de la cuenta de «otra» que reclama pertenecer a «quantum» (metadato manipulado)
    const forged = completed("evt_f", q.sessionId, OTHER);
    const { body, sig } = signed(forged);
    expect(await (await post(body, sig)).json()).toMatchObject({ outcome: "isolated" });
    expect(quantum.quotes.paid).toHaveLength(0);
    expect(otra.quotes.paid).toHaveLength(0);
    expect((await quantum.store.getCheckout(q.sessionId))?.status).toBe("pending");
  });

  it("empresa desconocida: 200 sin efecto; modo equivocado: sin efecto", async () => {
    const t = setup();
    await verified(t);
    const { post, signed } = await boot({ quantum: t });
    const ghost = completed("evt_g", "cs_x");
    ghost.data.object.metadata = { tenant_id: "fantasma", quote_id: "1" };
    const a = signed(ghost);
    expect(await (await post(a.body, a.sig)).json()).toMatchObject({ ignored: "unknown_tenant" });
    const live = signed({ ...completed("evt_lv", "cs_x"), livemode: true });
    expect(await (await post(live.body, live.sig)).json()).toMatchObject({ outcome: "mode_mismatch" });
  });

  it("la verificación usa el secreto del destino Connect", () => {
    const body = JSON.stringify(completed("evt_v", "cs"));
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
    expect(verifyConnectEvent(CONFIG, Buffer.from(body), sig).id).toBe("evt_v");
    expect(() => verifyConnectEvent({ webhookSecret: "whsec_" + "z".repeat(32) }, Buffer.from(body), sig)).toThrow();
  });
});
