/**
 * Resource Manager en el plano de control: cuotas efectivas (override + defecto), consumo del
 * periodo en curso frente al límite (80 % / 100 %), vista global, historial y retirada de
 * overrides, filtro de incidencias por tenant y ámbitos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { effectiveQuotas, stateFor, tenantResources, UNMEASURED } from "./_core/erm/overview";
import { MemoryUsageStore, hourOf } from "./_core/erm/usage";
import type { Quota, QuotaPeriod } from "./_core/erm/types";
import type { DefaultQuota } from "./_core/erm/quota";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { IncidentService, MemoryIncidentStore } from "./_core/ops/incidents";

const NOW = Date.UTC(2026, 9, 15, 10, 30);
const DEFAULTS: DefaultQuota[] = [
  { metric: "http.request", period: "minute", limit: 1200, enforcement: "hard" },
  { metric: "email.sent", period: "day", limit: 100, enforcement: "hard" },
  { metric: "storage.write.bytes", period: "month", limit: 1000, enforcement: "hard" },
];

class FakeQuotas {
  rows: Quota[] = [];
  removed: Array<[string, string, string, Actor]> = [];
  async listQuotas(tenantId: string) {
    return this.rows.filter((q) => q.tenantId === tenantId);
  }
  async set(q: Quota) {
    this.rows = this.rows.filter((x) => !(x.tenantId === q.tenantId && x.metric === q.metric && x.period === q.period)).concat(q);
  }
  async remove(tenantId: string, metric: string, period: QuotaPeriod, actor: Actor) {
    this.removed.push([tenantId, metric, period, actor]);
    this.rows = this.rows.filter((x) => !(x.tenantId === tenantId && x.metric === metric && x.period === period));
  }
}

describe("cálculo de recursos", () => {
  it("override del tenant sustituye al valor por defecto de la misma métrica y periodo", () => {
    const eff = effectiveQuotas([{ tenantId: "t", metric: "email.sent", period: "day", limit: 500, enforcement: "soft" }], DEFAULTS);
    expect(eff.find((q) => q.metric === "email.sent")).toMatchObject({ limit: 500, enforcement: "soft", source: "tenant" });
    expect(eff.filter((q) => q.source === "default").map((q) => q.metric).sort()).toEqual(["http.request", "storage.write.bytes"]);
  });

  it("umbrales 80 % y 100 %", () => {
    expect(stateFor(79, 100)).toEqual({ ratio: 0.79, state: "ok" });
    expect(stateFor(80, 100).state).toBe("warning");
    expect(stateFor(100, 100).state).toBe("exceeded");
    expect(stateFor(null, 100)).toEqual({ ratio: null, state: "not_applicable" });
    expect(stateFor(0, 0).state).toBe("ok");
    expect(stateFor(1, 0).state).toBe("exceeded");
  });

  it("solo cuenta el periodo en curso; el ritmo por minuto no se acumula", async () => {
    const usage = new MemoryUsageStore();
    const today = hourOf(NOW);
    const yesterday = today - 24 * 3_600_000;
    await usage.add([
      { tenantId: "t1", metric: "email.sent", hourStart: today, quantity: 60 },
      { tenantId: "t1", metric: "email.sent", hourStart: today - 3_600_000, quantity: 25 },
      { tenantId: "t1", metric: "email.sent", hourStart: yesterday, quantity: 999 },
      { tenantId: "t1", metric: "storage.write.bytes", hourStart: yesterday, quantity: 400 },
      { tenantId: "t2", metric: "email.sent", hourStart: today, quantity: 100 },
    ]);
    const q = new FakeQuotas();
    const r = await tenantResources({ quotas: q, usage, defaults: DEFAULTS }, "t1", NOW);
    const email = r.rows.find((x) => x.metric === "email.sent")!;
    expect(email).toMatchObject({ used: 85, ratio: 0.85, state: "warning", source: "default", windowStart: Date.UTC(2026, 9, 15) });
    expect(r.rows.find((x) => x.metric === "storage.write.bytes")).toMatchObject({ used: 400, state: "ok" });
    expect(r.rows.find((x) => x.metric === "http.request")).toMatchObject({ used: null, state: "not_applicable" });
    expect(r).toMatchObject({ worst: "warning", maxRatio: 0.85 });
    expect((await tenantResources({ quotas: q, usage, defaults: DEFAULTS }, "t2", NOW)).worst).toBe("exceeded");
  });
});

describe("API del Resource Manager", () => {
  let server: http.Server;
  let noUsage: http.Server;
  let port: number;
  let port2: number;
  const quotas = new FakeQuotas();
  const OPS = "erm-ops-token-aaaaaaaaaaaaaaaaaaaaaaaa";
  const USAGE_ONLY = "erm-usage-token-bbbbbbbbbbbbbbbbbbbbb";
  const READER = "erm-read-token-cccccccccccccccccccccc";
  const CORE = "erm-core-token-dddddddddddddddddddddd";
  const OP: Actor = { type: "operator", id: "test" };

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["calma", "lleno", "alerta"]) await registry.createTenant({ id, displayName: id.toUpperCase() }, OP);
    const usage = new MemoryUsageStore();
    const h = hourOf(Date.now());
    await usage.add([
      { tenantId: "lleno", metric: "email.sent", hourStart: h, quantity: 150 },
      { tenantId: "alerta", metric: "email.sent", hourStart: h, quantity: 85 },
      { tenantId: "calma", metric: "email.sent", hourStart: h, quantity: 1 },
    ]);
    await quotas.set({ tenantId: "calma", metric: "email.sent", period: "day", limit: 50, enforcement: "soft" });
    const incidents = new IncidentService(new MemoryIncidentStore());
    await incidents.raise({ dedupeKey: "quota:lleno:email.sent:day", kind: "quota.near", severity: "critical", title: "Cuota", tenantId: "lleno" });
    await incidents.raise({ dedupeKey: "quota:alerta:email.sent:day", kind: "quota.near", severity: "warning", title: "Cuota", tenantId: "alerta" });
    // Historial: el lector devuelve eventos de cuotas (los escribe QuotaAdmin en MySQL)
    const reader = Object.assign(Object.create(reg), {
      listEvents: async (id: string) => [
        { id: 1, tenantId: id, at: new Date(1), actorType: "operator", actorId: "ana", action: "quota.set", fromState: null, toState: null, details: { metric: "email.sent", period: "day", limit: 50 }, requestId: null },
        { id: 2, tenantId: id, at: new Date(2), actorType: "system", actorId: "x", action: "status.changed", fromState: null, toState: null, details: null, requestId: null },
      ],
    });
    const base = {
      tokens: [
        { id: "ops", sha256: hashToken(OPS), scopes: ["usage:read", "tenants:read", "quotas:write", "ops:read"] as const },
        { id: "usage", sha256: hashToken(USAGE_ONLY), scopes: ["usage:read"] as const },
        { id: "reader", sha256: hashToken(READER), scopes: ["tenants:read"] as const },
        { id: "core", sha256: hashToken(CORE), scopes: ["commerce:purchase"] as const },
      ].map((t) => ({ ...t, scopes: [...t.scopes] })),
      registry,
      reader,
      entitlements: { listEntitlements: async () => [], grant: async () => undefined, setStatus: async () => undefined, revoke: async () => undefined },
      quotas,
      platformTarget: "edge.example.com",
      quotaDefaults: DEFAULTS,
      ops: { incidents },
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

  const call = (method: string, path: string, token: string, p = port) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: p, path: `/cp/v1${path}`, method, headers: { authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("vista global ordenada por gravedad, con filtro de alertas y recursos sin medición", async () => {
    const r = await call("GET", "/resources/overview", OPS);
    expect(r.status).toBe(200);
    // Orden por gravedad: excedido, aviso, correcto
    expect(r.json.tenants.map((t: any) => t.tenantId)).toEqual(["lleno", "alerta", "calma"]);
    const byId = Object.fromEntries(r.json.tenants.map((t: any) => [t.tenantId, t]));
    expect(byId.lleno.worst).toBe("exceeded");
    expect(byId.alerta.worst).toBe("warning");
    expect(byId.calma.worst).toBe("ok");
    expect(byId.calma.rows.find((x: any) => x.metric === "email.sent")).toMatchObject({ source: "tenant", limit: 50, used: 1 });
    expect(r.json.tenants[0].tenantId).toBe("lleno");
    expect(r.json.unmeasured.length).toBe(UNMEASURED.length);
    const alerts = await call("GET", "/resources/overview?alerts=1", OPS);
    expect(alerts.json.tenants.map((t: any) => t.tenantId).sort()).toEqual(["alerta", "lleno"]);
  });

  it("ámbitos: la vista global exige usage:read y tenants:read", async () => {
    expect((await call("GET", "/resources/overview", USAGE_ONLY)).status).toBe(403);
    expect((await call("GET", "/resources/overview", READER)).status).toBe(403);
    expect((await call("GET", "/tenants/lleno/resources", READER)).status).toBe(403);
    expect((await call("GET", "/tenants/lleno/resources", USAGE_ONLY)).json).toMatchObject({ available: true, tenantId: "lleno", worst: "exceeded" });
    expect((await call("GET", "/tenants/nadie/resources", USAGE_ONLY)).status).toBe(404);
    expect((await call("DELETE", "/tenants/calma/quotas/email.sent/day", READER)).status).toBe(403);
  });

  it("historial de cuotas y retirada auditada del override", async () => {
    const h = await call("GET", "/tenants/calma/quotas/history", READER);
    expect(h.json.history).toEqual([{ at: new Date(1).toISOString(), action: "quota.set", actor: "operator:ana", details: { metric: "email.sent", period: "day", limit: 50 } }]);
    expect((await call("DELETE", "/tenants/calma/quotas/email.sent/hour", OPS)).status).toBe(404);
    expect((await call("DELETE", "/tenants/calma/quotas/Email!/day", OPS)).status).toBe(400);
    const d = await call("DELETE", "/tenants/calma/quotas/email.sent/day", OPS);
    expect(d.status).toBe(200);
    expect(d.json.quotas).toEqual([]);
    expect(quotas.removed[0].slice(0, 3)).toEqual(["calma", "email.sent", "day"]);
    expect(quotas.removed[0][3]).toMatchObject({ id: "ops" }); // atribuido al actor del token
    // Tras retirar el override vuelve el valor por defecto
    const r = await call("GET", "/tenants/calma/resources", OPS);
    expect(r.json.rows.find((x: any) => x.metric === "email.sent")).toMatchObject({ source: "default", limit: 100 });
  });

  it("incidencias filtradas por tenant", async () => {
    const r = await call("GET", "/incidents?tenantId=alerta", OPS);
    expect(r.json.incidents.map((i: any) => i.tenantId)).toEqual(["alerta"]);
    expect((await call("GET", "/incidents?tenantId=../x", OPS)).status).toBe(400);
  });

  it("sin medición configurada lo indica en lugar de inventar ceros", async () => {
    expect((await call("GET", "/resources/overview", OPS, port2)).json).toMatchObject({ available: false });
  });

  it("panel de la empresa: solo su consumo, con nombres legibles y sin límites de ritmo", async () => {
    const r = await call("GET", "/commerce/tenants/alerta/usage", CORE);
    expect(r.status).toBe(200);
    expect(r.json.usage.available).toBe(true);
    const email = r.json.usage.rows.find((x: any) => x.metric === "email.sent");
    expect(email).toMatchObject({ label: "Correos enviados", period: "day", periodLabel: "hoy", used: 85, limit: 100, state: "warning", enforcement: "hard" });
    expect(r.json.usage.rows.some((x: any) => x.metric === "http.request")).toBe(false);
    // Aislamiento: otra empresa ve solo su propio consumo
    const calma = (await call("GET", "/commerce/tenants/calma/usage", CORE)).json.usage.rows.find((x: any) => x.metric === "email.sent");
    expect(calma).toMatchObject({ used: 1, state: "ok" });
    const lleno = (await call("GET", "/commerce/tenants/lleno/usage", CORE)).json.usage.rows.find((x: any) => x.metric === "email.sent");
    expect(lleno).toMatchObject({ used: 150, state: "exceeded" });
  });

  it("panel de la empresa: exige el ámbito del Core y, sin medición, no inventa cifras", async () => {
    expect((await call("GET", "/commerce/tenants/alerta/usage", USAGE_ONLY)).status).toBe(403);
    expect((await call("GET", "/commerce/tenants/alerta/usage", CORE, port2)).json.usage).toMatchObject({ available: false, rows: [] });
    expect((await call("GET", "/commerce/tenants/NO%20VALIDO/usage", CORE)).status).toBe(400);
  });
});
