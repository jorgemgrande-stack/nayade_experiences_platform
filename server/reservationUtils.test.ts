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
  collectComponentProductIds,
  buildPackExpansions,
  type ExpandedPackLine,
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

const LINE = (lineId: number, title: string, extra: Partial<ExpandedPackLine> = {}): ExpandedPackLine => ({
  lineId, title, quantity: 1, sourceType: "experience", sourceId: lineId, groupLabel: null, isOptional: false, ...extra,
});

describe("collectComponentProductIds", () => {
  it("reúne principal + extras sin duplicar y omitiendo null", () => {
    const extras = [
      { name: "A", productId: 30002 } as any,
      { name: "B", productId: null } as any,
      { name: "C", productId: 30002 } as any, // duplicado
    ];
    expect(collectComponentProductIds(120002, extras).sort((a, b) => a - b)).toEqual([30002, 120002]);
  });
  it("sin principal ni extras válidos => vacío", () => {
    expect(collectComponentProductIds(null, [])).toEqual([]);
    expect(collectComponentProductIds(undefined, [{ name: "X", productId: null } as any])).toEqual([]);
  });
});

describe("buildPackExpansions", () => {
  const map: Record<number, ExpandedPackLine[]> = {
    120002: [LINE(1, "Hotel"), LINE(2, "Pack Basic")],
    30002: [LINE(9, "Blob Jump"), LINE(11, "Banana Ski", { isOptional: true })],
  };

  it("expande el principal (index 0) y el extra que sean Lego Pack", () => {
    const extras = [{ name: "Pack Aventura", productId: 30002 } as any];
    const out = buildPackExpansions(120002, extras, map);
    expect(Object.keys(out).sort()).toEqual(["0", "1"]);
    expect(out[0].map(l => l.title)).toEqual(["Hotel", "Pack Basic"]);   // principal
    expect(out[1].map(l => l.title)).toEqual(["Blob Jump", "Banana Ski"]); // extra 0 -> index 1
  });

  it("ignora componentes que NO son Lego Pack (experiencia suelta)", () => {
    const extras = [{ name: "Banana Ski suelta", productId: 99999 } as any];
    const out = buildPackExpansions(88888, extras, map);
    expect(out).toEqual({});
  });

  it("solo el extra es pack: index 1, sin index 0", () => {
    const extras = [{ name: "Pack Aventura", productId: 30002 } as any];
    const out = buildPackExpansions(88888, extras, map);
    expect(Object.keys(out)).toEqual(["1"]);
  });

  it("la experiencia manda: un product_id que es experiencia NO se expande aunque colisione con un lego_pack", () => {
    // 120002 existe en el mapa de packs PERO también es una experiencia real:
    // colisión de ids (experiences.id vs lego_packs.id). No debe expandirse.
    const out = buildPackExpansions(120002, [], map, new Set([120002]));
    expect(out).toEqual({});
  });

  it("la experiencia manda: aplica también a los extras que sean experiencias", () => {
    const extras = [{ name: "Canoas suelta", productId: 30002 } as any];
    const out = buildPackExpansions(120002, extras, map, new Set([30002]));
    expect(Object.keys(out)).toEqual(["0"]);          // el principal (pack real) sí
    expect(out[1]).toBeUndefined();                    // el extra-experiencia no
  });

  it("sin experienceIds, el comportamiento es el de antes (retrocompatible)", () => {
    const extras = [{ name: "Pack Aventura", productId: 30002 } as any];
    const out = buildPackExpansions(120002, extras, map);
    expect(Object.keys(out).sort()).toEqual(["0", "1"]);
  });
});
