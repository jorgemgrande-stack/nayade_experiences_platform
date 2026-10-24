/**
 * Gestión de módulos por empresa en el plano de control: PUT idempotente en una sola operación,
 * DELETE sin efectos si no hay licencia, listado de empresas por módulo y permisos.
 * (La semántica transaccional real se prueba contra MySQL en moduleManagement.mysql.test.ts.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp, type ControlPlaneDeps } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import type { Entitlement, EntitlementStatus } from "./_core/modules/entitlements";
import type { ModuleTenantRow } from "./_core/modules/mysqlEntitlements";

const READ = "mm-read-token-aaaaaaaaaaaaaaaaaaaaaaa";
const WRITE = "mm-write-token-bbbbbbbbbbbbbbbbbbbbbb";
const NONE = "mm-none-token-cccccccccccccccccccccc";

type Call = { op: string; args: unknown[] };

function fakeEntitlements() {
  const rows: Entitlement[] = [];
  const calls: Call[] = [];
  const find = (t: string, m: string) => rows.findIndex((e) => e.tenantId === t && e.moduleId === m);
  const api: ControlPlaneDeps["entitlements"] = {
    listEntitlements: async (t) => rows.filter((e) => e.tenantId === t),
    grant: async (...args) => void calls.push({ op: "grant", args }),
    setStatus: async (...args) => void calls.push({ op: "setStatus", args }),
    revoke: async (...args) => void calls.push({ op: "revoke", args }),
    apply: async (t, m, target, actor, reason) => {
      calls.push({ op: "apply", args: [t, m, target, actor, reason] });
      const i = find(t, m);
      const previous = i >= 0 ? { ...rows[i] } : null;
      if (previous && previous.status === target.status && (previous.validUntil?.getTime() ?? null) === (target.validUntil?.getTime() ?? null)) {
        return { changed: false, previous, entitlement: previous };
      }
      const entitlement: Entitlement = { tenantId: t, moduleId: m, status: target.status, validUntil: target.validUntil, source: "crm" };
      if (i >= 0) rows[i] = entitlement;
      else rows.push(entitlement);
      return { changed: true, previous, entitlement };
    },
    remove: async (t, m, actor, reason) => {
      calls.push({ op: "remove", args: [t, m, actor, reason] });
      const i = find(t, m);
      if (i < 0) return { changed: false, previous: null };
      return { changed: true, previous: rows.splice(i, 1)[0] };
    },
    listModuleTenants: async (m, base) => {
      calls.push({ op: "listModuleTenants", args: [m, base] });
      const out: ModuleTenantRow[] = [];
      for (const t of ["uno", "dos"]) {
        const e = rows.find((r) => r.tenantId === t && r.moduleId === m);
        if (!e && !base) continue;
        out.push({
          tenantId: t,
          displayName: t.toUpperCase(),
          tenantStatus: "active",
          licenseStatus: (e?.status ?? null) as EntitlementStatus | null,
          validUntil: e?.validUntil ?? null,
          source: e?.source ?? null,
          updatedAt: e ? new Date("2026-10-01T00:00:00.000Z") : null,
        });
      }
      return out;
    },
    activeCounts: async () => {
      calls.push({ op: "activeCounts", args: [] });
      return new Map([["hotel", 7]]);
    },
  };
  return { api, rows, calls };
}

async function start(overrides: Partial<ControlPlaneDeps> = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  for (const id of ["uno", "dos"]) await registry.createTenant({ id, displayName: id }, { type: "operator", id: "seed" });
  const ents = fakeEntitlements();
  const app = createControlPlaneApp({
    tokens: [
      { id: "r", sha256: hashToken(READ), scopes: ["tenants:read"] },
      { id: "w", sha256: hashToken(WRITE), scopes: ["tenants:read", "entitlements:write"] },
      { id: "n", sha256: hashToken(NONE), scopes: ["usage:read"] },
    ],
    registry,
    reader: reg,
    entitlements: ents.api,
    quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
    platformTarget: "edge.example.com",
    perMinute: 1000,
    ...overrides,
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/cp/v1${path}`,
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
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { call, stop, ents };
}

describe("gestión de licencias por empresa (API)", () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start();
  });
  afterAll(async () => ctx.stop());

  it("PUT aplica el estado final en UNA operación, con motivo e identificador de petición", async () => {
    const { call, ents } = ctx;
    ents.calls.length = 0;
    const r = await call("PUT", "/tenants/uno/entitlements/hotel", WRITE, { status: "suspended", validUntil: "2027-01-01T00:00:00.000Z", reason: "Impago de la cuota" }, { "x-request-id": "req-prueba-1" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      changed: true,
      previous: null,
      entitlement: { moduleId: "hotel", status: "suspended", validUntil: "2027-01-01T00:00:00.000Z", source: "crm" },
      entitlements: [expect.objectContaining({ moduleId: "hotel", status: "suspended" })],
    });
    // sin grant + setStatus encadenados: una única llamada transaccional
    expect(ents.calls.map((c) => c.op)).toEqual(["apply"]);
    const [, , target, actor, reason] = ents.calls[0].args as [string, string, { status: string; validUntil: Date }, { requestId?: string; id: string }, string];
    expect(target.status).toBe("suspended");
    expect(target.validUntil.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(actor).toMatchObject({ id: "w", requestId: "req-prueba-1" });
    expect(reason).toBe("Impago de la cuota");
  });

  it("PUT repetido no cambia nada (changed:false)", async () => {
    const body = { status: "suspended", validUntil: "2027-01-01T00:00:00.000Z" };
    const r = await ctx.call("PUT", "/tenants/uno/entitlements/hotel", WRITE, body);
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(false);
    expect(r.json.previous).toEqual(r.json.entitlement);
  });

  it("PUT valida: módulo inexistente 404, motivo fuera de 5–300 → 400, sin escritura", async () => {
    const { call, ents } = ctx;
    ents.calls.length = 0;
    expect((await call("PUT", "/tenants/uno/entitlements/no_existe", WRITE, {})).status).toBe(404);
    expect((await call("PUT", "/tenants/uno/entitlements/spa", WRITE, { reason: "no" })).status).toBe(400);
    expect((await call("PUT", "/tenants/uno/entitlements/spa", WRITE, { reason: "x".repeat(301) })).status).toBe(400);
    expect(ents.calls).toEqual([]);
  });

  it("DELETE: 404 si el módulo no existe; sin licencia → changed:false; con licencia → previous", async () => {
    const { call, ents } = ctx;
    ents.calls.length = 0;
    const unknown = await call("DELETE", "/tenants/uno/entitlements/no_existe", WRITE);
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ error: "not_found", message: "Módulo desconocido" });
    expect(ents.calls).toEqual([]);

    const none = await call("DELETE", "/tenants/dos/entitlements/spa", WRITE);
    expect(none.status).toBe(200);
    expect(none.json).toEqual({ changed: false, previous: null });

    const done = await call("DELETE", "/tenants/uno/entitlements/hotel?reason=Baja%20solicitada", WRITE);
    expect(done.status).toBe(200);
    expect(done.json).toEqual({ changed: true, previous: { moduleId: "hotel", status: "suspended", validUntil: "2027-01-01T00:00:00.000Z", source: "crm" } });
    expect(ents.calls.at(-1)!.args[3]).toBe("Baja solicitada");

    // un módulo incluido en la base no se retira
    expect((await call("DELETE", "/tenants/uno/entitlements/cms", WRITE)).status).toBe(409);
  });

  it("permisos: escribir exige entitlements:write; leer el listado exige tenants:read", async () => {
    const { call, ents } = ctx;
    ents.calls.length = 0;
    const put = await call("PUT", "/tenants/uno/entitlements/spa", READ, {});
    expect(put.status).toBe(403);
    expect(put.json).toEqual({ error: "forbidden", scope: "entitlements:write" });
    expect((await call("DELETE", "/tenants/uno/entitlements/spa", READ)).status).toBe(403);
    const list = await call("GET", "/modules/hotel/tenants", NONE);
    expect(list.status).toBe(403);
    expect(list.json).toEqual({ error: "forbidden", scope: "tenants:read" });
    expect((await call("GET", "/modules", NONE)).status).toBe(403);
    expect(ents.calls).toEqual([]);
  });

  it("listado de empresas de un módulo sectorial: estado efectivo (caducado por fecha)", async () => {
    const { call, ents } = ctx;
    ents.rows.push(
      { tenantId: "uno", moduleId: "spa", status: "active", validUntil: null, source: "operator" },
      { tenantId: "dos", moduleId: "spa", status: "active", validUntil: new Date(Date.now() - 1000), source: "crm" },
    );
    const r = await call("GET", "/modules/spa/tenants", READ);
    expect(r.status).toBe(200);
    expect(r.json.module).toEqual({ id: "spa", name: expect.any(String), kind: "sector", includedInBase: false });
    expect(r.json.total).toBe(2);
    expect(r.json.active).toBe(1);
    expect(r.json.tenants[0]).toEqual({
      tenantId: "uno",
      displayName: "UNO",
      tenantStatus: "active",
      included: false,
      state: "active",
      license: { status: "active", validUntil: null, source: "operator", updatedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(r.json.tenants[1]).toMatchObject({ tenantId: "dos", state: "expired", license: { status: "active" } });
    expect(ents.calls.filter((c) => c.op === "listModuleTenants").at(-1)!.args).toEqual(["spa", false]);
  });

  it("listado de un módulo incluido en la base: todas las empresas con included:true", async () => {
    const r = await ctx.call("GET", "/modules/cms/tenants", READ);
    expect(r.status).toBe(200);
    expect(r.json.module.includedInBase).toBe(true);
    expect(r.json.tenants.map((t: any) => [t.tenantId, t.included, t.state, t.license])).toEqual([
      ["uno", true, "included", null],
      ["dos", true, "included", null],
    ]);
    expect((await ctx.call("GET", "/modules/no_existe/tenants", READ)).status).toBe(404);
  });

  it("GET /modules usa el recuento agregado (sin N+1 por empresa)", async () => {
    const { call, ents } = ctx;
    ents.calls.length = 0;
    const r = await call("GET", "/modules", READ);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.modules.map((m: any) => [m.id, m]));
    expect(by.hotel.activeTenants).toBe(7);
    expect(by.cms.activeTenants).toBe(2);
    expect(ents.calls.map((c) => c.op)).toEqual(["activeCounts"]);
  });
});

describe("despliegue sin operaciones de gestión", () => {
  it("PUT, DELETE y listado responden 501 si el almacén no las ofrece", async () => {
    const ctx = await start({
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
    });
    try {
      expect((await ctx.call("PUT", "/tenants/uno/entitlements/spa", WRITE, {})).status).toBe(501);
      expect((await ctx.call("DELETE", "/tenants/uno/entitlements/spa", WRITE)).status).toBe(501);
      const l = await ctx.call("GET", "/modules/spa/tenants", READ);
      expect(l.status).toBe(501);
      expect(l.json.message).toMatch(/no disponible/);
    } finally {
      await ctx.stop();
    }
  });
});
