/**
 * Price propio de cada extensión de Elephant Connect (regla del propietario, 01/11/2026), de punta a punta por HTTP
 * con la aplicación REAL del plano de control (orquestador, suscripciones, licencias y procesador de eventos reales;
 * Stripe es un doble y la firma del webhook es la real del SDK):
 *
 *  - Elephant People «bajo solicitud»: aparece en el catálogo deseado y en el plan de escrituras con su Product y su
 *    Price propios (19 €/mes, IVA aparte), se enlaza, y aun así NO se compra: ni desde el panel ni por Checkout;
 *  - People puesta en «available» SOLO dentro de esta prueba: se compra como partida adicional de la MISMA
 *    suscripción (sin tocar la partida del plan), con prorrateo; la renovación cobra plan + extensión con el IVA
 *    aparte; los webhooks repetidos no duplican licencias ni cobros; la baja quita solo su partida.
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
import { desiredCatalog, planCatalogWrites, syncCatalog, type DesiredPrice, type SkippedProduct } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MemoryStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryInvoiceLineStore } from "./stripe/invoiceLines";

const ADMIN = "extprices-admin-token-aaaaaaaaaaaaaaaaaaa";
const CORE = "extprices-core-token-bbbbbbbbbbbbbbbbbbbbb";
const WEB = "https://web.example";
const PEOPLE = "connect-people";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "e".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 10, 2, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
let web: WebAdminService;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
const changes = new MemorySubscriptionChangeStore();
const invoiceLines = new MemoryInvoiceLineStore();
const stripeStore = new MemoryStripeStore();
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };
let preparedDesired: DesiredPrice[] = [];
const preparedSkipped: SkippedProduct[] = [];

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
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
/** Entrega por webhook (firma real) los eventos que el doble emitió desde `mark`, en orden. */
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
  await settled();
}
const orderState = async (id: number) => (await ok(call("GET", `/orders/${id}`))).order.state as string;
const capsOf = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);
const buy = (tenantId: string, body: Record<string, unknown>) => call("POST", `/commerce/tenants/${tenantId}/purchases`, { token: CORE, body: { idempotencyKey: key(), buyer: "user:7", ...body } });
const reduce = (tenantId: string, body: Record<string, unknown>) => call("POST", `/commerce/tenants/${tenantId}/reductions`, { token: CORE, body: { idempotencyKey: key(), buyer: "user:7", ...body } });
const peopleMonthly = () => preparedDesired.find((d) => d.productKey === PEOPLE && d.kind === "monthly")!;
const essentialMonthly = () => preparedDesired.find((d) => d.productKey === "essential" && d.kind === "monthly")!;

/** Pone People en «available» (SOLO en esta prueba; en el catálogo real sigue «bajo solicitud»). */
async function openPeopleForSale() {
  const { entry: e } = await web.get("product", PEOPLE);
  const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
  draft.technicalStatus = "available";
  draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available" };
  const saved = await web.save("product", PEOPLE, { draft, expectedVersion: e.draftVersion }, "operator:test");
  await web.publish("product", PEOPLE, saved.draftVersion, "operator:test");
}

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
  // Catálogo tal cual: People «bajo solicitud» con su mensual aprobado (19 €, sin IVA)
  await seedElephantSource(web, webStore);
  preparedDesired = await desiredCatalog(catalogFromWebStore(webStore), { onSkip: (s) => preparedSkipped.push(s) });
  // Catálogo de Stripe creado según el plan de escrituras (lo que hará una persona) y enlazado
  for (const op of (await planCatalogWrites(preparedDesired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, taxBehavior: op.params.tax_behavior, metadata: op.params.metadata });
  }
  const sync = await syncCatalog(preparedDesired, gw, stripeStore, clock);
  expect(sync.conflicts).toEqual([]);
  expect(sync.missing).toEqual([]);
  // IVA aparte en todas las facturas del doble (como Stripe Tax con precios sin IVA)
  gw.invoiceTaxBp = 2100;
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
    trials: { store: new MemoryTrialStore(), publicEnabled: true, autoProvision: true, notify },
    orders: { store: orders, payments: null },
    publicIntake: { secret: "s".repeat(48), origins: [WEB] },
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
      purchases: { enabled: true, changes },
      invoiceLines,
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
async function contractedOrder(name: string, items: Array<{ key: string }> = []) {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Prueba", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items } } }), 201);
  await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-${c.id}`, approvalReason: "Aprobado por producto para la prueba" } }), [200, 202]);
  return { orderId: created.order.id as number, companyId: c.id };
}

/** Empresa con Essential mensual pagado por Checkout y activo. */
async function activeCompany(name: string) {
  const { orderId, companyId } = await contractedOrder(name);
  const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
  const mark = gw.events.length;
  gw.completeSession(s.sessionId);
  await deliverSince(mark);
  await until(async () => (await orderState(orderId)) === "active");
  const tenantId = (await ok(call("GET", `/orders/${orderId}`))).order.tenantId as string;
  const subId = gw.sessions.get(s.sessionId)!.subscriptionId!;
  return { orderId, companyId, tenantId, subId, customerId: gw.subscriptions.get(subId)!.customerId };
}

/** Stripe renueva la suscripción (nuevo periodo cobrado con sus partidas) y avisa por webhook. */
async function renew(a: { subId: string; customerId: string }, netCents: number) {
  const s = gw.subscriptions.get(a.subId)!;
  const end = s.currentPeriodEnd!;
  clock = Math.max(clock, end * 1000) + 5 * 86_400_000;
  gw.updateSubscription(a.subId, { currentPeriodStart: end, currentPeriodEnd: end + 30 * 86_400 });
  const mark = gw.events.length;
  const inv = gw.addInvoice(a.subId, a.customerId, "subscription_cycle", "paid", netCents);
  gw.emit("invoice.paid", "invoice", inv);
  await deliverSince(mark);
  return inv;
}

describe("Elephant People «bajo solicitud»: Product y Price propios, enlazados y NO vendibles", () => {
  it("catálogo deseado y plan de escrituras: aparece con su Product y su Price (19 €/mes, IVA aparte) y no es vendible", async () => {
    const people = preparedDesired.filter((d) => d.productKey === PEOPLE);
    expect(people).toEqual([expect.objectContaining({ kind: "monthly", interval: "month", amountCents: 1900, currency: "EUR", sellable: false, commercialStatus: "on_request", productName: "Elephant People", lookupKey: `es:connect-people:monthly:eur:v${people[0].webPriceId}` })]);
    // Los planes siguen vendibles; lo «próximamente» y «en preparación» no tiene Price
    expect(preparedDesired.filter((d) => d.sellable).map((d) => d.productKey)).toEqual(["essential", "essential", "business", "business"]);
    for (const k of ["connect-copilot", "connect-campaigns", "connect-whatsapp-ai", "connect-automations", "hotel-net-pms", "addon-user-essential"]) expect(preparedDesired.some((d) => d.productKey === k)).toBe(false);
    expect(preparedDesired.filter((d) => !d.sellable).every((d) => d.commercialStatus === "on_request")).toBe(true);
    expect(preparedSkipped).toEqual([]);
    // Lo que pide el plan de escrituras (HTTP): ya está todo creado y enlazado; People figura como no vendible
    const plan = await ok(call("GET", "/stripe/catalog/plan"));
    expect(plan.operations).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.desired.find((d: DesiredPrice) => d.productKey === PEOPLE)).toMatchObject({ sellable: false });
    expect(plan.ready).toContain(`price_test_${peopleMonthly().webPriceId}`);
    // Price propio en el doble: Product propio, recurrente mensual, 1900 céntimos, sin IVA
    const price = gw.prices.find((p) => p.lookupKey === peopleMonthly().lookupKey)!;
    expect(price).toMatchObject({ productId: "prod_test_connect-people", unitAmount: 1900, currency: "EUR", interval: "month", intervalCount: 1, taxBehavior: "exclusive", type: "recurring" });
    expect(price.metadata).toEqual({ es_product_key: PEOPLE, es_web_price_id: String(peopleMonthly().webPriceId), es_kind: "monthly" });
    expect((await stripeStore.priceForWebPrice(peopleMonthly().webPriceId))).toMatchObject({ stripePriceId: price.id, status: "active" });
    // Sincronizar otra vez no duplica nada
    const again = await ok(call("POST", "/stripe/catalog/sync"));
    expect(again.linked.find((l: { lookupKey: string }) => l.lookupKey === peopleMonthly().lookupKey)).toMatchObject({ sellable: false });
    expect((await stripeStore.listPrices()).length).toBe(preparedDesired.length);
  });

  it("con el Price enlazado, People no se compra: ni desde el panel ni por Checkout; nada cambia en Stripe", async () => {
    const a = await activeCompany("People Bloqueada SL");
    const catalog = (await ok(call("GET", `/commerce/tenants/${a.tenantId}/catalog`, { token: CORE }))).catalog;
    expect(catalog.items.find((i: { key: string }) => i.key === PEOPLE)).toMatchObject({ commercialStatus: "on_request", purchasable: false });
    const updates = gw.calls.filter((c) => c.op === "subscriptions.update").length;
    const ordersBefore = (await orders.list({ companyId: a.companyId })).length;
    const preview = await call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { add: [PEOPLE] } });
    expect(preview.status).toBe(409);
    expect(preview.json.error).toBe("unavailable");
    const r = await buy(a.tenantId, { add: [PEOPLE] });
    expect(r.json.error).toBe("unavailable");
    expect(gw.calls.filter((c) => c.op === "subscriptions.update").length).toBe(updates);
    expect((await orders.list({ companyId: a.companyId })).length).toBe(ordersBefore);
    expect(gw.subscriptions.get(a.subId)!.priceIds).toEqual([`price_test_${essentialMonthly().webPriceId}`]);
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");

    // Un pedido asistido con People (aprobado por el gestor) tampoco se cobra por Checkout
    const sessions = gw.calls.filter((c) => c.op === "checkout.sessions.create").length;
    const { orderId } = await contractedOrder("People Por Checkout SL", [{ key: PEOPLE }]);
    const s = await call("POST", `/stripe/orders/${orderId}/checkout`);
    expect(s.status).toBeGreaterThanOrEqual(400);
    expect(s.json.message).toMatch(/Elephant People.*no se contrata en línea/);
    expect(gw.calls.filter((c) => c.op === "checkout.sessions.create").length).toBe(sessions);
  });
});

describe("People en «available» (solo en esta prueba): partida adicional de la misma suscripción", () => {
  it("compra con prorrateo, renovación plan + extensión con IVA aparte, webhooks repetidos sin duplicar y baja que solo quita su partida", async () => {
    const a = await activeCompany("People Ciclo SL");
    await openPeopleForSale();
    // Abrir la venta no pide otro Price: el preparado es el mismo (mismo precio aprobado, misma lookup_key)
    const desired = await desiredCatalog(catalogFromWebStore(webStore));
    expect(desired.find((d) => d.productKey === PEOPLE)).toMatchObject({ lookupKey: peopleMonthly().lookupKey, webPriceId: peopleMonthly().webPriceId, sellable: true });
    expect((await planCatalogWrites(desired, gw)).operations).toEqual([]);

    const sub0 = gw.subscriptions.get(a.subId)!;
    const baseItem = { ...sub0.items![0] };
    expect(baseItem).toMatchObject({ priceId: `price_test_${essentialMonthly().webPriceId}`, quantity: 1 });
    // A mitad del periodo pagado: el prorrateo es una parte de los 19 €
    gw.now = sub0.currentPeriodStart! + Math.floor((sub0.currentPeriodEnd! - sub0.currentPeriodStart!) / 2);
    const preview = (await ok(call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { add: [PEOPLE] } }))).preview;
    expect(preview).toMatchObject({ subscriptionId: a.subId, recurringDeltaCents: 1900, interval: "month" });
    expect(preview.subtotalCents).toBeGreaterThan(0);
    expect(preview.subtotalCents).toBeLessThan(1900);
    expect(preview.taxCents).toBe(Math.round((preview.subtotalCents * 2100) / 10_000));

    const idem = key();
    const r = await ok(buy(a.tenantId, { idempotencyKey: idem, add: [PEOPLE] }), 201);
    expect(r.purchase).toMatchObject({ status: "applied", created: true });
    const changeOrder = r.purchase.orderId as number;
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    // Misma suscripción (ni otra en Stripe ni otra interna), partida del plan intacta y una partida nueva
    expect(await stripeStore.subscriptionsOfCompany(a.companyId)).toEqual([a.subId]);
    expect(gw.subscriptions.size).toBe(new Set(Array.from(gw.subscriptions.values()).map((s) => s.customerId)).size);
    const sub1 = gw.subscriptions.get(a.subId)!;
    expect(sub1.items).toHaveLength(2);
    expect(sub1.items!.find((i) => i.id === baseItem.id)).toEqual(baseItem);
    expect(sub1.items!.find((i) => i.id !== baseItem.id)).toMatchObject({ priceId: `price_test_${peopleMonthly().webPriceId}`, quantity: 1 });
    expect(await subsStore.list({ companyId: a.companyId })).toHaveLength(1);
    // La factura del cambio: solo el prorrateo de People, con el IVA aparte
    const change = gw.invoices.get(sub1.latestInvoiceId!)!;
    expect(change).toMatchObject({ billingReason: "subscription_update", status: "paid", subtotal: preview.subtotalCents, taxCents: preview.taxCents, total: preview.subtotalCents + preview.taxCents });
    expect(change.lines!.map((l) => [l.priceId, l.proration])).toEqual([[`price_test_${peopleMonthly().webPriceId}`, true]]);

    // Repeticiones: misma clave y webhooks entregados dos veces → ni otro cobro ni otra licencia
    const invoices = gw.invoices.size;
    expect((await ok(buy(a.tenantId, { idempotencyKey: idem, add: [PEOPLE] }), 200)).purchase).toMatchObject({ orderId: changeOrder, created: false });
    await deliverSince(0);
    await deliverSince(0);
    expect(gw.invoices.size).toBe(invoices);
    expect((await ok(call("GET", `/orders/${changeOrder}`))).payments).toHaveLength(1);
    expect((await caps.list(a.tenantId)).filter((g) => g.capabilityId === "people-hr" && g.status === "active")).toHaveLength(1);
    expect(gw.subscriptions.get(a.subId)!.items).toHaveLength(2);
    expect((await buy(a.tenantId, { add: [PEOPLE] })).status).toBe(400);

    // Renovación: plan (29 €) + People (19 €) = 48 € netos, con el 21 % de IVA aparte
    const renewal = await renew(a, 2900 + 1900);
    expect(gw.invoices.get(renewal)).toMatchObject({ subtotal: 4800, taxCents: 1008, total: 5808, amountPaid: 5808 });
    const lines = await invoiceLines.linesOf(renewal);
    expect(lines.map((l) => [l.productKey, l.amountCents, l.taxCents, l.proration]).sort()).toEqual([
      [PEOPLE, 1900, 399, false],
      ["essential", 2900, 609, false],
    ]);
    const renewals = (await ok(call("GET", `/orders/${changeOrder}`))).payments.filter((p: { purpose: string }) => p.purpose === "renewal");
    expect(renewals).toEqual([expect.objectContaining({ status: "succeeded", amountCents: 5808 })]);
    // Repetir los webhooks de la renovación no registra otro cobro
    await deliverSince(0);
    expect((await ok(call("GET", `/orders/${changeOrder}`))).payments.filter((p: { purpose: string }) => p.purpose === "renewal")).toHaveLength(1);
    expect(await capsOf(a.tenantId)).toContain("people-hr");

    // Baja de People: solo sale su partida; la del plan sigue igual (precio, cantidad y partida)
    const capsBefore = (await capsOf(a.tenantId)).filter((c) => c !== "people-hr").sort();
    const down = await ok(reduce(a.tenantId, { remove: [PEOPLE] }), 201);
    expect(down.reduction).toMatchObject({ status: "applied" });
    expect(gw.subscriptions.get(a.subId)!.items).toEqual([baseItem]);
    expect(await stripeStore.subscriptionsOfCompany(a.companyId)).toEqual([a.subId]);
    await deliverSince(0);
    // Siguiente renovación: solo el plan; People deja de estar y lo demás sigue
    const next = await renew(a, 2900);
    expect((await invoiceLines.linesOf(next)).map((l) => l.productKey)).toEqual(["essential"]);
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    expect((await capsOf(a.tenantId)).sort()).toEqual(capsBefore);
    expect(await orderState(down.reduction.orderId)).toBe("active");
  });
});
