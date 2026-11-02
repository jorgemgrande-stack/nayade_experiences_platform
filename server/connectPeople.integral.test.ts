/**
 * Elephant People (`connect-people`) de punta a punta: contratación automática desde el panel con Stripe SIMULADO.
 *
 * Se encadena todo lo real menos Stripe (doble `FakeStripeGateway`, firma del webhook real del SDK) y la base de datos
 * (almacenes en memoria):
 *
 *   Core (tRPC: subscription.purchase / connect.catalog / panel.navigation) → canal comercial real
 *   (`commerceClientFromEnv`, HTTP a 127.0.0.1) → plano de control real (compra, orquestador, suscripciones,
 *   licencias, procesador de webhooks) → registro de licencias compartido → menú, permisos y candados del Core.
 *
 * En cada paso se comprueba el estado de activación (`activationFromOrders` / `orderActivation`) contra lo que sirve el
 * catálogo del panel (`panelCatalog`): none → pending → processing → active; error recuperable y reintento; la ventana
 * de error caduca. Además: idempotencia, permisos, suspensión y aislamiento entre empresas.
 *
 * El catálogo de ESTA prueba pone `connect-people` a la venta (1900 céntimos/mes, IVA excluido, Price preparado); el
 * catálogo real (`server/catalog/*`) no se toca. Sin red externa, sin Stripe real y sin claves.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import type { TrpcContext } from "./_core/context";
import { WebAdminService, withoutInternal, type SiteDocument } from "./web/service";
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
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { MemoryOrderStore } from "./orchestrator/store";
import type { CommercialOrder } from "./orchestrator/types";
import type { TrialNotifier } from "./trials/onboarding";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryInvoiceLineStore } from "./stripe/invoiceLines";
import { activationFromOrders, orderActivation, ERROR_WINDOW_MS, type PanelActivation } from "./commerce/panelActivation";
import { panelCatalog } from "./commerce/panelCatalog";

// El Core sin base de datos: usuarios del panel y contacto de soporte simulados (como en connect.ciclo.test.ts)
vi.mock("./subscriptionDb", async (orig) => ({ ...(await orig<typeof import("./subscriptionDb")>()), countPanelUsers: async () => 1 }));
vi.mock("./supportContact", () => ({ resolveSupportContact: async () => ({ email: "ayuda@elephant.example" }) }));

import { router } from "./_core/trpc";
import { subscriptionRouter } from "./routers/subscriptionRouter";
import { connectRouter } from "./routers/connectRouter";
import { panelRouter } from "./routers/panelRouter";
import { configureCapabilityAccess, _resetCapabilityAccessForTests } from "./_core/capabilities/access";
import { runWithTenant } from "./_core/tenant";
import { capabilityStateFrom, resolveNav, routeAccess, TASK_NAV } from "../shared/adminNav";
import { WORKPLACE_LOCKS, workplaceLockItems } from "../client/src/components/connect/WorkplaceLocks";

const PEOPLE = "connect-people";
const ADMIN = "people-integral-admin-token-aaaaaaaaaaaa";
/** Token de servicio del Core: SOLO el canal comercial (el tenant lo pone el Core desde la sesión). */
const CORE = "people-integral-core-token-bbbbbbbbbbbbb";
const WEB = "https://web.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "c".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 10, 2, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let web: WebAdminService;
const env = { ...process.env };
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const trialStore = new MemoryTrialStore();
const gw = new FakeStripeGateway();
const stripeStore = new MemoryStripeStore();
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };

/** Una foto por cada transición de un pedido de cambio con Elephant People: estado del pedido, activación y licencia. */
interface Step {
  orderId: number;
  tenantId: string;
  orderState: string;
  activation: PanelActivation | undefined;
  activationMap: Map<string, PanelActivation>;
  licensed: boolean;
}
const steps: Step[] = [];
/** Pedidos en memoria que anotan cada transición (sin tocar el código del orquestador). */
class RecordingOrderStore extends MemoryOrderStore {
  override async transition(...args: Parameters<MemoryOrderStore["transition"]>) {
    const next = await super.transition(...args);
    if (next.kind === "change" && next.tenantId && (next.request?.items ?? []).some((i) => i.key === PEOPLE)) {
      const map = activationFromOrders(await this.list({ companyId: next.companyId }), next.tenantId, clock);
      steps.push({ orderId: next.id, tenantId: next.tenantId, orderState: next.state, activation: map.get(PEOPLE), activationMap: map, licensed: (await activeCaps(next.tenantId)).includes("people-hr") });
    }
    return next;
  }
}
const orders = new RecordingOrderStore();

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
/** Lo que Stripe enviaría al webhook, firmado con el secreto (firma real del SDK). */
const stripeWebhook = (ev: GwEvent) => {
  const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
};
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no llegó al estado esperado");
};
const orderState = async (id: number) => (await ok(call("GET", `/orders/${id}`))).order.state as string;
/** Entrega por webhook (firma real) los eventos que el doble emitió desde `mark`, en orden. */
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
}
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
const activeCaps = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);

/** Catálogo del panel tal como lo sirve el plano de control al Core (token del Core). */
const panelItem = async (tenantId: string) => {
  const c = (await ok(call("GET", `/commerce/tenants/${tenantId}/catalog`, { token: CORE }))).catalog;
  return c.items.find((i: { key: string }) => i.key === PEOPLE) as { purchasable: boolean; monthly: { amountCents: number; currency: string; taxIncluded: boolean }; capabilities: string[]; activation: PanelActivation };
};
/** Lector de activación del plano de control (el mismo que monta el catálogo del panel). */
const readActivation = (tenantId: string) => orderActivation({ crm: crmStore, orders, now: () => clock })(tenantId);
/** Lo que pintaría el catálogo del panel con un mapa de activación concreto (p. ej. el de una foto intermedia). */
const panelWith = async (activation: Map<string, PanelActivation>) => {
  const site = withoutInternal(await web.site("published"));
  const c = quoteCatalogFromSite(site);
  return panelCatalog(c.products, { version: c.version, purchasesEnabled: true, site, activation }).items.find((i) => i.key === PEOPLE)!;
};

// ── Core ──────────────────────────────────────────────────────────────────────────
const core = router({ subscription: subscriptionRouter, connect: connectRouter, panel: panelRouter });
const ctxFor = (role: string, id = 1): TrpcContext => ({
  user: { id, openId: "o", email: "ana@empresa.example", name: "Ana", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as NonNullable<TrpcContext["user"]>,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
const as = <T,>(tenant: string, fn: () => Promise<T>) => runWithTenant(tenant, fn);
const corePurchase = (tenant: string, idempotencyKey: string, role = "admin") =>
  as(tenant, () => core.createCaller(ctxFor(role)).subscription.purchase({ add: [PEOPLE], idempotencyKey })) as Promise<{ status: string; orderId: number; created?: boolean }>;
const coreCatalog = (tenant: string, role = "admin") => as(tenant, () => core.createCaller(ctxFor(role)).connect.catalog());
const coreItem = async (tenant: string) => (await coreCatalog(tenant)).items.find((i) => i.key === PEOPLE)!;
const menu = async (tenant: string) => {
  const caller = core.createCaller(ctxFor("admin"));
  const [ov, nav] = await as(tenant, () => Promise.all([caller.subscription.overview(), caller.panel.navigation()]));
  const state = capabilityStateFrom(ov);
  return { nav, state, sections: resolveNav(TASK_NAV, { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: state }, nav.entries) };
};
const menuHrefs = async (tenant: string) => (await menu(tenant)).sections.flatMap((s) => s.items.map((i) => i.href));
const routeOf = async (tenant: string, path: string) => {
  const m = await menu(tenant);
  return routeAccess(path, m.state, m.nav.routes);
};
/** Candados del lugar de trabajo «administración» con el catálogo que recibe el panel del Core. */
const adminLocks = async (tenant: string) => workplaceLockItems((await coreCatalog(tenant)).items, WORKPLACE_LOCKS.admin).map((i) => i.key);

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
  web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  // SOLO en esta prueba: Elephant People a la venta, preparado para Stripe, con su precio de test equivalente al real
  // Preparado para Stripe ANTES de abrir la venta: como extensión de Elephant Connect «bajo solicitud», su Price ya
  // existe (no vendible) por la regla de familia. `catalog.stripePrepared` no se puede poner en la ficha: el esquema
  // del borrador (server/web/schemas.ts) no admite ese campo, aunque server/stripe/catalog.ts y
  // server/subscriptions/ports.ts lo leen.
  expect((await desiredCatalog(catalogFromWebStore(webStore))).filter((d) => d.productKey === PEOPLE)).toEqual([expect.objectContaining({ kind: "monthly", amountCents: 1900, currency: "EUR", sellable: false })]);
  const { entry } = await web.get("product", PEOPLE);
  const draft = structuredClone(entry.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
  draft.technicalStatus = "available";
  draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available" };
  const saved = await web.save("product", PEOPLE, { draft, expectedVersion: entry.draftVersion }, "operator:test");
  await web.publish("product", PEOPLE, saved.draftVersion, "operator:test");
  // Catálogo de Stripe (doble) creado según el plan de escrituras y enlazado
  const desired = await desiredCatalog(catalogFromWebStore(webStore));
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  const linked = (await syncCatalog(desired, gw, stripeStore, clock)).linked;
  // Precio de test equivalente al real: 1900 céntimos/mes en EUR, a la venta
  expect(desired.filter((d) => d.productKey === PEOPLE)).toEqual([expect.objectContaining({ kind: "monthly", amountCents: 1900, currency: "EUR", sellable: true })]);
  const peopleLookup = desired.find((d) => d.productKey === PEOPLE)!.lookupKey;
  expect(linked.filter((l) => l.lookupKey === peopleLookup && l.sellable)).toHaveLength(1);
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
    subscriptions: { store: subsStore, now: () => clock },
    capabilities: caps,
    limits: new MemoryTenantLimitStore(),
    trials: { store: trialStore, publicEnabled: false, autoProvision: true, notify },
    orders: { store: orders, payments: null },
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
      termsVersion: null,
      purchases: { enabled: true, changes: new MemorySubscriptionChangeStore(), internalTenants: new Set<string>() },
      invoiceLines: new MemoryInvoiceLineStore(),
    },
  });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  // El Core: multiempresa, canal comercial real hacia este plano de control y el MISMO registro de licencias
  process.env.TENANT_MODE = "multi";
  process.env.CP_COMMERCE_URL = `http://127.0.0.1:${port}`;
  process.env.CP_COMMERCE_TOKEN = CORE;
  configureCapabilityAccess(caps, { now: () => clock, enforce: true, ttlMs: 30_000 });
});

afterAll(async () => {
  process.env = env;
  _resetCapabilityAccessForTests();
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Empresa con Essential mensual pagado por Checkout y activo (pedido asistido firmado → cobro → licencias). */
async function activeCompany(name: string) {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Beta", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
  const orderId = created.order.id as number;
  await ok(call("POST", `/orders/${orderId}/accept`, { body: { signatureRef: `firma-${c.id}`, approvalReason: "Aprobado para la prueba integral" } }), [200, 202]);
  const mark = gw.events.length;
  const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
  gw.completeSession(s.sessionId);
  await deliverSince(mark);
  await until(async () => (await orderState(orderId)) === "active");
  await settled();
  const tenantId = (await ok(call("GET", `/orders/${orderId}`))).order.tenantId as string;
  const subId = gw.sessions.get(s.sessionId)!.subscriptionId!;
  gw.now = Math.floor(clock / 1000);
  return { orderId, companyId: c.id as number, tenantId, subId, customerId: gw.subscriptions.get(subId)!.customerId };
}
type Company = Awaited<ReturnType<typeof activeCompany>>;

describe("Elephant People: contratación automática de punta a punta (Stripe simulado)", () => {
  let A: Company;
  let B: Company;

  it("sin compra: activación «none» en el plano de control y en el catálogo del panel; el Core lo ofrece con candado", async () => {
    A = await activeCompany("People Integral A SL");
    B = await activeCompany("People Integral B SL");
    for (const t of [A, B]) {
      expect((await readActivation(t.tenantId)).has(PEOPLE)).toBe(false);
      const item = await panelItem(t.tenantId);
      expect(item.activation).toEqual({ state: "none", retryable: false, updatedAt: null });
      expect(item).toMatchObject({ purchasable: true, capabilities: ["people-hr"], monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false } });
      expect(await activeCaps(t.tenantId)).not.toContain("people-hr");
    }
    // Core: a la venta para la administración, fuera del menú, ruta cerrada y candado en «administración»
    const cat = await coreCatalog(A.tenantId);
    expect([cat.canPurchase, cat.purchaseBlock, cat.plan?.key]).toEqual([true, null, "essential"]);
    expect((await coreItem(A.tenantId)).state).toBe("available");
    expect(await menuHrefs(A.tenantId)).not.toContain("/admin/personal");
    expect(await routeOf(A.tenantId, "/admin/personal/empleados/1")).toBe("not_included");
    expect(await adminLocks(A.tenantId)).toContain(PEOPLE);
  });

  it("permisos: solo la administración compra; un agente ve el motivo y su intento no crea pedido", async () => {
    const view = await coreCatalog(A.tenantId, "agente");
    expect([view.canPurchase, view.purchaseBlock]).toEqual([false, "role"]);
    const before = (await orders.list({ companyId: A.companyId })).length;
    await expect(corePurchase(A.tenantId, key(), "agente")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(coreCatalog(A.tenantId, "user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await orders.list({ companyId: A.companyId })).length).toBe(before);
  });

  it("compra con cobro correcto desde el Core: pending → processing → active; la licencia solo con el cobro verificado; repetir no cobra ni concede dos veces", async () => {
    steps.length = 0;
    const idem = key();
    const invoicesBefore = gw.invoices.size;
    const grantsBefore = (await caps.list(A.tenantId)).length;
    const mark = gw.events.length;
    const r = await corePurchase(A.tenantId, idem);
    expect(r.status).toBe("applied");
    const changeOrder = r.orderId;

    // Recorrido del pedido de cambio, foto a foto
    const mine = steps.filter((s) => s.orderId === changeOrder);
    // La licencia aparece al quedar «licensed», pero el panel sigue en «processing» hasta que el pedido es vigente
    expect(mine.filter((s) => s.orderState !== "quoted").map((s) => [s.orderState, s.activation?.state, s.licensed])).toEqual([
      ["contracted", "pending", false],
      ["confirmed", "processing", false],
      ["subscribed", "processing", false],
      ["licensed", "processing", true],
      ["active", "active", true],
    ]);
    for (const s of mine) {
      const expected = s.orderState === "contracted" ? "pending" : ["confirmed", "subscribed", "licensed"].includes(s.orderState) ? "processing" : s.orderState === "active" ? "active" : null;
      if (expected) expect(s.activation?.state, `pedido en «${s.orderState}»`).toBe(expected);
      // Lo que serviría el catálogo del panel en ese mismo instante
      if (expected) expect((await panelWith(s.activationMap)).activation?.state).toBe(expected);
    }
    // Pendiente y procesando sin licencia; activo con licencia
    const pendingStep = mine.find((s) => s.orderState === "contracted")!;
    const confirmedStep = mine.find((s) => s.orderState === "confirmed")!;
    expect(pendingStep.licensed).toBe(false);
    expect(confirmedStep.licensed).toBe(false);
    expect(mine.at(-1)).toMatchObject({ orderState: "active", licensed: true });
    // El orden es monótono: nunca vuelve atrás
    const rank = { pending: 0, processing: 1, active: 2 } as Record<string, number>;
    const ranks = mine.map((s) => rank[s.activation?.state ?? ""]).filter((x) => x !== undefined);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    // Estado final: plano de control y catálogo del panel coinciden; licencia para ESTE tenant
    expect((await readActivation(A.tenantId)).get(PEOPLE)).toMatchObject({ state: "active", retryable: false });
    expect((await panelItem(A.tenantId)).activation).toMatchObject({ state: "active", retryable: false });
    expect(await activeCaps(A.tenantId)).toContain("people-hr");
    expect(gw.invoices.size).toBe(invoicesBefore + 1);

    // Misma clave (doble clic, reintento de red): mismo pedido, ningún cobro ni licencia nuevos
    const grantsAfter = (await caps.list(A.tenantId)).length;
    const again = await corePurchase(A.tenantId, idem);
    expect(again).toMatchObject({ status: "applied", orderId: changeOrder });
    expect(gw.invoices.size).toBe(invoicesBefore + 1);
    expect((await caps.list(A.tenantId)).length).toBe(grantsAfter);
    expect(grantsAfter).toBeGreaterThan(grantsBefore);
    // Los webhooks del cobro llegan después (firma real) y no cambian nada
    await deliverSince(mark);
    await settled();
    expect(await orderState(changeOrder)).toBe("active");
    expect((await ok(call("GET", `/orders/${changeOrder}`))).payments).toHaveLength(1);
    expect((await caps.list(A.tenantId)).length).toBe(grantsAfter);
  });

  it("Core con la licencia: entrada de People en el menú, ruta abierta, sin candado; la otra empresa no ve nada", async () => {
    const item = await coreItem(A.tenantId);
    expect([item.state, item.purchasable]).toEqual(["active", false]);
    expect(await menuHrefs(A.tenantId)).toContain("/admin/personal");
    const { nav, sections } = await menu(A.tenantId);
    expect(nav.entries.map((e) => e.moduleId)).toEqual(["people"]);
    const people = sections.find((s) => s.id === "contratados")!.items.find((i) => i.key === "x-people-personal")!;
    expect(people.children!.map((c) => c.href)).toContain("/admin/personal/nominas");
    expect(await routeOf(A.tenantId, "/admin/personal/empleados/7")).toBe("allowed");
    expect(await adminLocks(A.tenantId)).not.toContain(PEOPLE);

    // Aislamiento: B sigue sin licencia, sin pedido, sin menú y con candado
    expect(await activeCaps(B.tenantId)).not.toContain("people-hr");
    expect((await readActivation(B.tenantId)).has(PEOPLE)).toBe(false);
    expect((await panelItem(B.tenantId)).activation.state).toBe("none");
    expect((await coreItem(B.tenantId)).state).toBe("available");
    expect(await menuHrefs(B.tenantId)).not.toContain("/admin/personal");
    expect((await menu(B.tenantId)).nav.entries).toEqual([]);
    expect(await routeOf(B.tenantId, "/admin/personal/empleados/7")).toBe("not_included");
    expect(await adminLocks(B.tenantId)).toContain(PEOPLE);
    // El pedido de A no existe para B
    const aOrder = steps.find((s) => s.tenantId === A.tenantId)!.orderId;
    await expect(as(B.tenantId, () => core.createCaller(ctxFor("admin")).subscription.purchaseStatus({ orderId: aOrder }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cobro fallido y cambio caducado en Stripe: pedido rechazado → «error» recuperable, sin licencia; el reintento pasa a pending y luego a active", async () => {
    const C = await activeCompany("People Integral Reintento SL");
    gw.paymentOutcome.set(C.customerId, "fail");
    const mark = gw.events.length;
    const r = await corePurchase(C.tenantId, key());
    expect(r.status).toBe("payment_pending");
    expect((await panelItem(C.tenantId)).activation.state).toBe("pending");
    expect((await readActivation(C.tenantId)).get(PEOPLE)?.state).toBe("pending");
    // Webhooks del fallo (firma real): nada concedido
    await deliverSince(mark);
    await settled();
    expect(await activeCaps(C.tenantId)).not.toContain("people-hr");
    // Pasan 23 h sin cobro: Stripe descarta el cambio → pedido rechazado
    const mark2 = gw.events.length;
    gw.expirePendingUpdate(C.subId);
    await deliverSince(mark2);
    await until(async () => (await orderState(r.orderId)) === "rejected");
    await settled();
    expect((await readActivation(C.tenantId)).get(PEOPLE)).toMatchObject({ state: "error", retryable: true });
    expect((await panelItem(C.tenantId)).activation).toMatchObject({ state: "error", retryable: true });
    expect(await activeCaps(C.tenantId)).not.toContain("people-hr");
    expect((await coreItem(C.tenantId)).state).toBe("available");
    expect(await menuHrefs(C.tenantId)).not.toContain("/admin/personal");

    // Reintento (otra clave): el cliente tiene que autenticar el pago → pending; paga → processing → active
    steps.length = 0;
    gw.paymentOutcome.set(C.customerId, "requires_action");
    const retry = await corePurchase(C.tenantId, key());
    expect(retry.status).toBe("payment_pending");
    expect(retry.orderId).not.toBe(r.orderId);
    expect((await panelItem(C.tenantId)).activation).toMatchObject({ state: "pending", retryable: false });
    expect(await activeCaps(C.tenantId)).not.toContain("people-hr");
    const mark3 = gw.events.length;
    gw.payInvoice(gw.subscriptions.get(C.subId)!.latestInvoiceId!);
    await deliverSince(mark3);
    await until(async () => (await orderState(retry.orderId)) === "active");
    await settled();
    const mine = steps.filter((s) => s.orderId === retry.orderId);
    const confirmed = mine.find((s) => s.orderState === "confirmed");
    expect(confirmed?.activation?.state).toBe("processing");
    expect(confirmed?.licensed).toBe(false);
    expect((await panelItem(C.tenantId)).activation).toMatchObject({ state: "active", retryable: false });
    expect(await activeCaps(C.tenantId)).toContain("people-hr");
    // El Core lo ve al consultar el estado del pedido (descarta la caché de licencias)
    const st = await as(C.tenantId, () => core.createCaller(ctxFor("admin")).subscription.purchaseStatus({ orderId: retry.orderId }));
    expect((st as { status: string }).status).toBe("applied");
    expect((await coreItem(C.tenantId)).state).toBe("active");
    expect(await menuHrefs(C.tenantId)).toContain("/admin/personal");
  });

  it("suspender la licencia: la entrada de People desaparece del menú y la ruta se cierra", async () => {
    await caps.apply(A.tenantId, [{ capabilityId: "people-hr", siteId: "", status: "suspended", validUntil: null, source: "operator" }], { actor: "operador", reason: "impago", now: clock });
    clock += 31_000; // la caché de licencias del Core se renueva sola
    expect(await menuHrefs(A.tenantId)).not.toContain("/admin/personal");
    expect((await menu(A.tenantId)).nav.entries).toEqual([]);
    expect(await routeOf(A.tenantId, "/admin/personal/nominas")).toBe("not_included");
    const s = await coreItem(A.tenantId);
    expect([s.state, s.purchasable]).toEqual(["incident", false]);
    // Las otras empresas no se ven afectadas
    expect(await menuHrefs(B.tenantId)).not.toContain("/admin/personal");
  });

  it("pasada ERROR_WINDOW_MS, el error de una compra fallida desaparece del catálogo del panel", async () => {
    const D = await activeCompany("People Integral Ventana SL");
    gw.paymentOutcome.set(D.customerId, "fail");
    const r = await corePurchase(D.tenantId, key());
    expect(r.status).toBe("payment_pending");
    const mark = gw.events.length;
    gw.expirePendingUpdate(D.subId);
    await deliverSince(mark);
    await until(async () => (await orderState(r.orderId)) === "rejected");
    await settled();
    expect((await panelItem(D.tenantId)).activation).toMatchObject({ state: "error", retryable: true });
    clock += ERROR_WINDOW_MS - 60_000;
    expect((await panelItem(D.tenantId)).activation.state).toBe("error");
    clock += 120_000;
    expect((await readActivation(D.tenantId)).has(PEOPLE)).toBe(false);
    expect((await panelItem(D.tenantId)).activation).toEqual({ state: "none", retryable: false, updatedAt: null });
    expect(await activeCaps(D.tenantId)).not.toContain("people-hr");
  });
});
