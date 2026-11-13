/**
 * Repositorio SQL del multidioma (épica E-1) sobre la base de datos de la empresa en curso (`getDb()` resuelve la
 * suya; no hay caché ni estado compartido entre empresas). Tablas de la migración `multidioma_nativo`
 * (`site_locales`, `page_translations`, `content_translations`).
 *
 * Si las tablas aún no existen (migración sin aplicar), la lectura de idiomas devuelve «sin idiomas»: la web se
 * comporta como siempre y nunca falla por esto.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import type { PageBlock } from "../shared/pageBlocks";
import { readStoredBlocks } from "./_core/pageBlocks";
import type { LocaleEntry, TranslationStatus } from "../shared/i18n";
import type { ContentEntityType, ContentTranslationRow, I18nRepo, I18nSettings, PageTranslationRow, PrincipalPage, PublishedMeta } from "./i18nService";

type Row = Record<string, unknown>;

async function exec() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const d = await exec();
  const [r] = (await d.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

async function run(q: ReturnType<typeof sql>): Promise<void> {
  const d = await exec();
  await d.execute(q);
}

const parseJson = <T>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
};
const toJson = (v: unknown) => (v == null ? null : JSON.stringify(v));
const date = (v: unknown) => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const status = (v: unknown): TranslationStatus => (v === "validated" ? "validated" : "draft");

function pageRow(r: Row): PageTranslationRow {
  const draft = parseJson<unknown[]>(r.draft_blocks);
  const pub = parseJson<unknown[]>(r.published_blocks);
  return {
    pageId: Number(r.page_id), locale: String(r.locale), slug: String(r.slug),
    title: String(r.title), metaTitle: (r.meta_title as string) ?? null, metaDescription: (r.meta_description as string) ?? null, ogImageUrl: (r.og_image_url as string) ?? null,
    draftBlocks: draft ? (readStoredBlocks(draft) as PageBlock[]) : null,
    publishedSlug: (r.published_slug as string) ?? null,
    publishedMeta: parseJson<PublishedMeta>(r.published_meta),
    publishedBlocks: pub ? (readStoredBlocks(pub) as PageBlock[]) : null,
    status: status(r.status), baseHash: (r.base_hash as string) ?? null,
    validatedAt: date(r.validated_at), validatedBy: (r.validated_by as string) ?? null, updatedAt: date(r.updated_at),
  };
}

function contentRow(r: Row): ContentTranslationRow {
  return {
    entityType: String(r.entity_type) as ContentEntityType, entityKey: String(r.entity_key), locale: String(r.locale),
    fields: parseJson<Record<string, string>>(r.fields) ?? {}, slug: (r.slug as string) ?? null,
    status: status(r.status), validatedAt: date(r.validated_at), validatedBy: (r.validated_by as string) ?? null,
  };
}

const principal = (r: Row): PrincipalPage => ({ id: Number(r.id), slug: String(r.slug), title: String(r.title), isPublished: !!r.isPublished });

export function sqlI18nRepo(): I18nRepo {
  return {
    async listLocales() {
      try {
        const r = await rows(sql`SELECT locale, is_default, status, sort_order FROM site_locales ORDER BY sort_order, locale`);
        return r.map((x): LocaleEntry => ({ locale: String(x.locale), isDefault: !!x.is_default, status: status(x.status), sortOrder: Number(x.sort_order) }));
      } catch {
        // Tablas aún sin migrar: un solo idioma, como siempre
        return [];
      }
    },
    async insertLocale(e) {
      await run(sql`INSERT INTO site_locales (locale, is_default, status, sort_order, validated_at, validated_by)
        VALUES (${e.locale}, ${e.isDefault ? 1 : 0}, ${e.status}, ${e.sortOrder}, ${e.status === "validated" ? new Date() : null}, ${e.validatedBy ?? null})`);
    },
    async setLocaleStatus(locale, st, by) {
      await run(sql`UPDATE site_locales SET status = ${st}, validated_at = ${st === "validated" ? new Date() : null}, validated_by = ${st === "validated" ? by : null} WHERE locale = ${locale}`);
    },
    async deleteLocale(locale) {
      await run(sql`DELETE FROM site_locales WHERE locale = ${locale}`);
    },
    async readSettings(): Promise<I18nSettings> {
      try {
        const r = await rows(sql`SELECT \`key\`, value FROM system_settings WHERE \`key\` IN ('i18n_default_prefix','i18n_fallback','i18n_negotiate')`);
        const m = new Map(r.map((x) => [String(x.key), x.value == null ? null : String(x.value)]));
        return { defaultPrefix: m.get("i18n_default_prefix"), fallback: m.get("i18n_fallback"), negotiate: m.get("i18n_negotiate") };
      } catch {
        return {};
      }
    },
    async writeSetting(key, value) {
      await run(sql`INSERT INTO system_settings (\`key\`, value, category, label) VALUES (${key}, ${value}, 'web', ${`Multidioma: ${key}`}) ON DUPLICATE KEY UPDATE value = ${value}`);
    },

    async principalPageBySlug(slug) {
      const r = await rows(sql`SELECT id, slug, title, isPublished FROM static_pages WHERE slug = ${slug} LIMIT 1`);
      return r[0] ? principal(r[0]) : null;
    },
    async principalPageById(id) {
      const r = await rows(sql`SELECT id, slug, title, isPublished FROM static_pages WHERE id = ${id} LIMIT 1`);
      return r[0] ? principal(r[0]) : null;
    },
    async principalHomeSlug() {
      const { getHomeSlug, resolvePublicSlug } = await import("./pageBuilderDb");
      return resolvePublicSlug(await getHomeSlug());
    },

    async pageTranslation(pageId, locale) {
      const r = await rows(sql`SELECT * FROM page_translations WHERE page_id = ${pageId} AND locale = ${locale} LIMIT 1`);
      return r[0] ? pageRow(r[0]) : null;
    },
    async publishedTranslationBySlug(locale, slug) {
      const r = await rows(sql`SELECT * FROM page_translations WHERE locale = ${locale} AND published_slug = ${slug} AND status = 'validated' LIMIT 1`);
      return r[0] ? pageRow(r[0]) : null;
    },
    async listPageTranslations(f) {
      const r = await rows(sql`SELECT * FROM page_translations WHERE 1 = 1
        ${f.pageId !== undefined ? sql`AND page_id = ${f.pageId}` : sql``}
        ${f.locale !== undefined ? sql`AND locale = ${f.locale}` : sql``}
        ${f.onlyValidated ? sql`AND status = 'validated' AND published_slug IS NOT NULL` : sql``}
        ORDER BY updated_at DESC`);
      return r.map(pageRow);
    },
    async slugTaken(locale, slug, exceptPageId) {
      const r = await rows(sql`SELECT id FROM page_translations WHERE locale = ${locale} AND page_id <> ${exceptPageId} AND (slug = ${slug} OR published_slug = ${slug}) LIMIT 1`);
      return r.length > 0;
    },
    async savePageTranslation(t) {
      await run(sql`INSERT INTO page_translations
        (page_id, locale, slug, published_slug, published_meta, title, meta_title, meta_description, og_image_url, draft_blocks, published_blocks, status, base_hash, validated_at, validated_by)
        VALUES (${t.pageId}, ${t.locale}, ${t.slug}, ${t.publishedSlug}, ${toJson(t.publishedMeta)}, ${t.title}, ${t.metaTitle}, ${t.metaDescription}, ${t.ogImageUrl},
          ${toJson(t.draftBlocks)}, ${toJson(t.publishedBlocks)}, ${t.status}, ${t.baseHash}, ${t.validatedAt}, ${t.validatedBy})
        ON DUPLICATE KEY UPDATE slug = VALUES(slug), published_slug = VALUES(published_slug), published_meta = VALUES(published_meta), title = VALUES(title),
          meta_title = VALUES(meta_title), meta_description = VALUES(meta_description), og_image_url = VALUES(og_image_url), draft_blocks = VALUES(draft_blocks),
          published_blocks = VALUES(published_blocks), status = VALUES(status), base_hash = VALUES(base_hash), validated_at = VALUES(validated_at), validated_by = VALUES(validated_by)`);
    },

    async contentTranslation(type, key, locale) {
      const r = await rows(sql`SELECT * FROM content_translations WHERE entity_type = ${type} AND entity_key = ${key} AND locale = ${locale} LIMIT 1`);
      return r[0] ? contentRow(r[0]) : null;
    },
    async listContentTranslations(type, locale, onlyValidated) {
      const r = await rows(sql`SELECT * FROM content_translations WHERE entity_type = ${type} AND locale = ${locale} ${onlyValidated ? sql`AND status = 'validated'` : sql``}`);
      return r.map(contentRow);
    },
    async contentSlugTaken(type, locale, slug, exceptKey) {
      const r = await rows(sql`SELECT id FROM content_translations WHERE entity_type = ${type} AND locale = ${locale} AND slug = ${slug} AND entity_key <> ${exceptKey} LIMIT 1`);
      return r.length > 0;
    },
    async saveContentTranslation(t) {
      await run(sql`INSERT INTO content_translations (entity_type, entity_key, locale, fields, slug, status, validated_at, validated_by)
        VALUES (${t.entityType}, ${t.entityKey}, ${t.locale}, ${JSON.stringify(t.fields)}, ${t.slug}, ${t.status}, ${t.validatedAt}, ${t.validatedBy})
        ON DUPLICATE KEY UPDATE fields = VALUES(fields), slug = VALUES(slug), status = VALUES(status), validated_at = VALUES(validated_at), validated_by = VALUES(validated_by)`);
    },
  };
}
