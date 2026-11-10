/**
 * Revisión del 10/11/2026: Social Token Net por empresa (`catalog.scope` de «site» a «company») y su descripción larga
 * sin «paquete». Sin tocar precios, licencias, estados ni la oferta.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { REVIEW_ID_2026_11_10_STN, STN_SCOPE_2026_11_10, applyStnScopeReview } from "./catalog/review20261110stn";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { capabilitiesOf } from "./licensing/service";
import { PRODUCTS } from "./catalog/elephantSourceV1";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_10_STN}`;
const PRODUCTO_STN = STN_SCOPE_2026_11_10.key;

/** Catálogo de partida: la semilla con Social Token Net como estaba publicado en production el 10/11/2026. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  const e = (await store.getEntry("product", PRODUCTO_STN))!;
  const d = productDraft.parse(e.draft);
  const draft = productDraft.parse({ ...d, catalog: { ...d.catalog, scope: "site" }, commercial: { ...d.commercial!, longDescription: STN_SCOPE_2026_11_10.longDescription.from } });
  const saved = await svc.save("product", PRODUCTO_STN, { draft, expectedVersion: e.draftVersion }, "operator:1");
  await svc.publish("product", PRODUCTO_STN, saved.draftVersion, "operator:1");
  return { store, svc };
}

const stn = async (store: MemoryWebStore) => productDraft.parse((await store.getEntry("product", PRODUCTO_STN))!.draft);

describe("revisión del 10/11/2026: Social Token Net por empresa", () => {
  it("la semilla ya lo declara por empresa, como sus módulos heredados, y sin «paquete»", () => {
    const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
    expect(byKey.get(PRODUCTO_STN)?.draft.catalog.scope).toBe("company");
    for (const k of ["social-token-net-communities", "social-token-net-tokens"]) expect(byKey.get(k)?.draft.catalog.scope).toBe("company");
    // Las demás soluciones Net siguen como estaban
    expect(byKey.get("hotel-net-complete")?.draft.catalog.scope).toBe("site");
    expect(STN_SCOPE_2026_11_10.longDescription.to).not.toMatch(/paquete|por separado|suelt/i);
  });

  it("simula y aplica solo el ámbito y la descripción larga, sin tocar precios ni capacidades; repetir no cambia nada", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = await stn(k.store);
    const capsBefore = quoteCatalogFromSite(await k.svc.site("published"));

    const sim = await applyStnScopeReview(k.svc, k.store, { author: AUTHOR });
    expect(sim).toMatchObject({ apply: false, conflicts: [], already: [] });
    expect(sim.changed).toEqual([`${PRODUCTO_STN}: ámbito site → company; ficha (longDescription)`]);
    expect((await stn(k.store)).catalog.scope).toBe("site");

    const r = await applyStnScopeReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(1);
    const after = await stn(k.store);
    expect(after.catalog.scope).toBe("company");
    expect(after.commercial?.longDescription).toBe(STN_SCOPE_2026_11_10.longDescription.to);
    // Nada más cambia: ni precios, ni estado, ni oferta, ni el resto de la ficha
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    expect({ ...after.catalog, scope: "site" }).toEqual(before.catalog);
    expect({ ...after.commercial, longDescription: before.commercial?.longDescription }).toEqual(before.commercial);
    const e = (await k.store.getEntry("product", PRODUCTO_STN))!;
    expect(e.publishedVersion).toBe(e.draftVersion);
    const capsAfter = quoteCatalogFromSite(await k.svc.site("published"));
    const byB = new Map(capsBefore.products.map((p) => [p.key, p]));
    const byA = new Map(capsAfter.products.map((p) => [p.key, p]));
    for (const [key, p] of Array.from(byB)) expect(Array.from(capabilitiesOf(byA.get(key), byA)).sort(), key).toEqual(Array.from(capabilitiesOf(p, byB)).sort());
    expect(byA.get(PRODUCTO_STN)?.scope).toBe("company");

    const again = await applyStnScopeReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(again).toMatchObject({ changed: [], conflicts: [], already: [PRODUCTO_STN] });
  });

  it("respeta un borrador ajeno y un texto cambiado desde el CRM", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", PRODUCTO_STN))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", PRODUCTO_STN, { draft: { ...d, tagline: "Borrador del operador" }, expectedVersion: e.draftVersion }, "operator:2");
    const r = await applyStnScopeReview(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.changed).toEqual([]);
    expect(r.conflicts[0]).toMatch(/borrador ajeno/);
    expect((await stn(k.store)).catalog.scope).toBe("site");

    const k2 = await production();
    const e2 = (await k2.store.getEntry("product", PRODUCTO_STN))!;
    const d2 = productDraft.parse(e2.draft);
    const saved = await k2.svc.save("product", PRODUCTO_STN, { draft: { ...d2, commercial: { ...d2.commercial!, longDescription: "Texto del CRM" } }, expectedVersion: e2.draftVersion }, "operator:2");
    await k2.svc.publish("product", PRODUCTO_STN, saved.draftVersion, "operator:2");
    const r2 = await applyStnScopeReview(k2.svc, k2.store, { apply: true, author: AUTHOR });
    expect(r2.changed).toEqual([]);
    expect(r2.conflicts[0]).toMatch(/descripción larga/);
  });
});
