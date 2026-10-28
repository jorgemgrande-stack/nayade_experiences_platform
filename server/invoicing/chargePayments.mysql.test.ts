/**
 * Cobro de cargos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con todas las migraciones del CRM):
 * alta, búsqueda por sesión, actualización de estado y entornos separados (CRM 0029).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlChargePaymentStore } from "./chargePayments";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "charge_payments_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 10, 15, 9);

describe.skipIf(!URL_)("cobro de cargos con MySQL real (CRM 0029)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0029_charge_payments");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("alta, búsqueda por sesión, cobro registrado y entornos separados", async () => {
    const test = new MysqlChargePaymentStore(pool, "test");
    const live = new MysqlChargePaymentStore(pool, "live");
    const p = await test.insert({ chargeId: 3, kind: "stripe_link", status: "open", amountCents: 50_000, totalCents: 60_500, currency: "EUR", stripeSessionId: "cs_test_1", stripePaymentIntentId: null, reference: null, expiresAt: T + 3_600_000, createdBy: "operator:ana", createdAt: T, paidAt: null });
    expect(p).toMatchObject({ chargeId: 3, status: "open", totalCents: 60_500 });
    expect((await test.bySession("cs_test_1"))?.id).toBe(p.id);
    expect(await live.bySession("cs_test_1")).toBeNull();
    const paid = await test.update(p.id, { status: "paid", stripePaymentIntentId: "pi_1", paidAt: T + 60_000 }, T + 60_000);
    expect(paid).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_1", paidAt: T + 60_000 });
    await test.insert({ chargeId: 3, kind: "offline", status: "paid", amountCents: 50_000, totalCents: 60_500, currency: "EUR", stripeSessionId: null, stripePaymentIntentId: null, reference: "TRF-1", expiresAt: null, createdBy: "operator:jefa", createdAt: T + 1, paidAt: T + 1 });
    expect((await test.byCharge(3)).map((x) => x.kind)).toEqual(["offline", "stripe_link"]);
    expect(await live.byCharge(3)).toEqual([]);
  });
});
