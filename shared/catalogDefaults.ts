/**
 * Valores con los que nace un producto nuevo en el panel (lógica pura: la usan el formulario y las pruebas).
 *
 *  - Pyme (licencias por capacidad): «Producto» con precio por unidad y, si tiene caja, vendible en caja (M5): lo
 *    habitual es poder cobrarlo en el mostrador sin volver a editarlo.
 *  - Instalación original: los de siempre (actividad por persona, sin caja).
 * Un tipo que no se puede cobrar en caja (alojamiento: necesita fechas de entrada y salida) nace sin ella.
 */
export interface NewProductDefaults {
  productType: string;
  pricingType: "per_person" | "per_unit";
  isPresentialSale: boolean;
}

/** Tipos de producto que no se venden en el punto de venta. */
const NOT_SOLD_AT_POS = new Set(["alojamiento"]);

export function presentialSaleAllowed(productType: string): boolean {
  return !NOT_SOLD_AT_POS.has(productType);
}

export function newProductDefaults(input: { licensed: boolean; can: (capabilityId: string) => boolean; productType?: string }): NewProductDefaults {
  if (!input.licensed) return { productType: input.productType ?? "actividad", pricingType: "per_person", isPresentialSale: false };
  const productType = input.productType ?? "own";
  // «per_person» es el precio por cada unidad comprada (precio × cantidad), que en una pyme se muestra como «Por unidad»
  return { productType, pricingType: "per_person", isPresentialSale: input.can("bill-cash") && presentialSaleAllowed(productType) };
}
