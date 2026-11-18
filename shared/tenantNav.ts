/**
 * Navegación pública de la web de cada empresa: solo enlaza páginas que la propia empresa ha publicado.
 * Un enlace del menú a una página en borrador (por ejemplo, un texto legal aún sin revisar) no se muestra.
 */

/** Páginas legales: cada empresa redacta y publica las suyas; nunca se publican solas. */
export const LEGAL_PAGE_SLUGS = ["aviso-legal", "politica-de-privacidad", "politica-de-cookies", "terminos", "condiciones-cancelacion"] as const;

export function isLegalPageSlug(slug: string): boolean {
  return (LEGAL_PAGE_SLUGS as readonly string[]).includes(slug);
}

/** Frases de los textos legales de relleno de las plantillas (server/_core/templates/catalog.ts). */
export const LEGAL_PLACEHOLDER_MARKERS = ["Complete en este apartado los datos identificativos", "Complete este texto con su política"] as const;

/**
 * Texto legal que sigue siendo el de relleno de la plantilla, sin completar por la empresa. Las empresas dadas de alta
 * antes de sembrar los legales en borrador lo tienen publicado: no se sirve ni se enlaza hasta que lo redacten.
 */
export function isLegalPlaceholder(slug: string, content: string | null | undefined): boolean {
  if (!isLegalPageSlug(slug) || !content) return false;
  return LEGAL_PLACEHOLDER_MARKERS.some((m) => content.includes(m));
}

/** Rutas cortas que sirven una página de la empresa con otra dirección (ver App.tsx). */
const ROUTE_ALIASES: Record<string, string> = {
  privacidad: "politica-de-privacidad",
  cookies: "politica-de-cookies",
};

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

/** Página de la empresa a la que lleva un enlace interno («/slug»), o null si no es una página. */
export function pageSlugOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0];
  const m = /^\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  const seg = m[1].toLowerCase();
  if (!SLUG_RE.test(seg)) return null;
  return ROUTE_ALIASES[seg] ?? seg;
}

/** Qué texto legal es una dirección, en los idiomas de las webs de empresa (para no repetirlo en el pie). */
const LEGAL_KIND_BY_SLUG: Record<string, "aviso" | "privacidad" | "cookies"> = {
  "aviso-legal": "aviso", impressum: "aviso", "legal-notice": "aviso", "mentions-legales": "aviso",
  privacidad: "privacidad", "politica-de-privacidad": "privacidad", datenschutz: "privacidad", "privacy-policy": "privacidad", "politique-de-confidentialite": "privacidad",
  cookies: "cookies", "politica-de-cookies": "cookies", "cookie-richtlinie": "cookies", "cookie-policy": "cookies", "politique-de-cookies": "cookies",
};

/** Tipo de texto legal al que lleva un enlace («/impressum», «/es/aviso-legal»…), o null. El último tramo manda; un prefijo de idioma no importa. */
export function legalKindOfUrl(url: string | null | undefined): "aviso" | "privacidad" | "cookies" | null {
  if (!url) return null;
  const parts = url.split(/[?#]/)[0].split("/").filter(Boolean);
  const last = (parts[parts.length - 1] ?? "").toLowerCase();
  return LEGAL_KIND_BY_SLUG[last] ?? null;
}

interface MenuLink {
  id: number;
  parentId?: number | null;
  url?: string | null;
}

/** Quita los enlaces a páginas no publicadas (y los submenús que cuelgan de ellos). */
export function hideUnpublishedPageLinks<T extends MenuLink>(items: T[], unpublished: ReadonlySet<string>): T[] {
  const hidden = new Set<number>();
  for (const it of items) {
    const slug = pageSlugOfUrl(it.url);
    if (slug && unpublished.has(slug)) hidden.add(it.id);
  }
  return items.filter((it) => !hidden.has(it.id) && !(it.parentId != null && hidden.has(it.parentId)));
}

/** Páginas de contacto de la web en cualquier idioma («/kontakt», «/es/contacto»…): el menú ya lleva a contacto. */
const CONTACT_SLUGS = new Set(["contacto", "kontakt", "contact", "contatto", "contato", "contacte"]);
export function isContactUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const parts = url.split(/[?#]/)[0].split("/").filter(Boolean);
  return CONTACT_SLUGS.has((parts[parts.length - 1] ?? "").toLowerCase());
}

/**
 * Título del catálogo: la etiqueta del elemento activo del menú que lleva a él («Angebote», «Programas y servicios»…),
 * con o sin parámetros (`/tienda?categoria=x`). Sin ninguno, null (la página usa «Tienda» en su idioma).
 */
export function shopTitleFromMenu(items: Array<{ label?: string | null; url?: string | null; isActive?: boolean | null }> | null | undefined, shopHref: string): string | null {
  for (const it of items ?? []) {
    if (it.isActive === false || !it.url) continue;
    const path = it.url.split(/[?#]/)[0].replace(/\/+$/, "");
    const label = (it.label ?? "").trim();
    if (path === shopHref && label) return label;
  }
  return null;
}
