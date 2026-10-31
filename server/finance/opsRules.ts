/**
 * Reglas PURAS de las operaciones (fase 1B, sin BD ni red): cálculo fiscal del gasto, asientos de gasto, rectificativa,
 * pago, movimiento bancario contra cuenta y caja (contrato §4), gastos recurrentes por periodo, lectura de extractos
 * (Norma 43, CaixaBank y CSV con mapeo), claves de duplicado, sugerencias de conciliación, validación de NIF e IBAN y
 * tipo de documento por firma de contenido.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { isValidSpanishTaxId, taxOf } from "../invoicing/rules";
import { isValidDate, signed } from "./rules";
import { FinanceError, type EntryDraft, type EntryLineInput } from "./types";
import { REVERSE_CHARGE_TREATMENTS, VAT_TREATMENT_LABELS, VAT_TREATMENTS, vatTreatmentOf, type Expense, type ExpenseKind, type ExpensePaymentStatus, type Frequency, type ParsedMovement, type RecurringExpense, type VatTreatment } from "./opsTypes";

const bad = (message: string) => new FinanceError("invalid_input", message);

// ── Cuentas ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const OPS_ACCOUNTS = {
  vatInput: "472",
  vatOutput: "477",
  withholding: "4751",
  stripe: "5720",
  bankPrefix: "572000",
  cashPrefix: "570000",
} as const;

/**
 * Siguiente subcuenta libre de 8 dígitos con un prefijo de 6 (`572000NN` bancos, `570000NN` cajas), desde 01.
 * `conflict` si ya están las 99.
 */
export function nextSubaccountCode(prefix: string, existing: readonly string[]): string {
  let max = 0;
  for (const c of existing) if (c.length === prefix.length + 2 && c.startsWith(prefix) && /^\d+$/.test(c)) max = Math.max(max, Number(c.slice(prefix.length)));
  if (max >= 99) throw new FinanceError("conflict", `No quedan subcuentas libres de ${prefix}NN`);
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

// ── Fechas ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

// ── Cálculo fiscal del gasto ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Cuota de una base con signo: `taxOf` de la facturación propia sobre el valor absoluto (medios hacia arriba) y el
 * signo de la base, para que una rectificativa sea exactamente la factura en negativo.
 */
export const signedTaxOf = (baseCents: number, rateBp: number) => Math.sign(baseCents) * taxOf(Math.abs(baseCents), rateBp) || 0;

export interface ExpenseAmounts {
  baseCents: number;
  taxCents: number;
  /** Cuota soportada deducible (472). */
  deductibleTaxCents: number;
  /** Cuota no deducible: mayor gasto (cuenta de la categoría). */
  nonDeductibleTaxCents: number;
  /** Importe a la cuenta de gasto: base + cuota no deducible. */
  expenseAccountCents: number;
  withholdingCents: number;
  /** Total de la factura (base + cuota). */
  totalCents: number;
  /** A pagar al proveedor (total − retención): lo que va al 400/410. */
  payableCents: number;
}

/**
 * Desglose del gasto (contrato §4; mismo cálculo que el CRM, src/financeExpenses.ts). Adaptado del cálculo fiscal del
 * gasto del tenant (`computeExpenseFiscal` en server/routers/expenses.ts: allí el importe es el total con IVA y la
 * retención va sobre la base); aquí se parte de la base, en céntimos y con la parte deducible de la cuota.
 */
export function expenseAmounts(i: { baseCents: number; taxRateBp: number; deductibleBp: number; withholdingRateBp: number }): ExpenseAmounts {
  const taxCents = signedTaxOf(i.baseCents, i.taxRateBp);
  const deductibleTaxCents = signedTaxOf(taxCents, i.deductibleBp);
  const nonDeductibleTaxCents = taxCents - deductibleTaxCents;
  const withholdingCents = signedTaxOf(i.baseCents, i.withholdingRateBp);
  const totalCents = i.baseCents + taxCents;
  return { baseCents: i.baseCents, taxCents, deductibleTaxCents, nonDeductibleTaxCents, expenseAccountCents: i.baseCents + nonDeductibleTaxCents, withholdingCents, totalCents, payableCents: totalCents - withholdingCents };
}

/** A pagar al proveedor: total − retención. */
export const payableOf = (e: Pick<Expense, "totalCents" | "withholdingCents">) => e.totalCents - e.withholdingCents;

/** Pendiente de pago = total − retención − pagos vigentes (0 en un gasto anulado). */
export const pendingOf = (e: Pick<Expense, "status" | "totalCents" | "withholdingCents" | "paidCents">) => (e.status === "void" ? 0 : payableOf(e) - e.paidCents);

/** Estado de pago a partir de lo pagado (con signo, como lo pendiente). */
export function paymentStatusOf(payableCents: number, paidCents: number): ExpensePaymentStatus {
  if (paidCents === 0) return "pending";
  return Math.abs(paidCents) >= Math.abs(payableCents) ? "paid" : "partial";
}

export const MAX_EXPENSE_CENTS = 100_000_000_000; // mil millones de euros: fuera de esto es un error de entrada

/** Comprueba los importes y tipos de un gasto según su clase. Rectificativa: base NEGATIVA; el resto, positiva. */
export function checkExpenseAmounts(kind: ExpenseKind, i: { baseCents: number; taxRateBp: number; deductibleBp: number; withholdingRateBp: number }) {
  if (!Number.isSafeInteger(i.baseCents) || i.baseCents === 0 || Math.abs(i.baseCents) > MAX_EXPENSE_CENTS) throw bad("La base imponible es un importe en céntimos distinto de cero");
  if (kind === "rectification" && i.baseCents > 0) throw bad("En una factura rectificativa la base es negativa");
  if (kind !== "rectification" && i.baseCents < 0) throw bad("La base es negativa: registra una factura rectificativa");
  for (const [v, what] of [[i.taxRateBp, "El tipo de IVA"], [i.deductibleBp, "La parte deducible"], [i.withholdingRateBp, "La retención"]] as const) if (!Number.isInteger(v) || v < 0 || v > 10_000) throw bad(`${what} va de 0 a 10000 puntos básicos`);
}

// ── Claves de origen (un asiento por hecho económico) ─────────────────────────────────────────────────────────────

export const expenseSourceKey = (id: number) => `expense:${id}`;
export const expensePaymentSourceKey = (id: number) => `expense-payment:${id}`;
/** Primera conciliación `bankmov:<id>`; tras desvincular (asiento revertido), `bankmov:<id>:<n>`. */
export const bankMovementSourceKey = (id: number, matchCount: number) => (matchCount <= 1 ? `bankmov:${id}` : `bankmov:${id}:${matchCount}`);
export const cashMovementSourceKey = (id: number) => `cash:${id}`;
export const recurringSourceKey = (templateId: number, period: string) => `recurring:${templateId}:${period}`;

// ── Asientos ──────────────────────────────────────────────────────────────────────────────────────────────────────

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Gasto registrado (diario COM): Debe cuenta de la categoría (base + cuota NO deducible) · Debe 472 (cuota deducible) ·
 * Haber 4751 (retención) · Haber 400/410 del proveedor (total − retención). La rectificativa, con importes negativos,
 * sale invertida (debe ↔ haber). Fecha = devengo o, si no hay, fecha de la factura. `source_key = expense:<id>`.
 */
export function expenseEntry(e: Expense, ctx: { categoryAccount: string; supplierAccount: string; supplierName: string | null }): EntryDraft {
  if (e.settlesStripeFees) return stripeFeeInvoiceEntry(e, ctx);
  const a = expenseAmounts(e);
  if (a.taxCents !== e.taxCents || a.withholdingCents !== e.withholdingCents || a.totalCents !== e.totalCents) throw bad(`El gasto #${e.id} no cuadra con su base y sus tipos`);
  const date = e.accrualDate ?? e.invoiceDate;
  const label = e.kind === "rectification" ? "Factura rectificativa recibida" : e.kind === "ticket" ? "Tique" : "Factura recibida";
  const who = ctx.supplierName ? ` · ${ctx.supplierName}` : "";
  const ref = { supplierId: e.supplierId, costCenterId: e.costCenterId };
  // CRM 0039: con inversión del sujeto pasivo, autoliquidación Debe 472 (parte deducible) / Haber 477 (cuota completa)
  // y la parte no deducible a mayor gasto; las líneas llevan el tipo y la base (el 303 las lleva a sus casillas por el
  // tratamiento del gasto)
  const isp = reverseChargeAmounts(e);
  const ispText = isp ? `IVA autoliquidado ${isp.rateBp / 100} % (inversión del sujeto pasivo: ${VAT_TREATMENT_LABELS[vatTreatmentOf(e)].toLowerCase()})` : "";
  const lines: EntryLineInput[] = [
    ...signed(ctx.categoryAccount, a.expenseAccountCents + (isp?.nonDeductibleTaxCents ?? 0), "debit", { ...ref, description: short(e.description, 300), taxRateBp: e.taxRateBp, taxBaseCents: e.baseCents }),
    ...signed(OPS_ACCOUNTS.vatInput, a.deductibleTaxCents, "debit", { supplierId: e.supplierId, description: `IVA soportado ${e.taxRateBp / 100} %`, taxRateBp: e.taxRateBp, taxBaseCents: e.baseCents }),
    ...(isp ? signed(OPS_ACCOUNTS.vatInput, isp.deductibleTaxCents, "debit", { supplierId: e.supplierId, description: short(ispText, 300), taxRateBp: isp.rateBp, taxBaseCents: e.baseCents }) : []),
    ...(isp ? signed(OPS_ACCOUNTS.vatOutput, isp.taxCents, "credit", { supplierId: e.supplierId, description: short(ispText, 300), taxRateBp: isp.rateBp, taxBaseCents: e.baseCents }) : []),
    ...signed(OPS_ACCOUNTS.withholding, a.withholdingCents, "credit", { supplierId: e.supplierId, description: `Retención ${e.withholdingRateBp / 100} %`, taxRateBp: e.withholdingRateBp, taxBaseCents: e.baseCents }),
    ...signed(ctx.supplierAccount, a.payableCents, "credit", { supplierId: e.supplierId, description: short(`${label} ${e.invoiceNumber ?? ""}`.trim(), 300) }),
  ];
  return { journalCode: "COM", date, description: short(`${label} ${e.invoiceNumber ?? `#${e.id}`}${who}`, 500), origin: "expense", sourceKey: expenseSourceKey(e.id), lines };
}

/** Cuenta de las comisiones de Stripe contabilizadas al importar (la cuota del IVA español se reclasifica desde ella). */
export const STRIPE_FEES_ACCOUNT = "626";

/**
 * Factura de comisiones de Stripe que liquida las ya contabilizadas al importar (CRM 0039, `settlesStripeFees`): la base
 * NO vuelve a 626 ni hay cuenta del proveedor (se pagó con el saldo de Stripe). Solo el IVA, con tipo y base en las
 * líneas para el 303:
 *  - con inversión del sujeto pasivo (`intra_eu_services`): Debe 472 (deducible) y la parte no deducible a la cuenta de la
 *    categoría · Haber 477 (autoliquidada);
 *  - interior (`domestic`): la comisión importada ya incluía el IVA español: Debe 472 · Haber 626 (la cuota deducible sale
 *    del gasto; la no deducible se queda en él).
 * Rectificativa: lo mismo con signo contrario. `source_key = expense:<id>`.
 */
export function stripeFeeInvoiceEntry(e: Expense, ctx: { categoryAccount: string; supplierName: string | null }): EntryDraft {
  const a = expenseAmounts(e);
  if (a.taxCents !== e.taxCents || a.withholdingCents !== e.withholdingCents || a.totalCents !== e.totalCents) throw bad(`El gasto #${e.id} no cuadra con su base y sus tipos`);
  if (e.withholdingCents !== 0) throw new FinanceError("invalid_stripe_fee_invoice", "La factura de comisiones de Stripe no lleva retención");
  const date = e.accrualDate ?? e.invoiceDate;
  const label = `${e.kind === "rectification" ? "Rectificativa de comisiones de Stripe" : "Factura de comisiones de Stripe"} ${e.invoiceNumber ?? `#${e.id}`}${ctx.supplierName ? ` · ${ctx.supplierName}` : ""}`;
  const isp = reverseChargeAmounts(e);
  const lines: EntryLineInput[] = [];
  if (isp) {
    if (vatTreatmentOf(e) !== "intra_eu_services") throw new FinanceError("invalid_stripe_fee_invoice", "Con inversión del sujeto pasivo, la factura de comisiones de Stripe es de servicios intracomunitarios");
    const text = short(`IVA autoliquidado ${isp.rateBp / 100} % · comisiones de Stripe (inversión del sujeto pasivo)`, 300);
    lines.push(
      ...signed(OPS_ACCOUNTS.vatInput, isp.deductibleTaxCents, "debit", { supplierId: e.supplierId, description: text, taxRateBp: isp.rateBp, taxBaseCents: e.baseCents }),
      ...signed(ctx.categoryAccount, isp.nonDeductibleTaxCents, "debit", { supplierId: e.supplierId, costCenterId: e.costCenterId, description: "IVA no deducible de las comisiones de Stripe", taxRateBp: isp.rateBp, taxBaseCents: e.baseCents }),
      ...signed(OPS_ACCOUNTS.vatOutput, isp.taxCents, "credit", { supplierId: e.supplierId, description: text, taxRateBp: isp.rateBp, taxBaseCents: e.baseCents }),
    );
  } else {
    if (vatTreatmentOf(e) !== "domestic") throw new FinanceError("invalid_stripe_fee_invoice", "La factura de comisiones de Stripe es interior (IVA español) o de servicios intracomunitarios (ISP)");
    const text = short(`IVA soportado ${e.taxRateBp / 100} % · comisiones de Stripe (reclasificado desde ${STRIPE_FEES_ACCOUNT})`, 300);
    lines.push(
      ...signed(OPS_ACCOUNTS.vatInput, a.deductibleTaxCents, "debit", { supplierId: e.supplierId, description: text, taxRateBp: e.taxRateBp, taxBaseCents: e.baseCents }),
      ...signed(STRIPE_FEES_ACCOUNT, a.deductibleTaxCents, "credit", { supplierId: e.supplierId, costCenterId: e.costCenterId, description: text, taxRateBp: e.taxRateBp, taxBaseCents: e.baseCents }),
    );
  }
  if (!lines.length) throw new FinanceError("invalid_stripe_fee_invoice", "La factura de comisiones de Stripe no tiene IVA que contabilizar (la comisión ya está en 626)");
  return { journalCode: "COM", date, description: short(label, 500), origin: "expense", sourceKey: expenseSourceKey(e.id), lines };
}

/**
 * Autoliquidación de un gasto con inversión del sujeto pasivo (CRM 0039): cuota al tipo de la autoliquidación sobre la
 * base (con su signo), parte deducible (472) y no deducible (mayor gasto). null si el tratamiento no lleva ISP.
 */
export function reverseChargeAmounts(e: Pick<Expense, "baseCents" | "deductibleBp" | "vatTreatment" | "reverseChargeRateBp">): { rateBp: number; taxCents: number; deductibleTaxCents: number; nonDeductibleTaxCents: number } | null {
  if (!REVERSE_CHARGE_TREATMENTS.includes(vatTreatmentOf(e))) return null;
  if (e.reverseChargeRateBp === null || e.reverseChargeRateBp === undefined) throw bad("Falta el tipo de la autoliquidación (inversión del sujeto pasivo)");
  const taxCents = signedTaxOf(e.baseCents, e.reverseChargeRateBp);
  const deductibleTaxCents = signedTaxOf(taxCents, e.deductibleBp);
  return { rateBp: e.reverseChargeRateBp, taxCents, deductibleTaxCents, nonDeductibleTaxCents: taxCents - deductibleTaxCents };
}

/**
 * Comprueba el tratamiento del IVA de un gasto con su proveedor (CRM 0039). Con ISP la factura viene sin IVA (tipo 0)
 * y el tipo de la autoliquidación es obligatorio; las intracomunitarias exigen un proveedor de otro Estado de la UE
 * con NIF-IVA (`vat_id_required`). Devuelve lo que se guarda (null = interior) y el tipo de la autoliquidación.
 */
export function checkVatTreatment(
  treatment: VatTreatment | null | undefined,
  i: { taxRateBp: number; reverseChargeRateBp?: number | null },
  supplier: { country: string; taxId: string | null } | null,
  eu: { isEu: (country: string | null | undefined) => boolean; isEuForeign: (country: string | null | undefined) => boolean },
): { vatTreatment: VatTreatment | null; reverseChargeRateBp: number | null } {
  const t = treatment ?? null;
  const rc = i.reverseChargeRateBp ?? null;
  if (t !== null && !(VAT_TREATMENTS as readonly string[]).includes(t)) throw bad("Tratamiento del IVA no válido");
  const isp = t !== null && REVERSE_CHARGE_TREATMENTS.includes(t);
  if (!isp && rc !== null) throw bad("El tipo de la autoliquidación solo se indica con inversión del sujeto pasivo");
  if (isp) {
    if (i.taxRateBp !== 0) throw bad("Con inversión del sujeto pasivo la factura viene sin IVA: el tipo de IVA de la factura es 0");
    if (rc === null) throw bad("Indica el tipo de la autoliquidación (inversión del sujeto pasivo), p. ej. 2100 = 21 %");
    if (!Number.isInteger(rc) || rc <= 0 || rc > 10_000) throw bad("El tipo de la autoliquidación va de 1 a 10000 puntos básicos");
  }
  if ((t === "exempt" || t === "not_subject") && i.taxRateBp !== 0) throw bad("Una operación exenta o no sujeta no lleva IVA: el tipo es 0");
  if (t === "intra_eu_services" || t === "intra_eu_goods") {
    if (!supplier) throw new FinanceError("vat_id_required", "Una operación intracomunitaria necesita el proveedor con su NIF-IVA");
    if (!eu.isEuForeign(supplier.country)) throw bad("Una operación intracomunitaria es con un proveedor de otro Estado de la UE (no España)");
    if (!supplier.taxId) throw new FinanceError("vat_id_required", "Falta el NIF-IVA del proveedor: complétalo en su ficha (lo pide el 349)");
  }
  if (t === "non_eu_services" && supplier && eu.isEu(supplier.country)) throw bad("El proveedor es de la UE: usa «servicios intracomunitarios» (o interior si es de España)");
  if (t === "reverse_charge_domestic" && supplier && supplier.country.toUpperCase() !== "ES") throw bad("La inversión del sujeto pasivo interior es con un proveedor español");
  return { vatTreatment: t, reverseChargeRateBp: isp ? rc : null };
}

/**
 * Pago de un gasto: Debe 400/410 · Haber tesorería (572000NN banco, 570000NN caja, 5720 Stripe). Un importe negativo
 * (devolución de una rectificativa) sale invertido. Diario BAN, CAJ o STR según la tesorería.
 */
export function paymentEntry(p: { amountCents: number; date: string; supplierAccount: string; treasuryAccount: string; supplierId: number | null; label: string; sourceKey: string }): EntryDraft {
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents === 0) throw bad("El importe del pago es distinto de cero");
  const journalCode = p.treasuryAccount === OPS_ACCOUNTS.stripe ? "STR" : p.treasuryAccount.startsWith("570") ? "CAJ" : "BAN";
  return {
    journalCode,
    date: p.date,
    description: short(p.label, 500),
    origin: "expense_payment",
    sourceKey: p.sourceKey,
    lines: [...signed(p.supplierAccount, p.amountCents, "debit", { supplierId: p.supplierId, description: short(p.label, 300) }), ...signed(p.treasuryAccount, p.amountCents, "credit")],
  };
}

/**
 * Movimiento bancario sin gasto (comisión, impuesto, transferencia interna, nómina…): abono → Debe banco · Haber
 * contrapartida; cargo → Debe contrapartida · Haber banco. Diario BAN, `source_key = bankmov:<id>`.
 */
export function bankCounterpartEntry(m: { amountCents: number; bookingDate: string; description: string }, bankAccount: string, counterpart: string, description: string | null, sourceKey: string): EntryDraft {
  if (counterpart === bankAccount) throw new FinanceError("invalid_account", "La contrapartida no puede ser la propia cuenta del banco");
  const text = short((description?.trim() || m.description || "Movimiento bancario").trim(), 300);
  return { journalCode: "BAN", date: m.bookingDate, description: short(`Banco: ${text}`, 500), origin: "bank", sourceKey, lines: [...signed(bankAccount, m.amountCents, "debit", { description: text }), ...signed(counterpart, m.amountCents, "credit", { description: text })] };
}

/** Caja: entrada → Debe 570000NN · Haber contrapartida; salida → al revés. Diario CAJ, `source_key = cash:<id>`. */
export function cashEntry(m: { amountCents: number; movedOn: string; description: string }, cashAccount: string, counterpart: string, sourceKey: string): EntryDraft {
  if (counterpart === cashAccount) throw new FinanceError("invalid_account", "La contrapartida no puede ser la propia caja");
  const text = short(m.description.trim(), 300);
  return { journalCode: "CAJ", date: m.movedOn, description: short(`Caja: ${text}`, 500), origin: "cash", sourceKey, lines: [...signed(cashAccount, m.amountCents, "debit", { description: text }), ...signed(counterpart, m.amountCents, "credit", { description: text })] };
}

// ── Gastos recurrentes ────────────────────────────────────────────────────────────────────────────────────────────

const STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Periodo de una fecha según la frecuencia: «AAAA-MM» (mensual), «AAAA-T1…T4» (trimestral), «AAAA» (anual). */
export function recurringPeriod(frequency: Frequency, date: string): string {
  if (frequency === "monthly") return date.slice(0, 7);
  if (frequency === "quarterly") return `${date.slice(0, 4)}-T${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return date.slice(0, 4);
}

/**
 * Fechas de una plantilla hasta `until` (incluida): el día `dayOfMonth` de cada mes, trimestre o año contado desde el
 * mes de inicio, sin fechas anteriores al inicio ni posteriores al fin. Como mucho `max` fechas.
 */
export function recurringOccurrences(t: Pick<RecurringExpense, "frequency" | "dayOfMonth" | "startDate" | "endDate">, until: string, max = 500): string[] {
  const out: string[] = [];
  const y0 = Number(t.startDate.slice(0, 4));
  const m0 = Number(t.startDate.slice(5, 7)) - 1;
  const last = t.endDate && t.endDate < until ? t.endDate : until;
  for (let k = 0; out.length < max; k++) {
    const months = m0 + k * STEP[t.frequency];
    const date = `${y0 + Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}-${String(t.dayOfMonth).padStart(2, "0")}`;
    if (date > last) break;
    if (date >= t.startDate) out.push(date);
  }
  return out;
}

/** Siguiente fecha de la plantilla posterior a `after` (o la primera si `after` es null). */
export function nextOccurrence(t: Pick<RecurringExpense, "frequency" | "dayOfMonth" | "startDate" | "endDate">, after: string | null): string | null {
  const horizon = addDays(after ?? t.startDate, 400);
  return recurringOccurrences(t, horizon).find((d) => !after || d > after) ?? null;
}

// ── Validaciones de identificadores ───────────────────────────────────────────────────────────────────────────────

export const normalizeIban = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();

/** IBAN con su control (mod 97, ISO 13616). España: 24 caracteres. */
export function isValidIban(value: string): boolean {
  const v = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  if (v.startsWith("ES") && v.length !== 24) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

export const normalizeTaxId = (v: string) => v.trim().toUpperCase().replace(/[\s.-]/g, "");

/** NIF del proveedor: en España, NIF/CIF/NIE con su control (`isValidSpanishTaxId`); fuera, de 2 a 20 caracteres. */
export function taxIdProblem(taxId: string, country: string): string | null {
  const v = normalizeTaxId(taxId);
  if (country === "ES") return isValidSpanishTaxId(v) ? null : "El NIF/CIF no es válido (revisa la letra o el dígito de control)";
  return /^[A-Z0-9]{2,20}$/.test(v) ? null : "El identificador fiscal tiene de 2 a 20 letras o números";
}

// ── Documentos ────────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const startsWith = (buf: Buffer, bytes: number[]) => buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** ¿Es texto (sin bytes nulos ni de control salvo tabulador y saltos de línea)? */
function looksLikeText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 64 * 1024);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) return false;
  }
  return true;
}

/**
 * Tipo de un documento por la FIRMA de su contenido (no por la extensión): PDF, PNG, JPEG, XML o CSV. Null si no es
 * ninguno. El CSV además exige la extensión .csv y separadores en la primera línea.
 */
export function sniffDocument(buf: Buffer, filename: string): { mime: string; ext: string } | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (!looksLikeText(buf)) return null;
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^<\?xml[\s?]/.test(head) || /^<[A-Za-z_][\w:.-]*[\s>/]/.test(head)) return { mime: "application/xml", ext: "xml" };
  const first = head.split(/\r?\n/)[0] ?? "";
  if (/\.csv$/i.test(filename) && /[;,\t]/.test(first)) return { mime: "text/csv", ext: "csv" };
  return null;
}

/** Nombre de fichero seguro para guardar y servir (sin rutas, comillas ni caracteres de control). */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").trim().slice(0, 200);
  return clean || "documento";
}

export const sha256Hex = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

// ── Extractos bancarios ───────────────────────────────────────────────────────────────────────────────────────────

/** Texto de un fichero: UTF-8 si lo es; si no, Latin-1 (habitual en Norma 43 y en exportaciones de bancos). */
export function decodeText(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = buf.toString("latin1");
  }
  return text.replace(/^﻿/, "");
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Claves de duplicado ESTABLES: huella sha256 de los datos del movimiento más su número de aparición dentro del fichero
 * (dos comisiones idénticas el mismo día no se confunden; volver a importar el mismo extracto o uno solapado da las
 * mismas claves). La unicidad es por cuenta bancaria (índice único en la BD).
 */
export function withDuplicateKeys(rows: Array<Omit<ParsedMovement, "duplicateKey"> & { keyBase: string }>): ParsedMovement[] {
  const seen = new Map<string, number>();
  return rows.map(({ keyBase, ...m }) => {
    const n = (seen.get(keyBase) ?? 0) + 1;
    seen.set(keyBase, n);
    return { ...m, duplicateKey: sha256Hex(`${keyBase}#${n}`) };
  });
}

const N43_COMMON: Record<string, string> = {
  "01": "Talones y reintegros",
  "02": "Abonarés, entregas e ingresos",
  "03": "Domiciliaciones y recibos",
  "04": "Transferencias y traspasos",
  "05": "Amortización de préstamos",
  "06": "Remesas de efectos",
  "07": "Suscripciones y canjes",
  "08": "Dividendos y cupones",
  "09": "Operaciones de valores",
  "10": "Cheques de gasolina",
  "11": "Cajero automático",
  "12": "Tarjetas",
  "13": "Operaciones con el extranjero",
  "14": "Devoluciones e impagados",
  "15": "Nóminas y seguros sociales",
  "16": "Timbres y corretajes",
  "17": "Intereses, comisiones y gastos",
  "98": "Anulaciones y correcciones",
  "99": "Varios",
};

const n43Date = (s: string, what: string, line: number) => {
  const d = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  if (!isValidDate(d)) throw bad(`Norma 43, línea ${line}: ${what} no válida («${s}»)`);
  return d;
};
const n43Amount = (s: string, line: number) => {
  if (!/^\d{14}$/.test(s)) throw bad(`Norma 43, línea ${line}: importe no válido («${s}»)`);
  return Number(s);
};

export interface Norma43Account {
  bank: string;
  branch: string;
  account: string;
  from: string;
  to: string;
  openingCents: number;
  closingCents: number;
  currency: string;
  holder: string;
  movements: ParsedMovement[];
}

/**
 * Norma 43 de la AEB (cuaderno 43, registros de 80 posiciones):
 *  11 cabecera de cuenta (entidad, oficina, cuenta, fechas, clave y saldo inicial, divisa, titular);
 *  22 movimiento (fecha de operación y de valor AAMMDD, concepto común y propio, clave 1 = DEBE = cargo (importe
 *     negativo) / 2 = HABER = abono (positivo), importe con 2 decimales, documento y referencias);
 *  23 conceptos complementarios del movimiento anterior (hasta cinco);
 *  24 equivalencia de divisa (se ignora);
 *  33 final de cuenta (número y total de apuntes al debe y al haber, saldo final): se comprueba que cuadra;
 *  88 fin de fichero.
 * Cada movimiento lleva el saldo resultante (inicial + apuntes). `invalid_input` si el fichero no es Norma 43 o no cuadra.
 */
export function parseNorma43(text: string): Norma43Account[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0);
  if (!lines.length || !lines[0].startsWith("11")) throw bad("El fichero no es Norma 43: debe empezar por un registro 11 (cabecera de cuenta)");
  const accounts: Norma43Account[] = [];
  let cur: (Norma43Account & { rows: Array<Omit<ParsedMovement, "duplicateKey"> & { keyBase: string }>; debit: number; credit: number; nDebit: number; nCredit: number; running: number }) | null = null;
  let ended = false;
  lines.forEach((raw, i) => {
    const n = i + 1;
    const l = raw.padEnd(80, " ");
    const type = l.slice(0, 2);
    if (ended) throw bad(`Norma 43, línea ${n}: hay datos después del registro 88 (fin de fichero)`);
    if (type === "11") {
      if (cur) throw bad(`Norma 43, línea ${n}: cuenta sin registro 33 (final de cuenta) antes de la siguiente`);
      const sign = l[32] === "1" ? -1 : l[32] === "2" ? 1 : 0;
      if (!sign) throw bad(`Norma 43, línea ${n}: clave del saldo inicial no válida`);
      const opening = sign * n43Amount(l.slice(33, 47), n);
      cur = { bank: l.slice(2, 6), branch: l.slice(6, 10), account: l.slice(10, 20), from: n43Date(l.slice(20, 26), "fecha inicial", n), to: n43Date(l.slice(26, 32), "fecha final", n), openingCents: opening, closingCents: opening, currency: l.slice(47, 50), holder: l.slice(51, 77).trim(), movements: [], rows: [], debit: 0, credit: 0, nDebit: 0, nCredit: 0, running: opening };
    } else if (type === "22") {
      if (!cur) throw bad(`Norma 43, línea ${n}: movimiento fuera de una cuenta`);
      const key = l[27];
      if (key !== "1" && key !== "2") throw bad(`Norma 43, línea ${n}: clave debe/haber no válida («${key}»)`);
      const abs = n43Amount(l.slice(28, 42), n);
      if (abs === 0) throw bad(`Norma 43, línea ${n}: movimiento de importe cero`);
      const amount = key === "1" ? -abs : abs;
      if (key === "1") (cur.debit += abs), cur.nDebit++;
      else (cur.credit += abs), cur.nCredit++;
      cur.running += amount;
      const common = l.slice(22, 24);
      const own = l.slice(24, 27);
      const doc = l.slice(42, 52).trim();
      const ref1 = l.slice(52, 64).trim();
      const ref2 = l.slice(64, 80).trim();
      const bookingDate = n43Date(l.slice(10, 16), "fecha de operación", n);
      const valueDate = n43Date(l.slice(16, 22), "fecha valor", n);
      cur.rows.push({
        bookingDate,
        valueDate,
        amountCents: amount,
        description: ref2 || N43_COMMON[common] || `Concepto ${common}`,
        reference: ref1.replace(/^0+$/, "") || doc.replace(/^0+$/, "") || null,
        counterparty: null,
        balanceCents: cur.running,
        keyBase: ["n43", bookingDate, valueDate, amount, common, own, doc, ref1, ref2].join("|"),
      });
    } else if (type === "23") {
      const last = cur?.rows.at(-1);
      if (!cur || !last) throw bad(`Norma 43, línea ${n}: concepto complementario sin movimiento`);
      const extra = `${l.slice(4, 42).trim()} ${l.slice(42, 80).trim()}`.trim();
      if (extra) {
        // El primer complementario sustituye al texto genérico; los siguientes se añaden
        const generic = last.description === (N43_COMMON[last.keyBase.split("|")[4]] ?? "");
        last.description = (generic && l.slice(2, 4) === "01" ? extra : `${last.description} ${extra}`).replace(/\s+/g, " ").slice(0, 500);
        last.keyBase += `|${norm(extra)}`;
      }
    } else if (type === "24") {
      // Equivalencia de divisa: no cambia el importe en euros
    } else if (type === "33") {
      if (!cur) throw bad(`Norma 43, línea ${n}: final de cuenta sin cabecera`);
      const nDebit = Number(l.slice(20, 25));
      const debit = n43Amount(l.slice(25, 39), n);
      const nCredit = Number(l.slice(39, 44));
      const credit = n43Amount(l.slice(44, 58), n);
      const sign = l[58] === "1" ? -1 : l[58] === "2" ? 1 : 0;
      const closing = sign * n43Amount(l.slice(59, 73), n);
      if (nDebit !== cur.nDebit || debit !== cur.debit || nCredit !== cur.nCredit || credit !== cur.credit) throw bad(`Norma 43: los totales de la cuenta ${cur.account} no cuadran con sus movimientos (registro 33, línea ${n})`);
      if (!sign || closing !== cur.running) throw bad(`Norma 43: el saldo final de la cuenta ${cur.account} no cuadra con el saldo inicial y los movimientos`);
      cur.closingCents = closing;
      const { rows, debit: _d, credit: _c, nDebit: _nd, nCredit: _nc, running: _r, ...acc } = cur;
      accounts.push({ ...acc, movements: withDuplicateKeys(rows) });
      cur = null;
    } else if (type === "88") {
      ended = true;
    } else throw bad(`Norma 43, línea ${n}: tipo de registro desconocido («${type}»)`);
  });
  if (cur) throw bad("Norma 43: falta el registro 33 (final de cuenta)");
  return accounts;
}

/** Entidad, oficina y número de cuenta de un IBAN español (para comprobar que el extracto es de esa cuenta). */
export function spanishAccountOfIban(iban: string | null): { bank: string; branch: string; account: string } | null {
  const v = iban ? normalizeIban(iban) : "";
  if (!/^ES\d{22}$/.test(v)) return null;
  return { bank: v.slice(4, 8), branch: v.slice(8, 12), account: v.slice(14, 24) };
}

// CaixaBank: funciones COPIADAS y adaptadas de server/routers/bankMovements.ts (módulo del tenant; no se importan porque
// ese fichero depende de legacyDb). Cambios: importes en céntimos enteros, «1.234,56» con separador de miles bien
// leído, fechas de celdas Excel redondeadas al día (independiente de la zona del proceso) y huella estable con número
// de aparición.

/** Adaptada de `parseExcelDate` (server/routers/bankMovements.ts). Devuelve «AAAA-MM-DD» o "" si no es una fecha. */
export function parseExcelDate(v: unknown): string {
  if (v == null || v === "") return "";
  const fromDate = (dt: Date) => {
    // Medianoche local o UTC: sumar 12 h y leer en UTC da el mismo día en cualquier zona de Europa
    const x = new Date(dt.getTime() + 12 * 3_600_000);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
  };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : fromDate(v);
  if (typeof v === "number") {
    // Número de serie de Excel (1 = 1/1/1900, con el desfase del año bisiesto de 1900)
    const dt = new Date(Math.round((v - 25569) * 86_400_000));
    const out = fromDate(dt);
    return Number(out.slice(0, 4)) > 1900 && Number(out.slice(0, 4)) < 2100 ? out : "";
  }
  const s = String(v).trim();
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (d) {
    const out = `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    return isValidDate(out) ? out : "";
  }
  const y = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (y && isValidDate(s.slice(0, 10))) return s.slice(0, 10);
  return "";
}

/**
 * Adaptada de `parseImporte` (server/routers/bankMovements.ts): importe → céntimos con signo, o null si no es un
 * importe. Admite números, «-1.234,56», «1234,56», «1,234.56», «12.50» y el símbolo del euro.
 */
export function parseImporte(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).replace(/[\s€]/g, "").replace(/EUR$/i, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) (neg = true), (s = s.slice(1, -1));
  if (s.startsWith("-")) (neg = !neg), (s = s.slice(1));
  else if (s.startsWith("+")) s = s.slice(1);
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lastComma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [ent, dec = ""] = s.split(".");
  const c = Number(ent) * 100 + Number(dec.padEnd(2, "0"));
  return neg ? -c : c;
}

/** Copiada de `makeDuplicateKey` (server/routers/bankMovements.ts), con importes en céntimos: base de la huella. */
export function makeDuplicateKey(fecha: string, fechaValor: string, movimiento: string, masDatos: string, importeCents: number, saldoCents: number | null): string {
  return ["caixabank", fecha, fechaValor, norm(movimiento), norm(masDatos), importeCents, saldoCents ?? ""].join("|");
}

/**
 * Adaptada de `parseCaixaBankBuffer` (server/routers/bankMovements.ts): Excel (o CSV) exportado de CaixaBank. Busca la
 * cabecera con «Fecha» e «Importe» en las 20 primeras filas; columnas opcionales «Fecha valor», «Movimiento», «Más
 * datos»/«Concepto» y «Saldo».
 */
export function parseCaixaBankBuffer(buffer: Buffer): ParsedMovement[] {
  let rows: unknown[][];
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];
  } catch {
    throw bad("No se pudo leer el fichero de CaixaBank (Excel o CSV)");
  }
  const col: Record<string, number> = {};
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const h = (rows[r] ?? []).map((c) => norm(c));
    if (h.includes("fecha") && h.includes("importe")) {
      headerRow = r;
      h.forEach((x, i) => {
        if (x === "fecha" && col.fecha == null) col.fecha = i;
        else if (["fecha valor", "f.valor", "fechavalor", "f. valor"].includes(x) && col.fechaValor == null) col.fechaValor = i;
        else if (x === "movimiento" && col.movimiento == null) col.movimiento = i;
        else if (["más datos", "mas datos", "concepto", "descripcion", "descripción"].includes(x) && col.masDatos == null) col.masDatos = i;
        else if (x === "importe" && col.importe == null) col.importe = i;
        else if (x === "saldo" && col.saldo == null) col.saldo = i;
      });
      break;
    }
  }
  if (headerRow === -1) throw bad("No se encontró la cabecera del extracto de CaixaBank (columnas «Fecha» e «Importe»)");
  const out: Array<Omit<ParsedMovement, "duplicateKey"> & { keyBase: string }> = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const fecha = parseExcelDate(row[col.fecha]);
    if (!fecha) continue;
    const importe = parseImporte(row[col.importe]);
    if (importe === null) throw bad(`CaixaBank, fila ${r + 1}: importe no válido`);
    if (importe === 0) continue;
    const fechaValor = col.fechaValor != null ? parseExcelDate(row[col.fechaValor]) : "";
    const movimiento = String(row[col.movimiento ?? -1] ?? "").trim();
    const masDatos = String(row[col.masDatos ?? -1] ?? "").trim();
    const saldo = col.saldo != null ? parseImporte(row[col.saldo]) : null;
    out.push({
      bookingDate: fecha,
      valueDate: fechaValor || null,
      amountCents: importe,
      description: ([movimiento, masDatos].filter(Boolean).join(" · ") || "(sin concepto)").slice(0, 500),
      reference: null,
      counterparty: null,
      balanceCents: saldo,
      keyBase: makeDuplicateKey(fecha, fechaValor, movimiento, masDatos, importe, saldo),
    });
  }
  return withDuplicateKeys(out);
}

export interface CsvMapping {
  delimiter: ";" | "," | "\t";
  headerRows: number;
  date: number;
  amount: number;
  description: number;
  balance: number | null;
  dateFormat: "dd/mm/yyyy" | "yyyy-mm-dd" | "mm/dd/yyyy";
  decimal: "," | ".";
}

/** Una línea CSV en celdas (comillas dobles y «""» escapadas). */
export function splitCsvLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Fecha de una celda según el formato del mapeo → «AAAA-MM-DD» o null. */
export function parseCellDate(v: string, f: CsvMapping["dateFormat"]): string | null {
  const s = (v ?? "").trim();
  let y: string, m: string, d: string;
  if (f === "yyyy-mm-dd") {
    const r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (!r) return null;
    [, y, m, d] = r;
  } else {
    const r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?!\d)/.exec(s);
    if (!r) return null;
    [d, m] = f === "dd/mm/yyyy" ? [r[1], r[2]] : [r[2], r[1]];
    y = r[3].length === 2 ? `20${r[3]}` : r[3];
  }
  const out = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidDate(out) ? out : null;
}

/** Importe de una celda con el separador decimal del mapeo → céntimos con signo o null. */
export function parseCellAmount(v: string, decimal: "," | "."): number | null {
  let s = (v ?? "").trim().replace(/[€\s]/g, "").replace(/EUR$/i, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) (neg = true), (s = s.slice(1, -1));
  if (s.startsWith("-")) (neg = !neg), (s = s.slice(1));
  else if (s.startsWith("+")) s = s.slice(1);
  s = s.split(decimal === "," ? "." : ",").join("");
  if (decimal === ",") s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [ent, dec = ""] = s.split(".");
  const c = Number(ent) * 100 + Number(dec.padEnd(2, "0"));
  return neg ? -c : c;
}

export const MAX_IMPORT_ROWS = 20_000;

/**
 * CSV con mapeo de columnas (desde 0). Se saltan las filas de cabecera y las que no tienen fecha (pies, totales,
 * líneas en blanco) y las de importe cero; una fila con fecha e importe ilegible invalida el fichero (con su línea).
 */
export function parseMappedCsv(text: string, m: CsvMapping): ParsedMovement[] {
  const cols = [m.date, m.amount, m.description, ...(m.balance === null ? [] : [m.balance])];
  if (new Set(cols).size !== cols.length) throw bad("Cada dato del mapeo debe salir de una columna distinta");
  const lines = text.split(/\r?\n/);
  const out: Array<Omit<ParsedMovement, "duplicateKey"> & { keyBase: string }> = [];
  lines.forEach((line, i) => {
    if (i < m.headerRows || !line.trim()) return;
    const cells = splitCsvLine(line, m.delimiter);
    const date = parseCellDate(cells[m.date] ?? "", m.dateFormat);
    if (!date) return;
    const amount = parseCellAmount(cells[m.amount] ?? "", m.decimal);
    if (amount === null) throw bad(`CSV, línea ${i + 1}: importe no reconocido («${(cells[m.amount] ?? "").slice(0, 30)}»)`);
    if (amount === 0) return;
    const balance = m.balance === null ? null : parseCellAmount(cells[m.balance] ?? "", m.decimal);
    const description = (cells[m.description] ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || "(sin concepto)";
    out.push({ bookingDate: date, valueDate: null, amountCents: amount, description, reference: null, counterparty: null, balanceCents: balance, keyBase: ["csv", date, amount, norm(description), balance ?? ""].join("|") });
  });
  return withDuplicateKeys(out);
}

// ── Sugerencias de conciliación ───────────────────────────────────────────────────────────────────────────────────

/** Palabras significativas de un nombre (sin formas societarias ni palabras cortas), sin acentos y en minúsculas. */
export function nameTokens(name: string): string[] {
  const STOP = new Set(["sl", "slu", "sa", "sau", "sll", "scoop", "cb", "ltd", "llc", "inc", "gmbh", "bv", "sas", "srl", "limited", "sociedad", "limitada", "anonima", "the", "de", "del", "los", "las", "y"]);
  return Array.from(
    new Set(
      name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  );
}

export interface SuggestMovement {
  amountCents: number;
  bookingDate: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
}
export interface SuggestExpense {
  id: number;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  pendingCents: number;
}
export interface SuggestPayment {
  id: number;
  expenseId: number;
  supplierName: string | null;
  invoiceNumber: string | null;
  paidOn: string;
  amountCents: number;
}
export interface MatchSuggestion {
  type: "expense" | "expense_payment";
  expenseId: number;
  expensePaymentId: number | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  date: string;
  amountCents: number;
  reasons: string[];
  score: number;
}

export const SUGGESTION_WINDOW_DAYS = 7;

/**
 * Sugerencias para un movimiento (inspirado en `scoreCandidates` de server/services/cardTerminalMatchingService.ts):
 * importe exacto +60, fecha a ±7 días hasta +20 (menos cuanto más lejos), proveedor en el concepto +30.
 *  - pagos ya registrados a mano y sin movimiento: solo con importe exacto (vincularlos no crea asiento);
 *  - gastos registrados con pendiente: importe exacto o proveedor en el concepto (se crea su pago).
 * Un cargo (importe negativo) paga un gasto (pendiente positivo); un abono, una devolución (pendiente negativo).
 */
export function suggestMatches(m: SuggestMovement, expenses: readonly SuggestExpense[], payments: readonly SuggestPayment[], limit = 10): MatchSuggestion[] {
  const paid = -m.amountCents;
  const text = nameTokens(`${m.description} ${m.counterparty ?? ""} ${m.reference ?? ""}`);
  const textSet = new Set(text);
  const score = (amount: number, date: string, supplierName: string | null, invoiceNumber: string | null) => {
    const reasons: string[] = [];
    let s = 0;
    const exact = amount === paid;
    if (exact) (s += 60), reasons.push("Importe exacto");
    const days = Math.abs(daysBetween(date, m.bookingDate));
    if (days <= SUGGESTION_WINDOW_DAYS) (s += 20 - 2 * days), reasons.push(days === 0 ? "Misma fecha" : `Fecha a ${days} ${days === 1 ? "día" : "días"}`);
    const tokens = supplierName ? nameTokens(supplierName) : [];
    const named = tokens.length > 0 && tokens.some((t) => textSet.has(t));
    if (named) (s += 30), reasons.push("Proveedor en el concepto");
    const numbered = !!invoiceNumber && invoiceNumber.length >= 3 && `${m.description} ${m.reference ?? ""}`.toUpperCase().includes(invoiceNumber.toUpperCase());
    if (numbered) (s += 20), reasons.push("Número de factura en el concepto");
    return { s, reasons, exact, named: named || numbered, days };
  };
  const out: MatchSuggestion[] = [];
  for (const p of payments) {
    const r = score(p.amountCents, p.paidOn, p.supplierName, p.invoiceNumber);
    if (r.exact && (r.days <= SUGGESTION_WINDOW_DAYS || r.named)) out.push({ type: "expense_payment", expenseId: p.expenseId, expensePaymentId: p.id, supplierName: p.supplierName, invoiceNumber: p.invoiceNumber, date: p.paidOn, amountCents: p.amountCents, reasons: r.reasons, score: r.s + 5 });
  }
  for (const e of expenses) {
    if (e.pendingCents === 0 || Math.sign(e.pendingCents) !== Math.sign(paid)) continue;
    const date = e.dueDate ?? e.invoiceDate;
    const r = score(e.pendingCents, date, e.supplierName, e.invoiceNumber);
    if (r.exact || r.named) out.push({ type: "expense", expenseId: e.id, expensePaymentId: null, supplierName: e.supplierName, invoiceNumber: e.invoiceNumber, date, amountCents: e.pendingCents, reasons: r.reasons, score: r.s });
  }
  return out.sort((a, b) => b.score - a.score || a.expenseId - b.expenseId).slice(0, limit);
}
