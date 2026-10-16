/**
 * Licencias por capacidad con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): migración 0008 del
 * registro con el migrador real, aplicación atómica con historial, concurrencia y restricciones.
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
import { CapabilityAccess } from "./_core/capabilities/access";
import { MysqlOrganizationStore } from "./organization/service";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "cap_registry_test";

describe.skipIf(!URL_)("licencias por capacidad con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlCapabilityStore;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8, multipleStatements: true });
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(r.applied).toEqual(expect.arrayContaining(["0008", "0009"]));
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(new MysqlTenantRegistryStore(pool), () => ring);
    await registry.createTenant({ id: "acme", displayName: "Acme" }, { type: "operator", id: "test" });
    store = new MysqlCapabilityStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("aplica en una transacción, registra un evento por cambio y es idempotente", async () => {
    const ch = [
      { capabilityId: "crm-leads", siteId: "", status: "active" as const, validUntil: null, source: "subscription:1" },
      { capabilityId: "people-hr", siteId: "", status: "contracted" as const, validUntil: 1_900_000_000_000, source: "subscription:1" },
    ];
    expect(await store.apply("acme", ch, { actor: "operator:ana", reason: "Alta", now: 1 })).toHaveLength(2);
    expect(await store.apply("acme", ch, { actor: "operator:ana", reason: "Alta", now: 2 })).toEqual([]);
    const list = await store.list("acme");
    expect(list.map((g) => [g.capabilityId, g.status, g.validUntil]).sort()).toEqual([["crm-leads", "active", null], ["people-hr", "contracted", 1_900_000_000_000]]);
    const ev = await store.events("acme");
    expect(ev.map((e) => [e.capabilityId, e.fromStatus, e.toStatus])).toEqual(expect.arrayContaining([["crm-leads", null, "active"], ["people-hr", null, "contracted"]]));
  });

  it("altas simultáneas de empresas distintas: ninguna falla por interbloqueo (se reintenta) y cada una recibe lo suyo", async () => {
    const registry = new TenantRegistryService(new MysqlTenantRegistryStore(pool), () =>
      keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv),
    );
    const ids = Array.from({ length: 8 }, (_, i) => `par-${i}`);
    for (const id of ids) await registry.createTenant({ id, displayName: id }, { type: "operator", id: "test" });
    const caps = ["crm-contacts", "crm-accounts", "crm-leads", "crm-quotes", "shop-catalog", "shop-orders", "cms-editor", "bill-invoices", "admin-panel", "admin-users"];
    for (let round = 0; round < 3; round++) {
      const r = await Promise.allSettled(
        ids.map((id) => store.apply(id, caps.map((c) => ({ capabilityId: c, siteId: "", status: "active" as const, validUntil: 1_900_000_000_000 + round, source: "subscription:1" })), { actor: "t", reason: null, now: 100 + round })),
      );
      expect(r.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
    }
    for (const id of ids) expect((await store.list(id)).every((g) => g.validUntil === 1_900_000_000_002)).toBe(true);
  });

  it("aplicaciones concurrentes sobre el mismo tenant se serializan sin perder historial", async () => {
    const statuses = ["active", "suspended", "read_only", "active", "suspended", "active"] as const;
    await Promise.all(statuses.map((s, i) => store.apply("acme", [{ capabilityId: "tax-filings", siteId: "", status: s, validUntil: null, source: "operator" }], { actor: `op:${i}`, reason: "carrera", now: 10 + i })));
    const final = (await store.list("acme")).find((g) => g.capabilityId === "tax-filings")!;
    const ev = (await store.events("acme")).filter((e) => e.capabilityId === "tax-filings").reverse();
    // El historial encadena exactamente los estados por los que pasó y acaba en el vigente
    for (let i = 1; i < ev.length; i++) expect(ev[i].fromStatus).toBe(ev[i - 1].toStatus);
    expect(ev[ev.length - 1].toStatus).toBe(final.status);
  });

  it("la BD impide tenants inexistentes e ids de capacidad no válidos", async () => {
    await expect(store.apply("no-existe", [{ capabilityId: "crm-leads", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "t", reason: null, now: 1 })).rejects.toThrow();
    await expect(store.apply("acme", [{ capabilityId: "Mal Id", siteId: "", status: "active", validUntil: null, source: "operator" }], { actor: "t", reason: null, now: 1 })).rejects.toThrow();
  });

  it("el Core lee las licencias del registro y decide", async () => {
    const access = new CapabilityAccess(store, { enforce: true });
    expect((await access.check("crm-leads", { write: true, tenantId: "acme" })).allowed).toBe(true);
    expect((await access.check("people-hr", { write: false, tenantId: "acme" })).allowed).toBe(false);
  });
  it("sedes y entidades fiscales (0009): claves ajenas, NIF único por empresa e id de sede válido", async () => {
    const org = new MysqlOrganizationStore(pool);
    const base = { tenantId: "acme", country: "ES", address: null, isDefault: true, status: "active" as const, createdAt: 1, createdBy: "t", updatedAt: 1 };
    await org.insertFiscalEntity({ ...base, entityId: "acme-sl", legalName: "Acme SL", taxId: "B12345678" });
    await expect(org.insertFiscalEntity({ ...base, entityId: "otra", legalName: "Otra", taxId: "B12345678" })).rejects.toMatchObject({ code: "conflict" });
    const site = { tenantId: "acme", name: "Central", status: "active" as const, createdAt: 1, createdBy: "t", updatedAt: 1 };
    await org.insertSite({ ...site, siteId: "central", fiscalEntityId: "acme-sl" });
    await expect(org.insertSite({ ...site, siteId: "norte", fiscalEntityId: "no-existe" })).rejects.toThrow();
    await expect(org.insertSite({ ...site, siteId: "Mal Id", fiscalEntityId: null })).rejects.toThrow();
    await org.updateSite("acme", "central", { status: "archived", updatedAt: 2 });
    expect((await org.sites("acme")).map((x) => [x.siteId, x.status, x.fiscalEntityId])).toEqual([["central", "archived", "acme-sl"]]);
  });
});
