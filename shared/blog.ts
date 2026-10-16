/**
 * Blog de la web de cada empresa (capacidad `cms-blog`): reglas puras compartidas por el servidor,
 * el panel y las pruebas. Sin dependencias de React ni de la base de datos.
 */

export const BLOG_PAGE_SIZE = 9;
export const BLOG_LIMITS = {
  title: 200,
  slug: 160,
  excerpt: 500,
  author: 120,
  category: 80,
  metaTitle: 200,
  metaDescription: 320,
  imageAlt: 200,
  content: 200_000,
} as const;

/** Slug válido: minúsculas, números y guiones simples, sin guion al principio ni al final. */
export const BLOG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Convierte un título en slug (quita acentos y signos; máximo BLOG_LIMITS.slug caracteres). */
export function slugify(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BLOG_LIMITS.slug)
    .replace(/-+$/g, "");
}

export type BlogStatus = "draft" | "published";
/** Estado visible: un publicado con fecha futura está «programado». */
export type BlogVisibleStatus = "draft" | "scheduled" | "published";

export function visibleStatus(status: BlogStatus, publishedAt: number | null, now: number): BlogVisibleStatus {
  if (status !== "published") return "draft";
  return publishedAt !== null && publishedAt > now ? "scheduled" : "published";
}

/** Solo lo publicado con fecha alcanzada se sirve en la web pública. */
export function isPubliclyVisible(status: BlogStatus, publishedAt: number | null, now: number): boolean {
  return visibleStatus(status, publishedAt, now) === "published" && publishedAt !== null;
}

/**
 * Fecha de publicación que se guarda: al publicar sin fecha, ahora; un borrador conserva la fecha
 * programada si la hay (o ninguna).
 */
export function resolvePublishedAt(status: BlogStatus, requested: number | null | undefined, now: number): number | null {
  if (status === "published") return requested ?? now;
  return requested ?? null;
}

export function pageCount(total: number, pageSize = BLOG_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export const BLOG_STATUS_LABEL: Record<BlogVisibleStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  published: "Publicada",
};

export interface BlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
  authorName: string;
  category: string;
  metaTitle: string;
  metaDescription: string;
}
export type BlogDraftErrors = Partial<Record<keyof BlogDraft, string>>;

/** Validación del formulario del panel (las mismas reglas que aplica el servidor). */
export function validateBlogDraft(d: BlogDraft): BlogDraftErrors {
  const e: BlogDraftErrors = {};
  const max = (k: keyof BlogDraft, n: number, label: string) => {
    if (d[k].trim().length > n) e[k] = `${label}: máximo ${n} caracteres.`;
  };
  if (!d.title.trim()) e.title = "El título es obligatorio.";
  else max("title", BLOG_LIMITS.title, "Título");
  const slug = d.slug.trim();
  if (!slug) e.slug = "La dirección (slug) es obligatoria.";
  else if (slug.length > BLOG_LIMITS.slug) e.slug = `Dirección: máximo ${BLOG_LIMITS.slug} caracteres.`;
  else if (!BLOG_SLUG_RE.test(slug)) e.slug = "La dirección solo admite minúsculas, números y guiones (por ejemplo, mi-primera-entrada).";
  max("excerpt", BLOG_LIMITS.excerpt, "Extracto");
  if (d.content.length > BLOG_LIMITS.content) e.content = "El contenido es demasiado largo.";
  const img = d.featuredImageUrl.trim();
  if (img && !(/^https?:\/\/\S+$/i.test(img) || (img.startsWith("/") && !img.startsWith("//")))) {
    e.featuredImageUrl = "La imagen destacada debe ser una URL http(s) o una ruta del sitio.";
  }
  max("featuredImageAlt", BLOG_LIMITS.imageAlt, "Texto alternativo");
  max("authorName", BLOG_LIMITS.author, "Autor");
  max("category", BLOG_LIMITS.category, "Categoría");
  max("metaTitle", BLOG_LIMITS.metaTitle, "Título SEO");
  max("metaDescription", BLOG_LIMITS.metaDescription, "Descripción SEO");
  return e;
}
