/**
 * Contabilidad general de cada empresa — reglas PURAS (sin BD ni red): asientos automáticos de lo que ya registra el
 * Core (facturas y abonos, tickets de caja, cobros, gastos con su IVA soportado, pagos y cierres y movimientos de
 * caja), plan de la generación idempotente (crear, sustituir o revertir por documento), fechas de las reversiones,
 * cuenta de pérdidas y ganancias del modelo de pymes y exportaciones CSV y Excel para la gestoría.
 *
 * REUTILIZA las reglas puras de las finanzas corporativas sin cambiarlas (server/finance/rules.ts y opsRules.ts):
 * `signed` (línea con signo), `validateEntry` (partida doble: cada línea debe XOR haber > 0, cuentas existentes, activas
 * e imputables, Σdebe = Σhaber > 0), `reversalEntry`, `trialBalance`, `ledger`, `journalCsv`, `trialBalanceCsv`,
 * `paymentEntry`, `cashEntry` y `signedTaxOf`. Solo se usan sus funciones: nunca sus tablas `fin_*` ni su servicio.
 *
 * Convenios: céntimos enteros; saldo = debe − haber; fechas contables «AAAA-MM-DD» (Europe/Madrid).
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { csvText, esDate, eur, journalCsv, ledger, reversalEntry, signed, toCsv, trialBalance, trialBalanceCsv, validateEntry } from "../finance/rules";
import { cashEntry, paymentEntry, signedTaxOf } from "../finance/opsRules";
import { FinanceError, type Account, type EntryLine, type EntryLineInput, type PostedLine } from "../finance/types";
import { ACC_PNL_ITEMS, type AccAccountMap, type AccAccountType, type AccJournal, type AccOrigin, type AccPnlKey } from "../../shared/accountingGeneral";

export { trialBalance, ledger };

/** Asiento propuesto (automático o manual) antes de guardarlo. */
export interface AccDraft {
  journal: AccJournal;
  date: string;
  description: string;
  origin: AccOrigin;
  lines: EntryLineInput[];
}

export interface AccAccount {
  code: string;
  name: string;
  type: AccAccountType;
  parentCode: string | null;
  isPostable: boolean;
  active: boolean;
}

/** Error de entrada o de estado con su mensaje en español (el router lo traduce a TRPCError). */
export class AccError extends Error {
  constructor(
    public readonly code: "invalid_input" | "unbalanced" | "invalid_account" | "locked" | "not_found" | "conflict" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "AccError";
  }
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pctLabel = (rateBp: number) => `${(rateBp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;

/** Euros guardados como DECIMAL (texto o número) → céntimos enteros. */
export function centsOf(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ── Validación (partida doble de las finanzas corporativas) ────────────────────────────────────────────────────────

/**
 * Valida un asiento con la regla de las finanzas corporativas (`validateEntry`) contra el plan de cuentas de la
 * empresa y devuelve sus líneas normalizadas. Los errores salen como `AccError` con el mismo mensaje.
 */
export function validateDraft(d: AccDraft, accounts: ReadonlyMap<string, AccAccount>): EntryLine[] {
  const asFinance = new Map<string, Account>();
  accounts.forEach((a, code) => asFinance.set(code, { id: 0, code, name: a.name, type: a.type, parentCode: a.parentCode, isPostable: a.isPostable, active: a.active, createdAt: 0 }));
  try {
    return validateEntry({ journalCode: d.journal, date: d.date, description: d.description, origin: "manual", sourceKey: null, lines: d.lines }, asFinance).lines;
  } catch (e) {
    if (e instanceof FinanceError) throw new AccError(e.code === "unbalanced" ? "unbalanced" : e.code === "invalid_account" ? "invalid_account" : "invalid_input", e.message);
    throw e;
  }
}

/** Huella del contenido económico de un asiento (diario, fecha y líneas): si cambia, el documento cambió. */
export function draftHash(d: AccDraft): string {
  const lines = d.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.taxRateBp ?? null]);
  return createHash("sha256").update(JSON.stringify([d.journal, d.date, lines])).digest("hex");
}

/** Agrupa importes por cuenta conservando el orden de aparición. */
function byAccount(items: Array<{ account: string; cents: number }>): Array<{ account: string; cents: number }> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.account, (m.get(i.account) ?? 0) + i.cents);
  return Array.from(m, ([account, cents]) => ({ account, cents }));
}

// ── Ventas: facturas, abonos y tickets ─────────────────────────────────────────────────────────────────────────────

export type TpvMethod = "cash" | "card" | "bizum" | "other";

/** Documento fiscal emitido (server/fiscalDocuments.ts) en céntimos y con signo (abonos en negativo). */
export interface SaleDoc {
  kind: "factura" | "abono" | "ticket";
  id: number;
  number: string;
  date: string;
  clientName: string;
  rectifies: string;
  byRate: Array<{ rateBp: number; baseCents: number; taxCents: number }>;
  totalCents: number;
  /** Solo tickets: cobros completados por método. */
  payments?: Array<{ method: TpvMethod; cents: number }>;
}

export const tpvMethodAccount = (m: TpvMethod, map: AccAccountMap) => (m === "cash" ? map.cash : m === "other" ? map.bank : map.card);

/**
 * Venta (diario VEN). Factura: Debe clientes (total) · Haber ventas (base de cada tipo) · Haber IVA repercutido (cuota
 * de cada tipo) · Haber ventas (parte no sujeta o de régimen especial, si la hay). El abono, en negativo, sale invertido.
 * Ticket de caja (factura simplificada, ya cobrado): el debe va a la tesorería de cada cobro (caja, tarjeta o banco) y
 * lo que no cubran los cobros, a clientes. Null si el documento es de importe cero.
 */
export function saleEntry(doc: SaleDoc, map: AccAccountMap): AccDraft | null {
  const label = doc.kind === "abono" ? "Abono" : doc.kind === "ticket" ? "Ticket" : "Factura";
  const who = doc.clientName.trim() ? ` · ${doc.clientName.trim()}` : "";
  const ref = doc.kind === "abono" && doc.rectifies ? ` (rectifica ${doc.rectifies})` : "";
  const text = short(`${label} ${doc.number}`, 300);
  const debit: EntryLineInput[] = [];
  if (doc.kind === "ticket") {
    const paid = byAccount((doc.payments ?? []).map((p) => ({ account: tpvMethodAccount(p.method, map), cents: p.cents })));
    for (const p of paid) debit.push(...signed(p.account, p.cents, "debit", { description: `Cobro ${text}` }));
    const rest = doc.totalCents - paid.reduce((a, p) => a + p.cents, 0);
    debit.push(...signed(map.customers, rest, "debit", { description: text }));
  } else {
    debit.push(...signed(map.customers, doc.totalCents, "debit", { description: text }));
  }
  const groups = [...doc.byRate].sort((a, b) => b.rateBp - a.rateBp);
  const base = groups.reduce((a, g) => a + g.baseCents, 0);
  const tax = groups.reduce((a, g) => a + g.taxCents, 0);
  const notSubject = doc.totalCents - base - tax;
  const lines: EntryLineInput[] = [
    ...debit,
    ...groups.flatMap((g) => signed(map.sales, g.baseCents, "credit", { description: `Base ${pctLabel(g.rateBp)}`, taxRateBp: g.rateBp, taxBaseCents: g.baseCents })),
    ...groups.flatMap((g) => signed(map.vatOutput, g.taxCents, "credit", { description: `IVA ${pctLabel(g.rateBp)}`, taxRateBp: g.rateBp, taxBaseCents: g.baseCents })),
    ...signed(map.sales, notSubject, "credit", { description: "No sujeto o régimen especial" }),
  ];
  if (!lines.length) return null;
  return { journal: "VEN", date: doc.date, description: short(`${label} ${doc.number}${ref}${who}`, 500), origin: doc.kind === "ticket" ? "ticket" : "invoice", lines };
}

/**
 * Ticket anulado o devuelto después de cobrarlo (no cuenta como venta). Su efectivo sí entró en el cajón y lo devuelto
 * sale con un movimiento manual de salida (`cash_movements`, que ya contabiliza Debe 555 · Haber 570; ver
 * server/tpvSessionTotals.ts). Para que esa salida no abone la caja por segunda vez, el cobro en efectivo queda en el
 * puente de caja: Debe 570 · Haber 555 (diario CAJ). Lo cobrado con tarjeta o Bizum se devuelve por el mismo medio y no
 * deja asiento. Null si no hubo cobro en efectivo.
 */
export function voidTicketCashEntry(t: { number: string; date: string; cashCents: number }, map: AccAccountMap): AccDraft | null {
  if (t.cashCents === 0) return null;
  const text = short(`Ticket ${t.number} anulado o devuelto: efectivo cobrado, pendiente de su salida de caja`, 300);
  return {
    journal: "CAJ",
    date: t.date,
    description: text,
    origin: "ticket",
    lines: [...signed(map.cash, t.cashCents, "debit", { description: text }), ...signed(map.cashBridge, t.cashCents, "credit", { description: text })],
  };
}

// ── Cobros de facturas ─────────────────────────────────────────────────────────────────────────────────────────────

/** Método de cobro guardado en la factura → tesorería. */
export function invoiceMethodAccount(method: string | null, map: AccAccountMap): string {
  if (method === "efectivo") return map.cash;
  if (method === "redsys" || method === "tarjeta_redsys" || method === "tarjeta_fisica") return map.card;
  return map.bank;
}

/** Cobro de una factura: Debe tesorería · Haber clientes (diario CAJ si es en efectivo; si no, BAN). */
export function collectionEntry(c: { number: string; date: string; totalCents: number; method: string | null; clientName: string }, map: AccAccountMap): AccDraft | null {
  if (c.totalCents === 0) return null;
  const treasury = invoiceMethodAccount(c.method, map);
  const text = short(`Cobro de la factura ${c.number}`, 300);
  return {
    journal: treasury === map.cash ? "CAJ" : "BAN",
    date: c.date,
    description: short(`${text}${c.clientName.trim() ? ` · ${c.clientName.trim()}` : ""}`, 500),
    origin: "collection",
    lines: [...signed(treasury, c.totalCents, "debit", { description: text }), ...signed(map.customers, c.totalCents, "credit", { description: text })],
  };
}

// ── Gastos y pagos ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ExpenseMethod = "cash" | "card" | "transfer" | "direct_debit" | "tpv_cash";

/** Gasto del Core (server/routers/expenses.ts) en céntimos: `totalCents` es el importe CON IVA. */
export interface ExpenseDoc {
  id: number;
  date: string;
  concept: string;
  supplierName: string;
  totalCents: number;
  /** Cuota de IVA guardada (o derivada del total y el tipo). */
  taxCents: number;
  rateBp: number;
  /** Parte deducible de la cuota (10000 = 100 %). */
  deductibleBp: number;
  retentionCents: number;
  /** Nómina, Seguridad Social o bonus de RRHH (origen `hr_*`): sin IVA y contra remuneraciones pendientes. */
  payroll: boolean;
  expenseAccount: string;
  method: ExpenseMethod;
  /** Fecha del pago: la del movimiento bancario conciliado o, si no hay, la del gasto. */
  paidOn: string;
}

/** Desglose del gasto: base = total − cuota; deducible con `signedTaxOf` (el mismo redondeo que las corporativas). */
export function expenseAmounts(e: Pick<ExpenseDoc, "totalCents" | "taxCents" | "deductibleBp" | "retentionCents" | "payroll">) {
  const taxCents = e.payroll ? 0 : e.taxCents;
  const deductibleTaxCents = signedTaxOf(taxCents, e.deductibleBp);
  const sign = Math.sign(e.totalCents) || 1;
  const retentionCents = sign * Math.abs(e.retentionCents);
  const baseCents = e.totalCents - taxCents;
  return { baseCents, taxCents, deductibleTaxCents, nonDeductibleTaxCents: taxCents - deductibleTaxCents, retentionCents, payableCents: e.totalCents - retentionCents };
}

/**
 * Gasto (diario COM), la misma estructura que el gasto corporativo (`expenseEntry` de opsRules): Debe cuenta del gasto
 * (base + cuota no deducible) · Debe IVA soportado (cuota deducible) · Haber retenciones · Haber proveedor (total −
 * retención). Nómina de RRHH: sin IVA y contra remuneraciones pendientes. Un gasto negativo (devolución) sale invertido.
 */
export function expenseEntry(e: ExpenseDoc, map: AccAccountMap): AccDraft | null {
  if (e.totalCents === 0) return null;
  const a = expenseAmounts(e);
  const counterpart = e.payroll ? map.payroll : map.suppliers;
  const concept = short(e.concept.trim() || `Gasto #${e.id}`, 300);
  const who = e.supplierName.trim() ? ` · ${e.supplierName.trim()}` : "";
  return {
    journal: "COM",
    date: e.date,
    description: short(`Gasto: ${concept}${who}`, 500),
    origin: "expense",
    lines: [
      ...signed(e.expenseAccount, a.baseCents + a.nonDeductibleTaxCents, "debit", { description: concept, taxRateBp: e.payroll ? null : e.rateBp, taxBaseCents: a.baseCents }),
      ...signed(map.vatInput, a.deductibleTaxCents, "debit", { description: `IVA soportado ${pctLabel(e.rateBp)}`, taxRateBp: e.rateBp, taxBaseCents: a.baseCents }),
      ...signed(map.withholding, a.retentionCents, "credit", { description: "Retención" }),
      ...signed(counterpart, a.payableCents, "credit", { description: concept }),
    ],
  };
}

/** Método de pago del gasto → tesorería. Caja del TPV: contra el puente de caja (su salida la registra la sesión). */
export function expenseMethodAccount(m: ExpenseMethod, map: AccAccountMap): string {
  if (m === "cash") return map.cash;
  if (m === "tpv_cash") return map.cashBridge;
  return map.bank;
}

/** Pago del gasto (`paymentEntry` de las corporativas): Debe proveedor · Haber tesorería; diario CAJ o BAN. */
export function expensePaymentEntry(e: ExpenseDoc, map: AccAccountMap): AccDraft | null {
  const a = expenseAmounts(e);
  if (a.payableCents === 0) return null;
  const treasury = expenseMethodAccount(e.method, map);
  const p = paymentEntry({ amountCents: a.payableCents, date: e.paidOn, supplierAccount: e.payroll ? map.payroll : map.suppliers, treasuryAccount: treasury, supplierId: null, label: `Pago: ${e.concept.trim() || `gasto #${e.id}`}`, sourceKey: "" });
  return { journal: treasury === map.cash ? "CAJ" : "BAN", date: p.date, description: p.description, origin: "payment", lines: p.lines.map((l) => ({ ...l, supplierId: null })) };
}

// ── Caja del TPV ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Cierre de una sesión de caja con descuadre: sobrante Debe caja · Haber sobrantes; faltante Debe faltantes · Haber caja. */
export function cashCloseEntry(c: { sessionId: number; date: string; differenceCents: number; register: string }, map: AccAccountMap): AccDraft | null {
  if (c.differenceCents === 0) return null;
  const over = c.differenceCents > 0;
  const abs = Math.abs(c.differenceCents);
  const text = short(`${over ? "Sobrante" : "Faltante"} en el cierre de caja #${c.sessionId}${c.register ? ` (${c.register})` : ""}`, 300);
  return {
    journal: "CAJ",
    date: c.date,
    description: text,
    origin: "cash_close",
    lines: over
      ? [{ accountCode: map.cash, debitCents: abs, creditCents: 0, description: text }, { accountCode: map.cashOverage, debitCents: 0, creditCents: abs, description: text }]
      : [{ accountCode: map.cashShortage, debitCents: abs, creditCents: 0, description: text }, { accountCode: map.cash, debitCents: 0, creditCents: abs, description: text }],
  };
}

/** Entrada o salida manual de la caja del TPV (`cashEntry` de las corporativas) contra el puente de caja. */
export function cashMoveEntry(m: { id: number; date: string; type: "in" | "out"; amountCents: number; reason: string }, map: AccAccountMap): AccDraft | null {
  if (m.amountCents === 0) return null;
  const e = cashEntry({ amountCents: m.type === "in" ? Math.abs(m.amountCents) : -Math.abs(m.amountCents), movedOn: m.date, description: m.reason.trim() || `Movimiento de caja #${m.id}` }, map.cash, map.cashBridge, "");
  return { journal: "CAJ", date: e.date, description: e.description, origin: "cash_move", lines: e.lines };
}

// ── Plan de la generación (idempotente por documento) ──────────────────────────────────────────────────────────────

/** Lo que el documento pide hoy: su asiento, ninguno (anulado, devuelto…) o dejar lo que haya (sin información nueva). */
export type Desired = { kind: "entry"; draft: AccDraft } | { kind: "none" } | { kind: "keep" };

export interface SourceState {
  entryId: number | null;
  hash: string | null;
}

export type SyncAction =
  | { type: "create"; key: string; draft: AccDraft; hash: string }
  | { type: "replace"; key: string; draft: AccDraft; hash: string; entryId: number }
  | { type: "reverse"; key: string; entryId: number };

/**
 * Qué hacer con cada documento comparando lo que pide con su estado contable:
 *  - sin asiento vigente y pide uno → crear;
 *  - con asiento vigente de otra huella → sustituir (revertir el anterior y contabilizar el nuevo);
 *  - con asiento vigente y no pide ninguno, o el documento ya no existe → revertir;
 *  - misma huella o `keep` → nada.
 * Las creaciones y sustituciones salen en orden de fecha (numeración cronológica en la primera generación).
 */
export function planSync(desired: ReadonlyMap<string, Desired>, existing: ReadonlyMap<string, SourceState>): SyncAction[] {
  const out: SyncAction[] = [];
  desired.forEach((d, key) => {
    const s = existing.get(key);
    const active = s?.entryId ?? null;
    if (d.kind === "entry") {
      const hash = draftHash(d.draft);
      if (active == null) out.push({ type: "create", key, draft: d.draft, hash });
      else if (s!.hash !== hash) out.push({ type: "replace", key, draft: d.draft, hash, entryId: active });
    } else if (d.kind === "none" && active != null) out.push({ type: "reverse", key, entryId: active });
  });
  existing.forEach((s, key) => {
    if (!desired.has(key) && s.entryId != null) out.push({ type: "reverse", key, entryId: s.entryId });
  });
  const dateOf = (a: SyncAction) => (a.type === "reverse" ? "" : a.draft.date);
  return out.sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || a.key.localeCompare(b.key));
}

/**
 * Fecha de la reversión automática: la del asiento revertido (el libro queda como los documentos, igual que los
 * informes fiscales del Core) salvo que esté bloqueada; entonces hoy. Null si hoy también está bloqueado.
 */
export function autoReversalDate(originalDate: string, lockedUntil: string | null, today: string): string | null {
  if (!lockedUntil || originalDate > lockedUntil) return originalDate;
  return today > lockedUntil ? today : null;
}

/** ¿La fecha cae en el periodo bloqueado? */
export const isLocked = (date: string, lockedUntil: string | null) => !!lockedUntil && date <= lockedUntil;

/** Reversión (`reversalEntry` de las corporativas): mismas líneas con debe y haber intercambiados. */
export function reversalDraft(e: { id: number; year: number; number: number; journal: AccJournal; lines: EntryLine[] }, date: string, reason: string): AccDraft {
  const r = reversalEntry({ id: e.id, year: e.year, number: e.number, journalCode: e.journal, lines: e.lines }, date, reason);
  return { journal: e.journal, date: r.date, description: r.description, origin: "reversal", lines: r.lines };
}

// ── Plan de cuentas ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Subcuenta nueva: dígitos, más larga que su cuenta y empezando por ella (la cuenta existente de prefijo más largo).
 * Hereda su tipo. Devuelve la cuenta padre.
 */
export function subaccountParent(code: string, accounts: ReadonlyMap<string, AccAccount>): AccAccount {
  if (!/^\d{4,12}$/.test(code)) throw new AccError("invalid_input", "La subcuenta tiene de 4 a 12 dígitos");
  if (accounts.has(code)) throw new AccError("conflict", `La cuenta ${code} ya existe`);
  for (let n = code.length - 1; n >= 3; n--) {
    const p = accounts.get(code.slice(0, n));
    if (p) return p;
  }
  throw new AccError("invalid_input", `No hay ninguna cuenta del plan que empiece la subcuenta ${code} (p. ej. 572 para 57200001)`);
}

// ── Cuenta de pérdidas y ganancias (modelo de pymes) ───────────────────────────────────────────────────────────────

const PNL_PREFIXES: Array<[string, AccPnlKey]> = [
  ["70", "p1"],
  ["71", "p2"], ["6930", "p2"], ["7930", "p2"],
  ["73", "p3"],
  ["60", "p4"], ["61", "p4"], ["6931", "p4"], ["6932", "p4"], ["6933", "p4"], ["7931", "p4"], ["7932", "p4"], ["7933", "p4"],
  ["74", "p5"], ["75", "p5"],
  ["64", "p6"],
  ["62", "p7"], ["631", "p7"], ["634", "p7"], ["636", "p7"], ["639", "p7"], ["65", "p7"], ["694", "p7"], ["695", "p7"], ["794", "p7"], ["7954", "p7"],
  ["68", "p8"],
  ["746", "p9"],
  ["7951", "p10"], ["7952", "p10"], ["7955", "p10"], ["7956", "p10"],
  ["670", "p11"], ["671", "p11"], ["672", "p11"], ["690", "p11"], ["691", "p11"], ["692", "p11"], ["770", "p11"], ["771", "p11"], ["772", "p11"], ["790", "p11"], ["791", "p11"], ["792", "p11"],
  ["678", "p12"], ["778", "p12"],
  ["76", "p13"],
  ["660", "p14"], ["661", "p14"], ["662", "p14"], ["664", "p14"], ["665", "p14"], ["669", "p14"],
  ["663", "p15"], ["763", "p15"],
  ["668", "p16"], ["768", "p16"],
  ["666", "p17"], ["667", "p17"], ["673", "p17"], ["675", "p17"], ["696", "p17"], ["697", "p17"], ["698", "p17"], ["699", "p17"], ["766", "p17"], ["773", "p17"], ["775", "p17"], ["796", "p17"], ["797", "p17"], ["798", "p17"], ["799", "p17"],
  ["630", "p18"], ["633", "p18"], ["638", "p18"],
];

/** Partida de la cuenta de pérdidas y ganancias de una cuenta (prefijo más largo); null fuera de los grupos 6 y 7. */
export function pnlItemOf(code: string): AccPnlKey | null {
  if (!code.startsWith("6") && !code.startsWith("7")) return null;
  let best: [string, AccPnlKey] | null = null;
  for (const r of PNL_PREFIXES) if (code.startsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r;
  return best ? best[1] : code.startsWith("6") ? "p7" : "p5";
}

export interface PnlReport {
  items: Array<{ key: AccPnlKey; label: string; cents: number; accounts: Array<{ code: string; name: string; cents: number }> }>;
  operatingCents: number;
  financialCents: number;
  beforeTaxCents: number;
  resultCents: number;
}

/** Cuenta de pérdidas y ganancias: importe de cada partida = haber − debe (ingresos en positivo, gastos en negativo). */
export function profitAndLoss(lines: ReadonlyArray<{ accountCode: string; debitCents: number; creditCents: number }>, names: ReadonlyMap<string, string>): PnlReport {
  const byAccount = new Map<string, number>();
  for (const l of lines) if (pnlItemOf(l.accountCode)) byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.creditCents - l.debitCents);
  const items = ACC_PNL_ITEMS.map((it) => {
    const accounts = Array.from(byAccount)
      .filter(([code, cents]) => pnlItemOf(code) === it.key && cents !== 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, cents]) => ({ code, name: names.get(code) ?? "", cents }));
    return { key: it.key, label: it.label, cents: accounts.reduce((a, x) => a + x.cents, 0), accounts };
  });
  const sumBlock = (b: string) => items.filter((i) => ACC_PNL_ITEMS.find((x) => x.key === i.key)!.block === b).reduce((a, i) => a + i.cents, 0);
  const operatingCents = sumBlock("operating");
  const financialCents = sumBlock("financial");
  const beforeTaxCents = operatingCents + financialCents;
  return { items, operatingCents, financialCents, beforeTaxCents, resultCents: beforeTaxCents + sumBlock("tax") };
}

// ── Exportaciones para la gestoría ─────────────────────────────────────────────────────────────────────────────────

/** Libro diario en CSV: el formato de las finanzas corporativas («;», BOM, euros con coma). */
export function journalCsvOf(lines: ReadonlyArray<PostedLine>, names: ReadonlyMap<string, string>): string {
  return journalCsv(lines, new Map(Array.from(names, ([code, name]) => [code, { name }])));
}

/** Mayor de una cuenta en CSV con saldo anterior y acumulado. */
export function ledgerCsv(account: { code: string; name: string }, l: ReturnType<typeof ledger>): string {
  const rows = [["", "", "", csvText(`Saldo anterior ${account.code} ${account.name}`), "", "", eur(l.openingCents)]];
  for (const r of l.items) rows.push([esDate(r.entryDate), `${r.year}/${r.entryNumber}`, r.journalCode, csvText(r.description), eur(r.debitCents), eur(r.creditCents), eur(r.balanceCents)]);
  rows.push(["", "", "", "Totales", eur(l.debitCents), eur(l.creditCents), eur(l.closingCents)]);
  return toCsv(["Fecha", "Asiento", "Diario", "Concepto", "Debe", "Haber", "Saldo"], rows);
}

export const trialCsv = trialBalanceCsv;

/** Cuenta de pérdidas y ganancias en CSV (partidas, cuentas y resultados). */
export function pnlCsv(p: PnlReport): string {
  return toCsv(["Partida", "Cuenta", "Nombre", "Importe"], pnlRows(p).map((r) => [csvText(r[0]), r[1], csvText(r[2]), eur(r[3])]));
}

function pnlRows(p: PnlReport): Array<[string, string, string, number]> {
  const rows: Array<[string, string, string, number]> = [];
  const push = (block: string) => {
    for (const i of p.items.filter((x) => ACC_PNL_ITEMS.find((y) => y.key === x.key)!.block === block)) {
      rows.push([i.label, "", "", i.cents]);
      for (const a of i.accounts) rows.push(["", a.code, a.name, a.cents]);
    }
  };
  push("operating");
  rows.push(["A) Resultado de explotación", "", "", p.operatingCents]);
  push("financial");
  rows.push(["B) Resultado financiero", "", "", p.financialCents]);
  rows.push(["C) Resultado antes de impuestos", "", "", p.beforeTaxCents]);
  push("tax");
  rows.push(["D) Resultado del ejercicio", "", "", p.resultCents]);
  return rows;
}

const euros = (c: number) => Math.round(c) / 100;

/** Libro Excel para la gestoría: diario, sumas y saldos y pérdidas y ganancias del periodo (importes numéricos en euros). */
export function workbookXlsx(input: { title: string; from: string; to: string; journal: ReadonlyArray<PostedLine>; names: ReadonlyMap<string, string>; trial: ReturnType<typeof trialBalance>; pnl: PnlReport }): Buffer {
  const head = (t: string) => [[input.title], [`${t} del ${esDate(input.from)} al ${esDate(input.to)}`], []];
  const wb = XLSX.utils.book_new();
  const journal = [...input.journal].sort((a, b) => a.date.localeCompare(b.date) || a.year - b.year || a.number - b.number || a.lineNo - b.lineNo);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ...head("Libro diario"),
      ["Ejercicio", "Asiento", "Fecha", "Diario", "Descripción", "Cuenta", "Nombre de la cuenta", "Debe", "Haber", "Concepto"],
      ...journal.map((l) => [l.year, l.number, esDate(l.date), l.journalCode, l.entryDescription, l.accountCode, input.names.get(l.accountCode) ?? "", euros(l.debitCents), euros(l.creditCents), l.description ?? ""]),
    ]),
    "Diario",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ...head("Balance de sumas y saldos"),
      ["Cuenta", "Nombre", "Sumas debe", "Sumas haber", "Saldo deudor", "Saldo acreedor"],
      ...input.trial.items.map((r) => [r.code, r.name, euros(r.debitCents), euros(r.creditCents), euros(Math.max(r.balanceCents, 0)), euros(Math.max(-r.balanceCents, 0))]),
      ["", "Totales", euros(input.trial.totals.debitCents), euros(input.trial.totals.creditCents), euros(input.trial.totals.debitBalanceCents), euros(input.trial.totals.creditBalanceCents)],
    ]),
    "Sumas y saldos",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head("Cuenta de pérdidas y ganancias"), ["Partida", "Cuenta", "Nombre", "Importe"], ...pnlRows(input.pnl).map((r) => [r[0], r[1], r[2], euros(r[3])])]), "Pérdidas y ganancias");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
