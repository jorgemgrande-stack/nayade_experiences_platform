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

export interface WhatsappThemeInput {
  neutralSite: boolean;
  brandName: string | null;
  contact: { whatsapp?: string | null };
}

export function whatsappTarget(theme: WhatsappThemeInput | null | undefined): { phone: string; url: string } | null {
  if (!theme) return null;
  if (!theme.neutralSite) return { phone: LEGACY_WHATSAPP_PHONE, url: LEGACY_WHATSAPP_URL };
  const phone = normalizeWhatsapp(theme.contact.whatsapp);
  if (!phone) return null;
  const name = (theme.brandName ?? "").trim();
  const text = name ? `Hola ${name}, me gustaría recibir información` : "Hola, me gustaría recibir información";
  return { phone, url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
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
export const WHATSAPP_MOBILE_MAX = 767;
export function whatsappHidden(button: Box, avoid: Box[], viewportWidth: number, cartOpen = false): boolean {
  // Con el carrito abierto, a cualquier anchura: no tapa su pie ni «Finalizar compra»
  if (cartOpen) return true;
  if (viewportWidth > WHATSAPP_MOBILE_MAX) return false;
  return avoid.some((b) => boxesOverlap(button, b, 8));
}
