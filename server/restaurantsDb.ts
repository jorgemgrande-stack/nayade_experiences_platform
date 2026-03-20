import { eq, and, gte, lte, like, or, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn);
}
import {
  restaurants, restaurantShifts, restaurantClosures,
  restaurantBookings, restaurantBookingLogs, restaurantStaff,
  type Restaurant, type InsertRestaurant,
  type RestaurantShift, type InsertRestaurantShift,
  type RestaurantBooking, type InsertRestaurantBooking,
} from "../drizzle/schema";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function generateLocator(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── RESTAURANTS ─────────────────────────────────────────────────────────────

export async function getAllRestaurants(activeOnly = true) {
  const db = await getDb();
  const query = db.select().from(restaurants);
  if (activeOnly) {
    return query.where(eq(restaurants.isActive, true)).orderBy(asc(restaurants.sortOrder));
  }
  return query.orderBy(asc(restaurants.sortOrder));
}

export async function getRestaurantBySlug(slug: string) {
  const db = await getDb();
  const rows = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getRestaurantById(id: number) {
  const db = await getDb();
  const rows = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createRestaurant(data: InsertRestaurant) {
  const db = await getDb();
  const result = await db.insert(restaurants).values(data);
  return result;
}

export async function updateRestaurant(id: number, data: Partial<InsertRestaurant>) {
  const db = await getDb();
  return db.update(restaurants).set(data).where(eq(restaurants.id, id));
}

// ─── SHIFTS ──────────────────────────────────────────────────────────────────

export async function getShiftsByRestaurant(restaurantId: number) {
  const db = await getDb();
  return db.select().from(restaurantShifts)
    .where(and(eq(restaurantShifts.restaurantId, restaurantId), eq(restaurantShifts.isActive, true)))
    .orderBy(asc(restaurantShifts.sortOrder));
}

export async function getAllShiftsByRestaurant(restaurantId: number) {
  const db = await getDb();
  return db.select().from(restaurantShifts)
    .where(eq(restaurantShifts.restaurantId, restaurantId))
    .orderBy(asc(restaurantShifts.sortOrder));
}

export async function createShift(data: InsertRestaurantShift) {
  const db = await getDb();
  return db.insert(restaurantShifts).values(data);
}

export async function updateShift(id: number, data: Partial<InsertRestaurantShift>) {
  const db = await getDb();
  return db.update(restaurantShifts).set(data).where(eq(restaurantShifts.id, id));
}

export async function deleteShift(id: number) {
  const db = await getDb();
  return db.delete(restaurantShifts).where(eq(restaurantShifts.id, id));
}

// ─── CLOSURES ────────────────────────────────────────────────────────────────

export async function getClosuresByRestaurant(restaurantId: number, fromDate?: string, toDate?: string) {
  const db = await getDb();
  const conditions = [eq(restaurantClosures.restaurantId, restaurantId)];
  if (fromDate) conditions.push(gte(restaurantClosures.date, fromDate));
  if (toDate) conditions.push(lte(restaurantClosures.date, toDate));
  return db.select().from(restaurantClosures).where(and(...conditions)).orderBy(asc(restaurantClosures.date));
}

export async function createClosure(restaurantId: number, date: string, shiftId?: number, reason?: string) {
  const db = await getDb();
  return db.insert(restaurantClosures).values({ restaurantId, date, shiftId, reason });
}

export async function deleteClosure(id: number) {
  const db = await getDb();
  return db.delete(restaurantClosures).where(eq(restaurantClosures.id, id));
}

// ─── AVAILABILITY ────────────────────────────────────────────────────────────

export async function getAvailability(restaurantId: number, date: string) {
  const db = await getDb();
  // Obtener turnos activos del restaurante
  const shifts = await getShiftsByRestaurant(restaurantId);
  if (!shifts.length) return [];

  // Verificar cierres del día
  const closures = await db.select().from(restaurantClosures)
    .where(and(eq(restaurantClosures.restaurantId, restaurantId), eq(restaurantClosures.date, date)));

  const totalClosure = closures.find(c => c.shiftId === null);
  if (totalClosure) return []; // Día cerrado

  const closedShiftIds = new Set(closures.map(c => c.shiftId).filter(Boolean));

  // Calcular disponibilidad por turno
  const result = [];
  for (const shift of shifts) {
    if (closedShiftIds.has(shift.id)) continue;

    // Contar reservas confirmadas/pendientes para ese turno y fecha
    const bookingsRows = await db.select({ count: sql<number>`COUNT(*)` })
      .from(restaurantBookings)
      .where(and(
        eq(restaurantBookings.restaurantId, restaurantId),
        eq(restaurantBookings.shiftId, shift.id),
        eq(restaurantBookings.date, date),
        or(
          eq(restaurantBookings.status, "confirmed"),
          eq(restaurantBookings.status, "pending_payment")
        )
      ));

    const bookedGuests = await db.select({ total: sql<number>`COALESCE(SUM(guests), 0)` })
      .from(restaurantBookings)
      .where(and(
        eq(restaurantBookings.restaurantId, restaurantId),
        eq(restaurantBookings.shiftId, shift.id),
        eq(restaurantBookings.date, date),
        or(
          eq(restaurantBookings.status, "confirmed"),
          eq(restaurantBookings.status, "pending_payment")
        )
      ));

    const occupied = Number(bookedGuests[0]?.total ?? 0);
    const available = shift.maxCapacity - occupied;

    result.push({
      shiftId: shift.id,
      shiftName: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      maxCapacity: shift.maxCapacity,
      occupied,
      available: Math.max(0, available),
      isFull: available <= 0,
    });
  }
  return result;
}

// ─── BOOKINGS ────────────────────────────────────────────────────────────────

export async function createBooking(data: Omit<InsertRestaurantBooking, "locator">) {
  const db = await getDb();
  // Generar localizador único
  let locator = generateLocator();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db.select({ id: restaurantBookings.id })
      .from(restaurantBookings).where(eq(restaurantBookings.locator, locator)).limit(1);
    if (!existing.length) break;
    locator = generateLocator();
    attempts++;
  }
  const result = await db.insert(restaurantBookings).values({ ...data, locator });
  return { locator, insertId: (result as any).insertId };
}

export async function getBookingByLocator(locator: string) {
  const db = await getDb();
  const rows = await db.select().from(restaurantBookings)
    .where(eq(restaurantBookings.locator, locator)).limit(1);
  return rows[0] ?? null;
}

export async function getBookingById(id: number) {
  const db = await getDb();
  const rows = await db.select().from(restaurantBookings)
    .where(eq(restaurantBookings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateBooking(id: number, data: Partial<InsertRestaurantBooking>) {
  const db = await getDb();
  return db.update(restaurantBookings).set(data).where(eq(restaurantBookings.id, id));
}

export interface BookingFilters {
  restaurantId?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function getBookings(filters: BookingFilters = {}) {
  const db = await getDb();
  const { restaurantId, date, dateFrom, dateTo, status, search, page = 1, limit = 50 } = filters;
  const conditions = [];
  if (restaurantId) conditions.push(eq(restaurantBookings.restaurantId, restaurantId));
  if (date) conditions.push(eq(restaurantBookings.date, date));
  if (dateFrom) conditions.push(gte(restaurantBookings.date, dateFrom));
  if (dateTo) conditions.push(lte(restaurantBookings.date, dateTo));
  if (status) conditions.push(eq(restaurantBookings.status, status as any));
  if (search) {
    conditions.push(or(
      like(restaurantBookings.guestName, `%${search}%`),
      like(restaurantBookings.guestEmail, `%${search}%`),
      like(restaurantBookings.guestPhone, `%${search}%`),
      like(restaurantBookings.locator, `%${search}%`),
    ));
  }
  const offset = (page - 1) * limit;
  const query = db.select().from(restaurantBookings);
  if (conditions.length) query.where(and(...conditions));
  return query.orderBy(desc(restaurantBookings.date), asc(restaurantBookings.time))
    .limit(limit).offset(offset);
}

export async function getBookingsByDate(restaurantId: number, date: string) {
  const db = await getDb();
  return db.select().from(restaurantBookings)
    .where(and(eq(restaurantBookings.restaurantId, restaurantId), eq(restaurantBookings.date, date)))
    .orderBy(asc(restaurantBookings.time));
}

// ─── LOGS ────────────────────────────────────────────────────────────────────

export async function addBookingLog(bookingId: number, action: string, details?: string, userId?: number) {
  const db = await getDb();
  return db.insert(restaurantBookingLogs).values({ bookingId, action, details, userId });
}

export async function getBookingLogs(bookingId: number) {
  const db = await getDb();
  return db.select().from(restaurantBookingLogs)
    .where(eq(restaurantBookingLogs.bookingId, bookingId))
    .orderBy(desc(restaurantBookingLogs.createdAt));
}

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────

export async function getDashboardStats(restaurantId: number) {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const [todayStats] = await db.select({
    bookings: sql<number>`COUNT(*)`,
    guests: sql<number>`COALESCE(SUM(guests), 0)`,
    deposits: sql<number>`COALESCE(SUM(CASE WHEN paymentStatus = 'paid' THEN depositAmount ELSE 0 END), 0)`,
  }).from(restaurantBookings).where(and(
    eq(restaurantBookings.restaurantId, restaurantId),
    eq(restaurantBookings.date, today),
    or(eq(restaurantBookings.status, "confirmed"), eq(restaurantBookings.status, "pending_payment"))
  ));

  const [weekStats] = await db.select({
    bookings: sql<number>`COUNT(*)`,
    guests: sql<number>`COALESCE(SUM(guests), 0)`,
    deposits: sql<number>`COALESCE(SUM(CASE WHEN paymentStatus = 'paid' THEN depositAmount ELSE 0 END), 0)`,
  }).from(restaurantBookings).where(and(
    eq(restaurantBookings.restaurantId, restaurantId),
    gte(restaurantBookings.date, weekStartStr),
    or(eq(restaurantBookings.status, "confirmed"), eq(restaurantBookings.status, "pending_payment"))
  ));

  const pendingPayment = await db.select({ count: sql<number>`COUNT(*)` })
    .from(restaurantBookings).where(and(
      eq(restaurantBookings.restaurantId, restaurantId),
      eq(restaurantBookings.status, "pending_payment")
    ));

  const noShows = await db.select({ count: sql<number>`COUNT(*)` })
    .from(restaurantBookings).where(and(
      eq(restaurantBookings.restaurantId, restaurantId),
      eq(restaurantBookings.status, "no_show"),
      gte(restaurantBookings.date, weekStartStr)
    ));

  const todayBookings = await getBookingsByDate(restaurantId, today);

  return {
    today: {
      bookings: Number(todayStats?.bookings ?? 0),
      guests: Number(todayStats?.guests ?? 0),
      deposits: Number(todayStats?.deposits ?? 0),
    },
    week: {
      bookings: Number(weekStats?.bookings ?? 0),
      guests: Number(weekStats?.guests ?? 0),
      deposits: Number(weekStats?.deposits ?? 0),
    },
    pendingPayment: Number(pendingPayment[0]?.count ?? 0),
    noShows: Number(noShows[0]?.count ?? 0),
    todayBookings,
  };
}

// ─── STAFF ───────────────────────────────────────────────────────────────────

export async function getRestaurantsByUser(userId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select({ restaurantId: restaurantStaff.restaurantId })
    .from(restaurantStaff).where(eq(restaurantStaff.userId, userId));
  return rows.map(r => r.restaurantId);
}

export async function assignStaff(userId: number, restaurantId: number) {
  const db = await getDb();
  return db.insert(restaurantStaff).values({ userId, restaurantId })
    .onDuplicateKeyUpdate({ set: { userId } });
}

export async function removeStaff(userId: number, restaurantId: number) {
  const db = await getDb();
  return db.delete(restaurantStaff).where(
    and(eq(restaurantStaff.userId, userId), eq(restaurantStaff.restaurantId, restaurantId))
  );
}

export async function getStaffByRestaurant(restaurantId: number) {
  const db = await getDb();
  const { users } = await import("../drizzle/schema");
  const rows = await db
    .select({
      staffId: restaurantStaff.id,
      userId: restaurantStaff.userId,
      restaurantId: restaurantStaff.restaurantId,
      assignedAt: restaurantStaff.createdAt,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(restaurantStaff)
    .innerJoin(users, eq(restaurantStaff.userId, users.id))
    .where(eq(restaurantStaff.restaurantId, restaurantId));
  return rows;
}
