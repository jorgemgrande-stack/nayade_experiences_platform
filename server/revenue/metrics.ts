/**
 * Métricas de ingresos del Control Center (solo lectura, calculadas en el servidor con datos reales).
 *
 *  - MRR real: servicios externos con cobro programado o en curso (`scheduled`, `active`, `past_due`), por su cuota
 *    neta mensual. Es lo único que hoy genera cargos reales.
 *  - Contratado pendiente: contratos enviados o aceptados que aún no tienen el cobro autorizado.
 *  - Modo sombra: las suscripciones de `subscriptions` (CRM 0006) NO cobran; su MRR se informa aparte y nunca se suma.
 *  - Cobrado: facturas pagadas (`invoice_paid`) en la ventana, neto e IVA; riesgo: facturas impagadas y su margen.
 *  - Churn de la ventana: MRR de los servicios cancelados en ella sobre el MRR vigente al empezarla.
 * Importes en céntimos y sin IVA salvo que el nombre diga lo contrario.
 */
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import type { Subscription, SubscriptionItem } from "../subscriptions/types";
import { monthlyEquivalent } from "../subscriptions/pricing";

const DAY = 86_400_000;
const BILLING = new Set(["scheduled", "active", "past_due"]);
const PENDING = new Set(["awaiting_acceptance", "awaiting_payment_method", "needs_decision"]);

export interface RevenueMetrics {
  generatedAt: number;
  windowDays: number;
  currency: string;
  mrrCents: number;
  arrCents: number;
  /** Clientes (empresas distintas) con cobro programado o en curso. */
  payingCompanies: number;
  /** Ya cobrando (al día o con una factura pendiente) frente a solo programados. */
  billingNowMrrCents: number;
  scheduledMrrCents: number;
  pending: { count: number; mrrCents: number };
  collected: { netCents: number; taxCents: number; grossCents: number; invoices: number };
  atRisk: Array<{ externalId: number; companyId: number; serviceName: string; amountDueCents: number | null; graceUntil: number | null; overdue: boolean }>;
  upcoming: Array<{ externalId: number; companyId: number; serviceName: string; at: number; amountCents: number }>;
  churn: { canceledCount: number; lostMrrCents: number; rate: number | null };
  byStatus: Record<string, number>;
  shadow: { activeSubscriptions: number; mrrCents: number } | null;
}

/** Cuota mensual neta de un servicio externo (hoy solo hay periodicidad mensual). */
const monthly = (x: Pick<ExternalSubscription, "amountCents">) => x.amountCents;

/** Próximo cargo de un servicio: el primero si aún no ha empezado; si no, el fin del periodo en curso. */
function nextChargeAt(x: ExternalSubscription, now: number): number | null {
  if (x.status === "scheduled") return x.firstChargeAt;
  if (x.status === "active" && x.currentPeriodEnd && x.currentPeriodEnd > now) return x.currentPeriodEnd;
  return null;
}

export function revenueMetrics(i: {
  external: ExternalSubscription[];
  events: Map<number, ExternalEvent[]>;
  shadow?: { subscriptions: Subscription[]; items: Map<number, SubscriptionItem[]> } | null;
  now: number;
  windowDays?: number;
  upcomingDays?: number;
}): RevenueMetrics {
  const { now } = i;
  const windowDays = i.windowDays ?? 30;
  const from = now - windowDays * DAY;
  const until = now + (i.upcomingDays ?? 7) * DAY;
  const billing = i.external.filter((x) => BILLING.has(x.status));
  const mrr = billing.reduce((s, x) => s + monthly(x), 0);
  const byStatus: Record<string, number> = {};
  for (const x of i.external) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;

  const collected = { netCents: 0, taxCents: 0, grossCents: 0, invoices: 0 };
  for (const x of i.external) {
    for (const e of i.events.get(x.id) ?? []) {
      if (e.kind !== "invoice_paid" || e.at < from || e.at > now) continue;
      const d = e.detail ?? {};
      const gross = Number(d.amountPaid ?? 0);
      const tax = Number(d.tax ?? 0);
      collected.invoices += 1;
      collected.grossCents += gross;
      collected.taxCents += tax;
      collected.netCents += Number(d.subtotal ?? gross - tax);
    }
  }

  const atRisk = i.external
    .filter((x) => x.status === "past_due")
    .map((x) => {
      const failed = (i.events.get(x.id) ?? []).filter((e) => e.kind === "invoice_payment_failed").sort((a, b) => b.at - a.at)[0];
      const due = failed?.detail?.amountDue;
      return { externalId: x.id, companyId: x.companyId, serviceName: x.serviceName, amountDueCents: typeof due === "number" ? due : null, graceUntil: x.graceUntil, overdue: !!x.graceUntil && x.graceUntil < now };
    })
    .sort((a, b) => (a.graceUntil ?? Infinity) - (b.graceUntil ?? Infinity));

  const upcoming = i.external
    .map((x) => ({ x, at: nextChargeAt(x, now) }))
    .filter((r): r is { x: ExternalSubscription; at: number } => r.at !== null && r.at >= now && r.at <= until)
    .map(({ x, at }) => ({ externalId: x.id, companyId: x.companyId, serviceName: x.serviceName, at, amountCents: monthly(x) }))
    .sort((a, b) => a.at - b.at);

  const canceled = i.external.filter((x) => x.status === "canceled" && x.updatedAt >= from && x.updatedAt <= now && (x.currentPeriodStart !== null || x.lastInvoiceId !== null));
  const lost = canceled.reduce((s, x) => s + monthly(x), 0);
  const startMrr = mrr + lost;

  let shadow: RevenueMetrics["shadow"] = null;
  if (i.shadow) {
    const active = i.shadow.subscriptions.filter((s) => s.status === "active");
    const cents = active.reduce((s, sub) => s + (i.shadow!.items.get(sub.id) ?? []).filter((it) => it.effectiveFrom <= now && (it.effectiveTo === null || it.effectiveTo > now)).reduce((a, it) => a + monthlyEquivalent(it), 0), 0);
    shadow = { activeSubscriptions: active.length, mrrCents: Math.round(cents) };
  }

  return {
    generatedAt: now,
    windowDays,
    currency: i.external[0]?.currency ?? "eur",
    mrrCents: mrr,
    arrCents: mrr * 12,
    payingCompanies: new Set(billing.map((x) => x.companyId)).size,
    billingNowMrrCents: billing.filter((x) => x.status !== "scheduled").reduce((s, x) => s + monthly(x), 0),
    scheduledMrrCents: billing.filter((x) => x.status === "scheduled").reduce((s, x) => s + monthly(x), 0),
    pending: { count: i.external.filter((x) => PENDING.has(x.status)).length, mrrCents: i.external.filter((x) => PENDING.has(x.status)).reduce((s, x) => s + monthly(x), 0) },
    collected,
    atRisk,
    upcoming,
    churn: { canceledCount: canceled.length, lostMrrCents: lost, rate: startMrr > 0 ? lost / startMrr : null },
    byStatus,
    shadow,
  };
}
