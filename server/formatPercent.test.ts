import { describe, it, expect } from "vitest";
import { formatPercentEs } from "../shared/formatPercent";

describe("porcentajes en formato es-ES", () => {
  it("coma decimal y espacio fijo antes de %", () => {
    expect(formatPercentEs(76.923)).toBe("76,9\u00a0%");
    expect(formatPercentEs(100)).toBe("100,0\u00a0%");
    expect(formatPercentEs(0)).toBe("0,0\u00a0%");
    expect(formatPercentEs(76.923)).not.toContain(".");
  });
  it("sin dato numérico, 0", () => {
    expect(formatPercentEs(Number.NaN)).toBe("0,0\u00a0%");
  });
});
