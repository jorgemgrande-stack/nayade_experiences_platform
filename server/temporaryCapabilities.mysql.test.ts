/**
 * Concesión temporal de capacidades con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; corre en la CI bloqueante
 * `core-suites`): concurrencia dentro de la transacción de `apply`, no pisar otras fuentes y barrido idempotente.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MysqlCapabilityStore } from "./_core/capabilities/store";
import { TemporaryCapabilities } from "./controlPlane/temporaryCapabilities";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "cap_temp_registry_test";
const T = "alta-correo-20261024c";
const CAP = "accounting-general";
const H = 3_600_000;
const REASON = "verificación funcional de Contabilidad General #41";

describe.skipIf(!URL_)("concesión temporal de capacidades con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlCapabilityStore;
  let clock = Date.UTC(2026, 10, 27, 12);
  let svc: TemporaryCapabilities;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8, multipleStatements: true });
    await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(new MysqlTenantRegistryStore(pool), () => ring);
    await registry.createTenant({ id: T, displayName: "Prueba" }, { type: "operator", id: "test" });
    store = new MysqlCapabilityStore(pool);
    svc = new TemporaryCapabilities({ store, now: () => clock, environment: () => "alta-correo" });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  const input = () => ({ capabilityId: CAP, reason: REASON, expiresAt: clock + 2 * H });

  it("dos concesiones simultáneas: una gana, la otra 409, y un solo evento", async () => {
    const r = await Promise.allSettled([svc.grant(T, input(), "operator:a"), svc.grant(T, input(), "operator:b")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "conflict" });
    const ev = await store.events(T);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: "operator", toStatus: "active", fromStatus: null });
    expect(ev[0].reason).toContain(REASON);
  });

  it("barrido: pasa a suspended con system:expiry, idempotente; después se puede conceder de nuevo", async () => {
    clock += 3 * H;
    expect(await svc.sweep()).toBe(1);
    expect(await svc.sweep()).toBe(0);
    expect((await store.list(T))[0].status).toBe("suspended");
    expect((await store.events(T))[0]).toMatchObject({ actor: "system:expiry", reason: "caducidad automática", fromStatus: "active", toStatus: "suspended" });
    expect((await svc.grant(T, input(), "operator:a")).grant.status).toBe("active");
  });

  it("no pisa una capacidad concedida por suscripción (la guarda se ejecuta dentro de la transacción)", async () => {
    await pool.query("DELETE FROM tenant_capabilities WHERE tenant_id = ?", [T]);
    await store.apply(T, [{ capabilityId: CAP, siteId: "", status: "active", validUntil: null, source: "subscription:9" }], { actor: "system", reason: "alta", now: clock });
    await expect(svc.grant(T, input(), "operator:a")).rejects.toMatchObject({ code: "conflict" });
    expect((await store.list(T))[0]).toMatchObject({ source: "subscription:9", status: "active", validUntil: null });
    expect(await svc.sweep()).toBe(0);
  });
});
