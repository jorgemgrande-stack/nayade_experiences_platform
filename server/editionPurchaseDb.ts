/**
 * Compra de tienda ligada a una convocatoria (acceso a datos). Las reglas puras están en shared/editionPurchase.ts y la
 * retención atómica de plazas en inventoryHoldsDb.ts (`holdEditionSeatsAndCreateReservation`).
 *
 * Cableado en `reservations.cartCheckout`: `prepareEditionLine` por línea (valida y devuelve el precio/fecha de la
 * edición o null si el producto no tiene convocatorias) y `createEditionLine` al crear la reserva pendiente.
 * La edición comprada queda en la propia reserva (`inventory_kind = 'edition_seat'`, `inventory_ref_id` = edición,
 * `inventory_units` = plazas): sin columnas nuevas.
 */
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { isMissingEditionsSchema } from "./editionsDb";
import { applyPaymentToInventoryHolds, holdEditionSeatsAndCreateReservation, settleEditionSeats } from "./inventoryHoldsDb";
import {
  editionLocalDate,
  editionNote,
  editionRequirement,
  editionSaleVerdict,
  type SaleEdition,
} from "../shared/editionPurchase";

export interface EditionLine {
  editionId: number;
  experienceId: number;
  seats: number;
  label: string;
  /** Fecha local de inicio (YYYY-MM-DD): es la fecha del booking operativo y del expediente REAV. */
  bookingDate: string;
  priceOverride: number | null;
  /** Nota para la reserva: convocatoria, fechas de inicio y fin, lugar. */
  note: string;
}

function toSaleEdition(r: Record<string, any>): SaleEdition {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: Number(r.id),
    experienceId: Number(r.experience_id),
    label: String(r.label ?? ""),
    startsAt: Number(r.starts_at),
    endsAt: n(r.ends_at),
    timezone: String(r.timezone ?? "Europe/Madrid"),
    locationNote: String(r.location_note ?? ""),
    capacity: n(r.capacity),
    reserved: Number(r.reserved ?? 0),
    status: String(r.status),
    priceOverride: n(r.price_override),
  };
}

/** Todas las ediciones del producto (vacío sin la migración 0070). */
export async function loadProductEditions(experienceId: number): Promise<SaleEdition[]> {
  const d = await getDb();
  // Sin conexión SQL (dobles de prueba que solo simulan el catálogo) no hay convocatorias
  if (!d || typeof d.execute !== "function") return [];
  try {
    const [r] = (await d.execute(sql`SELECT * FROM product_editions WHERE experience_id = ${experienceId}`)) as unknown as [Record<string, any>[]];
    return (Array.isArray(r) ? r : []).map(toSaleEdition);
  } catch (err) {
    if (isMissingEditionsSchema(err)) return [];
    throw err;
  }
}

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/**
 * Valida la línea contra la convocatoria. null = el producto no tiene convocatorias (comportamiento de siempre).
 * Lanza BAD_REQUEST con un texto para la persona si falta elegir fecha, no hay fechas abiertas, la edición es ajena,
 * está cerrada/empezada/completa o no quedan plazas suficientes.
 */
export async function prepareEditionLine(input: { experienceId: number; editionId?: number; people: number; now?: number; ignoreSeats?: boolean }): Promise<EditionLine | null> {
  const now = input.now ?? Date.now();
  const editions = await loadProductEditions(input.experienceId);
  const requirement = editionRequirement(editions, now);
  if (requirement === "none") {
    if (input.editionId) throw bad("La fecha elegida no corresponde a este producto. Vuelve a elegirla en la ficha.");
    return null;
  }
  if (requirement === "blocked") throw bad("Este producto no tiene fechas abiertas a la venta ahora mismo. Solicita información para la próxima convocatoria.");
  if (!input.editionId) throw bad("Elige la fecha (convocatoria) antes de pagar.");
  // Una retención caducada no debe hacer pasar por completa una edición con plazas
  if (editions.some((e) => e.id === input.editionId)) await settleEditionSeats(input.editionId, now).catch(() => undefined);
  const fresh = (await loadProductEditions(input.experienceId)).find((e) => e.id === input.editionId) ?? null;
  // `ignoreSeats`: solo fecha, estado y precio (el carrito lo usa para calcular la huella ANTES de saber si el pedido ya
  // existe: un clic repetido sobre un pedido que ya retiene las últimas plazas no debe fallar por «completa»). Las plazas
  // se comprueban después, solo si hay que crear el pedido, y la retención atómica es la garantía final.
  const verdict = editionSaleVerdict(input.ignoreSeats && fresh ? { ...fresh, capacity: null, reserved: 0 } : fresh, input.experienceId, input.people, now);
  if (!verdict.ok) throw bad(verdict.message);
  const e = fresh!;
  return {
    editionId: e.id,
    experienceId: e.experienceId,
    seats: input.people,
    label: e.label,
    bookingDate: editionLocalDate(e.startsAt, e.timezone),
    priceOverride: e.priceOverride,
    note: editionNote(e),
  };
}

/**
 * Crea la reserva pendiente reteniendo las plazas (atómico). Si ya no caben, cancela las líneas anteriores del mismo
 * pedido (liberando sus plazas) y rechaza el pedido entero: nunca queda un pedido a medias.
 */
export async function createEditionLine<D extends Parameters<typeof holdEditionSeatsAndCreateReservation>[1]>(line: EditionLine, data: D): Promise<number> {
  const r = await holdEditionSeatsAndCreateReservation({ editionId: line.editionId, experienceId: line.experienceId, seats: line.seats }, data);
  if (r.ok) return r.reservation.id;
  await cancelPendingOrder(data.merchantOrder);
  throw new TRPCError({
    code: "CONFLICT",
    message: r.available > 0 ? `Solo quedan ${r.available} plazas en «${line.label}». Ajusta las personas e inténtalo de nuevo.` : `La fecha «${line.label}» se ha completado o cerrado mientras comprabas.`,
  });
}

/** Anula las reservas aún pendientes de un pedido y libera sus plazas (idempotente). */
export async function cancelPendingOrder(merchantOrder: string, now = Date.now()): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d.execute(sql`UPDATE reservations SET status = 'cancelled', updated_at = ${now} WHERE merchant_order = ${merchantOrder} AND status = 'pending_payment'`);
  await applyPaymentToInventoryHolds(merchantOrder, false, now);
}
