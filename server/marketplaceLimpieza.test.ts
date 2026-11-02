/**
 * Limpieza del marketplace: borrado de imágenes solo si nadie las usa (borrador, publicación o historial), con plazo de
 * gracia de 30 días, simulación por defecto y segunda comprobación antes de borrar; depuración de las claves de
 * deduplicación de la medición sin tocar los contadores agregados. Imágenes y eventos sintéticos (sin sharp).
 */
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import type mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { authenticate, hashToken } from "./controlPlane/auth";
import { EVENT_KEY_RETENTION_MS, MemoryPanelEventStore, MysqlPanelEventStore, panelEventSummary, purgePanelEventKeys, recordPanelEvents } from "./commerce/panelEvents";
import { MediaError, MediaService, MemoryMediaStore, MysqlMediaStore, createMediaAdminRouter, mediaUrl, type ImageEncoder } from "./web/media";
import { MemoryWebStore, type WebEntry } from "./web/store";

const DAY = 24 * 3600_000;
const T0 = Date.UTC(2026, 9, 1);
const BASE = "https://admin.bigelephant.es";

/** Codificador falso: dos variantes por imagen, sin procesar nada. */
const encode: ImageEncoder = async () => ({
  width: 1200,
  height: 800,
  files: [
    { variant: "w480.webp", contentType: "image/webp", width: 480, data: Buffer.from("webp") },
    { variant: "w480.avif", contentType: "image/avif", width: 480, data: Buffer.from("avif") },
  ],
});
/** PNG sintético (solo la firma y bytes distintos: cada uno tiene su huella). */
const fakePng = (n: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`imagen-${n}`.padEnd(32))]);

const setup = () => {
  const clock = { now: T0 };
  const store = new MemoryMediaStore();
  const web = new MemoryWebStore();
  const svc = new MediaService({ store, web, encode, now: () => clock.now });
  const upload = async (n: number) => (await svc.upload({ data: fakePng(n), alt: `Imagen ${n}`, author: "operator:1" })).media.id;
  const entry = (key: string, over: Partial<WebEntry>) =>
    web.createEntry({ kind: "marketplace_slide", key, family: null, sortOrder: 0, publication: "draft", draft: {}, draftVersion: 1, published: null, publishedVersion: null, createdAt: 1, createdBy: "o", updatedAt: 1, updatedBy: "o", publishedAt: null, publishedBy: null, ...over });
  return { clock, store, web, svc, upload, entry };
};

describe("borrado de imágenes del marketplace", () => {
  it("no borra imágenes usadas en un borrador, en una publicación o en el historial", async () => {
    const { clock, store, web, svc, upload, entry } = setup();
    const [enBorrador, publicada, enHistorial, libre] = [await upload(1), await upload(2), await upload(3), await upload(4)];
    await entry("borrador", { draft: { background: { src: mediaUrl(BASE, enBorrador) } } });
    await entry("publicada", { publication: "published", published: { background: { src: mediaUrl(BASE, publicada, "w960.avif") } }, publishedVersion: 1 });
    const h = await entry("historial", { draft: { background: { src: mediaUrl(BASE, enHistorial) } } });
    await web.saveDraft(h.id, 1, { background: { src: "https://otra.example/a.webp" } }, 0, "o", 2);
    clock.now = T0 + 40 * DAY;

    for (const id of [enBorrador, publicada, enHistorial]) {
      const err = await svc.remove(id, "operator:1").catch((e) => e);
      expect(err).toBeInstanceOf(MediaError);
      expect(err).toMatchObject({ code: "in_use" });
      expect((err.details as { usedBy: string[] }).usedBy.length).toBeGreaterThan(0);
    }
    expect((await svc.usage(enHistorial))).toEqual(["marketplace_slide:historial@v1"]);

    const r = await svc.purgeUnused({ dryRun: false });
    expect(r.deleted).toEqual([libre]);
    expect(r.kept.map((k) => k.id).sort()).toEqual([enBorrador, publicada, enHistorial].sort());
    for (const id of [enBorrador, publicada, enHistorial]) expect(await store.get(id)).not.toBeNull();
    expect(await store.get(libre)).toBeNull();
  });

  it("respeta el plazo de gracia de 30 días aunque se pida menos", async () => {
    const { clock, store, svc, upload } = setup();
    const vieja = await upload(1);
    clock.now = T0 + 10 * DAY;
    const reciente = await upload(2);
    clock.now = T0 + 31 * DAY;
    const r = await svc.purgeUnused({ dryRun: false, olderThanDays: 1 });
    expect(r.olderThanDays).toBe(30);
    expect(r.deleted).toEqual([vieja]);
    expect(await store.get(reciente)).not.toBeNull();
  });

  it("por defecto simula: devuelve la lista y no borra nada", async () => {
    const { clock, store, svc, upload } = setup();
    const id = await upload(1);
    clock.now = T0 + 60 * DAY;
    const r = await svc.purgeUnused();
    expect(r).toMatchObject({ dryRun: true, deleted: [], kept: [] });
    expect(r.unused.map((m) => m.id)).toEqual([id]);
    expect(await store.get(id)).not.toBeNull();
  });

  it("el borrado elimina también las variantes", async () => {
    const { store, svc, upload } = setup();
    const id = await upload(1);
    expect(await store.file(id, "w480.webp")).not.toBeNull();
    await svc.remove(id, "operator:1");
    expect(await store.get(id)).toBeNull();
    expect(await store.file(id, "w480.webp")).toBeNull();
    expect(await store.file(id, "w480.avif")).toBeNull();
    await expect(svc.remove(id, "operator:1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("vuelve a comprobar el uso justo antes de borrar (alguien la referencia entre la lista y el borrado)", async () => {
    const { clock, store, web, upload } = setup();
    const id = await upload(1);
    clock.now = T0 + 40 * DAY;
    let calls = 0;
    // Primera comprobación: libre; la segunda ya la ve en el historial
    const racy = { listEntries: () => web.listEntries(), versionsContaining: async () => (++calls > 1 ? [{ kind: "marketplace_slide" as const, key: "nueva", version: 1 }] : []) };
    const r = await new MediaService({ store, web: racy, encode, now: () => clock.now }).purgeUnused({ dryRun: false });
    expect(r.deleted).toEqual([]);
    expect(r.kept).toEqual([{ id, usedBy: ["marketplace_slide:nueva@v1"] }]);
    expect(await store.get(id)).not.toBeNull();
  });

  it("en MySQL borra la fila de la imagen (las variantes caen por la clave foránea en cascada)", async () => {
    const sql: string[] = [];
    const pool = { query: async (q: string) => (sql.push(q), [{ affectedRows: 1 }]) } as unknown as mysql.Pool;
    expect(await new MysqlMediaStore(pool).delete("a".repeat(32))).toBe(true);
    expect(sql).toEqual(["DELETE FROM marketplace_media WHERE id = ?"]);
  });

  it("API: DELETE 409 con la lista de usos; la limpieza simula salvo dryRun false y no admite menos de 30 días", async () => {
    const { clock, svc, upload, entry } = setup();
    const usada = await upload(1);
    const libre = await upload(2);
    await entry("campana", { draft: { background: { src: mediaUrl(BASE, usada) } } });
    clock.now = T0 + 40 * DAY;
    const token = "t".repeat(40);
    const readOnly = "r".repeat(40);
    const app = express()
      .use(authenticate([{ id: "crm", sha256: hashToken(token), scopes: ["web:read", "web:write"] }, { id: "lectura", sha256: hashToken(readOnly), scopes: ["web:read"] }]))
      .use("/web/media", createMediaAdminRouter(svc));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/web/media`;
      const call = (method: string, path: string, body?: unknown) =>
        fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const inUse = await call("DELETE", `/${usada}`);
      expect(inUse.status).toBe(409);
      expect(await inUse.json()).toMatchObject({ error: "in_use", details: { usedBy: ["marketplace_slide:campana", "marketplace_slide:campana@v1"] } });
      expect((await call("POST", "/purge", { olderThanDays: 5 })).status).toBe(400);
      const sim = await (await call("POST", "/purge", {})).json();
      expect(sim).toMatchObject({ dryRun: true, deleted: [] });
      expect(sim.unused.map((m: { id: string }) => m.id)).toEqual([libre]);
      const real = await (await call("POST", "/purge", { dryRun: false })).json();
      expect(real).toMatchObject({ dryRun: false, deleted: [libre] });
      expect((await call("DELETE", `/${libre}`)).status).toBe(404);
      // Borrar y limpiar exigen el mismo permiso de escritura que subir
      for (const [m, p] of [["DELETE", `/${usada}`], ["POST", "/purge"]]) expect((await fetch(`${base}${p}`, { method: m, headers: { authorization: `Bearer ${readOnly}` } })).status, p).toBe(403);
    } finally {
      server.close();
    }
  });
});

describe("depuración de claves de la medición", () => {
  const ev = (at: number, over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type: "card_view", productKey: "connect-people", at, ...over });

  it("borra solo las claves de más de 7 días y conserva los contadores agregados", async () => {
    const store = new MemoryPanelEventStore();
    await recordPanelEvents(store, "t9-demo", { events: [ev(T0 - 1000), ev(T0 - 2000)] }, T0);
    const later = T0 + 3 * DAY;
    await recordPanelEvents(store, "t9-demo", { events: [ev(later - 1000)] }, later);
    const before = await panelEventSummary(store, { from: "2026-09-30", to: "2026-10-04" });

    expect(await purgePanelEventKeys(store, T0 + 8 * DAY)).toBe(2);
    expect(store.seen.size).toBe(1);
    expect(await panelEventSummary(store, { from: "2026-09-30", to: "2026-10-04" })).toEqual(before);
    expect(before.totals).toEqual({ card_view: 3 });
  });

  it("un evento antiguo cuya clave se depuró no vuelve a contar: llega fuera de plazo", async () => {
    const store = new MemoryPanelEventStore();
    const a = ev(T0 - 1000);
    expect((await recordPanelEvents(store, "t9-demo", { events: [a] }, T0)).counted).toBe(1);
    const now = T0 + EVENT_KEY_RETENTION_MS + 1000;
    await purgePanelEventKeys(store, now);
    expect(store.seen.has(a.id)).toBe(false);
    expect(await recordPanelEvents(store, "t9-demo", { events: [a] }, now)).toEqual({ accepted: 1, counted: 0, stale: 1 });
    expect((await panelEventSummary(store, { from: "2026-09-30", to: "2026-10-01" })).totals).toEqual({ card_view: 1 });
  });

  it("la retención supera con margen el plazo en que un evento aún se acepta (24 h + 5 min)", () => {
    expect(EVENT_KEY_RETENTION_MS).toBeGreaterThan(2 * DAY);
  });

  it("en MySQL borra por lotes de 1000 hasta vaciar y nunca toca marketplace_event_counts", async () => {
    const sql: Array<{ q: string; v: unknown[] }> = [];
    const batches = [1000, 1000, 37];
    const pool = { query: async (q: string, v: unknown[]) => (sql.push({ q, v }), [{ affectedRows: batches.shift() ?? 0 }]) } as unknown as mysql.Pool;
    const cutoff = T0 - EVENT_KEY_RETENTION_MS;
    expect(await new MysqlPanelEventStore(pool).purgeKeys(cutoff)).toBe(2037);
    expect(sql).toHaveLength(3);
    for (const s of sql) {
      expect(s.q).toBe("DELETE FROM marketplace_event_keys WHERE received_at < ? LIMIT 1000");
      expect(s.v).toEqual([new Date(cutoff)]);
    }
    expect(sql.some((s) => s.q.includes("marketplace_event_counts"))).toBe(false);
  });
});
