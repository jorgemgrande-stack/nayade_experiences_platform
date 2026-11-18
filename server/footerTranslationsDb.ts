/**
 * Editor «Idiomas» del pie: el texto del pie y los elementos del menú «pie» (títulos de columna y enlaces) en cada
 * idioma adicional. Solo lectura: guardar y validar van por los procedimientos genéricos de traducción de contenido
 * (`cms.saveContentTranslation`, `cms.validateContentTranslation`, `cms.unvalidateContentTranslation`).
 */
import { asc, eq } from "drizzle-orm";
import { menuItems } from "../drizzle/schema";
import { getDb } from "./db";
import { getSystemSetting } from "./config";
import { getI18nConfig, type I18nRepo } from "./i18nService";
import type { TranslationStatus } from "../shared/i18n";

type StoredRow = { fields: Record<string, string>; slug: string | null; status: TranslationStatus; validatedAt: Date | null; validatedBy: string | null } | null;

export interface FooterTranslationEditor {
  multilingual: boolean;
  defaultLocale: string;
  locales: { locale: string; status: TranslationStatus }[];
  /** Texto del pie en el idioma principal y su traducción por idioma */
  text: { key: string; principal: { value: string }; translations: Record<string, StoredRow> };
  /** Elementos del menú «pie» (columnas y enlaces), con su texto original y su traducción */
  items: Array<{ id: number; parentId: number | null; isActive: boolean; hasUrl: boolean; principal: { label: string }; translations: Record<string, StoredRow> }>;
}

export const FOOTER_TEXT_KEY = "site_footer_text";

export async function getFooterTranslationEditor(repo: I18nRepo): Promise<FooterTranslationEditor> {
  const cfg = await getI18nConfig(repo);
  const locales = cfg.locales.filter((l) => !l.isDefault && l.locale !== cfg.defaultLocale).map((l) => ({ locale: l.locale, status: l.status }));
  const principalText = ((await getSystemSetting(FOOTER_TEXT_KEY, "")) ?? "").trim();
  const d = await getDb();
  const rows = d && locales.length
    ? await d.select({ id: menuItems.id, parentId: menuItems.parentId, label: menuItems.label, url: menuItems.url, isActive: menuItems.isActive }).from(menuItems).where(eq(menuItems.menuZone, "footer")).orderBy(asc(menuItems.sortOrder), asc(menuItems.id))
    : [];
  const byType = new Map<string, Map<string, StoredRow>>();
  for (const l of locales) {
    for (const type of ["menu_item", "setting"] as const) {
      const list = await repo.listContentTranslations(type, l.locale, false);
      byType.set(`${type}:${l.locale}`, new Map(list.map((r) => [r.entityKey, { fields: r.fields, slug: r.slug, status: r.status, validatedAt: r.validatedAt, validatedBy: r.validatedBy }])));
    }
  }
  const pick = (type: "menu_item" | "setting", key: string) => Object.fromEntries(locales.map((l) => [l.locale, byType.get(`${type}:${l.locale}`)?.get(key) ?? null]));
  return {
    multilingual: locales.length > 0,
    defaultLocale: cfg.defaultLocale,
    locales,
    text: { key: FOOTER_TEXT_KEY, principal: { value: principalText }, translations: pick("setting", FOOTER_TEXT_KEY) },
    items: rows.map((r) => ({ id: r.id, parentId: r.parentId ?? null, isActive: r.isActive, hasUrl: !!r.url, principal: { label: r.label }, translations: pick("menu_item", String(r.id)) })),
  };
}
