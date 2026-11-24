/**
 * Centro de suscripción, pagos y facturas de una empresa (solo lectura). Lo pide el Core con su token de comercio
 * para el tenant de la sesión. No crea ningún libro nuevo: lee lo que ya existe (suscripción, condiciones vigentes,
 * cobro por condiciones personalizadas con sus facturas de Stripe, facturas expedidas del sistema y «Mi plan» de los
 * pedidos) y lo ordena con las reglas del contrato `shared/billingCenter.ts`.
 *
 * Reglas que se aplican aquí (y se prueban):
 *  - Un cobro real es una factura de Stripe PAGADA con importe > 0. Una factura de 0 € es un documento sin cobro; una
 *    suscripción en prueba o con método autorizado no es una mensualidad pagada.
 *  - El próximo cobro es la fecha de Stripe (fin de la prueba o del periodo), no el periodo interno del CRM.
 *  - Aislamiento: todo se resuelve desde el tenant autenticado → su empresa → SUS suscripciones. Los enlaces de una
 *    factura solo se entregan si su identificador figura en las facturas de esa empresa; nunca se acepta un id de Stripe
 *    que el cliente invente.
 */
import type { BillingCenterInvoice, BillingCenterPayment, BillingInvoiceLinks, BillingStage, TenantBillingCenter } from "../../shared/billingCenter";
import type { TenantCustomTerms } from "../commercialTerms/tenantView";
import type { TermsBillingInvoice, TermsBillingRow } from "../commercialTerms/billingStore";
import type { Invoice } from "../invoicing/types";
import type { Subscription } from "../subscriptions/types";
import type { TenantPlanSummary } from "./tenantPlan";

export class BillingCenterError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const LIVE_BILLING = ["active", "past_due", "suspended", "cancel_scheduled"] as const;

export interface BillingCenterInput {
  companyName: string;
  /** Condiciones personalizadas vigentes (null: tarifa oficial). Su existencia implica contrato aceptado. */
  terms: TenantCustomTerms | null;
  planName: string | null;
  sub: Pick<Subscription, "status" | "interval" | "currentPeriodStart" | "currentPeriodEnd" | "trialEnd" | "cancelAt"> | null;
  /** Cobro por condiciones personalizadas (Stripe). */
  row: TermsBillingRow | null;
  stripeInvoices: TermsBillingInvoice[];
  /** «Mi plan» de los pedidos (cobro por pedido); null si no hay. */
  order: TenantPlanSummary | null;
  /** Facturas expedidas del sistema (sin borradores). */
  crmInvoices: Invoice[];
  portalEnabled: boolean;
  now: number;
}

const isPaidReal = (i: TermsBillingInvoice) => i.status === "paid" && i.amountPaidCents > 0;
const when = (i: TermsBillingInvoice) => i.paidAt ?? i.createdAt;

/** Etapa económica real, con la fuente más específica disponible (cobro por condiciones → pedido → contrato sin pago). */
export function deriveStage(i: BillingCenterInput): BillingStage {
  const row = i.row && i.row.linkedAt && (LIVE_BILLING as readonly string[]).includes(i.row.status) ? i.row : null;
  if (row) {
    if (row.status === "past_due") return "payment_issue";
    if (row.status === "suspended") return "suspended";
    const paid = i.stripeInvoices.some(isPaidReal);
    if (row.stripeStatus === "trialing" || !paid) return "trial_authorized";
    return "active";
  }
  if (i.row && i.row.status === "canceled") return "canceled";
  if (i.order?.contract) {
    const st = i.order.contract.state;
    if (st === "past_due") return "payment_issue";
    if (st === "suspended") return "suspended";
    if (st === "confirmed" || st === "contracted") return "contract_pending_payment";
    return i.order.period?.status === "trialing" ? "trial_authorized" : "active";
  }
  if (i.terms) return "contract_pending_payment";
  return "no_contract";
}

function paymentsOf(i: BillingCenterInput): BillingCenterPayment[] {
  const out: BillingCenterPayment[] = [];
  const pastDue = i.row?.status === "past_due";
  for (const v of i.stripeInvoices) {
    if (v.status === "void" || v.status === "draft") continue;
    const free = (v.totalCents ?? v.amountPaidCents) === 0;
    const status: BillingCenterPayment["status"] = v.coverageLost ? "refunded" : v.status === "paid" ? (free ? "free" : "paid") : v.status === "uncollectible" || (v.status === "open" && pastDue) ? "failed" : "pending";
    out.push({
      id: `stripe:${v.stripeInvoiceId}`,
      at: v.status === "paid" ? when(v) : null,
      amountCents: v.status === "paid" ? v.amountPaidCents : (v.totalCents ?? 0),
      currency: v.currency || "EUR",
      periodStart: v.periodStart,
      status,
      kind: v.billingReason === "subscription_create" ? "first" : v.billingReason === "subscription_cycle" ? "renewal" : v.billingReason === "subscription_update" ? "change" : "other",
      reference: v.stripeInvoiceId,
      invoiceNumber: v.number,
      refundedCents: v.coverageLost ? v.amountPaidCents : null,
    });
  }
  // Cobros de las facturas del sistema que no son ya una factura de Stripe de las anteriores (sin duplicar importes)
  const stripeIds = new Set(i.stripeInvoices.map((v) => v.stripeInvoiceId));
  for (const c of i.crmInvoices) {
    if (c.paymentStatus !== "paid" || c.totalCents <= 0 || isStripeMirror(c, stripeIds)) continue;
    out.push({ id: `crm:${c.id}`, at: c.paidAt ?? c.issuedAt ?? null, amountCents: c.totalCents, currency: c.currency || "EUR", periodStart: null, status: "paid", kind: "other", reference: null, invoiceNumber: c.number, refundedCents: null });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** ¿La factura del sistema refleja una factura de Stripe ya listada? (referencias de cobro, no importes) */
function isStripeMirror(c: Invoice, stripeIds: Set<string>): boolean {
  return [c.paymentRef, c.billingRef].some((r) => !!r && stripeIds.has(r));
}

function invoicesOf(i: BillingCenterInput): BillingCenterInvoice[] {
  const out: BillingCenterInvoice[] = [];
  for (const v of i.stripeInvoices) {
    if (v.status === "draft" || v.status === "void" || !v.number) continue;
    const total = v.totalCents ?? v.amountPaidCents;
    const free = total === 0;
    out.push({
      id: `stripe:${v.stripeInvoiceId}`,
      source: "stripe",
      number: v.number,
      issuedAt: v.paidAt ?? v.createdAt,
      concept: i.planName ? `Cuota de ${i.planName}` : "Cuota de la suscripción",
      baseCents: v.subtotalCents,
      taxCents: v.taxCents,
      totalCents: total,
      currency: v.currency || "EUR",
      state: free ? "free" : v.status === "paid" ? "paid" : v.status === "uncollectible" ? "uncollectible" : "open",
      free,
      hasDocument: true,
    });
  }
  const stripeIds = new Set(i.stripeInvoices.map((v) => v.stripeInvoiceId));
  for (const c of i.crmInvoices) {
    if (c.status === "draft" || isStripeMirror(c, stripeIds)) continue;
    out.push({
      id: `crm:${c.id}`,
      source: "crm",
      number: c.number,
      issuedAt: c.issuedAt ?? (c.issueDate ? Date.parse(c.issueDate) : null),
      concept: c.periodLabel,
      baseCents: c.baseCents,
      taxCents: c.taxCents,
      totalCents: c.totalCents,
      currency: c.currency || "EUR",
      state: c.status === "rectified" ? "void" : c.paymentStatus === "paid" ? "paid" : "open",
      free: c.totalCents === 0,
      hasDocument: true,
    });
  }
  return out.sort((a, b) => (b.issuedAt ?? 0) - (a.issuedAt ?? 0));
}

export function deriveBillingCenter(i: BillingCenterInput): TenantBillingCenter {
  const stage = deriveStage(i);
  const row = i.row && i.row.linkedAt ? i.row : null;
  const payments = paymentsOf(i);
  const invoices = invoicesOf(i);
  const interval = i.terms?.current.interval ?? i.order?.contract?.interval ?? i.sub?.interval ?? null;
  const trialing = row?.stripeStatus === "trialing";
  const cancelling = !!(row?.cancelAt ?? i.sub?.cancelAt) || row?.status === "cancel_scheduled";
  const lastReal = payments.filter((p) => p.status === "paid" || p.status === "refunded").sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  const feeSrc = i.terms
    ? { netCents: i.terms.today.netCents, taxCents: i.terms.today.taxCents, totalCents: i.terms.today.totalCents, currency: i.terms.current.currency }
    : i.order?.contract && i.order.contract.recurringNetCents !== null
      ? { netCents: i.order.contract.recurringNetCents, taxCents: 0, totalCents: i.order.contract.recurringNetCents, currency: i.order.contract.currency }
      : null;
  const contracting = i.terms?.contracting ?? null;
  // Con cobro de Stripe: su fecha (fin de la prueba o del periodo); sin él, la del acuerdo aceptado o la del pedido. Nunca el periodo interno del CRM
  const nextAt = row ? (cancelling || stage === "canceled" ? null : row.currentPeriodEnd) : (contracting?.nextChargeAt ?? i.order?.period?.renewsAt ?? null);
  const nextCharge =
    stage === "no_contract" || stage === "canceled" || cancelling || (!nextAt && !feeSrc)
      ? null
      : { at: nextAt, estimatedTotalCents: contracting?.recurring?.totalCents ?? (i.terms ? i.terms.today.totalCents : null), currency: feeSrc?.currency ?? "EUR", basis: row ? (trialing ? ("trial_end" as const) : ("period_end" as const)) : nextAt ? (contracting?.trialActive ? ("trial_end" as const) : ("period_end" as const)) : null };
  const stripeStatus = row?.stripeStatus ?? null;
  const custom = !!i.terms;
  const selfService = !custom && stage !== "payment_issue" && stage !== "suspended" && stage !== "canceled";
  return {
    company: { name: i.companyName },
    stage,
    customTerms: custom,
    trial: contracting?.trialActive || i.sub?.trialEnd || trialing ? { planName: null, endsAt: trialing ? row!.currentPeriodEnd : (contracting?.trialEndsAt ?? i.sub?.trialEnd ?? null) } : null,
    contracted: stage === "no_contract" ? null : { planName: contracting?.planName ?? i.planName ?? i.order?.contract?.plan ?? null, interval, reference: i.order?.contract?.reference ?? null },
    stripeStatus,
    included: i.terms ? (contracting ? [...(contracting.planName ? [contracting.planName] : []), ...contracting.extensions] : i.terms.current.included.map((x) => x.name)) : (i.order?.contract?.items ?? []),
    fee: feeSrc ? { ...feeSrc, interval } : null,
    nextCharge,
    lastPayment: lastReal && lastReal.status === "paid" ? { at: lastReal.at, amountCents: lastReal.amountCents, currency: lastReal.currency, invoiceNumber: lastReal.invoiceNumber } : null,
    // Periodo de facturación de Stripe (en prueba, hasta el fin de la prueba); sin Stripe, el de la suscripción
    billingPeriod: row ? { start: i.sub?.currentPeriodStart ?? null, end: row.currentPeriodEnd } : i.order?.period ? { start: i.order.period.start, end: i.order.period.end } : null,
    // Con acuerdo aceptado, el método solo cuenta como autorizado si el cobro se enlazó por webhook verificado de Stripe
    paymentMethod: { state: contracting ? (contracting.paymentMethodAuthorized ? "authorized" : "missing") : row ? "authorized" : i.order?.billing.provider === "stripe" ? "authorized" : stage === "contract_pending_payment" ? "missing" : "unknown" },
    payments,
    invoices,
    actions: {
      portal: i.portalEnabled && (!!row || i.order?.billing.portal === true),
      selfServicePlanChange: selfService,
      note: custom ? "Tus condiciones comerciales son personalizadas: para cambiarlas, contacta con tu gestor de Big Elephant." : stage === "payment_issue" ? "Hay un cobro pendiente: actualiza tu método de pago." : null,
    },
  };
}

export interface BillingCenterDeps {
  companyOfTenant(tenantId: string): Promise<{ id: number; name: string } | null>;
  /** Suscripciones vivas de ESA empresa (ya filtradas por empresa y por esa plataforma o sin plataforma). */
  subscriptionsOf(companyId: number, tenantId: string): Promise<Array<Pick<Subscription, "id" | "status" | "interval" | "currentPeriodStart" | "currentPeriodEnd" | "trialEnd" | "cancelAt">>>;
  billingRow(subscriptionId: number): Promise<TermsBillingRow | null>;
  billingInvoices(billingId: number): Promise<TermsBillingInvoice[]>;
  customTerms?(tenantId: string, companyId: number, subscriptionId: number | null): Promise<TenantCustomTerms | null>;
  planName?(subscriptionId: number): Promise<string | null>;
  order?(tenantId: string): Promise<TenantPlanSummary | null>;
  crmInvoices?(companyId: number): Promise<Invoice[]>;
  invoiceHtml?(inv: Invoice): string;
  /** Enlaces del PDF y de la página alojada de una factura de Stripe (lectura). */
  stripeInvoiceLinks?(stripeInvoiceId: string): Promise<{ pdfUrl: string | null; hostedUrl: string | null; customerId: string | null } | null>;
  portalEnabled: boolean;
  now: () => number;
}

export class TenantBillingCenterService {
  constructor(private d: BillingCenterDeps) {}

  private async company(tenantId: string) {
    if (!TENANT_RE.test(tenantId)) throw new BillingCenterError("invalid_input", "Empresa no válida");
    const c = await this.d.companyOfTenant(tenantId);
    if (!c) throw new BillingCenterError("not_found", "Empresa no encontrada");
    return c;
  }

  /** Datos de la empresa autenticada (nunca de otra): todo cuelga de su tenant y de su empresa. */
  private async load(tenantId: string) {
    const company = await this.company(tenantId);
    const subs = (await this.d.subscriptionsOf(company.id, tenantId)).sort((a, b) => b.id - a.id);
    const order = this.d.order ? await this.d.order(tenantId).catch(() => null) : null;
    // La suscripción del pedido vigente si la hay; si no, la única que tenga la empresa (si no es única, ninguna)
    const sub = subs.length === 1 ? subs[0] : (subs.find((s) => s.status !== "canceled") ?? null);
    const row = sub ? await this.d.billingRow(sub.id) : null;
    const stripeInvoices = row ? await this.d.billingInvoices(row.id) : [];
    const terms = sub && this.d.customTerms ? await this.d.customTerms(tenantId, company.id, sub.id).catch(() => null) : null;
    const planName = sub && this.d.planName ? await this.d.planName(sub.id).catch(() => null) : null;
    const crmInvoices = this.d.crmInvoices ? (await this.d.crmInvoices(company.id)).filter((x) => x.companyId === company.id && x.status !== "draft") : [];
    return { company, sub, row, stripeInvoices, terms, planName, order, crmInvoices };
  }

  async center(tenantId: string): Promise<TenantBillingCenter> {
    const x = await this.load(tenantId);
    return deriveBillingCenter({ companyName: x.company.name, terms: x.terms, planName: x.planName, sub: x.sub, row: x.row, stripeInvoices: x.stripeInvoices, order: x.order, crmInvoices: x.crmInvoices, portalEnabled: this.d.portalEnabled, now: this.d.now() });
  }

  /** Enlaces oficiales de UNA factura de la propia empresa; cualquier otra no existe para esta empresa. */
  async invoiceLinks(tenantId: string, id: string): Promise<BillingInvoiceLinks> {
    const x = await this.load(tenantId);
    const m = /^(stripe|crm):(.{1,80})$/.exec(id);
    if (!m) throw new BillingCenterError("invalid_input", "Factura no válida");
    if (m[1] === "stripe") {
      const mine = x.stripeInvoices.find((v) => v.stripeInvoiceId === m[2] && v.status !== "draft" && v.status !== "void");
      if (!mine || !this.d.stripeInvoiceLinks) throw new BillingCenterError("not_found", "Factura no encontrada");
      const links = await this.d.stripeInvoiceLinks(mine.stripeInvoiceId);
      // Doble comprobación: la factura de Stripe debe pertenecer al cliente de Stripe de esta empresa
      if (!links || (links.customerId && x.row && links.customerId !== x.row.stripeCustomerId)) throw new BillingCenterError("not_found", "Factura no encontrada");
      return { pdfUrl: links.pdfUrl, hostedUrl: links.hostedUrl, documentHtml: null };
    }
    const inv = x.crmInvoices.find((c) => String(c.id) === m[2]);
    if (!inv || inv.companyId !== x.company.id || !this.d.invoiceHtml) throw new BillingCenterError("not_found", "Factura no encontrada");
    return { pdfUrl: null, hostedUrl: null, documentHtml: this.d.invoiceHtml(inv) };
  }
}
