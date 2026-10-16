/**
 * SEO del blog en el HTML inicial (multiempresa): título, descripción, imagen Open Graph y texto de
 * respaldo de `/blog` y `/blog/:slug`. El canonical lo calcula `buildTenantMeta` con el host de la
 * empresa. Solo entradas publicadas: un borrador o una programada no aportan nada (se sirve el SEO
 * genérico de la empresa). Valores devueltos ya escapados para HTML.
 */
import { escapeHtml, safeUrl } from "./_core/tenantSeo";
import { BLOG_SLUG_RE } from "../shared/blog";

export type BlogRoute = { kind: "list" } | { kind: "post"; slug: string };

export function blogRouteOf(pathname: string): BlogRoute | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/blog") return { kind: "list" };
  const m = /^\/blog\/([^/]+)$/.exec(p);
  if (m && m[1].length <= 160 && BLOG_SLUG_RE.test(m[1])) return { kind: "post", slug: m[1] };
  return null;
}

export interface BlogSeoPost {
  title: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  featuredImageUrl: string | null;
}

export interface BlogSeoOverride {
  title: string;
  description: string;
  h1: string;
  body: string;
  image?: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function blogMetaOverride(
  pathname: string,
  brandName: string,
  deps: { licensed: () => Promise<boolean>; getPost: (slug: string) => Promise<BlogSeoPost | null> },
): Promise<BlogSeoOverride | null> {
  const route = blogRouteOf(pathname);
  if (!route) return null;
  if (!(await deps.licensed())) return null;
  const brand = brandName.trim();
  const withBrand = (t: string) => (brand ? `${t} | ${brand}` : t);
  if (route.kind === "list") {
    const title = withBrand("Blog");
    const description = brand ? `Noticias y artículos de ${brand}.` : "Noticias y artículos.";
    return { title: escapeHtml(title), description: escapeHtml(description), h1: "Blog", body: escapeHtml(description) };
  }
  const post = await deps.getPost(route.slug);
  if (!post) return null;
  const title = clip(withBrand((post.metaTitle || post.title).trim()), 160);
  const description = clip((post.metaDescription || post.excerpt || post.title).trim(), 300);
  const image = safeUrl(post.featuredImageUrl ?? undefined);
  return {
    title: escapeHtml(title),
    description: escapeHtml(description),
    h1: escapeHtml(post.title),
    body: escapeHtml(clip((post.excerpt ?? "").trim(), 300)),
    image: image ? escapeHtml(image) : undefined,
  };
}

/** Con las dependencias reales: licencia `cms-blog` de la empresa en curso y entrada publicada. */
export async function blogMetaForRequest(pathname: string, brandName: string): Promise<BlogSeoOverride | null> {
  const { getCapabilityAccess } = await import("./_core/capabilities/access");
  const { getPublishedPost } = await import("./blogDb");
  return blogMetaOverride(pathname, brandName, {
    licensed: async () => (await getCapabilityAccess().check("cms-blog", { write: false })).allowed,
    getPost: (slug) => getPublishedPost(slug, Date.now()),
  });
}
