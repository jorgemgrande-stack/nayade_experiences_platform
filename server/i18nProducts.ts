/**
 * Fichas de producto en el idioma de la URL (multidioma E-1, tienda de cada empresa).
 *
 * Una sola identidad de producto con una representación por idioma: aquí solo se SUPERPONEN los textos de las
 * traducciones VALIDADAS (producto, opciones y convocatorias, en `content_translations`) sobre el contenido del
 * principal. Precio, impuestos, plazas, fechas, imágenes y reglas salen siempre del producto del principal.
 *
 * Política sin traducción (explícita): se muestra el contenido del principal con `translated = false` y su idioma real
 * (`contentLocale`), para que la página lo avise y lo marque con `lang`; nunca se presenta como si fuera del idioma de
 * la URL. Sin idiomas adicionales, nada cambia.
 */
import { isMultilingual, normalizeLocale } from "../shared/i18n";
import { getI18nConfig, resolveProductLocale, type ContentTranslationRow, type I18nRepo } from "./i18nService";

/** Idioma de la ficha que se devuelve a la web (para el aviso, `lang` y el selector de idioma). */
export interface ProductI18nInfo {
  /** Idioma de la URL. */
  locale: string;
  /** Idioma real del contenido mostrado (el principal cuando falta la traducción). */
  contentLocale: string;
  /** Hay traducción validada a este idioma (o es el principal). */
  translated: boolean;
  /** La misma ficha en cada idioma público (ruta real, con el slug de cada idioma). */
  alternates: Array<{ locale: string; path: string }>;
  /** La URL pedida no es la canónica de este idioma (p. ej. slug del principal con slug traducido): ir aquí. */
  redirectTo?: string;
}

/** Idioma adicional público pedido (validado), o null: principal, desconocido, sin validar o empresa de un solo idioma. */
export async function publicExtraLocale(repo: I18nRepo, raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const locale = normalizeLocale(raw);
  if (!locale) return null;
  const cfg = await getI18nConfig(repo);
  if (!isMultilingual(cfg) || locale === cfg.defaultLocale) return null;
  return cfg.locales.some((l) => l.locale === locale && l.status === "validated") ? locale : null;
}

const TEXT_FIELDS = ["title", "shortDescription", "description", "metaTitle", "metaDescription", "duration", "requirements", "requestCtaLabel"] as const;
const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** Producto con los textos de su traducción (los campos que la traducción no trae quedan como en el principal). Pura. */
export function overlayProduct<T extends object>(product: T, t: ContentTranslationRow | null): T {
  if (!t) return product;
  const out: Record<string, unknown> = { ...(product as Record<string, unknown>) };
  for (const k of TEXT_FIELDS) if (t.fields[k]) out[k] = t.fields[k];
  if (t.fields.includes) out.includes = lines(t.fields.includes);
  if (t.fields.excludes) out.excludes = lines(t.fields.excludes);
  return out as T;
}

export type LocalizedProduct<T> = { kind: "notFound" } | { kind: "ok"; product: T; i18n: ProductI18nInfo };

/**
 * Ficha pública de un producto en un idioma. `slug` es el de la URL (traducido o del principal); `load` lee el producto
 * PUBLICADO del principal por su slug (la consulta de siempre). Idioma no público o producto inexistente: «no encontrado».
 */
export async function localizeProductBySlug<T extends object>(repo: I18nRepo, slug: string, rawLocale: string, load: (primarySlug: string) => Promise<T | null>): Promise<LocalizedProduct<T>> {
  const r = await resolveProductLocale(repo, rawLocale, slug);
  if (r.kind === "notFound") return { kind: "notFound" };
  if (r.kind === "redirect") {
    const base = await load(r.product.slug);
    if (!base) return { kind: "notFound" };
    return { kind: "ok", product: base, i18n: { locale: normalizeLocale(rawLocale) ?? rawLocale, contentLocale: "", translated: false, alternates: [], redirectTo: r.to } };
  }
  const base = await load(r.product.slug);
  if (!base) return { kind: "notFound" };
  return { kind: "ok", product: overlayProduct(base, r.translation), i18n: { locale: r.locale, contentLocale: r.contentLocale, translated: r.translated, alternates: r.alternates } };
}

const byKey = (rows: ContentTranslationRow[]) => new Map(rows.filter((t) => Object.keys(t.fields).length > 0).map((t) => [t.entityKey, t]));

/** Opciones (variantes) de un producto con su nombre y descripción traducidos y validados. Sin idioma adicional, tal cual. */
export async function localizeVariants<T extends { id: number; name: string; description?: string | null }>(repo: I18nRepo, rows: T[], rawLocale: string | null | undefined): Promise<T[]> {
  if (!rows.length) return rows;
  const locale = await publicExtraLocale(repo, rawLocale);
  if (!locale) return rows;
  const tr = byKey(await repo.listContentTranslations("variant", locale, true));
  return rows.map((v) => {
    const f = tr.get(String(v.id))?.fields;
    if (!f) return v;
    return { ...v, ...(f.name ? { name: f.name } : {}), ...(f.description ? { description: f.description } : {}) };
  });
}

/**
 * Productos de un listado (catálogo público) con su nombre, resumen y slug en ese idioma (traducciones validadas). El
 * slug traducido es el de su ficha en ese idioma; sin traducción, el del principal (la ficha lo avisa). Sin idioma
 * adicional, tal cual. Precio, imágenes, modo de contratación y categoría no cambian.
 */
export async function localizeProducts<T extends { id: number; slug: string; title: string; shortDescription?: string | null }>(repo: I18nRepo, rows: T[], rawLocale: string | null | undefined): Promise<T[]> {
  if (!rows.length) return rows;
  const locale = await publicExtraLocale(repo, rawLocale);
  if (!locale) return rows;
  const tr = byKey(await repo.listContentTranslations("product", locale, true));
  return rows.map((p) => {
    const t = tr.get(String(p.id));
    if (!t) return p;
    return { ...p, ...(t.fields.title ? { title: t.fields.title } : {}), ...(t.fields.shortDescription ? { shortDescription: t.fields.shortDescription } : {}), ...(t.slug ? { slug: t.slug } : {}) };
  });
}

/** Categorías de la tienda con su nombre traducido y validado. Sin idioma adicional, tal cual. */
export async function localizeCategories<T extends { id: number; name: string }>(repo: I18nRepo, rows: T[], rawLocale: string | null | undefined): Promise<T[]> {
  if (!rows.length) return rows;
  const locale = await publicExtraLocale(repo, rawLocale);
  if (!locale) return rows;
  const tr = byKey(await repo.listContentTranslations("category", locale, true));
  return rows.map((c) => {
    const name = tr.get(String(c.id))?.fields.name;
    return name ? { ...c, name } : c;
  });
}

export interface EditionLikeRow {
  id: number;
  experienceId: number;
  productTitle: string;
  productSlug: string;
  label: string;
  scheduleNote: string;
  locationNote: string;
  /** Categoría del producto (opcional): su nombre también se traduce */
  categoryId?: number | null;
  categoryName?: string | null;
}

/**
 * Convocatorias públicas con sus textos traducidos y validados (etiqueta, horario, lugar), el nombre y el slug del
 * producto y, si viene, el nombre de su categoría en ese idioma. Fechas, plazas, estado y precio no cambian. Sin
 * idioma adicional, tal cual.
 */
export async function localizeEditions<T extends EditionLikeRow>(repo: I18nRepo, rows: T[], rawLocale: string | null | undefined): Promise<T[]> {
  if (!rows.length) return rows;
  const locale = await publicExtraLocale(repo, rawLocale);
  if (!locale) return rows;
  const withCategory = rows.some((e) => e.categoryId != null);
  const [ed, pr, ca] = await Promise.all([
    repo.listContentTranslations("edition", locale, true),
    repo.listContentTranslations("product", locale, true),
    withCategory ? repo.listContentTranslations("category", locale, true) : Promise.resolve([]),
  ]);
  const edT = byKey(ed);
  const prT = byKey(pr);
  const caT = byKey(ca);
  return rows.map((e) => {
    const f = edT.get(String(e.id))?.fields;
    const p = prT.get(String(e.experienceId));
    const categoryName = e.categoryId != null ? caT.get(String(e.categoryId))?.fields.name : undefined;
    return {
      ...e,
      ...(f?.label ? { label: f.label } : {}),
      ...(f?.scheduleNote ? { scheduleNote: f.scheduleNote } : {}),
      ...(f?.locationNote ? { locationNote: f.locationNote } : {}),
      ...(p?.fields.title ? { productTitle: p.fields.title } : {}),
      ...(p?.slug ? { productSlug: p.slug } : {}),
      ...(categoryName ? { categoryName } : {}),
    };
  });
}
