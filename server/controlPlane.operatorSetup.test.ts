/** Arranque de la autenticación de operadores (operatorAuthFromEnv) con una BD simulada. */
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { operatorAuthFromEnv } from "./controlPlane/operatorSetup";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);

/** BD con las migraciones 0007 y 0012; `keys` responde a la comprobación de claves del MFA. */
const fakePool = (keys: () => Promise<any>) =>
  ({
    query: vi.fn(async (sql: string) => (/DISTINCT mfa_key_id/.test(sql) ? keys() : [[], []])),
  }) as unknown as mysql.Pool;

describe("arranque de la autenticación de operadores", () => {
  it("un fallo transitorio al comprobar las claves del MFA no impide arrancar (mfa_key_check_failed)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const setup = await operatorAuthFromEnv(fakePool(() => Promise.reject(Object.assign(new Error("x"), { code: "ECONNRESET" }))), {} as NodeJS.ProcessEnv, { keyring: ring });
    expect(setup.service).toBeDefined();
    expect(setup.mfa).toMatchObject({ available: true });
    expect(setup.mfa?.missingKeys).toBeUndefined();
    expect(err.mock.calls.map((c) => String(c[0])).some((m) => m.includes("mfa_key_check_failed") && m.includes("ECONNRESET"))).toBe(true);
    err.mockRestore();
  });

  it("si falta una clave del llavero lo señala (mfa_key_missing)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const setup = await operatorAuthFromEnv(fakePool(async () => [[{ k: "k0" }, { k: "k1" }], []]), {} as NodeJS.ProcessEnv, { keyring: ring });
    expect(setup.mfa).toMatchObject({ available: true, missingKeys: ["k0"] });
    expect(err.mock.calls.some((c) => String(c[0]).includes("mfa_key_missing"))).toBe(true);
    err.mockRestore();
  });
});
