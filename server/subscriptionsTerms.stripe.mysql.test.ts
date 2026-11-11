/**
 * Cobro en Stripe de condiciones personalizadas contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada
 * creada y borrada aquí): migración 0049 del CRM, registro de la puesta en cobro (una fila por suscripción, versión
 * optimista, una suscripción de Stripe por contratación, modos separados), facturas y el recorrido completo con los
 * almacenes reales (suscripciones, acuerdos, Stripe) y el doble de Stripe: sin red ni claves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../scripts/db/migrationLib";
import { MysqlCrmStore } from "./crm/mysqlStore";
import { MysqlWebStore } from "./web/store";
import { WebAdminService } from "./web/service";
import { catalogFromWebStore, crmFromStore } from "./subscriptions/ports";
import { SubscriptionService } from "./subscriptions/service";
import { MysqlSubscriptionStore } from "./subscriptions/store";
import { CommercialTermsService, type TermsInput } from "./commercialTerms/service";
import { MysqlTermsStore } from "./commercialTerms/store";
import { TermsBillingService } from "./commercialTerms/billing";
import { BillingStoreConflict, MysqlTermsBillingStore } from "./commercialTerms/billingStore";
import { NegotiatedBillingService } from "./commercialTerms/stripeBilling";
import { StripeNegotiatedGateway, catalogProductsOf } from "./commercialTerms/stripeGateway";
import { StripeEventProcessor } from "./stripe/events";
import { MysqlStripeStore } from "./stripe/store";
import { FakeStripeGateway } from "./stripe/testing";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "commercial_terms_billing_test";
const DIR = path.resolve(__dirname, "../db/crm/migrations");
const A = "operator:ana";
const NS = "local";
const T0 = Date.UTC(2026, 10, 1, 10);

describe.skipIf(!URL_)("cobro en Stripe de condiciones personalizadas con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlSubscriptionStore;
  let termsStore: MysqlTermsStore;
  let stripeStore: MysqlStripeStore;
  let billingStore: MysqlTermsBillingStore;
  let subs: SubscriptionService;
  let terms: CommercialTermsService;
  let billing: TermsBillingService;
  let neg: NegotiatedBillingService;
  let processor: StripeEventProcessor;
  let gw: FakeStripeGateway;
  let clock = T0;
  const P: Record<string, number> = {};

  const input = (over: Partial<TermsInput> = {}): TermsInput => ({
    pricingMode: "global",
    globalAmountCents: 12900,
    presentation: "global",
    packageName: "Paquete hotel",
    reason: "Acuerdo comercial negociado",
    lines: [
      { kind: "catalog", productKey: "essential", priceId: P.essM },
      { kind: "catalog", productKey: "hotel-net", priceId: P.hotM },
    ],
    ...over,
  });
  async function agreed(companyId: number, over: Partial<TermsInput> = {}) {
    const sub = await subs.create({ companyId, interval: "month", plan: { productKey: "essential", priceId: P.essM } }, A);
    const draft = await terms.createForSubscription(sub.id, input(over), A);
    await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: sub.version }, A);
    return sub.id;
  }
  async function deliver() {
    for (const ev of gw.events.slice().reverse()) await stripeStore.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "webhook", now: clock });
    return processor.processDue(200);
  }

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(DIR);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    await pool.query("INSERT INTO crm_companies (id, name, created_at) VALUES (1, 'Acme', 1), (2, 'Otra', 1), (3, 'Tercera', 1), (4, 'Cuarta', 1)");
    const webStore = new MysqlWebStore(pool);
    const web = new WebAdminService({ store: webStore, refs: { moduleIds: ["hotel"], planIds: () => null }, now: () => clock });
    gw = new FakeStripeGateway();
    stripeStore = new MysqlStripeStore(pool, "test");
    for (const [key, family, act, model] of [
      ["essential", "core_plan", { kind: "plan", ref: "essential" }, "subscription"],
      ["hotel-net", "industry_module", { kind: "module", ref: "hotel" }, "recurring_addon"],
    ] as const) {
      await web.create({ kind: "product", key, family, draft: { name: key, technicalStatus: "available", activation: act, billingModel: model } }, A);
      await web.publish("product", key, 1, A);
    }
    for (const [name, key, amount] of [["essM", "essential", 2900], ["hotM", "hotel-net", 11900]] as const) {
      const p = await web.addPrice(key, { kind: "monthly", amountCents: amount, taxRateBp: 2100 }, A);
      await web.approvePrice(p.id, A);
      P[name] = p.id;
      gw.addProduct({ id: `prod_${key}`, name: key });
      await stripeStore.upsertPrice({ webPriceId: p.id, stripeProductId: `prod_${key}`, stripePriceId: `price_${key}`, lookupKey: `es:${key}:monthly:eur:v${p.id}`, now: clock });
    }
    store = new MysqlSubscriptionStore(pool);
    termsStore = new MysqlTermsStore(pool);
    billingStore = new MysqlTermsBillingStore(pool, "test");
    const crmStore = new MysqlCrmStore(pool);
    const crm = crmFromStore(crmStore);
    const catalog = catalogFromWebStore(webStore);
    subs = new SubscriptionService({ store, catalog, crm, now: () => clock });
    billing = new TermsBillingService({ enabled: true, termsStore, subscriptionStore: store, now: () => clock });
    terms = new CommercialTermsService({ store: termsStore, subscriptions: subs, subscriptionStore: store, catalog, crm, now: () => clock, afterChange: async (sid) => void (await billing.syncIfOpen(sid)) });
    const adapter = new StripeNegotiatedGateway({ gateway: gw, namespace: NS, mode: "test", taxPolicy: "test_net_no_tax", catalogProducts: async () => catalogProductsOf(await stripeStore.listPrices()), allowed: (id) => neg.allowed(id) });
    neg = new NegotiatedBillingService({ enabled: true, store: billingStore, stripeStore, gateway: gw, adapter, billing, termsStore, subscriptionStore: store, subscriptions: subs, crmStore, urls: { success: "https://web.example/ok", cancel: "https://web.example/ko" }, namespace: NS, mode: "test", taxPolicy: "test_net_no_tax", now: () => clock });
    billing.attach({ gateway: neg.gatewayFor(), link: neg.link });
    const trap = new Proxy({}, { get: (_t, op) => (op === "then" ? undefined : () => Promise.reject(new Error(`circuito ordinario no permitido: ${String(op)}`))) });
    processor = new StripeEventProcessor({ store: stripeStore, gateway: gw, orders: trap as never, orchestrator: trap as never, now: () => clock, namespace: NS, mode: "test", negotiated: { handleSession: (id) => neg.handleSession(id), handleSubscription: (s, h) => neg.handleSubscription(s, h), handleCharge: (c, i, s) => neg.handleCharge(c, i, s) } });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("la migración 0049 es aditiva: crea solo sus dos tablas y no contiene borrados", async () => {
    const up = fs.readFileSync(path.join(DIR, "0049_commercial_terms_billing.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(up).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP)\b/i);
    expect(up.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(up).not.toMatch(/ALTER TABLE/i);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'commercial_terms_billing%' ORDER BY table_name", [DB]);
    expect(rows.map((r) => r.t)).toEqual(["commercial_terms_billing", "commercial_terms_billing_invoices"]);
  });

  it("una fila por suscripción: dos altas a la vez dejan una; el cambio exige la versión vigente", async () => {
    const subId = await agreed(1);
    const made = await Promise.all([1, 2, 3].map((n) => billingStore.create({ subscriptionId: subId, companyId: 1, stripeCustomerId: "cus_test_a", startedBy: `operator:${n}`, now: clock })));
    expect(made.filter((m) => m.created)).toHaveLength(1);
    expect(new Set(made.map((m) => m.row.id)).size).toBe(1);
    const row = made[0].row;
    const offer = { hash: "h", termsId: 1, currency: "EUR", recurringCents: 12900, firstChargeCents: 12900, oneOffs: { "charge:1": 50000 }, deferredCredits: ["credit:2"], taxTreatment: "test_net_no_tax" };
    const results = await Promise.allSettled([billingStore.patch(row.id, { sessionSeq: 1, checkout: offer }, row.version, clock), billingStore.patch(row.id, { sessionSeq: 2 }, row.version, clock)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(BillingStoreConflict);
    const cur = (await billingStore.bySubscription(subId))!;
    expect(cur.version).toBe(row.version + 1);
    // JSON de ida y vuelta, y vuelta a null
    if (cur.checkout) expect(cur.checkout).toEqual(offer);
    const cleared = await billingStore.patch(cur.id, { checkout: null, suspendedCapabilities: [{ capabilityId: "plan.essential", siteId: "" }], stripeSubscriptionId: "sub_test_a", sessionId: "cs_test_a", sessionStatus: "open", sessionExpiresAt: clock - 1 }, cur.version, clock);
    expect(cleared).toMatchObject({ checkout: null, suspendedCapabilities: [{ capabilityId: "plan.essential", siteId: "" }], stripeSubscriptionId: "sub_test_a" });
    expect((await billingStore.byStripeSubscription("sub_test_a"))!.id).toBe(row.id);
    expect((await billingStore.bySession("cs_test_a"))!.id).toBe(row.id);
    expect((await billingStore.list({ status: ["pending"], sessionExpiredBefore: clock })).map((r) => r.id)).toContain(row.id);
    // Otro modo (live) no ve la fila ni puede reutilizarla
    const live = new MysqlTermsBillingStore(pool, "live");
    expect(await live.bySubscription(subId)).toBeNull();
    expect(await live.byStripeSubscription("sub_test_a")).toBeNull();
    await expect(live.create({ subscriptionId: subId, companyId: 1, stripeCustomerId: "cus_live_a", startedBy: A, now: clock })).rejects.toBeInstanceOf(BillingStoreConflict);
    // Una suscripción de Stripe solo puede estar enlazada a una contratación
    const other = await agreed(2);
    const o = (await billingStore.create({ subscriptionId: other, companyId: 2, stripeCustomerId: "cus_test_b", startedBy: A, now: clock })).row;
    await expect(billingStore.patch(o.id, { stripeSubscriptionId: "sub_test_a" }, o.version, clock)).rejects.toBeInstanceOf(BillingStoreConflict);
    await pool.query("UPDATE commercial_terms_billing SET stripe_subscription_id = NULL, session_id = NULL WHERE id IN (?, ?)", [row.id, o.id]);
  });

  it("facturas: una fila por factura de Stripe; releerla no la duplica ni pierde lo ya sabido", async () => {
    const subId = await agreed(3);
    const row = (await billingStore.create({ subscriptionId: subId, companyId: 3, stripeCustomerId: "cus_test_c", startedBy: A, now: clock })).row;
    const inv = { billingId: row.id, subscriptionId: subId, stripeInvoiceId: "in_test_1", status: "open", billingReason: "subscription_cycle", number: null, currency: "EUR", subtotalCents: 12900, taxCents: null, totalCents: 12900, amountPaidCents: 0, periodStart: clock, taxCheck: null, coverageLost: false, paidAt: null };
    expect((await billingStore.upsertInvoice(inv, clock)).previous).toBeNull();
    const paid = await billingStore.upsertInvoice({ ...inv, status: "paid", amountPaidCents: 12900, taxCheck: "ok", paidAt: clock + 5 }, clock + 5);
    expect(paid.previous).toMatchObject({ status: "open" });
    expect(paid.current).toMatchObject({ status: "paid", amountPaidCents: 12900, taxCheck: "ok", paidAt: clock + 5, createdAt: clock });
    const again = await billingStore.upsertInvoice({ ...inv, status: "paid", amountPaidCents: 12900, taxCheck: null, coverageLost: true, paidAt: clock + 99 }, clock + 99);
    expect(again.current).toMatchObject({ taxCheck: "ok", coverageLost: true, paidAt: clock + 5 });
    expect(await billingStore.invoices(row.id)).toHaveLength(1);
    const [n] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM commercial_terms_billing_invoices WHERE stripe_invoice_id = 'in_test_1'");
    expect(Number(n[0].n)).toBe(1);
  });

  it("recorrido completo con almacenes reales: dos operadores a la vez abren UNA sesión; el webhook enlaza; sincronizar no duplica", async () => {
    const subId = await agreed(4);
    const out = await Promise.allSettled([neg.start(subId, A), neg.start(subId, "operator:berta"), neg.start(subId, "operator:carla")]);
    const creates = gw.calls.filter((c) => c.op === "checkout.sessions.create(negotiated)");
    expect(creates).toHaveLength(1);
    expect(gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(1);
    for (const r of out) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    const started = out.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ status: string; sessionId: string }>;
    expect(started.value.status).toBe("pending");
    // El Customer es el de la empresa (`stripe_customers`), uno solo
    const [customers] = await pool.query<mysql.RowDataPacket[]>("SELECT stripe_customer_id FROM stripe_customers WHERE company_id = 4");
    expect(customers).toHaveLength(1);
    expect(await neg.link(subId)).toBeNull();
    // El cliente paga: llegan los webhooks (y se repiten)
    const stripeId = gw.completeNegotiatedSession(started.value.sessionId);
    await deliver();
    await deliver();
    for (const ev of gw.events) await processor.process({ eventId: ev.id, type: ev.type, objectId: ev.objectId });
    const row = (await billingStore.bySubscription(subId))!;
    expect(row).toMatchObject({ status: "active", stripeSubscriptionId: stripeId, stripeCustomerId: String(customers[0].stripe_customer_id), sessionStatus: "complete" });
    expect(await neg.link(subId)).toEqual({ customerId: row.stripeCustomerId, subscriptionId: stripeId });
    expect(await billingStore.invoices(row.id)).toHaveLength(1);
    expect(await neg.start(subId, A)).toMatchObject({ status: "linked", stripeSubscriptionId: stripeId });
    expect(gw.subscriptions.size).toBe(1);
    // Cambio de condiciones (sincroniza solo) y sincronizaciones simultáneas: un solo efecto
    const draft = await terms.createForSubscription(subId, input({ globalAmountCents: 9900 }), A);
    await terms.activate(draft.id, { expectedRevision: draft.revision, expectedVersion: (await subs.must(subId)).version }, A);
    await Promise.all([billing.sync(subId, A), billing.sync(subId, "operator:berta")]);
    expect(gw.negotiated.get(stripeId)!.items.reduce((a, i) => a + i.unitAmount, 0)).toBe(9900);
    expect(gw.calls.filter((c) => c.op === "subscriptions.update(negotiated)")).toHaveLength(1);
    expect(await billing.reconcile(subId)).toMatchObject({ available: true, consistent: true });
    // Historial del acuerdo: puesta en cobro, cobro y estado
    const kinds = (await termsStore.events({ subscriptionId: subId })).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["billing_started", "billing_payment", "billing_state", "sync"]));
  });
});
