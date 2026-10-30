/**
 * Elephant Resource Manager: cuotas y límites COMPARTIDOS entre réplicas.
 * Varias instancias (limitadores, contadores y motores) sobre el MISMO almacén simulan varias réplicas sobre `es_erm`.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Metrics, meter, setMeterSink } from "./_core/metering";
import {
  MemoryCounterStore,
  MemoryUsageStore,
  SharedUsageCounters,
  UsageAggregator,
  counterWindowStart,
  type SharedCounterStore,
  type WindowKey,
} from "./_core/erm/usage";
import { DistributedRateLimiter, TenantConcurrencyLimiter } from "./_core/erm/limiters";
import { QuotaEngine } from "./_core/erm/quota";
import { tenantResourceGuard } from "./_core/erm/middleware";
import { installErm, enforceQuota, _resetErmForTests, replicasEstimateFromEnv } from "./_core/erm/runtime";
import { QuotaExceededError, type Quota, type QuotaPolicyReader } from "./_core/erm/types";
import { runWithTenant } from "./_core/tenant";

class Policy implements QuotaPolicyReader {
  quotas: Quota[] = [];
  async listQuotas(tenantId: string) {
    return this.quotas.filter((q) => q.tenantId === tenantId);
  }
}

afterEach(async () => {
  delete process.env.TENANT_MODE;
  await _resetErmForTests();
  setMeterSink(null);
});

const T0 = Date.UTC(2026, 9, 30, 10, 0, 5);

/** Réplica simulada: limitador propio sobre el almacén común. */
function replicas(store: SharedCounterStore, n: number, now: () => number, opts: Partial<ConstructorParameters<typeof DistributedRateLimiter>[1]> = {}) {
  return Array.from({ length: n }, () => new DistributedRateLimiter(store, { now, ...opts }));
}

describe("limitador de tasa distribuido (leases sobre el contador compartido)", () => {
  it("tres réplicas en paralelo (Promise.all) no superan JUNTAS el límite por minuto, con pocas escrituras", async () => {
    const store = new MemoryCounterStore();
    const rs = replicas(store, 3, () => T0);
    const results = await Promise.all(Array.from({ length: 600 }, (_, i) => rs[i % 3].take("t-uno", 200)));
    expect(results.filter((r) => r.ok)).toHaveLength(200);
    const rejected = results.filter((r) => !r.ok) as Array<{ ok: false; retryAfterMs: number }>;
    expect(rejected).toHaveLength(400);
    expect(rejected.every((r) => r.retryAfterMs > 0 && r.retryAfterMs <= 60_000)).toBe(true);
    // Bloques de 10 (5 % de 200): unas 20 escrituras para 200 admitidas, no una por petición
    expect(store.calls).toBeLessThan(40);
  });

  it("separa tenants y abre ventana nueva al cambiar de minuto", async () => {
    let t = T0;
    const store = new MemoryCounterStore();
    const [a, b] = replicas(store, 2, () => t);
    for (let i = 0; i < 5; i++) expect((await a.take("t-uno", 5)).ok).toBe(true);
    expect((await b.take("t-uno", 5)).ok).toBe(false);
    expect((await b.take("t-dos", 5)).ok).toBe(true);
    t += 60_000;
    expect((await b.take("t-uno", 5)).ok).toBe(true);
  });

  it("un reinicio conserva el contador: la réplica nueva no regala otro minuto entero", async () => {
    const store = new MemoryCounterStore();
    const [antes] = replicas(store, 1, () => T0);
    for (let i = 0; i < 30; i++) await antes.take("t-uno", 40);
    const [despues] = replicas(store, 1, () => T0 + 1_000); // proceso nuevo, memoria vacía, mismo almacén
    const r = await Promise.all(Array.from({ length: 40 }, () => despues.take("t-uno", 40)));
    // Lo reservado y no gastado por la réplica anterior (como mucho un bloque) se pierde: nunca se excede
    expect(r.filter((x) => x.ok).length).toBeLessThanOrEqual(10);
  });

  it("almacén caído: degrada al límite local (límite / réplicas estimadas), avisa y no lanza; luego vuelve al compartido", async () => {
    let t = T0;
    const store = new MemoryCounterStore();
    const avisos: string[] = [];
    const [r] = replicas(store, 1, () => t, { replicasEstimate: 4, onDegraded: (op) => avisos.push(op), retryStoreAfterMs: 5_000 });
    store.setFailing(true);
    const res = await Promise.all(Array.from({ length: 100 }, () => r.take("t-uno", 100)));
    expect(res.filter((x) => x.ok)).toHaveLength(25);
    expect(avisos).toContain("rate_lease");
    expect(r.degraded()).toBe(true);
    // Mientras dura la pausa no se vuelve a consultar el almacén
    const llamadas = store.calls;
    await r.take("t-uno", 100);
    expect(store.calls).toBe(llamadas);
    store.setFailing(false);
    t += 61_000;
    expect(r.degraded()).toBe(false);
    expect((await r.take("t-uno", 100)).ok).toBe(true);
    expect(store.calls).toBeGreaterThan(llamadas);
  });

  it("almacén lento: pasado el tiempo máximo se trata como caído (la petición no espera a la base)", async () => {
    const lento: SharedCounterStore = {
      incr: () => new Promise<number>(() => undefined),
      addMany: async () => undefined,
      get: async () => 0,
    };
    const r = new DistributedRateLimiter(lento, { storeTimeoutMs: 20, replicasEstimate: 1 });
    const t0 = Date.now();
    expect((await r.take("t-uno", 10)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(r.degraded()).toBe(true);
  });
});

describe("cuotas día/mes sobre el contador compartido", () => {
  const emailDia = (limit: number): Quota => ({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", limit, enforcement: "hard" });

  function motor(store: SharedCounterStore, policy: Policy, now: () => number) {
    const usage = new MemoryUsageStore(); // horario de cada réplica (aquí aislado: lo compartido es el contador)
    const counters = new SharedUsageCounters(store, { now, warn: () => undefined });
    const engine = new QuotaEngine(policy, usage, new UsageAggregator(usage, { now }), { defaults: [], applyDefaults: false, ttlMs: 0, now, counters });
    return { counters, engine };
  }

  it("tres motores en paralelo no conceden más que el límite duro (reserva atómica)", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [emailDia(10)];
    const ms = [0, 1, 2].map(() => motor(store, policy, () => T0));
    const r = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => ms[i % 3].engine.assert(Metrics.EMAIL_SENT, 1, "t-uno")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(10);
    const rechazos = r.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(rechazos.every((x) => x.reason instanceof QuotaExceededError)).toBe(true);
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", T0) })).toBe(10);
  });

  it("la medición posterior no cuenta dos veces lo ya reservado; lo no reservado sí se suma", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [emailDia(100)];
    const { counters, engine } = motor(store, policy, () => T0);
    for (let i = 0; i < 3; i++) await engine.assert(Metrics.EMAIL_SENT, 1, "t-uno");
    for (let i = 0; i < 5; i++) counters.record({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, quantity: 1, unit: "count", at: T0 });
    await counters.flush();
    const k: WindowKey = { tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", T0) };
    expect(await store.get(k)).toBe(5); // 3 reservados + 2 medidos sin reserva
    expect(await store.get({ ...k, period: "month", windowStart: counterWindowStart("month", T0) })).toBe(5);
  });

  it("sobrevive al reinicio: un proceso nuevo ve el consumo del día", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [emailDia(3)];
    const a = motor(store, policy, () => T0);
    for (let i = 0; i < 3; i++) await a.engine.assert(Metrics.EMAIL_SENT, 1, "t-uno");
    await a.counters.stop();
    const b = motor(store, policy, () => T0 + 3_600_000);
    await expect(b.engine.assert(Metrics.EMAIL_SENT, 1, "t-uno")).rejects.toBeInstanceOf(QuotaExceededError);
    // Al día siguiente, ventana nueva
    const c = motor(store, policy, () => T0 + 86_400_000);
    await expect(c.engine.assert(Metrics.EMAIL_SENT, 1, "t-uno")).resolves.toMatchObject({ allowed: true });
  });

  it("con varios límites duros, si uno rechaza se deshace la reserva del otro", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [
      { tenantId: "t-uno", metric: Metrics.STORAGE_WRITE_BYTES, period: "day", limit: 1000, enforcement: "hard" },
      { tenantId: "t-uno", metric: Metrics.STORAGE_WRITE_BYTES, period: "month", limit: 100, enforcement: "hard" },
    ];
    const otro = motor(store, policy, () => T0);
    await otro.counters.reserve("t-uno", Metrics.STORAGE_WRITE_BYTES, "month", 90, 100); // otra réplica ya reservó 90
    const { engine } = motor(store, policy, () => T0);
    await expect(engine.assert(Metrics.STORAGE_WRITE_BYTES, 50, "t-uno")).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.STORAGE_WRITE_BYTES, period: "day", windowStart: counterWindowStart("day", T0) })).toBe(0);
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.STORAGE_WRITE_BYTES, period: "month", windowStart: counterWindowStart("month", T0) })).toBe(90);
  });

  it("almacén compartido caído: no tumba el servicio, avisa y decide con lo conocido en el proceso", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [emailDia(2)];
    const avisos: string[] = [];
    const usage = new MemoryUsageStore();
    const agg = new UsageAggregator(usage, { now: () => T0 });
    const counters = new SharedUsageCounters(store, { now: () => T0, warn: (op) => avisos.push(op) });
    const engine = new QuotaEngine(policy, usage, agg, { defaults: [], applyDefaults: false, ttlMs: 0, now: () => T0, counters });
    store.setFailing(true);
    await expect(engine.assert(Metrics.EMAIL_SENT, 1, "t-uno")).resolves.toMatchObject({ allowed: true });
    expect(avisos).toEqual(expect.arrayContaining(["get", "reserve"]));
    // Lo medido en el proceso sigue frenando el límite duro
    const ev = { tenantId: "t-uno", metric: Metrics.EMAIL_SENT, quantity: 2, unit: "count", at: T0 };
    agg.record(ev);
    counters.record(ev);
    await expect(engine.assert(Metrics.EMAIL_SENT, 1, "t-uno")).rejects.toBeInstanceOf(QuotaExceededError);
    // El volcado fallido se conserva y llega cuando el almacén vuelve
    expect(await counters.flush()).toBe(0);
    store.setFailing(false);
    expect(await counters.flush()).toBe(2); // día y mes
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", T0) })).toBe(2);
  });

  it("retención sin borrados: la ventana nueva reutiliza la fila desde cero; una escritura atrasada suma a la vigente", async () => {
    const store = new MemoryCounterStore();
    const ayer = T0 - 86_400_000;
    const k = (at: number): WindowKey => ({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", at) });
    // Un lote que cruza el cambio de día, desordenado: se aplica en orden de ventana
    await store.addMany([
      { ...k(T0), delta: 1 },
      { ...k(ayer), delta: 4 },
    ]);
    expect(store.size()).toBe(1);
    expect(await store.get(k(T0))).toBe(1);
    expect(await store.get(k(ayer))).toBe(1); // la fila ya guarda una ventana posterior: se cuenta de más, nunca de menos
    expect(await store.incr(k(ayer), 2)).toBe(3); // reloj atrasado de una réplica: suma a la vigente
    expect(await store.incr(k(T0 + 86_400_000), 5)).toBe(5); // día siguiente: misma fila, desde cero
    expect(await store.get(k(T0))).toBe(5);
    expect(store.size()).toBe(1);
  });

  it("lo medido en una ventana ya cerrada no se vuelca en la vigente (queda en usage_hourly)", async () => {
    const store = new MemoryCounterStore();
    let t = T0;
    const counters = new SharedUsageCounters(store, { now: () => t, warn: () => undefined });
    counters.record({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, quantity: 3, unit: "count", at: T0 });
    t = T0 + 86_400_000;
    await counters.flush();
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", t) })).toBe(0);
    expect(await store.get({ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "month", windowStart: counterWindowStart("month", t) })).toBe(3);
  });
});

describe("ensamblado y guarda HTTP", () => {
  function fakeRes() {
    const r = { statusCode: 200, headers: {} as Record<string, string> } as unknown as Response & { statusCode: number; headers: Record<string, string> };
    Object.assign(r, {
      setHeader: (k: string, v: string) => ((r.headers[k] = v), r),
      status: (s: number) => ((r.statusCode = s), r),
      type: () => r,
      send: () => r,
      once: () => r,
    });
    return r;
  }
  const pasa = (guard: ReturnType<typeof tenantResourceGuard>, tenant: string, path: string) =>
    runWithTenant(tenant, async () => {
      const res = fakeRes();
      let siguiente = false;
      await guard({ path } as Request, res, (() => (siguiente = true)) as NextFunction);
      return siguiente ? 200 : res.statusCode;
    });

  it("dos réplicas con la guarda reparten el límite; las rutas críticas (#479) siguen exentas", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t-uno", metric: Metrics.HTTP_REQUEST, period: "minute", limit: 6, enforcement: "hard" }];
    const engine = new QuotaEngine(policy, new MemoryUsageStore(), new UsageAggregator(new MemoryUsageStore()), { defaults: [], ttlMs: 0 });
    const guards = [0, 1].map(() => tenantResourceGuard(engine, new DistributedRateLimiter(store), new TenantConcurrencyLimiter()));
    const st = await Promise.all(Array.from({ length: 12 }, (_, i) => pasa(guards[i % 2], "t-uno", "/api/trpc/x")));
    expect(st.filter((s) => s === 200)).toHaveLength(6);
    expect(st.filter((s) => s === 429)).toHaveLength(6);
    expect(await pasa(guards[0], "t-uno", "/api/auth/login")).toBe(200);
    expect(await pasa(guards[1], "t-uno", "/api/redsys/notification")).toBe(200);
  });

  it("installErm con almacén compartido: meter() alimenta el contador y enforceQuota lo usa entre «réplicas»", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t-uno", metric: Metrics.EMAIL_SENT, period: "day", limit: 2, enforcement: "hard" }];
    const a = installErm({ policy, store: new MemoryUsageStore(), defaults: [], flushMs: 3_600_000, counters: store });
    expect(a.counters).not.toBeNull();
    await runWithTenant("t-uno", async () => {
      meter(Metrics.EMAIL_SENT, 2, "count");
      await a.counters!.flush();
    });
    // Otra «réplica» (instalación nueva, memoria vacía) sobre el mismo almacén
    installErm({ policy, store: new MemoryUsageStore(), defaults: [], flushMs: 3_600_000, counters: store });
    await expect(runWithTenant("t-uno", () => enforceQuota(Metrics.EMAIL_SENT, 1))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("ERM_REPLICAS_ESTIMATE: valor válido o 2 por defecto", () => {
    expect(replicasEstimateFromEnv({})).toBe(2);
    expect(replicasEstimateFromEnv({ ERM_REPLICAS_ESTIMATE: "3" })).toBe(3);
    expect(replicasEstimateFromEnv({ ERM_REPLICAS_ESTIMATE: "0" })).toBe(2);
    expect(replicasEstimateFromEnv({ ERM_REPLICAS_ESTIMATE: "x" })).toBe(2);
  });
});
