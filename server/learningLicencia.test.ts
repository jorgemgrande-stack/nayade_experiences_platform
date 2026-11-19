import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ModuleRegistry } from "./_core/modules/registry";
import { MemoryEntitlementStore, ModuleAccess } from "./_core/modules/entitlements";
import { LEARNING_ENFORCE_ENV, moduleRouteGuard } from "./_core/modules/routeGuard";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { LEGACY_SECTIONS, TASK_NAV, resolveNav, type NavContext } from "../shared/adminNav";
import { runWithTenant } from "./_core/tenant";

afterEach(() => {
  delete process.env.TENANT_MODE;
  delete process.env[LEARNING_ENFORCE_ENV];
});

describe("módulo learning (Elephant Learning)", () => {
  const learning = BUILTIN_MODULES.find((m) => m.id === "learning")!;

  it("existe, es un addon con permiso propio y sin capacidad ni panel comerciales", () => {
    expect(learning).toBeTruthy();
    expect(learning.kind).toBe("addon");
    expect(learning.includedInBase).toBeFalsy();
    expect(learning.capability).toBeUndefined();
    expect(learning.panel).toBeUndefined();
    expect(learning.permissions?.map((p) => p.key)).toEqual(["learning.manage"]);
  });

  it("el conjunto de manifiestos sigue siendo válido", () => {
    const r = new ModuleRegistry("1.0.0");
    BUILTIN_MODULES.forEach((m) => r.register(m));
    r.validate();
    expect(r.activationOrder().indexOf("commerce")).toBeLessThan(r.activationOrder().indexOf("learning"));
  });

  it("licencia de módulo por tenant: solo la empresa con licencia lo tiene", async () => {
    process.env.TENANT_MODE = "multi";
    const reg = new ModuleRegistry("1.0.0");
    BUILTIN_MODULES.forEach((m) => reg.register(m));
    const store = new MemoryEntitlementStore();
    store.grant({ tenantId: "quantum", moduleId: "learning", validUntil: null, source: "operator" });
    const access = new ModuleAccess(reg, store);
    await runWithTenant("quantum", async () => expect(await access.isModuleAvailable("learning")).toBe(true));
    await runWithTenant("otra", async () => expect(await access.isModuleAvailable("learning")).toBe(false));
  });
});

describe("menú «Formación»", () => {
  const ctx = (modules: string[]): NavContext => ({
    role: "admin",
    isFlagVisible: () => true,
    isModuleVisible: (k) => !k || modules.includes(k),
    isCapabilityVisible: () => true,
    capabilityState: () => "active",
  } as unknown as NavContext);
  const hrefs = (s: ReturnType<typeof resolveNav>) => s.flatMap((x) => x.items.map((i) => i.href));

  it("sale en ambos menús solo con la licencia de módulo", () => {
    for (const nav of [LEGACY_SECTIONS, TASK_NAV]) {
      expect(hrefs(resolveNav(nav, ctx(["learning"])))).toContain("/admin/formacion");
      expect(hrefs(resolveNav(nav, ctx([])))).not.toContain("/admin/formacion");
    }
  });
});

describe("guarda tRPC de learning: gradual", () => {
  async function setup(granted: boolean) {
    process.env.TENANT_MODE = "multi";
    const reg = new ModuleRegistry("1.0.0");
    BUILTIN_MODULES.forEach((m) => reg.register(m));
    const store = new MemoryEntitlementStore();
    if (granted) store.grant({ tenantId: "quantum", moduleId: "learning", validUntil: null, source: "operator" });
    const access = new ModuleAccess(reg, store);
    const app = express();
    app.use((req, _res, next) => runWithTenant(String(req.headers["x-test-tenant"] ?? "quantum"), () => next()));
    app.use("/api/trpc", moduleRouteGuard(() => access));
    app.use("/api/trpc", (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, tenant: string) =>
      new Promise<number>((resolve, reject) => {
        const rq = http.request({ host: "127.0.0.1", port, path, headers: { "x-test-tenant": tenant } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
        rq.on("error", reject);
        rq.end();
      });
    return { call, close: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } };
  }

  it("por defecto NO se exige: el LMS actual de Quantum no se rompe", async () => {
    const s = await setup(false);
    expect(await s.call("/api/trpc/learning.my.courses", "quantum")).toBe(200);
    await s.close();
  });

  it("con LEARNING_LICENSE_ENFORCED=1 se exige por tenant (403 sin licencia, 200 con ella)", async () => {
    process.env[LEARNING_ENFORCE_ENV] = "1";
    const s = await setup(true);
    expect(await s.call("/api/trpc/learning.my.courses", "quantum")).toBe(200);
    expect(await s.call("/api/trpc/learning.my.courses", "otra")).toBe(403);
    expect(await s.call("/api/trpc/auth.me", "otra")).toBe(200);
    await s.close();
  });
});
