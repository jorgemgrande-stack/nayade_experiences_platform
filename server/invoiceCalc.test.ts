import { describe, it, expect } from "vitest";
import { computeCreditNote, computeCreditNoteFromLines, computeDirectInvoice, CreditNoteSelectionError, invoiceComponents, prorate, round2 } from "./invoiceCalc";
import { parseAmount, validateNewInvoice, validateNif } from "../shared/directInvoice";
import { assertCounterValueAllowed, CounterResetError } from "./documentNumbers";
import { madridMonth, madridYear } from "./utils/timezone";
import { creditNotePrefix } from "./creditNoteNumber";

/** Comprueba que líneas, desglose, base, cuota y total cuadran al céntimo. */
function expectBalanced(a: { items: { total: number }[]; taxBreakdown: { base: number; amount: number }[]; subtotal: number; taxAmount: number; total: number }, untaxed = 0) {
  const lines = round2(a.items.reduce((s, i) => s + i.total, 0));
  const bd = round2(a.taxBreakdown.reduce((s, b) => s + b.base + b.amount, 0));
  expect(lines).toBe(a.total);
  expect(round2(bd + untaxed)).toBe(a.total);
  expect(round2(a.subtotal + a.taxAmount)).toBe(a.total);
  expect(round2(a.taxBreakdown.reduce((s, b) => s + b.amount, 0))).toBe(a.taxAmount);
}

// Factura con dos tipos de IVA: 100 € de base al 21 % y 50 € de base al 10 %
const multi = computeDirectInvoice([
  { description: "Servicio general", quantity: 2, unitPrice: 50, taxRate: 21 },
  { description: "Servicio reducido", quantity: 1, unitPrice: 50, taxRate: 10 },
]);
const multiInvoice = {
  invoiceNumber: "FAC-2026-0001",
  total: multi.total.toFixed(2),
  subtotal: multi.subtotal.toFixed(2),
  taxRate: "21",
  taxAmount: multi.taxAmount.toFixed(2),
  taxBreakdown: multi.taxBreakdown,
  itemsJson: multi.items,
};

describe("factura libre", () => {
  it("base × tipo por línea; desglose por tipo; cuadra", () => {
    expect(multi.taxBreakdown).toEqual([
      { rate: 21, base: 100, amount: 21 },
      { rate: 10, base: 50, amount: 5 },
    ]);
    expect(multi.subtotal).toBe(150);
    expect(multi.taxAmount).toBe(26);
    expect(multi.total).toBe(176);
    expect(multi.taxRate).toBe(21);
    expect(multi.items[0]).toMatchObject({ total: 121, unitPrice: 60.5, taxRate: 21, fiscalRegime: "general" });
    expectBalanced(multi);
  });

  it("tipos 4 % y 0 %, redondeo por línea", () => {
    const r = computeDirectInvoice([
      { description: "Libro", quantity: 3, unitPrice: 9.99, taxRate: 4 },
      { description: "Exento", quantity: 1, unitPrice: 12.345, taxRate: 0 },
    ]);
    expect(r.taxBreakdown).toEqual([
      { rate: 4, base: 29.97, amount: 1.2 },
      { rate: 0, base: 12.35, amount: 0 },
    ]);
    expect(r.total).toBe(43.52);
    expectBalanced(r);
  });

  it("validación del formulario por campo", () => {
    const empty = { name: "", nif: "", email: "", phone: "", address: "" };
    const line = { description: "", quantity: "0", unitPrice: "", taxRate: 21 as const };
    expect(validateNewInvoice("existing", null, empty, [line])).toMatchObject({
      clientId: "Elige un cliente",
      "line0.description": "Indica el concepto",
      "line0.quantity": "Debe ser mayor que cero",
      "line0.unitPrice": "Indica el precio",
    });
    const e = validateNewInvoice("new", null, { ...empty, nif: "12345678A", email: "no-es-correo" }, [{ description: "Concepto", quantity: "1", unitPrice: "-1", taxRate: 21 }]);
    expect(e.name).toBeTruthy();
    expect(e.nif).toBe("El NIF no es válido");
    expect(e.email).toBeTruthy();
    expect(e["line0.unitPrice"]).toBe("No puede ser negativo");
    expect(validateNewInvoice("new", null, { ...empty, name: "Cliente SL", nif: "12345678Z" }, [{ description: "C", quantity: "1,5", unitPrice: "10,50", taxRate: 10 }])).toEqual({});
    expect(validateNif("FR12345678901")).toBeNull();
    expect(parseAmount("10,50")).toBe(10.5);
  });
});

describe("abonos", () => {
  it("abono total de una factura multi-IVA: copia líneas y desglose en negativo", () => {
    const cn = computeCreditNote(multiInvoice, [], 176);
    expect(cn.closesInvoice).toBe(true);
    expect(cn.total).toBe(-176);
    expect(cn.taxBreakdown).toEqual([
      { rate: 21, base: -100, amount: -21 },
      { rate: 10, base: -50, amount: -5 },
    ]);
    expect(cn.items.map((i) => i.description)).toEqual(["Servicio general", "Servicio reducido"]);
    expect(cn.items[0]).toMatchObject({ unitPrice: -60.5, total: -121, taxRate: 21 });
    expectBalanced(cn);
  });

  it("abono parcial por importe: reparto proporcional entre tipos, una línea por tipo y cuadra", () => {
    const cn = computeCreditNote(multiInvoice, [], 50);
    expect(cn.closesInvoice).toBe(false);
    expect(cn.total).toBe(-50);
    expect(cn.taxBreakdown.map((b) => b.rate)).toEqual([21, 10]);
    // 121/176 y 55/176 de 50 € (34,375 y 15,625: el céntimo sobrante se descuenta del tipo mayor)
    expect(round2(cn.taxBreakdown[0].base + cn.taxBreakdown[0].amount)).toBe(-34.37);
    expect(round2(cn.taxBreakdown[1].base + cn.taxBreakdown[1].amount)).toBe(-15.63);
    // la cuota es la del tipo sobre la base (al céntimo)
    for (const b of cn.taxBreakdown) {
      const rate = b.rate;
      expect(Math.abs(round2(b.base * rate / 100) - b.amount)).toBeLessThanOrEqual(0.01);
    }
    expect(cn.items).toHaveLength(2);
    expect(cn.items[0].description).toContain("Abono parcial de la factura FAC-2026-0001");
    expectBalanced(cn);
  });

  it("dos abonos parciales y el que completa la factura suman exactamente cero por tipo", () => {
    const first = computeCreditNote(multiInvoice, [], 33.33);
    const prevRow = (a: typeof first) => ({ total: a.total, subtotal: a.subtotal, taxAmount: a.taxAmount, taxBreakdown: a.taxBreakdown, itemsJson: a.items });
    const second = computeCreditNote(multiInvoice, [prevRow(first)], 77.77);
    const rest = round2(176 - 33.33 - 77.77);
    const last = computeCreditNote(multiInvoice, [prevRow(first), prevRow(second)], rest);
    expect(last.closesInvoice).toBe(true);
    for (const cn of [first, second, last]) expectBalanced(cn);
    for (const rate of [21, 10]) {
      const orig = multi.taxBreakdown.find((b) => b.rate === rate)!;
      const credited = [first, second, last].map((c) => c.taxBreakdown.find((b) => b.rate === rate)!);
      expect(round2(orig.base + credited.reduce((s, b) => s + b.base, 0))).toBe(0);
      expect(round2(orig.amount + credited.reduce((s, b) => s + b.amount, 0))).toBe(0);
    }
  });

  it("factura antigua sin desglose: usa el tipo de la factura (no el 21 por defecto)", () => {
    const old = { invoiceNumber: "FAC-2025-0009", total: "110.00", subtotal: "100.00", taxRate: "10.00", taxAmount: "10.00", taxBreakdown: null, itemsJson: [{ description: "S", quantity: 1, unitPrice: 110, total: 110 }] };
    const cn = computeCreditNote(old, [], 22);
    expect(cn.taxBreakdown).toEqual([{ rate: 10, base: -20, amount: -2 }]);
    expectBalanced(cn);
  });

  it("parte sin IVA repercutido (REAV) queda fuera del desglose", () => {
    const inv = {
      total: "221.00", taxRate: "21",
      taxBreakdown: [{ rate: 21, base: 100, amount: 21 }],
      itemsJson: [
        { description: "General", quantity: 1, unitPrice: 121, total: 121, fiscalRegime: "general" as const, taxRate: 21 },
        { description: "Viaje", quantity: 1, unitPrice: 100, total: 100, fiscalRegime: "reav" as const },
      ],
    };
    expect(invoiceComponents(inv)).toEqual([{ rate: 21, base: 100, amount: 21 }, { rate: null, base: 100, amount: 0 }]);
    const cn = computeCreditNote(inv, [], 110.5);
    expect(cn.taxBreakdown).toHaveLength(1);
    expectBalanced(cn, -50);
  });

  it("prorrateo: el céntimo de redondeo va al tipo mayor y la suma es exacta", () => {
    const out = prorate([{ rate: 21, base: 0.33, amount: 0.07 }, { rate: 10, base: 0.3, amount: 0.03 }, { rate: 4, base: 0.32, amount: 0.01 }], 0.01);
    expect(round2(out.reduce((s, c) => s + c.base + c.amount, 0))).toBe(0.01);
  });

  it("abono por líneas: solo lo elegido, en proporción a la cantidad, cuadra", () => {
    const cn = computeCreditNoteFromLines(multiInvoice, [{ itemIndex: 0, quantity: 1 }, { itemIndex: 1 }]);
    expect(cn.items).toHaveLength(2);
    expect(cn.items[0]).toMatchObject({ description: "Servicio general", quantity: 1, total: -60.5 });
    expect(cn.total).toBe(-115.5);
    expect(cn.taxBreakdown).toEqual([
      { rate: 21, base: -50, amount: -10.5 },
      { rate: 10, base: -50, amount: -5 },
    ]);
    expectBalanced(cn);
    expect(() => computeCreditNoteFromLines(multiInvoice, [{ itemIndex: 0, quantity: 3 }])).toThrow(CreditNoteSelectionError);
    expect(() => computeCreditNoteFromLines(multiInvoice, [{ itemIndex: 5 }])).toThrow(/no existe/);
    expect(() => computeCreditNoteFromLines(multiInvoice, [{ itemIndex: 0 }, { itemIndex: 0 }])).toThrow(/repetida/);
  });
});

describe("contador de series fiscales", () => {
  it("facturas y abonos no bajan del último número emitido; las series no fiscales sí pueden", () => {
    expect(() => assertCounterValueAllowed("factura", 4, 5)).toThrow(CounterResetError);
    expect(() => assertCounterValueAllowed("factura", 4, 5)).toThrow(/último número emitido \(5\)/);
    expect(() => assertCounterValueAllowed("abono", 0, 1)).toThrow(CounterResetError);
    expect(() => assertCounterValueAllowed("factura", 5, 5)).not.toThrow();
    expect(() => assertCounterValueAllowed("factura", 9, 5)).not.toThrow();
    expect(() => assertCounterValueAllowed("presupuesto", 0, 50)).not.toThrow();
  });
});

describe("año fiscal de Madrid", () => {
  it("la Nochevieja en UTC ya es el año siguiente en Madrid", () => {
    const d = new Date("2026-12-31T23:30:00Z");
    expect(madridYear(d)).toBe(2027);
    expect(madridMonth(d)).toBe(1);
    expect(creditNotePrefix(d)).toBe("ABO-2027-01-");
    expect(madridYear(new Date("2026-12-31T22:30:00Z"))).toBe(2026);
  });
});
