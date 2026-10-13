/**
 * Compatibilidad: con TENANT_MODE=single (producción hoy) el registro no altera nada.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { decodeJwt } from "jose";
import { signSessionToken, verifySessionToken } from "./localAuth";
import { installTenantBinding, installTenantResolution } from "./_core/tenantRegistry/install";
import { runWithTenant } from "./_core/tenant";
import { getSingleTenantDatabaseSync, _resetRegistryForTests } from "./_core/dbRegistry";

const stackSize = (app: express.Express) => (app as any)._router?.stack?.length ?? 0;

afterEach(() => {
  delete process.env.TENANT_MODE;
  delete process.env.REGISTRY_DATABASE_URL;
  _resetRegistryForTests();
});

describe("TENANT_MODE=single", () => {
  it("no monta ningún middleware ni crea el registro", () => {
    const app = express();
    app.use((_q, _r, n) => n()); // inicializa el router
    const before = stackSize(app);
    expect(installTenantResolution(app)).toBeNull();
    installTenantBinding(app);
    expect(stackSize(app)).toBe(before);
  });

  it("las sesiones siguen sin tid y se aceptan igual que antes", async () => {
    const t = await signSessionToken(42);
    expect(decodeJwt(t).tid).toBeUndefined();
    expect(await verifySessionToken(t)).toBe(42);
  });

  it("un token con tid de otro tenant se rechaza si hay contexto distinto", async () => {
    const t = await runWithTenant("tenant-a", () => signSessionToken(1));
    expect(await runWithTenant("tenant-b", () => verifySessionToken(t))).toBeNull();
    expect(await verifySessionToken(t)).toBe(1); // sin contexto: compatible
  });

  it("el acceso heredado a la BD sigue disponible", () => {
    process.env.DATABASE_URL ||= "mysql://u:p@127.0.0.1:3306/x";
    expect(() => getSingleTenantDatabaseSync()).not.toThrow();
  });
});

describe("TENANT_MODE=shadow / multi sin registro", () => {
  it("shadow sin REGISTRY_DATABASE_URL no monta nada y no lanza", () => {
    process.env.TENANT_MODE = "shadow";
    const app = express();
    app.use((_q, _r, n) => n()); // inicializa el router
    const before = stackSize(app);
    expect(installTenantResolution(app)).toBeNull();
    expect(stackSize(app)).toBe(before);
  });

  it("multi sin registro falla en el arranque (nunca se sirve sin tenant)", () => {
    process.env.TENANT_MODE = "multi";
    expect(() => installTenantResolution(express())).toThrow(/REGISTRY_DATABASE_URL/);
  });

  it("shadow con registro monta solo un observador", async () => {
    process.env.TENANT_MODE = "shadow";
    process.env.REGISTRY_DATABASE_URL = "mysql://u:p@127.0.0.1:1/none";
    process.env.REGISTRY_KEYS = "k1:" + Buffer.alloc(32, 1).toString("base64");
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    const app = express();
    app.use((_q, _r, n) => n()); // inicializa el router
    const before = stackSize(app);
    const rt = installTenantResolution(app);
    expect(rt).not.toBeNull();
    expect(stackSize(app)).toBe(before + 1);
    installTenantBinding(app); // en shadow no liga contexto
    expect(stackSize(app)).toBe(before + 1);
    await rt!.close();
  });
});
