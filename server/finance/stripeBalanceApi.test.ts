/**
 * Lector de Stripe por API (solo GET) con respuestas sintéticas: misma forma que el informe CSV, payout automático de
 * cada transacción, factura de Stripe del cobro por su PaymentIntent y permisos que faltan sin inventar importes.
 */
import { describe, expect, it } from "vitest";
import { payoutFromApi, StripeApiBalanceReader, txnFromApi } from "./stripeBalanceApi";

type Handler = (url: URL) => { status?: number; body: unknown };
function fakeFetch(h: Handler) {
  const calls: Array<{ url: string; auth: string; method: string }> = [];
  const fetch = async (url: string, init: { headers: Record<string, string>; method?: string }) => {
    calls.push({ url, auth: init.headers.Authorization, method: init.method ?? "GET" });
    const r = h(new URL(url));
    return { status: r.status ?? 200, json: async () => r.body };
  };
  return { fetch, calls };
}

const CREATED = Date.UTC(2026, 10, 1, 8, 7, 29) / 1000;
const bt = { id: "txn_1", object: "balance_transaction", type: "charge", reporting_category: "charge", created: CREATED, available_on: CREATED + 7 * 86_400, currency: "eur", amount: 121_000, fee: 1_840, net: 119_160, description: "Subscription update", source: { id: "ch_1", object: "charge", payment_intent: "pi_1", customer: "cus_1", billing_details: { email: "administracion@example.com" } } };
const payout = { id: "po_1", object: "payout", automatic: true, created: CREATED + 7 * 86_400, arrival_date: CREATED + 9 * 86_400, currency: "eur", amount: 119_160, status: "paid", description: "STRIPE PAYOUT" };
const denied = (perm: string) => ({ status: 403, body: { error: { type: "invalid_request_error", code: "more_permissions_required", message: `Permission denied. The provided key 'rk_x_..abcd' does not have the required permissions for this endpoint. Enabling ${perm === "balance_read" ? "Balance Read" : "Payouts Read"} ('${perm}') permissions on this key would allow this request to continue.` } } });

describe("filas del lector de Stripe", () => {
  it("una transacción de cobro queda igual que una fila del informe (fecha de Madrid, céntimos con signo)", () => {
    expect(txnFromApi(bt, { invoiceOf: new Map([["pi_1", "in_1"]]), payoutOf: new Map([["txn_1", "po_1"]]) })).toEqual({
      balanceTransactionId: "txn_1",
      type: "charge",
      rawType: "charge",
      createdTs: CREATED * 1000,
      createdOn: "2026-11-01",
      availableOn: "2026-11-08",
      currency: "EUR",
      grossCents: 121_000,
      feeCents: 1_840,
      netCents: 119_160,
      sourceId: "ch_1",
      description: "Subscription update",
      customerId: "cus_1",
      customerEmail: "administracion@example.com",
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      stripeInvoiceId: "in_1",
      stripePayoutId: "po_1",
      payoutArrivalOn: null,
    });
  });
  it("una fila de payout lleva su propio id y el payout, su fecha de llegada", () => {
    expect(txnFromApi({ id: "txn_po", type: "payout", reporting_category: "payout", created: CREATED, currency: "eur", amount: -119_160, fee: 0, source: "po_1" })).toMatchObject({ type: "payout", stripePayoutId: "po_1", grossCents: -119_160, netCents: -119_160 });
    expect(payoutFromApi(payout)).toEqual({ payoutId: "po_1", createdOn: "2026-11-08", arrivalOn: "2026-11-10", currency: "EUR", amountCents: 119_160, feeCents: 0, status: "paid", description: "STRIPE PAYOUT" });
  });
});

describe("StripeApiBalanceReader", () => {
  it("sin clave: no configurado, sin llamadas", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    expect(await new StripeApiBalanceReader({ apiKey: "", fetch: f.fetch }).read(0)).toMatchObject({ status: "not_configured", txns: [], payouts: [] });
    expect(f.calls).toHaveLength(0);
  });

  it("sin permisos de lectura de saldo y payouts: lo dice, con los permisos que faltan y sin importes", async () => {
    const f = fakeFetch((u) => (u.pathname.endsWith("/payouts") ? denied("payout_read") : denied("balance_read")));
    const r = await new StripeApiBalanceReader({ apiKey: "rk_prueba", fetch: f.fetch }).read(CREATED - 86_400);
    expect(r).toMatchObject({ status: "permission_missing", txns: [], payouts: [] });
    expect(r.missing.sort()).toEqual(["balance_read", "payout_read"]);
    expect(r.message).not.toMatch(/rk_x_/);
  });

  it("con permisos: lee saldo, payouts, el payout de cada transacción y la factura del cobro; solo GET", async () => {
    const f = fakeFetch((u) => {
      if (u.pathname.endsWith("/payouts")) return { body: { data: [payout], has_more: false } };
      if (u.pathname.endsWith("/balance_transactions") && u.searchParams.get("payout") === "po_1") return { body: { data: [{ id: "txn_1" }], has_more: false } };
      if (u.pathname.endsWith("/balance_transactions")) {
        expect(u.searchParams.get("created[gte]")).toBe(String(CREATED - 86_400));
        // Sin expandir el origen (exigiría el permiso de orígenes): el cargo se lee aparte
        expect(u.searchParams.get("expand[]")).toBeNull();
        return { body: { data: [{ ...bt, source: "ch_1" }], has_more: false } };
      }
      if (u.pathname.endsWith("/charges/ch_1")) return { body: bt.source };
      if (u.pathname.endsWith("/invoice_payments")) {
        expect(u.searchParams.get("payment[payment_intent]")).toBe("pi_1");
        return { body: { data: [{ id: "inpay_1", invoice: "in_1" }] } };
      }
      return { status: 404, body: { error: { message: "no" } } };
    });
    const r = await new StripeApiBalanceReader({ apiKey: "rk_prueba", fetch: f.fetch }).read(CREATED - 86_400);
    expect(r.status).toBe("ok");
    expect(r.txns).toEqual([expect.objectContaining({ balanceTransactionId: "txn_1", stripeInvoiceId: "in_1", stripePayoutId: "po_1", feeCents: 1_840 })]);
    expect(r.payouts).toEqual([expect.objectContaining({ payoutId: "po_1", status: "paid" })]);
    expect(f.calls.every((c) => c.method === "GET" && c.auth === "Bearer rk_prueba")).toBe(true);
  });

  it("pagina con starting_after y se detiene en el tope de páginas", async () => {
    let page = 0;
    const f = fakeFetch((u) => {
      if (u.pathname.endsWith("/payouts")) return { body: { data: [], has_more: false } };
      page++;
      return { body: { data: [{ ...bt, id: `txn_${page}`, source: null }], has_more: true } };
    });
    const r = await new StripeApiBalanceReader({ apiKey: "rk_prueba", fetch: f.fetch, maxPages: 3 }).read(0);
    expect(r).toMatchObject({ status: "ok", truncated: true });
    expect(r.txns.map((x) => x.balanceTransactionId)).toEqual(["txn_1", "txn_2", "txn_3"]);
    expect(f.calls.filter((c) => c.url.includes("starting_after=txn_1"))).toHaveLength(1);
  });

  it("un error de red o de Stripe queda como error, sin lanzar", async () => {
    const f = fakeFetch(() => ({ status: 500, body: { error: { message: "Stripe caído" } } }));
    expect(await new StripeApiBalanceReader({ apiKey: "rk_prueba", fetch: f.fetch }).read(0)).toMatchObject({ status: "error", message: "Stripe caído" });
  });
});
