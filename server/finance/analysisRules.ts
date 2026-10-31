/**
 * Reglas PURAS de la fase 4 (sin BD ni red): periodos y comparativas, cuenta de pérdidas y ganancias y balance de
 * situación con la estructura del modelo abreviado del PGC de pymes (con cuadre), tesorería por naturaleza de la
 * contrapartida, previsión de tesorería, antigüedad de saldos, gastos agrupados, Revenue & Margin, métricas de
 * conversión (DSO, cobro→disponible, payout→banco, tasas), resolución de la marca de coste directo, avisos del control
 * diario y los CSV de cada informe.
 *
 * Convenios: importes en céntimos; en la cuenta de resultados cada importe lleva el signo de su efecto en el resultado
 * (haber − debe: ingreso positivo, gasto negativo); en el balance, el activo es debe − haber y el patrimonio neto y el
 * pasivo, haber − debe. Una partida o un porcentaje sin base es `null`, nunca 0.
 */
import { addDays, daysBetween } from "./opsRules";
import { BOM, csvText, esDate, eur } from "./rules";
import type { DailyCounts, LedgerFact, PayableDoc, StripeFeesTreatment, StripeMonthFact, TransferMonthFact, TreasuryFact } from "./analysisTypes";
import { FinanceError } from "./types";

const bad = (m: string) => new FinanceError("invalid_input", m);

// ── Meses y periodos ─────────────────────────────────────────────────────────────────────────────────────────────

export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;
export const GRANULARITIES = ["month", "quarter", "year"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const COMPARE_KINDS = ["none", "previous", "year"] as const;
export type CompareKind = (typeof COMPARE_KINDS)[number];

/** Rango máximo de un informe por periodos (meses). */
export const MAX_REPORT_MONTHS = 36;

export const ymOf = (date: string) => date.slice(0, 7);
export function addMonths(ym: string, n: number): string {
  const total = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
export const lastDayOf = (ym: string) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  for (let m = fromYm; m <= toYm; m = addMonths(m, 1)) out.push(m);
  return out;
}
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const quarterOf = (ym: string) => Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1;

export interface Period {
  key: string;
  label: string;
  from: string;
  to: string;
  months: string[];
}

/** Clave del periodo de un mes según la granularidad: «2026-10», «2026-T4» o «2026». */
export function periodKeyOf(ym: string, g: Granularity): string {
  return g === "month" ? ym : g === "quarter" ? `${ym.slice(0, 4)}-T${quarterOf(ym)}` : ym.slice(0, 4);
}

/**
 * Periodos de un rango de meses completos (`from` se lleva al día 1 de su mes y `to` al último del suyo). Los periodos
 * de los extremos se recortan al rango (un trimestre puede tener menos de tres meses si el rango empieza a mitad).
 */
export function periodsOf(fromYm: string, toYm: string, g: Granularity): Period[] {
  const out: Period[] = [];
  for (const ym of monthsBetween(fromYm, toYm)) {
    const key = periodKeyOf(ym, g);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.months.push(ym);
      last.to = lastDayOf(ym);
      continue;
    }
    const label = g === "month" ? monthLabel(ym) : g === "quarter" ? `${quarterOf(ym)}T ${ym.slice(0, 4)}` : ym.slice(0, 4);
    out.push({ key, label, from: `${ym}-01`, to: lastDayOf(ym), months: [ym] });
  }
  return out;
}

/** Rango normalizado a meses completos y comprobado (máximo 36 meses). */
export function monthRange(from: string, to: string): { from: string; to: string; fromYm: string; toYm: string; months: number } {
  const fromYm = ymOf(from);
  const toYm = ymOf(to);
  if (fromYm > toYm) throw bad("La fecha inicial es posterior a la final");
  const months = monthsBetween(fromYm, toYm).length;
  if (months > MAX_REPORT_MONTHS) throw bad(`El informe abarca como mucho ${MAX_REPORT_MONTHS} meses`);
  return { from: `${fromYm}-01`, to: lastDayOf(toYm), fromYm, toYm, months };
}

/** Rango de comparación: el periodo anterior de la misma duración o el mismo del año anterior (`shift` en meses). */
export function compareRange(fromYm: string, toYm: string, kind: CompareKind): { fromYm: string; toYm: string; from: string; to: string; shift: number } | null {
  if (kind === "none") return null;
  const shift = kind === "year" ? -12 : -monthsBetween(fromYm, toYm).length;
  const f = addMonths(fromYm, shift);
  const t = addMonths(toYm, shift);
  return { fromYm: f, toYm: t, from: `${f}-01`, to: lastDayOf(t), shift };
}

/** Periodos de comparación con la misma forma que los actuales: cada periodo desplazado `shift` meses. */
export function shiftPeriods(periods: ReadonlyArray<Period>, shift: number, g: Granularity): Period[] {
  return periods.map((p) => {
    const months = p.months.map((m) => addMonths(m, shift));
    const first = months[0];
    const last = months[months.length - 1];
    const own = periodsOf(first, last, g);
    const whole = own.length === 1 && own[0].months.length === months.length;
    return { key: whole ? own[0].key : `${first}/${last}`, label: whole ? own[0].label : `${monthLabel(first)} – ${monthLabel(last)}`, from: `${first}-01`, to: lastDayOf(last), months };
  });
}

/** Variación porcentual con un decimal (null sin base). */
export function pctChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
/** Porcentaje con un decimal (null sin base). */
export function pctOf(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// ── Cuenta de pérdidas y ganancias (modelo abreviado del PGC de pymes) ───────────────────────────────────────────

export const PNL_LINES = [
  { key: "revenue", label: "1. Importe neto de la cifra de negocios" },
  { key: "inventoryChange", label: "2. Variación de existencias de productos terminados y en curso" },
  { key: "ownWork", label: "3. Trabajos realizados por la empresa para su activo" },
  { key: "supplies", label: "4. Aprovisionamientos" },
  { key: "otherOperatingIncome", label: "5. Otros ingresos de explotación" },
  { key: "personnel", label: "6. Gastos de personal" },
  { key: "otherOperatingExpenses", label: "7. Otros gastos de explotación" },
  { key: "depreciation", label: "8. Amortización del inmovilizado" },
  { key: "grants", label: "9. Imputación de subvenciones de inmovilizado no financiero y otras" },
  { key: "provisionsExcess", label: "10. Excesos de provisiones" },
  { key: "fixedAssetDisposals", label: "11. Deterioro y resultado por enajenaciones del inmovilizado" },
  { key: "otherResults", label: "12. Otros resultados" },
  { key: "financialIncome", label: "13. Ingresos financieros" },
  { key: "financialExpenses", label: "14. Gastos financieros" },
  { key: "fairValue", label: "15. Variación de valor razonable en instrumentos financieros" },
  { key: "exchangeDifferences", label: "16. Diferencias de cambio" },
  { key: "financialImpairment", label: "17. Deterioro y resultado por enajenaciones de instrumentos financieros" },
  { key: "incomeTax", label: "18. Impuestos sobre beneficios" },
] as const;
export type PnlLineKey = (typeof PNL_LINES)[number]["key"];

export const PNL_SUBTOTALS = [
  { key: "operatingResult", label: "A.1) RESULTADO DE EXPLOTACIÓN", lines: ["revenue", "inventoryChange", "ownWork", "supplies", "otherOperatingIncome", "personnel", "otherOperatingExpenses", "depreciation", "grants", "provisionsExcess", "fixedAssetDisposals", "otherResults"], after: "otherResults" },
  { key: "financialResult", label: "A.2) RESULTADO FINANCIERO", lines: ["financialIncome", "financialExpenses", "fairValue", "exchangeDifferences", "financialImpairment"], after: "financialImpairment" },
  { key: "preTaxResult", label: "A.3) RESULTADO ANTES DE IMPUESTOS (A.1 + A.2)", lines: [], after: "financialImpairment" },
  { key: "netResult", label: "A.4) RESULTADO DEL EJERCICIO (A.3 + 18)", lines: [], after: "incomeTax" },
] as const;

/** Partida de la cuenta de resultados por el prefijo más largo de la cuenta (PGC de pymes); grupos 6 y 7 siempre caen en una. */
const PNL_PREFIXES: Array<[string, PnlLineKey]> = [
  ["70", "revenue"],
  ["71", "inventoryChange"],
  ["6930", "inventoryChange"],
  ["7930", "inventoryChange"],
  ["73", "ownWork"],
  ["60", "supplies"],
  ["61", "supplies"],
  ["6931", "supplies"],
  ["6932", "supplies"],
  ["6933", "supplies"],
  ["7931", "supplies"],
  ["7932", "supplies"],
  ["7933", "supplies"],
  ["75", "otherOperatingIncome"],
  ["740", "otherOperatingIncome"],
  ["747", "otherOperatingIncome"],
  ["64", "personnel"],
  ["62", "otherOperatingExpenses"],
  ["631", "otherOperatingExpenses"],
  ["634", "otherOperatingExpenses"],
  ["636", "otherOperatingExpenses"],
  ["639", "otherOperatingExpenses"],
  ["65", "otherOperatingExpenses"],
  ["694", "otherOperatingExpenses"],
  ["695", "otherOperatingExpenses"],
  ["794", "otherOperatingExpenses"],
  ["7954", "otherOperatingExpenses"],
  ["68", "depreciation"],
  ["746", "grants"],
  ["7951", "provisionsExcess"],
  ["7952", "provisionsExcess"],
  ["7955", "provisionsExcess"],
  ["7956", "provisionsExcess"],
  ["670", "fixedAssetDisposals"],
  ["671", "fixedAssetDisposals"],
  ["672", "fixedAssetDisposals"],
  ["690", "fixedAssetDisposals"],
  ["691", "fixedAssetDisposals"],
  ["692", "fixedAssetDisposals"],
  ["770", "fixedAssetDisposals"],
  ["771", "fixedAssetDisposals"],
  ["772", "fixedAssetDisposals"],
  ["790", "fixedAssetDisposals"],
  ["791", "fixedAssetDisposals"],
  ["792", "fixedAssetDisposals"],
  ["678", "otherResults"],
  ["778", "otherResults"],
  ["76", "financialIncome"],
  ["66", "financialExpenses"],
  ["663", "fairValue"],
  ["763", "fairValue"],
  ["668", "exchangeDifferences"],
  ["768", "exchangeDifferences"],
  ["666", "financialImpairment"],
  ["667", "financialImpairment"],
  ["673", "financialImpairment"],
  ["675", "financialImpairment"],
  ["696", "financialImpairment"],
  ["697", "financialImpairment"],
  ["698", "financialImpairment"],
  ["699", "financialImpairment"],
  ["766", "financialImpairment"],
  ["773", "financialImpairment"],
  ["775", "financialImpairment"],
  ["796", "financialImpairment"],
  ["797", "financialImpairment"],
  ["798", "financialImpairment"],
  ["799", "financialImpairment"],
  ["630", "incomeTax"],
  ["633", "incomeTax"],
  ["638", "incomeTax"],
  ["6", "otherOperatingExpenses"],
  ["7", "otherOperatingIncome"],
];

const longestPrefix = <T>(code: string, table: ReadonlyArray<[string, T]>): T | null => {
  let best: [string, T] | null = null;
  for (const row of table) if (code.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  return best ? best[1] : null;
};

/** Partida de la cuenta de resultados de una cuenta (null si no es de los grupos 6 o 7). */
export function pnlLineOf(code: string): PnlLineKey | null {
  if (!/^[67]/.test(code)) return null;
  return longestPrefix(code, PNL_PREFIXES);
}

export interface PnlRow {
  key: string;
  label: string;
  kind: "line" | "subtotal";
  values: number[];
  totalCents: number;
  compareValues: number[] | null;
  compareTotalCents: number | null;
  variationCents: number | null;
  variationPct: number | null;
  accounts: Array<{ code: string; name: string; values: number[]; totalCents: number; compareTotalCents: number | null }>;
}

/** Importe por partida y periodo (haber − debe) de unos hechos del libro; índices = posición del periodo. */
function pnlMatrix(facts: ReadonlyArray<LedgerFact>, periods: ReadonlyArray<Period>) {
  const idx = new Map<string, number>();
  periods.forEach((p, i) => p.months.forEach((m) => idx.set(m, i)));
  const byLine = new Map<string, number[]>();
  const byAccount = new Map<string, number[]>();
  for (const f of facts) {
    const i = idx.get(f.month);
    const line = pnlLineOf(f.accountCode);
    if (i === undefined || !line) continue;
    const v = f.creditCents - f.debitCents;
    const l = byLine.get(line) ?? periods.map(() => 0);
    l[i] += v;
    byLine.set(line, l);
    const a = byAccount.get(f.accountCode) ?? periods.map(() => 0);
    a[i] += v;
    byAccount.set(f.accountCode, a);
  }
  return { byLine, byAccount };
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const addVec = (a: number[], b: readonly number[]) => a.map((x, i) => x + (b[i] ?? 0));

/**
 * Cuenta de resultados por periodos con las partidas del modelo abreviado, los subtotales A.1–A.4, el desglose por
 * cuenta de cada partida y, si se pide, la comparación periodo a periodo (mismo número de periodos).
 */
export function buildPnl(facts: ReadonlyArray<LedgerFact>, periods: ReadonlyArray<Period>, names: ReadonlyMap<string, string>, compare?: { facts: ReadonlyArray<LedgerFact>; periods: ReadonlyArray<Period> } | null): PnlRow[] {
  const cur = pnlMatrix(facts, periods);
  const cmp = compare ? pnlMatrix(compare.facts, compare.periods) : null;
  const zero = () => periods.map(() => 0);
  const row = (key: string, label: string, kind: PnlRow["kind"], values: number[], cvalues: number[] | null, accounts: PnlRow["accounts"]): PnlRow => {
    const total = sum(values);
    const ctotal = cvalues ? sum(cvalues) : null;
    return { key, label, kind, values, totalCents: total, compareValues: cvalues, compareTotalCents: ctotal, variationCents: ctotal === null ? null : total - ctotal, variationPct: pctChange(total, ctotal), accounts };
  };
  const lineValues = new Map<string, { v: number[]; c: number[] | null }>();
  const rows: PnlRow[] = [];
  const subtotal = (key: string): { v: number[]; c: number[] | null } => {
    const keys = key === "preTaxResult" ? ["operatingResult", "financialResult"] : key === "netResult" ? ["preTaxResult", "incomeTax"] : PNL_SUBTOTALS.find((s) => s.key === key)!.lines;
    let v = zero();
    let c: number[] | null = cmp ? zero() : null;
    for (const k of keys) {
      const x = lineValues.get(k)!;
      v = addVec(v, x.v);
      if (c && x.c) c = addVec(c, x.c);
    }
    return { v, c };
  };
  for (const l of PNL_LINES) {
    const v = cur.byLine.get(l.key) ?? zero();
    const c = cmp ? (cmp.byLine.get(l.key) ?? zero()) : null;
    lineValues.set(l.key, { v, c });
    const codes = new Set<string>([...Array.from(cur.byAccount.keys()), ...(cmp ? Array.from(cmp.byAccount.keys()) : [])].filter((code) => pnlLineOf(code) === l.key));
    const accounts = Array.from(codes)
      .sort()
      .map((code) => {
        const values = cur.byAccount.get(code) ?? zero();
        return { code, name: names.get(code) ?? "", values, totalCents: sum(values), compareTotalCents: cmp ? sum(cmp.byAccount.get(code) ?? []) : null };
      })
      .filter((a) => a.totalCents !== 0 || (a.compareTotalCents ?? 0) !== 0 || a.values.some((x) => x !== 0));
    rows.push(row(l.key, l.label, "line", v, c, accounts));
    for (const s of PNL_SUBTOTALS.filter((x) => x.after === l.key)) {
      const t = subtotal(s.key);
      lineValues.set(s.key, t);
      rows.push(row(s.key, s.label, "subtotal", t.v, t.c, []));
    }
  }
  return rows;
}

// ── Balance de situación (abreviado) ─────────────────────────────────────────────────────────────────────────────

type BalanceSection = "nonCurrentAssets" | "currentAssets" | "equity" | "nonCurrentLiabilities" | "currentLiabilities";

export const BALANCE_LINES: Array<{ key: string; section: BalanceSection; label: string }> = [
  { key: "intangible", section: "nonCurrentAssets", label: "I. Inmovilizado intangible" },
  { key: "tangible", section: "nonCurrentAssets", label: "II. Inmovilizado material" },
  { key: "realEstate", section: "nonCurrentAssets", label: "III. Inversiones inmobiliarias" },
  { key: "longTermInvestments", section: "nonCurrentAssets", label: "IV–V. Inversiones financieras a largo plazo" },
  { key: "deferredTaxAssets", section: "nonCurrentAssets", label: "VI. Activos por impuesto diferido" },
  { key: "inventories", section: "currentAssets", label: "I–II. Existencias" },
  { key: "receivables", section: "currentAssets", label: "III. Deudores comerciales y otras cuentas a cobrar" },
  { key: "shortTermInvestments", section: "currentAssets", label: "IV–V. Inversiones financieras a corto plazo" },
  { key: "prepayments", section: "currentAssets", label: "VI. Periodificaciones a corto plazo" },
  { key: "cash", section: "currentAssets", label: "VII. Efectivo y otros activos líquidos equivalentes" },
  { key: "capital", section: "equity", label: "A-1 I. Capital" },
  { key: "reserves", section: "equity", label: "A-1 II–III. Prima de emisión y reservas" },
  { key: "priorResults", section: "equity", label: "A-1 V. Resultados de ejercicios anteriores" },
  { key: "pendingResult", section: "equity", label: "A-1 VII. Resultado pendiente de aplicar (129)" },
  { key: "yearResult", section: "equity", label: "A-1 VII. Resultado del ejercicio en curso" },
  { key: "equityAdjustments", section: "equity", label: "A-2/A-3. Ajustes, subvenciones y otros (grupos 13, 8 y 9)" },
  { key: "longTermProvisions", section: "nonCurrentLiabilities", label: "I. Provisiones a largo plazo" },
  { key: "longTermDebt", section: "nonCurrentLiabilities", label: "II. Deudas a largo plazo" },
  { key: "deferredTaxLiabilities", section: "nonCurrentLiabilities", label: "IV. Pasivos por impuesto diferido" },
  { key: "shortTermProvisions", section: "currentLiabilities", label: "I. Provisiones a corto plazo" },
  { key: "shortTermDebt", section: "currentLiabilities", label: "II. Deudas a corto plazo" },
  { key: "payables", section: "currentLiabilities", label: "IV. Acreedores comerciales y otras cuentas a pagar" },
  { key: "accruals", section: "currentLiabilities", label: "V. Periodificaciones a corto plazo" },
];

/** Partidas de signo fijo (grupos 1, 2 y 3). */
const FIXED_BALANCE: Array<[string, string]> = [
  ["10", "capital"],
  ["11", "reserves"],
  ["12", "priorResults"],
  ["129", "pendingResult"],
  ["13", "equityAdjustments"],
  ["14", "longTermProvisions"],
  ["15", "longTermDebt"],
  ["16", "longTermDebt"],
  ["17", "longTermDebt"],
  ["18", "longTermDebt"],
  ["19", "equityAdjustments"],
  ["479", "deferredTaxLiabilities"],
  ["474", "deferredTaxAssets"],
  ["20", "intangible"],
  ["280", "intangible"],
  ["290", "intangible"],
  ["21", "tangible"],
  ["23", "tangible"],
  ["281", "tangible"],
  ["291", "tangible"],
  ["22", "realEstate"],
  ["282", "realEstate"],
  ["292", "realEstate"],
  ["24", "longTermInvestments"],
  ["25", "longTermInvestments"],
  ["26", "longTermInvestments"],
  ["293", "longTermInvestments"],
  ["294", "longTermInvestments"],
  ["295", "longTermInvestments"],
  ["296", "longTermInvestments"],
  ["297", "longTermInvestments"],
  ["298", "longTermInvestments"],
  ["3", "inventories"],
  ["8", "equityAdjustments"],
  ["9", "equityAdjustments"],
];
/** Grupos 4 y 5: la partida depende del signo del saldo (deudor → activo, acreedor → pasivo). */
const SIGNED_BALANCE: Array<[string, { debit: string; credit: string }]> = [
  ["4", { debit: "receivables", credit: "payables" }],
  ["480", { debit: "prepayments", credit: "accruals" }],
  ["485", { debit: "prepayments", credit: "accruals" }],
  ["499", { debit: "receivables", credit: "shortTermProvisions" }],
  ["5", { debit: "shortTermInvestments", credit: "shortTermDebt" }],
  ["529", { debit: "shortTermInvestments", credit: "shortTermProvisions" }],
  ["567", { debit: "prepayments", credit: "accruals" }],
  ["568", { debit: "prepayments", credit: "accruals" }],
  ["57", { debit: "cash", credit: "shortTermDebt" }],
];

/** Partida del balance de una cuenta con su saldo (debe − haber); null para los grupos 6 y 7 (van al resultado). */
export function balanceLineOf(code: string, balanceCents: number): string | null {
  if (/^[67]/.test(code)) return null;
  const fixed = longestPrefix(code, FIXED_BALANCE);
  const signed = longestPrefix(code, SIGNED_BALANCE);
  // El prefijo más largo de las dos tablas decide (474 y 479 son de signo fijo dentro del grupo 4)
  const fixedLen = FIXED_BALANCE.filter(([p]) => code.startsWith(p)).reduce((a, [p]) => Math.max(a, p.length), 0);
  const signedLen = SIGNED_BALANCE.filter(([p]) => code.startsWith(p)).reduce((a, [p]) => Math.max(a, p.length), 0);
  if (signed && signedLen > fixedLen) return balanceCents < 0 ? signed.credit : signed.debit;
  return fixed ?? "receivables";
}

const SECTION_SIGN: Record<BalanceSection, 1 | -1> = { nonCurrentAssets: 1, currentAssets: 1, equity: -1, nonCurrentLiabilities: -1, currentLiabilities: -1 };

export interface BalanceLine {
  key: string;
  label: string;
  amountCents: number;
  accounts: Array<{ code: string; name: string; amountCents: number }>;
}
export interface BalanceBlock {
  totalCents: number;
  lines: BalanceLine[];
}

/**
 * Balance abreviado a una fecha a partir de los saldos por cuenta (sin asientos de cierre ni apertura, que se anulan
 * entre sí). `currentYear` son los saldos de los grupos 6 y 7 del ejercicio en curso (resultado del ejercicio); el resto
 * de saldos de los grupos 6 y 7 (ejercicios anteriores sin regularizar) se suma al resultado pendiente de aplicar. El
 * cuadre (activo = patrimonio neto + pasivo) se muestra siempre: si no cuadra, el libro tiene un problema.
 */
export function buildBalance(balances: ReadonlyMap<string, number>, currentYear: ReadonlyMap<string, number>, names: ReadonlyMap<string, string>) {
  const lines = new Map<string, BalanceLine>(BALANCE_LINES.map((l) => [l.key, { key: l.key, label: l.label, amountCents: 0, accounts: [] }]));
  const sectionOf = new Map(BALANCE_LINES.map((l) => [l.key, l.section]));
  let yearResult = 0;
  let olderResult = 0;
  for (const [code, bal] of Array.from(balances.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (bal === 0) continue;
    if (/^[67]/.test(code)) {
      const inYear = currentYear.get(code) ?? 0;
      yearResult -= inYear;
      olderResult -= bal - inYear;
      continue;
    }
    const key = balanceLineOf(code, bal)!;
    const amount = SECTION_SIGN[sectionOf.get(key)!] * bal;
    const l = lines.get(key)!;
    l.amountCents += amount;
    l.accounts.push({ code, name: names.get(code) ?? "", amountCents: amount });
  }
  lines.get("yearResult")!.amountCents = yearResult;
  if (olderResult !== 0) {
    const p = lines.get("pendingResult")!;
    p.amountCents += olderResult;
    p.accounts.push({ code: "6/7", name: "Ingresos y gastos de ejercicios anteriores sin regularizar", amountCents: olderResult });
  }
  const block = (section: BalanceSection): BalanceBlock => {
    const ls = BALANCE_LINES.filter((l) => l.section === section).map((l) => lines.get(l.key)!);
    return { totalCents: sum(ls.map((l) => l.amountCents)), lines: ls };
  };
  const nonCurrentAssets = block("nonCurrentAssets");
  const currentAssets = block("currentAssets");
  const equity = block("equity");
  const nonCurrentLiabilities = block("nonCurrentLiabilities");
  const currentLiabilities = block("currentLiabilities");
  const assetsCents = nonCurrentAssets.totalCents + currentAssets.totalCents;
  const equityAndLiabilitiesCents = equity.totalCents + nonCurrentLiabilities.totalCents + currentLiabilities.totalCents;
  return {
    assets: { nonCurrent: nonCurrentAssets, current: currentAssets, totalCents: assetsCents },
    equityAndLiabilities: { equity, nonCurrent: nonCurrentLiabilities, current: currentLiabilities, totalCents: equityAndLiabilitiesCents },
    check: { assetsCents, equityAndLiabilitiesCents, differenceCents: assetsCents - equityAndLiabilitiesCents, balanced: assetsCents === equityAndLiabilitiesCents },
    result: { currentYearCents: yearResult, pendingCents: lines.get("pendingResult")!.amountCents },
  };
}

/** Saldos (debe − haber) por cuenta de unos hechos del libro. */
export function balancesOfFacts(facts: ReadonlyArray<Pick<LedgerFact, "accountCode" | "debitCents" | "creditCents">>): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of facts) m.set(f.accountCode, (m.get(f.accountCode) ?? 0) + f.debitCents - f.creditCents);
  return m;
}

// ── Tesorería ────────────────────────────────────────────────────────────────────────────────────────────────────

export const TREASURY_PREFIX = "57";
export const STRIPE_ACCOUNT = "5720";
export const FLOW_NATURES = [
  { key: "customers", label: "Cobros de clientes" },
  { key: "suppliers", label: "Pagos a proveedores" },
  { key: "taxes", label: "Impuestos" },
  { key: "payroll", label: "Nóminas y Seguridad Social" },
  { key: "other", label: "Otros" },
] as const;
export type FlowNature = (typeof FLOW_NATURES)[number]["key"];

/** Naturaleza de un flujo de tesorería según la cuenta de la contrapartida. */
export function flowNatureOf(code: string): FlowNature {
  const table: Array<[string, FlowNature]> = [
    ["43", "customers"],
    ["44", "customers"],
    ["438", "customers"],
    ["70", "customers"],
    ["40", "suppliers"],
    ["41", "suppliers"],
    ["407", "suppliers"],
    ["47", "taxes"],
    ["63", "taxes"],
    ["476", "payroll"],
    ["465", "payroll"],
    ["64", "payroll"],
  ];
  return longestPrefix(code, table) ?? "other";
}

export const treasuryKindOf = (code: string): "stripe" | "bank" | "cash" | "other" => (code === STRIPE_ACCOUNT ? "stripe" : code.startsWith("572") ? "bank" : code.startsWith("570") ? "cash" : "other");

/**
 * Tesorería real de un rango: por cuenta (saldo inicial, entradas, salidas, saldo final; los traspasos entre cuentas de
 * tesorería se cuentan en la cuenta y aparte como `internal…`), por mes y por naturaleza de la contrapartida (cobros de
 * clientes, pagos a proveedores, impuestos, nóminas, otros). Entradas por naturaleza = haber de la contrapartida;
 * salidas = su debe: su diferencia es la variación neta de la tesorería sin traspasos.
 */
export function buildCashflow(i: { opening: ReadonlyMap<string, number>; treasury: ReadonlyArray<TreasuryFact>; counterparts: ReadonlyArray<Pick<LedgerFact, "month" | "accountCode" | "debitCents" | "creditCents">>; months: string[]; names: ReadonlyMap<string, string> }) {
  const codes = new Set<string>([...Array.from(i.opening.keys()), ...i.treasury.map((t) => t.accountCode)]);
  const accounts = Array.from(codes)
    .sort()
    .map((code) => {
      const rows = i.treasury.filter((t) => t.accountCode === code);
      const inCents = sum(rows.map((r) => r.debitCents));
      const outCents = sum(rows.map((r) => r.creditCents));
      const openingCents = i.opening.get(code) ?? 0;
      return { code, name: i.names.get(code) ?? "", kind: treasuryKindOf(code), openingCents, inCents, outCents, internalInCents: sum(rows.filter((r) => r.internal).map((r) => r.debitCents)), internalOutCents: sum(rows.filter((r) => r.internal).map((r) => r.creditCents)), closingCents: openingCents + inCents - outCents };
    })
    .filter((a) => a.openingCents !== 0 || a.inCents !== 0 || a.outCents !== 0);
  const emptyNature = () => Object.fromEntries(FLOW_NATURES.map((n) => [n.key, { inCents: 0, outCents: 0 }])) as Record<FlowNature, { inCents: number; outCents: number }>;
  const monthRows = i.months.map((month) => ({ month, inCents: 0, outCents: 0, netCents: 0, internalCents: 0, byNature: emptyNature() }));
  const mi = new Map(i.months.map((m, n) => [m, n]));
  const totalsByNature = emptyNature();
  for (const c of i.counterparts) {
    const nature = flowNatureOf(c.accountCode);
    const row = monthRows[mi.get(c.month) ?? -1];
    totalsByNature[nature].inCents += c.creditCents;
    totalsByNature[nature].outCents += c.debitCents;
    if (!row) continue;
    row.byNature[nature].inCents += c.creditCents;
    row.byNature[nature].outCents += c.debitCents;
    row.inCents += c.creditCents;
    row.outCents += c.debitCents;
  }
  for (const t of i.treasury.filter((x) => x.internal)) {
    const row = monthRows[mi.get(t.month) ?? -1];
    if (row) row.internalCents += t.debitCents;
  }
  for (const r of monthRows) r.netCents = r.inCents - r.outCents;
  const totals = {
    openingCents: sum(accounts.map((a) => a.openingCents)),
    inCents: sum(monthRows.map((r) => r.inCents)),
    outCents: sum(monthRows.map((r) => r.outCents)),
    internalTransfersCents: sum(monthRows.map((r) => r.internalCents)),
    closingCents: sum(accounts.map((a) => a.closingCents)),
  };
  return {
    accounts,
    totals: { ...totals, netCents: totals.inCents - totals.outCents },
    months: monthRows,
    byNature: FLOW_NATURES.map((n) => ({ key: n.key, label: n.label, inCents: totalsByNature[n.key].inCents, outCents: totalsByNature[n.key].outCents, netCents: totalsByNature[n.key].inCents - totalsByNature[n.key].outCents })),
  };
}

// ── Previsión de tesorería ───────────────────────────────────────────────────────────────────────────────────────

export const FORECAST_HORIZONS = [30, 60, 90] as const;
/** Días de cobro supuestos de una factura propia (no tiene vencimiento propio): se espera cobrarla a 30 días de su fecha. */
export const RECEIVABLE_TERMS_DAYS = 30;

export interface ForecastItem {
  date: string;
  kind: "receivable" | "payable" | "tax";
  reference: string;
  description: string;
  /** Con signo: positivo entra, negativo sale; null = obligación sin importe calculado (no suma). */
  amountCents: number | null;
  overdue: boolean;
  sourceId: number;
}

/**
 * Previsión a 30/60/90 días (marcada como previsión): parte del saldo actual de tesorería y suma los cobros pendientes
 * de facturas (a su fecha esperada: fecha + 30 días), los pagos pendientes de gastos (a su vencimiento; los vencidos,
 * mañana) y las obligaciones fiscales con borrador «a ingresar» (a su vencimiento). Prudencia: los cobros ya vencidos
 * NO se proyectan (se informan aparte) y una obligación sin calcular se lista sin importe.
 */
export function buildForecast(i: {
  today: string;
  horizonDays: number;
  startingBalanceCents: number;
  receivables: ReadonlyArray<{ id: number; number: string | null; customerName: string | null; date: string; pendingCents: number }>;
  payables: ReadonlyArray<PayableDoc>;
  taxes: ReadonlyArray<{ id: number; model: string; period: string; year: number; dueDate: string; amountCents: number | null; outcome: string | null; status: string }>;
}) {
  const tomorrow = addDays(i.today, 1);
  const until = addDays(i.today, i.horizonDays);
  const items: ForecastItem[] = [];
  let overdueReceivablesCents = 0;
  let overdueReceivablesCount = 0;
  for (const r of i.receivables) {
    if (r.pendingCents <= 0) continue;
    const expected = addDays(r.date, RECEIVABLE_TERMS_DAYS);
    if (expected < tomorrow) {
      overdueReceivablesCents += r.pendingCents;
      overdueReceivablesCount++;
      continue;
    }
    if (expected <= until) items.push({ date: expected, kind: "receivable", reference: r.number ?? `#${r.id}`, description: `Cobro previsto${r.customerName ? ` · ${r.customerName}` : ""}`, amountCents: r.pendingCents, overdue: false, sourceId: r.id });
  }
  for (const p of i.payables) {
    if (p.pendingCents === 0) continue;
    const due = p.dueDate ?? p.invoiceDate;
    const overdue = due < tomorrow;
    const date = overdue ? tomorrow : due;
    if (date <= until) items.push({ date, kind: "payable", reference: p.invoiceNumber ?? `#${p.id}`, description: `Pago${p.supplierName ? ` a ${p.supplierName}` : ""}${overdue ? " (vencido)" : ""}`, amountCents: -p.pendingCents, overdue, sourceId: p.id });
  }
  let uncalculatedTaxes = 0;
  for (const t of i.taxes) {
    if (t.dueDate < tomorrow || t.dueDate > until) continue;
    const payable = t.outcome === "a_ingresar" && t.amountCents !== null && t.amountCents > 0;
    const unknown = t.amountCents === null || t.outcome === null;
    if (unknown) uncalculatedTaxes++;
    if (!payable && !unknown) continue;
    items.push({ date: t.dueDate, kind: "tax", reference: `${t.model} ${t.period} ${t.year}`, description: `Modelo ${t.model} (${t.period} ${t.year})${unknown ? ": importe sin calcular" : ""}`, amountCents: payable ? -t.amountCents! : null, overdue: false, sourceId: t.id });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.sourceId - b.sourceId);
  const buckets = FORECAST_HORIZONS.filter((d) => d <= i.horizonDays).map((days) => {
    const to = addDays(i.today, days);
    const within = items.filter((x) => x.date <= to && x.amountCents !== null);
    const inflowsCents = sum(within.filter((x) => x.amountCents! > 0).map((x) => x.amountCents!));
    const outflowsCents = -sum(within.filter((x) => x.amountCents! < 0).map((x) => x.amountCents!)) || 0;
    return { days, until: to, inflowsCents, outflowsCents, netCents: inflowsCents - outflowsCents, projectedBalanceCents: i.startingBalanceCents + inflowsCents - outflowsCents };
  });
  return {
    isForecast: true as const,
    label: "Previsión (no es un dato contable)",
    asOf: i.today,
    horizonDays: i.horizonDays,
    startingBalanceCents: i.startingBalanceCents,
    buckets,
    items: items.slice(0, 500),
    itemsTruncated: items.length > 500,
    excluded: { overdueReceivablesCents, overdueReceivablesCount, uncalculatedTaxes },
    assumptions: [
      "Saldo de partida: tesorería del libro hoy (bancos, caja y saldo pendiente en Stripe).",
      `Cobros: facturas propias pendientes a ${RECEIVABLE_TERMS_DAYS} días de su fecha; las ya vencidas no se proyectan (se muestran aparte).`,
      "Pagos: gastos registrados pendientes a su vencimiento (sin vencimiento, a la fecha de la factura); los vencidos, mañana.",
      "Impuestos: obligaciones con borrador «a ingresar» a su vencimiento; sin borrador calculado se listan sin importe.",
    ],
  };
}

// ── Antigüedad de saldos ─────────────────────────────────────────────────────────────────────────────────────────

export const AGING_BUCKETS = [
  { key: "current", label: "No vencido" },
  { key: "d0_30", label: "0–30 días" },
  { key: "d31_60", label: "31–60 días" },
  { key: "d61_90", label: "61–90 días" },
  { key: "d90_plus", label: "Más de 90 días" },
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number]["key"];

/** Tramo por días desde la fecha de referencia (vencimiento o, sin él, fecha del documento). */
export function agingBucketOf(asOf: string, baseDate: string, hasDueDate: boolean): { bucket: AgingBucket; days: number } {
  const days = daysBetween(baseDate, asOf);
  if (hasDueDate && days < 0) return { bucket: "current", days };
  const d = Math.max(0, days);
  return { bucket: d <= 30 ? "d0_30" : d <= 60 ? "d31_60" : d <= 90 ? "d61_90" : "d90_plus", days: d };
}

export interface AgingDoc {
  id: number;
  number: string | null;
  partyKey: string;
  partyId: number | null;
  partyName: string;
  date: string;
  dueDate: string | null;
  totalCents: number;
  pendingCents: number;
}

const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucket, number>;

/** Antigüedad por tercero y tramo (solo documentos con pendiente distinto de cero). */
export function buildAging(asOf: string, docs: ReadonlyArray<AgingDoc>) {
  const parties = new Map<string, { key: string; partyId: number | null; name: string; totalCents: number; count: number; buckets: Record<AgingBucket, number>; documents: Array<AgingDoc & { daysOverdue: number; bucket: AgingBucket }> }>();
  const totals = emptyBuckets();
  let total = 0;
  let count = 0;
  for (const d of docs) {
    if (d.pendingCents === 0) continue;
    const a = agingBucketOf(asOf, d.dueDate ?? d.date, d.dueDate !== null);
    const p = parties.get(d.partyKey) ?? { key: d.partyKey, partyId: d.partyId, name: d.partyName, totalCents: 0, count: 0, buckets: emptyBuckets(), documents: [] };
    p.totalCents += d.pendingCents;
    p.count++;
    p.buckets[a.bucket] += d.pendingCents;
    p.documents.push({ ...d, daysOverdue: a.days, bucket: a.bucket });
    parties.set(d.partyKey, p);
    totals[a.bucket] += d.pendingCents;
    total += d.pendingCents;
    count++;
  }
  const list = Array.from(parties.values())
    .map((p) => ({ ...p, documents: p.documents.sort((a, b) => b.daysOverdue - a.daysOverdue || a.id - b.id) }))
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "es"));
  return { buckets: AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label })), totals: { ...totals, totalCents: total, count }, parties: list };
}

// ── Gastos agrupados ─────────────────────────────────────────────────────────────────────────────────────────────

export const EXPENSE_GROUPS = ["category", "costCenter", "supplier"] as const;
export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number];

/**
 * Gastos (grupo 6 del libro, debe − haber) agrupados por categoría (las líneas que no vienen de un gasto, por su
 * cuenta), centro de coste o proveedor, por mes y con comparación.
 */
export function buildExpenseGroups(i: { facts: ReadonlyArray<LedgerFact>; compareFacts: ReadonlyArray<LedgerFact> | null; months: string[]; groupBy: ExpenseGroup; nameOf: (key: string) => { id: number | null; name: string; accountCode: string | null } }) {
  const keyOf = (f: LedgerFact) => (i.groupBy === "category" ? (f.categoryId !== null ? `category:${f.categoryId}` : `account:${f.accountCode}`) : i.groupBy === "costCenter" ? (f.costCenterId !== null ? `costCenter:${f.costCenterId}` : "costCenter:none") : f.supplierId !== null ? `supplier:${f.supplierId}` : "supplier:none");
  const mi = new Map(i.months.map((m, n) => [m, n]));
  const cur = new Map<string, number[]>();
  const cmp = new Map<string, number>();
  for (const f of i.facts) {
    if (!f.accountCode.startsWith("6")) continue;
    const n = mi.get(f.month);
    if (n === undefined) continue;
    const k = keyOf(f);
    const v = cur.get(k) ?? i.months.map(() => 0);
    v[n] += f.debitCents - f.creditCents;
    cur.set(k, v);
  }
  for (const f of i.compareFacts ?? []) {
    if (!f.accountCode.startsWith("6")) continue;
    const k = keyOf(f);
    cmp.set(k, (cmp.get(k) ?? 0) + f.debitCents - f.creditCents);
  }
  const keys = new Set<string>([...Array.from(cur.keys()), ...Array.from(cmp.keys())]);
  const items = Array.from(keys)
    .map((key) => {
      const values = cur.get(key) ?? i.months.map(() => 0);
      const totalCents = sum(values);
      const compareCents = i.compareFacts ? (cmp.get(key) ?? 0) : null;
      return { key, ...i.nameOf(key), values, totalCents, compareCents, variationCents: compareCents === null ? null : totalCents - compareCents, variationPct: pctChange(totalCents, compareCents) };
    })
    .filter((x) => x.totalCents !== 0 || (x.compareCents ?? 0) !== 0 || x.values.some((v) => v !== 0))
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "es"));
  const values = i.months.map((_, n) => sum(items.map((x) => x.values[n])));
  const totalCents = sum(values);
  const compareCents = i.compareFacts ? sum(items.map((x) => x.compareCents ?? 0)) : null;
  return { items, totals: { values, totalCents, compareCents, variationCents: compareCents === null ? null : totalCents - compareCents, variationPct: pctChange(totalCents, compareCents) } };
}

// ── Coste directo ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Marca de coste directo de una categoría: la fijada por el operador o, si es NULL («según cuenta»), solo la sugerencia
 * por nombre (hosting o infraestructura). CRM 0039: la cuenta 626 ya NO lo marca por sí sola: una comisión bancaria es
 * coste directo, estructura o gasto financiero según su naturaleza, y lo decide el operador categoría a categoría (las
 * comisiones de Stripe van según `stripe_fees_treatment` de /analysis/settings).
 */
export function resolveDirectCost(c: { name: string; accountCode: string; isDirectCost: boolean | null }): boolean {
  if (c.isDirectCost !== null) return c.isDirectCost;
  return /hosting|infraestructura/i.test(c.name);
}

// ── Revenue & Margin ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RevenueMarginMonth {
  month: string;
  label: string;
  /** Ingresos devengados: cifra de negocios (70x) del libro, haber − debe. */
  accruedRevenueCents: number;
  /** Cobrado: cobros de Stripe netos de reembolsos (bruto) + transferencias conciliadas. */
  collectedCents: number;
  stripeFeesCents: number;
  stripeFeesPct: number | null;
  directCostsCents: number;
  /** CRM 0039: gastos financieros del análisis (66x y, con `financial`, las comisiones de Stripe), fuera del margen. */
  financialCostsCents: number;
  grossMarginCents: number;
  grossMarginPct: number | null;
  structureCostsCents: number;
  otherIncomeCents: number;
  resultCents: number;
}

/**
 * Revenue & Margin por mes desde el libro: margen bruto = devengado − comisiones de Stripe (626 de origen stripe, con
 * `direct_cost`) − costes directos (líneas de gasto de categorías de coste directo); gastos financieros = 66x (y las
 * comisiones de Stripe con `financial`); estructura = resto del grupo 6 (y las comisiones con `structure`); resultado =
 * devengado + otros ingresos (resto del grupo 7) − todo el grupo 6 (sin regularización ni cierre).
 */
export function buildRevenueMargin(i: { facts: ReadonlyArray<LedgerFact>; months: string[]; directCategories: ReadonlySet<number>; stripe: ReadonlyArray<StripeMonthFact> | null; transfers: ReadonlyArray<TransferMonthFact> | null; stripeFeesTreatment?: StripeFeesTreatment }) {
  const treatment = i.stripeFeesTreatment ?? "direct_cost";
  const rows: RevenueMarginMonth[] = i.months.map((month) => ({ month, label: monthLabel(month), accruedRevenueCents: 0, collectedCents: 0, stripeFeesCents: 0, stripeFeesPct: null, directCostsCents: 0, financialCostsCents: 0, grossMarginCents: 0, grossMarginPct: null, structureCostsCents: 0, otherIncomeCents: 0, resultCents: 0 }));
  const mi = new Map(i.months.map((m, n) => [m, n]));
  const expenses = i.months.map(() => 0);
  for (const f of i.facts) {
    const n = mi.get(f.month);
    if (n === undefined) continue;
    const r = rows[n];
    if (f.accountCode.startsWith("70")) r.accruedRevenueCents += f.creditCents - f.debitCents;
    else if (f.accountCode.startsWith("7")) r.otherIncomeCents += f.creditCents - f.debitCents;
    else if (f.accountCode.startsWith("6")) {
      const v = f.debitCents - f.creditCents;
      expenses[n] += v;
      if (f.accountCode.startsWith("626") && f.origin === "stripe") r.stripeFeesCents += v;
      else if (f.accountCode.startsWith("66")) r.financialCostsCents += v;
      else if (f.categoryId !== null && i.directCategories.has(f.categoryId)) r.directCostsCents += v;
    }
  }
  const collectedAvailable = i.stripe !== null || i.transfers !== null;
  for (const s of i.stripe ?? []) {
    const n = mi.get(s.month);
    if (n !== undefined && (s.type === "charge" || s.type === "refund" || s.type === "refund_failure")) rows[n].collectedCents += s.grossCents;
  }
  for (const t of i.transfers ?? []) {
    const n = mi.get(t.month);
    if (n !== undefined) rows[n].collectedCents += t.amountCents;
  }
  rows.forEach((r, n) => {
    r.stripeFeesPct = pctOf(r.stripeFeesCents, r.collectedCents);
    // Las comisiones de Stripe: en el margen (coste del cobro), en estructura o en el resultado financiero del análisis
    const feesInMargin = treatment === "direct_cost" ? r.stripeFeesCents : 0;
    if (treatment === "financial") r.financialCostsCents += r.stripeFeesCents;
    r.grossMarginCents = r.accruedRevenueCents - feesInMargin - r.directCostsCents;
    r.grossMarginPct = pctOf(r.grossMarginCents, r.accruedRevenueCents);
    r.structureCostsCents = expenses[n] - feesInMargin - r.directCostsCents - r.financialCostsCents;
    r.resultCents = r.accruedRevenueCents + r.otherIncomeCents - expenses[n];
  });
  const total = (k: keyof RevenueMarginMonth) => sum(rows.map((r) => r[k] as number));
  const accrued = total("accruedRevenueCents");
  const collected = total("collectedCents");
  const fees = total("stripeFeesCents");
  const gross = total("grossMarginCents");
  return {
    months: rows.map((r) => ({ ...r, collectedCents: collectedAvailable ? r.collectedCents : null, stripeFeesPct: collectedAvailable ? r.stripeFeesPct : null })),
    totals: {
      accruedRevenueCents: accrued,
      collectedCents: collectedAvailable ? collected : null,
      stripeFeesCents: fees,
      stripeFeesPct: collectedAvailable ? pctOf(fees, collected) : null,
      directCostsCents: total("directCostsCents"),
      financialCostsCents: total("financialCostsCents"),
      grossMarginCents: gross,
      grossMarginPct: pctOf(gross, accrued),
      structureCostsCents: total("structureCostsCents"),
      otherIncomeCents: total("otherIncomeCents"),
      resultCents: total("resultCents"),
    },
  };
}

// ── Conversion Health ────────────────────────────────────────────────────────────────────────────────────────────

/** Factura con su cadena de conciliación (fase 2): lo que necesitan las métricas de conversión. */
export interface ConversionInvoice {
  invoiceId: number;
  issueDate: string;
  totalCents: number;
  collectedCents: number;
  status: string;
  dates: { invoiceDate: string | null; chargeDate: string | null; availableOn: string | null; payoutDate: string | null; bankDate: string | null };
}

/** Días de cobro a partir de los cuales una factura pendiente cuenta como vencida (no tiene vencimiento propio). */
export const RECEIVABLE_OVERDUE_DAYS = 30;

const avgDays = (pairs: Array<[string | null, string | null]>) => {
  const ds = pairs.filter((p): p is [string, string] => !!p[0] && !!p[1]).map(([a, b]) => daysBetween(a, b));
  return ds.length ? Math.round((sum(ds) / ds.length) * 10) / 10 : null;
};

/**
 * Salud de la conversión facturado → cobrado → liquidado → en banco por mes de la factura (porcentajes sobre el importe
 * facturado), plazos medios (DSO factura→cobro, cobro→disponible, payout→banco) y, por mes de la transacción, reembolsos y
 * disputas sobre lo cobrado, cobros sin factura y tasa de pagos fallidos del registro comercial.
 */
export function buildConversion(i: { months: string[]; asOf: string; invoices: ReadonlyArray<ConversionInvoice> | null; stripe: ReadonlyArray<StripeMonthFact> | null; payments: ReadonlyArray<{ month: string; failed: number; succeeded: number }> | null }) {
  const SETTLED = new Set(["liquidada", "en_banco"]);
  const rowFor = (month: string, inv: ReadonlyArray<ConversionInvoice> | null) => {
    const list = inv?.filter((x) => ymOf(x.issueDate) === month) ?? null;
    const billed = list ? sum(list.map((x) => x.totalCents)) : 0;
    const collected = list ? sum(list.map((x) => Math.min(Math.max(x.collectedCents, 0), x.totalCents))) : 0;
    const st = i.stripe?.filter((s) => s.month === month) ?? null;
    const by = (t: string) => sum((st ?? []).filter((s) => s.type === t).map((s) => s.grossCents));
    const charges = by("charge");
    const refunds = -(by("refund") + by("refund_failure")) || 0;
    const disputes = -(by("dispute") + by("dispute_reversal")) || 0;
    const noInvoice = (st ?? []).filter((s) => s.type === "charge" && s.noInvoice);
    const pay = i.payments?.find((p) => p.month === month) ?? null;
    return {
      month,
      label: monthLabel(month),
      invoices: list ? { count: list.length, amountCents: billed } : null,
      collectedPct: list ? pctOf(collected, billed) : null,
      settledPct: list ? pctOf(sum(list.filter((x) => SETTLED.has(x.status)).map((x) => x.totalCents)), billed) : null,
      inBankPct: list ? pctOf(sum(list.filter((x) => x.status === "en_banco").map((x) => x.totalCents)), billed) : null,
      dsoDays: list ? avgDays(list.map((x) => [x.dates.invoiceDate ?? x.issueDate, x.dates.chargeDate])) : null,
      chargeToAvailableDays: list ? avgDays(list.map((x) => [x.dates.chargeDate, x.dates.availableOn])) : null,
      payoutToBankDays: list ? avgDays(list.map((x) => [x.dates.payoutDate, x.dates.bankDate])) : null,
      stripe: st ? { chargesCents: charges, refundsCents: refunds, refundsPct: pctOf(refunds, charges), disputesCents: disputes, disputesPct: pctOf(disputes, charges), chargesWithoutInvoice: { count: sum(noInvoice.map((s) => s.count)), amountCents: sum(noInvoice.map((s) => s.grossCents)) } } : null,
      failedPayments: i.payments ? { failed: pay?.failed ?? 0, succeeded: pay?.succeeded ?? 0, ratePct: pctOf(pay?.failed ?? 0, (pay?.failed ?? 0) + (pay?.succeeded ?? 0)) } : null,
    };
  };
  const months = i.months.map((m) => rowFor(m, i.invoices));
  const all = i.invoices;
  const billed = all ? sum(all.map((x) => x.totalCents)) : 0;
  const overdue = all?.filter((x) => x.status === "pendiente_cobro" && daysBetween(x.dates.invoiceDate ?? x.issueDate, i.asOf) > RECEIVABLE_OVERDUE_DAYS) ?? null;
  const st = i.stripe;
  const by = (t: string) => sum((st ?? []).filter((s) => s.type === t).map((s) => s.grossCents));
  const charges = by("charge");
  const refunds = -(by("refund") + by("refund_failure")) || 0;
  const disputes = -(by("dispute") + by("dispute_reversal")) || 0;
  const noInvoice = (st ?? []).filter((s) => s.type === "charge" && s.noInvoice);
  const failed = i.payments ? sum(i.payments.map((p) => p.failed)) : 0;
  const succeeded = i.payments ? sum(i.payments.map((p) => p.succeeded)) : 0;
  return {
    months,
    totals: {
      invoices: all ? { count: all.length, amountCents: billed } : null,
      collectedPct: all ? pctOf(sum(all.map((x) => Math.min(Math.max(x.collectedCents, 0), x.totalCents))), billed) : null,
      settledPct: all ? pctOf(sum(all.filter((x) => SETTLED.has(x.status)).map((x) => x.totalCents)), billed) : null,
      inBankPct: all ? pctOf(sum(all.filter((x) => x.status === "en_banco").map((x) => x.totalCents)), billed) : null,
      dsoDays: all ? avgDays(all.map((x) => [x.dates.invoiceDate ?? x.issueDate, x.dates.chargeDate])) : null,
      chargeToAvailableDays: all ? avgDays(all.map((x) => [x.dates.chargeDate, x.dates.availableOn])) : null,
      payoutToBankDays: all ? avgDays(all.map((x) => [x.dates.payoutDate, x.dates.bankDate])) : null,
      stripe: st ? { chargesCents: charges, refundsCents: refunds, refundsPct: pctOf(refunds, charges), disputesCents: disputes, disputesPct: pctOf(disputes, charges), chargesWithoutInvoice: { count: sum(noInvoice.map((s) => s.count)), amountCents: sum(noInvoice.map((s) => s.grossCents)) } } : null,
      failedPayments: i.payments ? { failed, succeeded, ratePct: pctOf(failed, failed + succeeded) } : null,
      overdueUnpaid: overdue ? { count: overdue.length, amountCents: sum(overdue.map((x) => x.totalCents - Math.max(x.collectedCents, 0))), days: RECEIVABLE_OVERDUE_DAYS } : null,
    },
  };
}

// ── Control diario ───────────────────────────────────────────────────────────────────────────────────────────────

export interface DailyAlert {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  count: number;
}

/** Avisos del control diario a partir de los recuentos (los null no avisan). */
export function dailyAlerts(c: Partial<Record<keyof DailyCounts, number | null>>): DailyAlert[] {
  const out: DailyAlert[] = [];
  const add = (code: string, severity: DailyAlert["severity"], n: number | null | undefined, msg: (n: number) => string) => {
    if (n) out.push({ code, severity, message: msg(n), count: n });
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  add("payments_overdue", "critical", c.paymentsOverdue, (n) => `${plural(n, "pago a proveedor vencido", "pagos a proveedores vencidos")} sin pagar`);
  add("tax_overdue", "critical", c.taxOverdue, (n) => `${plural(n, "obligación fiscal vencida", "obligaciones fiscales vencidas")} sin presentar`);
  add("receivables_overdue", "warning", c.receivablesOverdue, (n) => `${plural(n, "factura", "facturas")} pendiente${n === 1 ? "" : "s"} de cobro con más de ${RECEIVABLE_OVERDUE_DAYS} días`);
  add("bank_pending", "warning", c.bankPending, (n) => `${plural(n, "movimiento bancario", "movimientos bancarios")} sin conciliar`);
  add("stripe_issues", "warning", c.stripeIssuesOpen, (n) => `${plural(n, "incidencia de Stripe", "incidencias de Stripe")} sin revisar`);
  add("payouts_without_bank", "warning", c.payoutsWithoutBank, (n) => `${plural(n, "payout contabilizado", "payouts contabilizados")} sin su movimiento bancario`);
  add("payments_due_today", "warning", c.paymentsDueToday, (n) => `${plural(n, "pago vence", "pagos vencen")} hoy`);
  add("tax_due_soon", "info", c.taxDueNext15, (n) => `${plural(n, "obligación fiscal vence", "obligaciones fiscales vencen")} en los próximos 15 días`);
  add("draft_entries", "info", c.draftEntries, (n) => `${plural(n, "asiento en borrador", "asientos en borrador")}`);
  // CRM 0039: nada se contabiliza a ciegas
  add("fee_vat_unset", "warning", c.stripeFeeVatUnset, (n) => `${plural(n, "transacción de Stripe", "transacciones de Stripe")} sin tratamiento del IVA de su comisión: no se contabiliza${n === 1 ? "" : "n"} hasta configurarlo`);
  add("payments_due_next7", "info", c.paymentsDueNext7, (n) => `${plural(n, "pago vence", "pagos vencen")} en los próximos 7 días`);
  return out;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const csvOf = (header: string[], rows: string[][]) => BOM + [header, ...rows].map((r) => r.join(";")).join("\r\n") + "\r\n";
const pct = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const opt = (v: number | null | undefined) => (v === null || v === undefined ? "" : eur(v));

export function pnlCsv(r: { periods: ReadonlyArray<Pick<Period, "label">>; lines: ReadonlyArray<PnlRow>; compare: unknown }): string {
  const withCompare = r.lines.some((l) => l.compareTotalCents !== null);
  const header = ["Partida", "Cuenta", ...r.periods.map((p) => p.label), "Total", ...(withCompare ? ["Comparación", "Variación", "Variación %"] : [])];
  const rows: string[][] = [];
  for (const l of r.lines) {
    rows.push([csvText(l.label), "", ...l.values.map(eur), eur(l.totalCents), ...(withCompare ? [opt(l.compareTotalCents), opt(l.variationCents), pct(l.variationPct)] : [])]);
    for (const a of l.accounts) rows.push([csvText(`   ${a.name}`), a.code, ...a.values.map(eur), eur(a.totalCents), ...(withCompare ? [opt(a.compareTotalCents), "", ""] : [])]);
  }
  return csvOf(header, rows);
}

export function balanceCsv(b: ReturnType<typeof buildBalance> & { date: string }): string {
  const rows: string[][] = [];
  const block = (title: string, x: BalanceBlock) => {
    rows.push([csvText(title), "", eur(x.totalCents)]);
    for (const l of x.lines) {
      if (l.amountCents === 0 && !l.accounts.length) continue;
      rows.push([csvText(`  ${l.label}`), "", eur(l.amountCents)]);
      for (const a of l.accounts) rows.push([csvText(`    ${a.name}`), csvText(a.code), eur(a.amountCents)]);
    }
  };
  block("A) ACTIVO NO CORRIENTE", b.assets.nonCurrent);
  block("B) ACTIVO CORRIENTE", b.assets.current);
  rows.push(["TOTAL ACTIVO (A + B)", "", eur(b.assets.totalCents)]);
  block("A) PATRIMONIO NETO", b.equityAndLiabilities.equity);
  block("B) PASIVO NO CORRIENTE", b.equityAndLiabilities.nonCurrent);
  block("C) PASIVO CORRIENTE", b.equityAndLiabilities.current);
  rows.push(["TOTAL PATRIMONIO NETO Y PASIVO (A + B + C)", "", eur(b.equityAndLiabilities.totalCents)]);
  rows.push([csvText(`Cuadre a ${esDate(b.date)}`), "", eur(b.check.differenceCents)]);
  return csvOf(["Partida", "Cuenta", "Importe"], rows);
}

export function cashflowCsv(c: ReturnType<typeof buildCashflow> & { forecast: ReturnType<typeof buildForecast> | null }): string {
  const rows: string[][] = [];
  for (const a of c.accounts) rows.push(["Cuenta", a.code, csvText(a.name), eur(a.openingCents), eur(a.inCents), eur(a.outCents), eur(a.closingCents)]);
  rows.push(["Total", "", "", eur(c.totals.openingCents), eur(c.totals.inCents), eur(c.totals.outCents), eur(c.totals.closingCents)]);
  for (const n of c.byNature) rows.push(["Naturaleza", n.key, csvText(n.label), "", eur(n.inCents), eur(n.outCents), eur(n.netCents)]);
  for (const m of c.months) rows.push(["Mes", m.month, "", "", eur(m.inCents), eur(m.outCents), eur(m.netCents)]);
  if (c.forecast) {
    for (const b of c.forecast.buckets) rows.push(["Previsión", `${b.days} días`, esDate(b.until), eur(c.forecast.startingBalanceCents), eur(b.inflowsCents), eur(b.outflowsCents), eur(b.projectedBalanceCents)]);
    for (const it of c.forecast.items) rows.push(["Previsión (detalle)", esDate(it.date), csvText(`${it.reference} · ${it.description}`), "", it.amountCents !== null && it.amountCents > 0 ? eur(it.amountCents) : "", it.amountCents !== null && it.amountCents < 0 ? eur(-it.amountCents) : "", it.amountCents === null ? "sin calcular" : ""]);
  }
  return csvOf(["Tipo", "Clave", "Descripción", "Saldo inicial", "Entradas", "Salidas", "Saldo final / neto"], rows);
}

export function agingCsv(a: ReturnType<typeof buildAging> & { side: string }): string {
  const rows: string[][] = [];
  for (const p of a.parties) {
    rows.push([csvText(p.name), "", "", "", ...AGING_BUCKETS.map((b) => eur(p.buckets[b.key])), eur(p.totalCents)]);
    for (const d of p.documents) rows.push([csvText(p.name), csvText(d.number ?? `#${d.id}`), esDate(d.date), d.dueDate ? esDate(d.dueDate) : "", ...AGING_BUCKETS.map((b) => (b.key === d.bucket ? eur(d.pendingCents) : "")), eur(d.pendingCents)]);
  }
  rows.push(["Total", "", "", "", ...AGING_BUCKETS.map((b) => eur(a.totals[b.key])), eur(a.totals.totalCents)]);
  return csvOf([a.side === "receivable" ? "Cliente" : "Proveedor", "Documento", "Fecha", "Vencimiento", ...AGING_BUCKETS.map((b) => b.label), "Pendiente"], rows);
}

export function expensesCsv(e: { months: string[]; items: ReadonlyArray<{ name: string; accountCode: string | null; values: number[]; totalCents: number; compareCents: number | null; variationCents: number | null; variationPct: number | null }>; totals: { values: number[]; totalCents: number; compareCents: number | null; variationCents: number | null; variationPct: number | null } }): string {
  const withCompare = e.totals.compareCents !== null;
  const rows = e.items.map((x) => [csvText(x.name), x.accountCode ?? "", ...x.values.map(eur), eur(x.totalCents), ...(withCompare ? [opt(x.compareCents), opt(x.variationCents), pct(x.variationPct)] : [])]);
  rows.push(["Total", "", ...e.totals.values.map(eur), eur(e.totals.totalCents), ...(withCompare ? [opt(e.totals.compareCents), opt(e.totals.variationCents), pct(e.totals.variationPct)] : [])]);
  return csvOf(["Grupo", "Cuenta", ...e.months.map(monthLabel), "Total", ...(withCompare ? ["Comparación", "Variación", "Variación %"] : [])], rows);
}

export function revenueMarginCsv(r: { months: ReadonlyArray<Omit<RevenueMarginMonth, "collectedCents" | "stripeFeesPct"> & { collectedCents: number | null; stripeFeesPct: number | null }> }): string {
  const rows = r.months.map((m) => [m.label, eur(m.accruedRevenueCents), opt(m.collectedCents), eur(m.stripeFeesCents), pct(m.stripeFeesPct), eur(m.directCostsCents), eur(m.grossMarginCents), pct(m.grossMarginPct), eur(m.structureCostsCents), eur(m.otherIncomeCents), eur(m.resultCents), eur(m.financialCostsCents)]);
  return csvOf(["Mes", "Ingresos devengados", "Cobrado", "Comisiones de Stripe", "Comisiones %", "Costes directos", "Margen bruto", "Margen bruto %", "Gastos de estructura", "Otros ingresos", "Resultado", "Gastos financieros"], rows);
}

export function conversionCsv(c: ReturnType<typeof buildConversion>): string {
  const rows = c.months.map((m) => [
    m.label,
    m.invoices ? String(m.invoices.count) : "",
    m.invoices ? eur(m.invoices.amountCents) : "",
    pct(m.collectedPct),
    pct(m.settledPct),
    pct(m.inBankPct),
    pct(m.dsoDays),
    pct(m.chargeToAvailableDays),
    pct(m.payoutToBankDays),
    pct(m.stripe?.refundsPct ?? null),
    pct(m.stripe?.disputesPct ?? null),
    m.stripe ? String(m.stripe.chargesWithoutInvoice.count) : "",
    pct(m.failedPayments?.ratePct ?? null),
  ]);
  return csvOf(["Mes", "Facturas", "Facturado", "Cobrado %", "Liquidado %", "En banco %", "Días factura→cobro", "Días cobro→disponible", "Días payout→banco", "Reembolsos %", "Disputas %", "Cobros sin factura", "Pagos fallidos %"], rows);
}

export const DAILY_COUNT_KEYS: ReadonlyArray<keyof DailyCounts> = ["invoicesIssued", "stripeCharges", "payoutsArriving", "payoutsWithoutBank", "bankMovements", "bankPending", "expensesRegistered", "paymentsOverdue", "paymentsDueToday", "paymentsDueNext7", "receivablesOverdue", "stripeIssuesOpen", "taxDueNext15", "taxOverdue", "draftEntries"];

export function dailyCsv(d: { date: string; counts: Partial<Record<keyof DailyCounts, number | null>>; alerts: DailyAlert[] }): string {
  const labels: Record<keyof DailyCounts, string> = {
    invoicesIssued: "Facturas emitidas",
    stripeCharges: "Cobros de Stripe",
    payoutsArriving: "Payouts con llegada hoy",
    payoutsWithoutBank: "Payouts sin movimiento bancario",
    bankMovements: "Movimientos bancarios del día",
    bankPending: "Movimientos bancarios sin conciliar",
    expensesRegistered: "Gastos registrados",
    paymentsOverdue: "Pagos vencidos",
    paymentsDueToday: "Pagos que vencen hoy",
    paymentsDueNext7: "Pagos que vencen en 7 días",
    receivablesOverdue: "Facturas vencidas sin cobrar",
    stripeIssuesOpen: "Incidencias de Stripe sin revisar",
    taxDueNext15: "Obligaciones fiscales en 15 días",
    taxOverdue: "Obligaciones fiscales vencidas",
    draftEntries: "Asientos en borrador",
    stripeFeeVatUnset: "Transacciones de Stripe sin tratamiento del IVA de la comisión",
  };
  // CRM 0039: la fila de las comisiones sin tratamiento solo aparece con la migración (si el recuento viene)
  const keys: Array<keyof DailyCounts> = [...DAILY_COUNT_KEYS, ...("stripeFeeVatUnset" in d.counts ? (["stripeFeeVatUnset"] as const) : [])];
  const rows = keys.map((k) => [esDate(d.date), csvText(labels[k]), d.counts[k] === null || d.counts[k] === undefined ? "" : String(d.counts[k])]);
  for (const a of d.alerts) rows.push([esDate(d.date), csvText(`Aviso: ${a.message}`), String(a.count)]);
  return csvOf(["Fecha", "Concepto", "Valor"], rows);
}
