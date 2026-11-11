/**
 * iCal y check-in online usan el mismo valor por defecto del interruptor de Hotel que el resto del módulo: en una
 * empresa sin fila `hotel_module_enabled` (las nuevas) cuentan como encendidos y decide la licencia de Hotel Net.
 * Antes leían `getFeatureFlag("hotel_module_enabled", false)` y quedaban apagados aunque el panel del hotel funcionara.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flags = vi.hoisted(() => ({ rows: new Map<string, boolean>(), allowed: true }));

vi.mock("./config", () => ({
  getFeatureFlag: async (key: string, fallback: boolean) => (flags.rows.has(key) ? flags.rows.get(key)! : fallback),
}));
vi.mock("./_core/capabilities/access", () => ({
  getCapabilityAccess: () => ({ check: async () => ({ allowed: flags.allowed }) }),
}));
vi.mock("./_core/modules/runtime", () => ({
  getModuleAccess: () => ({ isModuleAvailable: async () => true }),
}));

import { icalAvailable } from "./hotelIcalDb";
import { onlineCheckinAvailable } from "./netPublic/hotelCheckin";
import { SECTOR_MODULE_FLAG_DEFAULTS } from "./_core/flagGuard";

describe("interruptor de Hotel: mismo valor por defecto en iCal y check-in online", () => {
  beforeEach(() => {
    flags.rows.clear();
    flags.allowed = true;
  });

  it("sin fila del interruptor (empresa nueva) y con Hotel Net: disponibles", async () => {
    expect(SECTOR_MODULE_FLAG_DEFAULTS.hotel_module_enabled).toBe(true);
    expect(await icalAvailable()).toBe(true);
    expect(await onlineCheckinAvailable()).toBe(true);
  });

  it("interruptor apagado explícitamente: no disponibles", async () => {
    flags.rows.set("hotel_module_enabled", false);
    expect(await icalAvailable()).toBe(false);
    expect(await onlineCheckinAvailable()).toBe(false);
  });

  it("sin licencia de Hotel Net: no disponibles aunque el interruptor esté encendido", async () => {
    flags.allowed = false;
    expect(await icalAvailable()).toBe(false);
    expect(await onlineCheckinAvailable()).toBe(false);
  });
});
