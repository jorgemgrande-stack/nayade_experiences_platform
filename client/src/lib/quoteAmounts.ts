/**
 * Importes de un presupuesto de una línea con la convención del CRM: el PVP ya incluye el impuesto. El total es el
 * PVP (no se suma el impuesto encima) y la base imponible se obtiene extrayéndolo.
 */
export function singleLineQuoteAmounts(pvp: number, taxRate: number): { subtotal: number; tax: number; total: number } {
  const total = Math.round(pvp * 100) / 100;
  const tax = Math.round(((total * taxRate) / (100 + taxRate)) * 100) / 100;
  return { subtotal: Math.round((total - tax) * 100) / 100, tax, total };
}
