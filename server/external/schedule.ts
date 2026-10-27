/**
 * Calendario de cobro de los servicios externos: un instante concreto de un día del mes en una zona horaria
 * (Europe/Madrid por defecto), sin depender de la zona del servidor.
 *
 * Stripe ancla los cobros mensuales al MISMO día y hora UTC del primer cargo. Por eso la hora de cobro por defecto es
 * las 08:00 de Madrid: en invierno (UTC+1) son las 07:00 UTC y en verano (UTC+2) las 08:00 de Madrid caen a las 09:00,
 * siempre el día 1 en las dos zonas. A medianoche, el día 1 de Madrid sería el último día del mes en UTC.
 */

/** Desfase (ms) de una zona horaria respecto a UTC en un instante. */
export function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
}

/** Instante (ms) de una fecha y hora locales en una zona horaria. */
export function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  // Dos pasadas: el desfase puede cambiar entre la estimación y el instante real (cambio de hora)
  let at = guess - zoneOffsetMs(guess, timeZone);
  at = guess - zoneOffsetMs(at, timeZone);
  return at;
}

/** Fecha local (año, mes, día) de un instante en una zona horaria. */
export function localDate(at: number, timeZone: string): { year: number; month: number; day: number } {
  const d = new Date(at + zoneOffsetMs(at, timeZone));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Primer cobro de una fecha «AAAA-MM-DD» a la hora de cobro local. */
export function chargeInstant(date: string, hour: number, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("Fecha no válida (AAAA-MM-DD)");
  return zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]), hour, timeZone);
}

/** Siguiente día de cobro (día `day` del mes a la hora local) estrictamente posterior a `after`. */
export function nextChargeAfter(after: number, day: number, hour: number, timeZone: string): number {
  const { year, month } = localDate(after, timeZone);
  for (let i = 0; i < 3; i++) {
    const y = year + Math.floor((month - 1 + i) / 12);
    const m = ((month - 1 + i) % 12) + 1;
    const at = zonedInstant(y, m, day, hour, timeZone);
    if (at > after) return at;
  }
  throw new Error("No se pudo calcular el siguiente día de cobro");
}

/** Fin del margen de cobro: el final del día `day + graceDays − 1` del mes del periodo (23:59:59 local). */
export function graceEnd(periodStart: number, graceDays: number, timeZone: string): number {
  const { year, month, day } = localDate(periodStart, timeZone);
  return zonedInstant(year, month, day + graceDays, 0, timeZone) - 1000;
}

/** Mensualidad legible de un periodo (p. ej. «noviembre de 2026»), para identificar cada factura. */
export function periodLabel(periodStart: number, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone, month: "long", year: "numeric" }).format(new Date(periodStart));
}
