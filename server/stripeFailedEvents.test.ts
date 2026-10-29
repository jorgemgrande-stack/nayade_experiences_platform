/**
 * Eventos de Stripe fallidos visibles para operación (GET /stripe/events → failed): solo los del modo propio, los más
 * recientes primero, con su error y el próximo reintento; nunca el cuerpo del evento.
 */
import { describe, it, expect } from "vitest";
import { MemoryStripeStore } from "./stripe/store";

const T = Date.UTC(2026, 10, 1, 9);
const rec = (s: MemoryStripeStore, id: string, now: number) =>
  s.recordEvent({ eventId: id, type: "invoice.payment_failed", apiVersion: null, objectType: "invoice", objectId: "in_1", stripeCreated: now / 1000, source: "webhook", now });

describe("eventos de Stripe fallidos", () => {
  it("lista los fallidos (reintento programado o definitivo), los más recientes primero, sin los procesados", async () => {
    const s = new MemoryStripeStore("live");
    await rec(s, "evt_aaaaaaaa1", T);
    await rec(s, "evt_aaaaaaaa2", T + 1000);
    await rec(s, "evt_aaaaaaaa3", T + 2000);
    await s.failEvent("evt_aaaaaaaa1", "pedido no encontrado", T + 60_000);
    await s.failEvent("evt_aaaaaaaa3", "error definitivo", null);
    await s.finishEvent("evt_aaaaaaaa2", "processed", null, T + 5000);
    const failed = await s.failedEvents(10);
    expect(failed.map((e) => [e.eventId, e.lastError, e.nextAttemptAt])).toEqual([
      ["evt_aaaaaaaa3", "error definitivo", null],
      ["evt_aaaaaaaa1", "pedido no encontrado", T + 60_000],
    ]);
    expect(await s.failedEvents(1)).toHaveLength(1);
    expect((await s.eventCounts()).failed).toBe(2);
  });
});
