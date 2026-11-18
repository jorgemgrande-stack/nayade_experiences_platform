/**
 * Multidioma nativo de Elephant Studio (épica E-1): lógica de idiomas, traducciones y resolución de URLs localizadas.
 *
 * Todo se hace contra un `I18nRepo` (la base de datos de la empresa en curso, ver i18nSqlRepo.ts), así que el servicio
 * no sabe nada de tenants ni de SQL y se prueba con un repositorio en memoria. Diseño: docs/architecture/studio-multidioma.md.
 *
 * Reglas que garantiza este módulo:
 *  - Nada se traduce solo: aquí no hay traducción automática; el texto lo escribe una persona.
 *  - Nada se publica sin validación: solo `validatePageTranslation` copia el borrador a lo publicado, y solo se sirve un
 *    idioma validado con una traducción validada (`decideServing`).
 *  - Sin idiomas adicionales, todo se comporta como antes (`resolveRequest` devuelve `passthrough`).
 */
import { normalizeBlocks as normalizeBlocksRaw, PageBlocksError } from "./_core/pageBlocks";
import type { PageBlock } from "../shared/pageBlocks";
import { siteUiText } from "../shared/siteUiText";
import {
  DEFAULT_LOCALE, MAX_LOCALES, isSafeRedirectTarget, publicLocales, buildConfig, contentHash, decideServing, isConfiguredLocale, isMultilingual, isReservedSlug,
  internalLinkSegments, internalProductSlugs, localeSeo, localizeBlockLinks, localizeProductLink, localizedPath, normalizeLocale, normalizeLocalizedSlug, parseLocalizedPath,
  productRest, productSlugOfPath, untranslatedFields,
  type Alternate, type I18nConfig, type LocaleEntry, type LocaleSeo, type PageVersion, type ServeDecision, type TranslationStatus, type UntranslatedField,
} from "../shared/i18n";

export class I18nError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "I18nError";
  }
}

// ─── Filas y repositorio ──────────────────────────────────────────────────────

export interface PublishedMeta {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
}

export interface PageTranslationRow {
  pageId: number;
  locale: string;
  /** Borrador de trabajo */
  slug: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  draftBlocks: PageBlock[] | null;
  /** Lo que se sirve (solo con `status = validated`) */
  publishedSlug: string | null;
  publishedMeta: PublishedMeta | null;
  publishedBlocks: PageBlock[] | null;
  status: TranslationStatus;
  baseHash: string | null;
  validatedAt: Date | null;
  validatedBy: string | null;
  updatedAt: Date | null;
}

export interface ContentTranslationRow {
  entityType: ContentEntityType;
  entityKey: string;
  locale: string;
  fields: Record<string, string>;
  slug: string | null;
  status: TranslationStatus;
  validatedAt: Date | null;
  validatedBy: string | null;
}

export interface PrincipalPage {
  id: number;
  slug: string;
  title: string;
  isPublished: boolean;
}

/** Producto de la tienda (`experiences`) en el idioma principal. Sus traducciones: `content_translations` con clave = id. */
export interface PrincipalProduct {
  id: number;
  slug: string;
  isPublished: boolean;
  updatedAt?: Date | null;
}

export interface I18nSettings {
  defaultPrefix?: string | null;
  fallback?: string | null;
  negotiate?: string | null;
}

export interface I18nRepo {
  listLocales(): Promise<LocaleEntry[]>;
  insertLocale(e: LocaleEntry & { validatedBy?: string | null }): Promise<void>;
  setLocaleStatus(locale: string, status: TranslationStatus, by: string | null): Promise<void>;
  deleteLocale(locale: string): Promise<void>;
  readSettings(): Promise<I18nSettings>;
  writeSetting(setting: "i18n_default_prefix" | "i18n_fallback" | "i18n_negotiate", value: string): Promise<void>;

  principalPageBySlug(slug: string): Promise<PrincipalPage | null>;
  principalPageById(id: number): Promise<PrincipalPage | null>;
  principalHomeSlug(): Promise<string>;

  pageTranslation(pageId: number, locale: string): Promise<PageTranslationRow | null>;
  /** Traducción VALIDADA por su slug publicado. */
  publishedTranslationBySlug(locale: string, slug: string): Promise<PageTranslationRow | null>;
  listPageTranslations(filter: { pageId?: number; locale?: string; onlyValidated?: boolean }): Promise<PageTranslationRow[]>;
  /** El slug lo usa ya otra página en ese idioma (borrador o publicado). */
  slugTaken(locale: string, slug: string, exceptPageId: number): Promise<boolean>;
  savePageTranslation(row: PageTranslationRow): Promise<void>;

  contentTranslation(type: ContentEntityType, key: string, locale: string): Promise<ContentTranslationRow | null>;
  listContentTranslations(type: ContentEntityType, locale: string, onlyValidated: boolean): Promise<ContentTranslationRow[]>;
  contentSlugTaken(type: ContentEntityType, locale: string, slug: string, exceptKey: string): Promise<boolean>;
  saveContentTranslation(row: ContentTranslationRow): Promise<void>;

  /**
   * Fichas de producto localizadas (`/<idioma>/tienda/<slug>`). Opcionales: un repositorio sin ellas se comporta como
   * antes (la tienda no se localiza).
   */
  productBySlug?(slug: string): Promise<PrincipalProduct | null>;
  productById?(id: number): Promise<PrincipalProduct | null>;
  /** Elemento activo del menú que lleva al catálogo (`/tienda`), para el título de la pestaña del catálogo. */
  shopMenuItem?(): Promise<{ id: number; label: string } | null>;
}

// ─── Configuración e idiomas ──────────────────────────────────────────────────

export async function getI18nConfig(repo: I18nRepo): Promise<I18nConfig> {
  const [rows, settings] = await Promise.all([repo.listLocales(), repo.readSettings()]);
  return buildConfig(rows, settings);
}

/** Da de alta un idioma (en borrador: no es público hasta que una persona lo valide). */
export async function addLocale(repo: I18nRepo, raw: unknown, by: string | null) {
  const locale = normalizeLocale(raw);
  if (!locale) throw new I18nError("El código de idioma no es válido. Usa, por ejemplo, de, en, fr o pt-br.");
  const rows = await repo.listLocales();
  if (rows.some((r) => r.locale === locale)) throw new I18nError("Ese idioma ya está dado de alta.");
  if (rows.length >= MAX_LOCALES) throw new I18nError(`Puedes tener hasta ${MAX_LOCALES} idiomas.`);
  // Una página propia con ese slug (p. ej. «en») quedaría tapada por el prefijo de idioma
  if (await repo.principalPageBySlug(locale)) throw new I18nError(`Ya existe una página con la dirección «${locale}». Cámbiale la dirección antes de activar ese idioma.`);
  if (!rows.length) await repo.insertLocale({ locale: DEFAULT_LOCALE, isDefault: true, status: "validated", sortOrder: 0, validatedBy: by });
  await repo.insertLocale({ locale, isDefault: false, status: "draft", sortOrder: rows.length + 1 });
  return { success: true, locale };
}

async function requireExtraLocale(repo: I18nRepo, raw: unknown) {
  const locale = normalizeLocale(raw);
  if (!locale) throw new I18nError("El código de idioma no es válido.");
  const cfg = await getI18nConfig(repo);
  if (locale === cfg.defaultLocale) throw new I18nError("El idioma principal se publica con el flujo normal de páginas.");
  if (!isConfiguredLocale(cfg, locale)) throw new I18nError("Ese idioma no está dado de alta.");
  return { locale, cfg };
}

/** Validación humana de un idioma: a partir de aquí es público (solo sus páginas ya validadas). */
export async function validateLocale(repo: I18nRepo, raw: unknown, by: string | null) {
  const { locale } = await requireExtraLocale(repo, raw);
  await repo.setLocaleStatus(locale, "validated", by);
  return { success: true };
}

/** Retira un idioma de la web (deja de servirse y de indexarse); sus traducciones se conservan. */
export async function unvalidateLocale(repo: I18nRepo, raw: unknown) {
  const { locale } = await requireExtraLocale(repo, raw);
  await repo.setLocaleStatus(locale, "draft", null);
  return { success: true };
}

/** Quita un idioma no publicado. Sus traducciones guardadas no se borran (si se vuelve a dar de alta, reaparecen). */
export async function removeLocale(repo: I18nRepo, raw: unknown) {
  const { locale, cfg } = await requireExtraLocale(repo, raw);
  if (cfg.locales.find((l) => l.locale === locale)?.status === "validated") throw new I18nError("Retira el idioma de la web antes de quitarlo.");
  await repo.deleteLocale(locale);
  // Sin idiomas adicionales, vuelve el estado de siempre (tabla vacía = solo el principal implícito)
  if ((await repo.listLocales()).every((l) => l.isDefault)) await repo.deleteLocale(cfg.defaultLocale);
  return { success: true };
}

export async function updateI18nSettings(repo: I18nRepo, input: { fallback?: "hide" | "default"; negotiate?: boolean }) {
  if (input.fallback) await repo.writeSetting("i18n_fallback", input.fallback);
  if (input.negotiate !== undefined) await repo.writeSetting("i18n_negotiate", input.negotiate ? "1" : "0");
  return { success: true };
}

// ─── Traducción de páginas ────────────────────────────────────────────────────

export interface PageTranslationInput {
  /** Dirección del idioma; vacía = la del principal. */
  slug?: string | null;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
  /** Lista completa de bloques del idioma (se normaliza y sanea igual que la del principal). */
  blocks?: unknown;
}

/** Mismas reglas y saneado que las páginas del principal; el error se devuelve como error de idioma. */
function normalizeBlocks(raw: unknown): PageBlock[] {
  try {
    return normalizeBlocksRaw(raw);
  } catch (e) {
    if (e instanceof PageBlocksError) throw new I18nError(e.message);
    throw e;
  }
}

const clip = (v: string | null | undefined, n: number) => ((v ?? "").trim().slice(0, n) || null);
// eslint-disable-next-line no-control-regex
const stripCtl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

/** Solo http(s) absoluta o ruta del propio sitio. */
function safeImage(u: string | null | undefined): string | null {
  const v = (u ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v.slice(0, 1000);
  try {
    const p = new URL(v);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

async function requirePageAndLocale(repo: I18nRepo, pageId: number, rawLocale: unknown) {
  const { locale, cfg } = await requireExtraLocale(repo, rawLocale);
  const page = await repo.principalPageById(pageId);
  if (!page) throw new I18nError("La página no existe.");
  return { locale, cfg, page };
}

/**
 * Guarda el BORRADOR de la traducción de una página. No publica nada: un idioma o una traducción ya validados siguen
 * sirviendo lo último validado hasta que alguien vuelva a validar. `principalBlocks` (los publicados del principal) fija
 * la huella para avisar de que el principal ha cambiado.
 */
export async function savePageTranslationDraft(repo: I18nRepo, pageId: number, rawLocale: unknown, input: PageTranslationInput, principalBlocks?: PageBlock[] | null) {
  const { locale, page } = await requirePageAndLocale(repo, pageId, rawLocale);
  const title = stripCtl((input.title ?? "").trim()).slice(0, 256);
  if (!title) throw new I18nError("Indica el título de la página en ese idioma.");
  const wantedSlug = (input.slug ?? "").trim();
  const slug = normalizeLocalizedSlug(wantedSlug || page.slug);
  if (!slug) throw new I18nError("La dirección solo admite minúsculas sin acentos, números y guiones.");
  if (isReservedSlug(slug)) throw new I18nError("Esa dirección está reservada por la aplicación. Elige otra.");
  if (await repo.slugTaken(locale, slug, pageId)) throw new I18nError("Otra página ya usa esa dirección en este idioma.");
  const existing = await repo.pageTranslation(pageId, locale);
  const blocks = input.blocks === undefined ? existing?.draftBlocks ?? null : normalizeBlocks(input.blocks);
  const row: PageTranslationRow = {
    pageId, locale, slug, title,
    metaTitle: clip(input.metaTitle && stripCtl(input.metaTitle), 256),
    metaDescription: clip(input.metaDescription && stripCtl(input.metaDescription), 1000),
    ogImageUrl: safeImage(input.ogImageUrl),
    draftBlocks: blocks,
    publishedSlug: existing?.publishedSlug ?? null,
    publishedMeta: existing?.publishedMeta ?? null,
    publishedBlocks: existing?.publishedBlocks ?? null,
    status: existing?.status ?? "draft",
    baseHash: principalBlocks ? contentHash(principalBlocks) : existing?.baseHash ?? null,
    validatedAt: existing?.validatedAt ?? null,
    validatedBy: existing?.validatedBy ?? null,
    updatedAt: new Date(),
  };
  await repo.savePageTranslation(row);
  return { success: true, slug };
}

/**
 * «Copiar desde el principal»: deja como borrador una copia de los bloques del principal (mismos identificadores) para
 * traducirla a mano. No traduce ni valida nada. Los textos quedan iguales y el indicador de campos sin traducir los marca.
 */
export async function copyFromPrincipal(repo: I18nRepo, pageId: number, rawLocale: unknown, principalBlocks: PageBlock[]) {
  const { locale, page } = await requirePageAndLocale(repo, pageId, rawLocale);
  const existing = await repo.pageTranslation(pageId, locale);
  const copy = normalizeBlocks(JSON.parse(JSON.stringify(principalBlocks)));
  if (existing) {
    await repo.savePageTranslation({ ...existing, draftBlocks: copy, baseHash: contentHash(principalBlocks), updatedAt: new Date() });
    return { success: true, created: false };
  }
  let slug = normalizeLocalizedSlug(page.slug) ?? "pagina";
  for (let i = 2; await repo.slugTaken(locale, slug, pageId); i++) slug = `${page.slug}-${i}`.slice(0, 64);
  await repo.savePageTranslation({
    pageId, locale, slug, title: page.title, metaTitle: null, metaDescription: null, ogImageUrl: null,
    draftBlocks: copy, publishedSlug: null, publishedMeta: null, publishedBlocks: null, status: "draft",
    baseHash: contentHash(principalBlocks), validatedAt: null, validatedBy: null, updatedAt: new Date(),
  });
  return { success: true, created: true };
}

/**
 * VALIDAR (publicar) una traducción: acción humana, con autor. Exige título, dirección y bloques, y que el idioma
 * exista. Si el idioma aún no está validado la traducción queda lista, pero no se sirve hasta validar el idioma.
 */
export async function validatePageTranslation(repo: I18nRepo, pageId: number, rawLocale: unknown, by: string | null) {
  const { locale } = await requirePageAndLocale(repo, pageId, rawLocale);
  const row = await repo.pageTranslation(pageId, locale);
  if (!row) throw new I18nError("Aún no hay traducción de esta página en ese idioma.");
  if (!row.draftBlocks?.length) throw new I18nError("La traducción no tiene contenido. Copia el del principal y tradúcelo, o escríbelo.");
  if (!row.title.trim() || !row.slug) throw new I18nError("Faltan el título o la dirección de la página en ese idioma.");
  if (await repo.slugTaken(locale, row.slug, pageId)) throw new I18nError("Otra página ya usa esa dirección en este idioma.");
  await repo.savePageTranslation({
    ...row,
    publishedSlug: row.slug,
    publishedMeta: { title: row.title, metaTitle: row.metaTitle, metaDescription: row.metaDescription, ogImageUrl: row.ogImageUrl },
    publishedBlocks: row.draftBlocks,
    status: "validated",
    validatedAt: new Date(),
    validatedBy: by,
    updatedAt: new Date(),
  });
  return { success: true };
}

/** Retira una traducción de la web (deja de servirse y de indexarse). El contenido se conserva. */
export async function unpublishPageTranslation(repo: I18nRepo, pageId: number, rawLocale: unknown) {
  const { locale } = await requirePageAndLocale(repo, pageId, rawLocale);
  const row = await repo.pageTranslation(pageId, locale);
  if (!row) throw new I18nError("Aún no hay traducción de esta página en ese idioma.");
  await repo.savePageTranslation({ ...row, status: "draft", updatedAt: new Date() });
  return { success: true };
}

export interface PageTranslationStatus {
  locale: string;
  exists: boolean;
  status: TranslationStatus | "missing";
  slug: string | null;
  /** El principal ha cambiado desde que se guardó esta traducción. */
  principalChanged: boolean;
  /** Hay cambios en el borrador sin validar. */
  hasPendingChanges: boolean;
}

/** Estado de una página en cada idioma adicional (para el conmutador del editor). */
export async function pageTranslationStatuses(repo: I18nRepo, pageId: number, principalBlocks: PageBlock[] | null): Promise<PageTranslationStatus[]> {
  const [cfg, rows] = await Promise.all([getI18nConfig(repo), repo.listPageTranslations({ pageId })]);
  const hash = principalBlocks ? contentHash(principalBlocks) : null;
  return cfg.locales
    .filter((l) => !l.isDefault)
    .map((l) => {
      const r = rows.find((x) => x.locale === l.locale);
      return {
        locale: l.locale,
        exists: !!r,
        status: r ? r.status : "missing",
        slug: r?.slug ?? null,
        principalChanged: !!r && !!hash && !!r.baseHash && r.baseHash !== hash,
        hasPendingChanges: !!r && contentHash(r.draftBlocks) !== contentHash(r.publishedBlocks),
      } satisfies PageTranslationStatus;
    });
}

/** Campos de texto de la traducción que siguen sin traducir (iguales al principal o vacíos). */
export async function untranslatedForPage(repo: I18nRepo, pageId: number, rawLocale: unknown, principalBlocks: PageBlock[]): Promise<UntranslatedField[]> {
  const { locale } = await requirePageAndLocale(repo, pageId, rawLocale);
  const row = await repo.pageTranslation(pageId, locale);
  if (!row?.draftBlocks) return untranslatedFields(principalBlocks, []);
  return untranslatedFields(principalBlocks, row.draftBlocks);
}

// ─── Contenido genérico traducible (menús, ajustes, productos…) ───────────────

/**
 * Claves: `menu_item` = id del elemento, `setting` = clave del ajuste, `product` = `experiences.id`,
 * `variant` = `experience_variants.id`, `edition` = `product_editions.id` (convocatoria).
 */
export const CONTENT_ENTITY_TYPES = ["menu_item", "setting", "form", "product", "variant", "edition", "category"] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

/**
 * Campos traducibles por tipo y su longitud máxima. Todo lo demás se rechaza (precio, impuestos, plazas, fechas…).
 * En `product`, `includes` y `excludes` son texto con un elemento por línea.
 */
export const CONTENT_FIELDS: Record<ContentEntityType, Record<string, number>> = {
  menu_item: { label: 128, url: 512 },
  setting: { value: 4000 },
  form: { title: 200, intro: 1000, submitLabel: 120, successMessage: 500, errorMessage: 500 },
  product: {
    title: 256, shortDescription: 2000, description: 20000, metaTitle: 256, metaDescription: 1000,
    duration: 128, requirements: 4000, includes: 4000, excludes: 4000, requestCtaLabel: 80,
  },
  variant: { name: 128, description: 2000 },
  edition: { label: 160, scheduleNote: 600, locationNote: 300 },
  /** Categoría de la tienda (`categories.id`): su nombre en el catálogo público */
  category: { name: 128 },
};

const KEY_RE = /^[A-Za-z0-9_.:-]{1,190}$/;

/** Ajustes cuyo texto se puede traducir (y su longitud máxima): lista cerrada, nunca un ajuste cualquiera. */
export const TRANSLATABLE_SETTINGS: Record<string, number> = { site_footer_text: 240 };

export async function saveContentTranslationDraft(
  repo: I18nRepo,
  input: { entityType: ContentEntityType; entityKey: string; locale: unknown; fields: Record<string, unknown>; slug?: string | null },
) {
  const { locale } = await requireExtraLocale(repo, input.locale);
  const allowed = CONTENT_FIELDS[input.entityType];
  if (!allowed) throw new I18nError("Tipo de contenido no válido.");
  if (!KEY_RE.test(input.entityKey)) throw new I18nError("Identificador no válido.");
  // Producto, opción y convocatoria se identifican por su id (nunca por el slug, que puede cambiar)
  if ((input.entityType === "product" || input.entityType === "variant" || input.entityType === "edition" || input.entityType === "category") && !/^[1-9]\d{0,9}$/.test(input.entityKey)) throw new I18nError("Identificador no válido.");
  if (input.entityType === "setting" && !(input.entityKey in TRANSLATABLE_SETTINGS)) throw new I18nError("Ese ajuste no se puede traducir.");
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields ?? {})) {
    if (!(k in allowed)) throw new I18nError(`El campo «${k}» no se puede traducir.`);
    if (typeof v !== "string") throw new I18nError(`El campo «${k}» debe ser texto.`);
    const text = stripCtl(v).trim();
    if (text.length > allowed[k]) throw new I18nError(`El campo «${k}» admite hasta ${allowed[k]} caracteres.`);
    if (input.entityType === "setting" && (text.length > TRANSLATABLE_SETTINGS[input.entityKey] || /[<>]/.test(text))) throw new I18nError("Texto no válido (sin < ni >, dentro del máximo).");
    if (text) fields[k] = text;
  }
  if (input.entityType === "menu_item" && fields.url && !/^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(fields.url)) throw new I18nError("El enlace debe empezar por /, http(s)://, mailto: o tel:.");
  let slug: string | null = null;
  if (input.slug) {
    if (input.entityType !== "product") throw new I18nError("Solo los productos tienen dirección propia por idioma.");
    slug = normalizeLocalizedSlug(input.slug);
    if (!slug) throw new I18nError("La dirección solo admite minúsculas sin acentos, números y guiones.");
    if (await repo.contentSlugTaken(input.entityType, locale, slug, input.entityKey)) throw new I18nError("Otro producto ya usa esa dirección en este idioma.");
    // Tampoco la dirección principal de OTRO producto: la ficha traducida taparía la suya en este idioma
    const owner = repo.productBySlug ? await repo.productBySlug(slug) : null;
    if (owner && String(owner.id) !== String(input.entityKey)) throw new I18nError("Otro producto ya usa esa dirección.");
  }
  // Editar una traducción validada la devuelve a borrador: aquí no hay copia publicada aparte, así que no se sirve a medias
  await repo.saveContentTranslation({
    entityType: input.entityType, entityKey: input.entityKey, locale, fields, slug,
    status: "draft", validatedAt: null, validatedBy: null,
  });
  return { success: true };
}

export async function validateContentTranslation(repo: I18nRepo, entityType: ContentEntityType, entityKey: string, rawLocale: unknown, by: string | null) {
  const { locale } = await requireExtraLocale(repo, rawLocale);
  const row = await repo.contentTranslation(entityType, entityKey, locale);
  if (!row || !Object.keys(row.fields).length) throw new I18nError("Aún no hay traducción para validar.");
  await repo.saveContentTranslation({ ...row, status: "validated", validatedAt: new Date(), validatedBy: by });
  return { success: true };
}

/** Retirar de la web una traducción validada: vuelve a borrador con sus textos (no se borra nada). */
export async function unvalidateContentTranslation(repo: I18nRepo, entityType: ContentEntityType, entityKey: string, rawLocale: unknown) {
  const { locale } = await requireExtraLocale(repo, rawLocale);
  const row = await repo.contentTranslation(entityType, entityKey, locale);
  if (!row) throw new I18nError("No hay traducción que retirar.");
  await repo.saveContentTranslation({ ...row, status: "draft", validatedAt: null, validatedBy: null });
  return { success: true };
}

// ─── Menús ────────────────────────────────────────────────────────────────────

export interface MenuItemLike {
  id: number;
  parentId: number | null;
  label: string;
  url: string | null;
  [k: string]: unknown;
}

/**
 * Slug de cada producto público en un idioma (el traducido y validado o, si no lo hay, el del principal), para los
 * slugs del principal dados. Los que no son un producto publicado no aparecen (su enlace no se toca).
 */
export async function productSlugsInLocale(repo: I18nRepo, locale: string, primarySlugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!repo.productBySlug || !primarySlugs.length) return out;
  for (const s of primarySlugs) {
    const p = await repo.productBySlug(s);
    if (!p?.isPublished) continue;
    const t = await repo.contentTranslation("product", String(p.id), locale);
    out.set(s, (t?.status === "validated" && t.slug) || p.slug);
  }
  return out;
}

/** Enlaces internos de los bloques de una página traducida, al idioma de la URL (páginas y fichas de producto). */
async function localizeLinksFor(repo: I18nRepo, cfg: I18nConfig, locale: string, blocks: PageBlock[] | null): Promise<PageBlock[] | null> {
  if (!blocks) return blocks;
  const ok = new Set<string>();
  for (const seg of internalLinkSegments(blocks)) {
    if (seg !== "" && ((await repo.publishedTranslationBySlug(locale, seg)) || (await repo.principalPageBySlug(seg)))) ok.add(seg);
  }
  const products = await productSlugsInLocale(repo, locale, internalProductSlugs(blocks));
  return localizeBlockLinks(blocks, locale, cfg, (seg) => ok.has(seg), repo.productBySlug ? (s) => products.get(s) ?? null : undefined);
}

/**
 * Menú en un idioma. Etiqueta y enlace salen de la traducción VALIDADA del elemento; un enlace a una página propia se
 * deriva del slug localizado de esa página. Sin traducción: `hide` oculta el elemento (y sus hijos); `default` lo
 * muestra con la etiqueta del principal y un enlace al fallback de ese idioma.
 */
/**
 * `includeDrafts` (solo vista previa del equipo): usa también los textos y las direcciones en borrador y no exige que el
 * idioma esté validado, para ver la navegación tal y como quedará. Nunca se usa en la web pública.
 */
export async function localizeMenu<T extends MenuItemLike>(repo: I18nRepo, items: T[], rawLocale: string, opts: { includeDrafts?: boolean } = {}): Promise<T[]> {
  const cfg = await getI18nConfig(repo);
  const locale = normalizeLocale(rawLocale);
  if (!locale || locale === cfg.defaultLocale || (!opts.includeDrafts && !isMultilingual(cfg))) return items;
  const entry = cfg.locales.find((l) => l.locale === locale);
  if (!entry || (!opts.includeDrafts && entry.status !== "validated")) return items;
  const onlyValidated = !opts.includeDrafts;
  const [tr, pageTr, home] = await Promise.all([
    repo.listContentTranslations("menu_item", locale, onlyValidated),
    repo.listPageTranslations({ locale, onlyValidated }),
    repo.principalHomeSlug(),
  ]);
  const byKey = new Map(tr.map((t) => [t.entityKey, t]));
  const slugByPage = new Map(pageTr.map((p) => [p.pageId, (opts.includeDrafts ? p.slug : p.publishedSlug) as string]));
  const dropped = new Set<number>();
  const out: T[] = [];
  for (const it of items) {
    if (it.parentId != null && dropped.has(it.parentId)) {
      dropped.add(it.id);
      continue;
    }
    const t = byKey.get(String(it.id));
    const label = t?.fields.label;
    let url = it.url;
    let translatedLink = false;
    const catalog = it.url ? /^\/tienda(\?[^#]*)?$/.exec(it.url) : null;
    if (catalog) {
      // Catálogo de la tienda: el del idioma (con su filtro), salvo que la traducción del elemento traiga su propio enlace
      url = t?.fields.url || localizedPath("/tienda", locale, cfg) + (catalog[1] ?? "");
      translatedLink = true;
    } else if (it.url && /^\/[^/]*$/.test(it.url)) {
      const principalSlug = it.url === "/" ? home : it.url.slice(1);
      const page = await repo.principalPageBySlug(principalSlug);
      const ps = page ? slugByPage.get(page.id) : undefined;
      if (ps) {
        url = localizedPath(it.url === "/" || principalSlug === home ? "/" : `/${ps}`, locale, cfg);
        translatedLink = true;
      }
    } else if (t?.fields.url) {
      url = t.fields.url;
      translatedLink = true;
    } else if (it.url && productSlugOfPath(it.url)) {
      // Ficha de producto: a la del mismo producto en este idioma (con su slug traducido si lo tiene)
      const primary = productSlugOfPath(it.url)!;
      const slug = (await productSlugsInLocale(repo, locale, [primary])).get(primary);
      if (slug) url = localizeProductLink(it.url, locale, cfg, () => slug);
    }
    const isInternalPage = !!it.url && /^\/[^/]*$/.test(it.url);
    const hasText = !!label;
    if (hasText && (translatedLink || !isInternalPage)) {
      out.push({ ...it, label, url });
    } else if (cfg.fallback === "default") {
      out.push({ ...it, label: label ?? it.label, url: isInternalPage && !translatedLink ? localizedPath(it.url as string, locale, cfg) : url });
    } else {
      dropped.add(it.id);
    }
  }
  return out;
}

// ─── Resolución de peticiones públicas ────────────────────────────────────────

export interface ResolvedPage {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  blocks: PageBlock[] | null;
}

export type ResolvedRequest =
  /** Una sola lengua, ruta no localizable o ruta que no es una página del constructor: se sirve como siempre. */
  | { kind: "passthrough" }
  | { kind: "redirect"; to: string; status: 301 }
  | { kind: "notFound" }
  /** Catálogo de la tienda en un idioma adicional (`/<idioma>/tienda`): las mismas reglas que `/tienda`. */
  | {
      kind: "catalog";
      locale: string;
      /** La URL llevaba prefijo de idioma (el catálogo del idioma principal sin prefijo es `/tienda`). */
      prefixed: boolean;
      seo: LocaleSeo;
      /** El mismo catálogo en cada idioma público (selector de idioma). */
      switcher: Alternate[];
      /** Título de la pestaña en ese idioma (el del menú que lleva al catálogo, o «Shop»/«Tienda»…). */
      title: string;
    }
  | {
      kind: "page";
      /** La URL llevaba prefijo de idioma. Sin prefijo es el principal: la ruta la valida el servidor de siempre. */
      prefixed: boolean;
      decision: ServeDecision;
      locale: string;
      /** Slug de la página en el idioma principal (para leer su contenido de siempre). */
      principalSlug: string;
      /** Contenido traducido; null si se sirve el del principal (principal o fallback). */
      page: ResolvedPage | null;
      seo: LocaleSeo;
    }
  /** Ficha de producto (`/tienda/<slug>` o `/<idioma>/tienda/<slug>`): siempre se sirve; sin traducción, con el contenido del principal. */
  | {
      kind: "product";
      prefixed: boolean;
      locale: string;
      productId: number;
      principalSlug: string;
      translated: boolean;
      /** Título y metadatos traducidos (null: los del principal). */
      meta: { title: string; metaTitle: string | null; metaDescription: string | null } | null;
      seo: LocaleSeo;
      /** Misma ficha en cada idioma público (selector de idioma; incluye las aún sin traducir). */
      switcher: Alternate[];
    };

// ─── Fichas de producto ───────────────────────────────────────────────────────

export interface ProductLocaleResolution {
  product: PrincipalProduct;
  /** Idioma de la URL. */
  locale: string;
  /** Idioma real del contenido: el principal cuando falta la traducción. */
  contentLocale: string;
  /** El contenido está en el idioma de la URL (principal, o traducción validada). */
  translated: boolean;
  /** Traducción validada que se superpone (null en el principal o sin traducción). */
  translation: ContentTranslationRow | null;
  /** Slug de la ficha en este idioma. */
  slug: string;
  /** La misma ficha en cada idioma público (para el selector), con su ruta real. */
  alternates: Array<{ locale: string; path: string }>;
  /** Solo las versiones con contenido en su idioma (principal + traducciones validadas), para `hreflang` y el sitemap. */
  versions: PageVersion[];
}

export type ProductResolution = { kind: "notFound" } | { kind: "redirect"; to: string; product: PrincipalProduct } | ({ kind: "product" } & ProductLocaleResolution);

const hasFields = (t: ContentTranslationRow | null | undefined): t is ContentTranslationRow => !!t && t.status === "validated" && Object.keys(t.fields).length > 0;

/** Versiones de la ficha de un producto en los idiomas públicos (traducciones validadas de idiomas validados). */
export async function productVersions(repo: I18nRepo, cfg: I18nConfig, product: PrincipalProduct) {
  const byLocale = new Map<string, ContentTranslationRow>();
  const alternates: ProductLocaleResolution["alternates"] = [];
  const versions: PageVersion[] = [];
  for (const l of publicLocales(cfg)) {
    let slug = product.slug;
    if (l !== cfg.defaultLocale) {
      const t = await repo.contentTranslation("product", String(product.id), l);
      if (hasFields(t)) {
        byLocale.set(l, t);
        slug = t.slug || product.slug;
      }
    }
    alternates.push({ locale: l, path: localizedPath(productRest(slug), l, cfg) });
    if (l === cfg.defaultLocale || byLocale.has(l)) versions.push({ locale: l, rest: productRest(slug) });
  }
  return { byLocale, alternates, versions };
}

/**
 * Qué ficha de producto hay en `/<idioma>/tienda/<slug>` (o `/tienda/<slug>` con `rawLocale` vacío o el principal).
 * Una sola identidad de producto: el slug puede ser el traducido (traducción validada) o el del principal. Con slug
 * traducido, el del principal en esa URL redirige al traducido. El idioma debe ser público (validado). Sin traducción
 * validada se sirve igualmente, con el contenido del principal y `translated = false` (la página lo avisa).
 */
export async function resolveProductLocale(repo: I18nRepo, rawLocale: string | null | undefined, slug: string): Promise<ProductResolution> {
  if (!repo.productBySlug || !repo.productById) return { kind: "notFound" };
  const cfg = await getI18nConfig(repo);
  const locale = rawLocale ? normalizeLocale(rawLocale) : cfg.defaultLocale;
  if (!locale) return { kind: "notFound" };
  const isDefault = locale === cfg.defaultLocale;
  if (!isDefault) {
    const entry = cfg.locales.find((l) => l.locale === locale);
    if (!isMultilingual(cfg) || !entry || entry.status !== "validated") return { kind: "notFound" };
  }
  let product: PrincipalProduct | null = null;
  if (!isDefault) {
    const byTranslatedSlug = (await repo.listContentTranslations("product", locale, true)).find((t) => t.slug === slug && hasFields(t));
    if (byTranslatedSlug && /^\d+$/.test(byTranslatedSlug.entityKey)) product = await repo.productById(Number(byTranslatedSlug.entityKey));
  }
  if (!product) product = await repo.productBySlug(slug);
  if (!product?.isPublished) return { kind: "notFound" };
  const { byLocale, alternates, versions } = await productVersions(repo, cfg, product);
  const translation = isDefault ? null : byLocale.get(locale) ?? null;
  const slugHere = translation?.slug || product.slug;
  if (slugHere !== slug) {
    const to = localizedPath(productRest(slugHere), locale, cfg);
    return isSafeRedirectTarget(to) ? { kind: "redirect", to, product } : { kind: "notFound" };
  }
  const translated = isDefault || !!translation;
  return { kind: "product", product, locale, contentLocale: translated ? locale : cfg.defaultLocale, translated, translation, slug: slugHere, alternates, versions };
}

/** Respuesta de `resolveRequest` para una ficha: SEO del idioma (sin traducción: canónica al principal y `noindex`). */
function productRequest(cfg: I18nConfig, origin: string, r: Extract<ProductResolution, { kind: "product" }>, prefixed: boolean): ResolvedRequest {
  const decision: ServeDecision = r.locale === cfg.defaultLocale
    ? { kind: "principal" }
    : r.translated ? { kind: "translated", locale: r.locale } : { kind: "fallback", requested: r.locale, contentLocale: cfg.defaultLocale };
  // `lang` del documento: el de la URL, porque la interfaz de la ficha (rutas, botones, aviso) sale en ese idioma; el
  // contenido sin traducir lo marca la propia página con su `lang` real. Canónica y `noindex` como en el fallback.
  const seo = { ...localeSeo({ cfg, origin, decision, locale: r.locale, rest: productRest(r.slug), principalRest: productRest(r.product.slug), versions: r.versions }), htmlLang: r.locale };
  const f = r.translation?.fields;
  const meta = f?.title ? { title: f.title, metaTitle: f.metaTitle ?? null, metaDescription: f.metaDescription ?? f.shortDescription ?? null } : null;
  const switcher = r.alternates.length > 1 ? r.alternates.map((a) => ({ hreflang: a.locale, href: a.path })) : [];
  return { kind: "product", prefixed, locale: r.locale, productId: r.product.id, principalSlug: r.product.slug, translated: r.translated, meta, seo, switcher };
}

/** Catálogo (`/tienda` o `/<idioma>/tienda`): selector, canónica, hreflang y título en el idioma de la URL. */
async function catalogRequest(repo: I18nRepo, cfg: I18nConfig, origin: string, locale: string, prefixed: boolean): Promise<ResolvedRequest> {
  const locales = publicLocales(cfg);
  const decision: ServeDecision = locale === cfg.defaultLocale ? { kind: "principal" } : { kind: "translated", locale };
  const seo = { ...localeSeo({ cfg, origin, decision, locale, rest: "/tienda", principalRest: "/tienda", versions: locales.map((l) => ({ locale: l, rest: "/tienda" })) }), htmlLang: locale };
  const switcher = locales.length > 1 ? locales.map((l) => ({ hreflang: l, href: localizedPath("/tienda", l, cfg) })) : [];
  let title = "";
  try {
    const item = repo.shopMenuItem ? await repo.shopMenuItem() : null;
    if (item) {
      const t = locale === cfg.defaultLocale ? null : (await repo.listContentTranslations("menu_item", locale, true)).find((x) => x.entityKey === String(item.id));
      title = (t?.fields.label ?? (locale === cfg.defaultLocale ? item.label : "")).trim();
    }
  } catch {
    /* sin título propio: el genérico del idioma */
  }
  return { kind: "catalog", locale, prefixed, seo, switcher, title: title || siteUiText(locale).shop };
}

/** Versiones públicas de una página (principal + traducciones validadas), para `hreflang`. */
async function versionsOf(repo: I18nRepo, cfg: I18nConfig, page: PrincipalPage, home: string): Promise<PageVersion[]> {
  const isHome = page.slug === home;
  const out: PageVersion[] = [{ locale: cfg.defaultLocale, rest: isHome ? "/" : `/${page.slug}` }];
  for (const t of await repo.listPageTranslations({ pageId: page.id, onlyValidated: true })) {
    if (t.publishedSlug) out.push({ locale: t.locale, rest: isHome ? "/" : `/${t.publishedSlug}` });
  }
  return out;
}

/**
 * Qué hay en una URL desde el punto de vista del idioma. Es la única función que el servidor HTML y la API pública
 * necesitan: devuelve `passthrough` cuando nada cambia respecto a hoy (la mayoría de las empresas, siempre).
 */
export async function resolveRequest(repo: I18nRepo, pathname: string, origin: string): Promise<ResolvedRequest> {
  const cfg = await getI18nConfig(repo);
  if (!isMultilingual(cfg)) return { kind: "passthrough" };
  const parsed = parseLocalizedPath(pathname, cfg);
  if (parsed.redirectTo !== undefined) return safeRedirect(parsed.redirectTo);
  const home = await repo.principalHomeSlug();
  const asPage = async (rest: string) => {
    if (rest === "/") return repo.principalPageBySlug(home);
    const m = /^\/([^/]+)$/.exec(rest);
    return m ? repo.principalPageBySlug(decodeURIComponentSafe(m[1])) : null;
  };
  // Ficha de producto en un idioma (null: no es una ficha o el repositorio no conoce productos)
  const asProduct = async (locale: string, prefixed: boolean): Promise<ResolvedRequest | null> => {
    const slug = productSlugOfPath(parsed.rest);
    if (!slug || !repo.productBySlug) return null;
    const r = await resolveProductLocale(repo, locale, slug);
    if (r.kind === "redirect") return safeRedirect(r.to);
    if (r.kind === "notFound") {
      if (prefixed) return { kind: "notFound" };
      // Sin prefijo: un slug que ya solo existe como traducción validada (p. ej. tras cambiar el idioma principal) lleva
      // a su ficha en ese idioma; si no, se sirve como siempre (la aplicación muestra su «no encontrado»)
      for (const l of publicLocales(cfg)) {
        if (l === cfg.defaultLocale) continue;
        const t = (await repo.listContentTranslations("product", l, true)).find((x) => x.slug === slug && hasFields(x));
        const p = t && /^\d+$/.test(t.entityKey) && repo.productById ? await repo.productById(Number(t.entityKey)) : null;
        if (p?.isPublished) return safeRedirect(localizedPath(productRest(slug), l, cfg));
      }
      return { kind: "passthrough" };
    }
    return productRequest(cfg, origin, r, prefixed);
  };

  // Sin prefijo: el principal. Solo es «página» si lo es; si no (tienda, blog…) se sirve como siempre
  if (!parsed.prefixed) {
    const product = await asProduct(cfg.defaultLocale, false);
    if (product) return product;
    const page = await asPage(parsed.rest);
    if ((!page || !page.isPublished) && parsed.rest === "/tienda" && repo.productBySlug) return catalogRequest(repo, cfg, origin, cfg.defaultLocale, false);
    if (!page || !page.isPublished) return { kind: "passthrough" };
    const decision: ServeDecision = { kind: "principal" };
    const seo = localeSeo({ cfg, origin, decision, locale: cfg.defaultLocale, rest: parsed.rest, principalRest: parsed.rest, versions: await versionsOf(repo, cfg, page, home) });
    return { kind: "page", prefixed: false, decision, locale: cfg.defaultLocale, principalSlug: page.slug, page: null, seo };
  }

  const locale = parsed.locale;
  // Idioma sin validar o desconocido: nunca público
  const entry = cfg.locales.find((l) => l.locale === locale);
  if (!entry || (!entry.isDefault && entry.status !== "validated")) return { kind: "notFound" };

  // Prefijo del propio principal (`/es/x` con prefijo activo)
  if (locale === cfg.defaultLocale) {
    const product = await asProduct(locale, true);
    if (product) return product;
    const page = await asPage(parsed.rest);
    if (!page?.isPublished && parsed.rest === "/tienda" && repo.productBySlug) return catalogRequest(repo, cfg, origin, locale, true);
    if (!page?.isPublished) return { kind: "notFound" };
    const decision: ServeDecision = { kind: "principal" };
    return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: null, seo: localeSeo({ cfg, origin, decision, locale, rest: parsed.rest, principalRest: parsed.rest, versions: await versionsOf(repo, cfg, page, home) }) };
  }

  // Ficha de producto del idioma adicional
  const product = await asProduct(locale, true);
  if (product) return product;
  // Catálogo del idioma adicional (solo si la tienda está localizada: el repositorio conoce los productos)
  if (parsed.rest === "/tienda" && repo.productBySlug) return catalogRequest(repo, cfg, origin, locale, true);

  // Idioma adicional: por slug publicado (la portada, en «/»)
  let row: PageTranslationRow | null = null;
  let page: PrincipalPage | null = null;
  if (parsed.rest === "/") {
    page = await repo.principalPageBySlug(home);
    row = page ? await repo.pageTranslation(page.id, locale) : null;
  } else {
    const m = /^\/([^/]+)$/.exec(parsed.rest);
    if (!m) return { kind: "notFound" };
    const slug = decodeURIComponentSafe(m[1]);
    row = await repo.publishedTranslationBySlug(locale, slug);
    page = row ? await repo.principalPageById(row.pageId) : await repo.principalPageBySlug(slug);
    if (row && page && page.slug === home) return safeRedirect(localizedPath("/", locale, cfg));
    if (!row && page) {
      // El slug del principal en una URL de otro idioma: si ya hay traducción validada, a su dirección; si no, fallback
      const t = await repo.pageTranslation(page.id, locale);
      if (t?.status === "validated" && t.publishedSlug) return safeRedirect(localizedPath(`/${t.publishedSlug}`, locale, cfg));
    }
  }
  if (page && !page.isPublished) page = null;
  const validated = !!row && row.status === "validated" && !!row.publishedBlocks?.length;
  const decision = decideServing({ cfg, locale, principalExists: !!page, translationValidated: validated });
  if (decision.kind === "notFound" || !page) return { kind: "notFound" };
  const principalRest = page.slug === home ? "/" : `/${page.slug}`;
  const versions = await versionsOf(repo, cfg, page, home);
  const seo = localeSeo({ cfg, origin, decision, locale, rest: parsed.rest, principalRest, versions });
  if (decision.kind === "translated" && row) {
    const meta = row.publishedMeta ?? { title: row.title, metaTitle: null, metaDescription: null, ogImageUrl: null };
    return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: { ...meta, blocks: await localizeLinksFor(repo, cfg, locale, row.publishedBlocks) }, seo };
  }
  return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: null, seo };
}

/**
 * Dirección de la página PRINCIPAL a la que corresponde una dirección que llega del cliente en una página traducida
 * (el slug localizado, o el código del idioma en la portada). null si es ya una página del principal o no se reconoce.
 * Solo traducciones validadas de idiomas validados.
 */
export async function principalSlugForLocalized(repo: I18nRepo, slug: string): Promise<string | null> {
  if (await repo.principalPageBySlug(slug)) return null;
  const cfg = await getI18nConfig(repo);
  if (!isMultilingual(cfg)) return null;
  const pub = new Set(publicLocales(cfg));
  if (pub.has(slug) && slug !== cfg.defaultLocale) return repo.principalHomeSlug();
  for (const t of await repo.listPageTranslations({ onlyValidated: true })) {
    if (t.publishedSlug === slug && pub.has(t.locale)) return (await repo.principalPageById(t.pageId))?.slug ?? null;
  }
  return null;
}

/** Única vía de redirección: un destino que no sea una ruta interna segura se convierte en «no encontrada». */
function safeRedirect(to: string): ResolvedRequest {
  return isSafeRedirectTarget(to) ? { kind: "redirect", to, status: 301 } : { kind: "notFound" };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

export interface SitemapPageEntry {
  /** Ruta sin prefijo en el principal. */
  rest: string;
  versions: PageVersion[];
  lastmod?: string;
}

/**
 * Entradas localizadas del sitemap: por cada página con traducciones validadas, una URL por idioma público con sus
 * alternativas. Devuelve [] si no hay idiomas adicionales (el sitemap queda idéntico al de siempre).
 * `products`: productos que el sitemap ya publica en `/tienda/<slug>` (publicados y a la vista); entra cada uno con
 * alguna traducción validada. Las versiones sin traducir no entran (se sirven con `noindex`).
 */
export async function sitemapAlternates(repo: I18nRepo, products: PrincipalProduct[] = [], opts: { catalog?: boolean } = {}): Promise<{ cfg: I18nConfig; entries: SitemapPageEntry[] }> {
  const cfg = await getI18nConfig(repo);
  if (!isMultilingual(cfg)) return { cfg, entries: [] };
  const [rows, home] = await Promise.all([repo.listPageTranslations({ onlyValidated: true }), repo.principalHomeSlug()]);
  const byPage = new Map<number, PageTranslationRow[]>();
  for (const r of rows) byPage.set(r.pageId, [...(byPage.get(r.pageId) ?? []), r]);
  const entries: SitemapPageEntry[] = [];
  // Catálogo (`/tienda`): una URL por idioma público, cada una con las demás como alternativas
  if (opts.catalog) entries.push({ rest: "/tienda", versions: publicLocales(cfg).map((l) => ({ locale: l, rest: "/tienda" })) });
  for (const [pageId, list] of Array.from(byPage.entries())) {
    const page = await repo.principalPageById(pageId);
    if (!page?.isPublished) continue;
    entries.push({ rest: page.slug === home ? "/" : `/${page.slug}`, versions: await versionsOf(repo, cfg, page, home), lastmod: list[0]?.updatedAt?.toISOString().slice(0, 10) });
  }
  for (const p of products) {
    if (!p.isPublished) continue;
    const { versions } = await productVersions(repo, cfg, p);
    if (versions.length < 2) continue;
    entries.push({ rest: productRest(p.slug), versions, lastmod: p.updatedAt instanceof Date && !Number.isNaN(p.updatedAt.getTime()) ? p.updatedAt.toISOString().slice(0, 10) : undefined });
  }
  return { cfg, entries };
}
