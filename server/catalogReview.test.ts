/**
 * Estados comerciales normalizados y revisión del 25/10/2026:
 *  - los cuatro estados y sus reglas (Disponible exige técnico «available»; Implantación acompañada exige funcionalidad
 *    operativa; En preparación y Próximamente no se contratan);
 *  - la revisión solo cambia lo que sigue en su estado de partida, por el flujo normal (versión, autor, publicación),
 *    es idempotente, respeta lo decidido desde el CRM y los borradores ajenos y no toca precios;
 *  - la semilla ya no revierte el estado comercial decidido en el CRM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyStatusReview, fillEvidence } from "./catalog/review";
import { EVIDENCE_2026_10_25, STATUS_REVIEW_2026_10_25 } from "./catalog/review20261025";
import { STATUS_REVIEW_2026_11_07 } from "./catalog/review20261107";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { COMMERCIAL_STATUS, COMMERCIAL_STATUS_LABEL, productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = "operacion:revision-catalogo-2026-10-25";

/** Catálogo como estaba en las BD antes de la revisión (los estados de partida), escrito sin pasar por las reglas nuevas. */
async function previousCatalog() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of STATUS_REVIEW_2026_10_25) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const old = { ...d, catalog: { ...d.catalog, commercialStatus: c.from }, internal: { ...d.internal, evidence: null } };
    const saved = await store.saveDraft(e.id, e.draftVersion, old, e.sortOrder, "catalogo:elephant-source-v1", 1_790_000_000_000);
    await store.setPublication(e.id, { publication: "published", published: { ...(e.published ?? {}), catalog: { ...((e.published?.catalog as object) ?? {}), commercialStatus: c.from } }, publishedVersion: saved.draftVersion, publishedAt: 1, publishedBy: "x", updatedAt: 1, updatedBy: "x" });
  }
  return { store, svc };
}

describe("estados comerciales normalizados", () => {
  it("cuatro estados visibles con sus etiquetas y «no publicado»", () => {
    expect(COMMERCIAL_STATUS).toEqual(["unpublished", "coming_soon", "in_preparation", "on_request", "available"]);
    expect(COMMERCIAL_STATUS_LABEL).toMatchObject({ available: "Disponible", on_request: "Implantación acompañada", in_preparation: "En preparación", coming_soon: "Próximamente" });
  });

  it("Disponible exige que el producto esté técnicamente disponible", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    const ess = (await store.getEntry("product", "essential"))!;
    const de = productDraft.parse(ess.draft);
    await expect(svc.save("product", "essential", { draft: { ...de, catalog: { ...de.catalog, commercialStatus: "available" } }, expectedVersion: ess.draftVersion }, "x")).rejects.toThrow(/Disponible/);
  });

  it("En preparación no se contrata: el cotizador lo bloquea", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    const cat = quoteCatalogFromSite(await svc.site("published"));
    expect(quote(cat, { plan: "enterprise", interval: "month", extensions: [] } as never).contractable).toBe("not_available");
    expect(quote(cat, { plan: "essential", interval: "month", extensions: [] } as never).contractable).toBe("request");
  });

  it("la semilla nueva ya refleja la revisión y todo lo que se ofrece tiene evidencia", () => {
    const status = Object.fromEntries(PRODUCTS.map((p) => [p.key, p.draft.catalog.commercialStatus]));
    // Cada producto, en el estado de llegada de la última revisión que lo cambia
    const latest = new Map([...STATUS_REVIEW_2026_10_25, ...STATUS_REVIEW_2026_11_07].map((c) => [c.key, c.to]));
    for (const [key, to] of Array.from(latest)) expect(status[key], key).toBe(to);
    for (const c of STATUS_REVIEW_2026_11_07) if (c.technical) expect(PRODUCTS.find((p) => p.key === c.key)!.draft.technicalStatus, c.key).toBe(c.technical.to);
    for (const p of PRODUCTS) {
      if (p.draft.catalog.commercialStatus === "on_request") expect(p.draft.internal.evidence, p.key).toBeTruthy();
      if (p.draft.catalog.commercialStatus === "on_request") expect(p.draft.technicalStatus, p.key).not.toBe("planned");
      if (p.key !== "social-token-net-complete") expect(p.draft.catalog.commercialStatus, p.key).not.toBe("available");
    }
    expect(PRODUCTS.find((p) => p.key === "hotel-net-pms")!.draft.internal.notes).toMatch(/^Componente interno del producto Elephant Net/);
  });
});

describe("revisión del 25/10/2026", () => {
  let k: Awaited<ReturnType<typeof previousCatalog>>;
  beforeEach(async () => {
    k = await previousCatalog();
  });

  it("simulación por defecto: calcula los cambios y no escribe nada", async () => {
    const before = JSON.stringify(await k.store.listEntries({ kind: "product" }));
    const r = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { author: AUTHOR });
    expect(r.changed).toHaveLength(STATUS_REVIEW_2026_10_25.length);
    expect(JSON.stringify(await k.store.listEntries({ kind: "product" }))).toBe(before);
  });

  it("aplica por el flujo normal (versión nueva, autor, publicación) sin tocar precios; repetir no cambia nada", async () => {
    const pms = (await k.store.getEntry("product", "hotel-net-pms"))!;
    const pricesBefore = JSON.stringify(await k.store.listPrices(pms.id));
    const r = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    const after = (await k.store.getEntry("product", "hotel-net-pms"))!;
    expect(after.draftVersion).toBe(pms.draftVersion + 1);
    expect(after.publishedVersion).toBe(after.draftVersion);
    expect(after.publishedBy).toBe(AUTHOR);
    expect((after.published as { catalog: { commercialStatus: string } }).catalog.commercialStatus).toBe("on_request");
    expect(productDraft.parse(after.draft).internal.evidence).toMatch(/hotelDb/);
    expect(JSON.stringify(await k.store.listPrices(pms.id))).toBe(pricesBefore);
    const site = await k.svc.site("published");
    expect(JSON.stringify(site)).not.toMatch(/hotelDb|evidence/);
    const again = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toHaveLength(STATUS_REVIEW_2026_10_25.length);
  });

  it("respeta lo decidido desde el CRM y no publica borradores ajenos", async () => {
    const biz = (await k.store.getEntry("product", "enterprise"))!;
    const d = productDraft.parse(biz.draft);
    await k.store.saveDraft(biz.id, biz.draftVersion, { ...d, catalog: { ...d.catalog, commercialStatus: "coming_soon" } }, biz.sortOrder, "operator:1", 2);
    const voice = (await k.store.getEntry("product", "hotel-net-pms"))!;
    await k.store.saveDraft(voice.id, voice.draftVersion, { ...productDraft.parse(voice.draft), tagline: "Cambio sin publicar" }, voice.sortOrder, "operator:1", 2);
    const r = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { apply: true, author: AUTHOR });
    expect(r.conflicts.some((c) => c.startsWith("enterprise:"))).toBe(true);
    expect(r.conflicts.some((c) => c.startsWith("hotel-net-pms:"))).toBe(true);
    expect(productDraft.parse((await k.store.getEntry("product", "enterprise"))!.draft).catalog.commercialStatus).toBe("coming_soon");
    expect((await k.store.getEntry("product", "hotel-net-pms"))!.publishedVersion).toBe(voice.publishedVersion);
  });

  it("se deshace desde el CRM restaurando la versión anterior", async () => {
    await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { apply: true, author: AUTHOR });
    const e = (await k.store.getEntry("product", "care-net-agenda"))!;
    await k.svc.restore("product", "care-net-agenda", e.draftVersion - 1, "operator:1");
    expect(productDraft.parse((await k.store.getEntry("product", "care-net-agenda"))!.draft).catalog.commercialStatus).toBe("coming_soon");
  });

  it("la evidencia de los que no cambian solo se rellena donde falta", async () => {
    const filled = await fillEvidence(k.svc, k.store, EVIDENCE_2026_10_25, { apply: true, author: AUTHOR });
    expect(filled).toEqual([]); // la semilla nueva ya la trae
    const ess = (await k.store.getEntry("product", "essential"))!;
    const d = productDraft.parse(ess.draft);
    await k.svc.save("product", "essential", { draft: { ...d, internal: { ...d.internal, evidence: null } }, expectedVersion: ess.draftVersion }, "x");
    expect(await fillEvidence(k.svc, k.store, EVIDENCE_2026_10_25, { author: AUTHOR })).toEqual(["essential"]);
  });

  it("la semilla ya no revierte el estado comercial decidido en el CRM", async () => {
    const e = (await k.store.getEntry("product", "connect-voice"))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", "connect-voice", { draft: { ...d, catalog: { ...d.catalog, commercialStatus: "in_preparation" } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "connect-voice", saved.draftVersion, "operator:1");
    await seedElephantSource(k.svc, k.store);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-voice"))!.draft).catalog.commercialStatus).toBe("in_preparation");
  });
});

describe("revisión del 07/11/2026: Elephant Net en implantación acompañada", () => {
  const AUTHOR_1107 = "operacion:revision-catalogo-2026-11-07";
  const FIVE = ["hotel-net-complete", "restaurant-net-complete", "care-net-complete", "ski-net-complete", "travel-net-complete"];

  /** Catálogo como está hoy en production: los cinco en su estado de partida (comercial y técnico), ya publicados. */
  async function before1107() {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
    await seedElephantSource(svc, store);
    for (const c of STATUS_REVIEW_2026_11_07) {
      const e = (await store.getEntry("product", c.key))!;
      const d = productDraft.parse(e.draft);
      const old = { ...d, ...(c.technical ? { technicalStatus: c.technical.from } : {}), catalog: { ...d.catalog, commercialStatus: c.from } };
      const saved = await store.saveDraft(e.id, e.draftVersion, old, e.sortOrder, "catalogo:elephant-source-v1", 1_790_000_000_000);
      await store.setPublication(e.id, { publication: "published", published: { ...(e.published ?? {}), ...(c.technical ? { technicalStatus: c.technical.from } : {}), catalog: { ...((e.published?.catalog as object) ?? {}), commercialStatus: c.from } }, publishedVersion: saved.draftVersion, publishedAt: 1, publishedBy: "x", updatedAt: 1, updatedBy: "x" });
    }
    return { store, svc };
  }

  it("solo los cinco productos, todos a «Implantación acompañada»; Social Token Net y Life Net no cambian", () => {
    expect(STATUS_REVIEW_2026_11_07.map((c) => c.key)).toEqual(FIVE);
    expect(STATUS_REVIEW_2026_11_07.every((c) => c.to === "on_request")).toBe(true);
    expect(STATUS_REVIEW_2026_11_07.filter((c) => c.technical).map((c) => [c.key, c.technical!.from, c.technical!.to])).toEqual([
      ["ski-net-complete", "planned", "partial"],
      ["travel-net-complete", "planned", "partial"],
    ]);
    for (const c of STATUS_REVIEW_2026_11_07) expect(c.evidence, c.key).toMatch("verificado en production el 07/11/2026");
  });

  it("aplica por el flujo normal sin tocar precios ni la oferta (asistida, sin checkout); repetir no cambia nada", async () => {
    const k = await before1107();
    const pricesBefore = JSON.stringify(await k.store.listPrices());
    const sim = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_11_07, { author: AUTHOR_1107 });
    expect(sim.changed).toEqual([
      "hotel-net-complete: in_preparation → on_request",
      "restaurant-net-complete: in_preparation → on_request",
      "care-net-complete: in_preparation → on_request",
      "ski-net-complete: coming_soon → on_request (técnico planned → partial)",
      "travel-net-complete: coming_soon → on_request (técnico planned → partial)",
    ]);
    const r = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_11_07, { apply: true, author: AUTHOR_1107 });
    expect(r.conflicts).toEqual([]);
    for (const key of FIVE) {
      const e = (await k.store.getEntry("product", key))!;
      const d = productDraft.parse(e.draft);
      expect(d.catalog.commercialStatus, key).toBe("on_request");
      expect(d.technicalStatus, key).toBe("partial");
      expect(e.publishedVersion, key).toBe(e.draftVersion);
      expect(e.publishedBy, key).toBe(AUTHOR_1107);
    }
    expect(JSON.stringify(await k.store.listPrices())).toBe(pricesBefore);
    // Venta asistida: el cotizador la deja en solicitud (nunca autoservicio) y la oferta no lleva checkout
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    for (const key of FIVE) {
      const p = cat.products.find((x) => x.key === key)!;
      expect(p.commercialStatus, key).toBe("on_request");
      expect(p.offer, key).toMatchObject({ modality: "assisted", checkout: false, trial: false, cta: "proposal" });
      expect(quote(cat, { plan: "essential", interval: "month", extensions: [key] } as never).contractable, key).toBe("request");
    }
    // Social Token Net: en venta directa (como en production desde el 10/11/2026); Life Net sigue «Próximamente»
    expect(cat.products.find((x) => x.key === "social-token-net-complete")!.commercialStatus).toBe("available");
    expect(cat.products.find((x) => x.key === "life-net")!.commercialStatus).toBe("coming_soon");
    const again = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_11_07, { apply: true, author: AUTHOR_1107 });
    expect(again.changed).toEqual([]);
    expect(again.already).toEqual(FIVE);
    // La del 25/10, aplicada después, ya no los toca: los informa como decididos (conflicto, no fallo)
    const old = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_10_25, { author: AUTHOR });
    for (const key of ["hotel-net-complete", "restaurant-net-complete", "care-net-complete"]) expect(old.conflicts.some((c) => c.startsWith(`${key}:`)), key).toBe(true);
  });

  it("respeta un estado técnico decidido desde el CRM", async () => {
    const k = await before1107();
    const e = (await k.store.getEntry("product", "travel-net-complete"))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", "travel-net-complete", { draft: { ...d, technicalStatus: "available" }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "travel-net-complete", saved.draftVersion, "operator:1");
    const r = await applyStatusReview(k.svc, k.store, STATUS_REVIEW_2026_11_07, { apply: true, author: AUTHOR_1107 });
    expect(r.conflicts.some((c) => c.startsWith("travel-net-complete: estado técnico"))).toBe(true);
    expect(productDraft.parse((await k.store.getEntry("product", "travel-net-complete"))!.draft).catalog.commercialStatus).toBe("coming_soon");
  });
});

describe("publicación del catálogo en la web", () => {
  it("cada despliegue de la web lleva la versión del catálogo publicado: un cambio desde el CRM invalida la caché de compilación", async () => {
    const fs = await import("node:fs");
    const { CATALOG_STAMP_FILE, WEB_CATALOG_SITE } = await import("../scripts/deploy/esRailwayLib");
    expect(Object.keys(WEB_CATALOG_SITE).sort()).toEqual(["live", "production"]);
    for (const u of Object.values(WEB_CATALOG_SITE)) expect(u).toMatch(/^https:\/\/[^/]+\/cp\/v1\/public\/site$/);
    const src = fs.readFileSync("scripts/deploy/esRailway.ts", "utf8");
    expect(src.match(/await stampWebCatalog\(dir\)/g)).toHaveLength(2);
    expect(src).toContain("CATALOG_STAMP_FILE");
    expect(CATALOG_STAMP_FILE).not.toMatch(/^\./); // los ficheros ocultos no deben quedar fuera de COPY . .
  });
});
