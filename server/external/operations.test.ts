/**
 * Operaciones de clientes externos (CRM 0041): cobro único con desglose y ajuste, infraestructura recurrente con
 * conceptos fijos y variables, límites de consumo, ajustes trazados, emisión idempotente sobre los cargos y la
 * facturación existentes, enlace de pago y confirmación por la sesión de Stripe, envío al cliente y estados.
 * Datos sintéticos; Stripe es el doble de pruebas (nunca se cobra nada real).
 */
import { describe, it, expect } from "vitest";
import { ChargeService, MemoryChargeStore } from "../invoicing/charges";
import { ChargePaymentService, MemoryChargePaymentStore } from "../invoicing/chargePayments";
import { MemoryInvoicingStore } from "../invoicing/store";
import type { CompanyFiscal } from "../invoicing/rules";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { computePeriod, displayOf, ExternalOperationsService, MemoryOperationStore, paymentState, type OpLine, type PaymentRequestMail } from "./operations";

const ACME: CompanyFiscal & { id: number; tenantId: string | null } = { id: 7, name: "Cliente Demo", legalName: "CLIENTE DEMO SL", taxId: "B00000000", address: "Calle Falsa 1", postalCode: "18001", city: "Granada", country: "ES", tenantId: null };
const CORE = { ...ACME, id: 8, tenantId: "t-core" };
const T = Date.UTC(2026, 10, 15, 9);

function setup(o: { stripe?: boolean } = {}) {
  let now = T;
  const company = async (id: number) => (id === 7 ? ACME : id === 8 ? CORE : null);
  const invoices = new MemoryInvoicingStore();
  const chargeStore = new MemoryChargeStore();
  const charges = new ChargeService({ charges: chargeStore, invoices, company, now: () => now });
  const gw = new FakeStripeGateway();
  const payments = new ChargePaymentService({ payments: new MemoryChargePaymentStore(), charges, invoices, company, gateway: o.stripe === false ? undefined : gw, stripeStore: new MemoryStripeStore("test"), mode: "test", namespace: "beta", urls: { success: "https://admin.example/ok", cancel: "https://admin.example/ko" }, now: () => now });
  const sent: Array<{ to: string; key: string; i: PaymentRequestMail }> = [];
  const store = new MemoryOperationStore();
  const svc = new ExternalOperationsService({ store, company, charges, invoices, payments, namespace: "beta", now: () => now, mail: { paymentRequest: async (to, key, i) => (sent.push({ to, key, i }), { status: "queued", reason: null, id: sent.length }) } });
  return { svc, store, chargeStore, invoices, gw, payments, sent, setNow: (t: number) => (now = t) };
}

const fixed = (key: string, concept: string, quantity: number, unitCents: number, category: OpLine["category"] = "service"): OpLine => ({ key, concept, category, pricing: "fixed", quantity, unitCents });
const ONE_OFF = { companyId: 7, kind: "one_off" as const, title: "Migración de datos", taxRateBp: 2100, dueDate: "2026-11-30", recipientName: "Ana Demo", recipientEmail: "ana@cliente.example", lines: [fixed("l1", "Análisis y diseño", 1, 40_000), fixed("l2", "Horas de migración", 3, 6_667)] };
const INFRA_LINES: OpLine[] = [
  fixed("srv", "Servidor dedicado", 1, 30_000, "server"),
  { key: "rw", concept: "Railway", category: "railway", pricing: "variable", provider: "Railway", marginBp: 1500, capCents: 20_000 },
  { key: "ia", concept: "Tokens de IA", category: "ai_tokens", pricing: "variable", provider: "Proveedor IA", marginCents: 500 },
];
const INFRA = { companyId: 7, kind: "infrastructure" as const, title: "Infraestructura gestionada", taxRateBp: 2100, billingDay: 1, dueDays: 10, startPeriod: "2026-11", recipientEmail: "it@cliente.example", lines: INFRA_LINES };

describe("cálculo de un periodo", () => {
  it("fijos, variables con margen y límite, ajuste comercial e IVA sobre la base neta", () => {
    const op = { lines: INFRA_LINES, taxRateBp: 2100, capCents: null, adjustment: { type: "discount" as const, mode: "percent" as const, value: 1000, reason: "Cliente piloto" } };
    const c = computePeriod(op, { rw: 10_000, ia: 2_000 });
    // 300 € + (100 € + 15 %) + (20 € + 5 €) = 440 €; −10 % = 396 €; IVA 83,16 €
    expect(c.lines.map((l) => l.amountCents)).toEqual([30_000, 11_500, 2_500]);
    expect(c).toMatchObject({ baseCents: 44_000, adjustmentCents: -4_400, netCents: 39_600, taxCents: 8_316, totalCents: 47_916, overCap: false, missingUsage: [] });
    // Por encima del límite se factura el límite, salvo exceso autorizado
    const over = computePeriod(op, { rw: 30_000, ia: 0 });
    expect(over.overCap).toBe(true);
    expect(over.lines[1]).toMatchObject({ amountCents: 20_000, capped: true, costCents: 30_000 });
    expect(computePeriod(op, { rw: 30_000, ia: 0 }, { overCapAuthorized: true }).lines[1].amountCents).toBe(34_500);
    expect(computePeriod(op, null).missingUsage).toEqual(["rw", "ia"]);
  });

  it("estados: borrador, pendiente, vencido, fallido, pagado y cancelado", () => {
    expect(paymentState({ status: "draft", dueDate: "2026-11-30" }, null, "2026-11-15")).toBe("none");
    expect(paymentState({ status: "issued", dueDate: "2026-11-30" }, { paymentStatus: "pending" }, "2026-11-15")).toBe("pending");
    expect(paymentState({ status: "issued", dueDate: "2026-11-30" }, { paymentStatus: "pending" }, "2026-12-01")).toBe("overdue");
    expect(paymentState({ status: "issued", dueDate: "2026-11-30" }, { paymentStatus: "failed" }, "2026-11-15")).toBe("failed");
    expect(paymentState({ status: "issued", dueDate: "2026-11-30" }, { paymentStatus: "paid" }, "2026-12-15")).toBe("paid");
    expect(displayOf({ kind: "one_off", status: "draft" }, []).state).toBe("draft");
    expect(displayOf({ kind: "one_off", status: "active" }, [{ status: "issued", payment: "paid", sentAt: 1 }])).toEqual({ state: "active", label: "Pagado" });
    expect(displayOf({ kind: "infrastructure", status: "active" }, [{ status: "issued", payment: "overdue", sentAt: 1 }]).state).toBe("overdue");
    expect(displayOf({ kind: "infrastructure", status: "canceled" }, []).state).toBe("canceled");
  });
});

describe("cobro único", () => {
  it("borrador sin cargos → emisión con desglose y factura → enlace → envío → cobro confirmado por Stripe", async () => {
    const t = setup();
    const { operation, periods } = await t.svc.create(ONE_OFF, "operator:ana");
    expect(operation).toMatchObject({ status: "draft", display: { state: "draft" }, totals: { baseCents: 60_001, netCents: 60_001, taxCents: 12_600, totalCents: 72_601 } });
    expect(periods).toHaveLength(1);
    // Guardar no crea cargos, facturas ni sesiones de Stripe
    expect(t.chargeStore.rows).toHaveLength(0);
    expect(t.gw.calls).toHaveLength(0);

    const p = await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
    expect(p).toMatchObject({ status: "issued", payment: { state: "pending" } });
    const inv = (await t.invoices.get(p.invoiceId!))!;
    expect(inv.lines.map((l) => [l.concept, l.quantity, l.unitCents])).toEqual([["Análisis y diseño", 1, 40_000], ["Horas de migración", 3, 6_667]]);
    // El IVA de la factura es el de la base total (el mismo que cobra Stripe)
    expect(inv).toMatchObject({ baseCents: 60_001, taxCents: 12_600, totalCents: 72_601, paymentStatus: "pending" });
    // Emitir dos veces no duplica el cargo ni la factura
    await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
    expect(t.chargeStore.rows).toHaveLength(1);

    const sent = await t.svc.send(operation.id, p.id, {}, "operator:ana");
    expect(sent.mail.status).toBe("queued");
    expect(t.sent[0]).toMatchObject({ to: "ana@cliente.example", i: { totalCents: 72_601, title: "Migración de datos", url: expect.stringContaining("checkout.stripe.test") } });
    expect(sent.period.payment).toMatchObject({ state: "pending", sentTo: "ana@cliente.example", link: { url: expect.any(String) } });
    // Reenviar reutiliza el enlace abierto (un solo Checkout)
    await t.svc.send(operation.id, p.id, {}, "operator:ana");
    expect(t.gw.calls.filter((k) => k.op === "checkout.sessions.create(payment)")).toHaveLength(1);

    const session = t.gw.calls.find((k) => k.op === "checkout.sessions.create(payment)")!;
    const sid = (await t.payments.list(p.chargeId!))[0].stripeSessionId!;
    expect(session).toBeTruthy();
    t.gw.completePaymentSession(sid, "paid");
    expect(await t.payments.handleSession(sid)).toBe("Cargo cobrado");
    const d = await t.svc.detail(operation.id);
    expect(d.operation.display).toEqual({ state: "active", label: "Pagado" });
    expect(d.periods[0].payment.state).toBe("paid");
    expect(d.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "period_prepared", "issued", "payment_link", "sent"]));
  });

  it("descuento autorizado: línea negativa en la factura y requiere orders:approve", async () => {
    const t = setup();
    const adjustment = { type: "discount" as const, mode: "amount" as const, value: 10_001, reason: "Promoción de lanzamiento" };
    await expect(t.svc.create({ ...ONE_OFF, adjustment }, "operator:ana")).rejects.toMatchObject({ code: "forbidden" });
    const { operation, periods } = await t.svc.create({ ...ONE_OFF, adjustment }, "operator:jefa", { canAuthorize: true });
    expect(operation.adjustment).toMatchObject({ authorizedBy: "operator:jefa" });
    expect(operation.totals).toMatchObject({ baseCents: 60_001, adjustmentCents: -10_001, netCents: 50_000, taxCents: 10_500, totalCents: 60_500 });
    const p = await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
    const inv = (await t.invoices.get(p.invoiceId!))!;
    expect(inv.lines.at(-1)).toMatchObject({ concept: expect.stringMatching(/^Descuento comercial de 100,01\s€$/), unitCents: -10_001 });
    expect(inv).toMatchObject({ baseCents: 50_000, totalCents: 60_500 });
    // Editar un borrador sin enviar el ajuste lo conserva (sin necesidad de volver a autorizarlo)
    const b = await t.svc.create({ ...ONE_OFF, adjustment }, "operator:jefa", { canAuthorize: true });
    const { adjustment: _omit, ...plain } = { ...ONE_OFF, adjustment: undefined, title: "Migración de datos (revisada)" };
    expect((await t.svc.update(b.operation.id, plain, "operator:ana")).operation).toMatchObject({ title: "Migración de datos (revisada)", adjustment: { authorizedBy: "operator:jefa", value: 10_001 } });
    // Uno emitido no se edita
    await expect(t.svc.update(operation.id, { ...ONE_OFF, adjustment }, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("validaciones: empresa de Elephant Core, sin líneas, vencimiento pasado y concepto variable", async () => {
    const t = setup();
    await expect(t.svc.create({ ...ONE_OFF, companyId: 8 }, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(t.svc.create({ ...ONE_OFF, lines: [] }, "operator:ana")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(t.svc.create({ ...ONE_OFF, dueDate: "2026-11-01" }, "operator:ana")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(t.svc.create({ ...ONE_OFF, lines: [INFRA_LINES[1]] }, "operator:ana")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("cancelar: el borrador sí; lo emitido no (rectificativa)", async () => {
    const t = setup();
    const a = await t.svc.create(ONE_OFF, "operator:ana");
    expect((await t.svc.cancel(a.operation.id, "Cliente lo pospone", "operator:ana")).operation.display.state).toBe("canceled");
    const b = await t.svc.create(ONE_OFF, "operator:ana");
    await t.svc.issue(b.operation.id, b.periods[0].id, "operator:jefa");
    await expect(t.svc.cancel(b.operation.id, "Cliente lo pospone", "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("vencido sin pagar y pago externo con referencia", async () => {
    const t = setup();
    const { operation, periods } = await t.svc.create(ONE_OFF, "operator:ana");
    await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
    t.setNow(Date.UTC(2026, 11, 2, 9));
    expect((await t.svc.detail(operation.id)).operation.display.state).toBe("overdue");
    await t.svc.offlinePayment(operation.id, periods[0].id, { reference: "TRF-2026-001" }, "operator:jefa");
    expect((await t.svc.detail(operation.id)).operation.display).toEqual({ state: "active", label: "Pagado" });
  });

  it("sin Stripe: se emite la factura pero el envío con enlace no está disponible", async () => {
    const t = setup({ stripe: false });
    const { operation, periods } = await t.svc.create(ONE_OFF, "operator:ana");
    await t.svc.issue(operation.id, periods[0].id, "operator:jefa");
    await expect(t.svc.send(operation.id, periods[0].id, {}, "operator:ana")).rejects.toMatchObject({ code: "unavailable" });
    expect(t.sent).toHaveLength(0);
  });
});

describe("infraestructura recurrente", () => {
  it("activar, preparar el mes con consumo, ajustar con traza, autorizar exceso y emitir una sola vez por mes", async () => {
    const t = setup();
    const { operation } = await t.svc.create(INFRA, "operator:ana");
    expect(operation).toMatchObject({ status: "draft", totals: { baseCents: 30_000 } });
    await expect(t.svc.period(operation.id, { period: "2026-11" }, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    await t.svc.activate(operation.id, "operator:jefa");

    const p = await t.svc.period(operation.id, { period: "2026-11", usage: { rw: 25_000 } }, "operator:ana");
    expect(p).toMatchObject({ status: "draft", overCap: true, dueDate: "2026-11-11" });
    // Repetir el mismo mes devuelve el mismo periodo
    expect((await t.svc.period(operation.id, { period: "2026-11" }, "operator:ana")).id).toBe(p.id);
    // Falta el consumo de la IA: no se emite
    await expect(t.svc.issue(operation.id, p.id, "operator:jefa")).rejects.toMatchObject({ code: "invalid_input" });

    // Ajustar y autorizar exige orders:approve
    await expect(t.svc.updatePeriod(operation.id, p.id, { adjustments: [{ key: "srv", amountCents: 25_000, reason: "Caída de 3 días" }] }, "operator:ana")).rejects.toMatchObject({ code: "forbidden" });
    const adj = await t.svc.updatePeriod(operation.id, p.id, { usage: { rw: 25_000, ia: 1_000 }, adjustments: [{ key: "srv", amountCents: 25_000, reason: "Caída de 3 días" }], authorizeOverCap: { reason: "Pico de tráfico pactado" } }, "operator:jefa", { canAuthorize: true });
    // 250 € (ajustado) + 287,50 € (Railway sin tope, autorizado) + 15 € = 552,50 €
    expect(adj.lines.map((l) => l.amountCents)).toEqual([25_000, 28_750, 1_500]);
    expect(adj.lines[0].adjusted).toMatchObject({ fromCents: 30_000, reason: "Caída de 3 días", by: "operator:jefa" });
    expect(adj).toMatchObject({ netCents: 55_250, overCapAuthorized: { reason: "Pico de tráfico pactado" } });
    const ev = (await t.svc.detail(operation.id)).events;
    expect(ev.find((e) => e.kind === "line_adjusted")!.detail).toMatchObject({ key: "srv", fromCents: 30_000, toCents: 25_000 });
    expect(ev.some((e) => e.kind === "over_cap_authorized")).toBe(true);

    const issued = await t.svc.issue(operation.id, p.id, "operator:jefa");
    const inv = (await t.invoices.get(issued.invoiceId!))!;
    expect(inv.lines.map((l) => l.concept)).toEqual(["Servidor dedicado", "Railway (Railway)", "Tokens de IA (Proveedor IA)"]);
    expect(inv.baseCents).toBe(55_250);
    // Un periodo emitido ya no se ajusta
    await expect(t.svc.updatePeriod(operation.id, p.id, { usage: { rw: 1 } }, "operator:jefa", { canAuthorize: true })).rejects.toMatchObject({ code: "invalid_state" });

    // Siguiente mes: otro periodo, otro cargo
    const dic = await t.svc.period(operation.id, { period: "2026-12", usage: { rw: 1_000, ia: 0 } }, "operator:ana");
    await t.svc.issue(operation.id, dic.id, "operator:jefa");
    expect(t.chargeStore.rows.map((c) => c.billingRef)).toEqual([`external-op:${operation.id}:2026-11`, `external-op:${operation.id}:2026-12`]);
    // Noviembre vencía el día 11 y sigue sin pagar
    expect((await t.svc.detail(operation.id)).operation.display.state).toBe("overdue");
  });

  it("límite total del periodo: sin autorización no se emite", async () => {
    const t = setup();
    const { operation } = await t.svc.create({ ...INFRA, capCents: 35_000 }, "operator:ana");
    await t.svc.activate(operation.id, "operator:jefa");
    const p = await t.svc.period(operation.id, { period: "2026-11", usage: { rw: 5_000, ia: 1_000 } }, "operator:ana");
    await expect(t.svc.issue(operation.id, p.id, "operator:jefa")).rejects.toMatchObject({ code: "invalid_state" });
    await t.svc.updatePeriod(operation.id, p.id, { authorizeOverCap: { reason: "Ampliación aprobada por el cliente" } }, "operator:jefa", { canAuthorize: true });
    expect((await t.svc.issue(operation.id, p.id, "operator:jefa")).status).toBe("issued");
  });
});
