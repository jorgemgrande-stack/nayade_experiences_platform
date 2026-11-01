/**
 * IVA de una venta de caja con descuento global: el descuento se reparte por tipo antes de desglosar (mismo
 * criterio que las facturas de presupuestos), el total es lo cobrado y se guarda el desglose por tipo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tpvSaleTax } from "./tpvSaleTax";

const r2 = (n: number) => Math.round(n * 100) / 100;
const balanced = (t: ReturnType<typeof tpvSaleTax>, untaxed = 0) => {
  expect(r2(t.taxBreakdown.reduce((s, b) => s + b.base + b.amount, 0) + untaxed)).toBe(t.total);
  expect(r2(t.subtotal + t.taxAmount)).toBe(t.total);
};

describe("IVA de una venta de caja", () => {
  it("sin descuento: cada tipo con su base y su cuota", () => {
    const t = tpvSaleTax([{ lineSubtotal: 121, fiscalRegime: "general", taxRate: 21 }, { lineSubtotal: 110, fiscalRegime: "general", taxRate: 10 }], 231);
    expect(t.taxBreakdown).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 100, amount: 10 }]);
    expect([t.taxBase, t.taxAmount, t.total, t.ratio]).toEqual([200, 31, 231, 1]);
    balanced(t);
  });

  it("IVA mixto con descuento global: el descuento reduce cada tipo antes de desglosar (antes: IVA de las líneas sin descontar)", () => {
    // 121 € al 21 % + 110 € al 10 %, 23,10 € de descuento → 207,90 €
    const t = tpvSaleTax([{ lineSubtotal: 121, fiscalRegime: "general", taxRate: 21 }, { lineSubtotal: 110, fiscalRegime: "general", taxRate: 10 }], 207.9);
    expect(t.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
    expect([t.taxBase, t.taxAmount, t.total]).toEqual([180, 27.9, 207.9]);
    expect(t.taxAmount).not.toBe(31);
    expect(t.taxRate).toBe(15.5); // tipo efectivo de la venta con dos tipos
    balanced(t);
  });

  it("descuento que no reparte exacto: cuadra al céntimo con lo cobrado", () => {
    // 60,50 € al 21 % + 33 € al 10 % con 5 € de descuento → 88,50 €
    const t = tpvSaleTax([{ lineSubtotal: 60.5, fiscalRegime: "general", taxRate: "21.00" }, { lineSubtotal: 33, fiscalRegime: "general", taxRate: "10.00" }], 88.5);
    expect(t.taxBreakdown.map((b) => b.rate)).toEqual([21, 10]);
    expect(r2(t.taxBreakdown[0].base + t.taxBreakdown[0].amount)).toBe(57.26);
    expect(r2(t.taxBreakdown[1].base + t.taxBreakdown[1].amount)).toBe(31.24);
    balanced(t);
  });

  it("con una parte sin IVA repercutido (REAV) y tipo 0 %: la parte REAV no entra en el desglose", () => {
    const t = tpvSaleTax([{ lineSubtotal: 121, fiscalRegime: "general", taxRate: 21 }, { lineSubtotal: 100, fiscalRegime: "reav", taxRate: 0 }], 198.9);
    expect(t.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }]);
    balanced(t, 90);
    const zero = tpvSaleTax([{ lineSubtotal: 50, fiscalRegime: "general", taxRate: 0 }], 45);
    expect(zero.taxBreakdown).toEqual([{ rate: 0, base: 45, amount: 0 }]);
    expect(zero.taxRate).toBe(0);
  });

  it("el TPV usa este cálculo para la venta, el asiento y la factura (con su desglose)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers/tpv.ts"), "utf8");
    expect(src).toContain("const saleTax = tpvSaleTax(linesFiscal, total);");
    expect(src).toContain("const invAmounts = chargedInvoiceAmounts(invoiceItems, total);");
    expect(src).toMatch(/taxBreakdown:\s+invAmounts\.taxBreakdown/);
    expect(src).not.toContain("linesFiscal.reduce((s, l) => s + l.taxAmount, 0)");
  });
});
