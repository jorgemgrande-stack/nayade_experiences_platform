import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { galleryItems, type GalleryItem, type NewGalleryItem } from "../drizzle/schema";

async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn);
}

// ── Public ────────────────────────────────────────────────────────────────────

export async function getActiveGalleryItems(): Promise<GalleryItem[]> {
  const db = await getDb();
  return db
    .select()
    .from(galleryItems)
    .where(eq(galleryItems.isActive, true))
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.createdAt));
}

export async function getGalleryCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ category: galleryItems.category })
    .from(galleryItems)
    .where(eq(galleryItems.isActive, true));
  const unique = Array.from(new Set(rows.map((r) => r.category))).filter((c): c is string => Boolean(c));
  return unique.sort();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function getAllGalleryItems(): Promise<GalleryItem[]> {
  const db = await getDb();
  return db
    .select()
    .from(galleryItems)
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.createdAt));
}

export async function createGalleryItem(data: Omit<NewGalleryItem, "sortOrder">): Promise<GalleryItem> {
  const db = await getDb();
  const existing = await db.select({ sortOrder: galleryItems.sortOrder }).from(galleryItems);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map((r) => r.sortOrder)) : -1;
  const [result] = await db.insert(galleryItems).values({ ...data, sortOrder: maxOrder + 1 });
  const [inserted] = await db.select().from(galleryItems).where(eq(galleryItems.id, (result as { insertId: number }).insertId));
  return inserted;
}

export async function updateGalleryItem(id: number, data: Partial<NewGalleryItem>): Promise<GalleryItem | null> {
  const db = await getDb();
  await db.update(galleryItems).set(data).where(eq(galleryItems.id, id));
  const [updated] = await db.select().from(galleryItems).where(eq(galleryItems.id, id));
  return updated ?? null;
}

export async function deleteGalleryItem(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(galleryItems).where(eq(galleryItems.id, id));
}

export async function reorderGalleryItems(orderedIds: number[]): Promise<void> {
  const db = await getDb();
  await Promise.all(
    orderedIds.map((id, index) =>
      db.update(galleryItems).set({ sortOrder: index }).where(eq(galleryItems.id, id))
    )
  );
}
