/** «Mi plan» del plano de control (server/commerce/tenantPlan.ts): solo lectura, solo la propia empresa. */
import { describe, expect, it } from "vitest";
import express from "express";
import { TenantPlanService, createTenantPlanRouter } from "./commerce/tenantPlan";
import type { CommercialOrder } from "./orchestrator/types";
import type { Invoice } from "./invoicing/types";

const DAY = 86_400_000;
const order = (o: Partial<CommercialOrder>): CommercialOrder =>
  ({ id: 1, reference: "PED-1", state: "active", companyId: 10, tenantId: "t5-cliente", subscriptionId: 7, graceEndsAt: null, request: { plan: "essential", interval: "month", items: [{ key: "net-hotel" }] }, quote: { currency: "EUR", contractAmountCents: 4900 }, ...o }) as unknown as CommercialOrder;
const invoice = (o: Partial<Invoice>): Invoice =>
  ({ id: 100, companyId: 10, status: "issued", kind: "invoice", number: "EB-2026-0001", issueDate: "2026-10-01", periodLabel: "Octubre 2026", totalCents: 5929, currency: "EUR", paymentStatus: "paid", ...o }) as unknown as Invoice;

function svc(over: Partial<ConstructorParameters<typeof TenantPlanService>[0]> = {}) {
  return new TenantPlanService({
    companyOfTenant: async (t) => (t === "t5-cliente" ? { id: 10, name: "Cliente SL" } : t === "t6-otra" ? { id: 11, name: "Otra SL" } : null),
    orders: async (c) => (c === 10 ? [order({ id: 1, state: "superseded" }), order({ id: 2 })] : []),
    subscription: async () => ({ id: 7, status: "active", currency: "EUR", currentPeriodStart: Date.UTC(2026, 9, 1), currentPeriodEnd: Date.UTC(2026, 10, 1), trialEnd: null, cancelAt: null }) as never,
    invoices: async (c) => (c === 10 ? [invoice({}), invoice({ id: 101, status: "draft", number: null })] : [invoice({ id: 200, companyId: 11 })]),
    invoiceHtml: (i) => `<p>${i.number}</p>`,
    stripeStatus: async () => ({ status: "active", cancelAtPeriodEnd: false }),
    billingPortalEnabled: true,
    ...over,
  });
}

describe("resumen de «Mi plan»", () => {
  it("contrato vigente, periodo, renovación, cobro y facturas expedidas (sin borradores)", async () => {
    const p = await svc().summary("t5-cliente");
    expect(p.contract).toMatchObject({ orderId: 2, plan: "essential", interval: "month", items: ["net-hotel"], recurringNetCents: 4900, currency: "EUR" });
    expect(p.period).toMatchObject({ renewsAt: Date.UTC(2026, 10, 1), cancelAt: null });
    expect(p.billing).toEqual({ provider: "stripe", status: "active", cancelAtPeriodEnd: false, portal: true });
    expect(p.invoices.map((i) => i.id)).toEqual([100]);
  });
  it("baja programada: sin fecha de renovación; impago: el pedido en gracia", async () => {
    const s = svc({ subscription: async () => ({ id: 7, status: "active", currency: "EUR", currentPeriodStart: 0, currentPeriodEnd: 30 * DAY, trialEnd: null, cancelAt: 30 * DAY }) as never, orders: async () => [order({ state: "past_due", graceEndsAt: 7 * DAY })] });
    const p = await s.summary("t5-cliente");
    expect(p.period).toMatchObject({ renewsAt: null, cancelAt: 30 * DAY });
    expect(p.contract).toMatchObject({ state: "past_due", graceEndsAt: 7 * DAY });
    expect(p.billing.cancelAtPeriodEnd).toBe(false);
  });
  it("prueba (sin pedido): sin contrato, sin cobro; empresa desconocida o id inválido: error", async () => {
    const p = await svc().summary("t6-otra");
    expect(p).toMatchObject({ contract: null, period: null, billing: { provider: "none", portal: false } });
    await expect(svc().summary("t9-nadie")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc().summary("../x")).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("cobro manual (sin Stripe): proveedor manual, sin portal", async () => {
    const p = await svc({ stripeStatus: async () => null }).summary("t5-cliente");
    expect(p.billing).toMatchObject({ provider: "manual", portal: false });
  });
});

describe("documento de factura", () => {
  it("solo facturas expedidas de la PROPIA empresa: la de otra o un borrador, no encontrada", async () => {
    expect(await svc().invoiceDocument("t5-cliente", 100)).toBe("<p>EB-2026-0001</p>");
    await expect(svc().invoiceDocument("t5-cliente", 200)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc().invoiceDocument("t5-cliente", 101)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc().invoiceDocument("t6-otra", 100)).rejects.toMatchObject({ code: "not_found" });
  });
  it("las rutas exigen el token de comercio", async () => {
    const app = express();
    app.use(createTenantPlanRouter(svc()));
    const srv = app.listen(0);
    const port = (srv.address() as { port: number }).port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/tenants/t5-cliente/plan`);
      expect([401, 403]).toContain(r.status);
    } finally {
      srv.close();
    }
  });
});
