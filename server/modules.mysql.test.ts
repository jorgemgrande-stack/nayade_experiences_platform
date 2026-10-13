/**
 * Licencias y migraciones de módulos contra MySQL real (opt-in).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/modules.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { EntitlementAdmin, MysqlEntitlementReader } from "./_core/modules/mysqlEntitlements";
import { ModuleAccess } from "./_core/modules/entitlements";
import { ModuleRegistry } from "./_core/modules/registry";
import { applyModuleMigrations, planModuleMigrations } from "./_core/modules/migrations";
import type { ModuleManifest } from "./_core/modules/contract";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const ACTOR = { type: "operator", id: "test" } as const;

const hotel: ModuleManifest = {
  id: "hotel",
  name: "Hotel",
  version: "1.0.0",
  kind: "sector",
  coreRange: "*",
  migrationsDir: "migrations",
};

describe.skipIf(!URL_)("módulos con MySQL real", () => {
  let pool: mysql.Pool;
  let tmp: string;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 4 });
    await pool.query("DROP DATABASE IF EXISTS mod_tenant");
    await pool.query("CREATE DATABASE mod_tenant");
    await pool.query("DROP TABLE IF EXISTS tenant_entitlements");
    // asegura el esquema base del registro y la tabla de licencias
    for (const file of ["0000_registry.sql", "0001_entitlements.sql"]) {
      if (file === "0000_registry.sql") {
        const exists = await pool.query("SHOW TABLES LIKE 'tenants'");
        if ((exists[0] as any[]).length) continue;
      }
      const ddl = fs.readFileSync(path.resolve(__dirname, "../db/registry", file), "utf8").replace(/^--.*$/gm, "");
      for (const stmt of ddl.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
    }
    await pool.query("DELETE FROM tenant_events WHERE tenant_id IN ('mod-a','mod-b')").catch(() => undefined);
    await pool.query("INSERT IGNORE INTO tenants (id, display_name, status) VALUES ('mod-a','A','active'),('mod-b','B','active')");

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es-mod-"));
    fs.mkdirSync(path.join(tmp, "migrations"));
    fs.writeFileSync(
      path.join(tmp, "migrations", "0001_rooms.sql"),
      "CREATE TABLE hotel_rooms (id INT PRIMARY KEY, name VARCHAR(50));\n",
    );
    fs.writeFileSync(path.join(tmp, "migrations", "0001_rooms.down.sql"), "DROP TABLE hotel_rooms;\n");
  });

  afterAll(async () => {
    await pool?.query("DROP DATABASE IF EXISTS mod_tenant");
    await pool?.end();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("concede, suspende y revoca licencias con auditoría en la misma transacción", async () => {
    const admin = new EntitlementAdmin(pool);
    await admin.grant("mod-a", "hotel", ACTOR);
    expect((await admin.listEntitlements("mod-a")).map((e) => [e.moduleId, e.status])).toEqual([["hotel", "active"]]);
    expect(await admin.listEntitlements("mod-b")).toEqual([]);

    await admin.setStatus("mod-a", "hotel", "suspended", ACTOR);
    expect((await admin.listEntitlements("mod-a"))[0].status).toBe("suspended");

    await admin.revoke("mod-a", "hotel", ACTOR);
    expect(await admin.listEntitlements("mod-a")).toEqual([]);

    const [ev] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action FROM (SELECT id, action FROM tenant_events WHERE tenant_id = 'mod-a' AND action LIKE 'entitlement.%' ORDER BY id DESC LIMIT 3) x ORDER BY id",
    );
    expect(ev.map((e) => e.action)).toEqual(["entitlement.granted", "entitlement.status", "entitlement.revoked"]);
  });

  it("un tenant inexistente no recibe licencias", async () => {
    await expect(new EntitlementAdmin(pool).grant("no-existe", "hotel", ACTOR)).rejects.toThrow();
  });

  it("ModuleAccess sobre MySQL: aplica la licencia del tenant", async () => {
    const admin = new EntitlementAdmin(pool);
    await admin.grant("mod-b", "hotel", ACTOR);
    const reg = new ModuleRegistry("1.0.0");
    reg.register({ ...hotel, migrationsDir: undefined });
    const access = new ModuleAccess(reg, new MysqlEntitlementReader(pool), { enforce: true, ttlMs: 0 });
    expect(await access.isModuleAvailable("hotel", "mod-b")).toBe(true);
    expect(await access.isModuleAvailable("hotel", "mod-a")).toBe(false);
  });

  it("migraciones de módulo: dry-run, aplicación idempotente e inmutabilidad", async () => {
    const tenantUrl = new URL(URL_!);
    tenantUrl.pathname = "/mod_tenant";
    const tpool = mysql.createPool({ uri: tenantUrl.toString(), multipleStatements: true, connectionLimit: 3 });
    try {
      const plan = await planModuleMigrations(tpool, hotel, tmp);
      expect(plan.pending.map((m) => m.id)).toEqual(["0001_rooms"]);

      const dry = await applyModuleMigrations(tpool, hotel, tmp);
      expect(dry.ran).toEqual([]);
      expect((await tpool.query("SHOW TABLES LIKE 'hotel_rooms'"))[0]).toHaveLength(0);

      const ran = await applyModuleMigrations(tpool, hotel, tmp, { apply: true });
      expect(ran.ran).toEqual(["0001_rooms"]);
      expect((await tpool.query("SHOW TABLES LIKE 'hotel_rooms'"))[0]).toHaveLength(1);

      const again = await applyModuleMigrations(tpool, hotel, tmp, { apply: true });
      expect(again.ran).toEqual([]);

      fs.writeFileSync(path.join(tmp, "migrations", "0001_rooms.sql"), "CREATE TABLE hotel_rooms (id INT);\n");
      await expect(planModuleMigrations(tpool, hotel, tmp)).rejects.toThrow(/ha cambiado/);
    } finally {
      await tpool.end();
    }
  });
});
