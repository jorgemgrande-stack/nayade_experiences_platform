/**
 * Revisión del catálogo del 09/11/2026: Elephant WhatsApp AI de «En preparación» a implantación acompañada con su ficha
 * real (sin checkout ni Price de Stripe: `stripePrepared: false`). Imprime la simulación (productos y campos que cambian).
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { REVIEW_ID_2026_11_09_WHATSAPP, WHATSAPP_LISTING_2026_11_09 } from "./catalog/review20261109whatsapp";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_09_WHATSAPP}`;
const KEY = "connect-whatsapp-ai";

/** Como production el 09/11/2026: WhatsApp AI «En preparación» (técnico partial, activación feature, nivel 2) con su ficha publicada. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  const c = WHATSAPP_LISTING_2026_11_09[0];
  const e = (await store.getEntry("product", c.key))!;
  const d = productDraft.parse(e.draft);
  const commercial: Record<string, unknown> = { ...(d.commercial ?? {}), headline: "Responde por WhatsApp también cuando no estás.", cta: "contact" };
  for (const [f, v] of Object.entries(c.fields)) if (v!.from !== undefined) commercial[f] = v!.from;
  const draft = {
    ...d,
    thirdPartyCosts: c.thirdPartyCosts!.from,
    technicalStatus: "partial" as const,
    activation: { kind: "feature" as const, ref: null },
    catalog: { ...d.catalog, commercialStatus: c.status!.from, implementationLevel: c.implementationLevel!.from },
    commercial,
    internal: { ...d.internal, functionalGrade: "partial" as const },
  };
  const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
  await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  return { store, svc };
}

describe("revisión del 09/11/2026: Elephant WhatsApp AI", () => {
  it("solo WhatsApp AI pasa a implantación acompañada, con su ficha (pasa las comprobaciones del CRM) y sin tocar precios", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const before = new Map((await k.store.listEntries({ kind: "product" })).filter((e) => e.key !== KEY).map((e) => [e.key, e.draftVersion]));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: WHATSAPP_LISTING_2026_11_09 });
    // Simulación que reporta el coordinador
    console.log(JSON.stringify({ revision: REVIEW_ID_2026_11_09_WHATSAPP, ...sim }));
    expect(sim).toEqual({
      apply: false,
      changed: ["connect-whatsapp-ai: in_preparation → on_request; ficha (valueProposition, longDescription, benefits, excludes, integrations, coreIntegration, terms, faq)"],
      already: [],
      conflicts: [],
    });
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: WHATSAPP_LISTING_2026_11_09 });
    expect(r.conflicts).toEqual([]);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) if (e.key !== KEY) expect(e.draftVersion, e.key).toBe(before.get(e.key));
    const d = productDraft.parse((await k.store.getEntry("product", KEY))!.draft);
    expect(d).toMatchObject({
      technicalStatus: "partial",
      activation: { kind: "feature" },
      catalog: { commercialStatus: "on_request", stripePrepared: false, implementationLevel: 1 },
      commercial: { cta: "contact", headline: "Responde por WhatsApp también cuando no estás." },
      internal: { functionalGrade: "in_use" },
    });
    expect(d.thirdPartyCosts).toContain("las factura Meta");
    expect(d.commercial?.valueProposition).not.toMatch(/Próximamente/);
    expect(d.commercial?.faq?.[0].q).toBe("¿Cómo se pone en marcha?");
    expect(JSON.stringify(d.commercial?.faq)).toMatch(/número aprobado/);
    expect(JSON.stringify(d.commercial?.faq)).toMatch(/plantillas aprobadas/);
    // La base de conocimiento se edita desde WhatsApp AI (compartida con Reception AI)
    expect(d.commercial?.coreIntegration?.some((x) => /editas desde WhatsApp/.test(x))).toBe(true);
    // El Paquete Communications no cambia
    expect(before.get("connect-pack-communications")).toBeDefined();
    // Sin checkout: implantación asistida en la web y el cotizador
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    expect(cat.products.find((p) => p.key === KEY)!.offer).toMatchObject({ modality: "assisted", checkout: false });
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: WHATSAPP_LISTING_2026_11_09 });
    expect(again.already).toEqual([KEY]);
  });

  it("si en el CRM ya cambió un campo de partida, no lo pisa (conflicto)", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", KEY))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", KEY, { draft: productDraft.parse({ ...d, commercial: { ...d.commercial!, benefits: ["Otro texto decidido en el CRM"] } }), expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", KEY, saved.draftVersion, "operator:1");
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: WHATSAPP_LISTING_2026_11_09 });
    expect(sim.changed).toEqual([]);
    expect(sim.conflicts[0]).toMatch(/benefits/);
  });
});
