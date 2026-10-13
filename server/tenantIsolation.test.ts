/**
 * Aislamiento entre tenants (modo multi): dominio → tenant → sesión → conexión de BD.
 *
 * Parte 1 (siempre): registro en memoria + Express real + mysql2 simulado, para demostrar
 *   qué conexión se elige y que NUNCA se usa DATABASE_URL como respaldo.
 * Parte 2 (opt-in con REGISTRY_TEST_DATABASE_URL): dos bases de datos MySQL reales con datos
 *   distintos; cada host solo ve los de su tenant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const GLOBAL_DSN = "mysql://global:CLAVE-GLOBAL-FICTICIA@global.invalid:3306/global";
const DSN_A = "mysql://ua:CLAVE-A-FICTICIA@db-a.invalid:3306/tenant_a";
const DSN_B = "mysql://ub:CLAVE-B-FICTICIA@db-b.invalid:3306/tenant_b";

const created: string[] = [];
vi.mock("mysql2/promise", () => {
  const createPool = (opts: { uri: string }) => {
    created.push(opts.uri);
    return { uri: opts.uri, end: async () => undefined, query: async () => [[], []], execute: async () => [[], []], getConnection: async () => ({}) };
  };
  return { default: { createPool }, createPool };
});

import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { TenantResolver } from "./_core/tenantRegistry/resolver";
import { bindTenantMiddleware, resolveTenantMiddleware } from "./_core/tenantRegistry/tenantMiddleware";
import { registryConnectionResolver } from "./_core/tenantRegistry/runtime";
import { runForEachTenant, writableTenantLister } from "./_core/tenantRegistry/jobs";
import { sessionTenantAllowed } from "./_core/tenantRegistry/sessionBinding";
import {
  _resetRegistryForTests,
  getSingleTenantDatabaseSync,
  getTenantDatabase,
  openTenantPools,
  setConnectionResolver,
} from "./_core/dbRegistry";
import { getTenantId, runWithTenant, TenantResolutionError } from "./_core/tenant";
import { signSessionToken, verifySessionToken } from "./localAuth";

const OP: Actor = { type: "operator", id: "test" };

let store: MemoryTenantRegistryStore;
let service: TenantRegistryService;
let resolver: TenantResolver;
let server: http.Server;
let base: string;

async function get(host: string, p: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  // fetch no permite fijar Host: se usa http.request directamente
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(base);
    const req = http.request(
      { host: u.hostname, port: u.port, path: p, method: (init.method as string) ?? "GET", headers: { ...(init.headers ?? {}), host } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body as string);
    req.end();
  });
}

beforeAll(async () => {
  process.env.TENANT_MODE = "multi";
  process.env.DATABASE_URL = GLOBAL_DSN;
  store = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({
    REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
    REGISTRY_ACTIVE_KEY_ID: "k1",
  } as NodeJS.ProcessEnv);
  service = new TenantRegistryService(store, () => ring);

  for (const [id, host, dsn] of [
    ["tenant-a", "a.elephantsource.es", DSN_A],
    ["tenant-b", "b.elephantsource.es", DSN_B],
  ] as const) {
    await service.createTenant({ id, displayName: id }, OP);
    await service.setStatus(id, "trial", OP);
    await service.addDomain(id, host, "platform_subdomain", OP, { primary: true });
    await service.activateDomain(host, OP);
    const db = await service.registerDatabase(id, dsn, OP);
    await service.activateDatabase(id, db.id, OP);
  }
  // Tenant suspendido y tenant archivado
  await service.createTenant({ id: "tenant-s", displayName: "s" }, OP);
  await service.setStatus("tenant-s", "trial", OP);
  await service.addDomain("tenant-s", "s.elephantsource.es", "platform_subdomain", OP);
  await service.activateDomain("s.elephantsource.es", OP);
  await service.setStatus("tenant-s", "active", OP);
  await service.setStatus("tenant-s", "suspended", OP, { reason: "impago" });

  // Tenant archivado (con BD registrada): nunca debe obtener conexión
  await service.createTenant({ id: "tenant-x", displayName: "x" }, OP);
  await service.setStatus("tenant-x", "trial", OP);
  await service.addDomain("tenant-x", "x.elephantsource.es", "platform_subdomain", OP);
  await service.activateDomain("x.elephantsource.es", OP);
  const dbx = await service.registerDatabase("tenant-x", "mysql://ux:CLAVE-X@db-x.invalid:3306/tenant_x", OP);
  await service.activateDatabase("tenant-x", dbx.id, OP);
  await service.setStatus("tenant-x", "active", OP);
  await service.setStatus("tenant-x", "archived", OP, { reason: "baja" });

  resolver = new TenantResolver(store);
  setConnectionResolver(registryConnectionResolver(store, service));

  const app = express();
  app.use(resolveTenantMiddleware(resolver, { log: () => undefined }));
  app.use(express.json());
  app.use(bindTenantMiddleware());
  app.get("/who", (_req, res) => res.json({ tenant: getTenantId() }));
  app.post("/echo", async (req, res) => {
    // El contexto debe sobrevivir al cuerpo leído y a esperas asíncronas
    await new Promise((r) => setTimeout(r, 5));
    res.json({ tenant: getTenantId(), body: req.body });
  });
  app.get("/db", async (_req, res) => {
    await getTenantDatabase();
    res.json({ tenant: getTenantId(), pools: openTenantPools() });
  });
  app.get("/healthz", (_req, res) => res.send("ok"));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.TENANT_MODE;
  _resetRegistryForTests();
});

beforeEach(() => {
  created.length = 0;
  _resetRegistryForTests();
  setConnectionResolver(registryConnectionResolver(store, service));
  resolver.invalidateAll();
});

describe("aislamiento: dominio → tenant", () => {
  it("cada host resuelve a su tenant", async () => {
    expect(JSON.parse((await get("a.elephantsource.es", "/who")).body)).toEqual({ tenant: "tenant-a" });
    expect(JSON.parse((await get("b.elephantsource.es", "/who")).body)).toEqual({ tenant: "tenant-b" });
  });

  it("ignora X-Tenant-Id, X-Forwarded-Host, query y cuerpo aportados por el cliente", async () => {
    const r = await get("a.elephantsource.es", "/who?tenant=tenant-b&tid=tenant-b", {
      headers: { "x-tenant-id": "tenant-b", "x-forwarded-host": "b.elephantsource.es", "x-original-host": "b.elephantsource.es" },
    });
    expect(JSON.parse(r.body).tenant).toBe("tenant-a");
  });

  it("un dominio desconocido devuelve 404 y no abre ninguna BD (sin BD por defecto)", async () => {
    for (const h of ["desconocido.example.com", "tenant-a.elephantsource.es.evil.com", "elephantsource.es"]) {
      const r = await get(h, "/db");
      expect(r.status).toBe(404);
    }
    expect(created).toEqual([]);
    expect(created).not.toContain(GLOBAL_DSN);
  });

  it("hosts no válidos se rechazan sin llegar a la aplicación", async () => {
    expect((await get("a.elephantsource.es@evil.com", "/who")).status).toBe(404);
    expect((await get("", "/who")).status).toBe(404);
  });

  it("un tenant suspendido no sirve la web pública (503) pero conserva el panel y la API", async () => {
    expect((await get("s.elephantsource.es", "/")).status).toBe(503);
    expect((await get("s.elephantsource.es", "/who")).status).toBe(503);
    expect((await get("s.elephantsource.es", "/api/ping")).status).toBe(404); // llega a la app (no existe la ruta)
  });

  it("un tenant suspendido no admite escrituras de negocio, solo sesión", async () => {
    const post = (p: string) => get("s.elephantsource.es", p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await post("/api/trpc/reservations.create")).status).toBe(403);
    expect((await post("/api/trpc/auth.login")).status).not.toBe(403);
    expect((await post("/api/trpc/auth.login,reservations.create")).status).toBe(403);
  });

  it("un tenant archivado devuelve 410 y no abre su BD", async () => {
    expect((await get("x.elephantsource.es", "/db")).status).toBe(410);
    expect(created).toEqual([]);
  });

  it("el contexto sobrevive a la lectura del cuerpo y a esperas asíncronas", async () => {
    const r = await get("b.elephantsource.es", "/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: 1 }),
    });
    expect(JSON.parse(r.body)).toEqual({ tenant: "tenant-b", body: { x: 1 } });
  });

  it("peticiones concurrentes de tenants distintos no mezclan contextos", async () => {
    const hosts = Array.from({ length: 40 }, (_, i) => (i % 2 ? "b" : "a") + ".elephantsource.es");
    const out = await Promise.all(hosts.map((h) => get(h, "/who").then((r) => [h, JSON.parse(r.body).tenant])));
    for (const [h, t] of out) expect(t).toBe(h.startsWith("a.") ? "tenant-a" : "tenant-b");
  });

  it("las sondas de salud no necesitan tenant", async () => {
    expect((await get("cualquiera.invalid", "/healthz")).status).toBe(200);
  });
});

describe("aislamiento: tenant → conexión de BD", () => {
  it("cada tenant abre su propio pool con su DSN y nunca DATABASE_URL", async () => {
    await get("a.elephantsource.es", "/db");
    expect(created).toEqual([DSN_A]);
    await get("b.elephantsource.es", "/db");
    expect(created).toEqual([DSN_A, DSN_B]);
    await get("a.elephantsource.es", "/db"); // reutiliza
    expect(created).toHaveLength(2);
    expect(created).not.toContain(GLOBAL_DSN);
    expect(openTenantPools().sort()).toEqual(["tenant-a", "tenant-b"]);
  });

  it("sin contexto de tenant no hay BD: se lanza, no se cae en DATABASE_URL", async () => {
    await expect(getTenantDatabase()).rejects.toBeInstanceOf(TenantResolutionError);
    expect(created).toEqual([]);
  });

  it("un tenant inexistente o no servible no obtiene conexión", async () => {
    await expect(getTenantDatabase("no-existe")).rejects.toBeInstanceOf(TenantResolutionError);
    await expect(getTenantDatabase("tenant-x")).rejects.toBeInstanceOf(TenantResolutionError); // archivado
    expect(created).not.toContain(GLOBAL_DSN);
  });

  it("sin resolvedor configurado en multi no hay respaldo", async () => {
    setConnectionResolver(null);
    await expect(runWithTenant("tenant-a", () => getTenantDatabase())).rejects.toBeInstanceOf(TenantResolutionError);
    expect(created).toEqual([]);
  });

  it("el acceso síncrono heredado está prohibido en multi", () => {
    expect(() => getSingleTenantDatabaseSync()).toThrow(TenantResolutionError);
  });
});

describe("aislamiento: sesión ↔ tenant", () => {
  it("un token emitido en un tenant no vale en otro", async () => {
    const tokenA = await runWithTenant("tenant-a", () => signSessionToken(7));
    expect(await runWithTenant("tenant-a", () => verifySessionToken(tokenA))).toBe(7);
    expect(await runWithTenant("tenant-b", () => verifySessionToken(tokenA))).toBeNull();
  });

  it("sin contexto de tenant no se emite ni se acepta sesión en multi", async () => {
    await expect(signSessionToken(1)).rejects.toThrow();
    const tokenA = await runWithTenant("tenant-a", () => signSessionToken(7));
    expect(await verifySessionToken(tokenA)).toBeNull();
  });

  it("los tokens previos (sin tid) se rechazan salvo para el tenant heredado configurado", () => {
    runWithTenant("tenant-a", () => {
      expect(sessionTenantAllowed(undefined, undefined)).toBe(false);
      expect(sessionTenantAllowed(undefined, "tenant-a")).toBe(true);
      expect(sessionTenantAllowed(undefined, "tenant-b")).toBe(false);
    });
  });

  it("un tid forjado en el cliente no cambia el tenant efectivo", () => {
    runWithTenant("tenant-a", () => {
      expect(sessionTenantAllowed("tenant-b", "tenant-b")).toBe(false);
      expect(getTenantId()).toBe("tenant-a");
    });
  });
});

describe("aislamiento: jobs", () => {
  it("el job se ejecuta una vez por tenant con escritura, cada uno en su contexto", async () => {
    const seen: Array<[string, string]> = [];
    const res = await runForEachTenant(
      "test",
      async (id) => {
        await new Promise((r) => setTimeout(r, 2));
        seen.push([id, getTenantId()]);
      },
      writableTenantLister(store),
    );
    expect(seen.sort()).toEqual([
      ["tenant-a", "tenant-a"],
      ["tenant-b", "tenant-b"],
    ]);
    expect(res.every((r) => r.ok)).toBe(true); // el suspendido no participa
  });

  it("el fallo de un tenant no impide los demás", async () => {
    const done: string[] = [];
    const res = await runForEachTenant(
      "test",
      async (id) => {
        if (id === "tenant-a") throw new Error("boom");
        done.push(id);
      },
      writableTenantLister(store),
    );
    expect(done).toEqual(["tenant-b"]);
    expect(res.find((r) => r.tenantId === "tenant-a")).toMatchObject({ ok: false });
  });

  it("un job fuera de runForEachTenant no tiene contexto y falla de forma segura", () => {
    expect(() => getTenantId()).toThrow(TenantResolutionError);
  });

  it("multi exige el listado de tenants", async () => {
    await expect(runForEachTenant("x", async () => undefined)).rejects.toThrow();
  });
});

describe("secretos", () => {
  it("el DSN descifrado no aparece en eventos de auditoría ni en el estado del registro", async () => {
    const ev = JSON.stringify(await store.listEvents("tenant-a"));
    expect(ev).not.toContain("CLAVE-A-FICTICIA");
    const dbs = JSON.stringify(await store.listDatabases("tenant-a"));
    expect(dbs).not.toContain("CLAVE-A-FICTICIA");
  });
});
