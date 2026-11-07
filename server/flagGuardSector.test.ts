/**
 * Interruptores de los módulos sectoriales de Elephant Net: una empresa nueva no tiene su fila en feature_flags, así que
 * Hotel Net y Care Net quedaban inservibles («Módulo desactivado») aunque la licencia estuviera activa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, boolean>();
const getFeatureFlag = vi.fn(async (key: string, fallback = false) => (rows.has(key) ? rows.get(key)! : fallback));
vi.mock("./config", () => ({ getFeatureFlag: (k: string, f?: boolean) => getFeatureFlag(k, f) }));

const { assertModuleEnabled, moduleFlagEnabled, SECTOR_MODULE_FLAG_DEFAULTS } = await import("./_core/flagGuard");

beforeEach(() => rows.clear());

describe("interruptores de módulos sectoriales", () => {
  it("sin fila: Hotel y SPA encendidos (decide la licencia); el resto, apagado como siempre", async () => {
    expect(SECTOR_MODULE_FLAG_DEFAULTS).toEqual({ hotel_module_enabled: true, spa_module_enabled: true });
    expect(await moduleFlagEnabled("hotel_module_enabled")).toBe(true);
    expect(await moduleFlagEnabled("spa_module_enabled")).toBe(true);
    expect(await moduleFlagEnabled("suppliers_module_enabled")).toBe(false);
    await expect(assertModuleEnabled("hotel_module_enabled")).resolves.toBeUndefined();
    await expect(assertModuleEnabled("ticketing_module_enabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("con fila, manda el valor de la empresa (puede apagar el módulo)", async () => {
    rows.set("hotel_module_enabled", false);
    rows.set("suppliers_module_enabled", true);
    expect(await moduleFlagEnabled("hotel_module_enabled")).toBe(false);
    await expect(assertModuleEnabled("hotel_module_enabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertModuleEnabled("suppliers_module_enabled")).resolves.toBeUndefined();
  });
});
