/**
 * Revisión del catálogo del 09/11/2026: estrategia del TPV (caja de cada plan y TPV Advanced en la ficha de
 * `connect-pos`). Solo textos: sin precios, estados, cupos ni licencias. Imprime la simulación.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { REVIEW_ID_2026_11_09_TPV, TPV_LISTINGS_2026_11_09 } from "./catalog/review20261109tpv";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_TPV}`;
const KEYS = TPV_LISTINGS_2026_11_09.map((c) => c.key);

/**
 * Como production el 09/11/2026: los textos de partida publicados y Essential y Business en venta directa. Con
 * `perCompany`, el ámbito de connect-pos ya cambiado en el CRM (por empresa, sin unidad de cobro), que exige la revisión.
 */
async function production(perCompany = true) {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of TPV_LISTINGS_2026_11_09) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = Object.keys(c.fields).length ? { ...(d.commercial ?? {}) } : {};
    for (const [f, v] of Object.entries(c.fields)) commercial[f] = v!.from;
    const texts = Object.fromEntries(Object.entries(c.product ?? {}).map(([f, v]) => [f, v!.from]));
    const direct = c.key === "essential" || c.key === "business";
    const draft = {
      ...d,
      ...texts,
      ...(direct ? { technicalStatus: "available" as const } : {}),
      catalog: {
        ...d.catalog,
        ...(direct ? { commercialStatus: "available" as const, offer: { modality: "immediate" as const, trial: true, checkout: true } } : {}),
        ...(c.key === "connect-pos" && perCompany ? { scope: "company" as const, chargeUnit: null } : {}),
      },
      commercial,
      internal: { ...d.internal, evidence: `Evidencia previa de ${c.key}` },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 09/11/2026: estrategia del TPV", () => {
  it("ajusta los textos de los planes, TPV Advanced y las fichas que nombraban POS, sin tocar precios ni estados", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, e.draftVersion]));
    const statusBefore = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, JSON.stringify(productDraft.parse(e.draft).catalog)]));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    console.log(JSON.stringify({ revision: REVIEW_ID_2026_11_09_TPV, ...sim }));
    expect(sim).toEqual({
      apply: false,
      changed: [
        "essential: ficha (longDescription, benefits, excludes, capacityRules)",
        "business: producto (description)",
        "enterprise: producto (description)",
        "connect-pos: producto (name, tagline); ficha (headline, longDescription, problem, forWho, valueProposition, benefits, excludes, capacityRules, integrations, coreIntegration, howItWorks, faq, seo)",
        "addon-site-business: ficha (excludes, faq)",
      ],
      already: [],
      conflicts: [],
    });
    // La simulación no escribe nada
    for (const e of await k.store.listEntries({ kind: "product" })) expect(e.draftVersion, e.key).toBe(before.get(e.key));

    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(KEYS.length);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) {
      if (!KEYS.includes(e.key)) expect(e.draftVersion, e.key).toBe(before.get(e.key));
      expect(e.publishedVersion, e.key).toBe(e.draftVersion);
    }
    const get = async (key: string) => productDraft.parse((await k.store.getEntry("product", key))!.draft);

    const pos = await get("connect-pos");
    expect(pos.name).toBe("TPV Advanced");
    // Mismo estado, ámbito y unidad de cobro: el precio y el ámbito por empresa los cambia main en el CRM
    const posCatalog = { ...pos.catalog, stripePrepared: undefined };
    expect(JSON.stringify(posCatalog)).toBe(JSON.stringify({ ...JSON.parse(statusBefore.get("connect-pos")!), stripePrepared: undefined }));
    expect(pos.catalog).toMatchObject({ commercialStatus: "on_request", stripePrepared: false, scope: "company", chargeUnit: null, capabilities: ["pos-advanced"] });
    expect(pos.internal.evidence).toMatch(/aprobada por Jorge/);
    const posText = JSON.stringify(pos.commercial);
    for (const t of ["Finance Sync", "Restaurant Net", "Ski Net", "Hotel Net", "caja de tu plan", "Por empresa"]) expect(posText).toContain(t);
    expect(posText).not.toMatch(/Varias cajas por sede|rol de cajero|Elephant POS/);

    const ess = await get("essential");
    expect(ess.commercial?.excludes.join(" ")).not.toMatch(/Elephant POS/);
    expect(ess.commercial?.capacityRules).toContain("Caja: una caja activa por empresa; más cajas, con Business o Enterprise");
    // Los planes conservan su evidencia y su estado (solo cambian textos)
    expect(ess.internal.evidence).toBe("Evidencia previa de essential");
    for (const key of ["essential", "business", "enterprise"]) expect(JSON.stringify((await get(key)).catalog), key).toBe(statusBefore.get(key));
    const bus = await get("business");
    expect(bus.description).toMatch(/hasta 3 cajas activas, operadores y permisos por caja/);
    expect(bus.commercial).toEqual(productDraft.parse({ ...bus, commercial: {} }).commercial);
    expect((await get("enterprise")).description).toMatch(/sin límite comercial fijo \(con control de recursos y uso razonable\)/);
    for (const key of ["addon-site-business"]) expect(JSON.stringify((await get(key)).commercial), key).not.toMatch(/Elephant POS/);

    // TPV Advanced sigue en venta asistida, sin checkout
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === "connect-pos")!.offer).toMatchObject({ modality: "assisted", checkout: false });

    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(again).toEqual({ apply: true, changed: [], already: KEYS, conflicts: [] });
  });

  it("si en el CRM ya cambió un texto de partida, no lo pisa (conflicto) y aplica el resto", async () => {
    const k = await production();
    for (const [key, patch] of [
      ["connect-pos", (d: ReturnType<typeof productDraft.parse>) => ({ ...d, tagline: "Otro texto decidido en el CRM" })],
      ["essential", (d: ReturnType<typeof productDraft.parse>) => ({ ...d, commercial: { ...d.commercial!, benefits: ["Otro beneficio decidido en el CRM"] } })],
    ] as const) {
      const e = (await k.store.getEntry("product", key))!;
      const saved = await k.svc.save("product", key, { draft: productDraft.parse(patch(productDraft.parse(e.draft))), expectedVersion: e.draftVersion }, "operator:1");
      await k.svc.publish("product", key, saved.draftVersion, "operator:1");
    }
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(sim.conflicts).toHaveLength(2);
    expect(sim.conflicts.find((c) => c.startsWith("connect-pos"))).toMatch(/«tagline» del producto/);
    expect(sim.conflicts.find((c) => c.startsWith("essential"))).toMatch(/«benefits»/);
    expect(sim.changed).toHaveLength(KEYS.length - 2);
  });

  it("sin el ámbito por empresa de connect-pos en el CRM, las fichas que lo dicen no cambian (conflicto)", async () => {
    const k = await production(false);
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(r.conflicts.map((c) => c.split(":")[0])).toEqual(["connect-pos", "addon-site-business"]);
    expect(r.conflicts[0]).toMatch(/ámbito de «connect-pos» a «company».*ahora «site», «por sede»/);
    expect(r.changed).toHaveLength(KEYS.length - 2);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-pos"))!.draft).name).toBe("Elephant POS");
  });

  it("un borrador ajeno sin publicar no se publica", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "business"))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", "business", { draft: productDraft.parse({ ...d, tagline: `${d.tagline} (borrador)` }), expectedVersion: e.draftVersion }, "operator:1");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(r.conflicts).toEqual(["business: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno"]);
    expect((await k.store.getEntry("product", "business"))!.draftVersion).toBe(e.draftVersion + 1);
  });
});
