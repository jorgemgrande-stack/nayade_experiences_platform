/**
 * Módulos externos: carga desde un paquete, licencia en el router, aislamiento de fallos,
 * y migraciones por tenant (MySQL real, opt-in).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { ModuleRegistry } from "./_core/modules/registry";
import { ModuleAccess, MemoryEntitlementStore } from "./_core/modules/entitlements";
import { loadModules, readModuleManifests, _resetLoadedModulesForTests } from "./_core/modules/loader";
import { createModuleInstaller } from "./_core/modules/installer";
import { runWithTenant } from "./_core/tenant";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

let dir: string;

function writeModule(
  name: string,
  manifest: Record<string, unknown>,
  opts: { migrations?: Record<string, string>; failRegister?: boolean } = {},
) {
  const root = path.join(dir, name);
  fs.mkdirSync(path.join(root, "migrations"), { recursive: true });
  const body = [
    "export default {",
    `  manifest: ${JSON.stringify(manifest)},`,
    "  register(host) {",
    opts.failRegister ? "    throw new Error('fallo al registrar');" : "",
    `    host.router.get("/ping", (_req, res) => res.json({ module: ${JSON.stringify(manifest.id)}, tenant: host.context.tenantId() }));`,
    "  },",
    "};",
  ].join("\n");
  fs.writeFileSync(path.join(root, "index.mjs"), body);
  for (const [f, sql] of Object.entries(opts.migrations ?? {})) fs.writeFileSync(path.join(root, "migrations", f), sql);
  return root;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "es-mods-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.TENANT_MODE;
  _resetLoadedModulesForTests();
});

const base = { kind: "sector", coreRange: "^1.0.0", dependsOn: [{ id: "commerce", range: "^1.0.0" }] };

async function boot(specs: string[]) {
  process.env.TENANT_MODE = "multi";
  const registry = new ModuleRegistry("1.0.0");
  BUILTIN_MODULES.forEach((m) => registry.register(m));
  const store = new MemoryEntitlementStore();
  store.grant({ tenantId: "con", moduleId: "ski", validUntil: null, source: "operator" });
  const access = new ModuleAccess(registry, store);
  const app = express();
  app.use((req, _res, next) => {
    const t = req.headers["x-test-tenant"];
    if (typeof t === "string") runWithTenant(t, () => next());
    else next();
  });
  const report = await loadModules(specs, { app, registry, access, baseDir: dir });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (p: string, tenant?: string) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, headers: tenant ? { "x-test-tenant": tenant } : {} }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b ? JSON.parse(b) : null }));
      });
      req.on("error", reject);
      req.end();
    });
  return {
    report,
    registry,
    call,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

describe("cargador de módulos", () => {
  it("carga un módulo, monta su router licenciado y lo registra", async () => {
    writeModule("ski", { id: "ski", name: "Ski", version: "1.2.0", ...base });
    const h = await boot(["ski"]);
    try {
      expect(h.report.failed).toEqual([]);
      expect(h.report.loaded.map((m) => m.manifest.id)).toEqual(["ski"]);
      expect(h.registry.get("ski")?.version).toBe("1.2.0");
      expect(await h.call("/api/modules/ski/ping", "con")).toMatchObject({ status: 200, body: { module: "ski", tenant: "con" } });
      expect((await h.call("/api/modules/ski/ping", "sin")).status).toBe(403);
      expect((await h.call("/api/modules/ski/ping")).status).toBe(503);
    } finally {
      await h.close();
    }
  });

  it("un módulo defectuoso o incompatible se omite sin afectar a los demás", async () => {
    writeModule("bueno", { id: "bueno", name: "Bueno", version: "1.0.0", ...base });
    writeModule("roto", { id: "roto", name: "Roto", version: "1.0.0", ...base }, { failRegister: true });
    writeModule("futuro", { id: "futuro", name: "F", version: "1.0.0", kind: "sector", coreRange: "^9.0.0" });
    writeModule("sinmanifest", { id: "Mal Id", name: "X", version: "1.0.0", kind: "sector", coreRange: "*" });
    const h = await boot(["bueno", "roto", "futuro", "sinmanifest", "no-existe"]);
    try {
      expect(h.report.loaded.map((m) => m.manifest.id)).toEqual(["bueno"]);
      expect(h.report.failed.map((f) => f.spec).sort()).toEqual(["futuro", "no-existe", "roto", "sinmanifest"]);
      expect(h.registry.get("roto")).toBeUndefined();
      expect(h.registry.get("futuro")).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("detecta dependencias ausentes", async () => {
    writeModule("dep", { id: "dep", name: "Dep", version: "1.0.0", kind: "sector", coreRange: "*", dependsOn: [{ id: "inexistente", range: "*" }] });
    const h = await boot(["dep"]);
    try {
      expect(h.report.failed[0].error).toMatch(/no está instalado/);
    } finally {
      await h.close();
    }
  });

  it("readModuleManifests lee sin montar", async () => {
    writeModule("lee", { id: "lee", name: "Lee", version: "2.0.0", ...base });
    const m = await readModuleManifests(["lee"], dir);
    expect(m[0].manifest.version).toBe("2.0.0");
  });
});

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
describe.skipIf(!URL_)("instalación de migraciones de módulo (MySQL real)", () => {
  it("aplica migraciones del módulo y de sus dependencias, una sola vez", async () => {
    writeModule("base_mod", { id: "base_mod", name: "Base", version: "1.0.0", kind: "sector", coreRange: "*", migrationsDir: "migrations" }, {
      migrations: { "0001_base.sql": "CREATE TABLE IF NOT EXISTS mod_base_t (id INT PRIMARY KEY);\n", "0001_base.down.sql": "DROP TABLE mod_base_t;\n" },
    });
    writeModule(
      "child_mod",
      { id: "child_mod", name: "Child", version: "1.0.0", kind: "sector", coreRange: "*", dependsOn: [{ id: "base_mod", range: "*" }], migrationsDir: "migrations" },
      { migrations: { "0001_child.sql": "CREATE TABLE IF NOT EXISTS mod_child_t (id INT PRIMARY KEY, base_id INT);\n", "0001_child.down.sql": "DROP TABLE mod_child_t;\n" } },
    );
    const registry = new ModuleRegistry("1.0.0");
    const loaded = await readModuleManifests(["base_mod", "child_mod"], dir);
    loaded.forEach((l) => registry.register(l.manifest));
    registry.validate();

    const admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query("DROP DATABASE IF EXISTS modinst_test");
    await admin.query("CREATE DATABASE modinst_test");
    const u = new URL(URL_!);
    u.pathname = "/modinst_test";
    try {
      const inst = createModuleInstaller(() => loaded, registry);
      const r1 = await inst.install(u.toString(), ["child_mod"]);
      expect(r1.installed).toEqual(["base_mod", "child_mod"]);
      const [t] = await admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS n FROM information_schema.tables WHERE table_schema='modinst_test' AND TABLE_NAME LIKE 'mod_%' ORDER BY 1",
      );
      expect(t.map((x) => x.n)).toEqual(["mod_base_t", "mod_child_t"]);
      const r2 = await inst.install(u.toString(), ["child_mod"]);
      expect(r2.installed).toEqual(["base_mod", "child_mod"]);
      const [h] = await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM modinst_test.__elephant_module_migrations");
      expect(Number(h[0].n)).toBe(2);
    } finally {
      await admin.query("DROP DATABASE IF EXISTS modinst_test");
      await admin.end();
    }
  });
});
