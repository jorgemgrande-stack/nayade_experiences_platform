/**
 * Stripe Billing en MODO LIVE por HTTP, con la aplicación REAL del plano de control (en memoria). Solo
 * Stripe es un doble (`FakeStripeGateway` que imita una cuenta live, sin red); la firma del webhook usa la
 * criptografía REAL del SDK. Comprueba lo que distingue al entorno live:
 *
 *  - Con `stripe_tax_exclusive`: Checkout con Stripe Tax y aviso sin «pruebas»; pago → webhook live firmado →
 *    empresa activa; el pago queda con proveedor `stripe` y modo `live`.
 *  - Eventos e ids de sesión de pruebas rechazados en live.
 *  - Sin política fiscal: Checkout apagado y ninguna llamada a Stripe.
 *  - Los pagos simulados y un almacén de otro modo no pueden montarse.
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
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemorySubscriptionStore } from "./subscriptions/store";
import { catalogFromWebStore } from "./subscriptions/ports";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryOrderStore } from "./orchestrator/store";
import { SignedTestProvider } from "./orchestrator/payments";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import { LIVE_TAX_NOTICE } from "./stripe/checkout";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type CheckoutSessionInput, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

const ADMIN = "stripe-live-admin-token-aaaaaaaaaaaaaaaaa";
const WEB = "https://web.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const liveConfig = (taxPolicy: StripeConfig["taxPolicy"]): StripeConfig => ({ mode: "live", apiKey: ["rk", "live", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "l".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "restricted", namespace: "live", eventsRetentionDays: 180, taxPolicy });
const sdk = new Stripe(liveConfig(null).apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
const clock = Date.UTC(2026, 9, 18, 9);
const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;

type Res = { status: number; json: any; raw: string };
const key = () => crypto.randomBytes(12).toString("hex");

/** Una instancia completa del plano de control con Stripe en live (memoria). */
async function liveControlPlane(o: { taxPolicy: StripeConfig["taxPolicy"]; store?: MemoryStripeStore; payments?: SignedTestProvider | null }) {
  const config = liveConfig(o.taxPolicy);
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
  const webStore = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  const gw = new FakeStripeGateway();
  gw.livemode = true;
  const stripeStore = o.store ?? new MemoryStripeStore("live");
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_live_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_live_${op.params.metadata.es_web_price_id}`, productId: `prod_live_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  if (stripeStore.mode === "live") await syncCatalog(desired, gw, stripeStore, clock);
  gw.calls = [];
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const orders = new MemoryOrderStore();
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
    capabilities: new MemoryCapabilityStore(),
    orders: { store: orders, payments: o.payments ?? null },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratacion/estado`, cancel: `${WEB}/contratacion/cancelada`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      // Bandera encendida: en live sin política, Checkout sigue apagado igualmente
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: false,
      termsVersion: null,
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, c: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
    new Promise<Res>((resolve, reject) => {
      const data = c.raw ?? (c.body === undefined ? undefined : JSON.stringify(c.body));
      const token = c.token === undefined ? ADMIN : c.token;
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(c.headers ?? {}) } },
        (res) => {
          let b = "";
          res.on("data", (x) => (b += x));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null, raw: b }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
    const r = await p;
    if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw}`);
    return r.json;
  };
  /** Lo que Stripe enviaría al destino del webhook, firmado con el secreto real; `livemode` del evento. */
  const webhook = (ev: GwEvent, livemode = ev.livemode) => {
    const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
    return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
  };
  const contractedOrder = async (name: string) => {
    const c = await crm.createCompany({ name }, "operator:test");
    await crm.createContact(c.id, { name: "Ana Live", email: `ana@c${c.id}.example` }, "operator:test");
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-live-${c.id}`, approvalReason: "Aprobado por producto" } }), [200, 202]);
    return created.order.id as number;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { gw, stripeStore, orders, call, ok, webhook, contractedOrder, close };
}

const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};

describe("Stripe en modo live por HTTP, con política fiscal stripe_tax_exclusive", () => {
  let cp: Awaited<ReturnType<typeof liveControlPlane>>;
  beforeAll(async () => {
    cp = await liveControlPlane({ taxPolicy: "stripe_tax_exclusive" });
  });
  afterAll(() => cp.close());

  it("alta: Checkout con Stripe Tax → pago → webhook live firmado → activa; el pago queda como stripe/live", async () => {
    expect(await cp.ok(cp.call("GET", "/stripe/status"))).toMatchObject({ enabled: true, mode: "live", namespace: "live", taxPolicy: "stripe_tax_exclusive", checkoutEnabled: true });
    expect(await cp.ok(cp.call("GET", "/orders/payments/config"))).toMatchObject({ enabled: false, mode: "live", stripeProvider: "stripe", autoCharge: false });
    const orderId = await cp.contractedOrder("Live Essential SL");
    const s = await cp.ok(cp.call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(s).toMatchObject({ amountCents: 2900, currency: "EUR", taxTreatment: "stripe_tax_exclusive", reused: false });
    expect(s.sessionId).toMatch(/^cs_live_/);
    const input = cp.gw.calls.find((c) => c.op === "checkout.sessions.create")!.input as CheckoutSessionInput;
    expect(input).toMatchObject({ automaticTax: true, notice: LIVE_TAX_NOTICE, metadata: { es_env: "live", es_tax_treatment: "stripe_tax_exclusive" } });
    expect(input.notice).not.toMatch(/prueba/i);
    // Estado público: solo ids de sesión live
    expect(await cp.ok(cp.call("GET", `/public/checkout/status?session_id=${s.sessionId}`, { token: null }))).toMatchObject({ state: "pending_payment" });
    expect((await cp.call("GET", `/public/checkout/status?session_id=${s.sessionId.replace("cs_live_", "cs_test_")}`, { token: null })).status).toBe(400);
    expect((await cp.call("POST", `/stripe/checkout/${s.sessionId.replace("cs_live_", "cs_test_")}/sync`)).status).toBe(400);
    cp.gw.completeSession(s.sessionId);
    expect(await cp.ok(cp.webhook(cp.gw.events[0]))).toMatchObject({ received: true, duplicate: false });
    await until(async () => (await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state === "active");
    const detail = await cp.ok(cp.call("GET", `/orders/${orderId}`));
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", provider: "stripe", mode: "live", amountCents: 2900 })]);
    expect((await cp.orders.payments(orderId)).every((p) => p.mode === "live" && p.provider === "stripe")).toBe(true);
  });

  it("un evento de PRUEBAS con firma válida se rechaza en live (400) y no se guarda nada", async () => {
    const ev = cp.gw.emit("invoice.paid", "invoice", "in_x_0000000001");
    const before = await cp.stripeStore.eventCounts();
    const r = await cp.webhook(ev, false);
    expect(r).toMatchObject({ status: 400, json: { error: "test_event_rejected" } });
    expect(await cp.stripeStore.event(ev.id)).toBeNull();
    expect(await cp.stripeStore.eventCounts()).toEqual(before);
  });

  it("no existe el webhook de pagos simulados (sin token cae en la autenticación; con él, no existe)", async () => {
    expect((await cp.call("POST", "/payments/test/webhook", { token: null, body: {} })).status).toBe(401);
    expect((await cp.call("POST", "/payments/test/webhook", { body: {} })).status).toBe(404);
  });
});

describe("Stripe en modo live sin política fiscal", () => {
  it("Checkout apagado aunque la bandera esté encendida: 409 y ninguna llamada a Stripe ni nada guardado", async () => {
    const cp = await liveControlPlane({ taxPolicy: null });
    try {
      expect(await cp.ok(cp.call("GET", "/stripe/status"))).toMatchObject({ mode: "live", taxPolicy: "pending", checkoutEnabled: false, checkoutBlocked: "tax_policy_pending" });
      const orderId = await cp.contractedOrder("Live Pendiente SL");
      const r = await cp.call("POST", `/stripe/orders/${orderId}/checkout`);
      expect(r.status).toBe(409);
      expect(cp.gw.calls).toEqual([]);
      expect(cp.gw.customers.size).toBe(0);
      expect(cp.stripeStore.sessions.size).toBe(0);
      expect((await cp.ok(cp.call("GET", `/orders/${orderId}`))).order.state).toBe("contracted");
    } finally {
      await cp.close();
    }
  });
});

describe("montaje del modo live", () => {
  it("los pagos simulados no pueden montarse con Stripe en live", async () => {
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", payments: new SignedTestProvider({ webhookSecret: "secreto-del-proveedor-de-pruebas-0123456789abcdef" }) })).rejects.toThrow(/pagos simulados/);
  });

  it("un almacén de pruebas con la configuración live no se monta", async () => {
    await expect(liveControlPlane({ taxPolicy: "stripe_tax_exclusive", store: new MemoryStripeStore("test") })).rejects.toThrow(/modo test/);
  });
});
