/**
 * Tabla del blog (capacidad `cms-blog`). Vive en el carril de migraciones nuevo
 * (`db/migrations/0007_blog_posts.sql`), no en el histórico de drizzle: por eso está fuera de
 * `schema.ts` (drizzle-kit no la genera y la comprobación de esquema del arranque no la exige en
 * instalaciones que aún no hayan aplicado la migración).
 */
import { bigint, index, int, mediumtext, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const blogPosts = mysqlTable(
  "blog_posts",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    excerpt: varchar("excerpt", { length: 500 }),
    content: mediumtext("content"),
    featuredImageUrl: varchar("featured_image_url", { length: 1024 }),
    featuredImageAlt: varchar("featured_image_alt", { length: 200 }),
    authorName: varchar("author_name", { length: 120 }),
    authorUserId: int("author_user_id"),
    category: varchar("category", { length: 80 }),
    status: varchar("status", { length: 16 }).$type<"draft" | "published">().default("draft").notNull(),
    publishedAt: bigint("published_at", { mode: "number" }),
    metaTitle: varchar("meta_title", { length: 200 }),
    metaDescription: varchar("meta_description", { length: 320 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uq_blog_posts_slug").on(t.slug), index("idx_blog_posts_public").on(t.status, t.publishedAt)],
);

export type BlogPostRow = typeof blogPosts.$inferSelect;
