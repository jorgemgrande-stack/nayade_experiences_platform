/**
 * Timezone utilities for Europe/Madrid.
 *
 * All functions use Intl — no external dependencies, handles DST automatically.
 * The server runs in UTC (Railway). These functions convert correctly for
 * Spain's timezone (UTC+1 winter / UTC+2 summer).
 */

const TZ = "Europe/Madrid";

/**
 * Current date (or given Date) as YYYY-MM-DD in Europe/Madrid.
 * Replaces: new Date().toISOString().slice(0, 10)  ← was UTC, wrong after 22h/23h Spain
 */
export function madridDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv", { timeZone: TZ }).format(date);
}

/**
 * Año de calendario en Europe/Madrid: el de la numeración fiscal. `getFullYear()` usa la zona del
 * servidor (UTC), y entre las 00:00 y la 01:00 (o 02:00 en verano) de Madrid daría otro año.
 */
export function madridYear(date: Date = new Date()): number {
  return Number(madridDateKey(date).slice(0, 4));
}

/** Mes (1-12) de calendario en Europe/Madrid. */
export function madridMonth(date: Date = new Date()): number {
  return Number(madridDateKey(date).slice(5, 7));
}

const MADRID_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Desfase de Madrid respecto a UTC (ms) en un instante dado: +1 h en invierno, +2 h en verano. */
function madridOffsetMs(ms: number): number {
  const p = Object.fromEntries(MADRID_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - (ms - (ms % 1000));
}

/** Día siguiente de una fecha YYYY-MM-DD (calendario, sin zona). */
export function nextDateKey(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Instante (ms) de las 00:00 en Madrid de un día. Se usa el desfase vigente a esa hora (no al mediodía), así que es
 * exacto también los días de cambio de hora: en Madrid la medianoche nunca cae en la hora que se salta ni en la que
 * se repite (el cambio es a las 02:00 y a las 03:00).
 */
export function madridMidnightMs(dateKey: string): number {
  const utcMidnight = Date.parse(`${dateKey}T00:00:00Z`);
  const guess = utcMidnight - madridOffsetMs(utcMidnight);
  return utcMidnight - madridOffsetMs(guess);
}

/**
 * UTC Date for 00:00:00.000 in Europe/Madrid on the given date key (YYYY-MM-DD).
 * e.g. madridStartOfDayUtc("2026-05-02") → 2026-05-01T22:00:00.000Z (CEST)
 * Exacto los días de cambio de hora: madridStartOfDayUtc("2026-03-29") → 2026-03-28T23:00:00.000Z (aún CET).
 */
export function madridStartOfDayUtc(dateKey: string): Date {
  return new Date(madridMidnightMs(dateKey));
}

/**
 * UTC Date for 23:59:59.999 in Europe/Madrid on the given date key: el instante anterior a las 00:00 del día
 * siguiente, así que los días de 23 y de 25 horas quedan completos.
 */
export function madridEndOfDayUtc(dateKey: string): Date {
  return new Date(madridMidnightMs(nextDateKey(dateKey)) - 1);
}

/** YYYY-MM-01 del mes `month0` (0-11; 12 = enero del año siguiente) de `year`. */
function monthStartKey(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toISOString().slice(0, 10);
}

/**
 * Periodo de `months` meses naturales desde el mes `month0` (0-11) de `year`, en Europe/Madrid:
 *  - `start` / `endExcl`: las 00:00 de Madrid del primer día del periodo y del primer día del siguiente (para filtrar
 *    instantes como la fecha de emisión: [start, endExcl)).
 *  - `startStr` / `endStr`: primer y último día del periodo como YYYY-MM-DD (para columnas de fecha sin hora).
 * Una factura emitida el 1 de abril a las 00:30 en España es del segundo trimestre, aunque en UTC sea 31 de marzo.
 */
export function madridMonthsRange(year: number, month0: number, months: number) {
  const startStr = monthStartKey(year, month0);
  const nextStr = monthStartKey(year, month0 + months);
  const lastDay = new Date(Date.UTC(year, month0 + months, 0)).toISOString().slice(0, 10);
  return {
    start: madridStartOfDayUtc(startStr),
    endExcl: madridStartOfDayUtc(nextStr),
    startStr,
    endStr: lastDay,
  };
}

/** Trimestre natural (q = 1..4) de un ejercicio en Europe/Madrid. Ver `madridMonthsRange`. */
export function madridQuarterRange(year: number, q: number) {
  return madridMonthsRange(year, (q - 1) * 3, 3);
}
