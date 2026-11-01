/**
 * Cierre de caja: el efectivo contado se escribe como en España («125,50»), con el ejemplo «0,00».
 * Antes el campo era numérico: «144,90» se quedaba vacío y la diferencia no se calculaba.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parseCashInput } from "../shared/cashAmount";

describe("parseCashInput", () => {
  it("coma decimal, punto decimal y millares", () => {
    expect(parseCashInput("125,50")).toBe(125.5);
    expect(parseCashInput("144,9")).toBe(144.9);
    expect(parseCashInput("125.50")).toBe(125.5);
    expect(parseCashInput("1.234,50")).toBe(1234.5);
    expect(parseCashInput("1 234,50 €")).toBe(1234.5);
    expect(parseCashInput("1,234.50")).toBe(1234.5);
    expect(parseCashInput("0")).toBe(0);
    expect(parseCashInput("0,00")).toBe(0);
    expect(parseCashInput("200")).toBe(200);
  });

  it("lo que no es un importe: null", () => {
    for (const v of ["", "  ", "abc", "-5", "12,345,6", "1,2,3", "12,555", "1.2.3"]) expect(parseCashInput(v), v).toBeNull();
  });
});

describe("pantalla de cierre de caja", () => {
  it("campo de texto con teclado decimal, ejemplo «0,00» y el importe leído con coma", () => {
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/tpv/TpvCloseSession.tsx"), "utf8");
    expect(src).toContain('placeholder="0,00"');
    expect(src).toContain('inputMode="decimal"');
    expect(src).not.toContain('type="number"');
    expect(src).toContain("parseCashInput(countedCash)");
    expect(src).toContain("countedCash: counted,");
  });
});
