/**
 * Registro de comprobaciones VIES (migración CRM 0021) contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD
 * temporal propia que se borra al terminar).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlStripeStore } from "./store";
import { VatVerifier, type ViesPort } from "./vies";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = `es_vies_${process.pid}`;

describe.skipIf(!URL_)("comprobaciones VIES con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  const dir = path.resolve(__dirname, "../../db/crm/migrations");

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const { migrations, errors } = loadMigrations(dir);
    if (errors.length) throw new Error(errors.join("; "));
    for (const m of migrations) for (const s of splitStatements(m.up)) await pool.query(s);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("registra cada consulta, reutiliza la válida reciente del MISMO modo y lista las de un pedido", async () => {
    let n = 0;
    const vies: ViesPort = { check: async (country, vatNumber) => ({ status: "valid", country, vatNumber, consultationNumber: `WAPI${++n}`, traderName: "ACME SARL", traderAddress: "1 RUE X\nPARIS", detail: null }) };
    const clock = Date.UTC(2026, 9, 20, 10);
    const live = new MysqlStripeStore(pool, "live");
    const test = new MysqlStripeStore(pool, "test");
    expect(await live.hasVatCheckTable()).toBe(true);
    const a = await new VatVerifier({ vies, store: live, now: () => clock }).verify("FR", "FR12345678901", { orderId: 42 });
    expect(a).toMatchObject({ status: "valid", consultationNumber: "WAPI1", reused: false });
    expect(await new VatVerifier({ vies, store: live, now: () => clock + 1000 }).verify("FR", "12345678901")).toMatchObject({ consultationNumber: "WAPI1", reused: true });
    // Pruebas no reutiliza la de live (cada entorno, su evidencia)
    expect(await test.lastValidVatCheck("FR", "12345678901")).toBeNull();
    expect(await new VatVerifier({ vies, store: test, now: () => clock }).verify("FR", "12345678901")).toMatchObject({ consultationNumber: "WAPI2", reused: false });
    expect(await live.vatChecksOfOrder(42)).toEqual([expect.objectContaining({ country: "FR", vatNumber: "12345678901", status: "valid", consultationNumber: "WAPI1", traderName: "ACME SARL", checkedAt: clock, orderId: 42 })]);
  });

  it("reversión de 0021: sin la tabla no hay evidencia y la verificación responde «no disponible» sin consultar", async () => {
    for (const s of splitStatements(fs.readFileSync(path.join(dir, "0021_vat_checks.down.sql"), "utf8"))) await pool.query(s);
    let called = false;
    const vies: ViesPort = { check: async (country, vatNumber) => ((called = true), { status: "valid", country, vatNumber, consultationNumber: "X", traderName: null, traderAddress: null, detail: null }) };
    expect(await new VatVerifier({ vies, store: new MysqlStripeStore(pool, "live") }).verify("FR", "12345678901")).toMatchObject({ status: "unavailable", detail: "storage_missing" });
    expect(called).toBe(false);
  });
});
