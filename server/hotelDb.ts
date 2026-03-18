import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  roomTypes, roomRates, roomRateSeasons, roomBlocks,
  InsertRoomType, RoomType,
} from "../drizzle/schema";

async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn);
}

// ─── ROOM TYPES ───────────────────────────────────────────────────────────────

export async function getAllRoomTypes() {
  const db = await getDb();
  return db.select().from(roomTypes).orderBy(roomTypes.sortOrder, roomTypes.name);
}

export async function getActiveRoomTypes() {
  const db = await getDb();
  return db.select().from(roomTypes)
    .where(eq(roomTypes.isActive, true))
    .orderBy(roomTypes.sortOrder, roomTypes.name);
}

export async function getRoomTypeBySlug(slug: string) {
  const db = await getDb();
  const rows = await db.select().from(roomTypes).where(eq(roomTypes.slug, slug));
  return rows[0] ?? null;
}

export async function getRoomTypeById(id: number) {
  const db = await getDb();
  const rows = await db.select().from(roomTypes).where(eq(roomTypes.id, id));
  return rows[0] ?? null;
}

export async function createRoomType(data: Omit<InsertRoomType, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  const result = await db.insert(roomTypes).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateRoomType(id: number, data: Partial<Omit<InsertRoomType, "id" | "createdAt">>) {
  const db = await getDb();
  await db.update(roomTypes).set(data).where(eq(roomTypes.id, id));
  return { success: true };
}

export async function deleteRoomType(id: number) {
  const db = await getDb();
  await db.delete(roomTypes).where(eq(roomTypes.id, id));
  return { success: true };
}

export async function toggleRoomTypeActive(id: number, isActive: boolean) {
  const db = await getDb();
  await db.update(roomTypes).set({ isActive }).where(eq(roomTypes.id, id));
  return { success: true };
}

// ─── RATE SEASONS ─────────────────────────────────────────────────────────────

export async function getAllRateSeasons() {
  const db = await getDb();
  return db.select().from(roomRateSeasons).orderBy(roomRateSeasons.sortOrder);
}

export async function createRateSeason(data: { name: string; startDate: string; endDate: string; isActive?: boolean; sortOrder?: number }) {
  const db = await getDb();
  const result = await db.insert(roomRateSeasons).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateRateSeason(id: number, data: Partial<{ name: string; startDate: string; endDate: string; isActive: boolean; sortOrder: number }>) {
  const db = await getDb();
  await db.update(roomRateSeasons).set(data).where(eq(roomRateSeasons.id, id));
  return { success: true };
}

export async function deleteRateSeason(id: number) {
  const db = await getDb();
  await db.delete(roomRateSeasons).where(eq(roomRateSeasons.id, id));
  return { success: true };
}

// ─── ROOM RATES ───────────────────────────────────────────────────────────────

export async function getRatesByRoomType(roomTypeId: number) {
  const db = await getDb();
  return db.select().from(roomRates)
    .where(and(eq(roomRates.roomTypeId, roomTypeId), eq(roomRates.isActive, true)))
    .orderBy(roomRates.seasonId, roomRates.dayOfWeek);
}

export async function createRoomRate(data: {
  roomTypeId: number;
  seasonId?: number | null;
  dayOfWeek?: number | null;
  specificDate?: string | null;
  pricePerNight: string;
  supplement?: string;
  supplementLabel?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  const result = await db.insert(roomRates).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updateRoomRate(id: number, data: Partial<{
  pricePerNight: string;
  supplement: string;
  supplementLabel: string;
  isActive: boolean;
}>) {
  const db = await getDb();
  await db.update(roomRates).set(data).where(eq(roomRates.id, id));
  return { success: true };
}

export async function deleteRoomRate(id: number) {
  const db = await getDb();
  await db.delete(roomRates).where(eq(roomRates.id, id));
  return { success: true };
}

// ─── ROOM BLOCKS (AVAILABILITY CALENDAR) ─────────────────────────────────────

export async function getRoomBlocksForRange(roomTypeId: number, startDate: string, endDate: string) {
  const db = await getDb();
  return db.select().from(roomBlocks)
    .where(
      and(
        eq(roomBlocks.roomTypeId, roomTypeId),
        gte(roomBlocks.date, startDate),
        lte(roomBlocks.date, endDate)
      )
    )
    .orderBy(roomBlocks.date);
}

export async function getAllBlocksForRange(startDate: string, endDate: string) {
  const db = await getDb();
  return db.select().from(roomBlocks)
    .where(and(gte(roomBlocks.date, startDate), lte(roomBlocks.date, endDate)))
    .orderBy(roomBlocks.date);
}

export async function upsertRoomBlock(data: {
  roomTypeId: number;
  date: string;
  availableUnits: number;
  reason?: string;
  createdBy?: number;
}) {
  const db = await getDb();
  // Check if exists
  const existing = await db.select().from(roomBlocks)
    .where(and(eq(roomBlocks.roomTypeId, data.roomTypeId), eq(roomBlocks.date, data.date)));
  if (existing.length > 0) {
    await db.update(roomBlocks)
      .set({ availableUnits: data.availableUnits, reason: data.reason })
      .where(and(eq(roomBlocks.roomTypeId, data.roomTypeId), eq(roomBlocks.date, data.date)));
    return { id: existing[0].id, success: true };
  }
  const result = await db.insert(roomBlocks).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function deleteRoomBlock(id: number) {
  const db = await getDb();
  await db.delete(roomBlocks).where(eq(roomBlocks.id, id));
  return { success: true };
}

// ─── AVAILABILITY SEARCH ──────────────────────────────────────────────────────

/**
 * Returns room types with computed price and availability for a date range.
 * Logic: base price from roomTypes.basePrice, overridden by specific-date rates,
 * then day-of-week rates, then season rates (in that priority order).
 * Availability = totalUnits minus any block that sets availableUnits < totalUnits.
 */
export async function searchAvailability(params: {
  checkIn: string;   // YYYY-MM-DD
  checkOut: string;  // YYYY-MM-DD
  adults: number;
  children: number;
}) {
  const db = await getDb();
  const rooms = await db.select().from(roomTypes)
    .where(eq(roomTypes.isActive, true))
    .orderBy(roomTypes.sortOrder);

  const allRates = await db.select().from(roomRates).where(eq(roomRates.isActive, true));
  const allBlocks = await db.select().from(roomBlocks)
    .where(and(gte(roomBlocks.date, params.checkIn), lte(roomBlocks.date, params.checkOut)));

  const checkInDate = new Date(params.checkIn);
  const checkOutDate = new Date(params.checkOut);
  const nights = Math.max(1, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000));

  return rooms.map(room => {
    // Compute min price per night across the stay
    let totalPrice = 0;
    let pricePerNight = parseFloat(room.basePrice);

    for (let i = 0; i < nights; i++) {
      const d = new Date(checkInDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const dow = d.getDay();

      // Priority: specificDate > dayOfWeek > season > base
      const specificRate = allRates.find(r => r.roomTypeId === room.id && r.specificDate === dateStr);
      const dowRate = allRates.find(r => r.roomTypeId === room.id && r.dayOfWeek === dow && !r.specificDate);
      const seasonRate = allRates.find(r => r.roomTypeId === room.id && !r.specificDate && r.dayOfWeek === null);

      const nightRate = specificRate ?? dowRate ?? seasonRate;
      const nightPrice = nightRate ? parseFloat(nightRate.pricePerNight) : parseFloat(room.basePrice);
      totalPrice += nightPrice;
    }
    pricePerNight = nights > 0 ? totalPrice / nights : parseFloat(room.basePrice);

    // Compute availability: minimum available units across all nights
    let minAvailable = room.totalUnits;
    for (let i = 0; i < nights; i++) {
      const d = new Date(checkInDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const block = allBlocks.find(b => b.roomTypeId === room.id && b.date === dateStr);
      if (block !== undefined) {
        minAvailable = Math.min(minAvailable, block.availableUnits);
      }
    }

    const isAvailable = minAvailable > 0 &&
      room.maxAdults >= params.adults &&
      (room.maxChildren >= params.children || params.children === 0);

    return {
      ...room,
      pricePerNight: Math.round(pricePerNight * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100,
      nights,
      availableUnits: minAvailable,
      isAvailable,
    };
  });
}

/**
 * Returns calendar data for a room type: price and status for each day of a month.
 */
export async function getRoomCalendar(roomTypeId: number, year: number, month: number) {
  const db = await getDb();
  const room = await getRoomTypeById(roomTypeId);
  if (!room) return [];

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const rates = await db.select().from(roomRates)
    .where(and(eq(roomRates.roomTypeId, roomTypeId), eq(roomRates.isActive, true)));
  const blocks = await getRoomBlocksForRange(roomTypeId, startDate, endDate);

  const days = [];
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const d = new Date(dateStr);
    const dow = d.getDay();

    const specificRate = rates.find(r => r.specificDate === dateStr);
    const dowRate = rates.find(r => r.dayOfWeek === dow && !r.specificDate);
    const seasonRate = rates.find(r => !r.specificDate && r.dayOfWeek === null);
    const nightRate = specificRate ?? dowRate ?? seasonRate;
    const price = nightRate ? parseFloat(nightRate.pricePerNight) : parseFloat(room.basePrice);

    const block = blocks.find(b => b.date === dateStr);
    const available = block !== undefined ? block.availableUnits : room.totalUnits;

    let status: "disponible" | "pocas_unidades" | "completo" = "disponible";
    if (available === 0) status = "completo";
    else if (available <= Math.ceil(room.totalUnits * 0.3)) status = "pocas_unidades";

    days.push({ date: dateStr, price, available, status });
  }
  return days;
}
