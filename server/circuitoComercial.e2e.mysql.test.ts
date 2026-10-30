/**
 * Circuito comercial de punta a punta (fase H, PR 9) por HTTP con la aplicación REAL del plano de control sobre
 * MySQL desechable (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con las migraciones del CRM hasta la 0019,
 * creada y borrada aquí). Almacenes MySQL de CRM, catálogo, suscripciones, pedidos, Stripe, cambios de partidas,
 * líneas de factura, registro de eventos comerciales y bandeja de correo. Stripe es un doble (sin red) y la firma
 * de los webhooks es la REAL del SDK. Nada sale a la red: el correo va a un proveedor en memoria.
 *
 *   1. cliente nuevo            Checkout → webhook → empresa, suscripción, licencias, factura y documento fiscal
 *   2. pago fallido             renovación impagada → gracia → cobro → al corriente
 *   3. módulos                  compra, ampliación con prorrateo, cobro fallido que caduca, baja a fin de periodo
 *   4. cancelación              baja en Stripe → fin → solo lectura 30 días (la exportación se prueba en el Core)
 *   5. ataques multiempresa     tokens, permisos, tenant ajeno, campos de importe y claves reutilizadas
 *   6. webhooks                 duplicados, fuera de orden, firma no válida, objeto de otro entorno, reintento
 *   7. facturación              líneas de factura, reembolso parcial repartido, rectificativa pendiente
 *   8. correos                  despachador → bandeja de salida: plantillas del catálogo, sin duplicados
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
import { mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService } from "./mail/service";
import { MysqlMailStore } from "./mail/store";
import { PlatformMailer } from "./mail/platform";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "circuito_comercial_e2e";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const ADMIN = "circuito-admin-token-aaaaaaaaaaaaaaaaaaaaa";
const CORE = "circuito-core-token-bbbbbbbbbbbbbbbbbbbbbb";
const OPS_ONLY = "circuito-ops-token-cccccccccccccccccccccc";
const FOR_SALE = ["connect-people", "addon-user-essential"];
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: ["whsec", "e".repeat(32)].join("_"), apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax", billingMode: "classic" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

describe.skipIf(!URL_)("circuito comercial de punta a punta (MySQL real, Stripe simulado)", { timeout: 60_000 }, () => {
  let clock = Date.UTC(2026, 9, 20, 9);
  const START = clock;
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let server: http.Server;
  let port = 0;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let subsStore: MysqlSubscriptionStore;
  let orders: MysqlOrderStore;
  let stripeStore: MysqlStripeStore;
  let invoiceLines: MysqlInvoiceLineStore;
  let mailStore: MysqlMailStore;
  const caps = new MemoryCapabilityStore();
  const limits = new MemoryTenantLimitStore();
  const gw = new FakeStripeGateway();
  const provider = memoryProvider();

  type Res = { status: number; json: any; raw: string };
  const call = (method: string, p: string, o: { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
    new Promise<Res>((resolve, reject) => {
      const data = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
      const token = o.token === undefined ? ADMIN : o.token;
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${p}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) } },
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
  const rawEvent = (ev: GwEvent, livemode = false) => JSON.stringify({ id: ev.id, object: "event", type: ev.type, created: Math.floor(Date.now() / 1000), livemode, api_version: ev.apiVersion, data: { object: { id: ev.objectId, object: ev.objectType } } });
  const signed = (raw: string, secret = config.webhookSecret) => call("POST", "/stripe/webhook", { token: null, raw, headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload: raw, secret }) } });
  const webhook = (ev: GwEvent) => signed(rawEvent(ev));
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
  const order = async (id: number) => (await ok(call("GET", `/orders/${id}`))) as { order: { state: string; tenantId: string; kind: string }; payments: Array<{ purpose: string; status: string; providerRef: string }> };
  const capsOf = async (t: string) => (await caps.list(t)).filter((g) => g.status === "active").map((g) => g.capabilityId);
  const buy = (t: string, body: Record<string, unknown>, token: string | null = CORE) => call("POST", `/commerce/tenants/${t}/purchases`, { token, body: { idempotencyKey: key(), buyer: "user:1", ...body } });
  const reduce = (t: string, body: Record<string, unknown>) => call("POST", `/commerce/tenants/${t}/reductions`, { token: CORE, body: { idempotencyKey: key(), buyer: "user:1", ...body } });

  async function newCustomer(name: string) {
    const c = await crm.createCompany({ name }, "operator:e2e");
    await crm.createContact(c.id, { name: "Ana", email: `ana@c${c.id}.example`, isPrimary: true }, "operator:e2e");
    const created = await ok(call("POST", "/orders", { body: { idempotencyKey: key(), companyId: c.id, request: { plan: "essential", interval: "month", items: [] } } }), 201);
    await ok(call("POST", `/orders/${created.order.id}/accept`, { body: { signatureRef: `firma-${c.id}`, approvalReason: "Aprobado para el ensayo de punta a punta" } }), [200, 202]);
    const s = await ok(call("POST", `/stripe/orders/${created.order.id}/checkout`));
    const mark = gw.events.length;
    gw.completeSession(s.sessionId);
    await deliverSince(mark);
    await until(async () => (await order(created.order.id)).order.state === "active");
    const o = await order(created.order.id);
    const subId = gw.sessions.get(s.sessionId)!.subscriptionId!;
    return { orderId: created.order.id as number, companyId: c.id, tenantId: o.order.tenantId, subId, customerId: gw.subscriptions.get(subId)!.customerId, email: `ana@c${c.id}.example` };
  }
  /** Stripe renueva: periodo nuevo y factura con el estado indicado. */
  async function cycle(a: { subId: string; customerId: string }, status: "paid" | "open") {
    const s = gw.subscriptions.get(a.subId)!;
    const end = s.currentPeriodEnd!;
    // Pasado el fin del periodo de Stripe y del interno (pueden diferir unas horas)
    clock = Math.max(clock, end * 1000) + 5 * 86_400_000;
    gw.updateSubscription(a.subId, { currentPeriodStart: end, currentPeriodEnd: end + 30 * 86_400, status: status === "paid" ? "active" : "past_due" });
    const mark = gw.events.length;
    const inv = gw.addInvoice(a.subId, a.customerId, "subscription_cycle", status, 2900);
    gw.emit(status === "paid" ? "invoice.paid" : "invoice.payment_failed", "invoice", inv);
    gw.emit("customer.subscription.updated", "subscription", a.subId);
    await deliverSince(mark);
    return inv;
  }

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
    expect(migrations.map((m) => m.id).slice(-7)).toEqual(["0026_external_services", "0027_invoicing", "0028_billing_charges", "0029_charge_payments", "0030_admin_alerts", "0031_comms_consent", "0032_data_requests"]);
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);

    const log = new MysqlCommercialEventLog(pool, "test");
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    for (const k of FOR_SALE) {
      const { entry: e } = await web.get("product", k);
      const draft = structuredClone(e.draft) as { technicalStatus?: string; catalog?: Record<string, unknown> };
      draft.technicalStatus = "available";
      draft.catalog = { ...(draft.catalog ?? {}), commercialStatus: "available" };
      const saved = await web.save("product", k, { draft, expectedVersion: e.draftVersion }, "operator:e2e");
      await web.publish("product", k, saved.draftVersion, "operator:e2e");
    }
    crmStore = new MysqlCrmStore(pool);
    subsStore = new MysqlSubscriptionStore(pool, log);
    orders = new MysqlOrderStore(pool, log);
    stripeStore = new MysqlStripeStore(pool, "test", log);
    invoiceLines = new MysqlInvoiceLineStore(pool, "test");
    mailStore = new MysqlMailStore(pool);
    const desired = await desiredCatalog(catalogFromWebStore(webStore));
    for (const op of (await planCatalogWrites(desired, gw)).operations) {
      if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
      else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
    }
    expect((await syncCatalog(desired, gw, stripeStore, clock)).linked).toHaveLength(4 + FOR_SALE.length);

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
    crm = new CrmService({ store: crmStore, activation: createContractActivation({ provisioning, platformDomain: "elephant.test", actor: { type: "operator", id: "e2e" } }), now: () => clock });
    const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SANDBOX_ALLOWLIST: "example" } as NodeJS.ProcessEnv);
    const mailer = new PlatformMailer(new MailService({ lane: "platform", store: mailStore, provider, policy, now: () => clock }), policy);
    const all = ["crm:read", "crm:write", "web:read", "provisioning:write", "subscriptions:read", "subscriptions:write", "entitlements:write", "tenants:read", "orders:read", "orders:write", "orders:approve", "billing:write", "ops:read", "ops:write"] as const;
    const app = createControlPlaneApp({
      tokens: [
        { id: "admin", sha256: hashToken(ADMIN), scopes: [...all] },
        { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] },
        { id: "ops", sha256: hashToken(OPS_ONLY), scopes: ["ops:read"] },
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
      trials: { store: new MysqlTrialStore(pool, log), publicEnabled: false, autoProvision: true, notify: mailer.trialNotifier() },
      orders: { store: orders, payments: null },
      commercialEvents: log,
      mail: { platform: mailer },
      notifications: { since: START },
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
        invoiceLines,
      },
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  }, 180_000);

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  let a: Awaited<ReturnType<typeof newCustomer>>;
  let b: Awaited<ReturnType<typeof newCustomer>>;

  it("1. cliente nuevo: Checkout → webhook firmado → empresa, suscripción, licencias, factura y documento fiscal", async () => {
    a = await newCustomer("Circuito A SL");
    b = await newCustomer("Circuito B SL");
    const o = await order(a.orderId);
    expect(o.payments).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded" })]);
    expect(await capsOf(a.tenantId)).not.toHaveLength(0);
    const inv = o.payments[0].providerRef;
    expect(await stripeStore.invoiceRecord(inv)).toMatchObject({ orderId: a.orderId, purpose: "initial", subtotalCents: 2900 });
    expect((await stripeStore.listFiscalDocuments({ orderId: a.orderId, limit: 10 })).map((d) => [d.kind, d.status])).toEqual([["invoice", "pending"]]);
  });

  it("2. pago fallido: renovación impagada → gracia; cobro posterior → al corriente", async () => {
    await cycle(b, "open");
    await until(async () => (await order(b.orderId)).order.state === "past_due");
    const s = gw.subscriptions.get(b.subId)!;
    gw.payInvoice(s.latestInvoiceId!);
    gw.updateSubscription(b.subId, { status: "active" });
    const mark = gw.events.length;
    gw.emit("customer.subscription.updated", "subscription", b.subId);
    await deliverSince(mark);
    await until(async () => (await order(b.orderId)).order.state === "active");
    expect(await capsOf(b.tenantId)).not.toHaveLength(0);
  });

  let purchaseOrder = 0;
  it("3. módulos: compra cobrada, ampliación con prorrateo, cobro fallido que caduca y baja a fin de periodo", async () => {
    // El reloj ya pasó el fin del periodo de A sin aplicar su renovación: no se cobra nada (se concedería tarde)
    const invoicesBefore = gw.invoices.size;
    const early = await buy(a.tenantId, { add: ["connect-people"] });
    expect(early.status).toBe(409);
    expect(early.json.message).toMatch(/renovación/);
    expect(gw.invoices.size).toBe(invoicesBefore);
    await cycle(a, "paid");
    const r = await ok(buy(a.tenantId, { add: ["connect-people"] }), 201);
    expect(r.purchase.status).toBe("applied");
    purchaseOrder = r.purchase.orderId;
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    expect((await ok(buy(a.tenantId, { users: 5 }), 201)).purchase.status).toBe("applied");
    // Cobro fallido: nada concedido; Stripe lo descarta → pedido rechazado (MySQL: un solo pendiente)
    gw.paymentOutcome.set(a.customerId, "fail");
    const pend = await ok(buy(a.tenantId, { users: 7 }), 201);
    expect(pend.purchase.status).toBe("payment_pending");
    expect((await buy(a.tenantId, { users: 8 })).status).toBe(409);
    const mark = gw.events.length;
    gw.expirePendingUpdate(a.subId);
    await deliverSince(mark);
    await until(async () => (await order(pend.purchase.orderId)).order.state === "rejected");
    gw.paymentOutcome.delete(a.customerId);
    // Baja del módulo a fin de periodo: sigue activo hasta la renovación
    expect((await ok(reduce(a.tenantId, { remove: ["connect-people"] }), 201)).reduction.status).toBe("applied");
    expect(await capsOf(a.tenantId)).toContain("people-hr");
    await cycle(a, "paid");
    expect(await capsOf(a.tenantId)).not.toContain("people-hr");
  });

  it("4. cancelación: baja programada en Stripe → fin → solo lectura de 30 días (sin borrar nada)", async () => {
    const mark = gw.events.length;
    gw.updateSubscription(b.subId, { cancelAtPeriodEnd: true });
    gw.emit("customer.subscription.updated", "subscription", b.subId);
    await deliverSince(mark);
    await until(async () => (await order(b.orderId)).order.state === "cancel_scheduled");
    const end = gw.subscriptions.get(b.subId)!.currentPeriodEnd!;
    clock = end * 1000 + 3_600_000;
    const mark2 = gw.events.length;
    gw.updateSubscription(b.subId, { status: "canceled" });
    gw.emit("customer.subscription.deleted", "subscription", b.subId);
    await deliverSince(mark2);
    await until(async () => (await order(b.orderId)).order.state === "cancelled");
    const grants = await caps.list(b.tenantId);
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((g) => g.status === "read_only")).toBe(true);
    // Una empresa dada de baja no compra
    expect((await buy(b.tenantId, { add: ["connect-people"] })).status).toBe(409);
  });

  it("5. ataques multiempresa: tokens, permisos, empresa ajena, importes del navegador y claves reutilizadas", async () => {
    expect((await buy(a.tenantId, { add: ["connect-people"] }, null)).status).toBe(401);
    expect((await buy(a.tenantId, { add: ["connect-people"] }, ADMIN)).status).toBe(403);
    expect((await buy(a.tenantId, { add: ["connect-people"] }, OPS_ONLY)).status).toBe(403);
    expect((await call("GET", "/orders", { token: CORE })).status).toBe(403);
    expect((await call("GET", `/commerce/tenants/${b.tenantId}/purchases/${purchaseOrder}`, { token: CORE })).status).toBe(404);
    expect((await buy(a.tenantId, { add: ["connect-people"], amountCents: 1, tenantId: b.tenantId })).status).toBe(400);
    expect([400, 404]).toContain((await buy("../../orders", { add: ["connect-people"] })).status);
    // La clave de A no sirve para leer ni repetir nada en B
    const idem = key();
    const c = await newCustomer("Circuito C SL");
    const ra = await ok(buy(a.tenantId, { idempotencyKey: idem, users: 6 }), 201);
    const rc = await ok(buy(c.tenantId, { idempotencyKey: idem, users: 4 }), 201);
    expect(rc.purchase.orderId).not.toBe(ra.purchase.orderId);
    expect((await order(rc.purchase.orderId)).order.tenantId).toBe(c.tenantId);
  });

  it("6. webhooks: duplicado, fuera de orden, firma no válida, otro entorno y reintento tras una caída", async () => {
    const before = (await order(a.orderId)).payments.length;
    const last = gw.events[0];
    await ok(webhook(last));
    await settled();
    expect(await ok(webhook(last))).toMatchObject({ duplicate: true });
    // Firma de otro secreto: rechazado y nada registrado
    const fake = { ...last, id: "evt_test_firma_falsa_0001" };
    expect((await signed(rawEvent(fake), ["whsec", "z".repeat(32)].join("_"))).status).toBe(400);
    expect(await stripeStore.event("evt_test_firma_falsa_0001")).toBeNull();
    // Evento live en un entorno de pruebas: rechazado
    expect((await signed(rawEvent({ ...last, id: "evt_live_ajeno_0000000001" }, true))).status).toBeGreaterThanOrEqual(400);
    // Fuera de orden: la suscripción se relee siempre (el estado actual manda)
    const mark = gw.events.length;
    const older = gw.emit("customer.subscription.updated", "subscription", a.subId, 1);
    await deliverSince(mark);
    expect(older.created).toBe(1);
    expect((await order(a.orderId)).payments.length).toBe(before);
    // Stripe caído al procesar: se reintenta más tarde sin perder el evento
    gw.down = true;
    const ev = gw.emit("customer.subscription.updated", "subscription", a.subId);
    try {
      await ok(webhook(ev));
      // Falla al releer Stripe: queda «failed» con reintento programado (nunca se pierde)
      await until(async () => (await stripeStore.event(ev.id))?.status === "failed");
    } finally {
      gw.down = false;
    }
    // Reintento automático: pasada la espera, cualquier entrega nueva pone a procesar lo vencido
    clock += 5 * 60_000;
    await ok(webhook(gw.emit("customer.subscription.updated", "subscription", b.subId)));
    await until(async () => (await stripeStore.event(ev.id))?.status === "processed");
  }, 60_000);

  it("7. facturación: líneas de la factura de una compra; reembolso parcial repartido y rectificativa pendiente", async () => {
    const p = await order(purchaseOrder);
    const inv = p.payments.find((x) => x.purpose === "change")!.providerRef;
    const lines = await invoiceLines.linesOf(inv);
    expect(lines).toEqual([expect.objectContaining({ productKey: "connect-people", proration: true, refundedCents: 0 })]);
    const ch = gw.chargeForInvoice(inv);
    gw.refund(ch, 250);
    const mark = gw.events.length;
    gw.emit("charge.refunded", "charge", ch);
    await deliverSince(mark);
    expect((await invoiceLines.linesOf(inv))[0].refundedCents).toBe(250);
    const docs = await stripeStore.listFiscalDocuments({ orderId: purchaseOrder, limit: 10 });
    expect(docs.map((d) => [d.kind, d.totalCents, d.status])).toEqual(expect.arrayContaining([["rectification", -250, "pending"]]));
    expect(docs.every((d) => d.externalRef === null)).toBe(true);
  });

  it("8. correos: el despachador encola las plantillas del catálogo en la bandeja de salida, una vez", async () => {
    // Cada pasada atiende hasta 100 eventos: se repite hasta vaciar la cola (lo que hará la tarea periódica)
    const r = { done: 0, skipped: 0, dead: 0 };
    for (let i = 0; i < 20; i++) {
      const x = await ok(call("POST", "/notifications/dispatch"));
      r.done += x.done;
      r.skipped += x.skipped;
      r.dead += x.dead;
      if (x.done + x.skipped + x.retried + x.dead === 0) break;
    }
    expect(r.done).toBeGreaterThan(0);
    expect(r.dead).toBe(0);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT category, idempotency_key, status FROM mail_outbox WHERE idempotency_key LIKE 'notif:%' ORDER BY id");
    const cats = rows.map((x) => String(x.category));
    expect(cats).toEqual(expect.arrayContaining(["module_activated", "module_change", "access_read_only", "refund_recorded"]));
    expect(new Set(rows.map((x) => x.idempotency_key)).size).toBe(rows.length);
    // Otra pasada: nada nuevo
    const again = await ok(call("POST", "/notifications/dispatch"));
    expect(again.done).toBe(0);
    const [rows2] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM mail_outbox WHERE idempotency_key LIKE 'notif:%'");
    expect(Number(rows2[0].n)).toBe(rows.length);
    // Sin secretos ni enlaces de recuperación en lo que salió
    expect(provider.sent.map((m) => `${m.subject} ${m.text ?? ""}`).join("\n")).not.toMatch(/establecer-contrasena|token=/);
  });
});
