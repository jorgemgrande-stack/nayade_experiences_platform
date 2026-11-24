/**
 * Reglas puras del checkout del carrito (`reservations.cartCheckout`): importes en céntimos enteros, descuentos,
 * huella de idempotencia y entradas del historial del pedido. Sin acceso a BD ni a pasarelas: todo se prueba aislado.
 *
 * Decisiones (documentadas aquí porque son la «política» del cobro):
 *  - Importes siempre en céntimos enteros. Los decimales de la BD (strings) se leen exactos; los `number` en euros
 *    solo se redondean una vez, al convertirlos.
 *  - Importe mínimo del pedido: 0,50 € (mínimo de Stripe). Un pedido de 0 € (p. ej. descuento del 100 %) NO se cobra
 *    ni crea reservas: se rechaza con un mensaje claro (no existe flujo de pedido gratuito en la tienda).
 *  - Un descuento caducado, inactivo, agotado o inexistente se RECHAZA (antes se ignoraba en silencio y se cobraba
 *    el precio completo sin avisar).
 *  - El uso del código se consume al CONFIRMAR el pago (applyPaymentResult), no al crear el carrito.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

/** Importe mínimo cobrable por la pasarela, en céntimos (0,50 €). Coincide con STRIPE_MIN_AMOUNT_CENTS. */
export const MIN_CHARGE_CENTS = 50;

/** Ventana en la que un pedido pendiente idéntico se reutiliza (clics repetidos). Menor que la caducidad de Stripe (31 min). */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** Euros → céntimos enteros. Un decimal de la BD («12.50») se lee exacto; un número se redondea una sola vez. */
export function eurosToCents(v: unknown): number {
  if (typeof v === "string") {
    const m = /^\s*(-?)(\d+)(?:\.(\d{0,}))?\s*$/.exec(v);
    if (m) {
      const frac = (m[3] ?? "").padEnd(2, "0");
      const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
      return m[1] ? -cents : cents;
    }
    return Number.NaN;
  }
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100 + Math.sign(n) * 1e-9) : Number.NaN;
}

export interface PricedVariant { id: number; priceType?: string | null; priceModifier?: unknown; name?: string | null; isRequired?: boolean | null }

/**
 * Precio por persona/unidad en céntimos con la variante elegida (misma fórmula de siempre):
 * porcentaje → base + base·mod/100; fijo y «por persona» → el precio de la variante.
 */
export function variantUnitCents(baseCents: number, variant: PricedVariant): number {
  const mod = eurosToCents(String(variant.priceModifier ?? 0));
  if (variant.priceType === "percentage") {
    // mod está en céntimos de «porcentaje» (12,50 % → 1250): base·mod/100 con entero
    return baseCents + Math.round((baseCents * mod) / 10000);
  }
  return mod;
}

/** Total de una línea en céntimos y unidades reservadas (per_person: sin unidades; per_unit: ceil(personas/capacidad) con tope). */
export function lineTotalCents(unitCents: number, people: number, pricingType: "per_person" | "per_unit", unitCapacity: number | null | undefined, maxUnits: number | null | undefined): { totalCents: number; unitsBooked: number } {
  if (pricingType === "per_unit" && unitCapacity && unitCapacity > 0) {
    let units = Math.ceil(people / unitCapacity);
    if (maxUnits && units > maxUnits) units = maxUnits;
    return { totalCents: units * unitCents, unitsBooked: units };
  }
  return { totalCents: unitCents * people, unitsBooked: 0 };
}

export interface DiscountRow {
  id: number;
  code: string;
  discountType: string | null;
  discountPercent: unknown;
  discountAmount: unknown;
  status: string;
  expiresAt: Date | string | null;
  maxUses: number | null;
  currentUses: number;
}

/** Motivo por el que el código no se puede usar ahora (o null si es válido). */
export function discountProblem(row: DiscountRow | undefined | null, now = new Date()): string | null {
  if (!row) return "El código de descuento no existe. Revísalo e inténtalo de nuevo.";
  if (row.status === "inactive") return "El código de descuento está inactivo.";
  if (row.status === "expired") return "El código de descuento ha caducado.";
  if (row.status !== "active") return "El código de descuento no está disponible.";
  if (row.expiresAt && new Date(row.expiresAt) < now) return "El código de descuento ha caducado.";
  if (row.maxUses !== null && row.maxUses !== undefined && row.currentUses >= row.maxUses) return "El código de descuento ya se ha agotado.";
  return null;
}

/** Descuento en céntimos sobre el total (entero, nunca mayor que el total). */
export function discountCents(totalCents: number, row: Pick<DiscountRow, "discountType" | "discountPercent" | "discountAmount">): number {
  let d: number;
  if (row.discountType === "fixed") {
    d = eurosToCents(String(row.discountAmount ?? "0"));
  } else {
    const basisPoints = eurosToCents(String(row.discountPercent ?? "0")); // 12,5 % → 1250
    d = Math.round((totalCents * basisPoints) / 10000);
  }
  return Math.min(totalCents, Math.max(0, Number.isFinite(d) ? d : 0));
}

/** Rechaza el importe final antes de crear reservas o llamar a la pasarela. */
export function assertChargeable(finalCents: number): void {
  if (!Number.isInteger(finalCents) || finalCents <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El importe del pedido es 0 €: no se puede pagar online. Contacta con nosotros para completar la reserva. No se ha realizado ningún cobro." });
  }
  if (finalCents < MIN_CHARGE_CENTS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El importe mínimo para pagar online es de 0,50 €. No se ha realizado ningún cobro." });
  }
}

// ─── Historial del pedido (sin columnas nuevas) ───────────────────────────────

export const DISCOUNT_LOG_ACTION = "descuento_codigo";
export const FINGERPRINT_LOG_ACTION = "checkout_huella";

export interface OrderDiscount { id: number; code: string; percent: number; discountCents: number; originalCents: number; finalCents: number }

export function discountLogEntry(d: OrderDiscount, now: number) {
  return { ts: now, actor: "Comprador", action: DISCOUNT_LOG_ACTION, to: JSON.stringify(d) };
}
export function fingerprintLogEntry(fp: string, now: number) {
  return { ts: now, actor: "Comprador", action: FINGERPRINT_LOG_ACTION, to: fp };
}

export function discountFromLog(log: unknown): OrderDiscount | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as { action?: string; to?: string } | null;
    if (e?.action !== DISCOUNT_LOG_ACTION || typeof e.to !== "string") continue;
    try {
      const d = JSON.parse(e.to) as OrderDiscount;
      if (Number.isInteger(d.id) && Number.isInteger(d.discountCents)) return d;
    } catch { /* entrada ilegible: se ignora */ }
  }
  return null;
}

export function fingerprintFromLog(log: unknown): string | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as { action?: string; to?: string } | null;
    if (e?.action === FINGERPRINT_LOG_ACTION && typeof e.to === "string") return e.to;
  }
  return null;
}

/**
 * Huella del carrito: mismo comprador + mismas líneas + mismo importe final + mismo código + mismos datos de facturación
 * y comentarios = el mismo pedido. Cambiar cualquier cosa (otra fecha, otra cantidad, otra variante) da otra huella.
 */
export function checkoutFingerprint(p: {
  email: string;
  items: Array<{ productId: number; bookingDate: string; people: number; variantId?: number | null; legoPackLineIds?: number[] | null; editionId?: number | null; participants?: string[] | null }>;
  finalCents: number;
  discountCodeId?: number | null;
  comments?: string | null;
  billing?: unknown;
}): string {
  const lines = p.items
    // La convocatoria elegida y los nombres de los participantes también distinguen el pedido (otra fecha = otras plazas)
    .map((i) => [i.productId, i.bookingDate, i.people, i.variantId ?? 0, [...(i.legoPackLineIds ?? [])].sort((a, b) => a - b), i.editionId ?? 0, (i.participants ?? []).map((n) => n.trim()).filter(Boolean)])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const payload = JSON.stringify({ e: p.email.trim().toLowerCase(), l: lines, a: p.finalCents, d: p.discountCodeId ?? 0, c: (p.comments ?? "").trim(), b: p.billing ?? null });
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

// ─── Exclusión mutua en el proceso: dos clics simultáneos no crean dos pedidos ────────────────────────────────────────

const tails = new Map<string, Promise<void>>();

/** Serializa las ejecuciones con la misma clave: la segunda espera a la primera y así ve ya su pedido y lo reutiliza. Devuelve la función que libera. */
export async function acquireCheckoutLock(key: string): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  return () => {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  };
}

// ─── Límites de cantidad: por opción (minQty/maxQty) y por producto (minPersons/maxPersons) ──────────────────────

/** Mensaje si `people` incumple los límites de la opción (nulo = sin límite); null si los cumple. */
export function variantQuantityProblem(variant: { name?: string | null; minQty?: number | null; maxQty?: number | null } | undefined | null, people: number): string | null {
  if (!variant) return null;
  const label = variant.name ? `«${variant.name}»` : "Esta opción";
  if (variant.minQty != null && variant.minQty > 0 && people < variant.minQty) return `${label} requiere al menos ${variant.minQty} ${variant.minQty === 1 ? "participante" : "participantes"}. Elige otra opción o añade participantes.`;
  if (variant.maxQty != null && variant.maxQty > 0 && people > variant.maxQty) return `${label} admite como máximo ${variant.maxQty} ${variant.maxQty === 1 ? "participante" : "participantes"}. Elige otra opción o reduce los participantes.`;
  return null;
}

/** Mensaje si `people` incumple minPersons/maxPersons del producto (nulos o 0 = sin límite; mínimo por defecto 1). */
export function productPeopleProblem(product: { title: string; minPersons?: number | null; maxPersons?: number | null }, people: number): string | null {
  if (product.minPersons != null && product.minPersons > 1 && people < product.minPersons) return `«${product.title}» requiere al menos ${product.minPersons} participantes.`;
  if (product.maxPersons != null && product.maxPersons > 0 && people > product.maxPersons) return `«${product.title}» admite como máximo ${product.maxPersons} participantes.`;
  return null;
}
