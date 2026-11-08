/**
 * Revisión del catálogo del 08/11/2026 (activación del marketplace, tanda B): fichas de GEO Control, Contratos y
 * Finance Sync. Las fichas nuevas pasan las mismas comprobaciones que «Publicar» en el CRM.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { LISTINGS_2026_11_08, REVIEW_ID_2026_11_08_FICHAS, applyListingReview } from "./catalog/review20261108fichas";
import { DIRECT_SALE_2026_11_08, applyDirectSaleReview } from "./catalog/review20261108connect";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_08_FICHAS}`;
const KEYS = ["connect-geo-control", "extra-contracts-esign", "connect-finance-sync"];

/** Como production el 08/11/2026: las tres fichas publicadas con sus textos y estados de partida. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of LISTINGS_2026_11_08) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { headline: "x", cta: "contact" };
    for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
    const draft = {
      ...d,
      technicalStatus: c.technical?.from ?? d.technicalStatus,
      activation: c.activation ? { kind: c.activation.from, ref: null } : d.activation,
      catalog: { ...d.catalog, commercialStatus: c.status?.from ?? d.catalog.commercialStatus },
      commercial,
      internal: { ...d.internal, functionalGrade: c.status ? ("none" as const) : ("in_use" as const) },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 08/11/2026: fichas de GEO Control, Contratos y Finance Sync", () => {
  it("publica las fichas nuevas (pasan las comprobaciones del CRM) sin tocar precios; repetir no cambia nada", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR });
    expect(sim.conflicts).toEqual([]);
    expect(sim.changed).toHaveLength(3);
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const key of KEYS) {
      const e = (await k.store.getEntry("product", key))!;
      expect(e.publishedVersion, key).toBe(e.draftVersion);
      expect(e.publishedBy, key).toBe(AUTHOR);
    }
    const geo = productDraft.parse((await k.store.getEntry("product", "connect-geo-control"))!.draft);
    expect(geo).toMatchObject({ technicalStatus: "partial", activation: { kind: "feature" }, catalog: { commercialStatus: "on_request" }, commercial: { cta: "contact" } });
    expect(geo.commercial?.headline).not.toMatch(/Próximamente/);
    const esign = productDraft.parse((await k.store.getEntry("product", "extra-contracts-esign"))!.draft);
    expect(esign.catalog).toMatchObject({ commercialStatus: "on_request", stripePrepared: true });
    expect(esign.commercial?.excludes.join(" ")).toMatch(/avanzada o cualificada/);
    const fs = productDraft.parse((await k.store.getEntry("product", "connect-finance-sync"))!.draft);
    expect(fs.catalog.commercialStatus).toBe("on_request");
    expect(fs.commercial?.integrations).toEqual(["Cualquier banco (Norma 43, Excel o CSV)", "Datáfono Comercia (Excel o correo)"]);
    // Asistida en la web y en el cotizador
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    for (const key of KEYS) expect(cat.products.find((p) => p.key === key)!.offer, key).toMatchObject({ modality: "assisted", checkout: false });
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toEqual(KEYS);
  });

  it("después, la venta directa de GEO Control y Contratos parte de estas fichas (con su Price de Stripe)", async () => {
    const k = await production();
    await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR });
    const two = DIRECT_SALE_2026_11_08.filter((c) => c.key === "connect-geo-control" || c.key === "extra-contracts-esign");
    const r = await applyDirectSaleReview(k.svc, k.store, async () => true, { apply: true, author: "operacion:venta", changes: two });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(2);
    for (const c of two) {
      const d = productDraft.parse((await k.store.getEntry("product", c.key))!.draft);
      expect(d.catalog.commercialStatus, c.key).toBe("available");
      expect(d.commercial?.faq?.[0].a, c.key).toMatch(/se activa automáticamente/);
    }
  });

  it("respeta un texto o un estado decidido en el CRM", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "connect-geo-control"))!;
    const d = productDraft.parse(e.draft);
    const s = await k.svc.save("product", "connect-geo-control", { draft: { ...d, commercial: { ...d.commercial!, headline: "Otro titular del CRM" } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "connect-geo-control", s.draftVersion, "operator:1");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts.some((c) => c.startsWith("connect-geo-control:") && c.includes("«headline»"))).toBe(true);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-geo-control"))!.draft).catalog.commercialStatus).toBe("coming_soon");
    expect(r.changed.map((c) => c.split(":")[0])).toEqual(["extra-contracts-esign", "connect-finance-sync"]);
  });
});
