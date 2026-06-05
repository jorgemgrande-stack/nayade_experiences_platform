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
  /** Fecha de servicio propia de esta línea (YYYY-MM-DD). Si falta, hereda la fecha global del presupuesto. */
  serviceDate?: string | null;
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
  /** Fecha operativa propia del servicio (YYYY-MM-DD). null = hereda la `booking_date` de la reserva. */
  serviceDate: string | null;
};

/** Normaliza una fecha de servicio a YYYY-MM-DD, o null si no es una fecha utilizable. */
export function normalizeServiceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

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
): { productId: number; extrasJson: string | null; mainServiceDate: string | null } {
  const list: QuoteLineItem[] = Array.isArray(items) ? items : [];
  if (list.length === 0) return { productId: fallbackProductId, extrasJson: null, mainServiceDate: null };

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
      serviceDate: normalizeServiceDate(it.serviceDate),
    }));

  return {
    productId: main?.productId ?? fallbackProductId,
    extrasJson: extras.length > 0 ? JSON.stringify(extras) : null,
    mainServiceDate: normalizeServiceDate(main?.serviceDate),
  };
}

/** Parsea `extras_json` (string o ya-parseado por mysql2) a un array de extras. */
export function parseReservationExtras(extrasJson: unknown): ReservationExtra[] {
  if (!extrasJson) return [];
  if (Array.isArray(extrasJson)) return extrasJson as ReservationExtra[];
  if (typeof extrasJson === "string") {
    try {
      const parsed = JSON.parse(extrasJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Override operativo por componente que guarda el admin en `activities_op_json`. */
export type ActivityOpOverride = {
  /** Índice del componente: 0 = actividad principal, i+1 = extra `i`. */
  index: number;
  serviceDate?: string | null;
  monitorId?: number | null;
  arrivalTime?: string;
  opNotes?: string;
  consolidated?: boolean;
};

/** Un componente datado de una reserva, listo para pintarse en el calendario de operaciones. */
export type ReservationComponentDate = {
  /**
   * Índice del componente según la convención del módulo Operaciones:
   * `0` = actividad principal; `i+1` = extra `i` de `extras_json`.
   */
  index: number;
  isMain: boolean;
  /** Fecha operativa efectiva (YYYY-MM-DD) en la que debe aparecer este componente. */
  date: string;
};

/** Parsea `activities_op_json` (string o ya-parseado por mysql2) a array de overrides. */
export function parseActivityOpOverrides(json: unknown): ActivityOpOverride[] {
  if (!json) return [];
  if (Array.isArray(json)) return json as ActivityOpOverride[];
  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Expande una reserva en sus componentes datados, con la fecha EFECTIVA de cada uno.
 * Convención de índices alineada con Operaciones: principal = 0, extra `i` = `i+1`.
 *
 * Prioridad de la fecha (de mayor a menor):
 *   1. override del admin   → `activities_op_json[index].serviceDate`
 *   2. semilla del presupuesto (solo extras) → `extras_json[i].serviceDate`
 *   3. fecha de la reserva madre → `reservationDate` (`booking_date`)
 *
 * Solo calcula fechas; no decide presentación.
 */
export function reservationComponentDates(
  reservationDate: string,
  extrasJson: unknown,
  activitiesOpJson?: unknown,
): ReservationComponentDate[] {
  const overrides = parseActivityOpOverrides(activitiesOpJson);
  const overrideDate = (index: number): string | null =>
    normalizeServiceDate(overrides.find((o) => o.index === index)?.serviceDate);

  const out: ReservationComponentDate[] = [
    { index: 0, isMain: true, date: overrideDate(0) ?? reservationDate },
  ];
  parseReservationExtras(extrasJson).forEach((ex, i) => {
    const opIndex = i + 1;
    out.push({
      index: opIndex,
      isMain: false,
      date: overrideDate(opIndex) ?? normalizeServiceDate(ex?.serviceDate) ?? reservationDate,
    });
  });
  return out;
}
