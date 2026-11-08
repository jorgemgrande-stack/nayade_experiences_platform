/**
 * Revisión del catálogo del 08/11/2026 (tandas D y E): Campaigns a implantación acompañada con su ficha real y Finance
 * Sync en venta directa solo con su Price de Stripe.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview, LISTINGS_2026_11_08 } from "./catalog/review20261108fichas";
import { CAMPAIGNS_LISTING_2026_11_08, FINANCE_SYNC_DIRECT_SALE, REVIEW_ID_2026_11_08_CAMPAIGNS } from "./catalog/review20261108campaigns";
import { ASSISTED_ACTIVATION, applyDirectSaleReview } from "./catalog/review20261108connect";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };

/** Como production: Campaigns «Próximamente» con su ficha de partida; Finance Sync ya con la ficha de la tanda B. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of [...CAMPAIGNS_LISTING_2026_11_08, ...LISTINGS_2026_11_08.filter((x) => x.key === "connect-finance-sync")]) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { headline: "x", cta: "contact", terms: { activation: ASSISTED_ACTIVATION } };
    for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
    const draft = {
      ...d,
      ...(c.thirdPartyCosts ? { thirdPartyCosts: c.thirdPartyCosts.from } : {}),
      technicalStatus: c.technical?.from ?? d.technicalStatus,
      activation: c.activation ? { kind: c.activation.from, ref: null } : d.activation,
      catalog: { ...d.catalog, commercialStatus: c.status?.from ?? d.catalog.commercialStatus },
      commercial,
      internal: { ...d.internal, functionalGrade: c.status ? ("none" as const) : ("in_use" as const) },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  // Finance Sync con la ficha que dejó la tanda B en production
  await applyListingReview(svc, store, { apply: true, author: "operacion:fichas", changes: LISTINGS_2026_11_08.filter((x) => x.key === "connect-finance-sync") });
  return { store, svc };
}

describe("revisión del 08/11/2026: Campaigns y Finance Sync", () => {
  it("Campaigns pasa a implantación acompañada con su ficha (pasa las comprobaciones del CRM) y los costes de Brevo", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: `operacion:${REVIEW_ID_2026_11_08_CAMPAIGNS}`, changes: CAMPAIGNS_LISTING_2026_11_08 });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(1);
    const d = productDraft.parse((await k.store.getEntry("product", "connect-campaigns"))!.draft);
    expect(d).toMatchObject({ technicalStatus: "partial", activation: { kind: "feature" }, catalog: { commercialStatus: "on_request" }, commercial: { cta: "contact" } });
    expect(d.thirdPartyCosts).toMatch(/Brevo/);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === "connect-campaigns")!.offer).toMatchObject({ modality: "assisted", checkout: false });
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: `operacion:${REVIEW_ID_2026_11_08_CAMPAIGNS}`, changes: CAMPAIGNS_LISTING_2026_11_08 });
    expect(again.already).toEqual(["connect-campaigns"]);
  });

  it("Finance Sync: sin Price no abre la venta; con Price, «Disponible» con activación automática y su FAQ al día", async () => {
    const k = await production();
    const none = await applyDirectSaleReview(k.svc, k.store, async () => false, { apply: true, author: "operacion:venta", changes: [FINANCE_SYNC_DIRECT_SALE] });
    expect(none.changed).toEqual([]);
    expect(none.conflicts).toEqual([]);
    expect(none.stripePending.map((p) => p.key)).toEqual(["connect-finance-sync"]);
    const r = await applyDirectSaleReview(k.svc, k.store, async () => true, { apply: true, author: "operacion:venta", changes: [FINANCE_SYNC_DIRECT_SALE] });
    expect(r.conflicts).toEqual([]);
    const d = productDraft.parse((await k.store.getEntry("product", "connect-finance-sync"))!.draft);
    expect(d.catalog.commercialStatus).toBe("available");
    expect(d.commercial?.faq?.find((f) => f.q === "¿Cómo se pone en marcha?")?.a).toMatch(/asistente de puesta en marcha/);
  });
});
