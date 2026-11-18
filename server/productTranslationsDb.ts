/**
 * Editor «Idiomas» de un producto (E-1): textos del idioma principal y la traducción de cada idioma adicional
 * (`content_translations`, entity_type = product, entity_key = experiences.id). Solo lectura: guardar y validar van por
 * los procedimientos genéricos (`cms.saveContentTranslation`, `cms.validateContentTranslation`,
 * `cms.unvalidateContentTranslation`), que validan campos, longitudes, dirección e idioma.
 */
import { eq } from "drizzle-orm";
import { experiences, experienceVariants } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getI18nConfig, type I18nRepo } from "./i18nService";
import type { TranslationStatus } from "../shared/i18n";

export interface ProductTranslationEditor {
  multilingual: boolean;
  defaultLocale: string;
  /** Idiomas adicionales dados de alta (validado = ya visible en la web) */
  locales: { locale: string; status: TranslationStatus }[];
  principal: { id: number; slug: string; title: string; shortDescription: string; description: string; metaTitle: string; metaDescription: string; duration: string; requirements: string; includes: string; excludes: string; requestCtaLabel: string } | null;
  /** Opciones (variantes) y convocatorias del producto, con su texto original y su traducción por idioma */
  variants: SubItem[];
  editions: SubItem[];
  translations: Record<string, { fields: Record<string, string>; slug: string | null; status: TranslationStatus; validatedAt: Date | null; validatedBy: string | null } | null>;
}

export interface SubItem {
  id: number;
  principal: Record<string, string>;
  translations: ProductTranslationEditor["translations"];
}

const lines = (v: unknown): string => (Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : "");

export async function getProductTranslationEditor(repo: I18nRepo, experienceId: number): Promise<ProductTranslationEditor> {
  const cfg = await getI18nConfig(repo);
  const locales = cfg.locales.filter((l) => !l.isDefault && l.locale !== cfg.defaultLocale).map((l) => ({ locale: l.locale, status: l.status }));
  const d = await getDb();
  const [p] = d
    ? await d
        .select({ id: experiences.id, slug: experiences.slug, title: experiences.title, shortDescription: experiences.shortDescription, description: experiences.description, metaTitle: experiences.metaTitle, metaDescription: experiences.metaDescription, duration: experiences.duration, requirements: experiences.requirements, includes: experiences.includes, excludes: experiences.excludes, requestCtaLabel: experiences.requestCtaLabel })
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
  const rowOf = async (type: "variant" | "edition", key: number) => {
    const out: ProductTranslationEditor["translations"] = {};
    for (const l of locales) {
      const row = await repo.contentTranslation(type, String(key), l.locale);
      out[l.locale] = row ? { fields: row.fields, slug: row.slug, status: row.status, validatedAt: row.validatedAt, validatedBy: row.validatedBy } : null;
    }
    return out;
  };
  const variants: SubItem[] = [];
  const editions: SubItem[] = [];
  if (p && d && locales.length) {
    for (const v of await d.select({ id: experienceVariants.id, name: experienceVariants.name, description: experienceVariants.description }).from(experienceVariants).where(eq(experienceVariants.experienceId, p.id))) {
      variants.push({ id: v.id, principal: { name: v.name ?? "", description: v.description ?? "" }, translations: await rowOf("variant", v.id) });
    }
    // Convocatorias (0070): sin la tabla, ninguna
    const eds = (await d.execute(sql`SELECT id, label, schedule_note, location_note FROM product_editions WHERE experience_id = ${p.id} AND status <> 'cancelled' ORDER BY starts_at`).catch(() => [[]])) as unknown as [Array<{ id: number; label: string; schedule_note: string | null; location_note: string | null }>];
    for (const e of eds[0] ?? []) editions.push({ id: Number(e.id), principal: { label: String(e.label ?? ""), scheduleNote: e.schedule_note ?? "", locationNote: e.location_note ?? "" }, translations: await rowOf("edition", Number(e.id)) });
  }
  return {
    multilingual: locales.length > 0,
    variants,
    editions,
    defaultLocale: cfg.defaultLocale,
    locales,
    principal: p
      ? { id: p.id, slug: p.slug, title: p.title, shortDescription: p.shortDescription ?? "", description: p.description ?? "", metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "", duration: p.duration ?? "", requirements: p.requirements ?? "", includes: lines(p.includes), excludes: lines(p.excludes), requestCtaLabel: p.requestCtaLabel ?? "" }
      : null,
    translations,
  };
}
