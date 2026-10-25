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
    for (const c of STATUS_REVIEW_2026_10_25) expect(status[c.key], c.key).toBe(c.to);
    for (const p of PRODUCTS) {
      if (p.draft.catalog.commercialStatus === "on_request") expect(p.draft.internal.evidence, p.key).toBeTruthy();
      if (p.draft.catalog.commercialStatus === "on_request") expect(p.draft.technicalStatus, p.key).not.toBe("planned");
      expect(p.draft.catalog.commercialStatus, p.key).not.toBe("available");
    }
    expect(PRODUCTS.find((p) => p.key === "hotel-net-pms")!.draft.internal.notes).not.toMatch(/no se vende/);
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
