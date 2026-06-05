/**
 * Tests para server/reservationUtils.ts
 * Lógica pura de derivación de producto/extras y de fechas operativas por
 * componente (Parche A: packs/presupuestos con servicios en fechas distintas).
 */
import { describe, it, expect } from "vitest";
import {
  reservationProductFromQuoteItems,
  parseReservationExtras,
  reservationComponentDates,
  normalizeServiceDate,
} from "./reservationUtils";

describe("normalizeServiceDate", () => {
  it("acepta YYYY-MM-DD y recorta timestamps", () => {
    expect(normalizeServiceDate("2026-06-27")).toBe("2026-06-27");
    expect(normalizeServiceDate("2026-06-27T10:00:00.000Z")).toBe("2026-06-27");
  });
  it("rechaza valores no-fecha", () => {
    expect(normalizeServiceDate("el sábado")).toBeNull();
    expect(normalizeServiceDate(null)).toBeNull();
    expect(normalizeServiceDate(undefined)).toBeNull();
    expect(normalizeServiceDate(123 as unknown)).toBeNull();
  });
});

describe("reservationProductFromQuoteItems", () => {
  it("toma la primera línea con productId como principal y vuelca el resto a extras", () => {
    const res = reservationProductFromQuoteItems([
      { description: "Hotel 2 noches", productId: 500, quantity: 2, unitPrice: 100, total: 200 },
      { description: "Pack Aventura", productId: 30002, quantity: 6, unitPrice: 25, total: 150 },
    ]);
    expect(res.productId).toBe(500);
    const extras = JSON.parse(res.extrasJson!);
    expect(extras).toHaveLength(1);
    expect(extras[0].productId).toBe(30002);
    expect(extras[0].name).toBe("Pack Aventura");
  });

  it("propaga serviceDate por línea (principal y extras)", () => {
    const res = reservationProductFromQuoteItems([
      { description: "Hotel 2 noches", productId: 500, serviceDate: "2026-06-26" },
      { description: "Pack Aventura", productId: 30002, serviceDate: "2026-06-27T00:00:00Z" },
    ]);
    expect(res.mainServiceDate).toBe("2026-06-26");
    const extras = JSON.parse(res.extrasJson!);
    expect(extras[0].serviceDate).toBe("2026-06-27");
  });

  it("serviceDate ausente => null (heredará la fecha de la reserva)", () => {
    const res = reservationProductFromQuoteItems([
      { description: "Principal", productId: 1 },
      { description: "Extra sin fecha", productId: 2 },
    ]);
    expect(res.mainServiceDate).toBeNull();
    expect(JSON.parse(res.extrasJson!)[0].serviceDate).toBeNull();
  });

  it("lista vacía o no-array no rompe", () => {
    expect(reservationProductFromQuoteItems([], 9)).toEqual({ productId: 9, extrasJson: null, mainServiceDate: null });
    expect(reservationProductFromQuoteItems(null, 9).productId).toBe(9);
  });
});

describe("parseReservationExtras", () => {
  it("acepta string JSON y array ya parseado, y tolera basura", () => {
    expect(parseReservationExtras('[{"name":"x"}]')).toHaveLength(1);
    expect(parseReservationExtras([{ name: "y" }] as unknown)).toHaveLength(1);
    expect(parseReservationExtras("no-json")).toEqual([]);
    expect(parseReservationExtras(null)).toEqual([]);
  });
});

describe("reservationComponentDates", () => {
  it("la actividad principal va en booking_date (index 0 = principal)", () => {
    const comps = reservationComponentDates("2026-06-26", null);
    expect(comps).toEqual([{ index: 0, isMain: true, date: "2026-06-26" }]);
  });

  it("cada extra va en su serviceDate (index i+1); sin serviceDate hereda booking_date", () => {
    const extras = JSON.stringify([
      { name: "Pack Aventura", serviceDate: "2026-06-27" },
      { name: "Cena", serviceDate: null },
    ]);
    const comps = reservationComponentDates("2026-06-26", extras);
    expect(comps).toEqual([
      { index: 0, isMain: true, date: "2026-06-26" },
      { index: 1, isMain: false, date: "2026-06-27" },
      { index: 2, isMain: false, date: "2026-06-26" },
    ]);
  });

  it("el override del admin (activities_op_json) tiene prioridad sobre la semilla y la madre", () => {
    const extras = JSON.stringify([{ name: "Pack Aventura", serviceDate: "2026-06-27" }]);
    const opJson = JSON.stringify([
      { index: 0, serviceDate: "2026-06-30" }, // admin mueve la principal
      { index: 1, serviceDate: "2026-06-28" }, // admin re-agenda el pack
    ]);
    const comps = reservationComponentDates("2026-06-26", extras, opJson);
    expect(comps).toEqual([
      { index: 0, isMain: true, date: "2026-06-30" },
      { index: 1, isMain: false, date: "2026-06-28" },
    ]);
  });

  it("override sin serviceDate no rompe: cae a la semilla/madre", () => {
    const extras = JSON.stringify([{ name: "Pack", serviceDate: "2026-06-27" }]);
    const opJson = JSON.stringify([{ index: 1, monitorId: 5 }]); // override sin fecha
    const comps = reservationComponentDates("2026-06-26", extras, opJson);
    expect(comps[1].date).toBe("2026-06-27");
  });

  it("caso real RES-2026-0210: hotel (principal 26) + pack el sábado (27)", () => {
    const { extrasJson, mainServiceDate } = reservationProductFromQuoteItems([
      { description: "Hotel 2 noches", productId: 500, serviceDate: "2026-06-26" },
      { description: "Pack Aventura", productId: 30002, serviceDate: "2026-06-27" },
    ]);
    const comps = reservationComponentDates(mainServiceDate ?? "2026-06-26", extrasJson);
    const dates = comps.map((c) => c.date);
    expect(dates).toContain("2026-06-26");
    expect(dates).toContain("2026-06-27");
  });
});
