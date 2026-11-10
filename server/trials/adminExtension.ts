/**
 * Ampliación ADMINISTRATIVA de una prueba gratuita (decisión del equipo desde el CRM), separada de la ampliación de
 * autoservicio (`approve_extension`, con su tope de ampliaciones y días) y de la facturación simulada.
 *
 *  - Se indica la nueva fecha de fin (día civil en hora de España: la prueba dura hasta las 23:59:59 de ese día) o los
 *    días que se añaden (desde el fin actual, o desde ahora si ya venció).
 *  - Vale también para una prueba vencida. Nunca acorta la prueba ni la deja en el pasado.
 *  - Queda en el historial de la prueba (`admin_extend`) con el operador, la fecha, el motivo, el fin anterior y el
 *    nuevo, y la clave de idempotencia: repetir la misma operación (p. ej. tras un corte de red) no amplía dos veces.
 *  - Sin cobros, facturas, cambios de precio ni segunda suscripción: solo mueve el fin de la prueba; la suscripción en
 *    prueba y la caducidad de sus licencias se alinean después (`TrialOnboardingService.syncLicences`).
 *
 * Este fichero es puro (sin E/S): cálculo de la nueva fecha y formato del detalle del historial (máx. 300 caracteres).
 */

const DAY = 86_400_000;
/** Tope de seguridad de la nueva fecha: un año desde hoy. */
export const ADMIN_EXTENSION_MAX_AHEAD_MS = 366 * DAY;
/** Días que se pueden añadir de una vez. */
export const ADMIN_EXTENSION_MAX_DAYS = 366;
export const ADMIN_EXTENSION_REASON_MIN = 5;
export const ADMIN_EXTENSION_REASON_MAX = 160;
export const ADMIN_EXTENSION_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type AdminExtensionInput = { until: string; days?: undefined } | { days: number; until?: undefined };

/** Desfase de Madrid (ms) en un instante: hora local − UTC. */
function madridOffset(t: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** Instante UTC de las 00:00 de Madrid de un día AAAA-MM-DD (con el desfase de esa medianoche). */
export function madridMidnight(iso: string): number {
  const base = Date.parse(`${iso}T00:00:00Z`);
  let t = base - madridOffset(base);
  t = base - madridOffset(t);
  return t;
}

/** Día civil (AAAA-MM-DD) de un instante en Madrid. */
export function madridDay(at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Último segundo (23:59:59) de un día civil en Madrid. */
export function madridEndOfDay(iso: string): number {
  const next = new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
  return madridMidnight(next) - 1000;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class AdminExtensionInputError extends Error {}

/**
 * Nueva fecha de fin. Lanza `AdminExtensionInputError` (mensaje para el operador) si no es válida: fecha mal formada,
 * no posterior al fin actual, en el pasado o más allá del tope.
 */
export function planAdminExtension(current: { endsAt: number | null }, input: AdminExtensionInput, now: number): { before: number | null; after: number } {
  let after: number;
  if (input.until !== undefined) {
    if (!ISO_DAY.test(input.until) || Number.isNaN(Date.parse(`${input.until}T12:00:00Z`)) || new Date(`${input.until}T12:00:00Z`).toISOString().slice(0, 10) !== input.until) {
      throw new AdminExtensionInputError("Fecha no válida (AAAA-MM-DD)");
    }
    after = madridEndOfDay(input.until);
  } else {
    const days = input.days;
    if (!Number.isInteger(days) || days < 1 || days > ADMIN_EXTENSION_MAX_DAYS) throw new AdminExtensionInputError(`Entre 1 y ${ADMIN_EXTENSION_MAX_DAYS} días`);
    after = Math.max(current.endsAt ?? now, now) + days * DAY;
  }
  if (after <= now) throw new AdminExtensionInputError("La nueva fecha de fin tiene que ser futura");
  if (current.endsAt !== null && after <= current.endsAt) throw new AdminExtensionInputError("La nueva fecha de fin tiene que ser posterior a la actual");
  if (after > now + ADMIN_EXTENSION_MAX_AHEAD_MS) throw new AdminExtensionInputError("Como mucho, un año desde hoy");
  return { before: current.endsAt, after };
}

export interface AdminExtensionDetail {
  before: number | null;
  after: number;
  key: string;
  reason: string;
}

/** Detalle del historial (JSON compacto, ≤ 300 caracteres: el motivo se recorta si hiciera falta). */
export function encodeAdminExtensionDetail(d: AdminExtensionDetail): string {
  let reason = d.reason.trim().slice(0, ADMIN_EXTENSION_REASON_MAX);
  for (;;) {
    const s = JSON.stringify({ before: d.before, after: d.after, key: d.key, reason });
    if (s.length <= 300 || !reason) return s;
    reason = reason.slice(0, -10);
  }
}

export function decodeAdminExtensionDetail(detail: string | null): AdminExtensionDetail | null {
  if (!detail || !detail.startsWith("{")) return null;
  try {
    const v = JSON.parse(detail) as Partial<AdminExtensionDetail>;
    if (typeof v.after !== "number" || typeof v.key !== "string") return null;
    return { before: typeof v.before === "number" ? v.before : null, after: v.after, key: v.key, reason: typeof v.reason === "string" ? v.reason : "" };
  } catch {
    return null;
  }
}
