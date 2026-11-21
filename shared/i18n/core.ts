/**
 * Internacionalización de la interfaz del panel (Elephant Core). Lógica pura, sin React ni servidor: la usan el cliente,
 * las pruebas y cualquier módulo.
 *
 * Idioma de INTERFAZ ≠ idioma de CONTENIDO. Aquí solo se traduce la interfaz (menús, botones, etiquetas, avisos). Los datos
 * de la empresa (cursos, productos, páginas, documentos, mensajes de clientes) nunca pasan por este sistema.
 *
 * Contrato para cualquier módulo nuevo (ver docs/i18n/README.md):
 *  1. Los textos viven en `shared/i18n/locales/es/<espacio>.ts` (idioma principal, fuente de verdad) y
 *     `shared/i18n/locales/de/<espacio>.ts` (`satisfies Mirror<typeof es>`: si falta una clave, no compila).
 *  2. En los componentes: `const { t } = useI18n(); t("espacio.clave", { n })`.
 *  3. Fechas, números y monedas: `useFormat()`, nunca `toLocaleString("es-ES")` fijo.
 */

export const LOCALES = ["es", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

/** Etiqueta BCP-47 para `Intl` y nombre del idioma escrito en sí mismo (sin banderas). */
export const LOCALE_META: Record<Locale, { tag: string; autonym: string }> = {
  es: { tag: "es-ES", autonym: "Español" },
  de: { tag: "de-DE", autonym: "Deutsch" },
};

/** `es`, `es-ES`, `de-DE`, `DE`… → idioma admitido; cualquier otra cosa → null. */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

/**
 * Prioridad: preferencia guardada del usuario (servidor) > última elección en este navegador > idioma principal.
 * No se adivina por el idioma del navegador: cambiarlo es una elección explícita del usuario.
 */
export function resolveLocale(input: { saved?: unknown; stored?: unknown }): Locale {
  return normalizeLocale(input.saved) ?? normalizeLocale(input.stored) ?? DEFAULT_LOCALE;
}

// ── Diccionarios ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Messages = { [key: string]: string | Messages };

/** Espejo de un diccionario: mismas claves, valores de texto. Las traducciones lo usan con `satisfies`. */
export type Mirror<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends object ? Mirror<T[K]> : never };

/** Diccionarios por idioma y espacio de nombres: `{ es: { common: {...}, nav: {...} }, de: {...} }`. */
export type Catalog = Record<Locale, Record<string, Messages>>;

/** Aplana `{ a: { b: "x" } }` en `{ "a.b": "x" }`. */
export function flatten(messages: Messages, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(messages)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Diccionario plano de un idioma: las claves llevan el espacio de nombres delante (`common.save`). */
export function flattenCatalog(byNamespace: Record<string, Messages>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ns, messages] of Object.entries(byNamespace)) Object.assign(out, flatten(messages, ns));
  return out;
}

// ── Interpolación y plurales ────────────────────────────────────────────────────────────────────────────────────────
export type Params = Record<string, string | number | null | undefined>;

/**
 * Sintaxis (subconjunto de ICU):
 *   «Hola {name}»
 *   «{count, plural, =0 {Ningún cliente} one {# cliente} other {# clientes}}»   (`#` = el número)
 * Las categorías de plural las decide `Intl.PluralRules` del idioma.
 */
export function format(template: string, params: Params | undefined, locale: Locale): string {
  if (!template.includes("{")) return template;
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const end = matchingBrace(template, i);
    if (end < 0) {
      out += template.slice(i);
      break;
    }
    out += renderPlaceholder(template.slice(i + 1, end), params, locale);
    i = end + 1;
  }
  return out;
}

function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function renderPlaceholder(body: string, params: Params | undefined, locale: Locale): string {
  const comma = body.indexOf(",");
  if (comma < 0) {
    const v = params?.[body.trim()];
    return v === undefined || v === null ? `{${body}}` : String(v);
  }
  const name = body.slice(0, comma).trim();
  const rest = body.slice(comma + 1).trim();
  if (!rest.startsWith("plural")) return `{${body}}`;
  const n = Number(params?.[name]);
  if (!Number.isFinite(n)) return `{${body}}`;
  const forms = parsePluralForms(rest.slice("plural".length).replace(/^\s*,/, ""));
  const exact = forms[`=${n}`];
  const category = new Intl.PluralRules(LOCALE_META[locale].tag).select(n);
  const chosen = exact ?? forms[category] ?? forms.other ?? "";
  const shown = new Intl.NumberFormat(LOCALE_META[locale].tag).format(n);
  return format(chosen.replace(/#/g, shown), params, locale);
}

function parsePluralForms(s: string): Record<string, string> {
  const forms: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const start = i;
    while (i < s.length && !/[\s{]/.test(s[i])) i++;
    const selector = s.slice(start, i);
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== "{") break;
    const end = matchingBrace(s, i);
    if (end < 0) break;
    if (selector) forms[selector] = s.slice(i + 1, end);
    i = end + 1;
  }
  return forms;
}

/** Nombres de parámetros de una plantilla (para comprobar que la traducción conserva los mismos que el español). */
export function placeholderNames(template: string): string[] {
  const names = new Set<string>();
  const walk = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== "{") continue;
      const end = matchingBrace(s, i);
      if (end < 0) return;
      const body = s.slice(i + 1, end);
      const comma = body.indexOf(",");
      if (comma < 0) names.add(body.trim());
      else {
        names.add(body.slice(0, comma).trim());
        for (const f of Object.values(parsePluralForms(body.slice(comma + 1).trim().replace(/^plural\s*,?/, "")))) walk(f);
      }
      i = end;
    }
  };
  walk(template);
  return Array.from(names).sort();
}

// ── Traductor ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type Translate = (key: string, params?: Params) => string;

export interface Translator {
  locale: Locale;
  t: Translate;
  /** ¿existe la clave en el idioma actual (sin contar el respaldo)? */
  has: (key: string) => boolean;
}

/**
 * `flat` son los diccionarios planos por idioma. Ante una clave ausente en el idioma pedido se usa el español (respaldo);
 * si tampoco existe, se devuelve la propia clave y se avisa por `onMissing` (nunca revienta la pantalla).
 */
export function createTranslator(
  locale: Locale,
  flat: Record<Locale, Record<string, string>>,
  onMissing?: (key: string, locale: Locale) => void,
): Translator {
  const own = flat[locale] ?? {};
  const base = flat[DEFAULT_LOCALE] ?? {};
  return {
    locale,
    has: (key) => key in own,
    t: (key, params) => {
      let template = own[key];
      let used: Locale = locale;
      if (template === undefined) {
        template = base[key];
        used = DEFAULT_LOCALE;
        onMissing?.(key, locale);
      }
      if (template === undefined) return key;
      return format(template, params, used);
    },
  };
}

// ── Formatos locales ────────────────────────────────────────────────────────────────────────────────────────────────
type DateInput = Date | string | number | null | undefined;
const toDate = (d: DateInput): Date | null => {
  if (d === null || d === undefined || d === "") return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
};

export interface Formatters {
  /** 21/11/2026 · 21.11.2026 */
  date: (d: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  /** 21/11/2026, 21:53 · 21.11.2026, 21:53 */
  dateTime: (d: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  time: (d: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  number: (n: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  /** 1.234,50 € (moneda explícita; euro por defecto) */
  currency: (n: number | null | undefined, currency?: string, options?: Intl.NumberFormatOptions) => string;
  percent: (n: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  /** «hace 3 días» · «vor 3 Tagen» */
  relative: (d: DateInput, now?: Date) => string;
  /** Orden alfabético según el idioma (ä, ñ…). */
  collator: Intl.Collator;
}

const DASH = "—";

export function createFormatters(locale: Locale): Formatters {
  const tag = LOCALE_META[locale].tag;
  return {
    date: (d, o) => {
      const v = toDate(d);
      return v ? new Intl.DateTimeFormat(tag, o ?? { day: "2-digit", month: "2-digit", year: "numeric" }).format(v) : DASH;
    },
    dateTime: (d, o) => {
      const v = toDate(d);
      return v ? new Intl.DateTimeFormat(tag, o ?? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(v) : DASH;
    },
    time: (d, o) => {
      const v = toDate(d);
      return v ? new Intl.DateTimeFormat(tag, o ?? { hour: "2-digit", minute: "2-digit" }).format(v) : DASH;
    },
    number: (n, o) => (typeof n === "number" && Number.isFinite(n) ? new Intl.NumberFormat(tag, o).format(n) : DASH),
    currency: (n, currency = "EUR", o) =>
      typeof n === "number" && Number.isFinite(n) ? new Intl.NumberFormat(tag, { style: "currency", currency, ...o }).format(n) : DASH,
    percent: (n, o) => (typeof n === "number" && Number.isFinite(n) ? new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1, ...o }).format(n) : DASH),
    relative: (d, now = new Date()) => {
      const v = toDate(d);
      if (!v) return DASH;
      const diffSec = Math.round((v.getTime() - now.getTime()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
      for (const [unit, secs] of steps) if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
      return rtf.format(diffSec, "second");
    },
    collator: new Intl.Collator(tag, { sensitivity: "base", numeric: true }),
  };
}

// ── Carga de los diccionarios ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Agrupa los módulos `locales/<idioma>/<espacio>.ts` (por ruta) en un catálogo. Añadir un módulo nuevo es solo crear sus dos
 * ficheros: no hay lista central que editar (evita conflictos entre ramas).
 */
export function catalogFromModules(modules: Record<string, { default: Messages }>): Catalog {
  const catalog: Catalog = { es: {}, de: {} };
  for (const [path, mod] of Object.entries(modules)) {
    const m = /locales\/([a-z]{2})\/([^/]+)\.ts$/.exec(path.replace(/\\/g, "/"));
    const locale = m && normalizeLocale(m[1]);
    if (!m || !locale) continue;
    catalog[locale][m[2]] = mod.default;
  }
  return catalog;
}

export function flatCatalog(catalog: Catalog): Record<Locale, Record<string, string>> {
  return { es: flattenCatalog(catalog.es), de: flattenCatalog(catalog.de) };
}
