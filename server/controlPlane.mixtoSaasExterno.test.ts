/**
 * Modelo MIXTO con empresas SINTÉTICAS: una misma empresa con (i) plataforma SaaS (Elephant Core, suscripción
 * estándar cobrada en Stripe) y (ii) un servicio tecnológico EXTERNO (SkiNet, cobro el día 1 con Stripe Billing).
 * Aplicación REAL del plano de control por HTTP (CRM, pedidos, Stripe, servicios externos, aprovisionamiento);
 * Stripe es un doble (FakeStripeGateway) y la firma del webhook es la real del SDK. No hay datos reales ni Stripe real.
 *
 * Circuito: contrato externo del CRM → aceptación digital → autorización de pago → presupuesto/pedido SaaS →
 * aceptación → suscripción + pago → plataforma → cobros → renovaciones → impagos cruzados → bajas cruzadas.
 *
 * Cómo se compone hoy el modelo (lo que fija esta prueba): el servicio externo solo se puede dar de alta mientras la
 * empresa NO tiene plataforma (external/service.ts: «La empresa ya es cliente de Elephant Core»); después se contrata el
 * SaaS sobre la MISMA empresa. Una sola empresa, un solo Customer de Stripe, dos suscripciones de Stripe (cada una
 * identificada por sus metadatos es_external_id / es_order_id) y UNA suscripción interna de plataforma.
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
import { MemoryExternalStore } from "./external/store";
import { chargeInstant } from "./external/schedule";

const ADMIN = "mixto-admin-token-aaaaaaaaaaaaaaaaaaaaaa";
const CRM_ORIGIN = "https://admin.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "m".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
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
const ext = new MemoryExternalStore();
const changes = new MemorySubscriptionChangeStore();
const notify: TrialNotifier = { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined };
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
const madrid = (y: number, m: number, d: number, h = 8) => chargeInstant(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, h, "Europe/Madrid");
const sec = (ms: number) => Math.floor(ms / 1000);
const DAY = 86_400_000;
const orderOf = async (id: number) => ok(call("GET", `/orders/${id}`));
const extOf = async (id: number) => (await ok(call("GET", `/external/${id}`))).external;
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
    trials: { store: new MemoryTrialStore(), publicEnabled: false, autoProvision: false, notify },
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
    external: {
      store: ext,
      urls: { acceptance: `${CRM_ORIGIN}/cp/v1/public/contract-acceptance`, setupSuccess: `${CRM_ORIGIN}/ok`, setupCancel: `${CRM_ORIGIN}/ko`, portalReturn: CRM_ORIGIN },
      ipSalt: "s".repeat(32),
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

const SKINET = { key: "skinet", name: "SkiNet — Servicio tecnológico gestionado" };
const CONDITIONS = "Servicio tecnológico gestionado (infraestructura externa a Elephant Source) sintético para pruebas: mantenimiento y soporte. Duración indefinida con baja con 30 días de preaviso.";
const extBody = (companyId: number) => ({ companyId, service: SKINET, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", externalRef: "sintetico:mixto", conditions: CONDITIONS });

type Mixed = { companyId: number; tenantId: string; extId: number; extSubId: string; extContractId: number; orderId: number; saasSubId: string; internalSubId: number; customerId: string };

/**
 * Empresa sintética mixta: primero el servicio externo (contrato → aceptación digital → autorización de pago →
 * programado) y después la plataforma SaaS (presupuesto/pedido → aceptación → Checkout → pago → plataforma).
 * Devuelve los identificadores de cada pieza para comprobar las relaciones cruzadas.
 */
async function mixed(name: string, taxId: string): Promise<Mixed> {
  clock = Date.UTC(2026, 9, 27, 9);
  const mail = taxId.toLowerCase();
  const company = await crm.createCompany({ name, legalName: name, taxId, country: "ES", billingEmail: `facturas@${mail}.example` }, "operator:test");
  await crm.createContact(company.id, { name: "Rep Sintético", email: `rep@${mail}.example`, isPrimary: true }, "operator:test");
  // 1) Servicio externo: contrato del CRM, aceptación digital y autorización del método de pago (sin cargo)
  const created = (await ok(call("POST", "/external", { body: extBody(company.id) }), 201)).external;
  const acc = (await ok(call("POST", `/external/${created.id}/acceptance`, { body: { name: "Rep Sintético", email: `rep@${mail}.example`, role: "Administrador" } }), 201)).acceptance;
  const token = new URL(acc.url).searchParams.get("token")!;
  await ok(call("POST", "/public/contract-acceptance", { token: null, raw: new URLSearchParams({ token, name: "Rep Sintético", taxId, accept: "1" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }));
  const setup = (await ok(call("POST", `/external/${created.id}/payment-setup`))).setup;
  let mark = gw.events.length;
  const pm = gw.completeSetupSession(setup.sessionId);
  await deliverSince(mark);
  const x = await extOf(created.id);
  expect(x).toMatchObject({ status: "scheduled", stripePaymentMethodId: pm, companyId: company.id });
  // 2) Plataforma SaaS sobre la MISMA empresa: pedido (presupuesto), aceptación, Checkout, pago
  const o = await ok(call("POST", "/orders", { body: { idempotencyKey: `mixto-${key()}`, companyId: company.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
  await ok(call("POST", `/orders/${o.order.id}/accept`, { body: { signatureRef: `firma-${company.id}`, approvalReason: "Aprobado por producto para la beta" } }), [200, 202]);
  const s = await ok(call("POST", `/stripe/orders/${o.order.id}/checkout`));
  mark = gw.events.length;
  const saasSubId = gw.completeSession(s.sessionId);
  await deliverSince(mark);
  await until(async () => (await orders.get(o.order.id))?.state === "active");
  await deliverSince(mark);
  const detail = await orderOf(o.order.id);
  const internal = (await subsStore.list({ companyId: company.id }))[0];
  return { companyId: company.id, tenantId: detail.order.tenantId, extId: created.id, extSubId: x.stripeSubscriptionId, extContractId: x.contractId, orderId: o.order.id, saasSubId, internalSubId: internal.id, customerId: x.stripeCustomerId };
}
/** Cobro mensual del servicio externo (día 1, hora de Madrid) entregado por webhook. */
async function extCharge(m: Mixed, y: number, mo: number, outcome: "paid" | "open") {
  clock = madrid(y, mo, 1);
  const mark = gw.events.length;
  const next = mo === 12 ? [y + 1, 1] : [y, mo + 1];
  const id = gw.chargeServicePeriod(m.extSubId, sec(madrid(y, mo, 1)), sec(madrid(next[0], next[1], 1)), outcome);
  await deliverSince(mark);
  return id;
}
/** Renovación del SaaS de 29 € (30 días desde el reloj), pagada o fallida, entregada por webhook. */
async function saasRenewal(m: Mixed, outcome: "paid" | "open") {
  const sub = gw.subscriptions.get(m.saasSubId)!;
  const mark = gw.events.length;
  const start = sec(clock);
  const inv = gw.addInvoice(m.saasSubId, sub.customerId, "subscription_cycle", outcome, 2900, sub.items!.map((i) => ({ id: `il_${i.id}_${start}`, subscriptionItemId: i.id, priceId: i.priceId, quantity: i.quantity, amount: 2900, taxCents: null, proration: false, periodStart: start, periodEnd: start + 30 * 86_400 })));
  gw.updateSubscription(m.saasSubId, { status: outcome === "paid" ? "active" : "past_due", currentPeriodStart: start, currentPeriodEnd: start + 30 * 86_400 });
  gw.emit(outcome === "paid" ? "invoice.paid" : "invoice.payment_failed", "invoice", inv);
  gw.emit("customer.subscription.updated", "subscription", m.saasSubId);
  await deliverSince(mark);
  return inv;
}
const saasPayments = async (m: Mixed) => (await orderOf(m.orderId)).payments as Array<{ purpose: string; status: string; providerRef: string; amountCents: number }>;
const extEvents = async (id: number, kind: string) => (await ext.events(id)).filter((e) => e.kind === kind);

describe("modelo mixto: empresa sintética con plataforma SaaS + servicio externo", { timeout: 60_000 }, () => {
  let A: Mixed;
  let B: Mixed;

  it("alta: una sola empresa, una sola suscripción SaaS por tenant, un solo Customer de Stripe y el contrato del CRM intacto", async () => {
    A = await mixed("Mixto Sintético Alfa SL", "B90000001");
    const company = (await crmStore.get("companies", A.companyId))!;
    // UNA empresa con tenant (la plataforma se vincula a la misma empresa del servicio externo)
    expect(company.tenantId).toBe(A.tenantId);
    expect((await crmStore.list("companies", {})).filter((c: { name: string }) => c.name === "Mixto Sintético Alfa SL")).toHaveLength(1);
    expect((await registry.listTenants()).filter((t) => t.id === A.tenantId)).toHaveLength(1);
    // UNA sola suscripción interna de plataforma, viva, de esa empresa y ese tenant, enlazada al pedido
    const subs = await subsStore.list({ companyId: A.companyId });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ id: A.internalSubId, companyId: A.companyId, tenantId: A.tenantId, status: "active" });
    const viaApi = (await ok(call("GET", `/subscriptions?companyId=${A.companyId}`))).subscriptions;
    expect(viaApi).toHaveLength(1);
    expect(viaApi[0].billing).toMatchObject({ source: "stripe", orderId: A.orderId });
    const order = (await orderOf(A.orderId)).order;
    expect(order).toMatchObject({ companyId: A.companyId, tenantId: A.tenantId, state: "active" });
    // Plataforma con licencias activas; el servicio externo NO crea tenant ni aprovisiona nada propio
    expect((await capsOf(A.tenantId)).length).toBeGreaterThan(0);
    expect(provisioned.filter((id) => id === A.tenantId)).toHaveLength(1);
    // Un solo Customer de Stripe por empresa; las DOS suscripciones de Stripe cuelgan de él y cada una apunta a lo suyo
    expect(await stripeStore.customerByCompany(A.companyId)).toMatchObject({ companyId: A.companyId, stripeCustomerId: A.customerId });
    const extSub = gw.subscriptions.get(A.extSubId)!;
    const saasSub = gw.subscriptions.get(A.saasSubId)!;
    expect(extSub.customerId).toBe(A.customerId);
    expect(saasSub.customerId).toBe(A.customerId);
    expect(extSub.metadata).toMatchObject({ es_external_id: String(A.extId), es_contract_id: String(A.extContractId), es_company_id: String(A.companyId) });
    expect(extSub.metadata.es_order_id).toBeUndefined();
    expect(saasSub.metadata).toMatchObject({ es_order_id: String(A.orderId) });
    expect(saasSub.metadata.es_external_id).toBeUndefined();
    // Contrato del CRM del servicio externo: conserva sus condiciones, firmado, sin plan y sin tocar por la plataforma
    const contract = (await crmStore.get("contracts", A.extContractId))!;
    expect(contract).toMatchObject({ companyId: A.companyId, amountCents: 100_000, billingInterval: "month", planId: null, status: "signed" });
    expect(contract.conditions).toContain("1.210,00");
    expect(contract.conditions).toContain("Duración indefinida con baja con 30 días de preaviso");
    // La empresa tiene DOS contratos distintos en el CRM: el del servicio externo (sin plan) y el del plan SaaS (con plan y tenant)
    const contracts = (await crmStore.list("contracts", { companyId: A.companyId })) as Array<{ id: number; planId: string | null; tenantId: string | null; amountCents: number; status: string }>;
    expect(contracts).toHaveLength(2);
    const saasContract = contracts.find((c) => c.id !== A.extContractId)!;
    expect(saasContract).toMatchObject({ planId: "essential", tenantId: A.tenantId, amountCents: 2900, status: "active" });
    expect(order.contractId).toBe(saasContract.id);
    expect(order.subscriptionId).toBe(A.internalSubId);
    // Nota (no se fija): el enlace empresa↔Customer lo creó el servicio externo con tenantId null y no se actualiza al nacer el tenant
    expect((await stripeStore.customerByCompany(A.companyId))?.tenantId === null || (await stripeStore.customerByCompany(A.companyId))?.tenantId === A.tenantId).toBe(true);
    // Servicio externo registrado contra la misma empresa, aún sin cobrar (programado al día 1)
    expect(await extOf(A.extId)).toMatchObject({ companyId: A.companyId, contractId: A.extContractId, status: "scheduled", stripeSubscriptionId: A.extSubId, stripeCustomerId: A.customerId });
    // Un segundo servicio externo igual (duplicado) o una segunda contratación del SaaS se rechazan
    expect((await call("POST", "/external", { body: extBody(A.companyId) })).status).toBe(409);
    expect((await call("POST", "/orders", { body: { idempotencyKey: `mixto-${key()}`, companyId: A.companyId, request: { plan: "business", interval: "month", items: [] } } })).status).toBe(409);
    // El alta del SaaS pagó SOLO el SaaS (29 €): ningún importe del servicio externo se mezcla en su pedido
    expect(await saasPayments(A)).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", amountCents: 2900 })]);
  });

  it("cobros: cada factura se atribuye a su suscripción y empresa; webhooks repetidos no duplican nada", async () => {
    B = await mixed("Mixto Sintético Beta SL", "B90000002");
    expect(B.companyId).not.toBe(A.companyId);
    expect(B.tenantId).not.toBe(A.tenantId);
    // Empresas distintas, Customers distintos, suscripciones de Stripe distintas
    expect(new Set([A.customerId, B.customerId]).size).toBe(2);
    expect(new Set([A.extSubId, A.saasSubId, B.extSubId, B.saasSubId]).size).toBe(4);

    const novA = await extCharge(A, 2026, 11, "paid");
    const novB = await extCharge(B, 2026, 11, "paid");
    expect(novA).not.toBe(novB);
    for (const [m, inv] of [[A, novA], [B, novB]] as const) {
      const d = await ok(call("GET", `/external/${m.extId}`));
      expect(d.external).toMatchObject({ status: "active", lastInvoiceId: inv, lastInvoiceStatus: "paid" });
      const paid = d.events.find((e: { kind: string; ref: string }) => e.kind === "invoice_paid" && e.ref === inv);
      // La referencia de facturación es la del servicio de ESA empresa (nunca la del SaaS ni la de la otra)
      expect(paid.detail).toMatchObject({ billingRef: `external:${m.extId}`, paymentRef: `stripe:in:${inv}`, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000 });
      expect(gw.invoices.get(inv)).toMatchObject({ subscriptionId: m.extSubId, customerId: m.customerId });
    }
    // El cobro del servicio externo no genera pagos en el pedido SaaS (ni en el de la otra empresa)
    expect(await saasPayments(A)).toHaveLength(1);
    expect(await saasPayments(B)).toHaveLength(1);

    // Renovación del SaaS (≈ un mes después): pago de renovación en SU pedido, nada en el servicio externo
    clock += 31 * DAY;
    const eventsA = (await ext.events(A.extId)).length;
    const renA = await saasRenewal(A, "paid");
    const payA = await saasPayments(A);
    expect(payA).toHaveLength(2);
    expect(payA).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "renewal", status: "succeeded", providerRef: renA, amountCents: 2900 })]));
    expect(await saasPayments(B)).toHaveLength(1);
    expect((await ext.events(A.extId)).length).toBe(eventsA);
    expect(await subsStore.list({ companyId: A.companyId })).toHaveLength(1);

    // Idempotencia: repetir TODOS los webhooks no cambia pagos, eventos, suscripciones ni llamadas de alta a Stripe
    const snap = async () => ({
      payA: (await saasPayments(A)).length,
      payB: (await saasPayments(B)).length,
      evA: (await ext.events(A.extId)).length,
      evB: (await ext.events(B.extId)).length,
      subsA: (await subsStore.list({ companyId: A.companyId })).length,
      createsExt: gw.calls.filter((c) => c.op === "subscriptions.create(service)").length,
      createsSession: gw.calls.filter((c) => c.op === "checkout.sessions.create").length,
    });
    const before = await snap();
    await deliverSince(0);
    expect(await snap()).toEqual(before);
    expect((await extEvents(A.extId, "invoice_paid")).map((e) => e.ref)).toEqual([novA]);
    expect((await extEvents(B.extId, "invoice_paid")).map((e) => e.ref)).toEqual([novB]);
  });

  it("el IMPAGO del servicio externo no suspende la plataforma SaaS (y se recupera sin tocarla)", async () => {
    const sub = (await subsStore.get(A.internalSubId))!;
    const payments = (await saasPayments(A)).length;
    const dec = await extCharge(A, 2026, 12, "open");
    expect(await extOf(A.extId)).toMatchObject({ status: "past_due", lastInvoiceId: dec });
    // La plataforma sigue exactamente igual: pedido activo, suscripción activa, licencias activas, tenant sin suspender
    expect((await orderOf(A.orderId)).order.state).toBe("active");
    expect(await subsStore.get(A.internalSubId)).toMatchObject({ status: "active", version: sub.version });
    expect((await capsOf(A.tenantId)).length).toBeGreaterThan(0);
    expect((await registry.getTenant(A.tenantId))?.status).toBe("active");
    expect((await saasPayments(A)).length).toBe(payments);
    // Incluso pasado el plazo de gracia del servicio, la evaluación solo alerta; no toca la plataforma
    clock = madrid(2026, 12, 6, 9);
    expect((await ok(call("POST", "/external/evaluate"))).overdue).toEqual([expect.objectContaining({ externalId: A.extId, invoiceId: dec })]);
    expect((await orderOf(A.orderId)).order.state).toBe("active");
    expect((await capsOf(A.tenantId)).length).toBeGreaterThan(0);
    // La otra empresa no se ve afectada por el impago de esta
    expect(await extOf(B.extId)).toMatchObject({ status: "active" });
    // Recuperación: la MISMA factura queda cobrada, servicio activo, sin gracia, y sigue habiendo una sola suscripción SaaS
    const mark = gw.events.length;
    gw.recoverServiceInvoice(dec);
    await deliverSince(mark);
    expect(await extOf(A.extId)).toMatchObject({ status: "active", graceUntil: null, lastInvoiceId: dec, lastInvoiceStatus: "paid" });
    expect((await subsStore.list({ companyId: A.companyId })).map((s) => s.id)).toEqual([A.internalSubId]);
    // El evento de impago se registró una sola vez
    expect((await extEvents(A.extId, "invoice_payment_failed")).map((e) => e.ref)).toEqual([dec]);
  });

  it("el IMPAGO de la plataforma SaaS no toca el servicio externo (y se recupera)", async () => {
    clock = Date.UTC(2026, 11, 28, 9);
    const evB = (await ext.events(B.extId)).length;
    const inv = await saasRenewal(B, "open");
    expect((await orderOf(B.orderId)).order.state).toBe("past_due");
    // Solo el SaaS entra en gracia: el tenant de ESA empresa; el de la otra (con su servicio externo) sigue activo
    expect((await registry.getTenant(B.tenantId))?.status).toBe("grace");
    expect((await registry.getTenant(A.tenantId))?.status).toBe("active");
    expect(gw.subscriptions.get(B.saasSubId)!.status).toBe("past_due");
    // El servicio externo de la misma empresa: activo, misma factura, ningún evento nuevo
    expect(await extOf(B.extId)).toMatchObject({ status: "active", graceUntil: null });
    expect(gw.subscriptions.get(B.extSubId)!.status).toBe("active");
    expect((await ext.events(B.extId)).length).toBe(evB);
    // La empresa A (también mixta) sigue activa en ambas patas
    expect((await orderOf(A.orderId)).order.state).toBe("active");
    expect(await extOf(A.extId)).toMatchObject({ status: "active" });
    // Recuperación del SaaS: misma factura cobrada → pedido activo; ningún pago duplicado
    const mark = gw.events.length;
    gw.updateSubscription(B.saasSubId, { status: "active" });
    const paid = gw.invoices.get(inv)!;
    gw.invoices.set(inv, { ...paid, status: "paid", amountPaid: paid.total ?? 2900 });
    gw.emit("invoice.paid", "invoice", inv);
    gw.emit("customer.subscription.updated", "subscription", B.saasSubId);
    await deliverSince(mark);
    expect((await orderOf(B.orderId)).order.state).toBe("active");
    expect((await registry.getTenant(B.tenantId))?.status).toBe("active");
    expect((await saasPayments(B)).filter((p) => p.providerRef === inv)).toHaveLength(1);
    expect(await extOf(B.extId)).toMatchObject({ status: "active" });
    expect((await ext.events(B.extId)).length).toBe(evB);
  });

  it("la BAJA del servicio externo deja intacta la plataforma SaaS (empresa A)", async () => {
    const before = { sub: (await subsStore.get(A.internalSubId))!, caps: await capsOf(A.tenantId), pays: (await saasPayments(A)).length };
    // Baja desde el portal de Stripe: la suscripción del servicio se cancela y llega el webhook
    const mark = gw.events.length;
    gw.updateSubscription(A.extSubId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", A.extSubId);
    await deliverSince(mark);
    expect(await extOf(A.extId)).toMatchObject({ status: "canceled" });
    expect(gw.subscriptions.get(A.saasSubId)!.status).not.toBe("canceled");
    expect((await orderOf(A.orderId)).order.state).toBe("active");
    expect(await subsStore.get(A.internalSubId)).toMatchObject({ status: "active", version: before.sub.version });
    expect(await capsOf(A.tenantId)).toEqual(before.caps);
    expect((await saasPayments(A)).length).toBe(before.pays);
    // La empresa sigue siendo UNA, con su tenant, y el Customer de Stripe no se borra
    expect((await crmStore.get("companies", A.companyId))!.tenantId).toBe(A.tenantId);
    expect((await stripeStore.customerByCompany(A.companyId))?.stripeCustomerId).toBe(A.customerId);
    // El contrato del servicio externo conserva sus condiciones tras la baja
    expect((await crmStore.get("contracts", A.extContractId))!.conditions).toContain("1.210,00");
    // La empresa B no se ve afectada
    expect(await extOf(B.extId)).toMatchObject({ status: "active" });
    // Repetir el webhook de baja no cambia nada
    await deliverSince(0);
    expect(await extOf(A.extId)).toMatchObject({ status: "canceled" });
  });

  it("la BAJA de la plataforma SaaS deja intacto el servicio externo (empresa B)", async () => {
    clock = madrid(2027, 1, 1);
    const evBefore = (await ext.events(B.extId)).length;
    // Baja desde el portal de Stripe: primero programada al fin del periodo y después terminada
    let mark = gw.events.length;
    gw.updateSubscription(B.saasSubId, { cancelAtPeriodEnd: true });
    gw.emit("customer.subscription.updated", "subscription", B.saasSubId);
    await deliverSince(mark);
    expect((await orderOf(B.orderId)).order.state).toBe("cancel_scheduled");
    expect(await extOf(B.extId)).toMatchObject({ status: "active" });
    mark = gw.events.length;
    gw.updateSubscription(B.saasSubId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", B.saasSubId);
    await deliverSince(mark);
    expect(["canceled", "cancelled"]).toContain((await orderOf(B.orderId)).order.state);
    // El servicio externo de B: activo, su suscripción de Stripe viva y sin eventos nuevos por la baja
    expect(await extOf(B.extId)).toMatchObject({ status: "active" });
    expect(gw.subscriptions.get(B.extSubId)!.status).toBe("active");
    expect((await ext.events(B.extId)).length).toBe(evBefore);
    // Y el servicio sigue cobrando con normalidad después de la baja del SaaS, atribuido a la empresa B
    const jan = await extCharge(B, 2027, 1, "paid");
    expect(await extOf(B.extId)).toMatchObject({ status: "active", lastInvoiceId: jan });
    expect(gw.invoices.get(jan)).toMatchObject({ subscriptionId: B.extSubId, customerId: B.customerId });
    // La empresa A no se ve afectada por la baja de B
    expect((await orderOf(A.orderId)).order.state).toBe("active");
    expect((await crmStore.get("contracts", B.extContractId))!.conditions).toContain("1.210,00");
  });

  it("regla del modelo: un servicio externo no se contrata sobre una empresa que ya tiene plataforma", async () => {
    // El orden inverso (SaaS primero) se rechaza para no facturar dos veces: el servicio externo va antes
    const r = await call("POST", "/external", { body: { ...extBody(B.companyId), service: { key: "otro", name: "Otro servicio externo" } } });
    expect(r.status).toBe(409);
    expect(r.raw).toMatch(/ya es cliente de Elephant Core/);
  });
});
