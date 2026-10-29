/**
 * Métricas de ingresos del Control Center: MRR solo de lo que cobra de verdad, el modo sombra aparte, lo cobrado en la
 * ventana, el riesgo, los próximos cargos y el churn.
 */
import { describe, it, expect } from "vitest";
import { revenueMetrics } from "./revenue/metrics";
import type { ExternalEvent, ExternalSubscription } from "./external/types";
import type { Subscription, SubscriptionItem } from "./subscriptions/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 10);
let seq = 0;
const ext = (o: Partial<ExternalSubscription>): ExternalSubscription =>
  ({
    id: ++seq, contractId: seq, companyId: seq, serviceKey: "skinet", serviceName: "SkiNet", amountCents: 100_000, currency: "eur", taxRateBp: 2100,
    interval: "month", billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 5, firstChargeAt: NOW + 10 * DAY, externalRef: null,
    status: "active", stripeCustomerId: null, stripeSetupSessionId: null, stripePaymentMethodId: null, stripeSubscriptionId: null, stripeTestClockId: null,
    lastInvoiceId: null, lastInvoiceStatus: null, currentPeriodStart: null, currentPeriodEnd: null, graceUntil: null, decisionReason: null, version: 1,
    createdBy: "operator:test", createdAt: NOW - 90 * DAY, updatedAt: NOW - 60 * DAY, ...o,
  }) as ExternalSubscription;
const ev = (externalId: number, kind: string, at: number, detail: Record<string, unknown>): ExternalEvent => ({ id: ++seq, externalId, kind, ref: `r${seq}`, detail, actor: "system:stripe", at });

describe("métricas de ingresos", () => {
  it("MRR y ARR solo con cobro programado o en curso; pendientes aparte; cobrado, riesgo, próximos cargos y churn", () => {
    const active = ext({ companyId: 1, status: "active", currentPeriodStart: NOW - 14 * DAY, currentPeriodEnd: NOW + 3 * DAY, lastInvoiceId: "in_1" });
    const pastDue = ext({ companyId: 2, amountCents: 50_000, status: "past_due", graceUntil: NOW - DAY, currentPeriodStart: NOW - 15 * DAY, lastInvoiceId: "in_2" });
    const scheduled = ext({ companyId: 3, amountCents: 30_000, status: "scheduled", firstChargeAt: NOW + 2 * DAY });
    const sameCompany = ext({ companyId: 1, amountCents: 20_000, status: "scheduled", firstChargeAt: NOW + 20 * DAY });
    const awaiting = ext({ companyId: 4, amountCents: 70_000, status: "awaiting_payment_method" });
    const canceled = ext({ companyId: 5, amountCents: 40_000, status: "canceled", updatedAt: NOW - 5 * DAY, lastInvoiceId: "in_5" });
    const canceledNeverBilled = ext({ companyId: 6, amountCents: 99_000, status: "canceled", updatedAt: NOW - 2 * DAY });
    const events = new Map<number, ExternalEvent[]>([
      [active.id, [ev(active.id, "invoice_paid", NOW - 14 * DAY, { amountPaid: 121_000, subtotal: 100_000, tax: 21_000 }), ev(active.id, "invoice_paid", NOW - 45 * DAY, { amountPaid: 121_000, subtotal: 100_000, tax: 21_000 })]],
      [pastDue.id, [ev(pastDue.id, "invoice_payment_failed", NOW - 15 * DAY, { amountDue: 60_500 })]],
    ]);
    const m = revenueMetrics({ external: [active, pastDue, scheduled, sameCompany, awaiting, canceled, canceledNeverBilled], events, now: NOW });
    expect(m.mrrCents).toBe(200_000);
    expect(m.arrCents).toBe(2_400_000);
    expect(m.payingCompanies).toBe(3);
    expect(m.billingNowMrrCents).toBe(150_000);
    expect(m.scheduledMrrCents).toBe(50_000);
    expect(m.pending).toEqual({ count: 1, mrrCents: 70_000 });
    // Solo la factura de la ventana de 30 días
    expect(m.collected).toEqual({ netCents: 100_000, taxCents: 21_000, grossCents: 121_000, invoices: 1 });
    expect(m.atRisk).toEqual([{ externalId: pastDue.id, companyId: 2, serviceName: "SkiNet", amountDueCents: 60_500, graceUntil: NOW - DAY, overdue: true }]);
    expect(m.upcoming.map((u) => [u.externalId, u.at])).toEqual([[scheduled.id, NOW + 2 * DAY], [active.id, NOW + 3 * DAY]]);
    // Lo cancelado sin haber facturado nunca no es churn
    expect(m.churn.canceledCount).toBe(1);
    expect(m.churn.lostMrrCents).toBe(40_000);
    expect(m.churn.rate).toBeCloseTo(40_000 / 240_000);
    expect(m.byStatus).toMatchObject({ active: 1, past_due: 1, scheduled: 2, awaiting_payment_method: 1, canceled: 2 });
    expect(m.shadow).toBeNull();
  });

  it("el modo sombra se informa aparte y nunca suma al MRR real; sin datos, todo a cero y churn sin tasa", () => {
    const sub = { id: 1, status: "active" } as Subscription;
    const items = new Map<number, SubscriptionItem[]>([
      [1, [
        { unitAmountCents: 12_000, quantity: 1, priceKind: "yearly", effectiveFrom: NOW - DAY, effectiveTo: null },
        { unitAmountCents: 3_000, quantity: 2, priceKind: "monthly", effectiveFrom: NOW - DAY, effectiveTo: null },
        { unitAmountCents: 9_999, quantity: 1, priceKind: "monthly", effectiveFrom: NOW - 9 * DAY, effectiveTo: NOW - DAY },
      ] as SubscriptionItem[]],
    ]);
    const m = revenueMetrics({ external: [], events: new Map(), shadow: { subscriptions: [sub, { id: 2, status: "canceled" } as Subscription], items }, now: NOW });
    expect(m.mrrCents).toBe(0);
    expect(m.shadow).toEqual({ activeSubscriptions: 1, mrrCents: 7_000 });
    expect(m.churn).toEqual({ canceledCount: 0, lostMrrCents: 0, rate: null });
  });
});

describe("ingreso por plataforma para el margen del Resource Manager", () => {
  it("real por la empresa enlazada (solo con cobro programado o en curso); modo sombra aparte; sin plataforma no se atribuye", async () => {
    const { revenueByTenant } = await import("./revenue/metrics");
    const a = ext({ companyId: 10, status: "active", amountCents: 100_000 });
    const b = ext({ companyId: 10, status: "awaiting_payment_method", amountCents: 50_000 });
    const c = ext({ companyId: 11, status: "scheduled", amountCents: 30_000 });
    const sinPlataforma = ext({ companyId: 12, status: "active", amountCents: 99_000 });
    const sub = { id: 1, status: "active", tenantId: "t-hotel" } as Subscription;
    const items = new Map<number, SubscriptionItem[]>([[1, [{ unitAmountCents: 4_000, quantity: 1, priceKind: "monthly", effectiveFrom: NOW - DAY, effectiveTo: null }] as SubscriptionItem[]]]);
    const r = revenueByTenant({ external: [a, b, c, sinPlataforma], tenantOfCompany: new Map([[10, "t-ski"], [11, "t-hotel"], [12, null]]), shadow: { subscriptions: [sub], items }, now: NOW });
    expect(Object.fromEntries(r)).toEqual({ "t-ski": { realMrrCents: 100_000, shadowMrrCents: 0 }, "t-hotel": { realMrrCents: 30_000, shadowMrrCents: 4_000 } });
  });
});
