/**
 * Abonos parciales (rectificativas): reglas del servidor (planCreditNote: límite acumulado total y por
 * línea, por unidades o por importe, varios tipos de IVA), el paso del formulario a la petición
 * (shared/creditNoteForm) y lo que muestra la pantalla «Emitir abono» (CreditNoteForm).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { computeDirectInvoice, creditNoteLineStatus, CreditNoteSelectionError, planCreditNote, round2, type InvoiceForCredit } from "./invoiceCalc";
import { buildCreditNoteSelection, emptyLineDraft, formatEur, validateCreditNoteReason, type CreditNoteLineDraft } from "../shared/creditNoteForm";

(globalThis as { React?: unknown }).React = React;
vi.mock("../client/src/lib/trpc", () => ({ trpc: {} }));

import { CreditNoteForm, type CreditNoteContextView } from "../client/src/pages/admin/crm/CreditNoteDialog";

// Factura con dos tipos de IVA: 2 × 50 € al 21 % (121 €) y 1 × 50 € al 10 % (55 €) = 176 €
const amounts = computeDirectInvoice([
  { description: "Servicio general", quantity: 2, unitPrice: 50, taxRate: 21 },
  { description: "Formación", quantity: 1, unitPrice: 50, taxRate: 10 },
]);
const invoice: InvoiceForCredit = {
  invoiceNumber: "FAC-2026-0001",
  total: amounts.total,
  subtotal: amounts.subtotal,
  taxAmount: amounts.taxAmount,
  taxRate: 21,
  taxBreakdown: amounts.taxBreakdown,
  itemsJson: amounts.items as InvoiceForCredit["itemsJson"],
};
/** Un abono emitido tal como queda guardado (lo que leen los siguientes). */
const asIssued = (p: ReturnType<typeof planCreditNote>): InvoiceForCredit => ({ total: p.amounts.total, subtotal: p.amounts.subtotal, taxAmount: p.amounts.taxAmount, taxBreakdown: p.amounts.taxBreakdown, itemsJson: p.amounts.items });

describe("reglas del abono (servidor)", () => {
  it("total: abona lo pendiente con su IVA por tipo y cierra la factura", () => {
    const p = planCreditNote(invoice, [], {});
    expect(p.creditTotal).toBe(176);
    expect(p.closesInvoice).toBe(true);
    expect(p.amounts.taxBreakdown).toEqual([{ rate: 21, base: -100, amount: -21 }, { rate: 10, base: -50, amount: -5 }]);
  });

  it("parcial por unidades: una unidad al 21 % → 60,50 € con su base y cuota; deja 115,50 € pendientes", () => {
    const p = planCreditNote(invoice, [], { lines: [{ itemIndex: 0, quantity: 1 }] });
    expect(p.amounts).toMatchObject({ subtotal: -50, taxAmount: -10.5, total: -60.5, closesInvoice: false });
    expect(p.amounts.items[0]).toMatchObject({ creditedFromLine: 0, quantity: 1, total: -60.5, taxRate: 21 });
    expect(p.remainingAfter).toBe(115.5);
  });

  it("parcial por importe de una línea: al tipo de IVA de esa línea", () => {
    const p = planCreditNote(invoice, [], { lines: [{ itemIndex: 1, amount: 22 }] });
    expect(p.amounts.taxBreakdown).toEqual([{ rate: 10, base: -20, amount: -2 }]);
    expect(p.amounts.total).toBe(-22);
  });

  it("límite por línea acumulado: una línea no se abona por encima de lo facturado en ella", () => {
    const first = asIssued(planCreditNote(invoice, [], { lines: [{ itemIndex: 0, quantity: 1 }] }));
    // Queda una unidad (60,50 €) de la línea 1: dos unidades ya no caben
    expect(() => planCreditNote(invoice, [first], { lines: [{ itemIndex: 0, quantity: 2 }] })).toThrow(/solo quedan 60,50 €/);
    expect(() => planCreditNote(invoice, [first], { lines: [{ itemIndex: 0, amount: 60.51 }] })).toThrow(CreditNoteSelectionError);
    // Sin cantidad: lo que le queda a la línea
    const rest = planCreditNote(invoice, [first], { lines: [{ itemIndex: 0 }] });
    expect(rest.creditTotal).toBe(60.5);
    const second = asIssued(rest);
    expect(() => planCreditNote(invoice, [first, second], { lines: [{ itemIndex: 0, amount: 1 }] })).toThrow(/ya está abonada por completo/);
    const status = creditNoteLineStatus(invoice, [first, second]);
    expect(status.map((s) => [s.credited, s.remaining])).toEqual([[121, 0], [0, 55]]);
    // La línea al 10 % completa la factura
    const last = planCreditNote(invoice, [first, second], { lines: [{ itemIndex: 1 }] });
    expect(last.closesInvoice).toBe(true);
    expect(() => planCreditNote(invoice, [first, second, asIssued(last)], {})).toThrow(/abonada por completo/);
  });

  it("límite total acumulado: por importe nunca más de lo pendiente, mezclando modos", () => {
    const byAmount = asIssued(planCreditNote(invoice, [], { partialAmount: 150 }));
    expect(() => planCreditNote(invoice, [byAmount], { partialAmount: 26.01 })).toThrow(/supera lo pendiente de abonar \(26,00 €\)/);
    expect(() => planCreditNote(invoice, [byAmount], { lines: [{ itemIndex: 1 }] })).toThrow(/supera lo pendiente/);
    expect(planCreditNote(invoice, [byAmount], {}).creditTotal).toBe(26);
  });

  it("rechaza selecciones imposibles", () => {
    expect(() => planCreditNote(invoice, [], { lines: [{ itemIndex: 0, quantity: 1, amount: 10 }] })).toThrow(/unidades o importe/);
    expect(() => planCreditNote(invoice, [], { lines: [{ itemIndex: 0, amount: 0 }] })).toThrow(/mayor que cero/);
    expect(() => planCreditNote(invoice, [], { partialAmount: 10, lines: [{ itemIndex: 0 }] })).toThrow(/no ambas/);
    expect(() => planCreditNote(invoice, [], { partialAmount: 0 })).toThrow(/mayor que cero/);
  });

  it("cuadra al céntimo con importes que no dividen exacto", () => {
    const p = planCreditNote(invoice, [], { lines: [{ itemIndex: 0, amount: 33.33 }, { itemIndex: 1, amount: 10.01 }] });
    const bd = round2(p.amounts.taxBreakdown.reduce((s, b) => s + b.base + b.amount, 0));
    expect(bd).toBe(p.amounts.total);
    expect(round2(p.amounts.subtotal + p.amounts.taxAmount)).toBe(-43.34);
  });
});

const lines = creditNoteLineStatus(invoice, []);

describe("formulario «Emitir abono»", () => {
  const drafts = (d: Record<number, Partial<CreditNoteLineDraft>>) =>
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...emptyLineDraft(lines[Number(k)]), selected: true, ...v }])) as Record<number, CreditNoteLineDraft>;

  it("total: sin líneas (abona lo pendiente)", () => {
    expect(buildCreditNoteSelection("total", lines, {})).toEqual({ ok: true });
  });

  it("parcial: todas las unidades = la línea entera; menos unidades o importe con coma decimal", () => {
    expect(buildCreditNoteSelection("partial", lines, drafts({ 0: { value: "2" } }))).toEqual({ ok: true, lines: [{ itemIndex: 0 }] });
    expect(buildCreditNoteSelection("partial", lines, drafts({ 0: { value: "1" }, 1: { by: "amount", value: "12,5" } }))).toEqual({ ok: true, lines: [{ itemIndex: 0, quantity: 1 }, { itemIndex: 1, amount: 12.5 }] });
  });

  it("errores junto a la línea: sin marcar nada, de más, vacío", () => {
    const none = buildCreditNoteSelection("partial", lines, {});
    expect(none).toMatchObject({ ok: false, message: "Marca al menos una línea que abonar" });
    const bad = buildCreditNoteSelection("partial", lines, drafts({ 0: { value: "3" }, 1: { by: "amount", value: "55,01" } }));
    expect(bad).toMatchObject({ ok: false, errors: { line0: "Como máximo 2 unidades", line1: `Como máximo ${formatEur(55)}` } });
    expect(buildCreditNoteSelection("partial", lines, drafts({ 1: { by: "amount", value: "" } }))).toMatchObject({ ok: false, errors: { line1: "Indica el importe a abonar" } });
  });

  it("motivo obligatorio", () => {
    expect(validateCreditNoteReason("  ")).toBe("Indica el motivo del abono");
    expect(validateCreditNoteReason("Devolución")).toBeNull();
  });
});

describe("pantalla «Emitir abono»", () => {
  const context: CreditNoteContextView = {
    invoice: { invoiceNumber: "FAC-2026-0001", clientName: "Marta Cliente", total: 176, credited: 60.5, remaining: 115.5 },
    lines: creditNoteLineStatus(invoice, [asIssued(planCreditNote(invoice, [], { lines: [{ itemIndex: 0, quantity: 1 }] }))]),
    previous: [{ invoiceNumber: "ABO-2026-11-0001", total: 60.5, reason: "Una sesión no realizada" }],
  };
  const render = (over: Partial<React.ComponentProps<typeof CreditNoteForm>> = {}) =>
    renderToStaticMarkup(
      React.createElement(CreditNoteForm, {
        context,
        mode: "partial",
        onModeChange: () => {},
        drafts: { 1: { selected: true, by: "amount", value: "22" } },
        onDraftChange: () => {},
        reason: "",
        onReasonChange: () => {},
        lineErrors: {},
        problem: null,
        reasonError: null,
        preview: null,
        ...over,
      }),
    );

  it("resume lo facturado, lo abonado, lo pendiente y los abonos anteriores", () => {
    const html = render();
    expect(html).toContain("Factura FAC-2026-0001");
    expect(html).toContain(`Pendiente de abonar ${formatEur(115.5)}`);
    expect(html).toContain("Abono ABO-2026-11-0001");
    expect(html).toContain("Una sesión no realizada");
  });

  it("parcial: líneas con su IVA y lo que queda por abonar de cada una", () => {
    const html = render();
    expect(html).toContain("Servicio general");
    expect(html).toContain(`Ya abonado ${formatEur(60.5)}`);
    expect(html).toContain(`Puedes abonar hasta ${formatEur(60.5)}`);
    expect(html).toContain("IVA 10 %");
    expect(html).toContain("Importe con IVA");
  });

  it("vista previa: base e IVA por tipo y total; aviso si cierra la factura", () => {
    const p = planCreditNote(invoice, [], { lines: [{ itemIndex: 0, quantity: 1 }, { itemIndex: 1, amount: 22 }] });
    const html = render({ preview: { ...p.amounts, remainingAfter: p.remainingAfter } });
    expect(html).toContain("Base al 21 %");
    expect(html).toContain("Base al 10 %");
    expect(html).toContain(formatEur(10.5));
    expect(html).toContain(formatEur(2));
    expect(html).toContain(`−${formatEur(82.5)}`);
    expect(html).toContain(`quedarán ${formatEur(93.5)} por abonar`);
    const total = planCreditNote(invoice, [], {});
    expect(render({ mode: "total", preview: { ...total.amounts, remainingAfter: 0 } })).toContain("queda abonada por completo");
  });

  it("muestra el motivo por el que no se puede emitir y el error del motivo", () => {
    const html = render({ problem: "El abono (200,00 €) supera lo pendiente de abonar (115,50 €)", reasonError: "Indica el motivo del abono", lineErrors: { line1: "Como máximo 55,00 €" } });
    expect(html).toContain("supera lo pendiente de abonar");
    expect(html).toContain("Indica el motivo del abono");
    expect(html).toContain("Como máximo 55,00 €");
  });

  it("modo total: no enseña las líneas; textos sin términos técnicos", () => {
    const html = render({ mode: "total" });
    expect(html).not.toContain("lineas-abono");
    expect(html).toContain("Todo lo pendiente");
    expect(html).toContain("La factura original no se modifica");
    expect(html).not.toMatch(/n[aá]yade|reserva|experiencia|\bAPI\b|token/i);
  });
});
