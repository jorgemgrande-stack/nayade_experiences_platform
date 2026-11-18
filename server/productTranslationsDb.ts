/**
 * Editor «Idiomas» de un producto (E-1): textos del idioma principal y la traducción de cada idioma adicional
 * (`content_translations`, entity_type = product, entity_key = experiences.id). Solo lectura: guardar y validar van por
 * los procedimientos genéricos (`cms.saveContentTranslation`, `cms.validateContentTranslation`,
 * `cms.unvalidateContentTranslation`), que validan campos, longitudes, dirección e idioma.
 */
import { eq } from "drizzle-orm";
import { experiences } from "../drizzle/schema";
import { getDb } from "./db";
import { getI18nConfig, type I18nRepo } from "./i18nService";
import type { TranslationStatus } from "../shared/i18n";

export interface ProductTranslationEditor {
  multilingual: boolean;
  defaultLocale: string;
  /** Idiomas adicionales dados de alta (validado = ya visible en la web) */
  locales: { locale: string; status: TranslationStatus }[];
  principal: { id: number; slug: string; title: string; shortDescription: string; description: string; metaTitle: string; metaDescription: string } | null;
  translations: Record<string, { fields: Record<string, string>; slug: string | null; status: TranslationStatus; validatedAt: Date | null; validatedBy: string | null } | null>;
}

export async function getProductTranslationEditor(repo: I18nRepo, experienceId: number): Promise<ProductTranslationEditor> {
  const cfg = await getI18nConfig(repo);
  const locales = cfg.locales.filter((l) => !l.isDefault && l.locale !== cfg.defaultLocale).map((l) => ({ locale: l.locale, status: l.status }));
  const d = await getDb();
  const [p] = d
    ? await d
        .select({ id: experiences.id, slug: experiences.slug, title: experiences.title, shortDescription: experiences.shortDescription, description: experiences.description, metaTitle: experiences.metaTitle, metaDescription: experiences.metaDescription })
        .from(experiences)
        .where(eq(experiences.id, experienceId))
        .limit(1)
    : [];
  const translations: ProductTranslationEditor["translations"] = {};
  if (p) {
    for (const l of locales) {
      const row = await repo.contentTranslation("product", String(p.id), l.locale);
      translations[l.locale] = row ? { fields: row.fields, slug: row.slug, status: row.status, validatedAt: row.validatedAt, validatedBy: row.validatedBy } : null;
    }
  }
  return {
    multilingual: locales.length > 0,
    defaultLocale: cfg.defaultLocale,
    locales,
    principal: p
      ? { id: p.id, slug: p.slug, title: p.title, shortDescription: p.shortDescription ?? "", description: p.description ?? "", metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "" }
      : null,
    translations,
  };
}
