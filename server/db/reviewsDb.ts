import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { reviews, reservations, bookings, type Review } from "../../drizzle/schema";
import { eq, and, desc, count, avg, or } from "drizzle-orm";

async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn);
}

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type EntityType = "hotel" | "spa" | "experience" | "pack";

export interface ReviewStats {
  totalReviews: number;
  averageRating: number;
  distribution: { stars: number; count: number; percentage: number }[];
}

// ─── HELPERS PÚBLICOS ─────────────────────────────────────────────────────────

/** Obtiene reseñas aprobadas para una entidad (hotel room type o spa treatment) */
export async function getPublicReviews(
  entityType: EntityType,
  entityId: number,
  limit = 20,
  offset = 0
): Promise<{ reviews: Review[]; total: number }> {
  const db = await getDb();
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.entityType, entityType),
          eq(reviews.entityId, entityId),
          eq(reviews.status, "approved")
        )
      )
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(reviews)
      .where(
        and(
          eq(reviews.entityType, entityType),
          eq(reviews.entityId, entityId),
          eq(reviews.status, "approved")
        )
      ),
  ]);

  return { reviews: rows, total: Number(countRows[0]?.total ?? 0) };
}

/** Calcula estadísticas de valoración para una entidad */
export async function getReviewStats(
  entityType: EntityType,
  entityId: number
): Promise<ReviewStats> {
  const db = await getDb();
  const rows = await db
    .select({ rating: reviews.rating, cnt: count() })
    .from(reviews)
    .where(
      and(
        eq(reviews.entityType, entityType),
        eq(reviews.entityId, entityId),
        eq(reviews.status, "approved")
      )
    )
    .groupBy(reviews.rating);

  const totalReviews = rows.reduce(
    (sum: number, r: { rating: number; cnt: unknown }) => sum + Number(r.cnt),
    0
  );
  const sumRatings = rows.reduce(
    (sum: number, r: { rating: number; cnt: unknown }) =>
      sum + r.rating * Number(r.cnt),
    0
  );
  const averageRating =
    totalReviews > 0 ? Math.round((sumRatings / totalReviews) * 10) / 10 : 0;

  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const found = rows.find(
      (r: { rating: number; cnt: unknown }) => r.rating === stars
    );
    const cnt = found ? Number(found.cnt) : 0;
    return {
      stars,
      count: cnt,
      percentage:
        totalReviews > 0 ? Math.round((cnt / totalReviews) * 100) : 0,
    };
  });

  return { totalReviews, averageRating, distribution };
}

/** Devuelve un mapa entityId → { avgRating, reviewCount } para todos los items de un tipo */
export async function getRatingsByEntityType(
  entityType: EntityType
): Promise<Map<number, { avgRating: number; reviewCount: number }>> {
  const db = await getDb();
  const rows = await db
    .select({ entityId: reviews.entityId, cnt: count(), rating: reviews.rating })
    .from(reviews)
    .where(and(eq(reviews.entityType, entityType), eq(reviews.status, "approved")))
    .groupBy(reviews.entityId, reviews.rating);

  const map = new Map<number, { sum: number; count: number }>();
  for (const row of rows) {
    const prev = map.get(row.entityId) ?? { sum: 0, count: 0 };
    map.set(row.entityId, {
      sum: prev.sum + row.rating * Number(row.cnt),
      count: prev.count + Number(row.cnt),
    });
  }

  const result = new Map<number, { avgRating: number; reviewCount: number }>();
  map.forEach(({ sum, count: cnt }, id) => {
    result.set(id, {
      avgRating: cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : 0,
      reviewCount: cnt,
    });
  });
  return result;
}

/** Comprueba si un email tiene alguna reserva pagada o completada */
async function hasVerifiedBooking(db: Awaited<ReturnType<typeof getDb>>, email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  const [paid, completed] = await Promise.all([
    db.select({ id: reservations.id }).from(reservations)
      .where(and(eq(reservations.customerEmail, normalizedEmail), eq(reservations.status, "paid")))
      .limit(1),
    db.select({ id: bookings.id }).from(bookings)
      .where(and(
        eq(bookings.clientEmail, normalizedEmail),
        or(eq(bookings.status, "confirmado"), eq(bookings.status, "completado"))
      ))
      .limit(1),
  ]);

  return paid.length > 0 || completed.length > 0;
}

/** Crea una nueva reseña (estado pending hasta que el admin la apruebe) */
export async function createReview(data: {
  entityType: EntityType;
  entityId: number;
  authorName: string;
  authorEmail?: string;
  rating: number;
  title?: string;
  body: string;
  stayDate?: string;
}): Promise<Review> {
  const db = await getDb();

  const verified = data.authorEmail
    ? await hasVerifiedBooking(db, data.authorEmail)
    : false;

  const [result] = await db.insert(reviews).values({
    entityType: data.entityType,
    entityId: data.entityId,
    authorName: data.authorName,
    authorEmail: data.authorEmail ?? null,
    rating: Math.min(5, Math.max(1, data.rating)),
    title: data.title ?? null,
    body: data.body,
    stayDate: data.stayDate ?? null,
    status: "pending",
    verifiedBooking: verified,
  });

  const insertId = (result as { insertId: number }).insertId;
  const [row] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, insertId));
  return row;
}

// ─── HELPERS ADMIN ────────────────────────────────────────────────────────────

/** Listado completo de reseñas para el panel de admin */
export async function adminGetReviews(params: {
  entityType?: EntityType;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
  offset?: number;
}): Promise<{ reviews: Review[]; total: number }> {
  const db = await getDb();
  const conditions = [];
  if (params.entityType)
    conditions.push(eq(reviews.entityType, params.entityType));
  if (params.status) conditions.push(eq(reviews.status, params.status));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(reviews)
      .where(whereClause)
      .orderBy(desc(reviews.createdAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0),
    db.select({ total: count() }).from(reviews).where(whereClause),
  ]);

  return { reviews: rows, total: Number(countRows[0]?.total ?? 0) };
}

/** Aprueba una reseña */
export async function approveReview(id: number): Promise<void> {
  const db = await getDb();
  await db
    .update(reviews)
    .set({ status: "approved" })
    .where(eq(reviews.id, id));
}

/** Rechaza una reseña */
export async function rejectReview(id: number): Promise<void> {
  const db = await getDb();
  await db
    .update(reviews)
    .set({ status: "rejected" })
    .where(eq(reviews.id, id));
}

/** Elimina una reseña definitivamente */
export async function deleteReview(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(reviews).where(eq(reviews.id, id));
}

/** Añade o actualiza la respuesta del admin a una reseña */
export async function replyToReview(id: number, reply: string): Promise<void> {
  const db = await getDb();
  await db
    .update(reviews)
    .set({ adminReply: reply, adminRepliedAt: new Date() })
    .where(eq(reviews.id, id));
}

/** Obtiene una reseña por ID */
export async function getReviewById(id: number): Promise<Review | null> {
  const db = await getDb();
  const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
  return row ?? null;
}

/** Estadísticas globales para el dashboard admin */
export async function adminGetReviewStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  avgRating: number;
}> {
  const db = await getDb();
  const rows = await db
    .select({
      status: reviews.status,
      cnt: count(),
      avgRating: avg(reviews.rating),
    })
    .from(reviews)
    .groupBy(reviews.status);

  const get = (s: string) => {
    const r = rows.find(
      (x: { status: string; cnt: unknown; avgRating: unknown }) =>
        x.status === s
    );
    return { count: r ? Number(r.cnt) : 0 };
  };

  const pending = get("pending");
  const approved = get("approved");
  const rejected = get("rejected");
  const total = pending.count + approved.count + rejected.count;

  const allAvg = await db
    .select({ avg: avg(reviews.rating) })
    .from(reviews)
    .where(eq(reviews.status, "approved"));

  return {
    total,
    pending: pending.count,
    approved: approved.count,
    rejected: rejected.count,
    avgRating: allAvg[0]?.avg
      ? Math.round(Number(allAvg[0].avg) * 10) / 10
      : 0,
  };
}
