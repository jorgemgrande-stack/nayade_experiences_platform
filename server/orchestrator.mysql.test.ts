/**
 * Orquestador comercial contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y
 * borrada aquí): migración 0010 (ida, vuelta y otra vez ida), unicidad en la BD (clave, pedido abierto
 * por empresa) con altas simultáneas, eventos de pago simultáneos aplicados una sola vez y conversión
 * de una prueba en suscripción de pago sobre las tablas reales del CRM, suscripciones y pruebas.
 * Las licencias por capacidad (BD del registro) van en memoria.
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

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "orders_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const actor = "operator:mysql";
const key = () => crypto.randomBytes(12).toString("hex");

/** Reversión en la BD de prueba: la de la migración o, si es irreversible a propósito (p. ej. 0027, facturas), quitar lo que crea. */
const downOf = (m: { up: string; down: string | null }) => m.down ?? Array.from(m.up.matchAll(/CREATE TABLE\s+`?(\w+)`?/gi)).map((x) => `DROP TABLE IF EXISTS ${x[1]};`).reverse().join("\n");

describe.skipIf(!URL_)("orquestador comercial con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let subs: SubscriptionService;
  let trials: TrialService;
  let caps: MemoryCapabilityStore;
  const provider = new SignedTestProvider({ webhookSecret: SECRET });
  let clock = Date.UTC(2026, 9, 16, 9);

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
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    crmStore = new MysqlCrmStore(pool);
    const platform = { activate: async (i: { company: { id: number; tenantId: string | null } }) => ({ tenantId: i.company.tenantId ?? `t-mysql-${i.company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: platform, now: () => clock });
    const subsStore = new MysqlSubscriptionStore(pool);
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    trials = new TrialService({ store: new MysqlTrialStore(pool), subscriptions: subsStore, now: () => clock, limits: { perIp24h: 100, perDomain30d: 100 } });
    caps = new MemoryCapabilityStore();
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    svc = new CommercialOrchestrator({
      store: new MysqlOrderStore(pool),
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
  const signed = async (companyId: number, plan = "essential") => {
    const o = (await svc.create({ idempotencyKey: key(), companyId, request: { plan, interval: "month", items: [] } }, actor)).order;
    return (await svc.accept(o.id, { signatureRef: "firma-mysql", approvalReason: "Aprobado por producto" }, actor)).order;
  };
  const event = (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, id: string) => {
    const body = JSON.stringify({ id, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };

  it("altas simultáneas: la misma clave crea un pedido; claves distintas para la misma empresa, solo uno abierto (la BD decide)", async () => {
    const cid = await company("Carrera MySQL SL");
    const k = key();
    const same = await Promise.all(Array.from({ length: 4 }, () => svc.create({ idempotencyKey: k, companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)));
    expect(new Set(same.map((x) => x.order.id)).size).toBe(1);
    expect(same.filter((x) => x.created)).toHaveLength(1);
    const other = await Promise.allSettled(Array.from({ length: 3 }, () => svc.create({ idempotencyKey: key(), companyId: cid, request: { plan: "essential", interval: "month", items: [] } }, actor)));
    expect(other.every((x) => x.status === "rejected" && (x.reason as { code: string }).code === "conflict")).toBe(true);
    const [n] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM commercial_orders WHERE company_id = ?", [cid]);
    expect(Number(n[0].n)).toBe(1);
  });

  it("cinco entregas simultáneas del mismo evento de pago: un solo efecto (pedido, suscripción, pago y evento)", async () => {
    const cid = await company("Pago MySQL SL");
    const o = await signed(cid);
    const { payment } = await svc.requestPayment(o.id, actor);
    const out = await Promise.all(Array.from({ length: 5 }, () => event(payment, "evt_mysql_unico")));
    expect(out.filter((x) => x.status === "processed")).toHaveLength(1);
    expect((await svc.must(o.id)).state).toBe("active");
    const [s] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?", [cid]);
    expect(Number(s[0].n)).toBe(1);
    const [p] = await pool.query<mysql.RowDataPacket[]>("SELECT status, mode FROM commercial_payments WHERE order_id = ?", [o.id]);
    expect(p.map((x) => `${x.status}/${x.mode}`)).toEqual(["succeeded/test"]);
    const [e] = await pool.query<mysql.RowDataPacket[]>("SELECT outcome FROM commercial_payment_events WHERE provider_event_id = 'evt_mysql_unico'");
    expect(e.map((x) => x.outcome)).toEqual(["applied"]);
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT kind, version FROM commercial_order_events WHERE order_id = ? ORDER BY id", [o.id]);
    expect(ev.map((x) => x.kind)).toEqual(["created", "quote", "contract_drafted", "sign", "payment_requested", "confirm", "subscribe", "license", "activate"]);
    expect(ev.map((x) => Number(x.version))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("la BD solo admite pagos de prueba o live (0013): ningún otro modo", async () => {
    const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM commercial_orders LIMIT 1");
    await expect(
      pool.query("INSERT INTO commercial_payments (order_id, idempotency_key, purpose, amount_cents, currency, status, provider, mode, created_at) VALUES (?, 'real-1', 'initial', 1, 'EUR', 'pending', 'x', 'otro', 1)", [r[0].id]),
    ).rejects.toThrow();
  });

  it("el almacén guarda y lee el modo del pago (live con el proveedor stripe); un modo desconocido se rechaza", async () => {
    const store = new MysqlOrderStore(pool);
    const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM commercial_orders LIMIT 1");
    const p = { orderId: Number(r[0].id), idempotencyKey: "stripe:inv:in_live_mysql_1", purpose: "initial" as const, periodStart: null, amountCents: 2900, currency: "EUR", status: "succeeded" as const, provider: "stripe", mode: "live" as const, providerRef: "in_live_mysql_1", dueAt: null, createdAt: clock, settledAt: clock };
    expect((await store.insertPayment(p)).payment).toMatchObject({ provider: "stripe", mode: "live" });
    expect(await store.paymentByKey(p.idempotencyKey)).toMatchObject({ mode: "live" });
    const [row] = await pool.query<mysql.RowDataPacket[]>("SELECT mode FROM commercial_payments WHERE idempotency_key = ?", [p.idempotencyKey]);
    expect(row[0].mode).toBe("live");
    await expect(store.insertPayment({ ...p, idempotencyKey: "stripe:inv:in_x_mysql_2", mode: "otro" as never })).rejects.toThrow(/Modo de pago/);
    await pool.query("DELETE FROM commercial_payments WHERE idempotency_key = ?", [p.idempotencyKey]);
  });

  it("prueba Essential → Business con pago de prueba: misma suscripción y plataforma, contrato enlazado en la BD", async () => {
    const reg = await trials.register({ email: "olga@abeto.example", companyName: "Abeto MySQL SL", configuration: { plan: "essential", addons: [] }, idempotencyKey: key() });
    const v = await trials.verify(reg.trial.id, reg.verificationToken!);
    const p = await trials.requestProvisioning(v.id, v.version, actor);
    const t = await trials.markProvisioned(p.id, p.version, "t-abeto-mysql", actor);
    const c = await crm.createCompany({ name: "Abeto MySQL SL", email: "olga@abeto.example" }, actor);
    await crmStore.update("companies", c.id, { tenantId: t.tenantId });
    const priceOf = async (k: string) => (await catalogFromWebStore(new MysqlWebStore(pool)).offer()).find((x) => x.key === k)!.prices.find((x) => x.kind === "monthly")!.id;
    const trialSub = await subs.create({ companyId: c.id, tenantId: t.tenantId, interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: await priceOf("essential") } }, actor);
    await caps.apply(t.tenantId!, capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: clock + 15 * 86_400_000, source: `subscription:${trialSub.id}` })), { actor, reason: "Prueba", now: clock });
    clock += 3 * 86_400_000;
    const o = (await svc.create({ idempotencyKey: key(), trialId: t.id, request: { plan: "business", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "aceptacion-abeto", approvalReason: "Aprobado por producto" }, actor);
    expect((await subs.must(trialSub.id)).status).toBe("trialing");
    const { payment } = await svc.requestPayment(o.id, actor);
    await event(payment, "evt_mysql_abeto");
    const done = await svc.must(o.id);
    expect(done).toMatchObject({ state: "active", subscriptionId: trialSub.id, tenantId: "t-abeto-mysql" });
    const [row] = await pool.query<mysql.RowDataPacket[]>("SELECT status, contract_id, trial_end FROM subscriptions WHERE id = ?", [trialSub.id]);
    expect(row[0]).toMatchObject({ status: "active", contract_id: done.contractId, trial_end: null });
    const [kinds] = await pool.query<mysql.RowDataPacket[]>("SELECT kind FROM subscription_events WHERE subscription_id = ? ORDER BY id", [trialSub.id]);
    expect(kinds.map((x) => x.kind)).toEqual(["created", "trial_converted"]);
    expect((await trials.must(t.id)).state).toBe("converted");
    const g = await caps.list("t-abeto-mysql");
    expect(g.filter((x) => x.status === "active" && x.validUntil === null).length).toBe(new Set([...capabilitiesOfTier("essential"), ...capabilitiesOfTier("business")]).size);
  });

  it("la migración 0010 se revierte y se vuelve a aplicar", async () => {
    const all = loadMigrations(DIR).migrations;
    const m = all.find((x) => x.id === "0010_commercial_orders")!;
    // Como el ejecutor (`down --steps`): las posteriores se revierten antes, en orden inverso
    const later = all.filter((x) => x.number > m.number);
    for (const l of [...later].reverse()) for (const s of splitStatements(downOf(l))) await pool.query(s);
    for (const s of splitStatements(downOf(m))) await pool.query(s);
    const [t] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'commercial%'");
    expect(t).toHaveLength(0);
    for (const s of splitStatements(m.up)) await pool.query(s);
    for (const l of later) for (const s of splitStatements(l.up)) await pool.query(s);
    const [t2] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'commercial%'");
    // Las 4 de 0010 y `commercial_events` (0015)
    expect(t2).toHaveLength(5);
  });
});
