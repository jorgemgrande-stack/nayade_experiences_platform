import { describe, expect, it } from "vitest";
import type { StripeAccountFacts } from "../shared/paymentAccounts";
import type { ConnectConfig } from "./paymentsConnect/config";
import { chooseActiveConfig } from "./paymentsConnect/activeConfig";
import { incidentText } from "./paymentsConnect/incidents";
import { connectAccount, handleConnectEvent, refreshAccount, setOnlineEnabled, startQuoteCheckout, startShopCheckout, type ConnectEvent, type PaymentsDeps } from "./paymentsConnect/service";
import { FakeConnectGateway, FakeQuotes, FakeShop, MemoryAccountIndex, MemoryPaymentStore } from "./paymentsConnect/testing";

const CONFIG: ConnectConfig = { mode: "test", apiKey: "rk_test_" + "b".repeat(24), webhookSecret: "whsec_" + "a".repeat(32) };
const LIVE: ConnectConfig = { mode: "live", apiKey: "rk_live_" + "c".repeat(24), webhookSecret: "whsec_" + "d".repeat(32) };
const ACCT = "acct_1TestQuantum0001";
const OTHER = "acct_1OtraEmpresa0002";
const ORDER = "QSR20261124ABCD";
const PI = "pi_test_refund_1";
const facts: StripeAccountFacts = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirementsDue: [], disabledReason: null };

async function setup() {
  const store = new MemoryPaymentStore();
  const gateway = new FakeConnectGateway(ACCT);
  const quotes = new FakeQuotes({ id: 77, token: "t".repeat(40), total: "250.00", status: "enviado", paidAt: null, validUntil: null, hasPaymentPlan: false, title: "Q", email: "ana@example.com", currency: "EUR" });
  const shop = new FakeShop();
  const d: PaymentsDeps = { store, gateway, config: CONFIG, quotes, shop, index: new MemoryAccountIndex(), tenantId: "quantum", now: () => 1_700_000_000_000 };
  await connectAccount(d, { returnUrl: "https://x/r", refreshUrl: "https://x/f", by: "indira" });
  gateway.accountFacts = facts;
  await refreshAccount(d, "indira");
  await setOnlineEnabled(d, "test", true, "indira");
  return { store, gateway, quotes, shop, d };
}

/** Pedido de la tienda ya pagado (sesión cs_test_1, 25000 céntimos, payment_intent PI). */
async function paidShopOrder() {
  const s = await setup();
  const { sessionId } = await startShopCheckout(s.d, { merchantOrder: ORDER, amountCents: 25000, description: "Curso", successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
  const paid: ConnectEvent = { id: "evt_paid", type: "checkout.session.completed", livemode: false, account: ACCT, data: { object: { id: sessionId, payment_status: "paid", amount_total: 25000, currency: "eur", payment_intent: PI, metadata: { tenant_id: "quantum", merchant_order: ORDER } } } };
  expect(await handleConnectEvent(s.d, paid)).toBe("applied");
  return { ...s, sessionId };
}

const refund = (id: string, refunded: number, over: Record<string, unknown> = {}, account = ACCT): ConnectEvent => ({
  id, type: "charge.refunded", livemode: false, account,
  data: { object: { id: "ch_1", payment_intent: PI, amount: 25000, amount_refunded: refunded, refunded: refunded >= 25000, currency: "eur", ...over } },
});
const dispute = (id: string, type: "charge.dispute.created" | "charge.dispute.closed", status: string, account = ACCT): ConnectEvent => ({
  id, type, livemode: false, account, data: { object: { id: "dp_1", charge: "ch_1", payment_intent: PI, amount: 25000, currency: "eur", status, reason: "fraudulent" } },
});

describe("reembolsos de un pedido de la tienda", () => {
  it("reembolso total: marca el pedido y avisa; no llama a Stripe ni emite nada", async () => {
    const s = await paidShopOrder();
    const calls = s.gateway.calls.length;
    expect(await handleConnectEvent(s.d, refund("evt_r1", 25000))).toBe("refunded");
    expect(s.shop.incidents).toHaveLength(1);
    expect(s.shop.incidents[0]).toMatchObject({ merchantOrder: ORDER, incident: { kind: "refund_full", refundedCents: 25000, chargedCents: 25000, paymentIntent: PI } });
    expect(s.gateway.calls.length).toBe(calls);
    expect((await s.store.getAccount("test"))?.lastEventType).toBe("charge.refunded");
  });
  it("reembolso parcial: queda como parcial", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, refund("evt_r2", 10000))).toBe("partial_refund");
    expect(s.shop.incidents[0].incident).toMatchObject({ kind: "refund_partial", refundedCents: 10000 });
  });
  it("un parcial y después el resto: cada evento es un hecho distinto y el último es total", async () => {
    const s = await paidShopOrder();
    await handleConnectEvent(s.d, refund("evt_r3", 10000));
    expect(await handleConnectEvent(s.d, refund("evt_r4", 25000))).toBe("refunded");
    expect(s.shop.incidents.map((i) => i.incident.kind)).toEqual(["refund_partial", "refund_full"]);
  });
  it("el mismo evento repetido no se aplica dos veces", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, refund("evt_r5", 25000))).toBe("refunded");
    expect(await handleConnectEvent(s.d, refund("evt_r5", 25000))).toBe("duplicate");
    expect(s.shop.incidents).toHaveLength(1);
  });
  it("un evento de otra cuenta queda aislado: ni marca ni rastro", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, refund("evt_ajeno", 25000, {}, OTHER))).toBe("isolated");
    expect(s.shop.incidents).toHaveLength(0);
    expect(s.store.events.has("evt_ajeno")).toBe(false);
  });
  it("un cobro que esta empresa no creó se ignora", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, refund("evt_x", 100, { payment_intent: "pi_desconocido" }))).toBe("ignored");
    expect(s.shop.incidents).toHaveLength(0);
  });
  it("si falla aplicar la marca, el evento se puede reintentar y se aplica entonces", async () => {
    const s = await paidShopOrder();
    s.shop.failIncident = true;
    await expect(handleConnectEvent(s.d, refund("evt_r6", 25000))).rejects.toThrow();
    expect(await handleConnectEvent(s.d, refund("evt_r6", 25000))).toBe("refunded");
    expect(s.shop.incidents).toHaveLength(1);
  });
});

describe("disputas", () => {
  it("abierta, ganada y perdida se traducen a su hecho", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, dispute("evt_d1", "charge.dispute.created", "needs_response"))).toBe("dispute_open");
    expect(await handleConnectEvent(s.d, dispute("evt_d2", "charge.dispute.closed", "won"))).toBe("dispute_won");
    expect(await handleConnectEvent(s.d, dispute("evt_d3", "charge.dispute.closed", "lost"))).toBe("dispute_lost");
    expect(s.shop.incidents.map((i) => i.incident.kind)).toEqual(["dispute_opened", "dispute_won", "dispute_lost"]);
    expect(s.shop.incidents[0].incident.reason).toBe("fraudulent");
  });
  it("una disputa de otra cuenta queda aislada", async () => {
    const s = await paidShopOrder();
    expect(await handleConnectEvent(s.d, dispute("evt_d4", "charge.dispute.created", "needs_response", OTHER))).toBe("isolated");
    expect(s.shop.incidents).toHaveLength(0);
  });
});

describe("presupuestos", () => {
  it("un reembolso de un presupuesto cobrado solo deja constancia (sin tocar el presupuesto)", async () => {
    const s = await setup();
    const { sessionId } = await startQuoteCheckout(s.d, { token: "t".repeat(40), successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    await handleConnectEvent(s.d, { id: "evt_qp", type: "checkout.session.completed", livemode: false, account: ACCT, data: { object: { id: sessionId, payment_status: "paid", amount_total: 25000, currency: "eur", payment_intent: PI, metadata: { tenant_id: "quantum", quote_id: "77" } } } });
    expect(await handleConnectEvent(s.d, refund("evt_qr", 25000))).toBe("refunded");
    expect(s.quotes.incidents).toHaveLength(1);
    expect(s.quotes.incidents[0]).toMatchObject({ quoteId: 77, incident: { kind: "refund_full" } });
    expect(s.shop.incidents).toHaveLength(0);
  });
});

describe("sesión caducada de un pedido", () => {
  it("libera las plazas de inmediato", async () => {
    const s = await setup();
    const { sessionId } = await startShopCheckout(s.d, { merchantOrder: ORDER, amountCents: 25000, description: "Curso", successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    const ev: ConnectEvent = { id: "evt_exp", type: "checkout.session.expired", livemode: false, account: ACCT, data: { object: { id: sessionId } } };
    expect(await handleConnectEvent(s.d, ev)).toBe("applied");
    expect(s.shop.expired).toEqual([ORDER]);
    expect((await s.store.getCheckout(sessionId))?.status).toBe("expired");
    // repetido: no se libera dos veces
    expect(await handleConnectEvent(s.d, ev)).toBe("duplicate");
    expect(s.shop.expired).toHaveLength(1);
  });
  it("una sesión ya pagada no se cancela por un expired tardío", async () => {
    const s = await paidShopOrder();
    const ev: ConnectEvent = { id: "evt_exp2", type: "checkout.session.expired", livemode: false, account: ACCT, data: { object: { id: s.sessionId } } };
    await handleConnectEvent(s.d, ev);
    expect(s.shop.expired).toHaveLength(0);
  });
  it("una sesión de otra cuenta no libera nada", async () => {
    const s = await setup();
    const { sessionId } = await startShopCheckout(s.d, { merchantOrder: ORDER, amountCents: 25000, description: "Curso", successUrl: "https://x/ok", cancelUrl: "https://x/ko" });
    expect(await handleConnectEvent(s.d, { id: "evt_exp3", type: "checkout.session.expired", livemode: false, account: OTHER, data: { object: { id: sessionId } } })).toBe("isolated");
    expect(s.shop.expired).toHaveLength(0);
  });
});

describe("modo Prueba y público", () => {
  it("en production, una empresa autorizada para Real sin cobro real listo no expone Prueba", () => {
    expect(chooseActiveConfig({ live: LIVE, liveReady: false, test: CONFIG, production: true })).toBeNull();
  });
  it("en production, con el cobro real listo se usa Real", () => {
    expect(chooseActiveConfig({ live: LIVE, liveReady: true, test: CONFIG, production: true })).toBe(LIVE);
  });
  it("fuera de production se conserva Prueba", () => {
    expect(chooseActiveConfig({ live: LIVE, liveReady: false, test: CONFIG, production: false })).toBe(CONFIG);
    expect(chooseActiveConfig({ live: null, liveReady: false, test: CONFIG, production: false })).toBe(CONFIG);
  });
  it("una empresa no autorizada para Real mantiene Prueba también en production (sin cambio)", () => {
    expect(chooseActiveConfig({ live: null, liveReady: false, test: CONFIG, production: true })).toBe(CONFIG);
  });
});

describe("texto del aviso", () => {
  it("no promete acciones fiscales automáticas y dice qué hacer", () => {
    const t = incidentText("pedido X", { kind: "refund_full", eventId: "e", sessionId: "s", paymentIntent: PI, chargedCents: 25000, refundedCents: 25000, currency: "eur", reason: null });
    expect(t.title).toContain("reembolso total");
    expect(t.content).toContain("250,00 €");
    expect(t.content).toMatch(/no ha emitido ningún documento/);
  });
});
