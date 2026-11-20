/**
 * Variante comprada en una línea del pedido de tienda (`reservations.variant_id`, migración 0082). Se guarda al crear la
 * línea para poder identificar INEQUÍVOCAMENTE la opción pagada (la usa el LMS). Nunca impide vender: sin la columna
 * (migración sin aplicar) se registra y se sigue.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export async function markOrderVariant(reservationId: number, variantId: number | null | undefined): Promise<void> {
  if (!variantId || variantId <= 0) return;
  try {
    const d = await getDb();
    if (!d) return;
    await d.execute(sql`UPDATE reservations SET variant_id = ${variantId} WHERE id = ${reservationId}`);
  } catch (e) {
    console.error(JSON.stringify({ ctx: "Pedido", event: "variant_not_saved", reservationId, error: e instanceof Error ? e.name : "error" }));
  }
}
