/** Conciliación sin red ni BD: cursor, recuperación de eventos y trabajo pendiente (regresión M1). */
import { describe, it, expect } from "vitest";
import { StripeReconciler } from "./reconcile";
import { MemoryStripeStore } from "./store";
import { FakeStripeGateway } from "./testing";

const noProcessor = { processDue: async () => ({ processed: 0, ignored: 0, failed: 0, retried: 0 }), handleSubscription: async () => ({ outcome: "processed" as const, detail: null }) };

describe("conciliación", () => {
  it("recupera los eventos que no llegaron y no los duplica en la pasada siguiente", async () => {
    const gw = new FakeStripeGateway();
    const store = new MemoryStripeStore();
    const now = 1_800_000_500_000;
    for (let i = 0; i < 5; i++) gw.emit("invoice.paid", "invoice", `in_test_${i}`, 1_800_000_000 + i);
    gw.emit("charge.refunded", "charge", "ch_test_1", 1_800_000_100); // tipo no gestionado: no se pide
    const rec = new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now });
    expect((await rec.tick()).recovered).toBe(5);
    expect((await rec.tick()).recovered).toBe(0);
    expect(store.events.size).toBe(5);
  });

  it("M1: si quedan páginas por leer, el cursor NO avanza (lo pendiente es lo más antiguo)", async () => {
    const gw = new FakeStripeGateway();
    const store = new MemoryStripeStore();
    const now = 1_800_000_500_000;
    for (let i = 0; i < 150; i++) gw.emit("invoice.paid", "invoice", `in_test_${i}`, 1_800_000_000 + i);
    const before = Math.floor(now / 1000) - 3 * 86_400;
    const rec = new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now, maxEventPages: 1 });
    const r = await rec.tick();
    expect(r.recovered).toBe(100);
    expect(await store.getState("events_cursor")).toMatchObject({ cursor: before, complete: false });
    const all = new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now, maxEventPages: 5 });
    expect((await all.tick()).recovered).toBe(50);
    expect((await store.getState("events_cursor"))?.complete).toBe(true);
  });

  it("dos ejecuciones a la vez: solo una trabaja", async () => {
    const store = new MemoryStripeStore();
    const rec = new StripeReconciler({ store, gateway: new FakeStripeGateway(), processor: noProcessor, now: () => 1_800_000_000_000 });
    const [a, b] = await Promise.all([rec.tick(), rec.tick()]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  });
});
