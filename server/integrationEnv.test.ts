/**
 * En multiempresa las credenciales de integraciones no salen del entorno del proceso
 * (que es de una sola empresa) sino de los ajustes de cada tenant.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("./config", () => ({
  getSystemSettingSync: (k: string, fb = "") => settings.values[k] ?? fb,
  getSystemSetting: async (k: string, fb = "") => settings.values[k] ?? fb,
  warmConfigCache: async () => undefined,
}));

import { integrationEnv } from "./_core/tenantConfig";
import { getMerchantCode, getMerchantKey, getMerchantTerminal, getRedsysUrl } from "./redsys";

beforeEach(() => {
  process.env.GHL_API_KEY = "ghl-de-nayade";
  process.env.REDSYS_MERCHANT_CODE = "999008881";
  process.env.REDSYS_MERCHANT_KEY = Buffer.alloc(24, 7).toString("base64");
  process.env.REDSYS_MERCHANT_TERMINAL = "2";
  process.env.REDSYS_ENVIRONMENT = "production";
  settings.values = {};
});
afterEach(() => {
  delete process.env.TENANT_MODE;
  for (const k of ["GHL_API_KEY", "REDSYS_MERCHANT_CODE", "REDSYS_MERCHANT_KEY", "REDSYS_MERCHANT_TERMINAL", "REDSYS_ENVIRONMENT"]) delete process.env[k];
});

describe("integrationEnv", () => {
  it("single: devuelve la variable de entorno", () => {
    expect(integrationEnv("GHL_API_KEY")).toBe("ghl-de-nayade");
  });
  it("multi: nunca la variable de entorno", () => {
    process.env.TENANT_MODE = "multi";
    expect(integrationEnv("GHL_API_KEY")).toBeUndefined();
  });
});

describe("Redsys por tenant", () => {
  it("single: usa el entorno (sin cambios)", () => {
    expect(getMerchantCode()).toBe("999008881");
    expect(getMerchantTerminal()).toBe("002");
    expect(getRedsysUrl()).toContain("sis.redsys.es");
  });

  it("multi: usa los ajustes del tenant y no la cuenta del entorno", () => {
    process.env.TENANT_MODE = "multi";
    expect(getMerchantCode()).toBe(""); // tenant sin configurar: no hay cobro, y desde luego no el de Náyade
    expect(getMerchantKey()).toBe("");
    settings.values = {
      redsys_merchant_code: "123456789",
      redsys_merchant_key: "Zm9vYmFyZm9vYmFyZm9vYmFyMTIzNDU2",
      redsys_merchant_terminal: "1",
      redsys_environment: "test",
    };
    expect(getMerchantCode()).toBe("123456789");
    expect(getMerchantTerminal()).toBe("001");
    expect(getRedsysUrl()).toContain("sis-t.redsys.es");
  });
});
