import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ModuleRegistry } from "./_core/modules/registry";
import { ModuleAccess, MemoryEntitlementStore } from "./_core/modules/entitlements";
import { moduleRouteGuard, procedureNames } from "./_core/modules/routeGuard";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { runWithTenant } from "./_core/tenant";

afterEach(() => {
  delete process.env.TENANT_MODE;
});

describe("manifiestos incorporados", () => {
  it("son válidos, compatibles con el Core y se activan en orden", () => {
    const r = new ModuleRegistry("1.0.0");
    BUILTIN_MODULES.forEach((m) => r.register(m));
    r.validate();
    const order = r.activationOrder();
    expect(order.indexOf("commerce")).toBeLessThan(order.indexOf("hotel"));
  });
});

describe("guarda de rutas tRPC por licencia", () => {
  it("procedureNames extrae lotes", () => {
    expect(procedureNames("/api/trpc/hotel.list,auth.me?batch=1")).toEqual(["hotel.list", "auth.me"]);
  });

  async function setup() {
    process.env.TENANT_MODE = "multi";
    const reg = new ModuleRegistry("1.0.0");
    BUILTIN_MODULES.forEach((m) => reg.register(m));
    const store = new MemoryEntitlementStore();
    store.grant({ tenantId: "con-hotel", moduleId: "hotel", validUntil: null, source: "operator" });
    const access = new ModuleAccess(reg, store);
    const app = express();
    app.use((req, _res, next) => {
      const t = req.headers["x-test-tenant"];
      if (typeof t === "string") runWithTenant(t, () => next());
      else next();
    });
    app.use("/api/trpc", moduleRouteGuard(() => access));
    app.use("/api/trpc", (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, tenant?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, headers: tenant ? { "x-test-tenant": tenant } : {} }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });
    return { call, close: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } };
  }

  it("un procedimiento de hotel exige licencia; el resto del Core no", async () => {
    const { call, close } = await setup();
    try {
      expect(await call("/api/trpc/hotel.getRoomTypes", "con-hotel")).toBe(200);
      expect(await call("/api/trpc/hotel.getRoomTypes", "sin-hotel")).toBe(403);
      expect(await call("/api/trpc/spa.list", "con-hotel")).toBe(403); // otro módulo sin licencia
      expect(await call("/api/trpc/auth.me", "sin-hotel")).toBe(200);
      expect(await call("/api/trpc/auth.me,hotel.getRoomTypes", "sin-hotel")).toBe(403); // lote mixto
      expect(await call("/api/trpc/hotel.getRoomTypes")).toBe(503); // sin tenant: cierra
    } finally {
      await close();
    }
  });
});
