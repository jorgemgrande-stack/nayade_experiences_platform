/**
 * Blog de la web de cada empresa (capacidad `cms-blog`, guardián en
 * server/_core/capabilities/routeGuard.ts: el namespace `blog` entero).
 *
 *  - Públicos (solo lectura): listado paginado y detalle de entradas PUBLICADAS con fecha alcanzada.
 *    Un borrador o una entrada programada nunca se sirve.
 *  - Administración: mismos permisos que el CMS de páginas (`settings.manage`, rol admin).
 *
 * El contenido es HTML que se sanea con la lista blanca de las páginas (`sanitizeRichHtml`) al servirlo
 * y en la vista previa.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, permissionProcedure } from "../_core/trpc";
import { sanitizeRichHtml } from "../_core/htmlSanitize";
import {
  BlogNotInstalled,
  BlogSlugTaken,
  adminGetPost,
  adminListPosts,
  createPost,
  deletePost,
  getPublishedPost,
  listPublicCategories,
  listPublishedPosts,
  updatePost,
  type BlogPostInput,
} from "../blogDb";
import { BLOG_LIMITS, BLOG_SLUG_RE, resolvePublishedAt, visibleStatus } from "../../shared/blog";

const contentProcedure = permissionProcedure("settings.manage", ["admin"]);

/** Imagen: URL http(s) absoluta o ruta relativa del propio sitio. */
const isSafeImageUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u) || (u.startsWith("/") && !u.startsWith("//"));

const optText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const blogPostInput = z.object({
  title: z.string().trim().min(1, "El título es obligatorio.").max(BLOG_LIMITS.title, `El título admite como máximo ${BLOG_LIMITS.title} caracteres.`),
  slug: z
    .string()
    .trim()
    .min(1, "La dirección (slug) es obligatoria.")
    .max(BLOG_LIMITS.slug, `La dirección admite como máximo ${BLOG_LIMITS.slug} caracteres.`)
    .regex(BLOG_SLUG_RE, "La dirección solo admite minúsculas, números y guiones (por ejemplo, mi-primera-entrada)."),
  excerpt: optText(BLOG_LIMITS.excerpt, "Extracto"),
  content: z.string().max(BLOG_LIMITS.content, "El contenido es demasiado largo.").nullish().transform((v) => (v ? v : null)),
  featuredImageUrl: optText(1024, "Imagen destacada").refine((v) => v === null || isSafeImageUrl(v), "La imagen destacada debe ser una URL http(s) o una ruta del sitio."),
  featuredImageAlt: optText(BLOG_LIMITS.imageAlt, "Texto alternativo"),
  authorName: optText(BLOG_LIMITS.author, "Autor"),
  category: optText(BLOG_LIMITS.category, "Categoría"),
  status: z.enum(["draft", "published"]),
  /** Fecha de publicación (ms). Futura = programada. Omitida al editar: se conserva la guardada. */
  publishedAt: z.number().int().positive().nullable().optional(),
  metaTitle: optText(BLOG_LIMITS.metaTitle, "Título SEO"),
  metaDescription: optText(BLOG_LIMITS.metaDescription, "Descripción SEO"),
});
type PostInput = z.infer<typeof blogPostInput>;

function toRow(input: PostInput, requestedPublishedAt: number | null | undefined, now: number): BlogPostInput {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    featuredImageUrl: input.featuredImageUrl,
    featuredImageAlt: input.featuredImageAlt,
    authorName: input.authorName,
    category: input.category,
    status: input.status,
    publishedAt: resolvePublishedAt(input.status, requestedPublishedAt, now),
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
  };
}

function mapError(e: unknown): never {
  if (e instanceof BlogNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
  if (e instanceof BlogSlugTaken) throw new TRPCError({ code: "CONFLICT", message: e.message });
  throw e;
}

const slugInput = z.object({ slug: z.string().trim().regex(BLOG_SLUG_RE).max(BLOG_LIMITS.slug) });

export const blogRouter = router({
  // ── Públicos (solo lectura de lo publicado) ────────────────────────────────
  publicList: publicProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).max(10_000).default(1),
          category: z.string().trim().max(BLOG_LIMITS.category).nullish(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ input }) => {
      const now = Date.now();
      const [list, categories] = await Promise.all([
        listPublishedPosts({ page: input.page, category: input.category || null, now }),
        listPublicCategories(now),
      ]);
      return { ...list, categories };
    }),

  publicGet: publicProcedure.input(slugInput).query(async ({ input }) => {
    const row = await getPublishedPost(input.slug, Date.now());
    if (!row) return null;
    return {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      html: sanitizeRichHtml(row.content ?? ""),
      featuredImageUrl: row.featuredImageUrl,
      featuredImageAlt: row.featuredImageAlt,
      authorName: row.authorName,
      category: row.category,
      publishedAt: row.publishedAt,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    };
  }),

  // ── Administración ──────────────────────────────────────────────────────────
  list: contentProcedure.query(async () => {
    const now = Date.now();
    const rows = await adminListPosts().catch(mapError);
    return rows.map((r) => ({ ...r, visibleStatus: visibleStatus(r.status, r.publishedAt, now) }));
  }),

  get: contentProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const row = await adminGetPost(input.id).catch(mapError);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "La entrada no existe." });
    return { ...row, visibleStatus: visibleStatus(row.status, row.publishedAt, Date.now()) };
  }),

  create: contentProcedure.input(blogPostInput).mutation(async ({ input, ctx }) => {
    const now = Date.now();
    const row = toRow({ ...input, authorName: input.authorName ?? (ctx.user.name || null) }, input.publishedAt, now);
    const id = await createPost(row, ctx.user.id ?? null).catch(mapError);
    return { id, visibleStatus: visibleStatus(row.status, row.publishedAt, now) };
  }),

  update: contentProcedure.input(blogPostInput.extend({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const now = Date.now();
    const current = await adminGetPost(input.id).catch(mapError);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "La entrada no existe." });
    const requested = input.publishedAt !== undefined ? input.publishedAt : current.publishedAt;
    const row = toRow(input, requested, now);
    await updatePost(input.id, row).catch(mapError);
    return { id: input.id, visibleStatus: visibleStatus(row.status, row.publishedAt, now) };
  }),

  remove: contentProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const ok = await deletePost(input.id).catch(mapError);
    if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "La entrada no existe." });
    return { success: true };
  }),

  /** Vista previa del contenido tal como se servirá (saneado), sin guardar nada. */
  preview: contentProcedure
    .input(z.object({ content: z.string().max(BLOG_LIMITS.content) }))
    .mutation(({ input }) => ({ html: sanitizeRichHtml(input.content) })),
});
