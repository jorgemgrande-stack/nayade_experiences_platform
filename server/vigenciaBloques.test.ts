import { describe, expect, it } from "vitest";
import { filterScheduledBlocks, isScheduledOut, madridDay } from "../shared/pageBlocks";
import { normalizeStyle } from "./_core/pageBlocks";

const at = (iso: string) => Date.parse(iso);

describe("vigencia programada de bloques", () => {
  it("el día de Madrid cambia a medianoche de Madrid, no de UTC (invierno y verano)", () => {
    expect(madridDay(at("2026-11-29T22:30:00Z"))).toBe("2026-11-29"); // 23:30 en Madrid
    expect(madridDay(at("2026-11-29T23:30:00Z"))).toBe("2026-11-30"); // 00:30 del 30
    expect(madridDay(at("2026-07-15T21:30:00Z"))).toBe("2026-07-15"); // 23:30 en verano
    expect(madridDay(at("2026-07-15T22:30:00Z"))).toBe("2026-07-16"); // 00:30 del 16
  });

  it("el último día de vigencia se ve y el siguiente no", () => {
    const s = { showUntil: "2026-11-29" };
    expect(isScheduledOut(s, at("2026-11-29T22:59:00Z"))).toBe(false);
    expect(isScheduledOut(s, at("2026-11-29T23:00:00Z"))).toBe(true);
  });

  it("showFrom oculta antes del primer día y lo incluye", () => {
    const s = { showFrom: "2026-11-30" };
    expect(isScheduledOut(s, at("2026-11-29T22:59:00Z"))).toBe(true);
    expect(isScheduledOut(s, at("2026-11-29T23:00:00Z"))).toBe(false);
  });

  it("sin fechas o sin estilo, siempre visible", () => {
    expect(isScheduledOut(undefined, Date.now())).toBe(false);
    expect(isScheduledOut({ showFrom: "", showUntil: "" }, Date.now())).toBe(false);
  });

  it("filtra también dentro de las columnas de una sección y no toca el resto", () => {
    const blocks = [
      { id: "a", style: { showUntil: "2026-11-29" }, data: {} },
      { id: "b", data: {} },
      { id: "s", data: { columns: [{ blocks: [{ id: "c", style: { showUntil: "2026-11-29" }, data: {} }, { id: "d", data: {} }] }, { blocks: [] }] } },
    ];
    const out = filterScheduledBlocks(blocks as any[], at("2026-12-01T10:00:00Z"));
    expect(out.map((b: any) => b.id)).toEqual(["b", "s"]);
    expect((out[1] as any).data.columns[0].blocks.map((b: any) => b.id)).toEqual(["d"]);
    expect(filterScheduledBlocks(blocks as any[], at("2026-11-20T10:00:00Z"))).toHaveLength(3);
  });

  it("el normalizador conserva fechas válidas y descarta basura", () => {
    expect(normalizeStyle({ showUntil: "2026-11-29" })).toMatchObject({ showUntil: "2026-11-29", showFrom: "" });
    expect(normalizeStyle({ showUntil: "29/11/2026", showFrom: "x" })).toBeUndefined();
  });
});
