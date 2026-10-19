/**
 * Límites contratados y uso declarado contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD del registro
 * aislada, creada y borrada aquí, migrada con el migrador del registro hasta la 0013): idempotencia, aislamiento
 * entre empresas, la BD rechaza valores negativos y el uso declarado nunca retrocede con medidas antiguas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { MysqlTenantLimitStore } from "./_core/limits/store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "registry_limits_test";
const meta = (now: number) => ({ source: "subscription:7", actor: "operator:limites", now });

describe.skipIf(!URL_)("límites contratados con MySQL real (registro 0013)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlTenantLimitStore;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5, multipleStatements: true });
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(r).toMatchObject({ target: "0013", incomplete: [] });
    expect(r.applied).toContain("0013");
    store = new MysqlTenantLimitStore(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("idempotente, solo lo que cambia, aislado por empresa y sin valores negativos", async () => {
    expect(await store.setLimits("t-a", [{ metric: "users", limit: 5 }, { metric: "storage_gb", limit: null }], meta(1))).toEqual([
      { metric: "users", from: undefined, to: 5 },
      { metric: "storage_gb", from: undefined, to: null },
    ]);
    expect(await store.setLimits("t-a", [{ metric: "users", limit: 5 }, { metric: "storage_gb", limit: null }], meta(2))).toEqual([]);
    expect(await store.setLimits("t-a", [{ metric: "users", limit: 4 }], meta(3))).toEqual([{ metric: "users", from: 5, to: 4 }]);
    await store.setLimits("t-b", [{ metric: "users", limit: 15 }], meta(4));
    expect((await store.limits("t-a")).map((l) => [l.metric, l.limit]).sort()).toEqual([
      ["storage_gb", null],
      ["users", 4],
    ]);
    expect((await store.limits("t-b")).map((l) => l.limit)).toEqual([15]);
    await expect(pool.query("INSERT INTO tenant_entitlement_limits VALUES ('t-c','users',-1,'x',1,'x')")).rejects.toThrow();
    await expect(store.setLimits("T A", [{ metric: "users", limit: 1 }], meta(5))).rejects.toThrow(/Tenant no válido/);
  });

  it("el uso declarado sustituye al anterior solo si es más reciente (dos réplicas no lo hacen retroceder)", async () => {
    await store.reportUsage("t-a", "users", 7, 100);
    await store.reportUsage("t-a", "users", 3, 50);
    await store.reportUsage("t-a", "storage_bytes", 1024, 100);
    expect((await store.usage("t-a")).sort((x, y) => x.metric.localeCompare(y.metric))).toEqual([
      { metric: "storage_bytes", used: 1024, measuredAt: 100 },
      { metric: "users", used: 7, measuredAt: 100 },
    ]);
    await Promise.all([store.reportUsage("t-a", "users", 9, 200), store.reportUsage("t-a", "users", 8, 150)]);
    expect((await store.usage("t-a")).find((x) => x.metric === "users")).toEqual({ metric: "users", used: 9, measuredAt: 200 });
    expect(await store.usage("t-b")).toEqual([]);
  });
});
