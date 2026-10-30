/**
 * Resource Manager — RENTABILIDAD por cliente (solo lectura; nunca cobra, factura ni cambia nada).
 *
 * Por empresa, en un periodo:
 *  - ingresos FACTURADOS de las fuentes reales, SOLO del entorno live (lo de pruebas se excluye y se dice):
 *      1. facturación propia (server/invoicing): facturas expedidas y sus rectificativas, por fecha de operación;
 *      2. documentos fiscales de Stripe (server/stripe/fiscalDocuments): facturas y rectificativas de los pedidos SaaS;
 *      3. facturas cobradas en Stripe de los servicios externos (historial `invoice_paid`) que aún no tienen factura
 *         propia expedida de ese periodo;
 *      4. cobros del registro de eventos comerciales (`payment.succeeded`, `renewal.paid`) sin documento fiscal.
 *    Cada importe lleva su fuente; un mismo hecho nunca se cuenta dos veces (precedencia en ese orden);
 *  - costes del Resource Manager (la misma función que `/resources/costs`): MEDIDOS (consumo medido × tarifa) y
 *    ESTIMADOS (parte del coste fijo compartido), separados;
 *  - margen = ingresos − costes, solo si los costes están completos. Si falta algo relevante (coste compartido sin
 *    configurar, recursos sin medir, tarifas de referencia), el margen no se da como exacto: `complete: false`, la
 *    lista de lo que falta y un margen provisional (cota superior).
 * Los clientes externos (contrato y facturación sin base de datos de empresa) aparecen con sus ingresos y el coste de
 * infraestructura «no aplica».
 */
import type { Invoice } from "../invoicing/types";
import type { FiscalDocument } from "../stripe/fiscalDocuments";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import type { CommercialEvent } from "../commercialEvents/types";
import { UNMEASURED, type ResourceState, type TenantResources } from "../_core/erm/overview";
import { variableCost, type CostModel, type TenantCost } from "../_core/erm/costs";

export type Mode = "test" | "live";
export type RevenueSource = "own_invoices" | "stripe_fiscal" | "stripe_external" | "payment_events";

export const REVENUE_SOURCES: Record<RevenueSource, { label: string; basis: string }> = {
  own_invoices: { label: "Facturación propia", basis: "Base imponible de las facturas expedidas y rectificativas (fecha de operación)" },
  stripe_fiscal: { label: "Documentos fiscales de Stripe", basis: "Base imponible de las facturas y rectificativas de los pedidos SaaS" },
  stripe_external: { label: "Facturas de Stripe de servicios externos", basis: "Subtotal de las facturas cobradas sin factura propia expedida del periodo" },
  payment_events: { label: "Cobros registrados", basis: "Importe cobrado sin documento fiscal (impuestos incluidos si los hay)" },
};

export interface RevenueEntry {
  source: RevenueSource;
  companyId: number | null;
  tenantId: string | null;
  at: number;
  cents: number;
  ref: string;
}

export interface SourceReport {
  source: RevenueSource;
  label: string;
  basis: string;
  /** `live`: se usa; `excluded_test`: el entorno es de pruebas y no suma; `not_mounted`: no hay fuente en este plano. */
  status: "live" | "excluded_test" | "not_mounted";
  entries: number;
  cents: number;
  /** Se alcanzó el límite de lectura: puede faltar lo más antiguo. */
  truncated: boolean;
}

export interface RevenueInputs {
  from: number;
  to: number;
  ownInvoices: { mode: Mode; invoices: Invoice[]; truncated?: boolean } | null;
  stripeFiscal: { mode: Mode; documents: FiscalDocument[]; orderOf: Map<number, { companyId: number; tenantId: string | null }>; truncated?: boolean } | null;
  external: { mode: Mode; subscriptions: ExternalSubscription[]; events: Map<number, ExternalEvent[]> } | null;
  paymentEvents: { events: CommercialEvent[]; truncated?: boolean } | null;
}

const BILLED = new Set(["issued", "rectified"]);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Fecha AAAA-MM-DD (Madrid) a ms, a mediodía UTC para no cambiar de día. */
const dateMs = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), 12);

/** Ingresos facturados del periodo, solo live, con la fuente de cada importe y sin contar dos veces un mismo hecho. */
export function collectRevenue(i: RevenueInputs): { entries: RevenueEntry[]; sources: SourceReport[] } {
  const entries: RevenueEntry[] = [];
  const inWindow = (at: number) => at >= i.from && at < i.to;
  const report = (source: RevenueSource, status: SourceReport["status"], truncated = false): SourceReport => ({ source, ...REVENUE_SOURCES[source], status, entries: 0, cents: 0, truncated });
  const sources: Record<RevenueSource, SourceReport> = {
    own_invoices: report("own_invoices", !i.ownInvoices ? "not_mounted" : i.ownInvoices.mode === "live" ? "live" : "excluded_test", i.ownInvoices?.truncated),
    stripe_fiscal: report("stripe_fiscal", !i.stripeFiscal ? "not_mounted" : i.stripeFiscal.mode === "live" ? "live" : "excluded_test", i.stripeFiscal?.truncated),
    stripe_external: report("stripe_external", !i.external ? "not_mounted" : i.external.mode === "live" ? "live" : "excluded_test"),
    payment_events: report("payment_events", !i.paymentEvents ? "not_mounted" : "live", i.paymentEvents?.truncated),
  };
  const push = (e: RevenueEntry) => {
    entries.push(e);
    sources[e.source].entries++;
    sources[e.source].cents += e.cents;
  };

  // 1. Facturación propia (expedidas; las rectificativas restan con su base negativa)
  const ownExternalPeriods = new Set<string>();
  const ownPaymentRefs = new Set<string>();
  const ownOrders = new Set<number>();
  if (i.ownInvoices?.mode === "live") {
    for (const inv of i.ownInvoices.invoices) {
      if (!BILLED.has(inv.status)) continue;
      const ext = /^external:(\d+)$/.exec(inv.billingRef);
      if (ext && inv.kind === "invoice" && inv.periodLabel) ownExternalPeriods.add(`${ext[1]}|${inv.periodLabel}`);
      if (inv.paymentRef) ownPaymentRefs.add(inv.paymentRef);
      const ord = /^order:(\d+)$/.exec(inv.billingRef);
      if (ord) ownOrders.add(Number(ord[1]));
      const at = dateMs(inv.operationDate);
      if (inWindow(at)) push({ source: "own_invoices", companyId: inv.companyId, tenantId: null, at, cents: inv.baseCents, ref: inv.number ?? `factura:${inv.id}` });
    }
  }

  // 2. Documentos fiscales de Stripe (pedidos SaaS); los fallidos no son documentos emitidos
  const fiscalInvoices = new Set<string>();
  const fiscalOrders = new Set<number>();
  if (i.stripeFiscal?.mode === "live") {
    for (const d of i.stripeFiscal.documents) {
      if (d.status === "failed" || ownOrders.has(d.orderId)) continue;
      fiscalInvoices.add(d.stripeInvoiceId);
      fiscalOrders.add(d.orderId);
      if (!inWindow(d.createdAt)) continue;
      const o = i.stripeFiscal.orderOf.get(d.orderId);
      push({ source: "stripe_fiscal", companyId: o?.companyId ?? null, tenantId: o?.tenantId ?? null, at: d.createdAt, cents: d.baseCents, ref: d.externalRef ?? d.sourceKey });
    }
  }

  // 3. Facturas cobradas en Stripe de servicios externos sin factura propia del mismo periodo
  if (i.external?.mode === "live") {
    for (const x of i.external.subscriptions) {
      for (const e of i.external.events.get(x.id) ?? []) {
        if (e.kind !== "invoice_paid" || !inWindow(e.at)) continue;
        const d = (e.detail ?? {}) as Record<string, unknown>;
        if (typeof d.period === "string" && ownExternalPeriods.has(`${x.id}|${d.period}`)) continue;
        if (e.ref && ownPaymentRefs.has(`stripe:in:${e.ref}`)) continue;
        const cents = num(d.baseCents) ?? num(d.subtotal);
        if (cents === null) continue;
        push({ source: "stripe_external", companyId: x.companyId, tenantId: null, at: e.at, cents, ref: typeof d.number === "string" ? d.number : (e.ref ?? `external:${x.id}`) });
      }
    }
  }

  // 4. Cobros registrados sin documento fiscal (solo live; un cobro simulado nunca cuenta)
  if (i.paymentEvents) {
    for (const e of i.paymentEvents.events) {
      if (e.type !== "payment.succeeded" && e.type !== "renewal.paid") continue;
      if (e.environment !== "live" || e.data.mode === "test" || !inWindow(e.occurredAt)) continue;
      const cents = num(e.data.amountCents);
      if (cents === null) continue;
      const inv = e.stripeRef?.startsWith("inv:") ? e.stripeRef.slice(4) : null;
      if (inv ? fiscalInvoices.has(inv) : e.orderId !== null && fiscalOrders.has(e.orderId)) continue;
      if (e.orderId !== null && ownOrders.has(e.orderId)) continue;
      push({ source: "payment_events", companyId: e.companyId, tenantId: e.tenantId, at: e.occurredAt, cents, ref: e.stripeRef ?? `pago:${e.paymentId ?? e.id}` });
    }
  }
  return { entries, sources: Object.values(sources) };
}

/**
 * Recursos sin medir que son coste de la PLATAFORMA: los de infraestructura los cubre el coste fijo compartido cuando
 * está configurado. SMS, WhatsApp e integraciones salientes van con las credenciales propias de cada empresa (su
 * proveedor se lo cobra a ella), y usuarios o cola de trabajos no son un coste en sí.
 */
const COST_RELEVANT: Record<string, "infra" | "direct"> = { "storage.total.bytes": "infra", "db.size": "infra", cpu: "infra" };

export interface CostGap {
  key: string;
  label: string;
}

/** Lo que falta para que el coste sea completo (vacío = completo). */
export function costGaps(model: Pick<CostModel, "sharedMonthlyCents">, tariffOrigin: "admin" | "entorno" | "estimación"): CostGap[] {
  const gaps: CostGap[] = [];
  const shared = model.sharedMonthlyCents > 0;
  if (!shared) gaps.push({ key: "shared", label: "Coste fijo compartido sin configurar (servidores base, bases de datos, plan del proveedor)" });
  if (tariffOrigin === "estimación") gaps.push({ key: "rates", label: "Tarifas de referencia de precios públicos, no de las facturas reales de los proveedores" });
  for (const u of UNMEASURED) {
    const kind = COST_RELEVANT[u.resource];
    if (!kind || (kind === "infra" && shared)) continue;
    gaps.push({ key: u.resource, label: `Sin medir: ${u.note}` });
  }
  return gaps;
}

export interface ProfitabilityInput {
  now: number;
  days: number;
  from: number;
  to: number;
  tenants: Array<{ id: string; displayName: string; status: string }>;
  /** null: la medición no está configurada (sin costes). */
  costs: { tenants: TenantCost[]; sharedPeriodCents: number } | null;
  model: CostModel;
  tariffOrigin: "admin" | "entorno" | "estimación";
  /** Consumo diario por empresa (día de Madrid → métrica → cantidad). */
  usageDaily: Map<string, Map<string, Record<string, number>>>;
  /** Días del periodo (AAAA-MM-DD, Madrid), en orden. */
  dayAxis: string[];
  revenue: { entries: RevenueEntry[]; sources: SourceReport[] };
  tenantOfCompany: Map<number, string | null>;
  companyName: Map<number, string>;
  plans: Map<string, { plan: { id: string; name: string } | null; modules: Array<{ id: string; name: string }> }>;
  resources: Map<string, TenantResources>;
  incidents: Array<{ id: number; tenantId: string | null; severity: string; title: string; kind: string; status: string; openedAt: number }>;
}

/** Margen restante por debajo del cual una empresa está «cerca del límite» (menos del 15 % libre). */
export const NEAR_LIMIT_RATIO = 0.85;
const r2 = (n: number) => Math.round(n * 100) / 100;
const monthOf = (day: string) => day.slice(0, 7);

export function buildProfitability(i: ProfitabilityInput) {
  const gaps = costGaps(i.model, i.tariffOrigin);
  const complete = gaps.length === 0;
  const liveRevenue = i.revenue.sources.some((s) => s.status === "live");
  const costBy = new Map((i.costs?.tenants ?? []).map((t) => [t.tenantId, t] as const));
  const months = Array.from(new Set(i.dayAxis.map(monthOf)));
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const sharedDaily = i.model.sharedMonthlyCents / 30;

  // Ingresos agrupados por empresa: la plataforma de la empresa del CRM, o la propia empresa si no tiene plataforma
  const tenantIds = new Set(i.tenants.map((t) => t.id));
  const keyOf = (e: RevenueEntry): string => {
    const t = e.tenantId ?? (e.companyId !== null ? (i.tenantOfCompany.get(e.companyId) ?? null) : null);
    if (t && tenantIds.has(t)) return t;
    return e.companyId !== null ? `company:${e.companyId}` : "unassigned";
  };
  const revBy = new Map<string, RevenueEntry[]>();
  for (const e of i.revenue.entries) revBy.set(keyOf(e), [...(revBy.get(keyOf(e)) ?? []), e]);
  const revenueOf = (key: string) => {
    const list = revBy.get(key) ?? [];
    const bySource: Partial<Record<RevenueSource, number>> = {};
    for (const e of list) bySource[e.source] = r2((bySource[e.source] ?? 0) + e.cents);
    const byMonth = new Map<string, number>();
    for (const e of list) byMonth.set(monthOf(dayOf(e.at)), (byMonth.get(monthOf(dayOf(e.at))) ?? 0) + e.cents);
    return { billedCents: r2(list.reduce((s, e) => s + e.cents, 0)), bySource, entries: list.length, byMonth };
  };
  const alertsOf = (tenantId: string) => i.incidents.filter((x) => x.tenantId === tenantId && x.status !== "resolved");

  const saas = i.tenants.map((t) => {
    const c = costBy.get(t.id);
    const daily = i.dayAxis.map((day) => {
      const totals = i.usageDaily.get(t.id)?.get(day) ?? {};
      return { day, measuredCents: r2(variableCost(i.model, totals).cents), estimatedCents: r2(sharedDaily * (c?.sharedShare ?? 0)) };
    });
    const rev = revenueOf(t.id);
    const measuredCents = c?.variableCents ?? 0;
    const estimatedCents = c?.sharedCents ?? 0;
    const totalCents = r2(measuredCents + estimatedCents);
    const margin = liveRevenue && i.costs ? r2(rev.billedCents - totalCents) : null;
    const res = i.resources.get(t.id);
    const quotas = (res?.rows ?? [])
      .filter((q) => q.ratio !== null)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
      .slice(0, 4)
      .map((q) => ({ metric: q.metric, period: q.period, used: q.used, limit: q.limit, ratio: q.ratio === null ? null : r2(q.ratio * 100) / 100, state: q.state as ResourceState }));
    const alerts = alertsOf(t.id);
    const requests = Array.from(i.usageDaily.get(t.id)?.values() ?? []).reduce((s, d) => s + (d["http.request"] ?? 0), 0);
    return {
      key: t.id,
      kind: "saas" as const,
      tenantId: t.id,
      companyIds: Array.from(i.tenantOfCompany.entries()).filter(([, tid]) => tid === t.id).map(([cid]) => cid),
      displayName: t.displayName,
      status: t.status,
      plan: i.plans.get(t.id)?.plan ?? null,
      modules: i.plans.get(t.id)?.modules ?? [],
      revenue: { available: liveRevenue, billedCents: rev.billedCents, bySource: rev.bySource, entries: rev.entries },
      cost: i.costs ? { applicable: true, measuredCents, estimatedCents, totalCents } : { applicable: true, measuredCents: null, estimatedCents: null, totalCents: null },
      consumption: { requests },
      margin: { complete: complete && margin !== null, cents: complete ? margin : null, provisionalCents: margin, missing: gaps.map((g) => g.label) },
      quotas,
      maxRatio: res?.maxRatio ?? null,
      nearLimit: (res?.maxRatio ?? 0) >= NEAR_LIMIT_RATIO,
      alerts: alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, kind: a.kind, openedAt: a.openedAt })),
      daily,
      monthly: months.map((m) => ({ month: m, revenueCents: r2(rev.byMonth.get(m) ?? 0), costCents: r2(daily.filter((d) => monthOf(d.day) === m).reduce((s, d) => s + d.measuredCents + d.estimatedCents, 0)) })),
    };
  });

  // Clientes externos: empresas con ingresos y sin plataforma (ni base de datos de empresa)
  const external = Array.from(revBy.keys())
    .filter((k) => k.startsWith("company:"))
    .map((k) => {
      const companyId = Number(k.slice(8));
      const rev = revenueOf(k);
      return {
        key: k,
        kind: "external" as const,
        tenantId: null,
        companyIds: [companyId],
        displayName: i.companyName.get(companyId) ?? `Empresa ${companyId}`,
        status: null,
        plan: null,
        modules: [],
        revenue: { available: liveRevenue, billedCents: rev.billedCents, bySource: rev.bySource, entries: rev.entries },
        cost: { applicable: false, measuredCents: null, estimatedCents: null, totalCents: null },
        consumption: { requests: 0 },
        margin: { complete: false, cents: null, provisionalCents: null, missing: [] as string[] },
        quotas: [],
        maxRatio: null,
        nearLimit: false,
        alerts: [],
        daily: [],
        monthly: months.map((m) => ({ month: m, revenueCents: r2(rev.byMonth.get(m) ?? 0), costCents: 0 })),
      };
    });

  const rows = [...saas, ...external];
  const sum = (f: (r: (typeof rows)[number]) => number | null) => r2(rows.reduce((s, r) => s + (f(r) ?? 0), 0));
  const openIncidents = i.incidents.filter((x) => x.status !== "resolved" && (!x.tenantId || tenantIds.has(x.tenantId)));
  const unassigned = revenueOf("unassigned");
  return {
    complete,
    missing: gaps,
    revenueSources: i.revenue.sources,
    unassignedRevenueCents: unassigned.billedCents,
    totals: {
      activeCompanies: i.tenants.filter((t) => t.status === "active").length,
      saasCompanies: saas.length,
      externalClients: external.length,
      requests: sum((r) => r.consumption.requests),
      billedCents: r2(sum((r) => r.revenue.billedCents) + unassigned.billedCents),
      measuredCents: sum((r) => r.cost.measuredCents),
      estimatedCents: sum((r) => r.cost.estimatedCents),
      totalCostCents: sum((r) => r.cost.totalCents),
      activeAlerts: openIncidents.length,
    },
    topConsumers: saas
      .filter((r) => (r.cost.measuredCents ?? 0) > 0 || r.consumption.requests > 0)
      .sort((a, b) => (b.cost.measuredCents ?? 0) - (a.cost.measuredCents ?? 0) || b.consumption.requests - a.consumption.requests)
      .slice(0, 5)
      .map((r) => ({ key: r.key, displayName: r.displayName, measuredCents: r.cost.measuredCents, requests: r.consumption.requests })),
    nearLimit: saas.filter((r) => r.nearLimit).map((r) => ({ key: r.key, displayName: r.displayName, maxRatio: r.maxRatio, quotas: r.quotas.filter((q) => (q.ratio ?? 0) >= NEAR_LIMIT_RATIO) })),
    alerts: openIncidents.slice(0, 50).map((a) => ({ id: a.id, tenantId: a.tenantId, severity: a.severity, title: a.title, kind: a.kind, openedAt: a.openedAt })),
    daily: i.dayAxis.map((day, n) => ({ day, measuredCents: r2(saas.reduce((s, r) => s + r.daily[n].measuredCents, 0)), estimatedCents: r2(saas.reduce((s, r) => s + r.daily[n].estimatedCents, 0)) })),
    monthly: months.map((m, n) => ({ month: m, revenueCents: r2(rows.reduce((s, r) => s + r.monthly[n].revenueCents, 0) + (unassigned.byMonth.get(m) ?? 0)), costCents: r2(rows.reduce((s, r) => s + r.monthly[n].costCents, 0)) })),
    tenants: rows.sort((a, b) => b.revenue.billedCents - a.revenue.billedCents || (b.cost.totalCents ?? 0) - (a.cost.totalCents ?? 0)),
  };
}

/** Días del periodo (Madrid), del más antiguo al más reciente. */
export function dayAxis(now: number, days: number): string[] {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  for (let n = days - 1; n >= 0; n--) {
    const d = f.format(new Date(now - n * 86_400_000));
    if (out[out.length - 1] !== d) out.push(d);
  }
  return out;
}
