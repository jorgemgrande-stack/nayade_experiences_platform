/**
 * Política de conexiones de los pools de empresa (multi): presupuesto total por proceso, LRU de
 * pools sin arriendos, espera acotada con 503 + Retry-After, cierre por inactividad, opciones de
 * mysql2 (`maxIdle`/`idleTimeout`) y métricas sin datos sensibles. mysql2 simulado: cada pool
 * registra su `connectionLimit` y si se cerró, para comprobar que la suma de límites de los pools
 * abiertos nunca pasa del presupuesto.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const created = vi.hoisted(() => ({ pools: [] as any[], maxOpenLimit: 0 }));

vi.mock("mysql2/promise", () => {
  const openLimit = () => created.pools.filter((p) => !p.ended).reduce((s, p) => s + p.opts.connectionLimit, 0);
  const createPool = (opts: any) => {
    const pool: any = {
      opts,
      uri: opts.uri,
      ended: false,
      execute: async () => [[{ uri: opts.uri }]],
      end: vi.fn(async () => {
        pool.ended = true;
      }),
      // Forma interna de mysql2 que lee getTenantPoolStats
      pool: { _allConnections: { length: 2 }, _freeConnections: { length: 1 } },
    };
    created.pools.push(pool);
    created.maxOpenLimit = Math.max(created.maxOpenLimit, openLimit());
    return pool;
  };
  return { default: { createPool }, createPool };
});
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: (pool: any) => ({ __pool: pool }) }));

import {
  _resetRegistryForTests,
  closeAllDatabases,
  DbCapacityError,
  evictTenantDatabase,
  getTenantDatabase,
  getTenantPoolStats,
  leaseTenantDatabase,
  openTenantPools,
  setConnectionResolver,
  sweepInactivePools,
  withTenantDb,
} from "./_core/dbRegistry";
import { legacyPool } from "./_core/legacyDb";
import { runWithTenant } from "./_core/tenant";
import { setMeterSink, type MeterEvent } from "./_core/metering";
import { effectiveMaxPools, fixedPoolOptions, tenantPoolPolicyFromEnv, TENANT_POOL_DEFAULTS } from "./_core/dbPoolConfig";
import { bindTenantMiddleware, resolveTenantMiddleware } from "./_core/tenantRegistry/tenantMiddleware";

const dsn = (id: string) => `mysql://u:p@db.invalid:3306/db_${id}`;
const poolOf = (id: string) => created.pools.filter((p) => p.uri === dsn(id)).at(-1);
const lease = (id: string) => runWithTenant(id, () => leaseTenantDatabase());
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));
const events: MeterEvent[] = [];

const ENV = { ...process.env };
beforeEach(() => {
  created.pools.length = 0;
  created.maxOpenLimit = 0;
  events.length = 0;
  _resetRegistryForTests();
  process.env.TENANT_MODE = "multi";
  process.env.DATABASE_URL = "mysql://u:p@db.invalid:3306/app";
  for (const k of Object.keys(process.env)) if (k.startsWith("DB_TENANT_") || k.startsWith("DB_POOL_")) delete process.env[k];
  setConnectionResolver((id) => dsn(id));
  setMeterSink({ record: (e) => void events.push(e) });
});
afterEach(() => {
  setMeterSink(null);
  process.env = { ...ENV };
  _resetRegistryForTests();
});

describe("configuración por entorno", () => {
  it("valores por defecto seguros", () => {
    const p = tenantPoolPolicyFromEnv({});
    expect(p).toEqual(TENANT_POOL_DEFAULTS);
    expect(p.connectionsPerTenant).toBeLessThanOrEqual(5);
    expect(effectiveMaxPools(p)).toBe(15); // 60 / 4
  });

  it("valores no válidos → por defecto; fuera de rango → acotados; presupuesto ≥ un pool", () => {
    const p = tenantPoolPolicyFromEnv({
      DB_TENANT_POOL_CONNECTIONS: "abc",
      DB_TENANT_CONNECTION_BUDGET: "-5",
      DB_TENANT_POOL_MAX_IDLE: "99",
      DB_TENANT_BUDGET_WAIT_MS: "1.5",
      DB_TENANT_POOL_IDLE_TIMEOUT_MS: "10",
    });
    expect(p.connectionsPerTenant).toBe(4);
    expect(p.connectionBudget).toBe(4);
    expect(p.maxIdle).toBe(4);
    expect(p.waitMs).toBe(TENANT_POOL_DEFAULTS.waitMs);
    expect(p.idleTimeoutMs).toBe(1000);
    expect(effectiveMaxPools({ ...p, maxPools: 2, connectionBudget: 100 })).toBe(2);
  });

  it("pools fijos: tamaño configurable y cierre de ociosas", () => {
    expect(fixedPoolOptions("X_POOL", 5, {})).toEqual({ connectionLimit: 5, maxIdle: 2, idleTimeout: 60_000 });
    expect(fixedPoolOptions("X_POOL", 5, { X_POOL: "3", DB_FIXED_POOL_MAX_IDLE: "9" })).toEqual({ connectionLimit: 3, maxIdle: 3, idleTimeout: 60_000 });
    expect(fixedPoolOptions("X_POOL", 5, { X_POOL: "0" }).connectionLimit).toBe(1);
  });
});

describe("opciones de mysql2", () => {
  it("multi: límite por empresa, maxIdle e idleTimeout", async () => {
    process.env.DB_TENANT_POOL_CONNECTIONS = "3";
    await getTenantDatabase("a");
    expect(poolOf("a").opts).toMatchObject({ connectionLimit: 3, maxIdle: 1, idleTimeout: 30_000 });
  });

  it("single: el pool único de siempre (10 conexiones, sin cambios), fuera del presupuesto", async () => {
    delete process.env.TENANT_MODE;
    expect(await getTenantDatabase("lo-que-sea")).toBeTruthy();
    expect(created.pools).toHaveLength(1);
    expect(created.pools[0].opts).toEqual({ uri: "mysql://u:p@db.invalid:3306/app", connectionLimit: 10 });
    expect(getTenantPoolStats().connectionsReserved).toBe(0);
  });
});

describe("presupuesto total", () => {
  it("20 empresas con peticiones concurrentes: nunca se supera el presupuesto y ninguna ve otra BD", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "12"; // 3 pools de 4
    process.env.DB_TENANT_BUDGET_WAIT_MS = "5000";
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const jobs = Array.from({ length: 200 }, (_, i) => ids[i % ids.length]).map((id) =>
      withTenantDb(id, async () => {
        await tick(Math.floor(Math.random() * 3));
        const uri = ((await legacyPool().execute("SELECT 1")) as any)[0][0].uri;
        expect(getTenantPoolStats().connectionsReserved).toBeLessThanOrEqual(12);
        return [id, uri] as const;
      }),
    );
    for (const [id, uri] of await Promise.all(jobs)) expect(uri).toBe(dsn(id));
    expect(created.maxOpenLimit).toBeLessThanOrEqual(12);
    const s = getTenantPoolStats();
    expect(s.totals.peakReserved).toBeLessThanOrEqual(12);
    expect(s.totals.waits).toBeGreaterThan(0);
    expect(s.totals.evictedLru).toBeGreaterThan(0);
    expect(s.totals.waitTimeouts).toBe(0);
    expect(s.waiting).toBe(0);
  });

  it("LRU: se expulsa el menos usado recientemente SIN arriendo; usarlo renueva su recencia", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "12";
    for (const id of ["a", "b", "c"]) await getTenantDatabase(id);
    await getTenantDatabase("a"); // a pasa a ser el más reciente → b es el menos reciente
    await getTenantDatabase("d");
    expect(openTenantPools().sort()).toEqual(["a", "c", "d"]);
    expect(poolOf("b").end).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.metric === "db.pool.evicted" && e.meta?.reason === "lru" && e.tenantId === "b")).toBe(true);
  });

  it("todos arrendados: espera y entra en cuanto se libera uno (sin cerrar pools en uso)", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "8";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "2000";
    const la = await lease("a");
    const lb = await lease("b");
    const pending = lease("c");
    await tick(10);
    expect(getTenantPoolStats().waiting).toBe(1);
    expect(poolOf("c")).toBeUndefined(); // no se abre nada por encima del presupuesto
    la.release();
    const lc = await pending;
    expect(openTenantPools().sort()).toEqual(["b", "c"]);
    expect(poolOf("b").end).not.toHaveBeenCalled();
    expect(events.some((e) => e.metric === "db.pool.wait.ms" && e.tenantId === "c")).toBe(true);
    lb.release();
    lc.release();
  });

  it("sin hueco tras la espera máxima: DbCapacityError con Retry-After y métrica de rechazo", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "4";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "15";
    process.env.DB_TENANT_RETRY_AFTER_SECONDS = "7";
    const la = await lease("a");
    const err = await lease("b").catch((e) => e);
    expect(err).toBeInstanceOf(DbCapacityError);
    expect(err.retryAfterSeconds).toBe(7);
    expect(getTenantPoolStats()).toMatchObject({ waiting: 0, connectionsReserved: 4, totals: { waitTimeouts: 1 } });
    expect(events.some((e) => e.metric === "db.pool.rejected" && e.tenantId === "b")).toBe(true);
    la.release();
  });

  it("dos arriendos simultáneos del mismo tenant comparten pool y ninguno puede ser expulsado entre medias", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "4";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "50";
    const [l1, l2] = await Promise.all([lease("a"), lease("a")]);
    expect(created.pools).toHaveLength(1);
    await expect(lease("b")).rejects.toBeInstanceOf(DbCapacityError);
    l1.release();
    await expect(lease("b")).rejects.toBeInstanceOf(DbCapacityError); // sigue arrendado por l2
    l2.release();
    (await lease("b")).release();
    expect(poolOf("a").end).toHaveBeenCalledTimes(1);
  });

  it("invalidar un pool arrendado no devuelve su reserva hasta cerrarlo de verdad", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "4";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "2000";
    const la = await lease("a");
    await evictTenantDatabase("a");
    const pending = lease("b");
    await tick(10);
    expect(poolOf("b")).toBeUndefined();
    la.release(); // se cierra el pool retirado → hueco
    (await pending).release();
    expect(poolOf("a").end).toHaveBeenCalledTimes(1);
    expect(created.maxOpenLimit).toBeLessThanOrEqual(4);
  });
});

describe("inactividad", () => {
  it("cierra los pools sin actividad ni arriendos y devuelve su reserva; los arrendados siguen", async () => {
    process.env.DB_TENANT_POOL_INACTIVE_MS = "60000";
    const la = await lease("a");
    await getTenantDatabase("b");
    expect(sweepInactivePools(Date.now() + 1000)).toBe(0); // aún activos
    expect(sweepInactivePools(Date.now() + 61_000)).toBe(1);
    expect(openTenantPools()).toEqual(["a"]);
    expect(poolOf("b").end).toHaveBeenCalledTimes(1);
    expect(getTenantPoolStats()).toMatchObject({ pools: 1, connectionsReserved: 4, totals: { evictedIdle: 1 } });
    la.release();
    expect(sweepInactivePools(Date.now() + 61_000)).toBe(1);
    expect(getTenantPoolStats().connectionsReserved).toBe(0);
    // La siguiente petición vuelve a abrir el pool
    await withTenantDb("b", async () => undefined);
    expect(created.pools.filter((p) => p.uri === dsn("b"))).toHaveLength(2);
  });
});

describe("métricas", () => {
  it("sin identificadores de empresa ni datos de conexión", async () => {
    await getTenantDatabase("empresa-secreta");
    const s = getTenantPoolStats();
    expect(s).toMatchObject({ pools: 1, connectionsOpen: 2, connectionsInUse: 1, connectionBudget: 60, connectionsReserved: 4, poolsMax: 15 });
    const json = JSON.stringify(s);
    expect(json).not.toContain("empresa-secreta");
    expect(json).not.toContain("mysql://");
  });

  it("apagado ordenado: cierra todo y rechaza a quien espera", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "4";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "5000";
    await lease("a");
    const pending = lease("b").catch((e) => e);
    await tick(5);
    await closeAllDatabases();
    expect(await pending).toBeInstanceOf(DbCapacityError);
    expect(getTenantPoolStats()).toMatchObject({ pools: 0, connectionsReserved: 0, waiting: 0 });
  });
});

describe("borde HTTP", () => {
  let server: http.Server;
  let port: number;
  const get = (host: string) =>
    new Promise<{ status: number; retryAfter?: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/x", headers: { host } }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string | undefined }));
      });
      req.on("error", reject);
      req.end();
    });

  beforeEach(async () => {
    const fakeResolver = {
      resolveHost: async (host?: string) => ({
        kind: "resolved",
        tenant: { tenantId: String(host).split(".")[0], policy: { publicWeb: true, writes: true, admin: true } },
      }),
    };
    const app = express();
    app.use(resolveTenantMiddleware(fakeResolver as any, { log: () => undefined }));
    app.use(bindTenantMiddleware());
    app.get("/x", (_req, res) => res.send("ok"));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("presupuesto agotado → 503 con Retry-After (nunca se abre por encima)", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "4";
    process.env.DB_TENANT_BUDGET_WAIT_MS = "20";
    process.env.DB_TENANT_RETRY_AFTER_SECONDS = "3";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const held = await lease("a");
    expect(await get("b.example")).toEqual({ status: 503, retryAfter: "3" });
    expect(poolOf("b")).toBeUndefined();
    held.release();
    expect((await get("b.example")).status).toBe(200);
    warn.mockRestore();
  });
});
