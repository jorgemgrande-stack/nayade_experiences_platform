/**
 * Convenio de importes de los presupuestos que llegan al servidor (constructor del CRM, Primeros pasos o
 * cualquier integración que llame a los procedimientos de presupuestos):
 *
 *  - `items[].total` y `items[].unitPrice` son importes CON IVA incluido (el PVP que paga el cliente).
 *  - `discount` es el descuento global, también con IVA incluido; las líneas se guardan sin descontar.
 *  - `total` es lo que paga el cliente: suma de las líneas menos el descuento.
 *
 * Quien tenga sus precios sin IVA puede enviarlos con `pricesIncludeTax: false`: se normalizan a IVA
 * incluido (con el tipo de cada línea) antes de guardar. Un total que no cuadra con las líneas se rechaza.
 */
import { z } from "zod";
import { isReavLine } from "./taxUtils";
import { round2 } from "../shared/directInvoice";

export const QUOTE_LINE_TOTAL_DESCRIPTION = "Importe de la línea con IVA incluido (PVP), sin aplicar el descuento global";
export const QUOTE_UNIT_PRICE_DESCRIPTION = "Precio unitario con IVA incluido";
export const QUOTE_TOTAL_DESCRIPTION = "Total que paga el cliente: suma de las líneas (IVA incluido) menos el descuento";
export const QUOTE_DISCOUNT_DESCRIPTION = "Descuento global con IVA incluido";

export const pricesIncludeTaxSchema = z
  .boolean()
  .default(true)
  .describe("true (por defecto): las líneas llevan el IVA incluido. false: las líneas son bases imponibles y se convierten a IVA incluido antes de guardar");

type Line = { total: number; unitPrice: number; fiscalRegime?: string; taxRate?: number | null };

/** Convierte líneas expresadas como base imponible a IVA incluido (las líneas sin IVA repercutido no cambian). */
export function linesToTaxIncluded<T extends Line>(items: T[]): T[] {
  return items.map((it) => {
    if (isReavLine(it)) return it;
    const f = 1 + Number(it.taxRate ?? 21) / 100;
    return { ...it, unitPrice: round2(Number(it.unitPrice) * f), total: round2(Number(it.total) * f) };
  });
}

const eur = (n: number) => `${round2(n).toFixed(2).replace(".", ",")} €`;

/**
 * Mensaje de error (en español) si el total no es la suma de las líneas con IVA incluido menos el
 * descuento; null si cuadra. Se tolera un céntimo por línea por el redondeo de cada una.
 */
export function quoteTotalMismatch(items: Pick<Line, "total">[], discount: number, total: number): string | null {
  const expected = round2(items.reduce((s, i) => s + (Number(i.total) || 0), 0) - (Number(discount) || 0));
  const tolerance = 0.01 * Math.max(1, items.length) + 0.0001;
  if (Math.abs(round2(total) - expected) <= tolerance) return null;
  return `El total del presupuesto (${eur(total)}) no coincide con la suma de las líneas con IVA incluido menos el descuento (${eur(expected)}). `
    + "Los importes de las líneas deben llevar el IVA incluido; si son bases imponibles, indícalo con pricesIncludeTax: false.";
}
