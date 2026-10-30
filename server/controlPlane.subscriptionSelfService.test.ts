/**
 * Autoservicio de la suscripción cobrada en Stripe (baja, reactivación y cambio de plan), de punta a punta por HTTP
 * con la aplicación REAL del plano de control (orquestador, suscripciones, licencias y procesador de eventos
 * reales; Stripe es un doble y la firma del webhook es la real del SDK):
 *
 *  - baja al final del periodo → webhook → pedido «cancel_scheduled»; deshacer → webhook → activo; repeticiones
 *    sin otra llamada a Stripe; motivo guardado como nota del CRM; nada borrado;
 *  - subida de plan → webhook → pedido de cambio activo y licencias del nuevo plan; repetición sin otro cobro;
 *    cobro pendiente (3DS): nada cambia; bajada: programada en Stripe para el fin del periodo (Subscription
 *    Schedule) y reflejada por el webhook al cambiar de fase; sin poder programarla, solicitud para el CRM; un
 *    calendario ajeno no se toca;
 *  - interruptores apagados → 503; otra empresa o inexistente → 404; sin token del Core → 403; empresa no cobrada
 *    en Stripe → error claro.
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
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MemoryOrderStore } from "./orchestrator/store";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { StripeGatewayError, stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";

const ADMIN = "selfsub-admin-token-aaaaaaaaaaaaaaaaaaaaa";
/** Token de servicio del Core: el tenant lo pone el Core desde su sesión. */
const CORE = "selfsub-core-token-bbbbbbbbbbbbbbbbbbbbbbb";
const WEB = "https://web.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "y".repeat(24)].join("_"), webhookSecret: ["whsec", "c".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

const clock = Date.UTC(2026, 9, 18, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
/** Interruptores (los lee el servicio en cada petición). */
const flags = { cancel: true, planChange: true };

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
const orderOf = async (id: number) => (await ok(call("GET", `/orders/${id}`))).order as { id: number; state: string; kind: string; request: { plan: string; interval: string }; tenantId: string; subscriptionId: number };
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
}
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
const capsOf = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);
/** Pedido vigente (el último vivo) de la empresa. */
const liveOrder = async (companyId: number) => (await orders.list({ companyId })).filter((o) => ["active", "past_due", "suspended", "cancel_scheduled"].includes(o.state)).sort((a, b) => b.id - a.id)[0];
const stripeCalls = (op: string) => gw.calls.filter((c) => c.op === op).length;

beforeAll(async () => {
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
  // Planes y un módulo aprobados para venta libre SOLO en esta prueba (en el catálogo real son «bajo solicitud»)
  for (const k of ["essential", "business", "connect-people"]) {
    const { entry: e } = await web.get("product", k);
    const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
    draft.technicalStatus = "available";
    draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available" };
    const saved = await web.save("product", k, { draft, expectedVersion: e.draftVersion }, "operator:test");
    await web.publish("product", k, saved.draftVersion, "operator:test");
  }
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  await syncCatalog(desired, gw, stripeStore, clock);
  crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "test" } }), now: () => clock });
  const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read"] as const;
  const app = createControlPlaneApp({
    tokens: [
      { id: "admin", sha256: hashToken(ADMIN), scopes: [...all] },
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
    subscriptions: { store: new MemorySubscriptionStore(), now: () => clock },
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: new MemoryTrialStore(), publicEnabled: false, autoProvision: true, notify: { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined } },
    orders: { store: orders, payments: null },
    stripe: {
      config,
      store: stripeStore,
      gateway: gw,
      urls: { success: `${WEB}/contratacion/estado`, cancel: `${WEB}/contratacion/cancelada`, portalReturn: "https://app.elephant.test/admin/suscripcion" },
      checkoutEnabled: true,
      verifyWebhook: stripeWebhookVerifier(config),
      workerEnabled: false,
      publicStatus: false,
      selfService: false,
      termsVersion: null,
      purchases: { enabled: true, changes: new MemorySubscriptionChangeStore() },
      selfServiceSubscription: flags,
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

/** Empresa con el plan pagado por Checkout y activo. */
async function activeCompany(name: string, plan = "essential", interval = "month") {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Beta", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan, interval, items: [] } } }), 201);
  const orderId = created.order.id as number;
  await ok(call("POST", `/orders/${orderId}/accept`, { body: { signatureRef: `firma-${c.id}`, approvalReason: "Aprobado para la prueba" } }), [200, 202]);
  const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
  const mark = gw.events.length;
  gw.completeSession(s.sessionId);
  await deliverSince(mark);
  await until(async () => (await orderOf(orderId)).state === "active");
  const tenantId = (await orderOf(orderId)).tenantId;
  const subId = gw.sessions.get(s.sessionId)!.subscriptionId!;
  return { orderId, companyId: c.id, tenantId, subId, customerId: gw.subscriptions.get(subId)!.customerId };
}
const T = (tenantId: string) => `/commerce/tenants/${tenantId}`;
const cancel = (tenantId: string, body: Record<string, unknown> = {}, token: string | null = CORE) => call("POST", `${T(tenantId)}/cancellation`, { token, body: { idempotencyKey: key(), user: "user:7", ...body } });
const undo = (tenantId: string, body: Record<string, unknown> = {}, token: string | null = CORE) => call("POST", `${T(tenantId)}/cancellation/undo`, { token, body: { idempotencyKey: key(), user: "user:7", ...body } });
const changePlan = (tenantId: string, body: Record<string, unknown>, token: string | null = CORE) => call("POST", `${T(tenantId)}/plan-change`, { token, body: { idempotencyKey: key(), user: "user:7", ...body } });

describe("autoservicio de la suscripción cobrada en Stripe", () => {
  it("baja al final del periodo → webhook → baja programada; deshacer → activa; las repeticiones no llaman otra vez a Stripe", async () => {
    const a = await activeCompany("Baja Panel SL");
    const capsBefore = (await capsOf(a.tenantId)).sort();
    const st = (await ok(call("GET", `${T(a.tenantId)}/cancellation`, { token: CORE }))).cancellation;
    expect(st).toMatchObject({ enabled: true, available: true, scheduled: false, canCancel: true, canUndo: false });
    expect(st.periodEnd).toBe(gw.subscriptions.get(a.subId)!.currentPeriodEnd! * 1000);

    const idem = key();
    const mark = gw.events.length;
    const r = await ok(cancel(a.tenantId, { idempotencyKey: idem, reason: "Cerramos la temporada" }), 201);
    expect(r.cancellation).toMatchObject({ status: "scheduled", cancelAt: st.periodEnd, created: true });
    expect(gw.subscriptions.get(a.subId)!.cancelAtPeriodEnd).toBe(true);
    // Nada cambia en Elephant hasta que llega el webhook
    expect((await liveOrder(a.companyId)).state).toBe("active");
    await deliverSince(mark);
    await settled();
    expect((await liveOrder(a.companyId)).state).toBe("cancel_scheduled");
    // Licencias y datos intactos hasta el fin del periodo
    expect((await capsOf(a.tenantId)).sort()).toEqual(capsBefore);
    // Motivo guardado como nota de la empresa en el CRM
    const notes = await crmStore.list("activities", { entityType: "company", entityId: a.companyId, kind: "note" });
    expect(notes.some((n) => n.summary.includes("Baja programada desde el panel") && n.summary.includes("Cerramos la temporada"))).toBe(true);

    // Repetición (misma clave u otra): ya programada, sin otra llamada a Stripe
    const before = stripeCalls("subscriptions.update(cancel_at_period_end)");
    expect((await ok(cancel(a.tenantId, { idempotencyKey: idem }), 200)).cancellation).toMatchObject({ status: "scheduled", created: false });
    expect((await ok(cancel(a.tenantId), 200)).cancellation.created).toBe(false);
    expect(stripeCalls("subscriptions.update(cancel_at_period_end)")).toBe(before);
    expect((await ok(call("GET", `${T(a.tenantId)}/cancellation`, { token: CORE }))).cancellation).toMatchObject({ scheduled: true, canCancel: false, canUndo: true });
    // Con la baja programada no se cambia de plan
    expect((await changePlan(a.tenantId, { plan: "business", interval: "month" })).status).toBe(409);

    // Deshacer → webhook → activa otra vez
    const mark2 = gw.events.length;
    const u = await ok(undo(a.tenantId), 201);
    expect(u.cancellation).toMatchObject({ status: "active", cancelAt: null, created: true });
    await deliverSince(mark2);
    await settled();
    expect((await liveOrder(a.companyId)).state).toBe("active");
    expect((await capsOf(a.tenantId)).sort()).toEqual(capsBefore);
    const again = stripeCalls("subscriptions.update(cancel_at_period_end)");
    expect((await ok(undo(a.tenantId), 200)).cancellation).toMatchObject({ status: "active", created: false });
    expect(stripeCalls("subscriptions.update(cancel_at_period_end)")).toBe(again);
  });

  it("subida de plan → webhook → pedido de cambio activo y licencias del nuevo plan; la repetición no cobra dos veces", async () => {
    const a = await activeCompany("Sube Plan Panel SL");
    expect(await capsOf(a.tenantId)).not.toContain(capabilitiesOfTier("business")[0]);
    const view = (await ok(call("GET", `${T(a.tenantId)}/plan-change`, { token: CORE }))).planChange;
    expect(view).toMatchObject({ enabled: true, available: true, current: { plan: "essential", interval: "month" } });
    expect(view.options).toEqual(expect.arrayContaining([expect.objectContaining({ plan: "business", interval: "month", direction: "upgrade" })]));
    // El navegador solo dice QUÉ plan: un importe enviado se rechaza
    expect((await call("POST", `${T(a.tenantId)}/plan-change/preview`, { token: CORE, body: { plan: "business", interval: "month", amountCents: 1 } })).status).toBe(400);
    const p = (await ok(call("POST", `${T(a.tenantId)}/plan-change/preview`, { token: CORE, body: { plan: "business", interval: "month" } }))).preview;
    expect(p).toMatchObject({ direction: "upgrade", current: { plan: "essential" }, target: { plan: "business", interval: "month" }, currency: "EUR" });
    expect(p.amountDueCents).toBeGreaterThan(0);

    const idem = key();
    const invoices = gw.invoices.size;
    const mark = gw.events.length;
    const r = await ok(changePlan(a.tenantId, { idempotencyKey: idem, plan: "business", interval: "month" }), 201);
    expect(r.planChange).toMatchObject({ status: "applied", created: true });
    expect(gw.invoices.size).toBe(invoices + 1);
    // El reflejo llega SOLO por el webhook
    expect((await liveOrder(a.companyId)).id).toBe(a.orderId);
    await deliverSince(mark);
    await settled();
    const cur = await liveOrder(a.companyId);
    expect(cur).toMatchObject({ kind: "change", previousOrderId: a.orderId, state: "active", request: { plan: "business", interval: "month" } });
    expect((await orderOf(a.orderId)).state).toBe("superseded");
    expect(await capsOf(a.tenantId)).toEqual(expect.arrayContaining(capabilitiesOfTier("business")));
    // Repetición: ya aplicado, sin otra factura ni llamada
    const updates = stripeCalls("subscriptions.update");
    expect((await ok(changePlan(a.tenantId, { idempotencyKey: idem, plan: "business", interval: "month" }), 200)).planChange).toMatchObject({ status: "applied", created: false });
    expect(gw.invoices.size).toBe(invoices + 1);
    expect(stripeCalls("subscriptions.update")).toBe(updates);
  });

  it("subida con autenticación pendiente: nada cambia y no se admite otra; bajada: programada en Stripe y reflejada al cambiar de fase", async () => {
    const a = await activeCompany("Plan Pendiente SL");
    gw.paymentOutcome.set(a.customerId, "requires_action");
    const pricesBefore = [...gw.subscriptions.get(a.subId)!.priceIds];
    const r = await ok(changePlan(a.tenantId, { plan: "business", interval: "year" }), 201);
    expect(r.planChange).toMatchObject({ status: "payment_pending", paymentUrl: expect.stringMatching(/^https:\/\//) });
    expect(gw.subscriptions.get(a.subId)!.priceIds).toEqual(pricesBefore);
    expect((await changePlan(a.tenantId, { plan: "business", interval: "month" })).status).toBe(409);
    expect((await liveOrder(a.companyId)).request.plan).toBe("essential");
    gw.expirePendingUpdate(a.subId);
    gw.paymentOutcome.delete(a.customerId);

    const b = await activeCompany("Baja Plan SL", "business", "year");
    const subBefore = JSON.stringify(gw.subscriptions.get(b.subId));
    const calls = gw.calls.length;
    const p = (await ok(call("POST", `${T(b.tenantId)}/plan-change/preview`, { token: CORE, body: { plan: "essential", interval: "year" } }))).preview;
    expect(p).toMatchObject({ direction: "downgrade", amountDueCents: 0, effectiveAt: gw.subscriptions.get(b.subId)!.currentPeriodEnd! * 1000 });
    const periodEnd = gw.subscriptions.get(b.subId)!.currentPeriodEnd! * 1000;
    const d = await ok(changePlan(b.tenantId, { plan: "essential", interval: "year" }), 201);
    expect(d.planChange).toMatchObject({ status: "scheduled", created: true, amountDueCents: 0, effectiveAt: periodEnd });
    expect((await ok(changePlan(b.tenantId, { plan: "essential", interval: "year" }), 200)).planChange).toMatchObject({ status: "scheduled", created: false });
    expect(gw.calls.slice(calls).filter((c) => c.op === "subscription_schedules.update")).toHaveLength(1);
    const tasks = await crmStore.list("activities", { entityType: "company", entityId: b.companyId, kind: "task" });
    expect(tasks.filter((t) => t.summary.startsWith("Bajada de plan programada en Stripe desde el panel"))).toHaveLength(1);
    // Hasta el fin del periodo nada cambia: ni partidas, ni facturas, ni el pedido
    const { scheduleId, ...rest } = gw.subscriptions.get(b.subId)!;
    expect(scheduleId).toMatch(/^sub_sched_/);
    expect(rest.priceIds).toEqual(JSON.parse(subBefore).priceIds);
    expect(rest.items).toEqual(JSON.parse(subBefore).items);
    expect(gw.calls.slice(calls).filter((c) => c.op === "subscriptions.update")).toHaveLength(0);
    expect((await liveOrder(b.companyId)).request.plan).toBe("business");
    // Fin del periodo: Stripe pasa a la fase siguiente y el webhook lo refleja (pedido de cambio y licencias)
    const mark = gw.events.length;
    gw.advanceSchedule(b.subId);
    await deliverSince(mark);
    await settled();
    expect(await liveOrder(b.companyId)).toMatchObject({ kind: "change", state: "active", request: { plan: "essential", interval: "year" } });
    expect(await capsOf(b.tenantId)).not.toContain(capabilitiesOfTier("business").find((c) => !capabilitiesOfTier("essential").includes(c)));
  });

  it("bajada sin poder programarla en Stripe: solicitud para el CRM; un calendario ajeno no se toca", async () => {
    const a = await activeCompany("Bajada Manual SL", "business", "month");
    const orig = gw.scheduleItemsAtPeriodEnd;
    gw.scheduleItemsAtPeriodEnd = async () => {
      throw new StripeGatewayError("permission_error", "Stripe respondió 403 (permission_error)", false);
    };
    try {
      const r = await ok(changePlan(a.tenantId, { plan: "essential", interval: "month" }), 201);
      expect(r.planChange).toMatchObject({ status: "requested", created: true });
      const tasks = await crmStore.list("activities", { entityType: "company", entityId: a.companyId, kind: "task" });
      expect(tasks.filter((t) => t.summary.startsWith("Bajada de plan solicitada desde el panel"))).toHaveLength(1);
    } finally {
      gw.scheduleItemsAtPeriodEnd = orig;
    }
    const b = await activeCompany("Calendario Ajeno SL", "business", "month");
    const sub = gw.subscriptions.get(b.subId)!;
    gw.schedules.set("sub_sched_ajeno", { subscriptionId: b.subId, items: [], effectiveAt: null, ours: false });
    gw.subscriptions.set(b.subId, { ...sub, scheduleId: "sub_sched_ajeno" });
    expect((await changePlan(b.tenantId, { plan: "essential", interval: "month" })).status).toBe(409);
    expect(gw.schedules.get("sub_sched_ajeno")).toMatchObject({ items: [], ours: false });
  });

  it("interruptores apagados → 503; otra empresa, permisos y empresa no cobrada en Stripe → errores claros", async () => {
    const a = await activeCompany("Aislada Panel SL");
    // Sin token del Core (operador sin commerce:purchase) o sin token
    expect((await cancel(a.tenantId, {}, ADMIN)).status).toBe(403);
    expect((await cancel(a.tenantId, {}, null)).status).toBe(401);
    // Empresa inexistente o con forma no válida
    expect((await cancel("no-existe")).status).toBe(404);
    expect((await changePlan("no-existe", { plan: "business", interval: "month" })).status).toBe(404);
    expect((await cancel("Mala_Forma")).status).toBe(400);
    // Empresa con plataforma pero sin cobro en Stripe: error claro, nada llamado
    const c = await crm.createCompany({ name: "Sin Stripe SL" }, "operator:test");
    await crmStore.update("companies", c.id, { tenantId: "t-sin-stripe" });
    const calls = gw.calls.length;
    const no = await cancel("t-sin-stripe");
    expect(no.status).toBe(409);
    expect(no.json).toMatchObject({ error: "unavailable", message: expect.stringMatching(/no se cobra en línea/) });
    expect((await ok(call("GET", `${T("t-sin-stripe")}/cancellation`, { token: CORE }))).cancellation).toMatchObject({ enabled: true, available: false, message: expect.stringMatching(/no se cobra en línea/) });
    expect(gw.calls.length).toBe(calls);

    // Interruptores apagados: 503 sin tocar nada; el estado lo dice
    flags.cancel = false;
    flags.planChange = false;
    try {
      const n = gw.calls.length;
      expect((await cancel(a.tenantId)).status).toBe(503);
      expect((await undo(a.tenantId)).status).toBe(503);
      expect((await changePlan(a.tenantId, { plan: "business", interval: "month" })).status).toBe(503);
      expect((await call("POST", `${T(a.tenantId)}/plan-change/preview`, { token: CORE, body: { plan: "business", interval: "month" } })).status).toBe(503);
      expect((await ok(call("GET", `${T(a.tenantId)}/cancellation`, { token: CORE }))).cancellation).toMatchObject({ enabled: false, canCancel: false });
      expect((await ok(call("GET", "/commerce/self-service/status", { token: CORE })))).toEqual({ cancel: false, planChange: false });
      expect(gw.calls.length).toBe(n);
      expect(gw.subscriptions.get(a.subId)!.cancelAtPeriodEnd).toBe(false);
    } finally {
      flags.cancel = true;
      flags.planChange = true;
    }
    expect((await liveOrder(a.companyId)).state).toBe("active");
  });
});
