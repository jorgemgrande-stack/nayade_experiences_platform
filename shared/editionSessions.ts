/**
 * Sesiones de una convocatoria: un paquete que se vende una sola vez con varias fechas (p. ej. 4 sesiones de 90 min).
 * Solo reglas puras (validación, serie semanal, orden, fechas derivadas y lo que se publica), sin servidor ni navegador.
 *
 * - Una inscripción por paquete: las personas confirmadas de la convocatoria son las participantes de todas sus sesiones.
 * - `startTime` null = «hora por confirmar»: nunca se inventa una hora.
 * - `privateNote` (p. ej. el enlace de la videollamada) es solo para el equipo: no sale en la web ni se envía.
 */
import { isValidTimeZone, localToUtcMs } from "./editions";

export const SESSION_STATUSES = ["scheduled", "done", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { scheduled: "Programada", done: "Realizada", cancelled: "Cancelada" };

export const SESSION_LIMITS = { perEdition: 100, title: 160, privateNote: 600, durationMin: 1, durationMax: 1440, minYear: 2000, maxYear: 2100, maxIntervalWeeks: 8 } as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface SessionInput {
  /** «YYYY-MM-DD» (día local de la sesión) */
  startsOn: string;
  /** «HH:mm» o null = hora por confirmar */
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  title: string;
  status: SessionStatus;
  /** Solo para el equipo; no se publica */
  privateNote: string;
}

export interface SessionLike {
  id: number;
  position: number;
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  status: SessionStatus;
}

/** ¿Es «YYYY-MM-DD» una fecha real dentro de un margen razonable? */
export function isValidSessionDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  if (y < SESSION_LIMITS.minYear || y > SESSION_LIMITS.maxYear) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isValidSessionTime = (s: string): boolean => TIME_RE.test(s);

/** «18:00:00» (MySQL TIME) o «18:00» → «18:00»; vacío o null → null. */
export function normalizeTime(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const t = `${m[1].padStart(2, "0")}:${m[2]}`;
  return isValidSessionTime(t) ? t : null;
}

/** Clave para detectar duplicados: misma fecha y misma hora (dos «hora por confirmar» el mismo día también chocan). */
export const sessionSlotKey = (s: { startsOn: string; startTime: string | null }) => `${s.startsOn}|${s.startTime ?? "tbc"}`;

/** Errores por campo (texto para la persona); vacío = válido. */
export function validateSessionInput(s: SessionInput): Partial<Record<keyof SessionInput, string>> {
  const out: Partial<Record<keyof SessionInput, string>> = {};
  if (!isValidSessionDate(s.startsOn)) out.startsOn = "Indica una fecha válida.";
  if (s.startTime !== null && !isValidSessionTime(s.startTime)) out.startTime = "La hora no es válida (por ejemplo 18:00). Déjala vacía si aún no se sabe.";
  if (s.durationMinutes !== null && (!Number.isInteger(s.durationMinutes) || s.durationMinutes < SESSION_LIMITS.durationMin || s.durationMinutes > SESSION_LIMITS.durationMax)) out.durationMinutes = `La duración debe ser un número de minutos entre ${SESSION_LIMITS.durationMin} y ${SESSION_LIMITS.durationMax}.`;
  if (!isValidTimeZone(s.timezone)) out.timezone = "La zona horaria no es válida.";
  if (s.title.length > SESSION_LIMITS.title) out.title = `El título no puede superar los ${SESSION_LIMITS.title} caracteres.`;
  if (s.privateNote.length > SESSION_LIMITS.privateNote) out.privateNote = `La nota interna no puede superar los ${SESSION_LIMITS.privateNote} caracteres.`;
  if (!(SESSION_STATUSES as readonly string[]).includes(s.status)) out.status = "Estado no válido.";
  return out;
}

/**
 * ¿Choca con otra sesión de la misma convocatoria? (misma fecha y hora; las canceladas no cuentan).
 * `exceptId`: la propia sesión cuando se edita.
 */
export function findDuplicateSession<T extends { id: number; startsOn: string; startTime: string | null; status: string }>(existing: T[], candidate: { startsOn: string; startTime: string | null }, exceptId?: number): T | null {
  const key = sessionSlotKey(candidate);
  return existing.find((x) => x.id !== exceptId && x.status !== "cancelled" && sessionSlotKey(x) === key) ?? null;
}

/** Suma días a «YYYY-MM-DD» sin zonas horarias (aritmética de calendario). */
export function addDaysToDate(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error("Fecha no válida");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** «N sesiones semanales desde una fecha»: las fechas de la serie (cada `everyWeeks` semanas). */
export function weeklySeriesDates(firstDate: string, count: number, everyWeeks = 1): string[] {
  if (!isValidSessionDate(firstDate)) throw new Error("Indica una fecha de inicio válida.");
  if (!Number.isInteger(count) || count < 1 || count > SESSION_LIMITS.perEdition) throw new Error(`El número de sesiones debe estar entre 1 y ${SESSION_LIMITS.perEdition}.`);
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > SESSION_LIMITS.maxIntervalWeeks) throw new Error(`La frecuencia debe ser entre 1 y ${SESSION_LIMITS.maxIntervalWeeks} semanas.`);
  const out = Array.from({ length: count }, (_, i) => addDaysToDate(firstDate, i * 7 * everyWeeks));
  if (!out.every(isValidSessionDate)) throw new Error("La serie se sale de las fechas permitidas.");
  return out;
}

/** Orden cronológico estable: fecha, hora (las «por confirmar» al final del día), posición manual e id. */
export function chronologicalOrder<T extends Pick<SessionLike, "id" | "position" | "startsOn" | "startTime">>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) =>
    a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1
      : (a.startTime ?? "99:99") < (b.startTime ?? "99:99") ? -1 : (a.startTime ?? "99:99") > (b.startTime ?? "99:99") ? 1
        : a.position - b.position || a.id - b.id);
}

/**
 * Fechas de la convocatoria derivadas de sus sesiones (no canceladas): inicio = primera sesión (a su hora o, si está por
 * confirmar, al empezar el día); fin = última sesión más su duración o, sin hora o sin duración, al acabar ese día.
 * `null` si no hay sesiones vigentes (la convocatoria conserva sus fechas de siempre).
 */
export function deriveEditionRange(sessions: Array<Pick<SessionLike, "startsOn" | "startTime" | "durationMinutes" | "status" | "id" | "position"> & { timezone?: string }>, tz: string): { startsAt: number; endsAt: number } | null {
  const fallback = isValidTimeZone(tz) ? tz : "Europe/Madrid";
  // Cada sesión en su zona (por defecto la de la convocatoria)
  const zoneOf = (s: { timezone?: string }) => (s.timezone && isValidTimeZone(s.timezone) ? s.timezone : fallback);
  const live = sessions.filter((s) => s.status !== "cancelled" && isValidSessionDate(s.startsOn));
  let startsAt = Number.POSITIVE_INFINITY;
  let endsAt = 0;
  for (const s of live) {
    const begin = localToUtcMs(`${s.startsOn}T${s.startTime ?? "00:00"}`, zoneOf(s));
    if (begin == null) continue;
    // Sin hora o sin duración, la sesión ocupa hasta el final de su día (no se inventa la hora de fin)
    const end = s.startTime && s.durationMinutes ? begin + s.durationMinutes * 60_000 : localToUtcMs(`${s.startsOn}T23:59`, zoneOf(s))!;
    if (begin < startsAt) startsAt = begin;
    if (end > endsAt) endsAt = end;
  }
  if (!Number.isFinite(startsAt)) return null;
  return { startsAt, endsAt: Math.max(endsAt, startsAt) };
}

// ─── Web pública ─────────────────────────────────────────────────────────────

/** Lo único que se publica de una sesión: sin nota interna, sin título (no es traducible) y sin las canceladas. */
export interface PublicEditionSession {
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  status: "scheduled" | "done";
}

export function toPublicSessions(sessions: Array<SessionLike & { privateNote?: unknown; title?: unknown }>): PublicEditionSession[] {
  return chronologicalOrder(sessions)
    .filter((s) => s.status !== "cancelled")
    .map((s) => ({ startsOn: s.startsOn, startTime: s.startTime, durationMinutes: s.durationMinutes, status: s.status === "done" ? "done" : "scheduled" }));
}

/**
 * «domingo, 29 de noviembre de 2026 · 18:00 · 90 min» en el idioma de la página. Sin hora: el texto de «hora por
 * confirmar» del diccionario de la web (`tbcText`); nunca una hora inventada. `minutesText`: «{n} min».
 */
export function formatSessionLine(s: { startsOn: string; startTime: string | null; durationMinutes: number | null }, opts: { locale?: string; tbcText: string; minutesText?: string }): string {
  const m = DATE_RE.exec(s.startsOn);
  if (!m) return s.startsOn;
  let intl = "es-ES";
  try {
    intl = Intl.DateTimeFormat.supportedLocalesOf([opts.locale ?? "es-ES"]).length ? (opts.locale ?? "es-ES") : "es-ES";
  } catch {
    intl = "es-ES";
  }
  // La fecha es un día de calendario: se formatea en UTC para que ninguna zona la mueva de día
  const day = new Intl.DateTimeFormat(intl, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  const parts = [day, s.startTime ?? opts.tbcText];
  if (s.durationMinutes) parts.push((opts.minutesText ?? "{n} min").replace("{n}", String(s.durationMinutes)));
  return parts.join(" · ");
}
