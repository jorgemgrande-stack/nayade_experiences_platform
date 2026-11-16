/**
 * Plan (solo lectura) del cambio de idioma principal de la empresa en curso: reúne los datos reales y aplica
 * `planDefaultLocaleChange` (shared/i18nDefaultPlan.ts). No modifica nada.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import type { I18nRepo } from "./i18nService";
import { CONTENT_ENTITY_TYPES } from "./i18nService";
import { planDefaultLocaleChange, type DefaultLocalePlan } from "../shared/i18nDefaultPlan";

type Row = Record<string, any>;

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [r] = (await d.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

export async function planDefaultLocale(repo: I18nRepo, targetLocale: unknown): Promise<DefaultLocalePlan> {
  const [locales, home, pageRows, menuRows, translations, productCount] = await Promise.all([
    repo.listLocales(),
    repo.principalHomeSlug(),
    rows(sql`SELECT id, slug, title, isPublished FROM static_pages ORDER BY id`),
    rows(sql`SELECT id, label, url, isActive FROM menu_items ORDER BY id`),
    repo.listPageTranslations({}),
    rows(sql`SELECT COUNT(*) AS n FROM experiences`).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
  ]);
  const target = typeof targetLocale === "string" ? targetLocale.trim().toLowerCase() : "";
  const content = (await Promise.all(CONTENT_ENTITY_TYPES.map((t) => repo.listContentTranslations(t, target, false)))).flat();
  return planDefaultLocaleChange({
    target: targetLocale,
    locales: locales.map((l) => ({ locale: l.locale, isDefault: l.isDefault, status: l.status === "validated" ? "validated" : "draft" })),
    pages: pageRows.map((p) => ({ id: Number(p.id), slug: String(p.slug), title: String(p.title), isPublished: !!Number(p.isPublished), isHome: String(p.slug) === home })),
    pageTranslations: translations.map((t) => ({
      pageId: t.pageId, locale: t.locale, slug: t.slug, publishedSlug: t.publishedSlug, status: t.status === "validated" ? "validated" : "draft",
      hasPublishedBlocks: Array.isArray(t.publishedBlocks) && t.publishedBlocks.length > 0, hasDraftBlocks: Array.isArray(t.draftBlocks) && t.draftBlocks.length > 0,
    })),
    menuItems: menuRows.map((m) => ({ id: Number(m.id), label: String(m.label), url: String(m.url ?? ""), isVisible: !!Number(m.isActive) })),
    contentTranslations: content.map((c) => ({ entityType: c.entityType, entityKey: c.entityKey, locale: c.locale, status: c.status === "validated" ? "validated" : "draft" })),
    contentCounts: { product: productCount },
  });
}
