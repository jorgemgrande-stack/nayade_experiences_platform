/**
 * Resource Manager — coste atribuible por empresa: modelo (configuración o estimación), coste variable, reparto del
 * coste compartido y API (`GET /cp/v1/resources/costs`, usage:read + billing:read).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ESTIMATED_COST_MODEL, costModelFromEnv, tenantCosts, variableCost, type CostModel } from "./_core/erm/costs";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const MODEL: CostModel = {
  source: "configuración",
  note: "prueba",
  currency: "EUR",
  rates: [
    { metric: "http.response.bytes", label: "Tráfico", unit: "GB", per: 1e9, centsPerUnit: 10 },
    { metric: "email.sent", label: "Correo", unit: "correo", per: 1, centsPerUnit: 0.5 },
  ],
  sharedMonthlyCents: 3000,
  sharedBasis: "http.request",
};

describe("modelo de costes", () => {
  it("sin ERM_COST_MODEL se usa la estimación, y se dice", () => {
    expect(costModelFromEnv({} as NodeJS.ProcessEnv)).toEqual({ model: ESTIMATED_COST_MODEL, error: null });
    expect(ESTIMATED_COST_MODEL.source).toBe("estimación");
    expect(ESTIMATED_COST_MODEL.sharedMonthlyCents).toBe(0);
  });
  it("una configuración válida se usa; una no válida no se usa a medias", () => {
    const ok = costModelFromEnv({ ERM_COST_MODEL: JSON.stringify({ rates: MODEL.rates, sharedMonthlyCents: 3000 }) } as NodeJS.ProcessEnv);
    expect(ok.model).toMatchObject({ source: "configuración", sharedMonthlyCents: 3000, sharedBasis: "http.request" });
    expect(ok.model.rates).toHaveLength(2);
    for (const bad of ["{", JSON.stringify({ rates: [{ metric: "X Y", label: "a", unit: "u", per: 1, centsPerUnit: 1 }] }), JSON.stringify({ rates: [], extra: 1 }), JSON.stringify({ rates: [{ metric: "a.b", label: "a", unit: "u", per: 0, centsPerUnit: 1 }] })]) {
      const r = costModelFromEnv({ ERM_COST_MODEL: bad } as NodeJS.ProcessEnv);
      expect(r.model).toBe(ESTIMATED_COST_MODEL);
      expect(r.error).toMatch(/no es válido/);
    }
  });
  it("coste variable: consumo × tarifa; las métricas sin tarifa no suman", () => {
    const v = variableCost(MODEL, { "http.response.bytes": 2.5e9, "email.sent": 30, "http.request": 999 });
    expect(v.lines.map((l) => [l.metric, l.cents])).toEqual([
      ["http.response.bytes", 25],
      ["email.sent", 15],
    ]);
    expect(v.cents).toBe(40);
  });
  it("estimación: 1 GB de tráfico y 1000 correos", () => {
    const v = variableCost(ESTIMATED_COST_MODEL, { "http.response.bytes": 1e9, "email.sent": 1000 });
    expect(v.cents).toBeCloseTo(4.6 + 140, 5);
  });
});

describe("reparto del coste compartido", () => {
  const NOW = Date.UTC(2026, 9, 24, 12);
  it("proporcional a las peticiones, prorrateado a los días del periodo", async () => {
    const usage = new MemoryUsageStore();
    const h = hourOf(NOW);
    await usage.add([
      { tenantId: "a", metric: "http.request", hourStart: h, quantity: 300 },
      { tenantId: "b", metric: "http.request", hourStart: h, quantity: 100 },
      { tenantId: "a", metric: "email.sent", hourStart: h, quantity: 10 },
      // Fuera del periodo: no cuenta
      { tenantId: "b", metric: "email.sent", hourStart: h - 40 * 86_400_000, quantity: 1000 },
    ]);
    const r = await tenantCosts(usage, MODEL, ["a", "b", "c"], NOW, 15);
    expect(r.sharedPeriodCents).toBe(1500);
    const by = Object.fromEntries(r.tenants.map((t) => [t.tenantId, t]));
    expect(by.a).toMatchObject({ variableCents: 5, sharedCents: 1125, totalCents: 1130, sharedShare: 0.75 });
    expect(by.b).toMatchObject({ variableCents: 0, sharedCents: 375, sharedShare: 0.25 });
    expect(by.c).toMatchObject({ totalCents: 0, sharedShare: 0 });
  });
  it("si nadie consumió la métrica de reparto, a partes iguales", async () => {
    const r = await tenantCosts(new MemoryUsageStore(), MODEL, ["a", "b"], NOW, 30);
    expect(r.tenants.map((t) => t.sharedCents)).toEqual([1500, 1500]);
  });
});

describe("API de costes", () => {
  let server: http.Server;
  let noUsage: http.Server;
  let port: number;
  let port2: number;
  const FULL = "costes-full-token-aaaaaaaaaaaaaaaaaaaa";
  const USAGE_ONLY = "costes-usage-token-bbbbbbbbbbbbbbbbbbb";
  const OP: Actor = { type: "operator", id: "test" };

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["grande", "pequena"]) await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
    const usage = new MemoryUsageStore();
    const h = hourOf(Date.now());
    await usage.add([
      { tenantId: "grande", metric: "http.request", hourStart: h, quantity: 900 },
      { tenantId: "grande", metric: "http.response.bytes", hourStart: h, quantity: 1e9 },
      { tenantId: "pequena", metric: "http.request", hourStart: h, quantity: 100 },
    ]);
    const base = {
      tokens: [
        { id: "full", sha256: hashToken(FULL), scopes: ["usage:read", "billing:read", "tenants:read"] },
        { id: "usage", sha256: hashToken(USAGE_ONLY), scopes: ["usage:read"] },
      ] as Array<{ id: string; sha256: string; scopes: any[] }>,
      registry,
      reader: reg,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
      costModel: { model: MODEL, error: null },
    };
    server = http.createServer(createControlPlaneApp({ ...base, usage }));
    noUsage = http.createServer(createControlPlaneApp(base));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => noUsage.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    port2 = (noUsage.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of [server, noUsage]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  const call = (path: string, token: string, p = port) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: p, path: `/cp/v1${path}`, method: "GET", headers: { authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("costes por empresa, de mayor a menor, con el origen de las tarifas y lo no atribuible", async () => {
    const r = await call("/resources/costs?days=30", FULL);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ available: true, days: 30, currency: "EUR", model: { source: "configuración", error: null }, sharedPeriodCents: 3000 });
    expect(r.json.tenants.map((t: any) => [t.tenantId, t.variableCents, t.sharedCents])).toEqual([
      ["grande", 10, 2700],
      ["pequena", 0, 300],
    ]);
    expect(r.json.tenants[0].displayName).toBe("GRANDE");
    expect(r.json.totals.totalCents).toBe(3010);
    expect(r.json.unattributed.length).toBeGreaterThan(0);
  });

  it("una sola empresa: su parte se calcula entre todas", async () => {
    const r = await call("/resources/costs?tenant=pequena", FULL);
    expect(r.json.tenants).toHaveLength(1);
    expect(r.json.tenants[0]).toMatchObject({ tenantId: "pequena", sharedCents: 300 });
    expect((await call("/resources/costs?tenant=no-existe", FULL)).status).toBe(404);
    expect((await call("/resources/costs?tenant=NO%20VALIDO", FULL)).status).toBe(400);
  });

  it("exige usage:read y billing:read; sin medición, «no configurada»", async () => {
    expect((await call("/resources/costs", USAGE_ONLY)).status).toBe(403);
    expect((await call("/resources/costs", "token-inventado-xxxxxxxxxxxxxxxxxxxx")).status).toBe(401);
    expect((await call("/resources/costs?days=91", FULL)).status).toBe(400);
    const n = await call("/resources/costs", FULL, port2);
    expect(n.status).toBe(200);
    expect(n.json.available).toBe(false);
  });
});
