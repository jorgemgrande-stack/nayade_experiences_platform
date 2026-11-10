/**
 * Revisión del catálogo del 09/11/2026: estrategia del TPV (caja de cada plan y TPV Advanced en la ficha de
 * `connect-pos`). Textos, y el ámbito por empresa de TPV Advanced; sin precios (exige el de 19 € ya aprobado), estados,
 * cupos ni capacidades. Con borrador ajeno en un plan, publica solo lo suyo. Imprime la simulación.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { beforeTpvPerCompany } from "./catalog/seedHistory.testkit";
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

const run = (k: { svc: WebAdminService; store: MemoryWebStore }, apply = false) => applyListingReview(k.svc, k.store, { apply, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09, overDraft: true });
const POS_LINE = "connect-pos: ámbito «site» → «company», unidad de cobro «por sede» → «ninguna»; producto (name, tagline); ficha (headline, longDescription, problem, forWho, valueProposition, benefits, excludes, capacityRules, integrations, coreIntegration, howItWorks, faq, seo)";

/**
 * Como production el 10/11/2026: los textos de partida publicados, Essential y Business en venta directa y connect-pos
 * «por sede» (ámbito `site`). Con `price19`, el precio mensual de 19 € ya aprobado en el CRM (retira el de 25 €), que
 * exige la revisión.
 */
async function production(price19 = true) {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store, { products: beforeTpvPerCompany() });
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
      },
      commercial,
      internal: { ...d.internal, evidence: `Evidencia previa de ${c.key}` },
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  expect(productDraft.parse((await store.getEntry("product", "connect-pos"))!.draft).catalog).toMatchObject({ scope: "site", chargeUnit: "por sede" });
  if (price19) {
    const price = await svc.addPrice("connect-pos", { kind: "monthly", amountCents: 1900, taxRateBp: 2100 }, "operator:jorge");
    await svc.approvePrice(price.id, "operator:jorge");
  }
  return { store, svc };
}
const approvedPos = async (k: { store: MemoryWebStore }) => (await k.store.listPrices((await k.store.getEntry("product", "connect-pos"))!.id)).filter((x) => x.status === "approved").map((x) => `${x.kind}:${x.amountCents}`);

describe("revisión del 09/11/2026: estrategia del TPV", () => {
  it("ajusta los textos de los planes, TPV Advanced y las fichas que nombraban POS, sin tocar precios ni estados", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, e.draftVersion]));
    const statusBefore = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, JSON.stringify(productDraft.parse(e.draft).catalog)]));
    expect(await approvedPos(k)).toEqual(["monthly:1900"]);
    const sim = await run(k);
    console.log(JSON.stringify({ revision: REVIEW_ID_2026_11_09_TPV, ...sim }));
    expect(sim).toEqual({
      apply: false,
      changed: [
        "essential: ficha (longDescription, benefits, excludes, capacityRules)",
        "business: producto (description)",
        "enterprise: producto (description)",
        POS_LINE,
        "restaurant-net-complete: ficha (faq)",
        "addon-site-business: ficha (excludes, faq)",
      ],
      already: [],
      conflicts: [],
    });
    // La simulación no escribe nada
    for (const e of await k.store.listEntries({ kind: "product" })) expect(e.draftVersion, e.key).toBe(before.get(e.key));

    const r = await run(k, true);
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
    // Del modelo solo cambian el ámbito y la unidad de cobro (y stripePrepared); el precio lo cambió antes main en el CRM
    const posCatalog = { ...pos.catalog, stripePrepared: undefined };
    expect(JSON.stringify(posCatalog)).toBe(JSON.stringify({ ...JSON.parse(statusBefore.get("connect-pos")!), stripePrepared: undefined, scope: "company", chargeUnit: null }));
    expect(((await k.store.getEntry("product", "connect-pos"))!.published as Record<string, any>).catalog).toMatchObject({ scope: "company", chargeUnit: null });
    expect(await approvedPos(k)).toEqual(["monthly:1900"]);
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
    const rest = (await get("restaurant-net-complete")).commercial!.faq!;
    expect(rest).toHaveLength(4);
    expect(rest[3].q).toBe("¿Necesito TPV Advanced?");
    expect(rest[2].q).toBe("¿Incluye la caja?");
    for (const key of ["addon-site-business"]) expect(JSON.stringify((await get(key)).commercial), key).not.toMatch(/Elephant POS/);

    // TPV Advanced sigue en venta asistida, sin checkout
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === "connect-pos")!.offer).toMatchObject({ modality: "assisted", checkout: false });

    const again = await run(k, true);
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
    const sim = await run(k);
    // connect-pos no cambia, y con él tampoco la ficha que dice «por empresa»
    expect(sim.conflicts).toHaveLength(3);
    expect(sim.conflicts.find((c) => c.startsWith("addon-site-business"))).toMatch(/depende de «connect-pos»/);
    expect(sim.conflicts.find((c) => c.startsWith("connect-pos"))).toMatch(/«tagline» del producto/);
    expect(sim.conflicts.find((c) => c.startsWith("essential"))).toMatch(/«benefits»/);
    expect(sim.changed).toHaveLength(KEYS.length - 3);
  });

  it("con el precio aún en 25 €, TPV Advanced no cambia nada (conflicto claro) y la revisión no toca el precio", async () => {
    const k = await production(false);
    expect(await approvedPos(k)).toEqual(["monthly:2500"]);
    const before = (await k.store.getEntry("product", "connect-pos"))!;
    const r = await run(k, true);
    expect(r.conflicts.map((c) => c.split(":")[0])).toEqual(["connect-pos", "addon-site-business"]);
    expect(r.conflicts[0]).toBe("connect-pos: el precio aprobado (mensual) debe ser 19,00 € sin IVA y sin unidad, y ahora es 25,00 €: antes hay que aprobarlo en el CRM (la revisión no toca precios); se deja como lo decidió el CRM");
    expect(r.conflicts[1]).toBe("addon-site-business: depende de «connect-pos», que esta revisión no ha podido dejar por empresa (ver su conflicto); se deja como lo decidió el CRM");
    expect(r.changed).toHaveLength(KEYS.length - 2);
    const after = (await k.store.getEntry("product", "connect-pos"))!;
    expect(after.draftVersion).toBe(before.draftVersion);
    expect(productDraft.parse(after.draft)).toMatchObject({ name: "Elephant POS", catalog: { scope: "site", chargeUnit: "por sede" } });
    expect(await approvedPos(k)).toEqual(["monthly:2500"]);
    // Aprobado el precio en el CRM, la siguiente ejecución completa lo que faltaba
    const price = await k.svc.addPrice("connect-pos", { kind: "monthly", amountCents: 1900, taxRateBp: 2100 }, "operator:jorge");
    await k.svc.approvePrice(price.id, "operator:jorge");
    const prices = JSON.stringify(await k.store.listPrices());
    const next = await run(k, true);
    expect(next.conflicts).toEqual([]);
    expect(next.changed.map((c) => c.split(":")[0])).toEqual(["connect-pos", "addon-site-business"]);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-pos"))!.draft)).toMatchObject({ name: "TPV Advanced", catalog: { scope: "company", chargeUnit: null } });
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
  });

  it("ámbito o unidad de cobro distintos de los de partida: no se pisan (conflicto)", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "connect-pos"))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", "connect-pos", { draft: { ...d, catalog: { ...d.catalog, chargeUnit: "por caja" } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "connect-pos", saved.draftVersion, "operator:1");
    const r = await run(k, true);
    expect(r.conflicts.find((c) => c.startsWith("connect-pos"))).toMatch(/unidad de cobro «por caja» \(se esperaba «por sede»\)/);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-pos"))!.draft).catalog).toMatchObject({ scope: "site", chargeUnit: "por caja" });
    // Ya cambiado a mano (por empresa, sin unidad): se da por bueno y sigue con el resto
    const k2 = await production();
    const e2 = (await k2.store.getEntry("product", "connect-pos"))!;
    const d2 = productDraft.parse(e2.draft);
    const s2 = await k2.svc.save("product", "connect-pos", { draft: { ...d2, catalog: { ...d2.catalog, scope: "company", chargeUnit: null } }, expectedVersion: e2.draftVersion }, "operator:1");
    await k2.svc.publish("product", "connect-pos", s2.draftVersion, "operator:1");
    const r2 = await run(k2, true);
    expect(r2.conflicts).toEqual([]);
    expect(r2.changed.find((c) => c.startsWith("connect-pos"))).toBe(POS_LINE.replace("ámbito «site» → «company», unidad de cobro «por sede» → «ninguna»; ", ""));
  });

  it("borrador ajeno en los planes (como en production): publica solo lo de la revisión y el borrador sigue pendiente con lo suyo", async () => {
    const k = await production();
    const IMPORTER = "catalogo:especificaciones-comerciales";
    const draftOf = async (key: string) => productDraft.parse((await k.store.getEntry("product", key))!.draft);
    const foreign = async (key: string, change: (d: ReturnType<typeof productDraft.parse>) => unknown) => {
      const e = (await k.store.getEntry("product", key))!;
      return k.svc.save("product", key, { draft: change(productDraft.parse(e.draft)), expectedVersion: e.draftVersion }, IMPORTER);
    };
    // essential: solo la parte interna; business y enterprise: ficha entera, inclusiones y parte interna
    await foreign("essential", (d) => ({ ...d, internal: { ...d.internal, sources: ["F-ESS-1"], pendingDecisions: ["Decisión de prueba"] } }));
    const businessCommercial = { headline: "Para equipos que crecen", benefits: ["Ventaja de Business sin publicar"], cta: "contact" };
    await foreign("business", (d) => ({ ...d, commercial: businessCommercial, catalog: { ...d.catalog, inclusions: [{ key: "connect-people", mode: "full", status: "proposed" }] }, internal: { ...d.internal, sources: ["F-BUS-1"] } }));
    await foreign("enterprise", (d) => ({ ...d, commercial: { headline: "Para grupos", cta: "contact" }, catalog: { ...d.catalog, quoteOnRequest: { status: "proposed" } } }));
    const pending = new Map<string, number>();
    for (const key of ["essential", "business", "enterprise"]) pending.set(key, (await k.store.getEntry("product", key))!.draftVersion);
    const publishedBusiness = ((await k.store.getEntry("product", "business"))!.published as Record<string, any>).commercial;
    const prices = JSON.stringify(await k.store.listPrices());

    const sim = await run(k);
    expect(sim.conflicts).toEqual([]);
    expect(sim.changed).toHaveLength(KEYS.length);
    expect(sim.changed.find((c) => c.startsWith("business"))).toMatch(/^business: sobre el borrador v\d+ de catalogo:especificaciones-comerciales; se publica: 1 campo\(s\) de la revisión, 0 del borrador, 0 de ambos; \d+ cambio\(s\) del borrador retenido\(s\) sin publicar/);
    expect(sim.borradores!.map((b) => b.key)).toEqual(["essential", "business", "enterprise"]);
    expect(sim.borradores!.find((b) => b.key === "business")!.diff.map((x) => `${x.campo}: ${x.origen}`)).toEqual(["description: revisión"]);
    expect(sim.borradores!.find((b) => b.key === "business")!.retenido.map((x) => x.campo).some((c) => c.startsWith("commercial"))).toBe(true);
    for (const [key, v] of pending) expect((await k.store.getEntry("product", key))!.draftVersion, key).toBe(v);

    const r = await run(k, true);
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toHaveLength(KEYS.length);
    // Publicado: lo de la revisión, y nada del borrador ajeno
    const business = (await k.store.getEntry("product", "business"))!;
    const pub = business.published as Record<string, any>;
    expect(pub.description).toMatch(/hasta 3 cajas activas, operadores y permisos por caja/);
    expect(pub.commercial).toEqual(publishedBusiness);
    expect(JSON.stringify(pub)).not.toMatch(/Ventaja de Business sin publicar|connect-people/);
    const essentialPub = (await k.store.getEntry("product", "essential"))!.published as Record<string, any>;
    expect(essentialPub.commercial.capacityRules).toContain("Caja: una caja activa por empresa; más cajas, con Business o Enterprise");
    expect(((await k.store.getEntry("product", "enterprise"))!.published as Record<string, any>).description).toMatch(/sin límite comercial fijo/);
    // El borrador sigue pendiente, con lo suyo y con los cambios de la revisión
    expect(business.draftVersion).toBe(business.publishedVersion! + 1);
    const bd = await draftOf("business");
    expect(bd.commercial).toMatchObject(businessCommercial);
    expect(bd.catalog.inclusions).toEqual([{ key: "connect-people", mode: "full", status: "proposed" }]);
    expect(bd.internal.sources).toEqual(["F-BUS-1"]);
    expect(bd.description).toMatch(/hasta 3 cajas activas/);
    const ed = await draftOf("essential");
    expect(ed.internal.sources).toEqual(["F-ESS-1"]);
    expect(ed.internal.pendingDecisions).toEqual(["Decisión de prueba"]);
    expect(ed.commercial?.capacityRules).toContain("Caja: una caja activa por empresa; más cajas, con Business o Enterprise");
    expect((await draftOf("enterprise")).catalog.quoteOnRequest).toEqual({ status: "proposed" });
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);

    // Idempotente: nada que publicar ni que guardar; lo retenido sigue listado
    const versions = new Map((await k.store.listEntries({ kind: "product" })).map((e) => [e.key, e.draftVersion]));
    const again = await run(k, true);
    expect(again.changed).toEqual([]);
    expect(again.conflicts).toEqual([]);
    expect(again.already).toEqual(KEYS);
    expect(again.borradores!.map((b) => b.key)).toEqual(["essential", "business", "enterprise"]);
    for (const e of await k.store.listEntries({ kind: "product" })) expect(e.draftVersion, e.key).toBe(versions.get(e.key));
  });

  it("si connect-pos no llega a publicarse (fallo al guardar), la ficha que dice «por empresa» tampoco cambia", async () => {
    const k = await production();
    const real = k.svc.save.bind(k.svc);
    k.svc.save = async (...a: Parameters<typeof real>) => {
      if (a[1] === "connect-pos") throw new Error("corte");
      return real(...a);
    };
    const r = await run(k, true);
    expect(r.conflicts.map((c) => c.split(":")[0])).toEqual(["connect-pos", "addon-site-business"]);
    expect(r.conflicts[1]).toMatch(/depende de «connect-pos»/);
    expect(JSON.stringify(((await k.store.getEntry("product", "addon-site-business"))!.published as Record<string, any>).commercial)).toMatch(/Elephant POS/);
    k.svc.save = real;
    const next = await run(k, true);
    expect(next.conflicts).toEqual([]);
    expect(next.changed.map((c) => c.split(":")[0])).toEqual(["connect-pos", "addon-site-business"]);
  });

  it("precio de 19 € con IVA incluido, por unidad o duplicado: no vale", async () => {
    for (const [input, text] of [
      [{ taxIncluded: true }, /19,00 € con IVA incluido/],
      [{ unit: "sede" }, /19,00 € por sede y 25,00 €|25,00 € y 19,00 € por sede/],
    ] as const) {
      const k = await production(false);
      const price = await k.svc.addPrice("connect-pos", { kind: "monthly", amountCents: 1900, taxRateBp: 2100, ...input }, "operator:jorge");
      await k.svc.approvePrice(price.id, "operator:jorge");
      const r = await run(k, true);
      expect(r.conflicts.find((c) => c.startsWith("connect-pos"))).toMatch(text);
      expect(productDraft.parse((await k.store.getEntry("product", "connect-pos"))!.draft).name).toBe("Elephant POS");
    }
  });

  it("un borrador ajeno que cambia el mismo campo que la revisión: no se escribe nada de ese producto (conflicto)", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "business"))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", "business", { draft: { ...d, description: "Descripción del importador, sin publicar.", commercial: { headline: "Para equipos", cta: "contact" } }, expectedVersion: e.draftVersion }, "catalogo:especificaciones-comerciales");
    const before = (await k.store.getEntry("product", "business"))!;
    const r = await run(k, true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatch(/^business: el borrador v\d+ cambia campo\(s\) que también cambia la revisión \(description\); no se guarda ni se publica: se resuelve en el CRM$/);
    expect(r.borradores!.find((b) => b.key === "business")!.retenido.find((x) => x.campo === "description")).toMatchObject({ borrador: "Descripción del importador, sin publicar." });
    const after = (await k.store.getEntry("product", "business"))!;
    expect(after.draftVersion).toBe(before.draftVersion);
    expect(after.publishedVersion).toBe(before.publishedVersion);
    expect(r.changed).toHaveLength(KEYS.length - 1);
  });

  it("sin la marca overDraft, un borrador ajeno sigue siendo un conflicto (las revisiones anteriores no cambian)", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "business"))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", "business", { draft: productDraft.parse({ ...d, tagline: `${d.tagline} (borrador)` }), expectedVersion: e.draftVersion }, "operator:1");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: TPV_LISTINGS_2026_11_09 });
    expect(r.conflicts).toEqual(["business: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno"]);
    expect((await k.store.getEntry("product", "business"))!.draftVersion).toBe(e.draftVersion + 1);
    // Con la marca: se publica la descripción y la frase corta del borrador sigue pendiente
    const r2 = await run(k, true);
    expect(r2.conflicts).toEqual([]);
    const after = (await k.store.getEntry("product", "business"))!;
    expect((after.published as { tagline: string }).tagline).toBe(d.tagline);
    expect(productDraft.parse(after.draft).tagline).toBe(`${d.tagline} (borrador)`);
  });
});
