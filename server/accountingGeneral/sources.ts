/**
 * Contabilidad general — lo que ya registra el Core en la BD de la empresa en curso, leído SOLO para contabilizarlo
 * (nunca se modifica ningún documento):
 *  - facturas, abonos y tickets de caja: los documentos fiscales de server/fiscalDocumentsDb.ts, con la misma regla de
 *    cálculo y la de no duplicar que Informes, el Modelo 303 y el libro de la gestoría;
 *  - cobros de facturas (`invoices.status = cobrada`) y cobros de los tickets (`tpv_sale_payments` completados);
 *  - gastos (`expenses`) con su IVA soportado y su pago (fecha del movimiento bancario conciliado, si lo hay);
 *  - cierres de las sesiones de caja del TPV (`cash_sessions`) y sus movimientos manuales (`cash_movements`).
 *
 * Cada documento se resuelve en lo que pide hoy (`Desired`) bajo su clave natural. Un grupo que no puede leerse se
 * omite entero (sus asientos no se tocan) y queda en el resumen.
 */
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { bankMovementLinks, bankMovements, cashMovements, cashRegisters, cashSessions, expenseSuppliers, expenses, invoices, tpvSalePayments } from "../../drizzle/schema";
import { listFiscalDocuments, madridDayRange } from "../fiscalDocumentsDb";
import { madridDayKey } from "../../shared/gestoriaExportPeriod";
import { madridMidnightMs } from "../utils/timezone";
import { isAccDate, type AccAccountMap } from "../../shared/accountingGeneral";
import { cashCloseEntry, cashMoveEntry, centsOf, collectionEntry, expenseEntry, expensePaymentEntry, saleEntry, type Desired, type ExpenseDoc, type ExpenseMethod, type SaleDoc, type TpvMethod, voidTicketCashEntry } from "./rules";

/** Grupos de documentos y el prefijo de su clave. */
export const SOURCE_GROUPS = {
  sales: ["inv:", "tpv:"],
  collections: ["cobro:"],
  expenses: ["gasto:", "pago:"],
  cash: ["cierre:", "cajamov:"],
} as const;
export type SourceGroup = keyof typeof SOURCE_GROUPS;
export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  sales: "Facturas, abonos y tickets",
  collections: "Cobros de facturas",
  expenses: "Gastos y pagos",
  cash: "Cierres y movimientos de caja",
};

export interface SourceContext {
  startDate: string;
  map: AccAccountMap;
  /** Categoría de gasto → cuenta del grupo 6 (sin entrada, la de por defecto). */
  categoryAccounts: ReadonlyMap<number, string>;
}

export interface SourceRead {
  desired: Map<string, Desired>;
  /** Grupos leídos (solo sus claves pueden revertirse por «documento desaparecido»). */
  groups: SourceGroup[];
  failed: Array<{ group: SourceGroup; message: string }>;
  /** Documentos que no se pudieron convertir en asiento (datos incompletos). */
  problems: Array<{ key: string; message: string }>;
  /** Contabilizados, pero para revisar (gastos sin IVA real: sin IVA soportado). */
  review: Array<{ key: string; message: string }>;
}

type Db = { select: (...a: any[]) => any };
const END = "2100-12-31";
const text = (v: unknown) => (v == null ? "" : String(v));

async function readSales(db: Db, ctx: SourceContext, out: SourceRead) {
  const docs = await listFiscalDocuments(madridDayRange(ctx.startDate, END));
  // Tickets que cuentan y los anulados o devueltos después de cobrarlos (no los sustituidos por una factura)
  const voided = (d: (typeof docs)[number]) => d.kind === "ticket" && !d.counts && !d.substitutedBy;
  const ticketIds = docs.filter((d) => d.kind === "ticket" && (d.counts || voided(d))).map((d) => d.id);
  const payments = new Map<number, Array<{ method: TpvMethod; cents: number }>>();
  for (let i = 0; i < ticketIds.length; i += 1000) {
    const part = ticketIds.slice(i, i + 1000);
    const rs = await db
      .select({ saleId: tpvSalePayments.saleId, method: tpvSalePayments.method, amount: tpvSalePayments.amount })
      .from(tpvSalePayments)
      .where(and(inArray(tpvSalePayments.saleId, part), eq(tpvSalePayments.status, "completed")));
    for (const p of rs as Array<{ saleId: number; method: TpvMethod; amount: string }>) {
      const arr = payments.get(p.saleId) ?? [];
      arr.push({ method: p.method, cents: centsOf(p.amount) });
      payments.set(p.saleId, arr);
    }
  }
  for (const d of docs) {
    const key = `${d.kind === "ticket" ? "tpv" : "inv"}:${d.id}`;
    if (!d.counts) {
      const cashCents = voided(d) ? (payments.get(d.id) ?? []).filter((p) => p.method === "cash").reduce((a, p) => a + p.cents, 0) : 0;
      const draft = voidTicketCashEntry({ number: d.number, date: madridDayKey(d.issuedAt), cashCents }, ctx.map);
      out.desired.set(key, draft ? { kind: "entry", draft } : { kind: "none" });
      continue;
    }
    const doc: SaleDoc = {
      kind: d.kind,
      id: d.id,
      number: d.number,
      date: madridDayKey(d.issuedAt),
      clientName: d.clientName,
      rectifies: d.rectifies,
      byRate: d.byRate.map((b) => ({ rateBp: Math.round(b.rate * 100), baseCents: centsOf(b.base), taxCents: centsOf(b.amount) })),
      totalCents: centsOf(d.total),
      payments: d.kind === "ticket" ? payments.get(d.id) ?? [] : undefined,
    };
    const draft = saleEntry(doc, ctx.map);
    out.desired.set(key, draft ? { kind: "entry", draft } : { kind: "none" });
  }
}

async function readCollections(db: Db, ctx: SourceContext, out: SourceRead) {
  const rs = await db
    .select({ id: invoices.id, number: invoices.invoiceNumber, status: invoices.status, total: invoices.total, method: invoices.paymentMethod, validatedAt: invoices.paymentValidatedAt, issuedAt: invoices.issuedAt, clientName: invoices.clientName })
    .from(invoices)
    .where(and(eq(invoices.invoiceType, "factura"), gte(invoices.issuedAt, new Date(madridMidnightMs(ctx.startDate)))));
  for (const r of rs as Array<{ id: number; number: string; status: string; total: string; method: string | null; validatedAt: Date | null; issuedAt: Date; clientName: string }>) {
    const key = `cobro:${r.id}`;
    // Abonada: no consta si llegó a cobrarse antes del abono; se deja lo que hubiera
    if (r.status === "abonada") {
      out.desired.set(key, { kind: "keep" });
      continue;
    }
    if (r.status !== "cobrada") {
      out.desired.set(key, { kind: "none" });
      continue;
    }
    const issued = madridDayKey(r.issuedAt);
    const paid = r.validatedAt ? madridDayKey(r.validatedAt) : issued;
    const draft = collectionEntry({ number: r.number, date: paid > issued ? paid : issued, totalCents: centsOf(r.total), method: r.method, clientName: r.clientName ?? "" }, ctx.map);
    out.desired.set(key, draft ? { kind: "entry", draft } : { kind: "none" });
  }
}

async function readExpenses(db: Db, ctx: SourceContext, out: SourceRead) {
  const rs = await db
    .select({
      id: expenses.id,
      date: expenses.date,
      accrualDate: expenses.accrualDate,
      concept: expenses.concept,
      amount: expenses.amount,
      taxAmount: expenses.taxAmount,
      taxRate: expenses.taxRate,
      deductiblePercent: expenses.deductiblePercent,
      retentionAmount: expenses.retentionAmount,
      supplierName: expenses.supplierName,
      supplier: expenseSuppliers.name,
      categoryId: expenses.categoryId,
      paymentMethod: expenses.paymentMethod,
      source: expenses.source,
      fiscalReviewStatus: expenses.fiscalReviewStatus,
    })
    .from(expenses)
    .leftJoin(expenseSuppliers, eq(expenseSuppliers.id, expenses.supplierId));
  const links = await db
    .select({ expenseId: bankMovementLinks.entityId, fecha: bankMovements.fecha })
    .from(bankMovementLinks)
    .innerJoin(bankMovements, eq(bankMovements.id, bankMovementLinks.bankMovementId))
    .where(and(eq(bankMovementLinks.entityType, "expense"), eq(bankMovementLinks.status, "confirmed")));
  const paidOn = new Map<number, string>();
  for (const l of links as Array<{ expenseId: number; fecha: string }>) {
    const f = text(l.fecha).slice(0, 10);
    if (isAccDate(f) && (!paidOn.has(l.expenseId) || f < paidOn.get(l.expenseId)!)) paidOn.set(l.expenseId, f);
  }
  for (const r of rs as any[]) {
    const expenseDate = text(r.date).slice(0, 10);
    const date = r.accrualDate && isAccDate(text(r.accrualDate).slice(0, 10)) ? text(r.accrualDate).slice(0, 10) : expenseDate;
    if (!isAccDate(date)) {
      out.problems.push({ key: `gasto:${r.id}`, message: `El gasto #${r.id} no tiene una fecha válida` });
      // Sin fecha no se sabe qué pide: se deja lo que hubiera
      out.desired.set(`gasto:${r.id}`, { kind: "keep" });
      out.desired.set(`pago:${r.id}`, { kind: "keep" });
      continue;
    }
    // Anterior al inicio de la contabilidad: no se contabiliza solo (va en el asiento de apertura)
    if (date < ctx.startDate) continue;
    const doc = expenseDocOf(r, date, paidOn.get(Number(r.id)), ctx);
    if (doc.taxUnknown && doc.totalCents !== 0) {
      out.review.push({ key: `gasto:${doc.id}`, message: `El gasto #${doc.id} (${doc.concept.slice(0, 80) || "sin concepto"}) no tiene el IVA revisado: se contabiliza sin IVA soportado hasta que se revise en Gastos` });
    }
    const e = expenseEntry(doc, ctx.map);
    const p = expensePaymentEntry(doc, ctx.map);
    out.desired.set(`gasto:${doc.id}`, e ? { kind: "entry", draft: e } : { kind: "none" });
    out.desired.set(`pago:${doc.id}`, p ? { kind: "entry", draft: p } : { kind: "none" });
  }
}

/**
 * Fila de `expenses` → gasto contable (puro). `date` es la de devengo ya validada; `bankPaidOn`, la del movimiento
 * bancario conciliado, si lo hay.
 *
 * Retirada de caja del TPV de tipo «gasto» (`source = "tpv"`, `tpv.addCashMovement`): el TPV guarda a la vez el
 * movimiento de caja (`cash_movements`, que ya contabiliza la salida: Debe 555 · Haber 570) y este gasto. Para que la
 * caja se abone una sola vez, el pago del gasto va contra el puente de caja (como `tpv_cash`) y no otra vez contra la
 * caja: el 555 queda saldado y el gasto, en la cuenta de su categoría.
 *
 * IVA soportado: solo el de datos reales. La columna `taxRate` trae un 21 % por defecto y la regularización de gastos
 * antiguos (`expenses.backfillFiscal`) guarda cuotas estimadas al 21 % como «pendiente»; los gastos del TPV, de la
 * conciliación bancaria, del formulario público o de los recurrentes no traen desglose. El único desglose real es el del
 * formulario de gastos, que lo marca `fiscalReviewStatus = revisado`. Sin él (o sin cuota guardada), el gasto se
 * contabiliza sin IVA soportado (`taxUnknown`, para revisar): todo el importe va a su cuenta de gasto. Al revisarlo, el
 * documento cambia y su asiento se corrige solo.
 */
export function expenseDocOf(r: any, date: string, bankPaidOn: string | undefined, ctx: Pick<SourceContext, "map" | "categoryAccounts">): ExpenseDoc {
  const expenseDate = text(r.date).slice(0, 10);
  const fromTpv = r.source === "tpv";
  const payroll = typeof r.source === "string" && r.source.startsWith("hr_");
  const storedRate = Number(r.taxRate);
  const storedTax = Number(r.taxAmount);
  const taxKnown = r.fiscalReviewStatus === "revisado" && r.taxAmount != null && Number.isFinite(storedTax) && r.taxRate != null && Number.isFinite(storedRate);
  const taxUnknown = !payroll && !taxKnown;
  const rate = taxKnown ? storedRate : 0;
  const taxCents = taxKnown ? centsOf(storedTax) : 0;
  const ded = Number(r.deductiblePercent ?? 100);
  const method = (r.paymentMethod ?? "transfer") as ExpenseMethod;
  return {
    id: Number(r.id),
    date,
    concept: text(r.concept),
    supplierName: text(r.supplier || r.supplierName),
    totalCents: centsOf(r.amount),
    taxCents,
    rateBp: Math.round(rate * 100),
    deductibleBp: Math.max(0, Math.min(10_000, Math.round((Number.isFinite(ded) ? ded : 100) * 100))),
    retentionCents: centsOf(r.retentionAmount),
    payroll,
    taxUnknown,
    expenseAccount: ctx.categoryAccounts.get(Number(r.categoryId)) ?? ctx.map.defaultExpense,
    method: fromTpv && method === "cash" ? "tpv_cash" : method,
    paidOn: bankPaidOn ?? (isAccDate(expenseDate) ? expenseDate : date),
  };
}

async function readCash(db: Db, ctx: SourceContext, out: SourceRead) {
  const since = madridMidnightMs(ctx.startDate);
  const sessions = await db
    .select({ id: cashSessions.id, closedAt: cashSessions.closedAt, diff: cashSessions.cashDifference, register: cashRegisters.name })
    .from(cashSessions)
    .leftJoin(cashRegisters, eq(cashRegisters.id, cashSessions.registerId))
    .where(and(eq(cashSessions.status, "closed"), isNotNull(cashSessions.closedAt), gte(cashSessions.closedAt, since)));
  for (const s of sessions as Array<{ id: number; closedAt: number; diff: string | null; register: string | null }>) {
    const draft = cashCloseEntry({ sessionId: s.id, date: madridDayKey(new Date(Number(s.closedAt))), differenceCents: centsOf(s.diff), register: s.register ?? "" }, ctx.map);
    out.desired.set(`cierre:${s.id}`, draft ? { kind: "entry", draft } : { kind: "none" });
  }
  const moves = await db
    .select({ id: cashMovements.id, type: cashMovements.type, amount: cashMovements.amount, reason: cashMovements.reason, createdAt: cashMovements.createdAt })
    .from(cashMovements)
    .where(gte(cashMovements.createdAt, since));
  for (const m of moves as Array<{ id: number; type: "in" | "out"; amount: string; reason: string; createdAt: number }>) {
    const draft = cashMoveEntry({ id: m.id, date: madridDayKey(new Date(Number(m.createdAt))), type: m.type, amountCents: centsOf(m.amount), reason: m.reason ?? "" }, ctx.map);
    out.desired.set(`cajamov:${m.id}`, draft ? { kind: "entry", draft } : { kind: "none" });
  }
}

const READERS: Record<SourceGroup, (db: Db, ctx: SourceContext, out: SourceRead) => Promise<void>> = {
  sales: readSales,
  collections: readCollections,
  expenses: readExpenses,
  cash: readCash,
};

/** Lee todos los grupos; uno que falle no impide los demás. */
export async function readSources(db: Db, ctx: SourceContext): Promise<SourceRead> {
  const out: SourceRead = { desired: new Map(), groups: [], failed: [], problems: [], review: [] };
  for (const g of Object.keys(READERS) as SourceGroup[]) {
    const part: SourceRead = { desired: new Map(), groups: [], failed: [], problems: [], review: [] };
    try {
      await READERS[g](db, ctx, part);
      part.desired.forEach((v, k) => out.desired.set(k, v));
      out.problems.push(...part.problems);
      out.review.push(...part.review);
      out.groups.push(g);
    } catch (e) {
      out.failed.push({ group: g, message: e instanceof Error ? e.message.slice(0, 300) : "Error desconocido" });
    }
  }
  return out;
}

/** ¿La clave es de un grupo leído? */
export const keyInGroups = (key: string, groups: readonly SourceGroup[]) => groups.some((g) => SOURCE_GROUPS[g].some((p) => key.startsWith(p)));
