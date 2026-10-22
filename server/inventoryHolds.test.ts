/**
 * Retención de plazas de spa y hotel: reglas puras (sin base de datos). Las pruebas con MySQL real
 * (concurrencia, pago, cancelación, caducidad, reconciliación) están en inventoryHolds.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  HOLD_TTL_MS,
  decideHoldAction,
  occupiesInventory,
  stayNights,
  nightCapacity,
  occupancyByNight,
  minAvailableUnits,
  spaSlotDrift,
} from "./inventoryHolds";

const NOW = Date.UTC(2026, 10, 1, 12);
const future = NOW + 60_000;
const past = NOW - 60_000;

describe("decideHoldAction", () => {
  it("retenida y pendiente de pago sin caducar: nada", () => {
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: future, reservationStatus: "pending_payment" }, NOW)).toEqual({ type: "ninguna" });
  });

  it("retenida y pendiente con la retención caducada: liberar (caducada)", () => {
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: past, reservationStatus: "pending_payment" }, NOW)).toEqual({ type: "liberar", reason: "caducada" });
    // El instante exacto de caducidad ya libera
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: NOW, reservationStatus: "pending_payment" }, NOW).type).toBe("liberar");
  });

  it("pago fallido libera; cancelación libera, también si estaba confirmada", () => {
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: future, reservationStatus: "failed" }, NOW)).toEqual({ type: "liberar", reason: "pago_fallido" });
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: future, reservationStatus: "cancelled" }, NOW)).toEqual({ type: "liberar", reason: "cancelada" });
    expect(decideHoldAction({ holdStatus: "confirmada", holdExpiresAt: past, reservationStatus: "cancelled" }, NOW)).toEqual({ type: "liberar", reason: "cancelada" });
  });

  it("una reserva pagada nunca caduca: se confirma (también si la plaza ya se había liberado)", () => {
    expect(decideHoldAction({ holdStatus: "retenida", holdExpiresAt: past, reservationStatus: "paid" }, NOW)).toEqual({ type: "confirmar" });
    expect(decideHoldAction({ holdStatus: "liberada", holdExpiresAt: past, reservationStatus: "paid" }, NOW)).toEqual({ type: "confirmar" });
    expect(decideHoldAction({ holdStatus: "confirmada", holdExpiresAt: past, reservationStatus: "paid" }, NOW)).toEqual({ type: "ninguna" });
  });

  it("estados terminales y reservas sin retención: nada (idempotencia)", () => {
    expect(decideHoldAction({ holdStatus: "liberada", holdExpiresAt: past, reservationStatus: "cancelled" }, NOW).type).toBe("ninguna");
    expect(decideHoldAction({ holdStatus: "liberada", holdExpiresAt: past, reservationStatus: "pending_payment" }, NOW).type).toBe("ninguna");
    expect(decideHoldAction({ holdStatus: "conflicto", holdExpiresAt: past, reservationStatus: "paid" }, NOW).type).toBe("ninguna");
    expect(decideHoldAction({ holdStatus: null, holdExpiresAt: null, reservationStatus: "paid" }, NOW).type).toBe("ninguna");
  });
});

describe("occupiesInventory", () => {
  it("ocupan las retenidas vigentes y las confirmadas de reservas vivas", () => {
    expect(occupiesInventory({ holdStatus: "retenida", holdExpiresAt: future, reservationStatus: "pending_payment" }, NOW)).toBe(true);
    expect(occupiesInventory({ holdStatus: "confirmada", holdExpiresAt: past, reservationStatus: "paid" }, NOW)).toBe(true);
    expect(occupiesInventory({ holdStatus: "retenida", holdExpiresAt: past, reservationStatus: "paid" }, NOW)).toBe(true);
  });

  it("no ocupan las caducadas, liberadas, en conflicto ni las de reservas anuladas", () => {
    expect(occupiesInventory({ holdStatus: "retenida", holdExpiresAt: past, reservationStatus: "pending_payment" }, NOW)).toBe(false);
    expect(occupiesInventory({ holdStatus: "confirmada", holdExpiresAt: past, reservationStatus: "cancelled" }, NOW)).toBe(false);
    expect(occupiesInventory({ holdStatus: "liberada", holdExpiresAt: future, reservationStatus: "paid" }, NOW)).toBe(false);
    expect(occupiesInventory({ holdStatus: "conflicto", holdExpiresAt: null, reservationStatus: "paid" }, NOW)).toBe(false);
  });

  it("la retención dura lo que la sesión de pago más margen", () => {
    expect(HOLD_TTL_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});

describe("noches y capacidad del hotel", () => {
  it("stayNights: [entrada, salida), con cambio de mes y de año", () => {
    expect(stayNights("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(stayNights("2026-11-01", "2026-11-02")).toEqual(["2026-11-01"]);
    expect(stayNights("2026-11-02", "2026-11-02")).toEqual([]);
    expect(stayNights("2026-11-03", "2026-11-02")).toEqual([]);
    expect(stayNights("no-fecha", "2026-11-02")).toEqual([]);
  });

  it("nightCapacity: el bloqueo rebaja la capacidad, nunca la sube", () => {
    expect(nightCapacity(3, undefined)).toBe(3);
    expect(nightCapacity(3, 1)).toBe(1);
    expect(nightCapacity(3, 0)).toBe(0);
    expect(nightCapacity(3, 9)).toBe(3);
  });

  it("occupancyByNight y minAvailableUnits: la noche más ajustada manda", () => {
    const nights = stayNights("2026-11-01", "2026-11-04");
    const occ = occupancyByNight(
      [
        { checkIn: "2026-10-30", checkOut: "2026-11-02", units: 1 }, // ocupa la noche del 1
        { checkIn: "2026-11-02", checkOut: "2026-11-03", units: 1 }, // ocupa la del 2
        { checkIn: "2026-11-02", checkOut: "2026-11-05", units: 1 }, // ocupa 2 y 3
        { checkIn: "2026-11-04", checkOut: "2026-11-06", units: 1 }, // fuera del rango (sale el 4)
      ],
      nights,
    );
    expect(Object.fromEntries(occ)).toEqual({ "2026-11-01": 1, "2026-11-02": 2, "2026-11-03": 1 });
    expect(minAvailableUnits({ nights, totalUnits: 2, blocks: new Map(), occupancy: occ })).toBe(0);
    expect(minAvailableUnits({ nights, totalUnits: 3, blocks: new Map(), occupancy: occ })).toBe(1);
    // Un bloqueo en la noche 3 a 1 unidad, ya ocupada: completo
    expect(minAvailableUnits({ nights, totalUnits: 3, blocks: new Map([["2026-11-03", 1]]), occupancy: occ })).toBe(0);
    // Sobreventa previa: nunca negativo
    expect(minAvailableUnits({ nights, totalUnits: 1, blocks: new Map(), occupancy: occ })).toBe(0);
  });
});

describe("spaSlotDrift", () => {
  it("detecta contadores que no cuadran con las plazas vivas (por exceso y por defecto)", () => {
    const drift = spaSlotDrift(
      [
        { id: 1, bookedCount: 2, capacity: 4 },
        { id: 2, bookedCount: 3, capacity: 4 },
        { id: 3, bookedCount: 0, capacity: 2 },
        { id: 4, bookedCount: 0, capacity: 2 },
      ],
      new Map([[1, 2], [2, 1], [3, 2]]),
    );
    expect(drift).toEqual([
      { slotId: 2, bookedCount: 3, expected: 1, capacity: 4 },
      { slotId: 3, bookedCount: 0, expected: 2, capacity: 2 },
    ]);
  });
});
