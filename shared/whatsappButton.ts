/**
 * Botón flotante de WhatsApp de la web pública (lógica pura: la usan el cliente y las pruebas).
 *
 *  - single (Náyade, `neutralSite` falso): el número y el texto de siempre, sin cambios.
 *  - multi: el WhatsApp de la empresa que sirve la web (`public.getTheme` → `contact.whatsapp`). Sin
 *    número configurado no hay botón: nunca el de otra empresa.
 *  - Sin tema (cargando o error): sin botón, para no mostrar un número que quizá no sea el suyo.
 */

export const LEGACY_WHATSAPP_PHONE = "34639576627";
export const LEGACY_WHATSAPP_URL =
  "https://wa.me/34639576627?text=Hola%20Nayade%20Experiences%2C%20me%20gustar%C3%ADa%20recibir%20informaci%C3%B3n";

export interface WhatsappThemeInput {
  neutralSite: boolean;
  brandName: string | null;
  contact: { whatsapp?: string | null };
}

export function whatsappTarget(theme: WhatsappThemeInput | null | undefined): { phone: string; url: string } | null {
  if (!theme) return null;
  if (!theme.neutralSite) return { phone: LEGACY_WHATSAPP_PHONE, url: LEGACY_WHATSAPP_URL };
  const phone = theme.contact.whatsapp ?? null;
  if (!phone || !/^\d{8,15}$/.test(phone)) return null;
  const name = (theme.brandName ?? "").trim();
  const text = name ? `Hola ${name}, me gustaría recibir información` : "Hola, me gustaría recibir información";
  return { phone, url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
}
