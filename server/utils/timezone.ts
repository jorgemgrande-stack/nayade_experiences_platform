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

/**
 * UTC offset in minutes for Madrid at the given instant.
 * Returns +60 (winter/CET) or +120 (summer/CEST).
 */
function madridOffsetMinutes(date: Date): number {
  const utcStr    = date.toLocaleString("en-US", { timeZone: "UTC" });
  const madridStr = date.toLocaleString("en-US", { timeZone: TZ });
  return (new Date(madridStr).getTime() - new Date(utcStr).getTime()) / 60_000;
}

/**
 * UTC Date for 00:00:00.000 in Europe/Madrid on the given date key (YYYY-MM-DD).
 * e.g. madridStartOfDayUtc("2026-05-02") → 2026-05-01T22:00:00.000Z (CEST)
 */
export function madridStartOfDayUtc(dateKey: string): Date {
  const noon      = new Date(`${dateKey}T12:00:00Z`); // noon UTC is always same Madrid date
  const offsetMs  = madridOffsetMinutes(noon) * 60_000;
  return new Date(new Date(`${dateKey}T00:00:00Z`).getTime() - offsetMs);
}

/**
 * UTC Date for 23:59:59.999 in Europe/Madrid on the given date key.
 */
export function madridEndOfDayUtc(dateKey: string): Date {
  return new Date(madridStartOfDayUtc(dateKey).getTime() + 24 * 60 * 60 * 1000 - 1);
}
