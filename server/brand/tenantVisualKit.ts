/**
 * Kit visual de la empresa en curso: lo que necesitan un correo o una página pública para llevar SU marca (y no la
 * de otra empresa ni la de la plataforma): nombre, logotipo absoluto y seguro, paleta derivada de sus colores,
 * tipografías seguras para correo, identidad legal y enlaces a su web y a sus páginas publicadas (privacidad,
 * contacto, aviso legal) en el idioma de la persona.
 *
 *  - Todo sale de los ajustes de la empresa (`brand_*`, `theme_*`), de sus páginas publicadas y de su multidioma.
 *    Sin un dato, un valor neutro: nunca se inventa ni se hereda de otra instalación.
 *  - Un enlace solo se ofrece si la página está publicada (y no es el texto legal de relleno): nada de enlaces rotos.
 *  - Caché corta por empresa (60 s): un envío masivo no consulta la base de datos en cada correo.
 *  - `minimalKit()` no toca la base de datos: lo usan las pruebas y los correos cuando aún no hay kit cargado.
 *
 * Las dependencias con base de datos se importan de forma diferida para que `minimalKit` y los tipos puedan usarse
 * desde módulos puros (p. ej. `newsletter/core.ts`).
 */
import { buildPalette, type BrandPalette } from "../../shared/brandColors";
import { isLegalPlaceholder, isContactPageSlug, legalKindOfUrl } from "../../shared/tenantNav";
import { localizedPath, SINGLE_LANGUAGE_CONFIG, type I18nConfig } from "../../shared/i18n";
import { safeImageUrl } from "../_core/theme";
import { createTenantCache } from "../i18nCache";
import type { TenantLegalIdentity } from "./tenantLegal";

export interface TenantVisualKit {
  brandName: string;
  /** URL absoluta y segura (https o ruta propia resuelta sobre la URL pública), o null si no hay logotipo. */
  logoUrl: string | null;
  colors: BrandPalette;
  fonts: {
    /** Serif segura en todos los clientes de correo. */
    heading: string;
    /** La tipografía de la empresa (si la tiene) delante de una pila segura. */
    body: string;
  };
  legal: TenantLegalIdentity;
  links: {
    /** Portada de la web en ese idioma. */
    site(locale: string): string;
    privacy(locale: string): string | null;
    contact(locale: string): string | null;
    imprint(locale: string): string | null;
  };
}

export const HEADING_FONT = "Georgia, 'Times New Roman', Times, serif";
const BODY_FALLBACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_RE = /^[A-Za-z0-9 ,'"._-]{1,120}$/;

/** Pila de cuerpo: la tipografía de la empresa, si es válida, delante de la pila segura. */
export function bodyFontStack(themeFont: string | null | undefined): string {
  const f = (themeFont ?? "").trim();
  if (!f || !FONT_RE.test(f)) return BODY_FALLBACK;
  const first = f.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  if (!first || /^(arial|helvetica|helvetica neue)$/i.test(first)) return BODY_FALLBACK;
  return `${/\s/.test(first) ? `'${first}'` : first}, ${BODY_FALLBACK}`;
}

/** Logotipo absoluto: https tal cual; ruta propia («/files/…») sobre la URL pública; sin URL pública, ninguno. */
export function absoluteLogoUrl(raw: string | null | undefined, baseUrl: string): string | null {
  const safe = safeImageUrl(raw);
  if (!safe) return null;
  if (!safe.startsWith("/")) return safe;
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? `${base}${safe}` : null;
}

export interface KitPages {
  privacy?: string | null;
  contact?: string | null;
  imprint?: string | null;
}

/**
 * Kit sin base de datos: nombre, línea legal y, opcionalmente, colores, logotipo y enlaces ya resueltos. Con solo
 * nombre y línea legal, colores neutros cálidos y sin logotipo.
 */
export function minimalKit(input: {
  brand: string;
  legalLine: string;
  legal?: Partial<TenantLegalIdentity>;
  siteUrl?: string;
  logoUrl?: string | null;
  colors?: { primary?: string | null; accent?: string | null; ink?: string | null };
  font?: string | null;
  /** Rutas (o URLs) por idioma ya resueltas: `{ es: { privacy: "/es/politica-de-privacidad" } }`. */
  pages?: Record<string, KitPages>;
  /** Portada por idioma distinta de `siteUrl` (p. ej. `/es`). */
  sitePaths?: Record<string, string>;
}): TenantVisualKit {
  const base = (input.siteUrl ?? "").replace(/\/+$/, "");
  const abs = (p: string | null | undefined) => (p ? (/^https?:\/\//.test(p) ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`) : null);
  const lang = (l: string) => l.trim().toLowerCase().slice(0, 2);
  const pageOf = (l: string, k: keyof KitPages) => abs(input.pages?.[lang(l)]?.[k] ?? input.pages?.["*"]?.[k] ?? null);
  return {
    brandName: input.brand,
    logoUrl: absoluteLogoUrl(input.logoUrl, base),
    colors: buildPalette(input.colors ?? {}),
    fonts: { heading: HEADING_FONT, body: bodyFontStack(input.font) },
    legal: { ...input.legal, line: input.legalLine, name: input.legal?.name || input.brand },
    links: {
      site: (l) => abs(input.sitePaths?.[lang(l)] ?? "/") ?? base,
      privacy: (l) => pageOf(l, "privacy"),
      contact: (l) => pageOf(l, "contact"),
      imprint: (l) => pageOf(l, "imprint"),
    },
  };
}

// ── Carga real (base de datos de la empresa en curso) ──

const cache = createTenantCache<TenantVisualKit>(60_000);

export function invalidateTenantVisualKit(key?: string) {
  if (key) cache.invalidate(key);
  else cache.clear();
}

type PageRow = { id: number; slug: string; content: string | null; isPublished: boolean | null };

/** Qué papel juega una página publicada en el pie (privacidad, aviso legal o contacto), o null. */
export function pageRole(slug: string): keyof KitPages | null {
  const kind = legalKindOfUrl(`/${slug}`);
  if (kind === "privacidad") return "privacy";
  if (kind === "aviso") return "imprint";
  if (isContactPageSlug(slug)) return "contact";
  return null;
}

/**
 * Rutas de privacidad, aviso legal y contacto por idioma a partir de las páginas publicadas y sus traducciones
 * validadas: el idioma principal usa el slug principal; otro idioma, su slug traducido validado con prefijo; sin
 * traducción, la ruta principal (existe y se sirve). Pura: recibe las filas ya leídas.
 */
export function resolveKitPages(
  pages: PageRow[],
  cfg: I18nConfig,
  translated: (pageId: number, locale: string) => string | null,
): { byLocale: Record<string, KitPages>; sitePaths: Record<string, string> } {
  const published = pages.filter((p) => !!p.isPublished && !isLegalPlaceholder(p.slug, p.content));
  const principal: Partial<Record<keyof KitPages, PageRow>> = {};
  for (const p of published) {
    const role = pageRole(p.slug);
    if (role && !principal[role]) principal[role] = p;
  }
  const locales = cfg.locales.length ? cfg.locales.filter((l) => l.isDefault || l.status === "validated").map((l) => l.locale) : [cfg.defaultLocale];
  const byLocale: Record<string, KitPages> = {};
  const sitePaths: Record<string, string> = {};
  for (const locale of locales) {
    sitePaths[locale] = localizedPath("/", locale, cfg);
    const out: KitPages = {};
    for (const role of ["privacy", "contact", "imprint"] as const) {
      const p = principal[role];
      if (!p) continue;
      const main = `/${p.slug}`;
      if (locale === cfg.defaultLocale) out[role] = localizedPath(main, locale, cfg);
      else {
        const t = translated(p.id, locale);
        out[role] = t ? localizedPath(`/${t}`, locale, cfg) : main;
      }
    }
    byLocale[locale] = out;
  }
  byLocale["*"] = byLocale[cfg.defaultLocale] ?? {};
  return { byLocale, sitePaths };
}

async function loadKit(): Promise<TenantVisualKit> {
  const [{ getSystemSetting }, { brandName }, { tenantLegalIdentity }, { publicBaseUrl }] = await Promise.all([
    import("../config"),
    import("../tenantBrand"),
    import("./tenantLegal"),
    import("../_core/productIdentity"),
  ]);
  const setting = async (...keys: string[]) => {
    for (const k of keys) {
      const v = (await getSystemSetting(k, "").catch(() => "")).trim();
      if (v) return v;
    }
    return "";
  };
  let brand = "";
  try {
    brand = brandName();
  } catch {
    brand = "";
  }
  const legal = tenantLegalIdentity();
  const siteUrl = publicBaseUrl();
  const [logo, primary, accent, ink, font] = await Promise.all([
    setting("brand_logo_url"),
    setting("theme_primary_color", "brand_primary_color"),
    setting("theme_accent_color", "brand_accent_color"),
    setting("theme_text_color"),
    setting("theme_font_family"),
  ]);

  // Páginas publicadas y multidioma: cualquier fallo deja el kit sin enlaces de pie (nunca sin kit)
  let pages: Record<string, KitPages> = {};
  let sitePaths: Record<string, string> = {};
  try {
    const [{ getAllPages }, { sqlI18nRepo }, { getI18nConfig }] = await Promise.all([import("../db"), import("../i18nSqlRepo"), import("../i18nService")]);
    const repo = sqlI18nRepo();
    const [rows, cfg] = await Promise.all([getAllPages(), getI18nConfig(repo).catch(() => SINGLE_LANGUAGE_CONFIG)]);
    const extra = cfg.locales.filter((l) => !l.isDefault && l.status === "validated").map((l) => l.locale);
    const slugs = new Map<string, string>();
    for (const locale of extra) {
      const tr = await repo.listPageTranslations({ locale, onlyValidated: true }).catch(() => []);
      for (const t of tr) if (t.publishedSlug) slugs.set(`${t.pageId}:${locale}`, t.publishedSlug);
    }
    const r = resolveKitPages(
      rows.map((p) => ({ id: Number(p.id), slug: String(p.slug), content: (p.content as string | null) ?? null, isPublished: !!p.isPublished })),
      cfg,
      (id, locale) => slugs.get(`${id}:${locale}`) ?? null,
    );
    pages = r.byLocale;
    sitePaths = r.sitePaths;
  } catch (e) {
    console.warn(JSON.stringify({ ctx: "TenantVisualKit", event: "pages_unavailable", error: e instanceof Error ? e.message.slice(0, 160) : "error" }));
  }

  return minimalKit({ brand: brand || legal.name || "", legalLine: legal.line, legal, siteUrl, logoUrl: logo || null, colors: { primary, accent, ink }, font, pages, sitePaths });
}

/** Kit de la empresa en curso (caché de 60 s por empresa). */
export async function tenantVisualKit(): Promise<TenantVisualKit> {
  const { peekTenantContext } = await import("../_core/tenant");
  const key = peekTenantContext()?.tenantId ?? "single";
  return cache.get(key, loadKit);
}
