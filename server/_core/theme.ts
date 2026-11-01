/**
 * Tematización por tenant: identidad corporativa pública (marca, logotipo, colores, fuente).
 *
 * - Todo valor sale de los ajustes del tenant y se SANEA: son texto editable por el cliente
 *   que acaba en CSS y en atributos del navegador.
 * - En `single` no se devuelve ninguna sustitución (el sitio actual no cambia) salvo que se
 *   hayan definido ajustes `theme_*` explícitamente.
 * - `neutralSite` (solo multi): la web pública usa el shell neutro del tenant (sus páginas y
 *   menús), no las páginas específicas de otra empresa.
 * - `poweredBy`: identificación discreta de Big Elephant como proveedor (activa por defecto
 *   en multi; el tenant no la oculta salvo plan que lo permita: `brand_show_powered_by`).
 * - `login`: pantalla de acceso de la empresa (fondo, titular y mensaje). Los mismos ajustes de marca alimentan
 *   la web y el acceso: el fondo, por defecto, es la imagen principal de la web (`brand_hero_image_url`);
 *   `login_background_url` lo sustituye por otra imagen o, con «none», lo retira.
 */
import { normalizeWhatsapp } from "../../shared/whatsappButton";

/** Ajustes que forman el tema público (lectura de `public.getTheme`). */
export const PUBLIC_THEME_KEYS = [
  "brand_name", "brand_logo_url", "brand_favicon_url", "theme_primary_color", "theme_accent_color",
  "brand_primary_color", "brand_accent_color", "theme_font_family", "theme_radius", "brand_show_powered_by",
  "brand_phone", "brand_whatsapp", "email_reservations", "site_business_email", "brand_location",
  "brand_hero_image_url", "login_background_url", "login_welcome_title", "login_welcome_message",
  "analytics_ga4_id", "analytics_meta_pixel_id",
] as const;

/** Valor de `login_background_url` que retira el fondo (sin imagen, ni siquiera la de la web). */
export const LOGIN_BACKGROUND_NONE = "none";
export const LOGIN_TITLE_MAX = 80;
export const LOGIN_MESSAGE_MAX = 240;

export interface PublicLoginTheme {
  /** Imagen de fondo del panel de marca, o null. */
  backgroundUrl: string | null;
  /** De dónde sale: la imagen principal de la web, una propia del acceso o ninguna. */
  backgroundSource: "web" | "custom" | "none";
  title: string | null;
  message: string | null;
}

export interface PublicTheme {
  brandName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  radius: string | null;
  neutralSite: boolean;
  poweredBy: { label: string; url: string } | null;
  contact: { phone: string | null; email: string | null; address: string | null; whatsapp: string | null };
  login: PublicLoginTheme;
  /** Analítica propia de la empresa (multiempresa). Sin identificador, desactivada: nunca la de otra cuenta. */
  analytics: { ga4Id: string | null; metaPixelId: string | null };
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FN_COLOR = /^(?:rgb|hsl|oklch)\(\s*[0-9.,%\s/deg-]+\)$/;
const FONT = /^[A-Za-z0-9 ,'"._-]{1,120}$/;
const RADIUS = /^\d{1,2}(?:\.\d{1,2})?(?:px|rem)$/;

export function safeColor(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return HEX.test(s) || FN_COLOR.test(s) ? s : null;
}

export function safeHttpUrl(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Número para el enlace de WhatsApp (wa.me): solo dígitos con prefijo internacional, sin «+» ni «00».
 * Un móvil español sin prefijo se completa con el 34; un fijo o un número no válido no se usa (mejor sin botón que
 * con un enlace roto). Reglas en `shared/whatsappButton.ts`.
 */
export function whatsappNumber(v: string | undefined | null): string | null {
  return normalizeWhatsapp(v);
}

/**
 * Imagen para la pantalla de acceso: solo https o una ruta propia («/files/…»). Nada de http, `data:`,
 * `javascript:` ni comillas o paréntesis (se usa en atributos; nunca en CSS).
 */
export function safeImageUrl(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s || s.length > 600 || /["'()<>\\\s]/.test(s)) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

const text = (v: string | undefined, max: number): string | null => {
  const s = (v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim();
  return s ? s.slice(0, max) : null;
};

/** Pantalla de acceso. En single solo con ajustes `login_*` explícitos (Náyade no cambia de fondo). */
function buildLogin(get: (key: string) => string | undefined, multi: boolean): PublicLoginTheme {
  const own = (get("login_background_url") ?? "").trim();
  let backgroundUrl: string | null = null;
  let backgroundSource: PublicLoginTheme["backgroundSource"] = "none";
  if (own === LOGIN_BACKGROUND_NONE) backgroundSource = "none";
  else if (own) {
    backgroundUrl = safeImageUrl(own);
    backgroundSource = backgroundUrl ? "custom" : "none";
  } else if (multi) {
    backgroundUrl = safeImageUrl(get("brand_hero_image_url"));
    backgroundSource = backgroundUrl ? "web" : "none";
  }
  return { backgroundUrl, backgroundSource, title: text(get("login_welcome_title"), LOGIN_TITLE_MAX), message: text(get("login_welcome_message"), LOGIN_MESSAGE_MAX) };
}

/** Ajustes de identidad que el administrador de la empresa edita (Marca y tema, y Primeros pasos › Marca). */
export const THEME_EDITABLE_KEYS = [
  "brand_name", "brand_logo_url", "brand_favicon_url", "theme_primary_color", "theme_accent_color",
  "theme_font_family", "theme_radius", "seo_description", "brand_phone", "brand_location", "email_reservations",
  "brand_hero_image_url", "login_background_url", "login_welcome_title", "login_welcome_message",
  "analytics_ga4_id", "analytics_meta_pixel_id",
] as const;

/** Ajustes de la pantalla de acceso que «Restaurar valores predeterminados» deja vacíos. */
export const LOGIN_DEFAULT_KEYS = ["login_background_url", "login_welcome_title", "login_welcome_message"] as const;

/** Identificadores públicos de analítica de la empresa (no son secretos: van en el HTML de su web). */
export const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
export const META_PIXEL_ID = /^\d{8,20}$/;
export const ga4Id = (v: string | undefined | null): string | null => {
  const s = (v ?? "").trim().toUpperCase();
  return GA4_ID.test(s) ? s : null;
};
export const metaPixelId = (v: string | undefined | null): string | null => {
  const s = (v ?? "").trim();
  return META_PIXEL_ID.test(s) ? s : null;
};

export class ThemeValueError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = "ThemeValueError";
  }
}

const IMAGE_KEYS = new Set(["brand_logo_url", "brand_favicon_url", "brand_hero_image_url"]);

/**
 * Valida y limpia lo que envía el administrador: claves fuera de la lista se ignoran; un valor no válido
 * lanza ThemeValueError (no se guarda nada a medias); vacío = volver al valor predeterminado.
 */
export function cleanThemeValues(values: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, raw] of Object.entries(values)) {
    if (!(THEME_EDITABLE_KEYS as readonly string[]).includes(k)) continue;
    const val = String(raw ?? "").trim();
    if (val === "") {
      clean[k] = "";
      continue;
    }
    if (k.endsWith("_color") && !safeColor(val)) throw new ThemeValueError(k, "Color no válido: usa un código como #1f3a5f");
    if (IMAGE_KEYS.has(k) && !safeImageUrl(val)) throw new ThemeValueError(k, "Imagen no válida: sube el fichero o usa una dirección https");
    if (k === "login_background_url" && val !== LOGIN_BACKGROUND_NONE && !safeImageUrl(val)) throw new ThemeValueError(k, "Imagen de fondo no válida: sube el fichero o usa una dirección https");
    if (k === "theme_radius" && !RADIUS.test(val)) throw new ThemeValueError(k, "Radio no válido");
    if (k === "theme_font_family" && !FONT.test(val)) throw new ThemeValueError(k, "Tipografía no válida");
    if (k === "analytics_ga4_id") {
      const id = val.toUpperCase();
      if (!GA4_ID.test(id)) throw new ThemeValueError(k, "Identificador no válido: usa el de tu propiedad de Google Analytics 4 (G-XXXXXXXXXX)");
      clean[k] = id;
      continue;
    }
    if (k === "analytics_meta_pixel_id" && !META_PIXEL_ID.test(val)) throw new ThemeValueError(k, "Identificador no válido: usa el número de tu pixel de Meta");
    if (k === "login_welcome_title" || k === "login_welcome_message") {
      const t = text(val, k === "login_welcome_title" ? LOGIN_TITLE_MAX : LOGIN_MESSAGE_MAX);
      if (!t || val.length > (k === "login_welcome_title" ? LOGIN_TITLE_MAX : LOGIN_MESSAGE_MAX) || /[<>]/.test(val)) throw new ThemeValueError(k, k === "login_welcome_title" ? `Titular no válido (máximo ${LOGIN_TITLE_MAX} caracteres, sin < ni >)` : `Mensaje no válido (máximo ${LOGIN_MESSAGE_MAX} caracteres, sin < ni >)`);
      clean[k] = t;
      continue;
    }
    clean[k] = val;
  }
  return clean;
}

export function buildTheme(
  get: (key: string) => string | undefined,
  opts: { multi: boolean },
): PublicTheme {
  const font = (get("theme_font_family") ?? "").trim();
  const radius = (get("theme_radius") ?? "").trim();
  const showPowered = get("brand_show_powered_by");
  const poweredOn = opts.multi ? showPowered !== "false" : showPowered === "true";
  return {
    brandName: text(get("brand_name"), 120),
    logoUrl: safeHttpUrl(get("brand_logo_url")),
    faviconUrl: safeHttpUrl(get("brand_favicon_url")),
    // En single solo cuentan los ajustes `theme_*` explícitos: `brand_*_color` ya existen en
    // instalaciones previas y no deben alterar su aspecto (p. ej. Náyade).
    primaryColor: safeColor(get("theme_primary_color") ?? (opts.multi ? get("brand_primary_color") : undefined)),
    accentColor: safeColor(get("theme_accent_color") ?? (opts.multi ? get("brand_accent_color") : undefined)),
    fontFamily: FONT.test(font) ? font : null,
    radius: RADIUS.test(radius) ? radius : null,
    neutralSite: opts.multi,
    poweredBy: poweredOn ? { label: "Plataforma Big Elephant", url: "https://bigelephant.es" } : null,
    contact: {
      phone: text(get("brand_phone"), 40),
      email: text(get("email_reservations") ?? get("site_business_email"), 160),
      address: text(get("brand_location"), 200),
      // WhatsApp de la empresa: solo el que configuró expresamente (nunca su teléfono de contacto, que puede ser fijo)
      whatsapp: whatsappNumber(get("brand_whatsapp")),
    },
    login: buildLogin(get, opts.multi),
    // Solo en multiempresa y solo con el identificador de la propia empresa
    analytics: {
      ga4Id: opts.multi ? ga4Id(get("analytics_ga4_id")) : null,
      metaPixelId: opts.multi ? metaPixelId(get("analytics_meta_pixel_id")) : null,
    },
  };
}

/** Color de texto legible (blanco/negro) sobre un fondo hexadecimal. */
export function contrastOn(hex: string | null): string | null {
  if (!hex || !HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? "#111111" : "#ffffff";
}
