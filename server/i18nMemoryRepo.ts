/** Repositorio en memoria del multidioma, solo para pruebas (cada instancia = la base de datos de una empresa). */
import type { LocaleEntry } from "../shared/i18n";
import type { ContentTranslationRow, I18nRepo, I18nSettings, PageTranslationRow, PrincipalPage } from "./i18nService";

export function memoryI18nRepo(seed: { pages?: PrincipalPage[]; home?: string; settings?: I18nSettings } = {}) {
  const locales: LocaleEntry[] = [];
  const settings: Record<string, string> = {};
  const pages = [...(seed.pages ?? [])];
  const pt: PageTranslationRow[] = [];
  const ct: ContentTranslationRow[] = [];
  if (seed.settings?.fallback) settings.i18n_fallback = seed.settings.fallback;
  const repo: I18nRepo = {
    async listLocales() { return locales.map((l) => ({ ...l })); },
    async insertLocale(e) { locales.push({ locale: e.locale, isDefault: e.isDefault, status: e.status, sortOrder: e.sortOrder }); },
    async setLocaleStatus(locale, status) { const l = locales.find((x) => x.locale === locale); if (l) l.status = status; },
    async deleteLocale(locale) { const i = locales.findIndex((x) => x.locale === locale); if (i >= 0) locales.splice(i, 1); },
    async readSettings() { return { defaultPrefix: settings.i18n_default_prefix, fallback: settings.i18n_fallback, negotiate: settings.i18n_negotiate }; },
    async writeSetting(k, v) { settings[k] = v; },
    async principalPageBySlug(slug) { return pages.find((p) => p.slug === slug) ?? null; },
    async principalPageById(id) { return pages.find((p) => p.id === id) ?? null; },
    async principalHomeSlug() { return seed.home ?? "inicio"; },
    async pageTranslation(pageId, locale) { return pt.find((t) => t.pageId === pageId && t.locale === locale) ?? null; },
    async publishedTranslationBySlug(locale, slug) { return pt.find((t) => t.locale === locale && t.publishedSlug === slug && t.status === "validated") ?? null; },
    async listPageTranslations(f) {
      return pt.filter((t) => (f.pageId === undefined || t.pageId === f.pageId) && (f.locale === undefined || t.locale === f.locale) && (!f.onlyValidated || (t.status === "validated" && !!t.publishedSlug)));
    },
    async slugTaken(locale, slug, except) { return pt.some((t) => t.locale === locale && t.pageId !== except && (t.slug === slug || t.publishedSlug === slug)); },
    async savePageTranslation(row) { const i = pt.findIndex((t) => t.pageId === row.pageId && t.locale === row.locale); if (i >= 0) pt[i] = row; else pt.push(row); },
    async contentTranslation(type, key, locale) { return ct.find((t) => t.entityType === type && t.entityKey === key && t.locale === locale) ?? null; },
    async listContentTranslations(type, locale, only) { return ct.filter((t) => t.entityType === type && t.locale === locale && (!only || t.status === "validated")); },
    async contentSlugTaken(type, locale, slug, except) { return ct.some((t) => t.entityType === type && t.locale === locale && t.slug === slug && t.entityKey !== except); },
    async saveContentTranslation(row) { const i = ct.findIndex((t) => t.entityType === row.entityType && t.entityKey === row.entityKey && t.locale === row.locale); if (i >= 0) ct[i] = row; else ct.push(row); },
  };
  return repo;
}
