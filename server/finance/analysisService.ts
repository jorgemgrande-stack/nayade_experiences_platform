/**
 * Servicio de la fase 4 (CRM 0038): control diario con revisión, cuenta de resultados, balance, tesorería y previsión,
 * antigüedad de saldos, gastos, Revenue & Margin y Conversion Health. Es LECTURA: los informes salen del libro (sumas
 * agregadas en la BD), de las operaciones, de Stripe y de la gestoría; no hay fuentes paralelas. Solo escribe la
 * revisión diaria (con su bitácora) y la marca de coste directo de las categorías, con auditoría en `fin_audit_log`.
 *
 * Métricas comerciales (MRR/ARR de /revenue/metrics y rentabilidad por empresa de /resources/profitability): se
 * CONSUMEN tal cual a través de `CommercialSources` (las construye el plano de control con las mismas funciones que sus
 * rutas) y se devuelven aparte, rotuladas como comerciales, nunca mezcladas con lo contable.
 */
import { madridDateKey, madridEndOfDayUtc, madridStartOfDayUtc } from "../utils/timezone";
import type { OwnInvoiceDirectory } from "./ownInvoices";
import type { FinanceOpsStore } from "./opsStore";
import { addDays } from "./opsRules";
import { isValidDate } from "./rules";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import type { FinanceStripeService } from "./stripeService";
import type { FinanceStripeStore } from "./stripeStore";
import type { FinanceTaxService } from "./taxService";
import { OPEN_STATUSES } from "./taxTypes";
import {
  balancesOfFacts,
  buildAging,
  buildBalance,
  buildCashflow,
  buildConversion,
  buildExpenseGroups,
  buildForecast,
  buildPnl,
  buildRevenueMargin,
  compareRange,
  dailyAlerts,
  monthRange,
  monthsBetween,
  periodsOf,
  RECEIVABLE_OVERDUE_DAYS,
  resolveDirectCost,
  shiftPeriods,
  ymOf,
  type AgingDoc,
  type CompareKind,
  type ConversionInvoice,
  type ExpenseGroup,
  type Granularity,
} from "./analysisRules";
import { NON_FLOW_ORIGINS, type FinanceAnalysisStore } from "./analysisStore";
import type { DailyCounts, DailyReview, PaymentEventMonth } from "./analysisTypes";
import { FinanceError, type FinanceActor } from "./types";
import { BANK_FEE_NATURE_LABELS, BANK_FEE_NATURES, type BankFeeNature } from "./opsTypes";
import { STRIPE_FEES_TREATMENTS, type AnalysisSettings, type StripeFeesTreatment } from "./analysisTypes";

/** Eventos de cobro del registro comercial en solo lectura (null = no se pueden leer). */
export interface PaymentEventSource {
  monthly(from: string, to: string): Promise<PaymentEventMonth[] | null>;
}

/** Métricas comerciales existentes, consumidas sin recalcular (las construye el plano de control). */
export interface CommercialSources {
  /** Resultado de `revenueMetrics` (como /revenue/metrics); null = sin servicios externos ni suscripciones. */
  metrics?: (() => Promise<CommercialMetrics | null>) | null;
  /** Informe de /resources/profitability; null = sin permiso o sin medición. */
  profitability?: ((days: 30 | 90 | 365) => Promise<ProfitabilityReport>) | null;
}
export interface CommercialMetrics {
  windowDays: number;
  currency: string;
  mrrCents: number;
  arrCents: number;
  payingCompanies: number;
  collected: { netCents: number; taxCents: number; grossCents: number; invoices: number };
  churn: { canceledCount: number; lostMrrCents: number; rate: number | null };
}
export interface ProfitabilityReport {
  days: number;
  complete: boolean;
  tenants: Array<{ key: string; kind: string; displayName: string; revenue: { billedCents: number }; cost: { totalCents: number | null }; margin: { complete: boolean; cents: number | null; provisionalCents: number | null } }>;
}

export interface FinanceAnalysisDeps {
  store: FinanceAnalysisStore;
  /** Libro de la fase 1A: auditoría, plan contable y borradores. */
  finance: FinanceService;
  ledger: Pick<FinanceStore, "listEntries">;
  /** Operaciones (fase 1B): categorías, centros, cuentas bancarias y movimientos. */
  ops: FinanceOpsStore;
  /** Stripe y conciliación (fase 2): sin ellos, lo que depende de Stripe y de la conciliación por factura es null. */
  stripe?: { service: FinanceStripeService; store: FinanceStripeStore } | null;
  /** Gestoría (fase 3): obligaciones fiscales. */
  tax?: Pick<FinanceTaxService, "listObligations"> | null;
  /** Facturas propias (solo lectura) para el control diario. */
  invoices?: OwnInvoiceDirectory | null;
  /** Registro comercial (solo lectura) para la tasa de pagos fallidos. */
  paymentEvents?: PaymentEventSource | null;
  /** Migración 0039 aplicada: configuración del análisis (comisiones de Stripe y naturalezas bancarias). */
  fiscal?: boolean;
  now?: () => number;
}

type Chain = Awaited<ReturnType<FinanceStripeService["reconciliationInvoices"]>>["items"][number];
const CHAIN_PAGE = 500;
const CHAIN_MAX_PAGES = 40;
const bad = (m: string) => new FinanceError("invalid_input", m);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Obligaciones que aún tienen un pago por delante (previsión de tesorería). */
const TAX_TO_PAY = ["pendiente", "borrador", "revisado", "presentado", "domiciliado", "aplazado"] as const;

export class FinanceAnalysisService {
  private readonly now: () => number;
  constructor(private readonly d: FinanceAnalysisDeps) {
    this.now = d.now ?? Date.now;
  }

  today(): string {
    return madridDateKey(new Date(this.now()));
  }
  private s() {
    return this.d.store;
  }
  private async names() {
    return new Map((await this.d.finance.accounts()).map((a) => [a.code, a.name]));
  }
  private day(date: string | undefined) {
    const d = date ?? this.today();
    if (!isValidDate(d)) throw bad("Fecha no válida (AAAA-MM-DD)");
    return d;
  }

  /** Todas las cadenas factura → cobro → payout → banco de un rango (null sin Stripe o sin facturas propias). */
  private async chains(from?: string, to?: string): Promise<{ items: Chain[]; truncated: boolean } | null> {
    const stripe = this.d.stripe?.service;
    if (!stripe) return null;
    const items: Chain[] = [];
    try {
      for (let page = 0; page < CHAIN_MAX_PAGES; page++) {
        const p = await stripe.reconciliationInvoices({ from, to, limit: CHAIN_PAGE, offset: page * CHAIN_PAGE });
        items.push(...p.items);
        if (p.items.length < CHAIN_PAGE || items.length >= p.total) return { items, truncated: false };
      }
    } catch (e) {
      if (e instanceof FinanceError && e.code === "unavailable") return null;
      throw e;
    }
    return { items, truncated: true };
  }

  // ── Categorías: marca de coste directo ────────────────────────────────────────────────────────────────────────

  /** Categorías con su marca guardada (`isDirectCost`, null = según cuenta) y la resuelta (`directCost`). */
  async decorateCategories<T extends { id: number; name: string; accountCode: string }>(items: T[]): Promise<Array<T & { isDirectCost: boolean | null; directCost: boolean }>> {
    const flags = await this.s().categoryFlags();
    return items.map((c) => {
      const isDirectCost = flags.get(c.id) ?? null;
      return { ...c, isDirectCost, directCost: resolveDirectCost({ name: c.name, accountCode: c.accountCode, isDirectCost }) };
    });
  }

  async setDirectCost(id: number, value: boolean | null, actor: FinanceActor) {
    if (!(await this.s().setCategoryFlag(id, value))) throw new FinanceError("not_found", "Categoría no encontrada");
    await this.d.finance.recordAudit(actor, "category.direct_cost", "category", id, { isDirectCost: value });
  }

  // ── Configuración del análisis (CRM 0039) ─────────────────────────────────────────────────────────────────────

  /** ¿Está aplicada la migración 0039? */
  get fiscal() {
    return !!this.d.fiscal;
  }

  /** Configuración del análisis con las naturalezas bancarias y su etiqueta (finance:read; la edición, finance:config). */
  async analysisSettings() {
    const s = await this.s().getAnalysisSettings();
    return { ...s, natures: BANK_FEE_NATURES.map((key) => ({ key, label: BANK_FEE_NATURE_LABELS[key], accountCode: s.bankFeeAccounts[key] })) };
  }

  /**
   * Guarda la configuración (cambio parcial). Cada cuenta de naturaleza debe existir, ser imputable, estar activa y ser
   * del grupo 6.
   */
  async saveAnalysisSettings(p: { stripeFeesTreatment?: StripeFeesTreatment; bankFeeAccounts?: Partial<Record<BankFeeNature, string>> }, actor: FinanceActor) {
    if (!this.fiscal) throw new FinanceError("unavailable", "La configuración del análisis llega con la migración 0039, que no está aplicada en este entorno");
    const cur = await this.s().getAnalysisSettings();
    const next = { stripeFeesTreatment: p.stripeFeesTreatment ?? cur.stripeFeesTreatment, bankFeeAccounts: { ...cur.bankFeeAccounts, ...Object.fromEntries(Object.entries(p.bankFeeAccounts ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v).trim()])) } as AnalysisSettings["bankFeeAccounts"] };
    if (!(STRIPE_FEES_TREATMENTS as readonly string[]).includes(next.stripeFeesTreatment)) throw bad("Tratamiento de las comisiones de Stripe: direct_cost, structure o financial");
    const accounts = new Map((await this.d.finance.accounts()).map((a) => [a.code, a]));
    for (const n of BANK_FEE_NATURES) {
      const code = next.bankFeeAccounts[n];
      const a = accounts.get(code);
      if (!a || !a.active || !a.isPostable || !code.startsWith("6")) throw bad(`La cuenta de «${BANK_FEE_NATURE_LABELS[n].toLowerCase()}» debe existir, estar activa, ser imputable y del grupo 6 (${code})`);
    }
    const saved = await this.s().saveAnalysisSettings(next, actor.by, this.now());
    await this.d.finance.recordAudit(actor, "analysis.settings", "analysis_settings", 1, { stripeFeesTreatment: saved.stripeFeesTreatment, bankFeeAccounts: saved.bankFeeAccounts });
    return this.analysisSettings();
  }

  /** Cuenta de una naturaleza de comisión bancaria (enchufado al servicio de operaciones para conciliar). */
  async natureAccount(nature: BankFeeNature): Promise<string> {
    if (!(BANK_FEE_NATURES as readonly string[]).includes(nature)) throw bad("Naturaleza no válida");
    return (await this.s().getAnalysisSettings()).bankFeeAccounts[nature];
  }

  private async directCategories(): Promise<Set<number>> {
    return new Set((await this.decorateCategories(await this.d.ops.listCategories())).filter((c) => c.directCost).map((c) => c.id));
  }

  // ── Control diario ────────────────────────────────────────────────────────────────────────────────────────────

  async daily(date?: string) {
    const day = this.day(date);
    const today = this.today();
    const stripe = this.d.stripe;
    const [invoicePage, aggregates, issues, payoutsDay, payoutStats, movementsDay, pending, registered, due, drafts, taxSoon, taxLate, overdueReceivables, review] = await Promise.all([
      this.d.invoices ? this.d.invoices.list({ from: day, to: day, limit: 500, offset: 0 }) : Promise.resolve(null),
      stripe ? stripe.store.aggregates(day, day) : Promise.resolve(null),
      stripe ? stripe.store.issueCounts() : Promise.resolve(null),
      stripe ? stripe.store.listPayouts({ from: day, to: day, limit: 200 }) : Promise.resolve(null),
      stripe ? stripe.store.payoutStats(day, day) : Promise.resolve(null),
      this.d.ops.listMovements({ from: day, to: day, limit: 500 }),
      this.s().pendingMovements(day),
      this.s().expensesRegistered(madridStartOfDayUtc(day).getTime(), madridEndOfDayUtc(day).getTime()),
      this.s().dueBuckets(day),
      this.d.ledger.listEntries({ status: "draft", limit: 1 }),
      this.d.tax ? this.d.tax.listObligations({ dueFrom: day, dueTo: addDays(day, 15), statuses: [...OPEN_STATUSES], limit: 50 }) : Promise.resolve(null),
      this.d.tax ? this.d.tax.listObligations({ dueTo: addDays(day, -1), statuses: [...OPEN_STATUSES], limit: 1 }) : Promise.resolve(null),
      stripe ? this.overdueReceivables(day) : Promise.resolve(null),
      this.reviewWithLog(day),
    ]);
    const agg = (t: string) => aggregates?.find((a) => a.type === t) ?? { count: 0, grossCents: 0, feeCents: 0, netCents: 0 };
    const charges = agg("charge");
    const refunds = { count: agg("refund").count + agg("refund_failure").count, grossCents: agg("refund").grossCents + agg("refund_failure").grossCents };
    const feeVatUnset = this.fiscal && stripe ? await stripe.service.pendingFeeVatCount() : null;
    const counts: Record<Exclude<keyof DailyCounts, "stripeFeeVatUnset">, number | null> & { stripeFeeVatUnset?: number | null } = {
      ...(this.fiscal ? { stripeFeeVatUnset: feeVatUnset } : {}),
      invoicesIssued: invoicePage ? invoicePage.total : null,
      stripeCharges: aggregates ? charges.count : null,
      payoutsArriving: payoutsDay ? payoutsDay.total : null,
      payoutsWithoutBank: payoutStats ? payoutStats.withoutBank : null,
      bankMovements: movementsDay.total,
      bankPending: pending.count,
      expensesRegistered: registered.count,
      paymentsOverdue: due.overdue.count,
      paymentsDueToday: due.today.count,
      paymentsDueNext7: due.next7.count,
      receivablesOverdue: overdueReceivables ? overdueReceivables.count : null,
      stripeIssuesOpen: issues ? issues.open : null,
      taxDueNext15: taxSoon ? taxSoon.total : null,
      taxOverdue: taxLate ? taxLate.total : null,
      draftEntries: drafts.total,
    };
    return {
      date: day,
      today,
      counts,
      alerts: dailyAlerts(counts),
      invoices: invoicePage ? { count: invoicePage.total, totalCents: sum(invoicePage.items.map((i) => i.totalCents)), items: invoicePage.items.slice(0, 50).map((i) => ({ id: i.id, number: i.number, customerName: i.customerName, totalCents: i.totalCents, paymentStatus: i.paymentStatus })) } : null,
      stripe: aggregates && issues ? { charges: { count: charges.count, grossCents: charges.grossCents, feeCents: charges.feeCents, netCents: charges.netCents }, refunds, issuesOpen: issues.open, disputesOpen: issues.disputes } : null,
      payouts:
        payoutsDay && payoutStats
          ? { arriving: payoutsDay.items.map((p) => ({ id: p.id, payoutId: p.payoutId, amountCents: p.amountCents, status: p.status, arrivalOn: p.arrivalOn, entryId: p.entryId, bankMovementId: p.bankMovementId, inBank: p.bankMovementId !== null })), withoutBank: payoutStats.withoutBank }
          : null,
      bank: {
        movements: { count: movementsDay.total, inCents: sum(movementsDay.items.filter((m) => m.amountCents > 0).map((m) => m.amountCents)), outCents: -sum(movementsDay.items.filter((m) => m.amountCents < 0).map((m) => m.amountCents)) || 0 },
        pending,
      },
      expenses: { registered, due },
      receivables: overdueReceivables,
      tax: taxSoon && taxLate ? { dueNext15: taxSoon.items.map((o) => ({ id: o.id, model: o.model, year: o.year, period: o.period, dueDate: o.dueDate, status: o.status, amountCents: o.amountCents })), overdue: taxLate.total } : null,
      entries: { drafts: drafts.total },
      review,
    };
  }

  /** Facturas pendientes de cobro con más de 30 días a una fecha (estado de la conciliación por factura). */
  private async overdueReceivables(day: string) {
    try {
      const out = await this.d.stripe!.service.reconciliationInvoices({ status: "pendiente_cobro", to: addDays(day, -RECEIVABLE_OVERDUE_DAYS), limit: 500, offset: 0 });
      return { count: out.total, amountCents: sum(out.items.map((i) => i.totalCents - Math.max(i.collectedCents, 0))), days: RECEIVABLE_OVERDUE_DAYS };
    } catch (e) {
      if (e instanceof FinanceError && e.code === "unavailable") return null;
      throw e;
    }
  }

  private async reviewWithLog(day: string): Promise<(DailyReview & { log: Awaited<ReturnType<FinanceAnalysisStore["reviewLog"]>> }) | null> {
    const r = await this.s().getReview(day);
    return r ? { ...r, log: await this.s().reviewLog(r.id) } : null;
  }

  /**
   * Marca el día como revisado (idempotente): la primera vez guarda quién, cuándo, la nota y la instantánea de los
   * recuentos; después solo cambia la nota (con bitácora). Un día futuro no se revisa.
   */
  async review(date: string, note: string | null | undefined, actor: FinanceActor) {
    const day = this.day(date);
    if (day > this.today()) throw bad("No se puede revisar un día futuro");
    const text = note === undefined ? undefined : (note ?? "").trim() || null;
    if (text && text.length > 1000) throw bad("La nota admite como mucho 1.000 caracteres");
    const existing = await this.s().getReview(day);
    let created = false;
    if (!existing) {
      const snapshot = (await this.daily(day)).counts;
      const out = await this.s().insertReview({ day, reviewedBy: actor.by, reviewedAt: this.now(), note: text ?? null, snapshot, requestId: actor.requestId });
      created = out.created;
      if (created) await this.d.finance.recordAudit(actor, "daily.review", "daily_review", day, { note: text ?? null, snapshot });
    }
    if (!created && text !== undefined) {
      const cur = (await this.s().getReview(day))!;
      if (cur.note !== text) {
        const ok = await this.s().editReviewNote(cur.id, cur.note, text, { by: actor.by, at: this.now(), requestId: actor.requestId });
        if (!ok) throw new FinanceError("conflict", "Otra persona ha cambiado la nota a la vez: vuelve a cargar el día");
        await this.d.finance.recordAudit(actor, "daily.note", "daily_review", day, { before: cur.note, after: text });
      }
    }
    return { item: (await this.reviewWithLog(day))!, created };
  }

  async reviews(q: { from?: string; to?: string; limit?: number; offset?: number }) {
    if ((q.from && !isValidDate(q.from)) || (q.to && !isValidDate(q.to))) throw bad("Fechas no válidas (AAAA-MM-DD)");
    return this.s().listReviews({ from: q.from, to: q.to, limit: Math.max(1, Math.min(q.limit ?? 50, 366)), offset: Math.max(0, q.offset ?? 0) });
  }

  // ── Cuenta de resultados ──────────────────────────────────────────────────────────────────────────────────────

  private defaultRange(from?: string, to?: string) {
    const t = to ?? this.today();
    const f = from ?? `${t.slice(0, 4)}-01-01`;
    if (!isValidDate(f) || !isValidDate(t)) throw bad("Fechas no válidas (AAAA-MM-DD)");
    return { from: f, to: t };
  }

  async pnl(q: { from?: string; to?: string; granularity?: Granularity; compare?: CompareKind; costCenter?: number }) {
    const r = this.defaultRange(q.from, q.to);
    const range = monthRange(r.from, r.to);
    const g = q.granularity ?? "month";
    const kind = q.compare ?? "none";
    let costCenter: { id: number; code: string; name: string } | null = null;
    if (q.costCenter !== undefined) {
      const c = await this.d.ops.getCostCenter(q.costCenter);
      if (!c) throw new FinanceError("not_found", "Centro de coste no encontrado");
      costCenter = { id: c.id, code: c.code, name: c.name };
    }
    const base = { accountPrefixes: ["6", "7"], excludeOrigins: NON_FLOW_ORIGINS, ...(costCenter ? { costCenterId: costCenter.id } : {}) };
    const periods = periodsOf(range.fromYm, range.toYm, g);
    const cr = compareRange(range.fromYm, range.toYm, kind);
    const [facts, cfacts, names] = await Promise.all([this.s().ledgerFacts({ ...base, from: range.from, to: range.to }), cr ? this.s().ledgerFacts({ ...base, from: cr.from, to: cr.to }) : Promise.resolve(null), this.names()]);
    const aligned = cr ? shiftPeriods(periods, cr.shift, g) : null;
    const lines = buildPnl(facts, periods, names, cfacts && aligned ? { facts: cfacts, periods: aligned } : null);
    const net = lines.find((l) => l.key === "netResult")!;
    return {
      from: range.from,
      to: range.to,
      granularity: g,
      costCenter,
      periods: periods.map(({ months: _m, ...p }) => p),
      compare: cr && aligned ? { kind, from: cr.from, to: cr.to, periods: aligned.map(({ months: _m, ...p }) => p) } : null,
      lines,
      result: { totalCents: net.totalCents, compareTotalCents: net.compareTotalCents },
      notes: [
        "Del libro: asientos contabilizados sin regularización, cierre ni apertura. Importes con el signo de su efecto en el resultado (ingresos positivos, gastos negativos).",
        ...(costCenter ? ["Con centro de coste solo cuentan las líneas imputadas a ese centro (las facturas emitidas no llevan centro)."] : []),
      ],
    };
  }

  // ── Balance ───────────────────────────────────────────────────────────────────────────────────────────────────

  async balance(date?: string) {
    const day = this.day(date);
    const year = day.slice(0, 4);
    const [facts, names] = await Promise.all([this.s().ledgerFacts({ to: day, excludeOrigins: ["closing", "opening"] }), this.names()]);
    const currentYear = balancesOfFacts(facts.filter((f) => f.month.startsWith(year) && /^[67]/.test(f.accountCode)));
    return { date: day, ...buildBalance(balancesOfFacts(facts), currentYear, names) };
  }

  // ── Tesorería y previsión ─────────────────────────────────────────────────────────────────────────────────────

  async cashflow(q: { from?: string; to?: string; forecastDays?: 0 | 30 | 60 | 90 }) {
    const r = this.defaultRange(q.from, q.to);
    if (r.from > r.to) throw bad("La fecha inicial es posterior a la final");
    monthRange(r.from, r.to);
    const months = monthsBetween(ymOf(r.from), ymOf(r.to));
    const [before, apeInRange, treasury, counterparts, names] = await Promise.all([
      this.s().ledgerFacts({ to: addDays(r.from, -1), accountPrefixes: ["57"], excludeOrigins: ["closing", "opening"] }),
      this.s().ledgerFacts({ from: r.from, to: r.to, accountPrefixes: ["57"], onlyJournals: ["APE"], excludeOrigins: ["closing", "opening"] }),
      this.s().treasuryFacts(r.from, r.to),
      this.s().ledgerFacts({ from: r.from, to: r.to, withTreasury: true, excludeAccountPrefixes: ["57"], excludeOrigins: NON_FLOW_ORIGINS, excludeJournals: ["APE"] }),
      this.names(),
    ]);
    const flows = buildCashflow({ opening: balancesOfFacts([...before, ...apeInRange]), treasury, counterparts, months, names });
    const days = q.forecastDays ?? 90;
    return { from: r.from, to: r.to, ...flows, forecast: days ? await this.forecast(days) : null };
  }

  async forecast(horizonDays: 30 | 60 | 90) {
    const today = this.today();
    const [balances, chains, payables, taxes] = await Promise.all([
      this.s().ledgerFacts({ to: today, accountPrefixes: ["57"], excludeOrigins: ["closing", "opening"] }),
      this.chains(undefined, today),
      this.s().payableDocs(today),
      this.d.tax ? this.d.tax.listObligations({ dueFrom: addDays(today, 1), dueTo: addDays(today, horizonDays), statuses: [...TAX_TO_PAY], limit: 200 }) : Promise.resolve(null),
    ]);
    const receivables = (chains?.items ?? []).map((c) => ({ id: c.invoiceId, number: c.number, customerName: c.customerName, date: c.issueDate ?? c.dates.invoiceDate ?? today, pendingCents: c.totalCents - c.collectedCents }));
    const out = buildForecast({
      today,
      horizonDays,
      startingBalanceCents: sum(Array.from(balancesOfFacts(balances).values())),
      receivables,
      payables,
      taxes: (taxes?.items ?? []).map((o) => ({ id: o.id, model: o.model, period: o.period, year: o.year, dueDate: o.dueDate, amountCents: o.amountCents, outcome: o.outcome, status: o.status })),
    });
    return { ...out, sources: { receivables: chains !== null, taxes: taxes !== null } };
  }

  // ── Antigüedad de saldos ──────────────────────────────────────────────────────────────────────────────────────

  async aging(side: "receivable" | "payable", date?: string) {
    const day = this.day(date);
    let docs: AgingDoc[];
    if (side === "payable") {
      docs = (await this.s().payableDocs(day)).map((p) => ({ id: p.id, number: p.invoiceNumber, partyKey: p.supplierId !== null ? `supplier:${p.supplierId}` : "supplier:none", partyId: p.supplierId, partyName: p.supplierName ?? "Sin proveedor", date: p.invoiceDate, dueDate: p.dueDate, totalCents: p.totalCents, pendingCents: p.pendingCents }));
    } else {
      const chains = await this.chains(undefined, day);
      if (!chains) throw new FinanceError("unavailable", "La conciliación de facturas no está montada en este entorno (migración 0036)");
      docs = chains.items.map((c) => {
        const collected = sum(c.charges.filter((x) => x.createdOn <= day).map((x) => x.grossCents)) + sum(c.transfers.filter((t) => t.bookingDate <= day).map((t) => t.amountCents));
        return { id: c.invoiceId, number: c.number, partyKey: `company:${c.companyId}`, partyId: c.companyId, partyName: c.customerName ?? `Empresa ${c.companyId}`, date: c.issueDate ?? c.dates.invoiceDate ?? day, dueDate: null, totalCents: c.totalCents, pendingCents: Math.max(0, c.totalCents - collected) };
      });
    }
    return { side, date: day, ...buildAging(day, docs), basis: side === "receivable" ? "Antigüedad desde la fecha de la factura (las facturas propias no tienen vencimiento)" : "Días vencidos desde el vencimiento del gasto (sin vencimiento, desde la fecha de la factura)" };
  }

  // ── Gastos ────────────────────────────────────────────────────────────────────────────────────────────────────

  async expenses(q: { from?: string; to?: string; groupBy?: ExpenseGroup; compare?: CompareKind }) {
    const r = this.defaultRange(q.from, q.to);
    const range = monthRange(r.from, r.to);
    const groupBy = q.groupBy ?? "category";
    const kind = q.compare ?? "none";
    const cr = compareRange(range.fromYm, range.toYm, kind);
    const base = { accountPrefixes: ["6"], excludeOrigins: NON_FLOW_ORIGINS };
    const [facts, cfacts, names, categories, centers] = await Promise.all([this.s().ledgerFacts({ ...base, from: range.from, to: range.to }), cr ? this.s().ledgerFacts({ ...base, from: cr.from, to: cr.to }) : Promise.resolve(null), this.names(), this.d.ops.listCategories(), this.d.ops.listCostCenters()]);
    const supplierIds = Array.from(new Set([...facts, ...(cfacts ?? [])].map((f) => f.supplierId).filter((x): x is number => x !== null)));
    const suppliers = groupBy === "supplier" ? await this.s().supplierNames(supplierIds) : new Map<number, string>();
    const months = monthsBetween(range.fromYm, range.toYm);
    const nameOf = (key: string) => {
      const [kindKey, raw] = key.split(":");
      const id = raw === "none" ? null : Number(raw);
      if (kindKey === "category") {
        const c = categories.find((x) => x.id === id);
        return { id, name: c?.name ?? `Categoría ${id}`, accountCode: c?.accountCode ?? null };
      }
      if (kindKey === "account") return { id: null, name: `${raw} · ${names.get(raw) ?? ""} (sin categoría)`, accountCode: raw };
      if (kindKey === "costCenter") return id === null ? { id, name: "Sin centro de coste", accountCode: null } : { id, name: centers.find((c) => c.id === id)?.name ?? `Centro ${id}`, accountCode: null };
      return id === null ? { id, name: "Sin proveedor", accountCode: null } : { id, name: suppliers.get(id) ?? `Proveedor ${id}`, accountCode: null };
    };
    const out = buildExpenseGroups({ facts, compareFacts: cfacts, months, groupBy, nameOf });
    return { from: range.from, to: range.to, groupBy, months, compare: cr ? { kind, from: cr.from, to: cr.to } : null, ...out };
  }

  // ── Revenue & Margin ──────────────────────────────────────────────────────────────────────────────────────────

  async revenueMargin(year: number | undefined, commercial: CommercialSources | null = null) {
    const today = this.today();
    const y = year ?? Number(today.slice(0, 4));
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw bad("Ejercicio no válido");
    const months = monthsBetween(`${y}-01`, `${y}-12`);
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    const stripe = this.d.stripe;
    const [facts, direct, stripeMonths, transfers, settings] = await Promise.all([this.s().ledgerFacts({ from, to, accountPrefixes: ["6", "7"], excludeOrigins: NON_FLOW_ORIGINS }), this.directCategories(), stripe ? this.s().stripeMonthly(from, to) : Promise.resolve(null), this.s().transfersMonthly(from, to), this.s().getAnalysisSettings()]);
    const through = String(y) === today.slice(0, 4) ? today.slice(0, 7) : `${y}-12`;
    const stripeFeesTreatment = settings.stripeFeesTreatment;
    const full = buildRevenueMargin({ facts, months, directCategories: direct, stripe: stripeMonths, transfers, stripeFeesTreatment });
    const ytdMonths = months.filter((m) => m <= through);
    const ytd = buildRevenueMargin({ facts, months: ytdMonths, directCategories: direct, stripe: stripeMonths, transfers, stripeFeesTreatment }).totals;
    return {
      year: y,
      stripeFeesTreatment,
      months: full.months,
      totals: full.totals,
      ytd: { through, ...ytd },
      definitions: {
        accruedRevenue: "Devengado contable: cifra de negocios (70x) del libro.",
        collected: "Cobrado: cobros de Stripe netos de reembolsos (importe bruto) más transferencias de facturas conciliadas.",
        stripeFees: `Comisiones de Stripe: cuenta 626 de los asientos de origen Stripe; % sobre lo cobrado. Tratamiento: ${stripeFeesTreatment === "direct_cost" ? "coste directo del cobro (en el margen)" : stripeFeesTreatment === "structure" ? "gasto de estructura" : "resultado financiero (fuera del margen)"}.`,
        directCosts: "Costes directos: gastos de las categorías marcadas como coste directo (por defecto, solo las de hosting o infraestructura; el resto lo decide el operador).",
        grossMargin: stripeFeesTreatment === "direct_cost" ? "Margen bruto = devengado − comisiones de Stripe − costes directos." : "Margen bruto = devengado − costes directos.",
        financialCosts: "Gastos financieros: grupo 66 (intereses, otros gastos financieros)" + (stripeFeesTreatment === "financial" ? " y las comisiones de Stripe." : "."),
        structureCosts: "Gastos de estructura: resto del grupo 6" + (stripeFeesTreatment === "structure" ? " (incluidas las comisiones de Stripe)." : "."),
        result: "Resultado = devengado + otros ingresos − todo el grupo 6 (sin regularización ni cierre).",
      },
      commercial: await this.commercial(commercial),
    };
  }

  /** Métricas comerciales tal cual, rotuladas y aparte (null = no disponibles). */
  private async commercial(c: CommercialSources | null) {
    const label = "Métricas comerciales (no contables): MRR y ARR de /revenue/metrics y rentabilidad por empresa de /resources/profitability";
    let metrics: (CommercialMetrics & { available: true }) | null = null;
    let topCompanies: { days: number; complete: boolean; items: Array<{ key: string; kind: string; displayName: string; billedCents: number; totalCostCents: number | null; marginCents: number | null; marginComplete: boolean }> } | null = null;
    if (c?.metrics) {
      const m = await c.metrics().catch(() => null);
      if (m) metrics = { available: true, windowDays: m.windowDays, currency: m.currency, mrrCents: m.mrrCents, arrCents: m.arrCents, payingCompanies: m.payingCompanies, collected: m.collected, churn: m.churn };
    }
    if (c?.profitability) {
      const p = await c.profitability(365).catch(() => null);
      if (p)
        topCompanies = {
          days: p.days,
          complete: p.complete,
          items: [...p.tenants]
            .sort((a, b) => (b.margin.cents ?? b.margin.provisionalCents ?? b.revenue.billedCents) - (a.margin.cents ?? a.margin.provisionalCents ?? a.revenue.billedCents))
            .slice(0, 10)
            .map((t) => ({ key: t.key, kind: t.kind, displayName: t.displayName, billedCents: t.revenue.billedCents, totalCostCents: t.cost.totalCents, marginCents: t.margin.cents ?? t.margin.provisionalCents, marginComplete: t.margin.complete })),
        };
    }
    return { label, metrics, topCompanies };
  }

  // ── Conversion Health ─────────────────────────────────────────────────────────────────────────────────────────

  async conversion(q: { from?: string; to?: string }) {
    const today = this.today();
    const r = this.defaultRange(q.from, q.to);
    const range = monthRange(r.from, r.to);
    const months = monthsBetween(range.fromYm, range.toYm);
    const asOf = range.to < today ? range.to : today;
    const [chains, stripeMonths, payments] = await Promise.all([this.chains(range.from, range.to), this.d.stripe ? this.s().stripeMonthly(range.from, range.to) : Promise.resolve(null), this.d.paymentEvents ? this.d.paymentEvents.monthly(range.from, range.to) : Promise.resolve(null)]);
    const invoices: ConversionInvoice[] | null = chains ? chains.items.map((c) => ({ invoiceId: c.invoiceId, issueDate: c.issueDate ?? c.dates.invoiceDate ?? range.from, totalCents: c.totalCents, collectedCents: c.collectedCents, status: c.status, dates: c.dates })) : null;
    const out = buildConversion({ months, asOf, invoices, stripe: stripeMonths, payments });
    return {
      from: range.from,
      to: range.to,
      asOf,
      ...out,
      truncated: chains?.truncated ?? false,
      commercialFunnel: null,
      notes: [
        "Porcentajes sobre el importe facturado en el mes de la factura (cohorte): cobrado (Stripe y transferencias), liquidado por Stripe y en banco.",
        "Pagos fallidos: eventos «payment.failed» y «renewal.failed» frente a «payment.succeeded» y «renewal.paid» del registro comercial (solo lectura; los avisos de impago no cuentan).",
        "Embudo comercial (prueba → pago): /revenue/metrics no lo publica todavía; no se recalcula aquí.",
      ],
    };
  }
}
