/**
 * Integridad de la contabilidad corporativa: compara los hechos económicos confirmados con lo que hay en el libro.
 *
 *  - Hechos confirmados (solo lectura): cobros, impagos, reembolsos y disputas de los servicios externos tal y como los
 *    registra el webhook de Stripe en `external_subscription_events` (una fila por hecho).
 *  - Contrastes: factura propia expedida, transacción de Stripe importada y contabilizada, ejercicio, apertura,
 *    configuración fiscal, bancos, gastos y la última pasada de la automatización.
 *  - `alerts()`: incidencias con origen, gravedad y acción correctiva (se suman a las del control diario). Una fuente
 *    que no se sincroniza es una incidencia: nunca «sin alertas».
 *  - `overview()`: los indicadores del panel con su estado. Un importe solo es «cero real» cuando su fuente está
 *    sincronizada y completa; si no, es «pendiente» (hay hechos sin llevar al libro) o «no disponible» (falta la fuente).
 *
 * Nunca escribe nada.
 */
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import type { Invoice } from "../invoicing/types";
import { madridDateKey } from "../utils/timezone";
import type { AutomationReport, FinanceAutomation } from "./automation";
import type { FinanceOpsStore } from "./opsStore";
import type { OwnInvoiceDirectory } from "./ownInvoices";
import type { FinanceService } from "./service";
import type { FinanceStore } from "./store";
import type { FinanceStripeService } from "./stripeService";
import type { FinanceStripeStore } from "./stripeStore";
import type { FinanceTaxService } from "./taxService";

export type Severity = "info" | "warning" | "critical";

export interface IntegrityAlert {
  code: string;
  severity: Severity;
  message: string;
  count: number;
  /** De dónde sale la incidencia (fuente de datos o módulo). */
  source: string;
  /** Qué hay que hacer para resolverla. */
  action: string;
  amountCents?: number | null;
}

/** Hecho de cobro confirmado por Stripe para un servicio externo. */
export interface PaymentFact {
  kind: "paid" | "failed" | "refunded" | "dispute";
  externalId: number;
  companyId: number;
  serviceName: string;
  stripeInvoiceId: string | null;
  totalCents: number;
  baseCents: number | null;
  taxCents: number | null;
  period: string | null;
  at: number;
  detail: Record<string, unknown>;
}

export type IndicatorState = "value" | "zero" | "pending" | "unavailable";
export interface Indicator {
  key: string;
  label: string;
  state: IndicatorState;
  /** Importe calculado (null = no se puede calcular). */
  cents: number | null;
  /** Importe confirmado que aún no está en el libro o en la factura (si aplica). */
  pendingCents?: number | null;
  detail: string;
  source: string;
}

export interface FinanceIntegrityDeps {
  finance: Pick<FinanceService, "fiscalYears">;
  ledger: Pick<FinanceStore, "listEntries" | "postedLines">;
  ops: Pick<FinanceOpsStore, "listBankAccounts" | "listExpenses" | "listMovements">;
  external?: { list(f?: { companyId?: number }): Promise<ExternalSubscription[]>; events(externalId: number): Promise<ExternalEvent[]> } | null;
  /** Facturas propias expedidas (solo lectura). */
  invoices?: OwnInvoiceDirectory | null;
  /** Todas las facturas propias, borradores incluidos (solo lectura). */
  invoiceStore?: { list(f?: { status?: string; limit?: number }): Promise<Invoice[]> } | null;
  /** Expedición real habilitada en el entorno (interruptor de la facturación propia, decisión DF-2). */
  issueEnabled: boolean;
  stripe?: { service: Pick<FinanceStripeService, "summary" | "pendingFeeVatCount">; store: Pick<FinanceStripeStore, "transactionsByStripeInvoice"> } | null;
  tax?: Pick<FinanceTaxService, "settings"> | null;
  automation?: Pick<FinanceAutomation, "last"> | null;
  now?: () => number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const eur = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** La automatización corre cada 15 minutos; sin pasadas en 2 horas, la fuente se considera parada. */
const AUTOMATION_STALE_MS = 2 * 3_600_000;
const KIND: Record<string, PaymentFact["kind"]> = { invoice_paid: "paid", invoice_payment_failed: "failed", charge_refunded: "refunded", charge_dispute: "dispute" };

export class FinanceIntegrity {
  private readonly now: () => number;
  constructor(private readonly d: FinanceIntegrityDeps) {
    this.now = d.now ?? Date.now;
  }

  private today() {
    return madridDateKey(new Date(this.now()));
  }

  /** Hechos de cobro confirmados de los servicios externos (null sin el módulo de clientes externos). */
  async facts(): Promise<{ subscriptions: ExternalSubscription[]; facts: PaymentFact[] } | null> {
    if (!this.d.external) return null;
    const subscriptions = await this.d.external.list();
    const facts: PaymentFact[] = [];
    for (const x of subscriptions) {
      for (const e of await this.d.external.events(x.id)) {
        const kind = KIND[e.kind];
        if (!kind) continue;
        const d = e.detail ?? {};
        const ref = typeof d.paymentRef === "string" && d.paymentRef.startsWith("stripe:in:") ? d.paymentRef.slice("stripe:in:".length) : kind === "paid" || kind === "failed" ? e.ref : null;
        facts.push({ kind, externalId: x.id, companyId: x.companyId, serviceName: x.serviceName, stripeInvoiceId: ref, totalCents: n(d.totalCents) ?? n(d.amountPaid) ?? 0, baseCents: n(d.baseCents), taxCents: n(d.taxCents), period: typeof d.period === "string" ? d.period : null, at: e.at, detail: d });
      }
    }
    return { subscriptions, facts };
  }

  private async context() {
    const today = this.today();
    const year = Number(today.slice(0, 4));
    const [years, ext, last, settings, banks, drafts] = await Promise.all([
      this.d.finance.fiscalYears(),
      this.facts(),
      this.d.automation ? this.d.automation.last() : Promise.resolve(null),
      this.d.tax ? this.d.tax.settings() : Promise.resolve(null),
      this.d.ops.listBankAccounts(),
      this.d.invoiceStore ? this.d.invoiceStore.list({ status: "draft", limit: 500 }) : Promise.resolve(null),
    ]);
    const fy = years.find((y) => y.year === year) ?? null;
    const facts = ext?.facts ?? [];
    const paid = facts.filter((f) => f.kind === "paid" && f.totalCents > 0);
    const stripeIds = Array.from(new Set(facts.map((f) => f.stripeInvoiceId).filter((x): x is string => !!x)));
    const txns = this.d.stripe && stripeIds.length ? await this.d.stripe.store.transactionsByStripeInvoice(stripeIds) : [];
    const issued = this.d.invoices && stripeIds.length ? await this.d.invoices.byStripeIds(stripeIds) : [];
    const issuedRefs = new Set(issued.map((i) => i.paymentRef));
    const postedCharge = (id: string | null) => !!id && txns.some((t) => t.stripeInvoiceId === id && t.type === "charge" && t.entryId !== null);
    const importedCharge = (id: string | null) => !!id && txns.some((t) => t.stripeInvoiceId === id && t.type === "charge");
    const postedRefund = (id: string | null) => !!id && txns.some((t) => t.stripeInvoiceId === id && (t.type === "refund" || t.type === "refund_failure") && t.entryId !== null);
    const openingPosted = fy ? (await this.d.ledger.listEntries({ journal: "APE", from: `${year}-01-01`, to: `${year}-12-31`, status: "posted", limit: 1 })).total > 0 : false;
    const dueDrafts = (drafts ?? []).filter((i) => i.kind === "invoice" && i.operationDate <= today);
    const stripeSource = last?.stripe.source ?? null;
    return { today, year, fy, ext, facts, paid, txns, issuedRefs, postedCharge, importedCharge, postedRefund, openingPosted, last, settings, banks, drafts, dueDrafts, stripeSource };
  }

  /** Incidencias de integración e integridad (se añaden a las del control diario). */
  async alerts(): Promise<IntegrityAlert[]> {
    const c = await this.context();
    const out: IntegrityAlert[] = [];
    const add = (a: IntegrityAlert) => void (a.count > 0 && out.push(a));
    const stale = !c.last || this.now() - c.last.at > AUTOMATION_STALE_MS;
    const stepErrors = c.last ? (["fiscalYear", "taxSettings", "invoiceDrafts", "invoiceSync", "stripe"] as const).filter((k) => c.last![k].status === "error") : [];

    add({ code: "automation_stale", severity: "critical", count: stale ? 1 : 0, source: "Automatización contable", message: c.last ? "La automatización contable no se ejecuta desde hace más de 2 horas: los datos pueden estar desactualizados" : "La automatización contable aún no se ha ejecutado: los datos no están sincronizados", action: "Comprobar el registro del plano de control (ctx FinanceAutomation)" });
    add({ code: "automation_errors", severity: "critical", count: stepErrors.length, source: "Automatización contable", message: `La última pasada falló en: ${stepErrors.map((k) => `${STEP_LABEL[k]} (${c.last![k].detail ?? "error"})`).join("; ")}`, action: "Revisar el error indicado; la pasada se repite cada 15 minutos" });

    const missing = c.last?.stripe.missing?.length ? c.last.stripe.missing.join(", ") : "balance_read, payout_read";
    add({ code: "stripe_source_unavailable", severity: "critical", count: c.stripeSource && c.stripeSource !== "ok" ? 1 : 0, source: "Stripe (API de saldo)", message: `Stripe no se sincroniza por API (${c.stripeSource === "permission_missing" ? `a la clave restringida le faltan los permisos ${missing}` : (c.last?.stripe.detail ?? "sin lector")}): comisiones, neto y liquidaciones no entran solos en el libro`, action: c.stripeSource === "permission_missing" ? `En el Dashboard de Stripe, dar a la clave restringida del plano de control los permisos de lectura ${missing}; mientras tanto, importar el informe «Balance change from activity» en Contabilidad › Stripe` : "Importar los informes CSV de Stripe en Contabilidad › Stripe" });

    const unposted = c.paid.filter((f) => !c.postedCharge(f.stripeInvoiceId));
    add({ code: "confirmed_payment_unposted", severity: "critical", count: unposted.length, amountCents: sum(unposted.map((f) => f.totalCents)), source: "Stripe → libro diario", message: `${plural(unposted.length, "cobro confirmado por Stripe", "cobros confirmados por Stripe")} sin contabilizar (${eur(sum(unposted.map((f) => f.totalCents)))}): ${unposted.slice(0, 3).map((f) => `${f.serviceName}${f.period ? ` · ${f.period}` : ""}`).join("; ")}`, action: unposted.some((f) => c.importedCharge(f.stripeInvoiceId)) ? "La transacción está importada pero no contabilizada: decidir el IVA de las comisiones de Stripe con la gestoría (Contabilidad › Stripe) o revisar su error" : c.stripeSource === "ok" ? "La transacción de saldo aún no está disponible en Stripe: se contabiliza sola en la siguiente pasada" : "Falta la transacción de saldo (bruto, comisión y neto): dar los permisos de lectura a la clave o importar el informe CSV" });

    const noInvoice = c.paid.filter((f) => !c.issuedRefs.has(`stripe:in:${f.stripeInvoiceId}`));
    add({ code: "confirmed_payment_without_invoice", severity: "critical", count: noInvoice.length, amountCents: sum(noInvoice.map((f) => f.totalCents)), source: "Facturación propia", message: `${plural(noInvoice.length, "cobro confirmado", "cobros confirmados")} sin factura propia expedida (${eur(sum(noInvoice.map((f) => f.totalCents)))}): el ingreso y el IVA repercutido no están en el libro`, action: this.d.issueEnabled ? "Expedir el borrador de la factura en Comercial › Facturación" : "La expedición real está apagada hasta decidir el sistema de facturación legal (DF-2, CP_INVOICING_ISSUE_ENABLED). Expedir la factura legal fuera del sistema con la referencia del cobro o decidir DF-2" });

    add({ code: "invoice_drafts_due", severity: "warning", count: c.dueDrafts.length, amountCents: sum(c.dueDrafts.map((i) => i.totalCents)), source: "Facturación propia", message: `${plural(c.dueDrafts.length, "factura devengada sigue", "facturas devengadas siguen")} en borrador (${eur(sum(c.dueDrafts.map((i) => i.totalCents)))})`, action: this.d.issueEnabled ? "Revisar y expedir en Comercial › Facturación" : "Expedición apagada (DF-2): decidir el sistema de facturación legal" });

    const paidIds = new Set(c.paid.map((f) => f.stripeInvoiceId));
    const failed = c.facts.filter((f) => f.kind === "failed" && !paidIds.has(f.stripeInvoiceId));
    const failedIds = new Set(failed.map((f) => f.stripeInvoiceId));
    add({ code: "payment_failed", severity: "warning", count: failedIds.size, amountCents: sum(Array.from(failedIds).map((id) => failed.find((f) => f.stripeInvoiceId === id)!.totalCents)), source: "Stripe (webhooks)", message: `${plural(failedIds.size, "factura de Stripe con el cobro fallido", "facturas de Stripe con el cobro fallido")} y sin recuperar`, action: "Seguir los reintentos de Stripe y contactar con el cliente; el portal permite cambiar el método de pago" });

    const overdue = (c.ext?.subscriptions ?? []).filter((x) => x.status === "past_due");
    const afterGrace = overdue.filter((x) => x.graceUntil !== null && x.graceUntil < this.now());
    add({ code: "subscription_overdue", severity: afterGrace.length ? "critical" : "warning", count: overdue.length, source: "Servicios externos", message: `${plural(overdue.length, "contratación con cobro vencido", "contrataciones con cobro vencido")}${afterGrace.length ? ` (${afterGrace.length} fuera del margen de pago)` : ""}`, action: "Abrir la contratación en Comercial › Servicios externos y gestionar el impago" });

    const refunds = c.facts.filter((f) => f.kind === "refunded" && !c.postedRefund(f.stripeInvoiceId));
    add({ code: "refund_unposted", severity: "critical", count: refunds.length, amountCents: sum(refunds.map((f) => n(f.detail.refundedDeltaCents) ?? 0)), source: "Stripe → libro diario", message: `${plural(refunds.length, "reembolso confirmado", "reembolsos confirmados")} sin reflejo contable`, action: "Contabilizar la transacción de reembolso (API de Stripe o informe CSV) y expedir la rectificativa" });
    const disputes = new Map<string, PaymentFact>();
    for (const f of c.facts.filter((x) => x.kind === "dispute")) disputes.set(String(f.detail.chargeId ?? f.stripeInvoiceId ?? f.at), f);
    const openDisputes = Array.from(disputes.values()).filter((f) => !["won", "lost", "closed", "charge_refunded"].includes(String(f.detail.disputeStatus ?? "")));
    add({ code: "dispute_open", severity: "critical", count: openDisputes.length, source: "Stripe (webhooks)", message: `${plural(openDisputes.length, "disputa abierta", "disputas abiertas")} en Stripe`, action: "Responder la disputa en el Dashboard de Stripe dentro de plazo" });

    add({ code: "fiscal_year_missing", severity: "critical", count: c.fy ? 0 : 1, source: "Ejercicios contables", message: `El ejercicio ${c.year} no está dado de alta: no se puede contabilizar nada de este año`, action: "Dar de alta el ejercicio en Contabilidad › Ejercicios (la automatización lo crea si no hay ninguno)" });
    add({ code: "opening_entry_pending", severity: "warning", count: c.fy && !c.openingPosted ? 1 : 0, source: "Ejercicios contables", message: `Asiento de apertura de ${c.year} pendiente: balance y tesorería son provisionales (solo operaciones del ejercicio)`, action: "Registrar los saldos iniciales reales (diario APE) con el balance de cierre anterior de la gestoría" });
    add({ code: "fiscal_config_missing", severity: "critical", count: this.d.tax && c.settings && !c.settings.configured ? 1 : 0, source: "Configuración fiscal", message: "No hay configuración fiscal guardada", action: "Guardarla en Gestoría › Configuración fiscal (la automatización guarda los datos confirmados del emisor)" });
    add({ code: "fiscal_config_unvalidated", severity: "warning", count: c.settings?.configured && !c.settings.validatedAt ? 1 : 0, source: "Configuración fiscal", message: "La configuración fiscal está pendiente de validar con la gestoría: los modelos se calculan pero no se revisan ni se presentan", action: "Validarla con la gestoría en Gestoría › Configuración fiscal (ver las notas: qué falta por confirmar)" });
    add({ code: "bank_not_configured", severity: "warning", count: c.banks.length ? 0 : 1, source: "Bancos", message: "No hay cuentas bancarias dadas de alta: el saldo bancario y la conciliación de liquidaciones no están disponibles", action: "Dar de alta la cuenta bancaria real en Contabilidad › Bancos e importar su extracto (Norma 43 o CSV)" });
    if (c.banks.length) {
      const movements = await this.d.ops.listMovements({ limit: 1 });
      add({ code: "bank_without_statements", severity: "warning", count: movements.total ? 0 : 1, source: "Bancos", message: "No se ha importado ningún extracto bancario: el saldo bancario no está conciliado", action: "Importar el extracto en Contabilidad › Bancos" });
    }
    const [draftExp, uncategorized] = await Promise.all([this.d.ops.listExpenses({ status: "draft", limit: 1 }), this.uncategorizedExpenses()]);
    add({ code: "expenses_unposted", severity: "warning", count: draftExp.total, source: "Gastos", message: `${plural(draftExp.total, "factura recibida", "facturas recibidas")} sin contabilizar (en borrador)`, action: "Completar y registrar en Contabilidad › Gastos" });
    add({ code: "expenses_uncategorized", severity: "warning", count: uncategorized, source: "Gastos", message: `${plural(uncategorized, "gasto", "gastos")} sin categoría`, action: "Asignar la categoría en Contabilidad › Gastos" });
    if (this.d.stripe && c.stripeSource === "ok") {
      const s = await this.d.stripe.service.summary();
      add({ code: "stripe_ledger_difference", severity: "warning", count: s.balanceDifferenceCents !== 0 ? 1 : 0, amountCents: s.balanceDifferenceCents, source: "Stripe ↔ libro", message: `El saldo de Stripe en el libro (5720) difiere de las transacciones importadas en ${eur(s.balanceDifferenceCents)}`, action: "Revisar en Contabilidad › Stripe las transacciones sin contabilizar o registrar el saldo anterior a la primera importación" });
    }
    return out;
  }

  private async uncategorizedExpenses() {
    let count = 0;
    for (const status of ["draft", "registered"] as const) {
      const page = await this.d.ops.listExpenses({ status, limit: 500 });
      count += page.items.filter((e) => e.categoryId === null).length;
    }
    return count;
  }

  /** Indicadores del panel financiero con su estado (valor, cero real, pendiente o no disponible). */
  async overview() {
    const c = await this.context();
    const from = `${c.year}-01-01`;
    const lines = c.fy ? await this.d.ledger.postedLines({ to: c.today, excludeOrigins: ["regularization", "closing"] }) : [];
    const yearLines = lines.filter((l) => l.date >= from);
    const net = (ls: typeof lines, prefix: string) => sum(ls.filter((l) => l.accountCode.startsWith(prefix)).map((l) => l.debitCents - l.creditCents));
    const factsYear = c.facts.filter((f) => madridDateKey(new Date(f.at)) >= from);
    const paidYear = factsYear.filter((f) => f.kind === "paid" && f.totalCents > 0);
    const unpostedPaid = paidYear.filter((f) => !c.postedCharge(f.stripeInvoiceId));
    const unpostedCents = sum(unpostedPaid.map((f) => f.totalCents));
    const noInvoiceYear = paidYear.filter((f) => !c.issuedRefs.has(`stripe:in:${f.stripeInvoiceId}`));
    const draftsBase = sum(c.dueDrafts.map((i) => i.baseCents));
    const draftsTotal = sum(c.dueDrafts.map((i) => i.totalCents));
    const draftsTax = sum(c.dueDrafts.map((i) => i.taxCents));
    const noFy: Pick<Indicator, "state" | "cents" | "detail"> = { state: "unavailable", cents: null, detail: `El ejercicio ${c.year} no está dado de alta` };
    const issuedYear = this.d.invoices ? await this.d.invoices.list({ from, to: c.today, limit: 500, offset: 0 }) : null;
    const expensesYear = await this.d.ops.listExpenses({ status: "registered", from, to: c.today, limit: 500 });
    const noExpenses = expensesYear.total === 0;
    const stripeKnown = c.stripeSource === "ok" || (this.d.stripe ? (await this.d.stripe.service.summary()).lastImportAt !== null : false);
    const out: Indicator[] = [];
    const push = (key: string, label: string, source: string, v: Pick<Indicator, "state" | "cents" | "detail"> & { pendingCents?: number | null }) => out.push({ key, label, source, ...v, cents: v.cents === null ? null : v.cents + 0 });
    const ledgerValue = (cents: number, pending: { when: boolean; detail: string; cents?: number | null }, zeroDetail: string): Pick<Indicator, "state" | "cents" | "detail"> & { pendingCents?: number | null } =>
      pending.when ? { state: "pending", cents, pendingCents: pending.cents ?? null, detail: pending.detail } : cents !== 0 ? { state: "value", cents, detail: "Según el libro (asientos contabilizados)" } : { state: "zero", cents: 0, detail: zeroDetail };

    const revenue = -net(yearLines, "7");
    const pendingRevenue = { when: c.dueDrafts.length > 0 || noInvoiceYear.length > 0, cents: draftsBase || sum(noInvoiceYear.map((f) => f.baseCents ?? 0)), detail: `Devengado pendiente de factura expedida: ${eur(draftsBase || sum(noInvoiceYear.map((f) => f.baseCents ?? 0)))} de base${this.d.issueEnabled ? "" : " (expedición apagada, DF-2)"}` };
    push("accruedRevenue", "Ingresos devengados", "Libro (grupo 7) y facturación propia", c.fy ? ledgerValue(revenue, pendingRevenue, "Sin ingresos contabilizados ni devengos pendientes") : noFy);
    push("invoicedIssued", "Facturación emitida", "Facturación propia (expedidas)", !issuedYear ? { state: "unavailable", cents: null, detail: "Facturación propia no montada" } : (() => { const t = sum(issuedYear.items.map((i) => i.totalCents)); return c.dueDrafts.length ? { state: "pending" as const, cents: t, pendingCents: draftsTotal, detail: `${plural(c.dueDrafts.length, "factura en borrador", "facturas en borrador")} por ${eur(draftsTotal)} sin expedir${this.d.issueEnabled ? "" : " (expedición apagada, DF-2)"}` } : t ? { state: "value" as const, cents: t, detail: `${plural(issuedYear.total, "factura expedida", "facturas expedidas")} este año` } : { state: "zero" as const, cents: 0, detail: "Ninguna factura devengada pendiente" }; })());
    const collected = sum(paidYear.map((f) => f.totalCents));
    push("collected", "Cobros recibidos", "Stripe (webhooks firmados)", !c.ext ? { state: "unavailable", cents: null, detail: "Servicios externos no montados" } : collected ? { state: unpostedCents ? "pending" : "value", cents: collected, pendingCents: unpostedCents || null, detail: `${plural(paidYear.length, "cobro confirmado", "cobros confirmados")} por Stripe${unpostedCents ? `; ${eur(unpostedCents)} sin contabilizar` : "; todos contabilizados"}` } : { state: "zero", cents: 0, detail: "Ningún cobro confirmado este año" });
    const failedOpen = c.facts.filter((f) => f.kind === "failed" && !c.paid.some((p) => p.stripeInvoiceId === f.stripeInvoiceId));
    const failedCents = sum(Array.from(new Map(failedOpen.map((f) => [f.stripeInvoiceId, f.totalCents])).values()));
    const receivable430 = net(lines, "430");
    push("receivablePending", "Cobros pendientes", "Stripe (impagos) y libro (430)", !c.ext ? { state: "unavailable", cents: null, detail: "Servicios externos no montados" } : failedCents || receivable430 > 0 ? { state: "value", cents: failedCents + Math.max(receivable430, 0), detail: `${eur(failedCents)} de cobros fallidos sin recuperar${receivable430 > 0 ? ` y ${eur(receivable430)} de clientes en el libro` : ""}` } : { state: "zero", cents: 0, detail: "Ningún cobro fallido sin recuperar ni saldo de clientes" });
    push("stripeBalance", "Saldo en Stripe", "Libro (5720) e importaciones de Stripe", !c.fy ? noFy : !stripeKnown ? { state: "unavailable", cents: null, detail: c.stripeSource === "permission_missing" ? "La clave de Stripe no tiene permiso de lectura de saldo y no se ha importado ningún informe" : "No se ha sincronizado ni importado Stripe" } : ledgerValue(net(lines, "5720"), { when: unpostedCents > 0, cents: unpostedCents, detail: `${eur(unpostedCents)} cobrados aún sin contabilizar` }, "Sin saldo pendiente de liquidar"));
    const bankCents = net(lines, "57200");
    push("bankBalance", "Saldo bancario conocido", "Libro (572000NN) y extractos", !c.fy ? noFy : !c.banks.length ? { state: "unavailable", cents: null, detail: "Sin cuentas bancarias dadas de alta ni extractos importados" } : { state: c.openingPosted ? (bankCents ? "value" : "zero") : "pending", cents: bankCents, detail: c.openingPosted ? "Según el libro" : "Sin asiento de apertura: solo movimientos del ejercicio" });
    const expenses = net(yearLines, "6");
    push("accruedExpenses", "Gastos devengados", "Libro (grupo 6) y facturas recibidas", c.fy ? ledgerValue(expenses, { when: noExpenses, detail: "Ninguna factura recibida registrada este año: el gasto real no está incorporado" }, "Sin gastos") : noFy);
    const paidExp = sum(expensesYear.items.map((e) => e.paidCents));
    push("paidExpenses", "Gastos pagados", "Pagos de facturas recibidas", noExpenses ? { state: "pending", cents: 0, detail: "Ninguna factura recibida registrada este año" } : { state: paidExp ? "value" : "zero", cents: paidExp, detail: `${plural(expensesYear.total, "factura recibida", "facturas recibidas")} registradas` });
    const vatOut = -net(yearLines, "477");
    push("vatOutput", "IVA repercutido", "Libro (477)", c.fy ? ledgerValue(vatOut, { when: pendingRevenue.when, cents: draftsTax || sum(noInvoiceYear.map((f) => f.taxCents ?? 0)), detail: `IVA de facturas sin expedir: ${eur(draftsTax || sum(noInvoiceYear.map((f) => f.taxCents ?? 0)))}` }, "Sin IVA repercutido") : noFy);
    const vatIn = net(yearLines, "472");
    push("vatInput", "IVA soportado", "Libro (472)", c.fy ? ledgerValue(vatIn, { when: noExpenses, detail: "Ninguna factura recibida registrada este año" }, "Sin IVA soportado") : noFy);
    const result = revenue - expenses;
    push("result", "Resultado contable", "Libro (grupos 6 y 7)", c.fy ? (pendingRevenue.when || noExpenses ? { state: "pending", cents: result, detail: "Provisional: hay ingresos sin facturar o gastos sin incorporar" } : ledgerValue(result, { when: false, detail: "" }, "Resultado nulo")) : noFy);
    const treasury = net(lines, "57");
    const partial = !c.banks.length || !stripeKnown || !c.openingPosted;
    push("treasury", "Tesorería disponible", "Libro (grupo 57)", !c.fy ? noFy : partial ? { state: "unavailable", cents: null, detail: `No se puede calcular: ${[!c.banks.length && "sin bancos", !stripeKnown && "Stripe sin sincronizar", !c.openingPosted && "sin apertura"].filter(Boolean).join(", ")}` } : { state: treasury ? "value" : "zero", cents: treasury, detail: "Bancos, caja y Stripe según el libro" });

    return {
      asOf: c.today,
      year: c.year,
      definitive: !!c.fy && c.openingPosted && !out.some((i) => i.state === "pending" || i.state === "unavailable"),
      status: {
        fiscalYear: c.fy ? (c.fy.status === "open" ? "open" : "closed") : "missing",
        openingEntry: !c.fy ? "missing" : c.openingPosted ? "posted" : "pending",
        operationsPosted: c.fy ? (await this.d.ledger.listEntries({ from, to: `${c.year}-12-31`, status: "posted", limit: 1 })).total : 0,
        fiscalConfig: !this.d.tax ? "unavailable" : !c.settings?.configured ? "missing" : c.settings.validatedAt ? "validated" : "pending_validation",
        banks: c.banks.length,
        stripeSource: c.stripeSource ?? "unknown",
        invoicingIssue: this.d.issueEnabled ? "enabled" : "disabled",
        lastAutomationAt: c.last?.at ?? null,
      },
      indicators: out,
      pendingSync: out.filter((i) => i.state === "pending").map((i) => `${i.label}: ${i.detail}`),
      unavailable: out.filter((i) => i.state === "unavailable").map((i) => `${i.label}: ${i.detail}`),
      facts: paidYear.map((f) => ({ kind: f.kind, service: f.serviceName, period: f.period, stripeInvoiceId: f.stripeInvoiceId, totalCents: f.totalCents, baseCents: f.baseCents, taxCents: f.taxCents, at: f.at, posted: c.postedCharge(f.stripeInvoiceId), invoiced: c.issuedRefs.has(`stripe:in:${f.stripeInvoiceId}`) })),
    };
  }
}

const STEP_LABEL: Record<keyof Omit<AutomationReport, "at">, string> = { fiscalYear: "ejercicio", taxSettings: "configuración fiscal", invoiceDrafts: "borradores de factura", invoiceSync: "facturas al libro", stripe: "Stripe" };
