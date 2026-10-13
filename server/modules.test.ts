/**
 * Arquitectura de módulos: manifiestos, compatibilidad, dependencias, licencias aplicadas en
 * servidor (HTTP y tRPC), navegación y ciclo de vida.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ModuleError, type ModuleManifest } from "./_core/modules/contract";
import { ModuleRegistry } from "./_core/modules/registry";
import { ModuleAccess, MemoryEntitlementStore } from "./_core/modules/entitlements";
import { requireModuleHttp } from "./_core/modules/guard";
import { satisfies } from "./_core/modules/semver";
import { runWithTenant } from "./_core/tenant";

const hotel: ModuleManifest = {
  id: "hotel",
  name: "Hotel",
  version: "1.2.0",
  kind: "sector",
  coreRange: "^1.0.0",
  permissions: [
    { key: "hotel.rooms.view", description: "Ver habitaciones" },
    { key: "hotel.rooms.manage", description: "Gestionar habitaciones" },
  ],
  navigation: [
    { id: "rooms", label: "Habitaciones", path: "/admin/hotel/rooms", permission: "hotel.rooms.view", order: 10 },
    { id: "rates", label: "Tarifas", path: "/admin/hotel/rates", permission: "hotel.rooms.manage", order: 20 },
  ],
};
const spa: ModuleManifest = {
  id: "spa",
  name: "SPA",
  version: "1.0.0",
  kind: "sector",
  coreRange: "^1.0.0",
  dependsOn: [{ id: "hotel", range: "^1.0.0" }],
  permissions: [{ key: "spa.booking.manage", description: "Gestionar reservas de spa" }],
  navigation: [{ id: "treatments", label: "Tratamientos", path: "/admin/spa", permission: "spa.booking.manage" }],
};
const cms: ModuleManifest = { id: "cms", name: "CMS", version: "1.0.0", kind: "core", coreRange: "*", includedInBase: true };

function registry(...ms: ModuleManifest[]) {
  const r = new ModuleRegistry("1.4.2");
  ms.forEach((m) => r.register(m));
  r.validate();
  return r;
}

describe("semver", () => {
  it("rangos", () => {
    expect(satisfies("1.4.2", "^1.0.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfies("0.3.5", "^0.3.0")).toBe(true);
    expect(satisfies("0.4.0", "^0.3.0")).toBe(false);
    expect(satisfies("1.2.9", "~1.2.0")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfies("1.0.0", ">=1.0.0")).toBe(true);
    expect(satisfies("1.0.0", "*")).toBe(true);
    expect(satisfies("1.0.0", "basura")).toBe(false);
    expect(satisfies("no-version", "*")).toBe(false);
  });
});

describe("registro de módulos", () => {
  it("rechaza manifiestos no válidos", () => {
    const r = new ModuleRegistry("1.0.0");
    expect(() => r.register({ ...hotel, id: "Hotel!" })).toThrow(ModuleError);
    expect(() => r.register({ ...hotel, version: "1.x" })).toThrow(ModuleError);
    expect(() => r.register({ ...hotel, permissions: [{ key: "spa.x.y", description: "ajeno" }] })).toThrow(/debe empezar/);
    expect(() =>
      r.register({ ...hotel, navigation: [{ id: "a", label: "A", path: "/a", permission: "hotel.no.declarado" }] }),
    ).toThrow(/no declarado/);
  });

  it("rechaza duplicados y módulos incompatibles con el Core", () => {
    const r = new ModuleRegistry("2.0.0");
    expect(() => r.register(hotel)).toThrow(/requiere Core/);
    const r2 = new ModuleRegistry("1.0.0");
    r2.register(hotel);
    expect(() => r2.register(hotel)).toThrow(/ya registrado/);
  });

  it("valida dependencias, versiones y ciclos", () => {
    const r = new ModuleRegistry("1.0.0");
    r.register(spa);
    expect(() => r.validate()).toThrow(/no está instalado/);

    const r2 = new ModuleRegistry("1.0.0");
    r2.register({ ...hotel, version: "2.0.0", coreRange: "*" });
    r2.register(spa);
    expect(() => r2.validate()).toThrow(/requiere hotel/);

    const r3 = new ModuleRegistry("1.0.0");
    r3.register({ ...hotel, dependsOn: [{ id: "spa", range: "*" }] });
    r3.register({ ...spa, dependsOn: [{ id: "hotel", range: "*" }] });
    expect(() => r3.validate()).toThrow(/circular/);
  });

  it("orden de activación: dependencias primero", () => {
    expect(registry(spa, hotel, cms).activationOrder()).toEqual(["cms", "hotel", "spa"]);
  });

  it("dependientes y cierre de dependencias", () => {
    const r = registry(hotel, spa);
    expect(r.dependents("hotel")).toEqual(["spa"]);
    expect(r.withDependencies("spa").sort()).toEqual(["hotel", "spa"]);
  });

  it("navegación dinámica filtrada por permisos y módulos activos", () => {
    const r = registry(hotel, spa);
    const nav = r.navigation(["hotel", "spa"], (k) => k === "hotel.rooms.view" || k === "spa.booking.manage");
    expect(nav.map((n) => n.id)).toEqual(["rooms", "treatments"]);
    expect(r.navigation(["spa"], () => true).map((n) => n.moduleId)).toEqual(["spa"]);
    expect(r.navigation(["hotel"], () => false)).toEqual([]);
  });
});

describe("licencias (entitlements)", () => {
  let store: MemoryEntitlementStore;
  let now: number;
  let access: ModuleAccess;

  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    store = new MemoryEntitlementStore();
    now = Date.UTC(2026, 9, 13);
    access = new ModuleAccess(registry(cms, hotel, spa), store, { now: () => now, ttlMs: 1000, maxStaleMs: 60_000 });
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
  });

  it("sin licencia no hay módulo; los incluidos en la base sí", async () => {
    expect(await access.activeModules("acme")).toEqual(["cms"]);
    await expect(access.assertModule("hotel", "acme")).rejects.toMatchObject({ code: "not_licensed" });
  });

  it("la licencia es por tenant", async () => {
    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "operator" });
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(true);
    expect(await access.isModuleAvailable("hotel", "otro")).toBe(false);
  });

  it("un módulo exige licencia de sus dependencias", async () => {
    store.grant({ tenantId: "acme", moduleId: "spa", validUntil: null, source: "operator" });
    expect(await access.isModuleAvailable("spa", "acme")).toBe(false); // falta hotel
    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "operator" });
    access.invalidate("acme");
    expect(await access.isModuleAvailable("spa", "acme")).toBe(true);
  });

  it("caducidad, suspensión y revocación se aplican", async () => {
    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: new Date(now + 5000), source: "crm" });
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(true);
    now += 10_000; // caduca (y la caché ya venció)
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(false);

    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "crm" });
    now += 2000;
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(true);
    store.setStatus("acme", "hotel", "suspended");
    now += 2000;
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(false);
  });

  it("el flag operativo no concede módulos sin licencia, pero sí puede apagarlos", async () => {
    const withFlag = new ModuleAccess(registry(hotel), store, {
      now: () => now,
      isFlagEnabled: async () => false,
    });
    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "operator" });
    expect(await withFlag.isModuleAvailable("hotel", "acme")).toBe(false);
    const flagOn = new ModuleAccess(registry(hotel), store, { now: () => now, isFlagEnabled: async () => true });
    expect(await flagOn.isModuleAvailable("hotel", "otro")).toBe(false); // flag activo ≠ licencia
  });

  it("si el origen de licencias cae: continuidad acotada y después falla cerrado", async () => {
    store.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "operator" });
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(true);
    store.setFailing(true);
    now += 5000; // caché vencida, dentro de la ventana de continuidad
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(true);
    now += 120_000; // fuera de la ventana
    expect(await access.isModuleAvailable("hotel", "acme")).toBe(false);
    expect(await access.isModuleAvailable("hotel", "nunca-visto")).toBe(false);
  });

  it("en single todo lo instalado está licenciado (compatibilidad)", async () => {
    delete process.env.TENANT_MODE;
    expect((await access.activeModules("default")).sort()).toEqual(["cms", "hotel", "spa"]);
  });
});

describe("aplicación en servidor", () => {
  it("la API HTTP de un módulo no licenciado devuelve 403 aunque se llame directamente", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryEntitlementStore();
    store.grant({ tenantId: "con-hotel", moduleId: "hotel", validUntil: null, source: "operator" });
    const access = new ModuleAccess(registry(hotel), store);

    const app = express();
    app.use((req, _res, next) => {
      const t = req.headers["x-test-tenant"];
      if (typeof t === "string") runWithTenant(t, () => next());
      else next();
    });
    app.get("/api/hotel/rooms", requireModuleHttp(access, "hotel"), (_req, res) => res.json({ rooms: [1, 2] }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (tenant?: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/api/hotel/rooms", headers: tenant ? { "x-test-tenant": tenant } : {} },
          (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
          },
        );
        req.on("error", reject);
        req.end();
      });
    try {
      expect((await call("con-hotel")).status).toBe(200);
      const denied = await call("sin-hotel");
      expect(denied.status).toBe(403);
      expect(JSON.parse(denied.body)).toEqual({ error: "module_not_licensed", module: "hotel" });
      expect((await call()).status).toBe(503); // sin tenant: nunca se asume uno
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      delete process.env.TENANT_MODE;
    }
  });
});
