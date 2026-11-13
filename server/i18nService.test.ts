import { describe, expect, it } from "vitest";
import { createBlock } from "../shared/pageBlocks";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import {
  I18nError, addLocale, copyFromPrincipal, getI18nConfig, localizeMenu, pageTranslationStatuses, removeLocale, resolveRequest,
  saveContentTranslationDraft, savePageTranslationDraft, sitemapAlternates, unpublishPageTranslation, untranslatedForPage,
  unvalidateLocale, updateI18nSettings, validateContentTranslation, validateLocale, validatePageTranslation,
} from "./i18nService";

const ORIGIN = "https://ejemplo.test";
const pages = [
  { id: 1, slug: "inicio", title: "Inicio", isPublished: true },
  { id: 2, slug: "nosotros", title: "Nosotros", isPublished: true },
  { id: 3, slug: "borrador", title: "Borrador", isPublished: false },
];
const PRINCIPAL = [createBlock("hero", { title: "Hola", subtitle: "Mundo", buttonLabel: "Ir", buttonUrl: "/x" })];
const blocks = () => JSON.parse(JSON.stringify(PRINCIPAL));
const newRepo = (settings = {}) => memoryI18nRepo({ pages, home: "inicio", settings });

/** Empresa con alemán validado y la página «nosotros» traducida y validada. */
async function withGerman(repo = newRepo()) {
  await addLocale(repo, "de", "ana");
  await validateLocale(repo, "de", "ana");
  await savePageTranslationDraft(repo, 2, "de", { title: "Über uns", slug: "ueber-uns", blocks: blocks() }, blocks());
  await validatePageTranslation(repo, 2, "de", "ana");
  return repo;
}
const rejects = async (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(I18nError);

describe("idiomas", () => {
  it("sin idiomas: configuración de siempre y nada que resolver", async () => {
    const repo = newRepo();
    const cfg = await getI18nConfig(repo);
    expect(cfg.locales).toEqual([]);
    for (const p of ["/", "/nosotros", "/de/nosotros", "/tienda", "/es/nosotros"]) expect(await resolveRequest(repo, p, ORIGIN)).toEqual({ kind: "passthrough" });
    expect((await sitemapAlternates(repo)).entries).toEqual([]);
  });
  it("alta: principal implícito, nuevo idioma en borrador", async () => {
    const repo = newRepo();
    await addLocale(repo, "DE", "ana");
    const cfg = await getI18nConfig(repo);
    expect(cfg.locales.map((l) => [l.locale, l.isDefault, l.status])).toEqual([["es", true, "validated"], ["de", false, "draft"]]);
  });
  it("rechaza códigos inválidos, duplicados y slugs en conflicto", async () => {
    const repo = memoryI18nRepo({ pages: [...pages, { id: 9, slug: "en", title: "En", isPublished: true }] });
    await rejects(addLocale(repo, "no valido!", null));
    await addLocale(repo, "de", null);
    await rejects(addLocale(repo, "de", null));
    await rejects(addLocale(repo, "en", null));
  });
  it("validar y retirar; no se quita un idioma publicado", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await rejects(validateLocale(repo, "es", "ana"));
    await rejects(validateLocale(repo, "fr", "ana"));
    await validateLocale(repo, "de", "ana");
    await rejects(removeLocale(repo, "de"));
    await unvalidateLocale(repo, "de");
    await removeLocale(repo, "de");
    // vuelve el estado de siempre
    expect((await getI18nConfig(repo)).locales).toEqual([]);
  });
  it("ajustes", async () => {
    const repo = newRepo();
    await updateI18nSettings(repo, { fallback: "default", negotiate: true });
    const cfg = await getI18nConfig(repo);
    expect([cfg.fallback, cfg.negotiate]).toEqual(["default", true]);
  });
});

describe("traducción de páginas: estados", () => {
  it("guardar no publica; solo validar publica", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    await savePageTranslationDraft(repo, 2, "de", { title: "Über uns", slug: "ueber-uns", blocks: blocks() });
    expect((await resolveRequest(repo, "/de/ueber-uns", ORIGIN)).kind).toBe("notFound");
    await validatePageTranslation(repo, 2, "de", "ana");
    expect((await resolveRequest(repo, "/de/ueber-uns", ORIGIN)).kind).toBe("page");
  });
  it("editar una traducción validada no cambia lo servido hasta volver a validar", async () => {
    const repo = await withGerman();
    const edited = [createBlock("hero", { title: "Neu", subtitle: "x", buttonLabel: "y", buttonUrl: "/x" })];
    await savePageTranslationDraft(repo, 2, "de", { title: "Über uns NEU", slug: "ueber-uns", blocks: edited });
    const served = await resolveRequest(repo, "/de/ueber-uns", ORIGIN);
    expect(served.kind === "page" && served.page?.title).toBe("Über uns");
    expect(served.kind === "page" && (served.page?.blocks?.[0].data as { title: string }).title).toBe("Hola");
    expect((await pageTranslationStatuses(repo, 2, blocks())).find((s) => s.locale === "de")).toMatchObject({ status: "validated", hasPendingChanges: true });
    await validatePageTranslation(repo, 2, "de", "ana");
    const after = await resolveRequest(repo, "/de/ueber-uns", ORIGIN);
    expect(after.kind === "page" && after.page?.title).toBe("Über uns NEU");
  });
  it("retirar la traducción la deja de servir", async () => {
    const repo = await withGerman();
    await unpublishPageTranslation(repo, 2, "de");
    expect((await resolveRequest(repo, "/de/ueber-uns", ORIGIN)).kind).toBe("notFound");
  });
  it("idioma sin validar: la traducción validada no se sirve", async () => {
    const repo = await withGerman();
    await unvalidateLocale(repo, "de");
    expect((await resolveRequest(repo, "/de/ueber-uns", ORIGIN)).kind).toBe("notFound");
    expect((await resolveRequest(repo, "/de", ORIGIN)).kind).toBe("notFound");
  });
  it("validación de entrada", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await rejects(savePageTranslationDraft(repo, 2, "de", { title: "  ", blocks: blocks() }));
    await rejects(savePageTranslationDraft(repo, 2, "de", { title: "X", slug: "Über Uns", blocks: blocks() }));
    await rejects(savePageTranslationDraft(repo, 2, "de", { title: "X", slug: "admin", blocks: blocks() }));
    await rejects(savePageTranslationDraft(repo, 2, "es", { title: "X" }));
    await rejects(savePageTranslationDraft(repo, 2, "fr", { title: "X" }));
    await rejects(savePageTranslationDraft(repo, 99, "de", { title: "X" }));
    await rejects(savePageTranslationDraft(repo, 2, "de", { title: "X", blocks: "no es una lista" }));
    await rejects(validatePageTranslation(repo, 2, "de", null));
    await savePageTranslationDraft(repo, 2, "de", { title: "X", slug: "a" });
    await rejects(validatePageTranslation(repo, 2, "de", null)); // sin bloques
    await rejects(savePageTranslationDraft(repo, 1, "de", { title: "Y", slug: "a" })); // slug ya usado en ese idioma
  });
  it("saneado: los bloques traducidos pasan por la misma normalización", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await savePageTranslationDraft(repo, 2, "de", { title: "X", slug: "a", blocks: [{ id: "b1", type: "text", data: { title: "T", html: "<p>ok</p><script>alert(1)</script>", align: "left" } }], ogImageUrl: "javascript:alert(1)" });
    const row = await repo.pageTranslation(2, "de");
    expect(JSON.stringify(row?.draftBlocks)).not.toContain("<script");
    expect(row?.ogImageUrl).toBeNull();
  });
  it("copiar desde el principal no traduce ni valida; marca los campos sin traducir", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await copyFromPrincipal(repo, 2, "de", blocks());
    const row = await repo.pageTranslation(2, "de");
    expect(row).toMatchObject({ status: "draft", slug: "nosotros", publishedBlocks: null });
    expect(row?.draftBlocks?.[0].id).toBe(PRINCIPAL[0].id);
    const pending = await untranslatedForPage(repo, 2, "de", row!.draftBlocks!);
    expect(pending.length).toBeGreaterThan(0);
    expect((await resolveRequest(repo, "/de/nosotros", ORIGIN)).kind).toBe("notFound");
  });
  it("aviso de que el principal ha cambiado", async () => {
    const repo = await withGerman();
    const changed = [createBlock("hero", { title: "Otro", subtitle: "", buttonLabel: "", buttonUrl: "" })];
    expect((await pageTranslationStatuses(repo, 2, changed))[0].principalChanged).toBe(true);
    expect((await pageTranslationStatuses(repo, 2, blocks()))[0].principalChanged).toBe(false);
  });
});

describe("resolución de URLs y SEO", () => {
  it("el principal sin prefijo lleva hreflang a sus traducciones validadas", async () => {
    const repo = await withGerman();
    const r = await resolveRequest(repo, "/nosotros", ORIGIN);
    expect(r.kind).toBe("page");
    if (r.kind !== "page") return;
    expect(r.page).toBeNull();
    expect(r.seo).toMatchObject({ htmlLang: "es", canonical: "https://ejemplo.test/nosotros", noindex: false });
    expect(r.seo.alternates.map((a) => a.hreflang)).toEqual(["es", "de", "x-default"]);
  });
  it("traducción: lang, canonical y alternates recíprocos", async () => {
    const repo = await withGerman();
    const r = await resolveRequest(repo, "/de/ueber-uns", ORIGIN);
    if (r.kind !== "page") throw new Error("esperaba página");
    expect(r.seo.htmlLang).toBe("de");
    expect(r.seo.canonical).toBe("https://ejemplo.test/de/ueber-uns");
    expect(r.seo.alternates).toContainEqual({ hreflang: "es", href: "https://ejemplo.test/nosotros" });
    expect(r.principalSlug).toBe("nosotros");
  });
  it("principal sin traducciones validadas de esa página: sin alternates", async () => {
    const repo = await withGerman();
    const home = await resolveRequest(repo, "/", ORIGIN);
    expect(home.kind === "page" && home.seo.alternates).toEqual([]);
  });
  it("rutas de aplicación y páginas inexistentes siguen como hoy", async () => {
    const repo = await withGerman();
    for (const p of ["/tienda", "/blog/x", "/admin/studio/inicio", "/no-existe", "/borrador"]) expect(await resolveRequest(repo, p, ORIGIN)).toEqual({ kind: "passthrough" });
  });
  it("prefijo del principal redirige; el slug del principal en otro idioma redirige a la traducción", async () => {
    const repo = await withGerman();
    expect(await resolveRequest(repo, "/es/nosotros", ORIGIN)).toEqual({ kind: "redirect", to: "/nosotros", status: 301 });
    expect(await resolveRequest(repo, "/de/nosotros", ORIGIN)).toEqual({ kind: "redirect", to: "/de/ueber-uns", status: 301 });
  });
  it("portada traducida en /de", async () => {
    const repo = await withGerman();
    await savePageTranslationDraft(repo, 1, "de", { title: "Startseite", slug: "startseite", blocks: blocks() });
    await validatePageTranslation(repo, 1, "de", "ana");
    const r = await resolveRequest(repo, "/de", ORIGIN);
    expect(r.kind === "page" && r.page?.title).toBe("Startseite");
    expect(await resolveRequest(repo, "/de/startseite", ORIGIN)).toEqual({ kind: "redirect", to: "/de", status: 301 });
    const es = await resolveRequest(repo, "/", ORIGIN);
    expect(es.kind === "page" && es.seo.alternates.map((a) => a.href)).toContain("https://ejemplo.test/de");
  });
  it("fallback hide: sin traducción, 404 (también para páginas sin publicar)", async () => {
    const repo = await withGerman();
    expect((await resolveRequest(repo, "/de/otra", ORIGIN)).kind).toBe("notFound");
    expect((await resolveRequest(repo, "/de/borrador", ORIGIN)).kind).toBe("notFound");
    expect((await resolveRequest(repo, "/de/a/b", ORIGIN)).kind).toBe("notFound");
  });
  it("fallback default: muestra el principal declarándolo (lang, canonical al original, noindex)", async () => {
    const repo = newRepo({ fallback: "default" });
    await withGerman(repo);
    // página sin traducir: el único caso que cae al principal
    const pages2 = await resolveRequest(repo, "/de/inicio", ORIGIN);
    expect(pages2.kind).toBe("page");
    if (pages2.kind !== "page") return;
    expect(pages2.decision).toEqual({ kind: "fallback", requested: "de", contentLocale: "es" });
    expect(pages2.page).toBeNull();
    expect(pages2.seo).toMatchObject({ htmlLang: "es", noindex: true });
    expect(pages2.seo.canonical).toBe("https://ejemplo.test/");
    // un idioma sin validar nunca cae al principal
    await addLocale(repo, "fr", null);
    expect((await resolveRequest(repo, "/fr/nosotros", ORIGIN)).kind).toBe("notFound");
  });
  it("principal con prefijo: la ruta sin prefijo redirige", async () => {
    const repo = await withGerman();
    await repo.writeSetting("i18n_default_prefix", "1");
    expect(await resolveRequest(repo, "/nosotros", ORIGIN)).toEqual({ kind: "redirect", to: "/es/nosotros", status: 301 });
    const r = await resolveRequest(repo, "/es/nosotros", ORIGIN);
    expect(r.kind === "page" && r.seo.canonical).toBe("https://ejemplo.test/es/nosotros");
  });
});

describe("sitemap", () => {
  it("una entrada por página con traducción validada y sus versiones", async () => {
    const repo = await withGerman();
    const { entries } = await sitemapAlternates(repo);
    expect(entries).toHaveLength(1);
    expect(entries[0].rest).toBe("/nosotros");
    expect(entries[0].versions).toEqual([{ locale: "es", rest: "/nosotros" }, { locale: "de", rest: "/ueber-uns" }]);
  });
  it("no incluye traducciones sin validar", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await savePageTranslationDraft(repo, 2, "de", { title: "X", slug: "a", blocks: blocks() });
    expect((await sitemapAlternates(repo)).entries).toEqual([]);
  });
});

describe("menús", () => {
  const items = [
    { id: 1, parentId: null, label: "Inicio", url: "/" },
    { id: 2, parentId: null, label: "Nosotros", url: "/nosotros" },
    { id: 3, parentId: 2, label: "Equipo", url: "/equipo" },
    { id: 4, parentId: null, label: "Blog", url: "https://blog.ejemplo.test" },
  ];
  it("sin idioma o idioma sin validar: el menú de siempre", async () => {
    const repo = newRepo();
    expect(await localizeMenu(repo, items, "de")).toEqual(items);
    await addLocale(repo, "de", null);
    expect(await localizeMenu(repo, items, "de")).toEqual(items);
    expect(await localizeMenu(repo, items, "es")).toEqual(items);
  });
  it("oculta lo no traducido (y sus hijos) y deriva el enlace del slug localizado", async () => {
    const repo = await withGerman();
    await saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "2", locale: "de", fields: { label: "Über uns" } });
    await validateContentTranslation(repo, "menu_item", "2", "de", "ana");
    const out = await localizeMenu(repo, items, "de");
    expect(out.map((i) => [i.label, i.url])).toEqual([["Über uns", "/de/ueber-uns"]]);
  });
  it("fallback default: etiqueta del principal con enlace al idioma", async () => {
    const repo = newRepo({ fallback: "default" });
    await withGerman(repo);
    const out = await localizeMenu(repo, items, "de");
    expect(out.map((i) => i.label)).toEqual(["Inicio", "Nosotros", "Equipo", "Blog"]);
    expect(out[0].url).toBe("/de");
    expect(out[3].url).toBe("https://blog.ejemplo.test");
  });
  it("los enlaces externos se traducen con su propia URL validada", async () => {
    const repo = await withGerman();
    await saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "4", locale: "de", fields: { label: "Blog", url: "https://blog.ejemplo.test/de" } });
    await validateContentTranslation(repo, "menu_item", "4", "de", null);
    expect((await localizeMenu(repo, items, "de")).find((i) => i.id === 4)?.url).toBe("https://blog.ejemplo.test/de");
  });
});

describe("contenido genérico", () => {
  it("solo campos de la lista blanca; nada de precios", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await rejects(saveContentTranslationDraft(repo, { entityType: "product", entityKey: "7", locale: "de", fields: { basePrice: "1" } }));
    await rejects(saveContentTranslationDraft(repo, { entityType: "product", entityKey: "7", locale: "de", fields: { title: 5 as unknown as string } }));
    await rejects(saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "7", locale: "de", fields: { url: "javascript:x" } }));
    await rejects(saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "../x", locale: "de", fields: { label: "a" } }));
    await rejects(saveContentTranslationDraft(repo, { entityType: "menu_item", entityKey: "7", locale: "de", fields: { label: "a" }, slug: "x" }));
    await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "7", locale: "de", fields: { title: "Kajak", shortDescription: "" }, slug: "kajak" });
    await rejects(saveContentTranslationDraft(repo, { entityType: "product", entityKey: "8", locale: "de", fields: { title: "Kajak 2" }, slug: "kajak" }));
  });
  it("editar una traducción validada la devuelve a borrador", async () => {
    const repo = newRepo();
    await addLocale(repo, "de", null);
    await saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "brand_tagline", locale: "de", fields: { value: "Hallo" } });
    await validateContentTranslation(repo, "setting", "brand_tagline", "de", "ana");
    expect((await repo.contentTranslation("setting", "brand_tagline", "de"))?.status).toBe("validated");
    await saveContentTranslationDraft(repo, { entityType: "setting", entityKey: "brand_tagline", locale: "de", fields: { value: "Hallo!" } });
    expect((await repo.contentTranslation("setting", "brand_tagline", "de"))?.status).toBe("draft");
  });
});

describe("aislamiento entre empresas", () => {
  it("dos empresas con el mismo idioma y los mismos slugs no se ven", async () => {
    const a = await withGerman(newRepo());
    const b = newRepo();
    await addLocale(b, "de", null);
    await validateLocale(b, "de", null);
    expect((await resolveRequest(a, "/de/ueber-uns", ORIGIN)).kind).toBe("page");
    expect((await resolveRequest(b, "/de/ueber-uns", ORIGIN)).kind).toBe("notFound");
    // y una empresa sin idiomas ni se entera
    const c = newRepo();
    expect(await resolveRequest(c, "/de/ueber-uns", ORIGIN)).toEqual({ kind: "passthrough" });
    expect((await getI18nConfig(c)).locales).toEqual([]);
  });
});
