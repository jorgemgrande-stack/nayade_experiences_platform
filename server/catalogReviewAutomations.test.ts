/**
 * Revisión del catálogo del 09/11/2026: Automatizaciones avanzadas a implantación acompañada con su ficha real (sin
 * checkout ni Price de Stripe: `stripePrepared: false`). Imprime la simulación (productos y campos que cambian).
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { AUTOMATIONS_LISTING_2026_11_09, REVIEW_ID_2026_11_09_AUTOMATIONS } from "./catalog/review20261109automations";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_AUTOMATIONS}`;
const KEY = "connect-automations";

/** Como production el 09/11/2026: «En preparación», demostración, nivel 2 y la ficha publicada de partida. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of AUTOMATIONS_LISTING_2026_11_09) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { ...d.commercial, headline: "Tus procesos funcionando solos.", capacityRules: ["Por empresa"] };
    for (const [f, v] of Object.entries(c.fields)) {
      if (v!.from !== undefined) commercial[f] = v!.from;
      else delete commercial[f];
    }
    const draft = {
      ...d,
      technicalStatus: "partial" as const,
      activation: { kind: "feature" as const, ref: null },
      catalog: { ...d.catalog, commercialStatus: c.status!.from, implementationLevel: c.implementationLevel!.from },
      commercial,
    };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

describe("revisión del 09/11/2026: Automatizaciones avanzadas", () => {
  it("solo connect-automations pasa a implantación acompañada, con su ficha honesta y sin tocar precios, paquetes ni Copilot", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).filter((e) => e.key !== KEY).map((e) => [e.key, e.draftVersion]));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: AUTOMATIONS_LISTING_2026_11_09 });
    // Simulación que se reporta al coordinador
    console.log(`[simulación ${REVIEW_ID_2026_11_09_AUTOMATIONS}]`, JSON.stringify(sim, null, 2));
    expect(sim.conflicts).toEqual([]);
    expect(sim.changed).toEqual([`${KEY}: in_preparation → on_request; ficha (cta, longDescription, valueProposition, benefits, excludes, integrations, coreIntegration, terms, howItWorks, faq)`]);
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: AUTOMATIONS_LISTING_2026_11_09 });
    expect(r.conflicts).toEqual([]);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) if (e.key !== KEY) expect(e.draftVersion, e.key).toBe(before.get(e.key));
    const d = productDraft.parse((await k.store.getEntry("product", KEY))!.draft);
    expect(d).toMatchObject({ technicalStatus: "partial", activation: { kind: "feature" }, catalog: { commercialStatus: "on_request", implementationLevel: 1, stripePrepared: false }, commercial: { cta: "contact", capacityRules: ["Por empresa"] } });
    expect(d.commercial?.faq?.[0].q).toBe("¿Cómo se pone en marcha?");
    // Ficha honesta: los cinco disparadores y las acciones reales; nada de «Próximamente» ni de inclusión en Business
    const text = JSON.stringify(d.commercial);
    for (const s of ["oportunidad", "presupuesto", "reserva", "factura", "correo", "tarea", "avisar", "etiquet"]) expect(text.toLowerCase()).toContain(s);
    expect(text).not.toMatch(/Próximamente|Business/);
    // Sin checkout: implantación asistida en la web y el cotizador
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === KEY)!.offer).toMatchObject({ modality: "assisted", checkout: false });
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: AUTOMATIONS_LISTING_2026_11_09 });
    expect(again.already).toEqual([KEY]);
  });

  it("si production ya no tiene el valor de partida de un campo, no cambia nada (conflicto)", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", KEY))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", KEY, { draft: productDraft.parse({ ...d, commercial: { ...d.commercial, benefits: ["Otro texto"] } }), expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", KEY, saved.draftVersion, "operator:1");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: AUTOMATIONS_LISTING_2026_11_09 });
    expect(r.changed).toEqual([]);
    expect(r.conflicts[0]).toMatch(/benefits/);
  });
});
