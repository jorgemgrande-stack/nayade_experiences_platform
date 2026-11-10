/**
 * La semilla del catálogo solo escribe sobre lo suyo (10/11/2026): en una base con vida respeta lo guardado o publicado
 * por el CRM y por las revisiones de catálogo, y lo lista como conflicto, sin escribir. Nunca sobrescribe ni publica un
 * borrador ajeno, no vuelve a publicar lo despublicado y no vuelve a aprobar un precio retirado.
 * También: el estado que recoge la semilla (Net unificado y heredados, sin «Core incluido», TPV Advanced por empresa).
 */
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { SEED_AUTHOR, keepCommercialState, seedElephantSource } from "./catalog/seed";
import { beforeNetUnification, beforeTpvPerCompany } from "./catalog/seedHistory.testkit";
import { NET_LEGACY_SINCE } from "./catalog/review20261109netunificacion";
import { applyListingReview } from "./catalog/review20261108fichas";
import { REVIEW_ID_2026_11_09_TPV, TPV_LISTINGS_2026_11_09 } from "./catalog/review20261109tpv";
import { NET_LEGACY_KEYS, NET_PRODUCTS, netProductOfLegacy } from "../shared/netProducts";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const CRM = "operator:jorge";

async function kit(products = PRODUCTS) {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  const first = await seedElephantSource(svc, store, { products });
  expect(first.conflicts).toEqual([]);
  return { store, svc };
}
type Kit = Awaited<ReturnType<typeof kit>>;
const entry = async (k: Kit, key: string) => (await k.store.getEntry("product", key))!;
const draftOf = async (k: Kit, key: string) => productDraft.parse((await entry(k, key)).draft);
const prices = async (k: Kit, key: string) => (await k.store.listPrices((await entry(k, key)).id)).sort((a, b) => a.id - b.id).map((p) => `${p.kind}:${p.amountCents}:${p.status}`);
/** Edición del CRM: guarda y, si se pide, publica. */
async function crmEdit(k: Kit, key: string, change: (d: ReturnType<typeof productDraft.parse>) => unknown, o: { publish?: boolean; author?: string } = {}) {
  const e = await entry(k, key);
  const saved = await k.svc.save("product", key, { draft: change(productDraft.parse(e.draft)), expectedVersion: e.draftVersion }, o.author ?? CRM);
  if (o.publish !== false) await k.svc.publish("product", key, saved.draftVersion, o.author ?? CRM);
}
/** Huella de todo lo que la semilla podría tocar: entradas (borrador, versión, publicación) y precios. */
async function fingerprint(k: Kit) {
  const entries = (await k.store.listEntries()).map((e) => [e.kind, e.key, e.draftVersion, e.publishedVersion, e.publication, e.updatedBy, e.publishedBy, JSON.stringify(e.draft), JSON.stringify(e.published)]);
  return JSON.stringify({ entries, prices: await k.store.listPrices() });
}

describe("estado que recoge la semilla (10/11/2026)", () => {
  const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
  it("TPV Advanced: por empresa, sin unidad de cobro y 19 € al mes", () => {
    const pos = byKey.get("connect-pos")!;
    expect(pos.draft).toMatchObject({ name: "TPV Advanced", catalog: { scope: "company", chargeUnit: null, commercialStatus: "on_request", capabilities: ["pos-advanced"] } });
    expect(pos.prices).toEqual([{ kind: "monthly", amountCents: 1900, unit: null }]);
  });
  it("Elephant Net unificado: 7 soluciones y 19 módulos heredados, cada uno con su solución; ninguna incluye Core", () => {
    for (const key of NET_LEGACY_KEYS) expect(byKey.get(key)!.draft.catalog.legacy, key).toEqual({ since: NET_LEGACY_SINCE, replacedBy: netProductOfLegacy(key)!.key });
    expect(PRODUCTS.filter((p) => p.draft.catalog.legacy).map((p) => p.key).sort()).toEqual([...NET_LEGACY_KEYS].sort());
    expect(NET_LEGACY_KEYS).toHaveLength(19);
    for (const s of NET_PRODUCTS) {
      const p = byKey.get(s.key)!;
      expect(p.draft.catalog.legacy, s.key).toBeUndefined();
      expect(p.draft.name, s.key).not.toMatch(/Complete/);
    }
    for (const p of PRODUCTS) expect(p.draft.catalog.coreIncluded, p.key).toBeUndefined();
    expect(byKey.get("social-token-net-complete")!.draft.catalog.scope).toBe("company");
    expect(byKey.get("hotel-net-complete")!.draft.catalog.commercialStatus).toBe("on_request");
  });
  it("lo que conserva de la base: la oferta y lo decidido en el CRM, pero nunca «Core incluido»", () => {
    const seed = byKey.get("hotel-net-complete")!.draft;
    const db = { ...seed, catalog: { ...seed.catalog, commercialStatus: "in_preparation" as const, coreIncluded: { plan: "essential", status: "approved" as const }, stripePrepared: true, implementationLevel: 1 as const, offer: { modality: "assisted" as const } } };
    const kept = productDraft.parse(keepCommercialState(seed, db));
    expect(kept.catalog).toMatchObject({ commercialStatus: "in_preparation", stripePrepared: true, implementationLevel: 1, offer: { modality: "assisted" } });
    expect(kept.catalog.coreIncluded).toBeUndefined();
  });
});

describe("la semilla solo escribe sobre lo suyo", () => {
  it("una base sembrada y sin tocar sigue siendo suya: actualiza, publica y cambia la tarifa", async () => {
    const k = await kit(beforeTpvPerCompany());
    const sim = await seedElephantSource(k.svc, k.store, { dryRun: true });
    expect(sim).toMatchObject({ updated: ["product:connect-pos"], published: ["product:connect-pos"], pricesApproved: ["connect-pos monthly 1900"], conflicts: [], pending: [] });
    const r = await seedElephantSource(k.svc, k.store);
    expect(r).toMatchObject({ updated: ["product:connect-pos"], published: ["product:connect-pos"], pricesApproved: ["connect-pos monthly 1900"], conflicts: [], pending: [] });
    expect((await entry(k, "connect-pos")).published).toMatchObject({ catalog: { scope: "company", chargeUnit: null } });
    expect(await prices(k, "connect-pos")).toEqual(["monthly:2500:retired", "monthly:1900:approved"]);
    const again = await seedElephantSource(k.svc, k.store);
    expect([again.created, again.updated, again.published, again.pricesApproved, again.conflicts, again.pending]).toEqual([[], [], [], [], [], []]);
  });

  it("borrador ajeno pendiente: ni se sobrescribe ni se publica; se lista", async () => {
    const k = await kit();
    // Como en production: borrador sin publicar de la importación de fichas sobre Business
    await crmEdit(k, "business", (d) => ({ ...d, tagline: "Borrador del CRM sin publicar" }), { publish: false, author: "catalogo:especificaciones-comerciales" });
    const before = await fingerprint(k);
    const publishedBefore = JSON.stringify((await entry(k, "business")).published);
    for (const dryRun of [true, false]) {
      const r = await seedElephantSource(k.svc, k.store, { dryRun });
      expect(r.pending).toEqual(["product:business"]);
      // Lo publicado coincide con la semilla: no hay conflicto, solo el borrador pendiente
      expect(r.conflicts).toEqual([]);
      expect([r.created, r.updated, r.published, r.pricesApproved]).toEqual([[], [], [], []]);
    }
    expect(await fingerprint(k)).toBe(before);
    const e = await entry(k, "business");
    expect(productDraft.parse(e.draft).tagline).toBe("Borrador del CRM sin publicar");
    expect(JSON.stringify(e.published)).toBe(publishedBefore);
    expect(e.publishedVersion).not.toBe(e.draftVersion);
  });

  it("lo publicado por el CRM se respeta: no lo revierte, y lista en qué difiere de la semilla", async () => {
    const k = await kit();
    await crmEdit(k, "connect-voice", (d) => ({ ...d, tagline: "Centralita con IA, decidida en el CRM", catalog: { ...d.catalog, scope: "site" as const, stripePrepared: false } }));
    const before = await fingerprint(k);
    const r = await seedElephantSource(k.svc, k.store);
    expect(r.conflicts).toEqual([`connect-voice: publicado por «${CRM}»; difiere de la semilla en catalog.scope, tagline; se respeta lo decidido en el CRM`]);
    expect([r.updated, r.published, r.pricesApproved, r.pending]).toEqual([[], [], [], []]);
    expect(await fingerprint(k)).toBe(before);
    // Lo que decide el CRM (aquí `stripePrepared`) no cuenta como diferencia; publicado por el CRM sin diferencias, tampoco
    await crmEdit(k, "connect-tax", (d) => ({ ...d, catalog: { ...d.catalog, stripePrepared: true } }));
    const r2 = await seedElephantSource(k.svc, k.store);
    expect(r2.conflicts).toEqual(r.conflicts);
    expect((await draftOf(k, "connect-tax")).catalog.stripePrepared).toBe(true);
  });

  it("lo despublicado por el CRM no se vuelve a publicar", async () => {
    const k = await kit();
    await k.svc.unpublish("product", "extra-accounting", CRM);
    const before = await fingerprint(k);
    const r = await seedElephantSource(k.svc, k.store);
    expect(r.published).toEqual([]);
    expect(r.conflicts).toEqual([`extra-accounting: despublicado (último guardado de «${(await entry(k, "extra-accounting")).updatedBy}»); se respeta lo decidido en el CRM`]);
    expect((await entry(k, "extra-accounting")).publication).toBe("unpublished");
    expect(await fingerprint(k)).toBe(before);
  });

  it("precio retirado en el CRM: la semilla no lo vuelve a aprobar ni sustituye el vigente", async () => {
    // El caso real: la base se sembró con 25 € y Jorge aprueba 19 € en el CRM (retira el de 25 €). Una semilla antigua
    // (25 €) no debe volver a aprobar el retirado; la nueva (19 €) lo da por bueno
    const k = await kit(beforeTpvPerCompany());
    const p = await k.svc.addPrice("connect-pos", { kind: "monthly", amountCents: 1900, taxRateBp: 2100 }, CRM);
    await k.svc.approvePrice(p.id, CRM);
    expect(await prices(k, "connect-pos")).toEqual(["monthly:2500:retired", "monthly:1900:approved"]);
    const before = await fingerprint(k);
    const old = await seedElephantSource(k.svc, k.store, { products: beforeTpvPerCompany() });
    expect(old.pricesApproved).toEqual([]);
    expect(old.conflicts).toEqual([`connect-pos: precio mensual vigente 19,00 € (aprobado por «${CRM}») frente a 25,00 € de la semilla; se respeta el del CRM (la semilla no aprueba ni retira precios ajenos)`]);
    expect(await fingerprint(k)).toBe(before);
    // Sin precio vigente (retirado en el CRM y sin sustituto): tampoco lo repone
    const k2 = await kit();
    const cur = (await k2.store.listPrices((await entry(k2, "connect-deals")).id))[0];
    await k2.svc.retirePrice(cur.id, CRM);
    const r2 = await seedElephantSource(k2.svc, k2.store);
    expect(r2.pricesApproved).toEqual([]);
    expect(r2.conflicts).toEqual([`connect-deals: precio mensual sin precio vigente (retirado por «${CRM}») frente a 19,00 € de la semilla; se respeta el del CRM (la semilla no aprueba ni retira precios ajenos)`]);
    expect(await prices(k2, "connect-deals")).toEqual(["monthly:1900:retired"]);
  });

  it("como production hoy y después de la revisión del TPV: la siembra con --apply no cambia nada", async () => {
    // Hoy: módulos Net ya heredados por la revisión, connect-pos todavía «Elephant POS» por sede a 25 €, y borradores
    // ajenos pendientes en los planes
    const k = await kit(beforeTpvPerCompany(beforeNetUnification()));
    for (const key of NET_LEGACY_KEYS) await crmEdit(k, key, (d) => ({ ...d, catalog: { ...d.catalog, legacy: { since: NET_LEGACY_SINCE, replacedBy: netProductOfLegacy(key)!.key } } }), { author: "operacion:revision-catalogo-2026-11-09-net-unificacion" });
    for (const c of TPV_LISTINGS_2026_11_09) {
      await crmEdit(k, c.key, (d) => {
        const commercial: Record<string, unknown> = Object.keys(c.fields).length ? { ...(d.commercial ?? {}) } : {};
        for (const [f, v] of Object.entries(c.fields)) commercial[f] = v!.from;
        return productDraft.parse({ ...d, ...Object.fromEntries(Object.entries(c.product ?? {}).map(([f, v]) => [f, v!.from])), commercial });
      });
    }
    await crmEdit(k, "business", (d) => ({ ...d, commercial: { ...d.commercial!, problem: "Ficha importada, sin publicar" } }), { publish: false, author: "catalogo:especificaciones-comerciales" });
    const today = await fingerprint(k);
    const r = await seedElephantSource(k.svc, k.store);
    expect([r.created, r.updated, r.published, r.pricesApproved]).toEqual([[], [], [], []]);
    expect(r.pending).toEqual(["product:business"]);
    // connect-pos: ni el nombre, ni el ámbito, ni el precio de 19 € antes de tiempo
    expect(r.conflicts.find((c) => c.startsWith("connect-pos: publicado"))).toBe(`connect-pos: publicado por «${CRM}»; difiere de la semilla en catalog.chargeUnit, catalog.scope, name, tagline; se respeta lo decidido en el CRM`);
    expect(r.conflicts.find((c) => c.startsWith("connect-pos: precio"))).toBe(`connect-pos: precio mensual vigente 25,00 € (aprobado por «${SEED_AUTHOR}») frente a 19,00 € de la semilla; se respeta el del CRM (la semilla no aprueba ni retira precios ajenos)`);
    // Los heredados ya coinciden con la semilla: sin conflicto
    expect(r.conflicts.filter((c) => NET_LEGACY_KEYS.some((key) => c.startsWith(`${key}:`)))).toEqual([]);
    expect(await fingerprint(k)).toBe(today);

    // Después: Jorge aprueba 19 € en el CRM y se aplica la revisión del TPV. La semilla ya no tiene nada que decir de connect-pos
    const price = await k.svc.addPrice("connect-pos", { kind: "monthly", amountCents: 1900, taxRateBp: 2100 }, CRM);
    await k.svc.approvePrice(price.id, CRM);
    const review = await applyListingReview(k.svc, k.store, { apply: true, author: `operacion:${REVIEW_ID_2026_11_09_TPV}`, changes: TPV_LISTINGS_2026_11_09, overDraft: true });
    expect(review.conflicts).toEqual([]);
    const applied = await fingerprint(k);
    const after = await seedElephantSource(k.svc, k.store);
    expect([after.created, after.updated, after.published, after.pricesApproved]).toEqual([[], [], [], []]);
    expect(after.conflicts.filter((c) => c.startsWith("connect-pos"))).toEqual([]);
    expect(await prices(k, "connect-pos")).toEqual(["monthly:2500:retired", "monthly:1900:approved"]);
    expect(await fingerprint(k)).toBe(applied);
  });
});
