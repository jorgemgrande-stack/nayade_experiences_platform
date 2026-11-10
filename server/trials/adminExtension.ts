/**
 * Ampliación ADMINISTRATIVA de una prueba gratuita (decisión del equipo desde el CRM), separada de la ampliación de
 * autoservicio (`approve_extension`, con su tope de ampliaciones y días) y de la facturación simulada.
 *
 * Decisión de Jorge (10/11/2026): SIN LÍMITES. Sin tope de ampliaciones, de días ni de duración acumulada; vale para
 * pruebas activas, vencidas o ya ampliadas, y no consume el cupo del autoservicio. Solo se conservan las validaciones
 * TÉCNICAS de una fecha válida: posterior a ahora y al fin actual (ampliar nunca acorta), y anterior al año 2100.
 *
 *  - Se indica la nueva fecha (día civil, hasta las 23:59:59, o fecha y hora, siempre en hora de España) o los días que
 *    se añaden (desde el fin actual, o desde ahora si ya venció).
 *  - Queda en el historial de la prueba (`admin_extend`, solo de anexado) con el operador, la fecha, el motivo, el fin
 *    anterior y el nuevo, los días añadidos y la clave de idempotencia; el resultado de la propagación a las licencias
 *    se anota aparte (`admin_extend_result`). Repetir la misma clave no amplía dos veces.
 *  - Sin cobros, facturas, cambios de precio ni segunda suscripción.
 *
 * Este fichero es puro (sin E/S): cálculo de la nueva fecha y formato del detalle del historial (máx. 300 caracteres).
 */

const DAY = 86_400_000;
/** Validación técnica (no comercial): una fecha anterior al 01/01/2100. */
export const ADMIN_EXTENSION_TECHNICAL_LIMIT = Date.UTC(2100, 0, 1);
export const ADMIN_EXTENSION_REASON_MIN = 5;
export const ADMIN_EXTENSION_REASON_MAX = 160;
export const ADMIN_EXTENSION_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** «AAAA-MM-DD» (hasta las 23:59:59) o «AAAA-MM-DDTHH:mm» (hora de España). */
export const ADMIN_EXTENSION_UNTIL_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

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

/**
 * Instante UTC de una hora de pared de Madrid (AAAA-MM-DD y HH:mm:ss). Se calcula con el desfase de ESE instante (dos
 * pasadas), así que el día del cambio de hora también sale bien.
 */
export function madridWallTime(iso: string, time = "00:00:00"): number {
  const base = Date.parse(`${iso}T${time}Z`);
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
  return madridWallTime(iso, "23:59:59");
}

export class AdminExtensionInputError extends Error {}

const validDay = (iso: string) => !Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;

/** Instante de `until`: el día entero (23:59:59) o la fecha y hora indicadas, en hora de España. */
export function untilInstant(until: string): number {
  if (!ADMIN_EXTENSION_UNTIL_RE.test(until)) throw new AdminExtensionInputError("Fecha no válida (AAAA-MM-DD o AAAA-MM-DDTHH:mm)");
  const [day, time] = until.split("T");
  if (!validDay(day)) throw new AdminExtensionInputError("Fecha no válida");
  if (time === undefined) return madridEndOfDay(day);
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) throw new AdminExtensionInputError("Hora no válida");
  return madridWallTime(day, `${time}:00`);
}

/**
 * Nueva fecha de fin. Lanza `AdminExtensionInputError` (mensaje para el operador) si no es TÉCNICAMENTE válida: fecha
 * mal formada, no posterior a ahora ni al fin actual, o a partir de 2100. Sin límites comerciales.
 */
export function planAdminExtension(current: { endsAt: number | null }, input: AdminExtensionInput, now: number): { before: number | null; after: number; days: number } {
  let after: number;
  if (input.until !== undefined) after = untilInstant(input.until);
  else {
    const days = input.days;
    if (!Number.isSafeInteger(days) || days < 1) throw new AdminExtensionInputError("Indica un número entero de días (1 o más)");
    after = addMadridDays(Math.max(current.endsAt ?? now, now), days);
  }
  if (!Number.isSafeInteger(after) || after >= ADMIN_EXTENSION_TECHNICAL_LIMIT) throw new AdminExtensionInputError("Fecha no válida: tiene que ser anterior a 2100");
  if (after <= now) throw new AdminExtensionInputError("La nueva fecha de fin tiene que ser futura");
  if (current.endsAt !== null && after <= current.endsAt) throw new AdminExtensionInputError("La nueva fecha de fin tiene que ser posterior a la actual");
  // Días añadidos sobre el fin vigente (o desde ahora si ya había vencido), con dos decimales (por días: los indicados)
  const days = input.days !== undefined ? input.days : Math.round(((after - Math.max(current.endsAt ?? now, now)) / DAY) * 100) / 100;
  return { before: current.endsAt, after, days };
}

/**
 * Suma N días CIVILES de España conservando la hora local (un cambio de hora en medio no desplaza el fin una hora):
 * p. ej. 23:59:59 del 20/10 + 10 días = 23:59:59 del 30/10, aunque el 25/10 cambie la hora.
 */
export function addMadridDays(at: number, days: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + days, 12)).toISOString().slice(0, 10);
  return madridWallTime(day, `${p.hour}:${p.minute}:${p.second}`) + (at % 1000);
}

/** Huella corta de la entrada (para detectar la misma clave de idempotencia reutilizada con otros datos). */
export function adminExtensionInputTag(input: AdminExtensionInput): string {
  return input.until !== undefined ? `u:${input.until}` : `d:${input.days}`;
}

export interface AdminExtensionDetail {
  before: number | null;
  after: number;
  days: number;
  key: string;
  /** Entrada de la operación (`adminExtensionInputTag`). */
  input?: string;
  reason: string;
}

/** Detalle del historial (JSON compacto, ≤ 300 caracteres: el motivo se recorta si hiciera falta). */
export function encodeAdminExtensionDetail(d: AdminExtensionDetail): string {
  let reason = d.reason.trim().slice(0, ADMIN_EXTENSION_REASON_MAX);
  for (;;) {
    const s = JSON.stringify({ before: d.before, after: d.after, days: d.days, key: d.key, input: d.input, reason });
    if (s.length <= 300 || !reason) return s;
    reason = reason.slice(0, -10);
  }
}

export function decodeAdminExtensionDetail(detail: string | null): AdminExtensionDetail | null {
  if (!detail || !detail.startsWith("{")) return null;
  try {
    const v = JSON.parse(detail) as Partial<AdminExtensionDetail>;
    if (typeof v.after !== "number" || typeof v.key !== "string") return null;
    return { before: typeof v.before === "number" ? v.before : null, after: v.after, days: typeof v.days === "number" ? v.days : 0, key: v.key, ...(typeof v.input === "string" ? { input: v.input } : {}), reason: typeof v.reason === "string" ? v.reason : "" };
  } catch {
    return null;
  }
}

/** Resultado de la propagación a las licencias, anotado tras cada ampliación (y en cada reintento con la misma clave). */
export interface AdminExtensionResultDetail {
  key: string;
  /** `applied`: derechos efectivos actualizados; `pending`: no se pudo, la reconciliación periódica lo reintenta. */
  result: "applied" | "pending";
  subscriptionId: number | null;
  licencesChanged: number;
  reason: string | null;
}
export function encodeAdminExtensionResult(d: AdminExtensionResultDetail): string {
  return JSON.stringify(d).slice(0, 300);
}
