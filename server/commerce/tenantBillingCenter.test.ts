import { describe, expect, it } from "vitest";
import { BillingCenterError, TenantBillingCenterService, deriveBillingCenter, deriveStage, type BillingCenterDeps, type BillingCenterInput } from "./tenantBillingCenter";
import type { TermsBillingInvoice, TermsBillingRow } from "../commercialTerms/billingStore";
import type { TenantCustomTerms } from "../commercialTerms/tenantView";
import type { Invoice } from "../invoicing/types";

const D = (iso: string) => Date.parse(iso);
const NOW = D("2026-11-24T10:00:00Z");

const row = (o: Partial<TermsBillingRow> = {}): TermsBillingRow =>
  ({ id: 1, subscriptionId: 8, companyId: 14, status: "active", stripeCustomerId: "cus_demo_q", stripeSubscriptionId: "sub_demo_q", sessionId: null, sessionStatus: "complete", sessionExpiresAt: null, sessionSeq: 1, checkout: null, stripeStatus: "active", currentPeriodEnd: D("2026-12-23T00:00:00Z"), cancelAt: null, cancelRequestedAt: null, graceEndsAt: null, readOnlyUntil: null, lastPaidInvoiceId: null, heldInvoiceId: null, suspendedCapabilities: null, startedBy: "t", startedAt: NOW, linkedAt: NOW, syncedAt: NOW, updatedAt: NOW, version: 1, ...o }) as TermsBillingRow;

const sinv = (o: Partial<TermsBillingInvoice> = {}): TermsBillingInvoice => ({ billingId: 1, subscriptionId: 8, stripeInvoiceId: "in_demo_1", status: "paid", billingReason: "subscription_create", number: "LV-0001", currency: "EUR", subtotalCents: 4500, taxCents: 945, totalCents: 5445, amountPaidCents: 5445, periodStart: D("2026-11-23T14:00:00Z"), taxCheck: null, coverageLost: false, paidAt: D("2026-11-23T14:11:00Z"), createdAt: D("2026-11-23T14:10:00Z"), updatedAt: NOW, ...o });

const crm = (o: Partial<Invoice> = {}): Invoice => ({ id: 275, sourceKey: "ext:1", kind: "invoice", status: "issued", paymentStatus: "paid", companyId: 9, billingRef: "es-charge-1", paymentRef: "pi_demo_c", number: "FAC-1", operationDate: "2026-11-04", periodLabel: "Activación Bloque", issueDate: "2026-11-04", currency: "EUR", baseCents: 13867, taxCents: 2912, totalCents: 16779, customer: null, issuedAt: D("2026-11-04T11:53:00Z"), issuedBy: null, paidAt: D("2026-11-04T11:53:00Z"), ...o }) as Invoice;

const terms = (total = 5445): TenantCustomTerms => ({
  current: { presentation: "global_fee", packageName: "Elephant Core Business", currency: "EUR", interval: "month", included: [{ name: "Elephant Core Business", description: null, kind: "product", recurring: true, quantity: 1, conditions: null }, { name: "Formación", description: null, kind: "service", recurring: true, quantity: 1, conditions: null }] } as never,
  today: { netCents: Math.round(total / 1.21), taxCents: total - Math.round(total / 1.21), totalCents: total },
  upcoming: null,
  renewsAt: D("2026-12-13T00:00:00Z"),
  timeZone: "Europe/Madrid",
});

const sub = (o = {}) => ({ status: "active" as const, interval: "month" as const, currentPeriodStart: D("2026-11-13T00:00:00Z"), currentPeriodEnd: D("2026-12-13T00:00:00Z"), trialEnd: null, cancelAt: null, ...o });

const base = (o: Partial<BillingCenterInput> = {}): BillingCenterInput => ({ companyName: "Empresa Demo", terms: null, planName: null, sub: null, row: null, stripeInvoices: [], order: null, crmInvoices: [], portalEnabled: true, now: NOW, ...o });

describe("centro de suscripción: etapa y cobros", () => {
  it("Quantum: prueba con contrato aceptado y tarjeta autorizada, sin ningún cobro real", () => {
    const zero = sinv({ stripeInvoiceId: "in_demo_0", number: "LV-0004", subtotalCents: 0, taxCents: 0, totalCents: 0, amountPaidCents: 0 });
    const c = deriveBillingCenter(base({ terms: terms(), planName: "Elephant Core Business", sub: sub(), row: row({ stripeStatus: "trialing", currentPeriodEnd: D("2026-11-28T20:53:00Z") }), stripeInvoices: [zero] }));
    expect(c.stage).toBe("trial_authorized");
    expect(c.customTerms).toBe(true);
    expect(c.lastPayment).toBeNull();
    // La factura de 0 € no es un cobro: no entra en el historial de pagos (consta en facturas)
    expect(c.payments).toHaveLength(0);
    expect(c.invoices[0]).toMatchObject({ free: true, state: "free", totalCents: 0 });
    // El próximo cobro es el fin de la prueba de Stripe (28/11), no el periodo interno del CRM (13/12)
    expect(c.nextCharge).toMatchObject({ at: D("2026-11-28T20:53:00Z"), basis: "trial_end", estimatedTotalCents: 5445 });
    // En prueba no hay periodo de facturación: el inicio interno del CRM no se mezcla con la fecha de Stripe
    expect(c.billingPeriod).toBeNull();
    expect(c.trial?.endsAt).toBe(D("2026-11-28T20:53:00Z"));
    expect(c.paymentMethod.state).toBe("authorized");
    expect(c.actions.selfServicePlanChange).toBe(false);
    expect(c.actions.note).toMatch(/personalizadas/);
    expect(c.included).toEqual(["Elephant Core Business", "Formación"]);
  });

  it("Several Energy: suscripción activa con un cobro confirmado de 54,45 €; el cobro independiente de 167,79 € del sistema se lista aparte y sin duplicar", () => {
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub(), row: row(), stripeInvoices: [sinv()], crmInvoices: [crm()] }));
    expect(c.stage).toBe("active");
    expect(c.lastPayment).toMatchObject({ amountCents: 5445, invoiceNumber: "LV-0001" });
    expect(c.nextCharge).toMatchObject({ basis: "period_end", at: D("2026-12-23T00:00:00Z") });
    expect(c.payments.map((p) => [p.id, p.amountCents])).toEqual([["stripe:in_demo_1", 5445], ["crm:275", 16779]].sort((a, b) => 0) as never);
    expect(c.invoices.map((i) => [i.source, i.totalCents])).toEqual(expect.arrayContaining([["stripe", 5445], ["crm", 16779]]));
    expect(c.invoices).toHaveLength(2);
    expect(c.fee).toMatchObject({ totalCents: 5445, interval: "month" });
    expect(c.fee!.netCents + c.fee!.taxCents).toBe(5445);
  });

  it("una factura del sistema que refleja la de Stripe (misma referencia de cobro) no duplica ni la factura ni el pago", () => {
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub(), row: row(), stripeInvoices: [sinv()], crmInvoices: [crm({ id: 9, paymentRef: "in_demo_1", totalCents: 5445 })] }));
    expect(c.invoices).toHaveLength(1);
    expect(c.payments).toHaveLength(1);
  });

  it("pago fallido: etapa de incidencia, factura abierta como pago fallido y acción de actualizar el método de pago", () => {
    const open = sinv({ stripeInvoiceId: "in_demo_2", status: "open", amountPaidCents: 0, billingReason: "subscription_cycle", paidAt: null });
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub(), row: row({ status: "past_due", stripeStatus: "past_due" }), stripeInvoices: [sinv(), open] }));
    expect(c.stage).toBe("payment_issue");
    expect(c.payments.find((p) => p.reference === "in_demo_2")).toMatchObject({ status: "failed", at: null });
    expect(c.actions.portal).toBe(true);
    expect(c.lastPayment?.amountCents).toBe(5445);
  });

  it("sin contratación: ni pagos, ni facturas, ni próximo cobro; con planes accesibles", () => {
    const c = deriveBillingCenter(base());
    expect(c.stage).toBe("no_contract");
    expect(c.contracted).toBeNull();
    expect(c.nextCharge).toBeNull();
    expect(c.payments).toEqual([]);
    expect(c.invoices).toEqual([]);
    expect(c.actions.selfServicePlanChange).toBe(true);
  });

  it("contrato aceptado sin método de pago autorizado", () => {
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub() }));
    expect(c.stage).toBe("contract_pending_payment");
    expect(c.paymentMethod.state).toBe("missing");
  });

  it("suspendida y cancelada: sin próximo cobro en la cancelada y sin autoservicio", () => {
    expect(deriveStage(base({ terms: terms(), sub: sub(), row: row({ status: "suspended" }), stripeInvoices: [sinv()] }))).toBe("suspended");
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub({ status: "canceled" }), row: row({ status: "canceled" }), stripeInvoices: [sinv()] }));
    expect(c.stage).toBe("canceled");
    expect(c.nextCharge).toBeNull();
    expect(c.actions.selfServicePlanChange).toBe(false);
  });

  it("una baja programada no anuncia un próximo cobro", () => {
    const c = deriveBillingCenter(base({ terms: terms(), sub: sub({ cancelAt: D("2026-12-23T00:00:00Z") }), row: row({ status: "cancel_scheduled", cancelAt: D("2026-12-23T00:00:00Z") }), stripeInvoices: [sinv()] }));
    expect(c.nextCharge).toBeNull();
  });

  it("empresa de simulación (cobro por pedido, sin Stripe): contrato y periodo del pedido, método sin determinar", () => {
    const order = { company: { name: "Sim" }, contract: { orderId: 1, reference: "PED-1", state: "active", plan: "business", interval: "month", items: ["essential", "mod-x"], recurringNetCents: 4900, currency: "EUR", graceEndsAt: null }, period: { start: D("2026-11-01T00:00:00Z"), end: D("2026-12-01T00:00:00Z"), renewsAt: D("2026-12-01T00:00:00Z"), cancelAt: null, trialEnd: null, status: "active" }, billing: { provider: "manual", status: null, cancelAtPeriodEnd: false, portal: false }, invoices: [], customTerms: null } as never;
    const c = deriveBillingCenter(base({ order }));
    expect(c.stage).toBe("active");
    expect(c.contracted).toMatchObject({ planName: "business", reference: "PED-1" });
    expect(c.nextCharge).toMatchObject({ at: D("2026-12-01T00:00:00Z") });
    expect(c.paymentMethod.state).toBe("unknown");
    expect(c.actions.selfServicePlanChange).toBe(true);
    expect(c.actions.portal).toBe(false);
  });
});

describe("centro de suscripción: aislamiento entre empresas", () => {
  // Dos empresas: A (tenant-a) con su cobro y B (tenant-b) con el suyo; ninguna ve nada de la otra
  const subsByCompany: Record<number, ReturnType<typeof sub> & { id: number }> = { 1: { id: 11, ...sub() }, 2: { id: 22, ...sub() } };
  const rows: Record<number, TermsBillingRow> = { 11: row({ id: 1, subscriptionId: 11, companyId: 1, stripeCustomerId: "cus_demo_a" }), 22: row({ id: 2, subscriptionId: 22, companyId: 2, stripeCustomerId: "cus_demo_b" }) };
  const invs: Record<number, TermsBillingInvoice[]> = { 1: [sinv({ billingId: 1, stripeInvoiceId: "in_demo_a" })], 2: [sinv({ billingId: 2, stripeInvoiceId: "in_demo_b" })] };
  const crmAll = [crm({ id: 100, companyId: 1 }), crm({ id: 200, companyId: 2 })];
  const asked: string[] = [];
  const deps: BillingCenterDeps = {
    companyOfTenant: async (t) => (t === "tenant-a" ? { id: 1, name: "A" } : t === "tenant-b" ? { id: 2, name: "B" } : null),
    subscriptionsOf: async (companyId) => [subsByCompany[companyId]],
    billingRow: async (sid) => rows[sid] ?? null,
    billingInvoices: async (bid) => invs[bid] ?? [],
    customTerms: async () => terms(),
    crmInvoices: async (companyId) => crmAll.filter((x) => x.companyId === companyId),
    invoiceHtml: (i) => `<p>${i.number}</p>`,
    stripeInvoiceLinks: async (id) => {
      asked.push(id);
      return { pdfUrl: `https://pay.example.test/${id}/pdf`, hostedUrl: `https://pay.example.test/${id}`, customerId: id === "in_demo_a" ? "cus_demo_a" : id === "in_demo_b" ? "cus_demo_b" : "cus_otro" };
    },
    portalEnabled: true,
    now: () => NOW,
  };
  const svc = new TenantBillingCenterService(deps);

  it("cada empresa solo ve sus propios pagos y facturas", async () => {
    const a = await svc.center("tenant-a");
    const b = await svc.center("tenant-b");
    expect(a.invoices.map((i) => i.id).sort()).toEqual(["crm:100", "stripe:in_demo_a"]);
    expect(b.invoices.map((i) => i.id).sort()).toEqual(["crm:200", "stripe:in_demo_b"]);
    expect(JSON.stringify(a)).not.toMatch(/in_demo_b|cus_demo_b|crm:200/);
  });

  it("los enlaces de una factura ajena no existen para esta empresa (Stripe y sistema)", async () => {
    await expect(svc.invoiceLinks("tenant-a", "stripe:in_demo_b")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.invoiceLinks("tenant-a", "crm:200")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.invoiceLinks("tenant-a", "stripe:in_inventada")).rejects.toMatchObject({ code: "not_found" });
    expect(asked).not.toContain("in_demo_b");
    expect(asked).not.toContain("in_inventada");
  });

  it("la propia factura entrega el PDF oficial de Stripe o el documento del sistema, sin generar uno alternativo", async () => {
    expect(await svc.invoiceLinks("tenant-a", "stripe:in_demo_a")).toEqual({ pdfUrl: "https://pay.example.test/in_demo_a/pdf", hostedUrl: "https://pay.example.test/in_demo_a", documentHtml: null });
    expect(await svc.invoiceLinks("tenant-a", "crm:100")).toEqual({ pdfUrl: null, hostedUrl: null, documentHtml: "<p>FAC-1</p>" });
  });

  it("una factura de Stripe cuyo cliente no es el de la empresa se rechaza aunque figure en su lista", async () => {
    const sneaky = new TenantBillingCenterService({ ...deps, stripeInvoiceLinks: async () => ({ pdfUrl: "x", hostedUrl: "y", customerId: "cus_demo_b" }) });
    await expect(sneaky.invoiceLinks("tenant-a", "stripe:in_demo_a")).rejects.toBeInstanceOf(BillingCenterError);
  });

  it("identificadores no válidos y empresas desconocidas se rechazan", async () => {
    await expect(svc.invoiceLinks("tenant-a", "../../etc")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.center("TENANT_A")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.center("tenant-z")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("centro de suscripción: acuerdo aceptado (contracting)", () => {
  const withContracting = (c: Partial<NonNullable<TenantCustomTerms["contracting"]>>): TenantCustomTerms => ({
    ...terms(6292),
    contracting: { planName: "Business", extensions: ["WhatsApp AI", "Campaigns"], acceptedAt: D("2026-11-19T10:00:00Z"), stage: "activation_scheduled", paymentMethodAuthorized: true, trialActive: true, trialEndsAt: D("2026-11-28T20:53:00Z"), nextChargeAt: D("2026-11-28T20:53:00Z"), recurring: { netCents: 5200, taxCents: 1092, totalCents: 6292, currency: "EUR" }, ...c },
  });
  it("Quantum: plan contratado y extensiones, primer cobro PREVISTO del 28/11 con IVA, método autorizado y sin cobro real", () => {
    const c = deriveBillingCenter(base({ terms: withContracting({}), sub: sub(), row: row({ stripeStatus: "trialing", currentPeriodEnd: D("2026-11-28T20:53:00Z") }), stripeInvoices: [sinv({ stripeInvoiceId: "in_demo_0", number: "LV-0004", subtotalCents: 0, taxCents: 0, totalCents: 0, amountPaidCents: 0 })] }));
    expect(c.stage).toBe("trial_authorized");
    expect(c.contracted?.planName).toBe("Business");
    expect(c.included).toEqual(["Business", "WhatsApp AI", "Campaigns"]);
    expect(c.nextCharge).toMatchObject({ at: D("2026-11-28T20:53:00Z"), estimatedTotalCents: 6292, basis: "trial_end" });
    expect(c.paymentMethod.state).toBe("authorized");
    expect(c.lastPayment).toBeNull();
  });
  it("método de pago sin autorizar (sin webhook verificado): no se da por registrado", () => {
    const c = deriveBillingCenter(base({ terms: withContracting({ paymentMethodAuthorized: false, stage: "payment_pending", nextChargeAt: null }), sub: sub() }));
    expect(c.stage).toBe("contract_pending_payment");
    expect(c.paymentMethod.state).toBe("missing");
    expect(c.nextCharge?.at ?? null).toBeNull();
  });
});
