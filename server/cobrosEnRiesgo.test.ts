/** Bandeja «Cobros en riesgo» (server/revenue/atRisk.ts): datos, idempotencia del reintento y candado de live. */
import { describe, expect, it, vi } from "vitest";
import { AtRiskService, failureText, type AtRiskDeps } from "./revenue/atRisk";
import type { CommercialOrder } from "./orchestrator/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29, 12);
const order = (o: Partial<CommercialOrder>) => ({ id: 1, state: "past_due", companyId: 10, tenantId: "t5-cliente", graceEndsAt: NOW + 4 * DAY, quote: { currency: "EUR" }, ...o }) as unknown as CommercialOrder;
const inv = { stripeInvoiceId: "in_1", orderId: 1, status: "open", number: "EB-1", currency: "eur", totalCents: 5929, amountPaidCents: 0, createdAt: NOW - DAY } as never;

function make(stripe: Partial<NonNullable<AtRiskDeps["stripe"]>> = {}, over: Partial<AtRiskDeps> = {}) {
  const pay = vi.fn(async () => ({ id: "in_1", status: "paid", amountRemaining: 0 }) as never);
  const settle = vi.fn(async () => "processed");
  const svc = new AtRiskService({
    orders: async () => [order({}), order({ id: 2, state: "active" }), order({ id: 3, state: "suspended", companyId: 11, graceEndsAt: NOW - DAY })],
    company: async (id) => ({ id, name: id === 10 ? "Cliente SL" : "Otra SL", tenantId: null }),
    invoices: async (orderId) => (orderId === 1 ? [inv] : []),
    events: async () => [{ occurredAt: NOW - DAY, type: "order.past_due", fromState: "active", toState: "past_due", actor: "stripe" } as never],
    stripe: {
      mode: "test",
      liveRetryAllowed: false,
      invoice: async () => ({ id: "in_1", status: "open", amountRemaining: 5929, attemptCount: 2, nextPaymentAttempt: (NOW + 2 * DAY) / 1000, hostedInvoiceUrl: "https://invoice.stripe.com/x" }) as never,
      failure: async () => ({ code: "card_declined", declineCode: "insufficient_funds", message: "Your card has insufficient funds." }),
      pay,
      subscriptionOf: async () => ({ id: "sub_1" }) as never,
      settle,
      portal: async () => ({ url: "https://billing.stripe.com/p/session/x" }),
      ...stripe,
    },
    external: async () => [{ externalId: 7, companyId: 12, serviceName: "Soporte", amountDueCents: 1210, graceUntil: NOW + DAY, overdue: false }],
    now: () => NOW,
    ...over,
  });
  return { svc, pay, settle };
}

describe("bandeja «Cobros en riesgo»", () => {
  it("impagos SaaS (gracia y suspendidos) y servicios externos: importe, motivo, próximo intento, gracia e historial", async () => {
    const { cases, totals } = await make().svc.list();
    expect(cases.map((c) => [c.kind, c.orderId ?? c.externalId, c.state])).toEqual([
      ["subscription", 3, "suspended"],
      ["external", 7, "past_due"],
      ["subscription", 1, "past_due"],
    ]);
    const c = cases.find((x) => x.orderId === 1)!;
    expect(c).toMatchObject({ amountDueCents: 5929, currency: "EUR", reason: "Fondos insuficientes", attempts: 2, nextAttemptAt: NOW + 2 * DAY, grace: { expired: false, daysLeft: 4 }, invoice: { id: "in_1", hostedUrl: "https://invoice.stripe.com/x" }, actions: { sync: true, retry: true, portal: true } });
    expect(c.events[0]).toMatchObject({ type: "order.past_due", to: "past_due" });
    expect(cases.find((x) => x.orderId === 3)!.grace).toMatchObject({ expired: true, daysLeft: 0 });
    expect(totals).toEqual({ count: 3, amountDueCents: 5929 + 1210 });
  });
  it("reintento idempotente por factura e intento (un doble clic no cobra dos veces la misma tentativa)", async () => {
    const { svc, pay } = make();
    await svc.retry(1);
    await svc.retry(1);
    expect(pay).toHaveBeenNthCalledWith(1, "in_1", "recovery:in_1:2");
    expect(pay).toHaveBeenNthCalledWith(2, "in_1", "recovery:in_1:2");
  });
  it("live: el reintento manual de cobros reales exige CP_RECOVERY_LIVE_RETRY; la bandeja lo refleja", async () => {
    const { svc, pay } = make({ mode: "live" });
    await expect(svc.retry(1)).rejects.toMatchObject({ code: "forbidden" });
    expect(pay).not.toHaveBeenCalled();
    expect((await svc.list()).cases.find((c) => c.orderId === 1)!.actions.retry).toBe(false);
    await expect(make({ mode: "live", liveRetryAllowed: true }).svc.retry(1)).resolves.toMatchObject({ status: "paid" });
  });
  it("sin factura abierta o factura ya pagada: no se reintenta; pedido al corriente: no está en la bandeja", async () => {
    await expect(make({ invoice: async () => ({ id: "in_1", status: "paid" }) as never }).svc.retry(1)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(make().svc.retry(3)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(make().svc.retry(2)).rejects.toMatchObject({ code: "not_found" });
  });
  it("sincronizar relee Stripe por el camino del webhook; portal: enlace sin enviar nada", async () => {
    const { svc, settle } = make();
    expect(await svc.sync(1)).toEqual({ outcome: "processed" });
    expect(settle).toHaveBeenCalledWith({ id: "sub_1" });
    expect(await svc.portal(1)).toEqual({ url: "https://billing.stripe.com/p/session/x" });
  });
  it("sin Stripe: la bandeja funciona (con lo registrado) y las acciones no están disponibles", async () => {
    const { svc } = make({}, { stripe: undefined });
    const c = (await svc.list()).cases.find((x) => x.orderId === 1)!;
    expect(c).toMatchObject({ amountDueCents: 5929, reason: "Cobro de la factura no completado", actions: { sync: false, retry: false, portal: false } });
    await expect(svc.sync(1)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("motivos legibles", () => {
    expect(failureText({ code: "expired_card", declineCode: null, message: null })).toBe("Tarjeta caducada");
    expect(failureText({ code: "x", declineCode: null, message: "Algo" })).toBe("Algo");
    expect(failureText(null)).toBeNull();
  });
});
