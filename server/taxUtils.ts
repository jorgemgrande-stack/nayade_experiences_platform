/**
 * taxUtils.ts — Utilidades compartidas de cálculo fiscal.
 *
 * Modelo: fiscalRegime ("general" | "reav" | "mixed") + taxRate (número)
 * son dos dimensiones independientes. "general_21" es un valor legacy
 * que se coerciona automáticamente.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type FiscalRegime = "general" | "reav" | "mixed";

/** Línea de presupuesto / factura con fiscalidad */
export interface TaxableLine {
  total: number;
  fiscalRegime?: string;   // acepta legacy "general_21"
  taxRate?: number | null; // si ausente y regime=general → default 21
}

/** Resultado del desglose por tipo de IVA (para facturas) */
export interface TaxBreakdownLine {
  rate: number;   // ej. 21, 10
  base: number;   // base imponible
  amount: number; // cuota IVA
}

// ─── Coerción de valores legacy ───────────────────────────────────────────────

/**
 * Normaliza un fiscalRegime antiguo al nuevo modelo.
 * "general_21" → { regime: "general", taxRate: 21 }
 * "general_10" → { regime: "general", taxRate: 10 }
 */
export function normalizeRegime(raw: string | null | undefined): { regime: FiscalRegime; taxRate: number } {
  if (raw === "general_21") return { regime: "general", taxRate: 21 };
  if (raw === "general_10") return { regime: "general", taxRate: 10 };
  if (raw === "reav")  return { regime: "reav",    taxRate: 0 };
  if (raw === "mixed") return { regime: "mixed",   taxRate: 21 };
  // default
  return { regime: "general", taxRate: 21 };
}

/** Devuelve el taxRate efectivo de una línea (con coerción legacy). */
export function effectiveTaxRate(line: TaxableLine): number {
  if (isReavLine(line)) return 0;
  if (line.taxRate != null) return line.taxRate;
  // coerción legacy: si el régimen contiene "21" o "10 extraer el número
  const { taxRate } = normalizeRegime(line.fiscalRegime);
  return taxRate;
}

/** True si la línea es REAV (sin IVA repercutido al cliente). */
export function isReavLine(line: Pick<TaxableLine, "fiscalRegime">): boolean {
  return line.fiscalRegime === "reav";
}

// ─── Cálculo de IVA por línea ─────────────────────────────────────────────────

export interface LineTaxResult {
  taxBase: number;
  taxAmount: number;
  taxRate: number;
}

/**
 * Extrae base imponible e IVA de un precio total (IVA incluido).
 * divisor = 1 + rate/100  →  base = total / divisor
 */
export function calcGeneralTax(totalConIva: number, rate: number): LineTaxResult {
  const divisor = 1 + rate / 100;
  const taxBase   = totalConIva / divisor;
  const taxAmount = totalConIva - taxBase;
  return {
    taxBase:   parseFloat(taxBase.toFixed(6)),
    taxAmount: parseFloat(taxAmount.toFixed(6)),
    taxRate:   rate,
  };
}

// ─── Desglose multi-tipo para facturas ───────────────────────────────────────

/**
 * Agrupa líneas por tipo de IVA y devuelve el desglose fiscal.
 * Líneas REAV se ignoran (no repercuten IVA).
 * Líneas sin taxRate explicito usan 21 como fallback legacy.
 */
export function groupTaxBreakdown(lines: TaxableLine[]): TaxBreakdownLine[] {
  const map = new Map<number, number>(); // rate → suma bruta (con IVA)
  for (const line of lines) {
    if (isReavLine(line)) continue;
    const rate = effectiveTaxRate(line);
    map.set(rate, (map.get(rate) ?? 0) + line.total);
  }
  return Array.from(map.entries())
    .map(([rate, gross]) => {
      const { taxBase, taxAmount } = calcGeneralTax(gross, rate);
      return {
        rate,
        base:   parseFloat(taxBase.toFixed(2)),
        amount: parseFloat(taxAmount.toFixed(2)),
      };
    })
    .sort((a, b) => b.rate - a.rate); // 21% primero
}

/** Suma total de cuotas IVA de un desglose. */
export function totalTaxAmount(breakdown: TaxBreakdownLine[]): number {
  return parseFloat(breakdown.reduce((s, b) => s + b.amount, 0).toFixed(2));
}

/**
 * Calcula el impuesto sobre la base imponible (ya sin IVA).
 * Útil para subtotales donde ya se conoce la base.
 */
export function calcTaxOnBase(base: number, rate: number): number {
  return parseFloat((base * rate / 100).toFixed(2));
}
