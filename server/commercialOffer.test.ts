/**
 * Modalidad comercial (`catalog.offer`): reglas de `effectiveOffer` (todas las degradaciones) y su presencia en la
 * salida pública del sitio y en la instantánea del cotizador.
 */
import { describe, it, expect } from "vitest";
import { effectiveOffer, OFFER_MODALITY_LABEL, type OfferConfig } from "./catalog/commercial/offer";
import { commercialChecks } from "./catalog/commercial/checks";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService, withoutUnpublished } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const PRICE = [{ kind: "monthly", amountCents: 1000 }];
const prod = (offer: OfferConfig | undefined, o: { commercial?: string; technical?: string; prices?: object[] } = {}) => ({
  technicalStatus: o.technical ?? "available",
  catalog: { commercialStatus: o.commercial ?? "available", offer },
  prices: o.prices ?? PRICE,
});

describe("effectiveOffer", () => {
  it("sin configurar: implantación asistida con propuesta y sin motivos", () => {
    expect(effectiveOffer(prod(undefined))).toEqual({ modality: "assisted", trial: false, checkout: false, cta: "proposal", reasons: [], label: "Implantación asistida", activationNotes: null });
    expect(effectiveOffer({})).toMatchObject({ modality: "assisted", cta: "proposal" });
  });

  it("inmediata con prueba → CTA prueba; sin prueba y con checkout → CTA checkout", () => {
    expect(effectiveOffer(prod({ modality: "immediate", trial: true, checkout: true }))).toMatchObject({ modality: "immediate", trial: true, checkout: true, cta: "trial", reasons: [], label: "Disponible" });
    expect(effectiveOffer(prod({ modality: "immediate", checkout: true }))).toMatchObject({ modality: "immediate", trial: false, checkout: true, cta: "checkout", reasons: [] });
  });

  it("inmediata exige estado comercial «available»", () => {
    for (const commercial of ["on_request", "in_preparation", "coming_soon", "unpublished"]) {
      const r = effectiveOffer(prod({ modality: "immediate", trial: true, checkout: true, cta: "trial" }, { commercial }));
      expect(r).toMatchObject({ modality: "assisted", trial: false, checkout: false, cta: "proposal", label: "Implantación asistida" });
      expect(r.reasons[0]).toMatch(/estado comercial/);
    }
  });

  it("inmediata exige estado técnico «available»", () => {
    const r = effectiveOffer(prod({ modality: "immediate", trial: true }, { technical: "partial" }));
    expect(r.modality).toBe("assisted");
    expect(r.reasons).toContain("Se ofrecerá como implantación asistida porque el estado técnico es parcial");
    expect(effectiveOffer(prod({ modality: "immediate", trial: true }, { technical: "planned" })).modality).toBe("assisted");
    expect(effectiveOffer({ catalog: { commercialStatus: "available", offer: { modality: "immediate", trial: true } } }).modality).toBe("assisted");
  });

  it("prueba y checkout solo en modalidad inmediata", () => {
    const r = effectiveOffer(prod({ modality: "assisted", trial: true, checkout: true }));
    expect(r).toMatchObject({ modality: "assisted", trial: false, checkout: false, cta: "proposal" });
    expect(r.reasons).toHaveLength(2);
  });

  it("checkout exige un precio publicado no borrador", () => {
    const sinPrecio = effectiveOffer(prod({ modality: "immediate", trial: true, checkout: true }, { prices: [] }));
    expect(sinPrecio).toMatchObject({ modality: "immediate", trial: true, checkout: false, cta: "trial" });
    expect(sinPrecio.reasons[0]).toMatch(/precio publicado/);
    expect(effectiveOffer(prod({ modality: "immediate", trial: true, checkout: true }, { prices: [{ kind: "monthly", draft: true }] })).checkout).toBe(false);
    expect(effectiveOffer(prod({ modality: "immediate", trial: true, checkout: true }, { prices: [{ status: "draft" }] })).checkout).toBe(false);
    expect(effectiveOffer(prod({ modality: "immediate", checkout: true }, { prices: [{ status: "approved" }] })).checkout).toBe(true);
  });

  it("inmediata sin nada inmediato que entregar se degrada a asistida", () => {
    const r = effectiveOffer(prod({ modality: "immediate" }));
    expect(r).toMatchObject({ modality: "assisted", cta: "proposal" });
    expect(r.reasons[0]).toMatch(/no hay prueba ni checkout/);
    // Checkout pedido sin precio y sin prueba: tampoco queda nada inmediato
    const s = effectiveOffer(prod({ modality: "immediate", checkout: true, cta: "checkout" }, { prices: [] }));
    expect(s).toMatchObject({ modality: "assisted", checkout: false, cta: "proposal" });
    expect(s.reasons).toHaveLength(3);
  });

  it("CTA de acceso inmediato en asistida → propuesta; CTA sin su acceso activo → la de por defecto", () => {
    for (const cta of ["trial", "checkout"] as const) {
      const r = effectiveOffer(prod({ modality: "assisted", cta }));
      expect(r.cta).toBe("proposal");
      expect(r.reasons).toHaveLength(1);
    }
    expect(effectiveOffer(prod({ modality: "immediate", checkout: true, cta: "trial" }))).toMatchObject({ cta: "checkout", reasons: [expect.stringMatching(/no está activa/)] });
    expect(effectiveOffer(prod({ modality: "immediate", trial: true, cta: "checkout" }))).toMatchObject({ cta: "trial" });
  });

  it("los demás CTA se respetan en las dos modalidades; las condiciones se recortan", () => {
    for (const cta of ["proposal", "specialist", "configure", "implementation", "advised"] as const) {
      expect(effectiveOffer(prod({ modality: "assisted", cta })).cta).toBe(cta);
      expect(effectiveOffer(prod({ modality: "immediate", trial: true, cta })).cta).toBe(cta);
    }
    expect(effectiveOffer(prod({ activationNotes: "  Requiere dominio propio  " })).activationNotes).toBe("Requiere dominio propio");
    expect(effectiveOffer(prod({ activationNotes: "   " })).activationNotes).toBeNull();
  });

  it("etiquetas públicas sin «Próximamente»", () => {
    expect(OFFER_MODALITY_LABEL).toEqual({ immediate: "Disponible", assisted: "Implantación asistida" });
  });
});

describe("esquema y revisión de `catalog.offer`", () => {
  const base = { name: "X", technicalStatus: "available", activation: { kind: "none" }, billingModel: "subscription" };
  it("es opcional y sin valores por defecto; rechaza campos y valores desconocidos", () => {
    expect(productDraft.parse(base).catalog.offer).toBeUndefined();
    expect(productDraft.parse({ ...base, catalog: { offer: {} } }).catalog.offer).toEqual({});
    expect(() => productDraft.parse({ ...base, catalog: { offer: { modality: "instant" } } })).toThrow();
    expect(() => productDraft.parse({ ...base, catalog: { offer: { cta: "demo" } } })).toThrow();
    expect(() => productDraft.parse({ ...base, catalog: { offer: { otro: 1 } } })).toThrow();
  });
  it("avisa de la degradación y bloquea condiciones con importes", () => {
    const draft = productDraft.parse({ ...base, technicalStatus: "partial", catalog: { commercialStatus: "on_request", offer: { modality: "immediate", trial: true, activationNotes: "Desde 10 € al mes" } } });
    const c = commercialChecks({ key: "x", family: "connect", publication: "draft", draft }, []);
    expect(c.warnings.some((w) => w.startsWith("modalidad comercial:"))).toBe(true);
    expect(c.blocking.some((b) => b.startsWith("las condiciones de activación importe"))).toBe(true);
  });
});

const NOW = Date.UTC(2026, 9, 30, 9);
const setup = async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  return web;
};
const configure = async (web: WebAdminService, key: string, patch: { technicalStatus?: string; catalog: Record<string, unknown>; internal?: Record<string, unknown> }) => {
  const { entry: e } = await web.get("product", key);
  const draft = structuredClone(e.draft) as Record<string, any>;
  if (patch.technicalStatus) draft.technicalStatus = patch.technicalStatus;
  draft.catalog = { ...draft.catalog, ...patch.catalog };
  draft.internal = { ...draft.internal, ...patch.internal };
  const saved = await web.save("product", key, { draft, expectedVersion: e.draftVersion }, "operator:test");
  await web.publish("product", key, saved.draftVersion, "operator:test");
};
type PubProduct = { key: string; offer?: ReturnType<typeof effectiveOffer>; catalog?: { offer?: unknown } };
const find = (site: { catalog: { products: unknown[] } }, key: string) => (site.catalog.products as PubProduct[]).find((p) => p.key === key);

describe("modalidad comercial en la salida pública y en el cotizador", () => {
  it("todo producto publicado lleva su `offer` efectivo; sin configurar, implantación asistida", async () => {
    const web = await setup();
    const site = await web.publicSite("published");
    expect(site.catalog.products.length).toBeGreaterThan(0);
    for (const p of site.catalog.products as PubProduct[]) expect(p.offer).toMatchObject({ modality: "assisted", trial: false, checkout: false, cta: "proposal" });
    const quote = quoteCatalogFromSite(site);
    for (const p of quote.products) expect(p.offer?.modality).toBe("assisted");
    // Determinista: la versión no cambia entre dos lecturas
    expect((await web.publicSite("published")).version).toBe(site.version);
  });

  it("inmediata configurada y entregable: sale tal cual; degradada: sale asistida con el motivo", async () => {
    const web = await setup();
    const before = await web.publicSite("published");
    const key = "essential";
    await configure(web, key, { technicalStatus: "available", catalog: { commercialStatus: "available", offer: { modality: "immediate", trial: true, checkout: true } }, internal: { functionalGrade: "in_use", evidence: "pruebas" } });
    const site = await web.publicSite("published");
    expect(site.version).not.toBe(before.version);
    const p = find(site, key)!;
    expect(p.catalog?.offer).toEqual({ modality: "immediate", trial: true, checkout: true });
    expect(p.offer).toMatchObject({ modality: "immediate", trial: true, cta: "trial", label: "Disponible" });
    expect(p.offer!.checkout).toBe((site.catalog.products.find((x) => x.key === key)!.prices.length > 0));
    expect(quoteCatalogFromSite(site).products.find((x) => x.key === key)!.offer).toEqual(p.offer);

    await configure(web, key, { technicalStatus: "partial", catalog: { commercialStatus: "on_request" }, internal: { functionalGrade: "partial" } });
    const degraded = find(await web.publicSite("published"), key)!;
    expect(degraded.offer).toMatchObject({ modality: "assisted", trial: false, checkout: false, cta: "proposal", label: "Implantación asistida" });
    expect(degraded.offer!.reasons[0]).toMatch(/implantación asistida porque el estado comercial/);
  });

  it("el estado comercial «No publicado» no aparece en la salida pública (sí en el documento interno)", async () => {
    const web = await setup();
    const key = "connect-tax";
    await configure(web, key, { catalog: { commercialStatus: "unpublished" } });
    expect(find(await web.site("published"), key)).toBeDefined();
    const pub = await web.publicSite("published");
    expect(find(pub, key)).toBeUndefined();
    // Sin productos «No publicado», el documento no cambia (misma versión)
    const clean = await (await setup()).site("published");
    expect(withoutUnpublished(clean)).toBe(clean);
  });
});
