/**
 * Revisión del catálogo del 09/11/2026: SEO Control, Ads Manager y Reception AI a implantación acompañada con su ficha real
 * (sin checkout ni Price de Stripe: `stripePrepared: false`).
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { MARKETING_LISTINGS_2026_11_09, REVIEW_ID_2026_11_09_MARKETING } from "./catalog/review20261109marketing";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_MARKETING}`;
const KEYS = ["connect-seo-control", "connect-ads-manager", "connect-reception-ai"];

/** Como production el 09/11/2026: los tres «Próximamente» con su ficha de partida (Reception AI con nivel 3). */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of MARKETING_LISTINGS_2026_11_09) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { headline: "x", cta: "contact" };
    for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
    const draft = {
      ...d,
      ...(c.thirdPartyCosts ? { thirdPartyCosts: c.thirdPartyCosts.from } : {}),
      technicalStatus: c.technical!.from,
      activation: { kind: c.activation!.from, ref: null },
      catalog: { ...d.catalog, commercialStatus: c.status!.from, ...(c.implementationLevel ? { implementationLevel: c.implementationLevel.from } : {}) },
      commercial,
      internal: { ...d.internal, functionalGrade: "none" as const },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 09/11/2026: SEO Control, Ads Manager y Reception AI", () => {
  it("solo esos tres pasan a implantación acompañada, con su ficha (pasa las comprobaciones del CRM) y sin tocar precios", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).filter((e) => !KEYS.includes(e.key)).map((e) => [e.key, e.draftVersion]));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: MARKETING_LISTINGS_2026_11_09 });
    expect(sim.conflicts).toEqual([]);
    expect(sim.changed.map((c) => c.split(":")[0])).toEqual(KEYS);
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: MARKETING_LISTINGS_2026_11_09 });
    expect(r.conflicts).toEqual([]);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) if (!KEYS.includes(e.key)) expect(e.draftVersion, e.key).toBe(before.get(e.key));
    for (const key of KEYS) {
      const d = productDraft.parse((await k.store.getEntry("product", key))!.draft);
      expect(d, key).toMatchObject({ technicalStatus: "partial", activation: { kind: "feature" }, catalog: { commercialStatus: "on_request" }, commercial: { cta: "contact" } });
      expect(d.commercial?.headline, key).not.toMatch(/Próximamente/);
      expect(d.commercial?.faq?.[0].q, key).toBe("¿Cómo se pone en marcha?");
    }
    expect(productDraft.parse((await k.store.getEntry("product", "connect-reception-ai"))!.draft).catalog.implementationLevel).toBe(1);
    for (const key of KEYS) expect(productDraft.parse((await k.store.getEntry("product", key))!.draft).catalog.stripePrepared, key).toBe(false);
    // Sin checkout: implantación asistida en la web y el cotizador
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    for (const key of KEYS) expect(cat.products.find((p) => p.key === key)!.offer, key).toMatchObject({ modality: "assisted", checkout: false });
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: MARKETING_LISTINGS_2026_11_09 });
    expect(again.already).toEqual(KEYS);
  });
});
