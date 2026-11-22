/**
 * Modelo MIXTO de punta a punta sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con TODAS las
 * migraciones del CRM, creada y borrada aquí): una empresa SINTÉTICA con plataforma SaaS + servicio externo (SkiNet).
 * Mismo montaje que circuitoComercial.e2e.mysql.test.ts (almacenes MySQL de CRM, catálogo, suscripciones, pedidos,
 * Stripe, cambios, líneas de factura y registro de eventos) más el almacén MySQL de servicios externos.
 * Stripe es un doble (sin red); la firma de los webhooks es la real del SDK. Sin datos reales.
 *
 * La versión sin MySQL (con más casos: dos empresas, impagos y bajas cruzadas) es controlPlane.mixtoSaasExterno.test.ts.
 * Aquí se comprueba lo que depende de la base de datos real: unicidad por empresa, claves foráneas lógicas y
 * persistencia de los estados tras impagos, recuperaciones, bajas y webhooks repetidos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import Stripe from "stripe";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { WebAdminService } from "./web/service";
import { MysqlWebStore } from "./web/store";
import { CrmService } from "./crm/service";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { createContractActivation } from "./crm/activation";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { catalogFromWebStore } from "./subscriptions/ports";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MysqlTrialStore } from "./trials/store";
import { ProvisioningService } from "./_core/provisioning/service";
import { MemoryProvisioningStore } from "./_core/provisioning/ports";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { seedElephantSource } from "./catalog/seed";
import { MysqlOrderStore } from "./orchestrator/store";
import { MysqlCommercialEventLog } from "./commercialEvents/log";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./stripe/catalog";
import type { StripeConfig } from "./stripe/config";
import { stripeWebhookVerifier, type GwEvent } from "./stripe/gateway";
import { MysqlStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";
import { MysqlSubscriptionChangeStore } from "./stripe/changes";
import { MysqlInvoiceLineStore } from "./stripe/invoiceLines";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { MysqlExternalStore } from "./external/store";
import { chargeInstant } from "./external/schedule";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "mixto_saas_externo_e2e";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const ADMIN = "mixto-mysql-admin-token-aaaaaaaaaaaaaaaa";
const CRM_ORIGIN = "https://admin.example";
// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "q".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

describe.skipIf(!URL_)("modelo mixto SaaS + servicio externo de punta a punta (MySQL real, Stripe simulado)", { timeout: 90_000 }, () => {
  let clock = Date.UTC(2026, 9, 27, 9);
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let server: http.Server;
  let port = 0;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let subsStore: MysqlSubscriptionStore;
  let orders: MysqlOrderStore;
  let stripeStore: MysqlStripeStore;
  let ext: MysqlExternalStore;
  let registry: MemoryTenantRegistryStore;
  const caps = new MemoryCapabilityStore();
  const gw = new FakeStripeGateway();
  // El doble de Stripe sigue el reloj de la prueba
  Object.defineProperty(gw, "now", { get: () => Math.floor(clock / 1000), set: () => {} });

  type Res = { status: number; json: any; raw: string };
  const call = (method: string, p: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
    new Promise<Res>((resolve, reject) => {
      const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
      const token = o.token === undefined ? ADMIN : o.token;
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${p}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": o.headers?.["content-type"] ?? "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
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
  const webhook = (ev: GwEvent) => {
    const raw = JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode: false, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
    return call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret: config.webhookSecret }) } });
  };
  // Plazo por tiempo: en un runner cargado el proceso asíncrono de webhooks puede tardar más de 3 s
  const until = async (fn: () => Promise<boolean>) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("no llegó al estado esperado");
  };
  const settled = () => until(async () => { const c = await stripeStore.eventCounts(); return c.received === 0 && c.processing === 0; });
  const deliverSince = async (mark: number) => {
    for (const ev of gw.events.slice(0, gw.events.length - mark).reverse()) await ok(webhook(ev));
    await settled();
  };
  const madrid = (y: number, m: number, d: number, h = 8) => chargeInstant(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, h, "Europe/Madrid");
  const sec = (ms: number) => Math.floor(ms / 1000);
  const orderOf = async (id: number) => (await ok(call("GET", `/orders/${id}`))) as { order: { state: string; tenantId: string; companyId: number; contractId: number | null; subscriptionId: number | null }; payments: Array<{ purpose: string; status: string; providerRef: string; amountCents: number }> };
  const extOf = async (id: number) => (await ok(call("GET", `/external/${id}`))).external;
  const capsOf = async (t: string) => (await caps.list(t)).filter((g) => g.status === "active").map((g) => g.capabilityId);
  const count = async (sql: string, args: unknown[]) => Number(((await pool.query(sql, args))[0] as Array<{ n: number }>)[0].n);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 10 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const migrations = loadMigrations(DIR).migrations;
    expect(migrations.map((m) => m.id)).toEqual(expect.arrayContaining(["0012_stripe_billing", "0026_external_services"]));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);

    const log = new MysqlCommercialEventLog(pool, "test");
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    crmStore = new MysqlCrmStore(pool);
    subsStore = new MysqlSubscriptionStore(pool, log);
    orders = new MysqlOrderStore(pool, log);
    stripeStore = new MysqlStripeStore(pool, "test", log);
    ext = new MysqlExternalStore(pool, "test");
    const desired = await desiredCatalog(catalogFromWebStore(webStore));
    for (const op of (await planCatalogWrites(desired, gw)).operations) {
      if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
      else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
    }
    await syncCatalog(desired, gw, stripeStore, clock);

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
    crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "e2e" } }), now: () => clock });
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
      trials: { store: new MysqlTrialStore(pool, log), publicEnabled: false, autoProvision: false, notify: { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined } },
      orders: { store: orders, payments: null },
      commercialEvents: log,
      stripe: {
        config,
        store: stripeStore,
        gateway: gw,
        urls: { success: "https://web.example/estado", cancel: "https://web.example/cancelada", portalReturn: "https://app.elephant.test/admin/suscripcion" },
        checkoutEnabled: true,
        verifyWebhook: stripeWebhookVerifier(config),
        workerEnabled: false,
        publicStatus: false,
        selfService: false,
        termsVersion: null,
        purchases: { enabled: true, changes: new MysqlSubscriptionChangeStore(pool, "test") },
        invoiceLines: new MysqlInvoiceLineStore(pool, "test"),
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
    server?.closeAllConnections();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  let m: { companyId: number; tenantId: string; extId: number; extSubId: string; extContractId: number; orderId: number; saasSubId: string; internalSubId: number; customerId: string };

  it("alta: contrato externo → aceptación → autorización de pago → pedido SaaS → pago → plataforma, sobre la MISMA empresa", async () => {
    const company = await crm.createCompany({ name: "Mixto MySQL Sintético SL", legalName: "Mixto MySQL Sintético SL", taxId: "B90000009", country: "ES", billingEmail: "facturas@mixto-mysql.example" }, "operator:e2e");
    await crm.createContact(company.id, { name: "Rep Sintético", email: "rep@mixto-mysql.example", isPrimary: true }, "operator:e2e");
    const created = (await ok(call("POST", "/external", { body: { companyId: company.id, service: { key: "skinet", name: "SkiNet — Servicio tecnológico gestionado" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", externalRef: "sintetico:mixto-mysql", conditions: "Servicio sintético para pruebas. Duración indefinida con baja con 30 días de preaviso." } }), 201)).external;
    const acc = (await ok(call("POST", `/external/${created.id}/acceptance`, { body: { name: "Rep Sintético", email: "rep@mixto-mysql.example", role: "Administrador" } }), 201)).acceptance;
    const token = new URL(acc.url).searchParams.get("token")!;
    await ok(call("POST", "/public/contract-acceptance", { token: null, raw: new URLSearchParams({ token, name: "Rep Sintético", taxId: "B90000009", accept: "1" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }));
    const setup = (await ok(call("POST", `/external/${created.id}/payment-setup`))).setup;
    let mark = gw.events.length;
    const pm = gw.completeSetupSession(setup.sessionId);
    await deliverSince(mark);
    const x = await extOf(created.id);
    expect(x).toMatchObject({ status: "scheduled", stripePaymentMethodId: pm, companyId: company.id });

    const o = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: company.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    await ok(call("POST", `/orders/${o.order.id}/accept`, { body: { signatureRef: `firma-${company.id}`, approvalReason: "Aprobado para el ensayo de punta a punta" } }), [200, 202]);
    const s = await ok(call("POST", `/stripe/orders/${o.order.id}/checkout`));
    mark = gw.events.length;
    const saasSubId = gw.completeSession(s.sessionId);
    await deliverSince(mark);
    await until(async () => (await orders.get(o.order.id))?.state === "active");
    await deliverSince(mark);
    const d = await orderOf(o.order.id);
    const internal = (await subsStore.list({ companyId: company.id }))[0];
    m = { companyId: company.id, tenantId: d.order.tenantId, extId: created.id, extSubId: x.stripeSubscriptionId, extContractId: x.contractId, orderId: o.order.id, saasSubId, internalSubId: internal.id, customerId: x.stripeCustomerId };

    // Una empresa, un tenant, una suscripción SaaS, un Customer de Stripe, dos contratos del CRM distintos
    expect(await count("SELECT COUNT(*) AS n FROM crm_companies WHERE name = ?", ["Mixto MySQL Sintético SL"])).toBe(1);
    expect((await crmStore.get("companies", m.companyId))!.tenantId).toBe(m.tenantId);
    expect(await count("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [m.companyId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM stripe_customers WHERE company_id = ?", [m.companyId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM external_subscriptions WHERE company_id = ?", [m.companyId])).toBe(1);
    const contracts = (await crmStore.list("contracts", { companyId: m.companyId })) as Array<{ id: number; planId: string | null; tenantId: string | null; amountCents: number; conditions: string | null }>;
    expect(contracts).toHaveLength(2);
    expect(contracts.find((c) => c.id === m.extContractId)).toMatchObject({ planId: null, amountCents: 100_000 });
    expect(contracts.find((c) => c.id === m.extContractId)!.conditions).toContain("1.210,00");
    expect(contracts.find((c) => c.id !== m.extContractId)).toMatchObject({ planId: "essential", tenantId: m.tenantId, amountCents: 2900 });
    expect(d.order).toMatchObject({ companyId: m.companyId, state: "active", subscriptionId: m.internalSubId });
    // Relaciones cruzadas en Stripe: ambas suscripciones del mismo Customer, cada una con sus metadatos
    const link = await stripeStore.customerByCompany(m.companyId);
    expect(link?.stripeCustomerId).toBe(m.customerId);
    expect(gw.subscriptions.get(m.extSubId)!.customerId).toBe(m.customerId);
    expect(gw.subscriptions.get(m.saasSubId)!.customerId).toBe(m.customerId);
    expect(gw.subscriptions.get(m.extSubId)!.metadata).toMatchObject({ es_external_id: String(m.extId), es_company_id: String(m.companyId) });
    expect(gw.subscriptions.get(m.saasSubId)!.metadata).toMatchObject({ es_order_id: String(m.orderId) });
    expect((await capsOf(m.tenantId)).length).toBeGreaterThan(0);
  });

  it("cobro del servicio externo y renovación del SaaS: cada pago a lo suyo; webhooks repetidos no duplican", async () => {
    clock = madrid(2026, 11, 1);
    let mark = gw.events.length;
    const nov = gw.chargeServicePeriod(m.extSubId, sec(madrid(2026, 11, 1)), sec(madrid(2026, 12, 1)), "paid");
    await deliverSince(mark);
    expect(await extOf(m.extId)).toMatchObject({ status: "active", lastInvoiceId: nov, lastInvoiceStatus: "paid" });
    expect((await orderOf(m.orderId)).payments).toHaveLength(1);
    // Renovación del SaaS un mes después
    clock = Date.UTC(2026, 10, 28, 9);
    const sub = gw.subscriptions.get(m.saasSubId)!;
    mark = gw.events.length;
    const start = sec(clock);
    const inv = gw.addInvoice(m.saasSubId, sub.customerId, "subscription_cycle", "paid", 2900);
    gw.updateSubscription(m.saasSubId, { status: "active", currentPeriodStart: start, currentPeriodEnd: start + 30 * 86_400 });
    gw.emit("invoice.paid", "invoice", inv);
    gw.emit("customer.subscription.updated", "subscription", m.saasSubId);
    await deliverSince(mark);
    const pays = (await orderOf(m.orderId)).payments;
    expect(pays).toHaveLength(2);
    expect(pays).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "renewal", status: "succeeded", providerRef: inv })]));
    expect(await extOf(m.extId)).toMatchObject({ lastInvoiceId: nov });
    // Webhooks repetidos
    const evs = await count("SELECT COUNT(*) AS n FROM external_subscription_events WHERE external_id = ?", [m.extId]);
    await deliverSince(0);
    expect((await orderOf(m.orderId)).payments).toHaveLength(2);
    expect(await count("SELECT COUNT(*) AS n FROM external_subscription_events WHERE external_id = ?", [m.extId])).toBe(evs);
    expect(await count("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [m.companyId])).toBe(1);
  });

  it("impagos cruzados: el del servicio externo no suspende la plataforma y el de la plataforma no toca el servicio", async () => {
    // Servicio externo impagado
    clock = madrid(2026, 12, 1);
    let mark = gw.events.length;
    const dec = gw.chargeServicePeriod(m.extSubId, sec(madrid(2026, 12, 1)), sec(madrid(2027, 1, 1)), "open");
    await deliverSince(mark);
    expect(await extOf(m.extId)).toMatchObject({ status: "past_due", lastInvoiceId: dec });
    expect((await orderOf(m.orderId)).order.state).toBe("active");
    expect((await registry.getTenant(m.tenantId))?.status).toBe("active");
    expect((await capsOf(m.tenantId)).length).toBeGreaterThan(0);
    mark = gw.events.length;
    gw.recoverServiceInvoice(dec);
    await deliverSince(mark);
    expect(await extOf(m.extId)).toMatchObject({ status: "active", graceUntil: null });
    // Plataforma impagada
    clock = Date.UTC(2026, 11, 28, 9);
    const sub = gw.subscriptions.get(m.saasSubId)!;
    const evs = await count("SELECT COUNT(*) AS n FROM external_subscription_events WHERE external_id = ?", [m.extId]);
    mark = gw.events.length;
    const start = sec(clock);
    const inv = gw.addInvoice(m.saasSubId, sub.customerId, "subscription_cycle", "open", 2900);
    gw.updateSubscription(m.saasSubId, { status: "past_due", currentPeriodStart: start, currentPeriodEnd: start + 30 * 86_400 });
    gw.emit("invoice.payment_failed", "invoice", inv);
    gw.emit("customer.subscription.updated", "subscription", m.saasSubId);
    await deliverSince(mark);
    expect((await orderOf(m.orderId)).order.state).toBe("past_due");
    expect((await registry.getTenant(m.tenantId))?.status).toBe("grace");
    expect(await extOf(m.extId)).toMatchObject({ status: "active" });
    expect(await count("SELECT COUNT(*) AS n FROM external_subscription_events WHERE external_id = ?", [m.extId])).toBe(evs);
    // Recuperación
    mark = gw.events.length;
    const paid = gw.invoices.get(inv)!;
    gw.invoices.set(inv, { ...paid, status: "paid", amountPaid: paid.total ?? 2900 });
    gw.updateSubscription(m.saasSubId, { status: "active" });
    gw.emit("invoice.paid", "invoice", inv);
    gw.emit("customer.subscription.updated", "subscription", m.saasSubId);
    await deliverSince(mark);
    expect((await orderOf(m.orderId)).order.state).toBe("active");
    expect((await registry.getTenant(m.tenantId))?.status).toBe("active");
  });

  it("baja del servicio externo: la plataforma SaaS queda intacta y la empresa sigue siendo una", async () => {
    const pays = (await orderOf(m.orderId)).payments.length;
    const capsBefore = await capsOf(m.tenantId);
    const mark = gw.events.length;
    gw.updateSubscription(m.extSubId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", m.extSubId);
    await deliverSince(mark);
    expect(await extOf(m.extId)).toMatchObject({ status: "canceled" });
    expect((await orderOf(m.orderId)).order.state).toBe("active");
    expect((await subsStore.get(m.internalSubId))!.status).toBe("active");
    expect(await capsOf(m.tenantId)).toEqual(capsBefore);
    expect((await orderOf(m.orderId)).payments).toHaveLength(pays);
    expect(await count("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [m.companyId])).toBe(1);
    expect((await crmStore.get("companies", m.companyId))!.tenantId).toBe(m.tenantId);
    expect(((await crmStore.get("contracts", m.extContractId)) as { conditions: string }).conditions).toContain("1.210,00");
    await deliverSince(0);
    expect(await extOf(m.extId)).toMatchObject({ status: "canceled" });
  });
});
