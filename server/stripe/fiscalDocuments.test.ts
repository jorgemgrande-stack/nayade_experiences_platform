import { describe, expect, it } from "vitest";
import { EXTERNAL_REF, invoiceDocumentOf, invoiceRecordOf, invoiceSourceKey, pendingSink, rectificationOf, refundSourceKey } from "./fiscalDocuments";
import type { GwInvoice } from "./gateway";

const inv: GwInvoice = { id: "in_1", status: "paid", subscriptionId: "sub_1", customerId: "cus_1", amountPaid: 3509, currency: "eur", billingReason: "subscription_create", periodStart: 1_800_000_000, subtotal: 2900, taxCents: 609, total: 3509, number: "ES-0001", customerCountry: "ES", customerPostalCode: "28002", customerTaxIds: 1 };

describe("registro de facturas y documentos fiscales (cálculos)", () => {
  it("copia de la factura: base, impuesto, total, número y escenario; periodo en ms y moneda en mayúsculas", () => {
    expect(invoiceRecordOf(inv, { orderId: 7, purpose: "initial", buyerScenario: "business:es_mainland", now: 5 })).toMatchObject({
      stripeInvoiceId: "in_1", orderId: 7, number: "ES-0001", currency: "EUR", subtotalCents: 2900, taxCents: 609, totalCents: 3509, amountPaidCents: 3509, amountRefundedCents: 0, periodStart: 1_800_000_000_000, buyerScenario: "business:es_mainland",
    });
    // Sin total ni subtotal informados: se toma lo pagado; sin impuesto informado queda null (no se inventa 0)
    expect(invoiceRecordOf({ ...inv, subtotal: null, total: null, taxCents: null }, { orderId: 7, purpose: "renewal", buyerScenario: null, now: 5 })).toMatchObject({ subtotalCents: 3509, totalCents: 3509, taxCents: null });
  });
  it("documento de la factura: positivo, sin original, clave de origen por factura", () => {
    const d = invoiceDocumentOf(invoiceRecordOf(inv, { orderId: 7, purpose: "initial", buyerScenario: null, now: 5 }), 6);
    expect(d).toEqual({ kind: "invoice", sourceKey: invoiceSourceKey("in_1"), orderId: 7, stripeInvoiceId: "in_1", stripeChargeId: null, originalDocumentId: null, currency: "EUR", baseCents: 2900, taxCents: 609, totalCents: 3509, createdAt: 6 });
  });
  it("rectificativa: solo lo reembolsado de nuevo, en negativo, impuesto proporcional y clave por cargo y total", () => {
    const original = { id: 1, orderId: 7, stripeInvoiceId: "in_1", currency: "EUR", taxCents: 609, totalCents: 3509 };
    const a = rectificationOf(original, { chargeId: "ch_1", refundedTotalCents: 1000, previousRefundedCents: 0, now: 9 })!;
    expect(a).toMatchObject({ kind: "rectification", originalDocumentId: 1, totalCents: -1000, taxCents: -174, baseCents: -826, sourceKey: refundSourceKey("ch_1", 1000) });
    const b = rectificationOf(original, { chargeId: "ch_1", refundedTotalCents: 3509, previousRefundedCents: 1000, now: 9 })!;
    expect(b).toMatchObject({ totalCents: -2509, taxCents: -435, baseCents: -2074 });
    expect(a.taxCents! + b.taxCents!).toBe(-609);
    expect(rectificationOf(original, { chargeId: "ch_1", refundedTotalCents: 1000, previousRefundedCents: 1000, now: 9 })).toBeNull();
    // Sin impuesto conocido en el original: la rectificativa tampoco lo inventa
    expect(rectificationOf({ ...original, taxCents: null }, { chargeId: "ch_1", refundedTotalCents: 500, previousRefundedCents: 0, now: 9 })).toMatchObject({ taxCents: null, baseCents: -500, totalCents: -500 });
  });
  it("adaptador por defecto: nada se emite (pendiente); referencias externas admitidas", async () => {
    expect(await pendingSink.submit({} as never)).toEqual({ status: "pending" });
    expect(EXTERNAL_REF.test("F-2026-000001")).toBe(true);
    expect(EXTERNAL_REF.test("VF/2026/12")).toBe(true);
    expect(EXTERNAL_REF.test("")).toBe(false);
    expect(EXTERNAL_REF.test("<script>")).toBe(false);
  });
});
