// Utilidades de reservas — derivación del producto y de las actividades
// operativas a partir de las líneas de un presupuesto.
//
// PROBLEMA QUE RESUELVE: una reserva tiene un único `product_id` (la actividad
// principal) más un `extras_json` con las actividades adicionales. El módulo
// de Operaciones (calendario y actividades del día) muestra 1 actividad
// principal + N actividades de `extras_json`. Si un presupuesto con varias
// líneas se convierte en reserva sin volcar las líneas extra a `extras_json`,
// esas actividades desaparecen de Operaciones.

export type QuoteLineItem = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  productId?: number;
  fiscalRegime?: string;
  taxRate?: number;
};

/** Elemento de `extras_json` que consume el módulo de Operaciones. */
export type ReservationExtra = {
  productId: number | null;
  experienceTitle: string;
  name: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

/**
 * Dada la lista de líneas de un presupuesto, devuelve el `productId` de la
 * actividad principal y el `extrasJson` (JSON) con el resto de líneas como
 * actividades adicionales. Así una reserva multi-línea conserva TODAS sus
 * actividades en Operaciones.
 *
 * La línea principal es la primera con `productId`; si ninguna lo tiene, la
 * primera línea. El resto de líneas se vuelcan a `extras_json`.
 */
export function reservationProductFromQuoteItems(
  items: unknown,
  fallbackProductId = 0,
): { productId: number; extrasJson: string | null } {
  const list: QuoteLineItem[] = Array.isArray(items) ? items : [];
  if (list.length === 0) return { productId: fallbackProductId, extrasJson: null };

  let mainIdx = list.findIndex((i) => i.productId != null);
  if (mainIdx < 0) mainIdx = 0;
  const main = list[mainIdx];

  const extras: ReservationExtra[] = list
    .filter((_, idx) => idx !== mainIdx)
    .map((it) => ({
      productId: it.productId ?? null,
      experienceTitle: it.description ?? "Actividad",
      name: it.description ?? "Actividad",
      productName: it.description ?? "Actividad",
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unitPrice ?? 0),
      total: Number(it.total ?? 0),
    }));

  return {
    productId: main?.productId ?? fallbackProductId,
    extrasJson: extras.length > 0 ? JSON.stringify(extras) : null,
  };
}
