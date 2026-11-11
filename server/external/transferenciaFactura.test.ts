/**
 * Factura de una nota de cobro pagada por transferencia: el MISMO circuito que si se paga por Stripe. La factura nace
 * en borrador al emitir la nota (`ChargeService.approve`), el cobro (Stripe o transferencia) la marca cobrada y la
 * expide `InvoicingAutomation.issueOne` (el paso de la pasada automática: número correlativo, datos fiscales, PDF y
 * envío). Nunca hay una segunda factura ni un segundo ingreso. Datos SINTÉTICOS con los importes de la operación #3
 * (1.487,60 € + 21 % = 1.800,00 €); Stripe es el doble de pruebas.
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

function setup(o: { failIssues?: number } = {}) {
  const now = T;
  const company = async (id: number) => (id === 7 ? CLIENT : null);
  const invoices = new MemoryInvoicingStore();
  const charges = new ChargeService({ charges: new MemoryChargeStore(), invoices, company, now: () => now });
  const svcInv = new InvoicingService({ store: invoices, company, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled: true, now: () => now });
  // Fallo forzado de la expedición (p. ej. la BD) en las primeras llamadas
  let fails = o.failIssues ?? 0;
  const sent: Array<{ key: string; to: string; name: string; pdf: string }> = [];
  const keys = new Set<string>();
  const automation = new InvoicingAutomation({
    svc: { readiness: (id) => svcInv.readiness(id), issue: async (id, actor) => (fails-- > 0 ? Promise.reject(new Error("BD no disponible")) : svcInv.issue(id, actor)) },
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
  const payments = new ChargePaymentService({ payments: store, charges, invoices, company, gateway: gw, stripeStore: new MemoryStripeStore("test"), mode: "test", namespace: "beta", urls: { success: "https://admin.example/ok", cancel: "https://admin.example/ko" }, now: () => now, receipts, issuing: automation });
  const svc = new ExternalOperationsService({ store: new MemoryOperationStore(), company, charges, invoices, payments, namespace: "beta", now: () => now });
  return { svc, svcInv, automation, invoices, gw, store, receipts, payments, sent };
}

async function issuedWithLink(t: ReturnType<typeof setup>) {
  const { operation, periods } = await t.svc.create(OP, "operator:ana");
  const p = await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
  await t.svc.paymentLink(operation.id, p.id, "operator:jefa");
  const sid = (await t.payments.list(p.chargeId!)).find((x) => x.kind === "stripe_link")!.stripeSessionId!;
  return { opId: operation.id, pid: p.id, chargeId: p.chargeId!, invoiceId: p.invoiceId!, sid };
}
const ofCharge = async (t: ReturnType<typeof setup>) => (await t.invoices.list({ limit: 100 })).filter((i: Invoice) => i.sourceKey.startsWith("charge:"));

describe("factura de una nota de cobro pagada por transferencia (mismo circuito que Stripe)", () => {
  it("sin factura expedida: la confirmación la expide con número, datos fiscales, importes, PDF y envío; justificante aparte", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "draft", number: null, paymentStatus: "pending" });
    const out = await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(out.invoice).toMatchObject({ status: "issued", number: expect.stringMatching(/^EB-?2026/) });
    const inv = (await t.invoices.get(x.invoiceId))!;
    expect(inv).toMatchObject({ status: "issued", kind: "invoice", baseCents: 148_760, taxCents: 31_240, totalCents: 180_000, paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:\d+$/), customer: { legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674" } });
    expect(inv.lines).toEqual([expect.objectContaining({ concept: "Asesoría implementación Integración turísticas V1", quantity: 1, baseCents: 148_760, taxRateBp: 2100, taxCents: 31_240 })]);
    expect(await ofCharge(t)).toHaveLength(1);
    // PDF de la factura (otro documento que el justificante): cobrada por transferencia, y enviado una vez
    const text = JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY));
    expect(text).toContain("Cobrada mediante transferencia bancaria.");
    expect(Buffer.from(await renderInvoicePdf(inv, ISSUER_PARTY)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(t.sent).toEqual([{ key: `invoicing:invoice:${inv.id}:${inv.number}`, to: "facturas@cliente.example", name: expect.stringContaining(inv.number!), pdf: "%PDF-" }]);
    expect(t.receipts.rows).toHaveLength(1);
    // Ficha: factura y justificante enlazados, cada uno con su id; historial con la expedición
    const d = await t.svc.detail(x.opId);
    expect(d.periods[0].payment.invoice).toMatchObject({ id: inv.id, number: inv.number, status: "issued", paymentStatus: "paid" });
    expect(d.periods[0].payment.movements[0]).toMatchObject({ receiptDocumentId: 1, method: "bank_transfer" });
    expect(d.events.filter((e) => e.kind === "invoice_issued")).toEqual([expect.objectContaining({ ref: `inv:${inv.id}`, detail: expect.objectContaining({ invoiceNumber: inv.number }) })]);
    // La pasada automática no la vuelve a expedir
    expect((await t.automation.issueDue()).issued).toEqual([]);
    // Finanzas: sigue siendo candidata a conciliar con el abono del banco (el cobro llega al libro con él)
    const dir = ownInvoicesFromStore(t.invoices);
    expect((await dir.declaredTransferCandidates!({ minTotalCents: 180_000, from: "2026-01-01", limit: 10 })).map((o) => o.id)).toEqual([inv.id]);
    expect((await dir.openCandidates({ minTotalCents: 180_000, from: "2026-01-01", limit: 10 })).map((o) => o.id)).toEqual([]);
  });

  it("con la factura ya expedida antes del cobro: se marca cobrada y se enlaza el pago, sin otra factura ni otro número", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const pre = await t.svcInv.issue(x.invoiceId, "operator:jefa");
    expect(pre).toMatchObject({ status: "issued", paymentStatus: "pending" });
    const out = await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    expect(out.invoice).toMatchObject({ status: "already", number: pre.number });
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ id: pre.id, number: pre.number, status: "issued", paymentStatus: "paid", paymentRef: expect.stringMatching(/^transfer:/) });
    expect(await ofCharge(t)).toHaveLength(1);
  });

  it("doble confirmación (seguida y a la vez): una factura, un número de la serie y un envío", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    const [a, b] = await Promise.all([t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge"), t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge")]);
    await t.svc.transferPayment(x.opId, x.pid, transfer("dbl-f-0001"), "operator:jorge");
    expect([a.invoice?.number, b.invoice?.number].filter(Boolean)).toEqual([a.invoice!.number ?? b.invoice!.number, a.invoice!.number ?? b.invoice!.number]);
    expect((await t.invoices.list({ limit: 100 })).filter((i: Invoice) => i.status === "issued")).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(1);
    // El siguiente número de la serie es el siguiente: no se ha gastado ninguno de más
    const other = await t.invoices.insertDraft({ sourceKey: "manual:1", kind: "invoice", paymentStatus: "paid", companyId: 7, billingRef: null, paymentRef: "offline:x", originalInvoiceId: null, operationDate: "2026-11-11", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", baseCents: 100, taxCents: 21, totalCents: 121, customer: null, notes: null, createdBy: "t", createdAt: T, lines: [{ position: 1, concept: "Prueba", quantity: 1, unitCents: 100, baseCents: 100, taxRateBp: 2100, taxCents: 21, totalCents: 121 }] } as never);
    const second = await t.svcInv.issue(other.invoice.id, "t");
    const n = (s: string | null) => Number(String(s).match(/(\d+)$/)![1]);
    expect(n(second.number) - n((await t.invoices.get(x.invoiceId))!.number)).toBe(1);
  });

  it("Stripe cobró antes de la transferencia: la factura se expide por el cobro de Stripe y la transferencia se rechaza", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    t.gw.completePaymentSession(x.sid, "paid");
    expect(await t.payments.handleSession(x.sid)).toBe("Cargo cobrado");
    const inv = (await t.invoices.get(x.invoiceId))!;
    expect(inv).toMatchObject({ status: "issued", paymentRef: expect.stringMatching(/^stripe:pi:/) });
    expect(JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY))).toContain("Cobrada mediante Stripe.");
    await expect(t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge")).rejects.toMatchObject({ code: "invalid_state" });
    expect(await ofCharge(t)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
  });

  it("evento de Stripe después de la transferencia: duplicado señalado, ni otra factura ni otro ingreso ni otro envío", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    const before = (await t.invoices.get(x.invoiceId))!;
    t.gw.payAnyway(x.sid);
    expect(await t.payments.handleSession(x.sid)).toMatch(/Cobro duplicado/);
    expect(await t.payments.handleSession(x.sid)).toMatch(/ya señalado/);
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ number: before.number, paymentRef: before.paymentRef, status: "issued" });
    expect(await ofCharge(t)).toHaveLength(1);
    expect(t.sent).toHaveLength(1);
    expect(t.store.rows.filter((r) => r.status === "paid")).toHaveLength(1);
  });

  it("fallo al expedir la factura: el cobro queda registrado, y el reintento (o la pasada) la expide una sola vez", async () => {
    const t = setup({ failIssues: 1 });
    const x = await issuedWithLink(t);
    const a = await t.svc.transferPayment(x.opId, x.pid, transfer("retry-f-0001"), "operator:jorge");
    expect(a.invoice).toMatchObject({ status: "error", reason: expect.stringMatching(/BD no disponible/) });
    expect(await t.invoices.get(x.invoiceId)).toMatchObject({ status: "draft", paymentStatus: "paid" });
    expect((await t.svc.detail(x.opId)).periods[0].payment.state).toBe("paid");
    // Reintento con la misma clave: no crea otro pago y expide la factura
    const b = await t.svc.transferPayment(x.opId, x.pid, transfer("retry-f-0001"), "operator:jorge");
    expect(b).toMatchObject({ replay: true, invoice: { status: "issued" } });
    expect((await t.automation.issueDue()).issued).toEqual([]);
    expect((await t.invoices.list({ limit: 100 })).filter((i: Invoice) => i.status === "issued")).toHaveLength(1);
    expect(t.store.rows.filter((r) => r.kind === "offline")).toHaveLength(1);
    // Sin reintento manual, la pasada automática la habría expedido igual (una vez)
    const u = setup({ failIssues: 1 });
    const y = await issuedWithLink(u);
    await u.svc.transferPayment(y.opId, y.pid, transfer("retry-f-0002"), "operator:jorge");
    expect((await u.automation.issueDue()).issued).toHaveLength(1);
    expect((await u.automation.issueDue()).issued).toHaveLength(0);
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

  it("anular: no con la factura expedida ni con un duplicado de Stripe; tras anular, reenviar la misma clave no da el pago por bueno", async () => {
    const t = setup();
    const x = await issuedWithLink(t);
    await t.svc.transferPayment(x.opId, x.pid, transfer(), "operator:jorge");
    const pay = t.store.rows.find((r) => r.method === "bank_transfer")!;
    const d = await t.svc.detail(x.opId);
    expect(d.periods[0].payment.movements[0].voidBlockedReason).toMatch(/rectificativa/);
    await expect(t.svc.voidTransfer(x.opId, x.pid, pay.id, { reason: "Registrada por error" }, "operator:jorge")).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/rectificativa/) });

    // Sin expedición (entorno sin ella): con un duplicado de Stripe tampoco
    const u = setup({ failIssues: 99 });
    const y = await issuedWithLink(u);
    await u.svc.transferPayment(y.opId, y.pid, transfer("void-f-0001"), "operator:jorge");
    u.gw.payAnyway(y.sid);
    await u.payments.handleSession(y.sid);
    const p2 = u.store.rows.find((r) => r.method === "bank_transfer")!;
    await expect(u.svc.voidTransfer(y.opId, y.pid, p2.id, { reason: "Registrada por error" }, "operator:jorge")).rejects.toMatchObject({ message: expect.stringMatching(/duplicado/) });

    // Sin duplicado y con la factura en borrador: se anula; reenviar esa clave es un error, no «ya registrado»
    const v = setup({ failIssues: 99 });
    const z = await issuedWithLink(v);
    await v.svc.transferPayment(z.opId, z.pid, transfer("void-f-0002"), "operator:jorge");
    const p3 = v.store.rows.find((r) => r.method === "bank_transfer")!;
    await v.svc.voidTransfer(z.opId, z.pid, p3.id, { reason: "Registrada por error" }, "operator:jorge");
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
