/**
 * Almacén de Stripe (MysqlStripeStore) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada
 * creada y borrada aquí): correspondencia de precios sin reasignaciones, un Customer por empresa con
 * carrera simultánea, una sola sesión abierta por pedido, pago completado y copia de la suscripción.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlStripeStore, StripeStoreError } from "./store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_store_test";
const now = Date.UTC(2026, 9, 17, 12);

describe.skipIf(!URL_)("almacén de Stripe con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlStripeStore;
  let companyId = 0;
  let orderId = 0;
  let webPriceId = 0;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(path.resolve(__dirname, "../../db/crm/migrations"));
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    store = new MysqlStripeStore(pool);
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Empresa Store Stripe', ?)`, [now])) as unknown as [{ insertId: number }];
    companyId = c.insertId;
    const [e] = (await pool.query(`INSERT INTO web_entries (kind, entry_key, draft, created_at, created_by, updated_at, updated_by) VALUES ('product', 'essential-store', '{}', ?, 't', ?, 't')`, [now, now])) as unknown as [{ insertId: number }];
    const [p] = (await pool.query(`INSERT INTO web_prices (entry_id, kind, amount_cents, currency, tax_rate_bp, tax_included, status, created_at, created_by) VALUES (?, 'monthly', 2900, 'EUR', 2100, 0, 'approved', ?, 't')`, [e.insertId, now])) as unknown as [{ insertId: number }];
    webPriceId = p.insertId;
    const [o] = (await pool.query(`INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES ('clave-store-stripe-000001', REPEAT('b', 64), 'new', 'contracted', ?, '{}', ?, 't')`, [companyId, now])) as unknown as [{ insertId: number }];
    orderId = o.insertId;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("enlaza un precio, repetirlo es idempotente y nunca se reasigna a otro Price", async () => {
    const a = await store.upsertPrice({ webPriceId, stripeProductId: "prod_test_A", stripePriceId: "price_test_A", lookupKey: `es:essential:monthly:eur:v${webPriceId}`, now });
    const b = await store.upsertPrice({ webPriceId, stripeProductId: "prod_test_A", stripePriceId: "price_test_A", lookupKey: `es:essential:monthly:eur:v${webPriceId}`, now: now + 1 });
    expect(b).toEqual(a);
    await expect(store.upsertPrice({ webPriceId, stripeProductId: "prod_test_A", stripePriceId: "price_test_B", lookupKey: `es:essential:monthly:eur:v${webPriceId}`, now })).rejects.toThrow(StripeStoreError);
    expect(await store.priceForWebPrice(webPriceId)).toMatchObject({ stripePriceId: "price_test_A", status: "active" });
  });

  it("un Customer por empresa aunque dos altas lleguen a la vez", async () => {
    const r = await Promise.all([
      store.linkCustomer({ companyId, tenantId: "t-store", stripeCustomerId: "cus_test_A", now }),
      store.linkCustomer({ companyId, tenantId: "t-store", stripeCustomerId: "cus_test_B", now }),
    ]);
    expect(r.filter((x) => x.created)).toHaveLength(1);
    expect(r[0].link.stripeCustomerId).toBe(r[1].link.stripeCustomerId);
    const [rows] = (await pool.query(`SELECT COUNT(*) n FROM stripe_customers WHERE company_id = ?`, [companyId])) as unknown as [{ n: number }[]];
    expect(Number(rows[0].n)).toBe(1);
  });

  it("una sola sesión abierta por pedido, también con inserciones simultáneas", async () => {
    const row = (id: string, key: string) => ({ orderId, stripeSessionId: id, idempotencyKey: key, priceIds: ["price_test_A"], status: "open" as const, paymentStatus: "unpaid", expiresAt: now + 7_200_000, createdAt: now, completedAt: null });
    const r = await Promise.allSettled([store.insertSession(row("cs_test_X1", "k-x1")), store.insertSession(row("cs_test_X2", "k-x2"))]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(StripeStoreError);
    const open = await store.openSession(orderId);
    expect(open?.priceIds).toEqual(["price_test_A"]);
    expect(await store.hasCompletedSession(orderId)).toBe(false);
    await store.updateSession(open!.stripeSessionId, { status: "complete", paymentStatus: "paid", completedAt: now + 5 });
    expect(await store.openSession(orderId)).toBeNull();
    expect(await store.hasCompletedSession(orderId)).toBe(true);
    expect(await store.countSessions(orderId)).toBe(1);
  });

  it("copia de la suscripción: inserta y actualiza (versión) sin duplicar", async () => {
    const cus = (await store.customerByCompany(companyId))!.stripeCustomerId;
    const base = { id: "sub_test_S1", customerId: cus, companyId, orderId, tenantId: "t-store", status: "active" as const, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: 1_800_000_000, latestInvoiceId: "in_test_1", priceIds: ["price_test_A"], syncedAt: now };
    await store.upsertSubscription(base);
    await store.upsertSubscription({ ...base, status: "past_due", cancelAt: 1_900_000_000, syncedAt: now + 10 });
    expect(await store.subscription("sub_test_S1")).toMatchObject({ status: "past_due", cancelAt: 1_900_000_000, priceIds: ["price_test_A"], orderId });
    const [rows] = (await pool.query(`SELECT version FROM stripe_subscriptions WHERE stripe_subscription_id = 'sub_test_S1'`)) as unknown as [{ version: number }[]];
    expect(Number(rows[0].version)).toBe(2);
  });

  it("B4: retención por cobro revertido: se registra, se resuelve con motivo y una pérdida NUEVA la reabre", async () => {
    const a = { chargeId: "ch_test_Cargo0001", invoiceId: "in_test_1", subscriptionId: "sub_test_S1", orderId, companyId, amountCents: 2900, amountRefundedCents: 0, currency: "EUR", disputeStatus: "needs_response", coverageLost: false };
    expect((await store.upsertAdjustment(a, now)).previous).toBeNull();
    expect(await store.activeHolds(orderId)).toEqual([]);
    const lost = await store.upsertAdjustment({ ...a, disputeStatus: "lost", coverageLost: true }, now + 1);
    expect(lost.previous?.coverageLost).toBe(false);
    expect(await store.activeHolds(orderId)).toHaveLength(1);
    // Un pago de la MISMA factura no levanta la retención; el de otra sí
    expect(await store.resolveHolds({ orderId, exceptInvoiceId: "in_test_1" }, "pago", now + 2)).toBe(0);
    expect(await store.resolveHolds({ chargeId: a.chargeId }, "operator:ana: revisado", now + 3)).toBe(1);
    expect(await store.activeHolds(orderId)).toEqual([]);
    // El mismo estado otra vez no reabre; volver a perder la cobertura sí
    await store.upsertAdjustment({ ...a, disputeStatus: "lost", coverageLost: true }, now + 4);
    expect(await store.activeHolds(orderId)).toEqual([]);
    await store.upsertAdjustment({ ...a, disputeStatus: "won", coverageLost: false }, now + 5);
    await store.upsertAdjustment({ ...a, amountRefundedCents: 2900, disputeStatus: "won", coverageLost: true }, now + 6);
    expect(await store.activeHolds(orderId)).toHaveLength(1);
    await expect(pool.query("UPDATE stripe_charge_adjustments SET livemode = 1")).rejects.toThrow();
  });

  it("purga: borra solo eventos terminados anteriores al corte, por lotes; fallidos y pendientes se quedan", async () => {
    const ev = (id: string, at: number) => store.recordEvent({ eventId: id, type: "invoice.paid", apiVersion: null, objectType: "invoice", objectId: "in_x", stripeCreated: 1, source: "webhook", now: at });
    for (let i = 0; i < 5; i++) {
      await ev(`evt_test_purge_p${i}`, now - 1000);
      await store.finishEvent(`evt_test_purge_p${i}`, i % 2 ? "ignored" : "processed", null, now);
    }
    await ev("evt_test_purge_failed", now - 1000);
    await store.failEvent("evt_test_purge_failed", "x", null);
    await ev("evt_test_purge_received", now - 1000);
    await ev("evt_test_purge_recent", now + 1000);
    await store.finishEvent("evt_test_purge_recent", "processed", null, now);
    expect(await store.purgeEvents(now, 3)).toEqual({ processed: 3, ignored: 0 });
    expect(await store.purgeEvents(now, 10)).toEqual({ processed: 0, ignored: 2 });
    const [rows] = (await pool.query("SELECT event_id FROM stripe_events WHERE event_id LIKE 'evt_test_purge%' ORDER BY event_id")) as unknown as [{ event_id: string }[]];
    expect(rows.map((r) => r.event_id)).toEqual(["evt_test_purge_failed", "evt_test_purge_received", "evt_test_purge_recent"]);
  });
});
