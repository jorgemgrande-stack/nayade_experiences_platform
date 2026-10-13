/**
 * Aislamiento de ficheros por tenant: prefijos, traversal, legado y servido local.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";

const dir = vi.hoisted(() => {
  const fsx = require("node:fs") as typeof import("node:fs");
  const osx = require("node:os") as typeof import("node:os");
  const pathx = require("node:path") as typeof import("node:path");
  const d = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "es-storage-"));
  process.env.LOCAL_STORAGE_PATH = d;
  return d;
});

import { scopeStorageKey, StorageKeyError, localStorageTenantGuard, storagePathAllowed } from "./_core/tenantStorage";
import { storagePut, storageGet } from "./storage";
import { runWithTenant } from "./_core/tenant";

afterEach(() => {
  delete process.env.TENANT_MODE;
  delete process.env.TENANT_LEGACY_STORAGE_TENANT;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scopeStorageKey", () => {
  it("rechaza traversal y claves no válidas en cualquier modo", () => {
    for (const k of ["../x", "a/../../b", "a\\b", "a\0b", "", "/", "./a", "a/./b", "x".repeat(1025)]) {
      expect(() => scopeStorageKey(k), JSON.stringify(k)).toThrow(StorageKeyError);
    }
  });

  it("single: la clave no cambia (compatibilidad con ficheros existentes)", () => {
    expect(scopeStorageKey("/uploads/a.png")).toBe("uploads/a.png");
  });

  it("multi: prefijo por tenant; un tenant no puede apuntar al espacio de otro", () => {
    process.env.TENANT_MODE = "multi";
    runWithTenant("acme", () => {
      expect(scopeStorageKey("uploads/a.png")).toBe("t/acme/uploads/a.png");
      expect(scopeStorageKey("t/acme/uploads/a.png")).toBe("t/acme/uploads/a.png"); // idempotente
      expect(() => scopeStorageKey("t/otro/uploads/a.png")).toThrow(/otro tenant/);
    });
  });

  it("multi sin contexto lanza", () => {
    process.env.TENANT_MODE = "multi";
    expect(() => scopeStorageKey("a.png")).toThrow();
  });

  it("el tenant heredado conserva el espacio sin prefijo pero no lee `t/…`", () => {
    process.env.TENANT_MODE = "multi";
    process.env.TENANT_LEGACY_STORAGE_TENANT = "nayade";
    runWithTenant("nayade", () => {
      expect(scopeStorageKey("uploads/a.png")).toBe("uploads/a.png");
      expect(() => scopeStorageKey("t/acme/x.png")).toThrow(/otro tenant/);
    });
    runWithTenant("acme", () => expect(scopeStorageKey("uploads/a.png")).toBe("t/acme/uploads/a.png"));
  });
});

describe("storagePut/storageGet (backend local)", () => {
  it("dos tenants con la misma clave escriben en ficheros distintos", async () => {
    process.env.TENANT_MODE = "multi";
    const a = await runWithTenant("tenant-a", () => storagePut("docs/contrato.txt", "DATOS-A", "text/plain"));
    const b = await runWithTenant("tenant-b", () => storagePut("docs/contrato.txt", "DATOS-B", "text/plain"));
    expect(a.key).toBe("t/tenant-a/docs/contrato.txt");
    expect(b.key).toBe("t/tenant-b/docs/contrato.txt");
    expect(fs.readFileSync(path.join(dir, a.key), "utf8")).toBe("DATOS-A");
    expect(fs.readFileSync(path.join(dir, b.key), "utf8")).toBe("DATOS-B");
  });

  it("no puede escribir fuera del directorio ni en el espacio de otro tenant", async () => {
    process.env.TENANT_MODE = "multi";
    await expect(runWithTenant("tenant-a", () => storagePut("../../etc/passwd", "x"))).rejects.toThrow(StorageKeyError);
    await expect(runWithTenant("tenant-a", () => storagePut("t/tenant-b/docs/contrato.txt", "x"))).rejects.toThrow(/otro tenant/);
    expect(fs.readFileSync(path.join(dir, "t/tenant-b/docs/contrato.txt"), "utf8")).toBe("DATOS-B");
  });

  it("storageGet de una clave ajena se rechaza", async () => {
    process.env.TENANT_MODE = "multi";
    await expect(runWithTenant("tenant-a", () => storageGet("t/tenant-b/docs/contrato.txt"))).rejects.toThrow();
    await expect(runWithTenant("tenant-a", () => storageGet("docs/contrato.txt"))).resolves.toMatchObject({
      key: "t/tenant-a/docs/contrato.txt",
    });
  });
});

describe("servido local por tenant", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    // El tenant del test sale de una cabecera SOLO en este arnés (en producción lo fija el registro)
    app.use((req, _res, next) => {
      const t = req.headers["x-test-tenant"];
      if (typeof t === "string") runWithTenant(t, () => next());
      else next();
    });
    app.use("/local-storage", localStorageTenantGuard());
    app.use("/local-storage", express.static(dir));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const get = (p: string, tenant?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(base);
      const req = http.request(
        { host: u.hostname, port: u.port, path: p, headers: tenant ? { "x-test-tenant": tenant } : {} },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  it("en multi cada tenant solo lee su espacio", async () => {
    process.env.TENANT_MODE = "multi";
    expect(await get("/local-storage/t/tenant-a/docs/contrato.txt", "tenant-a")).toMatchObject({ status: 200, body: "DATOS-A" });
    expect((await get("/local-storage/t/tenant-b/docs/contrato.txt", "tenant-a")).status).toBe(404);
    expect((await get("/local-storage/t/tenant-a/docs/contrato.txt")).status).toBe(404); // sin tenant
  });

  it("traversal codificado en la ruta se rechaza", async () => {
    process.env.TENANT_MODE = "multi";
    expect((await get("/local-storage/t/tenant-a/%2e%2e/tenant-b/docs/contrato.txt", "tenant-a")).status).toBe(404);
  });

  it("storagePathAllowed: heredado solo para su tenant", () => {
    process.env.TENANT_LEGACY_STORAGE_TENANT = "nayade";
    expect(storagePathAllowed("uploads/a.png", "nayade")).toBe(true);
    expect(storagePathAllowed("uploads/a.png", "acme")).toBe(false);
    expect(storagePathAllowed("t/acme/a.png", "acme")).toBe(true);
    expect(storagePathAllowed("t/acme/a.png", "nayade")).toBe(false);
  });
});
