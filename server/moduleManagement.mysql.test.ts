/**
 * Gestión de módulos por empresa contra MySQL real (opt-in): idempotencia, una sola transacción,
 * auditoría con from/to/request_id, DELETE sin fila sin evento y listado por módulo aislado.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:…@127.0.0.1:3341/registry_test \
 *     pnpm exec vitest run server/moduleManagement.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { EntitlementAdmin } from "./_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "./_core/erm/mysqlQuotas";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

const WRITE = "mmsql-write-token-aaaaaaaaaaaaaaaaaaaa";
const READ = "mmsql-read-token-bbbbbbbbbbbbbbbbbbbbb";

describe.skipIf(!URL_)("gestión de módulos con MySQL real", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const REG = `mmreg_${run}`;
  const A = `mma-${run}`;
  const B = `mmb-${run}`;
  const GONE = `mmz-${run}`;
  let root: mysql.Pool;
  let pool: mysql.Pool;
  let admin: EntitlementAdmin;
  let server: http.Server;
  let port: number;

  const call = (method: string, p: string, token: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1${p}`,
          method,
          headers: { authorization: `Bearer ${token}`, ...headers, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });

  const events = async (tenantId: string) => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action, from_state, to_state, details, request_id, actor_id FROM tenant_events WHERE tenant_id = ? AND action LIKE 'entitlement.%' ORDER BY id",
      [tenantId],
    );
    return rows.map((r) => ({ ...r, details: typeof r.details === "string" ? JSON.parse(r.details) : r.details }));
  };
  const version = async (tenantId: string) => {
    const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT registry_version FROM tenants WHERE id = ?", [tenantId]);
    return Number(r[0].registry_version);
  };

  beforeAll(async () => {
    root = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await root.query(`CREATE DATABASE \`${REG}\``);
    pool = mysql.createPool({ uri: withDb(URL_!, REG), connectionLimit: 6, multipleStatements: true });
    await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    const store = new MysqlTenantRegistryStore(pool);
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(store, () => ring);
    const OP = { type: "operator" as const, id: "seed" };
    for (const id of [A, B, GONE]) await registry.createTenant({ id, displayName: `Empresa ${id}` }, OP);
    admin = new EntitlementAdmin(pool);
    const app = createControlPlaneApp({
      tokens: [
        { id: "crm-w", sha256: hashToken(WRITE), scopes: ["tenants:read", "entitlements:write"] },
        { id: "crm-r", sha256: hashToken(READ), scopes: ["tenants:read"] },
      ],
      registry,
      reader: store,
      entitlements: admin,
      quotas: new QuotaAdmin(pool),
      platformTarget: "edge.example.com",
      perMinute: 1000,
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
    await pool?.end();
    await root?.query(`DROP DATABASE IF EXISTS \`${REG}\``);
    await root?.end();
  });

  it("dos PUT iguales → un solo evento y la versión del registro sube una sola vez", async () => {
    const v0 = await version(A);
    const body = { validUntil: "2027-03-01T10:00:00.000Z", reason: "Alta del módulo de hotel" };
    const first = await call("PUT", `/tenants/${A}/entitlements/hotel`, WRITE, body, { "x-request-id": "req-alta-1" });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      changed: true,
      previous: null,
      entitlement: { moduleId: "hotel", status: "active", validUntil: "2027-03-01T10:00:00.000Z", source: "crm" },
    });
    const second = await call("PUT", `/tenants/${A}/entitlements/hotel`, WRITE, body, { "x-request-id": "req-alta-2" });
    expect(second.status).toBe(200);
    expect(second.json.changed).toBe(false);
    expect(second.json.entitlement).toEqual(first.json.entitlement);
    expect(await version(A)).toBe(v0 + 1);
    const ev = await events(A);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      action: "entitlement.granted",
      from_state: null,
      to_state: "active",
      request_id: "req-alta-1",
      actor_id: "crm-w",
      details: { moduleId: "hotel", validUntil: "2027-03-01T10:00:00.000Z", reason: "Alta del módulo de hotel" },
    });
  });

  it("suspender es UNA transacción: un evento active→suspended, sin paso intermedio", async () => {
    const v0 = await version(A);
    const r = await call("PUT", `/tenants/${A}/entitlements/hotel`, WRITE, { status: "suspended", validUntil: "2027-03-01T10:00:00.000Z", reason: "Impago de la cuota" }, { "x-request-id": "req-susp" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ changed: true, previous: { status: "active" }, entitlement: { status: "suspended" } });
    expect(await version(A)).toBe(v0 + 1);
    const ev = await events(A);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ action: "entitlement.status", from_state: "active", to_state: "suspended", request_id: "req-susp", details: { reason: "Impago de la cuota" } });
    expect((await admin.listEntitlements(A)).map((e) => [e.moduleId, e.status])).toEqual([["hotel", "suspended"]]);
    // otro suspender idéntico no deja rastro
    await call("PUT", `/tenants/${A}/entitlements/hotel`, WRITE, { status: "suspended", validUntil: "2027-03-01T10:00:00.000Z" });
    expect(await events(A)).toHaveLength(2);
  });

  it("cambiar solo la fecha deja un evento entitlement.updated con la fecha anterior", async () => {
    const r = await call("PUT", `/tenants/${A}/entitlements/hotel`, WRITE, { status: "suspended", validUntil: null });
    expect(r.json.changed).toBe(true);
    const last = (await events(A)).at(-1)!;
    expect(last).toMatchObject({ action: "entitlement.updated", from_state: "suspended", to_state: "suspended", details: { validUntil: null, previousValidUntil: "2027-03-01T10:00:00.000Z" } });
  });

  it("DELETE: sin fila → sin evento ni versión; módulo inexistente → 404; con fila → evento con estado previo", async () => {
    const v0 = await version(B);
    const none = await call("DELETE", `/tenants/${B}/entitlements/spa`, WRITE);
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ changed: false, previous: null });
    expect(await events(B)).toHaveLength(0);
    expect(await version(B)).toBe(v0);

    expect((await call("DELETE", `/tenants/${B}/entitlements/no_existe`, WRITE)).status).toBe(404);
    expect((await call("PUT", `/tenants/${B}/entitlements/no_existe`, WRITE, {})).status).toBe(404);
    expect(await events(B)).toHaveLength(0);

    const del = await call("DELETE", `/tenants/${A}/entitlements/hotel?reason=Baja%20solicitada`, WRITE, undefined, { "x-request-id": "req-baja" });
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ changed: true, previous: { moduleId: "hotel", status: "suspended", validUntil: null, source: "crm" } });
    const last = (await events(A)).at(-1)!;
    expect(last).toMatchObject({ action: "entitlement.revoked", from_state: "suspended", to_state: null, request_id: "req-baja", details: { moduleId: "hotel", reason: "Baja solicitada" } });
    expect(await admin.listEntitlements(A)).toEqual([]);
    // segundo DELETE: idempotente
    const again = await call("DELETE", `/tenants/${A}/entitlements/hotel`, WRITE);
    expect(again.json.changed).toBe(false);
    expect((await events(A)).filter((e) => e.action === "entitlement.revoked")).toHaveLength(1);
  });

  it("permisos: escritura sin entitlements:write → 403 y sin efectos", async () => {
    const before = await events(B);
    expect((await call("PUT", `/tenants/${B}/entitlements/spa`, READ, {})).status).toBe(403);
    expect((await call("DELETE", `/tenants/${B}/entitlements/spa`, READ)).status).toBe(403);
    expect(await events(B)).toEqual(before);
    expect(await admin.listEntitlements(B)).toEqual([]);
  });

  it("listado por módulo: una consulta, solo hechos del registro, sin empresas borradas", async () => {
    await admin.apply(A, "spa", { status: "active", validUntil: null }, { type: "operator", id: "t" });
    await admin.apply(B, "spa", { status: "suspended", validUntil: null }, { type: "crm", id: "t" });
    await admin.apply(GONE, "spa", { status: "active", validUntil: null }, { type: "operator", id: "t" });
    await admin.apply(B, "restaurants", { status: "active", validUntil: null }, { type: "operator", id: "t" });
    await pool.query("UPDATE tenants SET status = 'deleted' WHERE id = ?", [GONE]);

    const r = await call("GET", "/modules/spa/tenants", READ);
    expect(r.status).toBe(200);
    expect(r.json.module).toMatchObject({ id: "spa", includedInBase: false });
    expect(r.json.tenants.map((t: any) => t.tenantId)).toEqual([A, B]);
    expect(r.json.total).toBe(2);
    expect(r.json.active).toBe(1);
    const b = r.json.tenants.find((t: any) => t.tenantId === B);
    expect(b).toEqual({
      tenantId: B,
      displayName: `Empresa ${B}`,
      tenantStatus: expect.any(String),
      included: false,
      state: "suspended",
      license: { status: "suspended", validUntil: null, source: "crm", updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    });
    // aislamiento: solo las claves previstas; nada de otras tablas (DSN, dominios…) ni de otros módulos
    for (const t of r.json.tenants) {
      expect(Object.keys(t).sort()).toEqual(["displayName", "included", "license", "state", "tenantId", "tenantStatus"]);
      expect(Object.keys(t.license).sort()).toEqual(["source", "status", "updatedAt", "validUntil"]);
    }
    expect(JSON.stringify(r.json)).not.toMatch(/dsn|cipher|restaurants|mysql:/i);

    const base = await call("GET", "/modules/cms/tenants", READ);
    expect(base.json.tenants.map((t: any) => [t.tenantId, t.included, t.state])).toEqual([
      [A, true, "included"],
      [B, true, "included"],
    ]);

    // recuento agregado de GET /modules: spa activo solo en A (B suspendida, GONE borrada)
    const cat = await call("GET", "/modules", READ);
    const by = Object.fromEntries(cat.json.modules.map((m: any) => [m.id, m]));
    expect(by.spa.activeTenants).toBe(1);
    expect(by.restaurants.activeTenants).toBe(1);
    expect(by.hotel.activeTenants).toBe(0);
    expect(by.cms.activeTenants).toBe(2);
  });
});
