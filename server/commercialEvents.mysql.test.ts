/**
 * Registro de eventos comerciales contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada
 * creada y borrada aquí): circuito completo de contratación y de conversión de una prueba con el registro
 * conectado a los almacenes reales, entregas simultáneas del mismo pago, atomicidad (si el registro falla,
 * el cambio de estado no se guarda), duplicados, separación de entornos y migración 0014 de ida y vuelta.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { CrmService } from "./crm/service";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { ShadowBillingService } from "./subscriptions/shadow";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { LicensingService } from "./licensing/service";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { MysqlTrialStore } from "./trials/store";
import { TrialService } from "./trials/service";
import { CommercialOrchestrator } from "./orchestrator/service";
import { MysqlOrderStore } from "./orchestrator/store";
import { SignedTestProvider } from "./orchestrator/payments";
import { MysqlStripeStore } from "./stripe/store";
import { MysqlCommercialEventLog, commercialEventsProblem } from "./commercialEvents/log";
import { withCommercialCause } from "./commercialEvents/context";
import type { CommercialEventSink } from "./commercialEvents/types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "commercial_events_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const actor = "operator:mysql";
const key = () => crypto.randomBytes(12).toString("hex");

describe.skipIf(!URL_)("registro de eventos comerciales con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let log: MysqlCommercialEventLog;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let subs: SubscriptionService;
  let trials: TrialService;
  let caps: MemoryCapabilityStore;
  const provider = new SignedTestProvider({ webhookSecret: SECRET });
  let clock = Date.UTC(2026, 9, 19, 9);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 10 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(DIR);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    log = new MysqlCommercialEventLog(pool, "test");
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    crmStore = new MysqlCrmStore(pool);
    const platform = { activate: async (i: { company: { id: number; tenantId: string | null } }) => ({ tenantId: i.company.tenantId ?? `t-ev-${i.company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: platform, now: () => clock });
    const subsStore = new MysqlSubscriptionStore(pool, log);
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    trials = new TrialService({ store: new MysqlTrialStore(pool, log), subscriptions: subsStore, now: () => clock, limits: { perIp24h: 100, perDomain30d: 100 } });
    caps = new MemoryCapabilityStore();
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    svc = new CommercialOrchestrator({
      store: new MysqlOrderStore(pool, log),
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => quote(await site(), r),
      licensing: new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock }),
      capabilities: caps,
      platform,
      trials,
      payments: provider,
      now: () => clock,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const company = async (name: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@c${c.id}.example` }, actor);
    return c.id;
  };
  const event = (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, id: string) => {
    const body = JSON.stringify({ id, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };
  const rows = async (sql: string, args: unknown[] = []) => (await pool.query<mysql.RowDataPacket[]>(sql, args))[0];

  it("contratación completa con cinco entregas simultáneas del mismo pago: cada hecho una vez, en orden y con su transición", async () => {
    const cid = await company("Eventos MySQL SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "firma-mysql", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    await withCommercialCause({ source: "system", causationId: "pruebas:evt_ev_unico" }, () => Promise.all(Array.from({ length: 5 }, () => event(payment, "evt_ev_unico"))));
    const done = await svc.must(o.id);
    expect(done.state).toBe("active");

    const ev = await log.list({ correlationId: `order:${o.id}` });
    expect(ev.map((e) => e.type)).toEqual([
      "order.created",
      "order.quoted",
      "order.contracted",
      "payment.requested",
      "payment.succeeded",
      "order.confirmed",
      "order.subscribed",
      "order.licensed",
      "order.activated",
    ]);
    // Las versiones del pedido avanzan sin huecos entre sus eventos de estado (las notas también suben versión)
    const versions = ev.filter((e) => e.aggregate.type === "order").map((e) => e.aggregate.version!);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(ev.find((e) => e.type === "payment.succeeded")).toMatchObject({ paymentId: payment.id, fromState: "pending", toState: "succeeded", causationId: "pruebas:evt_ev_unico", companyId: cid });
    expect(ev.find((e) => e.type === "order.activated")).toMatchObject({ subscriptionId: done.subscriptionId, tenantId: done.tenantId, data: { kind: "new", plan: "essential", interval: "month", items: [] } });
    // La suscripción creada en la activación queda en su propia correlación, enlazada por el id
    expect((await log.list({ subscriptionId: done.subscriptionId! })).map((e) => e.type)).toContain("subscription.created");
    const [dups] = await pool.query<mysql.RowDataPacket[]>("SELECT event_key, COUNT(*) AS n FROM commercial_events GROUP BY event_key HAVING n > 1");
    expect(dups).toHaveLength(0);
    // Ningún dato personal (correo o nombre del contacto, nombre de la empresa)
    const all = JSON.stringify(await rows("SELECT * FROM commercial_events"));
    expect(all).not.toMatch(/@|Ana Ensayo|Eventos MySQL/);
  });

  it("prueba Essential → Business: prueba, suscripción y pedido quedan trazados", async () => {
    const reg = await trials.register({ email: "olga@abeto.example", companyName: "Abeto Eventos SL", configuration: { plan: "essential", addons: [] }, idempotencyKey: key() });
    const v = await trials.verify(reg.trial.id, reg.verificationToken!);
    const p = await trials.requestProvisioning(v.id, v.version, actor);
    const t = await trials.markProvisioned(p.id, p.version, "t-abeto-ev", actor);
    const c = await crm.createCompany({ name: "Abeto Eventos SL", email: "olga@abeto.example" }, actor);
    await crmStore.update("companies", c.id, { tenantId: t.tenantId });
    const priceOf = async (k: string) => (await catalogFromWebStore(new MysqlWebStore(pool)).offer()).find((x) => x.key === k)!.prices.find((x) => x.kind === "monthly")!.id;
    const trialSub = await subs.create({ companyId: c.id, tenantId: t.tenantId, interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: await priceOf("essential") } }, actor);
    await caps.apply(t.tenantId!, capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: clock + 15 * 86_400_000, source: `subscription:${trialSub.id}` })), { actor, reason: "Prueba", now: clock });
    clock += 3 * 86_400_000;
    const o = (await svc.create({ idempotencyKey: key(), trialId: t.id, request: { plan: "business", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "aceptacion-abeto", approvalReason: "Aprobado por producto" }, actor);
    const { payment } = await svc.requestPayment(o.id, actor);
    await event(payment, "evt_ev_abeto");
    expect((await svc.must(o.id)).state).toBe("active");

    expect((await log.list({ trialId: t.id })).map((e) => e.type)).toEqual(["trial.requested", "trial.verified", "trial.started", "order.created", "order.quoted", "order.contracted", "payment.requested", "payment.succeeded", "order.confirmed", "order.subscribed", "order.licensed", "trial.converted", "order.activated"]);
    expect((await log.list({ subscriptionId: trialSub.id, types: ["subscription.created", "subscription.trial_converted"] })).map((e) => [e.type, e.fromState, e.toState])).toEqual([
      ["subscription.created", null, "trialing"],
      ["subscription.trial_converted", "trialing", "active"],
    ]);
    expect(JSON.stringify(await log.list({ trialId: t.id }))).not.toMatch(/abeto\.example|Abeto Eventos/);
  });

  it("si el registro falla, el cambio de estado no se guarda (misma transacción)", async () => {
    const failing: CommercialEventSink = {
      environment: "test",
      append: async (tx) => {
        await tx!.query("SELECT 1");
        throw new Error("registro caído");
      },
    };
    const cid = await company("Atómica SL");
    const ok = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    const history = (await rows("SELECT kind FROM commercial_order_events WHERE order_id = ?", [ok.id])).map((r) => r.kind);
    const logged = await log.list({ orderId: ok.id });
    const broken = new MysqlOrderStore(pool, failing);
    await expect(broken.transition(ok.id, ok.version, { state: "rejected" }, { kind: "reject", detail: null, actor, at: clock })).rejects.toThrow(/registro caído/);
    expect(await svc.must(ok.id)).toMatchObject({ state: ok.state, version: ok.version });
    expect((await rows("SELECT kind FROM commercial_order_events WHERE order_id = ?", [ok.id])).map((r) => r.kind)).toEqual(history);
    expect(await log.list({ orderId: ok.id })).toEqual(logged);
    await expect(broken.insertPayment({ orderId: ok.id, idempotencyKey: `x-${key()}`, purpose: "initial", periodStart: null, amountCents: 1, currency: "EUR", status: "pending", provider: "simulated", mode: "test", providerRef: null, dueAt: null, createdAt: clock, settledAt: null })).rejects.toThrow(/registro caído/);
    expect(await rows("SELECT id FROM commercial_payments WHERE order_id = ?", [ok.id])).toHaveLength(0);
  });

  it("un hecho ya registrado no se duplica ni deshace la transacción que lo repite", async () => {
    const cid = await company("Duplicada SL");
    const o = (await svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    // Alguien (p. ej. otra réplica) ya dejó el hecho de la próxima transición con la misma clave
    const next = `order:${o.id}:v${o.version + 1}:quote`;
    await pool.query("INSERT INTO commercial_events (event_key, type, schema_version, environment, source, actor, correlation_id, aggregate_type, aggregate_id, aggregate_version, occurred_at) VALUES (?, 'order.quoted', 1, 'test', 'system', 'x', ?, 'order', ?, ?, ?)", [next, `order:${o.id}`, String(o.id), o.version + 1, clock]);
    const store = new MysqlOrderStore(pool, log);
    const q = await store.transition(o.id, o.version, { state: "quoted" }, { kind: "quote", detail: null, actor, at: clock });
    expect(q.state).toBe("quoted");
    expect(await rows("SELECT id FROM commercial_events WHERE event_key = ?", [next])).toHaveLength(1);
  });

  it("cargos de Stripe: reembolso y pérdida de cobertura con el tenant del pedido, en la transacción del ajuste", async () => {
    const [o] = await rows("SELECT id, company_id, tenant_id, subscription_id FROM commercial_orders WHERE state = 'active' ORDER BY id LIMIT 1");
    const stripe = new MysqlStripeStore(pool, "test", log);
    const a = { chargeId: "ch_ev_1", invoiceId: "in_ev_1", subscriptionId: "sub_ev_1", orderId: Number(o.id), companyId: Number(o.company_id), amountCents: 3509, currency: "eur", disputeStatus: null, coverageLost: false };
    await stripe.upsertAdjustment({ ...a, amountRefundedCents: 3509, coverageLost: true }, clock);
    await stripe.upsertAdjustment({ ...a, amountRefundedCents: 3509, coverageLost: true }, clock + 1);
    const ev = await log.list({ orderId: Number(o.id), types: ["refund.recorded", "coverage.lost"] });
    expect(ev.map((e) => e.type)).toEqual(["refund.recorded", "coverage.lost"]);
    expect(ev[0]).toMatchObject({ tenantId: o.tenant_id, subscriptionId: Number(o.subscription_id), stripeRef: "ch_ev_1", source: "stripe", data: { full: true, amountRefundedCents: 3509 } });
  });

  it("entornos separados: un registro live no ve las filas de pruebas y no se monta sobre esta BD", async () => {
    expect(await commercialEventsProblem(pool, "test")).toBeNull();
    expect(await commercialEventsProblem(pool, "live")).toBe("environment_mismatch");
    expect(await new MysqlCommercialEventLog(pool, "live").list({ companyId: 1 })).toEqual([]);
    await expect(pool.query("INSERT INTO commercial_events (event_key, type, schema_version, environment, source, actor, correlation_id, aggregate_type, aggregate_id, occurred_at) VALUES ('x', 't', 1, 'otro', 'system', 'x', 'c', 'order', '1', 1)")).rejects.toThrow();
  });

  it("la migración 0014 se revierte y se vuelve a aplicar; sin la tabla el registro no se monta", async () => {
    const m = loadMigrations(DIR).migrations.find((x) => x.id === "0014_commercial_events")!;
    for (const s of splitStatements(m.down!)) await pool.query(s);
    expect(await rows("SHOW TABLES LIKE 'commercial_events'")).toHaveLength(0);
    expect(await commercialEventsProblem(pool, "test")).toBe("missing_table");
    // Los datos de negocio siguen ahí
    expect((await rows("SELECT COUNT(*) AS n FROM commercial_orders"))[0].n).toBeGreaterThan(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await commercialEventsProblem(pool, "test")).toBeNull();
  });
});
