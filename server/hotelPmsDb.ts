/**
 * Hotel Net · núcleo PMS — acceso a datos: habitaciones físicas y su estado operativo, asignación de habitación a
 * reserva (manual y automática, sin solapes), planning, recepción (check-in, check-out y no-show) y restricciones de
 * estancia. La lógica de decisión vive en `hotelPms.ts`.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant). Tablas de
 * db/migrations/0032_hotel_pms, declaradas aquí y no en drizzle/schema.ts (como 0021 o 0025): así la comprobación de
 * esquema del arranque y el resto del hotel no dependen de que la migración esté aplicada. Sin ella, cada función
 * responde con un error claro (`[module_not_installed]`) en vez de un error interno.
 *
 * Las reservas de hotel son filas de `reservations` (las crea la reserva pública o la recepción) con la retención de
 * inventario de db/migrations/0004 (`inventory_kind = 'hotel_room'`, `stay_check_in/out`, `hold_status`).
 *
 * Concurrencia: toda asignación ocurre en una transacción READ COMMITTED que bloquea con `SELECT … FOR UPDATE` la
 * reserva y después las habitaciones afectadas (mismo orden en todas las operaciones: tipo de habitación → reserva →
 * habitación), así dos recepcionistas nunca asignan la misma habitación en noches solapadas. Reintento ante
 * interbloqueo.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { bigint, boolean, int, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "./db";
import { isDeadlock } from "./creditNoteNumber";
import {
  OUT_OF_SERVICE_STATUSES,
  addDaysIso,
  assignmentBlocker,
  decideStayTransition,
  earlyCheckoutDate,
  hotelStayDetails,
  nightsBetween,
  pickRoomForStay,
  receptionSummary,
  reservationOccupies,
  stayRestrictionViolation,
  todayInTimeZone,
  type AssignmentLike,
  type RoomCandidate,
  type RoomOperationalStatus,
  type StayAction,
  type StayReservation,
  type StayRestriction,
} from "./hotelPms";

// ─── Tablas (db/migrations/0032_hotel_pms) ────────────────────────────────────

export const hotelRooms = mysqlTable("hotel_rooms", {
  id: int("id").autoincrement().primaryKey(),
  siteId: varchar("site_id", { length: 63 }),
  roomTypeId: int("room_type_id").notNull(),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 120 }),
  floor: varchar("floor", { length: 32 }),
  notes: text("notes"),
  attributes: json("attributes").$type<string[]>(),
  isActive: boolean("is_active").notNull().default(true),
  operationalStatus: varchar("operational_status", { length: 32 }).notNull().default("libre"),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const hotelRoomStateEvents = mysqlTable("hotel_room_state_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  hotelRoomId: int("hotel_room_id").notNull(),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 255 }),
  userId: int("user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const hotelRoomAssignments = mysqlTable("hotel_room_assignments", {
  id: int("id").autoincrement().primaryKey(),
  reservationId: int("reservation_id").notNull(),
  hotelRoomId: int("hotel_room_id").notNull(),
  checkIn: varchar("check_in", { length: 10 }).notNull(),
  checkOut: varchar("check_out", { length: 10 }).notNull(),
  notes: text("notes"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type HotelRoom = typeof hotelRooms.$inferSelect;

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Exec = Pick<Db, "execute" | "select" | "insert" | "update" | "delete">;

// ─── Utilidades ───────────────────────────────────────────────────────────────

export async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

export async function rows<T>(exec: Pick<Db, "execute">, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

function errCode(e: unknown): string | undefined {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  }
  return undefined;
}

/** Empresa sin la migración 0032 (tabla o columna inexistente). */
export function isMissingPmsSchema(e: unknown): boolean {
  const c = errCode(e);
  return c === "ER_NO_SUCH_TABLE" || c === "ER_BAD_FIELD_ERROR";
}

export const PMS_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] El PMS del hotel (habitaciones, asignación y recepción) aún no está preparado en tu empresa: falta aplicar la actualización 0032_hotel_pms de su base de datos.";

/** Ejecuta `fn` traduciendo la falta de la migración a un error claro (PRECONDITION_FAILED). */
async function pms<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingPmsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: PMS_NOT_INSTALLED_MESSAGE, cause: e });
    if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe una habitación con ese código en la sede.", cause: e });
    throw e;
  }
}

/** Transacción READ COMMITTED con reintento ante interbloqueo. */
export async function inTx<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  const d = await db();
  for (let attempt = 1; ; attempt++) {
    try {
      return await d.transaction((tx) => fn(tx as unknown as Exec), { isolationLevel: "read committed" });
    } catch (err) {
      if (attempt >= 5 || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt));
    }
  }
}

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

// ─── Habitaciones físicas ─────────────────────────────────────────────────────

export interface RoomInput {
  roomTypeId: number;
  code: string;
  name?: string | null;
  floor?: string | null;
  notes?: string | null;
  attributes?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export async function listHotelRooms(f: { roomTypeId?: number; siteCondition?: SQL | null } = {}) {
  return pms(async () => {
    const d = await db();
    const conds: SQL[] = [];
    if (f.roomTypeId != null) conds.push(eq(hotelRooms.roomTypeId, f.roomTypeId));
    if (f.siteCondition) conds.push(f.siteCondition);
    const q = d.select().from(hotelRooms);
    const list = await (conds.length ? q.where(and(...conds)) : q).orderBy(asc(hotelRooms.sortOrder), asc(hotelRooms.code));
    return list.map((r) => ({ ...r, attributes: Array.isArray(r.attributes) ? r.attributes : [] }));
  });
}

async function roomTypeExists(exec: Pick<Db, "execute">, roomTypeId: number): Promise<boolean> {
  const [t] = await rows<{ id: number }>(exec, sql`SELECT id FROM room_types WHERE id = ${roomTypeId}`);
  return !!t;
}

export async function createHotelRoom(data: RoomInput, siteId: string | null) {
  return pms(async () => {
    const d = await db();
    if (!(await roomTypeExists(d, data.roomTypeId))) bad("La tipología no existe.");
    const now = Date.now();
    const [res] = await d.insert(hotelRooms).values({
      siteId,
      roomTypeId: data.roomTypeId,
      code: data.code.trim(),
      name: data.name?.trim() || null,
      floor: data.floor?.trim() || null,
      notes: data.notes?.trim() || null,
      attributes: data.attributes ?? [],
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    return { id: Number((res as unknown as { insertId: number }).insertId) };
  });
}

export async function updateHotelRoom(id: number, patch: Partial<RoomInput>) {
  return pms(async () => {
    const d = await db();
    if (patch.roomTypeId != null && !(await roomTypeExists(d, patch.roomTypeId))) bad("La tipología no existe.");
    if (patch.roomTypeId != null) {
      // Cambiar de tipología con estancias futuras asignadas rompería el cuadre de inventario de esas reservas
      const [busy] = await rows<{ n: number }>(d, sql`
        SELECT COUNT(*) AS n FROM hotel_room_assignments a JOIN hotel_rooms h ON h.id = a.hotel_room_id
        WHERE a.hotel_room_id = ${id} AND h.room_type_id <> ${patch.roomTypeId} AND a.check_out > ${todayInTimeZone()}`);
      if (Number(busy?.n ?? 0) > 0) bad("La habitación tiene estancias asignadas: reasígnalas antes de cambiar su tipología.");
    }
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.roomTypeId != null) set.roomTypeId = patch.roomTypeId;
    if (patch.code != null) set.code = patch.code.trim();
    if (patch.name !== undefined) set.name = patch.name?.trim() || null;
    if (patch.floor !== undefined) set.floor = patch.floor?.trim() || null;
    if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
    if (patch.attributes !== undefined) set.attributes = patch.attributes;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    await d.update(hotelRooms).set(set).where(eq(hotelRooms.id, id));
    return { ok: true as const };
  });
}

export async function toggleHotelRoomActive(id: number, isActive: boolean) {
  return pms(async () => {
    const d = await db();
    await d.update(hotelRooms).set({ isActive, updatedAt: Date.now() }).where(eq(hotelRooms.id, id));
    return { ok: true as const };
  });
}

/** Borra una habitación sin estancias asignadas (con estancias, se desactiva en su lugar) y su historial. */
export async function deleteHotelRoom(id: number) {
  return pms(async () => {
    const d = await db();
    const [used] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM hotel_room_assignments WHERE hotel_room_id = ${id}`);
    if (Number(used?.n ?? 0) > 0) bad("La habitación tiene estancias asignadas: desactívala en lugar de borrarla.");
    await d.delete(hotelRoomStateEvents).where(eq(hotelRoomStateEvents.hotelRoomId, id));
    await d.delete(hotelRooms).where(eq(hotelRooms.id, id));
    return { ok: true as const };
  });
}

/** Cambia el estado operativo (con el registro del cambio) dentro de `tx`, con la habitación bloqueada. */
async function setRoomStateLocked(tx: Exec, hotelRoomId: number, toStatus: RoomOperationalStatus, opts: { userId?: number | null; reason?: string | null }) {
  const [cur] = await rows<{ operational_status: string }>(tx, sql`SELECT operational_status FROM hotel_rooms WHERE id = ${hotelRoomId} FOR UPDATE`);
  if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada" });
  if (cur.operational_status === toStatus) return { changed: false };
  const now = Date.now();
  await tx.insert(hotelRoomStateEvents).values({
    hotelRoomId,
    fromStatus: cur.operational_status,
    toStatus,
    reason: opts.reason?.slice(0, 255) || null,
    userId: opts.userId ?? null,
    createdAt: now,
  });
  await tx.update(hotelRooms).set({ operationalStatus: toStatus, updatedAt: now }).where(eq(hotelRooms.id, hotelRoomId));
  return { changed: true };
}

export async function setHotelRoomState(hotelRoomId: number, toStatus: RoomOperationalStatus, opts: { userId?: number | null; reason?: string | null }) {
  return pms(() => inTx((tx) => setRoomStateLocked(tx, hotelRoomId, toStatus, opts)));
}

export async function getHotelRoomStateHistory(hotelRoomId: number, limit = 100) {
  return pms(async () => {
    const d = await db();
    return d.select().from(hotelRoomStateEvents)
      .where(eq(hotelRoomStateEvents.hotelRoomId, hotelRoomId))
      .orderBy(desc(hotelRoomStateEvents.createdAt), desc(hotelRoomStateEvents.id))
      .limit(limit);
  });
}

async function countRoomsByStatus(exec: Pick<Db, "execute">) {
  const list = await rows<{ status: string; n: number }>(exec, sql`
    SELECT operational_status AS status, COUNT(*) AS n FROM hotel_rooms WHERE is_active = 1 GROUP BY operational_status`);
  const out: Record<string, number> = {};
  for (const r of list) out[r.status] = Number(r.n);
  return out;
}

// ─── Reservas de hotel ────────────────────────────────────────────────────────

interface ReservationRow {
  id: number;
  reservation_number: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  status_reservation: string | null;
  status_payment: string | null;
  channel: string | null;
  amount_total: number;
  amount_paid: number | null;
  booking_date: string;
  product_id: number;
  product_name: string;
  people: number;
  extras_json: string | null;
  notes: string | null;
  inventory_ref_id: number | null;
  stay_check_in: string | null;
  stay_check_out: string | null;
  hold_status: string | null;
  hold_expires_at: number | string | null;
}

const RESERVATION_COLUMNS = sql.raw(
  "id, reservation_number, customer_name, customer_email, customer_phone, status, status_reservation, status_payment, channel, " +
    "amount_total, amount_paid, booking_date, product_id, product_name, people, extras_json, notes, inventory_ref_id, stay_check_in, " +
    "stay_check_out, hold_status, hold_expires_at",
);

/** Reserva de hotel: la retención es de hotel o la reserva pública guardó `"type":"hotel"` en extras_json. */
const HOTEL_RESERVATION = sql.raw(`(inventory_kind = 'hotel_room' OR extras_json LIKE '%"type":"hotel"%')`);

export interface HotelReservation extends StayReservation {
  id: number;
  reservationNumber: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  statusPayment: string | null;
  channel: string | null;
  amountTotal: number;
  amountPaid: number;
  people: number;
  notes: string | null;
  roomTypeId: number | null;
  roomName: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
  occupies: boolean;
}

function toReservation(r: ReservationRow, now: number): HotelReservation | null {
  const s = hotelStayDetails({
    extrasJson: r.extras_json,
    bookingDate: r.booking_date,
    productId: r.product_id,
    productName: r.product_name,
    stayCheckIn: r.stay_check_in,
    stayCheckOut: r.stay_check_out,
    inventoryRefId: r.inventory_ref_id,
  });
  if (!s.checkIn || !s.checkOut) return null;
  const expires = r.hold_expires_at === null ? null : Number(r.hold_expires_at);
  const base: StayReservation = {
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    status: r.status,
    statusReservation: r.status_reservation,
    holdStatus: r.hold_status,
    holdLive: r.hold_status !== "retenida" || expires === null || expires > now,
  };
  return {
    ...base,
    id: Number(r.id),
    reservationNumber: r.reservation_number,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    customerPhone: r.customer_phone,
    statusPayment: r.status_payment,
    channel: r.channel,
    amountTotal: Number(r.amount_total),
    amountPaid: Number(r.amount_paid ?? 0),
    people: Number(r.people ?? 0),
    notes: r.notes,
    roomTypeId: s.roomTypeId,
    roomName: s.roomName,
    nights: s.nights,
    adults: s.adults,
    children: s.children,
    occupies: reservationOccupies(base) || base.statusReservation === "EN_CURSO",
  };
}

/** Reservas de hotel cuya estancia solapa [from, to] (fechas inclusivas), más recientes primero. */
export async function listHotelReservations(f: { from: string; to: string; status?: string; limit?: number }, exec?: Pick<Db, "execute">) {
  const e = exec ?? (await db());
  const now = Date.now();
  // La fecha de entrada (booking_date en la reserva pública) puede ser anterior al rango: margen de 60 noches
  const lower = addDaysIso(f.from, -60);
  const list = await rows<ReservationRow>(e, sql`
    SELECT ${RESERVATION_COLUMNS} FROM reservations
    WHERE ${HOTEL_RESERVATION}
      AND COALESCE(stay_check_in, booking_date) <= ${f.to} AND COALESCE(stay_check_in, booking_date) >= ${lower}
      ${f.status ? sql`AND status = ${f.status}` : sql``}
    ORDER BY COALESCE(stay_check_in, booking_date) DESC, id DESC
    LIMIT ${sql.raw(String(Math.max(1, Math.min(Math.trunc(f.limit ?? 500), 2000))))}`);
  return list
    .map((r) => toReservation(r, now))
    .filter((r): r is HotelReservation => !!r && r.checkIn <= f.to && r.checkOut > f.from);
}

export async function lockReservation(tx: Exec, reservationId: number): Promise<HotelReservation> {
  const [r] = await rows<ReservationRow>(tx, sql`
    SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = ${reservationId} AND ${HOTEL_RESERVATION} FOR UPDATE`);
  const res = r ? toReservation(r, Date.now()) : null;
  if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva de hotel no encontrada o sin fechas de estancia." });
  return res;
}

// ─── Asignaciones ─────────────────────────────────────────────────────────────

interface AssignmentRow {
  id: number;
  reservation_id: number;
  hotel_room_id: number;
  check_in: string;
  check_out: string;
  notes: string | null;
  room_code: string;
  room_name: string | null;
  room_floor: string | null;
  r_status: string;
  r_status_reservation: string | null;
  r_hold_status: string | null;
  r_hold_expires_at: number | string | null;
}

export interface AssignmentView extends AssignmentLike {
  id: number;
  notes: string | null;
  roomCode: string;
  roomName: string | null;
  roomFloor: string | null;
  /** La reserva sigue ocupando la habitación (no está cancelada, anulada, en no-show ni caducada). */
  active: boolean;
}

function toAssignment(r: AssignmentRow, now: number): AssignmentView {
  const expires = r.r_hold_expires_at === null ? null : Number(r.r_hold_expires_at);
  const stay: StayReservation = {
    checkIn: r.check_in,
    checkOut: r.check_out,
    status: r.r_status,
    statusReservation: r.r_status_reservation,
    holdStatus: r.r_hold_status,
    holdLive: r.r_hold_status !== "retenida" || expires === null || expires > now,
  };
  return {
    id: Number(r.id),
    reservationId: Number(r.reservation_id),
    hotelRoomId: Number(r.hotel_room_id),
    checkIn: r.check_in,
    checkOut: r.check_out,
    notes: r.notes,
    roomCode: r.room_code,
    roomName: r.room_name,
    roomFloor: r.room_floor,
    active: reservationOccupies(stay) || stay.statusReservation === "EN_CURSO" || stay.statusReservation === "FINALIZADA",
  };
}

async function selectAssignments(exec: Pick<Db, "execute">, where: SQL): Promise<AssignmentView[]> {
  const now = Date.now();
  const list = await rows<AssignmentRow>(exec, sql`
    SELECT a.id, a.reservation_id, a.hotel_room_id, a.check_in, a.check_out, a.notes,
      h.code AS room_code, h.name AS room_name, h.floor AS room_floor,
      r.status AS r_status, r.status_reservation AS r_status_reservation, r.hold_status AS r_hold_status, r.hold_expires_at AS r_hold_expires_at
    FROM hotel_room_assignments a
    JOIN hotel_rooms h ON h.id = a.hotel_room_id
    JOIN reservations r ON r.id = a.reservation_id
    WHERE ${where}`);
  return list.map((r) => toAssignment(r, now));
}

export async function assignmentsForReservations(exec: Pick<Db, "execute">, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, AssignmentView>();
  const list = await selectAssignments(exec, sql`a.reservation_id IN (${idList(ids)})`);
  return new Map(list.map((a) => [a.reservationId, a]));
}

/** Asignaciones vivas de las habitaciones que solapan la estancia (las que pueden chocar). */
async function liveAssignmentsForRooms(exec: Pick<Db, "execute">, roomIds: readonly number[], checkIn: string, checkOut: string) {
  if (roomIds.length === 0) return [];
  const list = await selectAssignments(exec, sql`a.hotel_room_id IN (${idList(roomIds)}) AND a.check_in < ${checkOut} AND a.check_out > ${checkIn}`);
  return list.filter((a) => a.active);
}

interface RoomRow {
  id: number;
  room_type_id: number;
  code: string;
  is_active: number;
  operational_status: string;
  sort_order: number;
}

const toCandidate = (r: RoomRow): RoomCandidate => ({
  id: Number(r.id),
  roomTypeId: Number(r.room_type_id),
  code: r.code,
  isActive: !!Number(r.is_active),
  operationalStatus: r.operational_status,
  sortOrder: Number(r.sort_order),
});

function assertAssignable(r: HotelReservation) {
  if (!r.occupies) bad("La reserva no ocupa habitación (cancelada, anulada, no-show o pago caducado).");
  if (r.statusReservation === "FINALIZADA") bad("La estancia ya terminó.");
  if (r.roomTypeId == null) bad("La reserva no indica la tipología.");
}

async function upsertAssignment(tx: Exec, reservationId: number, hotelRoomId: number, stay: { checkIn: string; checkOut: string }, notes: string | null | undefined) {
  const now = Date.now();
  await tx.insert(hotelRoomAssignments)
    .values({ reservationId, hotelRoomId, checkIn: stay.checkIn, checkOut: stay.checkOut, notes: notes ?? null, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { hotelRoomId, checkIn: stay.checkIn, checkOut: stay.checkOut, notes: notes ?? null, updatedAt: now } });
}

/**
 * Asigna (o cambia) la habitación física de una reserva. Las fechas son las de la reserva; la habitación ha de ser de
 * su tipología, estar en servicio y libre toda la estancia. Con la estancia en curso, el cambio de habitación mueve
 * también el estado (la nueva queda ocupada y la anterior sucia).
 */
export async function assignRoomToReservation(input: { reservationId: number; hotelRoomId: number; notes?: string | null; userId?: number | null }) {
  return pms(() => inTx((tx) => assignLocked(tx, input)));
}

/** Igual que `assignRoomToReservation`, dentro de una transacción ajena (alta de reserva por recepción). */
export async function assignRoomWithinTx(tx: unknown, input: { reservationId: number; hotelRoomId: number; userId?: number | null }) {
  return assignLocked(tx as Exec, input);
}

async function assignLocked(tx: Exec, input: { reservationId: number; hotelRoomId: number; notes?: string | null; userId?: number | null }) {
  const r = await lockReservation(tx, input.reservationId);
  assertAssignable(r);
  const [room] = await rows<RoomRow>(tx, sql`
    SELECT id, room_type_id, code, is_active, operational_status, sort_order FROM hotel_rooms WHERE id = ${input.hotelRoomId} FOR UPDATE`);
  if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada" });
  const stay = { checkIn: r.checkIn, checkOut: r.checkOut };
  const live = await liveAssignmentsForRooms(tx, [input.hotelRoomId], stay.checkIn, stay.checkOut);
  const why = assignmentBlocker(toCandidate(room), r.roomTypeId!, stay, live, r.id);
  if (why) throw new TRPCError({ code: "CONFLICT", message: why });
  const previous = (await assignmentsForReservations(tx, [r.id])).get(r.id) ?? null;
  await upsertAssignment(tx, r.id, input.hotelRoomId, stay, input.notes);
  if (r.statusReservation === "EN_CURSO" && previous && previous.hotelRoomId !== input.hotelRoomId) {
    await setRoomStateLocked(tx, previous.hotelRoomId, "sucia", { userId: input.userId, reason: "Cambio de habitación" });
    await setRoomStateLocked(tx, input.hotelRoomId, "ocupada", { userId: input.userId, reason: "Cambio de habitación" });
  }
  return { ok: true as const, hotelRoomId: input.hotelRoomId, roomCode: room.code };
}

/** Quita la habitación asignada (no con el huésped dentro: entonces se cambia de habitación). */
export async function unassignRoomFromReservation(reservationId: number) {
  return pms(() => inTx(async (tx) => {
    const r = await lockReservation(tx, reservationId);
    if (r.statusReservation === "EN_CURSO") bad("El huésped está alojado: cambia de habitación en lugar de quitarla.");
    await tx.delete(hotelRoomAssignments).where(eq(hotelRoomAssignments.reservationId, reservationId));
    return { ok: true as const };
  }));
}

export type AutoAssignResult =
  | { ok: true; alreadyAssigned: boolean; hotelRoomId: number; roomCode: string }
  | { ok: false; reason: string };

/** Asigna automáticamente la primera habitación libre de la tipología (dentro de `tx`). */
async function autoAssignLocked(tx: Exec, reservationId: number): Promise<AutoAssignResult> {
  const r = await lockReservation(tx, reservationId);
  const existing = (await assignmentsForReservations(tx, [r.id])).get(r.id);
  if (existing) return { ok: true, alreadyAssigned: true, hotelRoomId: existing.hotelRoomId, roomCode: existing.roomCode };
  if (!r.occupies) return { ok: false, reason: "La reserva no ocupa habitación (cancelada, anulada, no-show o pago caducado)." };
  if (r.statusReservation === "FINALIZADA") return { ok: false, reason: "La estancia ya terminó." };
  if (r.roomTypeId == null) return { ok: false, reason: "La reserva no indica la tipología." };
  // Bloquea todas las habitaciones de la tipología (en orden de id: mismo orden en cada transacción)
  const rooms = (await rows<RoomRow>(tx, sql`
    SELECT id, room_type_id, code, is_active, operational_status, sort_order FROM hotel_rooms
    WHERE room_type_id = ${r.roomTypeId} ORDER BY id FOR UPDATE`)).map(toCandidate);
  if (rooms.length === 0) return { ok: false, reason: "La tipología no tiene habitaciones físicas: créalas en Habitaciones." };
  const stay = { checkIn: r.checkIn, checkOut: r.checkOut };
  const live = await liveAssignmentsForRooms(tx, rooms.map((x) => x.id), stay.checkIn, stay.checkOut);
  const room = pickRoomForStay(rooms, r.roomTypeId, stay, live, r.id);
  if (!room) return { ok: false, reason: "No hay habitaciones libres de esa tipología para toda la estancia." };
  await upsertAssignment(tx, r.id, room.id, stay, null);
  return { ok: true, alreadyAssigned: false, hotelRoomId: room.id, roomCode: room.code };
}

export async function autoAssignReservation(reservationId: number) {
  return pms(() => inTx((tx) => autoAssignLocked(tx, reservationId)));
}

/** Asigna automáticamente todas las reservas vivas sin habitación cuya estancia solapa [from, to]. */
export async function autoAssignRange(from: string, to: string) {
  return pms(async () => {
    const d = await db();
    const list = await listHotelReservations({ from, to, limit: 1000 }, d);
    const assigned = await assignmentsForReservations(d, list.map((r) => r.id));
    let ok = 0;
    const failed: Array<{ reservationId: number; reservationNumber: string | null; reason: string }> = [];
    // Primero las que entran antes: así una estancia larga no se queda sin sitio por otras posteriores
    const pending = list
      .filter((r) => !assigned.has(r.id) && r.occupies && r.statusReservation !== "FINALIZADA")
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id - b.id);
    for (const r of pending) {
      const res = await inTx((tx) => autoAssignLocked(tx, r.id));
      if (res.ok) ok++;
      else failed.push({ reservationId: r.id, reservationNumber: r.reservationNumber, reason: res.reason });
    }
    return { assigned: ok, failed };
  });
}

// ─── Listado, planning y recepción ────────────────────────────────────────────

export async function listHotelReservationsWithRooms(f: { from: string; to: string; status?: string; limit?: number }) {
  return pms(async () => {
    const d = await db();
    const list = await listHotelReservations(f, d);
    const byRes = await assignmentsForReservations(d, list.map((r) => r.id));
    return list.map((r) => ({ ...r, assignment: byRes.get(r.id) ?? null }));
  });
}

/** Rack de ocupación: habitaciones, estancias asignadas que solapan [from, to] y reservas vivas sin habitación. */
export async function getRoomPlanning(from: string, to: string) {
  return pms(async () => {
    const d = await db();
    const rooms = await rows<{
      id: number; code: string; name: string | null; floor: string | null; room_type_id: number; room_type_name: string | null;
      is_active: number; operational_status: string; sort_order: number;
    }>(d, sql`
      SELECT h.id, h.code, h.name, h.floor, h.room_type_id, t.name AS room_type_name, h.is_active, h.operational_status, h.sort_order
      FROM hotel_rooms h LEFT JOIN room_types t ON t.id = h.room_type_id
      ORDER BY t.sortOrder, t.name, h.sort_order, h.code`);
    const toExclusive = addDaysIso(to, 1);
    const assignments = (await selectAssignments(d, sql`a.check_in < ${toExclusive} AND a.check_out > ${from}`)).filter((a) => a.active);
    const reservations = await listHotelReservations({ from, to, limit: 1000 }, d);
    const byId = new Map(reservations.map((r) => [r.id, r]));
    const assignedIds = new Set(assignments.map((a) => a.reservationId));
    // Las asignadas fuera del margen de lectura también se pintan: completa sus datos
    const missing = assignments.filter((a) => !byId.has(a.reservationId)).map((a) => a.reservationId);
    if (missing.length) {
      const extra = await rows<ReservationRow>(d, sql`SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id IN (${idList(missing)})`);
      for (const r of extra) {
        const x = toReservation(r, Date.now());
        if (x) byId.set(x.id, x);
      }
    }
    const pick = (r: HotelReservation | undefined) => r && {
      reservationNumber: r.reservationNumber, customerName: r.customerName, status: r.status, statusReservation: r.statusReservation,
      people: r.people, channel: r.channel,
    };
    return {
      today: todayInTimeZone(),
      rooms: rooms.map((r) => ({
        id: Number(r.id), code: r.code, name: r.name, floor: r.floor, roomTypeId: Number(r.room_type_id),
        roomTypeName: r.room_type_name ?? `Tipología ${r.room_type_id}`, isActive: !!Number(r.is_active),
        operationalStatus: r.operational_status, sortOrder: Number(r.sort_order),
      })),
      assignments: assignments.map((a) => ({ ...a, reservation: pick(byId.get(a.reservationId)) ?? null })),
      unassigned: reservations
        .filter((r) => !assignedIds.has(r.id) && r.occupies && r.statusReservation !== "FINALIZADA")
        .map((r) => ({
          reservationId: r.id, reservationNumber: r.reservationNumber, customerName: r.customerName, roomTypeId: r.roomTypeId,
          roomName: r.roomName, checkIn: r.checkIn, checkOut: r.checkOut, status: r.status,
        })),
    };
  });
}

/** Panel de recepción del día (en la zona horaria del hotel): llegadas, salidas, en casa y estado de las habitaciones. */
export async function getReceptionDashboard() {
  return pms(async () => {
    const d = await db();
    const today = todayInTimeZone();
    const list = await listHotelReservations({ from: addDaysIso(today, -30), to: today, limit: 2000 }, d);
    const byRes = await assignmentsForReservations(d, list.map((r) => r.id));
    const withRoom = list.map((r) => ({ ...r, assignment: byRes.get(r.id) ?? null }));
    const s = receptionSummary(withRoom, today);
    const [roomStates, [cap]] = await Promise.all([
      countRoomsByStatus(d),
      rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM hotel_rooms WHERE is_active = 1`),
    ]);
    const physical = Number(cap?.n ?? 0);
    let capacity = physical;
    if (capacity === 0) {
      const [t] = await rows<{ n: number | null }>(d, sql`SELECT SUM(totalUnits) AS n FROM room_types WHERE isActive = 1`);
      capacity = Number(t?.n ?? 0);
    }
    const outOfService = OUT_OF_SERVICE_STATUSES.reduce((acc, k) => acc + (roomStates[k] ?? 0), 0);
    return {
      today,
      arrivals: s.arrivals,
      departures: s.departures,
      inHouse: s.inHouse,
      noShowsToday: s.noShowsToday,
      occupiedTonight: s.occupiedTonight,
      physicalRooms: physical,
      capacity,
      occupancyPct: capacity > 0 ? Math.round((s.occupiedTonight / capacity) * 100) : 0,
      roomsDirty: roomStates["sucia"] ?? 0,
      roomsOutOfService: outOfService,
      roomStates,
    };
  });
}

/**
 * Check-in, check-out o no-show con la máquina de estados de `decideStayTransition`. Actualiza el estado de la
 * estancia (con su rastro en changes_log) y el de la habitación asignada en la misma transacción; en una salida
 * anticipada acorta la asignación para liberar la habitación las noches que quedan.
 */
export async function applyStayTransition(reservationId: number, action: StayAction, userId: number | null) {
  return pms(() => inTx(async (tx) => {
    const r = await lockReservation(tx, reservationId);
    const today = todayInTimeZone();
    const decision = decideStayTransition(r, action, today);
    if (!decision.ok) bad(decision.reason);
    const now = Date.now();
    const label = action === "checkin" ? "check_in" : action === "checkout" ? "check_out" : "no_show";
    const entry = JSON.stringify({ ts: now, actor: userId != null ? `user:${userId}` : "system", action: label, from: r.statusReservation ?? "", to: decision.nextStatusReservation });
    await tx.execute(sql`
      UPDATE reservations SET status_reservation = ${decision.nextStatusReservation}, updated_at = ${now},
        changes_log = JSON_ARRAY_APPEND(COALESCE(changes_log, JSON_ARRAY()), '$', CAST(${entry} AS JSON))
      WHERE id = ${reservationId}`);
    let assignment = (await assignmentsForReservations(tx, [reservationId])).get(reservationId) ?? null;
    if (action === "checkin" && !assignment) {
      // Sin habitación asignada: se intenta la automática; si no hay hueco, el check-in se hace igual (sin habitación)
      const auto = await autoAssignLocked(tx, reservationId);
      if (auto.ok) assignment = (await assignmentsForReservations(tx, [reservationId])).get(reservationId) ?? null;
    }
    if (assignment) {
      if (action === "checkout") {
        const shortened = earlyCheckoutDate(assignment, today);
        if (shortened) await tx.update(hotelRoomAssignments).set({ checkOut: shortened, updatedAt: now }).where(eq(hotelRoomAssignments.reservationId, reservationId));
      }
      const reason = action === "checkin" ? "Check-in" : action === "checkout" ? "Check-out" : "No-show";
      await setRoomStateLocked(tx, assignment.hotelRoomId, decision.roomStatus, { userId, reason });
    }
    return { ok: true as const, statusReservation: decision.nextStatusReservation, roomCode: assignment?.roomCode ?? null };
  }));
}

// ─── Restricciones de estancia (hotel_stay_restrictions) ──────────────────────

export const hotelStayRestrictions = mysqlTable("hotel_stay_restrictions", {
  id: int("id").autoincrement().primaryKey(),
  roomTypeId: int("room_type_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
});

const restrictionKey = (roomTypeId: number, date: string) => `${roomTypeId}|${date}`;

interface RestrictionRow {
  id: number;
  room_type_id: number;
  date: string;
  min_stay: number | null;
  max_stay: number | null;
  closed_to_arrival: number;
  closed_to_departure: number;
}

const toRestriction = (r: RestrictionRow): StayRestriction => ({
  minStay: r.min_stay === null ? null : Number(r.min_stay),
  maxStay: r.max_stay === null ? null : Number(r.max_stay),
  closedToArrival: !!Number(r.closed_to_arrival),
  closedToDeparture: !!Number(r.closed_to_departure),
});

/**
 * Restricciones de estancia de las tipologías en las fechas indicadas. Sin la migración 0032 (tabla ausente) no hay
 * restricciones: el buscador y la reserva pública siguen exactamente como antes.
 */
export async function stayRestrictionsFor(
  exec: Pick<Db, "execute">,
  roomTypeIds: readonly number[],
  dates: readonly string[],
): Promise<Map<string, StayRestriction>> {
  const out = new Map<string, StayRestriction>();
  if (roomTypeIds.length === 0 || dates.length === 0) return out;
  try {
    const list = await rows<RestrictionRow>(exec, sql`
      SELECT id, room_type_id, date, min_stay, max_stay, closed_to_arrival, closed_to_departure FROM hotel_stay_restrictions
      WHERE room_type_id IN (${idList(roomTypeIds)}) AND date IN (${sql.join(dates.map((x) => sql`${x}`), sql`, `)})`);
    for (const r of list) out.set(restrictionKey(Number(r.room_type_id), r.date), toRestriction(r));
  } catch (e) {
    if (!isMissingPmsSchema(e)) throw e;
  }
  return out;
}

export function restrictionAt(map: ReadonlyMap<string, StayRestriction>, roomTypeId: number, date: string) {
  return map.get(restrictionKey(roomTypeId, date)) ?? null;
}

/** Días con alguna restricción de estancia en [from, to] (todas las tipologías o una). */
export async function listStayRestrictions(from: string, to: string, roomTypeId?: number) {
  return pms(async () => {
    const d = await db();
    const list = await rows<RestrictionRow>(d, sql`
      SELECT id, room_type_id, date, min_stay, max_stay, closed_to_arrival, closed_to_departure FROM hotel_stay_restrictions
      WHERE date >= ${from} AND date <= ${to} ${roomTypeId != null ? sql`AND room_type_id = ${roomTypeId}` : sql``}
      ORDER BY date, room_type_id`);
    return list.map((r) => ({ id: Number(r.id), roomTypeId: Number(r.room_type_id), date: r.date, ...toRestriction(r) }));
  });
}

/**
 * Fija las restricciones de estancia de una tipología en cada día de [from, to] (una fila por día). Todo vacío y
 * desactivado las quita. El inventario por día (room_blocks) no cambia.
 */
export async function setStayRestrictions(input: { roomTypeId: number; from: string; to: string; userId?: number | null } & StayRestriction) {
  return pms(() => inTx(async (tx) => {
    const [type] = await rows<{ id: number }>(tx, sql`SELECT id FROM room_types WHERE id = ${input.roomTypeId}`);
    if (!type) bad("La tipología no existe.");
    const minStay = input.minStay && input.minStay > 0 ? input.minStay : null;
    const maxStay = input.maxStay && input.maxStay > 0 ? input.maxStay : null;
    const cta = input.closedToArrival ? 1 : 0;
    const ctd = input.closedToDeparture ? 1 : 0;
    const clear = !minStay && !maxStay && !cta && !ctd;
    const now = Date.now();
    let days = 0;
    for (let date = input.from; date <= input.to; date = addDaysIso(date, 1)) {
      if (clear) {
        await tx.delete(hotelStayRestrictions).where(and(eq(hotelStayRestrictions.roomTypeId, input.roomTypeId), eq(hotelStayRestrictions.date, date)));
      } else {
        await tx.execute(sql`
          INSERT INTO hotel_stay_restrictions (room_type_id, date, min_stay, max_stay, closed_to_arrival, closed_to_departure, created_by, updated_at)
          VALUES (${input.roomTypeId}, ${date}, ${minStay}, ${maxStay}, ${cta}, ${ctd}, ${input.userId ?? null}, ${now})
          ON DUPLICATE KEY UPDATE min_stay = VALUES(min_stay), max_stay = VALUES(max_stay), closed_to_arrival = VALUES(closed_to_arrival),
            closed_to_departure = VALUES(closed_to_departure), created_by = VALUES(created_by), updated_at = VALUES(updated_at)`);
      }
      days++;
    }
    return { ok: true as const, days };
  }));
}

/** Motivo por el que la estancia incumple las restricciones de su tipología (null si las cumple o no hay ninguna). */
export async function stayRestrictionReason(roomTypeId: number, checkIn: string, checkOut: string): Promise<string | null> {
  const map = await stayRestrictionsFor(await db(), [roomTypeId], [checkIn, checkOut]);
  return stayRestrictionViolation(restrictionAt(map, roomTypeId, checkIn), restrictionAt(map, roomTypeId, checkOut), nightsBetween(checkIn, checkOut));
}
