/**
 * API de política de consumo y excepciones comerciales (plano de control, memoria): desglose del límite efectivo,
 * alta con la cuota original calculada en el servidor, revocación, historial, validación y ámbitos (lectura con
 * `tenants:read`, escritura con `quotas:write`). Sin la migración 0016, las rutas de excepciones responden 501.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { MemoryQuotaExceptionStore } from "./_core/erm/quotaExceptions";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { MemoryTenantLimitStore } from "./_core/limits/store";
import { capabilitiesOfTier } from "./catalog/capabilities";
import type { Quota } from "./_core/erm/types";

const DAY = 86_400_000;
const WRITER = "quota-writer-token-aaaaaaaaaaaaaaaaaaaa";
const READER = "quota-reader-token-bbbbbbbbbbbbbbbbbbbb";
const USAGE = "quota-usage-token-cccccccccccccccccccc";
const OP: Actor = { type: "operator", id: "test" };

describe("API de política de consumo y excepciones de cuota", () => {
  let server: http.Server;
  let bare: http.Server;
  let port: number;
  let port2: number;
  const exceptions = new MemoryQuotaExceptionStore();

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["t5-pilot", "otra"]) await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
    const caps = new MemoryCapabilityStore();
    await caps.apply("t5-pilot", capabilitiesOfTier("essential").map((capabilityId) => ({ capabilityId, siteId: "", status: "active" as const, validUntil: null, source: "trial:5" })), { actor: "operator:x", reason: "Alta", now: 1 });
    const limits = new MemoryTenantLimitStore();
    await limits.setLimits("t5-pilot", [{ metric: "users", limit: 4 }], { source: "subscription:1", actor: "operator:x", now: 1 });
    const quotas: Quota[] = [];
    const base = {
      tokens: [
        { id: "writer", sha256: hashToken(WRITER), scopes: ["tenants:read", "quotas:write"] },
        { id: "reader", sha256: hashToken(READER), scopes: ["tenants:read"] },
        { id: "usage", sha256: hashToken(USAGE), scopes: ["usage:read"] },
      ],
      registry,
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async (t: string) => quotas.filter((q) => q.tenantId === t), set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      quotaDefaults: [{ metric: "email.sent", period: "day" as const, limit: 1000, enforcement: "hard" as const }],
      capabilities: caps,
      limits,
    };
    server = http.createServer(createControlPlaneApp({ ...base, quotaExceptions: exceptions } as never));
    bare = http.createServer(createControlPlaneApp(base as never));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    port2 = (bare.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of [server, bare]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  const call = (method: string, path: string, token: string, body?: unknown, p = port) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port: p, path: `/cp/v1${path}`, method, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      req.end(data);
    });

  it("desglose de la política: plan, ampliación y valor por defecto, con su explicación", async () => {
    const r = await call("GET", "/tenants/t5-pilot/quotas/policy", READER);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ tenantId: "t5-pilot", plan: "essential", exceptionsAvailable: true, exceptions: [], thresholds: { warning: 0.8, critical: 0.95 } });
    const b = Object.fromEntries(r.json.business.map((x: any) => [x.metric, x]));
    expect(b.users).toMatchObject({ limit: 4, source: "addon", breakdown: { plan: { key: "essential", included: 3 }, addon: 1 }, explanation: "4 (plan + ampliaciones) · Plan essential: 3 · ampliaciones: +1" });
    expect(b.contacts).toMatchObject({ limit: 10_000, source: "plan", enforcement: "hard" });
    expect(b.orders_month).toMatchObject({ enforcement: "none" });
    expect(r.json.resources.find((x: any) => x.metric === "email.sent")).toMatchObject({ limit: 1000, source: "default" });
    expect((await call("GET", "/tenants/nadie/quotas/policy", READER)).status).toBe(404);
  });

  it("ámbitos: leer con tenants:read; crear y revocar solo con quotas:write", async () => {
    const body = { metric: "users", newLimit: 6, reason: "Temporada de esquí", expiresAt: Date.now() + 10 * DAY };
    expect((await call("GET", "/tenants/t5-pilot/quotas/policy", USAGE)).status).toBe(403);
    expect((await call("GET", "/tenants/t5-pilot/quotas/exceptions", USAGE)).status).toBe(403);
    expect((await call("POST", "/tenants/t5-pilot/quotas/exceptions", READER, body)).status).toBe(403);
    expect((await call("POST", "/tenants/t5-pilot/quotas/exceptions/1/revoke", READER, { reason: "Por error" })).status).toBe(403);
    expect((await call("GET", "/tenants/t5-pilot/quotas/exceptions", READER)).json).toEqual({ exceptions: [] });
  });

  it("alta con la cuota original del servidor, límite efectivo, conflicto, revocación e historial", async () => {
    const expiresAt = Date.now() + 10 * DAY;
    const c = await call("POST", "/tenants/t5-pilot/quotas/exceptions", WRITER, { metric: "users", newLimit: 6, reason: "Temporada de esquí", expiresAt, originalLimit: 1 });
    expect(c.status).toBe(400); // el cliente no fija la cuota original
    const ok = await call("POST", "/tenants/t5-pilot/quotas/exceptions", WRITER, { metric: "users", newLimit: 6, reason: "Temporada de esquí", expiresAt });
    expect(ok.status).toBe(201);
    expect(ok.json.exception).toMatchObject({ tenantId: "t5-pilot", metric: "users", period: "total", originalLimit: 4, newLimit: 6, operator: "crm:writer", state: "active" });
    const p = await call("GET", "/tenants/t5-pilot/quotas/policy", READER);
    expect(p.json.business.find((x: any) => x.metric === "users")).toMatchObject({ limit: 6, source: "exception", contractual: 4 });
    expect((await call("POST", "/tenants/t5-pilot/quotas/exceptions", WRITER, { metric: "users", newLimit: 7, reason: "Otra más", expiresAt })).status).toBe(409);
    // Aislamiento: la otra empresa no la ve
    expect((await call("GET", "/tenants/otra/quotas/exceptions", READER)).json.exceptions).toEqual([]);
    const id = ok.json.exception.id;
    expect((await call("POST", `/tenants/otra/quotas/exceptions/${id}/revoke`, WRITER, { reason: "No es suya" })).status).toBe(404);
    const rv = await call("POST", `/tenants/t5-pilot/quotas/exceptions/${id}/revoke`, WRITER, { reason: "Fin anticipado" });
    expect(rv.json.exception).toMatchObject({ status: "revoked", state: "revoked", revokeReason: "Fin anticipado" });
    expect((await call("POST", `/tenants/t5-pilot/quotas/exceptions/${id}/revoke`, WRITER, { reason: "Otra vez" })).status).toBe(409);
    expect((await call("GET", "/tenants/t5-pilot/quotas/policy", READER)).json.business.find((x: any) => x.metric === "users")).toMatchObject({ limit: 4, source: "addon" });
    const h = await call("GET", "/tenants/t5-pilot/quotas/exceptions/history", READER);
    expect(h.json.history.map((x: any) => [x.action, x.actor])).toEqual([
      ["revoked", "crm:writer"],
      ["created", "crm:writer"],
    ]);
  });

  it("validación: métrica de negocio sin periodo, del Resource Manager con periodo, motivo y caducidad", async () => {
    const expiresAt = Date.now() + DAY;
    const post = (b: Record<string, unknown>) => call("POST", "/tenants/t5-pilot/quotas/exceptions", WRITER, { reason: "Motivo válido", expiresAt, newLimit: 10, ...b });
    expect((await post({ metric: "inventada" })).status).toBe(400);
    expect((await post({ metric: "users", period: "day" })).status).toBe(400);
    expect((await post({ metric: "email.sent", period: "total" })).status).toBe(400);
    expect((await post({ metric: "contacts", reason: "no" })).status).toBe(400);
    expect((await post({ metric: "contacts", expiresAt: Date.now() - 1 })).status).toBe(400);
    expect((await post({ metric: "contacts", newLimit: -5 })).status).toBe(400);
    const erm = await post({ metric: "email.sent", period: "day", newLimit: 5000 });
    expect(erm.status).toBe(201);
    expect(erm.json.exception).toMatchObject({ originalLimit: 1000, newLimit: 5000 });
    const sinTope = await post({ metric: "contacts", newLimit: null });
    expect(sinTope.json.exception).toMatchObject({ originalLimit: 10_000, newLimit: null });
  });

  it("sin la migración 0016: la política se lee y las excepciones responden 501", async () => {
    expect((await call("GET", "/tenants/t5-pilot/quotas/policy", READER, undefined, port2)).json).toMatchObject({ exceptionsAvailable: false, exceptions: [] });
    expect((await call("GET", "/tenants/t5-pilot/quotas/exceptions", READER, undefined, port2)).status).toBe(501);
    expect((await call("POST", "/tenants/t5-pilot/quotas/exceptions", WRITER, { metric: "users", newLimit: 6, reason: "Temporada", expiresAt: Date.now() + DAY }, port2)).status).toBe(501);
  });
});
