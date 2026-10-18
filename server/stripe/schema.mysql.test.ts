/**
 * Migraciones 0012_stripe_billing y 0013_stripe_livemode contra MySQL real (opt-in,
 * REGISTRY_TEST_DATABASE_URL; BD aislada creada y borrada aquí): ida, vuelta y otra vez ida; con la 0013 la
 * BD admite filas de pruebas y live (y nada más); su reversión falla sin cambiar nada si hay filas live y,
 * sin ellas, vuelve a rechazar cualquier fila «live»; unicidad de la correspondencia (precio, cliente por
 * empresa, una sesión de Checkout abierta por pedido, un evento por id).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_schema_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const now = Date.UTC(2026, 9, 17, 12);

describe.skipIf(!URL_)("migraciones 0012_stripe_billing y 0013_stripe_livemode con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let stripe: { up: string; down: string };
  let livemode: { up: string; down: string };
  let orderId = 0;
  let companyId = 0;
  let webPriceId = 0;

  const tables = async () =>
    ((await pool.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'stripe\\_%' ORDER BY 1`, [DB]))[0] as { t: string }[]).map((r) => r.t);
  // Una sola conexión, como el ejecutor de migraciones (la reversión de 0013 usa una tabla temporal)
  const run = async (sql: string) => {
    const conn = await pool.getConnection();
    try {
      for (const s of splitStatements(sql)) await conn.query(s);
    } finally {
      conn.release();
    }
  };
  const checks = async () =>
    ((await pool.query(`SELECT constraint_name AS c FROM information_schema.check_constraints WHERE constraint_schema = ? AND constraint_name LIKE 'chk\\_stripe\\_%' ORDER BY 1`, [DB]))[0] as { c: string }[]).map((r) => r.c);
  const paymentMode = async () =>
    ((await pool.query(`SELECT column_type AS t FROM information_schema.columns WHERE table_schema = ? AND table_name = 'commercial_payments' AND column_name = 'mode'`, [DB]))[0] as { t: string }[])[0]?.t;
  const insertPayment = (key: string, mode: string) =>
    pool.query(`INSERT INTO commercial_payments (order_id, idempotency_key, purpose, amount_cents, currency, status, provider, mode, created_at) VALUES (?, ?, 'initial', 2900, 'EUR', 'pending', 'stripe', ?, ?)`, [orderId, key, mode, now]);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(DIR);
    if (errors.length) throw new Error(errors.join("; "));
    const found = migrations.find((m) => m.id === "0012_stripe_billing");
    if (!found?.down) throw new Error("No se encuentra 0012_stripe_billing con su reversión");
    stripe = { up: found.up, down: found.down };
    const live = migrations.find((m) => m.id === "0013_stripe_livemode");
    if (!live?.down) throw new Error("No se encuentra 0013_stripe_livemode con su reversión");
    livemode = { up: live.up, down: live.down };
    for (const m of migrations) await run(m.up);

    // Datos mínimos sintéticos: empresa, entrada y precio del catálogo, pedido
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Empresa Stripe Test', ?)`, [now])) as unknown as [{ insertId: number }];
    companyId = c.insertId;
    const [e] = (await pool.query(
      `INSERT INTO web_entries (kind, entry_key, draft, created_at, created_by, updated_at, updated_by) VALUES ('product', 'essential-test', '{}', ?, 'test', ?, 'test')`,
      [now, now],
    )) as unknown as [{ insertId: number }];
    const [p] = (await pool.query(
      `INSERT INTO web_prices (entry_id, kind, amount_cents, currency, tax_rate_bp, tax_included, status, created_at, created_by) VALUES (?, 'monthly', 2900, 'EUR', 2100, 0, 'approved', ?, 'test')`,
      [e.insertId, now],
    )) as unknown as [{ insertId: number }];
    webPriceId = p.insertId;
    const [o] = (await pool.query(
      `INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES ('clave-pedido-stripe-test-0001', REPEAT('a', 64), 'new', 'contracted', ?, '{}', ?, 'test')`,
      [companyId, now],
    )) as unknown as [{ insertId: number }];
    orderId = o.insertId;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("crea las siete tablas", async () => {
    expect(await tables()).toEqual(["stripe_charge_adjustments", "stripe_checkout_sessions", "stripe_customers", "stripe_events", "stripe_prices", "stripe_subscriptions", "stripe_sync_state"]);
  });

  // Filas live (livemode = lm) en las seis tablas con datos de Stripe, para una empresa aparte
  let liveCompanyId = 0;
  const liveRows = {
    customer: (lm: number) => pool.query(`INSERT INTO stripe_customers (company_id, stripe_customer_id, livemode, created_at) VALUES (?, 'cus_live_x', ?, ?)`, [liveCompanyId, lm, now]),
    price: (lm: number) => pool.query(`INSERT INTO stripe_prices (web_price_id, stripe_product_id, stripe_price_id, lookup_key, livemode, created_at, synced_at) VALUES (?, 'prod_live_x', 'price_live_x', 'es:live:x', ?, ?, ?)`, [webPriceId, lm, now, now]),
    session: (lm: number) => pool.query(`INSERT INTO stripe_checkout_sessions (order_id, stripe_session_id, idempotency_key, price_ids_json, status, expires_at, livemode, created_at) VALUES (?, 'cs_live_x', 'k-live-x', '[]', 'expired', ?, ?, ?)`, [orderId, now, lm, now]),
    subscription: (lm: number) => pool.query(`INSERT INTO stripe_subscriptions (stripe_subscription_id, stripe_customer_id, company_id, status, price_ids_json, livemode, synced_at) VALUES ('sub_live_x', 'cus_live_x', ?, 'active', '[]', ?, ?)`, [liveCompanyId, lm, now]),
    event: (lm: number) => pool.query(`INSERT INTO stripe_events (event_id, type, stripe_created, source, status, livemode, received_at) VALUES ('evt_live_x', 'invoice.paid', 1, 'webhook', 'received', ?, ?)`, [lm, now]),
    adjustment: (lm: number) => pool.query(`INSERT INTO stripe_charge_adjustments (stripe_charge_id, order_id, company_id, amount_cents, currency, livemode, created_at, updated_at) VALUES ('ch_live_x', ?, ?, 2900, 'EUR', ?, ?, ?)`, [orderId, liveCompanyId, lm, now, now]),
  };
  const deleteLiveRows = async () => {
    for (const t of ["stripe_charge_adjustments", "stripe_subscriptions", "stripe_checkout_sessions", "stripe_events", "stripe_prices", "stripe_customers"]) await pool.query(`DELETE FROM ${t} WHERE livemode = 1`);
    await pool.query(`DELETE FROM commercial_payments WHERE mode = 'live'`);
  };
  const LIVE_CHECKS = ["chk_stripe_adj_livemode", "chk_stripe_checkout_livemode", "chk_stripe_customer_livemode", "chk_stripe_event_livemode", "chk_stripe_price_livemode", "chk_stripe_sub_livemode"];
  const TEST_CHECKS = ["chk_stripe_adj_test", "chk_stripe_checkout_test", "chk_stripe_customer_test", "chk_stripe_event_test", "chk_stripe_price_test", "chk_stripe_sub_test"];

  it("con 0013 la BD admite filas de pruebas y live en las seis tablas, y ningún otro valor", async () => {
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Empresa Stripe Live', ?)`, [now])) as unknown as [{ insertId: number }];
    liveCompanyId = c.insertId;
    expect(await checks()).toEqual(LIVE_CHECKS);
    for (const ins of Object.values(liveRows)) {
      await expect(ins(2)).rejects.toThrow(/check constraint/i);
      await ins(1);
    }
    expect(await paymentMode()).toBe("enum('test','live')");
    await insertPayment("pago-live-1", "live");
    await expect(insertPayment("pago-otro-1", "otro")).rejects.toThrow();
  });

  it("vuelta de 0013: con filas live falla SIN cambiar nada; sin ellas vuelve a solo pruebas; y otra vez ida", async () => {
    await expect(run(livemode.down)).rejects.toThrow(/check constraint/i);
    expect(await checks()).toEqual(LIVE_CHECKS);
    expect(await paymentMode()).toBe("enum('test','live')");
    await deleteLiveRows();
    await run(livemode.down);
    expect(await checks()).toEqual(TEST_CHECKS);
    expect(await paymentMode()).toBe("enum('test')");
    // Vuelve a rechazar cualquier fila live, como con la 0012 sola
    for (const ins of Object.values(liveRows)) await expect(ins(1)).rejects.toThrow();
    await expect(insertPayment("pago-live-2", "live")).rejects.toThrow();
    await run(livemode.up);
    expect(await checks()).toEqual(LIVE_CHECKS);
    expect(await paymentMode()).toBe("enum('test','live')");
  });

  it("un cliente por empresa y un evento por id", async () => {
    await pool.query(`INSERT INTO stripe_customers (company_id, stripe_customer_id, created_at) VALUES (?, 'cus_test_1', ?)`, [companyId, now]);
    await expect(pool.query(`INSERT INTO stripe_customers (company_id, stripe_customer_id, created_at) VALUES (?, 'cus_test_2', ?)`, [companyId, now])).rejects.toThrow(/Duplicate/);
    const ev = `INSERT INTO stripe_events (event_id, type, stripe_created, source, status, received_at) VALUES ('evt_test_1', 'invoice.paid', 1, 'webhook', 'received', ?)`;
    await pool.query(ev, [now]);
    await expect(pool.query(ev, [now])).rejects.toThrow(/Duplicate/);
  });

  it("los identificadores de Stripe se comparan de forma exacta (distinguen mayúsculas)", async () => {
    const ev = (id: string) => pool.query(`INSERT INTO stripe_events (event_id, type, stripe_created, source, status, received_at) VALUES (?, 'invoice.paid', 1, 'webhook', 'received', ?)`, [id, now]);
    await ev("evt_CaseTest");
    await ev("evt_casetest");
    const [rows] = (await pool.query(`SELECT COUNT(*) n FROM stripe_events WHERE event_id = 'evt_CaseTest'`)) as unknown as [{ n: number }[]];
    expect(Number(rows[0].n)).toBe(1);
  });

  it("una sola sesión de Checkout abierta por pedido; las cerradas no cuentan", async () => {
    const ins = (sid: string, k: string, status: string) =>
      pool.query(`INSERT INTO stripe_checkout_sessions (order_id, stripe_session_id, idempotency_key, price_ids_json, status, expires_at, created_at) VALUES (?, ?, ?, '[]', ?, ?, ?)`, [orderId, sid, k, status, now + 86_400_000, now]);
    await ins("cs_test_1", "k1", "open");
    await expect(ins("cs_test_2", "k2", "open")).rejects.toThrow(/Duplicate/);
    await pool.query(`UPDATE stripe_checkout_sessions SET status = 'expired' WHERE stripe_session_id = 'cs_test_1'`);
    await ins("cs_test_2", "k2", "open");
  });

  it("la correspondencia de precio es única por precio aprobado y por lookup_key", async () => {
    const ins = (price: string, lk: string) =>
      pool.query(`INSERT INTO stripe_prices (web_price_id, stripe_product_id, stripe_price_id, lookup_key, created_at, synced_at) VALUES (?, 'prod_test_1', ?, ?, ?, ?)`, [webPriceId, price, lk, now, now]);
    await ins("price_test_1", "es:essential:monthly:eur:v1");
    await expect(ins("price_test_2", "es:essential:monthly:eur:v2")).rejects.toThrow(/Duplicate/);
  });

  it("vuelta y otra vez ida (0013 y 0012, en orden inverso)", async () => {
    await run(livemode.down);
    await run(stripe.down);
    expect(await tables()).toEqual([]);
    // Lo anterior a 0012 sigue intacto
    const [rows] = (await pool.query(`SELECT COUNT(*) n FROM commercial_orders`)) as unknown as [{ n: number }[]];
    expect(Number(rows[0].n)).toBe(1);
    await run(stripe.up);
    expect((await tables()).length).toBe(7);
    expect(await checks()).toEqual(TEST_CHECKS);
    await run(livemode.up);
    expect(await checks()).toEqual(LIVE_CHECKS);
  });
});
