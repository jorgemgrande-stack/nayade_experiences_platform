/**
 * Contratación desde el panel de una empresa en prueba gratuita (CP_PANEL_CONVERSION_ENABLED): recorrido completo por
 * HTTP con el doble de Stripe y la firma real del webhook, repeticiones, sustitución de una selección abandonada y
 * aislamiento entre empresas. Datos sintéticos; sin red.
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

const ADMIN = "panel-conversion-admin-token-aaaaaaaaaaaa";
const CORE = "panel-conversion-core-token-bbbbbbbbbbbbb";
const TERMS = "v1-prueba";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "b".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });
const HOUR = 3_600_000;

let clock = Date.UTC(2026, 9, 18, 9);
let server: http.Server;
let port = 0;
let registry: MemoryTenantRegistryStore;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
const outbox: Array<{ kind: string; to: string; data: Record<string, unknown> }> = [];
const notify: TrialNotifier = {
  verification: async (to, l) => void outbox.push({ kind: "verification", to, data: l }),
  welcome: async (to, i) => void outbox.push({ kind: "welcome", to, data: i }),
  expiryNotice: async (to, i) => void outbox.push({ kind: "expiry", to, data: i }),
};

type Res = { status: number; json: any; raw: string };
const call = (method: string, path: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const token = o.token === undefined ? ADMIN : o.token;
    const req = http.request(
      { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
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
const key = () => crypto.randomBytes(12).toString("hex");
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};

/** Lo que envía el Core desde el panel (el tenant lo pone el Core con la sesión). */
const buyer = (name: string) => ({ type: "business", legalName: name, taxId: "B12345674", country: "ES", postalCode: "28002", line1: "Calle Mayor, 1", city: "Madrid" });
const consents = { terms: true, privacy: true, termsVersion: TERMS };
const start = (tenantId: string, b: Record<string, unknown>, token = CORE) =>
  call("POST", `/commerce/tenants/${tenantId}/conversion`, { token, body: { plan: "essential", interval: "month", buyer: buyer("Panel SL"), consents, user: "user:1", idempotencyKey: crypto.randomUUID(), ...b } });

/** Empresa en prueba gratuita activa (registro público + verificación + alta automática). */
async function trial(email: string, companyName: string) {
  await ok(call("POST", "/public/trial", { token: null, body: { email, companyName, idempotencyKey: key() } }), 202);
  const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
  await ok(call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } }));
  return (await trialStore.get(v.data.trialId as number))!;
}

beforeAll(async () => {
  registry = new MemoryTenantRegistryStore();
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
  // Essential, contratable en línea (decisión comercial que en production sigue pendiente)
  const { entry } = await web.get("product", "essential");
  const draft = structuredClone(entry.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
  draft.technicalStatus = "available";
  draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available" };
  const saved = await web.save("product", "essential", { draft, expectedVersion: entry.draftVersion }, "operator:test");
  await web.publish("product", "essential", saved.draftVersion, "operator:test");
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  await syncCatalog(desired, gw, stripeStore, clock);
  const crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;
  const app = createControlPlaneApp({
    tokens: [
      { id: "admin", sha256: hashToken(ADMIN), scopes: [...all] },
      // El Core: solo el canal comercial
      { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] },
    ],
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
      publicStatus: false,
      selfService: false,
      panelConversion: true,
      termsVersion: TERMS,
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

describe("contratación desde el panel de una empresa en prueba (doble de Stripe, firma real)", () => {
  it("estado: disponible con el interruptor, condiciones y un plan contratable en línea; solo con el ámbito del canal comercial", async () => {
    expect(await ok(call("GET", "/commerce/conversion/status", { token: CORE }))).toEqual({ enabled: true, reasons: [] });
    expect((await call("GET", "/commerce/conversion/status", { token: ADMIN })).status).toBe(403);
  });

  it("recorrido completo: presupuesto → condiciones → Checkout → webhook → cliente activo con la misma empresa, plataforma y suscripción", async () => {
    const t = await trial("panel@empresa.example", "Panel a Pago SL");
    const tenantsBefore = (await registry.listTenants()).length;
    const company = (await crmStore.list("companies", { tenantId: t.tenantId! }))[0];
    const sub = (await subsStore.list({ companyId: company.id }))[0];
    const p = await ok(call("POST", `/commerce/tenants/${t.tenantId}/conversion/preview`, { token: CORE, body: { plan: "essential", interval: "month" } }));
    expect(p.preview).toMatchObject({ plan: "essential", interval: "month", termsVersion: TERMS, quote: { ok: true, totals: { monthlyCents: 2900 } } });
    const idem = crypto.randomUUID();
    const s = await ok(start(t.tenantId!, { idempotencyKey: idem }));
    expect(s.url).toMatch(/^https:\/\//);
    // La misma petición repetida: la misma sesión, sin otro pedido
    expect((await ok(start(t.tenantId!, { idempotencyKey: idem }))).sessionId).toBe(s.sessionId);
    // Otra pestaña con la misma selección: retoma el pedido abierto (un solo cobro posible)
    expect((await ok(start(t.tenantId!, {}))).sessionId).toBe(s.sessionId);
    const open = await orders.list({ trialId: t.id, limit: 10 });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "trial_conversion", state: "contracted", tenantId: t.tenantId });
    expect(await stripeStore.buyerProfile(open[0].id)).toMatchObject({ type: "business", displayName: "Panel SL", taxId: "B12345674" });
    // Nada se activa con la vuelta del navegador: solo con el pago verificado
    expect((await trialStore.get(t.id))!.state).toBe("active");
    gw.completeSession(s.sessionId);
    await ok(stripeWebhook(gw.events.find((e) => e.type === "checkout.session.completed" && e.objectId === s.sessionId)!));
    await until(async () => (await orders.get(open[0].id))?.state === "active");
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
    expect((await subsStore.list({ companyId: company.id })).map((x) => x.id)).toEqual([sub.id]);
    expect((await subsStore.get(sub.id))!).toMatchObject({ status: "active", tenantId: t.tenantId, trialEnd: null });
    expect((await trialStore.get(t.id))!.state).toBe("converted");
    expect((await caps.list(t.tenantId!)).every((g) => g.status === "active")).toBe(true);
    // Convertida, ya no se contrata desde la prueba
    expect((await start(t.tenantId!, {})).status).toBe(409);
  });

  it("otra selección con un pago abierto: no; caducado el enlace, la anterior se sustituye (sin dos pedidos abiertos)", async () => {
    const t = await trial("panel-cambio@empresa.example", "Panel Cambio SL");
    const first = await ok(start(t.tenantId!, {}));
    const other = await start(t.tenantId!, { interval: "year" });
    expect(other.status).toBe(409);
    expect(other.json.error).toBe("conversion_open");
    // Checkout fecha la sesión con el reloj real (enlace de 2 h): se pasa su caducidad
    clock = Date.now() + 3 * HOUR;
    const second = await ok(start(t.tenantId!, { interval: "year" }));
    expect(second.sessionId).not.toBe(first.sessionId);
    const all = await orders.list({ trialId: t.id, limit: 10 });
    expect(all.map((o) => o.state).sort()).toEqual(["contracted", "rejected"]);
    expect(all.find((o) => o.state === "contracted")!.request).toMatchObject({ interval: "year" });
  });

  it("aislamiento: otro tenant, condiciones desactualizadas, un plan no contratable en línea o un comprador incompleto no abren ningún pago", async () => {
    const t = await trial("panel-aislado@empresa.example", "Panel Aislado SL");
    const sessions = gw.sessions.size;
    expect((await start(`t${t.id}-otra-empresa`, {})).status).toBe(404);
    expect((await start("t999999-nadie", {})).status).toBe(404);
    expect((await start("skibox", {})).status).toBe(404);
    expect((await start(t.tenantId!, { consents: { ...consents, termsVersion: "v0" } })).json.error).toBe("terms_outdated");
    expect((await start(t.tenantId!, { plan: "business" })).json.error).toBe("plan_not_self_service");
    expect((await start(t.tenantId!, { buyer: { type: "business", legalName: "X" } })).status).toBe(400);
    expect(gw.sessions.size).toBe(sessions);
    expect(await orders.list({ trialId: t.id, limit: 10 })).toEqual([]);
  });
});
