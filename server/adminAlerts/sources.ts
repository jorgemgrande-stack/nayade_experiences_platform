/**
 * Fuentes de las alertas administrativas: traducen hechos CONFIRMADOS a alertas. Nunca inventan un hecho:
 *  - eventos comerciales (registro 0015, escritos en la misma transacción que el cambio de estado), leídos con un
 *    cursor propio que empieza en el último evento existente al activarse (nunca avisa de hechos anteriores);
 *  - historial de los servicios externos (cada hecho una sola vez, confirmado por Stripe cuando es un cobro);
 *  - incidencias operativas (abiertas, reabiertas o escaladas);
 *  - revisión periódica: gracia a punto de vencer y tickets sin respuesta del equipo en plazo;
 *  - consumo del Resource Manager: umbrales de los límites, consumo anómalo, subida brusca del coste y gasto inusual
 *    de las integraciones externas (`ConsumptionWatcher`).
 */
import type { CostModel } from "../_core/erm/costs";
import { COST_METRIC, WATCHED, dailyUsage, detectAnomalies, detectCostSpike, externalWatched, lastFullMadridDay, type Anomaly } from "../_core/erm/insights";
import type { ResourceRow } from "../_core/erm/overview";
import type { UsageStore } from "../_core/erm/types";
import { opsLog } from "../_core/ops/log";
import type { Incident } from "../_core/ops/incidents";
import type { Ticket, TicketEvent } from "../_core/support/tickets";
import type { CommercialEvent, CommercialEventType } from "../commercialEvents/types";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import type { CommercialOrder } from "../orchestrator/types";
import type { AlertFacts } from "./catalog";
import type { AdminAlertStore } from "./store";
import { dateTime } from "./templates";

export type Raise = (alertId: string, f: AlertFacts) => Promise<unknown>;
export type AlertOut = { id: string; facts: AlertFacts };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown) => (typeof v === "string" && v ? v : null);
const money = (cents: unknown, currency: unknown) => (n(cents) !== null ? { cents: n(cents)!, currency: (s(currency) ?? "EUR").toUpperCase() } : null);
const KIND: Record<string, string> = { new: "alta", trial_conversion: "conversión de prueba", change: "cambio" };

// ── Eventos comerciales ───────────────────────────────────────────────────────

export const WATCHED_EVENTS: readonly CommercialEventType[] = [
  "trial.verified", "trial.started", "trial.provisioning_failed",
  "order.contracted", "order.confirmed", "order.subscribed", "order.cancel_scheduled", "order.past_due", "order.suspended", "order.recovered",
  "subscription.plan_changed", "subscription.module_added", "subscription.quantity_changed",
  "payment.succeeded", "payment.failed", "renewal.paid", "renewal.failed",
  "refund.recorded", "dispute.status_changed",
];

export interface EventContext {
  company: string | null;
  reference: string | null;
}

/** Alertas de un evento comercial (puro). */
export function commercialEventAlerts(e: CommercialEvent, ctx: EventContext): AlertOut[] {
  const d = obj(e.data);
  const isChange = d.kind === "change";
  const base = { key: `ce:${e.key}`, occurredAt: e.occurredAt, tenantId: e.tenantId, companyId: e.companyId, company: ctx.company, reference: ctx.reference };
  const order = e.orderId ? `#/comercial/contrataciones/${e.orderId}` : e.companyId ? `#/comercial/empresas/${e.companyId}` : null;
  const plan = [s(d.plan), d.interval === "year" ? "anual" : d.interval === "month" ? "mensual" : null].filter(Boolean).join(" · ");
  const one = (id: string, f: Omit<AlertFacts, keyof typeof base | "key" | "occurredAt"> & Partial<AlertFacts>): AlertOut[] => [{ id, facts: { ...base, link: order, ...f } }];
  switch (e.type) {
    case "trial.verified":
      return one("admin.customer_registered", { summary: "Una empresa nueva ha verificado su correo en el alta de la prueba gratuita.", status: { label: "Correo verificado", tone: "success" }, link: "#/operacion/pruebas" });
    case "trial.started":
      return one("admin.trial_started", { summary: "Se ha activado una prueba gratuita: la plataforma está aprovisionada.", status: { label: "Prueba activa", tone: "success" }, link: e.tenantId ? `#/clientes/${e.tenantId}` : "#/operacion/pruebas" });
    case "trial.provisioning_failed":
      return one("admin.provisioning_failed", { summary: "No se ha podido crear la plataforma de una prueba gratuita.", status: { label: "Alta fallida", tone: "error" }, link: "#/operacion/errores" });
    case "order.contracted":
      if (isChange) return [];
      return one("admin.contract_accepted", { summary: "El cliente ha aceptado las condiciones de contratación. Pendiente del cobro: la suscripción aún no está creada en Stripe.", status: { label: "Condiciones aceptadas", tone: "success" } });
    case "order.confirmed":
      if (isChange) return [];
      return one("admin.plan_contracted", { summary: `Contratación confirmada (${KIND[String(d.kind)] ?? "alta"})${d.basis === "payment" ? " con el pago verificado" : ""}.`, status: { label: "Contratación confirmada", tone: "success" }, amount: money(d.firstPeriodCents, d.currency), details: plan ? [{ label: "Plan", value: plan }] : [] });
    case "order.subscribed":
      if (isChange) return [];
      return one("admin.subscription_created", { summary: "Suscripción creada en el sistema de cobro.", status: { label: "Suscripción creada", tone: "info" } });
    case "order.cancel_scheduled":
      return one("admin.subscription_cancelled", { summary: `Baja de la suscripción programada${n(d.cancelAt) ? ` para el ${dateTime(n(d.cancelAt)!)}` : " a fin de periodo"}.`, status: { label: "Baja programada", tone: "warning" } });
    case "order.past_due":
      return one("admin.grace_started", { summary: "La suscripción está impagada y ha entrado en el periodo de gracia.", status: { label: "En gracia", tone: "warning" }, details: n(d.graceEndsAt) ? [{ label: "Fin de la gracia", value: dateTime(n(d.graceEndsAt)!) }] : [] });
    case "order.suspended":
      return one("admin.subscription_suspended", { summary: "La suscripción se ha suspendido: el acceso del cliente está en pausa.", status: { label: "Suspendida", tone: "error" } });
    case "order.recovered":
      return one("admin.payment_recovered", { summary: "El cobro pendiente se ha recuperado; la suscripción vuelve a estar al corriente.", status: { label: "Al corriente", tone: "success" } });
    case "subscription.plan_changed":
    case "subscription.module_added":
    case "subscription.quantity_changed": {
      const after = obj(d.after);
      const what = e.type === "subscription.plan_changed" ? `Cambio de plan${s(after.plan) ? ` a ${after.plan}` : ""}` : e.type === "subscription.module_added" ? `Módulo añadido${s(after.item) ? `: ${after.item}` : ""}` : `Ampliación${s(after.metric) ? ` de ${after.metric}` : ""}${n(after.quantity) !== null ? ` (${after.quantity} unidades adicionales)` : ""}`;
      return one("admin.plan_changed", { summary: `${what}.`, status: { label: "Aplicado", tone: "success" }, link: e.subscriptionId ? `#/comercial/suscripciones/${e.subscriptionId}` : order });
    }
    case "payment.succeeded":
      if (d.purpose !== "initial") return [];
      return one("admin.first_charge", { summary: `Primer cobro verificado${s(d.provider)?.startsWith("stripe") ? " en Stripe" : ""}${d.mode === "test" ? " (modo de pruebas)" : ""}.`, status: { label: "Cobrado", tone: "success" }, amount: money(d.amountCents, d.currency) });
    case "renewal.paid":
      return one("admin.renewal_paid", { summary: `Renovación cobrada${d.mode === "test" ? " (modo de pruebas)" : ""}.`, status: { label: "Cobrado", tone: "success" }, amount: money(d.amountCents, d.currency) });
    case "payment.failed":
    case "renewal.failed":
      return one("admin.payment_failed", { summary: e.type === "renewal.failed" ? "No se ha podido cobrar la renovación de la suscripción." : "No se ha podido completar el cobro de la contratación.", status: { label: "Impagado", tone: "error" }, amount: money(d.amountCents, d.currency), link: "#/comercial/cobros-en-riesgo" });
    case "refund.recorded":
      return one("admin.refund", { summary: `Reembolso ${d.full ? "total" : "parcial"} registrado en Stripe. Revisa la factura rectificativa.`, status: { label: d.full ? "Reembolso total" : "Reembolso parcial", tone: "info" }, amount: money(d.deltaCents, d.currency) });
    case "dispute.status_changed":
      return one("admin.dispute", { summary: `Disputa en Stripe: estado «${e.toState ?? "desconocido"}».`, status: { label: `Disputa: ${e.toState ?? "—"}`, tone: "error" }, amount: money(d.amountCents, d.currency), link: "#/comercial/cobros-en-riesgo" });
    default:
      return [];
  }
}

/**
 * Lector de eventos comerciales con cursor propio (`admin_alert_state.commercial_events`). Al activarse por primera
 * vez el cursor se coloca en el último evento existente: nunca se avisa de hechos anteriores. Reprocesar es inocuo
 * (idempotencia por evento).
 */
export class CommercialEventWatcher {
  constructor(
    private d: {
      events: { list(f: { afterId?: number; types?: CommercialEventType[]; limit?: number }): Promise<CommercialEvent[]> };
      store: Pick<AdminAlertStore, "getState" | "setState">;
      raise: Raise;
      latestId: () => Promise<number>;
      context: (e: CommercialEvent) => Promise<EventContext>;
      now?: () => number;
    },
  ) {}

  async tick(limit = 200): Promise<{ read: number; raised: number }> {
    const now = (this.d.now ?? Date.now)();
    let cursor = await this.d.store.getState("commercial_events");
    if (cursor === null) {
      await this.d.store.setState("commercial_events", await this.d.latestId(), now);
      return { read: 0, raised: 0 };
    }
    const list = await this.d.events.list({ afterId: cursor, types: [...WATCHED_EVENTS], limit });
    let raised = 0;
    for (const e of list) {
      const ctx = await this.d.context(e).catch(() => ({ company: null, reference: null }));
      for (const a of commercialEventAlerts(e, ctx)) {
        await this.d.raise(a.id, a.facts);
        raised++;
      }
      cursor = e.id;
    }
    if (list.length) await this.d.store.setState("commercial_events", cursor, now);
    return { read: list.length, raised };
  }
}

// ── Incidencias ───────────────────────────────────────────────────────────────

const SECURITY = new Set(["stripe.webhook_invalid_signature", "stripe.live_event_rejected", "stripe.test_event_rejected", "stripe.namespace_mismatch", "stripe.portal_unsafe"]);
const INTEGRATION = new Set(["stripe.gateway_error", "stripe.webhook_store_failed", "stripe.worker_failed", "stripe.reconcile_backlog", "stripe.reconcile_refresh_failed", "stripe.events_purge_failed", "notifications.dead", "licensing.check_failed"]);
/**
 * Incidencias que ya cubre otra alerta (eventos comerciales; las cuotas `quota:*`, la vigilancia de consumo con sus
 * umbrales): no se repite el mismo hecho.
 */
const COVERED = /^(tenant\.grace|tenant\.suspended|entitlement\.expiring|quota:)|^rate:(stripe\.dispute_open|stripe\.partial_refund|stripe\.coverage_lost)$/;

/** Alerta de una incidencia (abierta, reabierta o escalada), o null si no corresponde avisar. */
export function incidentAlert(i: Incident, event: "opened" | "reopened" | "escalated" | "resolved"): AlertOut | null {
  if (event === "resolved" || COVERED.test(i.dedupeKey)) return null;
  const rate = i.dedupeKey.startsWith("rate:") ? i.dedupeKey.slice(5) : null;
  let id: string | null = null;
  if (rate && SECURITY.has(rate)) id = "admin.security_incident";
  else if (rate === "provisioning.failed" || i.dedupeKey.startsWith("provisioning.failed")) id = "admin.provisioning_failed";
  else if (rate && (INTEGRATION.has(rate) || rate.startsWith("mail."))) id = "admin.integration_error";
  else if (i.dedupeKey === "erm.collector_stale") id = "admin.integration_error";
  else if (rate && /^(stripe|orders|purchases|external)\./.test(rate) && i.severity === "critical") id = "admin.billing_error";
  else if (i.dedupeKey.startsWith("backup.")) id = "admin.backup_failed";
  else if (i.severity === "critical") id = "admin.critical_incident";
  if (!id) return null;
  const state = event === "opened" ? "Abierta" : event === "reopened" ? "Reabierta" : "Escalada";
  return {
    id,
    facts: {
      key: `incident:${i.id}:${event}:${i.occurrences}`,
      occurredAt: i.lastSeenAt,
      tenantId: i.tenantId,
      summary: i.title.slice(0, 300),
      status: { label: state, tone: i.severity === "info" ? "info" : i.severity === "warning" ? "warning" : "error" },
      reference: `Incidencia #${i.id}`,
      details: [
        { label: "Tipo", value: i.kind },
        { label: "Repeticiones", value: String(i.occurrences) },
        { label: "Abierta desde", value: dateTime(i.openedAt) },
      ],
      link: i.tenantId ? `#/clientes/${i.tenantId}` : "#/dashboard",
      ...(event === "escalated" ? { severity: "critical" as const, escalated: "la incidencia se ha escalado" } : {}),
    },
  };
}

// ── Servicios externos ────────────────────────────────────────────────────────

/** Alertas de un hecho del historial de un servicio externo (puro). `firstPaid`: es la primera factura cobrada. */
export function externalEventAlerts(ev: Omit<ExternalEvent, "id">, x: ExternalSubscription, company: string | null, firstPaid: boolean): AlertOut[] {
  const d = obj(ev.detail);
  const base = { key: `ext:${x.id}:${ev.kind}:${ev.ref ?? ev.at}`, occurredAt: ev.at, companyId: x.companyId, company, link: `#/comercial/servicios-externos/${x.id}`, details: [{ label: "Servicio", value: x.serviceName }] };
  const fee = { cents: x.amountCents, currency: x.currency };
  const one = (id: string, f: Omit<AlertFacts, "key" | "occurredAt">): AlertOut[] => [{ id, facts: { ...base, ...f } }];
  switch (ev.kind) {
    case "created":
      return one("admin.external_contracted", { summary: `Alta del servicio externo «${x.serviceName}».`, status: { label: "Pendiente de contrato", tone: "info" }, amount: fee });
    case "changed": {
      const after = obj(d.after);
      const summary =
        d.change === "first_charge"
          ? `Decisión registrada en «${x.serviceName}»: primer cargo el ${dateTime(n(after.firstChargeAt) ?? x.firstChargeAt)}${s(after.status) ? ` (estado «${after.status}»)` : ""}.`
          : d.change === "contract_version"
            ? `Aceptada la versión ${n(d.contractVersion) ?? "nueva"} del contrato de «${x.serviceName}».`
            : `Modificación registrada en «${x.serviceName}».`;
      return one("admin.external_changed", {
        summary,
        status: { label: "Actualizado", tone: "info" },
        amount: fee,
        details: [...base.details, ...(n(d.contractVersion) !== null ? [{ label: "Versión del contrato", value: String(d.contractVersion) }] : []), ...(s(d.reason) ? [{ label: "Motivo", value: String(d.reason).slice(0, 300) }] : [])],
      });
    }
    case "acceptance_requested":
      return one("admin.contract_sent", { summary: `Contrato de «${x.serviceName}» enviado al firmante para su revisión y aceptación.`, status: { label: "Pendiente de firma", tone: "info" } });
    case "accepted":
      return one("admin.contract_accepted", { summary: `Contrato de «${x.serviceName}» aceptado electrónicamente. Siguiente paso: autorizar el método de pago (la suscripción aún no existe en Stripe).`, status: { label: "Contrato aceptado", tone: "success" }, intervention: true });
    case "payment_method_authorized":
      return one("admin.payment_method_authorized", { summary: "Stripe ha confirmado la autorización del método de pago. Todavía no se ha cobrado nada.", status: { label: "Tarjeta autorizada", tone: "success" } });
    case "scheduled":
      return one("admin.subscription_created", { summary: `Suscripción creada y programada en Stripe; primer cargo el ${dateTime(n(d.firstChargeAt) ?? x.firstChargeAt)}.`, status: { label: "Programada en Stripe", tone: "info" }, amount: fee });
    case "invoice_paid":
      return one(firstPaid ? "admin.first_charge" : "admin.renewal_paid", { summary: `${firstPaid ? "Primer cobro" : "Cobro mensual"} de «${x.serviceName}» verificado en Stripe${s(d.period) ? ` (${d.period})` : ""}.`, status: { label: "Cobrado", tone: "success" }, amount: money(d.amountPaid, x.currency), reference: s(d.number) });
    case "invoice_payment_failed":
      return one("admin.payment_failed", { summary: `Stripe no ha podido cobrar «${x.serviceName}»${s(d.period) ? ` (${d.period})` : ""}. Empieza el margen de cobro.`, status: { label: "Impagado", tone: "error" }, amount: money(d.amountDue, x.currency) });
    case "overdue_after_grace":
      return one("admin.subscription_suspended", { summary: `Terminado el margen de cobro de «${x.serviceName}» sin pago.`, status: { label: "Vencido sin cobro", tone: "error" } });
    case "charge_refunded":
      return one("admin.refund", { summary: `Reembolso ${d.fullyRefunded ? "total" : "parcial"} de «${x.serviceName}» en Stripe. Revisa la factura rectificativa.`, status: { label: "Reembolsado", tone: "info" }, amount: money(d.refundedDeltaCents, x.currency) });
    case "charge_dispute":
      return one("admin.dispute", { summary: `Disputa de un cobro de «${x.serviceName}»: estado «${s(d.disputeStatus) ?? "—"}».`, status: { label: "Disputa", tone: "error" } });
    default:
      return [];
  }
}

/**
 * Envuelve el almacén de servicios externos: tras registrar un hecho NUEVO (el almacén lo hace una sola vez por
 * referencia), lanza su alerta. Un fallo de la alerta nunca afecta al registro.
 */
export function withExternalAlerts<S extends { event(e: Omit<ExternalEvent, "id">): Promise<{ created: boolean }>; get(id: number): Promise<ExternalSubscription | null>; events(id: number): Promise<ExternalEvent[]> }>(
  store: S,
  d: { raise: Raise; companyName: (id: number) => Promise<string | null> },
): S {
  const event = store.event.bind(store);
  const wrappedEvent = async (e: Omit<ExternalEvent, "id">) => {
    const r = await event(e);
    if (!r.created) return r;
    void (async () => {
      const x = await store.get(e.externalId);
      if (!x) return;
      const firstPaid = e.kind === "invoice_paid" ? (await store.events(x.id)).filter((v) => v.kind === "invoice_paid").length <= 1 : false;
      for (const a of externalEventAlerts(e, x, await d.companyName(x.companyId).catch(() => null), firstPaid)) await d.raise(a.id, a.facts);
    })().catch((err) => opsLog("warn", "AdminAlerts", "external_alert_failed", { externalId: e.externalId, error: err instanceof Error ? err.name : "error" }));
    return r;
  };
  // Solo se intercepta `event`; el resto de métodos actúa sobre el almacén original
  return new Proxy(store, {
    get(t, p) {
      if (p === "event") return wrappedEvent;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

// ── Revisión periódica ────────────────────────────────────────────────────────

const H = 3600_000;

/** Pedidos impagados con 48 h o menos de gracia (puro). */
export function suspensionNear(orders: CommercialOrder[], now: number): AlertOut[] {
  return orders
    .filter((o) => o.state === "past_due" && typeof o.graceEndsAt === "number" && o.graceEndsAt > now && o.graceEndsAt - now <= 48 * H)
    .map((o) => ({ id: "admin.suspension_near", facts: { key: `order:${o.id}:grace:${o.graceEndsAt}`, occurredAt: now, tenantId: o.tenantId, companyId: o.companyId, reference: o.reference, summary: `Sin cobro, la suscripción se suspenderá el ${dateTime(o.graceEndsAt!)}.`, status: { label: "Suspensión inminente", tone: "warning" }, link: `#/comercial/contrataciones/${o.id}` } }));
}

/** Servicios externos impagados con 48 h o menos de margen (puro). */
export function externalSuspensionNear(list: ExternalSubscription[], now: number): AlertOut[] {
  return list
    .filter((x) => x.status === "past_due" && typeof x.graceUntil === "number" && x.graceUntil > now && x.graceUntil - now <= 48 * H)
    .map((x) => ({ id: "admin.suspension_near", facts: { key: `ext:${x.id}:grace:${x.graceUntil}`, occurredAt: now, companyId: x.companyId, summary: `Sin cobro, el margen de «${x.serviceName}» termina el ${dateTime(x.graceUntil!)}.`, status: { label: "Fin del margen inminente", tone: "warning" }, link: `#/comercial/servicios-externos/${x.id}` } }));
}

/** ¿Ha respondido el equipo? Un comentario público o un cambio de estado de alguien distinto de quien lo abrió. */
export function teamResponded(t: Ticket, events: TicketEvent[]): boolean {
  return events.some((e) => e.actor !== t.createdBy && ((e.kind === "comment" && !e.internal) || e.kind === "status"));
}

/** Tickets abiertos sin respuesta del equipo: aviso al vencer el plazo y escalado al doble (puro). */
export function ticketDeadlines(list: Array<{ ticket: Ticket; events: TicketEvent[] }>, now: number, slaHours: number): AlertOut[] {
  const out: AlertOut[] = [];
  for (const { ticket: t, events } of list) {
    if (t.status !== "open" || teamResponded(t, events)) continue;
    const age = now - t.createdAt;
    const base = { occurredAt: now, tenantId: t.tenantId, reference: `T-${t.id}`, link: "#/soporte", details: [{ label: "Asunto", value: t.title.slice(0, 120) }, { label: "Prioridad", value: t.priority }, { label: "Abierto desde", value: dateTime(t.createdAt) }] };
    if (age >= 2 * slaHours * H) out.push({ id: "admin.ticket_escalated", facts: { ...base, key: `ticket:${t.id}:escalated`, summary: `El ticket T-${t.id} lleva más de ${2 * slaHours} horas sin respuesta del equipo: se escala.`, status: { label: "Escalado", tone: "error" } } });
    else if (age >= slaHours * H) out.push({ id: "admin.ticket_unanswered", facts: { ...base, key: `ticket:${t.id}:unanswered`, summary: `El ticket T-${t.id} lleva más de ${slaHours} horas sin respuesta del equipo.`, status: { label: "Sin respuesta", tone: "warning" } } });
  }
  return out;
}

// ── Consumo de recursos (Resource Manager) ────────────────────────────────────

/** Umbrales por defecto de las alertas de consumo, en % del límite del periodo. */
export const DEFAULT_USAGE_THRESHOLDS: readonly number[] = [70, 85, 100];

/**
 * Umbrales de `ERM_ADMIN_ALERT_THRESHOLDS` («70,85,100»): enteros del 1 al 100, ordenados y sin repetir. El 100 % se
 * añade siempre (el límite alcanzado no se puede dejar sin aviso). Vacío o no válido → los de por defecto.
 */
export function usageThresholdsFromEnv(env: NodeJS.ProcessEnv): number[] {
  const raw = env.ERM_ADMIN_ALERT_THRESHOLDS?.trim();
  const list = raw ? raw.split(",").map((x) => Number(x.trim())) : [];
  if (!list.length || list.some((x) => !Number.isInteger(x) || x < 1 || x > 100)) return [...DEFAULT_USAGE_THRESHOLDS];
  return Array.from(new Set([...list, 100])).sort((a, b) => a - b);
}

export interface ConsumptionTenant {
  id: string;
  company: string | null;
}

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const PERIOD: Record<string, string> = { hour: "hora", day: "día", month: "mes" };
const ON_LIMIT = { hard: "se rechaza el consumo que lo supere", soft: "se permite y se avisa" } as const;

/**
 * Alertas de umbral de consumo (puro): por cada límite con consumo acumulable, el umbral MÁS ALTO alcanzado en el
 * periodo en curso. 70 % y 85 % → `admin.quota_near`; 100 % → `admin.quota_reached`. La clave del hecho (empresa,
 * métrica, periodo con su inicio y umbral) hace que cada umbral avise una sola vez por periodo.
 */
export function usageThresholdAlerts(t: ConsumptionTenant, rows: ResourceRow[], thresholds: readonly number[], now: number): AlertOut[] {
  const out: AlertOut[] = [];
  for (const r of rows) {
    if (r.used === null || r.limit <= 0) continue;
    const pct = (r.used / r.limit) * 100;
    const hit = thresholds.filter((x) => pct >= x).pop();
    if (hit === undefined) continue;
    const reached = hit >= 100;
    out.push({
      id: reached ? "admin.quota_reached" : "admin.quota_near",
      facts: {
        key: `erm:quota:${t.id}:${r.metric}:${r.period}:${r.windowStart}:${hit}`.slice(0, 190),
        occurredAt: now,
        tenantId: t.id,
        company: t.company,
        summary: reached
          ? `Límite de ${r.metric} alcanzado en el periodo (${PERIOD[r.period] ?? r.period}): ${nf.format(r.used)} de ${nf.format(r.limit)}.`
          : `Consumo de ${r.metric} al ${Math.floor(pct)} % del límite del periodo (${PERIOD[r.period] ?? r.period}).`,
        status: reached ? { label: "Límite alcanzado", tone: "error" } : { label: `Umbral del ${hit} %`, tone: "warning" },
        details: [
          { label: "Métrica", value: r.metric },
          { label: "Consumo", value: `${nf.format(r.used)} de ${nf.format(r.limit)} (${Math.floor(pct)} %)` },
          { label: "Periodo desde", value: dateTime(r.windowStart) },
          { label: "Al llegar al límite", value: ON_LIMIT[r.enforcement] },
        ],
        link: `#/clientes/${t.id}`,
      },
    });
  }
  return out;
}

const amount = (metric: string, v: number) =>
  metric === COST_METRIC ? `${nf.format(v / 100)} €` : metric.endsWith("_microusd") ? `${nf.format(v / 1e6)} USD` : nf.format(v);

/**
 * Alertas de consumo anómalo (puro), con las anomalías ya calculadas por el Resource Manager frente a los 14 días
 * anteriores. Solo los picos: una caída a cero es un fallo de medición o de servicio y la cubre `erm.collector_stale`.
 * Salen por `admin.quota_near` (sin plantillas nuevas), con el detalle de qué tipo de anomalía es:
 *  - coste variable atribuible → «subida brusca del coste»;
 *  - métricas `ext.*` → «gasto inusual de una integración externa»;
 *  - el resto → «consumo anómalo».
 */
export function anomalyAlerts(t: ConsumptionTenant, anomalies: Anomaly[]): AlertOut[] {
  return anomalies
    .filter((a) => a.kind === "spike")
    .map((a) => {
      const provider = /^ext\.([a-z0-9_]+)\./.exec(a.metric)?.[1] ?? null;
      const kind = a.metric === COST_METRIC ? "Subida brusca del coste" : provider ? "Gasto inusual de una integración externa" : "Consumo anómalo";
      const what = a.metric === COST_METRIC ? "coste variable atribuible" : a.metric;
      const times = Number.isFinite(a.factor) ? `${nf.format(a.factor)} veces la media` : "sin consumo";
      return {
        id: "admin.quota_near",
        facts: {
          key: `erm:anomaly:${t.id}:${a.metric}:${a.date}`.slice(0, 190),
          occurredAt: Date.parse(`${a.date}T23:59:59Z`),
          tenantId: t.id,
          company: t.company,
          summary: `${kind}${provider ? ` (${provider})` : ""}: ${what} de ${amount(a.metric, a.value)} el ${a.date}, ${times} de los 14 días anteriores.`,
          status: { label: kind, tone: "warning" as const },
          details: [
            { label: "Métrica", value: what },
            { label: "Día", value: a.date },
            { label: "Valor del día", value: amount(a.metric, a.value) },
            { label: "Media de los 14 días anteriores", value: amount(a.metric, a.baseline) },
          ],
          link: `#/clientes/${t.id}`,
        },
      };
    });
}

export interface ConsumptionWatcherDeps {
  /** Empresas en servicio (activas, en prueba o en gracia). */
  tenants: () => Promise<ConsumptionTenant[]>;
  /** Límites efectivos y consumo del periodo en curso (`tenantResources` del Resource Manager). */
  resources: (tenantId: string, now: number) => Promise<ResourceRow[]>;
  usage: UsageStore;
  /** Tarifas vigentes (Admin, ERM_COST_MODEL o estimación) para el coste variable de cada día. */
  costModel: () => Promise<CostModel>;
  thresholds: readonly number[];
  store: Pick<AdminAlertStore, "getState" | "setState">;
  raise: Raise;
  /** Cada cuánto se revisan los umbrales (por defecto 15 min); el ciclo de alertas pasa más a menudo. */
  everyMs?: number;
  now?: () => number;
}

/**
 * Vigilancia del consumo dentro del ciclo de alertas administrativas (`CP_ADMIN_ALERTS_EVERY_SECONDS`):
 *  - umbrales de los límites: cada `everyMs`;
 *  - anomalías (consumo, coste e integraciones externas): una vez al día, sobre el último día completo de Madrid
 *    (estado `erm_anomalies` en `admin_alert_state`, para no repetir el cálculo tras un reinicio).
 * El aviso a la EMPRESA cuando llega al 80 % / 100 % de su plan es otro circuito (`usageNotices`, plantilla
 * `usage_threshold`, al ritmo de `CP_ALERTS_EVERY_SECONDS`): aquí solo se avisa a la administración.
 * Un fallo con una empresa no impide revisar las demás.
 */
export class ConsumptionWatcher {
  private lastThresholdsAt = Number.NEGATIVE_INFINITY;
  /** Hechos ya lanzados por este proceso: no se vuelve a consultar el registro (la idempotencia real es la clave). */
  private raised = new Set<string>();
  constructor(private d: ConsumptionWatcherDeps) {}

  private async raiseOnce(list: AlertOut[]): Promise<number> {
    let n = 0;
    for (const a of list) {
      const k = `${a.id}|${a.facts.key}`;
      if (this.raised.has(k)) continue;
      const r = (await this.d.raise(a.id, a.facts)) as { status?: string } | undefined;
      n++;
      // Un fallo (o las alertas aún no disponibles) se reintenta en la siguiente pasada
      if (r?.status === "failed" || r?.status === "unavailable") continue;
      if (this.raised.size > 5000) this.raised.clear();
      this.raised.add(k);
    }
    return n;
  }

  async tick(): Promise<number> {
    const now = (this.d.now ?? Date.now)();
    const tenants = await this.d.tenants();
    let raised = 0;
    const each = async (step: string, t: ConsumptionTenant, f: () => Promise<AlertOut[]>) => {
      try {
        raised += await this.raiseOnce(await f());
      } catch (e) {
        opsLog("warn", "AdminAlerts", "consumption_check_failed", { step, tenantId: t.id, error: e instanceof Error ? e.name : "error" });
      }
    };
    if (now - this.lastThresholdsAt >= (this.d.everyMs ?? 15 * 60_000)) {
      this.lastThresholdsAt = now;
      for (const t of tenants) await each("thresholds", t, async () => usageThresholdAlerts(t, await this.d.resources(t.id, now), this.d.thresholds, now));
    }
    const day = lastFullMadridDay(now);
    const dayKey = Date.parse(`${day}T00:00:00Z`);
    if ((await this.d.store.getState("erm_anomalies")) !== dayKey) {
      const model = await this.d.costModel();
      for (const t of tenants) {
        await each("anomalies", t, async () => {
          const daily = await dailyUsage(this.d.usage, t.id, now - 17 * 86_400_000, now);
          const cost = detectCostSpike(t.id, daily, day, model);
          return anomalyAlerts(t, [...detectAnomalies(t.id, daily, day, { ...WATCHED, ...externalWatched(daily) }), ...(cost ? [cost] : [])]);
        });
      }
      await this.d.store.setState("erm_anomalies", dayKey, now);
    }
    return raised;
  }
}
