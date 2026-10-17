/**
 * Ciclo de vida de Stripe Billing de punta a punta contra MySQL REAL (opt-in, REGISTRY_TEST_DATABASE_URL;
 * BD aislada creada y borrada aquí). Orquestador, pedidos, contratos, suscripción contractual y licencias
 * son los REALES; solo Stripe es un doble (`FakeStripeGateway`, sin red). Los eventos se entregan como
 * lo haría el webhook (registro + procesamiento) o se recuperan con la conciliación.
 *
 * Escenarios: altas Essential/Business mensual y anual, checkout abandonado, pago rechazado, evento
 * duplicado y desordenado, reintento tras fallo de aprovisionamiento, empresa ya existente, cancelación
 * programada y reactivación, fin de la suscripción (solo lectura), renovación, impago, recuperación,
 * suspensión, cliente de otra empresa, caída de Stripe y webhooks perdidos recuperados por la conciliación.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlCrmStore } from "../crm/mysqlStore";
import { CrmService } from "../crm/service";
import { MysqlWebStore } from "../web/store";
import { WebAdminService } from "../web/service";
import { seedElephantSource } from "../catalog/seed";
import { BUILTIN_MODULES } from "../_core/modules/builtin";
import { catalogFromWebStore, crmFromStore } from "../subscriptions/ports";
import { SubscriptionService } from "../subscriptions/service";
import { ShadowBillingService } from "../subscriptions/shadow";
import { MysqlSubscriptionStore } from "../subscriptions/store";
import { LicensingService } from "../licensing/service";
import { MemoryCapabilityStore } from "../_core/capabilities/store";
import { quote } from "../catalog/quote";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import { CommercialOrchestrator } from "../orchestrator/service";
import { MysqlOrderStore } from "../orchestrator/store";
import { desiredCatalog, planCatalogWrites, syncCatalog } from "./catalog";
import { StripeCheckoutService } from "./checkout";
import { StripeEventProcessor, RETRY_BACKOFF_MS } from "./events";
import type { GwEvent } from "./gateway";
import { StripeReconciler } from "./reconcile";
import { MysqlStripeStore } from "./store";
import { FakeStripeGateway } from "./testing";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_lifecycle_test";
const actor = "operator:mysql";
const key = () => crypto.randomBytes(12).toString("hex");
const DAY = 86_400_000;
const URLS = { success: "https://web.example/contratacion/estado", cancel: "https://web.example/contratacion/cancelada", portalReturn: "https://app.example/admin/suscripcion" };

describe.skipIf(!URL_)("Stripe Billing de punta a punta con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let clock = Date.UTC(2026, 9, 18, 9);
  const gw = new FakeStripeGateway();
  let stripeStore: MysqlStripeStore;
  let orders: MysqlOrderStore;
  let svc: CommercialOrchestrator;
  let crm: CrmService;
  let crmStore: MysqlCrmStore;
  let caps: MemoryCapabilityStore;
  let checkout: StripeCheckoutService;
  let processor: StripeEventProcessor;
  let reconciler: StripeReconciler;
  const platform = { failNext: 0, calls: 0, created: 0, activate: async (i: { company: { id: number; tenantId: string | null } }) => {
    platform.calls++;
    if (platform.failNext > 0) {
      platform.failNext--;
      throw new Error("Fallo temporal al crear la base de la empresa");
    }
    // Solo una empresa SIN plataforma provoca un alta nueva (base de datos, migraciones, administrador)
    if (!i.company.tenantId) platform.created++;
    return { tenantId: i.company.tenantId ?? `t-stripe-${i.company.id}` };
  } };

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 10 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(path.resolve(__dirname, "../../db/crm/migrations"));
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => clock });
    await seedElephantSource(web, webStore);
    crmStore = new MysqlCrmStore(pool);
    crm = new CrmService({ store: crmStore, activation: platform, now: () => clock });
    const subsStore = new MysqlSubscriptionStore(pool);
    const catalog = catalogFromWebStore(webStore);
    const crmPort = crmFromStore(crmStore);
    const subs = new SubscriptionService({ store: subsStore, catalog, crm: crmPort, now: () => clock });
    caps = new MemoryCapabilityStore();
    const site = async () => quoteCatalogFromSite(await web.site("published"));
    orders = new MysqlOrderStore(pool);
    svc = new CommercialOrchestrator({
      store: orders, crm, crmStore, subscriptions: subs, subscriptionStore: subsStore,
      shadow: new ShadowBillingService({ store: subsStore, crm: crmPort, now: () => clock }),
      catalog, quote: async (r) => quote(await site(), r),
      licensing: new LicensingService({ capabilities: caps, subscriptions: subsStore, crm: crmPort, catalog: site, now: () => clock }),
      capabilities: caps, platform, payments: null, now: () => clock,
    });
    // Catálogo de Stripe tal como lo crearía una persona (plan de escrituras) y enlazado (solo lectura)
    stripeStore = new MysqlStripeStore(pool);
    const desired = await desiredCatalog(catalog);
    const plan = await planCatalogWrites(desired, gw);
    for (const op of plan.operations) {
      if (op.op === "create_product") gw.addProduct({ id: `prod_test_${op.productKey}`, name: op.params.name, metadata: op.params.metadata });
      else gw.addPrice({ id: `price_test_${op.params.metadata.es_web_price_id}`, productId: `prod_test_${op.productKey}`, lookupKey: op.params.lookup_key, unitAmount: op.params.unit_amount, interval: op.params.recurring.interval, metadata: op.params.metadata });
    }
    expect((await syncCatalog(desired, gw, stripeStore, clock)).linked).toHaveLength(4);
    checkout = new StripeCheckoutService({ store: stripeStore, gateway: gw, orders, crmStore, catalog, urls: URLS, now: () => clock });
    processor = new StripeEventProcessor({ store: stripeStore, gateway: gw, orders, orchestrator: svc, now: () => clock });
    reconciler = new StripeReconciler({ store: stripeStore, gateway: gw, processor, now: () => clock, refreshAfterMs: 60 * 60_000 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  // ── Ayudas ─────────────────────────────────────────────────────────────────
  const company = async (name: string, tenantId?: string) => {
    const c = await crm.createCompany({ name }, actor);
    await crm.createContact(c.id, { name: "Ana Ensayo", email: `ana@c${c.id}.example` }, actor);
    if (tenantId) await crmStore.update("companies", c.id, { tenantId });
    return c.id;
  };
  const contracted = async (companyId: number, plan = "essential", interval: "month" | "year" = "month") => {
    const o = (await svc.create({ idempotencyKey: key(), companyId, request: { plan, interval, items: [] } }, actor)).order;
    return (await svc.accept(o.id, { signatureRef: `firma-${o.id}`, approvalReason: "Aprobado por producto" }, actor)).order;
  };
  /** Entrega un evento como el webhook: registro (una vez) + procesamiento. */
  const deliver = async (ev: GwEvent) => {
    await stripeStore.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "webhook", now: clock });
    return processor.processDue(50);
  };
  const paid = async (orderId: number, status: "active" | "incomplete" = "active") => {
    const s = await checkout.start(orderId, actor);
    const subId = gw.completeSession(s.sessionId, status);
    await deliver(gw.events[0]);
    return { sessionId: s.sessionId, subId };
  };
  const subChange = async (subId: string, patch: Parameters<FakeStripeGateway["updateSubscription"]>[1], type = "customer.subscription.updated") => {
    gw.updateSubscription(subId, patch);
    return deliver(gw.emit(type, "subscription", subId));
  };
  const paymentsOf = async (orderId: number) => (await pool.query<mysql.RowDataPacket[]>("SELECT purpose, status, provider, mode, idempotency_key FROM commercial_payments WHERE order_id = ? ORDER BY id", [orderId]))[0];
  const licences = async (tenantId: string) => (await caps.list(tenantId)).map((g) => g.status);

  // ── Altas ──────────────────────────────────────────────────────────────────
  it.each([
    ["essential", "month"],
    ["essential", "year"],
    ["business", "month"],
    ["business", "year"],
  ] as const)("alta %s %s: pago verificado → alta de la empresa → licencias activas", async (plan, interval) => {
    const cid = await company(`Alta ${plan} ${interval} SL`);
    const o = await contracted(cid, plan, interval);
    expect(o.state).toBe("contracted");
    const { subId } = await paid(o.id);
    const done = await svc.must(o.id);
    expect(done).toMatchObject({ state: "active", tenantId: `t-stripe-${cid}` });
    expect(done.confirmation?.kind).toBe("payment");
    expect(await paymentsOf(o.id)).toEqual([expect.objectContaining({ purpose: "initial", status: "succeeded", provider: "stripe_test", mode: "test" })]);
    expect(await stripeStore.subscription(subId)).toMatchObject({ status: "active", orderId: o.id, companyId: cid });
    const l = await licences(done.tenantId!);
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((x) => x === "active")).toBe(true);
  });

  it("checkout abandonado: la sesión caduca, el pedido sigue pendiente de pago y se puede abrir otra", async () => {
    const o = await contracted(await company("Abandono SL"));
    const s = await checkout.start(o.id, actor);
    await gw.expireCheckoutSession(s.sessionId);
    await deliver(gw.emit("checkout.session.expired", "checkout.session", s.sessionId));
    expect((await stripeStore.session(s.sessionId))?.status).toBe("expired");
    expect((await svc.must(o.id)).state).toBe("contracted");
    expect(await paymentsOf(o.id)).toEqual([]);
    const again = await checkout.start(o.id, actor);
    expect(again.sessionId).not.toBe(s.sessionId);
  });

  it("pago rechazado: suscripción incompleta sin factura pagada → nada se confirma ni se aprovisiona", async () => {
    const o = await contracted(await company("Rechazo SL"));
    const before = platform.created;
    const { subId } = await paid(o.id, "incomplete");
    await deliver(gw.emit("invoice.payment_failed", "invoice", (await gw.subscription(subId))!.latestInvoiceId!));
    expect((await svc.must(o.id)).state).toBe("contracted");
    expect(await paymentsOf(o.id)).toEqual([]);
    expect(platform.created).toBe(before);
  });

  it("evento duplicado y desordenado: un solo pago y un solo alta", async () => {
    const o = await contracted(await company("Desorden SL"));
    const s = await checkout.start(o.id, actor);
    const subId = gw.completeSession(s.sessionId);
    const completed = gw.events[0];
    // Llega antes el de la suscripción y la factura que el de Checkout, y este dos veces
    await deliver(gw.emit("invoice.paid", "invoice", (await gw.subscription(subId))!.latestInvoiceId!));
    await deliver(gw.emit("customer.subscription.created", "subscription", subId));
    await deliver(completed);
    await deliver(completed);
    expect((await svc.must(o.id)).state).toBe("active");
    expect(await paymentsOf(o.id)).toHaveLength(1);
    const [n] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM subscriptions WHERE company_id = ?", [(await svc.must(o.id)).companyId]);
    expect(Number(n[0].n)).toBe(1);
  });

  it("fallo al aprovisionar: el evento se reintenta y el alta se completa sin duplicar nada", async () => {
    const cid = await company("Reintento SL");
    const o = await contracted(cid);
    platform.failNext = 1;
    const s = await checkout.start(o.id, actor);
    gw.completeSession(s.sessionId);
    const first = await deliver(gw.events[0]);
    expect(first.retried).toBe(1);
    const mid = await svc.must(o.id);
    expect(mid.state).not.toBe("active");
    expect(await paymentsOf(o.id)).toHaveLength(1); // el pago ya consta: no se pierde
    clock += RETRY_BACKOFF_MS[0] + 1000;
    const second = await processor.processDue(50);
    expect(second.processed).toBe(1);
    expect(await svc.must(o.id)).toMatchObject({ state: "active", tenantId: `t-stripe-${cid}` });
    expect(await paymentsOf(o.id)).toHaveLength(1);
  });

  it("empresa que ya tiene plataforma: no se vuelve a aprovisionar", async () => {
    const cid = await company("Existente SL", "t-ya-existente");
    const o = await contracted(cid);
    const before = platform.created;
    await paid(o.id);
    expect(await svc.must(o.id)).toMatchObject({ state: "active", tenantId: "t-ya-existente" });
    expect(platform.created).toBe(before);
  });

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  it("cancelación programada (Portal) → reactivación → fin: solo lectura y nada borrado", async () => {
    const o = await contracted(await company("Cancelación SL"));
    const { subId } = await paid(o.id);
    const end = Math.floor((clock + 30 * DAY) / 1000);
    await subChange(subId, { cancelAt: end, currentPeriodEnd: end });
    expect((await svc.must(o.id)).state).toBe("cancel_scheduled");
    await subChange(subId, { cancelAt: null });
    expect((await svc.must(o.id)).state).toBe("active");
    await subChange(subId, { cancelAt: end });
    await subChange(subId, { status: "canceled" }, "customer.subscription.deleted");
    const done = await svc.must(o.id);
    expect(done.state).toBe("cancelled");
    expect((await licences(done.tenantId!)).every((x) => x === "read_only")).toBe(true);
    const [c] = await pool.query<mysql.RowDataPacket[]>("SELECT status FROM crm_contracts WHERE id = ?", [done.contractId]);
    expect(c[0].status).toBe("cancelled");
  });

  it("impago → gracia → recuperación; impago agotado → suspensión → recuperación", async () => {
    const o = await contracted(await company("Impago SL"));
    const { subId } = await paid(o.id);
    await subChange(subId, { status: "past_due" });
    const pd = await svc.must(o.id);
    expect(pd.state).toBe("past_due");
    expect(pd.graceEndsAt).toBeGreaterThan(clock);
    expect((await licences(pd.tenantId!)).every((x) => x === "active")).toBe(true); // gracia: acceso intacto
    await subChange(subId, { status: "active" });
    expect((await svc.must(o.id)).state).toBe("active");
    await subChange(subId, { status: "unpaid" });
    const sus = await svc.must(o.id);
    expect(sus.state).toBe("suspended");
    expect((await licences(sus.tenantId!)).every((x) => x === "suspended")).toBe(true);
    const inv = gw.addInvoice(subId, (await gw.subscription(subId))!.customerId, "subscription_cycle", "paid", 2900);
    gw.updateSubscription(subId, { status: "active" });
    await deliver(gw.emit("invoice.paid", "invoice", inv));
    const back = await svc.must(o.id);
    expect(back.state).toBe("active");
    expect((await licences(back.tenantId!)).every((x) => x === "active")).toBe(true);
  });

  it("renovación cobrada en Stripe: pago de renovación verificado y periodo interno renovado, sin recibos simulados", async () => {
    const o = await contracted(await company("Renovación SL"));
    const { subId } = await paid(o.id);
    const [before] = await pool.query<mysql.RowDataPacket[]>("SELECT current_period_end FROM subscriptions WHERE id = ?", [(await svc.must(o.id)).subscriptionId]);
    clock += 32 * DAY;
    const inv = gw.addInvoice(subId, (await gw.subscription(subId))!.customerId, "subscription_cycle", "paid", 2900);
    await deliver(gw.emit("invoice.paid", "invoice", inv));
    const ps = await paymentsOf(o.id);
    expect(ps.map((p) => `${p.purpose}/${p.provider}`)).toEqual(["initial/stripe_test", "renewal/stripe_test"]);
    const [after] = await pool.query<mysql.RowDataPacket[]>("SELECT current_period_end FROM subscriptions WHERE id = ?", [(await svc.must(o.id)).subscriptionId]);
    expect(Number(after[0].current_period_end)).toBeGreaterThan(Number(before[0].current_period_end));
    expect((await svc.must(o.id)).state).toBe("active");
  });

  // ── Seguridad y recuperación ───────────────────────────────────────────────
  it("suscripción con el pedido de OTRA empresa: se ignora con alerta y no cambia nada", async () => {
    const victim = await contracted(await company("Víctima SL"));
    const intruder = await contracted(await company("Intrusa SL"));
    const { subId } = await paid(intruder.id);
    gw.updateSubscription(subId, { metadata: { es_order_id: String(victim.id) } });
    const r = await deliver(gw.emit("customer.subscription.updated", "subscription", subId));
    expect(r.ignored).toBe(1);
    expect((await svc.must(victim.id)).state).toBe("contracted");
    expect(await paymentsOf(victim.id)).toEqual([]);
  });

  it("caída temporal de Stripe: el evento se reintenta y se aplica al volver", async () => {
    const o = await contracted(await company("Caída SL"));
    const s = await checkout.start(o.id, actor);
    gw.completeSession(s.sessionId);
    gw.down = true;
    expect((await deliver(gw.events[0])).retried).toBe(1);
    expect((await svc.must(o.id)).state).toBe("contracted");
    gw.down = false;
    clock += RETRY_BACKOFF_MS[0] + 1000;
    await processor.processDue(50);
    expect((await svc.must(o.id)).state).toBe("active");
  });

  it("webhooks perdidos: la conciliación los recupera, los aplica y es segura con dos ejecuciones a la vez", async () => {
    const o = await contracted(await company("Perdido SL"));
    const s = await checkout.start(o.id, actor);
    gw.completeSession(s.sessionId); // el evento existe en Stripe pero NUNCA llega por webhook
    const [a, b] = await Promise.all([reconciler.tick(), reconciler.tick()]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
    const ran = a.skipped ? b : a;
    expect(ran.recovered).toBeGreaterThan(0);
    expect((await svc.must(o.id)).state).toBe("active");
    const again = await reconciler.tick();
    expect(again.recovered).toBe(0);
  });
});
