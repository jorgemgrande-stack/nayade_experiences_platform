/**
 * Factura de una nota de cobro pagada por transferencia: el MISMO circuito que hoy sigue un cobro de Stripe, que no
 * cambia. La factura nace en borrador al emitir la nota (`ChargeService.approve`); el cobro (Stripe o transferencia)
 * solo la marca cobrada, y la expide la pasada periódica de la automatización (`InvoicingAutomation.issueDue`, cada
 * 15 min): número correlativo, datos fiscales, PDF y envío. Nunca hay una segunda factura ni un segundo ingreso.
 * Datos SINTÉTICOS con los importes de la operación #3 (1.487,60 € + 21 % = 1.800,00 €); Stripe es el doble de pruebas.
 */
import { describe, it, expect } from "vitest";
import { ChargeService, MemoryChargeStore } from "../invoicing/charges";
import { ChargePaymentService, MemoryChargePaymentStore } from "../invoicing/chargePayments";
import { MemoryReceiptStore } from "../invoicing/transferReceipts";
import { InvoicingAutomation, invoicePdfBlocks, renderInvoicePdf } from "../invoicing/delivery";
import { InvoicingService } from "../invoicing/service";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { CompanyFiscal } from "../invoicing/rules";
import type { FiscalParty, Invoice } from "../invoicing/types";
import { ownInvoicesFromStore } from "../finance/ownInvoices";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import type { GwCheckoutSession } from "../stripe/gateway";
import { ISSUER } from "../stripe/issuer";
import { ExternalOperationsService, MemoryOperationStore } from "./operations";

const CLIENT: CompanyFiscal & { id: number; tenantId: string | null } = { id: 7, name: "Cliente sintético", legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "18006", city: "Granada", country: "ES", billingEmail: "facturas@cliente.example", tenantId: null };
const ISSUER_PARTY: FiscalParty = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: "ES" };
const T = Date.UTC(2026, 10, 11, 9);
const PDF = Buffer.from("%PDF-1.4\n% justificante sintético\n%%EOF\n");
const OP = { companyId: 7, kind: "one_off" as const, title: "Asesoría implementación Integración turísticas V1", taxRateBp: 2100, dueDate: "2026-11-30", lines: [{ key: "l1", concept: "Asesoría implementación Integración turísticas V1", category: "service" as const, pricing: "fixed" as const, quantity: 1, unitCents: 148_760 }] };
const transfer = (k = "form-key-f001", o: Record<string, unknown> = {}) => ({ amountCents: 180_000, receivedOn: "2026-11-10", reference: "TRF 1800", receipt: { filename: "transferencia.pdf", contentBase64: PDF.toString("base64") }, idempotencyKey: k, confirmed: true as const, ...o });

class Gw extends FakeStripeGateway {
  async expireCheckoutSession(id: string): Promise<GwCheckoutSession> {
    const s = this.paymentSessions.get(id);
    if (!s) return super.expireCheckoutSession(id);
    if (s.status !== "open") throw new Error("Only Checkout Sessions with a status of open can be expired");
    this.paymentSessions.set(id, { ...s, status: "expired", url: null });
    return { id, status: "expired", paymentStatus: "unpaid", url: null, customerId: s.customerId, subscriptionId: null, clientReferenceId: null, metadata: s.metadata, expiresAt: s.expiresAt };
  }
  payAnyway(id: string) {
    const s = this.paymentSessions.get(id)!;
    this.paymentSessions.set(id, { ...s, status: "complete", paymentStatus: "paid", paymentIntentId: `pi_tarde_${id}`, url: null });
  }
}

function setup(o: { failIssues?: number; bankReconciled?: boolean; meanwhile?: "readiness" | "issue" } = {}) {
  const now = T;
  const company = async (id: number) => (id === 7 ? CLIENT : null);
  const invoices = new MemoryInvoicingStore();
  const chargeStore = new MemoryChargeStore();
  const charges = new ChargeService({ charges: chargeStore, invoices, company, now: () => now });
  const svcInv = new InvoicingService({ store: invoices, company, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled: true, now: () => now });
  let fails = o.failIssues ?? 0;
  const sent: Array<{ key: string; to: string; name: string; pdf: string }> = [];
  const keys = new Set<string>();
  const automation = new InvoicingAutomation({
    svc: {
      // Expedida mientras tanto por otra vía (a mano o en otra réplica), justo antes de que la pasada llegue a ella
      readiness: async (id) => {
        if (o.meanwhile === "readiness" && (await invoices.get(id))?.status === "draft") await svcInv.issue(id, "operator:otra");
        return svcInv.readiness(id);
      },
      issue: async (id, actor) => {
        if (fails-- > 0) throw new Error("BD no disponible");
        if (o.meanwhile === "issue") await svcInv.issue(id, "operator:otra");
        return svcInv.issue(id, actor);
      },
    },
    store: invoices,
    issueEnabled: true,
    delivery: {
      send: async (m) => {
        const duplicate = keys.has(m.key);
        keys.add(m.key);
        if (!duplicate) sent.push({ key: m.key, to: m.to, name: m.attachments[0].name, pdf: Buffer.from(m.attachments[0].content!, "base64").subarray(0, 5).toString() });
        return { status: "pending", duplicate };
      },
      recipient: async (inv) => inv.customer?.email ?? CLIENT.billingEmail ?? null,
      issuer: ISSUER_PARTY,
      supportEmail: null,
    },
    now: () => now,
  });
  const gw = new Gw();
  const store = new MemoryChargePaymentStore();
  const receipts = new MemoryReceiptStore();
  const payments = new ChargePaymentService({ payments: store, charges, invoices, company, gateway: gw, stripeStore: new MemoryStripeStore("test"), mode: "test", namespace: "beta", urls: { success: "https://admin.example/ok", cancel: "https://admin.example/ko" }, now: () => now, receipts, bankReconciled: async () => o.bankReconciled === true });
  const ops = new MemoryOperationStore();
  const svc = new ExternalOperationsService({ store: ops, company, charges, invoices, payments, namespace: "beta", now: () => now });
  return { svc, svcInv, automation, invoices, chargeStore, ops, gw, store, receipts, payments, sent };
}

async function issuedWithLink(t: ReturnType<typeof setup>) {
  const { operation, periods } = await t.svc.create(OP, "operator:ana");
  const p = await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
  await t.svc.paymentLink(operation.id, p.id, "operator:jefa");
  const sid = (await t.payments.list(p.chargeId!)).find((x) => x.kind === "stripe_link")!.stripeSessionId!;
  return { opId: operation.id, pid: p.id, chargeId: p.chargeId!, invoiceId: p.invoiceId!, sid };
}
const issuedInvoices = async (t: ReturnType<typeof setup>) => (await t.invoices.list({ limit: 100 })).filter((i: Invoice) => i.kind === "invoice" && i.status !== "draft");

describe("factura de una nota de cobro pagada por transferencia (mismo circuito que Stripe, que no cambia)", () => {
  it("sin factura expedida: la transferencia solo marca cobrado el borrador; la pasada la expide con número, datos, importes, PDF y envío", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    // Como un cobro de Stripe: borrador cobrado, sin número, hasta la pasada
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "draft", number: null, paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:\d+$/) });
    expect(t.sent).toEqual([]);
    expect((await t.svc.detail(x.opId)).periods[0].payment).toMatchObject({ state: "paid", invoice: { id: x.invoiceId, status: "draft" } });
    const pass = await t.automation.issueDue();
    expect(pass).toMatchObject({ blocked: [], issued: [expect.objectContaining({ id: x.invoiceId, number: expect.stringMatching(/^EB/) })] });
    const inv = (await t.invoices.get(x.invoiceId))!;
    expect(inv).toMatchObject({ status: "issued", baseCents: 148_760, taxCents: 31_240, totalCents: 180_000, paymentStatus: "paid", customer: { legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674" } });
    expect(inv.lines).toEqual([expect.objectContaining({ concept: "Asesoría implementación Integración turísticas V1", quantity: 1, baseCents: 148_760, taxRateBp: 2100, taxCents: 31_240 })]);
    expect(JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY))).toContain("Cobrada mediante transferencia bancaria.");
    expect(Buffer.from(await renderInvoicePdf(inv, ISSUER_PARTY)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(t.sent).toEqual([{ key: `invoicing:invoice:${inv.id}:${inv.number}`, to: "facturas@cliente.example", name: expect.stringContaining(inv.number!), pdf: "%PDF-" }]);
    expect(await issuedInvoices(t)).toHaveLength(1);
    // Factura y justificante: dos documentos distintos enlazados en la ficha
    const d = await t.svc.detail(x.opId);
    expect(d.periods[0].payment.invoice).toMatchObject({ id: inv.id, number: inv.number, status: "issued" });
    expect(d.periods[0].payment.movements[0]).toMatchObject({ receiptDocumentId: 1, method: "bank_transfer" });
    // Ni la transferencia ni Stripe dejan un evento «invoice_issued» (la expedición es de la facturación)
    expect(d.events.map((e) => e.kind)).not.toContain("invoice_issued");
    expect((await t.automation.issueDue()).issued).toEqual([]);
    // Finanzas: candidata a conciliar con el abono del banco
    const dir = ownInvoicesFromStore(t.invoices);
    expect((await dir.declaredTransferCandidates!({ minTotalCents: 180_000, from: "2026-01-01", limit: 10 })).map((o) => o.id)).toEqual([inv.id]);
  });

  it("un cobro de Stripe sigue igual: marca el borrador y lo expide la pasada («Cobrada mediante Stripe»); la transferencia se rechaza", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    t.gw.completePaymentSession(x.sid, "paid");
    expect(await t.payments.handleSession(x.sid)).toBe("Cargo cobrado");
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "draft", paymentStatus: "paid", paymentRef: expect.stringMatching(/^stripe:pi:/) });
    expect(t.sent).toEqual([]);
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await t.automation.issueDue()).issued).toHaveLength(1);
    const inv = (await t.invoices.get(x.invoiceId))!;
    expect(JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY))).toContain("Cobrada mediante Stripe.");
    expect(await issuedInvoices(t)).toHaveLength(1);
  });

  it("con la factura ya expedida antes del cobro: se marca cobrada y se enlaza el pago, sin otra factura ni otro número", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const pre = await t.svcInv.issue(x.invoiceId, "operator:jefa");
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ id: pre.id, number: pre.number, status: "issued", paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:/) });
    expect((await t.automation.issueDue()).issued).toEqual([]);
    expect(await issuedInvoices(t)).toHaveLength(1);
  });

  it("doble confirmación (seguida y a la vez): un pago; la pasada expide una factura con un solo número", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await Promise.all([t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge"), t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge")]);
    await t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge");
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(1);
    await t.automation.issueDue();
    await t.automation.issueDue();
    expect(await issuedInvoices(t)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    const other = await t.invoices.insertDraft({ sourceKey: "manual:1", kind: "invoice", paymentStatus: "paid", companyId: 7, billingRef: null, paymentRef: "offline:x", originalInvoiceId: null, operationDate: "2026-11-11", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", baseCents: 100, taxCents: 21, totalCents: 121, customer: null, notes: null, createdBy: "t", createdAt: T, lines: [{ position: 1, concept: "Prueba", quantity: 1, unitCents: 100, baseCents: 100, taxRateBp: 2100, taxCents: 21, totalCents: 121 }] } as never);
    const second = await t.svcInv.issue(other.invoice.id, "t");
    const n = (s: string | null) => Number(String(s).match(/(\d+)$/)![1]);
    expect(n(second.number) - n((await t.invoices.get(x.invoiceId))!.number)).toBe(1);
  });

  it("evento de Stripe después de la transferencia: duplicado señalado, ni otra factura ni otro ingreso ni otro envío", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    await t.automation.issueDue();
    const before = (await t.invoices.get(x.invoiceId))!;
    t.gw.payAnyway(x.sid);
    expect(await t.payments.handleSession(x.sid)).toMatch(/Cobro duplicado/);
    expect(await t.payments.handleSession(x.sid)).toMatch(/ya señalado/);
    await t.automation.issueDue();
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ number: before.number, paymentRef: before.paymentRef, status: "issued" });
    expect(await issuedInvoices(t)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(t.store.rows.filter((r) => r.status === "paid")).toHaveLength(1);
  });

  it("fallo al expedir en la pasada: el cobro sigue registrado y la siguiente pasada la expide una sola vez", async () => {
    const t = setup({ failIssues: 1 });
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer("retry-f-0001"), "operator:jorge");
    await expect(t.automation.issueDue()).rejects.toThrow(/BD no disponible/);
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "draft", paymentStatus: "paid" });
    expect((await t.svc.detail(x.opId)).periods[0].payment.state).toBe("paid");
    // Reintento de la confirmación: el mismo pago, sin otro
    expect((await t.svc.transferPayment(x.opId, x.pid, transfer("retry-f-0001"), "operator:jorge")).replay).toBe(true);
    expect((await t.automation.issueDue()).issued).toHaveLength(1);
    expect((await t.automation.issueDue()).issued).toHaveLength(0);
    expect(await issuedInvoices(t)).toHaveLength(1);
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(1);
  });

  it("la pasada tolera una factura expedida mientras tanto: se salta sin incidencia y sin cortar la pasada", async () => {
    for (const meanwhile of ["readiness", "issue"] as const) {
      const t = setup({ meanwhile });
      const x = await issuedWithLink(t);
      await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
      const pass = await t.automation.issueDue();
      expect(pass).toMatchObject({ issued: [], blocked: [] });
      expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "issued", issuedBy: "operator:otra" });
      expect(await issuedInvoices(t)).toHaveLength(1);
    }
  });
});

describe("salida de una transferencia registrada por error", () => {
  it("expedida: anular se bloquea; tras la rectificativa TOTAL se anula, se libera el cargo y la nota se vuelve a cobrar con factura nueva", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    await t.automation.issueDue();
    const pay = t.store.rows.find((r) => r.method === "bank_transfer")!;
    const d1 = await t.svc.detail(x.opId);
    expect(d1.periods[0].payment.movements[0].voidBlockedReason).toMatch(/rectifícala por completo.*después anula/);
    await expect(t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "La transferencia nunca llegó" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    // Circuito existente: rectificativa total expedida → la original queda «rectificada»
    const credit = await t.svcInv.rectify(x.invoiceId, { reason: "Pago por transferencia registrado por error" }, "operator:jorge");
    await t.svcInv.issue(credit.id, "operator:jorge");
    expect((await t.invoices.get(x.invoiceId))!.status).toBe("rectified");
    expect((await t.svc.detail(x.opId)).periods[0].payment.movements[0].voidBlockedReason).toBeNull();
    await t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "La transferencia nunca llegó" }, "operator:jorge");
    const d2 = await t.svc.detail(x.opId);
    const newInv = d2.periods[0].invoiceId!;
    expect(newInv).not.toBe(x.invoiceId);
    expect(d2.periods[0].payment).toMatchObject({ state: "pending", pendingCents: 180_000, invoice: { id: newInv, status: "draft" } });
    expect(await t.invoices.get(newInv)).toMatchObject({ status: "draft", paymentStatus: "pending", totalCents: 180_000, sourceKey: `charge:${x.chargeId}:tras:${x.invoiceId}` });
    expect((await t.chargeStore.get(x.chargeId))!.invoiceId).toBe(newInv);
    expect(t.store.rows.find((r) => r.id === pay.id)).toMatchObject({ status: "voided", settlesChargeId: null, receiptDocumentId: 1 });
    expect(t.receipts.rows[0].archived).toBeFalsy();
    expect(d2.events.find((e) => e.kind === "transfer_voided")!.detail).toMatchObject({ rectifiedInvoiceId: x.invoiceId, newInvoiceId: newInv });
    // Se vuelve a cobrar por el circuito normal: nueva transferencia (otra clave) y la pasada expide la factura nueva
    await t.svc.transferPayment(x.opId, x.pid, transfer("again-f-0001"), "operator:jorge");
    expect((await t.automation.issueDue()).issued.map((i) => i.id)).toEqual([newInv]);
    expect((await t.invoices.list({ limit: 100 })).filter((i: Invoice) => i.kind === "invoice")).toHaveLength(2);
  });

  it("nunca se anula con el abono ya conciliado con el banco, ni con una rectificativa parcial", async () => {
    const t = setup({ bankReconciled: true });
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    await t.automation.issueDue();
    const credit = await t.svcInv.rectify(x.invoiceId, { reason: "Error" }, "operator:jorge");
    await t.svcInv.issue(credit.id, "operator:jorge");
    const pay = t.store.rows.find((r) => r.method === "bank_transfer")!;
    await expect(t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "Registrada por error" }, "operator:jorge")).rejects.toMatchObject({ message: expect.stringMatching(/conciliado con el banco/) });
    const u = setup();
    const y = await issuedWithLink(u);
    await u.svc.transferPayment(y.opId, y.pid, transfer(), "operator:jorge");
    await u.automation.issueDue();
    const partial = await u.svcInv.rectify(y.invoiceId, { reason: "Descuento", baseCents: 10_000 }, "operator:jorge");
    await u.svcInv.issue(partial.id, "operator:jorge");
    expect((await u.invoices.get(y.invoiceId))!.status).toBe("issued");
    const p2 = u.store.rows.find((r) => r.method === "bank_transfer")!;
    await expect(u.svc.voidTransfer(y.opId, y.pid, p2.id, { reason: "Registrada por error" }, "operator:jorge")).rejects.toMatchObject({ message: expect.stringMatching(/rectifícala por completo/) });
  });
});

describe("límites de la transferencia (revisión)", () => {
  it("pago de Stripe en proceso (método diferido): la transferencia se bloquea", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const s = t.gw.paymentSessions.get(x.sid)!;
    t.gw.paymentSessions.set(x.sid, { ...s, status: "complete", paymentStatus: "unpaid", url: null });
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/en proceso/) });
    expect(t.receipts.rows).toHaveLength(0);
  });

  it("anular en borrador: no con un duplicado de Stripe; tras anular, reenviar la misma clave es un error", async () => {
    const u = setup();
    const y = await issuedWithLink(u);
    await u.svc.transferPayment(y.opId, y.pid, transfer("void-f-0001"), "operator:jorge");
    u.gw.payAnyway(y.sid);
    await u.payments.handleSession(y.sid);
    const p2 = u.store.rows.find((r) => r.method === "bank_transfer")!;
    await expect(u.svc.voidTransfer(y.opId, y.pid, p2.id, { reason: "Registrada por error" }, "operator:jorge")).rejects.toMatchObject({ message: expect.stringMatching(/duplicado/) });

    const v = setup();
    const z = await issuedWithLink(v);
    await v.svc.transferPayment(z.opId, z.pid, transfer("void-f-0002"), "operator:jorge");
    const p3 = v.store.rows.find((r) => r.method === "bank_transfer")!;
    await v.svc.voidTransfer(z.opId, z.pid, p3.id, { reason: "Registrada por error" }, "operator:jorge");
    expect((await v.svc.detail(z.opId)).periods[0].invoiceId).toBe(z.invoiceId);
    await expect(v.svc.transferPayment(z.opId, z.pid, transfer("void-f-0002"), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/anuló/) });
  });

  it("un cargo de operación externa no se cobra por la ruta de cargos sin justificante; un cargo de empresa sigue igual y sin llamar a Stripe", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await expect(t.payments.recordOffline(x.chargeId, { reference: "TRF-sin-pdf" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/ficha/) });
    const calls = t.gw.calls.length;
    const charges = new ChargeService({ charges: new MemoryChargeStore(), invoices: t.invoices, company: async () => CLIENT, now: () => T });
    const svc = new ChargePaymentService({ payments: new MemoryChargePaymentStore(), charges, invoices: t.invoices, company: async () => CLIENT, gateway: t.gw, stripeStore: new MemoryStripeStore("test"), mode: "test", namespace: "beta", urls: { success: "", cancel: "" }, now: () => T, receipts: new MemoryReceiptStore() });
    const { charge } = await charges.create({ idempotencyKey: "emp-1", companyId: 7, kind: "extraordinary", concept: "Migración de datos", amountCents: 10_000, taxRateBp: 2100, dueDate: "2026-11-11", method: "offline" }, "operator:ana");
    await charges.approve(charge.id, "operator:jefa");
    expect((await svc.recordOffline(charge.id, { reference: "TRF-empresa" }, "operator:jefa")).invoice.paymentStatus).toBe("paid");
    expect(t.gw.calls.length).toBe(calls);
  });

  it("si el pago no llega a registrarse, el justificante subido se archiva", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const insert = t.store.insertSettled.bind(t.store);
    t.store.insertSettled = async () => Promise.reject(new Error("BD caída"));
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toThrow(/BD caída/);
    expect(t.receipts.rows).toEqual([expect.objectContaining({ archived: true })]);
    t.store.insertSettled = insert;
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(t.receipts.rows.filter((r) => !r.archived)).toHaveLength(1);
  });
});
