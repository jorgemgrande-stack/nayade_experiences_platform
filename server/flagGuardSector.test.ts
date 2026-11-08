/**
 * Interruptores de los módulos sectoriales de Elephant Net: una empresa nueva no tiene su fila en feature_flags, así que
 * Hotel Net y Care Net quedaban inservibles («Módulo desactivado») aunque la licencia estuviera activa. Lo mismo con las
 * extensiones de Connect que se venden en línea (Partners, Deals y Finance Sync): comprarlas no servía de nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, boolean>();
const getFeatureFlag = vi.fn(async (key: string, fallback = false) => (rows.has(key) ? rows.get(key)! : fallback));
vi.mock("./config", () => ({ getFeatureFlag: (k: string, f?: boolean) => getFeatureFlag(k, f) }));

const { assertModuleEnabled, moduleFlagEnabled, SECTOR_MODULE_FLAG_DEFAULTS } = await import("./_core/flagGuard");

beforeEach(() => rows.clear());

describe("interruptores de módulos sectoriales", () => {
  it("sin fila: los módulos con licencia propia encendidos (decide la licencia); el resto, apagado como siempre", async () => {
    expect(SECTOR_MODULE_FLAG_DEFAULTS).toEqual({
      hotel_module_enabled: true,
      spa_module_enabled: true,
      suppliers_module_enabled: true,
      ticketing_module_enabled: true,
      bank_movements_module_enabled: true,
      card_terminal_batches_enabled: true,
    });
    for (const k of Object.keys(SECTOR_MODULE_FLAG_DEFAULTS)) expect(await moduleFlagEnabled(k), k).toBe(true);
    await expect(assertModuleEnabled("hotel_module_enabled")).resolves.toBeUndefined();
    await expect(assertModuleEnabled("ticketing_module_enabled")).resolves.toBeUndefined();
    expect(await moduleFlagEnabled("reav_module_enabled")).toBe(false);
    await expect(assertModuleEnabled("email_automation_job_enabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cada interruptor encendido por defecto corresponde a un módulo que protege una licencia en el guardián de rutas", async () => {
    const { TRPC_ROUTER_CAPABILITIES } = await import("./_core/capabilities/routeGuard");
    const licensed: Record<string, string> = { suppliers_module_enabled: "suppliers", ticketing_module_enabled: "ticketing", bank_movements_module_enabled: "bankMovements", card_terminal_batches_enabled: "cardTerminalBatches" };
    for (const [flag, ns] of Object.entries(licensed)) {
      expect(SECTOR_MODULE_FLAG_DEFAULTS[flag], flag).toBe(true);
      expect(TRPC_ROUTER_CAPABILITIES[ns], ns).toBeTruthy();
    }
  });

  it("con fila, manda el valor de la empresa (puede apagar el módulo)", async () => {
    rows.set("hotel_module_enabled", false);
    rows.set("suppliers_module_enabled", false);
    expect(await moduleFlagEnabled("hotel_module_enabled")).toBe(false);
    await expect(assertModuleEnabled("hotel_module_enabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertModuleEnabled("suppliers_module_enabled")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
