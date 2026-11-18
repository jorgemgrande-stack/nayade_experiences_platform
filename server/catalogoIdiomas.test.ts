/**
 * Catálogo multidioma: selector, canónica, hreflang, título y enlaces al catálogo por idioma.
 *  - /tienda (principal) y /<idioma>/tienda se resuelven con SEO propio: canónica del idioma y alternativas.
 *  - /<principal>/tienda con prefijo activo sirve el catálogo; sin prefijo activo, el principal va a /tienda.
 *  - Idioma sin validar: 404. Sin tienda localizada o con una página propia «tienda»: como siempre.
 *  - Los enlaces /tienda?categoria=… de las páginas traducidas llevan al catálogo de su idioma.
 */
import { describe, expect, it } from "vitest";
import { localizeBlockLinks, buildConfig } from "../shared/i18n";
import { switcherQuery } from "../client/src/components/LanguageSwitcher";
import type { ContentTranslationRow, I18nRepo } from "./i18nService";

const ORIGIN = "https://web.example";
const locales = [
  { locale: "de", status: "validated", isDefault: true },
  { locale: "es", status: "validated", isDefault: false },
  { locale: "fr", status: "draft", isDefault: false },
];
const label = (id: number, text: string): ContentTranslationRow =>
  ({ entityType: "menu_item", entityKey: String(id), locale: "es", fields: { label: text }, slug: null, status: "validated" } as unknown as ContentTranslationRow);

function repo(over: Record<string, unknown> = {}, settings: { defaultPrefix: boolean } = { defaultPrefix: false }): I18nRepo {
  return {
    listLocales: async () => locales,
    readSettings: async () => ({ defaultPrefix: settings.defaultPrefix ? "1" : "0", fallback: "default", negotiate: "0" }),
    principalHomeSlug: async () => "home",
    principalPageBySlug: async () => null,
    pageTranslation: async () => null,
    publishedTranslationBySlug: async () => null,
    listContentTranslations: async (type: string, locale: string) => (type === "menu_item" && locale === "es" ? [label(10, "Programas y servicios")] : []),
    productBySlug: async () => null,
    productById: async () => null,
    shopMenuItem: async () => ({ id: 10, label: "Angebote" }),
    ...over,
  } as unknown as I18nRepo;
}

describe("catálogo: SEO, hreflang y selector", () => {
  it("/tienda del idioma principal: canónica sin prefijo, hreflang de todos los idiomas públicos y título del menú", async () => {
    const { resolveRequest } = await import("./i18nService");
    const r = await resolveRequest(repo(), "/tienda", ORIGIN);
    expect(r).toMatchObject({ kind: "catalog", locale: "de", prefixed: false, title: "Angebote" });
    if (r.kind !== "catalog") throw new Error("catálogo");
    expect(r.seo.htmlLang).toBe("de");
    expect(r.seo.canonical).toBe(`${ORIGIN}/tienda`);
    expect(r.seo.noindex).toBe(false);
    const hl = Object.fromEntries(r.seo.alternates.map((a) => [a.hreflang, a.href]));
    expect(hl.de).toBe(`${ORIGIN}/tienda`);
    expect(hl.es).toBe(`${ORIGIN}/es/tienda`);
    expect(hl["x-default"]).toBe(`${ORIGIN}/tienda`);
    expect(hl.fr).toBeUndefined();
    expect(r.switcher).toEqual([{ hreflang: "de", href: "/tienda" }, { hreflang: "es", href: "/es/tienda" }]);
  });

  it("/es/tienda: canónica en español, hreflang cruzado y título traducido del elemento del menú", async () => {
    const { resolveRequest } = await import("./i18nService");
    const r = await resolveRequest(repo(), "/es/tienda", ORIGIN);
    expect(r).toMatchObject({ kind: "catalog", locale: "es", prefixed: true, title: "Programas y servicios" });
    if (r.kind !== "catalog") throw new Error("catálogo");
    expect(r.seo.htmlLang).toBe("es");
    expect(r.seo.canonical).toBe(`${ORIGIN}/es/tienda`);
    expect(r.seo.alternates.map((a) => a.hreflang).sort()).toEqual(["de", "es", "x-default"]);
    expect(r.switcher.map((s) => s.href)).toEqual(["/tienda", "/es/tienda"]);
  });

  it("sin traducción del elemento del menú: título genérico del idioma, nunca vacío", async () => {
    const { resolveRequest } = await import("./i18nService");
    const r = await resolveRequest(repo({ listContentTranslations: async () => [] }), "/es/tienda", ORIGIN);
    expect(r).toMatchObject({ kind: "catalog", title: "Tienda" });
    const sinMenu = await resolveRequest(repo({ shopMenuItem: async () => null }), "/tienda", ORIGIN);
    expect(sinMenu).toMatchObject({ kind: "catalog", title: "Shop" });
    const falla = await resolveRequest(repo({ shopMenuItem: async () => { throw new Error("bd"); } }), "/tienda", ORIGIN);
    expect(falla).toMatchObject({ kind: "catalog", title: "Shop" });
  });

  it("idioma sin validar: 404; sin tienda localizada o con página propia «tienda»: como siempre", async () => {
    const { resolveRequest } = await import("./i18nService");
    expect(await resolveRequest(repo(), "/fr/tienda", ORIGIN)).toEqual({ kind: "notFound" });
    const sinTienda = { ...repo(), productBySlug: undefined } as unknown as I18nRepo;
    expect((await resolveRequest(sinTienda, "/tienda", ORIGIN)).kind).toBe("passthrough");
    const conPagina = repo({ listPageTranslations: async () => [], principalPageBySlug: async (s: string) => (s === "tienda" ? { id: 5, slug: "tienda", title: "Tienda", isPublished: true, updatedAt: 1 } : null) });
    expect((await resolveRequest(conPagina, "/tienda", ORIGIN)).kind).not.toBe("catalog");
  });
});

describe("/<idioma principal>/tienda", () => {
  it("con prefijo activo en el principal: sirve el catálogo (canónica con prefijo), no un 404", async () => {
    const { resolveRequest } = await import("./i18nService");
    const r = await resolveRequest(repo({}, { defaultPrefix: true }), "/de/tienda", ORIGIN);
    expect(r).toMatchObject({ kind: "catalog", locale: "de", prefixed: true });
    if (r.kind !== "catalog") throw new Error("catálogo");
    expect(r.seo.canonical).toBe(`${ORIGIN}/de/tienda`);
    expect(r.seo.alternates.find((a) => a.hreflang === "es")?.href).toBe(`${ORIGIN}/es/tienda`);
  });

  it("sin prefijo activo en el principal: /de/tienda no es una dirección propia, va a /tienda", async () => {
    const { resolveRequest } = await import("./i18nService");
    const r = await resolveRequest(repo(), "/de/tienda", ORIGIN);
    expect(r).toEqual({ kind: "redirect", to: "/tienda", status: 301 });
  });
});

describe("enlaces al catálogo en páginas traducidas", () => {
  const cfg = buildConfig(locales.map((l, i) => ({ ...l, sortOrder: i })) as never, { defaultPrefix: "0", fallback: "default", negotiate: "0" });
  const none = () => false;

  it("/tienda, /tienda?categoria=… y /tienda#ancla llevan al catálogo del idioma", () => {
    const blocks = [{ id: "a", type: "button", props: { url: "/tienda?categoria=retreats" } }, { id: "b", type: "button", props: { url: "/tienda" } }, { id: "c", type: "button", props: { url: "/tienda/?categoria=x#top" } }];
    const out = localizeBlockLinks(blocks, "es", cfg, none) as typeof blocks;
    expect(out.map((b) => b.props.url)).toEqual(["/es/tienda?categoria=retreats", "/es/tienda", "/es/tienda?categoria=x#top"]);
  });

  it("también dentro de HTML, y el principal sin prefijo no se toca", () => {
    const html = [{ id: "t", type: "text", props: { html: '<a href="/tienda?categoria=retreats">Retiros</a>' } }];
    expect((localizeBlockLinks(html, "es", cfg, none) as typeof html)[0].props.html).toBe('<a href="/es/tienda?categoria=retreats">Retiros</a>');
    const b = [{ id: "a", type: "button", props: { url: "/tienda?categoria=retreats" } }];
    expect(localizeBlockLinks(b, "de", cfg, none)).toBe(b);
  });

  it("enlaces parecidos no se confunden: otra página y fichas siguen su propia regla", () => {
    const b = [{ id: "a", type: "button", props: { url: "/tienda-online" } }, { id: "b", type: "button", props: { url: "https://otra.example/tienda" } }];
    const out = localizeBlockLinks(b, "es", cfg, none) as typeof b;
    expect(out.map((x) => x.props.url)).toEqual(["/tienda-online", "https://otra.example/tienda"]);
  });
});

describe("selector de idioma en el catálogo", () => {
  it("conserva ?categoria= (y solo un slug válido) en el catálogo; la ficha conserva ?opcion=", () => {
    expect(switcherQuery("/tienda", "?categoria=retreats&utm=x")).toBe("?categoria=retreats");
    expect(switcherQuery("/es/tienda", "?categoria=retiros-del-alma")).toBe("?categoria=retiros-del-alma");
    expect(switcherQuery("/es/tienda", "?categoria=%3Cscript%3E")).toBe("");
    expect(switcherQuery("/es/tienda", "")).toBe("");
    expect(switcherQuery("/es/tienda/morning-impulse", "?opcion=8&categoria=x")).toBe("?opcion=8");
    expect(switcherQuery("/es/talleres", "?categoria=x")).toBe("");
  });
});
