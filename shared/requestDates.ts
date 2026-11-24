/**
 * Fecha de inicio deseada en una solicitud de producto «bajo petición» (sin convocatoria).
 *
 * Una fecha solicitada NO es disponibilidad ni reserva: solo una petición que la empresa acepta o sustituye por otra
 * antes de enviar el presupuesto. El periodo en el que se admiten peticiones es un DATO del producto
 * (`request_dates_from` / `request_dates_until`), no una regla escrita en el código ni leída de un texto editorial.
 * La duración también es un dato (`duration_days`): sin ella no se calcula ni se promete ninguna fecha de fin.
 */

export interface RequestDateRules {
  /** Primer día admitido (YYYY-MM-DD) o null = desde mañana */
  from: string | null;
  /** Último día admitido (YYYY-MM-DD). Null = el producto no admite petición de fechas */
  until: string | null;
  /** Días de duración (dato estructurado) o null si no consta */
  durationDays: number | null;
}

export type RequestDateProblem = "invalid" | "not_enabled" | "past" | "before_window" | "after_window";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día real del calendario (rechaza 2027-02-30) o null. */
export function parseIsoDay(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = ISO_DAY.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? s.trim() : null;
}

/** Hoy (UTC) como YYYY-MM-DD. */
export function todayIso(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** El producto admite petición de fechas solo si la empresa fijó un último día. */
export function datesRequestable(rules: Pick<RequestDateRules, "until">): boolean {
  return parseIsoDay(rules.until) !== null;
}

/** Problema de la fecha de inicio pedida, o null si es coherente. Las fechas ISO se comparan como texto. */
export function requestedStartProblem(start: unknown, rules: RequestDateRules, nowMs: number): RequestDateProblem | null {
  if (!datesRequestable(rules)) return "not_enabled";
  const day = parseIsoDay(start);
  if (!day) return "invalid";
  if (day <= todayIso(nowMs)) return "past";
  const from = parseIsoDay(rules.from);
  if (from && day < from) return "before_window";
  if (day > (rules.until as string)) return "after_window";
  return null;
}

/** Último día previsto si la duración consta como dato; null si no (nunca se deduce de un texto). */
export function plannedEndDay(start: string, durationDays: number | null | undefined): string | null {
  const day = parseIsoDay(start);
  if (!day || !Number.isInteger(durationDays) || (durationDays as number) < 1 || (durationDays as number) > 366) return null;
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + (durationDays as number) - 1);
  return dt.toISOString().slice(0, 10);
}

/** «5 de octubre de 2026» no: formato corto estable para el texto de la solicitud (dd/mm/aaaa). */
export function formatIsoDayShort(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
