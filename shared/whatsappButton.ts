/**
 * Botón flotante de WhatsApp de la web pública (lógica pura: la usan el cliente, el servidor y las pruebas).
 *
 *  - single (Náyade, `neutralSite` falso): el número y el texto de siempre, sin cambios.
 *  - multi: el WhatsApp que la empresa configuró expresamente (`brand_whatsapp` → `public.getTheme` →
 *    `contact.whatsapp`), en formato internacional. Nunca su teléfono fijo ni el número de otra empresa: sin un
 *    WhatsApp válido no hay botón.
 *  - Sin tema (cargando o error): sin botón, para no mostrar un número que quizá no sea el suyo.
 */

export const LEGACY_WHATSAPP_PHONE = "34639576627";
export const LEGACY_WHATSAPP_URL =
  "https://wa.me/34639576627?text=Hola%20Nayade%20Experiences%2C%20me%20gustar%C3%ADa%20recibir%20informaci%C3%B3n";

/**
 * Número de WhatsApp en formato internacional (solo cifras, como lo pide wa.me) o null si no sirve:
 *  - Con prefijo (`+` o `00`): de 8 a 15 cifras. Si es de España (34), tiene que ser un móvil (6 o 7).
 *  - Sin prefijo: solo un móvil español de 9 cifras (6 o 7), al que se añade el 34; o el mismo con el 34 delante.
 *  - Un fijo (9 u 8), un número corto o cualquier otra cosa: null (en wa.me sería un enlace roto).
 */
export function normalizeWhatsapp(v: string | undefined | null): string | null {
  const raw = (v ?? "").trim();
  if (!raw || /[^\d\s().+-]/.test(raw)) return null;
  const international = /^(\+|00)/.test(raw);
  const digits = raw.replace(/^\+/, "").replace(/[\s().-]/g, "").replace(/^00/, "");
  if (!/^\d+$/.test(digits)) return null;
  const spanishMobile = /^34[67]\d{8}$/;
  if (international) {
    if (digits.startsWith("34")) return spanishMobile.test(digits) ? digits : null;
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }
  if (/^[67]\d{8}$/.test(digits)) return `34${digits}`;
  return spanishMobile.test(digits) ? digits : null;
}

/**
 * Configuración del botón por empresa (17/11/2026), en el ajuste `whatsapp_button` (JSON). El número es el WhatsApp de
 * la empresa (`brand_whatsapp`, el mismo de «Primeros pasos»). Sin ajuste: activo si hay número, a la derecha y con el
 * texto de siempre (como hasta ahora).
 */
export const WHATSAPP_BUTTON_SETTING = "whatsapp_button";
export const WHATSAPP_POSITIONS = ["right", "left"] as const;
export type WhatsappPosition = (typeof WHATSAPP_POSITIONS)[number];
export const WHATSAPP_MESSAGE_MAX = 300;
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
export interface WhatsappButtonConfig {
  enabled: boolean;
  position: WhatsappPosition;
  /** Mensaje inicial por idioma de la página (código: `es`, `de`…); el visitante decide si lo envía. */
  messages: Record<string, string>;
}
export const DEFAULT_WHATSAPP_BUTTON: WhatsappButtonConfig = { enabled: true, position: "right", messages: {} };

/** Lectura defensiva del ajuste (dato guardado: nunca se confía en su forma). */
export function parseWhatsappButtonConfig(raw: string | null | undefined): WhatsappButtonConfig {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  if (!v || typeof v !== "object") return { ...DEFAULT_WHATSAPP_BUTTON, messages: {} };
  const o = v as { enabled?: unknown; position?: unknown; messages?: unknown };
  const messages: Record<string, string> = {};
  if (o.messages && typeof o.messages === "object") {
    for (const [k, m] of Object.entries(o.messages as Record<string, unknown>)) {
      const key = k.trim().toLowerCase();
      if (LOCALE_RE.test(key) && typeof m === "string" && m.trim()) messages[key] = m.trim().slice(0, WHATSAPP_MESSAGE_MAX);
    }
  }
  return {
    enabled: o.enabled !== false,
    position: (WHATSAPP_POSITIONS as readonly unknown[]).includes(o.position) ? (o.position as WhatsappPosition) : "right",
    messages,
  };
}

/**
 * Número para wa.me desde el valor del tema: el servidor ya lo entrega normalizado (solo cifras con prefijo, sin «+»).
 * Antes se volvía a normalizar como si fuera un número sin prefijo y cualquier WhatsApp de fuera de España se perdía.
 */
function themeWhatsapp(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return normalizeWhatsapp(s) ?? (/^[1-9]\d{7,14}$/.test(s) ? normalizeWhatsapp(`+${s}`) : null);
}

export interface WhatsappThemeInput {
  neutralSite: boolean;
  brandName: string | null;
  contact: { whatsapp?: string | null };
  whatsappButton?: WhatsappButtonConfig | null;
}

/** Mensaje inicial del idioma de la página (o del idioma base, `de-at` → `de`); null si no hay ninguno configurado. */
export function whatsappMessageFor(config: Pick<WhatsappButtonConfig, "messages"> | null | undefined, locale: string | null | undefined): string | null {
  const m = config?.messages ?? {};
  const l = (locale ?? "").toLowerCase();
  return m[l] ?? m[l.split("-")[0]] ?? null;
}

export function whatsappTarget(theme: WhatsappThemeInput | null | undefined, locale?: string | null): { phone: string; url: string; position: WhatsappPosition } | null {
  if (!theme) return null;
  if (!theme.neutralSite) return { phone: LEGACY_WHATSAPP_PHONE, url: LEGACY_WHATSAPP_URL, position: "right" };
  const config = theme.whatsappButton ?? DEFAULT_WHATSAPP_BUTTON;
  if (!config.enabled) return null;
  const phone = themeWhatsapp(theme.contact.whatsapp);
  if (!phone) return null;
  const name = (theme.brandName ?? "").trim();
  const text = whatsappMessageFor(config, locale) ?? (name ? `Hola ${name}, me gustaría recibir información` : "Hola, me gustaría recibir información");
  return { phone, url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, position: config.position };
}

/** Etiqueta accesible (lectores de pantalla y título) en el idioma de la página; español si no hay traducción. */
const WHATSAPP_LABELS: Record<string, string> = {
  es: "Contactar por WhatsApp",
  de: "Über WhatsApp kontaktieren",
  en: "Contact us on WhatsApp",
  fr: "Nous contacter sur WhatsApp",
  it: "Contattaci su WhatsApp",
  pt: "Contactar por WhatsApp",
  ca: "Contacta per WhatsApp",
};
export function whatsappLabel(locale: string | null | undefined): string {
  const l = (locale ?? "").toLowerCase();
  return WHATSAPP_LABELS[l] ?? WHATSAPP_LABELS[l.split("-")[0]] ?? WHATSAPP_LABELS.es;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** ¿Se pisan dos rectángulos (con `gap` píxeles de margen)? */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

/**
 * En móvil el botón flotante no puede tapar lo que se marca con `data-whatsapp-avoid` (precio, opciones y botón de
 * compra de la ficha de producto): se oculta mientras se pisan. Mientras el carrito está abierto se oculta siempre.
 */
export const WHATSAPP_AVOID_ATTR = "data-whatsapp-avoid";
/** También se aparta, en móvil, de los botones de envío y campos de los formularios. */
export const WHATSAPP_AVOID_SELECTOR = `[${WHATSAPP_AVOID_ATTR}], form button[type="submit"], form input:not([type="hidden"]), form textarea, form select`;
export const WHATSAPP_MOBILE_MAX = 767;
export function whatsappHidden(button: Box, avoid: Box[], viewportWidth: number, cartOpen = false): boolean {
  // Con el carrito abierto, a cualquier anchura: no tapa su pie ni «Finalizar compra»
  if (cartOpen) return true;
  if (viewportWidth > WHATSAPP_MOBILE_MAX) return false;
  return avoid.some((b) => boxesOverlap(button, b, 8));
}
