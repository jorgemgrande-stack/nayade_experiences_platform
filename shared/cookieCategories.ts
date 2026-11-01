/**
 * Categorías del aviso de cookies según lo que la web de la empresa usa de verdad (lógica pura: la usan el aviso y las
 * pruebas). El aviso solo menciona lo que existe (art. 22.2 LSSI y guía de la AEPD: información veraz).
 *
 *  - Instalación original (`neutralSite` falso): todas, como siempre.
 *  - Web de una empresa: analíticas solo con su Google Analytics configurado; publicidad solo con su píxel de Meta;
 *    preferencias, ninguna (la web no guarda ajustes del visitante fuera de las imprescindibles).
 */
export interface CookieCategories {
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}

export interface CookieThemeInput {
  neutralSite: boolean;
  analytics?: { ga4Id?: string | null; metaPixelId?: string | null } | null;
}

export const ALL_COOKIE_CATEGORIES: CookieCategories = { analytics: true, marketing: true, preferences: true };

export function cookieCategories(theme: CookieThemeInput | null | undefined): CookieCategories | null {
  if (!theme) return null;
  if (!theme.neutralSite) return ALL_COOKIE_CATEGORIES;
  return { analytics: !!theme.analytics?.ga4Id, marketing: !!theme.analytics?.metaPixelId, preferences: false };
}

export const hasOptionalCookies = (c: CookieCategories) => c.analytics || c.marketing || c.preferences;

function list(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Texto principal del aviso para las categorías que existen. */
export function cookieBody(c: CookieCategories): string {
  if (!hasOptionalCookies(c)) {
    return "Solo usamos cookies propias necesarias para que la web funcione (sesión, carrito y seguridad). No usamos cookies de análisis ni de publicidad.";
  }
  const thirdParty = c.analytics || c.marketing;
  const owner = c.preferences && thirdParty ? "propias y de terceros" : c.preferences ? "propias" : "de terceros";
  const purposes = [
    c.analytics ? "analizar su uso" : null,
    c.preferences ? "recordar tus preferencias" : null,
    c.marketing ? "mostrarte publicidad adaptada a tus intereses" : null,
  ].filter((p): p is string => !!p);
  return `Usamos cookies propias necesarias para que la web funcione y, solo si nos das tu consentimiento, cookies ${owner} para ${list(purposes)}. Puedes aceptarlas, rechazarlas o`;
}
