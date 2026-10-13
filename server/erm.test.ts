/**
 * Elephant Resource Manager: medición, agregación, cuotas con aplicación real, limitadores,
 * guarda HTTP, integración con almacenamiento y correo, y aislamiento entre tenants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const dir = vi.hoisted(() => {
  const fsx = require("node:fs") as typeof import("node:fs");
  const osx = require("node:os") as typeof import("node:os");
  const pathx = require("node:path") as typeof import("node:path");
  const d = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "es-erm-"));
  process.env.LOCAL_STORAGE_PATH = d;
  return d;
});

import { Metrics, meter, setMeterSink } from "./_core/metering";
import { MemoryUsageStore, UsageAggregator, hourOf } from "./_core/erm/usage";
import { QuotaEngine, windowStart, parseDefaultQuotas } from "./_core/erm/quota";
import { TenantConcurrencyLimiter, TenantRateLimiter } from "./_core/erm/limiters";
import { tenantResourceGuard } from "./_core/erm/middleware";
import { installErm, enforceQuota, _resetErmForTests, getErm } from "./_core/erm/runtime";
import { QuotaExceededError, type Quota, type QuotaAlert, type QuotaPolicyReader } from "./_core/erm/types";
import { runWithTenant } from "./_core/tenant";
import { storagePut } from "./storage";

class Policy implements QuotaPolicyReader {
  quotas: Quota[] = [];
  failing = false;
  async listQuotas(tenantId: string) {
    if (this.failing) throw new Error("registro caído");
    return this.quotas.filter((q) => q.tenantId === tenantId);
  }
}

afterEach(async () => {
  delete process.env.TENANT_MODE;
  await _resetErmForTests();
  setMeterSink(null);
});

describe("agregación", () => {
  it("acumula por tenant, métrica y hora; separa tenants", async () => {
    const store = new MemoryUsageStore();
    const agg = new UsageAggregator(store);
    const t = Date.UTC(2026, 9, 13, 10, 30);
    agg.record({ tenantId: "a", metric: "m", quantity: 5, unit: "count", at: t });
    agg.record({ tenantId: "a", metric: "m", quantity: 7, unit: "count", at: t + 60_000 });
    agg.record({ tenantId: "b", metric: "m", quantity: 100, unit: "count", at: t });
    expect(agg.pendingSum("a", "m", hourOf(t), hourOf(t) + 3_600_000)).toBe(12);
    expect(await agg.flush()).toBe(2);
    expect(await store.sum("a", "m", hourOf(t), hourOf(t) + 3_600_000)).toBe(12);
    expect(await store.sum("b", "m", hourOf(t), hourOf(t) + 3_600_000)).toBe(100);
    expect(agg.pendingSum("a", "m", 0, Infinity)).toBe(0);
  });

  it("ignora cantidades no válidas y eventos sin tenant", async () => {
    const agg = new UsageAggregator(new MemoryUsageStore());
    agg.record({ tenantId: "a", metric: "m", quantity: -1, unit: "c", at: 0 });
    agg.record({ tenantId: "a", metric: "m", quantity: NaN, unit: "c", at: 0 });
    agg.record({ tenantId: "unresolved", metric: "m", quantity: 1, unit: "c", at: 0 });
    expect(agg.stats().pendingKeys).toBe(0);
  });

  it("si el almacén falla conserva lo pendiente y lo reintenta", async () => {
    const store = new MemoryUsageStore();
    const agg = new UsageAggregator(store);
    agg.record({ tenantId: "a", metric: "m", quantity: 3, unit: "c", at: 1000 });
    store.setFailing(true);
    expect(await agg.flush()).toBe(0);
    agg.record({ tenantId: "a", metric: "m", quantity: 2, unit: "c", at: 1000 });
    store.setFailing(false);
    expect(await agg.flush()).toBe(1);
    expect(await store.sum("a", "m", 0, 3_600_000)).toBe(5);
  });
});

describe("cuotas: aplicación real", () => {
  let store: MemoryUsageStore;
  let agg: UsageAggregator;
  let policy: Policy;
  let now: number;
  let alerts: QuotaAlert[];
  let engine: QuotaEngine;

  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    store = new MemoryUsageStore();
    now = Date.UTC(2026, 9, 13, 12, 0);
    agg = new UsageAggregator(store, { now: () => now });
    policy = new Policy();
    alerts = [];
    engine = new QuotaEngine(policy, store, agg, {
      now: () => now,
      ttlMs: 0,
      defaults: [],
      alerts: { alert: (a) => alerts.push(a) },
    });
  });

  const use = (tenantId: string, metric: string, q: number) =>
    agg.record({ tenantId, metric, quantity: q, unit: "count", at: now });

  it("bloquea al superar un límite duro y permite hasta el límite", async () => {
    policy.quotas = [{ tenantId: "a", metric: "email.sent", period: "day", limit: 10, enforcement: "hard" }];
    use("a", "email.sent", 9);
    expect((await engine.check("email.sent", 1, "a")).allowed).toBe(true);
    expect((await engine.check("email.sent", 2, "a")).allowed).toBe(false);
    await expect(engine.assert("email.sent", 2, "a")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("el consumo de un tenant no afecta a la cuota de otro", async () => {
    policy.quotas = [
      { tenantId: "a", metric: "email.sent", period: "day", limit: 5, enforcement: "hard" },
      { tenantId: "b", metric: "email.sent", period: "day", limit: 5, enforcement: "hard" },
    ];
    use("a", "email.sent", 5);
    expect((await engine.check("email.sent", 1, "a")).allowed).toBe(false);
    expect((await engine.check("email.sent", 1, "b")).allowed).toBe(true);
  });

  it("suma lo volcado y lo pendiente (sin ventana ciega)", async () => {
    policy.quotas = [{ tenantId: "a", metric: "m", period: "month", limit: 100, enforcement: "hard" }];
    use("a", "m", 60);
    await agg.flush();
    use("a", "m", 35); // pendiente
    expect((await engine.check("m", 6, "a")).allowed).toBe(false);
    expect((await engine.check("m", 5, "a")).allowed).toBe(true);
  });

  it("la ventana se reinicia al cambiar de día/mes", async () => {
    policy.quotas = [{ tenantId: "a", metric: "m", period: "day", limit: 10, enforcement: "hard" }];
    use("a", "m", 10);
    expect((await engine.check("m", 1, "a")).allowed).toBe(false);
    now += 24 * 3_600_000;
    expect((await engine.check("m", 1, "a")).allowed).toBe(true);
    expect(windowStart("month", Date.UTC(2026, 9, 31, 23))).toBe(Date.UTC(2026, 9, 1));
  });

  it("límite blando: permite y alerta; alertas al 80 % y al 100 % una sola vez por ventana", async () => {
    policy.quotas = [{ tenantId: "a", metric: "llm", period: "month", limit: 100, enforcement: "soft" }];
    use("a", "llm", 79);
    await engine.check("llm", 1, "a"); // 80 %
    await engine.check("llm", 1, "a");
    expect(alerts.map((a) => a.threshold)).toEqual([0.8]);
    use("a", "llm", 25);
    const d = await engine.check("llm", 1, "a");
    expect(d).toMatchObject({ allowed: true, reason: "soft_exceeded" });
    expect(alerts.map((a) => a.threshold)).toEqual([0.8, 1]);
  });

  it("en multi, sin cuota propia se aplica el valor por defecto de plataforma", async () => {
    const eng = new QuotaEngine(policy, store, agg, {
      now: () => now,
      ttlMs: 0,
      defaults: [{ metric: "email.sent", period: "day", limit: 3, enforcement: "hard" }],
    });
    use("nuevo", "email.sent", 3);
    expect((await eng.check("email.sent", 1, "nuevo")).allowed).toBe(false);
  });

  it("en single no se aplican valores por defecto (compatibilidad)", async () => {
    delete process.env.TENANT_MODE;
    const eng = new QuotaEngine(policy, store, agg, {
      now: () => now,
      ttlMs: 0,
      defaults: [{ metric: "email.sent", period: "day", limit: 1, enforcement: "hard" }],
    });
    use("default", "email.sent", 50);
    expect((await eng.check("email.sent", 1, "default")).allowed).toBe(true);
  });

  it("si el registro de cuotas cae, usa lo último conocido y los valores de plataforma", async () => {
    policy.quotas = [{ tenantId: "a", metric: "m", period: "day", limit: 5, enforcement: "hard" }];
    await engine.check("m", 1, "a"); // llena la caché
    policy.failing = true;
    use("a", "m", 5);
    expect((await engine.check("m", 1, "a")).allowed).toBe(false);
  });

  it("si el almacén de uso cae, decide con lo pendiente y marca no disponible", async () => {
    policy.quotas = [{ tenantId: "a", metric: "m", period: "day", limit: 10, enforcement: "hard" }];
    store.setFailing(true);
    use("a", "m", 4);
    expect(await engine.check("m", 1, "a")).toMatchObject({ allowed: true, reason: "unavailable" });
    use("a", "m", 6);
    expect((await engine.check("m", 1, "a")).allowed).toBe(false);
  });

  it("parseDefaultQuotas valida la entrada", () => {
    expect(parseDefaultQuotas('[{"metric":"x","period":"day","limit":5,"enforcement":"hard"}]')).toHaveLength(1);
    expect(parseDefaultQuotas('[{"metric":"x","period":"semana","limit":5,"enforcement":"hard"}]')).toHaveLength(0);
    expect(parseDefaultQuotas("no es json")).toBeNull();
  });
});

describe("limitadores", () => {
  it("cubo de fichas: ráfaga hasta el límite y recuperación con el tiempo", () => {
    let t = 0;
    const rl = new TenantRateLimiter(() => t);
    for (let i = 0; i < 60; i++) expect(rl.take("a", 60).ok).toBe(true);
    const denied = rl.take("a", 60);
    expect(denied.ok).toBe(false);
    expect(rl.take("b", 60).ok).toBe(true); // otro tenant, otro cubo
    t += 2000; // 2 s → 2 fichas
    expect(rl.take("a", 60).ok).toBe(true);
    expect(rl.take("a", 60).ok).toBe(true);
    expect(rl.take("a", 60).ok).toBe(false);
  });

  it("concurrencia por tenant", () => {
    const c = new TenantConcurrencyLimiter();
    const r1 = c.acquire("a", 2)!;
    const r2 = c.acquire("a", 2)!;
    expect(c.acquire("a", 2)).toBeNull();
    expect(c.acquire("b", 2)).not.toBeNull();
    r1();
    r1(); // idempotente
    expect(c.current("a")).toBe(1);
    expect(c.acquire("a", 2)).not.toBeNull();
    r2();
  });
});

describe("guarda HTTP: un tenant ruidoso no afecta a otro", () => {
  it("limita por tenant con 429 y Retry-After", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryUsageStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "ruidoso", metric: Metrics.HTTP_REQUEST, period: "minute", limit: 5, enforcement: "hard" }];
    const agg = new UsageAggregator(store);
    const engine = new QuotaEngine(policy, store, agg, { defaults: [], ttlMs: 0 });
    const guard = tenantResourceGuard(engine, new TenantRateLimiter(), new TenantConcurrencyLimiter());

    const app = express();
    app.use((req, _res, next) => {
      const t = req.headers["x-test-tenant"];
      if (typeof t === "string") runWithTenant(t, () => next());
      else next();
    });
    app.use(guard);
    app.get("/x", (_req, res) => res.send("ok"));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (tenant: string) =>
      new Promise<{ status: number; retry?: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/x", headers: { "x-test-tenant": tenant } }, (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0, retry: res.headers["retry-after"] as string | undefined }));
        });
        req.on("error", reject);
        req.end();
      });
    try {
      const noisy: number[] = [];
      for (let i = 0; i < 8; i++) noisy.push((await call("ruidoso")).status);
      expect(noisy.filter((s) => s === 200)).toHaveLength(5);
      expect(noisy.filter((s) => s === 429)).toHaveLength(3);
      const r = await call("ruidoso");
      expect(r.status).toBe(429);
      expect(Number(r.retry)).toBeGreaterThanOrEqual(1);
      // el vecino no se ve afectado
      for (let i = 0; i < 5; i++) expect((await call("tranquilo")).status).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("enforcement en consumo real", () => {
  it("storagePut se rechaza al superar la cuota de escritura y no escribe el fichero", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryUsageStore();
    const policy = new Policy();
    policy.quotas = [
      { tenantId: "t1", metric: Metrics.STORAGE_WRITE_BYTES, period: "month", limit: 100, enforcement: "hard" },
    ];
    installErm({ policy, store, defaults: [], flushMs: 3_600_000 });

    const ok = await runWithTenant("t1", () => storagePut("a.bin", Buffer.alloc(60)));
    expect(ok.key).toBe("t/t1/a.bin");
    await expect(runWithTenant("t1", () => storagePut("b.bin", Buffer.alloc(60)))).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fs.existsSync(path.join(dir, "t/t1/b.bin"))).toBe(false);

    // otro tenant con su propio espacio y cuota por defecto (sin límites definidos aquí)
    await expect(runWithTenant("t2", () => storagePut("a.bin", Buffer.alloc(500)))).resolves.toBeTruthy();
  });

  it("enforceQuota es no-op sin ERM instalado (single)", async () => {
    expect(getErm()).toBeNull();
    await expect(enforceQuota(Metrics.EMAIL_SENT, 1_000_000)).resolves.toBeUndefined();
  });

  it("el medidor global alimenta el agregador: meter() cuenta para la cuota", async () => {
    process.env.TENANT_MODE = "multi";
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t1", metric: Metrics.EMAIL_SENT, period: "day", limit: 2, enforcement: "hard" }];
    installErm({ policy, store: new MemoryUsageStore(), defaults: [], flushMs: 3_600_000 });
    await runWithTenant("t1", async () => {
      await enforceQuota(Metrics.EMAIL_SENT, 1);
      meter(Metrics.EMAIL_SENT, 1, "count");
      await enforceQuota(Metrics.EMAIL_SENT, 1);
      meter(Metrics.EMAIL_SENT, 1, "count");
      await expect(enforceQuota(Metrics.EMAIL_SENT, 1)).rejects.toBeInstanceOf(QuotaExceededError);
    });
  });
});

afterEach(() => {
  /* limpieza del directorio temporal al final del fichero */
});
// limpieza final
import { afterAll } from "vitest";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
void os;
