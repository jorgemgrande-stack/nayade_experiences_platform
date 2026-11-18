/**
 * Cambio del idioma principal de la empresa en curso (intercambio de papeles base ↔ traducción).
 * Diseño: docs/elephant-source/DISENO_IDIOMA_PRINCIPAL.md. Reglas puras en shared/i18nSwap.ts y shared/i18nDefaultPlan.ts.
 *
 * Garantías:
 *  - Plan previo de solo lectura (`planDefaultLocale`): si hay un bloqueo, no se toca nada.
 *  - TODO ocurre en UNA transacción: copia previa (tabla `i18n_default_changes`), intercambio, redirecciones 301,
 *    comprobación posterior y registro. Si algo falla, la base de datos queda exactamente como estaba.
 *  - Vuelta atrás: `rollbackDefaultLocaleChange` restaura la copia previa (también en una transacción).
 *  - Alcance: páginas (borrador, publicado, historial), menús y ajustes traducibles, idiomas y redirecciones, y el catálogo
 *    de la tienda (productos, opciones y convocatorias) que tenga traducción VALIDADA al idioma nuevo: sus textos pasan al
 *    contenido base y los anteriores quedan como traducción al idioma anterior (también el slug del producto, si no choca;
 *    la dirección antigua `/tienda/<slug>` lleva entonces a `/<anterior>/tienda/<slug>`). Lo que no tiene traducción al
 *    idioma nuevo conserva su contenido base (en Quantum ya está escrito en alemán). Los formularios NO se intercambian.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { I18nError, getI18nConfig, type I18nRepo } from "./i18nService";
import { planDefaultLocale } from "./i18nDefaultPlanServer";
import { invalidateI18nCache } from "./i18nSqlRepo";
import { invalidateRedirectCache } from "./redirectsDb";
import { blocksToHtml, htmlToBlocks, readStoredBlocks } from "./_core/pageBlocks";
import { plainTextToHtml } from "./_core/templates/starterSite";
import { blockToRowData, rowToBlock } from "./pageBuilderDb";
import { CATALOG_SWAP_COLUMNS, swapCatalogFields, swapMenuUrl, swapPageRoles, type CatalogSwapType } from "../shared/i18nSwap";
import { localizedPath } from "../shared/i18n";
import { normalizeFromPath } from "../shared/redirects";
import type { PageBlock } from "../shared/pageBlocks";

type Row = Record<string, any>;
type Tx = { execute: (q: any) => Promise<any> };
export interface Actor { id?: number | null; name?: string | null }

const DRAFT = "borrador:";
const VERSION = "version:";
const TMP = "~swap~";

const qrows = async (tx: Tx, q: ReturnType<typeof sql>): Promise<Row[]> => { const [r] = await tx.execute(q); return Array.isArray(r) ? r : []; };
const qrun = async (tx: Tx, q: ReturnType<typeof sql>) => { const [h] = await tx.execute(q); return { insertId: Number(h?.insertId ?? 0), affected: Number(h?.affectedRows ?? 0) }; };
const jv = (v: unknown): string | null => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
const parseJson = <T>(v: unknown): T | null => { if (v == null) return null; if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } } return v as T; };
const dt = (col: string) => sql.raw(`DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`);
const inList = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

export interface SwapSummary {
  from: string; to: string;
  pages: { swapped: number; skipped: string[]; slugChanges: { from: string; to: string }[] };
  menuItems: number; settings: number;
  redirects: { created: number; updated: number; deleted: number };
  /** Catálogo de la tienda intercambiado (elementos con traducción validada al idioma nuevo). */
  catalog?: { products: number; variants: number; editions: number; slugChanges: { from: string; to: string }[] };
}

interface Snapshot {
  version: 1;
  pageIds: number[];
  pages: Row[];
  blockKeys: string[];
  blocks: Row[];
  menu: Row[];
  settings: Row[];
  pageTranslations: Row[];
  contentTranslations: Row[];
  locales: Row[];
  redirects: { created: number[]; updated: Row[]; deleted: Row[] };
  /** Tipos de `content_translations` incluidos en la copia (sin el campo: copias anteriores, solo menús y ajustes). */
  contentTypes?: string[];
  /** Filas base del catálogo antes del intercambio (solo las que se intercambian). */
  catalog?: Record<CatalogSwapType, Row[]>;
}

const SNAPSHOT_CONTENT_TYPES = ["menu_item", "setting", "product", "variant", "edition"];
const CATALOG_TABLE: Record<CatalogSwapType, string> = { product: "experiences", variant: "experience_variants", edition: "product_editions" };
const catalogCols = (type: CatalogSwapType) => Object.values(CATALOG_SWAP_COLUMNS[type] as Record<string, string>);

function blocksFromRows(rows: Row[]): PageBlock[] | null {
  const vis = rows.filter((r) => Number(r.isVisible) === 1 || r.isVisible === true);
  if (!vis.length) return null;
  const list = readStoredBlocks(vis.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map((r) => rowToBlock({ ...(parseJson<Record<string, unknown>>(r.data) ?? {}), type: r.blockType })));
  return list.length ? list : null;
}

export async function applyDefaultLocaleChange(repo: I18nRepo, targetRaw: unknown, actor: Actor = {}): Promise<SwapSummary & { changeId: number; checks: string[] }> {
  const plan = await planDefaultLocale(repo, targetRaw);
  if (!plan.canApply || !plan.target || !plan.current) {
    const first = plan.issues.filter((i) => i.severity === "blocker").slice(0, 3).map((i) => i.message).join(" ");
    throw new I18nError(`No se puede cambiar el idioma principal todavía. ${first}`.trim());
  }
  const target = plan.target;
  const old = plan.current;
  const home = await repo.principalHomeSlug();
  const cfg = await getI18nConfig(repo);
  const actorName = (actor.name ?? "").slice(0, 128) || null;
  const by = actorName ?? "cambio de idioma principal";
  const d = await getDb();
  if (!d) throw new I18nError("Base de datos no disponible");

  const out = await d.transaction(async (tx: Tx) => {
    const pages = await qrows(tx, sql`SELECT id, slug, title, content, metaTitle, metaDescription, isPublished FROM static_pages ORDER BY id`);
    const trRows = await qrows(tx, sql`SELECT page_id, locale, slug, published_slug, published_meta, title, meta_title, meta_description, draft_blocks, published_blocks, status FROM page_translations WHERE locale = ${target}`);
    const trByPage = new Map(trRows.map((r) => [Number(r.page_id), r]));
    const swappableIds = new Set(plan.pages.filter((p) => p.swappable).map((p) => p.id));
    const skipped: string[] = [];

    // 1) Lectura del contenido base de cada página que se intercambia (dentro de la transacción)
    const work: { page: Row; swap: ReturnType<typeof swapPageRoles>; old: { published: PageBlock[] | null; draft: PageBlock[] | null } }[] = [];
    for (const p of pages) {
      const tr = trByPage.get(Number(p.id));
      if (!swappableIds.has(Number(p.id)) || !tr) { skipped.push(String(p.slug)); continue; }
      const pubRows = await qrows(tx, sql`SELECT blockType, sortOrder, data, isVisible FROM page_blocks WHERE pageSlug = ${String(p.slug)}`);
      const draftRows = await qrows(tx, sql`SELECT data FROM page_blocks WHERE pageSlug = ${DRAFT + String(p.slug)} LIMIT 1`);
      let oldPub = blocksFromRows(pubRows);
      if (!oldPub && String(p.content ?? "").trim()) oldPub = htmlToBlocks(plainTextToHtml(String(p.content)));
      const draftData = draftRows[0] ? parseJson<{ blocks?: unknown }>(draftRows[0].data) : null;
      const oldDraft = draftData?.blocks ? readStoredBlocks(draftData.blocks) : null;
      const swap = swapPageRoles(
        { slug: String(p.slug), title: String(p.title), metaTitle: p.metaTitle ?? null, metaDescription: p.metaDescription ?? null, isPublished: !!Number(p.isPublished), isHome: String(p.slug) === home, publishedBlocks: oldPub, draftBlocks: oldDraft?.length ? oldDraft : null },
        {
          slug: String(tr.slug), publishedSlug: tr.published_slug ?? null, title: String(tr.title), metaTitle: tr.meta_title ?? null, metaDescription: tr.meta_description ?? null,
          draftBlocks: parseJson<PageBlock[]>(tr.draft_blocks) ? readStoredBlocks(parseJson(tr.draft_blocks)) : null,
          publishedBlocks: parseJson<PageBlock[]>(tr.published_blocks) ? readStoredBlocks(parseJson(tr.published_blocks)) : null,
          publishedMeta: parseJson(tr.published_meta), status: tr.status === "validated" ? "validated" : "draft",
        },
      );
      work.push({ page: p, swap, old: { published: oldPub, draft: oldDraft } });
    }
    if (!work.length) throw new I18nError("No hay ninguna página que intercambiar.");

    // 2) Copia previa (dentro de la misma transacción: se confirma o se deshace junto con el cambio)
    const pageIds = work.map((w) => Number(w.page.id));
    const oldSlugs = work.map((w) => String(w.page.slug));
    const newSlugs = work.map((w) => w.swap.base.slug);
    const blockKeys = Array.from(new Set(oldSlugs.concat(newSlugs).flatMap((s) => [s, DRAFT + s, VERSION + s])));
    const snap: Snapshot = {
      version: 1, pageIds, blockKeys,
      pages: pages.filter((p) => pageIds.includes(Number(p.id))).map((p) => ({ id: p.id, slug: p.slug, title: p.title, content: p.content, metaTitle: p.metaTitle, metaDescription: p.metaDescription })),
      blocks: await qrows(tx, sql`SELECT pageSlug, blockType, sortOrder, data, isVisible FROM page_blocks WHERE pageSlug IN (${inList(blockKeys)})`),
      menu: await qrows(tx, sql`SELECT id, label, url FROM menu_items`),
      settings: [],
      pageTranslations: await qrows(tx, sql`SELECT page_id, locale, slug, published_slug, published_meta, title, meta_title, meta_description, og_image_url, draft_blocks, published_blocks, status, base_hash, ${dt("validated_at")} AS validated_at, validated_by FROM page_translations WHERE page_id IN (${sql.join(pageIds.map((i) => sql`${i}`), sql`, `)}) AND locale IN (${target}, ${old})`),
      contentTranslations: await qrows(tx, sql`SELECT entity_type, entity_key, locale, fields, slug, status, ${dt("validated_at")} AS validated_at, validated_by FROM content_translations WHERE entity_type IN (${inList(SNAPSHOT_CONTENT_TYPES)}) AND locale IN (${target}, ${old})`),
      contentTypes: SNAPSHOT_CONTENT_TYPES,
      catalog: { product: [], variant: [], edition: [] },
      locales: await qrows(tx, sql`SELECT locale, is_default, status, sort_order, ${dt("validated_at")} AS validated_at, validated_by FROM site_locales WHERE locale IN (${target}, ${old})`),
      redirects: { created: [], updated: [], deleted: [] },
    };

    // 3) Páginas: fase 1 (liberar direcciones), fase 2 (contenido nuevo)
    const slugMap = new Map<string, string>();
    for (const w of work) if (w.swap.slugChanged) slugMap.set(String(w.page.slug), w.swap.base.slug);
    for (const w of work) {
      const s = String(w.page.slug);
      await qrun(tx, sql`DELETE FROM page_blocks WHERE pageSlug IN (${s}, ${DRAFT + s}, ${w.swap.base.slug}, ${DRAFT + w.swap.base.slug})`);
      await qrun(tx, sql`UPDATE page_blocks SET pageSlug = ${VERSION + TMP + w.page.id} WHERE pageSlug = ${VERSION + s}`);
      if (w.swap.slugChanged) await qrun(tx, sql`UPDATE static_pages SET slug = ${TMP + w.page.id} WHERE id = ${w.page.id}`);
    }
    for (const w of work) {
      const b = w.swap.base;
      const content = b.publishedBlocks ? blocksToHtml(b.publishedBlocks) : "";
      await qrun(tx, sql`UPDATE static_pages SET slug = ${b.slug}, title = ${b.title}, metaTitle = ${b.metaTitle}, metaDescription = ${b.metaDescription}, content = ${content}, updatedAt = NOW() WHERE id = ${w.page.id}`);
      if (b.publishedBlocks) {
        for (let i = 0; i < b.publishedBlocks.length; i++) {
          const blk = b.publishedBlocks[i];
          await qrun(tx, sql`INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (${b.slug}, ${blk.type}, ${i}, ${JSON.stringify(blockToRowData(blk))}, 1)`);
        }
      }
      if (b.draftBlocks) {
        await qrun(tx, sql`INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (${DRAFT + b.slug}, 'borrador', 0, ${JSON.stringify({ blocks: b.draftBlocks, savedAt: new Date().toISOString() })}, 0)`);
      }
      await qrun(tx, sql`UPDATE page_blocks SET pageSlug = ${VERSION + b.slug} WHERE pageSlug = ${VERSION + TMP + w.page.id}`);
      // Traducciones: la del idioma nuevo desaparece (ya es el base) y nace la del anterior
      await qrun(tx, sql`DELETE FROM page_translations WHERE page_id = ${w.page.id} AND locale IN (${target}, ${old})`);
      const o = w.swap.oldLocaleTranslation;
      await qrun(tx, sql`INSERT INTO page_translations
        (page_id, locale, slug, published_slug, published_meta, title, meta_title, meta_description, og_image_url, draft_blocks, published_blocks, status, base_hash, validated_at, validated_by)
        VALUES (${w.page.id}, ${old}, ${o.slug}, ${o.publishedSlug}, ${jv(o.publishedMeta)}, ${o.title}, ${o.metaTitle}, ${o.metaDescription}, ${null},
          ${jv(o.draftBlocks)}, ${jv(o.publishedBlocks)}, ${o.status}, ${o.baseHash}, ${o.status === "validated" ? new Date() : null}, ${o.status === "validated" ? by : null})`);
    }

    // 4) Menús (etiqueta y dirección) y ajustes traducibles
    const menuTr = await qrows(tx, sql`SELECT entity_key, fields, status FROM content_translations WHERE entity_type = 'menu_item' AND locale = ${target}`);
    const menuTrByKey = new Map(menuTr.map((r) => [String(r.entity_key), r]));
    let menuCount = 0;
    for (const m of snap.menu) {
      const t = menuTrByKey.get(String(m.id));
      const fields = t && t.status === "validated" ? parseJson<Record<string, string>>(t.fields) ?? {} : null;
      const url = swapMenuUrl(m.url ?? null, fields?.url, slugMap);
      const label = fields?.label?.trim() ? fields.label.trim().slice(0, 128) : String(m.label);
      if (fields) {
        await qrun(tx, sql`DELETE FROM content_translations WHERE entity_type = 'menu_item' AND entity_key = ${String(m.id)} AND locale IN (${target}, ${old})`);
        await qrun(tx, sql`INSERT INTO content_translations (entity_type, entity_key, locale, fields, slug, status, validated_at, validated_by) VALUES ('menu_item', ${String(m.id)}, ${old}, ${JSON.stringify({ label: m.label, url: m.url ?? "" })}, NULL, 'validated', NOW(), ${by})`);
        menuCount++;
      }
      if (label !== m.label || url !== (m.url ?? null)) await qrun(tx, sql`UPDATE menu_items SET label = ${label}, url = ${url}, updatedAt = NOW() WHERE id = ${m.id}`);
    }
    const setTr = await qrows(tx, sql`SELECT entity_key, fields FROM content_translations WHERE entity_type = 'setting' AND locale = ${target} AND status = 'validated'`);
    let settingCount = 0;
    for (const s of setTr) {
      const key = String(s.entity_key);
      const cur = (await qrows(tx, sql`SELECT value FROM system_settings WHERE \`key\` = ${key} LIMIT 1`))[0];
      const val = parseJson<Record<string, string>>(s.fields)?.value;
      if (!cur || typeof val !== "string") continue;
      snap.settings.push({ key, value: cur.value });
      await qrun(tx, sql`UPDATE system_settings SET value = ${val} WHERE \`key\` = ${key}`);
      await qrun(tx, sql`DELETE FROM content_translations WHERE entity_type = 'setting' AND entity_key = ${key} AND locale IN (${target}, ${old})`);
      await qrun(tx, sql`INSERT INTO content_translations (entity_type, entity_key, locale, fields, slug, status, validated_at, validated_by) VALUES ('setting', ${key}, ${old}, ${JSON.stringify({ value: cur.value ?? "" })}, NULL, 'validated', NOW(), ${by})`);
      settingCount++;
    }

    // 4b) Catálogo de la tienda: solo lo que tiene traducción VALIDADA al idioma nuevo (lo demás conserva su base)
    const catalogOut = { products: 0, variants: 0, editions: 0, slugChanges: [] as { from: string; to: string }[] };
    const swappedCatalog: { type: CatalogSwapType; key: string }[] = [];
    for (const type of ["product", "variant", "edition"] as CatalogSwapType[]) {
      const trs = await qrows(tx, sql`SELECT entity_key, fields, slug FROM content_translations WHERE entity_type = ${type} AND locale = ${target} AND status = 'validated'`);
      if (!trs.length) continue;
      const table = sql.raw(CATALOG_TABLE[type]);
      const cols = sql.raw(catalogCols(type).map((c) => `\`${c}\``).join(", "));
      for (const t of trs) {
        const key = String(t.entity_key);
        if (!/^[1-9]\d{0,9}$/.test(key)) continue;
        const fields = parseJson<Record<string, string>>(t.fields) ?? {};
        const baseRow = (await qrows(tx, sql`SELECT id${type === "product" ? sql`, slug` : sql``}, ${cols} FROM ${table} WHERE id = ${Number(key)} LIMIT 1`))[0];
        if (!baseRow) continue;
        const { update, oldFields } = swapCatalogFields(type, baseRow, fields);
        // Slug del producto: el traducido pasa a ser el de la tienda si ningún otro producto lo usa
        let oldSlug: string | null = null;
        let newSlug: string | null = null;
        const trSlug = typeof t.slug === "string" && t.slug.trim() ? t.slug.trim() : null;
        if (type === "product" && trSlug && trSlug !== String(baseRow.slug)) {
          const taken = (await qrows(tx, sql`SELECT id FROM experiences WHERE slug = ${trSlug} AND id <> ${Number(key)} LIMIT 1`))[0];
          if (!taken) { oldSlug = String(baseRow.slug); newSlug = trSlug; }
        }
        if (!Object.keys(update).length && !newSlug) continue;
        snap.catalog![type].push({ ...baseRow });
        const sets = Object.entries(update).map(([c, v]) => sql`${sql.raw(`\`${c}\``)} = ${v}`);
        if (newSlug) sets.push(sql`slug = ${newSlug}`);
        await qrun(tx, sql`UPDATE ${table} SET ${sql.join(sets, sql`, `)} WHERE id = ${Number(key)}`);
        await qrun(tx, sql`DELETE FROM content_translations WHERE entity_type = ${type} AND entity_key = ${key} AND locale IN (${target}, ${old})`);
        if (Object.keys(oldFields).length || oldSlug) {
          await qrun(tx, sql`INSERT INTO content_translations (entity_type, entity_key, locale, fields, slug, status, validated_at, validated_by) VALUES (${type}, ${key}, ${old}, ${JSON.stringify(oldFields)}, ${oldSlug}, 'validated', NOW(), ${by})`);
        }
        if (oldSlug && newSlug) catalogOut.slugChanges.push({ from: `/tienda/${oldSlug}`, to: `/tienda/${newSlug}` });
        swappedCatalog.push({ type, key });
        catalogOut[type === "product" ? "products" : type === "variant" ? "variants" : "editions"]++;
      }
    }

    // 5) Idiomas
    await qrun(tx, sql`UPDATE site_locales SET is_default = 0, status = 'validated', validated_at = COALESCE(validated_at, NOW()), validated_by = COALESCE(validated_by, ${by}) WHERE locale = ${old}`);
    await qrun(tx, sql`UPDATE site_locales SET is_default = 1 WHERE locale = ${target}`);

    // 6) Redirecciones 301: la dirección antigua (sin prefijo) pasa a ser la del mismo contenido en el idioma anterior
    const nextCfg = { ...cfg, defaultLocale: target };
    const red = { created: 0, updated: 0, deleted: 0 };
    const rules = await qrows(tx, sql`SELECT id, from_path, to_path, status_code, is_active FROM site_redirects`);
    const logR = (action: string, id: number, from: string, to: string | null) => qrun(tx, sql`INSERT INTO site_redirect_log (redirect_id, action, from_path, to_path, status_code, actor_id, actor_name) VALUES (${id}, ${action}, ${from}, ${to}, 301, ${actor.id ?? null}, ${actorName})`);
    for (const w of work) {
      if (!w.swap.slugChanged || !w.page.isPublished) continue;
      const oldPath = `/${w.page.slug}`;
      const newPath = `/${w.swap.base.slug}`;
      const dest = localizedPath(oldPath, old, nextCfg);
      for (const r of rules.filter((x) => normalizeFromPath(String(x.from_path)) === normalizeFromPath(newPath))) {
        snap.redirects.deleted.push({ ...r });
        await qrun(tx, sql`DELETE FROM site_redirects WHERE id = ${r.id}`); await logR("delete", Number(r.id), String(r.from_path), String(r.to_path)); red.deleted++;
      }
      for (const r of rules.filter((x) => normalizeFromPath(String(x.to_path)) === normalizeFromPath(oldPath) && normalizeFromPath(String(x.from_path)) !== normalizeFromPath(newPath))) {
        snap.redirects.updated.push({ id: r.id, to_path: r.to_path, status_code: r.status_code, is_active: r.is_active });
        await qrun(tx, sql`UPDATE site_redirects SET to_path = ${newPath} WHERE id = ${r.id}`); await logR("update", Number(r.id), String(r.from_path), newPath); red.updated++;
      }
      const existing = (await qrows(tx, sql`SELECT id, to_path, status_code, is_active FROM site_redirects WHERE from_path = ${normalizeFromPath(oldPath)} LIMIT 1`))[0];
      if (existing) {
        snap.redirects.updated.push({ id: existing.id, to_path: existing.to_path, status_code: existing.status_code, is_active: existing.is_active });
        await qrun(tx, sql`UPDATE site_redirects SET to_path = ${dest}, status_code = 301, is_active = 1 WHERE id = ${existing.id}`); await logR("update", Number(existing.id), oldPath, dest); red.updated++;
      } else {
        const { insertId } = await qrun(tx, sql`INSERT INTO site_redirects (from_path, to_path, status_code, is_active, note, created_by) VALUES (${normalizeFromPath(oldPath)}, ${dest}, 301, 1, ${"Cambio de idioma principal"}, ${actorName})`);
        snap.redirects.created.push(insertId); await logR("create", insertId, oldPath, dest); red.created++;
      }
    }

    // 7) Comprobación posterior: si algo no cuadra, se lanza y TODO se deshace
    const checks: string[] = [];
    const dflt = await qrows(tx, sql`SELECT locale FROM site_locales WHERE is_default = 1 AND status <> 'archived'`);
    if (dflt.length !== 1 || dflt[0].locale !== target) throw new I18nError(`Comprobación fallida: el idioma principal no es «${target}».`);
    checks.push(`idioma principal = ${target}`);
    for (const w of work) {
      const row = (await qrows(tx, sql`SELECT slug, title FROM static_pages WHERE id = ${w.page.id}`))[0];
      if (!row || row.slug !== w.swap.base.slug || row.title !== w.swap.base.title) throw new I18nError(`Comprobación fallida: la página «${w.page.slug}» no quedó como se esperaba.`);
      const nPub = Number((await qrows(tx, sql`SELECT COUNT(*) AS n FROM page_blocks WHERE pageSlug = ${w.swap.base.slug}`))[0]?.n ?? 0);
      if (nPub !== (w.swap.base.publishedBlocks?.length ?? 0)) throw new I18nError(`Comprobación fallida: los bloques publicados de «${w.swap.base.slug}» no coinciden.`);
      if (Number((await qrows(tx, sql`SELECT COUNT(*) AS n FROM page_translations WHERE page_id = ${w.page.id} AND locale = ${target}`))[0]?.n ?? 0) !== 0) throw new I18nError(`Comprobación fallida: «${w.page.slug}» conserva una traducción al idioma principal.`);
    }
    checks.push(`${work.length} página(s) intercambiadas con sus bloques publicados`);
    const dup = await qrows(tx, sql`SELECT slug FROM static_pages GROUP BY slug HAVING COUNT(*) > 1`);
    if (dup.length) throw new I18nError("Comprobación fallida: direcciones duplicadas.");
    if (Number((await qrows(tx, sql`SELECT COUNT(*) AS n FROM static_pages WHERE slug LIKE ${TMP + "%"}`))[0]?.n ?? 0) !== 0) throw new I18nError("Comprobación fallida: quedan direcciones temporales.");
    checks.push("sin direcciones duplicadas ni temporales");
    for (const c of swappedCatalog) {
      if (Number((await qrows(tx, sql`SELECT COUNT(*) AS n FROM content_translations WHERE entity_type = ${c.type} AND entity_key = ${c.key} AND locale = ${target}`))[0]?.n ?? 0) !== 0) throw new I18nError(`Comprobación fallida: un elemento del catálogo (${c.type} ${c.key}) conserva una traducción al idioma principal.`);
    }
    if (catalogOut.slugChanges.length && (await qrows(tx, sql`SELECT slug FROM experiences GROUP BY slug HAVING COUNT(*) > 1`)).length) throw new I18nError("Comprobación fallida: productos con la misma dirección.");
    if (swappedCatalog.length) checks.push(`${swappedCatalog.length} elemento(s) del catálogo intercambiados`);

    const summary: SwapSummary = {
      from: old, to: target,
      pages: { swapped: work.length, skipped, slugChanges: Array.from(slugMap.entries()).map(([from, to]) => ({ from: `/${from}`, to: `/${to}` })) },
      menuItems: menuCount, settings: settingCount, redirects: red,
      catalog: catalogOut,
    };
    const { insertId } = await qrun(tx, sql`INSERT INTO i18n_default_changes (from_locale, to_locale, status, actor_id, actor_name, summary, snapshot) VALUES (${old}, ${target}, 'applied', ${actor.id ?? null}, ${actorName}, ${JSON.stringify(summary)}, ${JSON.stringify(snap)})`);
    return { ...summary, changeId: insertId, checks };
  });
  invalidateI18nCache();
  invalidateRedirectCache();
  return out;
}

export async function listDefaultLocaleChanges() {
  const d = await getDb();
  if (!d) return [];
  try {
    const [r] = (await d.execute(sql`SELECT id, from_locale, to_locale, status, actor_name, summary, created_at, rolled_back_at, rolled_back_by FROM i18n_default_changes ORDER BY id DESC LIMIT 50`)) as unknown as [Row[]];
    return (Array.isArray(r) ? r : []).map((x) => ({ id: Number(x.id), from: String(x.from_locale), to: String(x.to_locale), status: String(x.status), actor: x.actor_name ?? null, summary: parseJson<SwapSummary>(x.summary), createdAt: x.created_at, rolledBackAt: x.rolled_back_at ?? null, rolledBackBy: x.rolled_back_by ?? null }));
  } catch {
    return [];
  }
}

/** Vuelta atrás del ÚLTIMO cambio aplicado: restaura la copia previa. Lo editado desde entonces en esas páginas se pierde (se avisa en el panel). */
export async function rollbackDefaultLocaleChange(changeId: number, actor: Actor = {}): Promise<{ restored: number; from: string; to: string }> {
  const d = await getDb();
  if (!d) throw new I18nError("Base de datos no disponible");
  const by = (actor.name ?? "").slice(0, 128) || null;
  const out = await d.transaction(async (tx: Tx) => {
    const row = (await qrows(tx, sql`SELECT id, from_locale, to_locale, status, snapshot FROM i18n_default_changes WHERE id = ${changeId} FOR UPDATE`))[0];
    if (!row) throw new I18nError("Ese cambio de idioma principal no existe.");
    if (row.status !== "applied") throw new I18nError("Ese cambio ya se deshizo.");
    const later = (await qrows(tx, sql`SELECT id FROM i18n_default_changes WHERE id > ${changeId} AND status = 'applied' LIMIT 1`))[0];
    if (later) throw new I18nError("Hay un cambio posterior: deshaz primero el último.");
    const snap = parseJson<Snapshot>(row.snapshot);
    if (!snap || snap.version !== 1) throw new I18nError("La copia previa de este cambio no se puede leer.");
    const target = String(row.to_locale);
    const old = String(row.from_locale);

    // Páginas: liberar direcciones, restaurar
    for (const p of snap.pages) await qrun(tx, sql`UPDATE static_pages SET slug = ${TMP + p.id} WHERE id = ${p.id}`);
    await qrun(tx, sql`DELETE FROM page_blocks WHERE pageSlug IN (${inList(snap.blockKeys)})`);
    for (const p of snap.pages) await qrun(tx, sql`UPDATE static_pages SET slug = ${p.slug}, title = ${p.title}, content = ${p.content}, metaTitle = ${p.metaTitle}, metaDescription = ${p.metaDescription}, updatedAt = NOW() WHERE id = ${p.id}`);
    for (const b of snap.blocks) await qrun(tx, sql`INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (${b.pageSlug}, ${b.blockType}, ${b.sortOrder}, ${jv(b.data)}, ${Number(b.isVisible) ? 1 : 0})`);

    // Traducciones de páginas
    await qrun(tx, sql`DELETE FROM page_translations WHERE page_id IN (${sql.join(snap.pageIds.map((i) => sql`${i}`), sql`, `)}) AND locale IN (${target}, ${old})`);
    for (const t of snap.pageTranslations) {
      await qrun(tx, sql`INSERT INTO page_translations
        (page_id, locale, slug, published_slug, published_meta, title, meta_title, meta_description, og_image_url, draft_blocks, published_blocks, status, base_hash, validated_at, validated_by)
        VALUES (${t.page_id}, ${t.locale}, ${t.slug}, ${t.published_slug}, ${jv(t.published_meta)}, ${t.title}, ${t.meta_title}, ${t.meta_description}, ${t.og_image_url}, ${jv(t.draft_blocks)}, ${jv(t.published_blocks)}, ${t.status}, ${t.base_hash}, ${t.validated_at}, ${t.validated_by})`);
    }

    // Menús, ajustes y su contenido traducible
    for (const m of snap.menu) await qrun(tx, sql`UPDATE menu_items SET label = ${m.label}, url = ${m.url} WHERE id = ${m.id}`);
    for (const s of snap.settings) await qrun(tx, sql`UPDATE system_settings SET value = ${s.value} WHERE \`key\` = ${s.key}`);
    // Catálogo de la tienda: filas base tal como estaban (solo copias que lo incluyen). Primero se liberan las
    // direcciones de los productos, por si dos intercambiaron slugs entre sí
    for (const r of snap.catalog?.product ?? []) await qrun(tx, sql`UPDATE experiences SET slug = ${TMP + r.id} WHERE id = ${r.id}`);
    for (const type of ["product", "variant", "edition"] as CatalogSwapType[]) {
      for (const r of snap.catalog?.[type] ?? []) {
        const cols = catalogCols(type).concat(type === "product" ? ["slug"] : []);
        const sets = cols.map((c) => sql`${sql.raw(`\`${c}\``)} = ${jv(r[c])}`);
        await qrun(tx, sql`UPDATE ${sql.raw(CATALOG_TABLE[type])} SET ${sql.join(sets, sql`, `)} WHERE id = ${r.id}`);
      }
    }
    // Solo los tipos que la copia incluye: una copia anterior (menús y ajustes) nunca borra traducciones del catálogo
    const types = snap.contentTypes?.length ? snap.contentTypes : ["menu_item", "setting"];
    await qrun(tx, sql`DELETE FROM content_translations WHERE entity_type IN (${inList(types)}) AND locale IN (${target}, ${old})`);
    for (const c of snap.contentTranslations) {
      await qrun(tx, sql`INSERT INTO content_translations (entity_type, entity_key, locale, fields, slug, status, validated_at, validated_by) VALUES (${c.entity_type}, ${c.entity_key}, ${c.locale}, ${jv(c.fields)}, ${c.slug}, ${c.status}, ${c.validated_at}, ${c.validated_by})`);
    }

    // Idiomas
    for (const l of snap.locales) await qrun(tx, sql`UPDATE site_locales SET is_default = ${Number(l.is_default) ? 1 : 0}, status = ${l.status}, sort_order = ${l.sort_order}, validated_at = ${l.validated_at}, validated_by = ${l.validated_by} WHERE locale = ${l.locale}`);

    // Redirecciones: se deshace exactamente lo que hizo el cambio
    for (const id of snap.redirects.created) await qrun(tx, sql`DELETE FROM site_redirects WHERE id = ${id}`);
    for (const r of snap.redirects.updated) await qrun(tx, sql`UPDATE site_redirects SET to_path = ${r.to_path}, status_code = ${r.status_code}, is_active = ${r.is_active} WHERE id = ${r.id}`);
    for (const r of snap.redirects.deleted) await qrun(tx, sql`INSERT IGNORE INTO site_redirects (id, from_path, to_path, status_code, is_active, note, created_by) VALUES (${r.id}, ${r.from_path}, ${r.to_path}, ${r.status_code}, ${r.is_active}, ${"Restaurada al deshacer el cambio de idioma principal"}, ${by})`);

    const dflt = await qrows(tx, sql`SELECT locale FROM site_locales WHERE is_default = 1 AND status <> 'archived'`);
    if (dflt.length !== 1 || dflt[0].locale !== old) throw new I18nError(`Comprobación fallida: el idioma principal no volvió a «${old}».`);
    await qrun(tx, sql`UPDATE i18n_default_changes SET status = 'rolled_back', rolled_back_at = NOW(), rolled_back_by = ${by} WHERE id = ${changeId}`);
    return { restored: snap.pageIds.length, from: old, to: target };
  });
  invalidateI18nCache();
  invalidateRedirectCache();
  return out;
}
