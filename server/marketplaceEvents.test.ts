/**
 * Medición del marketplace del panel: agregada por día, empresa, tipo, producto y campaña, sin datos personales;
 * cada evento cuenta una sola vez; lo fuera de plazo se descarta; sin almacén (migración pendiente) se acepta y se
 * descarta. Datos sintéticos.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryPanelEventStore, panelEventSummary, recordPanelEvents } from "./commerce/panelEvents";

const NOW = Date.UTC(2026, 10, 2, 12);
const ev = (type: string, over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, at: NOW - 1000, ...over });

describe("medición del marketplace", () => {
  it("cuenta por día, empresa, tipo, producto y campaña; repetir un id no vuelve a contar", async () => {
    const store = new MemoryPanelEventStore();
    const a = ev("card_view", { productKey: "connect-people" });
    const r = await recordPanelEvents(store, "t9-demo", { events: [a, a, ev("cta_click", { productKey: "connect-people" }), ev("slide_view", { slideId: "people" })] }, NOW);
    expect(r).toEqual({ accepted: 4, counted: 3, stale: 0 });
    expect((await recordPanelEvents(store, "t9-demo", { events: [a] }, NOW)).counted).toBe(0);
    await recordPanelEvents(store, "otra-empresa", { events: [ev("card_view", { productKey: "connect-people" })] }, NOW);
    const s = await panelEventSummary(store, { from: "2026-11-02", to: "2026-11-02" });
    expect(s.totals).toEqual({ card_view: 2, cta_click: 1, slide_view: 1 });
    expect(s.products).toEqual([{ key: "connect-people", total: 3, byType: { card_view: 2, cta_click: 1 }, tenants: 2 }]);
    expect(s.slides).toEqual([{ key: "people", total: 1, byType: { slide_view: 1 }, tenants: 1 }]);
  });

  it("sin datos personales: rechaza campos desconocidos, tipos inventados y lotes de más de 50", async () => {
    const store = new MemoryPanelEventStore();
    await expect(recordPanelEvents(store, "t9-demo", { events: [ev("card_view", { email: "x@y.z" })] }, NOW)).rejects.toThrow();
    await expect(recordPanelEvents(store, "t9-demo", { events: [ev("page_view")] }, NOW)).rejects.toThrow();
    await expect(recordPanelEvents(store, "t9-demo", { events: [{ ...ev("card_view"), id: "no-es-uuid" }] }, NOW)).rejects.toThrow();
    await expect(recordPanelEvents(store, "t9-demo", { events: Array.from({ length: 51 }, () => ev("card_view")) }, NOW)).rejects.toThrow();
    expect(store.rows.size).toBe(0);
  });

  it("lo de hace más de 24 h o del futuro se descarta sin fallar el lote; sin almacén, se acepta y no se cuenta", async () => {
    const store = new MemoryPanelEventStore();
    const r = await recordPanelEvents(store, "t9-demo", { events: [ev("card_view", { at: NOW - 25 * 3600_000 }), ev("card_view", { at: NOW + 3600_000 }), ev("card_view")] }, NOW);
    expect(r).toEqual({ accepted: 3, counted: 1, stale: 2 });
    expect(await recordPanelEvents(null, "t9-demo", { events: [ev("card_view")] }, NOW)).toEqual({ accepted: 1, counted: 0, stale: 0 });
  });

  it("acepta at en milisegundos o como fecha ISO (lo que envía el panel)", async () => {
    const store = new MemoryPanelEventStore();
    const r = await recordPanelEvents(store, "t9-demo", { events: [ev("card_view", { at: new Date(NOW - 60_000).toISOString() }), ev("card_view", { at: "2026-11-02T13:00:00+01:00" })] }, NOW);
    expect(r).toEqual({ accepted: 2, counted: 2, stale: 0 });
    await expect(recordPanelEvents(store, "t9-demo", { events: [ev("card_view", { at: "ayer" })] }, NOW)).rejects.toThrow();
  });
});
