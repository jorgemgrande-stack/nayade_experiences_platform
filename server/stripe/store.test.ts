/**
 * Almacén en memoria según el modo (sin BD): imita las garantías de MysqlStripeStore con dos vistas de los
 * MISMOS datos (`withMode`), como dos entornos que apuntaran por error a la misma base de datos.
 */
import { describe, it, expect } from "vitest";
import { MemoryStripeStore } from "./store";

const now = 1_800_000_000_000;

describe("almacén en memoria según el modo", () => {
  it("por defecto es de pruebas (compatibilidad con los usos existentes)", () => {
    expect(new MemoryStripeStore().mode).toBe("test");
  });

  it("cada modo solo ve sus filas y nunca toca ni reutiliza las del otro", async () => {
    const live = new MemoryStripeStore("live");
    const test = live.withMode("test");
    // Cliente
    await live.linkCustomer({ companyId: 7, tenantId: null, stripeCustomerId: "cus_live_1", now });
    expect(await test.customerByCompany(7)).toBeNull();
    await expect(test.linkCustomer({ companyId: 7, tenantId: null, stripeCustomerId: "cus_test_1", now })).rejects.toMatchObject({ code: "mode_mismatch" });
    // Precio
    await live.upsertPrice({ webPriceId: 11, stripeProductId: "prod_live", stripePriceId: "price_live", lookupKey: "k", now });
    expect(await test.priceForWebPrice(11)).toBeNull();
    expect(await test.listPrices()).toEqual([]);
    await expect(test.upsertPrice({ webPriceId: 11, stripeProductId: "prod_test", stripePriceId: "price_test", lookupKey: "k2", now })).rejects.toMatchObject({ code: "price_conflict" });
    // Sesión
    await live.insertSession({ orderId: 1, stripeSessionId: "cs_live_1", idempotencyKey: "k1", priceIds: ["price_live"], status: "open", paymentStatus: "unpaid", expiresAt: now - 1, createdAt: now, completedAt: null });
    expect(await test.session("cs_live_1")).toBeNull();
    expect(await test.openSession(1)).toBeNull();
    expect(await test.countSessions(1)).toBe(0);
    expect(await test.openSessionsExpiredBefore(now, 10)).toEqual([]);
    await test.updateSession("cs_live_1", { status: "complete", paymentStatus: "paid", completedAt: now });
    expect(await live.session("cs_live_1")).toMatchObject({ status: "open" });
    await expect(test.insertSession({ orderId: 2, stripeSessionId: "cs_live_1", idempotencyKey: "k2", priceIds: [], status: "expired", paymentStatus: null, expiresAt: now, createdAt: now, completedAt: null })).rejects.toThrow();
    // Suscripción
    const sub = { id: "sub_live_1", customerId: "cus_live_1", companyId: 7, orderId: 1, tenantId: null, status: "active" as const, cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: 1, latestInvoiceId: null, priceIds: [], syncedAt: 0 };
    await live.upsertSubscription(sub);
    expect(await test.subscription("sub_live_1")).toBeNull();
    await expect(test.upsertSubscription({ ...sub, status: "canceled" })).rejects.toMatchObject({ code: "mode_mismatch" });
    expect((await live.subscription("sub_live_1"))?.status).toBe("active");
    expect(await test.subscriptionsToRefresh(now, 10)).toEqual([]);
    expect(await live.subscriptionsToRefresh(now, 10)).toEqual(["sub_live_1"]);
    // Eventos
    await live.recordEvent({ eventId: "evt_live_1", type: "invoice.paid", apiVersion: null, objectType: "invoice", objectId: "in_1", stripeCreated: 1, source: "webhook", now });
    expect(await test.event("evt_live_1")).toBeNull();
    expect((await test.recordEvent({ eventId: "evt_live_1", type: "invoice.paid", apiVersion: null, objectType: "invoice", objectId: "in_1", stripeCreated: 1, source: "webhook", now })).created).toBe(false);
    expect(await test.claimEvents(now, 10, 1000)).toEqual([]);
    expect((await test.eventCounts()).received).toBe(0);
    await test.finishEvent("evt_live_1", "ignored", null, now);
    expect((await live.event("evt_live_1"))?.status).toBe("received");
    expect((await live.claimEvents(now, 10, 1000)).map((e) => e.eventId)).toEqual(["evt_live_1"]);
    // Reembolsos y disputas
    const adj = { chargeId: "ch_live_1", invoiceId: null, subscriptionId: "sub_live_1", orderId: 1, companyId: 7, amountCents: 100, amountRefundedCents: 100, currency: "EUR", disputeStatus: null, coverageLost: true };
    await live.upsertAdjustment(adj, now);
    await expect(test.upsertAdjustment(adj, now)).rejects.toMatchObject({ code: "mode_mismatch" });
    expect(await test.activeHolds(1)).toEqual([]);
    expect(await test.resolveHolds({ orderId: 1, exceptInvoiceId: null }, "x", now)).toBe(0);
    expect(await live.activeHolds(1)).toHaveLength(1);
  });
});
