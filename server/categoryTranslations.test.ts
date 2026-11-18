/**
 * «Idiomas» de las categorías de la tienda: los campos del editor son los que admite el servidor, guardar/validar/retirar
 * funcionan para el tipo «category» y el editor devuelve cada categoría con su original y su traducción por idioma.
 */
import { describe, expect, it, vi } from "vitest";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import { CONTENT_FIELDS, addLocale, saveContentTranslationDraft, unvalidateContentTranslation, validateContentTranslation, validateLocale } from "./i18nService";
import { ENTITY_HAS_SLUG, TRANSLATION_FIELD_SETS, draftErrors, draftPayload, translationState } from "../shared/translationEditor";

const defs = TRANSLATION_FIELD_SETS.category;
let categoryRows: Array<Record<string, unknown>> = [];
vi.mock("./db", () => ({
  getDb: async () => ({ select: () => ({ from: () => ({ orderBy: async () => categoryRows }) }) }),
}));

describe("campos de la categoría", () => {
  it("son exactamente los que admite el servidor, sin dirección propia", () => {
    expect(Object.fromEntries(defs.map((d) => [d.key, d.max]))).toEqual(CONTENT_FIELDS.category);
    expect(ENTITY_HAS_SLUG.category).toBe(false);
  });

  it("el nombre es obligatorio y se recorta; el formulario no manda dirección", () => {
    expect(draftErrors(defs, { fields: { name: "   " }, slug: "" }, false).name).toBeTruthy();
    expect(draftErrors(defs, { fields: { name: "Retiros" }, slug: "" }, false)).toEqual({});
    expect(draftPayload(defs, { fields: { name: "  Retiros y viajes del alma  " }, slug: "x" }, false)).toEqual({ fields: { name: "Retiros y viajes del alma" }, slug: null });
    expect(draftErrors(defs, { fields: { name: "a".repeat(129) }, slug: "" }, false).name).toBeTruthy();
  });
});

describe("categoryTranslationEditor", () => {
  const cats = [
    { id: 2, slug: "retreats", name: "Retiros y viajes del alma", isActive: true },
    { id: 3, slug: "heilarbeit", name: "Sanación individual y mentoría", isActive: false },
  ];

  it("una web de un solo idioma: no multidioma y sin categorías que traducir", async () => {
    categoryRows = cats;
    const { getCategoryTranslationEditor } = await import("./categoryTranslationsDb");
    const r = await getCategoryTranslationEditor(memoryI18nRepo({ pages: [], home: "inicio" }));
    expect(r).toMatchObject({ multilingual: false, locales: [], categories: [] });
  });

  it("con idioma adicional: cada categoría con su original y su traducción (o null) por idioma", async () => {
    categoryRows = cats;
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    await saveContentTranslationDraft(repo, { entityType: "category", entityKey: "2", locale: "de", fields: { name: "Retreats & Seelenreisen" } });
    const { getCategoryTranslationEditor } = await import("./categoryTranslationsDb");
    const r = await getCategoryTranslationEditor(repo);
    expect(r.multilingual).toBe(true);
    expect(r.locales).toEqual([{ locale: "de", status: "validated" }]);
    expect(r.categories.map((c) => [c.id, c.slug, c.isActive, c.principal.name])).toEqual([[2, "retreats", true, "Retiros y viajes del alma"], [3, "heilarbeit", false, "Sanación individual y mentoría"]]);
    expect(r.categories[0].translations.de).toMatchObject({ fields: { name: "Retreats & Seelenreisen" }, status: "draft" });
    expect(r.categories[1].translations.de).toBeNull();
  });

  it("ciclo completo: borrador → validada (se ve en el catálogo) → retirada (vuelve a borrador)", async () => {
    categoryRows = cats;
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    await saveContentTranslationDraft(repo, { entityType: "category", entityKey: "3", locale: "de", fields: { name: "Individuelle Heilarbeit & Mentoring" } });
    await validateContentTranslation(repo, "category", "3", "de", "ana");
    const { getCategoryTranslationEditor } = await import("./categoryTranslationsDb");
    let r = await getCategoryTranslationEditor(repo);
    expect(translationState(r.categories[1].translations.de)).toBe("validated");
    expect((await repo.listContentTranslations("category", "de", true)).map((t) => t.entityKey)).toEqual(["3"]);
    await unvalidateContentTranslation(repo, "category", "3", "de");
    r = await getCategoryTranslationEditor(repo);
    expect(translationState(r.categories[1].translations.de)).toBe("draft");
    expect(await repo.listContentTranslations("category", "de", true)).toEqual([]);
  });

  it("el servidor rechaza una categoría con identificador no válido o un nombre demasiado largo", async () => {
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await expect(saveContentTranslationDraft(repo, { entityType: "category", entityKey: "abc", locale: "de", fields: { name: "X" } })).rejects.toThrow();
    await expect(saveContentTranslationDraft(repo, { entityType: "category", entityKey: "2", locale: "de", fields: { name: "a".repeat(129) } })).rejects.toThrow();
  });
});
