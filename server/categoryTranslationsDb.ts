/**
 * Editor «Idiomas» de las categorías de la tienda: nombre original y traducción de cada idioma adicional
 * (`content_translations`, entity_type = category, entity_key = categories.id). Solo lectura: guardar y validar van por
 * los procedimientos genéricos (`cms.saveContentTranslation`, `cms.validateContentTranslation`,
 * `cms.unvalidateContentTranslation`), que validan campos, longitudes e idioma.
 */
import { asc } from "drizzle-orm";
import { categories } from "../drizzle/schema";
import { getDb } from "./db";
import { getI18nConfig, type I18nRepo } from "./i18nService";
import type { TranslationStatus } from "../shared/i18n";

type StoredRow = { fields: Record<string, string>; slug: string | null; status: TranslationStatus; validatedAt: Date | null; validatedBy: string | null } | null;

export interface CategoryTranslationEditor {
  multilingual: boolean;
  defaultLocale: string;
  /** Idiomas adicionales dados de alta (validado = ya visible en la web) */
  locales: { locale: string; status: TranslationStatus }[];
  categories: Array<{ id: number; slug: string; isActive: boolean; principal: { name: string }; translations: Record<string, StoredRow> }>;
}

export async function getCategoryTranslationEditor(repo: I18nRepo): Promise<CategoryTranslationEditor> {
  const cfg = await getI18nConfig(repo);
  const locales = cfg.locales.filter((l) => !l.isDefault && l.locale !== cfg.defaultLocale).map((l) => ({ locale: l.locale, status: l.status }));
  const d = await getDb();
  const rows = d && locales.length ? await d.select({ id: categories.id, slug: categories.slug, name: categories.name, isActive: categories.isActive }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)) : [];
  // Una lectura por idioma (no una por categoría e idioma)
  const byLocale = new Map<string, Map<string, StoredRow>>();
  for (const l of locales) {
    const list = await repo.listContentTranslations("category", l.locale, false);
    byLocale.set(l.locale, new Map(list.map((r) => [r.entityKey, { fields: r.fields, slug: r.slug, status: r.status, validatedAt: r.validatedAt, validatedBy: r.validatedBy }])));
  }
  return {
    multilingual: locales.length > 0,
    defaultLocale: cfg.defaultLocale,
    locales,
    categories: rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      isActive: c.isActive,
      principal: { name: c.name },
      translations: Object.fromEntries(locales.map((l) => [l.locale, byLocale.get(l.locale)?.get(String(c.id)) ?? null])),
    })),
  };
}
