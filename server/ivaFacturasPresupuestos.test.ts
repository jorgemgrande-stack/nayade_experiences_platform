/**
 * Facturas de presupuestos con el convenio de IVA incluido: el descuento se aplica antes de desglosar, el
 * total es lo cobrado, el desglose por tipo cuadra al céntimo, los informes fiscales no atribuyen bases a
 * otro tipo y los abonos de facturas con descuento siguen cuadrando.
 */
import { describe, it, expect } from "vitest";
import { chargedInvoiceAmounts, chargedLineTotals, creditNoteLineStatus, planCreditNote, reportTaxBreakdown, round2 } from "./invoiceCalc";
import { linesToTaxIncluded, quoteTotalMismatch } from "./quoteTaxConvention";
import { storedBreakdown } from "./gestoriaInvoiceExport";

const sumGross = (bd: { base: number; amount: number }[]) => round2(bd.reduce((s, b) => s + b.base + b.amount, 0));

describe("chargedInvoiceAmounts: factura de un presupuesto por lo cobrado", () => {
  it("21 % con un 10 % de descuento: 121 → 108,90 = 90,00 + 18,90 (no 90 + 21)", () => {
    const a = chargedInvoiceAmounts([{ total: 121, taxRate: 21 }], 108.9);
    expect(a).toMatchObject({ subtotal: 90, taxAmount: 18.9, total: 108.9, taxRate: 21, discount: 12.1 });
    expect(a.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }]);
  });

  it("10 % con descuento", () => {
    const a = chargedInvoiceAmounts([{ total: 110, taxRate: 10 }], 99);
    expect(a.taxBreakdown).toEqual([{ rate: 10, base: 90, amount: 9 }]);
    expect(round2(a.subtotal + a.taxAmount)).toBe(99);
  });

  it("sin descuento: el desglose de siempre (base = PVP − cuota) y descuento 0", () => {
    const a = chargedInvoiceAmounts([{ total: 145.2, taxRate: 21 }], 145.2);
    expect(a).toMatchObject({ subtotal: 120, taxAmount: 25.2, total: 145.2, discount: 0 });
  });

  it("tipos mixtos: el descuento se reparte en proporción por tipo y suma exacta al céntimo", () => {
    const a = chargedInvoiceAmounts([{ total: 121, taxRate: 21 }, { total: 110, taxRate: 10 }], 207.9);
    expect(a.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
    expect(a).toMatchObject({ subtotal: 180, taxAmount: 27.9, total: 207.9, taxRate: 21, discount: 23.1 });
  });

  it("tipos mixtos con céntimos que no reparten exactos: base + IVA = total siempre", () => {
    for (const charged of [99.99, 100, 133.33, 57.77, 1.03]) {
      const a = chargedInvoiceAmounts([{ total: 33.33, taxRate: 21 }, { total: 66.67, taxRate: 10 }, { total: 41.4, taxRate: 4 }], charged);
      expect(sumGross(a.taxBreakdown)).toBe(charged);
      expect(round2(a.subtotal + a.taxAmount)).toBe(charged);
      expect(a.taxBreakdown.map((b) => b.rate)).toEqual([21, 10, 4]);
    }
  });

  it("parte sin IVA repercutido (REAV): también lleva su parte del descuento y no entra en el desglose", () => {
    const a = chargedInvoiceAmounts([{ total: 121, taxRate: 21 }, { total: 100, fiscalRegime: "reav" }], 198.9);
    expect(a.taxBreakdown).toEqual([{ rate: 21, base: 90, amount: 18.9 }]);
    expect(a.subtotal).toBe(180); // 90 de base + 90 sin IVA repercutido
    expect(a.total).toBe(198.9);
  });

  it("solo REAV: sin desglose ni IVA", () => {
    const a = chargedInvoiceAmounts([{ total: 100, fiscalRegime: "reav" }], 100);
    expect(a).toMatchObject({ taxBreakdown: [], taxAmount: 0, subtotal: 100, taxRate: 0 });
  });

  it("presupuesto antiguo con líneas sin IVA (120 → 145,20): factura por lo cobrado, 120 + 25,20", () => {
    const a = chargedInvoiceAmounts([{ total: 120, taxRate: 21 }], 145.2);
    expect(a).toMatchObject({ subtotal: 120, taxAmount: 25.2, total: 145.2, discount: 0 });
  });
});

describe("reportTaxBreakdown: modelo 303 por tipo", () => {
  it("usa el desglose guardado", () => {
    expect(reportTaxBreakdown({ total: 207.9, taxBreakdown: [{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }] }))
      .toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
  });

  it("documento antiguo de varios tipos sin desglose: cada base a su tipo, no todo al 21 %", () => {
    const bd = reportTaxBreakdown({
      total: 207.9, subtotal: 180, taxRate: 21, taxAmount: 31,
      itemsJson: [{ description: "A", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }, { description: "B", quantity: 1, unitPrice: 110, total: 110, taxRate: 10 }],
    });
    expect(bd).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
  });

  it("documento antiguo con parte REAV sin desglose: la parte REAV no es base del 21 %", () => {
    const bd = reportTaxBreakdown({
      total: 221, subtotal: 200, taxRate: 21, taxAmount: 21,
      itemsJson: [{ description: "A", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }, { description: "R", quantity: 1, unitPrice: 100, total: 100, fiscalRegime: "reav" }],
    });
    expect(bd).toEqual([{ rate: 21, base: 100, amount: 21 }]);
  });

  it("documento antiguo de un solo tipo: los importes guardados del documento (no se reescriben)", () => {
    expect(reportTaxBreakdown({ total: 108.9, subtotal: 90, taxRate: 21, taxAmount: 21, itemsJson: [{ description: "A", quantity: 1, unitPrice: 121, total: 121, taxRate: 21 }] }))
      .toEqual([{ rate: 21, base: 90, amount: 21 }]);
  });

  it("el libro de facturas tampoco atribuye un documento mixto con descuento a un solo tipo", () => {
    const bd = storedBreakdown({
      id: 1, invoiceNumber: "F-1", invoiceType: "factura", status: "cobrada", clientName: "C", clientNif: null, creditNoteForId: null, issuedAt: new Date(),
      itemsJson: [{ total: 121, taxRate: 21 }, { total: 110, taxRate: 10 }], taxRate: "21", taxAmount: "31", taxBreakdown: null, total: "207.90",
    } as any);
    expect(bd).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
  });
});

describe("abonos de facturas con descuento", () => {
  const amounts = chargedInvoiceAmounts([{ total: 121, taxRate: 21 }, { total: 110, taxRate: 10 }], 207.9);
  const invoice = {
    invoiceNumber: "FAC-2026-0001",
    total: amounts.total, subtotal: amounts.subtotal, taxAmount: amounts.taxAmount, taxRate: amounts.taxRate, taxBreakdown: amounts.taxBreakdown,
    itemsJson: [
      { description: "Servicio general", quantity: 1, unitPrice: 121, total: 121, taxRate: 21, fiscalRegime: "general" as const },
      { description: "Servicio reducido", quantity: 2, unitPrice: 55, total: 110, taxRate: 10, fiscalRegime: "general" as const },
    ],
  };

  it("las líneas se abonan por lo cobrado: suman el total de la factura", () => {
    expect(chargedLineTotals(invoice)).toEqual([108.9, 99]);
    const st = creditNoteLineStatus(invoice, []);
    expect(st.map((l) => [l.total, l.unitPrice, l.remaining])).toEqual([[108.9, 108.9, 108.9], [99, 49.5, 99]]);
  });

  it("abono total: devuelve lo cobrado con el desglose de la factura, por tipo", () => {
    const p = planCreditNote(invoice, [], {});
    expect(p.amounts.total).toBe(-207.9);
    expect(p.amounts.taxBreakdown).toEqual([{ rate: 21, base: -90, amount: -18.9 }, { rate: 10, base: -90, amount: -9 }]);
    expect(p.closesInvoice).toBe(true);
  });

  it("abono de una línea entera: su importe cobrado, al tipo de la línea", () => {
    const p = planCreditNote(invoice, [], { lines: [{ itemIndex: 0 }] });
    expect(p.amounts.total).toBe(-108.9);
    expect(p.amounts.taxBreakdown).toEqual([{ rate: 21, base: -90, amount: -18.9 }]);
  });

  it("abono de una unidad: precio cobrado de la unidad; las dos líneas completas cierran la factura", () => {
    const one = planCreditNote(invoice, [], { lines: [{ itemIndex: 1, quantity: 1 }] });
    expect(one.amounts.total).toBe(-49.5);
    expect(one.amounts.taxBreakdown).toEqual([{ rate: 10, base: -45, amount: -4.5 }]);
    const all = planCreditNote(invoice, [], { lines: [{ itemIndex: 0 }, { itemIndex: 1 }] });
    expect(all.amounts.total).toBe(-207.9);
    expect(all.closesInvoice).toBe(true);
  });

  it("abono parcial por importe: repartido entre los tipos de lo cobrado", () => {
    const p = planCreditNote(invoice, [], { partialAmount: 20.79 });
    expect(sumGross(p.amounts.taxBreakdown.map((b) => ({ base: -b.base, amount: -b.amount })))).toBe(20.79);
    expect(p.amounts.taxBreakdown.map((b) => b.rate)).toEqual([21, 10]);
  });

  it("factura sin descuento: las líneas se abonan como siempre", () => {
    const plain = { total: 121, taxRate: 21, itemsJson: [{ description: "S", quantity: 2, unitPrice: 60.5, total: 121, taxRate: 21 }] };
    expect(creditNoteLineStatus(plain, [])[0]).toMatchObject({ total: 121, unitPrice: 60.5 });
  });
});

describe("presupuestos recibidos: convenio de IVA incluido", () => {
  it("acepta líneas con IVA incluido y descuento coherentes", () => {
    expect(quoteTotalMismatch([{ total: 121 }], 12.1, 108.9)).toBeNull();
    expect(quoteTotalMismatch([{ total: 33.33 }, { total: 66.67 }], 0, 100)).toBeNull();
  });

  it("rechaza líneas sin IVA con un total con IVA (120 → 145,20) con un mensaje claro", () => {
    const msg = quoteTotalMismatch([{ total: 120 }], 0, 145.2);
    expect(msg).toContain("145,20 €");
    expect(msg).toContain("120,00 €");
    expect(msg).toContain("IVA incluido");
  });

  it("las bases imponibles indicadas se convierten a IVA incluido con el tipo de cada línea", () => {
    const lines = linesToTaxIncluded([
      { description: "A", quantity: 1, unitPrice: 120, total: 120, taxRate: 21 },
      { description: "B", quantity: 2, unitPrice: 50, total: 100, taxRate: 10 },
      { description: "R", quantity: 1, unitPrice: 80, total: 80, fiscalRegime: "reav" },
    ]);
    expect(lines.map((l) => [l.unitPrice, l.total])).toEqual([[145.2, 145.2], [55, 110], [80, 80]]);
    expect(quoteTotalMismatch(lines, 0, 335.2)).toBeNull();
  });
});
