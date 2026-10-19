import { describe, it, expect, beforeEach } from "vitest";
import type { CatalogPort } from "../subscriptions/ports";
import type { CommercialOrder } from "../orchestrator/types";
import { StripeCatalogError, desiredCatalog, lookupKeyFor, planCatalogWrites, syncCatalog } from "./catalog";
import { INTEGRATION_IDENTIFIER, LIVE_TAX_NOTICE, SESSION_TTL_MS, StripeCheckoutError, StripeCheckoutService, TEST_TAX_NOTICE, checkoutUrlsFromEnv } from "./checkout";
import { StripeConfigError } from "./config";
import { toPrice, toSession, toSubscription, type CheckoutSessionInput } from "./gateway";
import { issuerLine } from "./issuer";
import { MemoryStripeStore, StripeStoreError } from "./store";
import { FakeStripeGateway } from "./testing";
import { toBuyerProfile, type BuyerProfileInput, type FiscalScenario, type TaxTreatment } from "./buyerProfile";

// ── Catálogo aprobado de prueba (ids de web_prices sintéticos) ─────────────────
const P = { essM: 11, essY: 12, busM: 13, busY: 14, entM: 15, entY: 16 };
const price = (id: number, key: string, kind: "monthly" | "yearly", amountCents: number, extra: Record<string, unknown> = {}) => ({
  id, productKey: key, kind, amountCents, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, status: "approved", ...extra,
});
const product = (key: string, prices: unknown[]) => ({ key, name: key, family: "core_plan", technicalStatus: "partial", commercialStatus: "on_request", activationKind: "none", activationRef: null, dependencies: [], compatibleWith: [], bundleOf: [], prices });
const catalogOf = (over: { essM?: Record<string, unknown> } = {}): CatalogPort =>
  ({
    product: async () => null,
    price: async () => null,
    offer: async () => [
      product("essential", [price(P.essM, "essential", "monthly", 2900, over.essM), price(P.essY, "essential", "yearly", 27900)]),
      product("business", [price(P.busM, "business", "monthly", 7900), price(P.busY, "business", "yearly", 75900)]),
      product("enterprise", [price(P.entM, "enterprise", "monthly", 19900), price(P.entY, "enterprise", "yearly", 189900)]),
    ],
  }) as unknown as CatalogPort;

/** Crea en el doble el catálogo exactamente como lo pide el plan de escrituras (lo que haría una persona). */
async function applyPlan(gw: FakeStripeGateway, catalog: CatalogPort) {
  const plan = await planCatalogWrites(await desiredCatalog(catalog), gw);
  const productIds = new Map<string, string>();
  for (const op of plan.operations) {
    if (op.op === "create_product") {
      const id = `prod_test_${op.productKey}`;
      gw.addProduct({ id, name: op.params.name, metadata: op.params.metadata });
      productIds.set(op.productKey, id);
    } else {
      const productId = op.params.product.startsWith("PRODUCT:") ? productIds.get(op.productKey)! : op.params.product;
      gw.addPrice({ id: `price_test_${op.lookupKey.replace(/[^a-z0-9]/g, "")}`, productId, lookupKey: op.params.lookup_key, currency: op.params.currency.toUpperCase(), unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, intervalCount: 1, taxBehavior: "exclusive", metadata: op.params.metadata });
    }
  }
  return plan;
}

describe("catálogo de Stripe", () => {
  it("solo Essential y Business, mensual y anual, con los importes aprobados; Enterprise nunca", async () => {
    const d = await desiredCatalog(catalogOf());
    expect(d.map((x) => [x.productKey, x.kind, x.amountCents, x.interval])).toEqual([
      ["essential", "monthly", 2900, "month"],
      ["essential", "yearly", 27900, "year"],
      ["business", "monthly", 7900, "month"],
      ["business", "yearly", 75900, "year"],
    ]);
    expect(d.every((x) => x.currency === "EUR" && x.lookupKey === lookupKeyFor(x.productKey, x.kind, "EUR", x.webPriceId))).toBe(true);
    expect(d.map((x) => x.productName)).toEqual(["Elephant Core Essential", "Elephant Core Essential", "Elephant Core Business", "Elephant Core Business"]);
  });

  it("productos comprables: solo módulos y ampliaciones «available» con mensual aprobado; el anual solo si existe", async () => {
    const base = await catalogOf().offer();
    const extra = (offer: unknown[]) => ({ product: async () => null, price: async () => null, offer: async () => [...base, ...offer] }) as unknown as CatalogPort;
    const mod = (key: string, family: string, commercialStatus: string, prices: unknown[]) => ({ ...product(key, prices), family, commercialStatus });
    const d = await desiredCatalog(
      extra([
        mod("mod-ok", "extension", "available", [price(21, "mod-ok", "monthly", 1900)]),
        mod("users", "extension", "available", [price(22, "users", "monthly", 500), price(23, "users", "yearly", 5000)]),
        mod("mod-on-request", "extension", "on_request", [price(24, "mod-on-request", "monthly", 900)]),
        mod("mod-soon", "industry_module", "coming_soon", [price(25, "mod-soon", "monthly", 900)]),
        mod("svc", "service", "available", [price(26, "svc", "monthly", 900)]),
      ]),
    );
    expect(d.slice(4).map((x) => [x.productKey, x.kind, x.amountCents, x.productName])).toEqual([
      ["mod-ok", "monthly", 1900, "mod-ok"],
      ["users", "monthly", 500, "users"],
      ["users", "yearly", 5000, "users"],
    ]);
    await expect(desiredCatalog(extra([mod("sin-mensual", "extension", "available", [price(27, "sin-mensual", "yearly", 9000)])]))).rejects.toThrow(/mensual aprobado/);
    const gw = new FakeStripeGateway();
    const plan = await planCatalogWrites(d, gw);
    expect(plan.operations.filter((o) => o.op === "create_product").map((o) => o.productKey)).toEqual(["essential", "business", "mod-ok", "users"]);
  });

  it("rechaza precios con IVA incluido o sin precio aprobado", async () => {
    await expect(desiredCatalog(catalogOf({ essM: { taxIncluded: true } }))).rejects.toThrow(StripeCatalogError);
    await expect(desiredCatalog(catalogOf({ essM: { status: "draft" } }))).rejects.toThrow(/exactamente un precio monthly/);
  });

  it("plan de escrituras: 2 Products y 4 Prices exactos; después vacío (idempotente)", async () => {
    const gw = new FakeStripeGateway();
    const plan = await planCatalogWrites(await desiredCatalog(catalogOf()), gw);
    expect(plan.operations.filter((o) => o.op === "create_product").map((o) => o.params)).toEqual([
      { name: "Elephant Core Essential", metadata: { es_product_key: "essential", es_catalog: "elephant-source" } },
      { name: "Elephant Core Business", metadata: { es_product_key: "business", es_catalog: "elephant-source" } },
    ]);
    const prices = plan.operations.filter((o) => o.op === "create_price");
    expect(prices).toHaveLength(4);
    for (const p of prices) {
      if (p.op !== "create_price") continue;
      expect(p.params).toMatchObject({ currency: "eur", tax_behavior: "exclusive", recurring: { interval_count: 1 }, lookup_key: p.lookupKey });
      expect(p.params.metadata.es_web_price_id).toMatch(/^\d+$/);
      expect(JSON.stringify(p.params)).not.toContain("payment_method_types");
    }
    await applyPlan(gw, catalogOf());
    const again = await planCatalogWrites(await desiredCatalog(catalogOf()), gw);
    expect(again.operations).toEqual([]);
    expect(again.ready).toHaveLength(4);
  });

  it("sincronización solo de lectura: enlaza los 4 y repetirla no duplica", async () => {
    const gw = new FakeStripeGateway();
    await applyPlan(gw, catalogOf());
    const store = new MemoryStripeStore();
    const d = await desiredCatalog(catalogOf());
    const r1 = await syncCatalog(d, gw, store, 1);
    expect(r1.linked).toHaveLength(4);
    expect(r1.missing).toEqual([]);
    const r2 = await syncCatalog(d, gw, store, 2);
    expect(r2.linked).toHaveLength(4);
    expect(store.prices.size).toBe(4);
    expect(gw.calls.some((c) => c.op.endsWith(".create"))).toBe(false);
  });

  it("un Price que no coincide (importe, periodicidad, IVA o producto) nunca se enlaza", async () => {
    const d = await desiredCatalog(catalogOf());
    const cases: Array<Record<string, unknown>> = [{ unitAmount: 2800 }, { interval: "year" }, { taxBehavior: "inclusive" }, { currency: "USD" }, { active: false }];
    for (const over of cases) {
      const gw = new FakeStripeGateway();
      await applyPlan(gw, catalogOf());
      Object.assign(gw.prices[0], over);
      const store = new MemoryStripeStore();
      const r = await syncCatalog(d, gw, store, 1);
      expect(r.conflicts.length).toBe(1);
      expect(r.linked.length).toBe(3);
      expect(store.prices.has(d[0].webPriceId)).toBe(false);
    }
    const gw = new FakeStripeGateway();
    await applyPlan(gw, catalogOf());
    gw.products.get("prod_test_essential")!.metadata.es_product_key = "business";
    expect((await syncCatalog(d, gw, new MemoryStripeStore(), 1)).conflicts.length).toBe(2);
  });

  it("un precio ya enlazado no se reasigna en silencio a otro Price", async () => {
    const store = new MemoryStripeStore();
    await store.upsertPrice({ webPriceId: 11, stripeProductId: "prod_a", stripePriceId: "price_a", lookupKey: "k1", now: 1 });
    await expect(store.upsertPrice({ webPriceId: 11, stripeProductId: "prod_a", stripePriceId: "price_b", lookupKey: "k1", now: 2 })).rejects.toThrow(StripeStoreError);
  });
});

// ── Checkout ─────────────────────────────────────────────────────────────────
const URLS = { success: "https://web.example/contratacion/estado", cancel: "https://web.example/contratacion/cancelada", portalReturn: "https://t1.app.example/admin/suscripcion" };
let clock = Date.UTC(2026, 9, 17, 12);
const quoteOf = (net: number) => ({ catalogVersion: "v", currency: "EUR", contractAmountCents: net, firstPeriodCents: Math.round(net * 1.21), capabilities: [], blocking: [], onRequest: [], contractable: "request" });
const order = (over: Partial<CommercialOrder> = {}): CommercialOrder =>
  ({
    id: 100, reference: "PED-2026-000100", idempotencyKey: "k".repeat(20), payloadHash: "h", kind: "new", state: "contracted", companyId: 7, leadRequestId: null, trialId: null, previousOrderId: null,
    request: { plan: "essential", interval: "month", items: [] }, quote: quoteOf(2900), contractId: 1, subscriptionId: null, tenantId: null, confirmation: null, graceEndsAt: null, attempts: 0, lastError: null, version: 3,
    createdAt: clock, createdBy: "test", updatedAt: null, updatedBy: null, ...over,
  }) as CommercialOrder;

describe("Checkout de un pedido", () => {
  let gw: FakeStripeGateway;
  let store: MemoryStripeStore;
  let orders: Map<number, CommercialOrder>;
  let svc: StripeCheckoutService;

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 17, 12);
    gw = new FakeStripeGateway();
    store = new MemoryStripeStore();
    await applyPlan(gw, catalogOf());
    await syncCatalog(await desiredCatalog(catalogOf()), gw, store, clock);
    orders = new Map([[100, order()], [101, order({ id: 101, request: { plan: "business", interval: "year", items: [] }, quote: quoteOf(75900) })]]);
    const crmStore = {
      get: async (_t: string, id: number) => (id === 7 ? { id: 7, name: "Empresa Demo Stripe", tenantId: "t9-demo" } : null),
      list: async () => [{ id: 1, companyId: 7, email: "contacto@demo.example", status: "active", isPrimary: true }],
    };
    svc = new StripeCheckoutService({ store, gateway: gw, orders: { get: async (id: number) => orders.get(id) ?? null }, crmStore: crmStore as never, catalog: catalogOf(), urls: URLS, now: () => clock });
  });

  it("crea la sesión con el Price enlazado del servidor, metadatos del pedido, URL del entorno y caducidad de 2 h", async () => {
    const s = await svc.start(100, "operator:test");
    expect(s.reused).toBe(false);
    const call = gw.calls.find((c) => c.op === "checkout.sessions.create")!;
    const input = call.input as Record<string, unknown>;
    const link = await store.priceForWebPrice(P.essM);
    expect(input).toMatchObject({
      priceId: link!.stripePriceId,
      clientReferenceId: "es-order-100",
      metadata: { es_order_id: "100", es_company_id: "7", es_tenant_id: "t9-demo" },
      successUrl: `${URLS.success}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: URLS.cancel,
      integrationIdentifier: INTEGRATION_IDENTIFIER,
      expiresAt: Math.floor((clock + SESSION_TTL_MS) / 1000),
    });
    expect(call.key).toBe("es-local-checkout-100-1");
    expect((await store.openSession(100))?.stripeSessionId).toBe(s.sessionId);
  });

  it("empresa sin plataforma: sin un contacto administrador válido no se abre Checkout ni se crea nada en Stripe", async () => {
    const make = (contacts: Array<Record<string, unknown>>) =>
      new StripeCheckoutService({
        store,
        gateway: gw,
        orders: { get: async (id: number) => orders.get(id) ?? null },
        crmStore: { get: async () => ({ id: 7, name: "Empresa Nueva", tenantId: null }), list: async () => contacts } as never,
        catalog: catalogOf(),
        urls: URLS,
        now: () => clock,
      });
    const before = gw.calls.length;
    for (const contacts of [
      [],
      [{ id: 1, companyId: 7, email: "admin@nueva.example", status: "inactive" }],
      [{ id: 2, companyId: 7, email: null, status: "active" }],
      [{ id: 3, companyId: 7, email: "sin-dominio", status: "active" }],
      [{ id: 4, companyId: 7, email: "con espacio@nueva.example", status: "active" }],
    ]) {
      await expect(make(contacts).start(100, "operator:test")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/contacto activo con correo válido/) });
    }
    expect(gw.calls.slice(before).filter((c) => c.op === "customers.create" || c.op === "checkout.sessions.create")).toEqual([]);
    expect(await store.openSession(100)).toBeNull();
    // Con un administrador válido, sí
    const ok = await make([{ id: 5, companyId: 7, email: "admin@nueva.example", status: "active", isPrimary: true }]).start(100, "operator:test");
    expect(ok.sessionId).toBeTruthy();
  });

  it("un Customer por empresa: dos pedidos de la misma empresa comparten cliente", async () => {
    await svc.start(100, "a");
    orders.set(100, { ...orders.get(100)!, state: "cancelled" });
    await svc.start(101, "a");
    expect(gw.customers.size).toBe(1);
    expect(gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(1);
    expect([...gw.customers.values()][0]).toMatchObject({ name: "Empresa Demo Stripe", email: "contacto@demo.example", metadata: { es_company_id: "7", es_tenant_id: "t9-demo" } });
  });

  it("reutiliza la sesión abierta; caducada o a punto de caducar, abre otra con clave nueva", async () => {
    const a = await svc.start(100, "a");
    const b = await svc.start(100, "a");
    expect(b).toMatchObject({ sessionId: a.sessionId, reused: true });
    clock += SESSION_TTL_MS - 5 * 60_000; // quedan 5 min: por debajo del margen
    const c = await svc.start(100, "a");
    expect(c.sessionId).not.toBe(a.sessionId);
    expect(gw.sessions.get(a.sessionId)!.status).toBe("expired");
    expect(gw.calls.filter((x) => x.op === "checkout.sessions.create").map((x) => x.key)).toEqual(["es-local-checkout-100-1", "es-local-checkout-100-2"]);
    expect(await store.countSessions(100)).toBe(2);
  });

  it("dos peticiones simultáneas: una sola sesión abierta (la sobrante se caduca)", async () => {
    const r = await Promise.allSettled([svc.start(100, "a"), svc.start(100, "b")]);
    const open = [...gw.sessions.values()].filter((s) => s.status === "open");
    expect(open).toHaveLength(1);
    expect(r.some((x) => x.status === "fulfilled")).toBe(true);
    expect(await store.openSession(100)).not.toBeNull();
  });

  // ── Regresiones B2 y B9 ──
  /** Simula una caída entre crear la sesión en Stripe y registrarla: Stripe la tiene, la BD no. */
  const orphan = async () => {
    const first = await svc.start(100, "a");
    store.sessions.delete(first.sessionId);
    return first.sessionId;
  };

  it("B2: una sesión huérfana caducada se adopta (cerrada) y se abre otra con una clave nueva", async () => {
    const lost = await orphan();
    clock += SESSION_TTL_MS + 60_000;
    const s = await svc.start(100, "a");
    expect(s.sessionId).not.toBe(lost);
    expect(await store.session(lost)).toMatchObject({ status: "expired", idempotencyKey: `orphan:${lost}` });
    expect(gw.sessions.get(lost)!.status).toBe("expired");
    expect(gw.calls.filter((x) => x.op === "checkout.sessions.create").map((x) => x.key)).toEqual(["es-local-checkout-100-1", "es-local-checkout-100-2"]);
    expect((await store.openSession(100))?.stripeSessionId).toBe(s.sessionId);
  });

  it("B2: la huérfana estaba PAGADA → queda registrada como completada y no se abre otra", async () => {
    const lost = await orphan();
    gw.completeSession(lost);
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await store.session(lost))?.status).toBe("complete");
    expect(await store.hasCompletedSession(100)).toBe(true);
    expect(gw.calls.filter((x) => x.op === "checkout.sessions.create")).toHaveLength(1);
  });

  it("B2: si Stripe aún no lista la huérfana, la clave usada da idempotency_error y se pasa a la siguiente", async () => {
    await orphan();
    gw.hideSessions = true;
    clock += 60_000; // otros parámetros (caducidad) con la misma clave → Stripe la rechaza
    const s = await svc.start(100, "a");
    expect(gw.calls.filter((x) => x.op === "checkout.sessions.create").map((x) => x.key)).toEqual(["es-local-checkout-100-1", "es-local-checkout-100-1", "es-local-checkout-100-2"]);
    expect((await store.openSession(100))?.stripeSessionId).toBe(s.sessionId);
  });

  it("importes: si el Price de Stripe no es el neto del presupuesto (catálogo sin sincronizar), no se abre Checkout", async () => {
    const link = (await store.listPrices()).find((p) => p.webPriceId === P.essM)!;
    gw.prices = gw.prices.map((p) => (p.id === link.stripePriceId ? { ...p, unitAmount: 2500 } : p));
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "conflict" });
    expect(gw.calls.filter((x) => x.op === "checkout.sessions.create")).toHaveLength(0);
  });

  it("B9: con el prefijo del entorno en claves y metadatos, dos entornos no comparten objetos", async () => {
    const crmStore = { get: async () => ({ id: 7, name: "Empresa Demo Stripe", tenantId: "t9-demo" }), list: async () => [] };
    const otherStore = new MemoryStripeStore();
    await syncCatalog(await desiredCatalog(catalogOf()), gw, otherStore, clock);
    const other = new StripeCheckoutService({ store: otherStore, gateway: gw, orders: { get: async (id: number) => orders.get(id) ?? null }, crmStore: crmStore as never, catalog: catalogOf(), urls: URLS, now: () => clock, namespace: "rabc1234" });
    const a = await svc.start(100, "a");
    const b = await other.start(100, "a");
    expect(b.sessionId).not.toBe(a.sessionId);
    const keys = gw.calls.filter((x) => x.op === "checkout.sessions.create" || x.op === "customers.create").map((x) => x.key);
    expect(keys.filter((k) => k!.startsWith("es-rabc1234-"))).toHaveLength(2);
    expect(keys.filter((k) => k!.startsWith("es-local-"))).toHaveLength(2);
    expect(gw.sessions.get(b.sessionId)!.metadata.es_env).toBe("rabc1234");
    expect(gw.customers.size).toBe(2);
  });

  it("importes: el neto del presupuesto debe ser el precio de Stripe; se informa del tratamiento fiscal de pruebas", async () => {
    const s = await svc.start(100, "a");
    expect(s).toMatchObject({ amountCents: 2900, currency: "EUR", taxTreatment: "test_net_no_tax" });
    const input = gw.calls.find((c) => c.op === "checkout.sessions.create")!.input as { metadata: Record<string, string>; notice: string };
    expect(input.metadata.es_tax_treatment).toBe("test_net_no_tax");
    expect(input.notice).toMatch(/sin IVA/);
    // Presupuesto con el IVA sumado al neto (35,09 €) frente a 29,00 € en Stripe: no se abre Checkout
    orders.set(101, order({ id: 101, quote: quoteOf(3509) }));
    await expect(svc.start(101, "a")).rejects.toMatchObject({ code: "conflict" });
    orders.set(100, order({ id: 100, quote: null }));
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("conversión de una prueba: el pedido trial_conversion se paga por Checkout con el tenant de la prueba", async () => {
    orders.set(100, order({ kind: "trial_conversion", trialId: 5, tenantId: "t9-demo" }));
    const s = await svc.start(100, "a");
    expect(gw.sessions.get(s.sessionId)!.metadata).toMatchObject({ es_order_id: "100", es_tenant_id: "t9-demo", es_env: "local" });
  });


  it.each([
    ["pedido inexistente", 999, "not_found"],
    ["pedido no contratado", "quoted", "invalid_state"],
    ["pedido ya confirmado", "confirmed", "invalid_state"],
    ["cambio de plan (va al Portal)", "change", "unsupported"],
    ["Enterprise (propuesta comercial)", "enterprise", "unsupported"],
    ["con complementos", "items", "unsupported"],
    ["con ampliación de usuarios", "users", "unsupported"],
  ])("rechaza: %s", async (_n, variant, code) => {
    if (variant === "quoted") orders.set(100, order({ state: "quoted" }));
    if (variant === "confirmed") orders.set(100, order({ state: "contracted", confirmation: { kind: "payment", ref: "x", actor: "a", reason: null, at: 1 } }));
    if (variant === "change") orders.set(100, order({ kind: "change" }));
    if (variant === "enterprise") orders.set(100, order({ request: { plan: "enterprise", interval: "month", items: [] } }));
    if (variant === "items") orders.set(100, order({ request: { plan: "essential", interval: "month", items: [{ key: "booking-net" }] } }));
    if (variant === "users") orders.set(100, order({ request: { plan: "essential", interval: "month", items: [], users: 9 } as never }));
    const id = typeof variant === "number" ? variant : 100;
    await expect(svc.start(id, "a")).rejects.toMatchObject({ code });
    expect(gw.calls.some((c) => c.op === "checkout.sessions.create")).toBe(false);
  });

  it("sin catálogo sincronizado no se abre Checkout", async () => {
    store.prices.clear();
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("pagada en Stripe: sync copia la suscripción pero NO confirma el pedido (llega con el webhook)", async () => {
    const s = await svc.start(100, "a");
    const subId = gw.completeSession(s.sessionId);
    const r = await svc.sync(s.sessionId);
    expect(r).toMatchObject({ sessionStatus: "complete", paymentStatus: "paid", subscriptionId: subId, subscriptionStatus: "active", orderConfirmed: false });
    expect(orders.get(100)!.state).toBe("contracted");
    expect(await store.subscription(subId)).toMatchObject({ companyId: 7, orderId: 100, status: "active" });
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "invalid_state" });
    expect(gw.calls.filter((c) => c.op === "checkout.sessions.create")).toHaveLength(1);
  });

  it("una sesión cuyos metadatos no son de este pedido se rechaza y no se copia", async () => {
    const s = await svc.start(100, "a");
    gw.sessions.get(s.sessionId)!.metadata.es_order_id = "999";
    await expect(svc.sync(s.sessionId)).rejects.toMatchObject({ code: "conflict" });
  });

  it("Customer Portal: solo con el cliente de la empresa resuelto en el servidor", async () => {
    await expect(svc.portalUrl(7)).rejects.toThrow(StripeCheckoutError);
    await svc.start(100, "a");
    const url = await svc.portalUrl(7);
    expect(url).toContain("cus_test_");
    expect(gw.calls.find((c) => c.op === "billing_portal.sessions.create")!.input).toMatchObject({ returnUrl: URLS.portalReturn });
  });
});

describe("Checkout en modo live", () => {
  let gw: FakeStripeGateway;
  let store: MemoryStripeStore;
  let orders: Map<number, CommercialOrder>;
  const crmStore = {
    get: async (_t: string, id: number) => (id === 7 ? { id: 7, name: "Empresa Live SL", tenantId: "t9-live" } : null),
    list: async () => [{ id: 1, companyId: 7, email: "contacto@live.example", status: "active", isPrimary: true }],
  };
  const make = (over: { mode?: "test" | "live"; taxPolicy?: "test_net_no_tax" | "stripe_tax_exclusive" | null; fiscalScenarios?: Set<FiscalScenario>; taxExpectations?: Map<FiscalScenario, TaxTreatment> } = {}) =>
    new StripeCheckoutService({
      store,
      gateway: gw,
      orders: { get: async (id: number) => orders.get(id) ?? null },
      crmStore: crmStore as never,
      catalog: catalogOf(),
      urls: URLS,
      now: () => clock,
      namespace: "live",
      mode: "live",
      fiscalScenarios: new Set<FiscalScenario>(["business:es_mainland"]),
      taxExpectations: new Map<FiscalScenario, TaxTreatment>([
        ["business:es_mainland", "taxed"],
        ["consumer:es_mainland", "taxed"],
      ]),
      ...over,
    });
  const created = () => gw.calls.filter((c) => c.op === "checkout.sessions.create").map((c) => c.input as CheckoutSessionInput);
  const consentStub = { source: "operator" as const, terms: { version: "v1", at: 1 }, privacy: null, precontract: null, immediateExecution: null, evidence: "0".repeat(16) };
  const saveBuyer = (input: BuyerProfileInput, orderId = 100) => store.saveBuyerProfile(toBuyerProfile(orderId, input, consentStub, clock), "operator:test");
  const BUSINESS_ES: BuyerProfileInput = { type: "business", legalName: "Empresa Live SL", taxId: "B12345678", country: "ES", postalCode: "28002", billingEmail: "facturas@live.example" };

  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 17, 12);
    gw = new FakeStripeGateway();
    gw.livemode = true;
    store = new MemoryStripeStore("live");
    await applyPlan(gw, catalogOf());
    await syncCatalog(await desiredCatalog(catalogOf()), gw, store, clock);
    orders = new Map([[100, order()]]);
    await saveBuyer(BUSINESS_ES);
    gw.calls = [];
  });

  it("perfil fiscal: sin perfil no se abre el pago; con el escenario pendiente tampoco; nada se crea en Stripe", async () => {
    store.buyers.clear();
    await expect(make({ taxPolicy: "stripe_tax_exclusive" }).start(100, "a")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/perfil fiscal/) });
    await saveBuyer({ type: "business", legalName: "Canarias SL", taxId: "B87654321", country: "ES", postalCode: "35001" });
    await expect(make({ taxPolicy: "stripe_tax_exclusive" }).start(100, "a")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/business:es_special/) });
    await expect(make({ taxPolicy: "stripe_tax_exclusive", fiscalScenarios: new Set() }).start(100, "a")).rejects.toMatchObject({ code: "unavailable" });
    expect(created()).toEqual([]);
    expect(gw.customers.size).toBe(0);
  });

  it("impuesto desconocido: un escenario aprobado sin tratamiento del impuesto declarado no se cobra", async () => {
    await expect(make({ taxPolicy: "stripe_tax_exclusive", taxExpectations: new Map() }).start(100, "a")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/tratamiento del impuesto/) });
    await expect(make({ taxPolicy: "stripe_tax_exclusive", taxExpectations: new Map<FiscalScenario, TaxTreatment>([["business:eu", "reverse_charge"]]) }).start(100, "a")).rejects.toMatchObject({ code: "unavailable" });
    expect(created()).toEqual([]);
    expect(gw.customers.size).toBe(0);
  });

  it("empresa: NIF obligatorio en la página de pago, Customer con razón social, correo de facturación y país/CP; metadatos del escenario", async () => {
    await make({ taxPolicy: "stripe_tax_exclusive" }).start(100, "a");
    const [input] = created();
    expect(input.taxIdRequired).toBe(true);
    expect(input.metadata).toMatchObject({ es_tax_expectation: "taxed" });
    expect(input.metadata).toMatchObject({ es_buyer_type: "business", es_fiscal_scenario: "business:es_mainland" });
    const [c] = [...gw.customers.values()];
    expect(c).toMatchObject({ name: "Empresa Live SL", email: "facturas@live.example", address: { country: "ES", postalCode: "28002" }, metadata: { es_buyer_type: "business" } });
  });

  it("particular: sin razón social ni NIF obligatorio; Customer con nombre y apellidos; solo si su escenario está aprobado", async () => {
    await saveBuyer({ type: "consumer", firstName: "Lucía", lastName: "Pérez Gómez", country: "ES", postalCode: "07001" });
    await expect(make({ taxPolicy: "stripe_tax_exclusive" }).start(100, "a")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/consumer:es_mainland/) });
    await make({ taxPolicy: "stripe_tax_exclusive", fiscalScenarios: new Set<FiscalScenario>(["consumer:es_mainland"]) }).start(100, "a");
    const [input] = created();
    expect(input.taxIdRequired).toBeUndefined();
    expect(input.metadata).toMatchObject({ es_buyer_type: "consumer", es_fiscal_scenario: "consumer:es_mainland" });
    const [c] = [...gw.customers.values()];
    expect(c).toMatchObject({ name: "Lucía Pérez Gómez", email: "contacto@live.example", address: { country: "ES", postalCode: "07001" } });
  });

  it("sin política fiscal: se rechaza («Política fiscal pendiente») sin ninguna llamada a Stripe ni nada guardado", async () => {
    for (const svc of [make(), make({ taxPolicy: null }), make({ taxPolicy: "test_net_no_tax" })]) {
      expect(svc.taxPolicy).toBeNull();
      await expect(svc.start(100, "operator:test")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/^Política fiscal pendiente: /) });
    }
    expect(gw.calls).toEqual([]);
    expect(gw.customers.size).toBe(0);
    expect(store.sessions.size).toBe(0);
    expect(store.customers.size).toBe(0);
  });

  it("con stripe_tax_exclusive: automatic_tax activado, NIF y dirección como siempre, metadatos con la política y aviso legal sin «pruebas»", async () => {
    const svc = make({ taxPolicy: "stripe_tax_exclusive" });
    const s = await svc.start(100, "operator:test");
    expect(s).toMatchObject({ amountCents: 2900, currency: "EUR", taxTreatment: "stripe_tax_exclusive", reused: false });
    expect(s.sessionId).toMatch(/^cs_live_/);
    const [input] = created();
    expect(input.automaticTax).toBe(true);
    expect(input.metadata).toMatchObject({ es_order_id: "100", es_env: "live", es_tax_treatment: "stripe_tax_exclusive" });
    expect(input.notice).toBe(LIVE_TAX_NOTICE);
    expect(input.notice).toContain(issuerLine());
    expect(input.notice).not.toMatch(/prueba/i);
    expect(input.notice).toMatch(/no incluyen IVA/);
    expect(input.notice!.length).toBeLessThanOrEqual(1200);
    expect(gw.calls.find((c) => c.op === "checkout.sessions.create")!.key).toBe("es-live-checkout-100-1");
  });

  it("live: la comparación de importes se mantiene y el Price debe ser sin IVA (exclusive)", async () => {
    const svc = make({ taxPolicy: "stripe_tax_exclusive" });
    orders.set(100, order({ quote: quoteOf(3509) }));
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "conflict" });
    orders.set(100, order());
    for (const p of gw.prices) p.taxBehavior = "inclusive";
    await expect(svc.start(100, "a")).rejects.toMatchObject({ code: "conflict", message: expect.stringMatching(/exclusive/) });
    expect(created()).toEqual([]);
  });

  it("pruebas: nada cambia aunque se pase una política live (test_net_no_tax, su aviso y sin automatic_tax)", async () => {
    gw = new FakeStripeGateway();
    store = new MemoryStripeStore();
    await applyPlan(gw, catalogOf());
    await syncCatalog(await desiredCatalog(catalogOf()), gw, store, clock);
    const svc = make({ mode: "test", taxPolicy: "stripe_tax_exclusive" });
    expect(svc.taxPolicy).toBe("test_net_no_tax");
    expect(await svc.start(100, "a")).toMatchObject({ taxTreatment: "test_net_no_tax" });
    const [input] = created();
    expect(input.automaticTax).toBeUndefined();
    expect(input.notice).toBe(TEST_TAX_NOTICE);
    expect(input.metadata.es_tax_treatment).toBe("test_net_no_tax");
    // Y por defecto (sin modo) también es pruebas
    expect(new StripeCheckoutService({ store, gateway: gw, orders: { get: async () => null }, crmStore: crmStore as never, catalog: catalogOf(), urls: URLS }).taxPolicy).toBe("test_net_no_tax");
  });
});

describe("URL de vuelta y objetos de Stripe", () => {
  it("URL solo https sin parámetros; ninguna → Checkout apagado", () => {
    expect(checkoutUrlsFromEnv({})).toBeNull();
    expect(checkoutUrlsFromEnv({ CP_STRIPE_SUCCESS_URL: URLS.success, CP_STRIPE_CANCEL_URL: URLS.cancel, CP_STRIPE_PORTAL_RETURN_URL: URLS.portalReturn })).toEqual(URLS);
    expect(() => checkoutUrlsFromEnv({ CP_STRIPE_SUCCESS_URL: "http://web.example/x", CP_STRIPE_CANCEL_URL: URLS.cancel, CP_STRIPE_PORTAL_RETURN_URL: URLS.portalReturn })).toThrow();
    expect(() => checkoutUrlsFromEnv({ CP_STRIPE_SUCCESS_URL: `${URLS.success}?a=1`, CP_STRIPE_CANCEL_URL: URLS.cancel, CP_STRIPE_PORTAL_RETURN_URL: URLS.portalReturn })).toThrow();
    expect(() => checkoutUrlsFromEnv({ CP_STRIPE_SUCCESS_URL: URLS.success })).toThrow();
  });

  it("cualquier objeto live de Stripe se rechaza al convertirlo", () => {
    const live = { livemode: true } as never;
    expect(() => toPrice(live)).toThrow(StripeConfigError);
    expect(() => toSession(live)).toThrow(StripeConfigError);
    expect(() => toSubscription(live)).toThrow(StripeConfigError);
  });

  it("la suscripción toma el fin de periodo de sus items (API ≥ 2025-03-31)", () => {
    const s = toSubscription({
      id: "sub_test_1", object: "subscription", livemode: false, customer: "cus_test_1", status: "active", cancel_at: null, cancel_at_period_end: false, latest_invoice: "in_test_1", metadata: { es_order_id: "1" },
      items: { data: [{ current_period_end: 100, price: { id: "price_a" } }, { current_period_end: 200, price: { id: "price_b" } }] },
    } as never);
    expect(s).toMatchObject({ currentPeriodEnd: 200, priceIds: ["price_a", "price_b"], customerId: "cus_test_1" });
  });
});
