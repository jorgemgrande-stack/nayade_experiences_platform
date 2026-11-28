/**
 * Estado de compra de un producto en la web pública (ficha, catálogo y carrito). Puro: sin servidor ni navegador.
 *
 * Reúne tres cosas que hasta ahora se decidían por separado: cómo se ofrece el producto (precio fijo o por solicitud),
 * si sigue a la venta (activo y publicado) y si la empresa puede cobrar online ahora mismo (`storefront.payments`).
 * Así, un producto de precio fijo cuya empresa aún no tiene pasarela se presenta como «Pronto disponible online»
 * en vez de dejar que la persona rellene todo y falle al pagar.
 */
import { isFixedOffer } from "./offerMode";
import { isPurchasable } from "./shopOrders";

export type PurchaseState =
  /** Precio fijo, a la venta y con pasarela: se puede añadir al carrito y pagar. */
  | "purchasable"
  /** Precio fijo y a la venta, pero la empresa no puede cobrar online todavía: se ofrece pedir información. */
  | "coming_soon_online"
  /** Se ofrece por solicitud («bajo petición», «próximamente», «precio visible, solo por solicitud»). */
  | "on_request"
  /** Precio fijo pero retirado de la venta (publicado y desactivado). */
  | "sold_out"
  /** Precio fijo pero sin ninguna opción vigente (todas caducadas o retiradas) o sin precio alguno: no hay nada que comprar. */
  | "no_variants";

export interface PurchaseProduct {
  offerMode?: unknown;
  isActive?: boolean | null;
  isPublished?: boolean | null;
  basePrice?: string | number | null;
}

export interface PurchaseVariant {
  validUntil?: string | null;
  isActive?: boolean | null;
}

/** Métodos de cobro online que ofrece la empresa (`storefront.payments`). Sin dato = la pasarela de siempre. */
export type PaymentsInfo = { redsys: boolean; stripe: boolean } | null | undefined;

/** ¿La empresa puede cobrar online ahora? Sin información se mantiene el comportamiento anterior (se asume que sí). */
export function onlinePayable(payments: PaymentsInfo): boolean {
  if (!payments) return true;
  return Boolean(payments.redsys || payments.stripe);
}

/** Variantes que se pueden elegir hoy: activas y no caducadas (`todayISO` = hoy en Madrid, AAAA-MM-DD). */
export function liveVariants<V extends PurchaseVariant>(variants: V[], todayISO?: string): V[] {
  return variants.filter((v) => v.isActive !== false && (!v.validUntil || !todayISO || v.validUntil >= todayISO));
}

export function purchaseState(product: PurchaseProduct, variants: PurchaseVariant[], payments: PaymentsInfo, opts: { todayISO?: string } = {}): PurchaseState {
  if (!isFixedOffer(product)) return "on_request";
  if (!isPurchasable(product)) return "sold_out";
  const base = Number(product.basePrice ?? 0);
  const live = liveVariants(variants, opts.todayISO);
  // Con variantes pero ninguna vigente no hay nada que elegir; sin variantes y sin precio base, tampoco
  if ((variants.length > 0 && live.length === 0) || (variants.length === 0 && !(base > 0))) return "no_variants";
  if (!onlinePayable(payments)) return "coming_soon_online";
  return "purchasable";
}
