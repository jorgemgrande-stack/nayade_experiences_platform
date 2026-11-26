/**
 * Suplementos opcionales elegidos en el carrito (p. ej. Lifetime Access de RECONNECT). Funciones puras, solo para MOSTRAR el
 * total estimado y enviar los ids: el servidor vuelve a decidir el tramo, el importe y si la opción lo admite.
 */
export interface CartSupplementTier {
  id: number;
  priceModifier: string;
  priceType: "fixed" | "per_person";
  minQty: number | null;
  maxQty: number | null;
}

export interface CartSupplement {
  group: string;
  name: string;
  description?: string | null;
  /** Opciones del programa con las que se ofrece (null/vacío = con cualquiera) */
  forVariantIds?: number[] | null;
  tiers: CartSupplementTier[];
}

/** Tramo que corresponde a n participantes (el más específico); undefined si ninguno lo admite. */
export function supplementTierFor(s: Pick<CartSupplement, "tiers">, people: number): CartSupplementTier | undefined {
  return [...s.tiers]
    .filter((t) => people >= (t.minQty ?? 1) && (t.maxQty == null || people <= t.maxQty))
    .sort((a, b) => (b.minQty ?? 0) - (a.minQty ?? 0))[0];
}

/** Importe en euros de un suplemento para n participantes (0 si ningún tramo lo admite). */
export function supplementEuros(s: Pick<CartSupplement, "tiers">, people: number): number {
  const t = supplementTierFor(s, people);
  if (!t) return 0;
  const unit = Math.round(Number(t.priceModifier) * 100);
  if (!Number.isFinite(unit) || unit <= 0) return 0;
  return ((t.priceType === "per_person" ? unit * people : unit) / 100);
}

export const supplementsTotalEuros = (list: Array<Pick<CartSupplement, "tiers">> | undefined, people: number): number =>
  Math.round((list ?? []).reduce((s, x) => s + supplementEuros(x, people), 0) * 100) / 100;

/** Ids de tramo a enviar al servidor para n participantes (los suplementos sin tramo válido no se envían: el servidor lo rechazaría). */
export const supplementIdsFor = (list: Array<Pick<CartSupplement, "tiers">> | undefined, people: number): number[] =>
  (list ?? []).map((s) => supplementTierFor(s, people)?.id).filter((x): x is number => typeof x === "number");

/** Suplementos que admite la opción elegida del programa. */
export const applicableSupplements = <T extends Pick<CartSupplement, "forVariantIds">>(list: T[], variantId: number | null | undefined): T[] =>
  list.filter((s) => !s.forVariantIds?.length || (variantId != null && s.forVariantIds.includes(variantId)));
