/**
 * Lo que la recepcionista lee del Core de la empresa: los productos publicados del catálogo (título, precio publicado,
 * duración y personas) y, para «¿hay plazas el sábado?», los horarios con aforo del producto y las personas de las
 * reservas que cuentan ese día (pagadas o pendientes de pago y no anuladas). Solo lectura y SQL parametrizado.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { RECEPTION_LIMITS, type CatalogEntry, type SlotInfo } from "../../shared/receptionAi";

type Row = Record<string, any>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

async function db() {
  const d = await getTenantDatabase();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

export async function publishedCatalog(limit: number = RECEPTION_LIMITS.catalogMax): Promise<CatalogEntry[]> {
  const d = await db();
  const rows = rowsOf(
    await d.execute(sql`
      SELECT id, title, basePrice, currency, duration, shortDescription, minPersons, maxPersons
        FROM experiences
       WHERE isActive = 1 AND isPublished = 1
       ORDER BY isFeatured DESC, sortOrder, id
       LIMIT ${limit}`),
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    priceFrom: num(r.basePrice),
    currency: String(r.currency || "EUR"),
    duration: r.duration ? String(r.duration) : null,
    summary: r.shortDescription ? String(r.shortDescription) : null,
    minPersons: num(r.minPersons),
    maxPersons: num(r.maxPersons),
  }));
}

export async function slotsAndBookings(productId: number, date: string): Promise<{ slots: SlotInfo[]; bookedBySlot: Map<number | null, number> }> {
  const d = await db();
  const slots = rowsOf(
    await d.execute(sql`SELECT id, label, start_time, days_of_week, capacity FROM product_time_slots WHERE product_id = ${productId} AND active = 1 ORDER BY sort_order, id`),
  ).map((r) => ({ id: Number(r.id), label: String(r.label ?? ""), startTime: r.start_time ? String(r.start_time) : null, daysOfWeek: r.days_of_week ? String(r.days_of_week) : null, capacity: num(r.capacity) }));
  const booked = rowsOf(
    await d.execute(sql`
      SELECT selected_time_slot_id AS slot, COALESCE(SUM(people), 0) AS people
        FROM reservations
       WHERE product_id = ${productId} AND booking_date = ${date}
         AND status IN ('paid', 'pending_payment')
         AND (status_reservation IS NULL OR status_reservation <> 'ANULADA')
       GROUP BY selected_time_slot_id`),
  );
  const bookedBySlot = new Map<number | null, number>();
  for (const b of booked) bookedBySlot.set(b.slot == null ? null : Number(b.slot), Number(b.people ?? 0));
  return { slots, bookedBySlot };
}
