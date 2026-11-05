/**
 * Social Token Net (STN-5): transición de módulos sueltos a Social Token Net Complete en la compra en línea, de punta a
 * punta por HTTP con la aplicación REAL del plano de control (orquestador, suscripciones, licencias y procesador de
 * eventos reales; Stripe es un doble con cobro condicionado y prorrateo; la firma del webhook es la real del SDK). Sin
 * llamadas reales a Stripe.
 *
 *  - Comunidades → Complete: UNA sola actualización de Stripe (la partida cambia de precio), prorrateo (se paga la
 *    diferencia), pedido activo, suscripción interna con Complete desde ya y licencias sin hueco; idempotente.
 *  - Comunidades + Tokens → Complete: más barato (abono), confirmación heredada, partida sobrante a 0 que la siguiente
 *    reducción retira sin cobro.
 *  - Cobro fallido o caducado: nada cambia. Paquete y componente a la vez: rechazado. Otra empresa: intacta. Datos:
 *    ninguna base borrada.
 *
 * Los tres productos se ponen a la venta SOLO en esta prueba: en el catálogo real siguen «Próximamente».
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
import { StripeGatewayError } from "./stripe/gateway";
import { MemorySubscriptionChangeStore, SubscriptionChangeError } from "./stripe/changes";
import { ModulePurchaseService, substitutionItems } from "./stripe/purchases";
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
const COM = "social-token-net-communities";
const TOK = "social-token-net-tokens";
const CPL = "social-token-net-complete";
/** Los tres productos de Social Token Net (y la ampliación de usuarios), a la venta SOLO en esta prueba (en el catálogo real siguen «Próximamente»). */
const FOR_SALE = [COM, TOK, CPL, "addon-user-essential"];
/** Producto interno de pruebas (solo en esta prueba): `connect-tax`, que además forma parte del paquete `connect-pack-finance`. */
const INTERNAL = "connect-tax";
const internalTenants = new Set<string>();
/** Bases de datos de empresa borradas (ninguna: un cambio de plan nunca toca los datos). */
const dropped: string[] = [];
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
    databases: { ensureDatabase: async (id) => ({ dsn: `mysql://u_${id}:x@db.invalid:3306/es_${id}`, serverAlias: "test" }), dropDatabase: async (id: string) => void dropped.push(id) },
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


const preview = (tenantId: string, body: Record<string, unknown>) => call("POST", `/commerce/tenants/${tenantId}/purchases/preview`, { token: CORE, body });
const reduce = (tenantId: string, body: Record<string, unknown>) => call("POST", `/commerce/tenants/${tenantId}/reductions`, { token: CORE, body: { idempotencyKey: key(), buyer: "user:7", ...body } });
const STN_CAPS = ["social-token-net", "social-token-net-tokens"];
const stnCaps = async (tenantId: string) => (await capsOf(tenantId)).filter((c) => STN_CAPS.includes(c)).sort();
/** Precio de Stripe enlazado de un producto (el mensual aprobado). */
const priceOf = (productKey: string) => {
  const p = gw.prices.find((x) => x.lookupKey?.startsWith(`es:${productKey}:monthly:`));
  if (!p) throw new Error(`sin precio para ${productKey}`);
  return p.id;
};
/** Llamadas a Stripe que CAMBIAN partidas desde una marca. */
const updatesSince = (mark: number) => gw.calls.slice(mark).filter((c) => c.op === "subscriptions.update");
/** Ninguna capacidad de Social Token Net pasó por un estado distinto de «activa» (sin hueco de licencias). */
const neverInactive = async (tenantId: string, since: number) => {
  const evs = (await caps.events(tenantId, 500)).filter((e) => STN_CAPS.includes(e.capabilityId) && e.at >= since);
  return evs.every((e) => e.toStatus === "active");
};
const liveItems = async (companyId: number) => {
  const sub = (await subsStore.list({ companyId }))[0];
  return (await subsStore.items(sub.id)).filter((i) => i.family !== "core_plan" && i.family !== "addon" && i.effectiveFrom <= clock && (i.effectiveTo === null || i.effectiveTo > clock)).map((i) => i.productKey).sort();
};

describe("Social Token Net: de módulos sueltos a Complete en una sola operación de Stripe", () => {
  it("con Comunidades contratado, Complete lo sustituye: una sola actualización con prorrateo, se paga solo la diferencia y las licencias no se interrumpen", async () => {
    const a = await activeCompany("STN Comunidades SL");
    gw.now = Math.floor(clock / 1000);
    expect((await ok(buy(a.tenantId, { add: [COM] }), 201)).purchase.status).toBe("applied");
    expect(await stnCaps(a.tenantId)).toEqual(["social-token-net"]);
    const comItem = gw.subscriptions.get(a.subId)!.items!.find((i) => i.priceId === priceOf(COM))!;

    // Vista previa: entra Complete, sale Comunidades; +20 €/mes y prorrateo de la diferencia
    const p = (await ok(preview(a.tenantId, { add: [CPL] }))).preview;
    expect(p.lines).toEqual([
      expect.objectContaining({ productKey: CPL, kind: "module", fromQuantity: 0, toQuantity: 1 }),
      expect.objectContaining({ productKey: COM, kind: "module", fromQuantity: 1, toQuantity: 0 }),
    ]);
    expect(p.recurringDeltaCents).toBe(5900 - 3900);
    expect(p.amountDueCents).toBeGreaterThan(0);
    expect(p.amountDueCents).toBeLessThanOrEqual(2000);

    const mark = gw.calls.length;
    const invoices = gw.invoices.size;
    const t0 = clock;
    const idem = key();
    const r = await ok(buy(a.tenantId, { idempotencyKey: idem, add: [CPL] }), 201);
    expect(r.purchase).toMatchObject({ status: "applied", created: true });
    // UNA sola operación: la partida de Comunidades pasa al precio de Complete, con prorrateo y cobro condicionado
    const up = updatesSince(mark);
    expect(up).toHaveLength(1);
    expect(up[0].input).toMatchObject({ prorationBehavior: "always_invoice", paymentBehavior: "pending_if_incomplete", items: [{ id: comItem.id, priceId: priceOf(CPL), quantity: 1 }] });
    expect(JSON.stringify(up[0].input)).not.toContain("deleted");
    // Una factura: abono de Comunidades no consumido + cargo de Complete = la diferencia
    expect(gw.invoices.size).toBe(invoices + 1);
    const inv = Array.from(gw.invoices.values()).at(-1)!;
    expect(inv.lines!.map((l) => Math.sign(l.amount)).sort()).toEqual([-1, 1]);
    expect(inv.total).toBe(p.amountDueCents);
    // Stripe ya solo cobra Complete (y el plan)
    const items = gw.subscriptions.get(a.subId)!.items!;
    expect(items.map((i) => i.priceId)).not.toContain(priceOf(COM));
    expect(items.find((i) => i.priceId === priceOf(CPL))).toMatchObject({ id: comItem.id, quantity: 1 });
    // Pedido activo; suscripción interna con Complete desde ya; licencias sin hueco
    expect(await orderState(r.purchase.orderId)).toBe("active");
    expect(await liveItems(a.companyId)).toEqual([CPL]);
    expect(await stnCaps(a.tenantId)).toEqual([...STN_CAPS].sort());
    expect(await neverInactive(a.tenantId, t0)).toBe(true);

    // Idempotencia: la misma compra no vuelve a cambiar ni a cobrar nada (ni con los webhooks repetidos)
    const again = await ok(buy(a.tenantId, { idempotencyKey: idem, add: [CPL] }), 200);
    expect(again.purchase).toMatchObject({ status: "applied", orderId: r.purchase.orderId, created: false });
    expect(gw.invoices.size).toBe(invoices + 1);
    await deliverSince(0);
    await settled();
    expect(updatesSince(mark)).toHaveLength(1);
    expect(await orderState(r.purchase.orderId)).toBe("active");
    expect(await stnCaps(a.tenantId)).toEqual([...STN_CAPS].sort());
    // Con Complete, los módulos sueltos ya no se venden
    const tok = await buy(a.tenantId, { add: [TOK] });
    expect(tok.status).toBe(400);
    expect(tok.json.message).toMatch(/ya está incluido en «Social Token Net Complete»/);
  });

  it("con Comunidades y Tokens internos, Complete los sustituye a los dos: sale más barato (abono), sin hueco y con la partida sobrante a 0", async () => {
    const a = await activeCompany("STN Ambos SL");
    gw.now = Math.floor(clock / 1000);
    await ok(buy(a.tenantId, { add: [COM] }), 201);
    await ok(buy(a.tenantId, { add: [TOK] }), 201);
    expect(await stnCaps(a.tenantId)).toEqual([...STN_CAPS].sort());
    const before = gw.subscriptions.get(a.subId)!.items!;
    const comItem = before.find((i) => i.priceId === priceOf(COM))!;
    const tokItem = before.find((i) => i.priceId === priceOf(TOK))!;

    const p = (await ok(preview(a.tenantId, { add: [CPL] }))).preview;
    expect(p.lines.map((l: { productKey: string; toQuantity: number }) => [l.productKey, l.toQuantity])).toEqual([[CPL, 1], [COM, 0], [TOK, 0]]);
    expect(p.recurringDeltaCents).toBe(5900 - 3900 - 2900);
    expect(p.amountDueCents).toBeLessThanOrEqual(0);

    const mark = gw.calls.length;
    const t0 = clock;
    const r = await ok(buy(a.tenantId, { add: [CPL] }), 201);
    expect(r.purchase.status).toBe("applied");
    const up = updatesSince(mark);
    expect(up).toHaveLength(1);
    expect(up[0].input).toMatchObject({ prorationBehavior: "always_invoice", items: [{ id: comItem.id, priceId: priceOf(CPL), quantity: 1 }, { id: tokItem.id, quantity: 0 }] });
    const after = gw.subscriptions.get(a.subId)!.items!;
    expect(after.find((i) => i.id === comItem.id)).toMatchObject({ priceId: priceOf(CPL), quantity: 1 });
    expect(after.find((i) => i.id === tokItem.id)).toMatchObject({ priceId: priceOf(TOK), quantity: 0 });
    // Sin importe ni capacidades nuevas: confirmación heredada del pedido anterior
    const detail = await ok(call("GET", `/orders/${r.purchase.orderId}`));
    expect(detail.order).toMatchObject({ state: "active", confirmation: expect.objectContaining({ kind: "inherited" }) });
    expect(await liveItems(a.companyId)).toEqual([CPL]);
    expect(await stnCaps(a.tenantId)).toEqual([...STN_CAPS].sort());
    expect(await neverInactive(a.tenantId, t0)).toBe(true);
    await deliverSince(0);
    await settled();
    expect(updatesSince(mark)).toHaveLength(1);

    // La partida a 0 no impide otra compra ni se borra en ella; la siguiente reducción la retira sin cobrar nada
    const pu = (await ok(preview(a.tenantId, { users: 5 }))).preview;
    expect(pu.lines.map((l: { productKey: string }) => l.productKey)).toEqual(["addon-user-essential"]);
    const mark2 = gw.calls.length;
    await ok(buy(a.tenantId, { users: 5 }), 201);
    expect(JSON.stringify(updatesSince(mark2))).not.toContain("deleted");
    expect(gw.subscriptions.get(a.subId)!.items!.some((i) => i.id === tokItem.id && i.quantity === 0)).toBe(true);
    const invoices = gw.invoices.size;
    const red = await ok(reduce(a.tenantId, { users: 3 }), 201);
    expect(red.reduction.status).toBe("applied");
    expect(gw.subscriptions.get(a.subId)!.items!.some((i) => i.id === tokItem.id)).toBe(false);
    expect(gw.invoices.size).toBe(invoices);
    expect(await stnCaps(a.tenantId)).toEqual([...STN_CAPS].sort());
  });

  it("cobro fallido de la sustitución: no cambia nada (ni Stripe, ni la suscripción interna, ni las licencias); al caducar, el pedido se rechaza", async () => {
    const a = await activeCompany("STN Fallo SL");
    gw.now = Math.floor(clock / 1000);
    await ok(buy(a.tenantId, { add: [COM] }), 201);
    const before = JSON.stringify(gw.subscriptions.get(a.subId)!.items);
    gw.paymentOutcome.set(a.customerId, "fail");
    const r = await ok(buy(a.tenantId, { add: [CPL] }), 201);
    expect(r.purchase.status).toBe("payment_pending");
    expect(JSON.stringify(gw.subscriptions.get(a.subId)!.items)).toBe(before);
    expect(await liveItems(a.companyId)).toEqual([COM]);
    expect(await stnCaps(a.tenantId)).toEqual(["social-token-net"]);
    const mark = gw.events.length;
    gw.expirePendingUpdate(a.subId);
    await deliverSince(mark);
    await until(async () => (await orderState(r.purchase.orderId)) === "rejected");
    expect(JSON.stringify(gw.subscriptions.get(a.subId)!.items)).toBe(before);
    expect(await liveItems(a.companyId)).toEqual([COM]);
    expect(await stnCaps(a.tenantId)).toEqual(["social-token-net"]);
    gw.paymentOutcome.delete(a.customerId);
  });

  it("nunca el paquete y un componente a la vez; la sustitución no toca a otra empresa ni borra datos", async () => {
    const a = await activeCompany("STN Doble SL");
    const b = await activeCompany("STN Vecina SL");
    gw.now = Math.floor(clock / 1000);
    const both = await buy(a.tenantId, { add: [CPL, COM] });
    expect(both.status).toBe(400);
    expect(both.json.message).toMatch(/ya va incluido en «Social Token Net Complete»/);
    await ok(buy(b.tenantId, { add: [COM] }), 201);
    const bItems = JSON.stringify(gw.subscriptions.get(b.subId)!.items);
    const bCaps = await stnCaps(b.tenantId);
    await ok(buy(a.tenantId, { add: [COM] }), 201);
    await ok(buy(a.tenantId, { add: [CPL] }), 201);
    expect(JSON.stringify(gw.subscriptions.get(b.subId)!.items)).toBe(bItems);
    expect(await stnCaps(b.tenantId)).toEqual(bCaps);
    expect(await liveItems(b.companyId)).toEqual([COM]);
    // Datos del tenant: ninguna base de datos se borra ni se reaprovisiona en un cambio de plan
    expect(dropped).toEqual([]);
  });

  it("sustitución pura: las partidas a 0 previas se conservan y ninguna otra partida puede desaparecer", () => {
    const current = [
      { id: "si_plan", priceId: "p_plan", quantity: 1 },
      { id: "si_a", priceId: "p_a", quantity: 1 },
      { id: "si_b", priceId: "p_b", quantity: 1 },
      { id: "si_z", priceId: "p_z", quantity: 0 },
    ];
    const desired = new Map([["p_plan", 1], ["p_z", 0], ["p_pack", 1]]);
    const r = substitutionItems(current, desired, [{ bundlePriceId: "p_pack", componentPriceIds: ["p_a", "p_b"] }]);
    expect(r.items).toEqual([{ id: "si_a", priceId: "p_pack", quantity: 1 }, { id: "si_b", quantity: 0 }]);
    expect(r.expected.sort((x, y) => x.priceId.localeCompare(y.priceId))).toEqual([
      { priceId: "p_b", quantity: 0 },
      { priceId: "p_pack", quantity: 1 },
      { priceId: "p_plan", quantity: 1 },
      { priceId: "p_z", quantity: 0 },
    ]);
    // Sin sustitución, quitar una partida sigue siendo un borrado (y la compra lo rechaza)
    expect(substitutionItems(current, new Map([["p_plan", 1], ["p_b", 1], ["p_z", 0]]), []).items).toEqual([{ id: "si_a", deleted: true }]);
  });
});
