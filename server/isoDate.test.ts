import { describe, expect, it } from "vitest";
import { isValidIsoDate } from "../client/src/lib/isoDate";

describe("isValidIsoDate (validación de «Reprocesar fecha»)", () => {
  it("acepta fechas AAAA-MM-DD reales", () => {
    for (const v of ["2026-11-25", "2026-01-01", "2026-12-31", "2024-02-29", "2000-02-29", "1999-12-31"]) expect(isValidIsoDate(v), v).toBe(true);
  });
  it("rechaza formatos inválidos", () => {
    for (const v of ["", " ", "2026-1-1", "26-11-25", "2026/11/25", "25-11-2026", "2026-11-25T10:00", "2026-11-255", "abcd-ef-gh", "2026-11-2", "dddd-dd-dd"]) expect(isValidIsoDate(v), v).toBe(false);
  });
  it("rechaza días y meses que no existen", () => {
    for (const v of ["2026-02-30", "2026-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-04-31", "2026-11-00"]) expect(isValidIsoDate(v), v).toBe(false);
  });
  it("rechaza null, undefined y no cadenas", () => {
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate(20261125 as unknown as string)).toBe(false);
  });
  it("la expresión que había (sin barras invertidas) no aceptaba ninguna fecha", () => {
    const old = /^d{4}-d{2}-d{2}$/;
    expect(old.test("2026-11-25")).toBe(false);
  });
});
