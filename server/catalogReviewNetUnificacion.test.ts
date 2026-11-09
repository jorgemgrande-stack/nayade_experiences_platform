/**
 * Unificación comercial de Elephant Net (09/11/2026): siete soluciones completas con sus funcionalidades incluidas y 19
 * módulos sueltos heredados (sin contrataciones nuevas, conservados para quien los tiene). Sin tocar precios ni licencias.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { NET_UNIFICATION_2026_11_09, REVIEW_ID_2026_11_09_NET_UNIFICATION, applyNetUnification, catalogGuard, guardDiff, type NetUnificationChange } from "./catalog/review20261109netunificacion";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { NET_LEGACY_KEYS, NET_PRODUCTS } from "../shared/netProducts";
import { effectiveOffer } from "./catalog/commercial/offer";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { capabilitiesOf } from "./licensing/service";
import { panelCatalog } from "./commerce/panelCatalog";
import { buildConnectCatalog } from "./connectMarketplace";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_NET_UNIFICATION}`;
const SOLUTIONS = NET_PRODUCTS.map((p) => p.key);

/** Catálogo de partida: la semilla con los valores publicados en production el 09/11/2026 para lo que cambia. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of NET_UNIFICATION_2026_11_09) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { ...(d.commercial ?? { headline: "x", cta: "contact" }) };
    delete commercial.includedFeatures;
    for (const [f, v] of Object.entries(c.fields ?? {})) if (v!.from !== undefined) commercial[f] = v!.from;
    if (c.key === "hotel-net-complete") commercial.cta = "contact";
    const draft = productDraft.parse({
      ...d,
      ...(c.name ? { name: c.name.from } : {}),
      ...(c.description ? { description: c.description.from } : {}),
      ...(c.tagline ? { tagline: c.tagline.from } : {}),
      catalog: { ...d.catalog, ...(c.status ? { commercialStatus: c.status.from } : {}), ...(c.implementationLevel?.from ? { implementationLevel: c.implementationLevel.from } : {}) },
      ...(c.fields ? { commercial } : {}),
    });
    const saved = await svc.save("product", c.key, { draft, expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 09/11/2026: unificación comercial de Elephant Net", () => {
  it("cubre las 7 soluciones y los 19 módulos heredados, cada uno con su solución", () => {
    expect(NET_UNIFICATION_2026_11_09.filter((c) => !c.legacy).map((c) => c.key)).toEqual(SOLUTIONS);
    const legacy = NET_UNIFICATION_2026_11_09.filter((c): c is NetUnificationChange & { legacy: NonNullable<NetUnificationChange["legacy"]> } => !!c.legacy);
    expect(legacy.map((c) => c.key).sort()).toEqual([...NET_LEGACY_KEYS].sort());
    expect(legacy).toHaveLength(19);
    for (const c of legacy) expect(NET_PRODUCTS.find((p) => p.key === c.legacy.replacedBy)?.legacyKeys).toContain(c.key);
    // Solo Hotel Net cambia de estado; ningún cambio toca precios (no existe ese campo en la revisión)
    expect(NET_UNIFICATION_2026_11_09.filter((c) => c.status).map((c) => c.key)).toEqual(["hotel-net-complete"]);
  });

  it("aplica sin conflictos ni cambios fuera de lo previsto, sin tocar precios ni capacidades; repetir no cambia nada", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const guard = await catalogGuard(k.store);
    const before = quoteCatalogFromSite(await k.svc.site("published"));
    const sim = await applyNetUnification(k.svc, k.store, { author: AUTHOR });
    expect(sim.conflicts).toEqual([]);
    expect(sim.changed).toHaveLength(26);
    expect(guardDiff(guard, await catalogGuard(k.store))).toEqual([]);

    const r = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(26);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    expect(guardDiff(guard, await catalogGuard(k.store))).toEqual([]);

    const site = await k.svc.site("published");
    const after = quoteCatalogFromSite(site);
    const byB = new Map(before.products.map((p) => [p.key, p]));
    const byA = new Map(after.products.map((p) => [p.key, p]));
    // Licencias: cada producto (soluciones, módulos y planes) concede exactamente las mismas capacidades
    for (const [key, p] of Array.from(byB)) expect(Array.from(capabilitiesOf(byA.get(key), byA)).sort(), key).toEqual(Array.from(capabilitiesOf(p, byB)).sort());
    // El completo concede todas las capacidades de sus módulos
    for (const np of NET_PRODUCTS.filter((p) => p.legacyKeys.length)) {
      const all = capabilitiesOf(byA.get(np.key), byA);
      for (const m of np.legacyKeys) for (const c of Array.from(capabilitiesOf(byA.get(m), byA))) expect(all.has(c), `${np.key} ⊇ ${m}`).toBe(true);
    }

    for (const np of NET_PRODUCTS) {
      const p = site.catalog.products.find((x) => x.key === np.key) as Record<string, any>;
      // La web calcula lo incluido con `bundleOf`: cada solución lista todos los módulos de su familia
      expect([...p.catalog.bundleOf].sort(), np.key).toEqual([...np.legacyKeys].sort());
      // Sin comparaciones con la compra suelta
      expect(JSON.stringify({ d: p.description, c: p.commercial }), np.key).not.toMatch(/descuento|por separado|submódulos|sueltos/i);
      // La web pública no usa «Próximamente»: el estado real va en includedFeatures[].status
      expect(JSON.stringify({ t: p.tagline, d: p.description, c: { ...p.commercial, includedFeatures: undefined } }), np.key).not.toMatch(/próximamente/i);
      expect(p.name).toBe(np.name);
      expect(p.name).toBe(np.name);
      expect(p.catalog.legacy).toBeUndefined();
      expect(p.commercial.includedFeatures).toEqual(np.areas);
    }
    const hotel = productDraft.parse((await k.store.getEntry("product", "hotel-net-complete"))!.draft);
    expect(hotel.catalog.commercialStatus).toBe("on_request");
    expect(hotel.catalog.implementationLevel).toBe(1);
    expect(JSON.stringify(hotel.commercial)).not.toMatch(/Todavía no/);

    for (const key of NET_LEGACY_KEYS) {
      const p = site.catalog.products.find((x) => x.key === key) as Record<string, any>;
      expect(p, key).toBeDefined();
      expect(p.catalog.legacy?.replacedBy, key).toBe(NET_PRODUCTS.find((n) => n.legacyKeys.includes(key))!.key);
      expect(p.offer.checkout, key).toBe(false);
      expect(p.prices.length, key).toBeGreaterThan(0);
    }

    const again = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toHaveLength(26);
  });

  it("no publica un borrador ajeno ni pisa lo que cambió en el CRM", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "ski-net-complete"))!;
    await k.svc.save("product", "ski-net-complete", { draft: e.draft, expectedVersion: e.draftVersion }, "operator:2");
    const pms = (await k.store.getEntry("product", "hotel-net-pms"))!;
    const d = productDraft.parse(pms.draft);
    const saved = await k.svc.save("product", "hotel-net-pms", { draft: { ...d, catalog: { ...d.catalog, legacy: { replacedBy: "travel-net-complete", since: "2026-11-01" } } }, expectedVersion: pms.draftVersion }, "operator:2");
    await k.svc.publish("product", "hotel-net-pms", saved.draftVersion, "operator:2");
    const r = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts.map((c) => c.split(":")[0]).sort()).toEqual(["hotel-net-pms", "ski-net-complete"]);
  });
});

describe("producto heredado: oferta y panel", () => {
  it("la oferta efectiva de un heredado nunca abre checkout, aunque esté «Disponible» con precio", () => {
    const o = effectiveOffer({ technicalStatus: "available", catalog: { commercialStatus: "available", offer: { modality: "immediate", checkout: true }, legacy: { replacedBy: "social-token-net-complete" } }, prices: [{ status: "approved" }] });
    expect(o.modality).toBe("assisted");
    expect(o.checkout).toBe(false);
    expect(o.reasons.join(" ")).toMatch(/heredado/);
  });

  it("panel: un heredado no es comprable; solo se ve en el marketplace si la empresa lo tiene contratado", async () => {
    const k = await production();
    await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    const site = await k.svc.site("published");
    const products = quoteCatalogFromSite(site).products;
    const active = { state: "active", payment: null, error: null, retryable: false, updatedAt: 1, activeUntil: null, renewal: null, canReactivate: false, nextRetryAt: null };
    const activation = new Map([["social-token-net-communities", active as never]]);
    const cat = panelCatalog(products, { version: "v", purchasesEnabled: true, site, activation, marketplace: { doc: null, plan: "business" } });
    const comm = cat.items.find((i) => i.key === "social-token-net-communities")!;
    expect(comm.purchasable).toBe(false);
    expect(comm.legacy).toEqual({ replacedBy: "social-token-net-complete" });
    const items = buildConnectCatalog(cat as never, [{ capabilityId: "social-token-net", status: "active", validUntil: null } as never], 1, "business");
    const shown = items.map((i) => i.key);
    expect(shown).toContain("social-token-net-communities");
    expect(shown).not.toContain("social-token-net-tokens");
    expect(shown).not.toContain("hotel-net-pms");
    const kept = items.find((i) => i.key === "social-token-net-communities")!;
    expect(kept.purchasable).toBe(false);
    expect(kept.legacy?.replacedBy?.key).toBe("social-token-net-complete");
    expect(kept.reasons.join(" ")).toMatch(/Producto heredado/);
    const hotel = items.find((i) => i.key === "hotel-net-complete")!;
    expect(hotel.net?.areas.map((a) => a.title)).toEqual(NET_PRODUCTS.find((p) => p.key === "hotel-net-complete")!.areas.map((a) => a.title));
  });
});
