/**
 * Persistencia del blog en la BD de la empresa en curso (tabla `blog_posts`, migración
 * `db/migrations/0007_blog_posts.sql`). Cada empresa tiene su propia base de datos: el aislamiento lo
 * da `getDb()` (base de datos del tenant ligado a la petición).
 *
 * Lo público solo lee entradas publicadas con fecha alcanzada; si la tabla no existe (migración no
 * aplicada) lo público responde vacío y lo de administración lanza `BlogNotInstalled`.
 */
import { and, count, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { blogPosts, type BlogPostRow } from "../drizzle/blogSchema";
import { getDb } from "./db";
import { BLOG_PAGE_SIZE, pageCount, type BlogStatus } from "../shared/blog";

export class BlogNotInstalled extends Error {
  constructor() {
    super("El blog no está instalado en esta empresa (falta aplicar la migración 0007_blog_posts).");
    this.name = "BlogNotInstalled";
  }
}
export class BlogSlugTaken extends Error {
  constructor(public slug: string) {
    super(`Ya existe una entrada con la dirección «${slug}».`);
    this.name = "BlogSlugTaken";
  }
}

/** Tabla inexistente (ER_NO_SUCH_TABLE), también envuelta por el ORM. */
export function isMissingBlogTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /blog_posts/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}
function isDuplicate(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  }
  return false;
}

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

async function admin<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingBlogTable(e)) throw new BlogNotInstalled();
    throw e;
  }
}

const publicWhere = (now: number) => and(eq(blogPosts.status, "published"), isNotNull(blogPosts.publishedAt), lte(blogPosts.publishedAt, now));

export type PublicPostSummary = Pick<
  BlogPostRow,
  "slug" | "title" | "excerpt" | "featuredImageUrl" | "featuredImageAlt" | "authorName" | "category" | "publishedAt"
>;

const summaryCols = {
  slug: blogPosts.slug,
  title: blogPosts.title,
  excerpt: blogPosts.excerpt,
  featuredImageUrl: blogPosts.featuredImageUrl,
  featuredImageAlt: blogPosts.featuredImageAlt,
  authorName: blogPosts.authorName,
  category: blogPosts.category,
  publishedAt: blogPosts.publishedAt,
};

/** Listado público paginado (más recientes primero). */
export async function listPublishedPosts(o: { page: number; category?: string | null; now: number; pageSize?: number }) {
  const pageSize = o.pageSize ?? BLOG_PAGE_SIZE;
  const where = o.category ? and(publicWhere(o.now), eq(blogPosts.category, o.category)) : publicWhere(o.now);
  try {
    const d = await db();
    const [{ n }] = await d.select({ n: count() }).from(blogPosts).where(where);
    const total = Number(n);
    const pages = pageCount(total, pageSize);
    const page = Math.min(Math.max(1, o.page), pages);
    const items: PublicPostSummary[] = await d
      .select(summaryCols)
      .from(blogPosts)
      .where(where)
      .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items, total, page, pages, pageSize };
  } catch (e) {
    if (isMissingBlogTable(e)) return { items: [] as PublicPostSummary[], total: 0, page: 1, pages: 1, pageSize };
    throw e;
  }
}

/** Entrada pública por slug: null si no existe, es borrador o está programada. */
export async function getPublishedPost(slug: string, now: number): Promise<BlogPostRow | null> {
  try {
    const d = await db();
    const [row] = await d.select().from(blogPosts).where(and(eq(blogPosts.slug, slug), publicWhere(now))).limit(1);
    return row ?? null;
  } catch (e) {
    if (isMissingBlogTable(e)) return null;
    throw e;
  }
}

/** Categorías con alguna entrada pública (para el filtro del listado). */
export async function listPublicCategories(now: number): Promise<string[]> {
  try {
    const d = await db();
    const rows = await d
      .selectDistinct({ category: blogPosts.category })
      .from(blogPosts)
      .where(and(publicWhere(now), isNotNull(blogPosts.category), sql`${blogPosts.category} <> ''`));
    return rows.map((r) => String(r.category)).sort((a, b) => a.localeCompare(b, "es"));
  } catch (e) {
    if (isMissingBlogTable(e)) return [];
    throw e;
  }
}

/** Entradas públicas para el sitemap. */
export async function listPublishedForSitemap(now: number): Promise<Array<{ slug: string; updatedAt: Date }>> {
  try {
    const d = await db();
    return await d.select({ slug: blogPosts.slug, updatedAt: blogPosts.updatedAt }).from(blogPosts).where(publicWhere(now)).orderBy(desc(blogPosts.publishedAt));
  } catch (e) {
    if (isMissingBlogTable(e)) return [];
    throw e;
  }
}

// ── Administración ─────────────────────────────────────────────────────────────

export interface BlogPostInput {
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  authorName: string | null;
  category: string | null;
  status: BlogStatus;
  publishedAt: number | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

export function adminListPosts() {
  return admin(async () => {
    const d = await db();
    return d
      .select({
        id: blogPosts.id,
        ...summaryCols,
        status: blogPosts.status,
        updatedAt: blogPosts.updatedAt,
      })
      .from(blogPosts)
      .orderBy(desc(blogPosts.updatedAt), desc(blogPosts.id));
  });
}

export function adminGetPost(id: number) {
  return admin(async () => {
    const d = await db();
    const [row] = await d.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
    return row ?? null;
  });
}

export function createPost(input: BlogPostInput, authorUserId: number | null) {
  return admin(async () => {
    const d = await db();
    try {
      const [res] = await d.insert(blogPosts).values({ ...input, authorUserId });
      return Number((res as { insertId: number }).insertId);
    } catch (e) {
      if (isDuplicate(e)) throw new BlogSlugTaken(input.slug);
      throw e;
    }
  });
}

/** Devuelve false si la entrada no existe. */
export function updatePost(id: number, input: BlogPostInput) {
  return admin(async () => {
    const d = await db();
    try {
      const [res] = await d.update(blogPosts).set(input).where(eq(blogPosts.id, id));
      return Number((res as { affectedRows: number }).affectedRows) > 0;
    } catch (e) {
      if (isDuplicate(e)) throw new BlogSlugTaken(input.slug);
      throw e;
    }
  });
}

export function deletePost(id: number) {
  return admin(async () => {
    const d = await db();
    const [res] = await d.delete(blogPosts).where(eq(blogPosts.id, id));
    return Number((res as { affectedRows: number }).affectedRows) > 0;
  });
}
