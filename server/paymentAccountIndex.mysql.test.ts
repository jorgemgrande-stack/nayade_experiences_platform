/**
 * Índice global de cuentas de cobro sobre MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): la migración 0018 se aplica y
 * se revierte con el aplicador real del registro, y la unicidad aguanta altas simultáneas (cada una con su propia conexión).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { MysqlAccountIndex } from "./paymentsConnect/accountIndex";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const acct = (n: string) => `acct_1Indice${n}${crypto.randomBytes(4).toString("hex")}`;

describe.skipIf(!URL_)("índice global de cuentas de cobro (registro 0018, MySQL real)", () => {
  const dbName = `idx_reg_${crypto.randomBytes(3).toString("hex")}`;
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let idx: MysqlAccountIndex;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 4 });
    await admin.query(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${dbName}`;
    pool = mysql.createPool({ uri: u.toString(), multipleStatements: true, connectionLimit: 40 });
    await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    idx = new MysqlAccountIndex(pool);
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it("la migración crea la tabla; el estado del registro llega a 0018", async () => {
    const [v] = await pool.query("SELECT v FROM registry_meta WHERE k = 'schema_version'");
    expect(String((v as any[])[0].v) >= "0018").toBe(true);
    const [t] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'tenant_payment_accounts'");
    expect((t as any[])[0].n).toBe(1);
  });

  it("25 empresas piden a la vez la misma cuenta: exactamente una la consigue", async () => {
    const a = acct("A");
    const r = await Promise.all(Array.from({ length: 25 }, (_, i) => idx.claim(`empresa-${i}`, "test", a)));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok).every((x) => !x.ok && x.reason === "taken")).toBe(true);
    const owner = await idx.tenantOf(a);
    expect(owner).toMatch(/^empresa-\d+$/);
    // y la ganadora sigue siendo la duena al repetir (idempotente)
    expect(await idx.claim(owner!, "test", a)).toEqual({ ok: true, alreadyOwned: true });
  });

  it("una empresa pide a la vez dos cuentas distintas en el mismo modo: solo una; en el otro modo sí", async () => {
    const [x, y] = [acct("X"), acct("Y")];
    const r = await Promise.all([idx.claim("solo-una", "test", x), idx.claim("solo-una", "test", y)]);
    expect(r.filter((q) => q.ok)).toHaveLength(1);
    expect(r.find((q) => !q.ok)).toEqual({ ok: false, reason: "tenant_has_other" });
    expect((await idx.claim("solo-una", "live", acct("Z"))).ok).toBe(true);
  });

  it("la cuenta de una empresa no se resuelve como de otra; cuentas desconocidas o mal formadas no resuelven", async () => {
    const a = acct("Q");
    await idx.claim("duena", "test", a);
    expect(await idx.tenantOf(a)).toBe("duena");
    expect(await idx.tenantOf(acct("N"))).toBeNull();
    expect(await idx.tenantOf("'; DROP TABLE x;--")).toBeNull();
  });

  it("la reversión (down) elimina la tabla y deja el marcador en 0017; reaplicar la recrea", async () => {
    const down = (await import("node:fs")).readFileSync(path.resolve(__dirname, "../db/registry/0018_payment_account_index.down.sql"), "utf8");
    await pool.query(down);
    const [t] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'tenant_payment_accounts'");
    expect((t as any[])[0].n).toBe(0);
    await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    const [t2] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'tenant_payment_accounts'");
    expect((t2 as any[])[0].n).toBe(1);
  });
});
