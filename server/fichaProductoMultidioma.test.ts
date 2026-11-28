/**
 * Fichas de producto multidioma (tienda de cada empresa): una sola identidad de producto con una representación por
 * idioma. Rutas `/:locale/tienda/:slug` con slug traducido y redirección, superposición de las traducciones VALIDADAS
 * (producto, opciones, convocatorias) con aviso explícito si falta, enlaces, selector de idioma, SEO y sitemap, textos
 * de la interfaz en el idioma de la página e intercambio del idioma principal. Todo en memoria (sin BD).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createBlock, DEFAULT_FORM_CONSENT_TEXT } from "../shared/pageBlocks";
import { buildConfig, internalProductSlugs, localizeBlockLinks, localizeProductLink, productRest, productSlugOfPath } from "../shared/i18n";
import { SITE_UI_TEXT, consentSentence, editionStateText, fillUiText, offerBadgeText, siteUiText, untranslatedNotice } from "../shared/siteUiText";
import { CATALOG_SWAP_COLUMNS, swapCatalogFields } from "../shared/i18nSwap";
import { formatEditionDates } from "../shared/editions";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import {
  I18nError, addLocale, localizeMenu, resolveProductLocale, resolveRequest, saveContentTranslationDraft, savePageTranslationDraft,
  sitemapAlternates, validateContentTranslation, validateLocale, validatePageTranslation, type PrincipalProduct,
} from "./i18nService";
import { localizeEditions, localizeProductBySlug, localizeVariants, overlayProduct } from "./i18nProducts";
import { i18nSitemapPlan } from "./sitemapI18n";
import { processProductRequest } from "./productRequests";
import { switcherQuery } from "../client/src/components/LanguageSwitcher";
import { initialOption } from "../client/src/pages/ProductDetail";

const ORIGIN = "https://ejemplo.test";
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const pages = [
  { id: 1, slug: "inicio", title: "Inicio", isPublished: true },
  { id: 2, slug: "cursos", title: "Cursos", isPublished: true },
];
const products: PrincipalProduct[] = [
  { id: 7, slug: "curso-yoga", isPublished: true, updatedAt: new Date("2026-11-10T10:00:00Z") },
  { id: 8, slug: "retiro", isPublished: true },
  { id: 9, slug: "oculto", isPublished: false },
];

/** Empresa con alemán e inglés validados (francés en borrador) y el curso 7 traducido y validado al alemán. */
async function shop(opts: { withProducts?: boolean } = {}) {
  const repo = memoryI18nRepo({ pages, home: "inicio", ...(opts.withProducts === false ? {} : { products }) });
  for (const l of ["de", "en", "fr"]) await addLocale(repo, l, "ana");
  await validateLocale(repo, "de", "ana");
  await validateLocale(repo, "en", "ana");
  await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "7", locale: "de", slug: "yoga-kurs", fields: { title: "Yogakurs", shortDescription: "Für alle", includes: "Matte\nTee" } });
  await validateContentTranslation(repo, "product", "7", "de", "ana");
  return repo;
}

describe("enlaces a fichas de producto", () => {
  const cfg = buildConfig([{ locale: "es", isDefault: true, status: "validated", sortOrder: 0 }, { locale: "de", isDefault: false, status: "validated", sortOrder: 1 }]);
  it("lee el slug de /tienda/<slug> con consulta y ancla", () => {
    expect(productSlugOfPath("/tienda/curso-yoga")).toBe("curso-yoga");
    expect(productSlugOfPath("/tienda/curso-yoga?opcion=8#reservar")).toBe("curso-yoga");
    expect([productSlugOfPath("/tienda"), productSlugOfPath("/tienda/a/b"), productSlugOfPath("/cursos")]).toEqual([null, null, null]);
    expect(productRest("curso-yoga")).toBe("/tienda/curso-yoga");
  });
  it("traduce /tienda/<slug> al idioma conservando ?opcion= y el ancla", () => {
    const slug = (s: string) => (s === "curso-yoga" ? "yoga-kurs" : s === "retiro" ? "retiro" : null);
    expect(localizeProductLink("/tienda/curso-yoga?opcion=8#reservar", "de", cfg, slug)).toBe("/de/tienda/yoga-kurs?opcion=8#reservar");
    expect(localizeProductLink("/tienda/retiro", "de", cfg, slug)).toBe("/de/tienda/retiro");
    expect(localizeProductLink("/tienda/no-existe", "de", cfg, slug)).toBe("/tienda/no-existe");
    expect(localizeProductLink("/cursos", "de", cfg, slug)).toBeNull();
  });
  it("en los bloques: con el buscador de slugs se localiza; sin él, como antes", () => {
    const blocks = [createBlock("hero", { title: "Hola", subtitle: "", buttonLabel: "Ver", buttonUrl: "/tienda/curso-yoga?opcion=8" })];
    expect(internalProductSlugs(blocks)).toEqual(["curso-yoga"]);
    const out = localizeBlockLinks(blocks, "de", cfg, () => false, () => "yoga-kurs");
    expect((out[0].data as { buttonUrl: string }).buttonUrl).toBe("/de/tienda/yoga-kurs?opcion=8");
    expect((localizeBlockLinks(blocks, "de", cfg, () => false)[0].data as { buttonUrl: string }).buttonUrl).toBe("/tienda/curso-yoga?opcion=8");
    expect(localizeBlockLinks(blocks, "es", cfg, () => true, () => "x")).toBe(blocks);
  });
});

describe("resolución de la ficha en un idioma", () => {
  it("slug traducido, redirección desde el del principal y alternativas de la misma ficha", async () => {
    const repo = await shop();
    const de = await resolveProductLocale(repo, "de", "yoga-kurs");
    expect(de).toMatchObject({ kind: "product", locale: "de", contentLocale: "de", translated: true, slug: "yoga-kurs" });
    if (de.kind !== "product") throw new Error();
    expect(de.product.id).toBe(7);
    expect(de.alternates).toEqual([{ locale: "es", path: "/tienda/curso-yoga" }, { locale: "de", path: "/de/tienda/yoga-kurs" }, { locale: "en", path: "/en/tienda/curso-yoga" }]);
    expect(de.versions.map((v) => v.locale)).toEqual(["es", "de"]);
    expect(await resolveProductLocale(repo, "de", "curso-yoga")).toMatchObject({ kind: "redirect", to: "/de/tienda/yoga-kurs" });
  });
  it("sin traducción: contenido del principal declarado como tal (nunca como inglés)", async () => {
    const repo = await shop();
    expect(await resolveProductLocale(repo, "en", "curso-yoga")).toMatchObject({ kind: "product", locale: "en", contentLocale: "es", translated: false, translation: null, slug: "curso-yoga" });
    // El slug alemán no es una dirección inglesa
    expect((await resolveProductLocale(repo, "en", "yoga-kurs")).kind).toBe("notFound");
  });
  it("idioma sin validar, producto sin publicar, traducción en borrador o repositorio sin productos: no hay ficha", async () => {
    const repo = await shop();
    expect((await resolveProductLocale(repo, "fr", "curso-yoga")).kind).toBe("notFound");
    expect((await resolveProductLocale(repo, "xx", "curso-yoga")).kind).toBe("notFound");
    expect((await resolveProductLocale(repo, "de", "oculto")).kind).toBe("notFound");
    await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "8", locale: "de", slug: "retreat", fields: { title: "Retreat" } });
    expect((await resolveProductLocale(repo, "de", "retreat")).kind).toBe("notFound");
    expect(await resolveProductLocale(repo, "de", "retiro")).toMatchObject({ kind: "product", translated: false });
    expect((await resolveProductLocale(await shop({ withProducts: false }), "de", "curso-yoga")).kind).toBe("notFound");
  });
});

describe("resolveRequest: SEO de la ficha", () => {
  it("traducida: canónica propia, hreflang de las versiones con contenido y título traducido", async () => {
    const r = await resolveRequest(await shop(), "/de/tienda/yoga-kurs", ORIGIN);
    if (r.kind !== "product") throw new Error(r.kind);
    expect(r).toMatchObject({ prefixed: true, locale: "de", productId: 7, principalSlug: "curso-yoga", translated: true, meta: { title: "Yogakurs", metaDescription: "Für alle" } });
    expect(r.seo).toMatchObject({ htmlLang: "de", canonical: `${ORIGIN}/de/tienda/yoga-kurs`, noindex: false });
    expect(r.seo.alternates).toEqual([
      { hreflang: "es", href: `${ORIGIN}/tienda/curso-yoga` },
      { hreflang: "de", href: `${ORIGIN}/de/tienda/yoga-kurs` },
      { hreflang: "x-default", href: `${ORIGIN}/tienda/curso-yoga` },
    ]);
    expect(r.switcher.map((a) => a.href)).toEqual(["/tienda/curso-yoga", "/de/tienda/yoga-kurs", "/en/tienda/curso-yoga"]);
  });
  it("sin traducción: canónica al principal, noindex, sin hreflang; el selector sigue ofreciendo los idiomas", async () => {
    const r = await resolveRequest(await shop(), "/en/tienda/curso-yoga", ORIGIN);
    if (r.kind !== "product") throw new Error(r.kind);
    expect(r).toMatchObject({ translated: false, meta: null });
    expect(r.seo).toMatchObject({ htmlLang: "en", canonical: `${ORIGIN}/tienda/curso-yoga`, noindex: true, alternates: [] });
    expect(r.switcher).toHaveLength(3);
  });
  it("principal: hreflang a sus traducciones; 301 al slug traducido; el slug que solo existe traducido lleva a su idioma", async () => {
    const repo = await shop();
    const es = await resolveRequest(repo, "/tienda/curso-yoga", ORIGIN);
    expect(es.kind === "product" && es.prefixed === false && es.seo.alternates.map((a) => a.hreflang)).toEqual(["es", "de", "x-default"]);
    expect(await resolveRequest(repo, "/de/tienda/curso-yoga", ORIGIN)).toEqual({ kind: "redirect", to: "/de/tienda/yoga-kurs", status: 301 });
    expect(await resolveRequest(repo, "/tienda/yoga-kurs", ORIGIN)).toEqual({ kind: "redirect", to: "/de/tienda/yoga-kurs", status: 301 });
    expect(await resolveRequest(repo, "/tienda/no-existe", ORIGIN)).toEqual({ kind: "passthrough" });
    expect(await resolveRequest(repo, "/de/tienda/no-existe", ORIGIN)).toEqual({ kind: "notFound" });
    expect(await resolveRequest(repo, "/fr/tienda/curso-yoga", ORIGIN)).toEqual({ kind: "notFound" });
  });
  it("sin productos en el repositorio, la tienda se comporta como antes", async () => {
    const repo = await shop({ withProducts: false });
    expect(await resolveRequest(repo, "/tienda/curso-yoga", ORIGIN)).toEqual({ kind: "passthrough" });
    expect(await resolveRequest(repo, "/de/tienda/curso-yoga", ORIGIN)).toEqual({ kind: "notFound" });
  });
  it("una página traducida enlaza a la ficha del mismo producto en su idioma (con ?opcion=)", async () => {
    const repo = await shop();
    const b = [createBlock("hero", { title: "Kurse", subtitle: "", buttonLabel: "Buchen", buttonUrl: "/tienda/curso-yoga?opcion=8" }), createBlock("hero", { title: "Retreat", subtitle: "", buttonLabel: "Mehr", buttonUrl: "/tienda/retiro" })];
    await savePageTranslationDraft(repo, 2, "de", { title: "Kurse", slug: "kurse", blocks: b }, b);
    await validatePageTranslation(repo, 2, "de", "ana");
    const r = await resolveRequest(repo, "/de/kurse", ORIGIN);
    if (r.kind !== "page" || !r.page?.blocks) throw new Error(r.kind);
    expect(r.page.blocks.map((x) => (x.data as { buttonUrl: string }).buttonUrl)).toEqual(["/de/tienda/yoga-kurs?opcion=8", "/de/tienda/retiro"]);
  });
  it("el menú del idioma lleva a la ficha localizada", async () => {
    const repo = await shop();
    await saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "1", locale: "de", fields: { label: "Yoga" } });
    await validateContentTranslation(repo, "menu_item", "1", "de", "ana");
    const out = await localizeMenu(repo, [{ id: 1, parentId: null, label: "Yoga", url: "/tienda/curso-yoga?opcion=3" }], "de");
    expect(out).toEqual([{ id: 1, parentId: null, label: "Yoga", url: "/de/tienda/yoga-kurs?opcion=3" }]);
  });
});

describe("sitemap", () => {
  it("cada producto publicado con traducción validada entra con sus alternativas; los no traducidos no", async () => {
    const repo = await shop();
    const { entries } = await sitemapAlternates(repo, products);
    expect(entries).toEqual([{ rest: "/tienda/curso-yoga", versions: [{ locale: "es", rest: "/tienda/curso-yoga" }, { locale: "de", rest: "/tienda/yoga-kurs" }], lastmod: "2026-11-10" }]);
    const plan = await i18nSitemapPlan(repo, ORIGIN, products);
    expect(plan?.alternatesFor.get("/tienda/curso-yoga")?.map((a) => a.hreflang)).toEqual(["es", "de", "x-default"]);
    expect(plan?.extra.map((x) => x.loc)).toEqual(["/de/tienda/yoga-kurs"]);
    // Sin productos (ficha sectorial o ninguno publicado): el sitemap multidioma es el de siempre
    expect((await sitemapAlternates(repo)).entries).toEqual([]);
  });
});

describe("traducciones de opciones y convocatorias", () => {
  it("campos permitidos por tipo, identificador numérico y dirección solo para productos", async () => {
    const repo = await shop();
    await saveContentTranslationDraft(repo, { entityType: "variant", entityKey: "31", locale: "de", fields: { name: "Live", description: "Online" } });
    await saveContentTranslationDraft(repo, { entityType: "edition", entityKey: "5", locale: "de", fields: { label: "Frühling", scheduleNote: "Mo–Fr", locationNote: "Berlin" } });
    await expect(saveContentTranslationDraft(repo, { entityType: "variant", entityKey: "31", locale: "de", fields: { priceModifier: "0" } })).rejects.toThrow(/no se puede traducir/);
    await expect(saveContentTranslationDraft(repo, { entityType: "edition", entityKey: "5", locale: "de", fields: { capacity: "10" } })).rejects.toBeInstanceOf(I18nError);
    await expect(saveContentTranslationDraft(repo, { entityType: "variant", entityKey: "abc", locale: "de", fields: { name: "x" } })).rejects.toThrow(/Identificador/);
    await expect(saveContentTranslationDraft(repo, { entityType: "variant", entityKey: "31", locale: "de", slug: "live", fields: { name: "x" } })).rejects.toThrow(/Solo los productos/);
    await expect(saveContentTranslationDraft(repo, { entityType: "edition", entityKey: "5", locale: "es", fields: { label: "x" } })).rejects.toBeInstanceOf(I18nError);
  });
  it("solo se superpone lo validado, y solo en un idioma adicional público", async () => {
    const repo = await shop();
    const variants = [{ id: 31, name: "En directo", description: "En línea", priceModifier: "90" }, { id: 32, name: "Presencial", description: null, priceModifier: "120" }];
    await saveContentTranslationDraft(repo, { entityType: "variant", entityKey: "31", locale: "de", fields: { name: "Live" } });
    expect(await localizeVariants(repo, variants, "de")).toEqual(variants);
    await validateContentTranslation(repo, "variant", "31", "de", "ana");
    expect(await localizeVariants(repo, variants, "de")).toEqual([{ ...variants[0], name: "Live" }, variants[1]]);
    expect(await localizeVariants(repo, variants, "es")).toEqual(variants);
    expect(await localizeVariants(repo, variants, "fr")).toEqual(variants);

    const editions = [{ id: 5, experienceId: 7, productTitle: "Curso de yoga", productSlug: "curso-yoga", label: "Primavera", scheduleNote: "L–V", locationNote: "Madrid", seatsLeft: 3, startsAt: 1 }];
    await saveContentTranslationDraft(repo, { entityType: "edition", entityKey: "5", locale: "de", fields: { label: "Frühling", locationNote: "Berlin" } });
    await validateContentTranslation(repo, "edition", "5", "de", "ana");
    expect(await localizeEditions(repo, editions, "de")).toEqual([{ ...editions[0], label: "Frühling", locationNote: "Berlin", productTitle: "Yogakurs", productSlug: "yoga-kurs" }]);
    expect(await localizeEditions(repo, editions, "en")).toEqual(editions);
    expect(await localizeEditions(repo, editions, undefined)).toEqual(editions);

    // Categoría del producto (antetítulo de la tarjeta de la web): solo con traducción validada; sin categoría, tal cual
    const withCategory = [{ ...editions[0], categoryId: 4, categoryName: "Retiros" }, { ...editions[0], id: 6, categoryId: null, categoryName: null }];
    await saveContentTranslationDraft(repo, { entityType: "category", entityKey: "4", locale: "de", fields: { name: "Retreats" } });
    expect((await localizeEditions(repo, withCategory, "de")).map((e) => e.categoryName)).toEqual(["Retiros", null]);
    await validateContentTranslation(repo, "category", "4", "de", "ana");
    expect((await localizeEditions(repo, withCategory, "de")).map((e) => e.categoryName)).toEqual(["Retreats", null]);
    expect((await localizeEditions(repo, withCategory, "en")).map((e) => e.categoryName)).toEqual(["Retiros", null]);
  });
  it("producto: textos superpuestos, listas por líneas; precio e imágenes, del principal", async () => {
    const base = { id: 7, slug: "curso-yoga", title: "Curso de yoga", shortDescription: "Para todos", description: "Largo", basePrice: "90.00", includes: ["Esterilla"], image1: "https://x/y.jpg" };
    const repo = await shop();
    const r = await localizeProductBySlug(repo, "yoga-kurs", "de", async (s) => (s === "curso-yoga" ? base : null));
    if (r.kind !== "ok") throw new Error();
    expect(r.product).toEqual({ ...base, title: "Yogakurs", shortDescription: "Für alle", includes: ["Matte", "Tee"] });
    expect(r.i18n).toMatchObject({ locale: "de", contentLocale: "de", translated: true });
    const en = await localizeProductBySlug(repo, "curso-yoga", "en", async () => base);
    expect(en.kind === "ok" && en.product).toBe(base);
    expect(en.kind === "ok" && en.i18n).toMatchObject({ locale: "en", contentLocale: "es", translated: false });
    const red = await localizeProductBySlug(repo, "curso-yoga", "de", async () => base);
    expect(red.kind === "ok" && red.i18n.redirectTo).toBe("/de/tienda/yoga-kurs");
    expect((await localizeProductBySlug(repo, "curso-yoga", "fr", async () => base)).kind).toBe("notFound");
    expect(overlayProduct(base, null)).toBe(base);
  });
});

describe("textos de la interfaz en el idioma de la página", () => {
  it("los tres idiomas tienen las mismas claves", () => {
    const keys = Object.keys(SITE_UI_TEXT.es).sort();
    expect(Object.keys(SITE_UI_TEXT.de).sort()).toEqual(keys);
    expect(Object.keys(SITE_UI_TEXT.en).sort()).toEqual(keys);
  });
  it("ficha, insignias, convocatorias y aviso de ficha sin traducir", () => {
    expect([siteUiText("de").from, siteUiText("de").options, siteUiText("en").vatIncluded, siteUiText("es").addToCart]).toEqual(["ab", "Optionen", "VAT included", "Añadir al carrito"]);
    expect([offerBadgeText(siteUiText("de"), "on_request"), offerBadgeText(siteUiText("es"), "coming_soon"), offerBadgeText(siteUiText("en"), "fixed")]).toEqual(["Auf Anfrage", "Próximamente", ""]);
    expect(editionStateText(siteUiText("de"), "waitlist")).toBe("Warteliste");
    expect(fillUiText(siteUiText("de").seatsLeft, { n: 4 })).toBe("Noch 4 Plätze frei");
    expect(untranslatedNotice("es", "de")).toBe("Esta ficha todavía no está traducida; se muestra en alemán.");
    expect(untranslatedNotice("de", "es")).toBe("Diese Seite ist noch nicht übersetzt; sie wird auf Spanisch angezeigt.");
    // El consentimiento en español es exactamente el de siempre (misma versión guardada)
    expect(consentSentence(siteUiText("es"))).toBe(DEFAULT_FORM_CONSENT_TEXT);
    expect(formatEditionDates(Date.UTC(2026, 10, 20, 9), null, "Europe/Berlin", false, "de-DE")).toBe("20. November 2026");
    expect(formatEditionDates(Date.UTC(2026, 10, 20, 9), null, "Europe/Madrid")).toBe("20 de noviembre de 2026");
  });
  it("las respuestas a la solicitud llegan en el idioma de la web", async () => {
    const ctx = { ip: "1.2.3.4", tenantId: "t1", ipSecret: "s" };
    const base = { experienceId: 7, name: "A", email: "a@b.de", consent: true };
    await expect(processProductRequest({ ...base, lang: "de" }, ctx)).rejects.toThrow("Bitte gib deinen Namen ein.");
    await expect(processProductRequest({ ...base, name: "Ana", consent: false, lang: "en" }, ctx)).rejects.toThrow("Tick the privacy box to continue.");
    await expect(processProductRequest(base, ctx)).rejects.toThrow("Escribe tu nombre.");
  });
  it("la ficha, el formulario y las convocatorias no tienen textos fijos en español y declaran el idioma de la URL", () => {
    const detail = read("client/src/pages/ProductDetail.tsx");
    const form = read("client/src/components/site/ProductRequestForm.tsx");
    const editions = read("client/src/components/site/Editions.tsx");
    for (const t of [">Inicio<", ">Tienda<", ">Desde<", ">Opciones<", "OFFER_MODE_PUBLIC_LABELS", "IVA incluido</p>"]) expect(detail, t).not.toContain(t);
    expect(detail).toContain("untranslatedNotice(i18n.locale, i18n.contentLocale)");
    expect(detail).toContain("lang={contentLang}");
    expect(detail).toContain("<Redirect to={i18n.redirectTo");
    for (const t of [">Nombre *<", "|| \"Enviar solicitud\"", "documentElement.lang"]) expect(form, t).not.toContain(t);
    expect(form).toContain("lang: site.locale");
    for (const t of ["\"Solicitar plaza\"", ">Próximas fechas<", "PUBLIC_EDITION_STATE_LABELS"]) expect(editions, t).not.toContain(t);
    expect(read("client/src/App.tsx")).toContain('<Route path="/:locale/tienda/:slug">{(p) => <LocaleProductGate locale={p.locale} Product={ProductDetail} />}</Route>');
  });
  it("selector de idioma: conserva ?opcion= en una ficha, y la opción se sigue leyendo en la ruta localizada", () => {
    expect(switcherQuery("/de/tienda/yoga-kurs", "?opcion=8&utm=x")).toBe("?opcion=8");
    expect(switcherQuery("/tienda/curso-yoga", "?opcion=8")).toBe("?opcion=8");
    expect(switcherQuery("/de/kurse", "?opcion=8")).toBe("");
    expect(switcherQuery("/tienda/curso-yoga", "?opcion=abc")).toBe("");
    expect(initialOption("?opcion=8")).toBe(8);
  });
});

describe("cambio de idioma principal: catálogo (función pura preparada, aún sin usar)", () => {
  it("la traducción al idioma nuevo pasa a la base y lo anterior queda como traducción (solo los campos que trae)", () => {
    const r = swapCatalogFields("product", { id: 7, slug: "curso-yoga", title: "Curso de yoga", shortDescription: null, includes: '["Esterilla","Té"]', basePrice: "90" }, { title: "Yogakurs", shortDescription: "Für alle", includes: "Matte\nTee", price: "1" });
    expect(r.update).toEqual({ title: "Yogakurs", shortDescription: "Für alle", includes: JSON.stringify(["Matte", "Tee"]) });
    expect(r.oldFields).toEqual({ title: "Curso de yoga", includes: "Esterilla\nTé" });
    expect(swapCatalogFields("edition", { label: "Primavera", schedule_note: "L–V" }, { label: "Frühling", scheduleNote: "Mo–Fr" })).toEqual({ update: { label: "Frühling", schedule_note: "Mo–Fr" }, oldFields: { label: "Primavera", scheduleNote: "L–V" } });
    expect(Object.keys(CATALOG_SWAP_COLUMNS.variant)).toEqual(["name", "description"]);
  });
  it("el cambio de idioma principal NO toca todavía el catálogo (sin probar contra MySQL; las traducciones quedan guardadas por idioma)", () => {
    const src = read("server/i18nSwapDb.ts");
    expect(src).not.toContain("swapCatalogFields");
  });

});

describe("revisión de #863", () => {
  it("una ficha con prefijo pasa las mismas reglas que /tienda/<slug> (sin 200 donde el cliente dice «no encontrada»)", () => {
    expect(read("server/_core/vite.ts")).toContain('i18n?.kind === "product" && i18n.prefixed ? await resolvePublicRoute(`/tienda/${i18n.principalSlug}`, deps)');
  });
  it("una dirección traducida no puede ser la dirección principal de otro producto", () => {
    expect(read("server/i18nService.ts")).toContain('throw new I18nError("Otro producto ya usa esa dirección.")');
  });
});
