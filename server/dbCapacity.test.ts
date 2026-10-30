/**
 * Capacidad global de MySQL con varias réplicas (server/_core/dbCapacity.ts): presupuesto seguro por proceso, presión
 * con histéresis y freno de pools NUEVOS de empresa en dbRegistry sin cerrar los abiertos.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { nextPressure, safeTenantBudget, startDbCapacityWatch } from "./_core/dbCapacity";
import { _resetRegistryForTests, capConnectionBudget, getTenantPoolStats, setServerPressure } from "./_core/dbRegistry";

afterEach(() => {
  _resetRegistryForTests();
  vi.useRealTimers();
});

describe("presupuesto seguro por réplica", () => {
  it("reparte el máximo del servidor entre réplicas y descuenta reservas", () => {
    // (500 − 40) / 3 − 10 = 143 → por debajo del configurado (200): se rebaja
    expect(safeTenantBudget({ maxConnections: 500, replicas: 3, reserve: 40, fixedPerProcess: 10, configuredBudget: 200, connectionsPerTenant: 4 })).toEqual({ budget: 143, capped: true });
    // Con holgura no se sube por encima de lo configurado
    expect(safeTenantBudget({ maxConnections: 2000, replicas: 2, reserve: 40, fixedPerProcess: 10, configuredBudget: 60, connectionsPerTenant: 4 })).toEqual({ budget: 60, capped: false });
    // Servidor diminuto: nunca menos de un pool
    expect(safeTenantBudget({ maxConnections: 50, replicas: 4, reserve: 40, fixedPerProcess: 10, configuredBudget: 60, connectionsPerTenant: 4 }).budget).toBe(4);
  });

  it("la presión tiene histéresis (90 % activa, 80 % levanta)", () => {
    expect(nextPressure(false, 85, 100)).toBe(false);
    expect(nextPressure(false, 90, 100)).toBe(true);
    expect(nextPressure(true, 85, 100)).toBe(true);
    expect(nextPressure(true, 79, 100)).toBe(false);
    expect(nextPressure(true, 10, 0)).toBe(true);
  });
});

describe("vigilancia de capacidad", () => {
  it("rebaja el presupuesto al arrancar y frena pools nuevos con el servidor saturado", async () => {
    let used = 100;
    const caps: number[] = [];
    const pressure: boolean[] = [];
    const stop = startDbCapacityWatch(
      { serverConnections: async () => ({ max: 300, used }), capBudget: (n) => (caps.push(n), n), setPressure: (on) => void pressure.push(on), configured: { connectionBudget: 200, connectionsPerTenant: 4 } },
      { DB_CORE_REPLICAS: "2", DB_SERVER_RESERVE: "40", DB_FIXED_PER_PROCESS: "10", DB_CAPACITY_CHECK_MS: "5000" },
    );
    await vi.waitFor(() => expect(caps).toEqual([120])); // (300 − 40) / 2 − 10
    expect(pressure).toEqual([]);
    stop();
    used = 280;
    const stop2 = startDbCapacityWatch(
      { serverConnections: async () => ({ max: 300, used }), capBudget: (n) => n, setPressure: (on) => void pressure.push(on), configured: { connectionBudget: 200, connectionsPerTenant: 4 } },
      {},
    );
    await vi.waitFor(() => expect(pressure).toEqual([true]));
    stop2();
  });

  it("sin lectura de capacidad no cambia nada", async () => {
    const caps: number[] = [];
    const stop = startDbCapacityWatch({ serverConnections: async () => { throw new Error("sin permiso"); }, capBudget: (n) => (caps.push(n), n), setPressure: () => undefined, configured: { connectionBudget: 60, connectionsPerTenant: 4 } }, {});
    await new Promise((r) => setTimeout(r, 20));
    expect(caps).toEqual([]);
    stop();
  });
});

describe("dbRegistry: tope y presión", () => {
  it("el tope nunca sube el presupuesto ni lo deja por debajo de un pool; la presión se ve en las estadísticas", () => {
    process.env.DB_TENANT_CONNECTION_BUDGET = "60";
    process.env.DB_TENANT_POOL_CONNECTIONS = "4";
    try {
      _resetRegistryForTests();
      expect(capConnectionBudget(500)).toBe(60);
      expect(capConnectionBudget(30)).toBe(30);
      expect(capConnectionBudget(1)).toBe(4);
      expect(getTenantPoolStats().connectionBudget).toBe(4);
      setServerPressure(true);
      expect(getTenantPoolStats().serverPressure).toBe(true);
    } finally {
      delete process.env.DB_TENANT_CONNECTION_BUDGET;
      delete process.env.DB_TENANT_POOL_CONNECTIONS;
    }
  });
});
