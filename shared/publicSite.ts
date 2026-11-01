/**
 * Web pública de cada empresa: qué secciones existen y con qué palabras se nombran.
 *
 *  - Instalación propia (licencias «legacy», p. ej. Náyade): todo como siempre (experiencias, Lego Packs, cupones…).
 *  - Pyme con licencias por capacidad: vocabulario genérico (tienda, productos o servicios, pedido) y solo las
 *    secciones de lo que tiene contratado. Lo sectorial nunca aparece sin su módulo.
 *
 * Lógica pura: la usan el servidor (respuesta 404 real) y el cliente (rutas, menú y textos). Solo presentación: la
 * autorización sigue en el servidor en cada operación.
 */

export interface PublicSiteFeatures {
  /** true si la empresa usa licencias por capacidad (pyme). */
  licensed: boolean;
  /** Tienda online y carrito. */
  store: boolean;
  /** Pago en línea del carrito. */
  checkout: boolean;
  /** Formulario público de petición de presupuesto (entra como oportunidad). */
  quotes: boolean;
  /** Canje de bonos y cupones de plataformas (módulo sectorial). */
  coupons: boolean;
  /** Secciones sectoriales con su módulo contratado y activo (hotel, spa, restaurantes). */
  hotel: boolean;
  spa: boolean;
  restaurants: boolean;
}

/** Sección sectorial de la web y el módulo que la sirve. */
export const SECTOR_SECTIONS = [
  { path: "/hotel", module: "hotel" },
  { path: "/spa", module: "spa" },
  { path: "/restaurantes", module: "restaurants" },
] as const;

/** Capacidad que habilita cada sección pública en modo pyme. */
export const PUBLIC_SITE_CAPABILITIES = {
  store: "shop-store",
  checkout: "shop-checkout",
  quotes: "crm-leads",
  coupons: "deals-coupons",
} as const;

/** Instalación propia o empresa sin licencias por capacidad: todo visible, textos de siempre. */
export const LEGACY_SITE_FEATURES: PublicSiteFeatures = { licensed: false, store: true, checkout: true, quotes: true, coupons: true, hotel: true, spa: true, restaurants: true };

export function siteFeaturesFrom(o: { licensed: boolean; can: (capabilityId: string) => boolean; module?: (moduleId: string) => boolean }): PublicSiteFeatures {
  if (!o.licensed) return LEGACY_SITE_FEATURES;
  const mod = o.module ?? (() => false);
  return {
    licensed: true,
    store: o.can(PUBLIC_SITE_CAPABILITIES.store),
    checkout: o.can(PUBLIC_SITE_CAPABILITIES.checkout),
    quotes: o.can(PUBLIC_SITE_CAPABILITIES.quotes),
    coupons: o.can(PUBLIC_SITE_CAPABILITIES.coupons),
    hotel: mod("hotel"),
    spa: mod("spa"),
    restaurants: mod("restaurants"),
  };
}

/** Tienda genérica de una pyme (la ficha de cada producto sigue en /experiencias/:slug). */
export { SHOP_PATH } from "./storefront";
import { SHOP_PATH } from "./storefront";

export type PublicRouteAccess = { kind: "allow" } | { kind: "notFound" } | { kind: "redirect"; to: string };

const ALLOW: PublicRouteAccess = { kind: "allow" };
const NOT_FOUND: PublicRouteAccess = { kind: "notFound" };

/**
 * Si una ruta pública existe en la web de la empresa. Solo decide las secciones que dependen de lo contratado; el
 * resto se resuelve como siempre (`allow`).
 */
export function publicRouteAccess(rawPath: string, f: PublicSiteFeatures): PublicRouteAccess {
  const p = (rawPath.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  // La tienda (/tienda y /experiencias) la resuelve el catálogo según la ficha de la empresa (shared/storefront.ts)
  if (!f.licensed) return ALLOW;
  // Lego Packs: producto propio de la instalación original, sin equivalente contratable
  if (p === "/lego-packs" || p.startsWith("/lego-packs/")) return NOT_FOUND;
  if (p === "/canjear-cupon") return f.coupons ? ALLOW : NOT_FOUND;
  if (p === "/presupuesto") return f.quotes ? ALLOW : NOT_FOUND;
  // Hotel, spa y restaurantes: solo con su módulo (el servidor ya responde 404 sin él)
  const sector = SECTOR_SECTIONS.find((s) => p === s.path || p.startsWith(s.path + "/"));
  if (sector) return f[sector.module] ? ALLOW : NOT_FOUND;
  return ALLOW;
}

export interface PublicSiteText {
  shopLabel: string;
  shopHref: string;
  cartEmpty: string;
  cartBrowse: string;
  cartCount: (n: number) => string;
  securePayment: string;
  securePaymentLong: string;
  secureBadge: string;
  /** Distintivo «Cancelación hasta 48 h antes»: política de la instalación propia, no de cualquier empresa. */
  showCancellationBadge: boolean;
  promoPlaceholder: string;
  commentsPlaceholder: string;
  contactHint: string;
  moreShop: string;
  browseShop: string;
  quoteCta: string;
  couponCta: string;
  /** Cantidad de un artículo: «2 unidades» (pyme) o «2 personas» (instalación propia). */
  quantity: (n: number) => string;
  /** Abreviatura junto al selector de cantidad: «ud.» / «pers.». */
  quantityShort: string;
  /** Precio por unidad: «€/ud.» / «€/p.». */
  perUnitShort: string;
  /** Precio por unidad en el resumen del pago: «€/unidad» / «€/persona». */
  perUnitLong: string;
  /** Nombre de la cantidad para lectores de pantalla: «unidades» / «personas». */
  quantityNoun: string;
}

/** Fecha de un artículo del carrito para mostrar, o null si no tiene (productos sin fecha) o no es válida. */
export function cartItemDate(dateStr: string | null | undefined, opts: Intl.DateTimeFormatOptions): string | null {
  const s = (dateStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("es-ES", opts);
}

const LEGACY_TEXT: PublicSiteText = {
  shopLabel: "Experiencias",
  shopHref: "/experiencias",
  cartEmpty: "Añade experiencias desde el catálogo para reservarlas juntas en un solo pago.",
  cartBrowse: "Ver experiencias",
  cartCount: (n) => `${n} ${n === 1 ? "experiencia" : "experiencias"} seleccionadas`,
  securePayment: "Pago seguro con Redsys · SSL",
  securePaymentLong: "Pago seguro con Redsys · Datos cifrados SSL",
  secureBadge: "SSL + Redsys",
  showCancellationBadge: true,
  promoPlaceholder: "VERANO25",
  commentsPlaceholder: "Alergias, necesidades especiales, ocasión especial...",
  contactHint: "Para enviarte la confirmación de reserva.",
  moreShop: "Ver más experiencias",
  browseShop: "Ver experiencias",
  quoteCta: "Solicitar Presupuesto",
  couponCta: "Canjear Cupón",
  quantity: (n) => `${n} ${n === 1 ? "persona" : "personas"}`,
  quantityShort: "pers.",
  perUnitShort: "€/p.",
  perUnitLong: "€/persona",
  quantityNoun: "personas",
};

const GENERIC_TEXT: PublicSiteText = {
  shopLabel: "Tienda",
  shopHref: SHOP_PATH,
  cartEmpty: "Añade productos o servicios de la tienda y págalos juntos en un solo pago.",
  cartBrowse: "Ver la tienda",
  cartCount: (n) => `${n} ${n === 1 ? "artículo" : "artículos"} en el carrito`,
  securePayment: "Pago seguro · Datos cifrados",
  securePaymentLong: "Pago seguro · Datos cifrados",
  secureBadge: "Datos cifrados",
  showCancellationBadge: false,
  promoPlaceholder: "Escribe tu código",
  commentsPlaceholder: "Indicaciones sobre tu pedido",
  contactHint: "Para enviarte la confirmación de tu pedido.",
  moreShop: "Seguir comprando",
  browseShop: "Ir a la tienda",
  quoteCta: "Pedir presupuesto",
  couponCta: "Canjear cupón",
  quantity: (n) => `${n} ${n === 1 ? "unidad" : "unidades"}`,
  quantityShort: "ud.",
  perUnitShort: "€/ud.",
  perUnitLong: "€/unidad",
  quantityNoun: "unidades",
};

/** Textos de la web. Mientras no se sabe el modo (`null`), los genéricos: nunca se muestra lo sectorial de más. */
export function publicSiteText(f: PublicSiteFeatures | null): PublicSiteText {
  return f && !f.licensed ? LEGACY_TEXT : GENERIC_TEXT;
}

/** Título de la pestaña: «Quiénes somos · Empresa»; sin página, solo la empresa. */
export function composePageTitle(page: string | null | undefined, brand: string | null | undefined): string {
  const p = (page ?? "").trim();
  const b = (brand ?? "").trim();
  if (p && b && p !== b) return `${p} · ${b}`;
  return p || b;
}

/** Rutas cuya existencia depende de lo contratado (las demás no necesitan consultar nada). */
export function isSiteGatedPath(rawPath: string): boolean {
  const p = (rawPath.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  return p === "/lego-packs" || p.startsWith("/lego-packs/") || p === "/canjear-cupon" || p === "/presupuesto";
}
