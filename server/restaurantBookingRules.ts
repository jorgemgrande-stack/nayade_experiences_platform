/**
 * Reglas de la reserva pública de restaurante que el servidor aplica SIEMPRE (el formulario web solo las sugiere):
 * turno del restaurante y activo, día de la semana del turno, hora dentro del turno, día sin cierre (total o del
 * turno), fecha no pasada, grupo dentro del máximo y aforo del turno (personas de reservas vivas + las nuevas).
 * Puras: el acceso a datos y el bloqueo del turno están en restaurantsDb.createPublicBooking.
 */

export interface BookingShift {
  id: number;
  restaurantId: number;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  daysOfWeek?: unknown;
  isActive: boolean;
}

export interface BookingClosure {
  shiftId: number | null;
}

/** Estados de reserva que ocupan plaza (los mismos que cuenta la disponibilidad pública). */
export const OCCUPYING_BOOKING_STATUSES = ["confirmed", "pending_payment"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Días de la semana del turno (0 = domingo). Sin dato, todos. */
export function shiftDays(daysOfWeek: unknown): number[] {
  let v = daysOfWeek;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [0, 1, 2, 3, 4, 5, 6];
    }
  }
  if (!Array.isArray(v)) return [0, 1, 2, 3, 4, 5, 6];
  return v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/** Día de la semana de una fecha AAAA-MM-DD (0 = domingo), sin depender de la zona horaria del servidor. */
export function weekdayOf(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  return d.getUTCDay();
}

/** ¿El turno se ofrece ese día? */
export function shiftRunsOn(shift: Pick<BookingShift, "daysOfWeek">, date: string): boolean {
  const wd = weekdayOf(date);
  return wd !== null && shiftDays(shift.daysOfWeek).includes(wd);
}

/** ¿La hora cae dentro del turno? [inicio, fin), admitiendo turnos que cruzan la medianoche. */
export function timeInShift(shift: Pick<BookingShift, "startTime" | "endTime">, time: string): boolean {
  const t = minutesOf(time);
  const s = minutesOf(shift.startTime);
  const e = minutesOf(shift.endTime);
  if (t === null || s === null || e === null) return false;
  if (e > s) return t >= s && t < e;
  return t >= s || t < e; // cruza la medianoche (o turno de 24 h si inicio = fin)
}

/**
 * Motivo por el que NO se puede crear la reserva pública, o null si cabe. `occupiedGuests` son las personas de las
 * reservas vivas de ese turno y fecha (leídas con el turno bloqueado).
 */
export function publicBookingProblem(p: {
  restaurantId: number;
  maxGroupSize: number | null | undefined;
  shift: BookingShift | null | undefined;
  closures: readonly BookingClosure[];
  date: string;
  time: string;
  guests: number;
  occupiedGuests: number;
  today: string;
}): string | null {
  const { shift } = p;
  if (!shift || shift.restaurantId !== p.restaurantId || !shift.isActive) return "El turno elegido no existe o no está disponible.";
  if (weekdayOf(p.date) === null) return "Fecha no válida.";
  if (p.date < p.today) return "No se puede reservar en una fecha pasada.";
  if (!shiftRunsOn(shift, p.date)) return "Ese turno no se ofrece el día elegido.";
  if (!timeInShift(shift, p.time)) return "La hora elegida no está dentro del turno.";
  if (p.closures.some((c) => c.shiftId == null || c.shiftId === shift.id)) return "El restaurante está cerrado ese día o en ese turno.";
  if (!Number.isInteger(p.guests) || p.guests < 1) return "Número de personas no válido.";
  if (p.maxGroupSize != null && p.maxGroupSize > 0 && p.guests > p.maxGroupSize) return `El máximo por reserva online es de ${p.maxGroupSize} personas.`;
  const free = shift.maxCapacity - p.occupiedGuests;
  if (p.guests > free) return free > 0 ? `Solo quedan ${free} plaza${free === 1 ? "" : "s"} en ese turno.` : "Ese turno está completo.";
  return null;
}
