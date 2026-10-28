/**
 * Cobro de cargos aprobados (CRM 0029, I-4): enlace de pago de Stripe (un Checkout por intento, reutilizado mientras
 * siga abierto), confirmación solo con la sesión releída y cotejada, pago externo con referencia y bloqueos (borrador,
 * ya cobrado, tarjeta guardada, live sin interruptor).
 */
import { describe, it, expect } from "vitest";
import { ChargeService, MemoryChargeStore, type NewChargeInput } from "./charges";
import { ChargePaymentService, MemoryChargePaymentStore } from "./chargePayments";
import { MemoryInvoicingStore } from "./store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import type { CompanyFiscal } from "./rules";

const NEXTAIR: CompanyFiscal & { id: number } = { id: 7, name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031", address: "C/ José Luis Pérez Pujadas, Ed. Forum, 14, 1º D", postalCode: "18006", city: "Granada", country: "ES" };
const T = Date.UTC(2026, 10, 15, 9);
const extra = (p: Partial<NewChargeInput> = {}): NewChargeInput => ({ idempotencyKey: "k-1", companyId: 7, kind: "extraordinary", concept: "Migración de datos de temporada", amountCents: 50_000, taxRateBp: 2100, dueDate: "2026-11-20", ...p });

function setup(o: { mode?: "test" | "live"; liveEnabled?: boolean; stripe?: boolean } = {}) {
  const charges = new MemoryChargeStore();
  const invoices = new MemoryInvoicingStore();
  const chargeSvc = new ChargeService({ charges, invoices, company: async (id) => (id === 7 ? NEXTAIR : null), now: () => T });
  const gw = new FakeStripeGateway();
  const stripeStore = new MemoryStripeStore(o.mode ?? "test");
  const payments = new MemoryChargePaymentStore();
  const svc = new ChargePaymentService({
    payments,
    charges: chargeSvc,
    invoices,
    company: async (id) => (id === 7 ? NEXTAIR : null),
    gateway: o.stripe === false ? undefined : gw,
    stripeStore,
    mode: o.mode ?? "test",
    namespace: "beta",
    liveEnabled: o.liveEnabled,
    urls: { success: "https://admin.example/ok", cancel: "https://admin.example/ko" },
    now: () => T,
  });
  return { chargeSvc, invoices, gw, stripeStore, payments, svc };
}
async function approved(t: ReturnType<typeof setup>, p: Partial<NewChargeInput> = {}) {
  const { charge } = await t.chargeSvc.create(extra(p), "operator:ana");
  return (await t.chargeSvc.approve(charge.id, "operator:jefa")).charge;
}

describe("cobro de cargos aprobados", () => {
  it("enlace de pago: Checkout único por 500 € + 21 % = 605 €, reutilizado mientras sigue abierto, y cobro confirmado por la sesión", async () => {
    const t = setup();
    const c = await approved(t);
    const a = await t.svc.paymentLink(c.id, "operator:ana");
    expect(a).toMatchObject({ reused: false, totalCents: 60_500, url: expect.stringContaining("checkout.stripe.test") });
    const call = t.gw.calls.find((k) => k.op === "checkout.sessions.create(payment)")!.input as { amountCents: number; metadata: Record<string, string> };
    expect(call).toMatchObject({ amountCents: 50_000, metadata: { es_charge_id: String(c.id), es_env: "beta" } });
    expect((await t.svc.paymentLink(c.id, "operator:ana")).reused).toBe(true);
    expect(t.gw.calls.filter((k) => k.op === "checkout.sessions.create(payment)")).toHaveLength(1);
    // Sesión aún sin pagar: nada cambia
    expect(await t.svc.handleSession(a.sessionId)).toMatch(/Sin cobro/);
    t.gw.completePaymentSession(a.sessionId, "paid");
    expect(await t.svc.handleSession(a.sessionId)).toBe("Cargo cobrado");
    expect(await t.svc.handleSession(a.sessionId)).toBe("Ya registrado");
    const inv = await t.invoices.get(c.invoiceId!);
    expect(inv).toMatchObject({ paymentStatus: "paid", paymentRef: expect.stringMatching(/^stripe:pi:/) });
    await expect(t.svc.paymentLink(c.id, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    // Una sesión que no es de un cargo no la reclama este módulo
    expect(await t.svc.handleSession("cs_ajena")).toBeNull();
  });

  it("enlace caducado: queda caducado y el siguiente intento crea otro Checkout", async () => {
    const t = setup();
    const c = await approved(t);
    const a = await t.svc.paymentLink(c.id, "operator:ana");
    t.gw.completePaymentSession(a.sessionId, "expired");
    expect(await t.svc.handleSession(a.sessionId)).toMatch(/caducado/);
    const b = await t.svc.paymentLink(c.id, "operator:ana");
    expect(b.sessionId).not.toBe(a.sessionId);
    expect((await t.svc.list(c.id)).map((p) => p.status)).toEqual(["open", "expired"]);
  });

  it("un cobro de otro importe en Stripe no se da por bueno", async () => {
    const t = setup();
    const c = await approved(t);
    const a = await t.svc.paymentLink(c.id, "operator:ana");
    t.gw.completePaymentSession(a.sessionId, "paid");
    const s = t.gw.paymentSessions.get(a.sessionId)!;
    t.gw.paymentSessions.set(a.sessionId, { ...s, amountTotal: 1 });
    await expect(t.svc.handleSession(a.sessionId)).rejects.toMatchObject({ code: "conflict" });
    expect((await t.invoices.get(c.invoiceId!))!.paymentStatus).toBe("pending");
  });

  it("pago externo con referencia: factura cobrada y enlaces abiertos anulados; exige referencia", async () => {
    const t = setup();
    const c = await approved(t, { method: "offline" });
    await expect(t.svc.paymentLink(c.id, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(t.svc.recordOffline(c.id, { reference: "x" }, "operator:jefa")).rejects.toMatchObject({ code: "invalid_input" });
    const out = await t.svc.recordOffline(c.id, { reference: "TRF-2026-11-0042" }, "operator:jefa");
    expect(out.invoice).toMatchObject({ paymentStatus: "paid", paymentRef: "offline:TRF-2026-11-0042" });
    await expect(t.svc.recordOffline(c.id, { reference: "TRF-otra" }, "operator:jefa")).rejects.toMatchObject({ code: "invalid_state" });
    // Funciona también sin Stripe
    const t2 = setup({ stripe: false });
    const c2 = await approved(t2, { method: "offline", idempotencyKey: "k-9" });
    expect((await t2.svc.recordOffline(c2.id, { reference: "efectivo-001" }, "operator:jefa")).invoice.paymentStatus).toBe("paid");
  });

  it("bloqueos: borrador, tarjeta guardada (no se ejecuta aquí), live sin interruptor y sin Stripe", async () => {
    const t = setup();
    const { charge: draft } = await t.chargeSvc.create(extra({ idempotencyKey: "k-d" }), "operator:ana");
    await expect(t.svc.paymentLink(draft.id, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    const card = await approved(t, { idempotencyKey: "k-c", method: "card_on_file", mandateRef: "acuerdo-v1" });
    await expect(t.svc.paymentLink(card.id, "operator:ana")).rejects.toMatchObject({ code: "invalid_state" });
    const live = setup({ mode: "live" });
    const cl = await approved(live);
    await expect(live.svc.paymentLink(cl.id, "operator:ana")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/CP_EXTERNAL_LIVE_ENABLED/) });
    const none = setup({ stripe: false });
    const cn = await approved(none);
    await expect(none.svc.paymentLink(cn.id, "operator:ana")).rejects.toMatchObject({ code: "unavailable" });
    // Ningún cobro directo con tarjeta: solo Checkout
    expect(t.gw.calls.some((k) => /paymentIntents|charges\.create/.test(k.op))).toBe(false);
  });
});
