/**
 * Cargos extraordinarios y gastos variables (CRM 0028, I-4): validación, importe calculado del gasto variable,
 * idempotencia, aprobación con factura por devengo, anulación solo en borrador y lectura estable para la parte de pagos.
 */
import { describe, it, expect } from "vitest";
import { ChargeService, MemoryChargeStore, validateCharge, variableAmount, type NewChargeInput } from "./charges";
import { MemoryInvoicingStore } from "./store";
import type { CompanyFiscal } from "./rules";

const NEXTAIR: CompanyFiscal = { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031", address: "C/ José Luis Pérez Pujadas, Ed. Forum, 14, 1º D", postalCode: "18006", city: "Granada", country: "ES" };
const T = Date.UTC(2026, 10, 15, 9);

function setup() {
  const charges = new MemoryChargeStore();
  const invoices = new MemoryInvoicingStore();
  const svc = new ChargeService({ charges, invoices, company: async (id) => (id === 7 ? NEXTAIR : null), now: () => T });
  return { charges, invoices, svc };
}
const extra = (p: Partial<NewChargeInput> = {}): NewChargeInput => ({ idempotencyKey: "k-1", companyId: 7, kind: "extraordinary", concept: "Migración de datos de temporada", amountCents: 50_000, taxRateBp: 2100, dueDate: "2026-11-20", ...p });
const variable = (p: Partial<NewChargeInput> = {}): NewChargeInput => ({ idempotencyKey: "k-2", companyId: 7, kind: "variable_cost", concept: "Telefonía e IA de voz", taxRateBp: 2100, dueDate: "2026-11-30", detail: { provider: "Netelip", periodStart: "2026-11-01", periodEnd: "2026-11-30", costCents: 12_345, marginBp: 1500 }, ...p });

describe("cargos extraordinarios y gastos variables", () => {
  it("gasto variable: coste + margen calculado en el servidor (porcentaje redondeado o importe fijo)", () => {
    expect(variableAmount({ costCents: 12_345, marginBp: 1500 })).toBe(12_345 + 1852);
    expect(variableAmount({ costCents: 10_000, marginCents: 500 })).toBe(10_500);
    expect(variableAmount({ costCents: 10_000 })).toBe(10_000);
  });

  it("validación: importes, concepto, fecha, margen, autorización expresa para cobrar con la tarjeta", () => {
    expect(validateCharge(extra()).problems).toEqual([]);
    expect(validateCharge(extra({ amountCents: 0 })).problems.join()).toMatch(/positivo/);
    expect(validateCharge(extra({ concept: "x" })).problems.join()).toMatch(/concepto/);
    expect(validateCharge(extra({ dueDate: "2026-13-01" })).problems.join()).toMatch(/fecha/);
    expect(validateCharge(extra({ method: "card_on_file" })).problems.join()).toMatch(/mandateRef/);
    expect(validateCharge(extra({ method: "card_on_file", mandateRef: "acuerdo-cargos-extra-v1" })).problems).toEqual([]);
    expect(validateCharge(variable({ amountCents: 999 })).problems.join()).toMatch(/se calcula/);
    expect(validateCharge(variable({ detail: { costCents: 100 } })).problems.join()).toMatch(/proveedor/);
    expect(validateCharge(variable({ detail: { provider: "X", costCents: 100, marginBp: 10, marginCents: 5 } })).problems.join()).toMatch(/no los dos/);
    expect(validateCharge(variable({ detail: { provider: "X", costCents: 100, periodStart: "2026-11-30", periodEnd: "2026-11-01" } })).problems.join()).toMatch(/termina antes/);
  });

  it("idempotente por clave; empresa inexistente, error", async () => {
    const t = setup();
    const a = await t.svc.create(extra(), "operator:ana");
    const b = await t.svc.create(extra({ amountCents: 99_999 }), "operator:ana");
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, charge: { id: a.charge.id, amountCents: 50_000 } });
    await expect(t.svc.create(extra({ idempotencyKey: "k-x", companyId: 8 }), "op")).rejects.toMatchObject({ code: "not_found" });
  });

  it("aprobar: factura en borrador por devengo (fecha pactada), con proveedor y periodo; aprobar dos veces no duplica", async () => {
    const t = setup();
    const { charge } = await t.svc.create(variable(), "operator:ana");
    expect(charge).toMatchObject({ status: "draft", amountCents: 14_197, method: "payment_link" });
    const r = await t.svc.approve(charge.id, "operator:jorge");
    expect(r.charge).toMatchObject({ status: "approved", decidedBy: "operator:jorge", invoiceId: r.invoice.id });
    expect(r.invoice).toMatchObject({ sourceKey: `charge:${charge.id}`, status: "draft", operationDate: "2026-11-30", baseCents: 14_197, taxCents: 2981, totalCents: 17_178, periodLabel: "2026-11-01 a 2026-11-30", customer: { taxId: "B16408031" } });
    expect(r.invoice.lines[0].concept).toBe("Telefonía e IA de voz — Netelip (2026-11-01 a 2026-11-30)");
    const again = await t.svc.approve(charge.id, "operator:jorge");
    expect(again.invoice.id).toBe(r.invoice.id);
    expect(t.invoices.rows).toHaveLength(1);
  });

  it("anular solo en borrador y con motivo; lo aprobado se corrige con rectificativa", async () => {
    const t = setup();
    const a = (await t.svc.create(extra(), "op")).charge;
    await expect(t.svc.cancel(a.id, " ", "op")).rejects.toMatchObject({ code: "invalid_input" });
    expect(await t.svc.cancel(a.id, "Incluido en la cuota", "op")).toMatchObject({ status: "cancelled", reason: "Incluido en la cuota" });
    await expect(t.svc.approve(a.id, "op")).rejects.toMatchObject({ code: "invalid_state" });
    const b = (await t.svc.create(extra({ idempotencyKey: "k-3" }), "op")).charge;
    await t.svc.approve(b.id, "op");
    await expect(t.svc.cancel(b.id, "error", "op")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/rectificativa/) });
  });

  it("lectura estable para pagos (I-4): solo aprobados, filtro por método, sin datos internos", async () => {
    const t = setup();
    const a = (await t.svc.create(extra(), "op")).charge;
    await t.svc.create(extra({ idempotencyKey: "k-4" }), "op");
    const c = (await t.svc.create(extra({ idempotencyKey: "k-5", method: "card_on_file", mandateRef: "acuerdo-v1" }), "op")).charge;
    await t.svc.approve(a.id, "operator:jorge");
    await t.svc.approve(c.id, "operator:jorge");
    const all = await t.svc.approvedCharges();
    expect(all.map((x) => x.chargeRef).sort()).toEqual([`charge:${a.id}`, `charge:${c.id}`]);
    expect(await t.svc.approvedCharges({ method: "card_on_file" })).toEqual([
      { id: c.id, chargeRef: `charge:${c.id}`, companyId: 7, concept: "Migración de datos de temporada", currency: "EUR", amountCents: 50_000, taxRateBp: 2100, method: "card_on_file", mandateRef: "acuerdo-v1", approvedBy: "operator:jorge", approvedAt: T, dueDate: "2026-11-20", invoiceId: expect.any(Number), agreementRef: null },
    ]);
  });
});
