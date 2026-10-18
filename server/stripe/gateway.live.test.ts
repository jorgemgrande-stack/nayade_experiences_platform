/**
 * Acceso a Stripe en MODO LIVE sin red: el SDK se sustituye por un doble (`vi.mock("stripe")`), porque en
 * live el adaptador no admite otro servidor (`apiBase`). Cada objeto devuelto se comprueba con el modo: en
 * live se aceptan los objetos live y se rechazan los de pruebas, en lectura, creación y listados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StripeConfigError, type StripeConfig } from "./config";

const sdk = vi.hoisted(() => ({ livemode: true, options: [] as unknown[], created: [] as Array<Record<string, unknown>> }));

vi.mock("stripe", () => {
  const obj = (o: Record<string, unknown>) => ({ ...o, livemode: sdk.livemode });
  const session = (p: Record<string, unknown> = {}) => obj({ id: "cs_live_0000000001", object: "checkout.session", status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/x", customer: p.customer ?? "cus_live_1", subscription: null, client_reference_id: p.client_reference_id ?? null, metadata: p.metadata ?? {}, expires_at: 1_900_000_000 });
  class FakeStripe {
    constructor(_key: string, options: unknown) {
      sdk.options.push(options);
    }
    products = { retrieve: async (id: string) => obj({ id, object: "product", name: "Elephant Core Essential", active: true, metadata: {} }) };
    customers = { create: async (p: Record<string, unknown>) => obj({ id: "cus_live_1", object: "customer", metadata: p.metadata }), retrieve: async (id: string) => obj({ id, object: "customer" }) };
    prices = { list: async () => ({ data: [obj({ id: "price_live_1", object: "price", product: "prod_live_1", lookup_key: "k", active: true, currency: "eur", unit_amount: 2900, type: "recurring", recurring: { interval: "month", interval_count: 1 }, tax_behavior: "exclusive", metadata: {} })] }) };
    checkout = {
      sessions: {
        create: async (p: Record<string, unknown>) => (sdk.created.push(p), session(p)),
        retrieve: async () => session(),
        list: async () => ({ data: [session()] }),
        expire: async () => session(),
      },
    };
    subscriptions = { retrieve: async (id: string) => obj({ id, object: "subscription", customer: "cus_live_1", status: "active", items: { data: [] }, metadata: {} }) };
    invoices = { retrieve: async (id: string) => obj({ id, object: "invoice", status: "paid", customer: "cus_live_1", amount_paid: 3509, currency: "eur", subtotal: 2900 }) };
    charges = { retrieve: async (id: string) => obj({ id, object: "charge", customer: "cus_live_1", amount: 3509, amount_refunded: 0, refunded: false, currency: "eur", invoice: "in_live_1", disputed: false }) };
    refunds = { retrieve: async (id: string) => obj({ id, object: "refund", charge: "ch_live_1" }) };
    disputes = { retrieve: async (id: string) => obj({ id, object: "dispute", charge: "ch_live_1" }) };
    billingPortal = { sessions: { create: async () => obj({ id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/x" }) } };
  }
  return { default: FakeStripe };
});

const { stripeGateway } = await import("./gateway");

// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "live", apiKey: ["rk", "live", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "w".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "restricted", namespace: "live", eventsRetentionDays: 180, taxPolicy: "stripe_tax_exclusive" };
const input = { customerId: "cus_live_1", priceId: "price_live_1", clientReferenceId: "es-order-1", metadata: { es_order_id: "1" }, successUrl: "https://web.example/ok", cancelUrl: "https://web.example/ko", expiresAt: 1_900_000_000, integrationIdentifier: "elephant-source-checkout-rqzmvtak" };

describe("acceso a Stripe en modo live (SDK sustituido, sin red)", () => {
  beforeEach(() => {
    sdk.livemode = true;
    sdk.created.length = 0;
  });

  const calls = (gw: ReturnType<typeof stripeGateway>) => [
    () => gw.product("prod_live_1"),
    () => gw.createCustomer({ name: "Empresa", email: null, metadata: {} }, "k1"),
    () => gw.customer("cus_live_1"),
    () => gw.pricesByLookupKeys(["k"]),
    () => gw.createCheckoutSession(input, "k2"),
    () => gw.checkoutSession("cs_live_0000000001"),
    () => gw.sessionsOfCustomer("cus_live_1"),
    () => gw.expireCheckoutSession("cs_live_0000000001"),
    () => gw.subscription("sub_live_1"),
    () => gw.invoice("in_live_1"),
    () => gw.charge("ch_live_1"),
    () => gw.chargeIdOf("refund", "re_live_1"),
    () => gw.chargeIdOf("dispute", "dp_live_1"),
    () => gw.createPortalSession({ customerId: "cus_live_1", returnUrl: "https://app.example/x" }),
  ];

  it("acepta los objetos live en todas las operaciones", async () => {
    const gw = stripeGateway(config);
    for (const c of calls(gw)) await expect(c()).resolves.toBeTruthy();
    // El SDK se crea con la configuración de siempre: sin servidor alternativo
    expect(sdk.options.at(-1)).not.toHaveProperty("host");
  });

  it("rechaza los objetos de pruebas en todas las operaciones (StripeConfigError, no reintentable)", async () => {
    sdk.livemode = false;
    const gw = stripeGateway(config);
    for (const c of calls(gw)) await expect(c()).rejects.toThrow(StripeConfigError);
  });

  it("con la política live, la sesión lleva automatic_tax, NIF y dirección de facturación obligatoria", async () => {
    await stripeGateway(config).createCheckoutSession({ ...input, automaticTax: true, notice: "Aviso" }, "k3");
    expect(sdk.created[0]).toMatchObject({ automatic_tax: { enabled: true }, tax_id_collection: { enabled: true }, billing_address_collection: "required", custom_text: { submit: { message: "Aviso" } } });
  });
});
