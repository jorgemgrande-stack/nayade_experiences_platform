/**
 * «Idiomas» de un producto (E-1): lógica del editor (shared/translationEditor.ts), coherencia con lo que admite el
 * servidor (CONTENT_FIELDS), retirar una traducción validada y los datos que abre el editor (BD simulada).
 */
import { describe, expect, it, vi } from "vitest";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import { CONTENT_FIELDS, I18nError, addLocale, saveContentTranslationDraft, unvalidateContentTranslation, validateContentTranslation, validateLocale } from "./i18nService";
import {
  ENTITY_HAS_SLUG, TRANSLATION_FIELD_SETS, canValidate, draftErrors, draftFromRow, draftPayload, isDraftDirty, pendingFieldKeys, translationState,
  type StoredTranslation,
} from "../shared/translationEditor";

const defs = TRANSLATION_FIELD_SETS.product;
const row = (over: Partial<StoredTranslation> = {}): StoredTranslation => ({ fields: { title: "Kajak-Tour", description: "Zwei Stunden" }, slug: "kajak-tour", status: "draft", ...over });

describe("editor de traducciones (lógica pura)", () => {
  it("los campos del producto son exactamente los que admite el servidor, con las mismas longitudes", () => {
    expect(Object.fromEntries(defs.map((d) => [d.key, d.max]))).toEqual(CONTENT_FIELDS.product);
    expect(ENTITY_HAS_SLUG.product).toBe(true);
  });

  it("estado: sin traducir / borrador / validada", () => {
    expect(translationState(null)).toBe("untranslated");
    expect(translationState(row({ fields: {} }))).toBe("untranslated");
    expect(translationState(row({ fields: { title: "   " } }))).toBe("untranslated");
    expect(translationState(row())).toBe("draft");
    expect(translationState(row({ status: "validated" }))).toBe("validated");
  });

  it("borrador desde lo guardado: todos los campos presentes, vacíos si no hay", () => {
    expect(draftFromRow(defs, null)).toEqual({ fields: { title: "", shortDescription: "", description: "", metaTitle: "", metaDescription: "" }, slug: "" });
    expect(draftFromRow(defs, row()).fields.title).toBe("Kajak-Tour");
    expect(draftFromRow(defs, row()).slug).toBe("kajak-tour");
  });

  it("lo que se envía: recortado, sin vacíos, dirección en minúsculas o null", () => {
    const d = { fields: { title: "  Kajak  ", shortDescription: "", description: " x ", metaTitle: "", metaDescription: "" }, slug: " Kajak-Tour " };
    expect(draftPayload(defs, d, true)).toEqual({ fields: { title: "Kajak", description: "x" }, slug: "kajak-tour" });
    expect(draftPayload(defs, { ...d, slug: "  " }, true).slug).toBeNull();
    expect(draftPayload(defs, d, false).slug).toBeNull();
  });

  it("cambios sin guardar: se comparan los textos que se enviarían, no los espacios", () => {
    const saved = row();
    const d = draftFromRow(defs, saved);
    expect(isDraftDirty(defs, d, saved, true)).toBe(false);
    expect(isDraftDirty(defs, { ...d, fields: { ...d.fields, title: "Kajak-Tour  " } }, saved, true)).toBe(false);
    expect(isDraftDirty(defs, { ...d, fields: { ...d.fields, title: "Kajaktour" } }, saved, true)).toBe(true);
    expect(isDraftDirty(defs, { ...d, slug: "otra" }, saved, true)).toBe(true);
    expect(isDraftDirty(defs, draftFromRow(defs, null), null, true)).toBe(false);
  });

  it("pendientes: con texto en el original y vacíos o iguales en la traducción", () => {
    const principal = { title: "Ruta en kayak", shortDescription: "Corta", description: "Dos horas", metaTitle: "", metaDescription: null };
    const d = draftFromRow(defs, row({ fields: { title: "Kajak-Tour", description: "Dos horas" } }));
    expect(pendingFieldKeys(defs, principal, d)).toEqual(["shortDescription", "description"]);
  });

  it("errores: nombre obligatorio, longitudes y formato de la dirección", () => {
    const ok = draftFromRow(defs, row());
    expect(draftErrors(defs, ok, true)).toEqual({});
    expect(draftErrors(defs, { ...ok, fields: { ...ok.fields, title: " " } }, true).title).toMatch(/nombre/);
    expect(draftErrors(defs, { ...ok, fields: { ...ok.fields, metaTitle: "x".repeat(257) } }, true).metaTitle).toMatch(/256/);
    expect(draftErrors(defs, { ...ok, slug: "Über uns" }, true).slug).toBeTruthy();
    expect(draftErrors(defs, { ...ok, slug: "Über uns" }, false).slug).toBeUndefined();
  });

  it("validar: solo un borrador guardado con textos y sin cambios pendientes", () => {
    expect(canValidate(null, false)).toBe(false);
    expect(canValidate(row(), false)).toBe(true);
    expect(canValidate(row(), true)).toBe(false);
    expect(canValidate(row({ status: "validated" }), false)).toBe(false);
  });
});

describe("retirar una traducción de producto validada", () => {
  const setup = async () => {
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    return repo;
  };

  it("guardar → validar → retirar: vuelve a borrador con sus textos y su dirección", async () => {
    const repo = await setup();
    await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "3", locale: "de", fields: { title: "Kajak-Tour", metaTitle: "Kajak" }, slug: "kajak-tour" });
    await validateContentTranslation(repo, "product", "3", "de", "ana");
    expect(await repo.contentTranslation("product", "3", "de")).toMatchObject({ status: "validated", validatedBy: "ana" });
    await unvalidateContentTranslation(repo, "product", "3", "de");
    expect(await repo.contentTranslation("product", "3", "de")).toMatchObject({ status: "draft", validatedAt: null, validatedBy: null, slug: "kajak-tour", fields: { title: "Kajak-Tour", metaTitle: "Kajak" } });
  });

  it("sin traducción, en el idioma principal o en un idioma no dado de alta: error para la persona", async () => {
    const repo = await setup();
    await expect(unvalidateContentTranslation(repo, "product", "3", "de")).rejects.toBeInstanceOf(I18nError);
    await expect(unvalidateContentTranslation(repo, "product", "3", "es")).rejects.toBeInstanceOf(I18nError);
    await expect(unvalidateContentTranslation(repo, "product", "3", "fr")).rejects.toBeInstanceOf(I18nError);
  });

  it("el servidor rechaza campos que no son del producto (precio) y direcciones repetidas", async () => {
    const repo = await setup();
    await expect(saveContentTranslationDraft(repo, { entityType: "product", entityKey: "3", locale: "de", fields: { basePrice: "1" } })).rejects.toThrow(/no se puede traducir/);
    await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "3", locale: "de", fields: { title: "A" }, slug: "kajak" });
    await expect(saveContentTranslationDraft(repo, { entityType: "product", entityKey: "4", locale: "de", fields: { title: "B" }, slug: "kajak" })).rejects.toThrow(/Otro producto/);
  });
});

// ─── Datos que abre el editor ──────────────────────────────────────────────────

const product = { id: 3, slug: "ruta-kayak", title: "Ruta en kayak", shortDescription: "Corta", description: null, metaTitle: "Kayak", metaDescription: null };
let productRows: unknown[] = [product];
vi.mock("./db", () => ({
  getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => productRows }) }) }) }),
}));

describe("productTranslationEditor", () => {
  it("una web de un solo idioma: no multidioma y sin traducciones", async () => {
    const { getProductTranslationEditor } = await import("./productTranslationsDb");
    const r = await getProductTranslationEditor(memoryI18nRepo({ pages: [], home: "inicio" }), 3);
    expect(r).toMatchObject({ multilingual: false, defaultLocale: "es", locales: [], translations: {} });
    expect(r.principal).toMatchObject({ id: 3, title: "Ruta en kayak", description: "", metaDescription: "" });
  });

  it("con alemán (validado) e inglés (sin validar): ambos idiomas, con su traducción o null", async () => {
    const { getProductTranslationEditor } = await import("./productTranslationsDb");
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    await validateLocale(repo, "de", "ana");
    await addLocale(repo, "en", "ana");
    await saveContentTranslationDraft(repo, { entityType: "product", entityKey: "3", locale: "de", fields: { title: "Kajak-Tour" }, slug: "kajak-tour" });
    const r = await getProductTranslationEditor(repo, 3);
    expect(r.multilingual).toBe(true);
    expect(r.locales).toEqual([{ locale: "de", status: "validated" }, { locale: "en", status: "draft" }]);
    expect(r.translations.de).toMatchObject({ fields: { title: "Kajak-Tour" }, slug: "kajak-tour", status: "draft" });
    expect(r.translations.en).toBeNull();
  });

  it("producto inexistente: principal null", async () => {
    productRows = [];
    const { getProductTranslationEditor } = await import("./productTranslationsDb");
    const r = await getProductTranslationEditor(memoryI18nRepo({ pages: [], home: "inicio" }), 99);
    expect(r.principal).toBeNull();
    productRows = [product];
  });
});
