/**
 * Ciclo estándar de una prueba gratuita con PRIMER COBRO FALLIDO (modelo estándar, empresa SINTÉTICA), por HTTP con la
 * aplicación REAL del plano de control (Stripe es un doble; la firma del webhook es la real del SDK):
 *
 *   alta de prueba pública → verificación → plataforma en prueba → pedido de conversión → aceptación → Checkout →
 *   primer pago FALLIDO (la prueba NO se convierte, no se activa ni se registra pago) → reintento cobrado de la MISMA
 *   factura → conversión (misma empresa, tenant y suscripción interna) → renovación fallida (past_due → gracia) →
 *   recuperación → al corriente. Webhooks repetidos sin efectos duplicados.
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
import { MemoryTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MemoryOrderStore } from "./orchestrator/store";
import type { TrialNotifier } from "./trials/onboarding";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryInvoiceLineStore } from "./stripe/invoiceLines";

const ADMIN = "prueba-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "p".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 27, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let registry: MemoryTenantRegistryStore;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
// El doble de Stripe sigue el reloj de la prueba (como en la prueba de servicios externos)
Object.defineProperty(gw, "now", { get: () => Math.floor(clock / 1000), set: () => {} });
const stripeStore = new MemoryStripeStore();
const trialStore = new MemoryTrialStore();
const changes = new MemorySubscriptionChangeStore();
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};
const provisioned: string[] = [];

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": o.headers?.["content-type"] ?? "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = b ? JSON.parse(b) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, raw: b });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
const ok = async (p: Promise<Res>, expected: number | number[] = 200) => {
  const r = await p;
  if (!(Array.isArray(expected) ? expected : [expected]).includes(r.status)) throw new Error(`${r.status} ${r.raw.slice(0, 400)}`);
  return r.json;
};
const key = () => crypto.randomBytes(12).toString("hex");
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
/** Entrega por webhook (firma real) los eventos que el doble emitió desde `mark`, en orden. */
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
  await settled();
}
const sec = (ms: number) => Math.floor(ms / 1000);
const orderOf = async (id: number) => ok(call("GET", `/orders/${id}`));
const capsOf = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);

beforeAll(async () => {
  registry = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const reg = new TenantRegistryService(registry, () => ring);
  const provisioning = new ProvisioningService({
    registry: reg,
    reader: registry,
    databases: { ensureDatabase: async (id) => (provisioned.push(id), { dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async () => undefined },
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
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  await syncCatalog(desired, gw, stripeStore, clock);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read", "ops:write"] as const;
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
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: null },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: "https://web.example/contratacion/estado", cancel: "https://web.example/contratacion/cancelada", portalReturn: "https://app.elephant.test/admin/suscripcion" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: false,
      termsVersion: null,
      purchases: { enabled: true, changes, internalTenants: new Set() },
      invoiceLines: new MemoryInvoiceLineStore(),
    },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const DAY = 86_400_000;
const orderState = async (id: number) => (await orders.get(id))?.state;
const saasPayments = async (id: number) => (await orderOf(id)).payments as Array<{ purpose: string; status: string; providerRef: string; amountCents: number }>;

describe("prueba gratuita con primer cobro fallido y recuperación (modelo estándar)", { timeout: 60_000 }, () => {
  it("primer cobro fallido: la prueba no se convierte; el reintento de la misma factura la convierte; después, impago y recuperación", async () => {
    const email = "prueba-cobro-fallido@empresa-sintetica.example";
    await ok(call("POST", "/public/trial", { token: null, body: { email, companyName: "Prueba Cobro Fallido SL", termsAccepted: true, termsVersion: "2026-10-21", idempotencyKey: key() } }), 202);
    const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
    await ok(call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } }));
    const t = (await trialStore.get(v.data.trialId as number))!;
    const tenantId = t.tenantId!;
    const company = (await crmStore.list("companies", { tenantId }))[0];
    const internal = (await subsStore.list({ companyId: company.id }))[0];
    expect(await subsStore.list({ companyId: company.id })).toHaveLength(1);
    expect(internal).toMatchObject({ tenantId });
    const tenantStatusBefore = (await registry.getTenant(tenantId))?.status;
    const tenantsBefore = (await registry.listTenants()).length;

    // Conversión: pedido ligado a la prueba, aceptación y Checkout
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), trialId: t.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    const orderId = created.order.id as number;
    expect(created.order).toMatchObject({ kind: "trial_conversion", tenantId, companyId: company.id });
    await ok(call("POST", `/orders/${orderId}/accept`, { body: { signatureRef: "aceptacion-prueba-fallida", approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));

    // PRIMER COBRO FALLIDO: la suscripción queda incompleta y la factura abierta
    let mark = gw.events.length;
    const subId = gw.completeSession(s.sessionId, "incomplete");
    await deliverSince(mark);
    expect(await orderState(orderId)).not.toBe("active");
    expect((await trialStore.get(t.id))!.state).not.toBe("converted");
    expect(await saasPayments(orderId)).toEqual([]);
    expect((await registry.getTenant(tenantId))?.status).toBe(tenantStatusBefore);
    expect((await subsStore.get(internal.id))!.trialEnd).not.toBeNull();

    // Reintento de Stripe con éxito: la MISMA factura queda cobrada y la suscripción activa
    mark = gw.events.length;
    const firstInvoice = gw.subscriptions.get(subId)!.latestInvoiceId!;
    const open = gw.invoices.get(firstInvoice)!;
    expect(open.status).toBe("open");
    gw.invoices.set(firstInvoice, { ...open, status: "paid", amountPaid: open.total ?? open.subtotal ?? 2900 });
    gw.updateSubscription(subId, { status: "active" });
    gw.emit("invoice.paid", "invoice", firstInvoice);
    gw.emit("customer.subscription.updated", "subscription", subId);
    await deliverSince(mark);
    await until(async () => (await orderState(orderId)) === "active");
    // Misma empresa, mismo tenant, misma suscripción interna; prueba convertida; un solo pago
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
    expect((await subsStore.list({ companyId: company.id })).map((x) => x.id)).toEqual([internal.id]);
    expect(await subsStore.get(internal.id)).toMatchObject({ status: "active", tenantId, trialEnd: null });
    expect((await trialStore.get(t.id))!.state).toBe("converted");
    expect((await registry.getTenant(tenantId))?.status).toBe("active");
    expect(await saasPayments(orderId)).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", providerRef: firstInvoice })]);
    expect((await capsOf(tenantId)).length).toBeGreaterThan(0);

    // Renovación fallida: past_due → gracia (el acceso se mantiene); sin pago registrado
    clock += 31 * DAY;
    const sub = gw.subscriptions.get(subId)!;
    mark = gw.events.length;
    const start = sec(clock);
    const renewal = gw.addInvoice(subId, sub.customerId, "subscription_cycle", "open", 2900);
    gw.updateSubscription(subId, { status: "past_due", currentPeriodStart: start, currentPeriodEnd: start + 30 * 86_400 });
    gw.emit("invoice.payment_failed", "invoice", renewal);
    gw.emit("customer.subscription.updated", "subscription", subId);
    await deliverSince(mark);
    expect((await orderOf(orderId)).order.state).toBe("past_due");
    expect((await registry.getTenant(tenantId))?.status).toBe("grace");
    expect((await capsOf(tenantId)).length).toBeGreaterThan(0);
    expect(await saasPayments(orderId)).toHaveLength(1);

    // Recuperación: la misma factura cobrada → al corriente, pago de renovación registrado una sola vez
    mark = gw.events.length;
    const unpaid = gw.invoices.get(renewal)!;
    gw.invoices.set(renewal, { ...unpaid, status: "paid", amountPaid: unpaid.total ?? 2900 });
    gw.updateSubscription(subId, { status: "active" });
    gw.emit("invoice.paid", "invoice", renewal);
    gw.emit("customer.subscription.updated", "subscription", subId);
    await deliverSince(mark);
    expect((await orderOf(orderId)).order.state).toBe("active");
    expect((await registry.getTenant(tenantId))?.status).toBe("active");
    const pays = await saasPayments(orderId);
    expect(pays).toHaveLength(2);
    expect(pays.filter((p) => p.providerRef === renewal)).toEqual([expect.objectContaining({ purpose: "renewal", status: "succeeded" })]);

    // Webhooks repetidos: ningún pago, suscripción ni tenant nuevo
    await deliverSince(0);
    expect(await saasPayments(orderId)).toHaveLength(2);
    expect(await subsStore.list({ companyId: company.id })).toHaveLength(1);
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
    expect((await registry.getTenant(tenantId))?.status).toBe("active");
  });
});
