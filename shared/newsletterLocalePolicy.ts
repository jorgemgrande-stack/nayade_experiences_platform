/**
 * Newsletter · política de idioma del alta (pura, sin servidor ni base de datos).
 *
 * El idioma de un suscriptor es el de la WEB desde la que se inscribe, nunca el país ni la IP del visitante. Prioridad:
 *  1. `path`    el prefijo de idioma de la ruta de la página (`/es/...`) si es un idioma público de la empresa;
 *  2. `block`   el idioma de la traducción validada del bloque que se sirvió (la página localizada sin prefijo propio);
 *  3. `hint`    el idioma que declara el formulario, solo si es público (un valor manipulado no cuela otro idioma);
 *  4. `default` el idioma principal de la empresa.
 *
 * Una lista (segmento) por idioma público: `newsletter-<idioma>` («Newsletter Alemán» = newsletter-de).
 */
import { normalizeLocale } from "./i18n";

export type LocaleBasis = "path" | "block" | "hint" | "default";
export type LocaleSource = "web" | "subscriber" | "admin" | "import";
export const LOCALE_SOURCES: readonly LocaleSource[] = ["web", "subscriber", "admin", "import"];

export interface SignupLocaleInput {
  /** Ruta de la página donde estaba el formulario (`/es/inicio`, `/`). */
  pagePath?: string | null;
  /** Idioma de la traducción del bloque publicado que se sirvió, si la hubo. */
  blockLocale?: string | null;
  /** Idioma declarado por el formulario (useSiteLocale). Solo pista. */
  hint?: unknown;
  /** Idiomas públicos de la empresa (principal incluido). */
  tenantLocales: readonly string[];
  defaultLocale: string;
}

/** Prefijo de idioma de una ruta (`/es/x` → `es`; `/` → null). No comprueba que sea un idioma público. */
export function pathLocale(pagePath: string | null | undefined): string | null {
  if (typeof pagePath !== "string") return null;
  const m = /^\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2})(?:\/|$|\?|#)/.exec(pagePath.trim());
  return m ? normalizeLocale(m[1]) : null;
}

export function resolveSignupLocale(i: SignupLocaleInput): { locale: string; basis: LocaleBasis } {
  const allowed = new Set(i.tenantLocales.map((l) => normalizeLocale(l)).filter((l): l is string => !!l));
  const def = normalizeLocale(i.defaultLocale) ?? "es";
  allowed.add(def);
  const ok = (raw: unknown): string | null => {
    const l = normalizeLocale(raw);
    return l && allowed.has(l) ? l : null;
  };
  const fromPath = ok(pathLocale(i.pagePath));
  if (fromPath) return { locale: fromPath, basis: "path" };
  const fromBlock = ok(i.blockLocale);
  if (fromBlock) return { locale: fromBlock, basis: "block" };
  const fromHint = ok(i.hint);
  if (fromHint) return { locale: fromHint, basis: "hint" };
  return { locale: def, basis: "default" };
}

/** Identificador de la lista de un idioma. */
export const segmentIdFor = (locale: string) => `newsletter-${locale}`;
/** Idioma de un identificador de lista (`newsletter-de` → `de`), o null si no es una lista. */
export function localeOfSegment(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const m = /^newsletter-([a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2})$/.exec(id.trim().toLowerCase());
  return m ? normalizeLocale(m[1]) : null;
}

/** Nombre de la lista en el idioma del panel («Newsletter Alemán», «Newsletter Deutsch»). */
export function listLabel(locale: string, uiLocale: "es" | "de"): string {
  let name = locale;
  try {
    const n = new Intl.DisplayNames([uiLocale], { type: "language" }).of(locale);
    if (n) name = n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    name = locale;
  }
  return `Newsletter ${name}`;
}

/** Unión ordenada de los idiomas públicos de la empresa y los que ya hay en la tabla (el principal primero). */
export function listLocales(tenantLocales: readonly string[], present: readonly string[], defaultLocale: string): string[] {
  const out: string[] = [];
  for (const raw of [defaultLocale, ...tenantLocales, ...present]) {
    const l = normalizeLocale(raw);
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}
