/**
 * Suscripciones modulares (fase 2): plan Elephant Core + módulos + ampliaciones cobrados en UNA suscripción de Stripe,
 * de punta a punta por HTTP con la aplicación REAL del plano de control (orquestador, suscripciones, licencias y
 * procesador de eventos reales; Stripe es un doble y la firma del webhook es la real del SDK):
 *
 *  - plan mensual con módulo y usuarios: una sola Checkout Session con todas las partidas, un pago, todo activo;
 *  - plan anual con módulo anual, módulo mensual y usuarios: el primer mes de lo mensual va en el mismo pago y, al
 *    activarse, las partidas mensuales se añaden sin prorrateo a la misma suscripción; la renovación mensual se
 *    registra sin adelantar el periodo anual; repetir los webhooks no duplica nada;
 *  - altas y bajas posteriores desde el CRM (operador) con prorrateo, con la periodicidad de cada partida;
 *  - salvaguardas: producto sin precio enlazado, suscripción antigua en modo clásico, aislamiento entre empresas.
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
import { TAX_RATE_BP } from "./catalog/elephantSourceV1";
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

const ADMIN = "modular-admin-token-aaaaaaaaaaaaaaaaaaaa";
const CORE = "modular-core-token-bbbbbbbbbbbbbbbbbbbbb";
const WEB = "https://web.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "c".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

let clock = Date.UTC(2026, 9, 27, 9);
let server: http.Server;
let port = 0;
let crm: CrmService;
const caps = new MemoryCapabilityStore();
const crmStore = new MemoryCrmStore();
const webStore = new MemoryWebStore();
const subsStore = new MemorySubscriptionStore();
const orders = new MemoryOrderStore();
const gw = new FakeStripeGateway();
const changes = new MemorySubscriptionChangeStore();
const stripeStore = new MemoryStripeStore();
/** Aprobados para venta libre SOLO en esta prueba. `connect-people` tiene además tarifa anual (190 €). */
const FOR_SALE = ["connect-people", "connect-partners", "connect-deals", "addon-user-essential"];
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };

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
  for (let i = 0; i < 200; i++) {
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
const orderOf = async (id: number) => ok(call("GET", `/orders/${id}`));
const capsOf = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);
const priceOf = async (productKey: string, kind: "monthly" | "yearly") => {
  const d = (await desiredCatalog(catalogFromWebStore(webStore))).find((x) => x.productKey === productKey && x.kind === kind)!;
  return (await stripeStore.priceForWebPrice(d.webPriceId))!.stripePriceId;
};
const lastSessionInput = () => [...gw.calls].reverse().find((c) => c.op === "checkout.sessions.create")!.input as CheckoutSessionInput;

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
  // Tarifa anual aprobada de un módulo (en el catálogo real los módulos solo tienen mensual)
  await web.approvePrice((await web.addPrice("connect-people", { kind: "yearly", amountCents: 19_000, taxRateBp: TAX_RATE_BP, note: "Prueba" }, "operator:test")).id, "operator:test");
  for (const k of FOR_SALE) {
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
  // 4 de los planes + 4 mensuales de los productos en venta + el anual de connect-people
  expect((await syncCatalog(desired, gw, stripeStore, clock)).linked.filter((l) => l.sellable)).toHaveLength(4 + FOR_SALE.length + 1);
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

/** Contratación desde el CRM («Contratar con cobro en Stripe»): pedido con la API existente y aceptación. */
async function contracted(name: string, request: Record<string, unknown>) {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Modular", email: `ana@m${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: `crm-sub-${key()}`, companyId: c.id, request } }), 201);
  await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-${c.id}`, approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
  return { orderId: created.order.id as number, companyId: c.id };
}
/** El cliente paga en Stripe y llegan los webhooks firmados: el pedido queda activo. */
async function pay(orderId: number, sessionId: string) {
  const mark = gw.events.length;
  const subId = gw.completeSession(sessionId);
  await deliverSince(mark);
  await until(async () => (await orders.get(orderId))?.state === "active");
  // Lo que Stripe emite por lo que se hizo al activarse (partidas añadidas) también llega por webhook
  await deliverSince(mark + 1);
  return subId;
}

describe("suscripciones modulares: plan + módulos + ampliaciones en una suscripción de Stripe", { timeout: 30_000 }, () => {
  it("plan mensual con módulo y usuarios: una sesión con todas las partidas, un pago, todo activo; repetir no duplica", async () => {
    const { orderId, companyId } = await contracted("Modular Mensual SL", { plan: "essential", interval: "month", items: [{ key: "connect-people" }], users: 5 });
    const order = (await orderOf(orderId)).order;
    // 29 € + 19 € + 2 usuarios adicionales × 6 € (Essential incluye 3)
    expect(order.quote.contractAmountCents).toBe(2900 + 1900 + 1200);

    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(s).toMatchObject({ reused: false, amountCents: 6000, currency: "EUR" });
    expect(lastSessionInput().lineItems).toEqual([
      { priceId: await priceOf("essential", "monthly"), quantity: 1 },
      { priceId: await priceOf("connect-people", "monthly"), quantity: 1 },
      { priceId: await priceOf("addon-user-essential", "monthly"), quantity: 2 },
    ]);
    // Doble clic: la misma sesión, ningún enlace nuevo
    const again = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(again).toMatchObject({ reused: true, sessionId: s.sessionId });
    expect(gw.calls.filter((c) => c.op === "checkout.sessions.create")).toHaveLength(1);

    const subId = await pay(orderId, s.sessionId);
    const detail = await orderOf(orderId);
    expect(detail.order.state).toBe("active");
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", provider: "stripe_test" })]);
    expect(await capsOf(detail.order.tenantId)).toContain("people-hr");
    expect(gw.subscriptions.get(subId)!.items).toHaveLength(3);
    // Una sola suscripción interna, cobrada en Stripe y con todas las partidas contratadas
    const subs = await ok(call("GET", `/subscriptions?companyId=${companyId}`));
    const internal = subs.subscriptions.find((x: { companyId: number }) => x.companyId === companyId);
    expect(internal.billing).toMatchObject({ source: "stripe", orderId });
    const items = (await subsStore.items(internal.id)).filter((i) => i.effectiveTo === null).map((i) => `${i.productKey}×${i.quantity}`).sort();
    expect(items).toEqual(["addon-user-essential×2", "connect-people×1", "essential×1"]);
    // Webhooks repetidos: nada cambia ni se cobra dos veces
    await deliverSince(0);
    expect((await orderOf(orderId)).payments).toHaveLength(1);
    expect(await changes.byOrder(orderId)).toBeNull();
    // Una segunda contratación de la misma empresa se rechaza
    expect((await call("POST", "/orders", { body: { idempotencyKey: `crm-sub-${key()}`, companyId, request: { plan: "business", interval: "month", items: [] } } })).status).toBe(409);
  });

  let annual: { orderId: number; companyId: number; tenantId: string; subId: string; internalId: number };

  it("plan anual con módulo anual, módulo mensual y usuarios: primer mes en el mismo pago; lo mensual se añade al activarse sin prorrateo", async () => {
    const { orderId, companyId } = await contracted("Modular Anual SL", { plan: "essential", interval: "year", items: [{ key: "connect-people" }, { key: "connect-partners" }], users: 5 });
    const order = (await orderOf(orderId)).order;
    // Anual: 279 € + 190 €; mensual: 19 € + 2 × 6 €. Contrato = anual + 12 × mensual
    expect(order.quote.contractAmountCents).toBe(27_900 + 19_000 + 12 * (1900 + 1200));

    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    // Primer cobro: lo anual + el primer mes de lo mensual, en un único pago
    expect(s.amountCents).toBe(27_900 + 19_000 + 1900 + 1200);
    expect(lastSessionInput().lineItems).toEqual([
      { priceId: await priceOf("essential", "yearly"), quantity: 1 },
      { priceId: await priceOf("connect-people", "yearly"), quantity: 1 },
      { oneTime: { productId: "prod_test_connect-partners", unitAmount: 1900, currency: "EUR" }, quantity: 1 },
      { oneTime: { productId: "prod_test_addon-user-essential", unitAmount: 600, currency: "EUR" }, quantity: 2 },
    ]);
    const invoicesBefore = gw.invoices.size;
    const subId = await pay(orderId, s.sessionId);
    const detail = await orderOf(orderId);
    expect(detail.order.state).toBe("active");
    expect(await capsOf(detail.order.tenantId)).toEqual(expect.arrayContaining(["people-hr", "supplier-settlements"]));

    // Las partidas mensuales ya están en LA MISMA suscripción de Stripe, sin factura de prorrateo
    const sub = gw.subscriptions.get(subId)!;
    expect(sub.billingMode).toBe("flexible");
    expect(sub.items!.map((i) => `${i.priceId}×${i.quantity}`).sort()).toEqual(
      [`${await priceOf("essential", "yearly")}×1`, `${await priceOf("connect-people", "yearly")}×1`, `${await priceOf("connect-partners", "monthly")}×1`, `${await priceOf("addon-user-essential", "monthly")}×2`].sort(),
    );
    expect(gw.invoices.size).toBe(invoicesBefore + 1);
    const attach = gw.calls.filter((c) => c.op === "subscriptions.update");
    expect(attach).toHaveLength(1);
    expect(attach[0].input).toMatchObject({ prorationBehavior: "none" });
    expect(await changes.byOrder(orderId)).toMatchObject({ status: "applied", createdBy: "system:checkout" });
    expect(detail.payments).toHaveLength(1);

    // Webhooks repetidos (incluido el de las partidas añadidas): nada se añade ni se cobra otra vez
    await deliverSince(0);
    expect(gw.calls.filter((c) => c.op === "subscriptions.update")).toHaveLength(1);
    expect((await orderOf(orderId)).payments).toHaveLength(1);

    // Renovación mensual (Stripe cobra solo lo mensual): se registra y no adelanta el periodo anual interno
    const internal = (await subsStore.list({ companyId }))[0];
    const periodEnd = internal.currentPeriodEnd;
    expect(periodEnd - internal.currentPeriodStart).toBeGreaterThan(360 * 86_400_000);
    clock += 31 * 86_400_000;
    gw.now = Math.floor(clock / 1000);
    const monthly = sub.items!.filter((i) => gw.prices.find((x) => x.id === i.priceId)?.interval === "month");
    expect(monthly).toHaveLength(2);
    const mark = gw.events.length;
    const renewal = gw.addInvoice(subId, sub.customerId, "subscription_cycle", "paid", 3100, monthly.map((i) => ({ id: `il_${i.id}`, subscriptionItemId: i.id, priceId: i.priceId, quantity: i.quantity, amount: (gw.prices.find((p) => p.id === i.priceId)!.unitAmount ?? 0) * i.quantity, taxCents: null, proration: false, periodStart: gw.now, periodEnd: gw.now! + 30 * 86_400 })));
    // Como Stripe al renovar lo mensual: el periodo de la suscripción pasa al mes nuevo (el anual sigue su curso)
    gw.updateSubscription(subId, { currentPeriodStart: gw.now, currentPeriodEnd: gw.now + 30 * 86_400 });
    gw.emit("invoice.paid", "invoice", renewal);
    await deliverSince(mark);
    const after = await orderOf(orderId);
    expect(after.order.state).toBe("active");
    expect(after.payments).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "renewal", amountCents: expect.any(Number), status: "succeeded" })]));
    expect(after.payments).toHaveLength(2);
    expect((await subsStore.get(internal.id))!.currentPeriodEnd).toBe(periodEnd);
    annual = { orderId, companyId, tenantId: detail.order.tenantId, subId, internalId: internal.id };
  });

  it("altas y bajas posteriores desde el CRM con prorrateo, cada partida con su periodicidad", async () => {
    const { companyId, tenantId, subId } = annual;
    gw.now = Math.floor(clock / 1000);
    // Vista previa: módulo mensual en un plan anual, prorrateo calculado por Stripe
    const p = (await ok(call("POST", `/commerce/companies/${companyId}/purchases/preview`, { body: { add: ["connect-deals"] } }))).preview;
    expect(p.lines).toEqual([expect.objectContaining({ productKey: "connect-deals", kind: "module", interval: "month", unitAmountCents: 1900 })]);
    expect(p.recurringDelta).toEqual({ monthlyCents: 1900, yearlyCents: 0 });
    expect(p.amountDueCents).toBeGreaterThan(0);
    expect(p.amountDueCents).toBeLessThanOrEqual(1900);
    // Un importe enviado por el navegador se rechaza
    expect((await call("POST", `/commerce/companies/${companyId}/purchases/preview`, { body: { add: ["connect-deals"], amountCents: 1 } })).status).toBe(400);
    // El token de la plataforma (Core) no usa la vía de operadores
    expect((await call("POST", `/commerce/companies/${companyId}/purchases/preview`, { token: CORE, body: { add: ["connect-deals"] } })).status).toBe(403);

    const idem = key();
    const mark = gw.events.length;
    const r = await ok(call("POST", `/commerce/companies/${companyId}/purchases`, { body: { idempotencyKey: idem, add: ["connect-deals"] } }), 201);
    expect(r.purchase).toMatchObject({ status: "applied", created: true });
    expect(await capsOf(tenantId)).toContain("deals-coupons");
    expect(gw.subscriptions.get(subId)!.priceIds).toContain(await priceOf("connect-deals", "monthly"));
    // Repetir con la misma clave: el mismo pedido, ningún cobro nuevo
    const invoices = gw.invoices.size;
    const again = await ok(call("POST", `/commerce/companies/${companyId}/purchases`, { body: { idempotencyKey: idem, add: ["connect-deals"] } }), 200);
    expect(again.purchase).toMatchObject({ orderId: r.purchase.orderId, created: false });
    expect(gw.invoices.size).toBe(invoices);
    await deliverSince(mark);

    // Baja de un módulo mensual: Stripe deja de cobrarlo ya (sin abonos) y el derecho dura hasta el fin de SU mes
    const red = (await ok(call("POST", `/commerce/companies/${companyId}/reductions/preview`, { body: { remove: ["connect-partners"] } }))).preview;
    expect(red.lines).toEqual([expect.objectContaining({ productKey: "connect-partners", interval: "month", fromQuantity: 1, toQuantity: 0 })]);
    const done = await ok(call("POST", `/commerce/companies/${companyId}/reductions`, { body: { idempotencyKey: key(), remove: ["connect-partners"] } }), 201);
    expect(done.reduction.status).toBe("applied");
    expect(gw.subscriptions.get(subId)!.priceIds).not.toContain(await priceOf("connect-partners", "monthly"));
    const sub = (await subsStore.list({ companyId }))[0];
    const partners = (await subsStore.items(sub.id)).find((i) => i.productKey === "connect-partners" && i.effectiveTo !== null)!;
    expect(partners.effectiveTo! - clock).toBeLessThanOrEqual(31 * 86_400_000);
    expect(sub.currentPeriodEnd - partners.effectiveTo!).toBeGreaterThan(300 * 86_400_000);
  });

  it("salvaguardas: producto sin precio enlazado, suscripción en modo clásico y aislamiento entre empresas", async () => {
    // Un módulo «bajo solicitud» no se cobra en línea aunque tenga su Price preparado y enlazado: no hay enlace de pago
    const pos = await contracted("Modular Bajo Solicitud SL", { plan: "essential", interval: "month", items: [{ key: "connect-pos" }] });
    const blocked = await call("POST", `/stripe/orders/${pos.orderId}/checkout`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.message).toMatch(/«Elephant POS[^»]*» todavía no se contrata en línea/);
    // Una suscripción anual antigua en modo clásico no admite partidas mensuales: se explica y no se toca Stripe
    const { orderId } = await contracted("Modular Clásica SL", { plan: "essential", interval: "year", items: [] });
    const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
    expect(lastSessionInput().lineItems).toBeUndefined();
    const subId = await pay(orderId, s.sessionId);
    gw.updateSubscription(subId, { billingMode: "classic" });
    const companyId = (await orderOf(orderId)).order.companyId as number;
    const updates = gw.calls.filter((c) => c.op === "subscriptions.update").length;
    const r = await call("POST", `/commerce/companies/${companyId}/purchases`, { body: { idempotencyKey: key(), add: ["connect-deals"] } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/no admite periodicidades distintas/);
    expect(gw.calls.filter((c) => c.op === "subscriptions.update")).toHaveLength(updates);
    // Aislamiento: una empresa sin plataforma no se amplía; una inexistente no existe
    const bare = await crm.createCompany({ name: "Sin Plataforma SL" }, "operator:test");
    expect((await call("POST", `/commerce/companies/${bare.id}/purchases/preview`, { body: { add: ["connect-deals"] } })).status).toBe(409);
    expect((await call("POST", `/commerce/companies/999999/purchases/preview`, { body: { add: ["connect-deals"] } })).status).toBe(404);
    // Los cambios de cada suscripción son siempre de su empresa
    expect((await changes.ofSubscription(subId)).every((c) => c.companyId === companyId)).toBe(true);
    expect((await changes.ofSubscription(annual.subId)).every((c) => c.companyId === annual.companyId)).toBe(true);
  });
});
