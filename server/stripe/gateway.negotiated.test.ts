/**
 * Operaciones de Stripe del cobro de condiciones personalizadas con el SDK oficial contra un servidor LOCAL que imita
 * la API (sin red ni claves reales): qué se envía exactamente (precios en línea sobre Products existentes, importes
 * sin impuestos, sin prorrateo, Idempotency-Key) y que cada objeto devuelto se comprueba con el modo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { StripeConfigError, type StripeConfig } from "./config";
import { stripeGateway, toInvoiceItem, toNegotiatedSubscription } from "./gateway";

// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const cfg: StripeConfig = { mode: "test", apiKey: ["rk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "w".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "restricted", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax" };

let livemode = false;
const seen: Array<{ method: string; path: string; body: Record<string, any>; idempotencyKey: string | undefined; version: string | undefined }> = [];
let server: http.Server;
let port = 0;

const subscription = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  object: "subscription",
  livemode,
  customer: "cus_x1",
  status: "active",
  currency: "eur",
  metadata: { es_negotiated: "1", es_env: "local" },
  automatic_tax: { enabled: true },
  cancel_at: null,
  cancel_at_period_end: false,
  default_tax_rates: [],
  schedule: null,
  items: {
    data: [
      { id: "si_1", quantity: 1, current_period_end: 1_900_000_000, metadata: { es_line: "essential" }, tax_rates: [], price: { id: "price_inline_1", product: "prod_essential", unit_amount: 1900, currency: "eur", recurring: { interval: "month", interval_count: 1 } } },
      { id: "si_2", quantity: 2, current_period_end: 1_900_000_500, metadata: {}, tax_rates: [{ percentage: 21 }], price: { id: "price_inline_2", product: { id: "prod_custom" }, unit_amount: 2500, currency: "eur", recurring: { interval: "year", interval_count: 1 } } },
    ],
  },
  ...over,
});

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    seen.push({ method: req.method, path: req.path, body: req.body ?? {}, idempotencyKey: req.header("idempotency-key") ?? undefined, version: req.header("stripe-version") ?? undefined });
    next();
  });
  app.get("/v1/subscriptions/sub_many", (_req, res) => void res.json(subscription("sub_many", { items: { object: "list", has_more: true, data: many.slice(0, 10) }, discounts: ["di_1"], pause_collection: { behavior: "void" }, collection_method: "send_invoice", trial_end: 1_900_000_999 })));
  app.get("/v1/subscriptions/:id", (req, res) => (req.params.id === "sub_missing" ? void res.status(404).json({ error: { type: "invalid_request_error", code: "resource_missing" } }) : void res.json(subscription(req.params.id))));
  const many = Array.from({ length: 11 }, (_, n) => ({ id: `si_m${n + 1}`, object: "subscription_item", quantity: 1, metadata: {}, tax_rates: [], price: { id: `price_m${n + 1}`, product: "prod_custom", unit_amount: 1000 + n, currency: "eur", recurring: { interval: "month", interval_count: 1 } } }));
  app.get("/v1/subscription_items", (req, res) => {
    const after = String(req.query.starting_after ?? "");
    const from = after ? many.findIndex((i) => i.id === after) + 1 : 0;
    const page = many.slice(from, from + 6);
    res.json({ object: "list", url: "/v1/subscription_items", has_more: from + 6 < many.length, data: page.map((i) => ({ ...i, livemode })) });
  });
  app.post("/v1/subscription_items/:id", (req, res) => void res.json({ id: req.params.id, object: "subscription_item", livemode, metadata: req.body.metadata ?? {} }));
  app.post("/v1/subscriptions/:id", (req, res) => void res.json(subscription(req.params.id)));
  const invLines = Array.from({ length: 13 }, (_, n) => ({ id: `il_${n + 1}`, object: "line_item", amount: 100 + n, quantity: 1 }));
  const invoice = (id: string, n: number) => ({ id, object: "invoice", livemode, status: "paid", customer: "cus_x1", amount_paid: 0, currency: "eur", subtotal: 0, lines: { object: "list", has_more: n > 10, data: invLines.slice(0, Math.min(n, 10)) } });
  app.get("/v1/invoices/in_many/lines", (req, res) => {
    const after = String(req.query.starting_after ?? "");
    const from = after ? invLines.findIndex((l) => l.id === after) + 1 : 0;
    res.json({ object: "list", url: "/v1/invoices/in_many/lines", has_more: from + 5 < invLines.length, data: invLines.slice(from, from + 5).map((l) => ({ ...l, livemode })) });
  });
  app.get("/v1/invoices/in_many", (_req, res) => void res.json(invoice("in_many", 13)));
  app.get("/v1/invoices/in_small", (_req, res) => void res.json(invoice("in_small", 2)));
  app.post("/v1/invoiceitems", (req, res) => void res.json({ id: "ii_1", object: "invoiceitem", livemode, amount: Number(req.body.amount), currency: req.body.currency, customer: req.body.customer, invoice: null, metadata: req.body.metadata ?? {}, parent: { type: "subscription_details", subscription_details: { subscription: req.body.subscription } } }));
  app.get("/v1/invoiceitems", (req, res) =>
    void res.json({
      object: "list",
      has_more: false,
      data: [
        { id: "ii_2", object: "invoiceitem", livemode, amount: -2900, currency: "eur", customer: req.query.customer, invoice: "in_9", metadata: { es_key: "credit:7" }, parent: { type: "subscription_details", subscription_details: { subscription: "sub_x1" } } },
        { id: "ii_1", object: "invoiceitem", livemode, amount: 50000, currency: "eur", customer: req.query.customer, invoice: null, metadata: { es_key: "charge:5" }, parent: null },
      ],
    }),
  );
  app.post("/v1/checkout/sessions", (req, res) => void res.json({ id: "cs_x0000000001", object: "checkout.session", livemode, status: "open", payment_status: "unpaid", url: "https://checkout.example/x", customer: req.body.customer, subscription: null, client_reference_id: req.body.client_reference_id, metadata: req.body.metadata ?? {}, expires_at: Number(req.body.expires_at) }));
  await new Promise<void>((r) => (server = app.listen(0, "127.0.0.1", () => r())));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  livemode = false;
  seen.length = 0;
});

const gw = () => stripeGateway(cfg, { maxNetworkRetries: 0, timeoutMs: 5000, apiBase: { host: "127.0.0.1", port, protocol: "http" } });

describe("Stripe: operaciones del cobro de condiciones personalizadas", () => {
  it("lee la suscripción con el detalle de sus partidas (importe, periodicidad, Product, clave e impuestos)", async () => {
    const s = (await gw().negotiatedSubscription!("sub_x1"))!;
    expect(s).toMatchObject({ id: "sub_x1", customerId: "cus_x1", status: "active", currency: "EUR", automaticTax: true, cancelAtPeriodEnd: false, currentPeriodEnd: 1_900_000_500, metadata: { es_negotiated: "1" } });
    expect(s.items).toEqual([
      { id: "si_1", productId: "prod_essential", unitAmount: 1900, quantity: 1, currency: "EUR", interval: "month", intervalCount: 1, metadata: { es_line: "essential" }, taxRateBp: null, taxBehavior: null },
      { id: "si_2", productId: "prod_custom", unitAmount: 2500, quantity: 2, currency: "EUR", interval: "year", intervalCount: 1, metadata: {}, taxRateBp: 2100, taxBehavior: null },
    ]);
    expect(await gw().negotiatedSubscription!("sub_missing")).toBeNull();
    expect(seen.every((r) => r.method === "GET" && r.version === "2026-09-30.endive")).toBe(true);
  });

  it("sustituye partidas con precios EN LÍNEA sobre Products existentes, sin impuestos incluidos y sin prorrateo", async () => {
    await gw().replaceNegotiatedItems!({ subscriptionId: "sub_x1", remove: ["si_1"], add: [{ productId: "prod_essential", unitAmount: 2100, currency: "EUR", interval: "month", metadata: { es_line: "essential", es_env: "local" } }], metadata: { es_terms: "7" } }, "es-local-clave-1");
    const r = seen[0];
    expect(r).toMatchObject({ method: "POST", path: "/v1/subscriptions/sub_x1", idempotencyKey: "es-local-clave-1" });
    expect(r.body.proration_behavior).toBe("none");
    expect(r.body.metadata).toEqual({ es_terms: "7" });
    expect(r.body.items).toEqual([
      { id: "si_1", deleted: "true" },
      { price_data: { currency: "eur", product: "prod_essential", unit_amount: "2100", recurring: { interval: "month" }, tax_behavior: "exclusive" }, quantity: "1", metadata: { es_line: "essential", es_env: "local" } },
    ]);
    // Nada de Prices ni Products: una sola llamada, a la suscripción
    expect(seen.map((x) => x.path)).toEqual(["/v1/subscriptions/sub_x1"]);
    // Ni tipos fijos ni un Price público
    expect(JSON.stringify(r.body)).not.toMatch(/tax_rates|"price":/);
  });

  it("importe único con signo para la próxima factura, sin impuestos incluidos y con su clave", async () => {
    const item = await gw().createInvoiceItem!({ customerId: "cus_x1", subscriptionId: "sub_x1", amount: -2900, currency: "EUR", description: "Descuento de bienvenida", metadata: { es_key: "credit:7", es_env: "local" } }, "es-local-credit-7");
    expect(item).toEqual({ id: "ii_1", amount: -2900, currency: "EUR", subscriptionId: "sub_x1", invoiceId: null, metadata: { es_key: "credit:7", es_env: "local" } });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/invoiceitems", idempotencyKey: "es-local-credit-7" });
    expect(seen[0].body).toEqual({ customer: "cus_x1", subscription: "sub_x1", amount: "-2900", currency: "eur", description: "Descuento de bienvenida", metadata: { es_key: "credit:7", es_env: "local" }, tax_behavior: "exclusive" });
    const list = await gw().invoiceItemsOfCustomer!("cus_x1");
    expect(list.map((i) => [i.id, i.amount, i.invoiceId, i.subscriptionId, i.metadata.es_key])).toEqual([["ii_2", -2900, "in_9", "sub_x1", "credit:7"], ["ii_1", 50000, null, null, "charge:5"]]);
  });

  it("Checkout con partidas negociadas: modo suscripción, precios en línea, Stripe Tax solo si se pide", async () => {
    const input = { customerId: "cus_x1", lines: [{ productId: "prod_essential", unitAmount: 7900, currency: "EUR", interval: "month" as const }, { productId: "prod_custom", unitAmount: 50000, currency: "EUR", interval: null }], clientReferenceId: "es-terms-4", metadata: { es_negotiated: "1", es_terms_subscription: "4", es_env: "local" }, successUrl: "https://web.example/ok", cancelUrl: "https://web.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "elephant-source-checkout-rqzmvtak", notice: "Aviso" };
    const s = await gw().createNegotiatedCheckoutSession!(input, "es-local-terms-checkout-4-1");
    expect(s).toMatchObject({ id: "cs_x0000000001", status: "open", customerId: "cus_x1", clientReferenceId: "es-terms-4" });
    const b = seen[0].body;
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/checkout/sessions", idempotencyKey: "es-local-terms-checkout-4-1" });
    expect(b).toMatchObject({ mode: "subscription", customer: "cus_x1", client_reference_id: "es-terms-4", billing_address_collection: "required", tax_id_collection: { enabled: "true" }, locale: "es", metadata: { es_negotiated: "1", es_terms_subscription: "4" }, subscription_data: { metadata: { es_negotiated: "1", es_terms_subscription: "4", es_env: "local" } } });
    expect(b.line_items).toEqual([
      { price_data: { currency: "eur", product: "prod_essential", unit_amount: "7900", tax_behavior: "exclusive", recurring: { interval: "month" } }, quantity: "1" },
      { price_data: { currency: "eur", product: "prod_custom", unit_amount: "50000", tax_behavior: "exclusive" }, quantity: "1" },
    ]);
    expect(b.automatic_tax).toBeUndefined();
    await gw().createNegotiatedCheckoutSession!({ ...input, automaticTax: true }, "es-local-terms-checkout-4-2");
    expect(seen[1].body.automatic_tax).toEqual({ enabled: "true" });
  });

  it("acuerdo sin plan: UNA partida a medida de 44,63 € (sin IVA, mensual, cantidad 1) con Stripe Tax; sin prueba, sin ancla de ciclo y sin prorrateo", async () => {
    await gw().createNegotiatedCheckoutSession!({ customerId: "cus_x1", lines: [{ productId: "es_terms_custom_service", unitAmount: 4463, currency: "EUR", interval: "month" }], clientReferenceId: "es-terms-9", metadata: { es_negotiated: "1", es_terms_subscription: "9", es_company_id: "3", es_env: "local" }, successUrl: "https://web.example/ok", cancelUrl: "https://web.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "elephant-source-checkout-rqzmvtak", notice: "Aviso", automaticTax: true }, "es-local-terms-checkout-9-1");
    const b = seen[0].body;
    expect(b.line_items).toEqual([{ price_data: { currency: "eur", product: "es_terms_custom_service", unit_amount: "4463", tax_behavior: "exclusive", recurring: { interval: "month" } }, quantity: "1" }]);
    expect(b.automatic_tax).toEqual({ enabled: "true" });
    // El impuesto (9,37 €) y el total (54,00 €) los calcula Stripe Tax: aquí solo viaja el neto, sin tipos fijos
    expect(JSON.stringify(b)).not.toMatch(/tax_rates|5400|937/);
    // La suscripción empieza al pagar, con un primer periodo completo: nada que lo retrase, lo ancle o lo prorratee
    expect(b.subscription_data).toEqual({ metadata: { es_negotiated: "1", es_terms_subscription: "9", es_company_id: "3", es_env: "local" } });
    expect(JSON.stringify(b)).not.toMatch(/trial|billing_cycle_anchor|proration|backdate/);
    expect(b.allowed_payment_method_types).toEqual(["card"]);
    // Nada de plataforma: la sesión cuelga del cliente (empresa) y de la suscripción interna
    expect(JSON.stringify(b)).not.toMatch(/tenant/);
  });

  it("más de 10 partidas: la suscripción solo trae 10 embebidas; se listan TODAS (paginado) y se ven las 11", async () => {
    const s = (await gw().negotiatedSubscription!("sub_many"))!;
    expect(s.items).toHaveLength(11);
    expect(s.items.map((i) => i.id)).toEqual(Array.from({ length: 11 }, (_, n) => `si_m${n + 1}`));
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/subscriptions/sub_many", "GET /v1/subscription_items", "GET /v1/subscription_items"]);
    // Y lo hecho fuera de Elephant que cambia lo que se cobra queda a la vista
    expect(s.anomalies).toEqual(["cupón", "cobro_no_automático"]);
    expect(s.paused).toBe(true);
    expect(s.trialEnd).toBe(1_900_000_999);
  });

  it("poner la clave a una partida es un cambio de SOLO metadatos (ni precio, ni cantidad, sin prorrateo)", async () => {
    await gw().tagSubscriptionItem!("si_1", { es_line: "custom:abc", es_env: "local" }, "es-local-tag-si_1");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/subscription_items/si_1", idempotencyKey: "es-local-tag-si_1" });
    expect(seen[0].body).toEqual({ metadata: { es_line: "custom:abc", es_env: "local" }, proration_behavior: "none" });
  });

  it("la sesión es solo con tarjeta y, si el primer cargo se aplaza al inicio del acuerdo, lleva esa fecha y nada más", async () => {
    const input = { customerId: "cus_x1", lines: [{ productId: "prod_essential", unitAmount: 7900, currency: "EUR", interval: "month" as const }], clientReferenceId: "es-terms-4", metadata: { es_negotiated: "1" }, successUrl: "https://web.example/ok", cancelUrl: "https://web.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "x", notice: "Aviso" };
    await gw().createNegotiatedCheckoutSession!(input, "k-a");
    await gw().createNegotiatedCheckoutSession!({ ...input, trialEnd: 1_900_500_000 }, "k-b");
    expect(seen[0].body.allowed_payment_method_types).toEqual(["card"]);
    expect(seen[0].body.subscription_data).toEqual({ metadata: { es_negotiated: "1" } });
    expect(seen[1].body.subscription_data).toEqual({ metadata: { es_negotiated: "1" }, trial_end: "1900500000" });
    expect(JSON.stringify(seen[1].body)).not.toMatch(/billing_cycle_anchor|proration|backdate/);
  });

  it("cobro en pausa (cuota pactada de 0) y su vuelta: una llamada a la suscripción, con su clave", async () => {
    await gw().setPauseCollection!("sub_x1", true, "es-local-pause-on");
    await gw().setPauseCollection!("sub_x1", false, "es-local-pause-off");
    expect(seen.map((r) => [r.method, r.path, r.idempotencyKey])).toEqual([["POST", "/v1/subscriptions/sub_x1", "es-local-pause-on"], ["POST", "/v1/subscriptions/sub_x1", "es-local-pause-off"]]);
    expect(seen[0].body).toEqual({ pause_collection: { behavior: "void" } });
    expect(seen[1].body).toEqual({ pause_collection: "" });
  });

  it("factura con más de 10 líneas: se marca como truncada y sus importes se leen todos (paginado)", async () => {
    const inv = (await gw().invoice("in_many"))!;
    expect(inv.lines).toHaveLength(10);
    expect(inv.linesTruncated).toBe(true);
    expect(await gw().invoiceLineAmounts!("in_many")).toEqual(Array.from({ length: 13 }, (_, n) => 100 + n));
    expect((await gw().invoice("in_small"))!.linesTruncated).toBe(false);
  });

  it("un objeto del otro modo se rechaza (lectura, escritura, importes y Checkout)", async () => {
    livemode = true;
    await expect(gw().negotiatedSubscription!("sub_x1")).rejects.toThrow(StripeConfigError);
    await expect(gw().replaceNegotiatedItems!({ subscriptionId: "sub_x1", remove: [], add: [], metadata: {} }, "k1")).rejects.toThrow(StripeConfigError);
    await expect(gw().createInvoiceItem!({ customerId: "cus_x1", subscriptionId: "sub_x1", amount: 100, currency: "EUR", description: "x", metadata: {} }, "k2")).rejects.toThrow(StripeConfigError);
    await expect(gw().invoiceItemsOfCustomer!("cus_x1")).rejects.toThrow(StripeConfigError);
    for (const f of [toNegotiatedSubscription, toInvoiceItem] as Array<(o: never, m?: "test" | "live") => unknown>) {
      expect(() => f({ livemode: true } as never)).toThrow(StripeConfigError);
      expect(() => f({ livemode: false } as never, "live")).toThrow(StripeConfigError);
    }
  });
});
