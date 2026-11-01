/**
 * Catálogo de módulos (marketplace): contrato 1.1 compatible hacia atrás, disponibilidad por plan,
 * estado por tenant, reglas de dependencias al activar/desactivar y API del plano de control.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { MODULE_CONTRACT_VERSION, ModuleError, type ModuleManifest } from "./_core/modules/contract";
import { validateManifest } from "./_core/modules/registry";
import { CORE_VERSION } from "../shared/version";
import { assertCanActivate, assertCanDeactivate, buildCatalog, tenantModules } from "./_core/modules/catalog";
import type { Entitlement } from "./_core/modules/entitlements";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const NOW = Date.UTC(2026, 9, 15);
const ent = (moduleId: string, p: Partial<Entitlement> = {}): Entitlement => ({ tenantId: "t", moduleId, status: "active", validUntil: null, source: "operator", ...p });

// Conjunto propio para probar dependencias encadenadas (ski → hotel → commerce)
const MANIFESTS: ModuleManifest[] = [
  ...BUILTIN_MODULES,
  { id: "ski", name: "Escuela de esquí", version: "0.1.0", kind: "sector", coreRange: "^1.0.0", dependsOn: [{ id: "hotel", range: "^1.0.0" }], source: { location: "external", repository: "https://github.com/example/elephant-module-ski" } },
];

describe("contrato de módulos 1.1", () => {
  it("es compatible hacia atrás: un manifiesto 1.0 sin campos nuevos sigue siendo válido", () => {
    expect(MODULE_CONTRACT_VERSION).toBe("1.2.0");
    expect(() => validateManifest({ id: "legacy", name: "Legacy", version: "1.0.0", kind: "addon", coreRange: "^1.0.0" })).not.toThrow();
    for (const m of BUILTIN_MODULES) expect(() => validateManifest(m)).not.toThrow();
  });
  it("valida recursos y repositorio", () => {
    expect(() => validateManifest({ id: "x1", name: "X", version: "1.0.0", kind: "addon", coreRange: "^1.0.0", resources: ["Email Sent"] })).toThrow(ModuleError);
    expect(() => validateManifest({ id: "x1", name: "X", version: "1.0.0", kind: "addon", coreRange: "^1.0.0", source: { location: "external", repository: "http://insecure.example" } })).toThrow(ModuleError);
  });
});

describe("catálogo", () => {
  it("versiones, dependencias y dependientes, recursos y disponibilidad por plan", () => {
    const c = buildCatalog({
      manifests: MANIFESTS,
      coreVersion: "1.0.0",
      plans: [{ id: "pro", name: "Pro", includedModules: ["cms", "hotel"] }],
      modulePrices: [{ moduleId: "spa", interval: "month", priceCents: null, currency: "EUR" }],
      activeCounts: new Map([["hotel", 3]]),
      tenantCount: 5,
    });
    expect(c.contractVersion).toBe("1.2.0");
    expect(c.modules.slice(0, 3).map((m) => m.kind)).toEqual(["core", "core", "core"]);
    const by = Object.fromEntries(c.modules.map((m) => [m.id, m]));
    expect(by.commerce.dependents).toEqual(["hotel", "restaurants", "ski", "spa"]);
    expect(by.hotel).toMatchObject({ compatible: true, dependents: ["ski"], activeTenants: 3, availability: { includedInBase: false, plans: ["pro"], addon: null } });
    expect(by.cms).toMatchObject({ activeTenants: 5, availability: { includedInBase: true, plans: ["pro"] } });
    expect(by.spa.availability.addon).toEqual({ interval: "month", priceCents: null, currency: "EUR" });
    expect(by.restaurants.activeTenants).toBe(0);
    expect(by.ski).toMatchObject({ source: { location: "external" }, dependsOn: [{ id: "hotel", range: "^1.0.0" }] });
    expect(by.hotel.resources).toContain("email.sent");
    expect(buildCatalog({ manifests: MANIFESTS, coreVersion: "2.0.0" }).modules.every((m) => !m.compatible)).toBe(true);
  });
});

describe("estado por tenant y reglas de activación", () => {
  it("estados: incluido, activo, suspendido, caducado e inactivo; módulos del plan", () => {
    const rows = tenantModules(
      MANIFESTS,
      [ent("hotel"), ent("spa", { status: "suspended" }), ent("restaurants", { validUntil: new Date(NOW - 1) })],
      NOW,
      ["hotel"],
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.cms.state).toBe("included");
    expect(by.hotel).toMatchObject({ state: "active", includedInPlan: true, activeDependents: [] });
    expect(by.spa.state).toBe("suspended");
    expect(by.restaurants.state).toBe("expired");
    expect(by.ski).toMatchObject({ state: "inactive", missingDependencies: [] });
    expect(tenantModules(MANIFESTS, [], NOW).find((r) => r.id === "ski")!.missingDependencies).toEqual(["hotel"]);
  });

  it("no se activa sin dependencias ni se desactiva con dependientes activos o si va incluido", () => {
    expect(() => assertCanActivate(MANIFESTS, [], "ski", NOW)).toThrow(/requiere antes: hotel/);
    expect(() => assertCanActivate(MANIFESTS, [ent("hotel")], "ski", NOW)).not.toThrow();
    expect(() => assertCanActivate(MANIFESTS, [ent("hotel", { validUntil: new Date(NOW - 1) })], "ski", NOW)).toThrow(ModuleError);
    expect(() => assertCanDeactivate(MANIFESTS, [ent("hotel"), ent("ski")], "hotel", NOW)).toThrow(/desactivar: ski/);
    expect(() => assertCanDeactivate(MANIFESTS, [ent("hotel")], "hotel", NOW)).not.toThrow();
    expect(() => assertCanDeactivate(MANIFESTS, [], "cms", NOW)).toThrow(/incluido en la base/);
    expect(() => assertCanActivate(MANIFESTS, [], "desconocido", NOW)).not.toThrow(); // módulo externo no declarado aquí
  });
});

describe("API del catálogo", () => {
  let server: http.Server;
  let port: number;
  const READ = "mod-read-token-aaaaaaaaaaaaaaaaaaaaaa";
  const WRITE = "mod-write-token-bbbbbbbbbbbbbbbbbbbbb";
  const NONE = "mod-none-token-cccccccccccccccccccccc";
  const ents: Entitlement[] = [];
  const OP: Actor = { type: "operator", id: "seed" };

  beforeAll(async () => {
    const reg = new MemoryTenantRegistryStore();
    const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
    const registry = new TenantRegistryService(reg, () => ring);
    for (const id of ["uno", "dos"]) await registry.createTenant({ id, displayName: id }, OP);
    ents.push({ ...ent("hotel"), tenantId: "uno" }, { ...ent("spa", { status: "suspended" }), tenantId: "dos" });
    const app = createControlPlaneApp({
      tokens: [
        { id: "r", sha256: hashToken(READ), scopes: ["tenants:read"] },
        { id: "w", sha256: hashToken(WRITE), scopes: ["tenants:read", "entitlements:write"] },
        { id: "n", sha256: hashToken(NONE), scopes: ["usage:read"] },
      ],
      registry,
      reader: reg,
      entitlements: {
        listEntitlements: async (t) => ents.filter((e) => e.tenantId === t),
        grant: async (t, m) => void ents.push({ ...ent(m), tenantId: t }),
        setStatus: async () => undefined,
        revoke: async (t, m) => {
          const i = ents.findIndex((e) => e.tenantId === t && e.moduleId === m);
          if (i >= 0) ents.splice(i, 1);
        },
        apply: async (t, m, target) => {
          const entitlement = { ...ent(m, target), tenantId: t };
          ents.push(entitlement);
          return { changed: true, previous: null, entitlement };
        },
        remove: async (t, m) => {
          const i = ents.findIndex((e) => e.tenantId === t && e.moduleId === m);
          const previous = i >= 0 ? ents.splice(i, 1)[0] : null;
          return { changed: previous !== null, previous };
        },
      },
      quotas: { listQuotas: async () => [], set: async () => undefined, remove: async () => undefined },
      platformTarget: "edge.example.com",
    });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (method: string, path: string, token: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path: `/cp/v1${path}`, method, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : null }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });

  it("catálogo con empresas activas por módulo; sin catálogo comercial se indica", async () => {
    expect((await call("GET", "/modules", NONE)).status).toBe(403);
    const r = await call("GET", "/modules", READ);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.modules.map((m: any) => [m.id, m]));
    expect(by.hotel.activeTenants).toBe(1);
    expect(by.spa.activeTenants).toBe(0); // suspendido no cuenta
    expect(by.cms.activeTenants).toBe(2);
    expect(r.json).toMatchObject({ contractVersion: "1.2.0", coreVersion: CORE_VERSION, commercialCatalog: false });
  });

  it("estado de módulos de un tenant", async () => {
    const r = await call("GET", "/tenants/uno/modules", READ);
    const by = Object.fromEntries(r.json.modules.map((m: any) => [m.id, m]));
    expect(by.hotel.state).toBe("active");
    expect(by.cms.state).toBe("included");
    expect((await call("GET", "/tenants/nadie/modules", READ)).status).toBe(404);
  });

  it("desactivar un módulo incluido en la base → 409; activar y retirar un sectorial", async () => {
    expect((await call("DELETE", "/tenants/uno/entitlements/cms", WRITE)).status).toBe(409);
    expect((await call("PUT", "/tenants/dos/entitlements/restaurants", WRITE, {})).status).toBe(200);
    expect((await call("DELETE", "/tenants/dos/entitlements/restaurants", WRITE)).json).toMatchObject({ changed: true });
    expect((await call("PUT", "/tenants/dos/entitlements/restaurants", READ, {})).status).toBe(403);
  });
});
