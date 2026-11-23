/**
 * Compra de tienda ligada a una convocatoria (edición): reglas puras, compartidas por el servidor y la ficha.
 *
 * Reglas:
 *  - Un producto con convocatorias (cualquier edición, del estado que sea) es un producto CON FECHA: para comprarlo hay que
 *    elegir una edición `open`, que aún no haya empezado y con plazas suficientes. Sin ninguna abierta, no se vende.
 *  - Un producto sin convocatorias se comporta como siempre (no pasa por aquí).
 *  - Precio: `priceOverride` de la edición SUSTITUYE al precio base del producto. Una opción (variante) de importe fijo
 *    sigue sustituyendo al precio (como hasta ahora) y una opción en porcentaje se calcula sobre el precio de la edición.
 *  - Plazas: cada persona de la línea ocupa una plaza (`seats = people`).
 */

export interface SaleEdition {
  id: number;
  experienceId: number;
  label: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  locationNote: string;
  capacity: number | null;
  reserved: number;
  status: string;
  priceOverride: number | null;
}

export type SaleRefusalCode =
  | "edition_required"
  | "no_open_editions"
  | "edition_not_found"
  | "not_open"
  | "started"
  | "sold_out"
  | "not_enough_seats"
  | "bad_seats";

export type SaleVerdict = { ok: true; seatsLeft: number | null } | { ok: false; code: SaleRefusalCode; message: string };

/** ¿Se puede vender ahora (sin mirar plazas)? Abierta y sin empezar. */
export function isEditionOnSale(e: Pick<SaleEdition, "status" | "startsAt">, now: number): boolean {
  return e.status === "open" && e.startsAt > now;
}

const left = (e: Pick<SaleEdition, "capacity" | "reserved">): number | null => (e.capacity == null ? null : Math.max(0, e.capacity - e.reserved));

/** Veredicto de compra de `seats` plazas de una edición ya localizada. `e` null = no existe o no es de este producto. */
export function editionSaleVerdict(e: SaleEdition | null, experienceId: number, seats: number, now: number): SaleVerdict {
  if (!Number.isInteger(seats) || seats < 1) return { ok: false, code: "bad_seats", message: "El número de plazas no es válido." };
  if (!e || e.experienceId !== experienceId) return { ok: false, code: "edition_not_found", message: "La fecha elegida no corresponde a este producto. Vuelve a elegirla en la ficha." };
  if (e.status !== "open") return { ok: false, code: "not_open", message: `La fecha «${e.label}» ya no admite reservas.` };
  if (e.startsAt <= now) return { ok: false, code: "started", message: `La fecha «${e.label}» ya ha comenzado.` };
  const l = left(e);
  if (l !== null && l <= 0) return { ok: false, code: "sold_out", message: `La fecha «${e.label}» está completa.` };
  if (l !== null && seats > l) return { ok: false, code: "not_enough_seats", message: `Solo quedan ${l} plazas en «${e.label}».` };
  return { ok: true, seatsLeft: l };
}

/** Qué exige un producto según sus convocatorias (todas las del producto, de cualquier estado). */
export function editionRequirement(editions: SaleEdition[], now: number): "none" | "choose" | "blocked" {
  if (editions.length === 0) return "none";
  return editions.some((e) => isEditionOnSale(e, now)) ? "choose" : "blocked";
}

/** Precio base de la línea: el de la edición si lo tiene (>0); si no, el del producto. */
export function editionBasePrice(priceOverride: number | null | undefined, productBase: number): number {
  return priceOverride != null && Number.isFinite(priceOverride) && priceOverride > 0 ? priceOverride : productBase;
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona horaria de la edición. */
export function editionLocalDate(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Nota operativa de la reserva: qué convocatoria, cuándo (inicio y fin) y dónde. */
export function editionNote(e: Pick<SaleEdition, "label" | "startsAt" | "endsAt" | "timezone" | "locationNote">): string {
  const from = editionLocalDate(e.startsAt, e.timezone);
  const to = e.endsAt != null ? editionLocalDate(e.endsAt, e.timezone) : null;
  const dates = to && to !== from ? `${from} a ${to}` : from;
  return `Convocatoria: ${e.label} · ${dates}${e.locationNote ? ` · ${e.locationNote}` : ""}`;
}
