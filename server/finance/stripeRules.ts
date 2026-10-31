/**
 * Reglas PURAS de la fase 2 (Stripe, sin BD ni red):
 *  - lectura de los dos informes CSV de Stripe (Panel → Informes): «Balance change from activity – itemized» /
 *    «Itemized balance transactions» y «Payouts – itemized», con detección de cabeceras por nombre;
 *  - normalización del tipo de cada transacción de saldo;
 *  - asientos (contrato §2): cobro, reembolso, disputa, comisiones de Stripe y payout, con el IVA de las comisiones
 *    según la configuración (exentas o inversión del sujeto pasivo);
 *  - incidencias, sugerencias de conciliación banco ↔ payout / factura y estado de la conciliación por factura (§4).
 */
import { madridDateKey } from "../utils/timezone";
import { daysBetween, nameTokens, parseCellAmount, signedTaxOf } from "./opsRules";
import { isValidDate, signed } from "./rules";
import { FinanceError, type EntryDraft, type EntryLineInput } from "./types";
import type { ParsedPayout, ParsedStripeTxn, PayoutStatus, StripeImportProblem, StripeIssue, StripeSettings, StripeTxnType } from "./stripeTypes";

const bad = (message: string) => new FinanceError("invalid_input", message);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const STRIPE_ACCOUNTS = {
  /** Saldo en la pasarela: lo pendiente de liquidar en Stripe. */
  balance: "5720",
  customers: "430",
  /** Comisiones y servicios bancarios (también las de Stripe por otros servicios). */
  fees: "626",
  vatInput: "472",
  vatOutput: "477",
} as const;

export const MAX_STRIPE_ROWS = 50_000;
/** Ventana de las sugerencias banco ↔ payout: ±3 días hábiles. */
export const PAYOUT_WINDOW_BUSINESS_DAYS = 3;

export const stripeTxnSourceKey = (balanceTransactionId: string) => `stripe-txn:${balanceTransactionId}`;
export const stripePayoutSourceKey = (payoutId: string) => `stripe-payout:${payoutId}`;

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cabecera normalizada: minúsculas, sin espacios, paréntesis, guiones ni guiones bajos («Created (UTC)» = «created_utc»). */
export const normalizeHeader = (h: string) =>
  h
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Registros de un CSV (comillas dobles, «""» escapadas y saltos de línea dentro de comillas). Delimitador «,» o «;». */
export function parseCsvRecords(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const d = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) row.push(cur.trim()), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur.trim());
      if (row.some((c) => c !== "")) out.push(row);
      (row = []), (cur = "");
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

/** Importe de Stripe en unidad mayor con punto decimal («-1234.56», «1,234.56») → céntimos; null si no se lee. */
export function parseStripeAmount(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return parseCellAmount(s, ".");
}

/**
 * Fecha de Stripe → fecha contable en Europe/Madrid. En una columna UTC (o con «Z»/«+0000») se convierte la hora a
 * Madrid (un cobro a las 23:30 UTC del 31 de octubre es del 1 de noviembre); sin hora, o en una columna en hora local
 * de la cuenta, se toma la fecha tal cual. Acepta también segundos Unix.
 */
export function parseStripeDate(v: string | undefined, utc: boolean): { date: string; ts: number | null } | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/^\d{9,11}$/.test(s)) {
    const ts = Number(s) * 1000;
    return { date: madridDateKey(new Date(ts)), ts };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|[+-]00:?00)?)?$/i.exec(s);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isValidDate(date)) return null;
  if (m[4] === undefined) return { date, ts: null };
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (utc || m[7]) return { date: madridDateKey(new Date(ts)), ts };
  return { date, ts: null };
}

/** Columnas de cada informe: nombres aceptados (normalizados), por orden de preferencia. */
const BALANCE_COLUMNS = {
  id: ["balancetransactionid", "id"],
  created: ["createdutc", "created"],
  available: ["availableonutc", "availableon"],
  currency: ["currency"],
  gross: ["gross", "amount"],
  fee: ["fee"],
  net: ["net"],
  type: ["reportingcategory", "type"],
  source: ["sourceid", "source"],
  description: ["description"],
  customerId: ["customerid"],
  customerEmail: ["customeremail"],
  chargeId: ["chargeid"],
  paymentIntentId: ["paymentintentid"],
  invoiceId: ["invoiceid"],
  payoutId: ["automaticpayoutid", "transfer"],
  payoutEffective: ["automaticpayouteffectiveatutc", "automaticpayouteffectiveat", "transferdateutc", "transferdate"],
} as const;
const BALANCE_REQUIRED: Array<keyof typeof BALANCE_COLUMNS> = ["id", "created", "currency", "gross", "fee", "net", "type"];

const PAYOUT_COLUMNS = {
  id: ["payoutid", "id"],
  arrival: ["payoutexpectedarrivaldate", "arrivaldateutc", "arrivaldate", "effectiveatutc", "effectiveat"],
  created: ["createdutc", "created"],
  currency: ["currency"],
  gross: ["gross", "amount"],
  fee: ["fee"],
  net: ["net"],
  status: ["payoutstatus", "status"],
  category: ["reportingcategory", "type"],
  description: ["payoutdescription", "description"],
} as const;
const PAYOUT_REQUIRED: Array<keyof typeof PAYOUT_COLUMNS> = ["id", "arrival", "currency", "gross"];

type ColumnMap<K extends string> = Record<K, { index: number; utc: boolean } | null>;

/** Localiza cada columna por su nombre; `invalid_input` con las que falten (fichero que no es de ese informe). */
function locate<K extends string>(header: string[], spec: Record<K, readonly string[]>, required: K[], report: string): ColumnMap<K> {
  const norm = header.map(normalizeHeader);
  const out = {} as ColumnMap<K>;
  for (const key of Object.keys(spec) as K[]) {
    let hit: { index: number; utc: boolean } | null = null;
    for (const name of spec[key]) {
      const i = norm.indexOf(name);
      if (i >= 0) {
        hit = { index: i, utc: name.endsWith("utc") };
        break;
      }
    }
    out[key] = hit;
  }
  const missing = required.filter((k) => !out[k]);
  if (missing.length) throw bad(`El fichero no parece el informe «${report}» de Stripe: faltan las columnas ${missing.map((k) => spec[k][0]).join(", ")}`);
  return out;
}

const cell = <K extends string>(cells: string[], cols: ColumnMap<K>, k: K) => {
  const c = cols[k];
  const v = c ? (cells[c.index] ?? "").trim() : "";
  return v || null;
};

/**
 * Tipo normalizado. `adjustment` (export clásico) es disputa solo si su concepto lo dice («Chargeback withdrawal»,
 * «Dispute»…); el resto de ajustes no se contabiliza solo.
 */
export function normalizeStripeType(raw: string, grossCents: number, description: string | null): StripeTxnType {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "charge" || t === "payment") return "charge";
  if (t === "refund" || t === "payment_refund") return "refund";
  if (t === "refund_failure" || t === "payment_failure_refund") return "refund_failure";
  if (t === "dispute_reversal") return "dispute_reversal";
  if (t === "dispute" || t === "payment_dispute" || (t === "adjustment" && /chargeback|dispute|disputa/i.test(description ?? ""))) return grossCents < 0 ? "dispute" : "dispute_reversal";
  if (t === "fee" || t === "stripe_fee" || t === "network_cost" || t === "tax") return "stripe_fee";
  if (t === "payout") return "payout";
  if (t === "payout_reversal" || t === "payout_cancel" || t === "payout_failure") return "payout_reversal";
  return "other";
}

/** Lee el informe de transacciones de saldo. Las filas ilegibles se saltan y se devuelven como avisos con su línea. */
export function parseBalanceCsv(text: string): { rows: ParsedStripeTxn[]; problems: StripeImportProblem[] } {
  const records = parseCsvRecords(text);
  if (records.length < 2) throw bad("El fichero no tiene transacciones");
  if (records.length - 1 > MAX_STRIPE_ROWS) throw bad(`Como mucho ${MAX_STRIPE_ROWS} filas por fichero`);
  const cols = locate(records[0], BALANCE_COLUMNS, BALANCE_REQUIRED, "Balance change from activity – itemized");
  const rows: ParsedStripeTxn[] = [];
  const problems: StripeImportProblem[] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const fail = (message: string) => void problems.push({ line, message });
    const id = cell(cells, cols, "id");
    if (!id) return fail("Sin identificador de transacción");
    if (id.length > 80) return fail("Identificador demasiado largo");
    if (seen.has(id)) return fail(`Transacción ${id} repetida en el fichero`);
    const created = parseStripeDate(cell(cells, cols, "created") ?? undefined, cols.created!.utc);
    if (!created) return fail(`Fecha no reconocida («${(cell(cells, cols, "created") ?? "").slice(0, 30)}»)`);
    const availRaw = cell(cells, cols, "available");
    const available = availRaw ? parseStripeDate(availRaw, cols.available!.utc) : null;
    if (availRaw && !available) return fail(`Fecha de disponibilidad no reconocida («${availRaw.slice(0, 30)}»)`);
    const currency = (cell(cells, cols, "currency") ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return fail("Moneda no válida");
    const gross = parseStripeAmount(cell(cells, cols, "gross") ?? undefined);
    const fee = parseStripeAmount(cell(cells, cols, "fee") ?? "0") ?? null;
    const net = parseStripeAmount(cell(cells, cols, "net") ?? undefined);
    if (gross === null || fee === null || net === null) return fail("Importe no reconocido (bruto, comisión o neto)");
    if (net !== gross - fee) return fail(`El neto (${net}) no es el bruto (${gross}) menos la comisión (${fee})`);
    const rawType = cell(cells, cols, "type") ?? "";
    if (!rawType) return fail("Sin tipo de transacción");
    const description = cell(cells, cols, "description");
    const type = normalizeStripeType(rawType, gross, description);
    const source = cell(cells, cols, "source");
    const payoutCol = cell(cells, cols, "payoutId");
    const isPayout = type === "payout" || type === "payout_reversal";
    const payoutRef = isPayout && source?.startsWith("po_") ? source : payoutCol?.startsWith("po_") ? payoutCol : null;
    const effRaw = cell(cells, cols, "payoutEffective");
    const eff = effRaw ? parseStripeDate(effRaw, cols.payoutEffective!.utc) : null;
    const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : null);
    seen.add(id);
    rows.push({
      balanceTransactionId: id,
      type,
      rawType: rawType.slice(0, 40),
      createdTs: created.ts,
      createdOn: created.date,
      availableOn: available?.date ?? null,
      currency,
      grossCents: gross,
      feeCents: fee,
      netCents: net,
      sourceId: clip(source, 80),
      description: clip(description, 500),
      customerId: clip(cell(cells, cols, "customerId"), 80),
      customerEmail: clip(cell(cells, cols, "customerEmail"), 160),
      chargeId: clip(cell(cells, cols, "chargeId") ?? (source?.startsWith("ch_") || source?.startsWith("py_") ? source : null), 80),
      paymentIntentId: clip(cell(cells, cols, "paymentIntentId"), 80),
      stripeInvoiceId: clip(cell(cells, cols, "invoiceId"), 80),
      stripePayoutId: clip(payoutRef, 80),
      payoutArrivalOn: isPayout ? (eff?.date ?? available?.date ?? null) : null,
    });
  });
  return { rows, problems };
}

const PAYOUT_STATUS_ALIASES: Record<string, PayoutStatus> = { paid: "paid", pending: "pending", intransit: "in_transit", failed: "failed", canceled: "canceled", cancelled: "canceled" };

/**
 * Lee el informe de payouts. Varias filas del mismo payout (p. ej. `payout` y `payout_reversal` del informe
 * detallado) se funden: una reversión lo marca como fallido.
 */
export function parsePayoutsCsv(text: string): { rows: ParsedPayout[]; problems: StripeImportProblem[] } {
  const records = parseCsvRecords(text);
  if (records.length < 2) throw bad("El fichero no tiene payouts");
  if (records.length - 1 > MAX_STRIPE_ROWS) throw bad(`Como mucho ${MAX_STRIPE_ROWS} filas por fichero`);
  const cols = locate(records[0], PAYOUT_COLUMNS, PAYOUT_REQUIRED, "Payouts – itemized");
  const byId = new Map<string, ParsedPayout>();
  const problems: StripeImportProblem[] = [];
  records.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const fail = (message: string) => void problems.push({ line, message });
    const id = cell(cells, cols, "id");
    if (!id || !id.startsWith("po_") || id.length > 80) return fail("Identificador de payout no válido (po_…)");
    const category = (cell(cells, cols, "category") ?? "payout").toLowerCase();
    const arrival = parseStripeDate(cell(cells, cols, "arrival") ?? undefined, cols.arrival!.utc);
    if (!arrival) return fail(`Fecha de llegada no reconocida («${(cell(cells, cols, "arrival") ?? "").slice(0, 30)}»)`);
    const createdRaw = cell(cells, cols, "created");
    const created = createdRaw ? parseStripeDate(createdRaw, cols.created!.utc) : null;
    const currency = (cell(cells, cols, "currency") ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return fail("Moneda no válida");
    const gross = parseStripeAmount(cell(cells, cols, "gross") ?? undefined);
    const fee = parseStripeAmount(cell(cells, cols, "fee") ?? "0");
    if (gross === null || gross === 0 || fee === null) return fail("Importe no reconocido");
    const statusRaw = normalizeHeader(cell(cells, cols, "status") ?? "paid");
    let status = PAYOUT_STATUS_ALIASES[statusRaw];
    if (!status) return fail(`Estado de payout desconocido («${statusRaw}»)`);
    const reversal = /reversal|failure|cancel/.test(category);
    if (reversal) status = "failed";
    const prev = byId.get(id);
    if (prev) {
      if (reversal) prev.status = "failed";
      return;
    }
    byId.set(id, { payoutId: id, createdOn: created?.date ?? null, arrivalOn: arrival.date, currency, amountCents: Math.abs(gross), feeCents: Math.abs(fee), status, description: (cell(cells, cols, "description") ?? "").slice(0, 300) || null });
  });
  return { rows: Array.from(byId.values()), problems };
}

// ── Asientos ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Factura propia con la que casa un cobro (solo referencia: la empresa cliente va en la línea del 430). */
export interface InvoiceRef {
  id: number;
  number: string | null;
  companyId: number | null;
  totalCents: number;
}

const TYPE_LABEL: Record<StripeTxnType, string> = {
  charge: "cobro",
  refund: "reembolso",
  refund_failure: "reembolso fallido",
  dispute: "disputa",
  dispute_reversal: "disputa ganada",
  stripe_fee: "comisión de Stripe",
  payout: "payout",
  payout_reversal: "payout fallido",
  other: "otra operación",
};
export const stripeTypeLabel = (t: StripeTxnType) => TYPE_LABEL[t];

/** Tipos que se contabilizan con su propio asiento (`stripe-txn:<id>`); los payouts van por su liquidación. */
export const SELF_POSTED_TYPES: readonly StripeTxnType[] = ["charge", "refund", "refund_failure", "dispute", "dispute_reversal", "stripe_fee"];

/**
 * Asiento de una transacción de saldo (diario STR, fecha = la del cobro `created`), con importes con el signo de Stripe
 * (neto = bruto − comisión):
 *   Debe 5720 neto · Debe 626 comisión · Haber contrapartida bruto
 * Con importes negativos cada línea pasa al lado contrario, así que la misma fórmula da:
 *  - cobro (bruto > 0): Debe 5720 neto · Debe 626 comisión · Haber 430 bruto;
 *  - reembolso (bruto < 0): Debe 430 · Haber 5720 (y con comisión devuelta, < 0: Haber 626);
 *  - disputa (bruto < 0, comisión de disputa > 0): Debe 430 (o la de dudoso cobro) · Debe 626 · Haber 5720; la
 *    disputa ganada (bruto > 0, comisión devuelta < 0) es exactamente el inverso;
 *  - comisión o servicio de Stripe (bruto < 0, contrapartida 626): Debe 626 · Haber 5720.
 * IVA de la comisión con inversión del sujeto pasivo: Debe 472 / Haber 477 al tipo configurado sobre la comisión
 * (autoliquidación, sin efecto en el saldo); exenta, sin líneas de IVA.
 */
export function stripeTxnEntry(t: Pick<ParsedStripeTxn, "balanceTransactionId" | "type" | "createdOn" | "currency" | "grossCents" | "feeCents" | "netCents" | "description" | "chargeId">, settings: Pick<StripeSettings, "stripeFeeVat" | "feeVatRateBp" | "disputeAccountCode">, invoice: InvoiceRef | null): EntryDraft {
  if (!SELF_POSTED_TYPES.includes(t.type)) throw bad(`La transacción ${t.balanceTransactionId} (${TYPE_LABEL[t.type]}) no se contabiliza con su propio asiento`);
  if (t.currency !== "EUR") throw bad(`La transacción ${t.balanceTransactionId} no está en euros`);
  if (!isValidDate(t.createdOn)) throw bad(`La transacción ${t.balanceTransactionId} no tiene una fecha válida`);
  if (t.netCents !== t.grossCents - t.feeCents) throw bad(`La transacción ${t.balanceTransactionId}: el neto no es el bruto menos la comisión`);
  const counterpart = t.type === "stripe_fee" ? STRIPE_ACCOUNTS.fees : t.type === "dispute" || t.type === "dispute_reversal" ? settings.disputeAccountCode : STRIPE_ACCOUNTS.customers;
  const ref = invoice?.companyId ? { companyId: invoice.companyId } : {};
  const what = TYPE_LABEL[t.type];
  const inv = invoice?.number ? ` · factura ${invoice.number}` : "";
  const label = short(`Stripe: ${what} ${t.chargeId ?? t.balanceTransactionId}${inv}`, 300);
  // Base de la comisión: la comisión de la transacción y, en un cargo de Stripe por otros servicios, el propio cargo
  const feeBase = t.feeCents + (t.type === "stripe_fee" ? -t.grossCents : 0);
  const vat = settings.stripeFeeVat === "reverse_charge" ? signedTaxOf(feeBase, settings.feeVatRateBp) : 0;
  const vatText = `IVA comisión Stripe ${settings.feeVatRateBp / 100} % (inversión del sujeto pasivo)`;
  const lines: EntryLineInput[] = [
    ...signed(STRIPE_ACCOUNTS.balance, t.netCents, "debit", { description: label }),
    ...signed(STRIPE_ACCOUNTS.fees, t.feeCents, "debit", { description: short(`Comisión Stripe ${t.balanceTransactionId}`, 300) }),
    ...signed(counterpart, t.grossCents, "credit", { ...(counterpart === STRIPE_ACCOUNTS.fees ? {} : ref), description: label }),
    ...signed(STRIPE_ACCOUNTS.vatInput, vat, "debit", { description: vatText, taxRateBp: settings.feeVatRateBp, taxBaseCents: feeBase }),
    ...signed(STRIPE_ACCOUNTS.vatOutput, vat, "credit", { description: vatText, taxRateBp: settings.feeVatRateBp, taxBaseCents: feeBase }),
  ];
  return { journalCode: "STR", date: t.createdOn, description: short(`Stripe: ${what} ${t.balanceTransactionId}${inv}${t.description ? ` · ${t.description}` : ""}`, 500), origin: "stripe", sourceKey: stripeTxnSourceKey(t.balanceTransactionId), lines };
}

/** Payout (diario STR, fecha = llegada): Debe 572000NN del banco de destino · Haber 5720. */
export function stripePayoutEntry(p: Pick<ParsedPayout, "payoutId" | "arrivalOn" | "amountCents" | "currency">, bankAccountCode: string): EntryDraft {
  if (p.currency !== "EUR") throw bad(`El payout ${p.payoutId} no está en euros`);
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) throw bad(`El payout ${p.payoutId} no tiene importe`);
  if (bankAccountCode === STRIPE_ACCOUNTS.balance) throw new FinanceError("invalid_account", "La cuenta de destino del payout no puede ser la propia de Stripe");
  const label = `Stripe: payout ${p.payoutId} al banco`;
  return { journalCode: "STR", date: p.arrivalOn, description: label, origin: "stripe", sourceKey: stripePayoutSourceKey(p.payoutId), lines: [...signed(bankAccountCode, p.amountCents, "debit", { description: label }), ...signed(STRIPE_ACCOUNTS.balance, p.amountCents, "credit", { description: label })] };
}

/** Incidencia de una transacción al contabilizarla (null = nada que revisar). */
export function txnIssue(t: Pick<ParsedStripeTxn, "type" | "grossCents" | "currency">, invoice: InvoiceRef | null): StripeIssue | null {
  if (t.currency !== "EUR") return "currency";
  if (t.type === "other") return "unsupported";
  if (t.type === "charge") return !invoice ? "no_invoice" : invoice.totalCents !== t.grossCents ? "amount_mismatch" : null;
  if (t.type === "refund" || t.type === "refund_failure") return "refund";
  if (t.type === "dispute") return "dispute";
  return null;
}

// ── Conciliación ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Días hábiles (lunes a viernes) entre dos fechas, en valor absoluto. Sin festivos: es una ventana de sugerencia. */
export function businessDaysBetween(a: string, b: string): number {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const total = daysBetween(from, to);
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < total; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export interface SuggestPayoutRow {
  id: number;
  payoutId: string;
  arrivalOn: string;
  amountCents: number;
}
export interface SuggestInvoiceRow {
  id: number;
  number: string | null;
  customerName: string | null;
  issueDate: string | null;
  pendingCents: number;
}
export type StripeMatchSuggestion =
  | { type: "stripe_payout"; payoutId: number; stripePayoutId: string; date: string; amountCents: number; reasons: string[]; score: number }
  | { type: "invoice"; invoiceId: number; invoiceNumber: string | null; customerName: string | null; date: string | null; amountCents: number; reasons: string[]; score: number };

/**
 * Sugerencias de un abono bancario (§4): payouts sin movimiento con importe exacto y llegada a ±3 días hábiles (o
 * «STRIPE» en el concepto), y facturas propias pendientes por importe exacto, número de factura o cliente en el concepto.
 */
export function suggestStripeMatches(m: { amountCents: number; bookingDate: string; description: string; counterparty: string | null; reference: string | null }, payouts: readonly SuggestPayoutRow[], invoices: readonly SuggestInvoiceRow[], limit = 10): StripeMatchSuggestion[] {
  if (m.amountCents <= 0) return [];
  const concept = `${m.description} ${m.counterparty ?? ""} ${m.reference ?? ""}`;
  const stripeInConcept = /stripe/i.test(concept);
  const out: StripeMatchSuggestion[] = [];
  for (const p of payouts) {
    if (p.amountCents !== m.amountCents) continue;
    const days = businessDaysBetween(p.arrivalOn, m.bookingDate);
    const inWindow = days <= PAYOUT_WINDOW_BUSINESS_DAYS;
    if (!inWindow && !stripeInConcept) continue;
    const reasons = ["Importe exacto"];
    let s = 60;
    if (inWindow) (s += 20 - 3 * days), reasons.push(days === 0 ? "Llega el mismo día hábil" : `Llegada a ${days} ${days === 1 ? "día hábil" : "días hábiles"}`);
    if (stripeInConcept) (s += 30), reasons.push("«STRIPE» en el concepto");
    if (concept.includes(p.payoutId)) (s += 20), reasons.push("Identificador del payout en el concepto");
    out.push({ type: "stripe_payout", payoutId: p.id, stripePayoutId: p.payoutId, date: p.arrivalOn, amountCents: p.amountCents, reasons, score: s + 5 });
  }
  const tokens = new Set(nameTokens(concept));
  const upper = concept.toUpperCase();
  for (const inv of invoices) {
    if (inv.pendingCents <= 0) continue;
    const reasons: string[] = [];
    let s = 0;
    const exact = inv.pendingCents === m.amountCents;
    if (exact) (s += 60), reasons.push("Importe exacto");
    const numbered = !!inv.number && inv.number.length >= 3 && upper.includes(inv.number.toUpperCase());
    if (numbered) (s += 40), reasons.push("Número de factura en el concepto");
    const named = !!inv.customerName && nameTokens(inv.customerName).some((t) => tokens.has(t));
    if (named) (s += 30), reasons.push("Cliente en el concepto");
    if (!exact && !numbered && !named) continue;
    if (!exact && m.amountCents > inv.pendingCents) continue;
    if (inv.issueDate) {
      const days = Math.abs(daysBetween(inv.issueDate, m.bookingDate));
      if (days <= 60) s += Math.max(0, 10 - Math.floor(days / 6));
    }
    out.push({ type: "invoice", invoiceId: inv.id, invoiceNumber: inv.number, customerName: inv.customerName, date: inv.issueDate, amountCents: inv.pendingCents, reasons, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const RECONCILIATION_STATUSES = ["pendiente_cobro", "cobrada", "liquidada", "en_banco", "incidencia"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/**
 * Estado de la cadena de una factura (§4):
 *  - pendiente_cobro: nada cobrado;
 *  - incidencia: reembolso, disputa o importe distinto del total, sin revisar;
 *  - cobrada: cobrada (Stripe o transferencia) pero algún cobro de Stripe aún no está en un payout contabilizado;
 *  - liquidada: todos los cobros de Stripe están en payouts contabilizados, alguno sin movimiento bancario vinculado;
 *  - en_banco: todo el dinero está en el banco (payouts vinculados a su movimiento, o transferencias conciliadas).
 */
export function reconciliationStatus(i: {
  totalCents: number;
  stripe: ReadonlyArray<{ type: StripeTxnType; grossCents: number; payoutPosted: boolean; payoutInBank: boolean }>;
  transfersCents: number;
  reviewed: boolean;
}): ReconciliationStatus {
  const linked = i.stripe.length > 0 || i.transfersCents !== 0;
  if (!linked) return "pendiente_cobro";
  const collected = i.stripe.reduce((a, t) => a + t.grossCents, 0) + i.transfersCents;
  const problem = i.stripe.some((t) => t.type !== "charge") || collected !== i.totalCents;
  if (problem && !i.reviewed) return "incidencia";
  if (collected <= 0) return "pendiente_cobro";
  const charges = i.stripe.filter((t) => t.grossCents > 0);
  if (charges.every((t) => t.payoutPosted && t.payoutInBank)) return "en_banco";
  if (charges.every((t) => t.payoutPosted)) return "liquidada";
  return "cobrada";
}

/**
 * Cobro de una factura propia por transferencia (movimiento bancario conciliado como `invoice_payment`): Debe
 * 572000NN del banco · Haber 430 con la empresa cliente. Diario BAN, `source_key = bankmov:<id>`.
 */
export function invoiceTransferEntry(m: { amountCents: number; bookingDate: string }, bankAccountCode: string, invoice: Pick<InvoiceRef, "id" | "number" | "companyId">, sourceKey: string): EntryDraft {
  if (!Number.isSafeInteger(m.amountCents) || m.amountCents <= 0) throw bad("Un cobro de factura es un abono (importe positivo)");
  const label = short(`Cobro por transferencia factura ${invoice.number ?? `#${invoice.id}`}`, 300);
  const ref = invoice.companyId ? { companyId: invoice.companyId } : {};
  return { journalCode: "BAN", date: m.bookingDate, description: label, origin: "bank", sourceKey, lines: [...signed(bankAccountCode, m.amountCents, "debit", { description: label }), ...signed(STRIPE_ACCOUNTS.customers, m.amountCents, "credit", { ...ref, description: label })] };
}
