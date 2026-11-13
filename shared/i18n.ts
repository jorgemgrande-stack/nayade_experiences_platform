/**
 * Multidioma nativo de Elephant Studio (épica E-1, ver docs/architecture/studio-multidioma.md).
 *
 * Solo reglas puras, sin servidor ni base de datos: códigos de idioma, configuración, lectura y construcción de URLs
 * localizadas, decisión de qué se sirve (traducción, fallback o 404), `hreflang`/`canonical` y detección de campos sin
 * traducir. Lo comparten el servidor (HTML con SEO, sitemap, API) y el cliente (selector, enlaces).
 *
 * Invariante: una empresa sin idiomas adicionales (`isMultilingual` falso) lo recibe todo como hoy.
 */
import { walk } from "./studio/tree";
import type { PageBlock } from "./pageBlocks";

export const DEFAULT_LOCALE = "es";
export const MAX_LOCALES = 12;

export type TranslationStatus = "draft" | "validated";
export type FallbackMode = "hide" | "default";

/** Código BCP 47 sencillo en minúsculas: `es`, `de`, `pt-br`, `zh-hans`. */
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

/** Normaliza un código (recorta, minúsculas, `_` → `-`). Devuelve null si no es un código válido. */
export function normalizeLocale(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  return v.length <= 35 && LOCALE_RE.test(v) ? v : null;
}

export interface LocaleEntry {
  locale: string;
  isDefault: boolean;
  status: TranslationStatus;
  sortOrder: number;
}

export interface I18nConfig {
  defaultLocale: string;
  /** Todos los idiomas de la empresa, el principal incluido. Vacío = solo el principal implícito. */
  locales: LocaleEntry[];
  /** El idioma principal también lleva prefijo (`/es/…`). Por defecto no: las URLs actuales no cambian. */
  defaultPrefix: boolean;
  fallback: FallbackMode;
  negotiate: boolean;
}

export const SINGLE_LANGUAGE_CONFIG: I18nConfig = {
  defaultLocale: DEFAULT_LOCALE,
  locales: [],
  defaultPrefix: false,
  fallback: "hide",
  negotiate: false,
};

/** Construye la configuración a partir de las filas y los ajustes (valores desconocidos caen al defecto seguro). */
export function buildConfig(rows: LocaleEntry[], settings: { defaultPrefix?: string | null; fallback?: string | null; negotiate?: string | null } = {}): I18nConfig {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.locale.localeCompare(b.locale));
  const def = sorted.find((r) => r.isDefault)?.locale ?? DEFAULT_LOCALE;
  return {
    defaultLocale: def,
    locales: sorted,
    defaultPrefix: settings.defaultPrefix === "1",
    fallback: settings.fallback === "default" ? "default" : "hide",
    negotiate: settings.negotiate === "1",
  };
}

/** Hay algún idioma adicional dado de alta (aunque aún no validado). Sin él, nada cambia respecto a hoy. */
export function isMultilingual(cfg: I18nConfig): boolean {
  return cfg.locales.some((l) => !l.isDefault);
}

/** Idiomas visibles en la web pública: el principal y los adicionales validados. */
export function publicLocales(cfg: I18nConfig): string[] {
  if (!isMultilingual(cfg)) return [cfg.defaultLocale];
  return cfg.locales.filter((l) => l.isDefault || l.status === "validated").map((l) => l.locale);
}

export function isConfiguredLocale(cfg: I18nConfig, locale: string): boolean {
  return cfg.locales.some((l) => l.locale === locale);
}

/** Rutas que nunca se localizan (áreas privadas, sistema y recursos). */
const NON_LOCALIZED = [
  "/admin", "/api", "/empleado", "/partner", "/supplier", "/gestoria", "/login", "/recuperar-contrasena",
  "/nueva-contrasena", "/establecer-contrasena", "/checkout", "/reserva", "/assets", "/uploads",
  "/sitemap.xml", "/robots.txt", "/version.txt", "/readyz", "/healthz",
];

export function isLocalizablePath(path: string): boolean {
  return !NON_LOCALIZED.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Ruta sin parámetros, sin barra final y siempre con `/` inicial. */
export function cleanPath(raw: string): string {
  return ("/" + (raw.split(/[?#]/)[0] || "").replace(/^\/+/, "")).replace(/\/+$/, "") || "/";
}

export interface ParsedPath {
  /** Idioma al que pertenece la ruta (el principal si no lleva prefijo). */
  locale: string;
  /** Ruta sin el prefijo de idioma, siempre con `/` inicial. */
  rest: string;
  /** La ruta llevaba el prefijo de un idioma configurado. */
  prefixed: boolean;
  /** Redirección 301 a la URL canónica (prefijo del principal sobrante, o que falta). */
  redirectTo?: string;
}

/**
 * Lee el idioma de una ruta. Solo se reconoce el prefijo de un idioma CONFIGURADO de la empresa: si no, la ruta se
 * trata como siempre (`/de/x` sin alemán es lo que ya era). Sin idiomas adicionales, devuelve la ruta tal cual.
 */
export function parseLocalizedPath(pathname: string, cfg: I18nConfig): ParsedPath {
  const path = cleanPath(pathname);
  const plain: ParsedPath = { locale: cfg.defaultLocale, rest: path, prefixed: false };
  if (!isMultilingual(cfg) || !isLocalizablePath(path)) return plain;
  const m = /^\/([^/]+)(\/.*)?$/.exec(path);
  const seg = m ? normalizeLocale(m[1]) : null;
  if (m && seg && m[1] === seg && isConfiguredLocale(cfg, seg)) {
    const rest = m[2] || "/";
    if (seg === cfg.defaultLocale && !cfg.defaultPrefix) return { locale: seg, rest, prefixed: true, redirectTo: rest };
    return { locale: seg, rest, prefixed: true };
  }
  if (cfg.defaultPrefix) return { ...plain, redirectTo: localizedPath(path, cfg.defaultLocale, cfg) };
  return plain;
}

/** URL (ruta) de `rest` en un idioma: el principal sin prefijo salvo `defaultPrefix`. */
export function localizedPath(rest: string, locale: string, cfg: I18nConfig): string {
  const r = cleanPath(rest);
  if (locale === cfg.defaultLocale && !cfg.defaultPrefix) return r;
  return `/${locale}${r === "/" ? "" : r}`;
}

// ─── Qué se sirve ─────────────────────────────────────────────────────────────

export type ServeDecision =
  | { kind: "principal" }
  | { kind: "translated"; locale: string }
  /** Se muestra el contenido del principal en una URL de otro idioma (solo con `fallback = default`). */
  | { kind: "fallback"; requested: string; contentLocale: string }
  | { kind: "notFound" };

/**
 * Decide qué se sirve en una URL localizada. Dos candados: el idioma debe estar validado y la traducción de esa página
 * también. Sin traducción validada: `hide` → 404; `default` → el principal, declarado como tal.
 */
export function decideServing(input: {
  cfg: I18nConfig;
  locale: string;
  /** Existe la página en el idioma principal. */
  principalExists: boolean;
  /** Hay traducción validada de esta página en `locale`. */
  translationValidated: boolean;
}): ServeDecision {
  const { cfg, locale } = input;
  if (locale === cfg.defaultLocale) return input.principalExists ? { kind: "principal" } : { kind: "notFound" };
  const entry = cfg.locales.find((l) => l.locale === locale);
  // Idioma inexistente o sin validar: nunca es público
  if (!entry || entry.status !== "validated") return { kind: "notFound" };
  if (input.translationValidated) return { kind: "translated", locale };
  if (cfg.fallback === "default" && input.principalExists) return { kind: "fallback", requested: locale, contentLocale: cfg.defaultLocale };
  return { kind: "notFound" };
}

// ─── hreflang, canonical, lang ────────────────────────────────────────────────

export interface PageVersion {
  locale: string;
  /** Ruta sin prefijo de idioma (con el slug de ESE idioma). */
  rest: string;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

/**
 * Alternativas `hreflang` de una página: una por cada versión VALIDADA (la del principal y las traducidas), más
 * `x-default` hacia la del principal. `versions` solo debe contener versiones públicas; aquí se vuelve a filtrar por
 * idioma validado. Sin versión adicional no se emite nada (la página no tiene alternativas que declarar).
 */
export function buildAlternates(cfg: I18nConfig, origin: string, versions: PageVersion[]): Alternate[] {
  const pub = new Set(publicLocales(cfg));
  const seen = new Set<string>();
  const list = versions.filter((v) => pub.has(v.locale) && !seen.has(v.locale) && !!seen.add(v.locale));
  if (list.length < 2) return [];
  const base = origin.replace(/\/+$/, "");
  const out: Alternate[] = list.map((v) => ({ hreflang: v.locale, href: base + localizedPath(v.rest, v.locale, cfg) }));
  const principal = list.find((v) => v.locale === cfg.defaultLocale);
  if (principal) out.push({ hreflang: "x-default", href: base + localizedPath(principal.rest, principal.locale, cfg) });
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Etiquetas `<link rel="alternate" hreflang>` listas para el `<head>` (valores escapados). */
export function alternateLinksHtml(alts: Alternate[]): string {
  return alts.map((a) => `<link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}" />`).join("\n    ");
}

/** Valor de `og:locale` (`de` → `de`, `pt-br` → `pt_BR`). */
export function ogLocale(locale: string): string {
  const [lang, region] = locale.split("-");
  return region && region.length === 2 ? `${lang}_${region.toUpperCase()}` : lang;
}

export interface LocaleSeo {
  /** Idioma del contenido que se muestra (el del principal en el fallback). */
  htmlLang: string;
  canonical: string;
  noindex: boolean;
  alternates: Alternate[];
}

/** SEO de una respuesta localizada. En el fallback, `canonical` apunta al original y la página no se indexa. */
export function localeSeo(input: { cfg: I18nConfig; origin: string; decision: ServeDecision; locale: string; rest: string; principalRest: string; versions: PageVersion[] }): LocaleSeo {
  const { cfg, decision } = input;
  const base = input.origin.replace(/\/+$/, "");
  if (decision.kind === "fallback") {
    return { htmlLang: decision.contentLocale, canonical: base + localizedPath(input.principalRest, decision.contentLocale, cfg), noindex: true, alternates: [] };
  }
  const locale = decision.kind === "translated" ? decision.locale : cfg.defaultLocale;
  const rest = decision.kind === "translated" ? input.rest : input.principalRest;
  return { htmlLang: locale, canonical: base + localizedPath(rest, locale, cfg), noindex: false, alternates: buildAlternates(cfg, input.origin, input.versions) };
}

// ─── Campos sin traducir ──────────────────────────────────────────────────────

/** Claves de datos que no son texto para traducir (enlaces, medios, diseño, enumeraciones). */
const NON_TEXT_KEY = /(^|_)(id|url|href|src|link|icon|color|colour|bg|align|font|size|width|height|layout|variant|kind|role|type|columns|limit|autoplay|interval|transition|overlay|level|position|lightbox|arrows|dots|required|showif|showvalue|value|slug|categoryslug)$|url$|^_/i;

export interface UntranslatedField {
  blockId: string;
  blockType: string;
  field: string;
}

/**
 * Campos de texto de la traducción que siguen IGUAL que en el principal (o vacíos mientras el principal los tiene):
 * indicador de «sin traducir». Es orientativo: un nombre propio idéntico en todos los idiomas aparecerá aquí y la
 * persona lo da por bueno al validar. No traduce nada.
 */
export function untranslatedFields(principal: PageBlock[], translated: PageBlock[]): UntranslatedField[] {
  const base = new Map<string, PageBlock>();
  walk(principal, ({ block }) => base.set(block.id, block));
  const out: UntranslatedField[] = [];
  const isText = (key: string, v: string) => !NON_TEXT_KEY.test(key) && !/^(https?:|\/|#|mailto:|tel:)/i.test(v) && /[A-Za-z\u00C0-\uFFFF]/.test(v);
  const visit = (key: string, a: unknown, b: unknown, block: PageBlock, path: string) => {
    if (typeof b === "string" || typeof a === "string") {
      const av = typeof a === "string" ? a.trim() : "";
      const bv = typeof b === "string" ? b.trim() : "";
      if (av && isText(key, av) && (bv === "" || bv === av)) out.push({ blockId: block.id, blockType: block.type, field: path });
      return;
    }
    if (Array.isArray(a)) {
      a.forEach((item, i) => visit(key, item, Array.isArray(b) ? b[i] : undefined, block, `${path}[${i}]`));
      return;
    }
    if (a && typeof a === "object") {
      for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
        // Las columnas de una sección se recorren como bloques propios
        if (k === "blocks") continue;
        visit(k, v, (b as Record<string, unknown> | undefined)?.[k], block, `${path}.${k}`);
      }
    }
  };
  walk(translated, ({ block }) => {
    const orig = base.get(block.id);
    if (!orig || orig.type !== block.type) return;
    for (const [k, v] of Object.entries(orig.data as Record<string, unknown>)) {
      if (k === "columns" && orig.type === "section") continue;
      visit(k, v, (block.data as Record<string, unknown>)[k], block, k);
    }
  });
  return out;
}

/** Huella estable (FNV-1a de 64 bits en hex) del contenido del principal, para avisar de que ha cambiado. */
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ─── Slugs localizados ────────────────────────────────────────────────────────

const LOCALIZED_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slug localizado: minúsculas, números y guiones (sin acentos: la dirección debe ser estable y simple). */
export function normalizeLocalizedSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return v.length >= 1 && v.length <= 64 && LOCALIZED_SLUG_RE.test(v) ? v : null;
}

/** Slugs que no pueden ser el de una página traducida (colisionarían con rutas de la aplicación). */
export function isReservedSlug(slug: string): boolean {
  return !isLocalizablePath(`/${slug}`);
}

// ─── Campos de texto de un bloque (para la tabla de traducción) ───────────────

export interface TextField {
  blockId: string;
  blockType: string;
  /** Ruta dentro de `data`: `title`, `items[0].label`… */
  path: string;
  value: string;
  /** Texto largo (HTML o párrafo): se edita en un área de texto. */
  long: boolean;
}

function textLeaves(value: unknown, path: string, key: string, out: Array<{ path: string; key: string; value: string }>): void {
  if (typeof value === "string") {
    if (value.trim() && !NON_TEXT_KEY.test(key) && !/^(https?:|\/|#|mailto:|tel:)/i.test(value.trim()) && /[A-Za-z\u00C0-\uFFFF]/.test(value)) out.push({ path, key, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => textLeaves(v, `${path}[${i}]`, key, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Las columnas de una sección contienen bloques: se recorren como bloques propios
      if (k === "blocks") continue;
      textLeaves(v, path ? `${path}.${k}` : k, k, out);
    }
  }
}

/** Todos los textos traducibles de una lista de bloques (secciones incluidas), en el orden en que se ven. */
export function listTextFields(blocks: PageBlock[]): TextField[] {
  const out: TextField[] = [];
  walk(blocks, ({ block }) => {
    const leaves: Array<{ path: string; key: string; value: string }> = [];
    for (const [k, v] of Object.entries(block.data as Record<string, unknown>)) {
      if (k === "columns" && block.type === "section") continue;
      textLeaves(v, k, k, leaves);
    }
    for (const l of leaves) out.push({ blockId: block.id, blockType: block.type, path: l.path, value: l.value, long: l.value.length > 80 || /html|body|text|description|intro/i.test(l.key) });
  });
  return out;
}

const PATH_RE = /^[A-Za-z0-9_]+(\[\d+\])?(\.[A-Za-z0-9_]+(\[\d+\])?)*$/;

/** Cambia un texto de un bloque (por su ruta) sin mutar la lista. Rutas no válidas o inexistentes no hacen nada. */
export function setTextField(blocks: PageBlock[], blockId: string, path: string, value: string): PageBlock[] {
  if (!PATH_RE.test(path)) return blocks;
  const apply = (list: PageBlock[]): PageBlock[] =>
    list.map((b) => {
      let next = b;
      if (b.id === blockId) {
        const clone = JSON.parse(JSON.stringify(b.data)) as Record<string, unknown>;
        const parts = path.split(".").flatMap((seg) => {
          const m = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(seg);
          return m ? [m[1], ...Array.from(m[2].matchAll(/\[(\d+)\]/g)).map((x) => Number(x[1]))] : [];
        });
        let cur: unknown = clone;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          cur = typeof p === "number" ? (Array.isArray(cur) ? cur[p] : undefined) : cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
        }
        const last = parts[parts.length - 1];
        if (cur && typeof cur === "object" && last !== undefined && typeof (cur as Record<string | number, unknown>)[last] === "string") {
          (cur as Record<string | number, unknown>)[last] = value;
          next = { ...b, data: clone } as PageBlock;
        }
      }
      if (next.type === "section") {
        const cols = (next.data as { columns: Array<{ blocks: PageBlock[] }> }).columns.map((c) => ({ ...c, blocks: apply(c.blocks) }));
        next = { ...next, data: { ...next.data, columns: cols } } as PageBlock;
      }
      return next;
    });
  return apply(blocks);
}
