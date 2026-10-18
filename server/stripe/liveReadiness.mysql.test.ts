/**
 * Comprobaciones de arranque del modo live contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada
 * creada y borrada aquí): la 0013 entera y registrada, y ningún dato del entorno de pruebas en una BD live.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { liveOrdersProblem, liveSchemaProblem } from "./liveReadiness";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "stripe_live_ready_test";
const now = Date.UTC(2026, 9, 18, 12);

describe.skipIf(!URL_)("arranque del modo live con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let orderId = 0;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(path.resolve(__dirname, "../../db/crm/migrations"));
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
    const [c] = (await pool.query(`INSERT INTO crm_companies (name, created_at) VALUES ('Empresa Arranque Live', ?)`, [now])) as unknown as [{ insertId: number }];
    const [o] = (await pool.query(`INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, request_json, created_at, created_by) VALUES ('clave-arranque-live-0001', REPEAT('d', 64), 'new', 'contracted', ?, '{}', ?, 't')`, [c.insertId, now])) as unknown as [{ insertId: number }];
    orderId = o.insertId;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("esquema: la 0013 entera (seis CHECK y mode con 'live'), registrada y sin migraciones a medias", async () => {
    expect(await liveSchemaProblem(pool)).toBeNull();
    // Falta cualquiera de las seis restricciones (no solo la de precios)
    await pool.query("ALTER TABLE stripe_events DROP CHECK chk_stripe_event_livemode, ADD CONSTRAINT chk_stripe_event_test CHECK (livemode = 0)");
    expect(await liveSchemaProblem(pool)).toBe("migration_0013_missing");
    await pool.query("ALTER TABLE stripe_events DROP CHECK chk_stripe_event_test, ADD CONSTRAINT chk_stripe_event_livemode CHECK (livemode IN (0,1))");
    // commercial_payments.mode sin 'live'
    await pool.query("ALTER TABLE commercial_payments MODIFY COLUMN mode ENUM('test') NOT NULL DEFAULT 'test'");
    expect(await liveSchemaProblem(pool)).toBe("migration_0013_missing");
    await pool.query("ALTER TABLE commercial_payments MODIFY COLUMN mode ENUM('test','live') NOT NULL DEFAULT 'test'");
    // Registro del ejecutor: 0013 sin registrar, y luego una migración a medias
    await pool.query("CREATE TABLE __elephant_migrations (id VARCHAR(128) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL)");
    await pool.query("CREATE TABLE __elephant_migrations_meta (k VARCHAR(64) NOT NULL PRIMARY KEY, v VARCHAR(255) NOT NULL)");
    expect(await liveSchemaProblem(pool)).toBe("migration_0013_not_recorded");
    await pool.query("INSERT INTO __elephant_migrations (id, checksum) VALUES ('0013_stripe_livemode', REPEAT('0', 64))");
    expect(await liveSchemaProblem(pool)).toBeNull();
    await pool.query("INSERT INTO __elephant_migrations_meta (k, v) VALUES ('in_progress', 'up:0014_x')");
    expect(await liveSchemaProblem(pool)).toBe("migration_in_progress");
    await pool.query("DROP TABLE __elephant_migrations_meta");
    await pool.query("DROP TABLE __elephant_migrations");
  });

  it("datos: un pago de prueba cobrado en un pedido vivo, o otro prefijo guardado, impiden montar pedidos en live", async () => {
    expect(await liveOrdersProblem(pool, "live")).toBeNull();
    await pool.query("INSERT INTO stripe_sync_state (name, value_json, locked_until, updated_at) VALUES ('namespace', ?, NULL, ?)", [JSON.stringify({ namespace: "beta" }), now]);
    expect(await liveOrdersProblem(pool, "live")).toBe("namespace_mismatch");
    await pool.query("UPDATE stripe_sync_state SET value_json = ? WHERE name = 'namespace'", [JSON.stringify({ namespace: "live" })]);
    expect(await liveOrdersProblem(pool, "live")).toBeNull();
    const pay = (key: string, mode: string, status: string) =>
      pool.query("INSERT INTO commercial_payments (order_id, idempotency_key, purpose, amount_cents, currency, status, provider, mode, created_at) VALUES (?, ?, 'initial', 2900, 'EUR', ?, 'simulated', ?, ?)", [orderId, key, status, mode, now]);
    await pay("arranque-test-pendiente", "test", "pending");
    await pay("arranque-live-cobrado", "live", "succeeded");
    expect(await liveOrdersProblem(pool, "live")).toBeNull();
    await pay("arranque-test-cobrado", "test", "succeeded");
    expect(await liveOrdersProblem(pool, "live")).toBe("test_payments_in_live");
    // En un pedido terminado ya no cuenta
    await pool.query("UPDATE commercial_orders SET state = 'cancelled' WHERE id = ?", [orderId]);
    expect(await liveOrdersProblem(pool, "live")).toBeNull();
  });
});
