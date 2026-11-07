/**
 * Hotel Net · fichas de huésped y planes de tarifa — acceso a datos. La lógica vive en `hotelGuests.ts`.
 *
 * Tablas de db/migrations/0043_hotel_huespedes (fuera de drizzle/schema.ts, como las de 0032): sin la migración, las
 * funciones de gestión responden `[module_not_installed]` y el precio (buscador, reserva pública y de recepción) sigue
 * exactamente como antes.
 *
 * Datos personales (RD 933/2021 y RGPD): solo los lee y escribe quien gestiona el hotel (los procedimientos usan el
 * permiso de administración del PMS); no hay ninguna ruta pública. La conservación es configurable y está desactivada
 * por defecto: al vencer el plazo los datos personales se ANONIMIZAN (se vacían), la estancia queda para los informes.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import {
  guestDisplayName,
  guestRegistryErrors,
  normalizeDocNumber,
  retentionCutoff,
  type GuestInput,
  type RatePlanAdjust,
} from "./hotelGuests";
import { db, inTx, isMissingPmsSchema, lockReservation, rows, type Db, type Exec } from "./hotelPmsDb";

export const GUESTS_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] Las fichas de huésped y los planes de tarifa aún no están preparados en tu empresa: falta aplicar la actualización 0043_hotel_huespedes de su base de datos.";

const hotelStayGuests = mysqlTable("hotel_stay_guests", {
  id: int("id").autoincrement().primaryKey(),
  reservationId: int("reservation_id").notNull(),
  guestId: int("guest_id").notNull(),
});

async function guests<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingPmsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: GUESTS_NOT_INSTALLED_MESSAGE, cause: e });
    for (let x: any = e, i = 0; x && i < 5; x = x.cause, i++) {
      if (x.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe un huésped con ese documento.", cause: e });
    }
    throw e;
  }
}

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

// ─── Fichas ───────────────────────────────────────────────────────────────────

interface GuestRow {
  id: number;
  client_id: number | null;
  first_name: string | null;
  last_name: string | null;
  second_last_name: string | null;
  sex: string | null;
  birth_date: string | null;
  nationality: string | null;
  doc_type: string | null;
  doc_number: string | null;
  doc_support_number: string | null;
  doc_issue_date: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  last_stay_at: string | null;
  anonymized_at: number | string | null;
}

const GUEST_COLUMNS = sql.raw(
  "g.id, g.client_id, g.first_name, g.last_name, g.second_last_name, g.sex, g.birth_date, g.nationality, g.doc_type, g.doc_number, " +
    "g.doc_support_number, g.doc_issue_date, g.address, g.city, g.postal_code, g.country, g.phone, g.email, g.notes, g.last_stay_at, g.anonymized_at",
);

const toGuest = (r: GuestRow) => {
  const g = {
    id: Number(r.id), clientId: r.client_id === null ? null : Number(r.client_id), firstName: r.first_name, lastName: r.last_name,
    secondLastName: r.second_last_name, sex: r.sex, birthDate: r.birth_date, nationality: r.nationality, docType: r.doc_type, docNumber: r.doc_number,
    docSupportNumber: r.doc_support_number, docIssueDate: r.doc_issue_date, address: r.address, city: r.city, postalCode: r.postal_code,
    country: r.country, phone: r.phone, email: r.email, notes: r.notes, lastStayAt: r.last_stay_at,
    anonymized: r.anonymized_at !== null,
  };
  return { ...g, displayName: g.anonymized ? "Huésped anonimizado" : guestDisplayName(g) };
};

const clean = (v: string | null | undefined, max: number) => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

function guestValues(g: GuestInput) {
  return {
    first_name: clean(g.firstName, 120), last_name: clean(g.lastName, 160), second_last_name: clean(g.secondLastName, 160), sex: clean(g.sex, 16),
    birth_date: clean(g.birthDate, 10), nationality: clean(g.nationality, 80), doc_type: clean(g.docType, 16), doc_number: normalizeDocNumber(g.docNumber),
    doc_support_number: clean(g.docSupportNumber, 64), doc_issue_date: clean(g.docIssueDate, 10), address: clean(g.address, 255), city: clean(g.city, 120),
    postal_code: clean(g.postalCode, 16), country: clean(g.country, 80), phone: clean(g.phone, 40), email: clean(g.email, 255)?.toLowerCase() ?? null,
  };
}

/** Cliente del CRM con ese correo (no se crean clientes desde aquí: así nunca se duplican). */
async function clientIdByEmail(exec: Pick<Db, "execute">, email: string | null): Promise<number | null> {
  if (!email) return null;
  const [c] = await rows<{ id: number }>(exec, sql`SELECT id FROM clients WHERE email = ${email} LIMIT 1`);
  return c ? Number(c.id) : null;
}

async function writeGuest(tx: Exec, id: number | null, g: GuestInput, opts: { clientEmail: string | null; userId: number | null }): Promise<number> {
  const v = guestValues(g);
  const clientId = await clientIdByEmail(tx, v.email ?? opts.clientEmail);
  const now = Date.now();
  // Un documento ya registrado reutiliza la ficha de esa persona (historial de estancias único)
  if (id == null && v.doc_number) {
    const [same] = await rows<{ id: number }>(tx, sql`
      SELECT id FROM hotel_guests WHERE doc_key = ${`${v.doc_type ?? ""}|${v.doc_number}`} LIMIT 1 FOR UPDATE`);
    if (same) id = Number(same.id);
  }
  const cols = Object.keys(v) as (keyof typeof v)[];
  if (id != null) {
    const sets = cols.map((k) => sql`${sql.raw(k)} = ${v[k]}`);
    await tx.execute(sql`
      UPDATE hotel_guests SET ${sql.join(sets, sql`, `)}, client_id = COALESCE(${clientId}, client_id), anonymized_at = NULL, updated_at = ${now}
      WHERE id = ${id}`);
    return id;
  }
  const [res] = (await tx.execute(sql`
    INSERT INTO hotel_guests (${sql.raw(cols.join(", "))}, client_id, created_by, created_at, updated_at)
    VALUES (${sql.join(cols.map((k) => sql`${v[k]}`), sql`, `)}, ${clientId}, ${opts.userId}, ${now}, ${now})`)) as unknown as [{ insertId: number }];
  return Number(res.insertId);
}

/** Huéspedes de una reserva (titular primero) con lo que falta para el registro de viajeros. */
export async function listStayGuests(reservationId: number) {
  return guests(async () => {
    const d = await db();
    const list = await rows<GuestRow & { is_lead: number; kinship: string | null; check_in: string }>(d, sql`
      SELECT ${GUEST_COLUMNS}, s.is_lead, s.kinship, s.check_in FROM hotel_stay_guests s JOIN hotel_guests g ON g.id = s.guest_id
      WHERE s.reservation_id = ${reservationId} ORDER BY s.is_lead DESC, s.id`);
    return list.map((r) => {
      const g = toGuest(r);
      return { ...g, isLead: !!Number(r.is_lead), kinship: r.kinship, missing: guestRegistryErrors({ ...g, kinship: r.kinship }, r.check_in) };
    });
  });
}

/**
 * Alta o cambio del huésped de una reserva (titular o acompañante). Si el documento ya existe, se actualiza esa ficha
 * y se añade la estancia a su historial. El titular se vincula al cliente del CRM por su correo o el de la reserva.
 */
export async function saveStayGuest(input: { reservationId: number; guestId?: number | null; isLead: boolean; kinship?: string | null; guest: GuestInput; userId: number | null }) {
  return guests(() => inTx(async (tx) => {
    const r = await lockReservation(tx, input.reservationId);
    if (r.status === "cancelled" || r.status === "failed" || r.statusReservation === "ANULADA") bad("La reserva está cancelada.");
    if (input.guestId != null) {
      const [link] = await rows<{ id: number }>(tx, sql`SELECT id FROM hotel_stay_guests WHERE reservation_id = ${r.id} AND guest_id = ${input.guestId}`);
      if (!link) bad("El huésped no es de esta reserva.");
    }
    const guestId = await writeGuest(tx, input.guestId ?? null, input.guest, { clientEmail: input.isLead ? r.customerEmail : null, userId: input.userId });
    if (input.isLead) await tx.execute(sql`UPDATE hotel_stay_guests SET is_lead = 0 WHERE reservation_id = ${r.id} AND guest_id <> ${guestId}`);
    await tx.execute(sql`
      INSERT INTO hotel_stay_guests (reservation_id, guest_id, is_lead, kinship, check_in, check_out, created_by, created_at)
      VALUES (${r.id}, ${guestId}, ${input.isLead ? 1 : 0}, ${clean(input.kinship, 40)}, ${r.checkIn}, ${r.checkOut}, ${input.userId}, ${Date.now()})
      ON DUPLICATE KEY UPDATE is_lead = VALUES(is_lead), kinship = VALUES(kinship), check_in = VALUES(check_in), check_out = VALUES(check_out)`);
    await tx.execute(sql`
      UPDATE hotel_guests SET last_stay_at = (SELECT MAX(check_out) FROM hotel_stay_guests WHERE guest_id = ${guestId}) WHERE id = ${guestId}`);
    return { guestId, missing: guestRegistryErrors({ ...input.guest, kinship: input.kinship ?? null }, r.checkIn) };
  }));
}

/** Quita el huésped de la reserva (la ficha y el resto de su historial se conservan). */
export async function removeStayGuest(reservationId: number, guestId: number) {
  return guests(async () => {
    const d = await db();
    await d.delete(hotelStayGuests).where(and(eq(hotelStayGuests.reservationId, reservationId), eq(hotelStayGuests.guestId, guestId)));
    await d.execute(sql`UPDATE hotel_guests SET last_stay_at = (SELECT MAX(check_out) FROM hotel_stay_guests WHERE guest_id = ${guestId}) WHERE id = ${guestId}`);
    return { ok: true as const };
  });
}

/** Búsqueda por nombre, apellidos, documento, correo o teléfono (máx. 50). */
export async function searchGuests(q: string) {
  return guests(async () => {
    const d = await db();
    const term = q.trim();
    const where: SQL = term
      ? sql`(g.first_name LIKE ${`%${term}%`} OR g.last_name LIKE ${`%${term}%`} OR g.second_last_name LIKE ${`%${term}%`} OR g.doc_number LIKE ${`%${normalizeDocNumber(term) ?? term}%`}
          OR g.email LIKE ${`%${term.toLowerCase()}%`} OR g.phone LIKE ${`%${term}%`} OR CONCAT_WS(' ', g.first_name, g.last_name, g.second_last_name) LIKE ${`%${term}%`})`
      : sql`1 = 1`;
    const list = await rows<GuestRow & { stays: number }>(d, sql`
      SELECT ${GUEST_COLUMNS}, (SELECT COUNT(*) FROM hotel_stay_guests s WHERE s.guest_id = g.id) AS stays
      FROM hotel_guests g WHERE ${where} ORDER BY g.last_stay_at IS NULL, g.last_stay_at DESC, g.id DESC LIMIT 50`);
    return list.map((r) => ({ ...toGuest(r), stays: Number(r.stays) }));
  });
}

/** Ficha con su historial de estancias (más reciente primero). */
export async function guestDetail(id: number) {
  return guests(async () => {
    const d = await db();
    const [r] = await rows<GuestRow>(d, sql`SELECT ${GUEST_COLUMNS} FROM hotel_guests g WHERE g.id = ${id}`);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Huésped no encontrado" });
    const stays = await rows<{ reservation_id: number; is_lead: number; check_in: string; check_out: string; reservation_number: string | null; product_name: string | null; status_reservation: string | null }>(d, sql`
      SELECT s.reservation_id, s.is_lead, s.check_in, s.check_out, r.reservation_number, r.product_name, r.status_reservation
      FROM hotel_stay_guests s LEFT JOIN reservations r ON r.id = s.reservation_id
      WHERE s.guest_id = ${id} ORDER BY s.check_in DESC`);
    return {
      guest: toGuest(r),
      stays: stays.map((s) => ({
        reservationId: Number(s.reservation_id), isLead: !!Number(s.is_lead), checkIn: s.check_in, checkOut: s.check_out,
        reservationNumber: s.reservation_number, roomName: s.product_name, statusReservation: s.status_reservation,
      })),
    };
  });
}

export async function updateGuest(id: number, g: GuestInput, notes: string | null, userId: number | null) {
  return guests(() => inTx(async (tx) => {
    const [r] = await rows<{ id: number }>(tx, sql`SELECT id FROM hotel_guests WHERE id = ${id} FOR UPDATE`);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Huésped no encontrado" });
    await writeGuest(tx, id, g, { clientEmail: null, userId });
    await tx.execute(sql`UPDATE hotel_guests SET notes = ${clean(notes, 1000)} WHERE id = ${id}`);
    return { ok: true as const };
  }));
}

// ─── Conservación ─────────────────────────────────────────────────────────────

export async function getGuestSettings() {
  return guests(async () => {
    const [s] = await rows<{ retention_months: number | null }>(await db(), sql`SELECT retention_months FROM hotel_guest_settings WHERE id = 1`);
    return { retentionMonths: s?.retention_months == null ? null : Number(s.retention_months) };
  });
}

export async function setGuestSettings(retentionMonths: number | null, userId: number | null) {
  return guests(async () => {
    await (await db()).execute(sql`
      INSERT INTO hotel_guest_settings (id, retention_months, updated_by, updated_at) VALUES (1, ${retentionMonths}, ${userId}, ${Date.now()})
      ON DUPLICATE KEY UPDATE retention_months = VALUES(retention_months), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
    return { ok: true as const };
  });
}

/**
 * Anonimiza las fichas cuya última estancia terminó antes del plazo de conservación (desactivado por defecto: no hace
 * nada). Vacía los datos personales y conserva la ficha y sus estancias (sin nombre) para los informes. Idempotente.
 */
export async function anonymizeExpiredGuests(today: string): Promise<{ cutoff: string | null; anonymized: number }> {
  return guests(async () => {
    const { retentionMonths } = await getGuestSettings();
    const cutoff = retentionCutoff(retentionMonths, today);
    if (!cutoff) return { cutoff: null, anonymized: 0 };
    const [res] = (await (await db()).execute(sql`
      UPDATE hotel_guests SET first_name = NULL, last_name = NULL, second_last_name = NULL, sex = NULL, birth_date = NULL, doc_type = NULL,
        doc_number = NULL, doc_support_number = NULL, doc_issue_date = NULL, address = NULL, city = NULL, postal_code = NULL, phone = NULL,
        email = NULL, notes = NULL, client_id = NULL, anonymized_at = ${Date.now()}, updated_at = ${Date.now()}
      WHERE anonymized_at IS NULL AND last_stay_at IS NOT NULL AND last_stay_at < ${cutoff}`)) as unknown as [{ affectedRows: number }];
    return { cutoff, anonymized: Number(res.affectedRows ?? 0) };
  });
}

// ─── Planes de tarifa ─────────────────────────────────────────────────────────

export interface RatePlan extends RatePlanAdjust {
  id: number;
  roomTypeId: number;
  code: string | null;
  name: string;
  description: string | null;
  refundable: boolean;
  includesBreakfast: boolean;
  sortOrder: number;
  isActive: boolean;
}

interface PlanRow {
  id: number; room_type_id: number; code: string | null; name: string; description: string | null; refundable: number; includes_breakfast: number;
  adjust_type: string; adjust_value: number; sort_order: number; is_active: number;
}

const toPlan = (r: PlanRow): RatePlan => ({
  id: Number(r.id), roomTypeId: Number(r.room_type_id), code: r.code, name: r.name, description: r.description, refundable: !!Number(r.refundable),
  includesBreakfast: !!Number(r.includes_breakfast), adjustType: r.adjust_type, adjustValue: Number(r.adjust_value), sortOrder: Number(r.sort_order),
  isActive: !!Number(r.is_active),
});

const PLAN_SELECT = sql.raw("SELECT id, room_type_id, code, name, description, refundable, includes_breakfast, adjust_type, adjust_value, sort_order, is_active FROM hotel_rate_plans");

export async function listRatePlans(roomTypeId?: number) {
  return guests(async () => (await rows<PlanRow>(await db(), sql`${PLAN_SELECT} ${roomTypeId != null ? sql`WHERE room_type_id = ${roomTypeId}` : sql``} ORDER BY room_type_id, sort_order, id`)).map(toPlan));
}

/** Planes activos de las tipologías; sin la migración, ninguno (el precio sigue como siempre). */
export async function activeRatePlans(exec: Pick<Db, "execute">, roomTypeIds: readonly number[]): Promise<RatePlan[]> {
  if (!roomTypeIds.length) return [];
  try {
    return (await rows<PlanRow>(exec, sql`${PLAN_SELECT} WHERE is_active = 1 AND room_type_id IN (${sql.join(roomTypeIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY sort_order, id`)).map(toPlan);
  } catch (e) {
    if (isMissingPmsSchema(e)) return [];
    throw e;
  }
}

/** Plan activo de esa tipología (para reservar con él) o error claro. */
export async function ratePlanForBooking(roomTypeId: number, planId: number): Promise<RatePlan> {
  const plan = (await activeRatePlans(await db(), [roomTypeId])).find((p) => p.id === planId);
  if (!plan) bad("El plan de tarifa no existe, no está activo o no es de esta tipología.");
  return plan!;
}

export async function saveRatePlan(input: Omit<RatePlan, "id"> & { id?: number }) {
  return guests(async () => {
    const d = await db();
    const [t] = await rows<{ id: number }>(d, sql`SELECT id FROM room_types WHERE id = ${input.roomTypeId}`);
    if (!t) bad("La tipología no existe.");
    const now = Date.now();
    if (input.id == null) {
      const [res] = (await d.execute(sql`
        INSERT INTO hotel_rate_plans (room_type_id, code, name, description, refundable, includes_breakfast, adjust_type, adjust_value, sort_order, is_active, created_at, updated_at)
        VALUES (${input.roomTypeId}, ${clean(input.code, 32)}, ${input.name.trim().slice(0, 120)}, ${clean(input.description, 255)}, ${input.refundable ? 1 : 0},
          ${input.includesBreakfast ? 1 : 0}, ${input.adjustType}, ${input.adjustValue}, ${input.sortOrder}, ${input.isActive ? 1 : 0}, ${now}, ${now})`)) as unknown as [{ insertId: number }];
      return { id: Number(res.insertId) };
    }
    await d.execute(sql`
      UPDATE hotel_rate_plans SET room_type_id = ${input.roomTypeId}, code = ${clean(input.code, 32)}, name = ${input.name.trim().slice(0, 120)},
        description = ${clean(input.description, 255)}, refundable = ${input.refundable ? 1 : 0}, includes_breakfast = ${input.includesBreakfast ? 1 : 0},
        adjust_type = ${input.adjustType}, adjust_value = ${input.adjustValue}, sort_order = ${input.sortOrder}, is_active = ${input.isActive ? 1 : 0},
        updated_at = ${now}
      WHERE id = ${input.id}`);
    return { id: input.id };
  });
}
