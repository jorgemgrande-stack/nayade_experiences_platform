/**
 * Resource Manager — gestión: anomalías, estado de los recolectores, exportación, política de exceso y tarifas
 * editables y auditadas (concurrencia optimista). Lógica pura y API (`/cp/v1/resources/*`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";
import { OVERAGE_POLICY, collectorStatus, detectAnomalies, exportDailyCsv } from "./_core/erm/insights";
import { CostModelConflict, MemoryCostModelStore, activeCostModel } from "./_core/erm/costModelStore";
import { ESTIMATED_COST_MODEL } from "./_core/erm/costs";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const H = 3_600_000;
const DAY = 86_400_000;

describe("anomalías del último día completo", () => {
  const days = (n: number, v: Record<string, number>, last: Record<string, number>) => {
    const m = new Map<string, Record<string, number>>();
    for (let i = 1; i <= n; i++) m.set(new Date(Date.UTC(2026, 9, 24) - i * DAY).toISOString().slice(0, 10), { ...v });
    m.set("2026-10-24", last);
    return m;
  };
  it("pico: muy por encima de la referencia y del umbral; un día normal no avisa", () => {
    expect(detectAnomalies("a", days(14, { "http.request": 1000 }, { "http.request": 1100 }), "2026-10-24")).toEqual([]);
    const a = detectAnomalies("a", days(14, { "http.request": 1000 }, { "http.request": 9000 }), "2026-10-24");
    expect(a).toEqual([{ tenantId: "a", metric: "http.request", date: "2026-10-24", value: 9000, baseline: 1000, kind: "spike", factor: 9 }]);
  });
  it("por debajo del umbral mínimo no hay aviso (ruido de empresas pequeñas)", () => {
    expect(detectAnomalies("a", days(14, { "email.sent": 1 }, { "email.sent": 40 }), "2026-10-24")).toEqual([]);
  });
  it("caída a cero con referencia alta: posible fallo de medición o de servicio", () => {
    expect(detectAnomalies("a", days(14, { "http.request": 2000 }, {}), "2026-10-24")).toEqual([expect.objectContaining({ metric: "http.request", kind: "drop", value: 0, baseline: 2000 })]);
  });
});

describe("recolectores y exportación", () => {
  const NOW = Date.UTC(2026, 9, 24, 12, 30);
  it("ok con datos recientes, retrasado sin datos en más de 3 h, sin datos en 48 h", async () => {
    const u = new MemoryUsageStore();
    await u.add([
      { tenantId: "a", metric: "http.request", hourStart: hourOf(NOW), quantity: 5 },
      { tenantId: "b", metric: "http.request", hourStart: hourOf(NOW) - 6 * H, quantity: 5 },
    ]);
    const r = Object.fromEntries((await collectorStatus(u, ["a", "b", "c"], NOW)).map((x) => [x.tenantId, x]));
    expect(r.a.state).toBe("ok");
    expect(r.b).toMatchObject({ state: "stale", ageHours: 5.5 });
    expect(r.c).toMatchObject({ state: "no_data", lastHour: null });
  });
  it("CSV diario en día de Madrid, por empresa y métrica, con BOM y sin datos personales", async () => {
    const u = new MemoryUsageStore();
    // 23:00 UTC del 23/10 = 01:00 del 24/10 en Madrid (verano)
    await u.add([
      { tenantId: "a", metric: "http.request", hourStart: Date.UTC(2026, 9, 23, 23), quantity: 2 },
      { tenantId: "a", metric: "http.request", hourStart: Date.UTC(2026, 9, 24, 10), quantity: 3 },
      { tenantId: "b", metric: "email.sent", hourStart: Date.UTC(2026, 9, 24, 10), quantity: 1 },
    ]);
    const csv = await exportDailyCsv(u, ["a", "b"], Date.UTC(2026, 9, 23), Date.UTC(2026, 9, 25));
    expect(csv.startsWith("﻿empresa,metrica,dia,cantidad\r\n")).toBe(true);
    expect(csv).toContain("a,http.request,2026-10-24,5\r\n");
    expect(csv).toContain("b,email.sent,2026-10-24,1\r\n");
  });
  it("la política de exceso nunca suspende automáticamente", () => {
    expect(OVERAGE_POLICY.approved).toBe(false);
    expect(OVERAGE_POLICY.suspension).toMatch(/Nunca automática/);
  });
});

describe("tarifas editables y auditadas", () => {
  const MODEL = { rates: [{ metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.2 }], sharedMonthlyCents: 1000, sharedBasis: "http.request" };
  it("sin tarifas guardadas manda el entorno o la estimación; guardadas, las de Admin con su versión", async () => {
    expect(activeCostModel(null, { model: ESTIMATED_COST_MODEL, error: null })).toMatchObject({ origin: "estimación", version: null });
    const s = new MemoryCostModelStore();
    await s.save(MODEL, { expectedVersion: 0, reason: "Factura de octubre", actor: "operator:jorge", now: 1 });
    expect(activeCostModel(await s.get(), { model: ESTIMATED_COST_MODEL, error: null })).toMatchObject({ origin: "admin", version: 1, model: { source: "configuración", sharedMonthlyCents: 1000 } });
  });
  it("dos personas no se pisan: guardar sobre una versión vieja se rechaza; todo queda en el historial", async () => {
    const s = new MemoryCostModelStore();
    await s.save(MODEL, { expectedVersion: 0, reason: "Primera versión", actor: "operator:a", now: 1 });
    await s.save({ ...MODEL, sharedMonthlyCents: 2000 }, { expectedVersion: 1, reason: "Ajuste", actor: "operator:b", now: 2 });
    await expect(s.save(MODEL, { expectedVersion: 1, reason: "Tarde", actor: "operator:a", now: 3 })).rejects.toBeInstanceOf(CostModelConflict);
    expect((await s.history(10)).map((h) => [h.version, h.changedBy, h.reason])).toEqual([
      [2, "operator:b", "Ajuste"],
      [1, "operator:a", "Primera versión"],
    ]);
  });
});

describe("API del Resource Manager", () => {
  let server: http.Server;
  let port: number;
  const FULL = "gestion-full-token-aaaaaaaaaaaaaaaaaaaa";
  const READ = "gestion-read-token-bbbbbbbbbbbbbbbbbbbb";
  const OP: Actor = { type: "operator", id: "test" };
  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["alfa", "beta"]) await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
    const usage = new MemoryUsageStore();
    await usage.add([{ tenantId: "alfa", metric: "http.request", hourStart: hourOf(Date.now()), quantity: 7 }]);
    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "full", sha256: hashToken(FULL), scopes: ["usage:read", "billing:read", "billing:write", "tenants:read"] },
          { id: "read", sha256: hashToken(READ), scopes: ["usage:read", "billing:read", "tenants:read"] },
        ] as never,
        registry,
        reader: reg,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
        quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
        platformTarget: "edge.example.com",
        usage,
        costModelStore: new MemoryCostModelStore(),
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const call = (method: string, path: string, token: string | null, body?: unknown) =>
    new Promise<{ status: number; text: string; json: any; type: string }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json" } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => {
            let json: any = null;
            try {
              json = b ? JSON.parse(b) : null;
            } catch {
              /* CSV */
            }
            resolve({ status: res.statusCode ?? 0, text: b, json, type: String(res.headers["content-type"] ?? "") });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });

  it("tarifas: estimación al principio; guardar con motivo y versión; conflicto con versión vieja; historial", async () => {
    const r0 = await call("GET", "/resources/rates", READ);
    expect(r0.json).toMatchObject({ editable: true, origin: "estimación", version: 0, history: [] });
    const model = { rates: [{ metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.2 }], sharedMonthlyCents: 500, sharedBasis: "http.request" };
    expect((await call("PUT", "/resources/rates", READ, { model, expectedVersion: 0, reason: "Factura real" })).status).toBe(403);
    expect((await call("PUT", "/resources/rates", FULL, { model, expectedVersion: 0 })).status).toBe(400);
    expect((await call("PUT", "/resources/rates", FULL, { model: { rates: [{ metric: "X Y" }] }, expectedVersion: 0, reason: "Factura real" })).status).toBe(400);
    expect((await call("PUT", "/resources/rates", FULL, { model, expectedVersion: 0, reason: "Factura real" })).json).toMatchObject({ version: 1, updatedBy: expect.stringContaining("full") });
    const conflict = await call("PUT", "/resources/rates", FULL, { model, expectedVersion: 0, reason: "Otra vez" });
    expect(conflict.status).toBe(409);
    expect(conflict.json.currentVersion).toBe(1);
    const r1 = await call("GET", "/resources/rates", READ);
    expect(r1.json).toMatchObject({ origin: "admin", version: 1, model: { sharedMonthlyCents: 500 } });
    expect(r1.json.history).toHaveLength(1);
    // El coste ya usa las tarifas de Admin y lo dice
    expect((await call("GET", "/resources/costs", READ)).json.model).toMatchObject({ origin: "admin", version: 1 });
  });

  it("anomalías, recolectores, exportación y política responden con datos reales", async () => {
    expect((await call("GET", "/resources/anomalies", READ)).json).toMatchObject({ available: true, anomalies: [] });
    const c = await call("GET", "/resources/collectors", READ);
    expect(c.json.summary).toEqual({ ok: 1, stale: 0, noData: 1 });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const e = await call("GET", `/resources/export?from=${today}&to=${today}`, READ);
    expect(e.status).toBe(200);
    expect(e.type).toMatch(/text\/csv/);
    expect(e.text).toContain(`alfa,http.request,${today},7`);
    expect((await call("GET", `/resources/export?from=2026-01-01&to=2026-12-31`, READ)).status).toBe(400);
    expect((await call("GET", `/resources/export?from=${today}&to=${today}&tenant=no-existe`, READ)).status).toBe(404);
    expect((await call("GET", "/resources/policy", READ)).json.approved).toBe(false);
    expect((await call("GET", "/resources/anomalies", null)).status).toBe(401);
  });
});
