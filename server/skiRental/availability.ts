/**
 * Disponibilidad de material (lógica pura). Un alquiler ocupa sus unidades todos los días de
 * `startDate` a `endDate`, ambos incluidos, mientras esté reservado o entregado. Lo disponible en un
 * rango es la existencia menos el PICO diario de unidades ocupadas en ese rango.
 */
export const ITEM_CATEGORIES = ["ski", "snowboard", "boots", "helmet", "poles", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const RENTAL_STATUSES = ["reserved", "out", "returned", "cancelled"] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
/** Estados que ocupan unidades. */
export const OCCUPYING: readonly RentalStatus[] = ["reserved", "out"];

/** Rango máximo de una consulta o de un alquiler. */
export const MAX_RANGE_DAYS = 31;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día (YYYY-MM-DD) → número de día UTC. Lanza si no es una fecha real. */
export function dayNumber(s: string): number {
  const m = DAY_RE.exec(s);
  if (!m) throw new RangeError(`Fecha no válida: ${s}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(t).toISOString().slice(0, 10) !== s) throw new RangeError(`Fecha no válida: ${s}`);
  return t / 86_400_000;
}

/** Valida un rango (incluido) y devuelve sus extremos como números de día. */
export function checkRange(from: string, to: string): [number, number] {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (b < a) throw new RangeError("La fecha final es anterior a la inicial");
  if (b - a + 1 > MAX_RANGE_DAYS) throw new RangeError(`El rango no puede superar ${MAX_RANGE_DAYS} días`);
  return [a, b];
}

export interface Occupation {
  startDate: string;
  endDate: string;
  quantity: number;
}

/** Pico diario de unidades ocupadas en [from, to]. */
export function peakUsage(rentals: Occupation[], from: string, to: string): number {
  const [a, b] = checkRange(from, to);
  let peak = 0;
  for (let d = a; d <= b; d++) {
    let used = 0;
    for (const r of rentals) if (dayNumber(r.startDate) <= d && dayNumber(r.endDate) >= d) used += r.quantity;
    if (used > peak) peak = used;
  }
  return peak;
}

export function availableUnits(stock: number, rentals: Occupation[], from: string, to: string): number {
  return Math.max(0, stock - peakUsage(rentals, from, to));
}
