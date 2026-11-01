/**
 * Rutas públicas que existen en la web de una empresa, para responder 404 REAL (no 200 de la SPA) a las que no.
 *
 * `CLIENT_ROUTES` refleja las rutas de `client/src/App.tsx` (una prueba compara ambas listas). Las áreas privadas
 * (panel, portales de empleado, colaborador, proveedor y gestoría) se sirven siempre: no se indexan y su propia
 * pantalla de «no encontrada» basta. Lo que depende del contenido de la empresa se consulta:
 *   - `/:slug` (multiempresa): una página propia publicada; en una sola empresa, 404 como en el cliente.
 *   - textos legales (`/privacidad`, `/cookies`, `/terminos`, `/condiciones-cancelacion`) en multiempresa: su página.
 *   - `/pagina/:slug`: página CMS publicada (o con bloques).
 *   - `/blog` y `/blog/:slug`: blog contratado y, para una entrada, publicada.
 *   - secciones sectoriales (`/hotel`, `/spa`, `/restaurantes`) en multiempresa: solo con su módulo.
 *   - secciones que dependen de lo contratado (`/tienda`, `/experiencias`, `/lego-packs`, `/canjear-cupon`,
 *     `/presupuesto`) en multiempresa: según shared/publicSite.ts (una redirección del cliente cuenta como existente).
 * Si una comprobación falla (base de datos caída), se sirve la página: nunca se rompe la navegación por un 404 falso.
 */

import { isSiteGatedPath, publicRouteAccess, type PublicSiteFeatures } from "../../shared/publicSite";

export const CLIENT_ROUTES: readonly string[] = [
  "/",
  "/experiencias", "/experiencias/:slug",
  "/tienda",
  "/galeria",
  "/presupuesto", "/presupuesto/:token", "/propuesta/:token",
  "/colegios", "/grupos",
  "/canjear-cupon", "/verificar-bono", "/registrar-gasto", "/solicitar-anulacion",
  "/contacto",
  "/ubicaciones", "/ubicaciones/:slug",
  "/lego-packs", "/lego-packs/detalle/:slug", "/lego-packs/:category",
  "/hotel", "/hotel/:slug",
  "/spa", "/spa/:slug",
  "/restaurantes", "/restaurantes/reserva-ok", "/restaurantes/reserva-ko", "/restaurantes/:slug", "/restaurantes/:slug/reservar",
  "/checkout", "/reserva/ok", "/reserva/error",
  "/login", "/recuperar-contrasena", "/nueva-contrasena", "/establecer-contrasena",
  "/privacidad", "/terminos", "/cookies", "/condiciones-cancelacion",
  "/pagina/:slug",
  "/blog", "/blog/:slug",
];

/** Áreas privadas: todo lo que cuelga de ellas lo resuelve el cliente. */
export const PRIVATE_PREFIXES: readonly string[] = ["/admin", "/empleado", "/partner", "/supplier", "/gestoria"];

/** En multiempresa estas rutas muestran la página propia de la empresa con ese slug (ver SingleOnlyPage). */
export const TENANT_PAGE_ALIASES: Readonly<Record<string, string>> = {
  "/privacidad": "politica-de-privacidad",
  "/terminos": "terminos",
  "/cookies": "politica-de-cookies",
  "/condiciones-cancelacion": "condiciones-cancelacion",
};

/** Secciones sectoriales y el módulo que las sirve (en multiempresa, sin el módulo no existen). */
export const SECTOR_ROUTES: Readonly<Record<string, string>> = { "/hotel": "hotel", "/spa": "spa", "/restaurantes": "restaurants" };

const PAGE_SLUG = /^[a-z0-9-]{1,64}$/;
const COMPILED = CLIENT_ROUTES.map((r) => ({
  route: r,
  re: new RegExp("^" + r.replace(/:[a-z]+/gi, "[^/]+").replace(/\//g, "\\/") + "$"),
}));

export type PublicPathKind =
  | { kind: "app" }
  | { kind: "sector"; moduleId: string }
  | { kind: "site"; path: string }
  | { kind: "notFound" }
  | { kind: "tenantPage"; slug: string }
  | { kind: "dynamicPage"; slug: string }
  | { kind: "blog" }
  | { kind: "blogPost"; slug: string };

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Qué hay en una ruta pública, sin consultar nada (lo que necesita contenido se marca para consultarlo). */
export function classifyPublicPath(rawPathname: string, multi: boolean): PublicPathKind {
  const p = (rawPathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  if (PRIVATE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return { kind: "app" };
  if (p === "/404") return { kind: "notFound" };
  if (p === "/blog") return { kind: "blog" };
  const blog = /^\/blog\/([^/]+)$/.exec(p);
  if (blog) {
    const slug = decode(blog[1]);
    return slug ? { kind: "blogPost", slug } : { kind: "notFound" };
  }
  const dyn = /^\/pagina\/([^/]+)$/.exec(p);
  if (dyn) {
    const slug = decode(dyn[1]);
    return slug ? { kind: "dynamicPage", slug } : { kind: "notFound" };
  }
  if (multi && TENANT_PAGE_ALIASES[p]) return { kind: "tenantPage", slug: TENANT_PAGE_ALIASES[p] };
  if (COMPILED.some((c) => c.re.test(p))) {
    const sector = multi ? Object.keys(SECTOR_ROUTES).find((x) => p === x || p.startsWith(`${x}/`)) : undefined;
    if (sector) return { kind: "sector", moduleId: SECTOR_ROUTES[sector] };
    return multi && isSiteGatedPath(p) ? { kind: "site", path: p } : { kind: "app" };
  }
  const one = /^\/([^/]+)$/.exec(p);
  if (one && multi) {
    const slug = decode(one[1]);
    return slug && PAGE_SLUG.test(slug) ? { kind: "tenantPage", slug } : { kind: "notFound" };
  }
  return { kind: "notFound" };
}

export interface TenantPageInfo {
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface PublicRouteDeps {
  multi: boolean;
  /** Página propia publicada de la empresa (sin textos legales de relleno), o null. */
  tenantPage: (slug: string) => Promise<TenantPageInfo | null>;
  /** `/pagina/:slug`: página CMS publicada o con bloques. */
  dynamicPageExists: (slug: string) => Promise<boolean>;
  /** Blog contratado (activo o en solo lectura). */
  blogLicensed: () => Promise<boolean>;
  blogPostPublished: (slug: string) => Promise<boolean>;
  /** Módulo sectorial contratado y activo para la empresa. */
  moduleAvailable: (moduleId: string) => Promise<boolean>;
  /** Secciones de la web según lo contratado (shared/publicSite.ts). Sin ella, existen todas. */
  siteFeatures?: () => Promise<PublicSiteFeatures>;
}

export interface PublicRouteResult {
  status: 200 | 404;
  /** Página propia servida en esa ruta (para su título y descripción). */
  page?: TenantPageInfo;
}

export async function resolvePublicRoute(pathname: string, deps: PublicRouteDeps): Promise<PublicRouteResult> {
  const k = classifyPublicPath(pathname, deps.multi);
  try {
    switch (k.kind) {
      case "app":
        return { status: 200 };
      case "notFound":
        return { status: 404 };
      case "sector":
        return { status: (await deps.moduleAvailable(k.moduleId)) ? 200 : 404 };
      case "site":
        if (!deps.siteFeatures) return { status: 200 };
        return { status: publicRouteAccess(k.path, await deps.siteFeatures()).kind === "notFound" ? 404 : 200 };
      case "tenantPage": {
        const page = await deps.tenantPage(k.slug);
        return page ? { status: 200, page } : { status: 404 };
      }
      case "dynamicPage":
        return { status: (await deps.dynamicPageExists(k.slug)) ? 200 : 404 };
      case "blog":
        return { status: (await deps.blogLicensed()) ? 200 : 404 };
      case "blogPost":
        return { status: (await deps.blogLicensed()) && (await deps.blogPostPublished(k.slug)) ? 200 : 404 };
    }
  } catch {
    return { status: 200 };
  }
}

/** Dependencias reales: base de datos y licencias de la empresa en curso. */
export function defaultPublicRouteDeps(multi: boolean): PublicRouteDeps {
  return {
    multi,
    async tenantPage(slug) {
      // Portada y textos legales iniciales: se crean una vez si faltan (igual que al leerlos desde la web)
      const { ensureStarterPages } = await import("../starterSiteDb");
      await ensureStarterPages();
      const { getPageBySlug } = await import("../db");
      const { isLegalPlaceholder } = await import("../../shared/tenantNav");
      const row = await getPageBySlug(slug);
      if (!row || !row.isPublished || isLegalPlaceholder(row.slug, row.content)) return null;
      return { title: row.title, metaTitle: row.metaTitle, metaDescription: row.metaDescription };
    },
    async dynamicPageExists(slug) {
      const { getPageBySlug, getPageBlocks } = await import("../db");
      const row = await getPageBySlug(slug);
      if (row) return !!row.isPublished;
      return (await getPageBlocks(slug)).length > 0;
    },
    async blogLicensed() {
      const { getCapabilityAccess } = await import("./capabilities/access");
      return (await getCapabilityAccess().check("cms-blog", { write: false })).allowed;
    },
    async siteFeatures() {
      const { readPublicSiteFeatures } = await import("../publicSite");
      return readPublicSiteFeatures();
    },
    async moduleAvailable(moduleId) {
      const { getModuleAccess } = await import("./modules/runtime");
      return getModuleAccess().isModuleAvailable(moduleId);
    },
    async blogPostPublished(slug) {
      const { BLOG_SLUG_RE } = await import("../../shared/blog");
      if (slug.length > 160 || !BLOG_SLUG_RE.test(slug)) return false;
      const { getPublishedPost } = await import("../blogDb");
      return !!(await getPublishedPost(slug, Date.now()));
    },
  };
}
