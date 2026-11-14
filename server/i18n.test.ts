import { describe, expect, it } from "vitest";
import {
  SINGLE_LANGUAGE_CONFIG, listTextFields, setTextField, alternateLinksHtml, buildAlternates, buildConfig, contentHash, decideServing, isMultilingual, localeSeo,
  localizedPath, normalizeLocale, normalizeLocalizedSlug, ogLocale, parseLocalizedPath, publicLocales, untranslatedFields,
} from "../shared/i18n";
import { createBlock } from "../shared/pageBlocks";

const multi = (extra: Array<[string, "draft" | "validated"]> = [["de", "validated"], ["en", "draft"]], settings = {}) =>
  buildConfig([{ locale: "es", isDefault: true, status: "validated", sortOrder: 0 }, ...extra.map(([locale, status], i) => ({ locale, isDefault: false, status, sortOrder: i + 1 }))], settings);

describe("códigos de idioma", () => {
  it("normaliza y rechaza", () => {
    expect(normalizeLocale(" DE ")).toBe("de");
    expect(normalizeLocale("pt_BR")).toBe("pt-br");
    for (const bad of ["", "d", "deutsch1", "../x", "de/en", 5, null]) expect(normalizeLocale(bad)).toBeNull();
  });
  it("slugs localizados", () => {
    expect(normalizeLocalizedSlug("ueber-uns")).toBe("ueber-uns");
    for (const bad of ["Über-uns", "a b", "-x", "x-", "a--b", ""]) expect(normalizeLocalizedSlug(bad)).toBeNull();
  });
});

describe("una sola lengua: regresión", () => {
  it("sin idiomas adicionales nada cambia", () => {
    expect(isMultilingual(SINGLE_LANGUAGE_CONFIG)).toBe(false);
    for (const p of ["/", "/tienda", "/de", "/de/x", "/es/x", "/sobre-nosotros", "/blog/entrada", "/admin/studio/x"]) {
      expect(parseLocalizedPath(p, SINGLE_LANGUAGE_CONFIG)).toEqual({ locale: "es", rest: p, prefixed: false });
    }
  });
  it("solo el principal en un sitio con filas pero sin adicionales", () => {
    const cfg = buildConfig([{ locale: "es", isDefault: true, status: "validated", sortOrder: 0 }]);
    expect(isMultilingual(cfg)).toBe(false);
    expect(parseLocalizedPath("/de/x", cfg).prefixed).toBe(false);
  });
});

describe("lectura y construcción de URLs", () => {
  const cfg = multi();
  it("principal sin prefijo por defecto", () => {
    expect(parseLocalizedPath("/sobre-nosotros", cfg)).toEqual({ locale: "es", rest: "/sobre-nosotros", prefixed: false });
    expect(localizedPath("/sobre-nosotros", "es", cfg)).toBe("/sobre-nosotros");
    expect(localizedPath("/", "de", cfg)).toBe("/de");
    expect(localizedPath("/ueber-uns", "de", cfg)).toBe("/de/ueber-uns");
  });
  it("prefijos de idiomas configurados", () => {
    expect(parseLocalizedPath("/de/ueber-uns/", cfg)).toEqual({ locale: "de", rest: "/ueber-uns", prefixed: true });
    expect(parseLocalizedPath("/de", cfg)).toEqual({ locale: "de", rest: "/", prefixed: true });
    expect(parseLocalizedPath("/en/about?x=1", cfg).locale).toBe("en");
  });
  it("un prefijo no configurado no es un idioma", () => {
    expect(parseLocalizedPath("/fr/contact", cfg)).toEqual({ locale: "es", rest: "/fr/contact", prefixed: false });
    expect(parseLocalizedPath("/DE/x", cfg).prefixed).toBe(false);
  });
  it("el prefijo del principal sobra y redirige", () => {
    expect(parseLocalizedPath("/es/sobre-nosotros", cfg).redirectTo).toBe("/sobre-nosotros");
    expect(parseLocalizedPath("/es", cfg).redirectTo).toBe("/");
  });
  it("principal con prefijo", () => {
    const c = multi(undefined, { defaultPrefix: "1" });
    expect(localizedPath("/x", "es", c)).toBe("/es/x");
    expect(parseLocalizedPath("/x", c).redirectTo).toBe("/es/x");
    expect(parseLocalizedPath("/", c).redirectTo).toBe("/es");
    expect(parseLocalizedPath("/es/x", c)).toEqual({ locale: "es", rest: "/x", prefixed: true });
  });
  it("áreas privadas y de sistema nunca se localizan", () => {
    const c = multi(undefined, { defaultPrefix: "1" });
    for (const p of ["/admin/cms", "/api/trpc/x", "/login", "/sitemap.xml", "/robots.txt", "/checkout"]) {
      expect(parseLocalizedPath(p, c).redirectTo).toBeUndefined();
    }
    expect(parseLocalizedPath("/admin/de", multi()).prefixed).toBe(false);
  });
});

describe("qué se sirve", () => {
  const base = { principalExists: true };
  it("dos candados: idioma validado y traducción validada", () => {
    const cfg = multi();
    expect(decideServing({ cfg, locale: "de", ...base, translationValidated: true })).toEqual({ kind: "translated", locale: "de" });
    // idioma sin validar: 404 aunque la traducción esté validada
    expect(decideServing({ cfg, locale: "en", ...base, translationValidated: true })).toEqual({ kind: "notFound" });
    // idioma inexistente
    expect(decideServing({ cfg, locale: "fr", ...base, translationValidated: true })).toEqual({ kind: "notFound" });
  });
  it("fallback hide: sin traducción, 404", () => {
    expect(decideServing({ cfg: multi(), locale: "de", ...base, translationValidated: false })).toEqual({ kind: "notFound" });
  });
  it("fallback default: el principal, declarado; nunca para un idioma sin validar", () => {
    const cfg = multi(undefined, { fallback: "default" });
    expect(decideServing({ cfg, locale: "de", ...base, translationValidated: false })).toEqual({ kind: "fallback", requested: "de", contentLocale: "es" });
    expect(decideServing({ cfg, locale: "en", ...base, translationValidated: false })).toEqual({ kind: "notFound" });
    expect(decideServing({ cfg, locale: "de", principalExists: false, translationValidated: false })).toEqual({ kind: "notFound" });
  });
  it("el principal", () => {
    expect(decideServing({ cfg: multi(), locale: "es", principalExists: true, translationValidated: false })).toEqual({ kind: "principal" });
    expect(publicLocales(multi())).toEqual(["es", "de"]);
  });
});

describe("hreflang, canonical y lang", () => {
  const cfg = multi([["de", "validated"], ["en", "validated"], ["fr", "draft"]]);
  const origin = "https://ejemplo.test/";
  const versions = [{ locale: "es", rest: "/nosotros" }, { locale: "de", rest: "/ueber-uns" }, { locale: "en", rest: "/about" }, { locale: "fr", rest: "/a-propos" }];
  it("alternates recíprocos con x-default, sin idiomas sin validar", () => {
    const alts = buildAlternates(cfg, origin, versions);
    expect(alts).toEqual([
      { hreflang: "es", href: "https://ejemplo.test/nosotros" },
      { hreflang: "de", href: "https://ejemplo.test/de/ueber-uns" },
      { hreflang: "en", href: "https://ejemplo.test/en/about" },
      { hreflang: "x-default", href: "https://ejemplo.test/nosotros" },
    ]);
  });
  it("sin versión adicional no hay alternates", () => {
    expect(buildAlternates(cfg, origin, [versions[0]])).toEqual([]);
    expect(buildAlternates(cfg, origin, [versions[0], versions[3]])).toEqual([]);
  });
  it("seo de una traducción: lang, canonical autorreferente, indexable", () => {
    const seo = localeSeo({ cfg, origin, decision: { kind: "translated", locale: "de" }, locale: "de", rest: "/ueber-uns", principalRest: "/nosotros", versions });
    expect(seo).toMatchObject({ htmlLang: "de", canonical: "https://ejemplo.test/de/ueber-uns", noindex: false });
    expect(seo.alternates).toHaveLength(4);
  });
  it("seo del fallback: lang del principal, canonical al original y noindex", () => {
    const seo = localeSeo({ cfg, origin, decision: { kind: "fallback", requested: "de", contentLocale: "es" }, locale: "de", rest: "/nosotros", principalRest: "/nosotros", versions });
    expect(seo).toEqual({ htmlLang: "es", canonical: "https://ejemplo.test/nosotros", noindex: true, alternates: [] });
  });
  it("escapa los valores y og:locale", () => {
    expect(alternateLinksHtml([{ hreflang: "de", href: 'https://x.test/"><script>' }])).not.toContain("<script>");
    expect(ogLocale("pt-br")).toBe("pt_BR");
    expect(ogLocale("de")).toBe("de");
  });
});

describe("campos sin traducir", () => {
  const principal = [
    createBlock("hero", { title: "Bienvenidos", subtitle: "Una experiencia única", buttonLabel: "Reservar", buttonUrl: "/contacto", imageUrl: "https://x.test/a.jpg" }),
    createBlock("cta", { title: "Hablemos", text: "Escríbenos" }),
  ];
  it("marca los textos iguales al principal y no las URLs ni las opciones", () => {
    const translated = JSON.parse(JSON.stringify(principal));
    translated[0].data.title = "Willkommen";
    const fields = untranslatedFields(principal, translated).map((f) => `${f.blockType}.${f.field}`);
    expect(fields).toContain("hero.subtitle");
    expect(fields).toContain("hero.buttonLabel");
    expect(fields).toContain("cta.title");
    expect(fields).not.toContain("hero.title");
    expect(fields).not.toContain("hero.buttonUrl");
    expect(fields).not.toContain("hero.imageUrl");
  });
  it("todo traducido: nada pendiente; vacío: pendiente", () => {
    const t = JSON.parse(JSON.stringify(principal));
    t[0].data = { ...t[0].data, title: "A", subtitle: "B", buttonLabel: "C" };
    t[1].data = { ...t[1].data, title: "D", text: "" };
    const fields = untranslatedFields(principal, t).map((f) => f.field);
    expect(fields).toContain("text");
    expect(fields).not.toContain("title");
    expect(fields).not.toContain("subtitle");
  });
  it("huella estable", () => {
    expect(contentHash(principal)).toBe(contentHash(JSON.parse(JSON.stringify(principal))));
    expect(contentHash(principal)).not.toBe(contentHash([]));
  });
});

describe("campos de texto para la tabla de traducción", () => {
  const blocks = [
    createBlock("hero", { title: "Bienvenidos", subtitle: "Una experiencia única", buttonLabel: "Reservar", buttonUrl: "/contacto", imageUrl: "https://x.test/a.jpg" }),
    createBlock("faq", { title: "Preguntas", items: [{ id: "q1", question: "¿Dónde estamos?", answer: "<p>En el centro</p>" }] as never }),
  ];
  it("lista los textos y no las direcciones", () => {
    const f = listTextFields(blocks).map((x) => x.path);
    expect(f).toContain("title");
    expect(f).toContain("subtitle");
    expect(f).not.toContain("buttonUrl");
    expect(f).not.toContain("imageUrl");
    expect(f).toContain("items[0].question");
    expect(f).toContain("items[0].answer");
  });
  it("cambia un texto por su ruta sin mutar y rechaza rutas raras", () => {
    const out = setTextField(blocks, blocks[1].id, "items[0].question", "Wo sind wir?");
    expect((out[1].data as { items: Array<{ question: string }> }).items[0].question).toBe("Wo sind wir?");
    expect((blocks[1].data as { items: Array<{ question: string }> }).items[0].question).toBe("¿Dónde estamos?");
    expect(setTextField(blocks, blocks[1].id, "__proto__.x", "a")).toEqual(blocks);
    expect(setTextField(blocks, blocks[1].id, "items[5].question", "a")[1]).toEqual(blocks[1]);
    expect(setTextField(blocks, "no-existe", "title", "a")).toEqual(blocks);
  });
});
