/**
 * Revisión del catálogo del 08/11/2026 (tanda C): fichas de Care, Ski, Restaurant y Travel Net al día con su implantación
 * acompañada. Hotel Net no se toca (borrador ajeno en el CRM).
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { NET_LISTINGS_2026_11_08, REVIEW_ID_2026_11_08_NET } from "./catalog/review20261108net";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_08_NET}`;
const KEYS = ["care-net-complete", "ski-net-complete", "restaurant-net-complete", "travel-net-complete"];

async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of NET_LISTINGS_2026_11_08) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { headline: "x", cta: "demo" };
    for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
    const saved = await svc.save("product", c.key, { draft: productDraft.parse({ ...d, commercial, internal: { ...d.internal, functionalGrade: "in_use" } }), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 08/11/2026: fichas de Elephant Net", () => {
  it("solo Care, Ski, Restaurant y Travel; nunca Hotel Net", () => {
    expect(NET_LISTINGS_2026_11_08.map((c) => c.key)).toEqual(KEYS);
    expect(NET_LISTINGS_2026_11_08.every((c) => !c.status && !c.technical)).toBe(true);
  });

  it("publica las fichas (pasan las comprobaciones del CRM), sin «Todavía no se puede contratar»; repetir no cambia nada", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: NET_LISTINGS_2026_11_08 });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(4);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const key of KEYS) {
      const e = (await k.store.getEntry("product", key))!;
      const d = productDraft.parse(e.draft);
      expect(e.publishedVersion, key).toBe(e.draftVersion);
      expect(d.catalog.commercialStatus, key).toBe("on_request");
      expect(d.commercial?.terms?.activation, key).toMatch(/^Implantación acompañada/);
      expect(JSON.stringify(d.commercial?.faq), key).not.toMatch(/Todavía no/);
    }
    const care = productDraft.parse((await k.store.getEntry("product", "care-net-complete"))!.draft);
    expect(care.commercial?.longDescription).toMatch(/recordatorios de cita por correo/);
    const ski = productDraft.parse((await k.store.getEntry("product", "ski-net-complete"))!.draft);
    expect(ski.commercial?.longDescription).toMatch(/fianzas con su devolución/);
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: NET_LISTINGS_2026_11_08 });
    expect(again.already).toEqual(KEYS);
  });
});
