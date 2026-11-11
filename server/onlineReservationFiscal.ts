/**
 * Fiscalidad de una reserva cobrada online (notificación de Redsys) que NO es una experiencia.
 *
 * Las reservas web de hotel y de SPA guardan en `productId` el tipo de habitación o el tratamiento (no un id de
 * `experiences`). Si la notificación buscara ese id en el catálogo de experiencias tomaría el IVA (o el régimen REAV)
 * de una experiencia que no tiene nada que ver. Aquí se reconocen esas reservas y se resuelve su IVA propio:
 *  - hotel: el IVA de alojamiento de la empresa (ajustes del PMS; 10 % si no está configurado);
 *  - SPA: el IVA del tratamiento reservado (21 % si el tratamiento no indica el suyo, como el TPV).
 * Nunca abren expediente REAV automático (solo las experiencias con régimen REAV lo hacen).
 */
import { sql } from "drizzle-orm";
import { db, rows } from "./hotelPmsDb";
import { DEFAULT_ACCOMMODATION_TAX_BP } from "./hotelFolio";

export type OnlineReservationKind = "hotel" | "spa";

/** IVA de los tratamientos de SPA que no indican el suyo (el mismo criterio que el cargo a habitación y el TPV). */
export const SPA_TAX_FALLBACK = 21;

/** Clasifica la reserva por su inventario (y, para reservas de hotel heredadas, por el detalle guardado). */
export function onlineReservationKind(r: { inventoryKind?: string | null; extrasJson?: string | null }): OnlineReservationKind | null {
  if (r.inventoryKind === "hotel_room") return "hotel";
  if (r.inventoryKind === "spa_slot") return "spa";
  if (r.extrasJson) {
    try {
      const t = (JSON.parse(r.extrasJson) as { type?: unknown } | null)?.type;
      if (t === "hotel") return "hotel";
      if (t === "spa") return "spa";
    } catch {
      /* detalle no JSON: no es una reserva de hotel/SPA */
    }
  }
  return null;
}

/** Tipo de IVA (en %) de la factura web de una reserva de hotel o de SPA. */
export async function onlineReservationTaxRate(kind: OnlineReservationKind, reservationId: number): Promise<number> {
  const d = await db();
  if (kind === "hotel") {
    try {
      const [s] = await rows<{ bp: number }>(d, sql`SELECT accommodation_tax_bp AS bp FROM hotel_pms_settings WHERE id = 1`);
      return (s ? Number(s.bp) : DEFAULT_ACCOMMODATION_TAX_BP) / 100;
    } catch {
      // PMS sin instalar en esta empresa: el IVA de alojamiento por defecto
      return DEFAULT_ACCOMMODATION_TAX_BP / 100;
    }
  }
  const [t] = await rows<{ taxRate: string | null; fiscalRegime: string | null }>(d, sql`
    SELECT t.taxRate, t.fiscalRegime FROM reservations r
    JOIN spa_slots s ON s.id = r.inventory_ref_id
    LEFT JOIN spa_treatments t ON t.id = s.treatmentId
    WHERE r.id = ${reservationId} AND r.inventory_kind = 'spa_slot'`).catch(() => []);
  if (t?.fiscalRegime === "reav") return 0;
  return t?.taxRate != null ? Number(t.taxRate) : SPA_TAX_FALLBACK;
}

/** Tipo de inventario de cada reserva (la columna no está en el esquema del ORM). */
export async function inventoryKindsOf(reservationIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (reservationIds.length === 0) return out;
  const d = await db();
  const list = await rows<{ id: number; kind: string | null }>(d, sql`
    SELECT id, inventory_kind AS kind FROM reservations WHERE id IN (${sql.join(reservationIds.map((id) => sql`${id}`), sql`, `)})`).catch(() => []);
  for (const r of list) out.set(Number(r.id), r.kind ?? null);
  return out;
}
