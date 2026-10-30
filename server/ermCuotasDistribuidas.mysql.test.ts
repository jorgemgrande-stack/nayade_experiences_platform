/**
 * Contadores compartidos del ERM contra MySQL real (opt-in): UPSERT atómico con lectura (`LAST_INSERT_ID`),
 * varias «réplicas» (pools distintos) sobre la misma base, reinicio y retención.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test \
 *     pnpm vitest run server/ermCuotasDistribuidas.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { Metrics } from "./_core/metering";
import { MemoryUsageStore, MysqlCounterStore, SharedUsageCounters, UsageAggregator, counterWindowStart } from "./_core/erm/usage";
import { DistributedRateLimiter } from "./_core/erm/limiters";
import { QuotaEngine } from "./_core/erm/quota";
import { WINDOWS_TABLE_DDL } from "./_core/erm/setup";
import { QuotaExceededError, type Quota, type QuotaPolicyReader } from "./_core/erm/types";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("contadores compartidos con MySQL real", () => {
  const pools: mysql.Pool[] = [];
  const pool = () => {
    const p = mysql.createPool({ uri: URL_!, connectionLimit: 3 });
    pools.push(p);
    return p;
  };

  beforeAll(async () => {
    const p = pool();
    await p.query("DROP TABLE IF EXISTS usage_windows");
    await p.query(WINDOWS_TABLE_DDL);
  });

  afterAll(async () => {
    await pools[0]?.query("DROP TABLE IF EXISTS usage_windows");
    await Promise.all(pools.map((p) => p.end()));
  });

  const k = (tenantId: string, windowStart = 1_000_000) => ({ tenantId, metric: "prueba.contador", period: "minute" as const, windowStart });

  it("incr devuelve el valor resultante en la misma sentencia (fila nueva y existente, también en negativo)", async () => {
    const s = new MysqlCounterStore(pools[0]);
    expect(await s.incr(k("cnt-a"), 5)).toBe(5);
    expect(await s.incr(k("cnt-a"), 7)).toBe(12);
    expect(await s.incr(k("cnt-a"), -2)).toBe(10);
    expect(await s.incr(k("cnt-z"), -3)).toBe(0); // nunca por debajo de cero
    expect(await s.get(k("cnt-a"))).toBe(10);
    expect(await s.get(k("cnt-b"))).toBe(0);
  });

  it("200 incrementos simultáneos desde tres pools: cada valor devuelto es único y el total es exacto", async () => {
    const stores = [pool(), pool(), pool()].map((p) => new MysqlCounterStore(p));
    const vals = await Promise.all(Array.from({ length: 200 }, (_, i) => stores[i % 3].incr(k("cnt-c"), 1)));
    expect(new Set(vals).size).toBe(200);
    expect(Math.max(...vals)).toBe(200);
    expect(await stores[0].get(k("cnt-c"))).toBe(200);
  });

  it("limitador distribuido: tres réplicas en paralelo no superan juntas el límite", async () => {
    const rs = [pool(), pool(), pool()].map((p) => new DistributedRateLimiter(new MysqlCounterStore(p), { storeTimeoutMs: 5_000 }));
    const r = await Promise.all(Array.from({ length: 300 }, (_, i) => rs[i % 3].take("cnt-tasa", 120)));
    expect(r.filter((x) => x.ok)).toHaveLength(120);
  });

  it("cuota diaria: tres motores en paralelo conceden exactamente el límite y un motor nuevo (reinicio) lo respeta", async () => {
    const policy: QuotaPolicyReader = {
      listQuotas: async (t) => [{ tenantId: t, metric: Metrics.EMAIL_SENT, period: "day", limit: 7, enforcement: "hard" } satisfies Quota],
    };
    const motor = () => {
      const usage = new MemoryUsageStore();
      const counters = new SharedUsageCounters(new MysqlCounterStore(pool()), { warn: () => undefined });
      return new QuotaEngine(policy, usage, new UsageAggregator(usage), { defaults: [], applyDefaults: false, ttlMs: 0, counters });
    };
    const ms = [motor(), motor(), motor()];
    const r = await Promise.allSettled(Array.from({ length: 21 }, (_, i) => ms[i % 3].assert(Metrics.EMAIL_SENT, 1, "cnt-correo")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(7);
    await expect(motor().assert(Metrics.EMAIL_SENT, 1, "cnt-correo")).rejects.toBeInstanceOf(QuotaExceededError);
    const s = new MysqlCounterStore(pools[0]);
    expect(await s.get({ tenantId: "cnt-correo", metric: Metrics.EMAIL_SENT, period: "day", windowStart: counterWindowStart("day", Date.now()) })).toBe(7);
  });

  it("volcado por lotes y retención sin borrados: una fila por contador, la ventana nueva empieza en cero", async () => {
    const s = new MysqlCounterStore(pools[0]);
    await s.addMany([
      { ...k("cnt-ret", 120_000), delta: 4 },
      { ...k("cnt-ret", 60_000), delta: 3 },
      { ...k("cnt-ret", 60_000), delta: 0 },
    ]);
    // En orden de ventana: 3 en la de 60 000 y la de 120 000 empieza en cero con 4
    expect(await s.get(k("cnt-ret", 120_000))).toBe(4);
    expect(await s.incr(k("cnt-ret", 60_000), 1)).toBe(5); // reloj atrasado: suma a la vigente
    expect(await s.incr(k("cnt-ret", 180_000), 2)).toBe(2); // ventana siguiente: misma fila, desde cero
    expect(await s.get(k("cnt-ret", 120_000))).toBe(2);
    const [n] = await pools[0].query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, MAX(window_start) AS w FROM usage_windows WHERE tenant_id = 'cnt-ret'");
    expect([Number(n[0].n), Number(n[0].w)]).toEqual([1, 180_000]);
  });

  it("sin la tabla (entorno sin medicion-preparar) el limitador degrada y no lanza", async () => {
    const p = pool();
    const sinTabla: Pick<mysql.Pool, "query"> = { query: ((sql: string, v?: unknown) => p.query(sql.replace(/usage_windows/g, "usage_windows_no_existe"), v as never)) as mysql.Pool["query"] };
    const avisos: string[] = [];
    const r = new DistributedRateLimiter(new MysqlCounterStore(sinTabla), { replicasEstimate: 2, onDegraded: (op) => avisos.push(op) });
    const res = await Promise.all(Array.from({ length: 20 }, () => r.take("cnt-sin-tabla", 20)));
    expect(res.filter((x) => x.ok)).toHaveLength(10);
    expect(avisos).toContain("rate_lease");
  });
});
