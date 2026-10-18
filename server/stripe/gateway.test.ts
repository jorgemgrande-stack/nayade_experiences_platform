/**
 * Acceso a Stripe con el SDK oficial contra un servidor LOCAL que imita la API (sin red ni claves reales):
 * cada objeto devuelto se comprueba con el modo de la configuración. Un entorno de pruebas rechaza los
 * objetos live y uno live rechaza los de pruebas, en lectura, en creación y en listados.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { StripeConfigError, type StripeConfig } from "./config";
import { stripeGateway, toInvoice, toPrice, toSession, toSubscription } from "./gateway";

// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const cfg = (mode: "test" | "live"): StripeConfig => ({
  mode,
  apiKey: ["rk", mode, "x".repeat(24)].join("_"),
  webhookSecret: ["whsec", "w".repeat(32)].join("_"),
  apiVersion: "2026-09-30.endive",
  keyKind: "restricted",
  namespace: mode === "live" ? "live" : "local",
  eventsRetentionDays: 180,
  taxPolicy: mode === "live" ? "stripe_tax_exclusive" : "test_net_no_tax",
});

/** livemode que devuelve el servidor imitado en cada respuesta. */
let livemode = false;
const created: Array<Record<string, unknown>> = [];
let server: http.Server;
let port = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.get("/v1/products/:id", (req, res) => void res.json({ id: req.params.id, object: "product", livemode, name: "Elephant Core Essential", active: true, metadata: {} }));
  app.post("/v1/customers", (req, res) => void res.json({ id: "cus_x0000000001", object: "customer", livemode, metadata: req.body.metadata ?? {} }));
  app.get("/v1/prices", (_req, res) =>
    void res.json({ object: "list", has_more: false, data: [{ id: "price_x1", object: "price", livemode, product: "prod_x1", lookup_key: "es:essential:monthly:eur:v1", active: true, currency: "eur", unit_amount: 2900, type: "recurring", recurring: { interval: "month", interval_count: 1 }, tax_behavior: "exclusive", metadata: {} }] }),
  );
  app.post("/v1/checkout/sessions", (req, res) => {
    created.push(req.body);
    res.json({ id: "cs_x0000000001", object: "checkout.session", livemode, status: "open", payment_status: "unpaid", url: "https://checkout.example/x", customer: req.body.customer, subscription: null, client_reference_id: req.body.client_reference_id, metadata: req.body.metadata ?? {}, expires_at: Number(req.body.expires_at) });
  });
  await new Promise<void>((r) => (server = app.listen(0, "127.0.0.1", () => r())));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const gw = (mode: "test" | "live") => stripeGateway(cfg(mode), { maxNetworkRetries: 0, timeoutMs: 5000, apiBase: { host: "127.0.0.1", port, protocol: "http" } });
const session = { customerId: "cus_x0000000001", priceId: "price_x1", clientReferenceId: "es-order-1", metadata: { es_order_id: "1" }, successUrl: "https://web.example/ok", cancelUrl: "https://web.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "elephant-source-checkout-rqzmvtak" };

describe("acceso a Stripe según el modo", () => {
  it("modo pruebas: acepta objetos de pruebas y rechaza los live (lectura, creación y listado)", async () => {
    livemode = false;
    expect(await gw("test").product("prod_x1")).toMatchObject({ id: "prod_x1" });
    expect(await gw("test").createCustomer({ name: "Empresa", email: null, metadata: {} }, "k1")).toEqual({ id: "cus_x0000000001" });
    expect(await gw("test").pricesByLookupKeys(["es:essential:monthly:eur:v1"])).toHaveLength(1);
    livemode = true;
    await expect(gw("test").product("prod_x1")).rejects.toThrow(StripeConfigError);
    await expect(gw("test").createCustomer({ name: "Empresa", email: null, metadata: {} }, "k2")).rejects.toThrow(StripeConfigError);
    await expect(gw("test").pricesByLookupKeys(["es:essential:monthly:eur:v1"])).rejects.toThrow(StripeConfigError);
    await expect(gw("test").createCheckoutSession(session, "k3")).rejects.toThrow(StripeConfigError);
  });

  it("en live, apiBase se rechaza: con la clave real nunca se habla con otro servidor (el modo live se prueba en gateway.live.test.ts)", () => {
    expect(() => gw("live")).toThrow(/apiBase solo se admite en modo pruebas/);
    expect(() => stripeGateway(cfg("live"))).not.toThrow();
  });

  it("automatic_tax solo se envía si se pide; sin él, la sesión es la de siempre", async () => {
    livemode = false;
    created.length = 0;
    await gw("test").createCheckoutSession(session, "k7");
    await gw("test").createCheckoutSession({ ...session, automaticTax: true, notice: "Aviso" }, "k8");
    expect(created[0].automatic_tax).toBeUndefined();
    expect(created[1].automatic_tax).toEqual({ enabled: "true" });
    // Recogida de NIF y dirección de facturación obligatoria en los dos casos
    for (const c of created) expect(c).toMatchObject({ billing_address_collection: "required", tax_id_collection: { enabled: "true" } });
  });

  it("los conversores comprueban el modo (por defecto, pruebas)", () => {
    const live = { livemode: true } as never;
    const test = { livemode: false } as never;
    for (const f of [toPrice, toSession, toSubscription, toInvoice] as Array<(o: never, m?: "test" | "live") => unknown>) {
      expect(() => f(live)).toThrow(StripeConfigError);
      expect(() => f(live, "test")).toThrow(StripeConfigError);
      expect(() => f(test, "live")).toThrow(StripeConfigError);
    }
  });
});
