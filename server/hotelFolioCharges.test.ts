/**
 * Cargo a habitación — reglas puras del contrato con el folio (server/hotelFolioChargeSources.ts) y registro de los
 * módulos que cargan. El recorrido con base de datos real está en cargoHabitacion.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { externalChargeIdOf, externalChargeSource, externalItemKey, externalLinesProblem, registerExternalChargeSource } from "./hotelFolioChargeSources";
import { ORDER_STATUS_LABELS, OPEN_ORDER_STATUSES, tableStates } from "../shared/restaurantNet";
import "./restaurantNetDb";
import "./careNetDb";

describe("líneas del folio de un cargo externo", () => {
  it("la clave de cada línea identifica su cargo y no se confunde con las automáticas", () => {
    expect(externalItemKey(12, 3)).toBe("ext:12:3");
    expect(externalChargeIdOf("ext:12:3")).toBe(12);
    expect(externalChargeIdOf("noche:2026-05-01")).toBeNull();
    expect(externalChargeIdOf("pago-reserva")).toBeNull();
    expect(externalChargeIdOf(null)).toBeNull();
    expect(externalChargeIdOf("ext:x:1")).toBeNull();
    // La clave cabe en la columna source_key (64)
    expect(externalItemKey(2147483647, 999).length).toBeLessThanOrEqual(64);
  });
  it("valida cantidades, importes en céntimos e IVA en puntos básicos", () => {
    const ok = { description: "Croquetas", quantity: 2, unitPriceCents: 950, taxRateBp: 1000 };
    expect(externalLinesProblem([ok])).toBeNull();
    expect(externalLinesProblem([])).toMatch(/nada/);
    expect(externalLinesProblem([{ ...ok, quantity: 0 }])).toMatch(/Cantidad/);
    expect(externalLinesProblem([{ ...ok, unitPriceCents: 9.5 }])).toMatch(/Importe/);
    expect(externalLinesProblem([{ ...ok, taxRateBp: 25000 }])).toMatch(/IVA/);
  });
});

describe("módulos que cargan", () => {
  it("restaurante y SPA registran su reversión al cargarse (sin que el hotel los importe)", () => {
    expect(externalChargeSource("restaurant")).not.toBeNull();
    expect(externalChargeSource("care")).not.toBeNull();
    expect(externalChargeSource("desconocido")).toBeNull();
  });
  it("un registro nuevo sustituye al anterior del mismo módulo", async () => {
    const prev = externalChargeSource("care")!;
    const calls: string[] = [];
    registerExternalChargeSource("care", { onReverted: async (_tx, ref) => void calls.push(ref) });
    await externalChargeSource("care")!.onReverted({ execute: async () => undefined }, "care_pack:1", { reason: "x", userId: null });
    expect(calls).toEqual(["care_pack:1"]);
    registerExternalChargeSource("care", prev);
  });
});

describe("comanda cargada a habitación", () => {
  it("no ocupa la mesa ni cuenta como abierta", () => {
    expect(ORDER_STATUS_LABELS.room_charged).toBe("Cargada a habitación");
    expect(OPEN_ORDER_STATUSES).not.toContain("room_charged");
    expect(tableStates([{ id: 1, mergedInto: null }], [{ id: 5, tableId: 1, status: "room_charged" }]).get(1)?.state).toBe("libre");
  });
});
