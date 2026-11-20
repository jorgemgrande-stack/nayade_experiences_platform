/**
 * Cobros REALES con Stripe Connect (solo empresas autorizadas): configuración, `state` firmado del OAuth, vínculo de la
 * cuenta EXISTENTE (sin crear ninguna), desvinculación y webhook con secretos de Prueba y Real. Sin red ni claves reales:
 * los valores se construyen en tiempo de ejecución y Stripe es un doble.
 */
import { describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { connectLiveConfigFromEnv, liveAllowedFor, type ConnectConfig } from "./paymentsConnect/config";
import { oauthAuthorizeUrl, signOAuthState, verifyOAuthState, OAUTH_STATE_TTL_MS } from "./paymentsConnect/oauthState";
import { connectAccount, handleConnectEvent, linkExistingAccount, PaymentsError, setOnlineEnabled, type ConnectEvent, type PaymentsDeps } from "./paymentsConnect/service";
import { createConnectWebhookRouter, CONNECT_WEBHOOK_PATH } from "./paymentsConnect/webhookRoute";
import { verifyConnectEvent } from "./paymentsConnect/gateway";
import { FakeConnectGateway, FakeQuotes, FakeShop, MemoryAccountIndex, MemoryPaymentStore } from "./paymentsConnect/testing";
import express from "express";

const j = (...p: string[]) => p.join("_");
const LIVE_KEY = j("rk", "live", "A1b2C3d4E5f6G7h8I9j0");
const TEST_KEY = j("rk", "test", "k".repeat(24));
const LIVE_SECRET = j("whsec", "L".repeat(32));
const TEST_SECRET = j("whsec", "T".repeat(32));
const CLIENT = j("ca", "Z9y8X7w6V5u4T3s2R1q0");
const ENV = { CONNECT_STRIPE_LIVE_API_KEY: LIVE_KEY, CONNECT_STRIPE_LIVE_WEBHOOK_SECRET: LIVE_SECRET, CONNECT_STRIPE_LIVE_CLIENT_ID: CLIENT, CONNECT_STRIPE_LIVE_TENANTS: "t12-quantum-soulrise" } as unknown as NodeJS.ProcessEnv;
const LIVE: ConnectConfig = { mode: "live", apiKey: LIVE_KEY, webhookSecret: LIVE_SECRET };
const TEST: ConnectConfig = { mode: "test", apiKey: TEST_KEY, webhookSecret: TEST_SECRET };
const ACCT = "acct_1AsociacionIndira01";

describe("configuración del modo Real", () => {
  it("apagado sin variables; incompleto o inválido falla; válido solo para las empresas listadas", () => {
    expect(connectLiveConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => connectLiveConfigFromEnv({ ...ENV, CONNECT_STRIPE_LIVE_CLIENT_ID: "" } as NodeJS.ProcessEnv)).toThrow(/incompleto/);
    expect(() => connectLiveConfigFromEnv({ ...ENV, CONNECT_STRIPE_LIVE_API_KEY: j("sk", "live", "x".repeat(24)) } as NodeJS.ProcessEnv)).toThrow(/restringida/);
    expect(() => connectLiveConfigFromEnv({ ...ENV, CONNECT_STRIPE_LIVE_API_KEY: TEST_KEY } as NodeJS.ProcessEnv)).toThrow(/restringida/);
    expect(() => connectLiveConfigFromEnv({ ...ENV, CONNECT_STRIPE_LIVE_TENANTS: "*" } as NodeJS.ProcessEnv)).toThrow(/sin comodines/);
    expect(() => connectLiveConfigFromEnv({ ...ENV, CP_STRIPE_API_KEY: LIVE_KEY } as NodeJS.ProcessEnv)).toThrow(/corporativo/);
    const ok = connectLiveConfigFromEnv(ENV)!;
    expect(ok.mode).toBe("live");
    expect(ok.tenants).toEqual(["t12-quantum-soulrise"]);
    expect(liveAllowedFor("t12-quantum-soulrise", ENV)).not.toBeNull();
    expect(liveAllowedFor("otra-empresa", ENV)).toBeNull();
    expect(liveAllowedFor("t12-quantum-soulrise", {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("state firmado del vínculo OAuth", () => {
  const who = { tenantId: "t12-quantum-soulrise", userId: "7" };
  it("vale para esa empresa y ese administrador, caduca y no se puede manipular", () => {
    const s = signOAuthState(who, "secreto-del-servidor", 1000);
    expect(verifyOAuthState(s, "secreto-del-servidor", who, 2000)).toBe(true);
    expect(verifyOAuthState(s, "secreto-del-servidor", { ...who, userId: "8" }, 2000)).toBe(false);
    expect(verifyOAuthState(s, "secreto-del-servidor", { ...who, tenantId: "otra" }, 2000)).toBe(false);
    expect(verifyOAuthState(s, "otro-secreto", who, 2000)).toBe(false);
    expect(verifyOAuthState(s, "secreto-del-servidor", who, 1000 + OAUTH_STATE_TTL_MS + 1)).toBe(false);
    const [body, sig] = s.split(".");
    expect(verifyOAuthState(`${body}x.${sig}`, "secreto-del-servidor", who, 2000)).toBe(false);
    expect(verifyOAuthState("basura", "secreto-del-servidor", who, 2000)).toBe(false);
    expect(verifyOAuthState(s, "", who, 2000)).toBe(false);
  });
  it("la dirección de Stripe lleva el client_id real, scope read_write, el retorno y el state", () => {
    const u = new URL(oauthAuthorizeUrl({ clientId: CLIENT, redirectUri: "https://t12.example/admin/configuracion/cobros", state: "abc" }));
    expect(u.origin + u.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(CLIENT);
    expect(u.searchParams.get("scope")).toBe("read_write");
    expect(u.searchParams.get("redirect_uri")).toBe("https://t12.example/admin/configuracion/cobros");
    expect(u.searchParams.get("state")).toBe("abc");
  });
});

function setup(over: Partial<PaymentsDeps> = {}) {
  const store = new MemoryPaymentStore();
  const gateway = new FakeConnectGateway(ACCT);
  gateway.oauthResult = { accountId: ACCT, livemode: true };
  gateway.accountFacts = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: [], disabledReason: null };
  const index = new MemoryAccountIndex();
  const d: PaymentsDeps = {
    store, gateway, config: LIVE, index, tenantId: "t12-quantum-soulrise", now: () => 1_700_000_000_000,
    quotes: new FakeQuotes({ id: 1, token: "x".repeat(40), total: "10.00", status: "enviado", paidAt: null, validUntil: null, hasPaymentPlan: false, title: "T", email: null, currency: "EUR" }),
    shop: new FakeShop(), ...over,
  };
  return { store, gateway, index, d };
}

describe("vincular la cuenta EXISTENTE (modo Real)", () => {
  it("cambia el código por la cuenta autorizada, la reserva, lee su estado y NO crea ninguna cuenta", async () => {
    const s = setup();
    const a = await linkExistingAccount(s.d, { code: "ac_code_123456", by: "indira" });
    expect(a.accountId).toBe(ACCT);
    expect(a.status).toBe("verificada");
    expect(a.chargesEnabled && a.payoutsEnabled).toBe(true);
    expect(s.gateway.calls).toContain("exchangeOAuthCode:ac_code_123456");
    expect(s.gateway.calls).not.toContain("createAccount");
    expect(await s.index.tenantOf(ACCT)).toBe("t12-quantum-soulrise");
    // Repetir el vínculo con la misma cuenta no duplica nada
    const again = await linkExistingAccount(s.d, { code: "ac_code_654321", by: "indira" });
    expect(again.accountId).toBe(ACCT);
  });
  it("rechaza una cuenta de otro modo, una cuenta de otra empresa y sustituir la ya vinculada", async () => {
    const test = setup();
    test.gateway.oauthResult = { accountId: ACCT, livemode: false };
    await expect(linkExistingAccount(test.d, { code: "ac_code_123456", by: null })).rejects.toMatchObject({ code: "account_conflict" });

    const other = setup();
    await other.index.claim("otra-empresa", "live", ACCT);
    await expect(linkExistingAccount(other.d, { code: "ac_code_123456", by: null })).rejects.toMatchObject({ code: "account_conflict" });
    expect(await other.store.getAccount("live")).toBeNull();

    const linked = setup();
    await linkExistingAccount(linked.d, { code: "ac_code_123456", by: null });
    linked.gateway.oauthResult = { accountId: "acct_1OtraCuentaDistinta", livemode: true };
    await expect(linkExistingAccount(linked.d, { code: "ac_code_654321", by: null })).rejects.toMatchObject({ code: "account_conflict" });
    expect((await linked.store.getAccount("live"))!.accountId).toBe(ACCT);
  });
  it("en modo Real no se crea cuenta (connectAccount) y el vínculo no existe en Prueba", async () => {
    const s = setup();
    await expect(connectAccount(s.d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: null })).rejects.toBeInstanceOf(PaymentsError);
    expect(s.gateway.calls).not.toContain("createAccount");
    const t = setup({ config: TEST });
    await expect(linkExistingAccount(t.d, { code: "ac_code_123456", by: null })).rejects.toBeInstanceOf(PaymentsError);
  });
  it("los cobros en línea solo se encienden con la cuenta verificada y se apagan al desvincularla", async () => {
    const s = setup();
    await linkExistingAccount(s.d, { code: "ac_code_123456", by: "indira" });
    await setOnlineEnabled(s.d, "live", true, "indira");
    expect((await s.store.getAccount("live"))!.onlineEnabled).toBe(true);
    const ev: ConnectEvent = { id: "evt_deauth_1", type: "account.application.deauthorized", livemode: true, account: ACCT, data: { object: { id: "ca_x", name: "Plataforma" } } };
    expect(await handleConnectEvent(s.d, ev)).toBe("applied");
    const a = (await s.store.getAccount("live"))!;
    expect(a.onlineEnabled).toBe(false);
    expect(a.status).toBe("restringida");
    expect(a.disabledReason).toBe("deauthorized");
    // Un evento real nunca se aplica con la configuración de Prueba (y viceversa)
    const t = setup({ config: TEST });
    expect(await handleConnectEvent(t.d, ev)).toBe("mode_mismatch");
  });
});

describe("webhook con secretos de Prueba y Real", () => {
  async function post(app: express.Express, raw: string, sig: string) {
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${CONNECT_WEBHOOK_PATH}`, { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: raw });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
  const stripe = new Stripe(TEST_KEY);

  it("la firma del modo Real se acepta y se aplica con la configuración Real; una firma ajena se rechaza", async () => {
    const s = setup();
    await linkExistingAccount(s.d, { code: "ac_code_123456", by: "indira" });
    const seen: string[] = [];
    const app = express();
    app.use(
      createConnectWebhookRouter({
        configs: () => [TEST, LIVE],
        verify: (cfg, raw, sig) => verifyConnectEvent(cfg, raw, sig) as unknown as ConnectEvent,
        tenantOfAccount: async (a) => (a === ACCT ? "t12-quantum-soulrise" : null),
        tenantAllowed: async () => true,
        runInTenant: (_id, fn) => fn(),
        paymentsFor: (_id, cfg) => {
          seen.push(cfg.mode);
          return { ...s.d, config: cfg };
        },
      }),
    );
    const payload = JSON.stringify({ id: "evt_live_1", object: "event", type: "account.updated", livemode: true, account: ACCT, data: { object: { id: ACCT, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] } } } });
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: LIVE_SECRET });
    const ok = await post(app, payload, good);
    expect(ok.status).toBe(200);
    expect(ok.body.outcome).toBe("applied");
    expect(seen).toEqual(["live"]);
    const bad = stripe.webhooks.generateTestHeaderString({ payload, secret: j("whsec", "X".repeat(32)) });
    expect((await post(app, payload, bad)).status).toBe(400);
  });
});
