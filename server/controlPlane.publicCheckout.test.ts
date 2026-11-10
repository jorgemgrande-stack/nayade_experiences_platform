/**
 * Checkout unificado de la web pública (decisión de Jorge del 10/11/2026): plan Elephant Core obligatorio + soluciones
 * Net y extensiones Connect habilitadas para la compra en línea, en UNA Checkout Session y una suscripción de Stripe.
 * De punta a punta por HTTP con la aplicación REAL del plano de control (autoservicio, orquestador, suscripciones,
 * licencias y procesador de eventos reales); Stripe es un doble y la firma del webhook es la real del SDK.
 *
 * Casos: oferta y lista blanca; presupuesto del servidor (88 € = Essential 29 € + Social Token Net 59 €); plan ausente,
 * producto no habilitado, heredado o «bajo solicitud», paquete con su componente; importes en el cuerpo; Price
 * manipulado en Stripe; doble clic y reintentos; misma clave con otro carrito; licencias solo tras el pago verificado;
 * webhook duplicado y fuera de orden; aislamiento entre empresas; interruptor apagado (404).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { createContractActivation } from "./crm/activation";
import { issueTicket } from "./crm/publicApi";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { catalogFromWebStore } from "./subscriptions/ports";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryOrderStore } from "./orchestrator/store";
import type { TrialNotifier } from "./trials/onboarding";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent, type CheckoutSessionInput } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryInvoiceLineStore } from "./stripe/invoiceLines";
import { NET_LEGACY_KEYS } from "../shared/netProducts";
import { publicCheckoutProductsFromEnv } from "./stripe/publicCart";

const ADMIN = "pubcheckout-admin-token-aaaaaaaaaaaaaaaaa";
const WEB = "https://web.example";
const SECRET = "p".repeat(48);
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "y".repeat(24)].join("_"), webhookSecret: ["whsec", "d".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

/** «available» solo en esta prueba (en production lo publica el CRM). */
const FOR_SALE = ["essential", "business", "social-token-net-communities", "social-token-net-tokens", "social-token-net-complete", "connect-people", "connect-tax", "connect-pack-finance", "connect-geo-control"];
const LEGACY_NET = NET_LEGACY_KEYS[0];
/**
 * Lista blanca: connect-geo-control está a la venta pero NO en la lista; connect-deals está en la lista pero «bajo
 * solicitud»; social-token-net-communities es una antigua extensión de Net (heredada).
 */
const ALLOWED = new Set(["social-token-net-complete", "social-token-net-communities", "connect-people", "connect-tax", "connect-pack-finance", "connect-deals", "connect-partners", "connect-finance-sync", LEGACY_NET]);

let clock = Date.UTC(2026, 10, 10, 9);
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };

const parse = (b: string) => {
  try {
    return b ? JSON.parse(b) : null;
  } catch {
    return null;
  }
};
type Res = { status: number; json: any; raw: string };
interface Env {
  port: number;
  server: http.Server;
  gw: FakeStripeGateway;
  crmStore: MemoryCrmStore;
  orders: MemoryOrderStore;
  stripeStore: MemoryStripeStore;
  caps: MemoryCapabilityStore;
  webStore: MemoryWebStore;
}

async function boot(opts: { selfService: boolean; allowed?: ReadonlySet<string> }): Promise<Env> {
  const caps = new MemoryCapabilityStore();
  const crmStore = new MemoryCrmStore();
  const webStore = new MemoryWebStore();
  const orders = new MemoryOrderStore();
  const gw = new FakeStripeGateway();
  const stripeStore = new MemoryStripeStore();
  const registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
    schema: { apply: async () => ({ baselineVersion: "0000_baseline", schemaVersion: "0000_baseline" }) },
    seeder: { seedAdmin: async () => ({ created: true, inviteToken: crypto.randomBytes(8).toString("hex") }), seedBranding: async () => undefined },
    entitlements: { grant: async () => undefined },
    quotas: { set: async () => undefined },
    store: new MemoryProvisioningStore(),
    now: () => clock,
    sleep: async () => undefined,
  });
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  const publish = async (k: string, change: (c: Record<string, unknown>) => void) => {
    const { entry: e } = await web.get("product", k);
    const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
    draft.technicalStatus = "available";
    draft.catalog = { ...(draft.catalog ?? {}) };
    change(draft.catalog);
    const saved = await web.save("product", k, { draft, expectedVersion: e.draftVersion }, "operator:test");
    await web.publish("product", k, saved.draftVersion, "operator:test");
  };
  const sell = (c: Record<string, unknown>) => {
    c.commercialStatus = "available";
    c.offer = { modality: "immediate", checkout: true, trial: false };
  };
  for (const k of FOR_SALE) await publish(k, sell);
  // A la venta pero con implantación asistida (sin Checkout), y en la lista blanca
  await publish("connect-finance-sync", (c) => {
    c.commercialStatus = "available";
    c.offer = { modality: "assisted", checkout: false };
  });
  // Producto heredado (09/11/2026): sigue «available» pero retirado de la venta
  await publish("connect-partners", (c) => {
    sell(c);
    c.legacy = { replacedBy: "connect-people", since: "2026-11-09" };
  });
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  await syncCatalog(desired, gw, stripeStore, clock);
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;
  const app = createControlPlaneApp({
    tokens: [{ id: "admin", sha256: hashToken(ADMIN), scopes: [...all] }],
    registry: reg,
    reader: registry,
    entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    provisioning,
    platformDomain: "elephant.test",
    crm: { service: crm, store: crmStore },
    web: { store: webStore },
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: new MemoryTrialStore(), publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: null },
    publicIntake: { secret: SECRET, origins: [WEB] },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratar/estado`, cancel: `${WEB}/contratar/cancelado`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: opts.selfService,
      publicProducts: opts.allowed,
      termsVersion: "v1",
      purchases: { enabled: false, changes: new MemorySubscriptionChangeStore(), internalTenants: new Set() },
      invoiceLines: new MemoryInvoiceLineStore(),
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, server, gw, crmStore, orders, stripeStore, caps, webStore };
}

const call = (env: Env, method: string, path: string, o: { body?: unknown; raw?: string; headers?: Record<string, string>; origin?: string | null } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const origin = o.origin === undefined ? WEB : o.origin;
    const req = http.request(
      { host: "127.0.0.1", port: env.port, path: `/cp/v1${path}`, method, headers: { ...(origin ? { origin } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: parse(b), raw: b }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const admin = (env: Env, method: string, path: string) =>
  new Promise<Res>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: env.port, path: `/cp/v1${path}`, method, headers: { authorization: `Bearer ${ADMIN}` } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: parse(b), raw: b }));
    });
    req.on("error", reject);
    req.end();
  });
const webhook = (env: Env, ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call(env, "POST", "/stripe/webhook", { origin: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const settled = (env: Env) => until(async () => { const c = await env.stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });

let n = 0;
/** Cuerpo del alta como lo enviaría la web: solo claves, nunca importes. */
const startBody = (over: Record<string, unknown> = {}) => {
  n++;
  return {
    idempotencyKey: crypto.randomUUID(),
    plan: "essential",
    interval: "month",
    products: ["social-token-net-complete"],
    company: { name: `Club Carrito ${n} SL` },
    admin: { name: "Ana Carrito", email: `ana${n}@carrito.example` },
    consents: { terms: true, privacy: true, termsVersion: "v1" },
    ticket: issueTicket(SECRET, clock - 10_000),
    ...over,
  };
};
const sessionsCreated = (env: Env) => env.gw.calls.filter((c) => c.op === "checkout.sessions.create");
const priceOf = async (env: Env, productKey: string) => {
  const d = (await desiredCatalog(catalogFromWebStore(env.webStore))).find((x) => x.productKey === productKey && x.kind === "monthly")!;
  return (await env.stripeStore.priceForWebPrice(d.webPriceId))!.stripePriceId;
};

describe("checkout unificado de la web: plan + productos en línea", { timeout: 60_000 }, () => {
  let env: Env;
  beforeAll(async () => {
    env = await boot({ selfService: true, allowed: ALLOWED });
  });
  afterAll(async () => {
    env.server.closeAllConnections();
    await new Promise<void>((r) => env.server.close(() => r()));
  });

  it("oferta: planes y SOLO los productos de la lista blanca que pasan todas las reglas", async () => {
    const r = await call(env, "GET", "/public/checkout/offer");
    expect(r.status).toBe(200);
    expect(r.json.plans.map((p: { key: string }) => p.key)).toEqual(expect.arrayContaining(["essential", "business"]));
    expect(r.json.products.map((p: { key: string }) => p.key).sort()).toEqual(["connect-pack-finance", "connect-people", "connect-tax", "social-token-net-complete"]);
    expect(r.json.products.find((p: { key: string }) => p.key === "social-token-net-complete")).toMatchObject({ monthlyCents: 5900, bundleOf: ["social-token-net-communities", "social-token-net-tokens"] });
    expect(r.json).toMatchObject({ enabled: true, currency: "EUR", taxIncluded: false });
    expect((await call(env, "GET", "/public/checkout/offer", { origin: "https://otra.example" })).status).toBe(403);
  });

  it("presupuesto del servidor: Essential 29 € + Social Token Net 59 € = 88 €/mes sin impuestos", async () => {
    const r = await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "month", products: ["social-token-net-complete"] } });
    expect(r.status).toBe(200);
    expect(r.json.lines.map((l: { key: string; amountCents: number }) => [l.key, l.amountCents])).toEqual([["essential", 2900], ["social-token-net-complete", 5900]]);
    expect(r.json.totals).toEqual({ firstChargeNetCents: 8800, monthlyNetCents: 8800, yearlyNetCents: 0 });
    // Entorno de pruebas: neto sin impuestos y sin estimación
    expect(r.json.tax).toMatchObject({ treatment: "test_net_no_tax", estimatedRateBp: null, final: false });
    // Coincide con la cotización pública del configurador
    const pub = await call(env, "POST", "/public/site/quote", { body: { plan: "essential", interval: "month", items: [{ key: "social-token-net-complete" }] } });
    expect(pub.json.totals.monthlyCents).toBe(r.json.totals.firstChargeNetCents);
    // Plan anual con un producto solo mensual: el primer mes va en el mismo pago y se renueva cada mes en la misma suscripción
    const y = await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "year", products: ["social-token-net-complete"] } });
    expect(y.status).toBe(200);
    expect(y.json.lines.map((l: { key: string; interval: string }) => [l.key, l.interval])).toEqual([["essential", "year"], ["social-token-net-complete", "month"]]);
    expect(y.json.totals.monthlyNetCents).toBe(5900);
    expect(y.json.totals.firstChargeNetCents).toBe(y.json.totals.yearlyNetCents + 5900);
    // Solo el plan (lista vacía de productos)
    expect((await call(env, "POST", "/public/checkout/quote", { body: { plan: "business", interval: "month" } })).json.lines).toHaveLength(1);
  });

  it.each([
    ["sin plan", { interval: "month", products: ["social-token-net-complete"] }, 400, "plan_required", undefined],
    ["un producto como plan", { plan: "social-token-net-complete", interval: "month" }, 400, "plan_required", undefined],
    ["Enterprise (asistido)", { plan: "enterprise", interval: "month" }, 409, "plan_not_self_service", undefined],
    ["a la venta pero fuera de la lista blanca", { plan: "essential", interval: "month", products: ["connect-geo-control"] }, 409, "no_online", "connect-geo-control"],
    ["en la lista pero «bajo solicitud»", { plan: "essential", interval: "month", products: ["connect-deals"] }, 409, "no_online", "connect-deals"],
    ["producto heredado del catálogo", { plan: "essential", interval: "month", products: ["connect-partners"] }, 409, "legacy", "connect-partners"],
    ["antigua extensión de Net", { plan: "essential", interval: "month", products: [LEGACY_NET] }, 409, "legacy", LEGACY_NET],
    ["componente heredado junto a su paquete", { plan: "essential", interval: "month", products: ["social-token-net-complete", "social-token-net-communities"] }, 409, "legacy", "social-token-net-communities"],
    ["paquete y su componente", { plan: "essential", interval: "month", products: ["connect-pack-finance", "connect-tax"] }, 409, "incompatible", "connect-tax"],
    ["a la venta sin Checkout (implantación asistida)", { plan: "essential", interval: "month", products: ["connect-finance-sync"] }, 409, "no_online", "connect-finance-sync"],
    ["clave desconocida", { plan: "essential", interval: "month", products: ["no-existe"] }, 409, "no_online", "no-existe"],
    ["importe enviado por la web", { plan: "essential", interval: "month", products: ["social-token-net-complete"], amountCents: 100 }, 400, "invalid_request", undefined],
  ])("presupuesto rechazado: %s", async (_n, body, status, code, product) => {
    const r = await call(env, "POST", "/public/checkout/quote", { body });
    expect(r.status).toBe(status);
    expect(r.json.error).toBe(code);
    expect(r.json.message).toEqual(expect.any(String));
    if (product) expect(r.json.product).toBe(product);
  });

  it("alta: una sesión con todas las partidas; doble clic y reintento devuelven la misma; otra selección con la misma clave, no", async () => {
    const companiesBefore = (await env.crmStore.list("companies", {})).length;
    const body = startBody();
    const a = await call(env, "POST", "/public/checkout/start", { body });
    expect(a.status).toBe(200);
    expect(a.json.url).toEqual(expect.any(String));
    const input = sessionsCreated(env).at(-1)!.input as CheckoutSessionInput;
    expect(input.lineItems).toEqual([
      { priceId: await priceOf(env, "essential"), quantity: 1 },
      { priceId: await priceOf(env, "social-token-net-complete"), quantity: 1 },
    ]);
    const created = sessionsCreated(env).length;
    // Doble clic (misma clave) y reintento: misma sesión, ni otra empresa ni otro pedido
    const [b, c] = await Promise.all([call(env, "POST", "/public/checkout/start", { body }), call(env, "POST", "/public/checkout/start", { body })]);
    expect([b.json.sessionId, c.json.sessionId]).toEqual([a.json.sessionId, a.json.sessionId]);
    expect(sessionsCreated(env)).toHaveLength(created);
    expect((await env.crmStore.list("companies", {})).length).toBe(companiesBefore + 1);
    // Misma clave con otro carrito: no reutiliza el pedido de antes
    const d = await call(env, "POST", "/public/checkout/start", { body: { ...body, products: [] } });
    expect(d).toMatchObject({ status: 409, json: { error: "idempotency_mismatch" } });
  });

  it("rechazos antes de crear nada: plan ausente, producto no habilitado, importes en el cuerpo", async () => {
    const companiesBefore = (await env.crmStore.list("companies", {})).length;
    const { plan: _p, ...noPlan } = startBody();
    expect((await call(env, "POST", "/public/checkout/start", { body: noPlan })).json.error).toBe("plan_required");
    expect((await call(env, "POST", "/public/checkout/start", { body: startBody({ products: ["connect-geo-control"] }) })).json).toMatchObject({ error: "no_online", product: "connect-geo-control" });
    expect((await call(env, "POST", "/public/checkout/start", { body: startBody({ products: ["connect-partners"] }) })).json.error).toBe("legacy");
    expect((await call(env, "POST", "/public/checkout/start", { body: startBody({ amountCents: 100 }) })).json.error).toBe("invalid_request");
    expect((await call(env, "POST", "/public/checkout/start", { body: startBody({ lines: [{ key: "essential", unitCents: 1 }] }) })).json.error).toBe("invalid_request");
    expect((await env.crmStore.list("companies", {})).length).toBe(companiesBefore);
  });

});

// Segundo plano de control (límite de 10 altas por hora e IP en /start): pago, reintentos, aislamiento y Price manipulado
describe("checkout unificado de la web: pago, reintentos y aislamiento", { timeout: 60_000 }, () => {
  let env: Env;
  beforeAll(async () => {
    env = await boot({ selfService: true, allowed: ALLOWED });
  });
  afterAll(async () => {
    env.server.closeAllConnections();
    await new Promise<void>((r) => env.server.close(() => r()));
  });

  it("licencias solo tras el pago verificado; webhook duplicado y fuera de orden: un pago, una suscripción", async () => {
    const body = startBody();
    const s = await call(env, "POST", "/public/checkout/start", { body });
    const row = await env.stripeStore.session(s.json.sessionId);
    const orderId = row!.orderId;
    // Antes de pagar: pedido contratado, sin empresa activa ni licencias; la vuelta del navegador no da acceso
    expect((await env.orders.get(orderId))!.state).toBe("contracted");
    expect((await call(env, "GET", `/public/checkout/status?session_id=${s.json.sessionId}`)).json.state).toBe("pending_payment");
    const mark = env.gw.events.length;
    const subId = env.gw.completeSession(s.json.sessionId);
    const completed = env.gw.events[0];
    // Fuera de orden: factura y suscripción antes que la sesión; la sesión, dos veces
    expect((await webhook(env, env.gw.emit("invoice.paid", "invoice", (await env.gw.subscription(subId))!.latestInvoiceId!))).status).toBe(200);
    expect((await webhook(env, env.gw.emit("customer.subscription.created", "subscription", subId))).status).toBe(200);
    expect((await webhook(env, completed)).status).toBe(200);
    expect((await webhook(env, completed)).status).toBe(200);
    await settled(env);
    await until(async () => (await env.orders.get(orderId))?.state === "active");
    for (const ev of env.gw.events.slice(0, env.gw.events.length - mark).reverse()) await webhook(env, ev);
    await settled(env);
    const order = (await env.orders.get(orderId))!;
    expect(order.request.items).toEqual([{ key: "social-token-net-complete" }]);
    const caps = (await env.caps.list(order.tenantId!)).filter((g) => g.status === "active").map((g) => g.capabilityId);
    expect(caps).toEqual(expect.arrayContaining(["social-token-net", "social-token-net-tokens"]));
    const detail = (await admin(env, "GET", `/orders/${orderId}`)).json;
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded" })]);
    expect(await env.stripeStore.subscriptionsOfCompany(order.companyId)).toHaveLength(1);
    expect((await call(env, "GET", `/public/checkout/status?session_id=${s.json.sessionId}`)).json.state).toBe("ready");
    // Pagado: repetir la petición no abre otro pago
    const again = await call(env, "POST", "/public/checkout/start", { body: { ...body, ticket: issueTicket(SECRET, clock - 10_000) } });
    expect(again.status).toBe(409);
    expect(sessionsCreated(env).filter((c) => (c.input as CheckoutSessionInput).metadata.es_order_id === String(orderId))).toHaveLength(1);
  });

  it("pago caducado: la misma clave reabre otra sesión del MISMO pedido", async () => {
    const body = startBody();
    const a = await call(env, "POST", "/public/checkout/start", { body });
    await env.gw.expireCheckoutSession(a.json.sessionId);
    await webhook(env, env.gw.emit("checkout.session.expired", "checkout.session", a.json.sessionId));
    await settled(env);
    const b = await call(env, "POST", "/public/checkout/start", { body });
    expect(b.status).toBe(200);
    expect(b.json.sessionId).not.toBe(a.json.sessionId);
    expect((await env.stripeStore.session(b.json.sessionId))!.orderId).toBe((await env.stripeStore.session(a.json.sessionId))!.orderId);
  });

  it("aislamiento entre empresas: cada alta su empresa, su cliente de Stripe y su pedido", async () => {
    const a = await call(env, "POST", "/public/checkout/start", { body: startBody() });
    const b = await call(env, "POST", "/public/checkout/start", { body: startBody({ products: ["connect-people"] }) });
    const ra = (await env.stripeStore.session(a.json.sessionId))!;
    const rb = (await env.stripeStore.session(b.json.sessionId))!;
    const oa = (await env.orders.get(ra.orderId))!;
    const ob = (await env.orders.get(rb.orderId))!;
    expect(oa.companyId).not.toBe(ob.companyId);
    const sa = env.gw.sessions.get(a.json.sessionId)!;
    const sb = env.gw.sessions.get(b.json.sessionId)!;
    expect(sa.customerId).not.toBe(sb.customerId);
    expect(sa.metadata).toMatchObject({ es_order_id: String(oa.id), es_company_id: String(oa.companyId) });
    expect(sb.metadata).toMatchObject({ es_order_id: String(ob.id), es_company_id: String(ob.companyId) });
    expect(ob.request.items).toEqual([{ key: "connect-people" }]);
    // Otra alta con el NIF de una empresa ya registrada: ni otra empresa ni otra suscripción
    const first = await call(env, "POST", "/public/checkout/start", { body: startBody({ company: { name: "Con NIF SL", taxId: "B12345674" } }) });
    expect(first.status).toBe(200);
    const dup = await call(env, "POST", "/public/checkout/start", { body: startBody({ company: { name: "Con NIF Otra SL", taxId: "B12345674" } }) });
    expect(dup).toMatchObject({ status: 409, json: { error: "company_exists" } });
  });

  it("Price manipulado en Stripe: ni presupuesto ni alta (nada se crea)", async () => {
    const price = env.gw.prices.find((p) => p.lookupKey?.includes("social-token-net-complete"))!;
    const original = price.unitAmount;
    price.unitAmount = 100;
    try {
      const companiesBefore = (await env.crmStore.list("companies", {})).length;
      const q = await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "month", products: ["social-token-net-complete"] } });
      expect(q).toMatchObject({ status: 503, json: { error: "unavailable" } });
      const s = await call(env, "POST", "/public/checkout/start", { body: startBody() });
      expect(s).toMatchObject({ status: 503, json: { error: "unavailable" } });
      expect((await env.crmStore.list("companies", {})).length).toBe(companiesBefore);
    } finally {
      price.unitAmount = original;
    }
  });
});

describe("checkout unificado: interruptores", { timeout: 60_000 }, () => {
  it("autoservicio apagado: /offer, /quote y /start no existen (404); /status sigue", async () => {
    const env = await boot({ selfService: false, allowed: ALLOWED });
    try {
      expect((await call(env, "GET", "/public/checkout/offer")).status).toBe(404);
      expect((await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "month" } })).status).toBe(404);
      expect((await call(env, "POST", "/public/checkout/start", { body: startBody() })).status).toBe(404);
      expect((await call(env, "GET", "/public/checkout/status?session_id=cs_test_x")).status).toBe(400);
    } finally {
      env.server.closeAllConnections();
      await new Promise<void>((r) => env.server.close(() => r()));
    }
  });

  it("lista blanca vacía (por defecto): solo el plan; cualquier producto se rechaza", async () => {
    const env = await boot({ selfService: true });
    try {
      expect((await call(env, "GET", "/public/checkout/offer")).json.products).toEqual([]);
      expect((await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "month", products: ["social-token-net-complete"] } })).json).toMatchObject({ error: "no_online", product: "social-token-net-complete" });
      expect((await call(env, "POST", "/public/checkout/quote", { body: { plan: "essential", interval: "month" } })).json.totals.firstChargeNetCents).toBe(2900);
    } finally {
      env.server.closeAllConnections();
      await new Promise<void>((r) => env.server.close(() => r()));
    }
  });

  it("CP_PUBLIC_CHECKOUT_PRODUCTS: vacía por defecto; claves no válidas o planes impiden arrancar", () => {
    expect(publicCheckoutProductsFromEnv({} as NodeJS.ProcessEnv).size).toBe(0);
    expect(Array.from(publicCheckoutProductsFromEnv({ CP_PUBLIC_CHECKOUT_PRODUCTS: " social-token-net-complete, connect-people ," } as NodeJS.ProcessEnv))).toEqual(["social-token-net-complete", "connect-people"]);
    expect(() => publicCheckoutProductsFromEnv({ CP_PUBLIC_CHECKOUT_PRODUCTS: "Social Token" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => publicCheckoutProductsFromEnv({ CP_PUBLIC_CHECKOUT_PRODUCTS: "essential" } as NodeJS.ProcessEnv)).toThrow();
  });
});
