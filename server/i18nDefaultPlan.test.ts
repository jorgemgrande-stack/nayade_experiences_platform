import { describe, it, expect } from "vitest";
import { planDefaultLocaleChange, type DefaultLocalePlanInput } from "../shared/i18nDefaultPlan";

const base = (over: Partial<DefaultLocalePlanInput> = {}): DefaultLocalePlanInput => ({
  target: "de",
  locales: [{ locale: "es", isDefault: true, status: "validated" }, { locale: "de", isDefault: false, status: "validated" }, { locale: "en", isDefault: false, status: "draft" }],
  pages: [
    { id: 1, slug: "inicio", title: "Inicio", isPublished: true, isHome: true },
    { id: 2, slug: "contacto", title: "Contacto", isPublished: true, isHome: false },
  ],
  pageTranslations: [
    { pageId: 1, locale: "de", slug: "startseite", publishedSlug: "startseite", status: "validated", hasPublishedBlocks: true, hasDraftBlocks: true },
    { pageId: 2, locale: "de", slug: "kontakt", publishedSlug: "kontakt", status: "validated", hasPublishedBlocks: true, hasDraftBlocks: true },
  ],
  menuItems: [{ id: 10, label: "Contacto", url: "/contacto", isVisible: true }],
  contentTranslations: [{ entityType: "menu_item", entityKey: "10", locale: "de", status: "validated" }],
  ...over,
});

describe("plan de cambio de idioma principal", () => {
  it("se puede aplicar cuando todo está traducido y validado, y lista los cambios de dirección", () => {
    const p = planDefaultLocaleChange(base());
    expect(p.canApply).toBe(true);
    expect(p.current).toBe("es");
    expect(p.slugChanges).toEqual([{ from: "/contacto", to: "/kontakt" }]);
    expect(p.counts).toMatchObject({ pages: 2, swappable: 2, blocked: 0, menuItems: 1, menuTranslated: 1 });
  });
  it("no es un simple cambio de etiqueta: una página publicada sin traducción bloquea", () => {
    const p = planDefaultLocaleChange(base({ pageTranslations: base().pageTranslations.filter((t) => t.pageId !== 2) }));
    expect(p.canApply).toBe(false);
    expect(p.issues.map((i) => i.code)).toContain("page_no_translation");
    expect(p.counts.blocked).toBe(1);
  });
  it("una traducción en borrador (sin validar por una persona) bloquea", () => {
    const p = planDefaultLocaleChange(base({ pageTranslations: base().pageTranslations.map((t) => (t.pageId === 2 ? { ...t, status: "draft" as const, publishedSlug: null } : t)) }));
    expect(p.canApply).toBe(false);
    expect(p.issues.some((i) => i.code === "page_translation_not_validated" && i.ref === "contacto")).toBe(true);
  });
  it("el idioma destino debe estar validado, existir y ser distinto del principal", () => {
    expect(planDefaultLocaleChange(base({ target: "en" })).issues.map((i) => i.code)).toContain("target_not_validated");
    expect(planDefaultLocaleChange(base({ target: "fr" })).issues.map((i) => i.code)).toEqual(["target_missing"]);
    expect(planDefaultLocaleChange(base({ target: "es" })).issues.map((i) => i.code)).toEqual(["already_default"]);
    expect(planDefaultLocaleChange(base({ target: "no es un idioma!" })).issues.map((i) => i.code)).toEqual(["target_invalid"]);
    expect(planDefaultLocaleChange(base({ locales: [] })).issues.map((i) => i.code)).toEqual(["no_multilingual"]);
  });
  it("un menú visible sin traducción validada bloquea", () => {
    const p = planDefaultLocaleChange(base({ contentTranslations: [] }));
    expect(p.canApply).toBe(false);
    expect(p.issues.some((i) => i.code === "menu_untranslated")).toBe(true);
  });
  it("detecta direcciones duplicadas, reservadas o que chocan con otra página", () => {
    const dup = planDefaultLocaleChange(base({ pageTranslations: base().pageTranslations.map((t) => ({ ...t, publishedSlug: "gleich", slug: "gleich" })) }));
    expect(dup.issues.some((i) => i.code === "slug_duplicate")).toBe(true);
    const reserved = planDefaultLocaleChange(base({ pageTranslations: base().pageTranslations.map((t) => (t.pageId === 2 ? { ...t, publishedSlug: "admin", slug: "admin" } : t)) }));
    expect(reserved.issues.some((i) => i.code === "slug_reserved")).toBe(true);
    const collide = planDefaultLocaleChange(base({
      pages: [...base().pages, { id: 3, slug: "kontakt", title: "Otra", isPublished: false, isHome: false }],
    }));
    expect(collide.issues.some((i) => i.code === "slug_collision")).toBe(true);
  });
  it("traducción validada sin contenido publicado bloquea", () => {
    const p = planDefaultLocaleChange(base({ pageTranslations: base().pageTranslations.map((t) => (t.pageId === 2 ? { ...t, hasPublishedBlocks: false } : t)) }));
    expect(p.issues.some((i) => i.code === "page_translation_empty")).toBe(true);
  });
  it("las páginas sin publicar y los productos/formularios sin traducir solo avisan", () => {
    const p = planDefaultLocaleChange(base({
      pages: [...base().pages, { id: 4, slug: "borrador", title: "Borrador", isPublished: false, isHome: false }],
      contentCounts: { product: 5, form: 1 },
    }));
    expect(p.canApply).toBe(true);
    expect(p.issues.filter((i) => i.severity === "warning").map((i) => i.code).sort()).toEqual(["content_untranslated", "content_untranslated", "page_draft_no_translation"]);
  });
  it("la portada puede cambiar de dirección sin generar 301 propio", () => {
    expect(planDefaultLocaleChange(base()).slugChanges.some((c) => c.from === "/inicio")).toBe(false);
  });
});
