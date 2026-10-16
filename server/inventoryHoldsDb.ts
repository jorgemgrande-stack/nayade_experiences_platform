/**
 * Retención de plazas de spa y hotel — acceso a datos. La lógica de decisión vive en `inventoryHolds.ts`.
 *
 * Atomicidad (dos clientes nunca se llevan la última plaza):
 *  - spa: UPDATE condicional `bookedCount + n <= capacity` sobre la franja, en la misma transacción que
 *    crea la reserva. InnoDB serializa las escrituras sobre la fila: solo una gana.
 *  - hotel: `SELECT … FOR UPDATE` del tipo de habitación (serializa las reservas de ese tipo), ocupación
 *    calculada desde las reservas vivas y alta de la reserva, todo en una transacción.
 * Orden de bloqueo común (reserva → franja; tipo de habitación → reserva) y reintento ante interbloqueo.
 *
 * Idempotencia: confirmar o liberar es una transición condicionada al estado actual de la retención, leído
 * con bloqueo; repetirla (p. ej. una notificación de Redsys duplicada) no mueve el contador dos veces.
 *
 * Las columnas de la retención (migración db/migrations/0004_inventory_holds) no están en
 * `drizzle/schema.ts` a propósito: así el resto del código de reservas no depende de que la migración
 * esté aplicada. Se leen y escriben aquí con SQL explícito.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb, createReservation, generateReservationNumber } from "./db";
import { isDeadlock } from "./creditNoteNumber";
import {
  HOLD_TTL_MS,
  decideHoldAction,
  occupiesInventory,
  stayNights,
  occupancyByNight,
  minAvailableUnits,
  nightCapacity,
  spaSlotDrift,
  type HoldAction,
  type InventoryKind,
  type ReleaseReason,
  type SpaSlotDrift,
} from "./inventoryHolds";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute" | "insert">;
type ReservationData = Parameters<typeof createReservation>[0];

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows<T>(exec: Pick<Db, "execute">, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function affected(exec: Pick<Db, "execute">, q: SQL): Promise<number> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number }];
  return r.affectedRows ?? 0;
}

/** Transacción READ COMMITTED (cada lectura ve lo confirmado tras obtener el bloqueo) con reintento ante interbloqueo. */
async function inTx<T>(fn: (tx: Exec) => Promise<T>, exec?: Exec): Promise<T> {
  if (exec) return fn(exec);
  const d = await db();
  for (let attempt = 1; ; attempt++) {
    try {
      return await d.transaction((tx) => fn(tx as unknown as Exec), { isolationLevel: "read committed" });
    } catch (err) {
      if (attempt >= 5 || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt));
    }
  }
}

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

interface HoldRow {
  id: number;
  status: string;
  inventory_kind: InventoryKind | null;
  inventory_ref_id: number | null;
  inventory_units: number | null;
  stay_check_in: string | null;
  stay_check_out: string | null;
  hold_status: string | null;
  hold_expires_at: number | string | null;
}

const HOLD_COLUMNS = sql.raw(
  "id, status, inventory_kind, inventory_ref_id, inventory_units, stay_check_in, stay_check_out, hold_status, hold_expires_at",
);

function holdState(r: HoldRow) {
  return {
    holdStatus: r.hold_status,
    holdExpiresAt: r.hold_expires_at === null ? null : Number(r.hold_expires_at),
    reservationStatus: r.status,
  };
}

async function markHold(tx: Exec, reservationId: number, status: "retenida" | "confirmada" | "conflicto", now: number) {
  await tx.execute(sql`UPDATE reservations SET hold_status = ${status}, hold_release_reason = NULL, updated_at = ${now} WHERE id = ${reservationId}`);
}

// ─── Retención al crear la reserva pendiente ──────────────────────────────────

export type HoldResult =
  | { ok: true; reservation: Awaited<ReturnType<typeof createReservation>> }
  | { ok: false; available: number };

/**
 * Retiene `units` plazas de la franja y crea la reserva pendiente de pago, en una única transacción.
 * Antes libera las retenciones de esa franja que ya no deberían ocuparla (caducadas o de reservas
 * fallidas/canceladas). Si no caben, no crea nada y devuelve las plazas que quedan.
 */
export async function holdSpaSlotAndCreateReservation(
  slot: { slotId: number; treatmentId: number; date: string; units: number },
  data: ReservationData,
  now = Date.now(),
): Promise<HoldResult> {
  const reservationNumber = data.reservationNumber ?? await generateReservationNumber();
  return inTx(async (tx) => {
    await settleSpaSlotHolds(tx, slot.slotId, now);
    const ok = await affected(tx, sql`
      UPDATE spa_slots SET bookedCount = bookedCount + ${slot.units}
      WHERE id = ${slot.slotId} AND treatmentId = ${slot.treatmentId} AND date = ${slot.date}
        AND status <> 'bloqueado' AND bookedCount + ${slot.units} <= capacity`);
    if (ok !== 1) {
      const [s] = await rows<{ capacity: number; bookedCount: number }>(tx, sql`SELECT capacity, bookedCount FROM spa_slots WHERE id = ${slot.slotId}`);
      return { ok: false, available: s ? Math.max(0, s.capacity - s.bookedCount) : 0 };
    }
    const reservation = await createReservation({ ...data, reservationNumber }, tx);
    await tx.execute(sql`
      UPDATE reservations SET inventory_kind = 'spa_slot', inventory_ref_id = ${slot.slotId}, inventory_units = ${slot.units},
        hold_status = 'retenida', hold_expires_at = ${now + HOLD_TTL_MS}, hold_release_reason = NULL
      WHERE id = ${reservation.id}`);
    return { ok: true, reservation };
  });
}

/**
 * Retiene `units` habitaciones del tipo en cada noche de [checkIn, checkOut) y crea la reserva pendiente,
 * en una única transacción serializada por el tipo de habitación.
 */
export async function holdHotelRoomAndCreateReservation(
  stay: { roomTypeId: number; checkIn: string; checkOut: string; units: number },
  data: ReservationData,
  now = Date.now(),
): Promise<HoldResult> {
  const reservationNumber = data.reservationNumber ?? await generateReservationNumber();
  return inTx(async (tx) => {
    const available = await lockedHotelAvailability(tx, stay, now);
    if (available < stay.units) return { ok: false, available };
    const reservation = await createReservation({ ...data, reservationNumber }, tx);
    await tx.execute(sql`
      UPDATE reservations SET inventory_kind = 'hotel_room', inventory_ref_id = ${stay.roomTypeId}, inventory_units = ${stay.units},
        stay_check_in = ${stay.checkIn}, stay_check_out = ${stay.checkOut},
        hold_status = 'retenida', hold_expires_at = ${now + HOLD_TTL_MS}, hold_release_reason = NULL
      WHERE id = ${reservation.id}`);
    return { ok: true, reservation };
  });
}

/** Bloquea el tipo de habitación y devuelve las unidades libres en la noche más ajustada de la estancia. */
async function lockedHotelAvailability(
  tx: Exec,
  stay: { roomTypeId: number; checkIn: string; checkOut: string },
  now: number,
  excludeReservationId?: number,
): Promise<number> {
  const [room] = await rows<{ totalUnits: number; isActive: number }>(tx, sql`SELECT totalUnits, isActive FROM room_types WHERE id = ${stay.roomTypeId} FOR UPDATE`);
  const nights = stayNights(stay.checkIn, stay.checkOut);
  if (!room || nights.length === 0) return 0;
  const occ = await hotelOccupancy(tx, [stay.roomTypeId], stay.checkIn, stay.checkOut, now, excludeReservationId);
  const blocks = await rows<{ date: string; availableUnits: number }>(tx, sql`
    SELECT date, availableUnits FROM room_blocks WHERE roomTypeId = ${stay.roomTypeId} AND date >= ${stay.checkIn} AND date < ${stay.checkOut}`);
  return minAvailableUnits({
    nights,
    totalUnits: room.totalUnits,
    blocks: new Map(blocks.map((b) => [b.date, b.availableUnits])),
    occupancy: occ.get(stay.roomTypeId) ?? new Map(),
  });
}

/**
 * Ocupación calculada del hotel: habitaciones ocupadas por tipo y noche en [from, to), contando solo las
 * reservas que ocupan plaza ahora (retenidas sin caducar y confirmadas de reservas no anuladas).
 */
export async function hotelOccupancy(
  exec: Pick<Db, "execute">,
  roomTypeIds: readonly number[] | null,
  from: string,
  to: string,
  now = Date.now(),
  excludeReservationId?: number,
): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (roomTypeIds && roomTypeIds.length === 0) return out;
  const nights = stayNights(from, to);
  if (nights.length === 0) return out;
  const list = await rows<HoldRow>(exec, sql`
    SELECT ${HOLD_COLUMNS} FROM reservations
    WHERE inventory_kind = 'hotel_room' AND hold_status IN ('retenida', 'confirmada')
      AND stay_check_in < ${to} AND stay_check_out > ${from}
      ${roomTypeIds ? sql`AND inventory_ref_id IN (${idList(roomTypeIds)})` : sql``}
      ${excludeReservationId ? sql`AND id <> ${excludeReservationId}` : sql``}`);
  const byRoom = new Map<number, Array<{ checkIn: string; checkOut: string; units: number }>>();
  for (const r of list) {
    if (!occupiesInventory(holdState(r), now)) continue;
    const k = Number(r.inventory_ref_id);
    if (!byRoom.has(k)) byRoom.set(k, []);
    byRoom.get(k)!.push({ checkIn: r.stay_check_in!, checkOut: r.stay_check_out!, units: Number(r.inventory_units ?? 1) });
  }
  byRoom.forEach((stays, k) => out.set(k, occupancyByNight(stays, nights)));
  return out;
}

/**
 * Plazas de cada franja de spa que siguen sumadas en `bookedCount` pero ya no deberían ocuparla
 * (retención caducada o reserva fallida/cancelada aún sin liberar). La disponibilidad pública las
 * descuenta para no mostrar como completa una franja que el siguiente intento de reserva liberará.
 */
export async function releasableSpaUnits(slotIds: readonly number[], now = Date.now()): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (slotIds.length === 0) return out;
  const list = await rows<HoldRow>(await db(), sql`
    SELECT ${HOLD_COLUMNS} FROM reservations
    WHERE inventory_kind = 'spa_slot' AND inventory_ref_id IN (${idList(slotIds)}) AND hold_status IN ('retenida', 'confirmada')`);
  for (const r of list) {
    if (decideHoldAction(holdState(r), now).type !== "liberar") continue;
    const k = Number(r.inventory_ref_id);
    out.set(k, (out.get(k) ?? 0) + Number(r.inventory_units ?? 0));
  }
  return out;
}

// ─── Transiciones: liberar y confirmar ────────────────────────────────────────

/** Libera dentro de `tx` (ya con la reserva bloqueada por quien llama o aquí). Devuelve si liberó. */
async function releaseLocked(tx: Exec, r: HoldRow, reason: ReleaseReason, now: number): Promise<boolean> {
  if (r.hold_status !== "retenida" && r.hold_status !== "confirmada") return false;
  const n = await affected(tx, sql`
    UPDATE reservations SET hold_status = 'liberada', hold_release_reason = ${reason}, updated_at = ${now}
    WHERE id = ${r.id} AND hold_status IN ('retenida', 'confirmada')`);
  if (n !== 1) return false;
  if (r.inventory_kind === "spa_slot") {
    await tx.execute(sql`UPDATE spa_slots SET bookedCount = GREATEST(bookedCount - ${Number(r.inventory_units ?? 0)}, 0) WHERE id = ${r.inventory_ref_id}`);
  }
  return true;
}

/** Libera la plaza de una reserva (pago fallido, cancelación, caducidad). Idempotente. */
export async function releaseInventoryHold(reservationId: number, reason: ReleaseReason, exec?: Exec, now = Date.now()): Promise<boolean> {
  return inTx(async (tx) => {
    const [r] = await rows<HoldRow>(tx, sql`SELECT ${HOLD_COLUMNS} FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
    if (!r || !r.inventory_kind) return false;
    return releaseLocked(tx, r, reason, now);
  }, exec);
}

export type ConfirmOutcome = "confirmada" | "conflicto" | "sin_cambios";

/**
 * Confirma la plaza de una reserva pagada. Idempotente: si ya está confirmada no hace nada. Si la
 * retención se había liberado (o, en hotel, caducado), vuelve a ocupar la plaza solo si queda sitio;
 * si no, la marca como conflicto (pagada sin plaza) y no sobrevende.
 */
export async function confirmInventoryHold(reservationId: number, now = Date.now()): Promise<ConfirmOutcome> {
  return inTx(async (tx) => {
    const [peek] = await rows<HoldRow>(tx, sql`SELECT ${HOLD_COLUMNS} FROM reservations WHERE id = ${reservationId}`);
    if (!peek || !peek.inventory_kind) return "sin_cambios";
    // Mismo orden de bloqueo que la retención de hotel: primero el tipo de habitación
    if (peek.inventory_kind === "hotel_room") {
      await tx.execute(sql`SELECT id FROM room_types WHERE id = ${peek.inventory_ref_id} FOR UPDATE`);
    }
    const [r] = await rows<HoldRow>(tx, sql`SELECT ${HOLD_COLUMNS} FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
    if (r.hold_status !== "retenida" && r.hold_status !== "liberada") return "sin_cambios";
    const units = Number(r.inventory_units ?? 0);

    if (r.inventory_kind === "spa_slot") {
      // Retenida: la plaza ya está sumada en bookedCount
      if (r.hold_status === "retenida") return markHold(tx, r.id, "confirmada", now).then(() => "confirmada" as const);
      const got = await affected(tx, sql`
        UPDATE spa_slots SET bookedCount = bookedCount + ${units} WHERE id = ${r.inventory_ref_id} AND bookedCount + ${units} <= capacity`);
      const outcome = got === 1 ? "confirmada" : "conflicto";
      await markHold(tx, r.id, outcome, now);
      return outcome;
    }

    // Hotel: una retenida vigente sigue contando; si caducó o se liberó, hay que volver a comprobar el sitio
    const stillHeld = r.hold_status === "retenida" && occupiesInventory({ ...holdState(r), reservationStatus: "pending_payment" }, now);
    let outcome: "confirmada" | "conflicto" = "confirmada";
    if (!stillHeld) {
      const free = await lockedHotelAvailability(tx, { roomTypeId: Number(r.inventory_ref_id), checkIn: r.stay_check_in!, checkOut: r.stay_check_out! }, now, r.id);
      if (free < units) outcome = "conflicto";
    }
    await markHold(tx, r.id, outcome, now);
    return outcome;
  });
}

/** Aplica el resultado de un pago a todas las reservas del pedido (carrito). Idempotente. */
export async function applyPaymentToInventoryHolds(merchantOrder: string, authorized: boolean, now = Date.now()) {
  const list = await rows<{ id: number }>(await db(), sql`
    SELECT id FROM reservations WHERE merchant_order = ${merchantOrder} AND inventory_kind IS NOT NULL`);
  const result = { confirmed: 0, conflicts: 0, released: 0 };
  for (const { id } of list) {
    if (authorized) {
      const o = await confirmInventoryHold(id, now);
      if (o === "confirmada") result.confirmed++;
      if (o === "conflicto") result.conflicts++;
    } else if (await releaseInventoryHold(id, "pago_fallido", undefined, now)) {
      result.released++;
    }
  }
  if (result.conflicts > 0) {
    console.error(`[Inventario] Pago confirmado sin plaza disponible (conflicto) en el pedido ${merchantOrder}: requiere gestión manual`);
  }
  return result;
}

// ─── Caducidad y sincronización con el estado de la reserva ───────────────────

/** Libera las retenciones de una franja que ya no deben ocuparla (dentro de la transacción de retención). */
async function settleSpaSlotHolds(tx: Exec, slotId: number, now: number) {
  const list = await rows<HoldRow>(tx, sql`
    SELECT ${HOLD_COLUMNS} FROM reservations
    WHERE inventory_kind = 'spa_slot' AND inventory_ref_id = ${slotId} AND hold_status IN ('retenida', 'confirmada')
    FOR UPDATE`);
  for (const r of list) {
    const action = decideHoldAction(holdState(r), now);
    if (action.type === "liberar") await releaseLocked(tx, r, action.reason, now);
  }
}

/** Retenciones cuyo estado no corresponde al de su reserva (caducadas, de reservas pagadas o anuladas). */
async function pendingHoldActions(now: number, kind?: InventoryKind): Promise<Array<{ row: HoldRow; action: HoldAction }>> {
  const list = await rows<HoldRow>(await db(), sql`
    SELECT ${HOLD_COLUMNS} FROM reservations
    WHERE inventory_kind IS NOT NULL ${kind ? sql`AND inventory_kind = ${kind}` : sql``}
      AND (
        (hold_status IN ('retenida', 'confirmada') AND status IN ('cancelled', 'failed'))
        OR (hold_status = 'retenida' AND (status = 'paid' OR hold_expires_at <= ${now}))
        OR (hold_status = 'liberada' AND status = 'paid')
      )`);
  return list.map((row) => ({ row, action: decideHoldAction(holdState(row), now) })).filter((x) => x.action.type !== "ninguna");
}

/**
 * Pone cada retención de acuerdo con su reserva: libera las caducadas y las de reservas fallidas o
 * anuladas por cualquier vía (también las que no pasan por este módulo), y confirma las de reservas
 * pagadas. Es lo que ejecuta la tarea de checkouts abandonados; se puede invocar a mano.
 */
export async function syncInventoryHolds(now = Date.now(), kind?: InventoryKind) {
  const result = { released: 0, expired: 0, confirmed: 0, conflicts: 0 };
  for (const { row, action } of await pendingHoldActions(now, kind)) {
    if (action.type === "liberar") {
      if (await releaseInventoryHold(row.id, action.reason, undefined, now)) {
        result.released++;
        if (action.reason === "caducada") result.expired++;
      }
    } else if (action.type === "confirmar") {
      const o = await confirmInventoryHold(row.id, now);
      if (o === "confirmada") result.confirmed++;
      if (o === "conflicto") result.conflicts++;
    }
  }
  return result;
}

// ─── Reconciliación ───────────────────────────────────────────────────────────

export interface InventoryReport {
  checkedAt: number;
  /** Retenciones desalineadas con su reserva (lo que `syncInventoryHolds` corregiría). */
  pendingActions: { release: number; confirm: number };
  spaDrift: SpaSlotDrift[];
  /** Franjas con más plazas vivas que capacidad (sobreventa ya producida). */
  spaOverbooked: Array<{ slotId: number; expected: number; capacity: number }>;
  hotelOverbooked: Array<{ roomTypeId: number; date: string; occupied: number; capacity: number }>;
  conflicts: Array<{ reservationId: number; kind: InventoryKind; refId: number }>;
  applied: boolean;
  fixed: { holds: number; spaSlots: number };
}

async function spaLiveUnits(exec: Pick<Db, "execute">, slotIds?: readonly number[]) {
  const list = await rows<{ slot: number; units: number | string }>(exec, sql`
    SELECT inventory_ref_id AS slot, SUM(inventory_units) AS units FROM reservations
    WHERE inventory_kind = 'spa_slot' AND hold_status IN ('retenida', 'confirmada')
      ${slotIds ? sql`AND inventory_ref_id IN (${idList(slotIds)})` : sql``}
    GROUP BY inventory_ref_id`);
  return new Map(list.map((r) => [Number(r.slot), Number(r.units)]));
}

/**
 * Recalcula la ocupación desde las reservas vivas y la compara con lo almacenado.
 * Por defecto SOLO informa. Con `apply: true` sincroniza las retenciones y fija `spa_slots.bookedCount`
 * a las plazas vivas (cada franja bajo bloqueo). Ojo: un `bookedCount` ajustado a mano para reservas que
 * no existen como reserva aparece como desajuste y la corrección lo sobrescribe.
 * La sobreventa del hotel no tiene contador que corregir: se informa para gestión manual.
 */
export async function reconcileInventory(opts: { apply?: boolean; kind?: InventoryKind; fromDate?: string; now?: number } = {}): Promise<InventoryReport> {
  const now = opts.now ?? Date.now();
  const fromDate = opts.fromDate ?? new Date(now).toISOString().slice(0, 10);
  const d = await db();
  const report: InventoryReport = {
    checkedAt: now,
    pendingActions: { release: 0, confirm: 0 },
    spaDrift: [],
    spaOverbooked: [],
    hotelOverbooked: [],
    conflicts: [],
    applied: !!opts.apply,
    fixed: { holds: 0, spaSlots: 0 },
  };

  const pending = await pendingHoldActions(now, opts.kind);
  report.pendingActions.release = pending.filter((p) => p.action.type === "liberar").length;
  report.pendingActions.confirm = pending.filter((p) => p.action.type === "confirmar").length;
  if (opts.apply && pending.length > 0) {
    const s = await syncInventoryHolds(now, opts.kind);
    report.fixed.holds = s.released + s.confirmed + s.conflicts;
  }

  if (!opts.kind || opts.kind === "spa_slot") {
    const live = await spaLiveUnits(d);
    const liveIds = Array.from(live.keys());
    const slots = await rows<{ id: number; bookedCount: number; capacity: number }>(d, sql`
      SELECT id, bookedCount, capacity FROM spa_slots
      WHERE date >= ${fromDate} AND (bookedCount > 0 ${liveIds.length ? sql`OR id IN (${idList(liveIds)})` : sql``})`);
    report.spaDrift = spaSlotDrift(slots, live);
    report.spaOverbooked = slots
      .filter((s) => (live.get(s.id) ?? 0) > s.capacity)
      .map((s) => ({ slotId: s.id, expected: live.get(s.id) ?? 0, capacity: s.capacity }));
    if (opts.apply) {
      for (const drift of report.spaDrift) {
        await inTx(async (tx) => {
          // Bloqueo de la franja y recálculo bajo él: una retención en curso espera o ya está confirmada
          await tx.execute(sql`SELECT id FROM spa_slots WHERE id = ${drift.slotId} FOR UPDATE`);
          const expected = (await spaLiveUnits(tx, [drift.slotId])).get(drift.slotId) ?? 0;
          if (await affected(tx, sql`UPDATE spa_slots SET bookedCount = ${expected} WHERE id = ${drift.slotId} AND bookedCount <> ${expected}`)) report.fixed.spaSlots++;
        });
      }
    }
  }

  if (!opts.kind || opts.kind === "hotel_room") {
    const [range] = await rows<{ maxOut: string | null }>(d, sql`
      SELECT MAX(stay_check_out) AS maxOut FROM reservations
      WHERE inventory_kind = 'hotel_room' AND hold_status IN ('retenida', 'confirmada') AND stay_check_out > ${fromDate}`);
    if (range?.maxOut) {
      const occ = await hotelOccupancy(d, null, fromDate, range.maxOut, now);
      const roomIds = Array.from(occ.keys());
      const rooms = roomIds.length ? await rows<{ id: number; totalUnits: number }>(d, sql`SELECT id, totalUnits FROM room_types WHERE id IN (${idList(roomIds)})`) : [];
      const blocks = roomIds.length ? await rows<{ roomTypeId: number; date: string; availableUnits: number }>(d, sql`
        SELECT roomTypeId, date, availableUnits FROM room_blocks WHERE roomTypeId IN (${idList(roomIds)}) AND date >= ${fromDate} AND date < ${range.maxOut}`) : [];
      for (const room of rooms) {
        for (const [date, occupied] of Array.from(occ.get(room.id) ?? new Map<string, number>())) {
          const block = blocks.find((b) => Number(b.roomTypeId) === room.id && b.date === date);
          const capacity = nightCapacity(room.totalUnits, block?.availableUnits);
          if (occupied > capacity) report.hotelOverbooked.push({ roomTypeId: room.id, date, occupied, capacity });
        }
      }
    }
  }

  const conflicts = await rows<{ id: number; inventory_kind: InventoryKind; inventory_ref_id: number }>(d, sql`
    SELECT id, inventory_kind, inventory_ref_id FROM reservations
    WHERE hold_status = 'conflicto' ${opts.kind ? sql`AND inventory_kind = ${opts.kind}` : sql``}`);
  report.conflicts = conflicts.map((c) => ({ reservationId: c.id, kind: c.inventory_kind, refId: Number(c.inventory_ref_id) }));
  return report;
}
