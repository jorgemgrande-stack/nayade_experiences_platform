/**
 * Contratación con Stripe de punta a punta por HTTP, con la aplicación REAL del plano de control:
 * aprovisionamiento, orquestador, suscripciones, licencias y prueba gratuita reales (en memoria).
 * Solo Stripe es un doble (`FakeStripeGateway`, sin red); la firma del webhook usa la criptografía REAL
 * del SDK. Es el ensayo, sin Stripe, del recorrido que se hará en el sandbox:
 *
 *  - Alta asistida: pedido → aceptación → Checkout → pago → webhook firmado → empresa aprovisionada,
 *    suscripción y licencias activas → página de estado «lista» con su dirección.
 *  - Conversión de una prueba gratuita pagando por Checkout: misma empresa, plataforma y suscripción.
 *  - Reembolso total por webhook: acceso suspendido, nada borrado.
 *  - Contratación pública cerrada: plan «bajo solicitud» y condiciones sin publicar; sin datos creados.
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
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryOrderStore } from "./orchestrator/store";
import type { TrialNotifier } from "./trials/onboarding";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

const ADMIN = "stripe-beta-admin-token-aaaaaaaaaaaaaaaa";
const WEB = "https://web.example";
const INTAKE_SECRET = "s".repeat(48);
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "b".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 18, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
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

/** Lo que Stripe enviaría al destino del webhook para un evento, firmado con el secreto real. */
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
/** El webhook guarda y responde; el procesamiento sigue en segundo plano: se espera a que termine. */
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const orderState = async (id: number) => (await ok(call("GET", `/orders/${id}`))).order.state as string;

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
  await seedElephantSource(new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock }), webStore);
  // Catálogo de Stripe creado según el plan de escrituras (lo que hará una persona en el sandbox) y enlazado
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  expect((await syncCatalog(desired, gw, stripeStore, clock)).linked).toHaveLength(4);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
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
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    trials: { store: trialStore, publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: null },
    publicIntake: { secret: INTAKE_SECRET, origins: [WEB] },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratacion/estado`, cancel: `${WEB}/contratacion/cancelada`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: true,
      selfService: true,
      // Condiciones legales SIN publicar (situación real hoy)
      termsVersion: null,
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

/** Pedido asistido contratado (firmado) para una empresa nueva. */
async function contractedOrder(name: string, plan = "essential", interval = "month") {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Beta", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan, interval, items: [] } } }), 201);
  await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-beta-${c.id}`, approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
  return { orderId: created.order.id as number, companyId: c.id };
}

describe("contratación con Stripe por HTTP (doble de Stripe, firma real)", () => {
  it("alta asistida: Checkout → pago → webhook firmado → empresa aprovisionada, suscripción y licencias → estado «lista»", async () => {
    const tenantsBefore = (await registry.listTenants()).length;
    const { orderId, companyId } = await contractedOrder("Beta Essential SL");
    expect(await orderState(orderId)).toBe("contracted");
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(s).toMatchObject({ amountCents: 2900, currency: "EUR", taxTreatment: "test_net_no_tax", reused: false });
    expect(s.url).toMatch(/^https:\/\//);
    expect(await ok(call("GET", `/public/checkout/status?session_id=${s.sessionId}`, { token: null }))).toMatchObject({ state: "pending_payment" });
    // El cliente paga en Stripe; Stripe avisa por webhook
    gw.completeSession(s.sessionId);
    expect(await ok(stripeWebhook(gw.events[0]))).toMatchObject({ received: true });
    await until(async () => (await orderState(orderId)) === "active");
    const detail = await ok(call("GET", `/orders/${orderId}`));
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", provider: "stripe_test", amountCents: 2900 })]);
    const tenantId = detail.order.tenantId as string;
    expect((await registry.listTenants()).length).toBe(tenantsBefore + 1);
    expect((await subsStore.list({ companyId }))[0]).toMatchObject({ status: "active", tenantId });
    const granted = await caps.list(tenantId);
    expect(granted.map((g) => g.capabilityId).sort()).toEqual(capabilitiesOfTier("essential").sort());
    expect(granted.every((g) => g.status === "active")).toBe(true);
    expect(await ok(call("GET", `/public/checkout/status?session_id=${s.sessionId}`, { token: null }))).toEqual({ state: "ready", message: expect.any(String), accessUrl: `https://${tenantId}.elephant.test` });
    // El mismo webhook repetido no duplica nada
    expect(await ok(stripeWebhook(gw.events.find((e) => e.type === "checkout.session.completed" && e.objectId === s.sessionId)!))).toMatchObject({ duplicate: true });
    expect((await registry.listTenants()).length).toBe(tenantsBefore + 1);
  });

  it("webhook con firma no válida: 400 y nada registrado", async () => {
    const before = (await stripeStore.eventCounts()).received;
    const raw = JSON.stringify({ id: "evt_test_falso00000001", object: "event", type: "invoice.paid", livemode: false, data: { object: { id: "in_test_x", object: "invoice" } } });
    const r = await call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: ["whsec", "c".repeat(32)].join("_") }) } });
    expect(r.status).toBe(400);
    expect(await stripeStore.event("evt_test_falso00000001")).toBeNull();
    expect((await stripeStore.eventCounts()).received).toBe(before);
  });

  it("conversión de una prueba gratuita pagando por Checkout: misma empresa, plataforma y suscripción", async () => {
    const email = "beta-prueba@empresa.example";
    await ok(call("POST", "/public/trial", { token: null, body: { email, companyName: "Prueba a Pago SL", idempotencyKey: key() } }), 202);
    const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
    await ok(call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } }));
    const t = (await trialStore.get(v.data.trialId as number))!;
    const company = (await crmStore.list("companies", { tenantId: t.tenantId! }))[0];
    const sub = (await subsStore.list({ companyId: company.id }))[0];
    const tenantsBefore = (await registry.listTenants()).length;
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), trialId: t.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    expect(created.order).toMatchObject({ kind: "trial_conversion", tenantId: t.tenantId });
    await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: "aceptacion-conversion-beta", approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
    const s = await ok(call("POST", `/stripe/orders/${created.order.id}/checkout`));
    expect(gw.sessions.get(s.sessionId)!.metadata).toMatchObject({ es_tenant_id: t.tenantId });
    gw.completeSession(s.sessionId);
    await ok(stripeWebhook(gw.events[0]));
    await until(async () => (await orderState(created.order.id)) === "active");
    expect((await registry.listTenants()).length).toBe(tenantsBefore);
    expect((await subsStore.list({ companyId: company.id })).map((x) => x.id)).toEqual([sub.id]);
    expect((await subsStore.get(sub.id))!).toMatchObject({ status: "active", tenantId: t.tenantId, trialEnd: null });
    expect((await trialStore.get(t.id))!.state).toBe("converted");
    expect((await caps.list(t.tenantId!)).every((g) => g.status === "active")).toBe(true);
  });

  it("reembolso total por webhook: acceso suspendido sin borrar nada; queda a la vista del operador", async () => {
    const { orderId } = await contractedOrder("Beta Reembolso SL");
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    const subId = gw.completeSession(s.sessionId);
    await ok(stripeWebhook(gw.events[0]));
    await until(async () => (await orderState(orderId)) === "active");
    const ch = gw.chargeForInvoice((await gw.subscription(subId))!.latestInvoiceId!);
    gw.refund(ch);
    await ok(stripeWebhook(gw.emit("charge.refunded", "charge", ch)));
    await until(async () => (await orderState(orderId)) === "suspended");
    const tenantId = (await ok(call("GET", `/orders/${orderId}`))).order.tenantId as string;
    const granted = await caps.list(tenantId);
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.every((g) => g.status === "suspended")).toBe(true);
    const adj = await ok(call("GET", "/stripe/adjustments"));
    expect(adj.adjustments).toEqual(expect.arrayContaining([expect.objectContaining({ chargeId: ch, orderId, coverageLost: true, resolvedAt: null })]));
    // Un operador lo levanta con motivo: vuelve el acceso
    await ok(call("POST", `/stripe/adjustments/${ch}/resolve`, { body: { reason: "Reembolso por error: cobrado de nuevo fuera de Stripe" } }));
    expect(await orderState(orderId)).toBe("active");
  });

  it("contratación pública cerrada: sin condiciones publicadas no se crea nada (el plan «bajo solicitud» lo impediría después)", async () => {
    const companies = (await crmStore.list("companies", {})).length;
    const body = { idempotencyKey: crypto.randomUUID(), plan: "essential", interval: "month", company: { name: "Autoservicio SL" }, admin: { name: "Ana", email: "ana@autoservicio.example" }, consents: { terms: true, privacy: true, termsVersion: "v1" }, ticket: issueTicket(INTAKE_SECRET, clock - 10_000) };
    const r = await call("POST", "/public/checkout/start", { token: null, body, headers: { origin: WEB } });
    // Sin condiciones publicadas, la contratación en línea no está disponible (antes de mirar nada más)
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("terms_unpublished");
    expect((await call("POST", "/public/checkout/start", { token: null, body, headers: { origin: "https://otra.example" } })).status).toBe(403);
    expect((await crmStore.list("companies", {})).length).toBe(companies);
    // Una ruta inexistente bajo /public/checkout responde 404, nunca cae en la autenticación de operadores
    expect((await call("GET", "/public/checkout/otra", { token: null })).status).toBe(404);
  });

  it("propuestas de precio anual: 10 × mensual aprobado, solo lectura y sin tocar Stripe", async () => {
    const before = gw.calls.length;
    const r = await ok(call("GET", "/stripe/catalog/yearly-proposals"));
    expect(r.rule).toBe("yearly = 10 × monthly");
    for (const p of r.proposals) expect(p.proposedYearlyCents).toBe(p.monthlyCents * 10);
    expect(r.proposals.map((p: { productKey: string }) => p.productKey)).not.toContain("essential");
    expect(gw.calls.length).toBe(before);
    expect((await call("GET", "/stripe/catalog/yearly-proposals", { token: null })).status).toBe(401);
  });

  it("suscripciones: la de una prueba gratuita sigue siendo simulación", async () => {
    const email = "beta-sombra@empresa.example";
    await ok(call("POST", "/public/trial", { token: null, body: { email, companyName: "Sombra SL", idempotencyKey: key() } }), 202);
    const v = outbox.filter((m) => m.kind === "verification" && m.to === email).at(-1)!;
    await ok(call("POST", "/public/trial/verify", { token: null, body: { id: v.data.trialId, token: v.data.token } }));
    const t = (await trialStore.get(v.data.trialId as number))!;
    const company = (await crmStore.list("companies", { tenantId: t.tenantId! }))[0];
    const sub = (await subsStore.list({ companyId: company.id }))[0];
    expect((await ok(call("GET", `/subscriptions/${sub.id}`))).billing).toEqual({ source: "shadow" });
    expect((await ok(call("GET", `/subscriptions?companyId=${company.id}`))).subscriptions[0].billing).toEqual({ source: "shadow" });
    // Las operaciones de simulación siguen disponibles
    expect((await call("POST", `/subscriptions/${sub.id}/shadow`, { body: {} })).status).toBe(200);
  });

  it("suscripciones: la cobrada en Stripe muestra su contratación, rechaza la simulación y renueva por webhook", async () => {
    const { orderId, companyId } = await contractedOrder("Beta Suscripción SL");
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    // Repetir la petición reutiliza la sesión abierta: un solo enlace por contratación
    expect(await ok(call("POST", `/stripe/orders/${orderId}/checkout`))).toMatchObject({ sessionId: s.sessionId, reused: true });
    const subId = gw.completeSession(s.sessionId);
    await ok(stripeWebhook(gw.events[0]));
    await until(async () => (await orderState(orderId)) === "active");
    const sub = (await subsStore.list({ companyId }))[0];
    expect((await ok(call("GET", `/subscriptions/${sub.id}`))).billing).toMatchObject({
      source: "stripe",
      mode: "test",
      orderId,
      orderState: "active",
      lastPayment: { status: "succeeded", purpose: "initial", amountCents: 2900, currency: "EUR" },
    });
    expect((await ok(call("GET", `/subscriptions?companyId=${companyId}`))).subscriptions[0].billing).toMatchObject({ source: "stripe", orderId });
    // Una segunda contratación para la misma empresa se rechaza: nunca dos suscripciones ni dos cobros
    expect((await call("POST", "/orders", { body: { idempotencyKey: key(), companyId, request: { plan: "business", interval: "month", items: [] } } })).status).toBe(409);

    // Ninguna operación de simulación sobre una suscripción cobrada en Stripe
    const blocked: Array<[string, unknown]> = [
      ["/shadow", {}],
      ["/renewals", {}],
      ["/cancel", { reason: "Prueba", expectedVersion: sub.version }],
      ["/reactivate", { expectedVersion: sub.version }],
      ["/interval", { interval: "year", prices: [], expectedVersion: sub.version }],
    ];
    for (const [path, body] of blocked) {
      const r = await call("POST", `/subscriptions/${sub.id}${path}`, { body });
      expect(r.status, path).toBe(409);
      expect(r.json).toMatchObject({ error: "invalid_state", details: { reason: "stripe_billed", orderId } });
    }
    expect((await ok(call("GET", `/subscriptions/${sub.id}`))).shadowInvoices).toEqual([]);

    // Renovación: Stripe cobra el periodo siguiente y avisa; el periodo interno avanza y el cobro queda registrado
    const periodEndBefore = (await subsStore.get(sub.id))!.currentPeriodEnd;
    const stripeSub = (await gw.subscription(subId))!;
    clock = Math.max(clock, stripeSub.currentPeriodEnd * 1000, periodEndBefore) + 86_400_000;
    gw.updateSubscription(subId, { currentPeriodStart: stripeSub.currentPeriodEnd, currentPeriodEnd: stripeSub.currentPeriodEnd + 30 * 86_400 });
    gw.emit("invoice.paid", "invoice", gw.addInvoice(subId, stripeSub.customerId, "subscription_cycle", "paid", 2900));
    await ok(stripeWebhook(gw.events[0]));
    await until(async () => (await subsStore.get(sub.id))!.currentPeriodEnd > periodEndBefore);
    const after = await ok(call("GET", `/subscriptions/${sub.id}`));
    expect(after.subscription.currentPeriodEnd).toBeGreaterThan(periodEndBefore);
    expect(after.billing).toMatchObject({ orderState: "active", lastPayment: { status: "succeeded", purpose: "renewal", amountCents: 2900 } });
  });
});
