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
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/setup/PrimerosPasosSteps.tsx"), "utf8");
    expect(src).not.toContain("unit * (1 + tax / 100)");
    expect(src).toContain("total: singleLineQuoteAmounts(unit, tax).total");
  });
});

describe("primeros pasos en móvil", () => {
  it("la rejilla no deja que el índice de pasos ensanche la página (390 px)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/setup/PrimerosPasos.tsx"), "utf8");
    expect(src).toContain('className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]"');
    expect(src).toContain('<nav aria-label="Pasos de Primeros pasos" className="min-w-0">');
    expect(src).toContain('<ol className="relative flex gap-2 overflow-x-auto');
  });
});

describe("primeros pasos: paso Marca", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../client/src/components/brand/BrandIdentityEditor.tsx"), "utf8");
  it("sin cambios se puede continuar con la marca (paso hecho, no omitido); con cambios, «Guardar y continuar»", () => {
    expect(src).toContain('variant === "onboarding" && !dirty');
    expect(src).toContain("Continuar con esta marca");
    expect(src).toContain('variant === "onboarding" ? "Guardar y continuar" : "Guardar"');
  });
  it("en móvil las rejillas del editor no se ensanchan con su contenido", () => {
    expect(src).toContain('className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"');
    expect(src).toContain('className="grid grid-cols-1 gap-4 sm:grid-cols-2"');
  });
});
