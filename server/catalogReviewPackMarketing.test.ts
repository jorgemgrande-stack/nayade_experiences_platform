/**
 * Revisión del catálogo del 09/11/2026: Paquete Marketing a implantación acompañada con su ficha real (sin checkout ni
 * Price de Stripe: `stripePrepared: false`). PREPARADA, no lanzada: la lanza el coordinador con `catalog-review`.
 *
 * Imprime la simulación (qué productos y qué campos cambian) para el informe.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { PACK_MARKETING_COMPONENTS, PACK_MARKETING_KEY, PACK_MARKETING_LISTING_2026_11_09, REVIEW_ID_2026_11_09_PACK_MARKETING } from "./catalog/review20261109packmarketing";
import { commercialChecks } from "./catalog/commercial/checks";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_PACK_MARKETING}`;
const KEYS = [PACK_MARKETING_KEY];
/** Componentes como en production el 09/11/2026 (https://admin.bigelephant.es/cp/v1/public/site). */
const COMPONENTS_TODAY: Record<string, { status: "on_request" | "available"; technical: "partial" | "available" }> = {
  "connect-ads-manager": { status: "on_request", technical: "partial" },
  "connect-campaigns": { status: "on_request", technical: "partial" },
  "connect-seo-control": { status: "on_request", technical: "partial" },
  "connect-geo-control": { status: "available", technical: "available" },
};

/** Como production el 09/11/2026: el paquete «Próximamente» con su ficha de partida y sus componentes ya contratables. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const [key, st] of Object.entries(COMPONENTS_TODAY)) {
    const e = (await store.getEntry("product", key))!;
    const d = productDraft.parse(e.draft);
    const draft = { ...d, technicalStatus: st.technical, activation: { kind: "feature" as const, ref: null }, catalog: { ...d.catalog, commercialStatus: st.status }, commercial: { ...(d.commercial ?? {}), cta: "contact" as const, headline: `${d.name}.` }, internal: { ...d.internal, functionalGrade: "in_use" as const } };
    const saved = await svc.save("product", key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", key, saved.draftVersion, "operator:1");
  }
  for (const c of PACK_MARKETING_LISTING_2026_11_09) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { ...(d.commercial ?? {}), headline: "x", cta: "contact" };
    for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
    const draft = {
      ...d,
      thirdPartyCosts: c.thirdPartyCosts!.from,
      technicalStatus: c.technical!.from,
      activation: { kind: c.activation!.from, ref: null },
      catalog: { ...d.catalog, commercialStatus: c.status!.from, implementationLevel: 2 as const },
      commercial,
      internal: { ...d.internal, functionalGrade: "partial" as const },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

const checkEntries = async (store: MemoryWebStore) => (await store.listEntries({ kind: "product" })).map((e) => ({ key: e.key, family: e.family, publication: e.publication, draft: productDraft.parse(e.draft) }));

describe("revisión del 09/11/2026: Paquete Marketing (preparada)", () => {
  it("simulación: solo cambia el Paquete Marketing (estado, técnico, activación y ficha), sin tocar precios ni otros productos", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, e.draftVersion]));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: PACK_MARKETING_LISTING_2026_11_09 });
    // Salida de la simulación (para el informe del coordinador)
    console.log(`SIMULACION ${REVIEW_ID_2026_11_09_PACK_MARKETING}: ${JSON.stringify(sim)}`);
    expect(sim).toMatchObject({ apply: false, already: [], conflicts: [] });
    expect(sim.changed).toEqual([
      "connect-pack-marketing: coming_soon → on_request; ficha (cta, headline, longDescription, valueProposition, benefits, excludes, integrations, seo, terms, faq)",
    ]);
    // La simulación no escribe nada
    for (const e of await k.store.listEntries({ kind: "product" })) expect(e.draftVersion, e.key).toBe(before.get(e.key));

    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: PACK_MARKETING_LISTING_2026_11_09 });
    expect(r.conflicts).toEqual([]);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) if (!KEYS.includes(e.key)) expect(e.draftVersion, e.key).toBe(before.get(e.key));

    const d = productDraft.parse((await k.store.getEntry("product", PACK_MARKETING_KEY))!.draft);
    expect(d).toMatchObject({ technicalStatus: "partial", activation: { kind: "feature" }, catalog: { commercialStatus: "on_request", stripePrepared: false, implementationLevel: 2 }, commercial: { cta: "contact" }, internal: { functionalGrade: "in_use" } });
    expect(d.catalog.bundleOf).toEqual([...PACK_MARKETING_COMPONENTS]);
    const pub = [d.commercial!.headline, d.commercial!.longDescription, d.commercial!.valueProposition ?? "", d.commercial!.seo!.description, d.commercial!.terms?.activation ?? "", ...(d.commercial!.faq ?? []).flatMap((f) => [f.q, f.a])];
    for (const t of pub) expect(t).not.toMatch(/Próximamente|próximamente|todavía no/i);
    expect(d.commercial!.faq![0].q).toBe("¿Cómo se pone en marcha?");
    expect(d.commercial!.integrations.join(" ")).toMatch(/Brevo/);
    expect(d.commercial!.integrations.join(" ")).toMatch(/CSV/);
    expect(d.commercial!.integrations.join(" ")).toMatch(/Search Console/);
    expect(d.commercial!.integrations.join(" ")).toMatch(/TripAdvisor/);
    expect(d.commercial!.integrations.join(" ")).toMatch(/IA/);

    // Pasa las comprobaciones del CRM (sin bloqueos) y la regla de paquetes: todos sus componentes se contratan
    const all = await checkEntries(k.store);
    expect(commercialChecks(all.find((e) => e.key === PACK_MARKETING_KEY)!, all).blocking).toEqual([]);
    for (const c of PACK_MARKETING_COMPONENTS) expect(["on_request", "available"], c).toContain(all.find((e) => e.key === c)!.draft.catalog.commercialStatus);

    // Sin checkout: implantación asistida en la web y el cotizador
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === PACK_MARKETING_KEY)!.offer).toMatchObject({ modality: "assisted", checkout: false });

    // Idempotente
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: PACK_MARKETING_LISTING_2026_11_09 });
    expect(again).toMatchObject({ changed: [], already: KEYS, conflicts: [] });
  });

  it("no pisa un borrador ajeno ni una ficha cambiada desde el CRM", async () => {
    const k = await production();
    // Borrador ajeno sin publicar
    const e = (await k.store.getEntry("product", PACK_MARKETING_KEY))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", PACK_MARKETING_KEY, { draft: productDraft.parse({ ...d, commercial: { ...d.commercial, problem: "Cambio de otra persona" } }), expectedVersion: e.draftVersion }, "operator:2");
    const v = (await k.store.getEntry("product", PACK_MARKETING_KEY))!.draftVersion;
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: PACK_MARKETING_LISTING_2026_11_09 });
    expect(r.changed).toEqual([]);
    expect(r.conflicts.join(" ")).toMatch(/cambios sin publicar/);
    expect((await k.store.getEntry("product", PACK_MARKETING_KEY))!.draftVersion).toBe(v);

    // Titular publicado distinto del de partida: conflicto, no se toca
    const k2 = await production();
    const e2 = (await k2.store.getEntry("product", PACK_MARKETING_KEY))!;
    const d2 = productDraft.parse(e2.draft);
    const s2 = await k2.svc.save("product", PACK_MARKETING_KEY, { draft: productDraft.parse({ ...d2, commercial: { ...d2.commercial, headline: "Próximamente: otro titular decidido en el CRM." } }), expectedVersion: e2.draftVersion }, "operator:2");
    await k2.svc.publish("product", PACK_MARKETING_KEY, s2.draftVersion, "operator:2");
    const r2 = await applyListingReview(k2.svc, k2.store, { apply: true, author: AUTHOR, changes: PACK_MARKETING_LISTING_2026_11_09 });
    expect(r2.changed).toEqual([]);
    expect(r2.conflicts.join(" ")).toMatch(/headline/);
  });

  it("la especificación comercial del paquete dice lo mismo que la ficha nueva (sin «Próximamente»)", () => {
    const s = PRODUCT_SPECS.find((x) => x.key === PACK_MARKETING_KEY)!;
    const c = PACK_MARKETING_LISTING_2026_11_09[0];
    expect(s.publicContent).toMatchObject({ headline: c.fields.headline!.to, cta: "contact" });
    expect(s.seo).toEqual(c.fields.seo!.to);
    // Lo mismo que la ficha que publica la revisión (el importador de fichas no la deshace)
    expect(s.longDescription).toBe(c.fields.longDescription!.to);
    expect(s.publicContent.benefits).toEqual(c.fields.benefits!.to);
    expect(s.excludes).toEqual(c.fields.excludes!.to);
    expect(s.integrations).toEqual(c.fields.integrations!.to);
    expect(s.verified.grade).toBe("in_use");
    for (const t of [s.publicContent.headline, s.seo.description, s.verified.evidence, ...s.implementation.requirements]) expect(t).not.toMatch(/Próximamente|Skicenter/i);
  });
});
