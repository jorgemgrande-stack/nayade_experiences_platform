/**
 * Acceso heredado síncrono (legacyDb / legacyPool) en multiempresa.
 *
 *  - single: exactamente como hoy (un pool de DATABASE_URL, sin necesidad de contexto).
 *  - multi: el pool ARRENDADO por el contexto del tenant en curso; sin contexto o sin
 *    arriendo, lanza. Dos tenants en paralelo nunca ven el pool del otro.
 *  - La expulsión LRU / invalidación no cierra un pool arrendado por una petición en curso.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const created = vi.hoisted(() => ({ pools: [] as any[] }));

vi.mock("mysql2/promise", () => {
  const createPool = (opts: { uri: string }) => {
    const pool = {
      uri: opts.uri,
      execute: async () => [[{ uri: opts.uri }]],
      end: vi.fn(async () => undefined),
    };
    created.pools.push(pool);
    return pool;
  };
  return { default: { createPool }, createPool };
});
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: (pool: any) => ({ __pool: pool, select: function (this: any) { return this.__pool.uri; } }),
}));

import { legacyDb, legacyPool } from "./_core/legacyDb";
import {
  _resetRegistryForTests,
  DbCapacityError,
  evictTenantDatabase,
  getTenantDatabase,
  leaseTenantDatabase,
  openTenantPools,
  setConnectionResolver,
  withTenantDb,
} from "./_core/dbRegistry";
import { runWithTenant, TenantResolutionError } from "./_core/tenant";
import { bindTenantMiddleware, resolveTenantMiddleware } from "./_core/tenantRegistry/tenantMiddleware";

const dsn = (id: string) => `mysql://u:p@db.invalid:3306/db_${id}`;
const uriOf = async () => ((await legacyPool().execute("SELECT 1")) as any)[0][0].uri as string;
const poolOf = (id: string) => created.pools.find((p) => p.uri === dsn(id));
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

const ENV = { ...process.env };
beforeEach(() => {
  created.pools.length = 0;
  _resetRegistryForTests();
  delete process.env.TENANT_MODE;
  process.env.DATABASE_URL = "mysql://u:p@db.invalid:3306/app";
});
afterEach(() => {
  process.env = { ...ENV };
  _resetRegistryForTests();
});

describe("single (regresión: comportamiento de hoy)", () => {
  it("un único pool de DATABASE_URL, sin contexto de tenant", async () => {
    expect(await uriOf()).toBe("mysql://u:p@db.invalid:3306/app");
    expect(legacyDb().select()).toBe("mysql://u:p@db.invalid:3306/app");
    expect(created.pools).toHaveLength(1);
  });

  it("con cualquier contexto sigue siendo la BD única (sin arriendos ni resolvedor)", async () => {
    setConnectionResolver(() => "mysql://no:usar@otra.invalid/x");
    await runWithTenant("lo-que-sea", async () => {
      expect(await uriOf()).toBe("mysql://u:p@db.invalid:3306/app");
    });
    await withTenantDb("otro", async () => {
      expect(await uriOf()).toBe("mysql://u:p@db.invalid:3306/app");
    });
    expect(created.pools).toHaveLength(1);
  });

  it("shadow se comporta como single", async () => {
    process.env.TENANT_MODE = "shadow";
    expect(await uriOf()).toBe("mysql://u:p@db.invalid:3306/app");
    expect(created.pools).toHaveLength(1);
  });
});

describe("multi", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver((id) => (id.startsWith("sin-bd") ? null : dsn(id)));
  });

  it("con el tenant precargado devuelve el pool de ESE tenant", async () => {
    await withTenantDb("a", async () => {
      expect(await uriOf()).toBe(dsn("a"));
      expect(legacyDb().select()).toBe(dsn("a"));
    });
    expect(created.pools.map((p) => p.uri)).toEqual([dsn("a")]);
    expect(created.pools.map((p) => p.uri)).not.toContain(process.env.DATABASE_URL);
  });

  it("sin tenant en contexto lanza y no abre ningún pool", () => {
    expect(() => legacyPool().execute("SELECT 1")).toThrow(TenantResolutionError);
    expect(() => legacyDb().select()).toThrow(TenantResolutionError);
    expect(created.pools).toHaveLength(0);
  });

  it("con tenant pero sin precargar lanza, aunque su pool exista en el registro", async () => {
    await getTenantDatabase("a"); // pool abierto, pero este contexto no lo ha arrendado
    await runWithTenant("a", async () => {
      expect(() => legacyPool().execute("SELECT 1")).toThrow(/precargado/);
    });
  });

  it("el arriendo de un contexto no se hereda en otro contexto, ni siquiera del mismo tenant", async () => {
    await withTenantDb("a", async () => {
      await runWithTenant("b", async () => {
        expect(() => legacyDb().select()).toThrow(TenantResolutionError);
      });
      await runWithTenant("a", async () => {
        expect(() => legacyDb().select()).toThrow(TenantResolutionError);
      });
      expect(legacyDb().select()).toBe(dsn("a"));
    });
  });

  it("tenant sin BD resoluble: withTenantDb lanza y no ejecuta la función", async () => {
    const fn = vi.fn();
    await expect(withTenantDb("sin-bd", fn)).rejects.toBeInstanceOf(TenantResolutionError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("dos tenants alternando en concurrencia: cada uno ve solo el suyo", async () => {
    const tasks = Array.from({ length: 60 }, (_, i) => {
      const id = i % 2 ? "b" : "a";
      return withTenantDb(id, async () => {
        const seen: string[] = [];
        for (let k = 0; k < 4; k++) {
          await tick(Math.floor(Math.random() * 3));
          seen.push(await uriOf(), legacyDb().select());
        }
        return [id, seen] as const;
      });
    });
    for (const [id, seen] of await Promise.all(tasks)) {
      expect(new Set(seen)).toEqual(new Set([dsn(id)]));
    }
    expect(created.pools).toHaveLength(2);
  });

  it("la expulsión LRU no cierra un pool arrendado; el resto sí se expulsa", async () => {
    // Máximo de 50 pools con presupuesto holgado (el límite que manda aquí es el de pools)
    process.env.DB_TENANT_POOLS_MAX = "50";
    process.env.DB_TENANT_CONNECTION_BUDGET = "1000";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const running = withTenantDb("t0", async () => {
      await gate;
      return uriOf(); // sigue funcionando tras la presión de pools
    });
    await tick(5);
    for (let i = 1; i <= 60; i++) await getTenantDatabase(`t${i}`);
    expect(openTenantPools()).toContain("t0");
    expect(openTenantPools().length).toBe(50);
    expect(poolOf("t0").end).not.toHaveBeenCalled();
    expect(poolOf("t1").end).toHaveBeenCalled(); // el menos reciente no arrendado
    release();
    expect(await running).toBe(dsn("t0"));
  });

  it("si todos están arrendados no se cierra ninguno en uso ni se supera el presupuesto: espera y 503", async () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "12"; // 3 pools de 4 conexiones
    process.env.DB_TENANT_BUDGET_WAIT_MS = "20";
    const leases = [];
    for (let i = 0; i < 3; i++) leases.push(await runWithTenant(`p${i}`, () => leaseTenantDatabase()));
    await expect(runWithTenant("p3", () => leaseTenantDatabase())).rejects.toBeInstanceOf(DbCapacityError);
    expect(openTenantPools().length).toBe(3);
    expect(created.pools.every((p) => p.end.mock.calls.length === 0)).toBe(true);
    for (const l of leases) l.release();
    // Liberados: el siguiente expulsa al menos reciente y entra
    await runWithTenant("p3", () => leaseTenantDatabase()).then((l) => l.release());
    expect(openTenantPools()).toEqual(["p1", "p2", "p3"]);
  });

  it("invalidar (evictTenantDatabase) un pool en uso aplaza el cierre hasta liberar el arriendo", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const running = withTenantDb("a", async () => {
      await gate;
      return uriOf();
    });
    await tick(5);
    expect(await evictTenantDatabase("a")).toBe(true);
    expect(poolOf("a").end).not.toHaveBeenCalled();
    expect(openTenantPools()).not.toContain("a"); // las peticiones nuevas resuelven de nuevo
    release();
    expect(await running).toBe(dsn("a"));
    expect(poolOf("a").end).toHaveBeenCalledTimes(1);
    // La siguiente ejecución abre un pool nuevo (p. ej. tras rotar el DSN)
    await withTenantDb("a", async () => expect(await uriOf()).toBe(dsn("a")));
    expect(created.pools.filter((p) => p.uri === dsn("a"))).toHaveLength(2);
  });

  it("trabajo en segundo plano tras liberar el arriendo: sigue viendo SU tenant, nunca otro", async () => {
    let later!: Promise<string>;
    await withTenantDb("a", async () => {
      later = new Promise((r) => setTimeout(() => void uriOf().then(r), 10));
    });
    expect(await withTenantDb("b", () => uriOf())).toBe(dsn("b"));
    expect(await later).toBe(dsn("a"));
  });

  it("sin arriendos, invalidar cierra en el acto (como hasta ahora)", async () => {
    await withTenantDb("a", async () => undefined);
    await evictTenantDatabase("a");
    expect(poolOf("a").end).toHaveBeenCalledTimes(1);
  });
});

describe("multi: middleware de petición (precarga + arriendo)", () => {
  let server: http.Server;
  let port: number;

  const get = (host: string, path: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      });
      req.on("error", reject);
      req.end();
    });

  beforeEach(async () => {
    process.env.TENANT_MODE = "multi";
    setConnectionResolver((id) => (id === "sin-bd" ? null : dsn(id)));
    // Resolución host → tenant simulada (el registro real se prueba en tenantIsolation)
    const fakeResolver = {
      resolveHost: async (host?: string) => ({
        kind: "resolved",
        tenant: { tenantId: String(host).split(".")[0], policy: { publicWeb: true, writes: true, admin: true } },
      }),
    };
    const app = express();
    app.use(resolveTenantMiddleware(fakeResolver as any, { log: () => undefined }));
    app.use(express.json());
    app.use(bindTenantMiddleware());
    app.get("/legacy", async (_req, res) => {
      await tick(Math.floor(Math.random() * 4));
      try {
        res.json({ uri: await uriOf(), drizzle: legacyDb().select() });
      } catch (e) {
        res.status(500).json({ error: e instanceof TenantResolutionError ? "tenant" : "otro" });
      }
    });
    app.get("/static", (_req, res) => res.send("ok"));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("cada petición ve el pool de su tenant, en concurrencia", async () => {
    const hosts = Array.from({ length: 40 }, (_, i) => (i % 2 ? "b" : "a") + ".elephantsource.es");
    const out = await Promise.all(hosts.map(async (h) => [h, JSON.parse((await get(h, "/legacy")).body)] as const));
    for (const [h, body] of out) {
      const id = h.split(".")[0];
      expect(body).toEqual({ uri: dsn(id), drizzle: dsn(id) });
    }
  });

  it("al terminar la petición se libera el arriendo (la invalidación cierra en el acto)", async () => {
    expect((await get("a.elephantsource.es", "/legacy")).status).toBe(200);
    await tick(5);
    await evictTenantDatabase("a");
    expect(poolOf("a").end).toHaveBeenCalledTimes(1);
  });

  it("tenant sin BD: la petición sigue sin arriendo y el acceso heredado lanza (falla cerrado)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await get("sin-bd.elephantsource.es", "/legacy");
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: "tenant" });
    expect((await get("sin-bd.elephantsource.es", "/static")).body).toBe("ok");
    expect(created.pools.map((p) => p.uri)).not.toContain(process.env.DATABASE_URL);
    warn.mockRestore();
  });
});
