/**
 * Excepciones comerciales de cuota contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD del registro aislada,
 * creada y borrada aquí, migrada con el migrador del registro hasta la 0016): alta con historial y evento de auditoría,
 * una sola vigente por cuota, revocación, aislamiento entre empresas, restricciones de la BD, lectura del Core y
 * reversión de la migración con su `.down.sql`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { MysqlQuotaExceptionReader, MysqlQuotaExceptionStore } from "./_core/erm/mysqlQuotas";
import { activeException } from "./_core/erm/policy";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "registry_quota_exc_test";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12);
const input = (p: Record<string, unknown> = {}) => ({ tenantId: "t-a", metric: "users", period: "total" as const, originalLimit: 3, newLimit: 6, reason: "Campaña de invierno", operator: "operator:ana", startsAt: NOW, expiresAt: NOW + 30 * DAY, ...p });

describe.skipIf(!URL_)("excepciones de cuota con MySQL real (registro 0016)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlQuotaExceptionStore;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5, multipleStatements: true });
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(r).toMatchObject({ target: "0016", incomplete: [] });
    expect(r.applied).toContain("0016");
    await pool.query("INSERT INTO tenants (id, display_name) VALUES ('t-a', 'A'), ('t-b', 'B')");
    store = new MysqlQuotaExceptionStore(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("alta con historial y auditoría; una sola vigente; revocación; aislamiento", async () => {
    const a = await store.create(input(), NOW);
    expect(a).toMatchObject({ tenantId: "t-a", metric: "users", newLimit: 6, status: "active" });
    await expect(store.create(input({ newLimit: 9 }), NOW + 1)).rejects.toThrow(/Ya hay una excepción/);
    await expect(store.create(input({ tenantId: "t-nadie" }), NOW)).rejects.toThrow(/Empresa no encontrada/);
    const b = await store.create(input({ tenantId: "t-b", metric: "email.sent", period: "day", newLimit: null }), NOW);
    expect((await store.exceptions("t-b")).map((e) => [e.metric, e.period, e.newLimit])).toEqual([["email.sent", "day", null]]);
    expect((await store.exceptions("t-a")).map((e) => e.id)).toEqual([a.id]);
    await expect(store.revoke("t-a", b.id, { actor: "operator:ana", reason: "No es suya", now: NOW + 2 })).rejects.toThrow(/no encontrada/);
    const r = await store.revoke("t-a", a.id, { actor: "crm:luis", reason: "Fin anticipado", now: NOW + 2 });
    expect(r).toMatchObject({ status: "revoked", revokedBy: "crm:luis", revokeReason: "Fin anticipado" });
    expect(activeException(await new MysqlQuotaExceptionReader(pool).exceptions("t-a"), "users", "total", NOW + 3)).toBeNull();
    const h = await store.history("t-a");
    expect(h.map((x) => [x.action, x.actor, x.details.newLimit])).toEqual([
      ["revoked", "crm:luis", 6],
      ["created", "operator:ana", 6],
    ]);
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT actor_type, actor_id, action FROM tenant_events WHERE tenant_id = 't-a' ORDER BY id");
    expect(ev.map((x) => [x.actor_type, x.actor_id, x.action])).toEqual([
      ["operator", "operator:ana", "quota_exception.created"],
      ["crm", "crm:luis", "quota_exception.revoked"],
    ]);
    // Tras revocar se puede conceder otra
    await expect(store.create(input({ newLimit: 7 }), NOW + 5)).resolves.toMatchObject({ newLimit: 7 });
  });

  it("la BD rechaza fechas invertidas y límites negativos", async () => {
    await expect(pool.query("INSERT INTO tenant_quota_exceptions (tenant_id, metric, reason, operator, starts_at, expires_at, created_at, updated_at) VALUES ('t-a','sites','x','y',10,5,1,1)")).rejects.toThrow();
    await expect(pool.query("INSERT INTO tenant_quota_exceptions (tenant_id, metric, new_limit, reason, operator, starts_at, expires_at, created_at, updated_at) VALUES ('t-a','sites',-1,'x','y',1,5,1,1)")).rejects.toThrow();
  });

  it("la reversión elimina las tablas y deja el registro en 0015", async () => {
    await pool.query(fs.readFileSync(path.resolve(__dirname, "../db/registry/0016_quota_exceptions.down.sql"), "utf8"));
    const [t] = await pool.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'tenant_quota_exception%'");
    expect(t).toEqual([]);
    const [[v]] = (await pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'")) as any;
    expect(v.v).toBe("0015");
    // Y se puede volver a aplicar
    expect((await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false })).applied).toEqual(["0016"]);
  });
});
