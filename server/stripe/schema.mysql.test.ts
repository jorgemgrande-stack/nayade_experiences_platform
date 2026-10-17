/**
 * Migración 0012_stripe_billing contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y
 * borrada aquí): ida, vuelta y otra vez ida; la BD rechaza cualquier fila «live»; unicidad de la
 * correspondencia (precio, cliente por empresa, una sesión de Checkout abierta por pedido, un evento
 * por id).
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

describe.skipIf(!URL_)("migración 0012_stripe_billing con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let stripe: { up: string; down: string };
  let orderId = 0;
  let companyId = 0;
  let webPriceId = 0;

  const tables = async () =>
    ((await pool.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'stripe\\_%' ORDER BY 1`, [DB]))[0] as { t: string }[]).map((r) => r.t);
  const run = async (sql: string) => {
    for (const s of splitStatements(sql)) await pool.query(s);
  };

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

  it("la BD rechaza filas live en todas las tablas con datos de Stripe", async () => {
    await expect(pool.query(`INSERT INTO stripe_customers (company_id, stripe_customer_id, livemode, created_at) VALUES (?, 'cus_live_x', 1, ?)`, [companyId, now])).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO stripe_prices (web_price_id, stripe_product_id, stripe_price_id, lookup_key, livemode, created_at, synced_at) VALUES (?, 'prod_x', 'price_x', 'es:x', 1, ?, ?)`, [webPriceId, now, now]),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO stripe_events (event_id, type, stripe_created, source, status, livemode, received_at) VALUES ('evt_live', 'invoice.paid', 1, 'webhook', 'received', 1, ?)`, [now]),
    ).rejects.toThrow();
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

  it("vuelta y otra vez ida", async () => {
    await run(stripe.down);
    expect(await tables()).toEqual([]);
    // Lo anterior a 0012 sigue intacto
    const [rows] = (await pool.query(`SELECT COUNT(*) n FROM commercial_orders`)) as unknown as [{ n: number }[]];
    expect(Number(rows[0].n)).toBe(1);
    await run(stripe.up);
    expect((await tables()).length).toBe(7);
  });
});
