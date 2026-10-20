/**
 * Compra de módulos y ampliaciones desde la plataforma, de punta a punta por HTTP con la aplicación REAL del
 * plano de control (orquestador, suscripciones, licencias y procesador de eventos reales; Stripe es un doble
 * con cobro condicionado y la firma del webhook es la real del SDK):
 *
 *  - compra con cobro correcto: derechos solo tras el cobro verificado; repetirla no cobra dos veces;
 *  - ampliación de usuarios con prorrateo;
 *  - cobro fallido o con autenticación: nada concedido; caducidad → pedido rechazado; pago tardío → aplicado;
 *  - compras simultáneas, método asíncrono (SEPA), producto no aprobado, reducción y aislamiento entre empresas;
 *  - interruptor apagado: 503 sin tocar nada;
 *  - bajas y reducciones a fin de periodo (PR 6): sin abonos, derechos hasta la renovación, nunca bajo el uso real;
 *  - facturación por líneas (fase E): líneas de cada factura cobrada, reembolso parcial repartido y descuadres avisados.
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
import { issuePreviewToken } from "./web/publicSite";
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
import { MemorySubscriptionChangeStore } from "./stripe/changes";
import { ModulePurchaseService } from "./stripe/purchases";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MemoryInvoiceLineStore } from "./stripe/invoiceLines";
import { setLogSink } from "./_core/ops/log";

const ADMIN = "purchase-admin-token-aaaaaaaaaaaaaaaaaaa";
/** Token de servicio del Core: SOLO compra (el tenant lo pone el Core desde su sesión). */
const CORE = "purchase-core-token-bbbbbbbbbbbbbbbbbbbbb";
const WEB = "https://web.example";
const INTAKE_SECRET = "s".repeat(48);
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "b".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
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
const changes = new MemorySubscriptionChangeStore();
const limits = new MemoryTenantLimitStore();
const invoiceLines = new MemoryInvoiceLineStore();
const FOR_SALE = ["connect-people", "addon-user-essential"];
/** Producto interno de pruebas (solo en esta prueba): `connect-tax`, que además forma parte del paquete `connect-pack-finance`. */
const INTERNAL = "connect-tax";
const internalTenants = new Set<string>();
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
  const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
  await seedElephantSource(web, webStore);
  // Aprobados para venta libre SOLO en esta prueba (en el catálogo real nada está «available»)
  for (const key of [...FOR_SALE, INTERNAL]) {
    const { entry: e } = await web.get("product", key);
    const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
    draft.technicalStatus = "available";
    // El producto interno de pruebas: disponible para comprar, pero nunca público
    draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available", ...(key === INTERNAL ? { internalOnly: true } : {}) };
    const saved = await web.save("product", key, { draft, expectedVersion: e.draftVersion }, "operator:test");
    await web.publish("product", key, saved.draftVersion, "operator:test");
  }
  // Sin productos internos, el catálogo de Stripe deseado no los incluye (lo que se pediría en live)
  expect((await desiredCatalog(catalogFromWebStore(webStore))).some((d) => d.productKey === INTERNAL)).toBe(false);
  // Catálogo de Stripe creado según el plan de escrituras (lo que hará una persona en el sandbox) y enlazado
  const desired = await desiredCatalog(catalogFromWebStore(webStore), { includeInternal: true });
  for (const op of (await planCatalogWrites(desired, gw)).operations) {
    if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
    else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
  }
  expect((await syncCatalog(desired, gw, stripeStore, clock)).linked).toHaveLength(4 + FOR_SALE.length + 1);
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
    limits,
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
      purchases: { enabled: true, changes, internalTenants },
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
async function contractedOrder(name: string, plan = "essential", interval = "month") {
  const c = await crm.createCompany({ name }, "operator:test");
  await crm.createContact(c.id, { name: "Ana Beta", email: `ana@c${c.id}.example` }, "operator:test");
  const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan, interval, items: [] } } }), 201);
  await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-beta-${c.id}`, approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
  return { orderId: created.order.id as number, companyId: c.id };
}

/** Empresa con Essential mensual pagado por Checkout y activo. */
async function activeCompany(name: string) {
  const { orderId, companyId } = await contractedOrder(name);
  const s = await ok(call("POST", `/stripe/orders/${orderId}/checkout`));
  gw.completeSession(s.sessionId);
  await ok(stripeWebhook(gw.events[0]));
  await until(async () => (await orderState(orderId)) === "active");
  const tenantId = (await ok(call("GET", `/orders/${orderId}`))).order.tenantId as string;
  const subId = gw.sessions.get(s.sessionId)!.subscriptionId!;
  return { orderId, companyId, tenantId, subId, customerId: gw.subscriptions.get(subId)!.customerId };
}
const buy = (tenantId: string, body: Record<string, unknown>, token: string | null = CORE) => call("POST", `/commerce/tenants/${tenantId}/purchases`, { token, body: { idempotencyKey: key(), buyer: "user:7", ...body } });
/** Entrega por webhook (firma real) los eventos que el doble emitió desde `mark`, en orden. */
async function deliverSince(mark: number) {
  for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(stripeWebhook(ev));
}
const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
const capsOf = async (tenantId: string) => (await caps.list(tenantId)).filter((g) => g.status === "active").map((g) => g.capabilityId);

describe("compra de módulos y ampliaciones desde la plataforma", () => {
  it("compra con cobro correcto: derechos solo con el cobro verificado; la repetición no cobra dos veces", async () => {
    const a = await activeCompany("Compra Módulo SL");
    gw.now = Math.floor(clock / 1000);
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    // Vista previa: el servidor calcula partidas e importe (el navegador no envía precios)
    const p = (await ok(call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { add: ["connect-people"] } }))).preview;
    expect(p).toMatchObject({ orderId: a.orderId, subscriptionId: a.subId, currency: "EUR", interval: "month", recurringDeltaCents: 1900 });
    expect(p.lines).toEqual([expect.objectContaining({ productKey: "connect-people", kind: "module", fromQuantity: 0, toQuantity: 1 })]);
    expect(p.amountDueCents).toBeGreaterThan(0);
    expect(p.amountDueCents).toBeLessThanOrEqual(1900);
    expect(gw.subscriptions.get(a.subId)!.priceIds).toHaveLength(1);
    // Un campo de precio o importe enviado por el navegador se rechaza
    expect((await call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { add: ["connect-people"], amountCents: 1 } })).status).toBe(400);

    const idem = key();
    const invoicesBefore = gw.invoices.size;
    const r = await ok(buy(a.tenantId, { idempotencyKey: idem, add: ["connect-people"] }), 201);
    expect(r.purchase).toMatchObject({ status: "applied", created: true });
    const changeOrder = r.purchase.orderId as number;
    expect(await orderState(changeOrder)).toBe("active");
    expect(await orderState(a.orderId)).toBe("superseded");
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    const detail = await ok(call("GET", `/orders/${changeOrder}`));
    expect(detail.order).toMatchObject({ kind: "change", tenantId: a.tenantId, confirmation: expect.objectContaining({ kind: "payment" }) });
    expect(detail.payments).toEqual([expect.objectContaining({ purpose: "change", status: "succeeded", provider: "stripe_test" })]);
    expect(gw.subscriptions.get(a.subId)!.priceIds).toHaveLength(2);
    expect(gw.invoices.size).toBe(invoicesBefore + 1);
    // Repetición (doble clic, reintento de red): mismo pedido, ningún cobro nuevo
    const again = await ok(buy(a.tenantId, { idempotencyKey: idem, add: ["connect-people"] }), 200);
    expect(again.purchase).toMatchObject({ status: "applied", orderId: changeOrder, created: false });
    expect(gw.invoices.size).toBe(invoicesBefore + 1);
    // Los webhooks de Stripe llegan después (y repetidos): no cambian nada
    await deliverSince(0);
    await settled();
    expect(await orderState(changeOrder)).toBe("active");
    expect((await ok(call("GET", `/orders/${changeOrder}`))).payments).toHaveLength(1);
    // Ya contratado: no se vuelve a vender
    expect((await buy(a.tenantId, { add: ["connect-people"] })).status).toBe(400);
  });

  it("ampliación de usuarios: partida por cantidad con prorrateo; reducir no va por aquí", async () => {
    const a = await activeCompany("Compra Usuarios SL");
    const r = await ok(buy(a.tenantId, { users: 5 }), 201);
    expect(r.purchase.status).toBe("applied");
    const items = gw.subscriptions.get(a.subId)!.items!;
    expect(items.map((i) => i.quantity).sort()).toEqual([1, 2]);
    const sub = (await subsStore.list({ companyId: a.companyId }))[0];
    const lines = (await subsStore.items(sub.id)).filter((i) => i.effectiveTo === null);
    expect(lines.find((i) => i.productKey === "addon-user-essential")).toMatchObject({ quantity: 2 });
    // Más usuarios otra vez: solo la diferencia
    const p = (await ok(call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { users: 6 } }))).preview;
    expect(p.lines).toEqual([expect.objectContaining({ productKey: "addon-user-essential", kind: "quantity", fromQuantity: 2, toQuantity: 3 })]);
    expect(p.recurringDeltaCents).toBe(600);
    // Menos usuarios que los contratados: a la reducción a fin de periodo
    const down = await buy(a.tenantId, { users: 4 });
    expect(down.status).toBe(400);
    expect(down.json.message).toMatch(/reducción a fin de periodo/);
  });

  it("cobro fallido: nada concedido; al caducar en Stripe el pedido se rechaza; un pago con autenticación se aplica al pagarse", async () => {
    const a = await activeCompany("Compra Fallida SL");
    gw.paymentOutcome.set(a.customerId, "fail");
    const mark = gw.events.length;
    const r = await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    expect(r.purchase).toMatchObject({ status: "payment_pending", paymentUrl: expect.stringMatching(/^https:\/\//) });
    const order = r.purchase.orderId as number;
    expect(await orderState(order)).toBe("contracted");
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    // Otra compra mientras hay una pendiente: conflicto, sin otro cobro
    expect((await buy(a.tenantId, { users: 4 })).status).toBe(409);
    // Webhooks del fallo: nada cambia
    await deliverSince(mark);
    await settled();
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    // Pasan 23 h: Stripe descarta el cambio y anula la factura → pedido rechazado, compra caducada
    const mark2 = gw.events.length;
    gw.expirePendingUpdate(a.subId);
    await deliverSince(mark2);
    await until(async () => (await orderState(order)) === "rejected");
    expect((await ok(call("GET", `/commerce/tenants/${a.tenantId}/purchases/${order}`, { token: CORE }))).purchase.status).toBe("expired");
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    expect(await orderState(a.orderId)).toBe("active");

    // Con autenticación (3DS): pendiente hasta que el cliente paga en la página de Stripe
    gw.paymentOutcome.set(a.customerId, "requires_action");
    const r2 = await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    expect(r2.purchase.status).toBe("payment_pending");
    const mark3 = gw.events.length;
    gw.payInvoice(gw.subscriptions.get(a.subId)!.latestInvoiceId!);
    await deliverSince(mark3);
    await until(async () => (await orderState(r2.purchase.orderId)) === "active");
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    expect((await ok(call("GET", `/commerce/tenants/${a.tenantId}/purchases/${r2.purchase.orderId}`, { token: CORE }))).purchase.status).toBe("applied");
  });

  it("SEPA, producto no aprobado, permisos y aislamiento entre empresas", async () => {
    const a = await activeCompany("Compra Aislada A SL");
    const b = await activeCompany("Compra Aislada B SL");
    // Adeudo SEPA: no se compra en línea (cobro asíncrono): nada creado
    gw.pmTypeOf.set(a.customerId, "sepa_debit");
    const ordersBefore = (await orders.list({ companyId: a.companyId })).length;
    const sepa = await buy(a.tenantId, { add: ["connect-people"] });
    expect(sepa.status).toBe(409);
    expect(sepa.json.error).toBe("async_payment_method");
    expect((await orders.list({ companyId: a.companyId })).length).toBe(ordersBefore);
    gw.pmTypeOf.delete(a.customerId);
    // Bajo solicitud o próximamente: no se vende en línea
    for (const k of ["connect-tax", "hotel-net-pms"]) expect((await buy(a.tenantId, { add: [k] })).json.error).toBe("unavailable");
    // Solo el token del Core compra; el de operador (sin commerce:purchase) no
    expect((await buy(a.tenantId, { add: ["connect-people"] }, ADMIN)).status).toBe(403);
    expect((await buy(a.tenantId, { add: ["connect-people"] }, null)).status).toBe(401);
    // Empresa inexistente o con forma no válida
    expect((await buy("no-existe", { add: ["connect-people"] })).status).toBe(404);
    expect((await buy("Mala_Forma", { add: ["connect-people"] })).status).toBe(400);
    // La compra de A no existe para B
    const r = await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    expect((await call("GET", `/commerce/tenants/${b.tenantId}/purchases/${r.purchase.orderId}`, { token: CORE })).status).toBe(404);
    expect(await capsOf(b.tenantId)).not.toContain("people-hr");
    // La misma clave usada por B no devuelve la compra de A
    const idem = key();
    const ra = await ok(buy(a.tenantId, { idempotencyKey: idem, users: 4 }), 201);
    const rb = await ok(buy(b.tenantId, { idempotencyKey: idem, users: 4 }), 201);
    expect(rb.purchase.orderId).not.toBe(ra.purchase.orderId);
  });

  it("interruptor apagado: 503 sin tocar nada", async () => {
    const off = new ModulePurchaseService({
      enabled: false,
      mode: "test",
      namespace: "local",
      billingMode: "classic",
      orchestrator: {} as never,
      orders: {} as never,
      crmStore: {} as never,
      catalog: {} as never,
      quote: async () => ({}) as never,
      gateway: gw,
      stripeStore,
      changes,
    });
    const calls = gw.calls.length;
    await expect(off.preview("cualquiera", { add: ["connect-people"] })).rejects.toMatchObject({ code: "disabled" });
    await expect(off.purchase("cualquiera", { add: ["connect-people"] }, { idempotencyKey: key(), actor: "x" })).rejects.toMatchObject({ code: "disabled" });
    expect(gw.calls.length).toBe(calls);
  });
});

const reduce = (tenantId: string, body: Record<string, unknown>, token: string | null = CORE) => call("POST", `/commerce/tenants/${tenantId}/reductions`, { token, body: { idempotencyKey: key(), buyer: "user:7", ...body } });
/** Stripe renueva la suscripción (nuevo periodo cobrado) y avisa por webhook; el reloj pasa el fin de periodo. */
async function renew(a: { subId: string; customerId: string }) {
  const s = gw.subscriptions.get(a.subId)!;
  const end = s.currentPeriodEnd!;
  clock = Math.max(clock, end * 1000) + 5 * 86_400_000;
  gw.updateSubscription(a.subId, { currentPeriodStart: end, currentPeriodEnd: end + 30 * 86_400 });
  const mark = gw.events.length;
  const inv = gw.addInvoice(a.subId, a.customerId, "subscription_cycle", "paid", 2900);
  gw.emit("invoice.paid", "invoice", inv);
  await deliverSince(mark);
  await settled();
}

describe("bajas y reducciones a fin de periodo (PR 6)", () => {
  it("baja de un módulo: sin abono, sigue activo hasta la renovación y Stripe deja de cobrarlo; no se recompra antes", async () => {
    const a = await activeCompany("Baja Módulo SL");
    await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    expect(gw.subscriptions.get(a.subId)!.priceIds).toHaveLength(2);
    const invoices = gw.invoices.size;
    const p = (await ok(call("POST", `/commerce/tenants/${a.tenantId}/reductions/preview`, { token: CORE, body: { remove: ["connect-people"] } }))).preview;
    expect(p.lines).toEqual([expect.objectContaining({ productKey: "connect-people", kind: "module", fromQuantity: 1, toQuantity: 0 })]);
    expect(p.recurringDeltaCents).toBe(-1900);
    const r = await ok(reduce(a.tenantId, { remove: ["connect-people"] }), 201);
    expect(r.reduction).toMatchObject({ status: "applied", created: true });
    expect(await orderState(r.reduction.orderId)).toBe("active");
    // Stripe: partida fuera YA, sin prorrateo (ni factura ni abono)
    expect(gw.subscriptions.get(a.subId)!.priceIds).toHaveLength(1);
    expect(gw.invoices.size).toBe(invoices);
    // Derechos hasta el fin del periodo pagado; volver a comprarlo antes no se admite (se pagaría dos veces)
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    const again = await buy(a.tenantId, { add: ["connect-people"] });
    expect(again.status).toBe(409);
    expect(again.json.message).toMatch(/baja programada/);
    // Los webhooks del cambio no alteran nada
    await deliverSince(0);
    await settled();
    expect(await orderState(r.reduction.orderId)).toBe("active");
    // Renovación: el módulo deja de estar contratado; nada se borra
    await renew(a);
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
    expect(await orderState(r.reduction.orderId)).toBe("active");
  });

  it("reducción de usuarios: nunca por debajo del uso real; aumentos, el plan o lo no contratado no van por aquí", async () => {
    const a = await activeCompany("Reducción Usuarios SL");
    await ok(buy(a.tenantId, { users: 6 }), 201);
    expect(gw.subscriptions.get(a.subId)!.items!.map((i) => i.quantity).sort()).toEqual([1, 3]);
    await limits.reportUsage(a.tenantId, "users", 5, clock);
    const ordersBefore = (await orders.list({ companyId: a.companyId })).length;
    const below = await reduce(a.tenantId, { users: 4 });
    expect(below.status).toBe(409);
    expect(below.json.message).toMatch(/uso real/);
    expect((await orders.list({ companyId: a.companyId })).length).toBe(ordersBefore);
    expect(gw.subscriptions.get(a.subId)!.items!.map((i) => i.quantity).sort()).toEqual([1, 3]);
    // Hasta el uso real sí: Stripe cobra menos desde la renovación; el límite actual se mantiene hasta entonces
    const r = await ok(reduce(a.tenantId, { users: 5 }), 201);
    expect(r.reduction.status).toBe("applied");
    expect(gw.subscriptions.get(a.subId)!.items!.map((i) => i.quantity).sort()).toEqual([1, 2]);
    expect((await limits.limits(a.tenantId)).find((l) => l.metric === "users")?.limit).toBe(6);
    expect((await reduce(a.tenantId, { users: 9 })).status).toBe(400);
    expect((await reduce(a.tenantId, { remove: ["essential"] })).status).toBe(400);
    expect((await reduce(a.tenantId, { remove: ["connect-people"] })).status).toBe(400);
    expect((await reduce(a.tenantId, {})).status).toBe(400);
    // En la renovación el límite baja a lo contratado (3 incluidos + 2); ningún usuario se desactiva
    await renew(a);
    expect((await limits.limits(a.tenantId)).find((l) => l.metric === "users")?.limit).toBe(5);
  });
});

describe("facturación por líneas, reembolsos y conciliación (fase E)", () => {
  it("la factura de una compra queda con sus líneas; un reembolso parcial se reparte; repetido no se duplica", async () => {
    const a = await activeCompany("Líneas Factura SL");
    const r = await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    const invId = (await ok(call("GET", `/orders/${r.purchase.orderId}`))).payments[0].providerRef as string;
    const lines = await invoiceLines.linesOf(invId);
    expect(lines).toEqual([expect.objectContaining({ orderId: r.purchase.orderId, productKey: "connect-people", quantity: 1, proration: true, refundedCents: 0 })]);
    expect(lines[0].amountCents).toBeGreaterThan(0);
    const ch = gw.chargeForInvoice(invId);
    gw.refund(ch, 300);
    const ev = gw.emit("charge.refunded", "charge", ch);
    await ok(stripeWebhook(ev));
    await settled();
    expect((await invoiceLines.linesOf(invId))[0].refundedCents).toBe(300);
    // El mismo evento otra vez: nada cambia
    await ok(stripeWebhook(ev));
    await settled();
    expect((await invoiceLines.linesOf(invId))[0].refundedCents).toBe(300);
    const docs = (await stripeStore.listFiscalDocuments({ orderId: r.purchase.orderId, limit: 10 })).map((d) => [d.kind, d.totalCents]);
    expect(docs).toEqual(expect.arrayContaining([["rectification", -300]]));
  });

  it("partidas de Stripe distintas de lo contratado: se avisa y no se corrige nada", async () => {
    const a = await activeCompany("Descuadre SL");
    const logged: string[] = [];
    setLogSink((_level, line) => void logged.push(line));
    try {
      const sub = gw.subscriptions.get(a.subId)!;
      gw.updateSubscription(a.subId, { items: sub.items!.map((i) => ({ ...i, quantity: 2 })) });
      await ok(stripeWebhook(gw.emit("customer.subscription.updated", "subscription", a.subId)));
      await settled();
    } finally {
      setLogSink(null);
    }
    expect(logged.some((l) => l.includes("items_drift"))).toBe(true);
    expect(gw.subscriptions.get(a.subId)!.items![0].quantity).toBe(2);
    expect(await orderState(a.orderId)).toBe("active");
  });
});

describe("productos internos de pruebas: nunca públicos, solo para empresas de prueba autorizadas", () => {
  const keysOf = (site: { catalog: { products: Array<{ key: string }> } }) => site.catalog.products.map((p) => p.key);

  it("la web pública, la vista previa y el cotizador público no los ven (ni el paquete que los incluye); el equipo sí", async () => {
    const pub = await ok(call("GET", "/public/site", { token: null }));
    expect(keysOf(pub)).not.toContain(INTERNAL);
    expect(keysOf(pub)).not.toContain("connect-pack-finance");
    expect(keysOf(pub)).toEqual(expect.arrayContaining(["essential", "connect-people"]));
    expect(JSON.stringify(pub)).not.toContain(INTERNAL);
    const { token } = issuePreviewToken(INTAKE_SECRET, Date.now());
    const prev = await ok(call("GET", `/public/site/preview?token=${token}`, { token: null }));
    expect(JSON.stringify(prev)).not.toContain(INTERNAL);
    const q = await ok(call("POST", "/public/site/quote", { token: null, body: { plan: "essential", interval: "month", items: [{ key: INTERNAL }] } }));
    expect(q.ok).toBe(false);
    expect(JSON.stringify(q.lines ?? [])).not.toContain(INTERNAL);
    // El equipo (con token) ve el catálogo completo, marcado como interno
    const team = await ok(call("GET", "/web/site"));
    const p = team.catalog.products.find((x: { key: string }) => x.key === INTERNAL);
    expect(p?.catalog?.internalOnly).toBe(true);
    // El ETag público no cambia por publicar productos internos: es el de la vista sin ellos
    expect(pub.version).not.toBe(team.version);
  });

  it("solo una empresa de prueba autorizada compra un producto interno; las demás no", async () => {
    const a = await activeCompany("Interno No Autorizado SL");
    const denied = await buy(a.tenantId, { add: [INTERNAL] });
    expect(denied.status).toBe(409);
    expect(denied.json.error).toBe("unavailable");
    expect((await call("POST", `/commerce/tenants/${a.tenantId}/purchases/preview`, { token: CORE, body: { add: [INTERNAL] } })).status).toBe(409);
    const b = await activeCompany("Empresa Ficticia QA SL");
    internalTenants.add(b.tenantId);
    try {
      const r = await ok(buy(b.tenantId, { add: [INTERNAL] }), 201);
      expect(r.purchase.status).toBe("applied");
      expect(await orderState(r.purchase.orderId)).toBe("active");
    } finally {
      internalTenants.delete(b.tenantId);
    }
  });
});
