/**
 * Recorrido comercial completo contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y
 * borrada aquí), con los almacenes reales, el registro de eventos comerciales, la sincronización del estado de
 * la empresa y el motor temporal en modo «apply»:
 *
 *   prueba gratuita → pedido de conversión → primer pago FALLIDO → reintento cobrado → suscripción y licencias
 *   activas → renovación con recibo impagado (gracia) → reintento fallido → pago → al corriente → cambio de plan
 *   pagado → cancelación → fin del periodo
 *
 * En cada paso: estado del pedido, de la suscripción, de las licencias y de la empresa, y el rastro en el registro
 * de eventos. Pagos solo de PRUEBA (proveedor simulado firmado); nada sale a la red.
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
import { TenantStatusSync } from "./orchestrator/tenantStatus";
import type { TenantStatus } from "./_core/tenantRegistry/contract";
import { assertTransition } from "./_core/tenantRegistry/lifecycle";
import { MysqlCommercialEventLog } from "./commercialEvents/log";
import { LifecycleEngine } from "./lifecycle/engine";
import { memoryLock } from "./trials/scheduler";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "commercial_journey_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const SECRET = "secreto-del-proveedor-de-pruebas-0123456789abcdef";
const DAY = 86_400_000;
const actor = "operator:recorrido";
const key = () => crypto.randomBytes(12).toString("hex");

describe.skipIf(!URL_)("recorrido comercial completo con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let log: MysqlCommercialEventLog;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let subs: SubscriptionService;
  let subsStore: MysqlSubscriptionStore;
  let orders: MysqlOrderStore;
  let trials: TrialService;
  let caps: MemoryCapabilityStore;
  let engine: LifecycleEngine;
  const provider = new SignedTestProvider({ webhookSecret: SECRET });
  // Registro de empresas en memoria con la misma tabla de transiciones que el real
  const registry = new Map<string, TenantStatus>();
  const registryAudit: string[] = [];
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
    const platform = { activate: async (i: { company: { id: number; tenantId: string | null } }) => ({ tenantId: i.company.tenantId ?? `t-rec-${i.company.id}` }) };
    crm = new CrmService({ store: crmStore, activation: platform, now: () => clock });
    subsStore = new MysqlSubscriptionStore(pool, log);
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    trials = new TrialService({ store: new MysqlTrialStore(pool, log), subscriptions: subsStore, now: () => clock, limits: { perIp24h: 100, perDomain30d: 100 } });
    caps = new MemoryCapabilityStore();
    orders = new MysqlOrderStore(pool, log);
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    const licensing = new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock });
    const tenantStatus = new TenantStatusSync({
      getTenant: async (id) => (registry.has(id) ? { id, status: registry.get(id)! } : null),
      setStatus: async (id, to, _a, o) => {
        const from = registry.get(id)!;
        if (from === to) return;
        assertTransition(from, to);
        registry.set(id, to);
        registryAudit.push(`${from}→${to}:${o.reason}`);
      },
      orders: (companyId) => orders.list({ companyId, limit: 1000 }),
      events: log,
      now: () => clock,
    });
    svc = new CommercialOrchestrator({
      store: orders,
      crm,
      crmStore,
      subscriptions: subs,
      subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog,
      quote: async (r) => quote(await site(), r),
      licensing,
      capabilities: caps,
      platform,
      trials,
      payments: provider,
      tenantStatus,
      now: () => clock,
    });
    engine = new LifecycleEngine({
      orders,
      subscriptions: subsStore,
      licensing,
      orchestrator: svc,
      trials: new MysqlTrialStore(pool),
      graceMs: 7 * DAY,
      policy: { mode: "apply", dunningDays: [0, 3, 6], trialNoticeDays: [7, 3, 1], retentionDays: 30 },
      lock: memoryLock(),
      now: () => clock,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const event = (p: { idempotencyKey: string; providerRef: string | null; amountCents: number; currency: string }, type: "payment.succeeded" | "payment.failed") => {
    const body = JSON.stringify({ id: `evt_${key()}`, type, paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
    return svc.handlePaymentEvent(body, provider.sign(body, Math.floor(clock / 1000)));
  };
  const types = async (f: Parameters<MysqlCommercialEventLog["list"]>[0]) => (await log.list({ ...f, limit: 1000 })).map((e) => e.type);
  const own = async (tenantId: string, subscriptionId: number) => (await caps.list(tenantId)).filter((g) => g.source === `subscription:${subscriptionId}`);

  it("prueba → pedido → pago fallido → reintento → activo → renovación impagada → recuperación → cambio de plan → cancelación → fin", async () => {
    // ── 1. Prueba gratuita de Essential ───────────────────────────────────────
    const reg = await trials.register({ email: "olga@abeto.example", companyName: "Abeto Recorrido SL", configuration: { plan: "essential", addons: [] }, idempotencyKey: key() });
    const v = await trials.verify(reg.trial.id, reg.verificationToken!);
    const p = await trials.requestProvisioning(v.id, v.version, actor);
    const t = await trials.markProvisioned(p.id, p.version, "t-abeto-recorrido", actor);
    const tenantId = t.tenantId!;
    registry.set(tenantId, "trial");
    const c = await crm.createCompany({ name: "Abeto Recorrido SL", email: "olga@abeto.example" }, actor);
    await crmStore.update("companies", c.id, { tenantId });
    const priceOf = async (k: string) => (await catalogFromWebStore(new MysqlWebStore(pool)).offer()).find((x) => x.key === k)!.prices.find((x) => x.kind === "monthly")!.id;
    const trialSub = await subs.create({ companyId: c.id, tenantId, interval: "month", trialDays: 15, plan: { productKey: "essential", priceId: await priceOf("essential") } }, actor);
    await caps.apply(tenantId, capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: clock + 15 * DAY, source: `subscription:${trialSub.id}` })), { actor, reason: "Prueba", now: clock });
    expect(registry.get(tenantId)).toBe("trial");

    // ── 2. Pedido de conversión; el primer pago FALLA y no activa nada ───────
    clock += 5 * DAY;
    const o = (await svc.create({ idempotencyKey: key(), trialId: t.id, request: { plan: "essential", interval: "month", items: [] } }, actor)).order;
    await svc.accept(o.id, { signatureRef: "aceptacion-recorrido", approvalReason: "Aprobado por producto" }, actor);
    const first = (await svc.requestPayment(o.id, actor)).payment;
    expect((await event(first, "payment.failed")).outcome).toBe("applied");
    expect((await svc.must(o.id)).state).toBe("contracted");
    expect(registry.get(tenantId)).toBe("trial");
    expect((await own(tenantId, trialSub.id)).every((g) => g.validUntil !== null)).toBe(true);

    // ── 3. Reintento cobrado: suscripción, licencias, prueba y empresa activas ─
    const second = (await svc.requestPayment(o.id, actor)).payment;
    expect(second.id).not.toBe(first.id);
    await event(second, "payment.succeeded");
    let cur = await svc.must(o.id);
    expect(cur).toMatchObject({ state: "active", subscriptionId: trialSub.id, tenantId });
    expect((await subsStore.get(trialSub.id))!.status).toBe("active");
    expect((await own(tenantId, trialSub.id)).every((g) => g.status === "active" && g.validUntil === null)).toBe(true);
    expect((await trials.must(t.id)).state).toBe("converted");
    expect(registry.get(tenantId)).toBe("active");

    // ── 4. Renovación: el recibo vence sin pagar → gracia; un reintento falla; el pago lo recupera ─
    const sub = (await subsStore.get(trialSub.id))!;
    clock = sub.currentPeriodEnd + 1;
    await engine.run();
    cur = await svc.must(o.id);
    expect(cur.state).toBe("past_due");
    expect(registry.get(tenantId)).toBe("grace");
    const renewal = (await orders.payments(o.id)).find((x) => x.purpose === "renewal")!;
    clock += 2 * DAY;
    await event(renewal, "payment.failed");
    expect((await svc.must(o.id)).state).toBe("past_due");
    expect((await engine.plan()).actions.find((a) => a.kind === "dunning_notice" && a.orderId === o.id)?.detail.day).toBe(0);
    clock += 2 * DAY;
    expect((await engine.plan()).actions.find((a) => a.kind === "dunning_notice" && a.orderId === o.id)?.detail.day).toBe(3);
    await event(renewal, "payment.succeeded");
    cur = await svc.must(o.id);
    expect(cur.state).toBe("active");
    expect(registry.get(tenantId)).toBe("active");
    expect((await own(tenantId, trialSub.id)).every((g) => g.status === "active")).toBe(true);

    // ── 5. Cambio de plan a Business, pagado: el pedido anterior queda sustituido ─
    const ch = (await svc.create({ idempotencyKey: key(), changeOf: o.id, request: { plan: "business", interval: "month", items: [] } }, actor)).order;
    await svc.accept(ch.id, { signatureRef: "aceptacion-cambio", approvalReason: "Aprobado por producto" }, actor);
    const chPay = (await svc.requestPayment(ch.id, actor)).payment;
    await event(chPay, "payment.succeeded");
    expect((await svc.must(ch.id)).state).toBe("active");
    expect((await svc.must(o.id)).state).toBe("superseded");
    expect(registry.get(tenantId)).toBe("active");
    const businessOnly = capabilitiesOfTier("business").filter((x) => !capabilitiesOfTier("essential").includes(x));
    expect((await own(tenantId, trialSub.id)).filter((g) => businessOnly.includes(g.capabilityId) && g.status === "active").length).toBe(businessOnly.length);

    // ── 6. Cancelación a fin de periodo: sigue activa hasta el fin; después, terminada ─
    await svc.cancel(ch.id, { reason: "El cliente cierra la actividad" }, actor);
    expect((await svc.must(ch.id)).state).toBe("cancel_scheduled");
    expect(registry.get(tenantId)).toBe("active");
    clock = (await subsStore.get(trialSub.id))!.currentPeriodEnd + 1;
    await engine.run();
    expect((await svc.must(ch.id)).state).toBe("cancelled");
    expect((await subsStore.get(trialSub.id))!.status).toBe("canceled");
    expect(registry.get(tenantId)).toBe("suspended");
    // Repetir el motor no cambia nada
    const before = (await log.list({ companyId: c.id, limit: 1000 })).length;
    await engine.run();
    await engine.run();
    expect((await log.list({ companyId: c.id, limit: 1000 })).length).toBe(before);

    // ── Rastro: estado de la empresa y hechos clave, cada uno una vez y en orden ─
    expect(registryAudit).toEqual([
      "trial→active:commercial:order_active",
      "active→grace:commercial:payment_overdue",
      "grace→active:commercial:order_active",
      "active→suspended:commercial:subscription_ended",
    ]);
    expect(await types({ trialId: t.id, types: ["trial.requested", "trial.verified", "trial.started", "trial.converted"] })).toEqual(["trial.requested", "trial.verified", "trial.started", "trial.converted"]);
    expect(await types({ orderId: o.id, types: ["payment.failed", "payment.succeeded", "order.activated", "renewal.requested", "renewal.failed", "renewal.paid", "order.past_due", "order.recovered", "order.superseded"] })).toEqual([
      "payment.failed",
      "payment.succeeded",
      "order.activated",
      "renewal.requested",
      "order.past_due",
      "renewal.failed",
      "renewal.paid",
      "order.recovered",
      "order.superseded",
    ]);
    expect(await types({ orderId: ch.id, types: ["order.activated", "order.cancel_scheduled", "order.cancelled"] })).toEqual(["order.activated", "order.cancel_scheduled", "order.cancelled"]);
    expect(await types({ subscriptionId: trialSub.id, types: ["subscription.trial_converted", "subscription.renewed", "subscription.plan_changed", "subscription.canceled"] })).toEqual([
      "subscription.trial_converted",
      "subscription.renewed",
      "subscription.plan_changed",
      "subscription.canceled",
    ]);
    expect(await types({ companyId: c.id, types: ["tenant.status_changed"] })).toHaveLength(4);
    const [dups] = await pool.query<mysql.RowDataPacket[]>("SELECT event_key FROM commercial_events GROUP BY event_key HAVING COUNT(*) > 1");
    expect(dups).toHaveLength(0);
    expect(JSON.stringify(await log.list({ companyId: c.id, limit: 1000 }))).not.toMatch(/@|Abeto Recorrido/);
  });
});
