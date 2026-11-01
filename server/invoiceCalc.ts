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
  /** Solo en líneas de abono por líneas: índice de la línea de la factura original que abonan. */
  creditedFromLine?: number;
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

/**
 * Línea de la factura original que se abona (índice en `itemsJson`) y cuánto: una cantidad de unidades o un
 * importe con IVA (`amount`); sin ninguno de los dos, lo que quede por abonar de la línea.
 */
export interface CreditNoteLineSelection {
  itemIndex: number;
  quantity?: number;
  amount?: number;
}

/** Rechazo de una selección de líneas que no corresponde a la factura. */
export class CreditNoteSelectionError extends Error {}

const eur = (n: number) => `${round2(n).toFixed(2).replace(".", ",")} €`;

/** Importe con IVA ya abonado de cada línea de la factura por abonos por líneas anteriores (índice → importe). */
export function creditedByLine(previous: InvoiceForCredit[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of previous) {
    for (const it of p.itemsJson ?? []) {
      if (typeof it.creditedFromLine !== "number") continue;
      out.set(it.creditedFromLine, round2((out.get(it.creditedFromLine) ?? 0) + Math.abs(Number(it.total) || 0)));
    }
  }
  return out;
}

/** Estado de abono de cada línea de la factura: lo facturado, lo ya abonado por líneas y lo que queda. */
export interface CreditNoteLineStatus {
  itemIndex: number;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Importe de la línea con IVA. */
  total: number;
  /** Tipo de IVA de la línea; null si no lleva IVA repercutido. */
  taxRate: number | null;
  credited: number;
  remaining: number;
}

export function creditNoteLineStatus(original: InvoiceForCredit, previous: InvoiceForCredit[]): CreditNoteLineStatus[] {
  const credited = creditedByLine(previous);
  const fallbackRate = Number(original.taxRate ?? 21);
  return (original.itemsJson ?? []).map((it, itemIndex) => {
    const total = round2(Math.abs(Number(it.total) || 0));
    const done = credited.get(itemIndex) ?? 0;
    return {
      itemIndex,
      description: it.description,
      quantity: Math.abs(Number(it.quantity) || 0),
      unitPrice: Math.abs(Number(it.unitPrice) || 0),
      total,
      taxRate: isReavLine(it) ? null : Number(it.taxRate ?? (Number.isFinite(fallbackRate) ? fallbackRate : 21)),
      credited: done,
      remaining: round2(Math.max(0, total - done)),
    };
  });
}

/**
 * Abono parcial por líneas: solo los conceptos y cantidades elegidos, cada uno con el importe de su línea
 * original en proporción a la cantidad (nunca un precio nuevo). El desglose se calcula por tipo de IVA de
 * esas líneas (las que no lo indiquen usan el tipo de la factura) y el céntimo de redondeo se asigna a la
 * base del tipo mayor, así que líneas, desglose y total cuadran. Adaptado de Skicenter
 * (`server/creditNoteLogic.ts`: `buildCreditNoteItems`, `computeCreditNoteTotals`).
 *
 * Con `previous` (abonos ya emitidos de la factura) cada línea solo admite lo que le quede por abonar: una
 * línea no se abona dos veces. Por importe (`amount`), la línea del abono lleva ese importe con IVA en una
 * unidad, al tipo de IVA de la línea original. Cada línea del abono guarda de qué línea procede.
 */
export function computeCreditNoteFromLines(original: InvoiceForCredit, selection: CreditNoteLineSelection[], previous: InvoiceForCredit[] = []): CreditNoteAmounts {
  const origItems = original.itemsJson ?? [];
  if (!selection.length) throw new CreditNoteSelectionError("Elige al menos una línea que abonar");
  const seen = new Set<number>();
  const fallbackRate = Number(original.taxRate ?? 21);
  const credited = creditedByLine(previous);
  const picked = selection.map((sel) => {
    const orig = origItems[sel.itemIndex];
    if (!orig) throw new CreditNoteSelectionError(`La línea ${sel.itemIndex + 1} no existe en la factura`);
    if (seen.has(sel.itemIndex)) throw new CreditNoteSelectionError(`La línea ${sel.itemIndex + 1} está repetida`);
    seen.add(sel.itemIndex);
    if (sel.quantity !== undefined && sel.amount !== undefined) {
      throw new CreditNoteSelectionError(`En «${orig.description}» indica unidades o importe, no las dos cosas`);
    }
    const origQty = Math.abs(Number(orig.quantity) || 0);
    const origTotal = Math.abs(Number(orig.total) || 0);
    const lineLeft = round2(Math.max(0, origTotal - (credited.get(sel.itemIndex) ?? 0)));
    if (!(lineLeft > 0)) throw new CreditNoteSelectionError(`«${orig.description}» ya está abonada por completo`);
    const taxRate = isReavLine(orig) ? undefined : orig.taxRate ?? (Number.isFinite(fallbackRate) ? fallbackRate : 21);
    const rate = taxRate !== undefined ? { taxRate } : {};
    if (sel.amount !== undefined) {
      const amount = round2(sel.amount);
      if (!(amount > 0)) throw new CreditNoteSelectionError(`El importe a abonar de «${orig.description}» debe ser mayor que cero`);
      if (amount - lineLeft > 0.005) throw new CreditNoteSelectionError(`De «${orig.description}» solo quedan ${eur(lineLeft)} por abonar`);
      return { ...orig, quantity: 1, unitPrice: -amount, total: -amount, ...rate, creditedFromLine: sel.itemIndex };
    }
    const qty = sel.quantity ?? origQty;
    if (!(qty > 0)) throw new CreditNoteSelectionError(`La cantidad a abonar de «${orig.description}» debe ser mayor que cero`);
    if (qty - origQty > 1e-9) throw new CreditNoteSelectionError(`No se pueden abonar más de ${origQty} unidades de «${orig.description}»`);
    // La línea entera (o lo que le queda) sin cantidad; con cantidad, en proporción a las unidades
    const total = sel.quantity === undefined ? lineLeft : qty === origQty ? origTotal : round2((origTotal / origQty) * qty);
    if (total - lineLeft > 0.005) throw new CreditNoteSelectionError(`De «${orig.description}» solo quedan ${eur(lineLeft)} por abonar`);
    return { ...orig, quantity: sel.quantity === undefined && lineLeft < origTotal ? 1 : qty, unitPrice: sel.quantity === undefined && lineLeft < origTotal ? -lineLeft : -Math.abs(Number(orig.unitPrice) || 0), total: -total, ...rate, creditedFromLine: sel.itemIndex };
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

// ─── Plan del abono (vista previa y emisión) ─────────────────────────────────

/** Qué se abona: lo pendiente (sin nada), un importe repartido entre los tipos de IVA o unas líneas. */
export interface CreditNoteRequest {
  partialAmount?: number;
  lines?: CreditNoteLineSelection[];
}

export interface CreditNotePlan {
  amounts: CreditNoteAmounts;
  /** Importe del abono con IVA, en positivo. */
  creditTotal: number;
  /** Lo que quedaba por abonar de la factura antes de este abono. */
  remaining: number;
  /** Lo que quedará por abonar después. */
  remainingAfter: number;
  closesInvoice: boolean;
}

/** Lo ya abonado de una factura (suma de sus abonos, en positivo). */
export function alreadyCredited(previous: InvoiceForCredit[]): number {
  return round2(previous.reduce((a, r) => a + Math.abs(Number(r.total) || 0), 0));
}

/**
 * Calcula el abono de `request` sobre `original` con sus abonos previos y aplica TODAS las reglas: la factura
 * debe tener algo pendiente, el abono debe ser mayor que cero y la suma de abonos nunca supera lo facturado
 * (ni, por líneas, lo facturado en cada línea). La misma función da la vista previa y el abono que se emite.
 */
export function planCreditNote(original: InvoiceForCredit, previous: InvoiceForCredit[], request: CreditNoteRequest): CreditNotePlan {
  if (request.partialAmount !== undefined && request.lines?.length) throw new CreditNoteSelectionError("Abona por importe o por líneas, no ambas cosas");
  const remaining = round2(Math.abs(Number(original.total) || 0) - alreadyCredited(previous));
  if (remaining <= 0) throw new CreditNoteSelectionError("Esta factura ya está abonada por completo");
  const byLines = request.lines?.length ? computeCreditNoteFromLines(original, request.lines, previous) : null;
  const creditTotal = byLines ? -byLines.total : request.partialAmount !== undefined ? round2(request.partialAmount) : remaining;
  if (!(creditTotal > 0)) throw new CreditNoteSelectionError("El importe del abono debe ser mayor que cero");
  if (creditTotal - remaining > 0.005) throw new CreditNoteSelectionError(`El abono (${eur(creditTotal)}) supera lo pendiente de abonar (${eur(remaining)})`);
  const amounts = byLines ?? computeCreditNote(original, previous, creditTotal);
  const closesInvoice = creditTotal - remaining > -0.005;
  return { amounts: { ...amounts, closesInvoice }, creditTotal, remaining, remainingAfter: round2(Math.max(0, remaining - creditTotal)), closesInvoice };
}
