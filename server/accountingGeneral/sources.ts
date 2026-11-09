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
import { and, eq, gte, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { bankMovementLinks, bankMovements, cashMovements, cashRegisters, cashSessions, expenseSuppliers, expenses, invoices, tpvSalePayments } from "../../drizzle/schema";
import { listFiscalDocuments, madridDayRange } from "../fiscalDocumentsDb";
import { madridDayKey } from "../../shared/gestoriaExportPeriod";
import { madridMidnightMs } from "../utils/timezone";
import { ACC_TAX_REVIEW_RETRACTED, isAccDate, type AccAccountMap } from "../../shared/accountingGeneral";
import { cashCloseEntry, categoryRole, desiredOf, cashMoveEntry, centsOf, collectionEntry, expenseEntry, expensePaymentEntry, saleEntry, type Desired, type ExpenseDoc, type ExpenseMethod, type SaleDoc, type TpvMethod, type CashMoveKind, effectiveCashKind, looksLikeRefund, voidTicketCashEntry } from "./rules";

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
  /** Contabilizados, pero para revisar (gastos sin IVA confirmado, movimientos de caja sin tipo…). */
  review: ReviewItem[];
}

/** Algo contabilizado que conviene revisar; `canConfirm`: un gasto con desglose guardado cuyo IVA se puede confirmar. */
export interface ReviewItem {
  key: string;
  message: string;
  expenseId?: number;
  canConfirm?: boolean;
}

/** Desglose de IVA de un gasto confirmado en la contabilidad general (acc_expense_tax_reviews). */
export interface TaxConfirmation {
  amountCents: number;
  taxRateBp: number;
  taxCents: number;
  invoiceType: string | null;
}

/** ¿La confirmación sigue valiendo? Solo si el gasto no ha cambiado (importe, tipo, cuota y tipo de factura). */
export function taxConfirmationMatches(c: TaxConfirmation | null | undefined, r: { amount: unknown; taxRate: unknown; taxAmount: unknown; invoiceType?: unknown }): boolean {
  // Retirada (la fila queda como rastro): nunca vale
  if (!c || c.invoiceType === ACC_TAX_REVIEW_RETRACTED || r.taxAmount == null || r.taxRate == null) return false;
  return c.amountCents === centsOf(r.amount) && c.taxRateBp === Math.round(Number(r.taxRate) * 100) && c.taxCents === centsOf(r.taxAmount) && (c.invoiceType ?? null) === ((r.invoiceType as string | null) ?? null);
}

type Db = { select: (...a: any[]) => any; execute: (q: SQL) => Promise<unknown> };
const CASH_KINDS = new Set<string>(["gasto", "devolucion", "traspaso", "fondo", "cobro", "fianza"]);
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
      out.desired.set(key, desiredOf((m) => voidTicketCashEntry({ number: d.number, date: madridDayKey(d.issuedAt), cashCents }, m), ctx.map));
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
    out.desired.set(key, desiredOf((m) => saleEntry(doc, m), ctx.map));
  }
}

async function readCollections(db: Db, ctx: SourceContext, out: SourceRead) {
  const start = new Date(madridMidnightMs(ctx.startDate));
  const rs = await db
    .select({ id: invoices.id, number: invoices.invoiceNumber, status: invoices.status, total: invoices.total, method: invoices.paymentMethod, validatedAt: invoices.paymentValidatedAt, issuedAt: invoices.issuedAt, clientName: invoices.clientName })
    .from(invoices)
    // También las anteriores al inicio cobradas después: su cobro va contra el saldo de apertura de clientes
    .where(and(eq(invoices.invoiceType, "factura"), or(gte(invoices.issuedAt, start), gte(invoices.paymentValidatedAt, start))));
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
    // Factura anterior al inicio: solo su cobro, y solo si consta cobrada desde el inicio (si no, ya va en la apertura)
    if (issued < ctx.startDate && paid < ctx.startDate) continue;
    const c = { number: r.number, date: paid > issued ? paid : issued, totalCents: centsOf(r.total), method: r.method, clientName: r.clientName ?? "" };
    out.desired.set(key, desiredOf((m) => collectionEntry(c, m), ctx.map));
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
      invoiceType: expenses.invoiceType,
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
  // IVA confirmado en la contabilidad general (nunca se lee fiscalReviewStatus ni se toca el gasto)
  const [confRows] = (await db.execute(sql`SELECT expense_id, amount_cents, tax_rate_bp, tax_cents, invoice_type FROM acc_expense_tax_reviews`)) as unknown as [any[]];
  const confirmations = new Map<number, TaxConfirmation>(
    confRows.map((c) => [Number(c.expense_id), { amountCents: Number(c.amount_cents), taxRateBp: Number(c.tax_rate_bp), taxCents: Number(c.tax_cents), invoiceType: c.invoice_type == null ? null : String(c.invoice_type) }]),
  );
  // Salidas del TPV con el gasto que crearon (tipo explícito o NULL, y su motivo)
  const [moveRows] = (await db.execute(sql`SELECT k.expense_id, k.kind, m.reason FROM acc_cash_movement_kinds k JOIN cash_movements m ON m.id = k.movement_id WHERE k.expense_id IS NOT NULL`)) as unknown as [any[]];
  const tpvMoves = new Map<number, { kind: CashMoveKind | null; reason: string }>(
    moveRows.map((x) => [Number(x.expense_id), { kind: CASH_KINDS.has(String(x.kind)) ? (String(x.kind) as CashMoveKind) : null, reason: text(x.reason) }]),
  );
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
    // Retirada del TPV que en realidad es una devolución a un cliente, SOLO si el cajero no eligió el tipo (movimiento
    // anterior o por API, que el TPV registra como gasto): no se contabiliza como gasto. Su movimiento de caja ya la
    // contabiliza contra clientes. Un «gasto» elegido por el cajero siempre es gasto, diga lo que diga el motivo.
    const tpvMove = r.source === "tpv" ? tpvMoves.get(Number(r.id)) : undefined;
    const tpvRefund = r.source === "tpv" && (tpvMove ? effectiveCashKind({ type: "out", reason: tpvMove.reason, kind: tpvMove.kind }) === "devolucion" : looksLikeRefund(text(r.concept)));
    if (tpvRefund) {
      if (date >= ctx.startDate) {
        out.desired.set(`gasto:${r.id}`, { kind: "none" });
        out.desired.set(`pago:${r.id}`, { kind: "none" });
        out.review.push({ key: `gasto:${r.id}`, message: `El gasto #${r.id} (${text(r.concept).slice(0, 80)}) parece una devolución de efectivo registrada sin tipo en el TPV: no se contabiliza como gasto. Si era un gasto, corrígelo con un asiento manual`, expenseId: Number(r.id) });
      }
      continue;
    }
    const doc = expenseDocOf(r, date, paidOn.get(Number(r.id)), ctx, confirmations.get(Number(r.id)));
    const asRoles = (roles: boolean): ExpenseDoc => (roles ? { ...doc, expenseAccount: categoryRole(Number(r.categoryId)) } : doc);
    // Anterior al inicio de la contabilidad: el gasto va en el asiento de apertura (no se contabiliza solo), pero su
    // pago, si es posterior al inicio, sí: contra el saldo de apertura de proveedores
    if (date < ctx.startDate) {
      if (doc.paidOn >= ctx.startDate) out.desired.set(`pago:${doc.id}`, desiredOf((m, roles) => expensePaymentEntry(asRoles(roles), m), ctx.map));
      continue;
    }
    if (doc.taxUnknown && doc.totalCents !== 0) {
      const canConfirm = r.taxAmount != null && Number.isFinite(Number(r.taxAmount)) && r.taxRate != null;
      const detail = canConfirm ? ` (en Gastos: IVA ${Number(r.taxRate)} %, cuota ${Number(r.taxAmount).toFixed(2).replace(".", ",")} €)` : " (sin cuota guardada en Gastos)";
      out.review.push({
        key: `gasto:${doc.id}`,
        message: `El gasto #${doc.id} (${doc.concept.slice(0, 80) || "sin concepto"}) no tiene el IVA confirmado con la factura${detail}: se contabiliza sin IVA soportado`,
        expenseId: doc.id,
        canConfirm,
      });
    }
    // Huella con la categoría (no con la cuenta que tenga asignada): ver desiredOf
    out.desired.set(`gasto:${doc.id}`, desiredOf((m, roles) => expenseEntry(asRoles(roles), m), ctx.map));
    out.desired.set(`pago:${doc.id}`, desiredOf((m, roles) => expensePaymentEntry(asRoles(roles), m), ctx.map));
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
 * IVA soportado: solo el CONFIRMADO en la contabilidad general (`acc_expense_tax_reviews`, `confirmation`) y si sigue
 * coincidiendo con el gasto. Los campos fiscales del Core (`taxRate`, que trae un 21 % por defecto, `taxBase`,
 * `taxAmount`, la retención y `fiscalReviewStatus`) no se tocan ni bastan: el 303, el 111 y la gestoría siguen igual. Sin
 * confirmación, el gasto se contabiliza sin IVA soportado (`taxUnknown`, para revisar). Sin factura o exenta, nunca.
 */
export function expenseDocOf(r: any, date: string, bankPaidOn: string | undefined, ctx: Pick<SourceContext, "map" | "categoryAccounts">, confirmation?: TaxConfirmation | null): ExpenseDoc {
  const expenseDate = text(r.date).slice(0, 10);
  const fromTpv = r.source === "tpv";
  const payroll = typeof r.source === "string" && r.source.startsWith("hr_");
  const storedRate = Number(r.taxRate);
  const storedTax = Number(r.taxAmount);
  // Sin factura o exenta: nunca deduce (no hay nada que revisar)
  const nonDeductible = r.invoiceType === "sin_factura" || r.invoiceType === "exenta";
  const taxKnown = !nonDeductible && taxConfirmationMatches(confirmation, r) && Number.isFinite(storedTax) && Number.isFinite(storedRate);
  const taxUnknown = !payroll && !nonDeductible && !taxKnown;
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
    const c = { sessionId: s.id, date: madridDayKey(new Date(Number(s.closedAt))), differenceCents: centsOf(s.diff), register: s.register ?? "" };
    out.desired.set(`cierre:${s.id}`, desiredOf((m) => cashCloseEntry(c, m), ctx.map));
  }
  const moves = await db
    .select({ id: cashMovements.id, type: cashMovements.type, amount: cashMovements.amount, reason: cashMovements.reason, createdAt: cashMovements.createdAt })
    .from(cashMovements)
    .where(gte(cashMovements.createdAt, since));
  // Tipo de cada movimiento (tpv.addCashMovement, depositStore) y el gasto que creó: su contrapartida real
  const kinds = new Map<number, CashMoveKind>();
  const linkedExpense = new Set<number>();
  const tpvExpenseKeys = new Set<string>();
  const depositBeforeStart = new Set<number>();
  if ((moves as unknown[]).length) {
    const [kr] = (await db.execute(sql`SELECT movement_id, kind, expense_id FROM acc_cash_movement_kinds`)) as unknown as [Array<{ movement_id: number; kind: string | null; expense_id: number | null }>];
    for (const k of kr) {
      if (k.kind != null && CASH_KINDS.has(k.kind)) kinds.set(Number(k.movement_id), k.kind as CashMoveKind);
      if (k.expense_id != null) linkedExpense.add(Number(k.movement_id));
    }
    // Fianzas del alquiler anteriores a la 0060: las identifica su evento (ski_deposit_events.cash_movement_id)
    try {
      const [dr] = (await db.execute(sql`SELECT e.cash_movement_id AS id, e.deposit_id, m.createdAt AS at FROM ski_deposit_events e JOIN cash_movements m ON m.id = e.cash_movement_id WHERE e.cash_movement_id IS NOT NULL`)) as unknown as [Array<{ id: number; deposit_id: number | null; at: number }>];
      const firstMove = new Map<number, number>();
      for (const d of dr) {
        if (!kinds.has(Number(d.id))) kinds.set(Number(d.id), "fianza");
        if (d.deposit_id != null) firstMove.set(Number(d.deposit_id), Math.min(firstMove.get(Number(d.deposit_id)) ?? Infinity, Number(d.at)));
      }
      // Fianza cobrada antes de la fecha de inicio y liquidada después: su cobro va en el asiento de apertura (560)
      for (const d of dr) {
        if (d.deposit_id != null && Number(d.at) >= since && (firstMove.get(Number(d.deposit_id)) ?? Infinity) < since) depositBeforeStart.add(Number(d.id));
      }
    } catch {
      // Sin el alquiler instalado no hay fianzas
    }
    // Gastos que el TPV creó para salidas anteriores a su enlace (mismo motivo e importe)
    const tx = await db.select({ concept: expenses.concept, amount: expenses.amount }).from(expenses).where(eq(expenses.source, "tpv"));
    for (const e of tx as Array<{ concept: string; amount: string }>) tpvExpenseKeys.add(`${text(e.concept)}|${centsOf(e.amount)}`);
  }
  for (const m of moves as Array<{ id: number; type: "in" | "out"; amount: string; reason: string; createdAt: number }>) {
    const c = { id: m.id, date: madridDayKey(new Date(Number(m.createdAt))), type: m.type, amountCents: centsOf(m.amount), reason: m.reason ?? "", kind: kinds.get(Number(m.id)) ?? null };
    out.desired.set(`cajamov:${m.id}`, desiredOf((map) => cashMoveEntry(c, map), ctx.map));
    if (c.amountCents === 0) continue;
    const key = `cajamov:${m.id}`;
    const what = `${m.type === "in" ? "Entrada" : "Salida"} de caja #${m.id} (${c.reason.slice(0, 80)})`;
    const effective = effectiveCashKind(c);
    // Lo que queda en el puente de caja (555) sin nada que lo salde, para revisar
    const clearedByExpense = linkedExpense.has(Number(m.id)) || tpvExpenseKeys.has(`Retirada de caja TPV — ${c.reason}|${c.amountCents}`);
    if (depositBeforeStart.has(Number(m.id))) out.review.push({ key, message: `${what}: fianza cobrada antes del inicio de la contabilidad; su cobro debe estar en el asiento de apertura (fianzas recibidas, 560)` });
    if (m.type === "in" && c.kind == null) out.review.push({ key, message: `${what} sin tipo: queda en el puente de caja (555) hasta aplicarla` });
    else if (m.type === "out" && c.kind == null && effective === "devolucion") out.review.push({ key, message: `${what} sin tipo: por su motivo se contabiliza como devolución a un cliente` });
    else if (m.type === "out" && effective === "gasto" && !clearedByExpense) out.review.push({ key, message: `${what} de tipo gasto sin su gasto (¿faltaba la categoría o el centro de coste?): queda en el puente de caja (555)` });
    else if (m.type === "out" && effective == null && !clearedByExpense) out.review.push({ key, message: `${what} sin tipo y sin gasto que la salde (¿un traspaso anterior?): queda en el puente de caja (555)` });
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
