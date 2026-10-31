/**
 * Reglas PURAS de la fase 3 (gestoría e impuestos), sin BD ni red: calendario fiscal (vencimientos reales con traslado
 * a día hábil), aplicabilidad de cada modelo según la configuración, cálculo de los modelos 303, 390, 349, 347, 111,
 * 190, 115, 180, 200 y 202 con sus casillas y el detalle de origen de cada cifra, huella y diferencias (`stale`),
 * libros registro en CSV y asientos (liquidación del IVA, pagos, nóminas y cuotas de aplazamientos).
 *
 * Adaptado del módulo de gestoría del tenant (copiado, nunca importado: aquel usa `legacyDb`):
 *  - `obligationSpecs` y `addMonthsISO` de server/routers/gestoria.ts (calendario del ejercicio y meses);
 *  - `lines303`, `lines111` y `lines200` de server/gestoriaTax.ts (desglose de cada obligación), aquí como `details`
 *    con la referencia exacta del asiento, la factura, el gasto o la nómina de los que sale cada cifra;
 *  - el coeficiente del 202 por base («5/7 del tipo, redondeado por defecto») de `computeCorporate`.
 * Diferencias con el tenant: céntimos enteros en lugar de decimales, el IVA sale del LIBRO (líneas 477/472 con su tipo
 * y base, incluida la inversión del sujeto pasivo de las comisiones de Stripe) y nada se presupone aplicable.
 *
 * Es una ESTIMACIÓN trazable: la presentación la hace el operador o su gestoría; aquí nunca se envía nada.
 */
import { createHash } from "node:crypto";
import { taxOf } from "../invoicing/rules";
import { addDays } from "./opsRules";
import { VAT_TREATMENT_LABELS, type VatTreatment } from "./opsTypes";
import { BOM, csvText, esDate, eur, signed, toCsv } from "./rules";
import {
  CORPORATE_REGIMES,
  DRAFT_NOTICE,
  INFORMATIVE_MODELS,
  MODEL_NAMES,
  PAYMENT_ACCOUNT,
  type CorporateBracket,
  type CorporatePreset,
  type CorporateYearConfig,
  type CorporateYearInput,
  type Declarant,
  type InstallmentMethod,
  type Outcome,
  type StaleInfo,
  type TaxBox,
  type TaxDetail,
  type TaxDraft,
  type TaxModel,
  type TaxSettings,
} from "./taxTypes";
import { FinanceError, type EntryDraft, type EntryLineInput } from "./types";

const bad = (m: string) => new FinanceError("invalid_input", m);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Fechas ────────────────────────────────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");
export const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthEnd = (year: number, month: number) => `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;

/**
 * Suma meses a una fecha conservando el día cuando existe (31/01 + 1 → 28/02 o 29/02). Adaptado de `addMonthsISO`
 * (server/routers/gestoria.ts), que usaba la zona local y podía desbordar al mes siguiente.
 */
export function addMonthsISO(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const d = Math.min(Number(date.slice(8, 10)), lastDayOfMonth(ty, tm + 1));
  return `${ty}-${pad2(tm + 1)}-${pad2(d)}`;
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Festivos nacionales fijos de toda España (y el Viernes Santo, nacional en todas las comunidades). */
export const NATIONAL_FIXED_HOLIDAYS = ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"] as const;

export function nationalHolidays(year: number): string[] {
  return [...NATIONAL_FIXED_HOLIDAYS.map((md) => `${year}-${md}`), addDays(easterSunday(year), -2)].sort();
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** ¿Es hábil a efectos de plazos tributarios? (ni sábado, ni domingo, ni festivo nacional o configurado). */
export function isBusinessDay(date: string, extraHolidays: readonly string[] = []): boolean {
  const w = weekday(date);
  if (w === 0 || w === 6) return false;
  return !nationalHolidays(Number(date.slice(0, 4))).includes(date) && !extraHolidays.includes(date);
}

/** Si el último día del plazo es inhábil, el plazo pasa al primer día hábil siguiente (art. 30 Ley 39/2015). */
export function shiftToBusinessDay(date: string, extraHolidays: readonly string[] = []): string {
  let d = date;
  for (let i = 0; i < 15 && !isBusinessDay(d, extraHolidays); i++) d = addDays(d, 1);
  return d;
}

export function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

// ── Periodos y vencimientos ───────────────────────────────────────────────────────────────────────────────────────

export const QUARTERS = ["1T", "2T", "3T", "4T"] as const;
export const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;
export const INSTALLMENTS = ["1P", "2P", "3P"] as const;
export const ANNUAL = "ANUAL";

/** Periodos de un modelo según la configuración. */
export function periodsOf(model: TaxModel, s: Pick<TaxSettings, "vatPeriod">): string[] {
  switch (model) {
    case "303":
      return s.vatPeriod === "monthly" ? [...MONTHS] : [...QUARTERS];
    case "111":
    case "115":
    case "349":
      return [...QUARTERS];
    case "202":
      return [...INSTALLMENTS];
    case "SS":
      return [...MONTHS];
    default:
      return [ANNUAL];
  }
}

export function isValidPeriod(model: TaxModel, period: string): boolean {
  if (model === "303") return (QUARTERS as readonly string[]).includes(period) || (MONTHS as readonly string[]).includes(period);
  if (model === "202") return (INSTALLMENTS as readonly string[]).includes(period);
  if (model === "SS") return (MONTHS as readonly string[]).includes(period);
  if (model === "111" || model === "115" || model === "349") return (QUARTERS as readonly string[]).includes(period);
  return period === ANNUAL;
}

/**
 * Fechas que abarca un periodo. El 202 abarca lo acumulado del ejercicio hasta el mes anterior al pago (art. 40.3 LIS:
 * tres, nueve y once primeros meses); el resto, su trimestre, mes o año natural.
 */
export function periodRange(model: TaxModel, year: number, period: string): { from: string; to: string } {
  if (!isValidPeriod(model, period)) throw bad(`Periodo «${period}» no válido para el modelo ${model}`);
  if (period === ANNUAL) return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (period.endsWith("T")) {
    const q = Number(period[0]);
    return { from: `${year}-${pad2(q * 3 - 2)}-01`, to: monthEnd(year, q * 3) };
  }
  if (period.endsWith("P")) {
    const m = { "1P": 3, "2P": 9, "3P": 11 }[period as "1P" | "2P" | "3P"];
    return { from: `${year}-01-01`, to: monthEnd(year, m) };
  }
  const m = Number(period);
  return { from: `${year}-${pad2(m)}-01`, to: monthEnd(year, m) };
}

export const periodLabel = (year: number, period: string) => (period === ANNUAL ? `${year}` : period.endsWith("T") ? `${period[0]}.º trimestre ${year}` : period.endsWith("P") ? `${period[0]}.º pago ${year}` : `${period}/${year}`);

/**
 * Último día del plazo (sin trasladar). Calendario de la AEAT (ejercicio natural):
 *  - 303 trimestral: 20 de abril, julio y octubre; 4T, 30 de enero. 303 mensual: día 30 del mes siguiente (enero, hasta
 *    el último día de febrero; diciembre, 30 de enero);
 *  - 111 y 115: 20 de abril, julio y octubre; 4T, 20 de enero (el 4T de retenciones vence el 20, no el 30);
 *  - 349 trimestral: como el 303 trimestral;
 *  - 390: 30 de enero; 190 y 180: 31 de enero; 347: último día de febrero;
 *  - 200: 25 días naturales tras los seis meses siguientes al cierre (25 de julio en ejercicio natural);
 *  - 202: 20 de abril, octubre y diciembre del propio ejercicio;
 *  - seguros sociales (RLC): último día del mes siguiente al de devengo.
 */
export function rawDueDate(model: TaxModel, year: number, period: string): string {
  const ny = year + 1;
  const q = period.endsWith("T") ? Number(period[0]) : 0;
  switch (model) {
    case "303":
    case "349":
      if (q) return q < 4 ? `${year}-${pad2(q * 3 + 1)}-20` : `${ny}-01-30`;
      if (period === "12") return `${ny}-01-30`;
      if (period === "01") return monthEnd(year, 2);
      return `${year}-${pad2(Number(period) + 1)}-30`;
    case "111":
    case "115":
      return q < 4 ? `${year}-${pad2(q * 3 + 1)}-20` : `${ny}-01-20`;
    case "390":
      return `${ny}-01-30`;
    case "190":
    case "180":
      return `${ny}-01-31`;
    case "347":
      return monthEnd(ny, 2);
    case "200":
      return `${ny}-07-25`;
    case "202":
      return { "1P": `${year}-04-20`, "2P": `${year}-10-20`, "3P": `${year}-12-20` }[period as "1P" | "2P" | "3P"];
    case "SS": {
      const m = Number(period);
      return m === 12 ? monthEnd(ny, 1) : monthEnd(year, m + 1);
    }
  }
}

export function dueDateOf(model: TaxModel, year: number, period: string, extraHolidays: readonly string[] = []): string {
  return shiftToBusinessDay(rawDueDate(model, year, period), extraHolidays);
}

export const obligationKey = (model: TaxModel, year: number, period: string) => `obligation:${model}:${year}:${period}`;

/**
 * ¿Aplica el modelo según la configuración? (lo que depende de los datos —347 y 349 sin terceros, 202 por art. 40.2
 * sin cuota— se decide al calcular). `reason` explica por qué no aparece en el calendario.
 */
export function modelApplicability(model: TaxModel, s: TaxSettings): { applies: boolean; reason: string | null } {
  const no = (reason: string) => ({ applies: false, reason });
  const yes = { applies: true, reason: null };
  switch (model) {
    case "303":
      return s.vatRegime === "exento" ? no("La entidad está configurada en régimen de IVA exento: no presenta el 303") : yes;
    case "390":
      if (s.vatRegime === "exento") return no("La entidad está configurada en régimen de IVA exento: no presenta el 390");
      return s.vat390Exempt ? no("La configuración marca la exoneración del resumen anual de IVA (390)") : yes;
    case "349":
      return s.intraEuOperations ? yes : no("La configuración no indica operaciones intracomunitarias");
    case "347":
      return s.operations347 ? yes : no("La configuración excluye el 347 (operaciones con terceros)");
    case "111":
    case "190":
      return s.hasEmployees || s.hasProfessionalWithholdings ? yes : no("Sin empleados ni retenciones a profesionales en la configuración");
    case "115":
    case "180":
      return s.hasRentWithholdings ? yes : no("Sin alquileres con retención en la configuración");
    case "200":
      return yes;
    case "202":
      return yes;
    case "SS":
      return s.hasEmployees ? yes : no("Sin empleados en la configuración: no hay seguros sociales");
  }
}

export interface ObligationSpec {
  key: string;
  model: TaxModel;
  year: number;
  period: string;
  from: string;
  to: string;
  dueDate: string;
}

/**
 * Obligaciones de un ejercicio según la configuración (adaptado de `obligationSpecs`, server/routers/gestoria.ts):
 * las que aplican, con su vencimiento real, y las que no, con el motivo.
 */
export function obligationSpecs(year: number, s: TaxSettings): { specs: ObligationSpec[]; notApplicable: Array<{ model: TaxModel; reason: string }> } {
  const specs: ObligationSpec[] = [];
  const notApplicable: Array<{ model: TaxModel; reason: string }> = [];
  for (const model of ["303", "390", "349", "347", "111", "190", "115", "180", "200", "202", "SS"] as TaxModel[]) {
    const a = modelApplicability(model, s);
    if (!a.applies) {
      notApplicable.push({ model, reason: a.reason! });
      continue;
    }
    for (const period of periodsOf(model, s)) {
      const r = periodRange(model, year, period);
      specs.push({ key: obligationKey(model, year, period), model, year, period, ...r, dueDate: dueDateOf(model, year, period, s.extraHolidays) });
    }
  }
  return { specs: specs.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key)), notApplicable };
}

// ── Huella y diferencias ──────────────────────────────────────────────────────────────────────────────────────────

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

export type DraftBody = Omit<TaxDraft, "hash" | "computedAt" | "notice">;

/** Huella sha256 del contenido del borrador (sin la fecha del cálculo): mismos datos, misma huella. */
export function draftHash(d: DraftBody): string {
  const { model, year, period, from, to, applicable, reason, hasData, boxes, details, declarants, outcome, resultCents, extra } = d;
  return createHash("sha256").update(JSON.stringify(canonical({ model, year, period, from, to, applicable, reason, hasData, boxes, details, declarants, outcome, resultCents, extra }))).digest("hex");
}

export function finalizeDraft(d: DraftBody, computedAt: number): TaxDraft {
  return { ...d, hash: draftHash(d), computedAt, notice: DRAFT_NOTICE };
}

/** Diferencias entre el borrador guardado y el recalculado (null si son iguales). */
export function staleInfo(prev: TaxDraft, next: TaxDraft, at: number): StaleInfo | null {
  if (prev.hash === next.hash) return null;
  const labels = new Map([...prev.boxes, ...next.boxes].map((b) => [b.box, b.label]));
  const before = new Map(prev.boxes.map((b) => [b.box, b.valueCents]));
  const after = new Map(next.boxes.map((b) => [b.box, b.valueCents]));
  const keys = Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]));
  const differences = keys.filter((k) => (before.get(k) ?? null) !== (after.get(k) ?? null)).map((k) => ({ box: k, label: labels.get(k) ?? k, before: before.get(k) ?? null, after: after.get(k) ?? null }));
  return { detectedAt: at, previousHash: prev.hash, currentHash: next.hash, resultBefore: prev.resultCents, resultAfter: next.resultCents, differences };
}

// ── Utilidades de los modelos ─────────────────────────────────────────────────────────────────────────────────────

export const EU_COUNTRIES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "GR", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"] as const;
export const isEu = (country: string | null | undefined) => !!country && (EU_COUNTRIES as readonly string[]).includes(country.toUpperCase());
export const isEuForeign = (country: string | null | undefined) => isEu(country) && country!.toUpperCase() !== "ES";

const box = (b: string, label: string, valueCents: number | null, unit: TaxBox["unit"] = "cents"): TaxBox => ({ box: b, label, valueCents, unit });
const count = (b: string, label: string, n: number) => box(b, label, n, "count");
const bpBox = (b: string, label: string, n: number) => box(b, label, n, "bp");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const outcomeOf = (result: number, activity: boolean, negative: "a_compensar" | "a_devolver"): Outcome => (result > 0 ? "a_ingresar" : result < 0 ? negative : activity ? "cero" : "sin_actividad");

function body(model: TaxModel, year: number, period: string, p: Partial<DraftBody>): DraftBody {
  const r = periodRange(model, year, period);
  return { model, year, period, ...r, applicable: true, reason: null, hasData: true, boxes: [], details: [], declarants: [], warnings: [], outcome: null, resultCents: null, extra: {}, ...p };
}

// ── 303: IVA ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Línea del libro en 477 o 472 dentro del periodo (sin regularización, cierre, apertura ni las propias liquidaciones).
 * `kind` es el origen del hecho: venta (factura expedida), compra (gasto registrado), Stripe (comisión con inversión
 * del sujeto pasivo) u otro (asiento manual, banco…). En una reversión es el origen del asiento revertido y
 * `originalInPeriod` dice si aquel cae en el mismo periodo (entonces se compensa en su misma casilla; si no, va a
 * modificaciones/rectificaciones).
 */
export interface VatLedgerLine {
  entryId: number;
  entryNumber: number | null;
  date: string;
  description: string;
  account: "477" | "472";
  kind: "sale" | "purchase" | "stripe" | "other";
  reversal: boolean;
  originalInPeriod: boolean;
  debitCents: number;
  creditCents: number;
  taxRateBp: number | null;
  taxBaseCents: number | null;
  /** CRM 0039: tratamiento del IVA del gasto del que sale la línea (compras; null = interior). */
  treatment?: VatTreatment | null;
}

/** Factura expedida del periodo (para las casillas informativas 59 y 120 y los avisos). */
export interface VatInvoiceInfo {
  id: number;
  number: string;
  date: string;
  customerName: string | null;
  customerTaxId: string | null;
  customerCountry: string | null;
  /** Σ base de sus líneas al 0 % (con signo). */
  zeroRatedBaseCents: number;
}

/** Gasto registrado del periodo (avisos de posible inversión del sujeto pasivo sin autoliquidar). */
export interface VatExpenseInfo {
  id: number;
  number: string | null;
  date: string;
  supplierName: string | null;
  supplierCountry: string | null;
  baseCents: number;
  taxRateBp: number;
  kind: string;
  /** CRM 0039: con un tratamiento explícito distinto del interior no se avisa de una posible ISP sin autoliquidar. */
  vatTreatment?: VatTreatment | null;
}

export interface Vat303Input {
  year: number;
  period: string;
  lines: VatLedgerLine[];
  /** null = la facturación propia no está montada (casillas informativas sin datos). */
  invoices: VatInvoiceInfo[] | null;
  expenses: VatExpenseInfo[];
  /** ¿Hay algún asiento contabilizado en el periodo? Sin ninguno, «sin datos». */
  ledgerHasEntries: boolean;
  /** Cuotas a compensar de periodos anteriores (casilla 110) y de dónde salen. */
  carriedInCents: number;
  carriedInSource: string;
  /** Último periodo del año: un resultado negativo puede pedirse a devolver. */
  lastPeriod: boolean;
  /** Elegido al presentar el último periodo: devolución en lugar de compensación. */
  refund?: boolean;
  regime: TaxSettings["vatRegime"];
}

/** Casillas por tipo: base y cuota (régimen general). */
export const RATE_BOXES: Record<number, [string, string]> = { 400: ["01", "03"], 1000: ["04", "06"], 2100: ["07", "09"] };

/**
 * Modelo 303 (adaptado de `compute303`/`lines303`, server/gestoriaTax.ts). Devengado: líneas de 477 por tipo
 * (01–09), adquisiciones intracomunitarias de servicios con inversión del sujeto pasivo —comisiones de Stripe— (10/11) y
 * modificaciones por rectificativas (14/15). Deducible: 472 de operaciones interiores (28/29), de adquisiciones
 * intracomunitarias (36/37) y rectificaciones de deducciones (40/41). Sin prorrata (régimen general: 100 % deducible
 * salvo la parte no deducible de cada gasto, que ya va al gasto). Compensación de periodos anteriores: 110 → 78 → 87.
 */
export function vat303(i: Vat303Input): DraftBody {
  const warnings: string[] = [];
  const details: TaxDetail[] = [];
  if (!i.ledgerHasEntries && i.lines.length === 0) {
    return body("303", i.year, i.period, {
      hasData: false,
      warnings: ["No hay asientos contabilizados en el periodo: sincroniza las facturas expedidas, registra los gastos y contabiliza Stripe antes de calcular"],
      boxes: [box("71", "Resultado de la liquidación", null)],
    });
  }
  const acc = new Map<string, number>();
  const add = (k: string, v: number) => acc.set(k, (acc.get(k) ?? 0) + v);
  if (i.regime === "mixto") warnings.push("Régimen mixto configurado: el cálculo no aplica prorrata; revisa con la gestoría la parte deducible");
  for (const l of i.lines) {
    const cuota = l.account === "477" ? l.creditCents - l.debitCents : l.debitCents - l.creditCents;
    if (cuota === 0) continue;
    const sign = Math.sign(cuota);
    const fullBase = Math.abs(l.taxBaseCents ?? 0);
    if (l.taxBaseCents === null) warnings.push(`El asiento ${l.entryNumber ?? l.entryId} (${l.date}) tiene IVA sin base ni tipo: revisa la línea`);
    let baseBox: string;
    let cuotaBox: string;
    let base: number;
    if (l.account === "477") {
      base = sign * fullBase;
      const modification = (l.reversal && !l.originalInPeriod) || (!l.reversal && l.kind === "sale" && cuota < 0);
      if (l.kind === "stripe") [baseBox, cuotaBox] = ["10", "11"];
      else if (modification) [baseBox, cuotaBox] = ["14", "15"];
      // CRM 0039: autoliquidación de un gasto con inversión del sujeto pasivo, por su tratamiento
      else if (l.kind === "purchase" && (l.treatment === "intra_eu_services" || l.treatment === "intra_eu_goods")) [baseBox, cuotaBox] = ["10", "11"];
      else if (l.kind === "purchase" && (l.treatment === "reverse_charge_domestic" || l.treatment === "non_eu_services")) [baseBox, cuotaBox] = ["12", "13"];
      else if (l.kind === "purchase") {
        [baseBox, cuotaBox] = ["12", "13"];
        warnings.push(`IVA autoliquidado en un gasto sin tratamiento de inversión del sujeto pasivo (asiento ${l.entryNumber ?? l.entryId}): revisa el tratamiento del gasto`);
      } else if (l.taxRateBp !== null && RATE_BOXES[l.taxRateBp]) [baseBox, cuotaBox] = RATE_BOXES[l.taxRateBp];
      else {
        [baseBox, cuotaBox] = ["otros_base", "otros_cuota"];
        warnings.push(`IVA repercutido a un tipo sin casilla propia (${l.taxRateBp === null ? "sin tipo" : `${l.taxRateBp / 100} %`}) en el asiento ${l.entryNumber ?? l.entryId}: revisa la casilla con la gestoría`);
      }
      if (l.kind === "other" && !l.reversal) warnings.push(`IVA repercutido en un asiento que no es una factura expedida (asiento ${l.entryNumber ?? l.entryId}): comprueba que está bien declarado`);
    } else {
      const full = l.taxRateBp ? taxOf(fullBase, l.taxRateBp) : 0;
      base = sign * (full > 0 ? Math.round((fullBase * Math.abs(cuota)) / full) : fullBase);
      const modification = (l.reversal && !l.originalInPeriod) || (!l.reversal && l.kind === "purchase" && cuota < 0);
      if (l.kind === "stripe") [baseBox, cuotaBox] = ["36", "37"];
      else if (modification) [baseBox, cuotaBox] = ["40", "41"];
      // CRM 0039: deducible de adquisiciones intracomunitarias (36/37) e importaciones (32/33) por el tratamiento del gasto
      else if (l.kind === "purchase" && (l.treatment === "intra_eu_services" || l.treatment === "intra_eu_goods")) [baseBox, cuotaBox] = ["36", "37"];
      else if (l.kind === "purchase" && l.treatment === "import") [baseBox, cuotaBox] = ["32", "33"];
      else [baseBox, cuotaBox] = ["28", "29"];
      if (l.kind === "other" && !l.reversal) warnings.push(`IVA soportado en un asiento que no es un gasto registrado (asiento ${l.entryNumber ?? l.entryId}): comprueba que tienes la factura`);
    }
    add(baseBox, base);
    add(cuotaBox, cuota);
    details.push({ box: cuotaBox, source: "entry", ref: `entry:${l.entryId}`, date: l.date, description: short(`${l.entryNumber !== null ? `Asiento ${l.entryNumber}` : `Asiento #${l.entryId}`}: ${l.description}`, 300), baseCents: base, taxCents: cuota, rateBp: l.taxRateBp });
  }
  // Casillas informativas: entregas/servicios intracomunitarios (59) y no sujetas por reglas de localización (120)
  let box59: number | null = null;
  let box120: number | null = null;
  if (i.invoices === null) warnings.push("La facturación propia no está montada: sin datos para las casillas informativas 59 y 120");
  else {
    box59 = 0;
    box120 = 0;
    for (const inv of i.invoices) {
      if (inv.zeroRatedBaseCents === 0) continue;
      const c = (inv.customerCountry ?? "").toUpperCase();
      if (isEuForeign(c)) {
        if (!inv.customerTaxId) warnings.push(`Factura ${inv.number} al 0 % a un cliente de la UE sin NIF-IVA: una venta a un consumidor de otro Estado no es intracomunitaria (revisa la ventanilla única)`);
        box59 += inv.zeroRatedBaseCents;
        details.push({ box: "59", source: "invoice", ref: `invoice:${inv.id}`, date: inv.date, description: short(`Factura ${inv.number} · ${inv.customerName ?? "cliente"} (${c})`, 300), baseCents: inv.zeroRatedBaseCents, taxCents: 0, rateBp: 0, taxId: inv.customerTaxId });
      } else if (c && c !== "ES") {
        box120 += inv.zeroRatedBaseCents;
        details.push({ box: "120", source: "invoice", ref: `invoice:${inv.id}`, date: inv.date, description: short(`Factura ${inv.number} · ${inv.customerName ?? "cliente"} (${c})`, 300), baseCents: inv.zeroRatedBaseCents, taxCents: 0, rateBp: 0, taxId: inv.customerTaxId });
      } else warnings.push(`Factura ${inv.number} al 0 % a un cliente en España: comprueba la exención con la gestoría`);
    }
  }
  // Solo los gastos interiores (sin tratamiento o `domestic`): con un tratamiento explícito ya está decidido
  const possibleIsp = i.expenses.filter((e) => (e.vatTreatment ?? "domestic") === "domestic" && e.supplierCountry && e.supplierCountry.toUpperCase() !== "ES" && e.taxRateBp === 0 && e.kind !== "ticket");
  for (const e of possibleIsp.slice(0, 20)) warnings.push(`Gasto ${e.number ?? `#${e.id}`} de ${e.supplierName ?? "un proveedor"} (${e.supplierCountry}) sin IVA: si es una adquisición de servicios con inversión del sujeto pasivo, falta autoliquidarla (casillas 10/11 y 36/37)`);
  if (possibleIsp.length > 20) warnings.push(`… y ${possibleIsp.length - 20} gastos más de proveedores extranjeros sin IVA`);
  const v = (k: string) => acc.get(k) ?? 0;
  const devengado = v("03") + v("06") + v("09") + v("otros_cuota") + v("11") + v("13") + v("15");
  const deducible = v("29") + v("31") + v("33") + v("35") + v("37") + v("39") + v("41");
  const r46 = devengado - deducible;
  const carried = Math.max(0, i.carriedInCents);
  const applied = Math.min(carried, Math.max(0, r46));
  const pendingAfter = carried - applied;
  const r69 = r46 - applied;
  const r71 = r69;
  if (carried > 0) details.push({ box: "110", source: "obligation", ref: i.carriedInSource, date: null, description: "Cuotas a compensar de periodos anteriores", baseCents: null, taxCents: carried, rateBp: null });
  const activity = i.lines.length > 0 || (box59 ?? 0) !== 0 || (box120 ?? 0) !== 0;
  if (r71 < 0 && i.refund && !i.lastPeriod) warnings.push("La devolución solo se pide en el último periodo del año (o con REDEME): el resultado negativo queda a compensar");
  const outcome = outcomeOf(r71, activity, r71 < 0 && i.refund && i.lastPeriod ? "a_devolver" : "a_compensar");
  if (r71 < 0 && i.lastPeriod && !i.refund) warnings.push("Último periodo con resultado negativo: puedes pedir la devolución al presentar (por defecto queda a compensar)");
  const carryForwardCents = pendingAfter + (outcome === "a_compensar" ? -r71 : 0);
  return body("303", i.year, i.period, {
    boxes: [
      box("01", "Régimen general 4 %: base imponible", v("01")),
      box("03", "Régimen general 4 %: cuota", v("03")),
      box("04", "Régimen general 10 %: base imponible", v("04")),
      box("06", "Régimen general 10 %: cuota", v("06")),
      box("07", "Régimen general 21 %: base imponible", v("07")),
      box("09", "Régimen general 21 %: cuota", v("09")),
      ...(acc.has("otros_cuota") ? [box("otros_base", "Otros tipos (revisar): base", v("otros_base")), box("otros_cuota", "Otros tipos (revisar): cuota", v("otros_cuota"))] : []),
      box("10", "Adquisiciones intracomunitarias de bienes y servicios: base", v("10")),
      box("11", "Adquisiciones intracomunitarias de bienes y servicios: cuota", v("11")),
      box("12", "Otras operaciones con inversión del sujeto pasivo: base", v("12")),
      box("13", "Otras operaciones con inversión del sujeto pasivo: cuota", v("13")),
      box("14", "Modificación de bases y cuotas: base", v("14")),
      box("15", "Modificación de bases y cuotas: cuota", v("15")),
      box("27", "Total cuota devengada", devengado),
      box("28", "Cuotas soportadas en operaciones interiores corrientes: base", v("28")),
      box("29", "Cuotas soportadas en operaciones interiores corrientes: cuota", v("29")),
      // CRM 0039: importaciones (DUA), solo si las hay (así la huella de los borradores anteriores no cambia)
      ...(acc.has("33") ? [box("32", "Cuotas soportadas en las importaciones de bienes corrientes: base", v("32")), box("33", "Cuotas soportadas en las importaciones de bienes corrientes: cuota", v("33"))] : []),
      box("36", "Adquisiciones intracomunitarias de bienes y servicios corrientes: base", v("36")),
      box("37", "Adquisiciones intracomunitarias de bienes y servicios corrientes: cuota", v("37")),
      box("40", "Rectificación de deducciones: base", v("40")),
      box("41", "Rectificación de deducciones: cuota", v("41")),
      box("45", "Total a deducir", deducible),
      box("46", "Resultado régimen general", r46),
      box("59", "Entregas intracomunitarias de bienes y servicios", box59),
      box("120", "Operaciones no sujetas por reglas de localización", box120),
      box("64", "Suma de resultados", r46),
      box("66", "Atribuible a la Administración del Estado (100 %)", r46),
      box("110", "Cuotas a compensar pendientes de periodos anteriores", carried),
      box("78", "Cuotas a compensar de periodos previos aplicadas en este periodo", applied),
      box("87", "Cuotas a compensar pendientes para periodos posteriores", pendingAfter),
      box("69", "Resultado", r69),
      box("71", "Resultado de la liquidación", r71),
    ],
    details,
    warnings: Array.from(new Set(warnings)),
    outcome,
    resultCents: r71,
    extra: { devengadoCents: devengado, deducibleCents: deducible, compensadoCents: applied, carryForwardCents, lastPeriod: i.lastPeriod },
  });
}

/** 390: suma anual de las casillas de los 303 del ejercicio (con el resultado de cada periodo como detalle). */
export function vat390(year: number, periods: Array<{ period: string; draft: DraftBody; source: string }>, expectedPeriods: string[]): DraftBody {
  const warnings: string[] = [];
  const missing = expectedPeriods.filter((p) => !periods.some((x) => x.period === p));
  if (missing.length) warnings.push(`Faltan los 303 de: ${missing.join(", ")}`);
  const noData = periods.filter((p) => !p.draft.hasData).map((p) => p.period);
  if (noData.length) warnings.push(`303 sin datos en: ${noData.join(", ")}`);
  if (periods.length === 0 || noData.length === periods.length) return body("390", year, ANNUAL, { hasData: false, warnings: warnings.length ? warnings : ["No hay ningún 303 calculado del ejercicio"], boxes: [box("303.71", "Suma anual: resultado de la liquidación", null)] });
  // CRM 0039: 12/13 (inversión del sujeto pasivo interior o de fuera de la UE) y 32/33 (importaciones), solo si algún
  // periodo los tiene (así la huella de los resúmenes anteriores no cambia)
  const used = (k: string) => periods.some((p) => (p.draft.boxes.find((b) => b.box === k)?.valueCents ?? 0) !== 0);
  const keys = ["01", "03", "04", "06", "07", "09", "10", "11", ...(used("12") || used("13") ? ["12", "13"] : []), "14", "15", "27", "28", "29", ...(used("32") || used("33") ? ["32", "33"] : []), "36", "37", "40", "41", "45", "46", "59", "120", "78", "71"];
  const all = periods.flatMap((p) => p.draft.boxes);
  const total = (k: string) => sum(periods.map((p) => p.draft.boxes.find((b) => b.box === k)?.valueCents ?? 0));
  const labelOf = (k: string) => {
    const l = all.find((b) => b.box === k)?.label ?? k;
    return l.charAt(0).toLowerCase() + l.slice(1);
  };
  const ordered = [...periods].sort((a, b) => a.period.localeCompare(b.period));
  const last = ordered[ordered.length - 1];
  const boxes = keys.map((k) => box(`303.${k}`, `Suma anual: ${labelOf(k)}`, total(k)));
  boxes.push(box("volumen", "Volumen de operaciones (bases devengadas e informativas)", total("01") + total("04") + total("07") + total("14") + total("59") + total("120")));
  boxes.push(box("ultimo_resultado", `Resultado del último periodo (${last.period})`, last.draft.resultCents));
  const details: TaxDetail[] = ordered.map((p) => ({ box: "303.71", source: "obligation", ref: p.source, date: p.draft.to, description: `303 ${p.period}: resultado de la liquidación`, baseCents: null, taxCents: p.draft.resultCents, rateBp: null }));
  const anyActivity = periods.some((p) => p.draft.outcome !== "sin_actividad");
  return body("390", year, ANNUAL, { boxes, details, warnings, outcome: anyActivity ? null : "sin_actividad", resultCents: null, extra: { periods: periods.length } });
}

// ── 349: operaciones intracomunitarias ────────────────────────────────────────────────────────────────────────────

export interface IntraEuInvoice {
  id: number;
  number: string;
  date: string;
  customerName: string | null;
  customerTaxId: string | null;
  customerCountry: string | null;
  baseCents: number;
}

export interface IntraEuExpense {
  id: number;
  number: string | null;
  date: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  supplierCountry: string | null;
  baseCents: number;
  /** CRM 0039: clave del 349 según el tratamiento del gasto (A = adquisición de bienes; I = servicios, por defecto). */
  key?: "A" | "I";
}

/** Comisiones de Stripe autoliquidadas de un emisor (NIF-IVA de la regla aplicada o, si no, el de la configuración). */
export interface StripeIssuerGroup {
  taxId: string | null;
  name: string;
  baseCents: number;
  details: TaxDetail[];
}

/** Umbral de la presentación mensual del 349: más de 50.000 € de entregas en el trimestre (o en los cuatro anteriores). */
export const M349_MONTHLY_THRESHOLD_CENTS = 5_000_000;

/**
 * 349 (trimestral por defecto): clave S, servicios prestados a empresarios de la UE con NIF-IVA (facturas expedidas al
 * 0 % a clientes de otro Estado miembro); clave I, servicios adquiridos a empresarios de la UE con inversión del sujeto
 * pasivo (comisiones de Stripe autoliquidadas y gastos de proveedores de la UE). Las rectificativas restan en su clave.
 */
export function m349(i: { year: number; period: string; invoices: IntraEuInvoice[] | null; expenses: IntraEuExpense[]; stripeFeeBaseCents: number; stripeVatId: string | null; stripeDetails: TaxDetail[]; stripeGroups?: StripeIssuerGroup[] }): DraftBody {
  const warnings: string[] = [];
  const details: TaxDetail[] = [];
  if (i.invoices === null) warnings.push("La facturación propia no está montada: no se pueden leer los servicios prestados a la UE");
  const groups = new Map<string, Declarant>();
  const put = (key: string, taxId: string | null, name: string, country: string | null, cents: number) => {
    const k = `${key}|${taxId ?? name}`;
    const g = groups.get(k) ?? { taxId, name, country, key, amountCents: 0 };
    g.amountCents += cents;
    groups.set(k, g);
  };
  for (const inv of i.invoices ?? []) {
    if (!isEuForeign(inv.customerCountry) || inv.baseCents === 0) continue;
    if (!inv.customerTaxId) {
      warnings.push(`Factura ${inv.number}: cliente de la UE sin NIF-IVA, no se declara en el 349`);
      continue;
    }
    put("S", inv.customerTaxId, inv.customerName ?? inv.customerTaxId, inv.customerCountry, inv.baseCents);
    details.push({ box: "S", source: "invoice", ref: `invoice:${inv.id}`, date: inv.date, description: `Factura ${inv.number} · ${inv.customerName ?? ""}`.trim(), baseCents: inv.baseCents, taxCents: 0, rateBp: 0, taxId: inv.customerTaxId });
  }
  for (const e of i.expenses) {
    if (!isEuForeign(e.supplierCountry) || e.baseCents === 0) continue;
    if (!e.supplierTaxId) warnings.push(`Gasto ${e.number ?? `#${e.id}`}: proveedor de la UE sin NIF-IVA`);
    const key = e.key ?? "I";
    put(key, e.supplierTaxId, e.supplierName ?? "Proveedor", e.supplierCountry, e.baseCents);
    details.push({ box: key, source: "expense", ref: `expense:${e.id}`, date: e.date, description: `Gasto ${e.number ?? `#${e.id}`} · ${e.supplierName ?? ""}`.trim(), baseCents: e.baseCents, taxCents: null, rateBp: null, taxId: e.supplierTaxId });
  }
  if (i.stripeGroups) {
    // CRM 0039: un declarado por emisor (NIF-IVA de la regla aplicada a cada comisión)
    for (const g of i.stripeGroups) {
      if (g.baseCents === 0) continue;
      if (!g.taxId) warnings.push("Comisiones de Stripe con inversión del sujeto pasivo sin NIF-IVA del emisor: indícalo en la regla o en la configuración fiscal");
      put("I", g.taxId, g.name, g.taxId ? g.taxId.slice(0, 2).toUpperCase() : null, g.baseCents);
      details.push(...g.details);
    }
  } else if (i.stripeFeeBaseCents !== 0) {
    if (!i.stripeVatId) warnings.push("Comisiones de Stripe con inversión del sujeto pasivo: falta el NIF-IVA de Stripe en la configuración fiscal");
    put("I", i.stripeVatId, "Stripe Payments Europe, Limited", i.stripeVatId ? i.stripeVatId.slice(0, 2).toUpperCase() : null, i.stripeFeeBaseCents);
    details.push(...i.stripeDetails);
  }
  const declarants = Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key) || (a.taxId ?? "").localeCompare(b.taxId ?? ""));
  for (const d of declarants) if (d.amountCents < 0) warnings.push(`El operador ${d.taxId ?? d.name} (clave ${d.key}) queda en negativo: decláralo como rectificación de un periodo anterior`);
  const positives = declarants.filter((d) => d.amountCents > 0);
  const negatives = declarants.filter((d) => d.amountCents < 0);
  const totalS = sum(declarants.filter((d) => d.key === "S").map((d) => d.amountCents));
  if (totalS > M349_MONTHLY_THRESHOLD_CENTS) warnings.push("Más de 50.000 € de operaciones intracomunitarias en el trimestre: el 349 pasa a ser mensual (revísalo con la gestoría)");
  const any = declarants.length > 0;
  return body("349", i.year, i.period, {
    applicable: any,
    reason: any ? null : "Sin operaciones intracomunitarias en el periodo: no hay que presentar el 349",
    boxes: [count("01", "Número total de operadores intracomunitarios", positives.length), box("02", "Importe de las operaciones intracomunitarias", sum(positives.map((d) => d.amountCents))), count("03", "Número total de operadores con rectificaciones", negatives.length), box("04", "Importe de las rectificaciones", sum(negatives.map((d) => d.amountCents)))],
    details,
    declarants,
    warnings: Array.from(new Set(warnings)),
    outcome: any ? null : "sin_actividad",
    resultCents: null,
  });
}

// ── 347: operaciones con terceros ─────────────────────────────────────────────────────────────────────────────────

export const M347_THRESHOLD_CENTS = 300_506;

export interface ThirdPartyOp {
  key: "A" | "B";
  ref: string;
  source: "invoice" | "expense";
  date: string;
  number: string | null;
  taxId: string | null;
  name: string;
  country: string | null;
  /** Importe total con IVA (con signo: las rectificativas restan). */
  totalCents: number;
  withholdingCents: number;
  /** CRM 0039: tratamiento del IVA del gasto (las intracomunitarias y las importaciones no van al 347). */
  vatTreatment?: VatTreatment | null;
}

const quarterOf = (date: string) => Math.floor((Number(date.slice(5, 7)) - 1) / 3);
const NOT_347: readonly VatTreatment[] = ["intra_eu_services", "intra_eu_goods", "import"];

/**
 * 347 (anual): terceros con más de 3.005,06 € en el año (IVA incluido), clave A (compras: gastos registrados) y clave B
 * (ventas: facturas expedidas), con el desglose trimestral. Se excluyen las operaciones con terceros fuera de España
 * (las intracomunitarias van al 349 y las demás no son declarables) y las sujetas a retención (alquileres y
 * profesionales, que van al 180/190). Las rectificativas restan.
 */
export function m347(year: number, ops: ThirdPartyOp[]): DraftBody {
  const warnings: string[] = [];
  const groups = new Map<string, Declarant & { refs: ThirdPartyOp[] }>();
  let excludedForeign = 0;
  let excludedWithholding = 0;
  let excludedTreatment = 0;
  for (const o of ops) {
    if (o.country && o.country.toUpperCase() !== "ES") {
      excludedForeign++;
      continue;
    }
    if (o.vatTreatment && NOT_347.includes(o.vatTreatment)) {
      excludedTreatment++;
      continue;
    }
    if (o.withholdingCents !== 0) {
      excludedWithholding++;
      continue;
    }
    if (!o.taxId) {
      warnings.push(`${o.source === "invoice" ? "Factura" : "Gasto"} ${o.number ?? o.ref} sin NIF del tercero (${o.name}): no se puede declarar`);
      continue;
    }
    const k = `${o.key}|${o.taxId}`;
    const g = groups.get(k) ?? { taxId: o.taxId, name: o.name, country: "ES", key: o.key, amountCents: 0, quarters: [0, 0, 0, 0] as [number, number, number, number], refs: [] };
    g.amountCents += o.totalCents;
    g.quarters![quarterOf(o.date)] += o.totalCents;
    g.refs.push(o);
    groups.set(k, g);
  }
  const all = Array.from(groups.values());
  const declared = all.filter((g) => Math.abs(g.amountCents) > M347_THRESHOLD_CENTS).sort((a, b) => a.key.localeCompare(b.key) || b.amountCents - a.amountCents);
  const details: TaxDetail[] = declared.flatMap((g) => g.refs.map((o) => ({ box: g.key, source: o.source, ref: o.ref, date: o.date, description: `${o.source === "invoice" ? "Factura" : "Gasto"} ${o.number ?? ""} · ${o.name}`.trim(), baseCents: null, taxCents: null, rateBp: null, taxId: o.taxId }) as TaxDetail));
  if (excludedForeign) warnings.push(`${excludedForeign} operaciones con terceros fuera de España excluidas (intracomunitarias o no declarables)`);
  if (excludedWithholding) warnings.push(`${excludedWithholding} operaciones sujetas a retención excluidas (van al 180 o al 190)`);
  if (excludedTreatment) warnings.push(`${excludedTreatment} operaciones intracomunitarias o importaciones excluidas por su tratamiento del IVA (van al 349 o no se declaran)`);
  warnings.push("No se incluyen los cobros en metálico de más de 6.000 € ni las subvenciones: si los hubo, añádelos con la gestoría");
  const any = declared.length > 0;
  return body("347", year, ANNUAL, {
    applicable: any,
    reason: any ? null : "Ningún tercero supera 3.005,06 € en el año: no hay que presentar el 347",
    hasData: ops.length > 0 || any,
    boxes: [count("01", "Número total de personas y entidades", declared.length), box("02", "Importe total anual de las operaciones", sum(declared.map((g) => g.amountCents)))],
    details,
    declarants: declared.map(({ refs: _r, ...d }) => d),
    warnings: Array.from(new Set(warnings)),
    outcome: any ? null : "sin_actividad",
    resultCents: null,
  });
}

// ── 111, 190, 115 y 180: retenciones ──────────────────────────────────────────────────────────────────────────────

export interface PayrollRow {
  id: number;
  period: string;
  employeeAlias: string;
  grossCents: number;
  irpfCents: number;
  ssEmployeeCents: number;
  ssCompanyCents: number;
  status: string;
}

export interface WithholdingExpense {
  id: number;
  number: string | null;
  date: string;
  supplierId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  baseCents: number;
  withholdingCents: number;
}

/**
 * 111 (adaptado de `compute111`/`lines111`, server/gestoriaTax.ts): retenciones del trabajo (nóminas registradas del
 * periodo, por mes de devengo) y de actividades económicas (gastos con retención de proveedores que no son alquileres).
 * Con empleados y algún mes sin nóminas, «sin datos». Sin retenciones, sin actividad (no hay declaración negativa).
 */
export function w111(i: { year: number; period: string; hasEmployees: boolean; payrolls: PayrollRow[]; professionals: WithholdingExpense[]; ledgerHasEntries: boolean }): DraftBody {
  const warnings: string[] = [];
  const { from, to } = periodRange("111", i.year, i.period);
  const months = MONTHS.map((m) => `${i.year}-${m}`).filter((m) => m >= from.slice(0, 7) && m <= to.slice(0, 7));
  const drafts = i.payrolls.filter((p) => p.status === "draft");
  const payrolls = i.payrolls.filter((p) => p.status !== "draft");
  if (drafts.length) warnings.push(`${drafts.length} nómina(s) en borrador no cuentan hasta registrarlas`);
  const missing = i.hasEmployees ? months.filter((m) => !payrolls.some((p) => p.period === m)) : [];
  if (missing.length) {
    return body("111", i.year, i.period, { hasData: false, warnings: [...warnings, `Faltan las nóminas de ${missing.join(", ")}: regístralas (o desactiva «tiene empleados») para calcular el 111`], boxes: [box("30", "Resultado a ingresar", null)] });
  }
  if (!i.hasEmployees && !i.ledgerHasEntries && i.professionals.length === 0) return body("111", i.year, i.period, { hasData: false, warnings: ["No hay asientos contabilizados en el periodo"], boxes: [box("30", "Resultado a ingresar", null)] });
  const details: TaxDetail[] = [
    ...payrolls.map((p) => ({ box: "03", source: "payroll" as const, ref: `payroll:${p.id}`, date: `${p.period}-01`, description: `Nómina ${p.period} · ${p.employeeAlias}`, baseCents: p.grossCents, taxCents: p.irpfCents, rateBp: null })),
    ...i.professionals.map((e) => ({ box: "09", source: "expense" as const, ref: `expense:${e.id}`, date: e.date, description: `Gasto ${e.number ?? `#${e.id}`} · ${e.supplierName ?? ""}`.trim(), baseCents: e.baseCents, taxCents: e.withholdingCents, rateBp: null, taxId: e.supplierTaxId })),
  ];
  const workers = new Set(payrolls.filter((p) => p.irpfCents !== 0 || p.grossCents !== 0).map((p) => p.employeeAlias)).size;
  const pros = new Set(i.professionals.map((e) => e.supplierTaxId ?? `#${e.supplierId}`)).size;
  const b02 = sum(payrolls.map((p) => p.grossCents));
  const b03 = sum(payrolls.map((p) => p.irpfCents));
  const b08 = sum(i.professionals.map((e) => e.baseCents));
  const b09 = sum(i.professionals.map((e) => e.withholdingCents));
  const total = b03 + b09;
  return body("111", i.year, i.period, {
    boxes: [count("01", "Rendimientos del trabajo: número de perceptores", workers), box("02", "Rendimientos del trabajo: importe de las percepciones", b02), box("03", "Rendimientos del trabajo: importe de las retenciones", b03), count("07", "Actividades económicas: número de perceptores", pros), box("08", "Actividades económicas: importe de las percepciones", b08), box("09", "Actividades económicas: importe de las retenciones", b09), box("28", "Suma de retenciones", total), box("30", "Resultado a ingresar", total)],
    details,
    warnings,
    outcome: outcomeOf(total, false, "a_devolver"),
    resultCents: total,
  });
}

/** 115: retenciones de arrendamientos de inmuebles urbanos (gastos de la cuenta 621 con retención). */
export function w115(i: { year: number; period: string; rents: WithholdingExpense[]; ledgerHasEntries: boolean }): DraftBody {
  if (!i.ledgerHasEntries && i.rents.length === 0) return body("115", i.year, i.period, { hasData: false, warnings: ["No hay asientos contabilizados en el periodo"], boxes: [box("05", "Resultado a ingresar", null)] });
  const total = sum(i.rents.map((e) => e.withholdingCents));
  return body("115", i.year, i.period, {
    boxes: [count("01", "Número de perceptores", new Set(i.rents.map((e) => e.supplierTaxId ?? `#${e.supplierId}`)).size), box("02", "Base de las retenciones", sum(i.rents.map((e) => e.baseCents))), box("03", "Retenciones e ingresos a cuenta", total), box("05", "Resultado a ingresar", total)],
    details: i.rents.map((e) => ({ box: "03", source: "expense" as const, ref: `expense:${e.id}`, date: e.date, description: `Alquiler ${e.number ?? `#${e.id}`} · ${e.supplierName ?? ""}`.trim(), baseCents: e.baseCents, taxCents: e.withholdingCents, rateBp: null, taxId: e.supplierTaxId })),
    warnings: i.rents.some((e) => !e.supplierTaxId) ? ["Hay arrendadores sin NIF: el 180 los necesita"] : [],
    outcome: outcomeOf(total, false, "a_devolver"),
    resultCents: total,
  });
}

/** Resúmenes anuales 190 (trabajo, clave A, y profesionales, clave G) y 180 (arrendadores), por perceptor. */
export function annualWithholdings(model: "190" | "180", year: number, i: { payrolls: PayrollRow[]; expenses: WithholdingExpense[]; ledgerHasEntries: boolean }): DraftBody {
  const warnings: string[] = [];
  const payrolls = model === "190" ? i.payrolls.filter((p) => p.status !== "draft") : [];
  if (!i.ledgerHasEntries && payrolls.length === 0 && i.expenses.length === 0) return body(model, year, ANNUAL, { hasData: false, warnings: ["No hay asientos contabilizados en el ejercicio"], boxes: [box("03", "Importe total de las retenciones", null)] });
  const byPerceptor = new Map<string, Declarant>();
  for (const p of payrolls) {
    const k = `A|${p.employeeAlias}`;
    const d = byPerceptor.get(k) ?? { taxId: null, name: p.employeeAlias, country: "ES", key: "A", amountCents: 0, withholdingCents: 0 };
    d.amountCents += p.grossCents;
    d.withholdingCents! += p.irpfCents;
    byPerceptor.set(k, d);
  }
  for (const e of i.expenses) {
    const key = model === "190" ? "G" : "R";
    const k = `${key}|${e.supplierTaxId ?? `#${e.supplierId}`}`;
    const d = byPerceptor.get(k) ?? { taxId: e.supplierTaxId, name: e.supplierName ?? "Proveedor", country: "ES", key, amountCents: 0, withholdingCents: 0 };
    d.amountCents += e.baseCents;
    d.withholdingCents! += e.withholdingCents;
    byPerceptor.set(k, d);
  }
  const declarants = Array.from(byPerceptor.values()).sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name));
  if (payrolls.length) warnings.push("Los trabajadores figuran por su alias: la gestoría añade su NIF y sus datos al presentar el 190");
  if (declarants.some((d) => d.key !== "A" && !d.taxId)) warnings.push("Hay perceptores sin NIF: complétalo en la ficha del proveedor");
  if (model === "180" && declarants.length) warnings.push("El 180 pide la referencia catastral de cada inmueble: la añade la gestoría");
  const total = sum(declarants.map((d) => d.withholdingCents ?? 0));
  const details: TaxDetail[] = [
    ...payrolls.map((p) => ({ box: "A", source: "payroll" as const, ref: `payroll:${p.id}`, date: `${p.period}-01`, description: `Nómina ${p.period} · ${p.employeeAlias}`, baseCents: p.grossCents, taxCents: p.irpfCents, rateBp: null })),
    ...i.expenses.map((e) => ({ box: model === "190" ? "G" : "R", source: "expense" as const, ref: `expense:${e.id}`, date: e.date, description: `Gasto ${e.number ?? `#${e.id}`} · ${e.supplierName ?? ""}`.trim(), baseCents: e.baseCents, taxCents: e.withholdingCents, rateBp: null, taxId: e.supplierTaxId })),
  ];
  return body(model, year, ANNUAL, {
    boxes: model === "190" ? [count("01", "Número total de perceptores", declarants.length), box("02", "Importe total de las percepciones", sum(declarants.map((d) => d.amountCents))), box("03", "Importe total de las retenciones", total)] : [count("01", "Número total de perceptores", declarants.length), box("02", "Base de las retenciones", sum(declarants.map((d) => d.amountCents))), box("03", "Importe total de las retenciones", total)],
    details,
    declarants,
    warnings,
    outcome: declarants.length ? null : "sin_actividad",
    resultCents: null,
  });
}

/** Seguros sociales (RLC) del mes: cuota de la empresa más la del trabajador de las nóminas registradas. */
export function socialSecurity(i: { year: number; period: string; payrolls: PayrollRow[] }): DraftBody {
  const regs = i.payrolls.filter((p) => p.status !== "draft");
  if (regs.length === 0) return body("SS", i.year, i.period, { hasData: false, warnings: ["No hay nóminas registradas del mes"], boxes: [box("total", "Total a ingresar", null)] });
  const company = sum(regs.map((p) => p.ssCompanyCents));
  const worker = sum(regs.map((p) => p.ssEmployeeCents));
  return body("SS", i.year, i.period, {
    boxes: [box("empresa", "Cuota a cargo de la empresa", company), box("trabajador", "Cuota a cargo de los trabajadores", worker), box("total", "Total a ingresar", company + worker)],
    details: regs.map((p) => ({ box: "total", source: "payroll" as const, ref: `payroll:${p.id}`, date: `${p.period}-01`, description: `Nómina ${p.period} · ${p.employeeAlias}`, baseCents: p.grossCents, taxCents: p.ssCompanyCents + p.ssEmployeeCents, rateBp: null })),
    outcome: outcomeOf(company + worker, false, "a_devolver"),
    resultCents: company + worker,
  });
}

// ── 200: Impuesto sobre Sociedades ────────────────────────────────────────────────────────────────────────────────

/** Por encima de un millón de euros de base previa, la compensación de bases negativas se limita al 70 % (art. 26 LIS). */
export const BIN_FLOOR_CENTS = 100_000_000;
export const BIN_LIMIT_BP = 7000;

/** Tipo aplicable: el de la configuración, o el 15 % el primer ejercicio con base positiva y el siguiente (art. 29.1 LIS). */
export function corporateRateBp(s: Pick<TaxSettings, "corporateTaxRateBp" | "newEntityFirstProfitYear">, year: number): number {
  if (s.newEntityFirstProfitYear && year >= s.newEntityFirstProfitYear && year <= s.newEntityFirstProfitYear + 1) return 1500;
  return s.corporateTaxRateBp;
}

/** Límite de la compensación de bases negativas para una base previa positiva. */
export function lossCompensationLimit(basePreviaCents: number, newEntity: boolean): number {
  if (basePreviaCents <= 0) return 0;
  if (newEntity || basePreviaCents <= BIN_FLOOR_CENTS) return basePreviaCents;
  return Math.max(BIN_FLOOR_CENTS, Math.round((basePreviaCents * BIN_LIMIT_BP) / 10_000));
}

export interface NegativeBase {
  originYear: number;
  amountCents: number;
  /** De dónde sale: ajuste manual o el 200 del ejercicio anterior. */
  source: string;
}

export interface Corporate200Input {
  year: number;
  rateBp: number;
  /** Primeros tres ejercicios con base positiva de una entidad de nueva creación: sin límite de compensación. */
  newEntity: boolean;
  /** Sin asientos de ingresos ni gastos en el ejercicio: «sin datos». */
  hasData: boolean;
  /** Resultado contable (ingresos − gastos, grupos 6 y 7 sin regularización ni cierre). */
  accountingResultCents: number;
  /** Gasto por impuesto sobre beneficios contabilizado (630): no deducible, ajuste positivo. */
  taxExpenseCents: number;
  /** Retenciones soportadas en el libro (473 que no son pagos fraccionados). */
  withholdings473Cents: number;
  /** Pagos fraccionados (202) pagados del ejercicio. */
  installmentsPaidCents: number;
  adjustments: Array<{ id: number; kind: string; description: string; amountCents: number; originYear: number | null }>;
  /** Bases negativas pendientes que deja el 200 del ejercicio anterior calculado en el sistema (null = no hay). */
  previousPending: Array<{ originYear: number; amountCents: number }> | null;
  previousSource: string | null;
  details: TaxDetail[];
  /**
   * CRM 0039: configuración del ejercicio (escala por tramos, reservas de capitalización y nivelación). null = sin
   * configurar: tipo único de la configuración fiscal y aviso `corporate_year_unset` (con `fiscal`).
   */
  corporate?: Pick<CorporateYearConfig, "regime" | "brackets" | "capReserveEquityIncreaseCents" | "capReserveRateBp" | "capReserveLimitBp" | "levellingReserveCents"> | null;
  /** Migración 0039 aplicada (cambia el aviso del tipo único por el de ejercicio sin configurar). */
  fiscal?: boolean;
}

/** Bases negativas disponibles y su aplicación, de la más antigua a la más reciente. */
export function applyNegativeBases(bases: NegativeBase[], compensationCents: number): Array<NegativeBase & { appliedCents: number }> {
  let left = compensationCents;
  return [...bases]
    .sort((a, b) => a.originYear - b.originYear)
    .map((x) => {
      const applied = Math.max(0, Math.min(x.amountCents, left));
      left -= applied;
      return { ...x, appliedCents: applied };
    });
}

// ── Impuesto sobre Sociedades por ejercicio: escala, presets y reservas (CRM 0039) ───────────────────────────────

export const CORPORATE_YEAR_UNSET_WARNING = "Impuesto sobre Sociedades del ejercicio sin configurar (régimen y tramos): se calcula con el tipo único de la configuración fiscal y el 200 no se puede revisar (corporate_year_unset)";
export const CAP_RESERVE_WARNING = "Reserva de capitalización (art. 25 LIS): exige dotar una reserva indisponible por el importe de la reducción y mantener el incremento de fondos propios durante 3 años";
export const PRESET_NOTICE = "Propuesta: confírmala con tu gestoría";
/** Tope de la escala de las microempresas: los primeros 50.000 € de base imponible. */
export const MICRO_FIRST_BRACKET_CENTS = 5_000_000;
/** Tope de la reserva de nivelación: 10 % de la base imponible y 1 millón de euros (art. 105 LIS). */
export const LEVELLING_RATE_BP = 1000;
export const LEVELLING_MAX_CENTS = 100_000_000;

/** Escala transitoria de la Ley 7/2024 por ejercicio (2029 y siguientes, la definitiva). */
const MICRO_RATES: Record<number, [number, number]> = { 2025: [2100, 2200], 2026: [2000, 2100], 2027: [1900, 2100], 2028: [1800, 2000] };
const ERD_RATES: Record<number, number> = { 2025: 2400, 2026: 2300, 2027: 2200, 2028: 2100 };

/**
 * Propuestas de escala del ejercicio (el operador elige una y la confirma; se guardan sus tramos, nunca el nombre):
 * tipo general (25 %), entidad de nueva creación (15 %, art. 29.1 LIS, primer ejercicio con base positiva y el
 * siguiente) y, desde 2025, microempresa (cifra de negocios < 1 M€) y entidad de reducida dimensión (< 10 M€) con la
 * escala transitoria de la Ley 7/2024. Todas llevan su cita y «Propuesta: confírmala con tu gestoría».
 */
export function corporatePresets(year: number): CorporatePreset[] {
  const out: CorporatePreset[] = [
    { key: "general", regime: "general", label: "Tipo general (25 %)", brackets: [{ uptoCents: null, rateBp: 2500 }], capReserveLimitBp: 2000, citation: "Art. 29.1 de la Ley 27/2014, del Impuesto sobre Sociedades: tipo general del 25 %", notice: PRESET_NOTICE },
    { key: "nueva_creacion", regime: "nueva_creacion", label: "Entidad de nueva creación (15 %)", brackets: [{ uptoCents: null, rateBp: 1500 }], capReserveLimitBp: 2000, citation: "Art. 29.1 LIS: entidades de nueva creación, 15 % en el primer periodo con base imponible positiva y en el siguiente", notice: PRESET_NOTICE },
  ];
  if (year >= 2025) {
    const [first, rest] = MICRO_RATES[year] ?? [1700, 2000];
    out.push({
      key: "microempresa",
      regime: "microempresa",
      label: `Microempresa: ${first / 100} % hasta 50.000 € y ${rest / 100} % el resto`,
      brackets: [
        { uptoCents: MICRO_FIRST_BRACKET_CENTS, rateBp: first },
        { uptoCents: null, rateBp: rest },
      ],
      capReserveLimitBp: 2500,
      citation: "Art. 29.1 LIS y su disposición transitoria (Ley 7/2024): microempresas, importe neto de la cifra de negocios del periodo anterior inferior a 1 millón de euros",
      notice: PRESET_NOTICE,
    });
    const erd = ERD_RATES[year] ?? 2000;
    out.push({ key: "erd", regime: "erd", label: `Entidad de reducida dimensión (${erd / 100} %)`, brackets: [{ uptoCents: null, rateBp: erd }], capReserveLimitBp: 2000, citation: "Art. 29.1 LIS y su disposición transitoria (Ley 7/2024): entidades de reducida dimensión (cifra de negocios inferior a 10 millones de euros) que no son microempresa", notice: PRESET_NOTICE });
  }
  return out;
}

/** Valida la configuración de un ejercicio: tramos ordenados con tope creciente, el último sin tope, tipos de 0 a 10000. */
export function checkCorporateYear(i: CorporateYearInput): CorporateYearInput {
  if (!(CORPORATE_REGIMES as readonly string[]).includes(i.regime)) throw bad("Régimen no válido: general, nueva_creacion, erd, microempresa u otro");
  if (!Array.isArray(i.brackets) || i.brackets.length === 0 || i.brackets.length > 10) throw bad("Indica de 1 a 10 tramos");
  let prev = 0;
  i.brackets.forEach((b, n) => {
    const last = n === i.brackets.length - 1;
    if (!Number.isInteger(b.rateBp) || b.rateBp < 0 || b.rateBp > 10_000) throw bad("El tipo de cada tramo va de 0 a 10000 puntos básicos");
    if (last && b.uptoCents !== null) throw bad("El último tramo no tiene tope (uptoCents: null)");
    if (!last && (b.uptoCents === null || !Number.isSafeInteger(b.uptoCents) || b.uptoCents <= prev)) throw bad("Los tramos van ordenados, con tope creciente (en céntimos de base imponible), salvo el último");
    if (!last) prev = b.uptoCents!;
  });
  for (const [v, what] of [[i.netTurnoverCents, "La cifra de negocios"], [i.capReserveEquityIncreaseCents, "El incremento de fondos propios"], [i.levellingReserveCents, "La reserva de nivelación"]] as const) if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw bad(`${what} es un importe en céntimos no negativo`);
  for (const [v, what] of [[i.capReserveRateBp, "La tasa de la reserva de capitalización"], [i.capReserveLimitBp, "El límite de la reserva de capitalización"]] as const) if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10_000)) throw bad(`${what} va de 0 a 10000 puntos básicos`);
  if (i.capReserveEquityIncreaseCents !== null && (i.capReserveRateBp === null || i.capReserveLimitBp === null)) throw bad("Con reserva de capitalización indica su tasa y su límite (sugeridos 2000 y 2000; 2500 de límite con cifra de negocios < 1 M€)");
  const notes = (i.notes ?? "").trim();
  return { ...i, brackets: i.brackets.map((b) => ({ uptoCents: b.uptoCents, rateBp: b.rateBp })), notes: notes ? notes.slice(0, 4000) : null };
}

/** Cuota íntegra por tramos con el detalle de cada uno (base imponible positiva; cada tramo redondeado a céntimos). */
export function bracketQuota(baseCents: number, brackets: readonly CorporateBracket[]): { quotaCents: number; rows: Array<{ fromCents: number; uptoCents: number | null; rateBp: number; baseCents: number; quotaCents: number }> } {
  let from = 0;
  const rows = brackets.map((b) => {
    const top = b.uptoCents ?? Number.MAX_SAFE_INTEGER;
    const portion = Math.max(0, Math.min(baseCents, top) - from);
    const row = { fromCents: from, uptoCents: b.uptoCents, rateBp: b.rateBp, baseCents: portion, quotaCents: portion > 0 ? taxOf(portion, b.rateBp) : 0 };
    from = top;
    return row;
  });
  return { quotaCents: sum(rows.map((r) => r.quotaCents)), rows };
}

/**
 * Reducción por reserva de capitalización (art. 25 LIS): el menor de incremento de fondos propios × tasa y base previa
 * a la reducción × límite. Sin incremento o con base no positiva, cero.
 */
export function capitalizationReduction(basePreviaCents: number, c: { equityIncreaseCents: number | null; rateBp: number | null; limitBp: number | null }): number {
  if (basePreviaCents <= 0 || !c.equityIncreaseCents || c.rateBp === null || c.limitBp === null) return 0;
  return Math.max(0, Math.min(taxOf(c.equityIncreaseCents, c.rateBp), taxOf(basePreviaCents, c.limitBp)));
}

/**
 * Modelo 200 (adaptado de `computeCorporate`/`lines200`, server/gestoriaTax.ts): resultado contable, ajuste por el
 * propio impuesto, ajustes extracontables manuales, compensación de bases negativas (las más antiguas primero) con su
 * límite, cuota íntegra al tipo configurado, deducciones, retenciones (473 y manuales) y pagos fraccionados pagados →
 * cuota diferencial. Las bases negativas pendientes al final (por ejercicio de origen) las recoge el 200 siguiente.
 * CRM 0039, con el ejercicio configurado: base previa → reducción por reserva de capitalización (casilla 01032) y de
 * nivelación (solo entidades de reducida dimensión) → compensación de bases negativas (límite sobre la base previa) →
 * base imponible → cuota por tramos (detalle de cada tramo). Sin configurar, el cálculo de antes (tipo único).
 */
export function corporate200(i: Corporate200Input): DraftBody {
  const warnings: string[] = [];
  if (!i.hasData) return body("200", i.year, ANNUAL, { hasData: false, warnings: ["No hay ingresos ni gastos contabilizados en el ejercicio"], boxes: [box("00599", "Cuota diferencial", null)] });
  const cfg = i.corporate ?? null;
  const adj = (k: string) => i.adjustments.filter((a) => a.kind === k);
  const total = (k: string) => sum(adj(k).map((a) => a.amountCents));
  const increases = total("increase");
  const decreases = total("decrease");
  const basePrevia = i.accountingResultCents + i.taxExpenseCents + increases - decreases;
  // Reservas (solo con el ejercicio configurado)
  const capReduction = cfg ? capitalizationReduction(basePrevia, { equityIncreaseCents: cfg.capReserveEquityIncreaseCents, rateBp: cfg.capReserveRateBp, limitBp: cfg.capReserveLimitBp }) : 0;
  const afterCap = basePrevia - capReduction;
  const levellingAllowed = !!cfg && (cfg.regime === "erd" || cfg.regime === "microempresa");
  const levelling = cfg && levellingAllowed && cfg.levellingReserveCents && afterCap > 0 ? Math.min(cfg.levellingReserveCents, taxOf(afterCap, LEVELLING_RATE_BP), LEVELLING_MAX_CENTS) : 0;
  if (cfg?.levellingReserveCents && !levellingAllowed) warnings.push("La reserva de nivelación solo la aplican las entidades de reducida dimensión: no se ha aplicado");
  if (cfg && cfg.levellingReserveCents && levelling < cfg.levellingReserveCents && levellingAllowed) warnings.push("La reserva de nivelación se limita al 10 % de la base imponible y a 1 millón de euros");
  const beforeBins = afterCap - levelling;
  const bases: NegativeBase[] = [
    ...(i.previousPending ?? []).map((x) => ({ ...x, source: i.previousSource ?? "obligation" })),
    ...adj("negative_base").map((a) => ({ originYear: a.originYear ?? i.year - 1, amountCents: a.amountCents, source: `adjustment:${a.id}` })),
  ];
  const available = sum(bases.map((x) => x.amountCents));
  const compensation = Math.min(available, lossCompensationLimit(basePrevia, i.newEntity), Math.max(0, beforeBins));
  const applied = applyNegativeBases(bases, compensation);
  const bi = beforeBins - compensation;
  const pending = applied.map((x) => ({ originYear: x.originYear, amountCents: x.amountCents - x.appliedCents })).filter((x) => x.amountCents > 0);
  if (bi < 0) pending.push({ originYear: i.year, amountCents: -bi });
  const scale = cfg ? bracketQuota(Math.max(0, bi), cfg.brackets) : null;
  const cuotaIntegra = bi > 0 ? (scale ? scale.quotaCents : taxOf(bi, i.rateBp)) : 0;
  // Tipo del borrador: el único configurado o, con escala, el efectivo (cuota íntegra / base imponible)
  const rateBp = cfg ? (cfg.brackets.length === 1 ? cfg.brackets[0].rateBp : bi > 0 ? Math.round((cuotaIntegra * 10_000) / bi) : cfg.brackets[0].rateBp) : i.rateBp;
  const deductions = Math.min(total("deduction"), cuotaIntegra);
  if (total("deduction") > cuotaIntegra) warnings.push("Las deducciones superan la cuota íntegra: el exceso no se aplica este año (se arrastra según su régimen)");
  const cuotaLiquida = cuotaIntegra - deductions;
  const withholdings = i.withholdings473Cents + total("withholding");
  const differential = cuotaLiquida - withholdings - i.installmentsPaidCents;
  if (i.previousPending === null && adj("negative_base").length === 0) warnings.push("Sin 200 del ejercicio anterior en el sistema: si hay bases negativas pendientes, regístralas como ajuste «negative_base» con su ejercicio de origen");
  if (!cfg) warnings.push(i.fiscal ? CORPORATE_YEAR_UNSET_WARNING : "Tipo único configurado: los tipos reducidos de microempresas (Ley 7/2024) y la reserva de capitalización no se calculan; revísalos con la gestoría");
  if (cfg && cfg.capReserveEquityIncreaseCents) warnings.push(CAP_RESERVE_WARNING);
  const details: TaxDetail[] = [
    ...i.details,
    ...i.adjustments.map((a) => ({ box: a.kind, source: "adjustment" as const, ref: `adjustment:${a.id}`, date: null, description: `${a.description}${a.originYear ? ` (ejercicio ${a.originYear})` : ""}`, baseCents: null, taxCents: a.amountCents, rateBp: null })),
    ...applied.filter((x) => !x.source.startsWith("adjustment:")).map((x) => ({ box: "00547", source: "obligation" as const, ref: x.source, date: null, description: `Base negativa pendiente del ejercicio ${x.originYear}`, baseCents: x.amountCents, taxCents: x.appliedCents, rateBp: null })),
    ...(scale && bi > 0 ? scale.rows.filter((r) => r.baseCents > 0).map((r, n) => ({ box: "00562", source: "settings" as const, ref: `corporate-year:${i.year}:tramo:${n + 1}`, date: null, description: `Tramo ${n + 1}: ${r.uptoCents === null ? `desde ${eur(r.fromCents)} €` : `de ${eur(r.fromCents)} a ${eur(r.uptoCents)} €`} al ${r.rateBp / 100} %`, baseCents: r.baseCents, taxCents: r.quotaCents, rateBp: r.rateBp })) : []),
  ];
  const reductions = cfg ? [box("01032", "Reducción por reserva de capitalización", capReduction), ...(cfg.levellingReserveCents || levelling ? [box("nivelacion", "Reducción por reserva de nivelación", levelling)] : [])] : [];
  return body("200", i.year, ANNUAL, {
    boxes: [
      box("00501", "Resultado de la cuenta de pérdidas y ganancias", i.accountingResultCents),
      box("ajuste_is", "Aumento: impuesto sobre sociedades contabilizado", i.taxExpenseCents),
      box("ajustes_aumento", "Otros aumentos extracontables", increases),
      box("ajustes_disminucion", "Disminuciones extracontables", decreases),
      box("00550", "Base imponible previa a la compensación", basePrevia),
      ...reductions,
      box("00547", "Compensación de bases imponibles negativas de periodos anteriores", compensation),
      box("00552", "Base imponible", bi),
      bpBox("tipo", cfg && cfg.brackets.length > 1 ? `Tipo de gravamen efectivo por tramos (${rateBp / 100} %)` : `Tipo de gravamen (${rateBp / 100} %)`, rateBp),
      box("00562", "Cuota íntegra", cuotaIntegra),
      box("deducciones", "Deducciones y bonificaciones", deductions),
      box("00592", "Cuota líquida positiva", cuotaLiquida),
      box("00595", "Retenciones e ingresos a cuenta", withholdings),
      box("00598", "Pagos fraccionados", i.installmentsPaidCents),
      box("00599", "Cuota diferencial", differential),
    ],
    details,
    warnings,
    outcome: outcomeOf(differential, i.accountingResultCents !== 0, "a_devolver"),
    resultCents: differential,
    extra: {
      rateBp,
      basePreviaCents: basePrevia,
      cuotaIntegraCents: cuotaIntegra,
      deduccionesCents: deductions,
      retencionesCents: withholdings,
      pendingLossesAfterCents: sum(pending.map((x) => x.amountCents)),
      pendingLossesJson: JSON.stringify(pending),
      negativeBasesJson: JSON.stringify(applied.map((x) => ({ originYear: x.originYear, amountCents: x.amountCents, appliedCents: x.appliedCents, source: x.source }))),
      // CRM 0039 (solo con el ejercicio configurado: sin él, la huella de los borradores anteriores no cambia)
      ...(cfg ? { regime: cfg.regime, capitalizationReserveCents: capReduction, levellingReductionCents: levelling, cuotaLiquidaCents: cuotaLiquida, bracketsJson: JSON.stringify(scale ? scale.rows : []) } : {}),
    },
  });
}

// ── Asiento del Impuesto sobre Sociedades (CRM 0039) ─────────────────────────────────────────────────────────────

/** Cuentas del asiento (las que falten en el plan se dan de alta como subcuentas del PGC antes de contabilizar). */
export const CORPORATE_ENTRY_ACCOUNTS = {
  currentTax: { code: "6300", name: "Impuesto corriente", parent: "630" },
  deferredTax: { code: "6301", name: "Impuesto diferido", parent: "630" },
  withholdings: { code: "473", name: "Hacienda Pública, retenciones y pagos a cuenta", parent: null },
  payable: { code: "4752", name: "Hacienda Pública, acreedora por impuesto sobre sociedades", parent: "475" },
  refundable: { code: "4709", name: "Hacienda Pública, deudora por devolución de impuestos", parent: "470" },
  deferredAsset: { code: "4740", name: "Activos por diferencias temporarias deducibles", parent: "474" },
  deferredLiability: { code: "479", name: "Pasivos por diferencias temporarias imponibles", parent: null },
} as const;
/** Cuentas de mayor (3 dígitos) que el PGC define y el plan sembrado no trae: se crean con su tipo si hacen falta. */
export const CORPORATE_PARENT_ACCOUNTS: Record<string, { name: string; type: "asset" | "liability" }> = {
  "474": { name: "Activos por impuesto diferido", type: "asset" },
  "479": { name: "Pasivos por diferencias temporarias imponibles", type: "liability" },
};

export const corporateEntrySourceKey = (year: number, seq: number) => (seq <= 1 ? `tax:200:entry:${year}` : `tax:200:entry:${year}:${seq}`);

/**
 * Asiento del Impuesto sobre Sociedades (diario IMP): Debe 6300 (impuesto corriente) · Haber 473 (retenciones y pagos
 * a cuenta, hasta su saldo) · Haber 4752 (a ingresar) o Debe 4709 (a devolver); el diferido opcional: gasto (> 0)
 * Debe 6301 · Haber 479; ingreso (< 0) Debe 4740 · Haber 6301. `source_key = tax:200:entry:<año>[:<n>]`.
 */
export function corporateEntryDraft(i: { year: number; seq: number; date: string; currentTaxCents: number; deferredTaxCents: number; withholdingsCents: number; origin: string }): EntryDraft {
  for (const [v, what] of [[i.currentTaxCents, "El impuesto corriente"], [i.withholdingsCents, "Las retenciones y pagos a cuenta"]] as const) if (!Number.isSafeInteger(v) || v < 0) throw bad(`${what} es un importe en céntimos no negativo`);
  if (!Number.isSafeInteger(i.deferredTaxCents)) throw bad("El impuesto diferido es un importe en céntimos (con signo)");
  const a = CORPORATE_ENTRY_ACCOUNTS;
  const label = `Impuesto sobre Sociedades del ejercicio ${i.year} (${i.origin === "system" ? "borrador del sistema" : i.origin === "gestoria" ? "importes de la gestoría" : "importes manuales"})`;
  const diff = i.currentTaxCents - i.withholdingsCents;
  const lines: EntryLineInput[] = [
    ...signed(a.currentTax.code, i.currentTaxCents, "debit", { description: "Impuesto corriente" }),
    ...signed(a.withholdings.code, i.withholdingsCents, "credit", { description: "Retenciones y pagos a cuenta del ejercicio" }),
    ...(diff > 0 ? signed(a.payable.code, diff, "credit", { description: "Impuesto a ingresar" }) : signed(a.refundable.code, -diff, "debit", { description: "Impuesto a devolver" })),
    ...(i.deferredTaxCents > 0 ? [...signed(a.deferredTax.code, i.deferredTaxCents, "debit", { description: "Impuesto diferido (gasto)" }), ...signed(a.deferredLiability.code, i.deferredTaxCents, "credit", { description: "Pasivo por diferencias temporarias imponibles" })] : []),
    ...(i.deferredTaxCents < 0 ? [...signed(a.deferredAsset.code, -i.deferredTaxCents, "debit", { description: "Activo por diferencias temporarias deducibles" }), ...signed(a.deferredTax.code, -i.deferredTaxCents, "credit", { description: "Impuesto diferido (ingreso)" })] : []),
  ];
  if (!lines.length) throw bad("No hay nada que contabilizar: el impuesto corriente, las retenciones y el diferido son cero");
  return { journalCode: "IMP", date: i.date, description: label, origin: "tax", sourceKey: corporateEntrySourceKey(i.year, i.seq), lines };
}

// ── 202: pagos fraccionados ───────────────────────────────────────────────────────────────────────────────────────

export const ART40_2_RATE_BP = 1800;

/** Coeficiente del art. 40.3: 5/7 del tipo redondeado por defecto (17 % con el 25 %; 10 % con el 15 %). */
export const art40_3CoefficientBp = (rateBp: number) => Math.floor((rateBp * 5) / 7 / 100) * 100;

/** Qué 200 sirve de base del pago (art. 40.2): el último vencido el día 1 del plazo (abril: año −2; octubre y diciembre: año −1). */
export const baseYearFor202 = (year: number, period: string) => (period === "1P" ? year - 2 : year - 1);

export interface Installment202Input {
  year: number;
  period: string;
  method: InstallmentMethod;
  /** Art. 40.2: el 200 de referencia (cuota íntegra, deducciones y retenciones). */
  last200: { year: number; cuotaIntegraCents: number; deduccionesCents: number; retencionesCents: number; source: string } | null;
  /** Art. 40.3: resultado acumulado (con el ajuste del 630), bases negativas disponibles, retenciones y pagos previos. */
  cumulative?: { resultCents: number; lossesAvailableCents: number; withholdingsCents: number; previousPaymentsCents: number; rateBp: number; hasData: boolean; newEntity: boolean };
}

export function installment202(i: Installment202Input): DraftBody {
  if (i.method === "art40_2") {
    const y = baseYearFor202(i.year, i.period);
    if (!i.last200) return body("202", i.year, i.period, { hasData: false, warnings: [`Falta el modelo 200 del ejercicio ${y} en el sistema: calcúlalo o regístralo para conocer la base del pago (art. 40.2)`], boxes: [box("resultado", "Resultado a ingresar", null)] });
    const base = i.last200.cuotaIntegraCents - i.last200.deduccionesCents - i.last200.retencionesCents;
    const pay = base > 0 ? taxOf(base, ART40_2_RATE_BP) : 0;
    return body("202", i.year, i.period, {
      applicable: base > 0,
      reason: base > 0 ? null : `La cuota del 200 de ${y} (menos deducciones y retenciones) no es positiva: no hay pago fraccionado por el art. 40.2`,
      boxes: [box("cuota_integra", `Cuota íntegra del 200 de ${y}`, i.last200.cuotaIntegraCents), box("deducciones", "Deducciones y bonificaciones", i.last200.deduccionesCents), box("retenciones", "Retenciones e ingresos a cuenta", i.last200.retencionesCents), box("base", "Base del pago fraccionado", base), bpBox("porcentaje", "Porcentaje (18 %)", ART40_2_RATE_BP), box("resultado", "Resultado a ingresar", pay)],
      details: [{ box: "base", source: "obligation", ref: i.last200.source, date: null, description: `Modelo 200 del ejercicio ${y}`, baseCents: base, taxCents: null, rateBp: ART40_2_RATE_BP }],
      outcome: pay > 0 ? "a_ingresar" : "sin_actividad",
      resultCents: pay,
      extra: { baseYear: y, method: "art40_2" },
    });
  }
  const c = i.cumulative!;
  if (!c.hasData) return body("202", i.year, i.period, { hasData: false, warnings: ["No hay ingresos ni gastos contabilizados en el periodo"], boxes: [box("resultado", "Resultado a ingresar", null)] });
  const coef = art40_3CoefficientBp(c.rateBp);
  const compensation = Math.min(c.lossesAvailableCents, lossCompensationLimit(c.resultCents, c.newEntity));
  const base = Math.max(0, c.resultCents - compensation);
  const gross = taxOf(base, coef);
  const pay = Math.max(0, gross - c.withholdingsCents - c.previousPaymentsCents);
  return body("202", i.year, i.period, {
    boxes: [box("resultado_acumulado", "Resultado acumulado del periodo", c.resultCents), box("compensacion", "Compensación de bases negativas", compensation), box("base", "Base del pago fraccionado", base), bpBox("porcentaje", `Porcentaje (${coef / 100} %)`, coef), box("pago_bruto", "Importe resultante", gross), box("retenciones", "Retenciones e ingresos a cuenta del periodo", c.withholdingsCents), box("pagos_anteriores", "Pagos fraccionados anteriores del ejercicio", c.previousPaymentsCents), box("resultado", "Resultado a ingresar", pay)],
    warnings: ["Modalidad del art. 40.3 (obligatoria con más de 6 millones de cifra de negocios): con más de 10 millones hay pago mínimo del 23 % que aquí no se calcula"],
    outcome: pay > 0 ? "a_ingresar" : "sin_actividad",
    resultCents: pay,
    extra: { method: "art40_3", coefficientBp: coef },
  });
}

// ── Avisos de vencimiento ─────────────────────────────────────────────────────────────────────────────────────────

/** Umbrales de aviso (días antes del vencimiento). Patrón `lastReminderDays` de server/taxReminderJob.ts. */
export const REMINDER_THRESHOLDS = [15, 7, 3] as const;

/** Umbral que toca avisar hoy (o null): el menor umbral alcanzado que aún no se avisó. */
export function reminderBucket(daysLeft: number, lastReminderDays: number | null): number | null {
  if (daysLeft < 0) return null;
  const bucket = [...REMINDER_THRESHOLDS].sort((a, b) => a - b).find((t) => daysLeft <= t);
  if (bucket === undefined) return null;
  if (lastReminderDays !== null && lastReminderDays <= bucket) return null;
  return bucket;
}

// ── Asientos ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const vatSettlementSourceKey = (year: number, period: string) => `tax:303:${year}:${period}`;
export const taxPaymentSourceKey = (obligationId: number) => `tax-payment:${obligationId}`;
export const payrollSourceKey = (id: number) => `payroll:${id}`;
export const payrollPaymentSourceKey = (id: number) => `payroll-payment:${id}`;
export const deferralInstallmentSourceKey = (deferralId: number, n: number) => `tax-deferral:${deferralId}:${n}`;

/**
 * Liquidación del IVA al presentar el 303 (diario IMP, último día del periodo): Debe 477 (devengado) · Haber 472
 * (deducible) · Haber 4700 (compensación aplicada de periodos anteriores) · Haber 4750 (a ingresar) o Debe 4700 (a
 * compensar o a devolver). Sin importes, ningún asiento. `source_key = tax:303:<año>:<periodo>`.
 */
export function vatSettlementEntry(i: { year: number; period: string; date: string; devengadoCents: number; deducibleCents: number; compensadoCents: number; resultCents: number }): EntryDraft | null {
  if (i.devengadoCents - i.deducibleCents - i.compensadoCents !== i.resultCents) throw bad("La liquidación del IVA no cuadra con el resultado del 303");
  const label = `Liquidación del IVA ${periodLabel(i.year, i.period)} (modelo 303)`;
  const lines: EntryLineInput[] = [
    ...signed("477", i.devengadoCents, "debit", { description: "IVA devengado del periodo" }),
    ...signed("472", i.deducibleCents, "credit", { description: "IVA deducible del periodo" }),
    ...signed("4700", i.compensadoCents, "credit", { description: "Compensación de periodos anteriores" }),
    ...signed("4750", i.resultCents, "credit", { description: i.resultCents > 0 ? "Resultado a ingresar" : "Resultado a compensar o devolver" }),
  ].map((l) => (l.accountCode === "4750" && l.debitCents > 0 ? { ...l, accountCode: "4700" } : l));
  if (!lines.length) return null;
  return { journalCode: "IMP", date: i.date, description: label, origin: "tax", sourceKey: vatSettlementSourceKey(i.year, i.period), lines };
}

/** Pago de una obligación: Debe cuenta del modelo (4750, 4751, 4752, 473, 476) · Haber banco. */
export function taxPaymentEntry(i: { obligationId: number; model: TaxModel; year: number; period: string; date: string; amountCents: number; bankAccountCode: string }): EntryDraft {
  const account = PAYMENT_ACCOUNT[i.model];
  if (!account || INFORMATIVE_MODELS.includes(i.model)) throw new FinanceError("invalid_state", `El modelo ${i.model} es informativo: no tiene pago`);
  if (!Number.isSafeInteger(i.amountCents) || i.amountCents <= 0) throw bad("El importe del pago es un número de céntimos mayor que cero");
  const label = `Pago del modelo ${i.model} ${periodLabel(i.year, i.period)}`;
  return { journalCode: "IMP", date: i.date, description: label, origin: "tax", sourceKey: taxPaymentSourceKey(i.obligationId), lines: [...signed(account, i.amountCents, "debit", { description: label }), ...signed(i.bankAccountCode, i.amountCents, "credit", { description: label })] };
}

/**
 * Nómina (diario NOM, último día del mes): Debe 640 (bruto) · Debe 642 (Seguridad Social a cargo de la empresa) ·
 * Haber 4751 (IRPF retenido) · Haber 476 (cuotas del trabajador y de la empresa) · Haber 465 (líquido a pagar).
 */
export function payrollEntry(p: { id: number; period: string; employeeAlias: string; grossCents: number; irpfCents: number; ssEmployeeCents: number; ssCompanyCents: number; netCents: number }): EntryDraft {
  if (p.grossCents !== p.irpfCents + p.ssEmployeeCents + p.netCents) throw bad("La nómina no cuadra: bruto = IRPF + Seguridad Social del trabajador + líquido");
  const [y, m] = p.period.split("-").map(Number);
  const label = `Nómina ${p.period} · ${p.employeeAlias}`;
  return {
    journalCode: "NOM",
    date: monthEnd(y, m),
    description: label,
    origin: "payroll",
    sourceKey: payrollSourceKey(p.id),
    lines: [
      ...signed("640", p.grossCents, "debit", { description: label }),
      ...signed("642", p.ssCompanyCents, "debit", { description: "Seguridad Social a cargo de la empresa" }),
      ...signed("4751", p.irpfCents, "credit", { description: "IRPF retenido" }),
      ...signed("476", p.ssEmployeeCents + p.ssCompanyCents, "credit", { description: "Cuotas de la Seguridad Social" }),
      ...signed("465", p.netCents, "credit", { description: "Líquido a pagar" }),
    ],
  };
}

/** Pago de la nómina: Debe 465 · Haber banco. */
export function payrollPaymentEntry(p: { id: number; period: string; employeeAlias: string; netCents: number; date: string; bankAccountCode: string }): EntryDraft {
  const label = `Pago de la nómina ${p.period} · ${p.employeeAlias}`;
  return { journalCode: "BAN", date: p.date, description: label, origin: "payroll", sourceKey: payrollPaymentSourceKey(p.id), lines: [...signed("465", p.netCents, "debit", { description: label }), ...signed(p.bankAccountCode, p.netCents, "credit", { description: label })] };
}

/** Cuota de un aplazamiento: Debe cuenta del modelo (principal) · Debe 669 (intereses) · Haber banco. */
export function deferralInstallmentEntry(i: { deferralId: number; number: number; model: TaxModel; date: string; amountCents: number; interestCents: number; bankAccountCode: string; label: string }): EntryDraft {
  const account = PAYMENT_ACCOUNT[i.model];
  if (!account) throw new FinanceError("invalid_state", `El modelo ${i.model} no tiene pago que aplazar`);
  const label = `${i.label}: cuota ${i.number}`;
  return {
    journalCode: "IMP",
    date: i.date,
    description: label,
    origin: "tax",
    sourceKey: deferralInstallmentSourceKey(i.deferralId, i.number),
    lines: [...signed(account, i.amountCents, "debit", { description: label }), ...signed("669", i.interestCents, "debit", { description: "Intereses del aplazamiento" }), ...signed(i.bankAccountCode, i.amountCents + i.interestCents, "credit", { description: label })],
  };
}

// ── Libros registro y exportaciones (CSV «;», BOM, euros con coma) ────────────────────────────────────────────────

export interface ReceivedRegisterRow {
  invoiceDate: string;
  accrualDate: string | null;
  number: string | null;
  kind: string;
  supplierName: string;
  supplierTaxId: string | null;
  country: string | null;
  baseCents: number;
  taxRateBp: number;
  taxCents: number;
  deductibleTaxCents: number;
  withholdingCents: number;
  totalCents: number;
  rectifies: string | null;
  reverseCharge: boolean;
  /** CRM 0039: tratamiento del IVA en texto («Interior» si no se indica). */
  treatment?: string | null;
}

/** Libro registro de facturas recibidas: gastos registrados y comisiones de Stripe con inversión del sujeto pasivo. */
export function receivedRegisterCsv(rows: ReceivedRegisterRow[]): string {
  const sorted = [...rows].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || (a.number ?? "").localeCompare(b.number ?? ""));
  return toCsv(
    ["Fecha de expedición", "Fecha de devengo", "Número", "Tipo", "Proveedor", "NIF del proveedor", "País", "Base imponible", "Tipo de IVA (%)", "Cuota de IVA", "Cuota deducible", "Retención", "Total", "Factura rectificada", "Inversión del sujeto pasivo", "Tratamiento IVA"],
    sorted.map((r) => [esDate(r.invoiceDate), r.accrualDate ? esDate(r.accrualDate) : "", csvText(r.number), r.kind, csvText(r.supplierName), csvText(r.supplierTaxId), csvText(r.country), eur(r.baseCents), eur(r.taxRateBp), eur(r.taxCents), eur(r.deductibleTaxCents), eur(r.withholdingCents), eur(r.totalCents), csvText(r.rectifies), r.reverseCharge ? "Sí" : "No", csvText(r.treatment ?? VAT_TREATMENT_LABELS.domestic)]),
  );
}

/** Incidencias que se añaden al libro de expedidas: cobros de Stripe sin factura propia (no se inventan facturas). */
export function issuedIncidentsCsv(rows: Array<{ date: string; transactionId: string; description: string | null; grossCents: number }>): string {
  if (!rows.length) return "";
  return ["", "Incidencias: cobros de Stripe sin factura propia (no figuran en el libro hasta que se expida su factura)", ["Fecha del cobro", "Transacción", "Descripción", "Importe bruto"].join(";"), ...rows.map((r) => [esDate(r.date), csvText(r.transactionId), csvText(r.description), eur(r.grossCents)].join(";"))].join("\r\n") + "\r\n";
}

/** Borrador de un modelo en CSV legible (casillas, declarados, detalle de origen y avisos). */
export function draftCsv(d: TaxDraft, label: string): string {
  const out: string[][] = [["Modelo", csvText(`${d.model} · ${MODEL_NAMES[d.model]}`), "", ""], ["Periodo", csvText(label), "", ""], ["Aviso", csvText(d.notice), "", ""], ["Huella", d.hash, "", ""], ["", "", "", ""], ["Casilla", "Concepto", "Importe", ""]];
  for (const b of d.boxes) out.push([csvText(b.box), csvText(b.label), b.valueCents === null ? "sin datos" : b.unit === "bp" ? `${eur(b.valueCents)} %` : b.unit === "count" ? String(b.valueCents) : eur(b.valueCents), ""]);
  if (d.declarants.length) {
    out.push(["", "", "", ""], ["Clave", "NIF", "Nombre", "Importe"]);
    for (const x of d.declarants) out.push([x.key, csvText(x.taxId), csvText(x.name), eur(x.amountCents)]);
  }
  if (d.details.length) {
    out.push(["", "", "", ""], ["Casilla", "Origen", "Descripción", "Cuota o importe"]);
    for (const x of d.details) out.push([csvText(x.box), csvText(x.ref), csvText(x.description), x.taxCents === null ? "" : eur(x.taxCents)]);
  }
  if (d.warnings.length) {
    out.push(["", "", "", ""], ["Avisos", "", "", ""]);
    for (const w of d.warnings) out.push([csvText(w), "", "", ""]);
  }
  return BOM + out.map((r) => r.join(";")).join("\r\n") + "\r\n";
}
