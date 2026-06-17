/**
 * spaSlots.test.ts — Troceado de un rango horario en slots según el intervalo
 * de la plantilla (Plantillas de horario del SPA).
 */
import { describe, it, expect } from "vitest";
import { splitIntoSlots } from "./spaDb";

describe("splitIntoSlots", () => {
  it("trocea 10:00–18:00 cada 60 min en 8 slots de una hora", () => {
    const r = splitIntoSlots("10:00", "18:00", 60);
    expect(r).toHaveLength(8);
    expect(r[0]).toEqual({ startTime: "10:00", endTime: "11:00" });
    expect(r[7]).toEqual({ startTime: "17:00", endTime: "18:00" });
  });

  it("trocea 10:00–13:00 cada 90 min en 2 slots", () => {
    const r = splitIntoSlots("10:00", "13:00", 90);
    expect(r).toEqual([
      { startTime: "10:00", endTime: "11:30" },
      { startTime: "11:30", endTime: "13:00" },
    ]);
  });

  it("intervalo 0 => un único slot que cubre todo el rango (comportamiento histórico)", () => {
    expect(splitIntoSlots("10:00", "18:00", 0)).toEqual([{ startTime: "10:00", endTime: "18:00" }]);
  });

  it("descarta el resto final menor que el intervalo (10:00–18:30 cada 60)", () => {
    const r = splitIntoSlots("10:00", "18:30", 60);
    expect(r).toHaveLength(8);
    expect(r[r.length - 1]).toEqual({ startTime: "17:00", endTime: "18:00" });
  });

  it("intervalo mayor que el rango => un único slot", () => {
    expect(splitIntoSlots("10:00", "11:00", 90)).toEqual([{ startTime: "10:00", endTime: "11:00" }]);
  });

  it("rango inválido (fin <= inicio) => un único slot tal cual", () => {
    expect(splitIntoSlots("18:00", "10:00", 60)).toEqual([{ startTime: "18:00", endTime: "10:00" }]);
  });
});
