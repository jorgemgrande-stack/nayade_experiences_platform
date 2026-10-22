/**
 * Retención de plazas de spa y hotel — lógica pura (sin base de datos).
 *
 * Una reserva de spa o de hotel ocupa inventario desde que se crea pendiente de pago:
 *  - spa: `inventory_units` plazas (personas) de la franja `spa_slots.id = inventory_ref_id`.
 *    La ocupación es el contador `spa_slots.bookedCount`, que se mueve SOLO al retener/liberar.
 *  - hotel: `inventory_units` habitaciones del tipo `room_types.id = inventory_ref_id` cada noche de
 *    [stay_check_in, stay_check_out). La ocupación se calcula desde las reservas vivas; la capacidad de
 *    cada noche es `totalUnits`, rebajada por un bloqueo de `room_blocks` si lo hay.
 *
 * Estados de la retención (`reservations.hold_status`):
 *  - retenida   → pendiente de pago; caduca en `hold_expires_at`.
 *  - confirmada → pagada; no caduca.
 *  - liberada   → plaza devuelta (`hold_release_reason`: pago_fallido | cancelada | caducada).
 *  - conflicto  → pago confirmado cuando la plaza ya se había liberado y otra reserva la ocupó; no
 *                 cuenta en la ocupación y la reconciliación la lista para gestión manual.
 */

export type InventoryKind = "spa_slot" | "hotel_room";
export type HoldStatus = "retenida" | "confirmada" | "liberada" | "conflicto";
export type ReleaseReason = "pago_fallido" | "cancelada" | "caducada";

/** Duración de la retención: la sesión de pago de Redsys caduca a los 30 min; 15 min de margen. */
export const HOLD_TTL_MS = 45 * 60 * 1000;

/** Estados que ocupan plaza (en spa, los que están sumados en `bookedCount`). */
export const LIVE_HOLD_STATUSES: readonly HoldStatus[] = ["retenida", "confirmada"];

export interface HoldState {
  holdStatus: string | null;
  holdExpiresAt: number | null;
  /** `reservations.status` (draft | pending_payment | paid | failed | cancelled). */
  reservationStatus: string;
}

export type HoldAction =
  | { type: "ninguna" }
  | { type: "confirmar" }
  | { type: "liberar"; reason: ReleaseReason };

const DEAD_RESERVATION = new Set(["cancelled", "failed"]);

/**
 * Qué hay que hacer con una retención según el estado de su reserva. Es la regla única que aplican la
 * notificación de pago, la caducidad y la reconciliación.
 *  - Reserva pagada con la plaza retenida o ya liberada → confirmar (si estaba liberada, se vuelve a
 *    ocupar solo si queda sitio; si no, conflicto).
 *  - Reserva fallida o cancelada con plaza viva → liberar.
 *  - Reserva pendiente con la retención caducada → liberar (caducada). Una reserva pagada nunca caduca.
 */
export function decideHoldAction(h: HoldState, now: number): HoldAction {
  const s = h.holdStatus;
  if (s !== "retenida" && s !== "confirmada" && s !== "liberada") return { type: "ninguna" };
  if (h.reservationStatus === "paid") return s === "confirmada" ? { type: "ninguna" } : { type: "confirmar" };
  if (s === "liberada") return { type: "ninguna" };
  if (DEAD_RESERVATION.has(h.reservationStatus)) {
    return { type: "liberar", reason: h.reservationStatus === "failed" ? "pago_fallido" : "cancelada" };
  }
  if (s === "retenida" && h.holdExpiresAt !== null && h.holdExpiresAt <= now) return { type: "liberar", reason: "caducada" };
  return { type: "ninguna" };
}

/**
 * ¿Ocupa plaza ahora mismo? (ocupación calculada del hotel y disponibilidad pública). Una retención
 * caducada o de una reserva muerta ya no ocupa aunque aún no se haya marcado como liberada.
 */
export function occupiesInventory(h: HoldState, now: number): boolean {
  if (h.holdStatus !== "retenida" && h.holdStatus !== "confirmada") return false;
  return decideHoldAction(h, now).type !== "liberar";
}

/** Noches de una estancia: cada fecha (YYYY-MM-DD) de [checkIn, checkOut). Vacío si el rango no es válido. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const out: string[] = [];
  for (let t = from; t < to; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Capacidad de una noche: las unidades del tipo, rebajadas por el bloqueo del día si lo hay. */
export function nightCapacity(totalUnits: number, blockedAvailableUnits: number | undefined): number {
  return blockedAvailableUnits === undefined ? totalUnits : Math.max(0, Math.min(totalUnits, blockedAvailableUnits));
}

/** Habitaciones ocupadas por noche a partir de las estancias que ocupan plaza. */
export function occupancyByNight(
  stays: Array<{ checkIn: string; checkOut: string; units: number }>,
  nights: readonly string[],
): Map<string, number> {
  const wanted = new Set(nights);
  const occ = new Map<string, number>(nights.map((n) => [n, 0]));
  for (const s of stays) {
    for (const n of stayNights(s.checkIn, s.checkOut)) {
      if (wanted.has(n)) occ.set(n, (occ.get(n) ?? 0) + s.units);
    }
  }
  return occ;
}

/** Habitaciones libres en la noche más ajustada de la estancia (0 si alguna está completa). */
export function minAvailableUnits(params: {
  nights: readonly string[];
  totalUnits: number;
  blocks: ReadonlyMap<string, number>;
  occupancy: ReadonlyMap<string, number>;
}): number {
  let min = params.totalUnits;
  for (const n of params.nights) {
    const free = nightCapacity(params.totalUnits, params.blocks.get(n)) - (params.occupancy.get(n) ?? 0);
    min = Math.min(min, free);
  }
  return Math.max(0, min);
}

export interface SpaSlotDrift {
  slotId: number;
  bookedCount: number;
  expected: number;
  capacity: number;
}

/**
 * Franjas de spa cuyo contador no coincide con las plazas retenidas o confirmadas por reservas.
 * `liveUnitsBySlot` es la suma de `inventory_units` de las retenciones vivas de cada franja.
 */
export function spaSlotDrift(
  slots: Array<{ id: number; bookedCount: number; capacity: number }>,
  liveUnitsBySlot: ReadonlyMap<number, number>,
): SpaSlotDrift[] {
  return slots
    .map((s) => ({ slotId: s.id, bookedCount: s.bookedCount, expected: liveUnitsBySlot.get(s.id) ?? 0, capacity: s.capacity }))
    .filter((d) => d.bookedCount !== d.expected);
}
