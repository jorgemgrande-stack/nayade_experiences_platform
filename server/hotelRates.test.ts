/**
 * hotelRates.test.ts — resolveNightlyPrice: el precio/noche debe respetar el rango
 * de fechas de la temporada, igual en visualización y en cobro. Regresión del bug
 * en el que el calendario mostraba 110 (1ª temporada) y se cobraba 150 (verano).
 */
import { describe, it, expect } from "vitest";
import { resolveNightlyPrice } from "./hotelDb";

const seasons = [
  { id: 1, startDate: "2026-01-01", endDate: "2026-05-31" }, // baja
  { id: 2, startDate: "2026-06-01", endDate: "2026-06-30" }, // media
  { id: 3, startDate: "2026-07-01", endDate: "2026-09-15" }, // verano
];

const rates = [
  { pricePerNight: "110.00", specificDate: null, dayOfWeek: null, seasonId: 1 },
  { pricePerNight: "130.00", specificDate: null, dayOfWeek: null, seasonId: 2 },
  { pricePerNight: "150.00", specificDate: null, dayOfWeek: null, seasonId: 3 },
];

describe("resolveNightlyPrice", () => {
  it("aplica la tarifa de la temporada cuyo rango contiene la fecha (verano → 150)", () => {
    expect(resolveNightlyPrice(rates, seasons, "90", "2026-07-18")).toBe(150);
  });

  it("temporada baja → 110, temporada media → 130", () => {
    expect(resolveNightlyPrice(rates, seasons, "90", "2026-03-10")).toBe(110);
    expect(resolveNightlyPrice(rates, seasons, "90", "2026-06-15")).toBe(130);
  });

  it("una fecha específica tiene prioridad sobre la temporada", () => {
    const withSpecific = [...rates, { pricePerNight: "200.00", specificDate: "2026-07-18", dayOfWeek: null, seasonId: null }];
    expect(resolveNightlyPrice(withSpecific, seasons, "90", "2026-07-18")).toBe(200);
  });

  it("el día de la semana tiene prioridad sobre la temporada", () => {
    // 2026-07-18 es sábado (dow=6)
    const withDow = [...rates, { pricePerNight: "175.00", specificDate: null, dayOfWeek: 6, seasonId: null }];
    expect(resolveNightlyPrice(withDow, seasons, "90", "2026-07-18")).toBe(175);
  });

  it("fecha fuera de toda temporada → tarifa genérica si existe, si no basePrice", () => {
    const generic = [{ pricePerNight: "99.00", specificDate: null, dayOfWeek: null, seasonId: null }];
    expect(resolveNightlyPrice(generic, seasons, "90", "2026-12-25")).toBe(99);
    expect(resolveNightlyPrice(rates, seasons, "90", "2026-12-25")).toBe(90); // sin tarifa aplicable → basePrice
  });
});
