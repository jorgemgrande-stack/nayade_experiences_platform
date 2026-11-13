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
import {
  DEFAULT_LOCALE, MAX_LOCALES, buildConfig, contentHash, decideServing, isConfiguredLocale, isMultilingual, isReservedSlug,
  localeSeo, localizedPath, normalizeLocale, normalizeLocalizedSlug, parseLocalizedPath, untranslatedFields,
  type I18nConfig, type LocaleEntry, type LocaleSeo, type PageVersion, type ServeDecision, type TranslationStatus, type UntranslatedField,
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
  writeSetting(key: "i18n_default_prefix" | "i18n_fallback" | "i18n_negotiate", value: string): Promise<void>;

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

export const CONTENT_ENTITY_TYPES = ["menu_item", "setting", "form", "product"] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

/** Campos traducibles por tipo y su longitud máxima. Todo lo demás se rechaza (precio, impuestos, reglas…). */
export const CONTENT_FIELDS: Record<ContentEntityType, Record<string, number>> = {
  menu_item: { label: 128, url: 512 },
  setting: { value: 4000 },
  form: { title: 200, intro: 1000, submitLabel: 120, successMessage: 500, errorMessage: 500 },
  product: { title: 256, shortDescription: 2000, description: 20000, metaTitle: 256, metaDescription: 1000 },
};

const KEY_RE = /^[A-Za-z0-9_.:-]{1,190}$/;

export async function saveContentTranslationDraft(
  repo: I18nRepo,
  input: { entityType: ContentEntityType; entityKey: string; locale: unknown; fields: Record<string, unknown>; slug?: string | null },
) {
  const { locale } = await requireExtraLocale(repo, input.locale);
  const allowed = CONTENT_FIELDS[input.entityType];
  if (!allowed) throw new I18nError("Tipo de contenido no válido.");
  if (!KEY_RE.test(input.entityKey)) throw new I18nError("Identificador no válido.");
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields ?? {})) {
    if (!(k in allowed)) throw new I18nError(`El campo «${k}» no se puede traducir.`);
    if (typeof v !== "string") throw new I18nError(`El campo «${k}» debe ser texto.`);
    const text = stripCtl(v).trim();
    if (text.length > allowed[k]) throw new I18nError(`El campo «${k}» admite hasta ${allowed[k]} caracteres.`);
    if (text) fields[k] = text;
  }
  if (input.entityType === "menu_item" && fields.url && !/^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(fields.url)) throw new I18nError("El enlace debe empezar por /, http(s)://, mailto: o tel:.");
  let slug: string | null = null;
  if (input.slug) {
    if (input.entityType !== "product") throw new I18nError("Solo los productos tienen dirección propia por idioma.");
    slug = normalizeLocalizedSlug(input.slug);
    if (!slug) throw new I18nError("La dirección solo admite minúsculas sin acentos, números y guiones.");
    if (await repo.contentSlugTaken(input.entityType, locale, slug, input.entityKey)) throw new I18nError("Otro producto ya usa esa dirección en este idioma.");
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

// ─── Menús ────────────────────────────────────────────────────────────────────

export interface MenuItemLike {
  id: number;
  parentId: number | null;
  label: string;
  url: string | null;
  [k: string]: unknown;
}

/**
 * Menú en un idioma. Etiqueta y enlace salen de la traducción VALIDADA del elemento; un enlace a una página propia se
 * deriva del slug localizado de esa página. Sin traducción: `hide` oculta el elemento (y sus hijos); `default` lo
 * muestra con la etiqueta del principal y un enlace al fallback de ese idioma.
 */
export async function localizeMenu<T extends MenuItemLike>(repo: I18nRepo, items: T[], rawLocale: string): Promise<T[]> {
  const cfg = await getI18nConfig(repo);
  const locale = normalizeLocale(rawLocale);
  if (!locale || locale === cfg.defaultLocale || !isMultilingual(cfg)) return items;
  const entry = cfg.locales.find((l) => l.locale === locale);
  if (!entry || entry.status !== "validated") return items;
  const [tr, pageTr, home] = await Promise.all([
    repo.listContentTranslations("menu_item", locale, true),
    repo.listPageTranslations({ locale, onlyValidated: true }),
    repo.principalHomeSlug(),
  ]);
  const byKey = new Map(tr.map((t) => [t.entityKey, t]));
  const slugByPage = new Map(pageTr.map((p) => [p.pageId, p.publishedSlug as string]));
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
    if (it.url && /^\/[^/]*$/.test(it.url)) {
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
    };

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
  if (parsed.redirectTo !== undefined) return { kind: "redirect", to: parsed.redirectTo, status: 301 };
  const home = await repo.principalHomeSlug();
  const asPage = async (rest: string) => {
    if (rest === "/") return repo.principalPageBySlug(home);
    const m = /^\/([^/]+)$/.exec(rest);
    return m ? repo.principalPageBySlug(decodeURIComponentSafe(m[1])) : null;
  };

  // Sin prefijo: el principal. Solo es «página» si lo es; si no (tienda, blog…) se sirve como siempre
  if (!parsed.prefixed) {
    const page = await asPage(parsed.rest);
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
    const page = await asPage(parsed.rest);
    if (!page?.isPublished) return { kind: "notFound" };
    const decision: ServeDecision = { kind: "principal" };
    return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: null, seo: localeSeo({ cfg, origin, decision, locale, rest: parsed.rest, principalRest: parsed.rest, versions: await versionsOf(repo, cfg, page, home) }) };
  }

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
    if (row && page && page.slug === home) return { kind: "redirect", to: localizedPath("/", locale, cfg), status: 301 };
    if (!row && page) {
      // El slug del principal en una URL de otro idioma: si ya hay traducción validada, a su dirección; si no, fallback
      const t = await repo.pageTranslation(page.id, locale);
      if (t?.status === "validated" && t.publishedSlug) return { kind: "redirect", to: localizedPath(`/${t.publishedSlug}`, locale, cfg), status: 301 };
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
    return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: { ...meta, blocks: row.publishedBlocks }, seo };
  }
  return { kind: "page", prefixed: true, decision, locale, principalSlug: page.slug, page: null, seo };
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
 */
export async function sitemapAlternates(repo: I18nRepo): Promise<{ cfg: I18nConfig; entries: SitemapPageEntry[] }> {
  const cfg = await getI18nConfig(repo);
  if (!isMultilingual(cfg)) return { cfg, entries: [] };
  const [rows, home] = await Promise.all([repo.listPageTranslations({ onlyValidated: true }), repo.principalHomeSlug()]);
  const byPage = new Map<number, PageTranslationRow[]>();
  for (const r of rows) byPage.set(r.pageId, [...(byPage.get(r.pageId) ?? []), r]);
  const entries: SitemapPageEntry[] = [];
  for (const [pageId, list] of Array.from(byPage.entries())) {
    const page = await repo.principalPageById(pageId);
    if (!page?.isPublished) continue;
    entries.push({ rest: page.slug === home ? "/" : `/${page.slug}`, versions: await versionsOf(repo, cfg, page, home), lastmod: list[0]?.updatedAt?.toISOString().slice(0, 10) });
  }
  return { cfg, entries };
}
