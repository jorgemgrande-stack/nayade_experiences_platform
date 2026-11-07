/**
 * Hotel Net · check-in online (capacidad `hotel-net` + módulo de hotel activo).
 *
 *  - Recepción emite un enlace por reserva (`net_public_links`, tipo `hotel_checkin`) con token opaco que caduca al
 *    terminar el día de llegada. Emitir otro revoca el anterior; también se puede revocar sin más.
 *  - El huésped rellena el registro de viajeros con los MISMOS campos de la ficha de huésped del PMS (0043,
 *    server/hotelGuests.ts) y su misma validación (RD 933/2021). No se piden datos de pago.
 *  - Lo enviado queda en `hotel_online_checkins` (pendiente) y el huésped puede corregirlo con el mismo enlace hasta el
 *    día de llegada. Recepción lo ve en la reserva y lo APLICA a las fichas (server/hotelGuestsDb.saveStayGuest, con
 *    su usuario: la ficha que ya existe con ese documento la decide recepción, nunca el enlace) o lo descarta. Al
 *    aplicarlo o descartarlo se vacían los datos enviados y el enlace deja de valer.
 *  - La página nunca muestra datos de otras fichas: solo lo que el propio huésped ha enviado con su enlace.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getModuleAccess } from "../_core/modules/runtime";
import { getFeatureFlag } from "../config";
import { HOTEL_CAPABILITY } from "../hotelFolioCharges";
import { DOC_TYPES, SEXES, guestDisplayName, guestRegistryErrors, type GuestInput } from "../hotelGuests";
import { listStayGuests, saveStayGuest } from "../hotelGuestsDb";
import { addDaysIso, isIsoDate, todayInTimeZone } from "../hotelPms";
import { db, lockReservation, type HotelReservation } from "../hotelPmsDb";
import { activeLink, affected, issueLink, revokeLink, rows, withLinksDb, type NetLink } from "./links";
import { publicUrl } from "./html";

/** Huéspedes por envío (titular y acompañantes). */
export const MAX_CHECKIN_GUESTS = 8;

export const GUEST_FIELDS = [
  "firstName", "lastName", "secondLastName", "sex", "birthDate", "nationality", "docType", "docNumber", "docSupportNumber", "docIssueDate",
  "address", "city", "postalCode", "country", "phone", "email", "kinship",
] as const;
export type GuestField = (typeof GUEST_FIELDS)[number];

const opt = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().optional();
const isoOpt = z.string().trim().transform((s) => s || null).nullable().optional().refine((v) => v == null || isIsoDate(v), "Fecha no válida (AAAA-MM-DD)");
/** Mismos campos y longitudes que la ficha de recepción (server/routers/hotel.ts, guestFields). */
export const onlineGuestSchema = z.object({
  firstName: opt(120), lastName: opt(160), secondLastName: opt(160),
  sex: z.union([z.enum(SEXES), z.literal("")]).optional().transform((v) => v || null),
  birthDate: isoOpt, nationality: opt(80),
  docType: z.union([z.enum(DOC_TYPES), z.literal("")]).optional().transform((v) => v || null),
  docNumber: opt(64), docSupportNumber: opt(64), docIssueDate: isoOpt,
  address: opt(255), city: opt(120), postalCode: opt(16), country: opt(80), phone: opt(40),
  email: z.string().trim().max(255).optional().transform((s) => s || null).refine((v) => v == null || z.string().email().safeParse(v).success, "Correo no válido"),
  kinship: opt(40),
});
export type OnlineGuest = GuestInput;

const isEmptyGuest = (g: Record<string, unknown>) => GUEST_FIELDS.every((f) => g[f] == null || String(g[f]).trim() === "");

/**
 * Huéspedes del formulario (`g<i>_<campo>`) validados como en recepción. Los bloques vacíos se ignoran; hace falta al
 * menos uno y todos los rellenados deben estar completos para el registro de viajeros a la fecha de llegada.
 */
export function guestsFromForm(body: Record<string, unknown>, slots: number, checkIn: string): { guests: OnlineGuest[]; values: Array<Record<string, string>>; errors: string[] } {
  const guests: OnlineGuest[] = [];
  const values: Array<Record<string, string>> = [];
  const errors: string[] = [];
  for (let i = 0; i < slots; i++) {
    const raw: Record<string, string> = {};
    for (const f of GUEST_FIELDS) {
      const v = body[`g${i}_${f}`];
      raw[f] = typeof v === "string" ? v.slice(0, 300) : "";
    }
    values.push(raw);
    if (isEmptyGuest(raw)) continue;
    const p = onlineGuestSchema.safeParse(raw);
    const label = i === 0 ? "Titular" : `Acompañante ${i}`;
    if (!p.success) {
      errors.push(`${label}: ${p.error.issues[0]?.message ?? "datos no válidos"}.`);
      continue;
    }
    const g = p.data as OnlineGuest;
    for (const e of guestRegistryErrors(g, checkIn)) errors.push(`${label}: ${e}`);
    guests.push(g);
  }
  if (!guests.length && !errors.length) errors.push("Rellena al menos los datos del titular.");
  return { guests, values, errors };
}

/** ¿Está el check-in online disponible? Hotel Net activo, módulo de hotel disponible y activado. Si no se sabe, no. */
export async function onlineCheckinAvailable(): Promise<boolean> {
  try {
    if (!(await getCapabilityAccess().check(HOTEL_CAPABILITY, { write: true })).allowed) return false;
    if (!(await getModuleAccess().isModuleAvailable("hotel"))) return false;
    return await getFeatureFlag("hotel_module_enabled", false);
  } catch {
    return false;
  }
}

const CLOSED = new Set(["EN_CURSO", "FINALIZADA", "NO_SHOW", "ANULADA"]);

/** Motivo por el que la reserva ya no admite check-in online (null = lo admite). */
export function checkinClosedReason(r: Pick<HotelReservation, "status" | "statusReservation" | "checkIn">, today: string): string | null {
  if (r.status === "cancelled" || r.status === "failed" || r.statusReservation === "ANULADA") return "La reserva está cancelada.";
  if (r.statusReservation && CLOSED.has(r.statusReservation)) return "La llegada ya se ha registrado en recepción.";
  if (r.checkIn < today) return "La fecha de llegada ya ha pasado.";
  return null;
}

/** Fin del día de llegada (con margen de zona horaria): el enlace no vale después. */
export const checkinExpiry = (checkIn: string) => Date.parse(`${addDaysIso(checkIn, 1)}T02:00:00Z`);

async function reservation(id: number): Promise<HotelReservation | null> {
  try {
    return await lockReservation(await db(), id);
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

export interface Submission {
  id: number;
  linkId: number;
  status: "pending" | "applied" | "discarded";
  guests: OnlineGuest[];
  guestCount: number;
  submittedAt: number;
  updatedAt: number;
  decidedAt: number | null;
}
const toSubmission = (r: any): Submission => {
  let guests: OnlineGuest[] = [];
  try {
    guests = r.guests_json ? JSON.parse(String(r.guests_json)) : [];
  } catch {
    guests = [];
  }
  return {
    id: Number(r.id), linkId: Number(r.link_id), status: r.status, guests, guestCount: Number(r.guest_count), submittedAt: Number(r.submitted_at),
    updatedAt: Number(r.updated_at), decidedAt: r.decided_at == null ? null : Number(r.decided_at),
  };
};

// ─── Pública ───────────────────────────────────────────────────────────────────

export interface PublicCheckin {
  reservation: HotelReservation;
  slots: number;
  submission: Submission | null;
  closedReason: string | null;
}

/** Reserva y envío del enlace. null si la reserva ya no existe. */
export async function checkinOfLink(link: NetLink): Promise<PublicCheckin | null> {
  const r = await reservation(link.targetId);
  if (!r) return null;
  const [s] = await withLinksDb(async (d) => rows(d, sql`SELECT * FROM hotel_online_checkins WHERE link_id = ${link.id}`));
  const submission = s ? toSubmission(s) : null;
  const people = Math.max(1, Number(r.people || 0), Number(r.adults ?? 0) + Number(r.children ?? 0));
  let closedReason = checkinClosedReason(r, todayInTimeZone());
  if (!closedReason && submission && submission.status !== "pending") closedReason = "Recepción ya ha registrado estos datos.";
  return { reservation: r, slots: Math.min(MAX_CHECKIN_GUESTS, people), submission, closedReason };
}

/** Guarda (o corrige) lo enviado con el enlace mientras siga pendiente. */
export function saveSubmission(link: NetLink, reservationId: number, guests: OnlineGuest[], now = Date.now()): Promise<boolean> {
  return withLinksDb(async (d) => {
    const json = JSON.stringify(guests);
    await d.execute(sql`INSERT INTO hotel_online_checkins (reservation_id, link_id, status, guests_json, guest_count, submitted_at, updated_at)
      VALUES (${reservationId}, ${link.id}, 'pending', ${json}, ${guests.length}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE guests_json = IF(status = 'pending', VALUES(guests_json), guests_json), guest_count = IF(status = 'pending', VALUES(guest_count), guest_count),
        updated_at = IF(status = 'pending', VALUES(updated_at), updated_at)`);
    const [s] = await rows(d, sql`SELECT status FROM hotel_online_checkins WHERE link_id = ${link.id}`);
    await d.execute(sql`UPDATE net_public_links SET uses = uses + 1, last_used_at = ${now} WHERE id = ${link.id}`);
    return s?.status === "pending";
  });
}

// ─── Recepción ─────────────────────────────────────────────────────────────────

async function assertAvailable(): Promise<void> {
  if (!(await onlineCheckinAvailable())) throw new TRPCError({ code: "FORBIDDEN", message: "El check-in online necesita Hotel Net activo en tu plan." });
}

async function panel<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === "NetLinksNotInstalled") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El check-in online aún no está instalado en esta empresa (falta la actualización 0046_net_rutas_publicas)." });
    }
    throw e;
  }
}

async function latestSubmission(reservationId: number): Promise<Submission | null> {
  const [s] = await withLinksDb(async (d) => rows(d, sql`SELECT * FROM hotel_online_checkins WHERE reservation_id = ${reservationId} ORDER BY (status = 'pending') DESC, id DESC LIMIT 1`));
  return s ? toSubmission(s) : null;
}

/** Estado del check-in online de la reserva: enlace activo (sin token) y lo enviado con lo que le falta. */
export function checkinStatus(reservationId: number) {
  return panel(async () => {
    const r = await reservation(reservationId);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva de hotel no encontrada." });
    const [link, s] = await Promise.all([activeLink("hotel_checkin", reservationId), latestSubmission(reservationId)]);
    return {
      available: await onlineCheckinAvailable(),
      closedReason: checkinClosedReason(r, todayInTimeZone()),
      link: link ? { createdAt: link.createdAt, expiresAt: link.expiresAt, uses: link.uses, lastUsedAt: link.lastUsedAt } : null,
      submission: s
        ? {
            id: s.id, status: s.status, submittedAt: s.submittedAt, updatedAt: s.updatedAt, decidedAt: s.decidedAt, guestCount: s.guestCount,
            guests: s.guests.map((g) => ({ ...g, displayName: guestDisplayName(g), missing: guestRegistryErrors(g, r.checkIn) })),
          }
        : null,
    };
  });
}

/** Emite (o rota) el enlace de check-in. La URL con el token solo se devuelve aquí, una vez. */
export function issueCheckinLink(reservationId: number, actor: string) {
  return panel(async () => {
    await assertAvailable();
    const r = await reservation(reservationId);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva de hotel no encontrada." });
    const closed = checkinClosedReason(r, todayInTimeZone());
    if (closed) throw new TRPCError({ code: "BAD_REQUEST", message: `No se puede enviar el check-in online: ${closed}` });
    const { link, token } = await issueLink({ kind: "hotel_checkin", targetId: reservationId, expiresAt: checkinExpiry(r.checkIn), actor });
    return { url: publicUrl(`/check-in/${token}`), expiresAt: link.expiresAt, email: r.customerEmail };
  });
}

export function revokeCheckinLink(reservationId: number, actor: string) {
  return panel(async () => ({ revoked: (await revokeLink("hotel_checkin", reservationId, actor)) > 0 }));
}

/**
 * Recepción aplica lo enviado a las fichas de huésped de la reserva (titular si aún no hay, después acompañantes). Se
 * puede repetir sin duplicar (la ficha se reconoce por su documento). Después se vacían los datos y el enlace se cierra.
 */
export function applyCheckin(reservationId: number, userId: number) {
  return panel(async () => {
    await assertAvailable();
    const s = await latestSubmission(reservationId);
    if (!s || s.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "No hay datos pendientes de aplicar." });
    const current = await listStayGuests(reservationId);
    let hasLead = current.some((g) => g.isLead);
    const results: Array<{ guestId: number; missing: string[] }> = [];
    for (const g of s.guests) {
      const isLead = !hasLead;
      results.push(await saveStayGuest({ reservationId, guestId: null, isLead, kinship: g.kinship ?? null, guest: g, userId }));
      hasLead = true;
    }
    await withLinksDb(async (d) => {
      await d.execute(sql`UPDATE hotel_online_checkins SET status = 'applied', guests_json = NULL, decided_by = ${userId}, decided_at = ${Date.now()} WHERE id = ${s.id} AND status = 'pending'`);
      await d.execute(sql`UPDATE net_public_links SET status = 'used', used_at = ${Date.now()} WHERE id = ${s.linkId} AND status = 'active'`);
    });
    return { applied: results.length, incomplete: results.filter((x) => x.missing.length > 0).length };
  });
}

export function discardCheckin(reservationId: number, userId: number) {
  return panel(async () => {
    const s = await latestSubmission(reservationId);
    if (!s || s.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "No hay datos pendientes." });
    const n = await withLinksDb(async (d) =>
      (await affected(d, sql`UPDATE hotel_online_checkins SET status = 'discarded', guests_json = NULL, decided_by = ${userId}, decided_at = ${Date.now()} WHERE id = ${s.id} AND status = 'pending'`)).affectedRows,
    );
    return { discarded: n === 1 };
  });
}
