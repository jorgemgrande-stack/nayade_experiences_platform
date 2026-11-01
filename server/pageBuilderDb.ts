/**
 * Constructor de la web de cada empresa (Web › Páginas): páginas por bloques con borrador y publicado, portada
 * elegible, menú y plantillas. Todo en la base de datos de la propia empresa (`getDb()` resuelve la suya).
 *
 * Almacenamiento, sin tablas nuevas:
 *   - `static_pages`: la página (título, dirección, descripción para buscadores, publicada o no). Su `content` guarda
 *     el HTML equivalente a los bloques publicados (buscadores, mapa del sitio, búsqueda del panel) o, en las páginas
 *     antiguas aún sin convertir, su HTML de siempre.
 *   - `page_blocks` con `pageSlug = <dirección>`: los bloques PUBLICADOS, uno por fila y en orden.
 *   - `page_blocks` con `pageSlug = "borrador:<dirección>"`: el BORRADOR, una sola fila con la lista completa. Los
 *     dos puntos no caben en una dirección, así que nunca coincide con una página real ni se sirve en la web.
 *   - `system_settings.site_home_page`: la página elegida como portada (vacío = «inicio»).
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { menuItems, pageBlocks, staticPages, systemSettings } from "../drizzle/schema";
import { getDb, savePageBlocks } from "./db";
import { blocksToHtml, htmlToBlocks, normalizeBlocks, readStoredBlocks, renderBlockTokens, PageBlocksError } from "./_core/pageBlocks";
import { HOME_PAGE_SETTING_KEY, HOME_SLUG, pageSlugProblem, templateBlocks, duplicateBlock, type PageBlock, type PageTemplateKey } from "../shared/pageBlocks";
import { isLegalPageSlug } from "../shared/tenantNav";
import { plainTextToHtml, type SiteTokenData } from "./_core/templates/starterSite";

export { PageBlocksError };

const DRAFT_PREFIX = "borrador:";
const draftKey = (slug: string) => `${DRAFT_PREFIX}${slug}`;
/** Dirección del menú que lleva a una página (la portada, a «/»). */
const pageUrl = (slug: string, home: string) => (slug === home ? "/" : `/${slug}`);

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

/** Si una dirección pertenece a una página real (sin el prefijo del borrador). */
export function isPageSlug(slug: string): boolean {
  return !slug.includes(":");
}

// ─── Portada ──────────────────────────────────────────────────────────────────

/** Página que la empresa ha elegido como portada («inicio» si no ha elegido otra). Sin caché: cambia al momento. */
export async function getHomeSlug(): Promise<string> {
  const d = await getDb();
  if (!d) return HOME_SLUG;
  const [row] = await d.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, HOME_PAGE_SETTING_KEY)).limit(1);
  return row?.value?.trim() || HOME_SLUG;
}

/** Página que se sirve en «/»: la elegida si existe y está publicada; si no, «inicio». */
export async function resolvePublicSlug(slug: string): Promise<string> {
  if (slug !== HOME_SLUG) return slug;
  const home = await getHomeSlug();
  if (home === HOME_SLUG) return HOME_SLUG;
  const d = await db();
  const [row] = await d.select({ isPublished: staticPages.isPublished }).from(staticPages).where(eq(staticPages.slug, home)).limit(1);
  return row?.isPublished ? home : HOME_SLUG;
}

export async function setHomePage(slug: string) {
  const d = await db();
  const page = await getPage(slug);
  if (!page) throw new PageBlocksError("La página no existe.");
  const value = slug === HOME_SLUG ? "" : slug;
  await d.insert(systemSettings).values({ key: HOME_PAGE_SETTING_KEY, value, label: "Página de portada de la web", category: "web" }).onDuplicateKeyUpdate({ set: { value } });
  // El menú no cambia: la página sigue viéndose también en su propia dirección
  return { success: true };
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

async function getPage(slug: string) {
  const d = await db();
  const [row] = await d.select().from(staticPages).where(eq(staticPages.slug, slug)).limit(1);
  return row ?? null;
}

async function publishedBlockRows(slug: string) {
  const d = await db();
  return d.select().from(pageBlocks).where(eq(pageBlocks.pageSlug, slug)).orderBy(pageBlocks.sortOrder);
}

/** Bloques publicados de una página, o null si la página sigue siendo HTML (antigua) o no tiene bloques. */
export async function getPublishedBlocks(slug: string): Promise<PageBlock[] | null> {
  const rows = await publishedBlockRows(slug);
  if (!rows.length) return null;
  const blocks = readStoredBlocks(rows.filter((r) => r.isVisible).map((r) => rowToBlock({ ...(r.data as Record<string, unknown>), type: r.blockType })));
  // Filas de un formato anterior que no se reconoce: la página se sirve con su HTML
  return blocks.length ? blocks : null;
}

function rowToBlock(r: Record<string, unknown>): unknown {
  const { id, type, ...data } = r;
  return { id, type, data };
}

async function getDraft(slug: string): Promise<{ blocks: PageBlock[]; savedAt: string | null } | null> {
  const d = await db();
  const [row] = await d.select().from(pageBlocks).where(eq(pageBlocks.pageSlug, draftKey(slug))).limit(1);
  if (!row) return null;
  const data = (row.data ?? {}) as { blocks?: unknown; savedAt?: string };
  return { blocks: readStoredBlocks(data.blocks), savedAt: data.savedAt ?? (row.updatedAt ? new Date(row.updatedAt).toISOString() : null) };
}

/** Lista de páginas para el panel, con su estado (borrador pendiente, portada, en el menú). */
export async function listSitePages() {
  const d = await db();
  const [pages, drafts, home, menu] = await Promise.all([
    d.select().from(staticPages).orderBy(staticPages.id),
    d.select({ pageSlug: pageBlocks.pageSlug }).from(pageBlocks).where(like(pageBlocks.pageSlug, `${DRAFT_PREFIX}%`)),
    getHomeSlug(),
    d.select({ url: menuItems.url, menuZone: menuItems.menuZone }).from(menuItems),
  ]);
  const draftSet = new Set(drafts.map((r) => r.pageSlug.slice(DRAFT_PREFIX.length)));
  return pages.map((p) => {
    const url = pageUrl(p.slug, home);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      isPublished: !!p.isPublished,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      updatedAt: p.updatedAt,
      hasDraft: draftSet.has(p.slug),
      isHome: p.slug === home,
      isLegal: isLegalPageSlug(p.slug),
      inHeader: menu.some((m) => m.menuZone === "header" && (m.url === url || m.url === `/${p.slug}`)),
      inFooter: menu.some((m) => m.menuZone === "footer" && (m.url === url || m.url === `/${p.slug}`)),
    };
  });
}

/**
 * Lo que abre el editor: el borrador si hay; si no, lo publicado; y una página antigua en HTML, convertida a bloques
 * (sin guardar nada: la web sigue mostrando la versión actual hasta que se publique).
 */
export async function getPageEditor(slug: string) {
  const page = await getPage(slug);
  if (!page) return null;
  const [draft, published, list] = await Promise.all([getDraft(slug), getPublishedBlocks(slug), listSitePages()]);
  const info = list.find((p) => p.slug === slug)!;
  let source: "draft" | "published" | "converted" | "empty";
  let blocks: PageBlock[];
  if (draft) {
    source = "draft";
    blocks = draft.blocks;
  } else if (published) {
    source = "published";
    blocks = published;
  } else if ((page.content ?? "").trim()) {
    source = "converted";
    blocks = htmlToBlocks(plainTextToHtml(page.content ?? ""));
  } else {
    source = "empty";
    blocks = [];
  }
  return { page: info, blocks, source, draftSavedAt: draft?.savedAt ?? null };
}

// ─── Borrador y publicación ───────────────────────────────────────────────────

async function requirePage(slug: string) {
  const page = await getPage(slug);
  if (!page) throw new PageBlocksError("La página no existe.");
  return page;
}

async function writeDraft(slug: string, blocks: PageBlock[]) {
  const d = await db();
  await d.delete(pageBlocks).where(eq(pageBlocks.pageSlug, draftKey(slug)));
  await d.insert(pageBlocks).values({ pageSlug: draftKey(slug), blockType: "borrador", sortOrder: 0, data: { blocks, savedAt: new Date().toISOString() } as never, isVisible: false });
}

export async function savePageDraft(slug: string, raw: unknown) {
  await requirePage(slug);
  const blocks = normalizeBlocks(raw);
  await writeDraft(slug, blocks);
  return { success: true, blocks };
}

export async function discardPageDraft(slug: string) {
  const d = await db();
  await d.delete(pageBlocks).where(eq(pageBlocks.pageSlug, draftKey(slug)));
  return { success: true };
}

/** Publica los bloques (los indicados o el borrador guardado): pasan a la web y el borrador se descarta. */
export async function publishPage(slug: string, raw?: unknown) {
  await requirePage(slug);
  let blocks: PageBlock[];
  if (raw !== undefined) blocks = normalizeBlocks(raw);
  else {
    const draft = await getDraft(slug);
    if (!draft) throw new PageBlocksError("No hay cambios pendientes de publicar.");
    blocks = draft.blocks;
  }
  const d = await db();
  await savePageBlocks(slug, blocks.map((b, i) => ({ blockType: b.type, sortOrder: i, data: { id: b.id, ...b.data }, isVisible: true })));
  await d.update(staticPages).set({ content: blocksToHtml(blocks), isPublished: true, updatedAt: new Date() }).where(eq(staticPages.slug, slug));
  await discardPageDraft(slug);
  return { success: true };
}

/** Retira la página de la web (deja de verse y de salir en el menú); su contenido se conserva. */
export async function setPagePublished(slug: string, isPublished: boolean) {
  await requirePage(slug);
  if (!isPublished && slug === (await getHomeSlug())) throw new PageBlocksError("Es la portada de tu web. Elige otra portada antes de retirarla.");
  const d = await db();
  await d.update(staticPages).set({ isPublished, updatedAt: new Date() }).where(eq(staticPages.slug, slug));
  return { success: true };
}

/** Página para la vista previa: el borrador (o lo actual) con los datos de la empresa, igual que en la web. */
export async function getPagePreview(slug: string, tokens: SiteTokenData) {
  const editor = await getPageEditor(slug);
  if (!editor) return null;
  return { slug, title: editor.page.title, blocks: renderBlockTokens(editor.blocks, tokens) };
}

// ─── Gestión de páginas ───────────────────────────────────────────────────────

async function assertFreeSlug(slug: string) {
  const problem = pageSlugProblem(slug);
  if (problem) throw new PageBlocksError(problem);
  if (await getPage(slug)) throw new PageBlocksError("Ya tienes una página con esa dirección. Elige otra.");
}

async function nextMenuOrder(zone: "header" | "footer") {
  const d = await db();
  const rows = await d.select({ sortOrder: menuItems.sortOrder }).from(menuItems).where(eq(menuItems.menuZone, zone));
  return rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
}

async function addMenuLink(zone: "header" | "footer", label: string, url: string) {
  const d = await db();
  const [exists] = await d.select({ id: menuItems.id }).from(menuItems).where(and(eq(menuItems.menuZone, zone), eq(menuItems.url, url))).limit(1);
  if (exists) return;
  await d.insert(menuItems).values({ label: label.slice(0, 128), url, parentId: null, target: "_self", sortOrder: await nextMenuOrder(zone), isActive: true, menuZone: zone });
}

/** Página nueva, en borrador, con los bloques de su plantilla. Opcionalmente, con su enlace en el menú. */
export async function createSitePage(input: { title: string; slug: string; template: PageTemplateKey; metaDescription?: string | null; addToMenu: boolean }) {
  const title = input.title.trim();
  if (!title) throw new PageBlocksError("Indica el título de la página.");
  await assertFreeSlug(input.slug);
  const d = await db();
  await d.insert(staticPages).values({ slug: input.slug, title, content: "", isPublished: false, metaTitle: title, metaDescription: input.metaDescription?.trim() || null });
  await writeDraft(input.slug, normalizeBlocks(templateBlocks(input.template, title)));
  if (input.addToMenu) await addMenuLink("header", title, `/${input.slug}`);
  return { success: true, slug: input.slug };
}

/** Título, dirección y textos para buscadores. Al cambiar la dirección se actualizan su contenido y su menú. */
export async function updatePageSettings(input: { slug: string; newSlug?: string; title: string; metaTitle?: string | null; metaDescription?: string | null }) {
  const page = await requirePage(input.slug);
  const title = input.title.trim();
  if (!title) throw new PageBlocksError("Indica el título de la página.");
  const d = await db();
  const target = input.newSlug && input.newSlug !== input.slug ? input.newSlug : input.slug;
  if (target !== input.slug) {
    if (input.slug === HOME_SLUG || isLegalPageSlug(input.slug)) throw new PageBlocksError("La dirección de esta página no se puede cambiar.");
    await assertFreeSlug(target);
  }
  await d.update(staticPages).set({ slug: target, title, metaTitle: input.metaTitle?.trim() || null, metaDescription: input.metaDescription?.trim() || null, updatedAt: new Date() }).where(eq(staticPages.id, page.id));
  if (target !== input.slug) {
    await d.update(pageBlocks).set({ pageSlug: target }).where(eq(pageBlocks.pageSlug, input.slug));
    await d.update(pageBlocks).set({ pageSlug: draftKey(target) }).where(eq(pageBlocks.pageSlug, draftKey(input.slug)));
    await d.update(menuItems).set({ url: `/${target}`, updatedAt: new Date() }).where(eq(menuItems.url, `/${input.slug}`));
    if ((await getHomeSlug()) === input.slug) {
      await d.update(systemSettings).set({ value: target }).where(eq(systemSettings.key, HOME_PAGE_SETTING_KEY));
    }
  }
  return { success: true, slug: target };
}

/** Copia de una página (en borrador, sin menú) con el contenido que se ve en su editor. */
export async function duplicateSitePage(slug: string) {
  const editor = await getPageEditor(slug);
  if (!editor) throw new PageBlocksError("La página no existe.");
  const base = `${slug}-copia`.slice(0, 58).replace(/-+$/, "");
  let candidate = base;
  for (let i = 2; (await getPage(candidate)) || pageSlugProblem(candidate); i++) candidate = `${base}-${i}`;
  const d = await db();
  const title = `${editor.page.title} (copia)`.slice(0, 200);
  await d.insert(staticPages).values({ slug: candidate, title, content: "", isPublished: false, metaTitle: editor.page.metaTitle, metaDescription: editor.page.metaDescription });
  await writeDraft(candidate, editor.blocks.map(duplicateBlock));
  return { success: true, slug: candidate, title };
}

/**
 * Elimina una página, sus bloques y sus enlaces del menú. La portada no se puede eliminar; un texto legal, solo con
 * confirmación expresa (`confirmLegal`), porque la web lo enlaza en su pie.
 */
export async function deleteSitePage(slug: string, opts: { confirmLegal?: boolean } = {}) {
  await requirePage(slug);
  const home = await getHomeSlug();
  if (slug === home) throw new PageBlocksError("Es la portada de tu web. Elige otra portada antes de eliminarla.");
  if (isLegalPageSlug(slug) && !opts.confirmLegal) throw new PageBlocksError("Es un texto legal que tu web enlaza en el pie. Confirma que quieres eliminarlo.");
  const d = await db();
  await d.delete(pageBlocks).where(or(eq(pageBlocks.pageSlug, slug), eq(pageBlocks.pageSlug, draftKey(slug))));
  const links = await d.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.url, `/${slug}`));
  if (links.length) {
    const ids = links.map((l) => l.id);
    await d.delete(menuItems).where(inArray(menuItems.parentId, ids));
    await d.delete(menuItems).where(inArray(menuItems.id, ids));
  }
  await d.delete(staticPages).where(eq(staticPages.slug, slug));
  return { success: true };
}

/** Añade o quita el enlace de una página en el menú de cabecera o en el pie. */
export async function setPageInMenu(slug: string, zone: "header" | "footer", inMenu: boolean) {
  const page = await requirePage(slug);
  const home = await getHomeSlug();
  const url = pageUrl(slug, home);
  const d = await db();
  if (inMenu) await addMenuLink(zone, page.title, url);
  else {
    const links = await d.select({ id: menuItems.id }).from(menuItems).where(and(eq(menuItems.menuZone, zone), inArray(menuItems.url, Array.from(new Set([url, `/${slug}`])))));
    if (links.length) {
      const ids = links.map((l) => l.id);
      await d.delete(menuItems).where(inArray(menuItems.parentId, ids));
      await d.delete(menuItems).where(inArray(menuItems.id, ids));
    }
  }
  return { success: true };
}
