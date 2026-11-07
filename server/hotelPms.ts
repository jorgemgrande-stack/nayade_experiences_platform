/**
 * Hotel Net · núcleo PMS — lógica pura (sin base de datos): estados operativos de las habitaciones físicas, solapes de
 * estancias, elección automática de habitación, máquina de estados de la estancia (check-in, check-out y no-show),
 * restricciones de estancia y resumen del panel de recepción. El acceso a datos vive en `hotelPmsDb.ts`.
 *
 * Fechas de estancia: YYYY-MM-DD; una estancia ocupa las noches de [checkIn, checkOut). Al ser cadenas ISO de ancho
 * fijo, la comparación lexicográfica es la cronológica.
 */

/** Zona horaria por defecto del hotel para decidir qué día es «hoy» en recepción (único sitio donde se fija). */
export const HOTEL_DEFAULT_TIME_ZONE = "Europe/Madrid";

/** Estados operativos de una habitación física (mismos que el PMS de origen). */
export const ROOM_OPERATIONAL_STATUSES = [
  "libre",
  "reservada",
  "ocupada",
  "checkin_pendiente",
  "checkout_pendiente",
  "sucia",
  "limpieza_en_curso",
  "revisada",
  "fuera_de_servicio",
  "bloqueada_mantenimiento",
] as const;
export type RoomOperationalStatus = (typeof ROOM_OPERATIONAL_STATUSES)[number];

/** Estados en los que la habitación no puede recibir huéspedes (no se asigna ni manual ni automáticamente). */
export const OUT_OF_SERVICE_STATUSES: readonly RoomOperationalStatus[] = ["fuera_de_servicio", "bloqueada_mantenimiento"];

export function isRoomOperationalStatus(v: unknown): v is RoomOperationalStatus {
  return typeof v === "string" && (ROOM_OPERATIONAL_STATUSES as readonly string[]).includes(v);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha YYYY-MM-DD real? */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Noches entre dos fechas (0 si el rango no es válido). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return 0;
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. */
export function todayInTimeZone(now: Date = new Date(), timeZone: string = HOTEL_DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ─── Solapes y asignación ─────────────────────────────────────────────────────

export interface Stay {
  checkIn: string;
  checkOut: string;
}

/** Dos estancias [a, b) y [c, d) solapan si a < d y c < b (salir y entrar el mismo día no es solape). */
export function staysOverlap(a: Stay, b: Stay): boolean {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

export interface AssignmentLike extends Stay {
  reservationId: number;
  hotelRoomId: number;
}

/** Primera asignación de la habitación que solapa la estancia pedida (ignorando la propia reserva). */
export function findAssignmentConflict<T extends AssignmentLike>(
  assignments: readonly T[],
  hotelRoomId: number,
  stay: Stay,
  excludeReservationId?: number,
): T | null {
  return (
    assignments.find(
      (a) => a.hotelRoomId === hotelRoomId && a.reservationId !== excludeReservationId && staysOverlap(a, stay),
    ) ?? null
  );
}

export interface RoomCandidate {
  id: number;
  roomTypeId: number;
  code: string;
  isActive: boolean;
  operationalStatus: string;
  sortOrder: number;
}

/** ¿Puede la habitación recibir huéspedes? (activa y no fuera de servicio ni bloqueada por mantenimiento). */
export function roomInService(room: Pick<RoomCandidate, "isActive" | "operationalStatus">): boolean {
  return room.isActive && !(OUT_OF_SERVICE_STATUSES as readonly string[]).includes(room.operationalStatus);
}

/** Motivo por el que la habitación no se puede asignar a la estancia, o null si se puede. */
export function assignmentBlocker(
  room: RoomCandidate,
  roomTypeId: number,
  stay: Stay,
  assignments: readonly AssignmentLike[],
  reservationId: number,
): string | null {
  if (room.roomTypeId !== roomTypeId) return `La habitación ${room.code} es de otra tipología que la reserva.`;
  if (!roomInService(room)) return `La habitación ${room.code} no está en servicio.`;
  const c = findAssignmentConflict(assignments, room.id, stay, reservationId);
  if (c) return `La habitación ${room.code} ya está ocupada del ${c.checkIn} al ${c.checkOut}.`;
  return null;
}

/**
 * Asignación automática: la primera habitación de la tipología en servicio y libre toda la estancia, en el orden de
 * la recepción (orden y código). Devuelve null si no hay ninguna.
 */
export function pickRoomForStay<R extends RoomCandidate>(
  rooms: readonly R[],
  roomTypeId: number,
  stay: Stay,
  assignments: readonly AssignmentLike[],
  reservationId: number,
): R | null {
  const sorted = rooms
    .filter((r) => r.roomTypeId === roomTypeId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "es", { numeric: true }));
  return sorted.find((r) => assignmentBlocker(r, roomTypeId, stay, assignments, reservationId) === null) ?? null;
}

// ─── Estancia: check-in, check-out y no-show ──────────────────────────────────

/** Estado de la reserva necesario para decidir una transición de estancia. */
export interface StayReservation extends Stay {
  /** `reservations.status`: draft | pending_payment | paid | failed | cancelled. */
  status: string;
  /** `reservations.status_reservation`: PENDIENTE_CONFIRMACION | CONFIRMADA | EN_CURSO | FINALIZADA | NO_SHOW | ANULADA. */
  statusReservation: string | null;
  /** `reservations.hold_status` (retenida | confirmada | liberada | conflicto) o null. */
  holdStatus: string | null;
  /** La retención todavía ocupa habitación (no caducó). */
  holdLive: boolean;
}

export type StayAction = "checkin" | "checkout" | "noshow";

export type StayDecision =
  | { ok: true; nextStatusReservation: "EN_CURSO" | "FINALIZADA" | "NO_SHOW"; roomStatus: RoomOperationalStatus }
  | { ok: false; reason: string };

const DEAD = new Set(["cancelled", "failed"]);

/**
 * ¿La reserva ocupa habitación ahora? Cancelada, fallida, anulada o no-show no ocupan; tampoco una pendiente de pago
 * cuya retención caducó o se liberó. Una pagada o confirmada por el personal, sí.
 */
export function reservationOccupies(r: StayReservation): boolean {
  if (DEAD.has(r.status)) return false;
  if (r.statusReservation === "ANULADA" || r.statusReservation === "NO_SHOW") return false;
  if (r.holdStatus === "conflicto") return false;
  if (r.status === "paid") return true;
  if (r.holdStatus === "liberada") return false;
  if (r.holdStatus === "retenida") return r.holdLive;
  return true;
}

/**
 * Máquina de estados de la estancia:
 *  - check-in: reserva viva (no cancelada, fallida, anulada ni caducada), aún sin entrar, y hoy dentro de
 *    [entrada, salida). Antes de la fecha de llegada no se permite.
 *  - check-out: solo con la estancia en curso (no hay check-out sin check-in).
 *  - no-show: reserva viva sin entrar y con la fecha de llegada ya alcanzada.
 */
export function decideStayTransition(r: StayReservation, action: StayAction, today: string): StayDecision {
  const sr = r.statusReservation ?? "PENDIENTE_CONFIRMACION";
  if (action === "checkout") {
    if (sr !== "EN_CURSO") {
      if (sr === "FINALIZADA") return { ok: false, reason: "La estancia ya tiene el check-out hecho." };
      return { ok: false, reason: "No se puede hacer el check-out de una estancia sin check-in." };
    }
    return { ok: true, nextStatusReservation: "FINALIZADA", roomStatus: "sucia" };
  }

  if (DEAD.has(r.status) || sr === "ANULADA") return { ok: false, reason: "La reserva está cancelada." };
  if (sr === "EN_CURSO") return { ok: false, reason: "El huésped ya hizo el check-in." };
  if (sr === "FINALIZADA") return { ok: false, reason: "La estancia ya terminó." };
  if (sr === "NO_SHOW") return { ok: false, reason: "La reserva está marcada como no-show." };
  if (!reservationOccupies(r)) return { ok: false, reason: "La reserva no tiene habitación retenida (pago caducado o en conflicto)." };
  if (today < r.checkIn) return { ok: false, reason: `La llegada es el ${r.checkIn}: aún no se puede ${action === "checkin" ? "hacer el check-in" : "marcar como no-show"}.` };

  if (action === "checkin") {
    if (today >= r.checkOut) return { ok: false, reason: `La estancia terminaba el ${r.checkOut}: ya no admite check-in.` };
    return { ok: true, nextStatusReservation: "EN_CURSO", roomStatus: "ocupada" };
  }
  return { ok: true, nextStatusReservation: "NO_SHOW", roomStatus: "libre" };
}

/**
 * Salida anticipada: al hacer el check-out antes de la fecha prevista, la asignación se acorta hasta hoy para que la
 * habitación quede libre las noches restantes (el mismo día de llegada queda en 0 noches, que no solapa con nada).
 * Devuelve la nueva fecha de salida o null si no cambia.
 */
export function earlyCheckoutDate(stay: Stay, today: string): string | null {
  return today >= stay.checkIn && today < stay.checkOut ? today : null;
}

// ─── Restricciones de estancia ────────────────────────────────────────────────

export interface StayRestriction {
  minStay: number | null;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

/**
 * Motivo por el que una estancia incumple las restricciones (null si las cumple). Se leen las del día de llegada
 * (cerrado a llegadas, estancia mínima y máxima) y las del día de salida (cerrado a salidas). Nulas o a 0, no
 * restringen.
 */
export function stayRestrictionViolation(
  arrival: StayRestriction | null | undefined,
  departure: StayRestriction | null | undefined,
  nights: number,
): string | null {
  if (arrival?.closedToArrival) return "No se admiten llegadas ese día.";
  if (departure?.closedToDeparture) return "No se admiten salidas ese día.";
  if (arrival?.minStay && arrival.minStay > 0 && nights < arrival.minStay) return `La estancia mínima es de ${arrival.minStay} noche${arrival.minStay > 1 ? "s" : ""}.`;
  if (arrival?.maxStay && arrival.maxStay > 0 && nights > arrival.maxStay) return `La estancia máxima es de ${arrival.maxStay} noche${arrival.maxStay > 1 ? "s" : ""}.`;
  return null;
}

/** Valida una restricción antes de guardarla: estancia mínima no mayor que la máxima. */
export function restrictionInputError(r: StayRestriction): string | null {
  if (r.minStay != null && r.minStay < 0) return "La estancia mínima no puede ser negativa.";
  if (r.maxStay != null && r.maxStay < 0) return "La estancia máxima no puede ser negativa.";
  if (r.minStay && r.maxStay && r.minStay > r.maxStay) return "La estancia mínima no puede superar la máxima.";
  return null;
}

// ─── Panel de recepción ───────────────────────────────────────────────────────

export interface ReceptionReservation extends StayReservation {
  id: number;
}

export interface ReceptionSummary<T> {
  arrivals: T[];
  departures: T[];
  inHouse: T[];
  noShowsToday: number;
  occupiedTonight: number;
}

/**
 * Llegadas (entran hoy, o entraban antes y siguen sin check-in ni no-show dentro de su estancia), salidas (salen hoy o
 * debían haber salido y siguen dentro; también las ya salidas hoy), en casa (estancia en curso) y habitaciones
 * ocupadas esta noche (reservas vivas que cubren la noche de hoy).
 */
export function receptionSummary<T extends ReceptionReservation>(rows: readonly T[], today: string): ReceptionSummary<T> {
  const live = (r: T) => reservationOccupies(r) || r.statusReservation === "EN_CURSO";
  const pendingArrival = (r: T) => r.statusReservation !== "EN_CURSO" && r.statusReservation !== "FINALIZADA" && live(r);
  return {
    arrivals: rows.filter((r) => pendingArrival(r) && r.checkIn <= today && today < r.checkOut),
    departures: rows.filter(
      (r) => (r.statusReservation === "EN_CURSO" && r.checkOut <= today) || (r.statusReservation === "FINALIZADA" && r.checkOut === today),
    ),
    inHouse: rows.filter((r) => r.statusReservation === "EN_CURSO"),
    noShowsToday: rows.filter((r) => r.statusReservation === "NO_SHOW" && r.checkIn === today).length,
    occupiedTonight: rows.filter((r) => live(r) && r.statusReservation !== "FINALIZADA" && r.checkIn <= today && today < r.checkOut).length,
  };
}

// ─── Lectura de la reserva de hotel ───────────────────────────────────────────

export interface HotelStayDetails {
  roomTypeId: number | null;
  roomName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
  source: string | null;
}

/**
 * Datos de la estancia de una reserva de hotel: las columnas de la retención (stay_check_in/out, inventory_ref_id)
 * mandan; si faltan, se leen del extras_json que guarda la reserva pública.
 */
export function hotelStayDetails(row: {
  extrasJson: string | null;
  bookingDate: string;
  productId: number;
  productName: string;
  stayCheckIn?: string | null;
  stayCheckOut?: string | null;
  inventoryRefId?: number | null;
}): HotelStayDetails {
  let d: Record<string, unknown> | null = null;
  try {
    d = row.extrasJson ? (JSON.parse(row.extrasJson) as Record<string, unknown>) : null;
  } catch {
    d = null;
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const checkIn = str(row.stayCheckIn) ?? str(d?.checkIn) ?? row.bookingDate ?? null;
  const checkOut = str(row.stayCheckOut) ?? str(d?.checkOut);
  return {
    roomTypeId: row.inventoryRefId ?? num(d?.roomTypeId) ?? row.productId ?? null,
    roomName: str(d?.roomName) ?? row.productName ?? null,
    checkIn,
    checkOut,
    nights: checkIn && checkOut ? nightsBetween(checkIn, checkOut) : num(d?.nights),
    adults: num(d?.adults),
    children: num(d?.children),
    source: str(d?.source),
  };
}
