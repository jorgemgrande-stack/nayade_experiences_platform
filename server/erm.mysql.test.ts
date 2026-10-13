/**
 * ERM contra MySQL real (opt-in): almacén de uso, cuotas del registro y motor.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/erm.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MysqlUsageStore, UsageAggregator } from "./_core/erm/usage";
import { QuotaAdmin } from "./_core/erm/mysqlQuotas";
import { QuotaEngine } from "./_core/erm/quota";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const ACTOR = { type: "operator", id: "test" } as const;

function run(pool: mysql.Pool, file: string) {
  const ddl = fs.readFileSync(path.resolve(__dirname, file), "utf8").replace(/^--.*$/gm, "");
  return ddl
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce((p, stmt) => p.then(() => pool.query(stmt)).then(() => undefined), Promise.resolve());
}

describe.skipIf(!URL_)("ERM con MySQL real", () => {
  let pool: mysql.Pool;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 4 });
    const [t] = await pool.query("SHOW TABLES LIKE 'tenants'");
    if (!(t as unknown[]).length) await run(pool, "../db/registry/0000_registry.sql");
    await pool.query("DROP TABLE IF EXISTS tenant_quotas, usage_hourly");
    await run(pool, "../db/registry/0002_quotas.sql");
    await run(pool, "../db/erm/0000_usage.sql");
    await pool.query("INSERT IGNORE INTO tenants (id, display_name, status) VALUES ('erm-a','A','active'),('erm-b','B','active')");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("acumula con UPSERT por cubo horario y separa tenants", async () => {
    const store = new MysqlUsageStore(pool);
    const h = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    await store.add([
      { tenantId: "erm-a", metric: "email.sent", hourStart: h, quantity: 3 },
      { tenantId: "erm-b", metric: "email.sent", hourStart: h, quantity: 50 },
    ]);
    await store.add([{ tenantId: "erm-a", metric: "email.sent", hourStart: h, quantity: 4 }]);
    expect(await store.sum("erm-a", "email.sent", h, h + 3_600_000)).toBe(7);
    expect(await store.sum("erm-b", "email.sent", h, h + 3_600_000)).toBe(50);
    expect((await store.list("erm-a", h, h + 3_600_000))[0]).toMatchObject({ metric: "email.sent", quantity: 7 });
  });

  it("cuotas del registro con auditoría; el motor las aplica", async () => {
    const admin = new QuotaAdmin(pool);
    await admin.set({ tenantId: "erm-a", metric: "email.sent", period: "day", limit: 10, enforcement: "hard" }, ACTOR);
    expect(await admin.listQuotas("erm-a")).toEqual([
      { tenantId: "erm-a", metric: "email.sent", period: "day", limit: 10, enforcement: "hard" },
    ]);
    expect(await admin.listQuotas("erm-b")).toEqual([]);

    const store = new MysqlUsageStore(pool);
    const engine = new QuotaEngine(admin, store, new UsageAggregator(store), { applyDefaults: false, ttlMs: 0 });
    expect((await engine.check("email.sent", 3, "erm-a")).allowed).toBe(true); // 7 + 3 = 10
    expect((await engine.check("email.sent", 4, "erm-a")).allowed).toBe(false);
    expect((await engine.check("email.sent", 4, "erm-b")).allowed).toBe(true); // sin cuota propia, sin defaults

    const [ev] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action FROM tenant_events WHERE tenant_id = 'erm-a' AND action LIKE 'quota.%'",
    );
    expect(ev.map((e) => e.action)).toContain("quota.set");

    await admin.remove("erm-a", "email.sent", "day", ACTOR);
    expect(await admin.listQuotas("erm-a")).toEqual([]);
  });
});
