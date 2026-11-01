/**
 * Factura libre: precios con IVA incluido (por defecto en el formulario, como productos y presupuestos) o sin
 * IVA, con el mismo desglose; con IVA al 0 % se exige el motivo de la exención y se guarda en la línea.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeDirectInvoice, convertUnitPrice, needsExemptionReason, validateNewInvoice } from "../shared/directInvoice";

const r2 = (n: number) => Math.round(n * 100) / 100;
const client = { name: "Cliente SL", nif: "", email: "", phone: "", address: "" };

describe("factura libre: IVA incluido o sin IVA", () => {
  it("con IVA incluido: el total es lo escrito y base + IVA se extraen por tipo", () => {
    const a = computeDirectInvoice([
      { description: "Servicio", quantity: 1, unitPrice: 121, taxRate: 21 },
      { description: "Libro", quantity: 2, unitPrice: 10.4, taxRate: 4 },
      { description: "Curso", quantity: 1, unitPrice: 50, taxRate: 0, exemptionReason: "Exenta (art. 20 LIVA)" },
    ], { pricesIncludeTax: true });
    expect(a.total).toBe(191.8);
    expect(a.taxBreakdown).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: 4, base: 20, amount: 0.8 }, { rate: 0, base: 50, amount: 0 }]);
    expect([a.subtotal, a.taxAmount]).toEqual([170, 21.8]);
    expect(a.items.map((i) => i.total)).toEqual([121, 20.8, 50]);
    expect(r2(a.items.reduce((s, i) => s + i.total, 0))).toBe(a.total);
    expect(a.items[2].exemptionReason).toBe("Exenta (art. 20 LIVA)");
    expect(a.items[0]).not.toHaveProperty("exemptionReason");
  });

  it("sin IVA: mismo resultado que antes (base × tipo por línea)", () => {
    const a = computeDirectInvoice([{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21 }]);
    expect([a.subtotal, a.taxAmount, a.total]).toEqual([100, 21, 121]);
    expect(computeDirectInvoice([{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21 }], { pricesIncludeTax: false })).toEqual(a);
  });

  it("con IVA incluido y céntimos que no dividen exacto: líneas, desglose y total cuadran", () => {
    const a = computeDirectInvoice([
      { description: "A", quantity: 3, unitPrice: 9.99, taxRate: 21 },
      { description: "B", quantity: 1, unitPrice: 0.05, taxRate: 21 },
      { description: "C", quantity: 7, unitPrice: 1.1, taxRate: 10 },
    ], { pricesIncludeTax: true });
    expect(a.total).toBe(r2(29.97 + 0.05 + 7.7));
    expect(r2(a.taxBreakdown.reduce((s, b) => s + b.base + b.amount, 0))).toBe(a.total);
    expect(r2(a.subtotal + a.taxAmount)).toBe(a.total);
    expect(a.taxBreakdown[0]).toEqual({ rate: 21, base: 24.81, amount: 5.21 });
  });

  it("al cambiar el selector, el precio se convierte y el total se mantiene", () => {
    expect(convertUnitPrice(100, 21, true)).toBe(121);
    expect(convertUnitPrice(121, 21, false)).toBe(100);
    expect(convertUnitPrice(50, 0, true)).toBe(50);
    const sin = computeDirectInvoice([{ description: "S", quantity: 2, unitPrice: 100, taxRate: 10 }]);
    const con = computeDirectInvoice([{ description: "S", quantity: 2, unitPrice: convertUnitPrice(100, 10, true), taxRate: 10 }], { pricesIncludeTax: true });
    expect(con.total).toBe(sin.total);
    expect(con.taxBreakdown).toEqual(sin.taxBreakdown);
  });

  it("IVA al 0 %: el motivo de la exención es obligatorio", () => {
    expect(needsExemptionReason({ taxRate: 0 })).toBe(true);
    expect(needsExemptionReason({ taxRate: 0, exemptionReason: "  " })).toBe(true);
    expect(needsExemptionReason({ taxRate: 0, exemptionReason: "Exenta" })).toBe(false);
    expect(needsExemptionReason({ taxRate: 21 })).toBe(false);
    const e = validateNewInvoice("new", null, client, [{ description: "Curso", quantity: "1", unitPrice: "50", taxRate: 0, exemptionReason: "" }]);
    expect(e["line0.exemptionReason"]).toMatch(/motivo de la exención/);
    expect(validateNewInvoice("new", null, client, [{ description: "Curso", quantity: "1", unitPrice: "50", taxRate: 0, exemptionReason: "Exenta" }])).toEqual({});
  });

  it("el formulario usa IVA incluido por defecto, con selector y motivo de exención; el documento lo muestra", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/NewInvoiceDialog.tsx"), "utf8");
    expect(src).toContain("useState(true)");
    expect(src).toContain("Precios con IVA incluido");
    expect(src).toContain("Precios sin IVA");
    expect(src).toContain("Motivo de la exención");
    expect(src).toContain("computeDirectInvoice(valid, { pricesIncludeTax })");
    const html = fs.readFileSync(path.resolve(__dirname, "invoiceHtml.ts"), "utf8");
    expect(html).toContain("exemptionReasons");
  });
});
