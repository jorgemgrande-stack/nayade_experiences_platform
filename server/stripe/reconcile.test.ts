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
    gw.emit("customer.created", "customer", "cus_test_1", 1_800_000_100); // tipo no gestionado: no se pide
    const rec = new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now });
    expect((await rec.tick()).recovered).toBe(5);
    expect((await rec.tick()).recovered).toBe(0);
    expect(store.events.size).toBe(5);
  });

  it("con todos los tipos gestionados (más de 20) no pide filtro a Stripe y atraviesa páginas de eventos ajenos", async () => {
    const gw = new FakeStripeGateway();
    const store = new MemoryStripeStore();
    const now = 1_800_000_500_000;
    gw.emit("invoice.voided", "invoice", "in_test_v", 1_800_000_000);
    for (let i = 0; i < 120; i++) gw.emit("customer.created", "customer", `cus_test_${i}`, 1_800_000_001 + i);
    gw.emit("customer.subscription.pending_update_expired", "subscription", "sub_test_p", 1_800_000_200);
    const rec = new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now });
    const r = await rec.tick();
    expect(r.recovered).toBe(2);
    expect([...store.events.values()].map((e) => e.type).sort()).toEqual(["customer.subscription.pending_update_expired", "invoice.voided"]);
    expect((await store.getState("events_cursor"))?.complete).toBe(true);
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

  it("purga: solo eventos terminados más antiguos que la retención; los fallidos nunca; una vez al día y con constancia", async () => {
    const store = new MemoryStripeStore();
    const DAY = 86_400_000;
    let now = 1_800_000_000_000;
    const rec = new StripeReconciler({ store, gateway: new FakeStripeGateway(), processor: noProcessor, now: () => now, retentionDays: 10 });
    const add = async (id: string, ageDays: number, status: "processed" | "ignored" | "failed" | "received") => {
      await store.recordEvent({ eventId: id, type: "invoice.paid", apiVersion: null, objectType: "invoice", objectId: "in_x", stripeCreated: 1, source: "webhook", now: now - ageDays * DAY });
      if (status === "processed" || status === "ignored") await store.finishEvent(id, status, null, now);
      if (status === "failed") await store.failEvent(id, "x", null);
    };
    await add("evt_old_processed", 200, "processed");
    await add("evt_old_ignored", 100, "ignored");
    await add("evt_old_failed", 300, "failed");
    await add("evt_new_processed", 5, "processed");
    // La retención mínima es 35 días aunque se configure menos
    expect(await rec.purge()).toBe(2);
    expect(Array.from(store.events.keys()).sort()).toEqual(["evt_new_processed", "evt_old_failed"]);
    expect(await store.getState("events_purge")).toMatchObject({ deleted: 2, byStatus: { processed: 1, ignored: 1 }, totalDeleted: 2, retentionDays: 35, complete: true });
    await add("evt_old2", 90, "processed");
    expect(await rec.purge()).toBe(0); // hoy ya se purgó
    now += DAY + 1;
    expect(await rec.purge()).toBe(1);
    expect((await store.getState("events_purge"))?.totalDeleted).toBe(3);
  });

  it("dos ejecuciones a la vez: solo una trabaja", async () => {
    const store = new MemoryStripeStore();
    const rec = new StripeReconciler({ store, gateway: new FakeStripeGateway(), processor: noProcessor, now: () => 1_800_000_000_000 });
    const [a, b] = await Promise.all([rec.tick(), rec.tick()]);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  });
});

describe("conciliación según el modo", () => {
  it("modo live: registra solo los eventos live; los de pruebas se descartan", async () => {
    const gw = new FakeStripeGateway();
    const now = 1_800_000_500_000;
    gw.livemode = true;
    for (let i = 0; i < 3; i++) gw.emit("invoice.paid", "invoice", `in_live_${i}`, 1_800_000_000 + i);
    gw.livemode = false;
    for (let i = 0; i < 2; i++) gw.emit("invoice.paid", "invoice", `in_test_${i}`, 1_800_000_010 + i);
    const store = new MemoryStripeStore("live");
    expect((await new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => now, mode: "live" }).tick()).recovered).toBe(3);
    expect(Array.from(store.events.values()).map((e) => e.objectId).sort()).toEqual(["in_live_0", "in_live_1", "in_live_2"]);
  });

  it("modo pruebas (por defecto): los eventos live se descartan como siempre", async () => {
    const gw = new FakeStripeGateway();
    gw.livemode = true;
    gw.emit("invoice.paid", "invoice", "in_live_x", 1_800_000_000);
    gw.livemode = false;
    gw.emit("invoice.paid", "invoice", "in_test_x", 1_800_000_001);
    const store = new MemoryStripeStore();
    expect((await new StripeReconciler({ store, gateway: gw, processor: noProcessor, now: () => 1_800_000_500_000 }).tick()).recovered).toBe(1);
    expect(Array.from(store.events.values()).map((e) => e.objectId)).toEqual(["in_test_x"]);
  });
});
