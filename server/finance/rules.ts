/**
 * Reglas contables PURAS del libro de Big Elephant (sin BD ni red): validación y cuadre de asientos, asiento de la
 * factura emitida y de la rectificativa, reversión, regularización, cierre y apertura del ejercicio, sumas y saldos,
 * mayor con saldo acumulado y exportaciones CSV («;», BOM, euros con coma decimal).
 *
 * Convenios: importes en céntimos enteros; el saldo de una cuenta es debe − haber (positivo = deudor). Cada línea
 * lleva debe XOR haber > 0; un asiento contabilizado cuadra (Σdebe = Σhaber > 0).
 */
import type { Invoice } from "../invoicing/types";
import { FinanceError, type Account, type AccountType, type EntryDraft, type EntryLineInput, type EntryLine, type JournalCode, type PostedLine } from "./types";

export const MAX_LINES = 500;
/** Tope por línea (10.000 millones de euros): fuera de él es un error de entrada, no un importe real. */
export const MAX_LINE_CENTS = 1_000_000_000_000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha de calendario real «AAAA-MM-DD»? */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export const yearOf = (date: string) => Number(date.slice(0, 4));
export const monthOf = (date: string) => Number(date.slice(5, 7));

export function sumLines(lines: ReadonlyArray<Pick<EntryLineInput, "debitCents" | "creditCents">>) {
  let debitCents = 0;
  let creditCents = 0;
  for (const l of lines) {
    debitCents += l.debitCents;
    creditCents += l.creditCents;
  }
  return { debitCents, creditCents };
}

const clean = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const optId = (v: number | null | undefined, what: string) => {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v <= 0) throw new FinanceError("invalid_input", `${what} no válido`);
  return v;
};

/**
 * Valida un asiento propuesto contra el plan contable y lo devuelve normalizado (líneas numeradas desde 1).
 *  - `invalid_input`: fecha, descripción o importes mal formados;
 *  - `invalid_account`: cuenta inexistente, inactiva o no imputable (cuenta de mayor con subcuentas);
 *  - `unbalanced`: Σdebe ≠ Σhaber o asiento a cero.
 * El periodo abierto se comprueba al contabilizar (depende del estado guardado, no de esta función).
 */
export function validateEntry(d: EntryDraft, accounts: ReadonlyMap<string, Account>): { draft: EntryDraft; lines: EntryLine[] } {
  if (!isValidDate(d.date)) throw new FinanceError("invalid_input", "La fecha del asiento no es válida (AAAA-MM-DD)");
  const description = (d.description ?? "").trim();
  if (!description) throw new FinanceError("invalid_input", "El asiento necesita una descripción");
  if (description.length > 500) throw new FinanceError("invalid_input", "La descripción no puede superar 500 caracteres");
  if (!Array.isArray(d.lines) || d.lines.length < 2) throw new FinanceError("unbalanced", "Un asiento necesita al menos dos líneas");
  if (d.lines.length > MAX_LINES) throw new FinanceError("invalid_input", `Un asiento admite como mucho ${MAX_LINES} líneas`);
  const lines: EntryLine[] = d.lines.map((l, i) => {
    const n = i + 1;
    for (const v of [l.debitCents, l.creditCents]) if (!Number.isSafeInteger(v) || v < 0 || v > MAX_LINE_CENTS) throw new FinanceError("invalid_input", `Línea ${n}: los importes son céntimos enteros no negativos`);
    if ((l.debitCents > 0) === (l.creditCents > 0)) throw new FinanceError("unbalanced", `Línea ${n}: lleva importe en el debe o en el haber, no en los dos ni en ninguno`);
    const a = accounts.get(l.accountCode);
    if (!a) throw new FinanceError("invalid_account", `Línea ${n}: la cuenta ${l.accountCode} no existe`);
    if (!a.active) throw new FinanceError("invalid_account", `Línea ${n}: la cuenta ${a.code} está inactiva`);
    if (!a.isPostable) throw new FinanceError("invalid_account", `Línea ${n}: la cuenta ${a.code} es de mayor; usa una subcuenta`);
    if (l.taxRateBp !== null && l.taxRateBp !== undefined && (!Number.isInteger(l.taxRateBp) || l.taxRateBp < 0 || l.taxRateBp > 10_000)) throw new FinanceError("invalid_input", `Línea ${n}: tipo impositivo no válido`);
    if (l.taxBaseCents !== null && l.taxBaseCents !== undefined && !Number.isSafeInteger(l.taxBaseCents)) throw new FinanceError("invalid_input", `Línea ${n}: base imponible no válida`);
    return {
      lineNo: n,
      accountCode: a.code,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: clean(l.description, 300),
      costCenterId: optId(l.costCenterId, `Línea ${n}: centro de coste`),
      supplierId: optId(l.supplierId, `Línea ${n}: proveedor`),
      companyId: optId(l.companyId, `Línea ${n}: empresa`),
      taxRateBp: l.taxRateBp ?? null,
      taxBaseCents: l.taxBaseCents ?? null,
    };
  });
  const t = sumLines(lines);
  if (t.debitCents !== t.creditCents) throw new FinanceError("unbalanced", `El asiento no cuadra: debe ${eur(t.debitCents)} € y haber ${eur(t.creditCents)} €`);
  if (t.debitCents <= 0) throw new FinanceError("unbalanced", "El asiento no puede ser de importe cero");
  return { draft: { ...d, description }, lines };
}

/** Línea a partir de un importe con signo: positivo en `positiveSide`, negativo en el lado contrario; cero, ninguna. */
function signed(accountCode: string, cents: number, positiveSide: "debit" | "credit", extra: Partial<EntryLineInput> = {}): EntryLineInput[] {
  if (cents === 0) return [];
  const side = cents > 0 ? positiveSide : positiveSide === "debit" ? "credit" : "debit";
  const abs = Math.abs(cents);
  return [{ accountCode, debitCents: side === "debit" ? abs : 0, creditCents: side === "credit" ? abs : 0, ...extra }];
}

export const ACCOUNTS = {
  customers: "430",
  services: "705",
  vatOutput: "477",
  vatInput: "472",
  result: "129",
} as const;

export const invoiceSourceKey = (invoiceId: number) => `invoice:${invoiceId}`;
export const reverseSourceKey = (entryId: number) => `reverse:${entryId}`;
export const regularizationSourceKey = (year: number) => `regularization:${year}`;
export const closingSourceKey = (year: number) => `closing:${year}`;
export const openingSourceKey = (year: number) => `opening:${year}`;

export type InvoiceForLedger = Pick<Invoice, "id" | "kind" | "status" | "number" | "issueDate" | "operationDate" | "currency" | "companyId" | "baseCents" | "taxCents" | "totalCents" | "lines">;

/**
 * Asiento de una factura emitida (server/invoicing, expedida): Debe 430 total · Haber 705 base · Haber 477 cuota, una
 * línea de 705 y de 477 por tipo de IVA. La rectificativa (importes negativos) usa las mismas cuentas con debe y haber
 * intercambiados. Fecha = fecha de EXPEDICIÓN (es cuando existe la factura y entra en el libro registro; la fecha de
 * operación va en la descripción). `source_key = invoice:<id>`.
 */
export function invoiceEntry(inv: InvoiceForLedger): EntryDraft {
  if (inv.status !== "issued" && inv.status !== "rectified") throw new FinanceError("invalid_state", `La factura #${inv.id} no está expedida`);
  if (!inv.number) throw new FinanceError("invalid_state", `La factura #${inv.id} no tiene número`);
  if (inv.currency !== "EUR") throw new FinanceError("invalid_input", `La factura ${inv.number} no está en euros`);
  const date = inv.issueDate ?? inv.operationDate;
  if (!isValidDate(date)) throw new FinanceError("invalid_input", `La factura ${inv.number} no tiene una fecha válida`);
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of inv.lines) {
    const g = byRate.get(l.taxRateBp) ?? { base: 0, tax: 0 };
    g.base += l.baseCents;
    g.tax += l.taxCents;
    byRate.set(l.taxRateBp, g);
  }
  const groups = Array.from(byRate.entries()).sort((a, b) => b[0] - a[0]);
  const base = groups.reduce((a, [, g]) => a + g.base, 0);
  const tax = groups.reduce((a, [, g]) => a + g.tax, 0);
  if (base !== inv.baseCents || tax !== inv.taxCents || base + tax !== inv.totalCents) throw new FinanceError("invalid_input", `La factura ${inv.number}: sus líneas no suman sus totales`);
  if (inv.totalCents === 0 && base === 0) throw new FinanceError("invalid_input", `La factura ${inv.number} es de importe cero`);
  const label = inv.kind === "rectification" ? "Factura rectificativa" : "Factura";
  const ref = { companyId: inv.companyId };
  const lines: EntryLineInput[] = [
    ...signed(ACCOUNTS.customers, inv.totalCents, "debit", { ...ref, description: `${label} ${inv.number}` }),
    ...groups.flatMap(([rate, g]) => signed(ACCOUNTS.services, g.base, "credit", { ...ref, description: `Base ${rate / 100} %`, taxRateBp: rate, taxBaseCents: g.base })),
    ...groups.flatMap(([rate, g]) => signed(ACCOUNTS.vatOutput, g.tax, "credit", { ...ref, description: `IVA ${rate / 100} %`, taxRateBp: rate, taxBaseCents: g.base })),
  ];
  return {
    journalCode: "VEN",
    date,
    description: `${label} ${inv.number} (operación ${inv.operationDate})`,
    origin: "invoice",
    sourceKey: invoiceSourceKey(inv.id),
    lines,
  };
}

/** Reversión: mismas líneas con debe y haber intercambiados, en la fecha indicada; `source_key = reverse:<id>`. */
export function reversalEntry(e: { id: number; year: number; number: number | null; journalCode: JournalCode; lines: EntryLine[] }, date: string, reason: string): EntryDraft {
  const why = reason.trim();
  return {
    journalCode: e.journalCode,
    date,
    description: `Reversión del asiento ${e.year}/${e.number ?? "-"}${why ? `: ${why}` : ""}`.slice(0, 500),
    origin: "reversal",
    sourceKey: reverseSourceKey(e.id),
    lines: e.lines.map((l) => ({ ...lineInput(l), debitCents: l.creditCents, creditCents: l.debitCents })),
  };
}

const lineInput = (l: EntryLine): EntryLineInput => ({
  accountCode: l.accountCode,
  debitCents: l.debitCents,
  creditCents: l.creditCents,
  description: l.description,
  costCenterId: l.costCenterId,
  supplierId: l.supplierId,
  companyId: l.companyId,
  taxRateBp: l.taxRateBp,
  taxBaseCents: l.taxBaseCents,
});

/** Saldos por cuenta (debe − haber) de un conjunto de líneas. */
export function balancesOf(lines: ReadonlyArray<Pick<EntryLine, "accountCode" | "debitCents" | "creditCents">>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.accountCode, (m.get(l.accountCode) ?? 0) + l.debitCents - l.creditCents);
  return m;
}

/** Cuentas de gestión (grupos 6 y 7): las que se regularizan contra 129. */
export const isResultAccount = (code: string) => code.startsWith("6") || code.startsWith("7");

/** Saldo en el lado contrario: deja la cuenta a cero. */
const cancelling = (code: string, balance: number, description?: string): EntryLineInput => ({
  accountCode: code,
  debitCents: balance < 0 ? -balance : 0,
  creditCents: balance > 0 ? balance : 0,
  ...(description ? { description } : {}),
});

/**
 * Regularización del ejercicio (diario REG, 31/12): salda los grupos 6 y 7 contra 129. Beneficio → 129 al haber;
 * pérdida → 129 al debe. Null si no hay saldos de gestión.
 */
export function regularizationEntry(year: number, balances: ReadonlyMap<string, number>): EntryDraft | null {
  const codes = Array.from(balances.keys()).filter((c) => isResultAccount(c) && balances.get(c) !== 0).sort();
  if (!codes.length) return null;
  const lines = codes.map((c) => cancelling(c, balances.get(c)!));
  // Lo que queda por cuadrar es el resultado: Σ(saldos de gestión) va contra 129
  const net = codes.reduce((a, c) => a + balances.get(c)!, 0);
  if (net !== 0) lines.push({ accountCode: ACCOUNTS.result, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0, description: net < 0 ? "Beneficio del ejercicio" : "Pérdida del ejercicio" });
  return { journalCode: "REG", date: `${year}-12-31`, description: `Regularización del ejercicio ${year}`, origin: "regularization", sourceKey: regularizationSourceKey(year), lines };
}

/** Aplica unas líneas a unos saldos (sin modificar los originales). */
export function applyLines(balances: ReadonlyMap<string, number>, lines: ReadonlyArray<Pick<EntryLineInput, "accountCode" | "debitCents" | "creditCents">>): Map<string, number> {
  const m = new Map(balances);
  for (const l of lines) m.set(l.accountCode, (m.get(l.accountCode) ?? 0) + l.debitCents - l.creditCents);
  return m;
}

/** Cierre del ejercicio (diario CIE, 31/12): salda todas las cuentas con saldo (tras la regularización). */
export function closingEntry(year: number, balances: ReadonlyMap<string, number>): EntryDraft | null {
  const codes = Array.from(balances.keys()).filter((c) => balances.get(c) !== 0).sort();
  if (!codes.length) return null;
  if (codes.some(isResultAccount)) throw new FinanceError("invalid_state", "Quedan cuentas de gestión sin regularizar");
  return { journalCode: "CIE", date: `${year}-12-31`, description: `Cierre del ejercicio ${year}`, origin: "closing", sourceKey: closingSourceKey(year), lines: codes.map((c) => cancelling(c, balances.get(c)!)) };
}

/** Apertura del ejercicio siguiente (diario APE, 1/1): el asiento de cierre con debe y haber intercambiados. */
export function openingEntry(closedYear: number, closing: { lines: ReadonlyArray<Pick<EntryLine, "accountCode" | "debitCents" | "creditCents">> }): EntryDraft {
  const next = closedYear + 1;
  return {
    journalCode: "APE",
    date: `${next}-01-01`,
    description: `Apertura del ejercicio ${next}`,
    origin: "opening",
    sourceKey: openingSourceKey(next),
    lines: closing.lines.map((l) => ({ accountCode: l.accountCode, debitCents: l.creditCents, creditCents: l.debitCents })),
  };
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType | null;
  debitCents: number;
  creditCents: number;
  /** Debe − haber (positivo = deudor). */
  balanceCents: number;
}

/** Sumas y saldos por cuenta imputable, ordenado por código, con totales. */
export function trialBalance(lines: ReadonlyArray<Pick<EntryLine, "accountCode" | "debitCents" | "creditCents">>, accounts: ReadonlyMap<string, Pick<Account, "name" | "type">>) {
  const m = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const r = m.get(l.accountCode) ?? { debit: 0, credit: 0 };
    r.debit += l.debitCents;
    r.credit += l.creditCents;
    m.set(l.accountCode, r);
  }
  const items: TrialBalanceRow[] = Array.from(m.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, r]) => ({ code, name: accounts.get(code)?.name ?? "", type: accounts.get(code)?.type ?? null, debitCents: r.debit, creditCents: r.credit, balanceCents: r.debit - r.credit }));
  const totals = items.reduce((a, r) => ({ debitCents: a.debitCents + r.debitCents, creditCents: a.creditCents + r.creditCents, debitBalanceCents: a.debitBalanceCents + Math.max(r.balanceCents, 0), creditBalanceCents: a.creditBalanceCents + Math.max(-r.balanceCents, 0) }), { debitCents: 0, creditCents: 0, debitBalanceCents: 0, creditBalanceCents: 0 });
  return { items, totals };
}

export interface LedgerRow {
  entryId: number;
  year: number;
  entryNumber: number;
  entryDate: string;
  journalCode: JournalCode;
  description: string;
  debitCents: number;
  creditCents: number;
  /** Saldo acumulado tras esta línea (debe − haber, incluido el saldo anterior al periodo). */
  balanceCents: number;
}

const byEntryOrder = (a: PostedLine, b: PostedLine) => a.date.localeCompare(b.date) || a.year - b.year || a.number - b.number || a.lineNo - b.lineNo;

/** Mayor de una cuenta: saldo anterior (líneas antes del periodo) y movimientos del periodo con saldo acumulado. */
export function ledger(before: ReadonlyArray<Pick<EntryLine, "debitCents" | "creditCents">>, lines: ReadonlyArray<PostedLine>) {
  const openingCents = before.reduce((a, l) => a + l.debitCents - l.creditCents, 0);
  let running = openingCents;
  const items: LedgerRow[] = [...lines].sort(byEntryOrder).map((l) => {
    running += l.debitCents - l.creditCents;
    return { entryId: l.entryId, year: l.year, entryNumber: l.number, entryDate: l.date, journalCode: l.journalCode, description: l.description ?? l.entryDescription, debitCents: l.debitCents, creditCents: l.creditCents, balanceCents: running };
  });
  const t = sumLines(lines);
  return { openingCents, items, debitCents: t.debitCents, creditCents: t.creditCents, closingCents: running };
}

/** Movimiento neto de las cuentas con un prefijo en un rango de fechas (debe − haber). */
export function netMovement(lines: ReadonlyArray<Pick<PostedLine, "accountCode" | "date" | "debitCents" | "creditCents">>, prefix: string, from: string, to: string): number {
  let n = 0;
  for (const l of lines) if (l.accountCode.startsWith(prefix) && l.date >= from && l.date <= to) n += l.debitCents - l.creditCents;
  return n;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Euros con coma decimal y sin separador de miles: 123456 → «1234,56»; −5 → «-0,05». */
export function eur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** «AAAA-MM-DD» → «DD/MM/AAAA». */
export const esDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Celda de texto: entre comillas si hace falta y sin fórmulas (una celda que empieza por = + - @ se neutraliza). */
export function csvText(v: string | null | undefined): string {
  let s = (v ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BOM = "﻿";
export const toCsv = (header: string[], rows: string[][]) => BOM + [header, ...rows].map((r) => r.join(";")).join("\r\n") + "\r\n";

/** Libro diario (líneas contabilizadas) en CSV. */
export function journalCsv(lines: ReadonlyArray<PostedLine>, accounts: ReadonlyMap<string, Pick<Account, "name">>): string {
  const rows = [...lines].sort(byEntryOrder).map((l) => [
    String(l.year),
    String(l.number),
    esDate(l.date),
    l.journalCode,
    csvText(l.entryDescription),
    l.accountCode,
    csvText(accounts.get(l.accountCode)?.name ?? ""),
    eur(l.debitCents),
    eur(l.creditCents),
    csvText(l.description),
  ]);
  return toCsv(["Ejercicio", "Asiento", "Fecha", "Diario", "Descripción", "Cuenta", "Nombre de la cuenta", "Debe", "Haber", "Concepto"], rows);
}

/** Sumas y saldos en CSV. */
export function trialBalanceCsv(tb: ReturnType<typeof trialBalance>): string {
  const rows = tb.items.map((r) => [r.code, csvText(r.name), eur(r.debitCents), eur(r.creditCents), eur(Math.max(r.balanceCents, 0)), eur(Math.max(-r.balanceCents, 0))]);
  rows.push(["", "Totales", eur(tb.totals.debitCents), eur(tb.totals.creditCents), eur(tb.totals.debitBalanceCents), eur(tb.totals.creditBalanceCents)]);
  return toCsv(["Cuenta", "Nombre", "Sumas debe", "Sumas haber", "Saldo deudor", "Saldo acreedor"], rows);
}
