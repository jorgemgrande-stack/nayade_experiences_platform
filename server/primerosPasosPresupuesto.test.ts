/**
 * Primeros pasos: el borrador de presupuesto respeta la convención del CRM (el PVP incluye el IVA). Antes el total
 * sumaba el 21 % encima (25 € → 30,25 €) mientras el IVA mostrado era el ya incluido (4,34 €).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { singleLineQuoteAmounts } from "../client/src/lib/quoteAmounts";

describe("presupuesto de primeros pasos", () => {
  it("PVP con IVA incluido: total = PVP, base = PVP − IVA incluido", () => {
    expect(singleLineQuoteAmounts(25, 21)).toEqual({ subtotal: 20.66, tax: 4.34, total: 25 });
    expect(singleLineQuoteAmounts(110, 10)).toEqual({ subtotal: 100, tax: 10, total: 110 });
    expect(singleLineQuoteAmounts(50, 0)).toEqual({ subtotal: 50, tax: 0, total: 50 });
  });
  it("el asistente ya no suma el impuesto encima del precio", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/setup/PrimerosPasos.tsx"), "utf8");
    expect(src).not.toContain("unit * (1 + tax / 100)");
    expect(src).toContain("total: singleLineQuoteAmounts(unit, tax).total");
  });
});
