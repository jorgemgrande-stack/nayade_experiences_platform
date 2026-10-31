/**
 * Líneas de un presupuesto que son de un PRODUCTO DEL CATÁLOGO pero tienen importe 0 (o vacío).
 *
 * Adaptado de Skicenter (shared/quoteUnpricedLines.ts, 1b89f9c8): allí un presupuesto salió al cliente con dos
 * productos a 0,00 € porque el producto no tenía precio configurado. Regla: un presupuesto no se envía (ni se
 * reenvía) si alguno de sus productos del catálogo tiene importe 0. El borrador se puede seguir guardando y
 * editando. No cuentan como «sin precio»:
 *   - las líneas libres (sin producto del catálogo), que se escriben a propósito;
 *   - las líneas con descuento explícito (`discountPercent` > 0, incluido el 100 %) o precio fijado a mano
 *     (`manualPriceOverride`), si el presupuesto los trae.
 */
export interface UnpricedLineCandidate {
  description?: string | null;
  total?: number | string | null;
  quantity?: number | null;
  productId?: number | null;
  manualPriceOverride?: boolean | null;
  discountPercent?: number | string | null;
}

export interface UnpricedLine {
  name: string;
  quantity: number;
}

const money = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

export function findUnpricedCatalogLines(items: readonly UnpricedLineCandidate[] | null | undefined): UnpricedLine[] {
  if (!Array.isArray(items)) return [];
  const out: UnpricedLine[] = [];
  for (const it of items) {
    if (!it || it.productId == null) continue; // línea libre: se respeta
    if (it.manualPriceOverride || money(it.discountPercent) > 0) continue; // decisión explícita
    if (money(it.total) > 0) continue;
    out.push({ name: (it.description ?? "").trim() || "Producto", quantity: Number(it.quantity) || 1 });
  }
  return out;
}

export function formatUnpricedLines(lines: readonly UnpricedLine[]): string {
  const names = Array.from(new Set(lines.map((l) => `«${l.name}»`))).join(", ");
  const one = lines.length === 1;
  return `No se puede enviar el presupuesto: ${one ? "el producto" : "los productos"} ${names} ${one ? "tiene" : "tienen"} un importe de 0,00 € porque no hay precio configurado. `
    + "Pon su precio en el catálogo o escribe el importe en la línea y vuelve a enviarlo. Si es un regalo, añádelo como línea libre.";
}
