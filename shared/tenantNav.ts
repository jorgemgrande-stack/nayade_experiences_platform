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
