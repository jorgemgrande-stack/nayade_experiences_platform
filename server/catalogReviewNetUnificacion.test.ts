/**
 * Unificación comercial de Elephant Net (09/11/2026): siete soluciones completas con sus funcionalidades incluidas y 19
 * módulos sueltos heredados (sin contrataciones nuevas, conservados para quien los tiene). Sin tocar precios ni licencias.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { beforeNetUnification } from "./catalog/seedHistory.testkit";
import { NET_UNIFICATION_2026_11_09, PUBLISH_FOREIGN_DRAFT, REVIEW_ID_2026_11_09_NET_UNIFICATION, applyNetUnification, catalogGuard, coreIncludedTexts, guardDiff, type ForeignDraftAuthorization, type NetUnificationChange } from "./catalog/review20261109netunificacion";
import { RETIRED_NET_CORE_INCLUDED } from "./catalog/commercial/policy";
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
  await seedElephantSource(svc, store, { products: beforeNetUnification() });
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

  it("un borrador ajeno sin cambios no estorba; lo que cambió en el CRM no se pisa", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "ski-net-complete"))!;
    await k.svc.save("product", "ski-net-complete", { draft: e.draft, expectedVersion: e.draftVersion }, "operator:2");
    const pms = (await k.store.getEntry("product", "hotel-net-pms"))!;
    const d = productDraft.parse(pms.draft);
    const saved = await k.svc.save("product", "hotel-net-pms", { draft: { ...d, catalog: { ...d.catalog, legacy: { replacedBy: "travel-net-complete", since: "2026-11-01" } } }, expectedVersion: pms.draftVersion }, "operator:2");
    await k.svc.publish("product", "hotel-net-pms", saved.draftVersion, "operator:2");
    const r = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts.map((c) => c.split(":")[0]).sort()).toEqual(["hotel-net-pms"]);
    // El borrador ajeno de Ski Net era idéntico a lo publicado: la unificación se publica y no queda borrador pendiente
    const ski = (await k.store.getEntry("product", "ski-net-complete"))!;
    expect(ski.publishedVersion).toBe(ski.draftVersion);
    expect((ski.published as { name: string }).name).toBe("Ski Net");
  });
});

/**
 * Borrador ajeno (10/11/2026). El de Hotel Net en production (v10 sobre la v8 publicada) lo dejaron la importación de
 * fichas y la revisión del 07/11: estado, nivel, «Core incluido», SEO, problema, integraciones y descripción larga.
 */
const IMPORTER = "catalogo:especificaciones-comerciales";
const HOTEL = "hotel-net-complete";
const DRAFT_LONG = "Un solo producto para tu alojamiento: PMS, motor de reservas y housekeeping. El Channel Manager llegará próximamente, incluido sin coste adicional.";
const DRAFT_PROBLEM = "Un alojamiento necesita gestión, venta directa, recepción y limpieza en un solo sistema.";
/** Autorización de Hotel Net en cada catálogo de prueba: ligada a la versión de su primer borrador (en production, v10 sobre v8). */
const AUTH = new WeakMap<object, ForeignDraftAuthorization[]>();
async function withDraft(k: Awaited<ReturnType<typeof production>>, key: string, change: (d: ReturnType<typeof productDraft.parse>) => unknown, author = IMPORTER) {
  const e = (await k.store.getEntry("product", key))!;
  const saved = await k.svc.save("product", key, { draft: change(productDraft.parse(e.draft)), expectedVersion: e.draftVersion }, author);
  if (key === HOTEL && !AUTH.has(k)) AUTH.set(k, [{ key, borradorVersion: saved.draftVersion, versionPublicada: saved.publishedVersion!, nota: "prueba" }]);
  return saved;
}
/** El borrador v10 de Hotel Net, con los campos que tiene en production. */
const hotelV10 = (d: ReturnType<typeof productDraft.parse>, extra: Record<string, unknown> = {}) => ({
  ...d,
  catalog: { ...d.catalog, commercialStatus: "on_request", implementationLevel: 1, coreIncluded: RETIRED_NET_CORE_INCLUDED[HOTEL] },
  commercial: { ...d.commercial, problem: DRAFT_PROBLEM, integrations: ["Pasarela de pago del alojamiento"], longDescription: DRAFT_LONG, ...extra },
  internal: { ...d.internal, evidence: "Importado de las especificaciones comerciales.", sources: ["F-HOTEL-1"] },
});
const entry = async (k: Awaited<ReturnType<typeof production>>, key: string) => (await k.store.getEntry("product", key))!;

describe("unificación sobre un borrador ajeno", () => {
  it("Hotel Net: publica la unificación con los cambios del borrador, retira «Core incluido» y no deja borrador pendiente; repetir no cambia nada", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const guard = await catalogGuard(k.store);
    const before = await entry(k, HOTEL);
    await withDraft(k, HOTEL, (d) => hotelV10(d));
    const pending = await entry(k, HOTEL);
    expect(pending.publishedVersion).toBe(before.draftVersion);

    // Simulación: no escribe nada y enseña el diff campo a campo con su origen
    const sim = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], author: AUTHOR });
    expect(sim.conflicts).toEqual([]);
    expect((await entry(k, HOTEL)).draftVersion).toBe(pending.draftVersion);
    const rep = sim.borradores.find((b) => b.key === HOTEL)!;
    expect(rep.borrador).toMatchObject({ version: pending.draftVersion, versionPublicada: before.draftVersion, autor: IMPORTER });
    const origin = Object.fromEntries(rep.diff.map((x) => [x.campo, x.origen]));
    expect(origin).toMatchObject({
      name: "revisión",
      "catalog.commercialStatus": "ambos",
      "catalog.implementationLevel": "ambos",
      "commercial.problem": "borrador",
      "commercial.integrations": "borrador",
      "commercial.includedFeatures": "revisión",
      "commercial.faq": "revisión",
      "commercial.terms.activation": "revisión",
      "internal.sources": "borrador",
      "internal.evidence": "ambos (nota interna: se conservan las dos)",
    });
    // La descripción larga la cambian los dos: manda la unificación porque el borrador dice «próximamente»
    expect(origin["commercial.longDescription"]).toMatch(/^revisión \(el texto del borrador dice «próximamente»/);
    expect(rep.diff.find((x) => x.campo === "commercial.problem")).toMatchObject({ resultado: DRAFT_PROBLEM });
    expect(rep.enDisputa).toEqual([]);
    expect(rep.retenido).toEqual([]);
    expect(rep.retirado.map((x) => x.campo)).toEqual(["catalog.coreIncluded"]);
    expect(sim.anunciaCore).toEqual([`${HOTEL} (borrador) catalog.coreIncluded`]);

    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.changed.find((x) => x.startsWith(HOTEL))).toMatch(/no queda borrador pendiente/);
    const after = await entry(k, HOTEL);
    expect(after.publishedVersion).toBe(after.draftVersion);
    expect(after.updatedBy).toBe(AUTHOR);
    const pub = after.published as Record<string, any>;
    expect(pub.name).toBe("Hotel Net");
    expect(pub.catalog.commercialStatus).toBe("on_request");
    expect(pub.catalog.implementationLevel).toBe(1);
    expect(pub.catalog.coreIncluded).toBeUndefined();
    expect(pub.commercial.problem).toBe(DRAFT_PROBLEM);
    expect(pub.commercial.integrations).toEqual(["Pasarela de pago del alojamiento"]);
    expect(pub.commercial.longDescription).toMatch(/^La solución completa para hoteles/);
    expect(JSON.stringify({ ...pub.commercial, includedFeatures: undefined })).not.toMatch(/próximamente|Todavía no/i);
    const draft = productDraft.parse(after.draft);
    expect(draft.catalog.coreIncluded).toBeUndefined();
    expect(draft.internal.sources).toEqual(["F-HOTEL-1"]);
    expect(draft.internal.evidence).toMatch(/^Importado de las especificaciones comerciales\. · Unificación comercial/);
    // Sin tocar precios, licencias, componentes ni otros productos
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    expect(guardDiff(guard, await catalogGuard(k.store))).toEqual([]);
    expect(r.anunciaCore).toEqual([]);

    const again = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.conflicts).toEqual([]);
    expect(again.already).toHaveLength(26);
    expect(again.borradores).toEqual([]);
    expect((await entry(k, HOTEL)).draftVersion).toBe(after.draftVersion);
  });

  it("campo en disputa: no se guarda ni se publica nada hasta que haya una decisión sobre esa versión del borrador", async () => {
    const k = await production();
    const faq = [{ q: "¿Qué incluye?", a: "PMS, motor de reservas y housekeeping, con el alta guiada por nuestro equipo." }];
    await withDraft(k, HOTEL, (d) => hotelV10(d, { faq }));
    const pending = await entry(k, HOTEL);
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^hotel-net-complete: 1 campo\(s\) en disputa \(commercial\.faq\); el borrador v\d+ queda intacto/);
    const rep = r.borradores.find((b) => b.key === HOTEL)!;
    expect(rep.enDisputa).toHaveLength(1);
    expect(rep.enDisputa[0]).toMatchObject({ campo: "commercial.faq", borrador: faq });
    expect((rep.enDisputa[0].publicado as unknown[]).length).toBe(4);
    expect((rep.enDisputa[0].revision as Array<{ q: string }>)[0].q).toBe("¿Qué incluye?");
    const untouched = await entry(k, HOTEL);
    expect(untouched.draftVersion).toBe(pending.draftVersion);
    expect(untouched.publishedVersion).toBe(pending.publishedVersion);
    expect(untouched.updatedBy).toBe(IMPORTER);
    // Los otros 25 cambios no dependen de Hotel
    expect(r.changed).toHaveLength(25);

    // Una decisión tomada sobre otra versión del borrador no vale
    const stale = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR, decisions: [{ key: HOTEL, campo: "commercial.faq", gana: "borrador", borradorVersion: pending.draftVersion - 1, nota: "Jorge, 10/11/2026" }] });
    expect(stale.conflicts[0]).toMatch(/en disputa/);
    expect(stale.borradores[0].decisionesIgnoradas[0]).toMatch(/se tomó sobre el borrador v/);
    expect((await entry(k, HOTEL)).draftVersion).toBe(pending.draftVersion);

    // Con la decisión sobre esta versión, manda lo decidido (aquí, el borrador)
    const ok = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR, decisions: [{ key: HOTEL, campo: "commercial.faq", gana: "borrador", borradorVersion: pending.draftVersion, nota: "Jorge, 10/11/2026" }] });
    expect(ok.conflicts).toEqual([]);
    expect(ok.borradores[0].decisionesAplicadas).toEqual(["commercial.faq: borrador (Jorge, 10/11/2026)"]);
    const after = await entry(k, HOTEL);
    expect(after.publishedVersion).toBe(after.draftVersion);
    expect((after.published as Record<string, any>).commercial.faq).toEqual(faq);
    expect((after.published as Record<string, any>).name).toBe("Hotel Net");
    // Y la siguiente ejecución lo respeta: figura como conflicto con lo decidido en el CRM, sin tocarlo
    const again = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.conflicts).toEqual(["hotel-net-complete: el campo «faq» de la ficha ya no es el de partida; se deja como lo decidió el CRM"]);
    expect(((await entry(k, HOTEL)).published as Record<string, any>).commercial.faq).toEqual(faq);
  });

  it("un cambio del borrador en el modelo del catálogo no se publica: queda retenido en el borrador", async () => {
    const k = await production();
    await withDraft(k, HOTEL, (d) => ({ ...hotelV10(d), catalog: { ...(hotelV10(d).catalog as object), chargeUnit: "por alojamiento" } }));
    const guard = await catalogGuard(k.store);
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.borradores[0].retenido).toEqual([{ campo: "catalog.chargeUnit", publicado: null, borrador: "por alojamiento" }]);
    const after = await entry(k, HOTEL);
    expect((after.published as Record<string, any>).catalog.chargeUnit ?? null).toBeNull();
    expect((after.published as Record<string, any>).commercial.problem).toBe(DRAFT_PROBLEM);
    expect(after.publishedVersion).toBe(after.draftVersion - 1);
    expect(productDraft.parse(after.draft).catalog.chargeUnit).toBe("por alojamiento");
    expect(productDraft.parse(after.draft).catalog.coreIncluded).toBeUndefined();
    expect(guardDiff(guard, await catalogGuard(k.store))).toEqual([]);
    const again = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toContain(HOTEL);
    expect(again.borradores[0].retenido.map((x) => x.campo)).toEqual(["catalog.chargeUnit"]);
    expect((await entry(k, HOTEL)).draftVersion).toBe(after.draftVersion);
  });

  it("otra solución con borrador ajeno: se publica solo la unificación; los cambios del borrador siguen pendientes y «Core incluido» se retira", async () => {
    const k = await production();
    const KEY = "restaurant-net-complete";
    await withDraft(k, KEY, (d) => ({ ...d, catalog: { ...d.catalog, coreIncluded: RETIRED_NET_CORE_INCLUDED[KEY] }, commercial: { ...d.commercial, problem: "Texto del operador sin publicar." } }), "operator:2");
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    const rep = r.borradores.find((b) => b.key === KEY)!;
    expect(rep.retenido.map((x) => x.campo)).toEqual(["commercial.problem"]);
    expect(rep.retirado.length).toBeGreaterThan(0);
    const after = await entry(k, KEY);
    const pub = after.published as Record<string, any>;
    expect(pub.name).toBe("Restaurant Net");
    expect(pub.commercial.problem).not.toBe("Texto del operador sin publicar.");
    // El borrador sigue pendiente, con su cambio y con la unificación, y ya sin «Core incluido»
    expect(after.draftVersion).toBe(after.publishedVersion! + 1);
    const draft = productDraft.parse(after.draft);
    expect(draft.commercial?.problem).toBe("Texto del operador sin publicar.");
    expect(draft.name).toBe("Restaurant Net");
    expect(draft.catalog.coreIncluded).toBeUndefined();
    expect(r.anunciaCore).toEqual([]);
    const again = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toHaveLength(26);
    expect((await entry(k, KEY)).draftVersion).toBe(after.draftVersion);
  });

  it("sin borrador pendiente: «Core incluido» se retira de la versión publicada sin cambiar lo que ve el público", async () => {
    const k = await production();
    const KEY = "restaurant-net-complete";
    const saved = await withDraft(k, KEY, (d) => ({ ...d, catalog: { ...d.catalog, coreIncluded: RETIRED_NET_CORE_INCLUDED[KEY] } }), "operator:1");
    await k.svc.publish("product", KEY, saved.draftVersion, "operator:1");
    await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR, changes: NET_UNIFICATION_2026_11_09.map((c) => ({ ...c, dropCoreIncluded: false })) });
    const unified = await entry(k, KEY);
    expect(productDraft.parse(unified.draft).catalog.coreIncluded).toBeDefined();
    const sim = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], author: AUTHOR });
    expect(sim.changed).toEqual([`${KEY}: se retira catalog.coreIncluded (Core y Net se contratan por separado)`]);
    expect(sim.anunciaCore).toEqual([`${KEY} (borrador) catalog.coreIncluded`]);
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.anunciaCore).toEqual([]);
    const after = await entry(k, KEY);
    expect(after.publishedVersion).toBe(after.draftVersion);
    expect(productDraft.parse(after.draft).catalog.coreIncluded).toBeUndefined();
    expect(after.published).toEqual(unified.published);
  });

  it("una ejecución interrumpida se retoma sin perder lo retenido ni publicarlo", async () => {
    const k = await production();
    const KEY = "ski-net-complete";
    await withDraft(k, KEY, (d) => ({ ...d, commercial: { ...d.commercial, problem: "Texto del operador sin publicar." } }), "operator:2");
    const real = k.svc.republishVersion.bind(k.svc);
    k.svc.republishVersion = async () => {
      throw new Error("corte");
    };
    const cut = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(cut.conflicts).toEqual([`${KEY}: no se pudo guardar o publicar (corte); se revisa en el CRM`]);
    const mid = await entry(k, KEY);
    expect((mid.published as { name: string }).name).toBe("Ski Net Complete");
    expect(productDraft.parse(mid.draft).commercial?.problem).toBe("Texto del operador sin publicar.");
    k.svc.republishVersion = real;
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.borradores[0].borrador.autor).toBe("operator:2");
    const after = await entry(k, KEY);
    const pub = after.published as Record<string, any>;
    expect(pub.name).toBe("Ski Net");
    expect(pub.commercial.problem).not.toBe("Texto del operador sin publicar.");
    expect(productDraft.parse(after.draft).commercial?.problem).toBe("Texto del operador sin publicar.");
    expect(productDraft.parse(after.draft).name).toBe("Ski Net");
    const again = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect((await entry(k, KEY)).draftVersion).toBe(after.draftVersion);
  });

  it("la autorización de Hotel Net vale solo para ese borrador: uno posterior no se publica (queda retenido)", async () => {
    expect(PUBLISH_FOREIGN_DRAFT).toEqual([expect.objectContaining({ key: HOTEL, borradorVersion: 10, versionPublicada: 8 })]);
    const k = await production();
    await withDraft(k, HOTEL, (d) => hotelV10(d));
    await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    const done = await entry(k, HOTEL);
    expect(done.publishedVersion).toBe(done.draftVersion);
    // Un operador deja después un borrador a medias
    await withDraft(k, HOTEL, (d) => ({ ...d, name: "Hotel Net PRUEBA", includes: ["Prueba"], commercial: { ...d.commercial, headline: "Titular de prueba" } }), "operator:9");
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.changed).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.already).toContain(HOTEL);
    expect(r.borradores[0].retenido.map((x) => x.campo).sort()).toEqual(["commercial.headline", "includes", "name"]);
    const after = await entry(k, HOTEL);
    expect((after.published as { name: string }).name).toBe("Hotel Net");
    expect(after.publishedVersion).toBe(done.publishedVersion);
    expect(after.updatedBy).toBe("operator:9");
    // Y sin autorización (la de production es para v10 sobre v8), el primer borrador tampoco se publica
    const k2 = await production();
    await withDraft(k2, HOTEL, (d) => hotelV10(d));
    const r2 = await applyNetUnification(k2.svc, k2.store, { apply: true, author: AUTHOR });
    expect(r2.conflicts).toEqual([]);
    const h2 = await entry(k2, HOTEL);
    expect((h2.published as Record<string, any>).name).toBe("Hotel Net");
    expect((h2.published as Record<string, any>).commercial.problem).not.toBe(DRAFT_PROBLEM);
    expect(productDraft.parse(h2.draft).commercial?.problem).toBe(DRAFT_PROBLEM);
    expect(productDraft.parse(h2.draft).catalog.coreIncluded).toBeUndefined();
  });

  it("un objeto que el borrador borra entero no reaparece vacío; el choque de un producto sin autorización queda retenido con el valor de la revisión", async () => {
    const k = await production();
    // Hotel (autorizado): el borrador quita las condiciones (terms) que la revisión cambia → disputa del objeto entero
    await withDraft(k, HOTEL, (d) => ({ ...hotelV10(d), commercial: { ...(hotelV10(d).commercial as Record<string, unknown>), terms: undefined } }));
    const KEY = "ski-net-complete";
    await withDraft(k, KEY, (d) => ({ ...d, name: "Ski Net Escuelas", commercial: { ...d.commercial, seo: null } }), "operator:2");
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^hotel-net-complete: 1 campo\(s\) en disputa \(commercial\.terms\)/);
    expect(r.borradores.find((b) => b.key === HOTEL)!.enDisputa[0]).toMatchObject({ campo: "commercial.terms", borrador: null });
    const ski = r.borradores.find((b) => b.key === KEY)!;
    expect(ski.retenido.find((x) => x.campo === "name")).toEqual({ campo: "name", publicado: "Ski Net Complete", borrador: "Ski Net Escuelas", revision: "Ski Net" });
    const after = await entry(k, KEY);
    expect((after.published as { name: string }).name).toBe("Ski Net");
    expect(productDraft.parse(after.draft).name).toBe("Ski Net Escuelas");
    expect(productDraft.parse(after.draft).commercial?.seo).toBeNull();
  });

  it("corte entre los dos guardados y edición posterior en el CRM: no se escribe nada y se avisa de lo retenido", async () => {
    const k = await production();
    const KEY = "ski-net-complete";
    await withDraft(k, KEY, (d) => ({ ...d, commercial: { ...d.commercial, problem: "Texto del operador sin publicar." } }), "operator:2");
    const real = k.svc.save.bind(k.svc);
    let saves = 0;
    k.svc.save = async (...a: Parameters<typeof real>) => {
      if (a[1] === KEY && ++saves === 2) throw new Error("corte");
      return real(...a);
    };
    const cut = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(cut.conflicts).toEqual([`${KEY}: no se pudo guardar o publicar (corte); se revisa en el CRM`]);
    k.svc.save = real;
    const mid = await entry(k, KEY);
    expect(mid.updatedBy).toBe(AUTHOR);
    // Sin edición intermedia, la reanudación lo recupera del historial
    const probe = await applyNetUnification(k.svc, k.store, { author: AUTHOR });
    expect(probe.borradores[0].retenido.map((x) => x.campo)).toEqual(["commercial.problem"]);
    // Con una edición del CRM encima del borrador a medias: se avisa y no se toca
    await withDraft(k, KEY, (d) => ({ ...d, commercial: { ...d.commercial, headline: "Otro cambio" } }), "operator:3");
    const edited = await entry(k, KEY);
    const r = await applyNetUnification(k.svc, k.store, { apply: true, author: AUTHOR });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^ski-net-complete: una ejecución anterior de esta revisión quedó a medias .*commercial\.problem.*se revisa en el CRM$/);
    const after = await entry(k, KEY);
    expect(after.draftVersion).toBe(edited.draftVersion);
    expect(after.publishedVersion).toBe(edited.publishedVersion);
  });

  it("detector de «Core incluido»: recorre todo lo público (no el modelo ni la parte interna) y no confunde una negación", () => {
    const doc = (extra: Record<string, unknown>) => ({ name: "Hotel Net", catalog: { coreIncluded: { plan: "essential" } }, internal: { notes: "Elephant Core incluido (nota interna)" }, ...extra });
    expect(coreIncludedTexts(doc({}))).toEqual([]);
    expect(coreIncludedTexts(doc({ includes: ["Elephant Core Essential incluido"] }))).toEqual(["includes[0]: «Elephant Core Essential incluido»"]);
    expect(coreIncludedTexts(doc({ presentation: { note: "Con Elephant Core incluido en el precio" } }))).toHaveLength(1);
    expect(coreIncludedTexts(doc({ commercial: { faq: [{ q: "¿Incluye Core?", a: "Sí, incluye Elephant Core." }] } }))).toEqual(["commercial.faq[0].a: «Sí, incluye Elephant Core.»"]);
    expect(coreIncludedTexts(doc({ commercial: { faq: [{ q: "¿Incluye Elephant Core?", a: "No: Elephant Core se contrata aparte." }] } }))).toEqual([]);
    expect(coreIncludedTexts(doc({ commercial: { benefits: ["Essential incluido"] } }))).toHaveLength(1);
    // El modelo vigente, dicho en negativo, no es un anuncio
    for (const ok of ["Hotel Net no incluye Elephant Core: el plan se contrata aparte.", "No incluye el plan Essential.", "Sin Elephant Core incluido: se contrata por separado.", "Elephant Core no está incluido."]) expect(coreIncludedTexts(doc({ description: ok })), ok).toEqual([]);
    // Pero una negación en otra frase no tapa un anuncio
    expect(coreIncludedTexts(doc({ description: "No tiene permanencia. Incluye Elephant Core." }))).toHaveLength(1);
  });

  it("un texto del borrador que anuncia Core incluido no se publica y se lista", async () => {
    const k = await production();
    await withDraft(k, HOTEL, (d) => hotelV10(d, { problem: "Con Elephant Core Essential incluido en el precio." }));
    const pending = await entry(k, HOTEL);
    const r = await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^hotel-net-complete: el resultado anunciaría Elephant Core incluido \(commercial\.problem: «Con Elephant Core Essential incluido en el precio\.»\)/);
    expect(r.anunciaCore).toEqual([`${HOTEL} (borrador) commercial.problem: «Con Elephant Core Essential incluido en el precio.»`, `${HOTEL} (borrador) catalog.coreIncluded`]);
    expect((await entry(k, HOTEL)).draftVersion).toBe(pending.draftVersion);
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
    await applyNetUnification(k.svc, k.store, { publishForeignDraft: AUTH.get(k) ?? [], apply: true, author: AUTHOR });
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
