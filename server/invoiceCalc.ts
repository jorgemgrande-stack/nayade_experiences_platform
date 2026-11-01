/**
 * Cálculo de importes de facturas libres y de facturas de abono (rectificativas), sin acceso a BD.
 *
 * Convenciones de la plataforma que se respetan aquí:
 *  - En `itemsJson`, `total` de cada línea es el importe CON IVA (así lo leen el generador de la factura,
 *    `groupTaxBreakdown` y el resto de consumidores).
 *  - `taxBreakdown` guarda, por tipo de IVA, la base imponible y la cuota. En los abonos los importes
 *    se guardan en negativo, igual que `subtotal`, `taxAmount` y `total` de la fila.
 */
import { groupTaxBreakdown, isReavLine, type TaxBreakdownLine } from "./taxUtils";
import { round2 } from "../shared/directInvoice";

export { round2 };

export type InvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime?: "reav" | "general";
  taxRate?: number;
  productId?: number;
};

// ─── Factura libre ───────────────────────────────────────────────────────────

// La regla de cálculo vive en shared/ para que el formulario muestre los mismos importes que se emiten.
export { computeDirectInvoice, DIRECT_INVOICE_TAX_RATES, type DirectInvoiceLine, type DirectInvoiceTaxRate } from "../shared/directInvoice";

// ─── Abonos ──────────────────────────────────────────────────────────────────

/** Parte de una factura con un mismo tratamiento: un tipo de IVA (`rate`) o sin IVA repercutido (`null`, REAV). */
export interface TaxComponent {
  rate: number | null;
  base: number;
  amount: number;
}

/** Datos de una factura (o de un abono previo) necesarios para calcular un abono. */
export interface InvoiceForCredit {
  invoiceNumber?: string;
  total: string | number;
  subtotal?: string | number | null;
  taxRate?: string | number | null;
  taxAmount?: string | number | null;
  taxBreakdown?: TaxBreakdownLine[] | null;
  itemsJson?: InvoiceItem[] | null;
}

const gross = (c: TaxComponent) => c.base + c.amount;
const keyOf = (rate: number | null) => (rate === null ? "sin-iva" : String(rate));

/**
 * Desglose de una factura en componentes (importes en positivo): el `taxBreakdown` guardado y, si no lo
 * hay (facturas antiguas), el que resulta de sus líneas con el tipo de la factura. Lo que el total tenga
 * por encima de los componentes con IVA es la parte sin IVA repercutido (REAV). Si los componentes
 * superan el total (descuento global no reflejado en el desglose) se reducen en proporción.
 */
export function invoiceComponents(inv: InvoiceForCredit): TaxComponent[] {
  const total = Math.abs(Number(inv.total) || 0);
  const fallbackRate = Number(inv.taxRate ?? 21);
  const rateOf = Number.isFinite(fallbackRate) ? fallbackRate : 21;
  let taxed: TaxBreakdownLine[];
  if (inv.taxBreakdown && inv.taxBreakdown.length > 0) {
    taxed = inv.taxBreakdown;
  } else {
    const items = (inv.itemsJson ?? []).filter((i) => !isReavLine(i));
    taxed = items.length
      ? groupTaxBreakdown(items.map((i) => ({ ...i, taxRate: i.taxRate ?? rateOf })))
      : (inv.itemsJson ?? []).length
        ? []
        : [{ rate: rateOf, base: Number(inv.subtotal ?? 0), amount: Number(inv.taxAmount ?? 0) }];
  }
  const merged = new Map<number, TaxComponent>();
  for (const b of taxed) {
    const rate = Number(b.rate) || 0;
    const cur = merged.get(rate) ?? { rate, base: 0, amount: 0 };
    cur.base += Math.abs(Number(b.base) || 0);
    cur.amount += Math.abs(Number(b.amount) || 0);
    merged.set(rate, cur);
  }
  let comps = Array.from(merged.values()).map((c) => ({ rate: c.rate, base: round2(c.base), amount: round2(c.amount) }));
  const taxedGross = round2(comps.reduce((s, c) => s + gross(c), 0));
  if (taxedGross > total + 0.005 && taxedGross > 0) {
    comps = prorate(comps, total);
  } else if (total - taxedGross > 0.005) {
    comps.push({ rate: null, base: round2(total - taxedGross), amount: 0 });
  }
  return comps.filter((c) => gross(c) > 0.004).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

/** Lo que queda por abonar de cada componente: los de la factura menos los de sus abonos previos. */
export function remainingComponents(original: InvoiceForCredit, previous: InvoiceForCredit[]): TaxComponent[] {
  const left = new Map(invoiceComponents(original).map((c) => [keyOf(c.rate), { ...c }]));
  for (const p of previous) {
    for (const c of invoiceComponents(p)) {
      const cur = left.get(keyOf(c.rate));
      if (!cur) continue;
      cur.base = round2(Math.max(0, cur.base - c.base));
      cur.amount = round2(Math.max(0, cur.amount - c.amount));
    }
  }
  return Array.from(left.values()).filter((c) => gross(c) > 0.004);
}

/**
 * Reparte `target` entre los componentes en proporción a su importe con IVA. En cada uno la cuota se
 * recalcula como importe × tipo / (100 + tipo) y la base es el resto; el céntimo que pueda sobrar o faltar
 * por redondeo se asigna a la base del componente mayor, de modo que la suma es exactamente `target`.
 */
export function prorate(comps: TaxComponent[], target: number): TaxComponent[] {
  const totalGross = comps.reduce((s, c) => s + gross(c), 0);
  if (!(totalGross > 0)) return [];
  const ratio = target / totalGross;
  const out = comps.map((c) => {
    const g = round2(gross(c) * ratio);
    const amount = c.rate ? round2((g * c.rate) / (100 + c.rate)) : 0;
    return { rate: c.rate, base: round2(g - amount), amount };
  });
  fixCents(out, target);
  return out;
}

function fixCents(comps: TaxComponent[], target: number) {
  if (!comps.length) return;
  const diff = round2(target - comps.reduce((s, c) => s + gross(c), 0));
  if (diff === 0) return;
  const biggest = comps.reduce((a, b) => (gross(b) > gross(a) ? b : a));
  biggest.base = round2(biggest.base + diff);
}

export interface CreditNoteAmounts {
  items: InvoiceItem[];
  /** Importes en negativo, como el resto de la fila del abono. */
  taxBreakdown: TaxBreakdownLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
  /** El abono deja la factura abonada por completo. */
  closesInvoice: boolean;
}

/**
 * Importes de un abono de `creditTotal` (positivo, IVA incluido) sobre `original`, teniendo en cuenta los
 * abonos ya emitidos (`previous`).
 *
 * Regla del abono parcial: el importe se reparte entre los tipos de IVA de la factura en proporción a lo
 * que queda pendiente de abonar en cada uno (ver `prorate`), y se emite una línea por tipo. Así líneas,
 * bases, cuotas y total cuadran al céntimo. El abono que completa la factura abona exactamente lo pendiente
 * de cada tipo, de modo que factura y abonos suman cero por tipo. Si es un abono total sin abonos previos
 * y las líneas de la factura suman su total, se copian sus líneas en negativo.
 */
export function computeCreditNote(original: InvoiceForCredit, previous: InvoiceForCredit[], creditTotal: number): CreditNoteAmounts {
  const target = round2(creditTotal);
  const remainingTotal = round2(Math.abs(Number(original.total)) - previous.reduce((s, p) => s + Math.abs(Number(p.total) || 0), 0));
  const closesInvoice = Math.abs(target - remainingTotal) <= 0.005;
  const pending = remainingComponents(original, previous);
  const pendingGross = round2(pending.reduce((s, c) => s + gross(c), 0));
  let comps: TaxComponent[];
  if (closesInvoice && Math.abs(pendingGross - target) <= 0.005) {
    comps = pending.map((c) => ({ ...c }));
    fixCents(comps, target);
  } else {
    comps = prorate(pending, target);
  }
  if (!comps.length) comps = [{ rate: Number(original.taxRate ?? 21) || 0, base: 0, amount: 0 }];

  const origItems = original.itemsJson ?? [];
  const hasReav = origItems.some((i) => isReavLine(i));
  const itemsGross = round2(origItems.reduce((s, i) => s + Math.abs(Number(i.total) || 0), 0));
  const copyLines = closesInvoice && previous.length === 0 && origItems.length > 0 && Math.abs(itemsGross - target) <= 0.01;
  const ref = original.invoiceNumber ? ` de la factura ${original.invoiceNumber}` : "";
  const items: InvoiceItem[] = copyLines
    ? origItems.map((i) => ({ ...i, unitPrice: -Math.abs(Number(i.unitPrice) || 0), total: -Math.abs(Number(i.total) || 0) }))
    : comps.map((c) => {
        const g = round2(gross(c));
        const label = c.rate === null ? "sin IVA repercutido" : `IVA ${c.rate} %`;
        return {
          description: `${closesInvoice && previous.length === 0 ? "Abono" : "Abono parcial"}${ref} (${label})`,
          quantity: 1,
          unitPrice: -g,
          total: -g,
          ...(c.rate === null ? { fiscalRegime: hasReav ? ("reav" as const) : ("general" as const), ...(hasReav ? {} : { taxRate: 0 }) } : { fiscalRegime: "general" as const, taxRate: c.rate }),
        };
      });

  const taxBreakdown = comps
    .filter((c) => c.rate !== null)
    .map((c) => ({ rate: c.rate as number, base: -round2(c.base), amount: -round2(c.amount) }));
  const subtotal = -round2(comps.reduce((s, c) => s + c.base, 0));
  const taxAmount = -round2(comps.reduce((s, c) => s + c.amount, 0));
  return { items, taxBreakdown, subtotal, taxAmount, total: -target, closesInvoice };
}

// ─── Abono por líneas ────────────────────────────────────────────────────────

/** Línea de la factura original que se abona (índice en `itemsJson`) y cantidad; sin cantidad, la línea entera. */
export interface CreditNoteLineSelection {
  itemIndex: number;
  quantity?: number;
}

/** Rechazo de una selección de líneas que no corresponde a la factura. */
export class CreditNoteSelectionError extends Error {}

/**
 * Abono parcial por líneas: solo los conceptos y cantidades elegidos, cada uno con el importe de su línea
 * original en proporción a la cantidad (nunca un precio nuevo). El desglose se calcula por tipo de IVA de
 * esas líneas (las que no lo indiquen usan el tipo de la factura) y el céntimo de redondeo se asigna a la
 * base del tipo mayor, así que líneas, desglose y total cuadran. Adaptado de Skicenter
 * (`server/creditNoteLogic.ts`: `buildCreditNoteItems`, `computeCreditNoteTotals`).
 */
export function computeCreditNoteFromLines(original: InvoiceForCredit, selection: CreditNoteLineSelection[]): CreditNoteAmounts {
  const origItems = original.itemsJson ?? [];
  if (!selection.length) throw new CreditNoteSelectionError("Elige al menos una línea que abonar");
  const seen = new Set<number>();
  const fallbackRate = Number(original.taxRate ?? 21);
  const picked = selection.map((sel) => {
    const orig = origItems[sel.itemIndex];
    if (!orig) throw new CreditNoteSelectionError(`La línea ${sel.itemIndex + 1} no existe en la factura`);
    if (seen.has(sel.itemIndex)) throw new CreditNoteSelectionError(`La línea ${sel.itemIndex + 1} está repetida`);
    seen.add(sel.itemIndex);
    const origQty = Math.abs(Number(orig.quantity) || 0);
    const qty = sel.quantity ?? origQty;
    if (!(qty > 0)) throw new CreditNoteSelectionError(`La cantidad a abonar de «${orig.description}» debe ser mayor que cero`);
    if (qty - origQty > 1e-9) throw new CreditNoteSelectionError(`No se pueden abonar más de ${origQty} unidades de «${orig.description}»`);
    const origTotal = Math.abs(Number(orig.total) || 0);
    const total = qty === origQty ? origTotal : round2((origTotal / origQty) * qty);
    const taxRate = isReavLine(orig) ? undefined : orig.taxRate ?? (Number.isFinite(fallbackRate) ? fallbackRate : 21);
    return { ...orig, quantity: qty, unitPrice: -Math.abs(Number(orig.unitPrice) || 0), total: -total, ...(taxRate !== undefined ? { taxRate } : {}) };
  });
  const target = round2(picked.reduce((s, i) => s + Math.abs(i.total), 0));
  const comps: TaxComponent[] = groupTaxBreakdown(picked.map((i) => ({ ...i, total: Math.abs(i.total) })))
    .map((b) => ({ rate: b.rate, base: b.base, amount: b.amount }));
  const reavGross = round2(picked.filter((i) => isReavLine(i)).reduce((s, i) => s + Math.abs(i.total), 0));
  if (reavGross > 0) comps.push({ rate: null, base: reavGross, amount: 0 });
  fixCents(comps, target);
  const taxBreakdown = comps.filter((c) => c.rate !== null).map((c) => ({ rate: c.rate as number, base: -round2(c.base), amount: -round2(c.amount) }));
  return {
    items: picked,
    taxBreakdown,
    subtotal: -round2(comps.reduce((s, c) => s + c.base, 0)),
    taxAmount: -round2(comps.reduce((s, c) => s + c.amount, 0)),
    total: -target,
    closesInvoice: false,
  };
}
