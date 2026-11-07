/**
 * Hotel Net · folio de estancia — lógica pura (sin base de datos): reparto del alojamiento por noche, saldo del folio,
 * líneas de la factura y forma de pago, y cuándo se puede cerrar. El acceso a datos vive en `hotelFolioDb.ts`.
 *
 * Importes en céntimos con IVA incluido (como las reservas del Core); el IVA, en puntos básicos (1000 = 10 %).
 */

/** IVA del alojamiento por defecto (10 %), configurable por empresa en `hotel_pms_settings`. */
export const DEFAULT_ACCOMMODATION_TAX_BP = 1000;

export const FOLIO_CHARGE_CATEGORIES = ["alojamiento", "extra", "restaurante", "spa", "minibar", "otro"] as const;
export type FolioChargeCategory = (typeof FOLIO_CHARGE_CATEGORIES)[number];

export const FOLIO_PAYMENT_METHODS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;
export type FolioPaymentMethod = (typeof FOLIO_PAYMENT_METHODS)[number];

/** Pago previo de la reserva (cobro web o validado en el módulo de reservas) traído al folio. */
export const PREVIOUS_PAYMENT_CATEGORY = "pago_reserva";

export interface FolioItem {
  kind: "cargo" | "pago";
  category: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  taxRateBp: number | null;
  nightDate: string | null;
}

/** IVA válido (0 % a 30 %, en puntos básicos enteros); fuera de rango, null. */
export function normalizeTaxBp(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3000) return null;
  return n;
}

/**
 * Reparte el importe del alojamiento entre las noches: céntimos iguales y el resto, céntimo a céntimo, en las primeras
 * noches. La suma es siempre exactamente el total.
 */
export function splitAccommodation(totalCents: number, nights: readonly string[]): Array<{ night: string; cents: number }> {
  const total = Math.max(0, Math.round(totalCents));
  if (nights.length === 0) return [];
  const base = Math.floor(total / nights.length);
  let rest = total - base * nights.length;
  return nights.map((night) => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return { night, cents: base + extra };
  });
}

export interface FolioTotals {
  chargesCents: number;
  paymentsCents: number;
  balanceCents: number;
}

export function folioTotals(items: readonly Pick<FolioItem, "kind" | "amountCents">[]): FolioTotals {
  let charges = 0;
  let payments = 0;
  for (const it of items) {
    if (it.kind === "cargo") charges += it.amountCents;
    else payments += it.amountCents;
  }
  return { chargesCents: charges, paymentsCents: payments, balanceCents: charges - payments };
}

/** Importe de un cargo: cantidad × precio unitario (con IVA incluido). */
export function chargeAmount(quantity: number, unitPriceCents: number): number {
  return Math.round(Math.max(1, Math.trunc(quantity)) * Math.round(unitPriceCents));
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime: "general";
  taxRate: number;
}

const euros = (cents: number) => Math.round(cents) / 100;

function shortDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Líneas de la factura del folio (formato de `invoices.itemsJson`): el alojamiento se agrupa en una línea por tipo de
 * IVA con el número de noches y sus fechas; cada extra es su propia línea. Importes en euros, IVA incluido.
 */
export function folioInvoiceLines(items: readonly FolioItem[], opts: { roomName: string | null; defaultTaxBp: number }): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const nightsByRate = new Map<number, FolioItem[]>();
  for (const it of items) {
    if (it.kind !== "cargo" || it.amountCents === 0) continue;
    const bp = it.taxRateBp ?? opts.defaultTaxBp;
    if (it.category === "alojamiento" && it.nightDate) {
      nightsByRate.set(bp, [...(nightsByRate.get(bp) ?? []), it]);
      continue;
    }
    const qty = Math.max(1, it.quantity);
    lines.push({
      description: it.description?.trim() || it.category,
      quantity: qty,
      unitPrice: euros(Math.round(it.amountCents / qty)),
      total: euros(it.amountCents),
      fiscalRegime: "general",
      taxRate: bp / 100,
    });
  }
  const accommodation: InvoiceLine[] = [];
  for (const [bp, nights] of Array.from(nightsByRate.entries())) {
    const sorted = nights.slice().sort((a, b) => (a.nightDate! < b.nightDate! ? -1 : 1));
    const cents = sorted.reduce((s, n) => s + n.amountCents, 0);
    const range = sorted.length === 1 ? shortDay(sorted[0].nightDate!) : `${shortDay(sorted[0].nightDate!)}–${shortDay(sorted[sorted.length - 1].nightDate!)}`;
    accommodation.push({
      description: `Alojamiento${opts.roomName ? ` · ${opts.roomName}` : ""} · ${sorted.length} noche${sorted.length > 1 ? "s" : ""} (${range})`,
      quantity: sorted.length,
      unitPrice: euros(Math.round(cents / sorted.length)),
      total: euros(cents),
      fiscalRegime: "general",
      taxRate: bp / 100,
    });
  }
  return [...accommodation, ...lines];
}

/** Forma de pago de la factura (enum de `invoices.paymentMethod`): la del pago de mayor importe. */
export function invoicePaymentMethod(
  payments: ReadonlyArray<{ category: string; amountCents: number }>,
  previousMethod: string | null = null,
): "efectivo" | "tarjeta_fisica" | "transferencia" | "otro" | "redsys" | "tarjeta_redsys" {
  const map: Record<string, "efectivo" | "tarjeta_fisica" | "transferencia" | "otro"> = {
    efectivo: "efectivo",
    tarjeta: "tarjeta_fisica",
    transferencia: "transferencia",
    otro: "otro",
  };
  const top = payments.filter((p) => p.amountCents > 0).slice().sort((a, b) => b.amountCents - a.amountCents)[0];
  if (!top) return "otro";
  if (top.category === PREVIOUS_PAYMENT_CATEGORY) {
    const allowed = ["efectivo", "tarjeta_fisica", "transferencia", "otro", "redsys", "tarjeta_redsys"] as const;
    return (allowed as readonly string[]).includes(previousMethod ?? "") ? (previousMethod as (typeof allowed)[number]) : "otro";
  }
  return map[top.category] ?? "otro";
}

/** Estado de la reserva que decide qué se puede hacer con su folio. */
export interface FolioReservation {
  status: string;
  statusReservation: string | null;
}

/** Motivo por el que no se pueden añadir cargos ni pagos, o null. */
export function folioEditBlocker(folioStatus: string, r: FolioReservation): string | null {
  if (folioStatus === "cerrado") return "El folio está cerrado: ya se emitió su factura.";
  if (r.status === "cancelled" || r.status === "failed" || r.statusReservation === "ANULADA") return "La reserva está cancelada.";
  return null;
}

/**
 * Motivo por el que no se puede cerrar el folio, o null. Se cierra con el huésped dentro o tras el check-out, sin
 * saldo pendiente ni pagos de más (la factura recoge lo cobrado).
 */
export function folioCloseBlocker(folioStatus: string, r: FolioReservation, t: FolioTotals): string | null {
  const edit = folioEditBlocker(folioStatus, r);
  if (edit) return edit;
  if (r.statusReservation !== "EN_CURSO" && r.statusReservation !== "FINALIZADA") return "El folio se cierra tras el check-in del huésped.";
  if (t.balanceCents > 0) return `Queda un saldo pendiente de ${(t.balanceCents / 100).toFixed(2)} €: registra el pago antes de cerrar.`;
  if (t.balanceCents < 0) return `Hay ${(-t.balanceCents / 100).toFixed(2)} € cobrados de más: corrige los pagos antes de cerrar.`;
  return null;
}
