/**
 * Traza de extremo a extremo de un alta de pago (alta nueva, conversión de una prueba o compra de un módulo), SOLO
 * LECTURA: lee lo que ya registraron el orquestador, el procesador de eventos de Stripe, las licencias, las pruebas y
 * la facturación, y lo resume en seis pasos con su estado. Nunca cobra, activa, corrige ni crea nada en Stripe.
 *
 *   1. Pago confirmado en Stripe      (Checkout completado o cambio de partidas cobrado, y pago verificado del pedido)
 *   2. Webhook recibido y procesado   (eventos de Stripe de los objetos del pedido: recibidos, procesados, fallidos)
 *   3. Suscripción activa             (pedido activo, suscripción interna y de Stripe enlazadas a la empresa)
 *   4. Licencias aplicadas            (capacidades del presupuesto activas en el tenant, con su origen)
 *   5. Datos conservados              (conversión: mismo tenant de la prueba, prueba convertida, sin otra plataforma)
 *   6. Factura emitida                (factura propia con número o documento fiscal emitido, y su envío)
 *
 * Umbrales (`SALE_TRACE_THRESHOLDS`): un paso que sigue pendiente más allá de lo razonable es una INCIDENCIA:
 *  - webhook: más de 10 minutos entre el pago en Stripe y el evento procesado;
 *  - activación y licencias: más de 15 minutos tras el pago (el procesador encadena confirmar → suscribir → licenciar
 *    → activar en el mismo evento; la recuperación de altas reintenta en minutos);
 *  - factura: más de 48 horas tras el pago (la automatización de facturación pasa a diario; el primer cobro no lleva
 *    proforma: la de 5 días solo precede a las mensualidades programadas).
 *
 * Sin datos sensibles: ni tarjetas ni correos; los ids de Stripe salen abreviados (`in_…a1b2`).
 */
import type { CapabilityGrant } from "../_core/capabilities/model";
import type { AlertFacts } from "../adminAlerts/catalog";
import { isTestTenant } from "../adminAlerts/operations";
import type { AdminAlertStore } from "../adminAlerts/store";
import { isStripeProvider } from "../orchestrator/service";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder, OrderEvent, OrderPayment, PaymentMode } from "../orchestrator/types";

// ── Umbrales y fases ──────────────────────────────────────────────────────────

const MIN = 60_000;
export const SALE_TRACE_THRESHOLDS = {
  /** Del pago en Stripe al evento procesado. */
  webhookMs: 10 * MIN,
  /** Del pago a la suscripción activa y las licencias aplicadas. */
  activationMs: 15 * MIN,
  /** Del pago a la factura emitida. */
  invoiceMs: 48 * 60 * MIN,
} as const;

/** Evaluaciones de la alerta: al detectar el cobro, pasado el margen de activación y al vencer el plazo de la factura. */
export const SALE_TRACE_PHASES = [
  { id: "inicial", afterMs: 0, label: "evaluación inmediata tras el cobro" },
  { id: "revision", afterMs: 20 * MIN, label: "revisión 20 minutos después del cobro" },
  { id: "factura", afterMs: SALE_TRACE_THRESHOLDS.invoiceMs, label: "revisión de la factura 48 horas después del cobro" },
] as const;
export type SaleTracePhase = (typeof SALE_TRACE_PHASES)[number];

export const SALE_TRACE_ALERT = "admin.sale_trace";
/** Ventana en la que la vigilancia busca cobros (cubre la última fase con margen). */
const WATCH_LOOKBACK_MS = 3 * 24 * 60 * MIN;
const STATE_SINCE = "sale_trace_since";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TraceStepStatus = "ok" | "pending" | "failed" | "not_applicable";
export type TraceStepId = "payment" | "webhook" | "subscription" | "licences" | "data" | "invoice";
export interface TraceStep {
  id: TraceStepId;
  title: string;
  status: TraceStepStatus;
  /** Cuándo se cumplió (ms) o null. */
  at: number | null;
  detail: string;
}
export interface SaleTrace {
  orderId: number;
  reference: string | null;
  kind: CommercialOrder["kind"];
  state: CommercialOrder["state"];
  companyId: number;
  tenantId: string | null;
  mode: PaymentMode | null;
  amount: { cents: number; currency: string } | null;
  /** Pago confirmado en Stripe (o registrado), ms. */
  paidAt: number | null;
  /** ok: todo correcto; failed: algún paso falla o se ha retrasado; in_progress: aún en plazo. */
  status: "ok" | "in_progress" | "failed";
  steps: TraceStep[];
  incidents: string[];
  evaluatedAt: number;
  thresholds: { webhookMinutes: number; activationMinutes: number; invoiceHours: number };
}

export interface TraceSession {
  id: string;
  status: "open" | "complete" | "expired";
  paymentStatus: string | null;
  createdAt: number;
  completedAt: number | null;
}
export interface TraceChange {
  stripeSubscriptionId: string;
  status: "pending" | "applied" | "expired" | "failed";
  stripeInvoiceId: string | null;
  detail: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface TraceStripeSubscription {
  id: string;
  status: string;
  orderId: number | null;
  companyId: number;
  tenantId: string | null;
  syncedAt: number;
}
export interface TraceStripeEvent {
  id: string;
  type: string;
  objectId: string | null;
  status: "received" | "processing" | "processed" | "ignored" | "failed";
  attempts: number;
  lastError: string | null;
  source: "webhook" | "reconcile";
  /** Segundos (como lo da Stripe). */
  stripeCreated: number;
  receivedAt: number;
  processedAt: number | null;
  nextAttemptAt: number | null;
}
export interface TraceStripeInvoice {
  id: string;
  status: string;
  purpose: string;
  totalCents: number;
  currency: string;
  createdAt: number;
}
export interface TraceFiscalDocument {
  id: number;
  kind: "invoice" | "rectification";
  stripeInvoiceId: string;
  status: "pending" | "issued" | "failed";
  externalRef: string | null;
  issuedAt: number | null;
  lastError: string | null;
  createdAt: number;
}
export interface TraceOwnInvoice {
  id: number;
  status: string;
  number: string | null;
  paymentRef: string | null;
  billingRef: string;
  issuedAt: number | null;
}
export interface TraceMail {
  key: string;
  status: string;
  createdAt: number;
}

/** Lecturas de Stripe, facturación y correo que necesita la traza (MySQL en ./saleTraceStore.ts). */
export interface SaleTraceReader {
  sessions(orderId: number): Promise<TraceSession[]>;
  change(orderId: number): Promise<TraceChange | null>;
  stripeSubscriptions(orderId: number, ids: string[]): Promise<TraceStripeSubscription[]>;
  stripeEvents(objectIds: string[]): Promise<TraceStripeEvent[]>;
  stripeInvoices(orderId: number): Promise<TraceStripeInvoice[]>;
  fiscalDocuments(orderId: number): Promise<TraceFiscalDocument[]>;
  ownInvoices(q: { orderId: number; companyId: number; stripeInvoiceIds: string[] }): Promise<TraceOwnInvoice[]>;
  mails(tenantId: string | null, keys: string[]): Promise<TraceMail[]>;
  /** Pedidos con su primer cobro verificado (alta o cambio) desde `since`, en ese modo. */
  recentSales(since: number, mode: PaymentMode): Promise<Array<{ orderId: number; paidAt: number }>>;
}

/** Todo lo leído para un pedido. */
export interface SaleTraceData {
  order: CommercialOrder;
  events: OrderEvent[];
  payments: OrderPayment[];
  sessions: TraceSession[];
  change: TraceChange | null;
  stripeSubscriptions: TraceStripeSubscription[];
  stripeEvents: TraceStripeEvent[];
  stripeInvoices: TraceStripeInvoice[];
  fiscalDocuments: TraceFiscalDocument[];
  ownInvoices: TraceOwnInvoice[];
  mails: TraceMail[];
  /** null: no se pueden leer en este entorno. */
  grants: CapabilityGrant[] | null;
  subscription: { id: number; status: string; tenantId: string | null } | null;
  trial: { id: number; state: string; tenantId: string | null; convertedSubscriptionId: number | null; updatedAt: number | null } | null;
  previousOrder: Pick<CommercialOrder, "id" | "tenantId"> | null;
  /** Tenant de la empresa en el CRM (undefined: no se pudo leer). */
  companyTenant: string | null | undefined;
}

// ── Utilidades ────────────────────────────────────────────────────────────────

/** `in_1AbCdEf…` → `in_…cdef`. */
export const abbr = (id: string | null | undefined) => {
  if (!id) return "—";
  const p = id.indexOf("_");
  return id.length <= 8 ? id : `${p > 0 && p < 8 ? id.slice(0, p + 1) : ""}…${id.slice(-4)}`;
};
/** Abrevia ids de Stripe y oculta cualquier secuencia que pudiera ser un número de tarjeta. */
export const sanitize = (s: string) =>
  s
    .replace(/\b(?:in|cs|sub|ch|pi|py|cus|evt|seti|pm|card|src|tok|ii|si|price|prod|re|dp)_[A-Za-z0-9_]{6,}\b/g, (m) => abbr(m))
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[oculto]");
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2).replace(".", ",")} ${currency.toUpperCase()}`;
const dur = (ms: number) => (ms < MIN ? "menos de 1 min" : ms < 120 * MIN ? `${Math.round(ms / MIN)} min` : `${Math.round(ms / (60 * MIN))} h`);
const KIND_LABEL: Record<CommercialOrder["kind"], string> = { new: "alta nueva", trial_conversion: "conversión de prueba", change: "compra de módulo o ampliación" };
const STATUS_LABEL: Record<TraceStepStatus, string> = { ok: "Correcto", pending: "Pendiente", failed: "Fallo", not_applicable: "No aplica" };
const LIVE_STATES: ReadonlySet<string> = new Set(["active", "past_due", "suspended", "cancel_scheduled"]);
const mailLabel = (st: string) => (st === "pending" || st === "sending" ? "encolado" : st === "accepted" || st === "delivered" ? "enviado" : st === "skipped" ? "omitido" : `fallido (${st})`);

/** Primer cobro verificado de la venta (alta o cambio; nunca una renovación). */
export const salePayment = (payments: readonly OrderPayment[]) =>
  payments.filter((p) => p.status === "succeeded" && p.purpose !== "renewal").sort((a, b) => (a.settledAt ?? a.createdAt) - (b.settledAt ?? b.createdAt))[0] ?? null;

// ── Construcción (pura) ───────────────────────────────────────────────────────

export function buildSaleTrace(d: SaleTraceData, now: number): SaleTrace {
  const T = SALE_TRACE_THRESHOLDS;
  const o = d.order;
  const incidents: string[] = [];
  const pay = salePayment(d.payments);
  const stripePay = !!pay && isStripeProvider(pay.provider);
  const firstTo = (s: string) => d.events.find((e) => e.toState === s)?.createdAt ?? null;
  const activeAt = firstTo("active");
  const licensedAt = firstTo("licensed") ?? activeAt;

  // Momento del pago en Stripe: el evento de Stripe del cobro (factura pagada o Checkout completado) o, si no consta, el registro
  const payEvent = pay
    ? d.stripeEvents
        .filter((e) => (e.objectId === pay.providerRef && e.type === "invoice.paid") || (e.type === "checkout.session.completed" && d.sessions.some((s) => s.id === e.objectId)))
        .sort((a, b) => a.stripeCreated - b.stripeCreated)[0] ?? null
    : null;
  const completed = d.sessions.find((s) => s.status === "complete") ?? null;
  const paidAt = pay ? Math.min(pay.settledAt ?? pay.createdAt, payEvent ? payEvent.stripeCreated * 1000 : Infinity) : null;
  const since = (t: number | null) => (t === null ? 0 : now - t);

  // 1. Pago
  const payment = ((): TraceStep => {
    const base = { id: "payment" as const, title: "Pago confirmado en Stripe" };
    if (pay) {
      const parts = [`Cobro verificado de ${money(pay.amountCents, pay.currency)} (${pay.purpose === "change" ? "prorrateo de la compra" : "primer periodo"})`];
      if (stripePay) parts.push(`factura ${abbr(pay.providerRef)}`);
      else parts.push(`proveedor ${pay.provider}`);
      if (completed) parts.push(`Checkout completado${completed.paymentStatus ? ` (${completed.paymentStatus})` : ""}`);
      if (d.change) parts.push(`cambio de partidas ${d.change.status === "applied" ? "aplicado" : d.change.status}`);
      if (pay.mode === "test") parts.push("modo de pruebas");
      return { ...base, status: "ok", at: paidAt, detail: parts.join(" · ") };
    }
    const failed = d.payments.find((p) => p.status === "failed" && p.purpose !== "renewal");
    if (failed) return { ...base, status: "failed", at: failed.settledAt, detail: `Cobro rechazado (${money(failed.amountCents, failed.currency)})` };
    if (o.confirmation?.kind === "admin_approval") return { ...base, status: "not_applicable", at: o.confirmation.at, detail: `Activación por aprobación administrativa${o.confirmation.category ? ` (${o.confirmation.category})` : ""}: sin cobro en Stripe` };
    if (o.confirmation?.kind === "inherited") return { ...base, status: "not_applicable", at: o.confirmation.at, detail: "Cambio sin importe a pagar: hereda la base del pedido anterior" };
    if (completed) {
      if (since(completed.completedAt) > T.webhookMs) incidents.push(`Checkout completado hace ${dur(since(completed.completedAt))} y el cobro aún no consta en el pedido`);
      return { ...base, status: "pending", at: completed.completedAt, detail: "Checkout completado en Stripe; falta registrar el cobro verificado (procesado del webhook)" };
    }
    if (d.change && (d.change.status === "expired" || d.change.status === "failed")) return { ...base, status: "failed", at: d.change.updatedAt, detail: `El cambio de partidas ${d.change.status === "expired" ? "caducó sin cobro" : "falló"} en Stripe` };
    if (d.change?.status === "pending") return { ...base, status: "pending", at: null, detail: "Cobro del prorrateo pendiente en Stripe (autenticación o reintento)" };
    if (o.state === "rejected" || o.state === "cancelled") return { ...base, status: "failed", at: o.updatedAt, detail: `Pedido ${o.state === "rejected" ? "rechazado" : "cancelado"} sin cobro` };
    if (d.sessions.some((s) => s.status === "open")) return { ...base, status: "pending", at: null, detail: "Pago pendiente en la página de Checkout" };
    if (d.sessions.length) return { ...base, status: "pending", at: null, detail: "Sesiones de Checkout caducadas sin pago" };
    return { ...base, status: "pending", at: null, detail: "Sin cobro todavía" };
  })();

  // 2. Webhook
  const webhook = ((): TraceStep => {
    const base = { id: "webhook" as const, title: "Webhook recibido y procesado" };
    if (pay && !stripePay) return { ...base, status: "not_applicable", at: null, detail: `Pago sin Stripe (${pay.provider})` };
    if (!pay && !d.sessions.length && !d.change) return { ...base, status: payment.status === "not_applicable" ? "not_applicable" : "pending", at: null, detail: payment.status === "not_applicable" ? "Sin cobro en Stripe" : "Sin objetos de Stripe todavía" };
    const evs = d.stripeEvents;
    if (!evs.length) {
      if (pay) return { ...base, status: "ok", at: pay.settledAt, detail: "Cobro registrado; el registro de eventos ya no conserva sus eventos (depuración periódica)" };
      return { ...base, status: "pending", at: null, detail: "Ningún evento de Stripe recibido todavía" };
    }
    const count = (s: TraceStripeEvent["status"]) => evs.filter((e) => e.status === s).length;
    const finalFail = evs.filter((e) => e.status === "failed" && e.nextAttemptAt === null);
    const retrying = evs.filter((e) => e.status === "failed" && e.nextAttemptAt !== null);
    const waiting = evs.filter((e) => e.status === "received" || e.status === "processing");
    const done = evs.filter((e) => e.status === "processed" || e.status === "ignored");
    const reconciled = evs.filter((e) => e.source === "reconcile").length;
    const parts = [`${evs.length} eventos (${Array.from(new Set(evs.map((e) => e.type))).slice(0, 6).join(", ")})`, `${done.length} procesados`];
    if (retrying.length || finalFail.length) parts.push(`${retrying.length + finalFail.length} fallidos`);
    if (waiting.length) parts.push(`${count("received") + count("processing")} en cola`);
    if (reconciled) parts.push(`${reconciled} recuperados por la conciliación`);
    const lastErr = [...finalFail, ...retrying].sort((a, b) => b.receivedAt - a.receivedAt)[0];
    if (lastErr) parts.push(`último error: «${(lastErr.lastError ?? "sin detalle").slice(0, 160)}» tras ${lastErr.attempts} intentos`);
    const key = payEvent ?? done.sort((a, b) => a.stripeCreated - b.stripeCreated)[0] ?? null;
    if (finalFail.length) {
      incidents.push(`Webhook: ${finalFail.length} eventos de Stripe fallidos sin más reintentos (${finalFail.map((e) => e.type).join(", ")})`);
      return { ...base, status: "failed", at: null, detail: parts.join(" · ") };
    }
    const ref = paidAt ?? (completed?.completedAt ?? null);
    if (retrying.length || waiting.length) {
      if (ref !== null && now - ref > T.webhookMs) incidents.push(`Webhook: eventos sin procesar ${dur(now - ref)} después del pago (umbral ${T.webhookMs / MIN} min)`);
      return { ...base, status: "pending", at: null, detail: parts.join(" · ") };
    }
    const at = key?.processedAt ?? null;
    if (key && at !== null) {
      const lag = at - key.stripeCreated * 1000;
      parts.push(`procesado ${dur(Math.max(0, lag))} después del pago`);
      if (lag > T.webhookMs) incidents.push(`Webhook procesado con retraso: ${dur(lag)} después del pago (umbral ${T.webhookMs / MIN} min)`);
    }
    if (!pay) return { ...base, status: "pending", at, detail: parts.join(" · ") };
    return { ...base, status: "ok", at, detail: parts.join(" · ") };
  })();

  // 3. Suscripción
  const stripeSub = d.change ? (d.stripeSubscriptions.find((s) => s.id === d.change!.stripeSubscriptionId) ?? null) : (d.stripeSubscriptions.filter((s) => s.orderId === o.id).sort((a, b) => b.syncedAt - a.syncedAt)[0] ?? null);
  const subscription = ((): TraceStep => {
    const base = { id: "subscription" as const, title: "Suscripción activa" };
    const parts = [`Pedido ${o.reference ?? `#${o.id}`} en «${o.state}»`];
    if (d.subscription) parts.push(`suscripción interna #${d.subscription.id} ${d.subscription.status}`);
    if (stripeSub) parts.push(`Stripe ${abbr(stripeSub.id)} ${stripeSub.status}`);
    parts.push(`empresa #${o.companyId}${o.tenantId ? ` · tenant ${o.tenantId}` : ""}`);
    if (stripeSub && stripeSub.companyId !== o.companyId) {
      incidents.push("La suscripción de Stripe no está enlazada a la empresa del pedido");
      return { ...base, status: "failed", at: null, detail: `${parts.join(" · ")} · la suscripción de Stripe es de otra empresa (#${stripeSub.companyId})` };
    }
    if (stripeSub?.tenantId && o.tenantId && stripeSub.tenantId !== o.tenantId) {
      incidents.push("La suscripción de Stripe apunta a otro tenant");
      return { ...base, status: "failed", at: null, detail: `${parts.join(" · ")} · tenant distinto en Stripe` };
    }
    if (activeAt !== null) {
      if (stripeSub && LIVE_STATES.has(o.state) && o.state !== "suspended" && ["canceled", "incomplete_expired", "unpaid"].includes(stripeSub.status)) {
        incidents.push(`Pedido ${o.state} con la suscripción de Stripe ${stripeSub.status}`);
        return { ...base, status: "failed", at: activeAt, detail: parts.join(" · ") };
      }
      if (paidAt !== null && activeAt - paidAt > T.activationMs) parts.push(`activado ${dur(activeAt - paidAt)} después del pago`);
      return { ...base, status: "ok", at: activeAt, detail: parts.join(" · ") };
    }
    if (o.state === "rejected" || o.state === "cancelled") return { ...base, status: "failed", at: null, detail: `${parts.join(" · ")}${o.lastError ? ` · ${o.lastError.slice(0, 160)}` : ""}` };
    if (paidAt !== null && now - paidAt > T.activationMs) {
      incidents.push(`Suscripción sin activar ${dur(now - paidAt)} después del pago (umbral ${T.activationMs / MIN} min)${o.lastError ? `: ${o.lastError.slice(0, 160)}` : ""}`);
      return { ...base, status: "failed", at: null, detail: `${parts.join(" · ")}${o.lastError ? ` · último error: ${o.lastError.slice(0, 160)}` : ""}` };
    }
    return { ...base, status: "pending", at: null, detail: parts.join(" · ") };
  })();

  // 4. Licencias
  const licences = ((): TraceStep => {
    const base = { id: "licences" as const, title: "Licencias aplicadas" };
    const expected = Array.from(new Set(o.quote?.capabilities ?? []));
    const late = paidAt !== null && now - paidAt > T.activationMs;
    const lateMsg = (what: string) => incidents.push(`Licencias: ${what} ${dur(now - (paidAt ?? now))} después del pago (umbral ${T.activationMs / MIN} min)`);
    if (d.grants === null) return { ...base, status: "pending", at: licensedAt, detail: "Las licencias no se pueden leer en este entorno" };
    if (!o.tenantId) {
      if (late) lateMsg("el pedido aún no tiene plataforma");
      return { ...base, status: late ? "failed" : "pending", at: null, detail: "El pedido aún no tiene plataforma asignada" };
    }
    const active = d.grants.filter((g) => g.status === "active");
    const missing = expected.filter((c) => !active.some((g) => g.capabilityId === c));
    const own = `subscription:${o.subscriptionId}`;
    const sources = Array.from(new Set(active.filter((g) => expected.includes(g.capabilityId)).map((g) => g.source)));
    const foreign = sources.filter((s) => s !== own);
    const parts = [`${expected.length - missing.length} de ${expected.length} capacidades del presupuesto activas`, `origen: ${sources.length ? sources.join(", ") : "—"}`];
    if (foreign.length) parts.push(`concedidas también por otro origen (${foreign.join(", ")})`);
    if (missing.length) parts.push(`faltan: ${missing.slice(0, 12).join(", ")}`);
    if (licensedAt !== null && !missing.length) return { ...base, status: "ok", at: licensedAt, detail: expected.length ? parts.join(" · ") : "El pedido no concede capacidades nuevas" };
    if (licensedAt !== null) {
      incidents.push(`Licencias: faltan ${missing.length} capacidades activas tras licenciar (${missing.slice(0, 6).join(", ")})`);
      return { ...base, status: "failed", at: licensedAt, detail: parts.join(" · ") };
    }
    if (late) {
      lateMsg("sin aplicar");
      return { ...base, status: "failed", at: null, detail: parts.join(" · ") };
    }
    return { ...base, status: "pending", at: null, detail: parts.join(" · ") };
  })();

  // 5. Datos conservados
  const data = ((): TraceStep => {
    const base = { id: "data" as const, title: "Datos conservados" };
    if (o.kind === "new") return { ...base, status: "not_applicable", at: null, detail: "Alta nueva: no había prueba previa (la plataforma se crea en el alta)" };
    if (o.kind === "change") {
      if (!d.previousOrder) return { ...base, status: "pending", at: null, detail: "No se encuentra el pedido anterior" };
      if (d.previousOrder.tenantId && o.tenantId && d.previousOrder.tenantId !== o.tenantId) {
        incidents.push("Compra de módulo sobre un tenant distinto del de la suscripción");
        return { ...base, status: "failed", at: null, detail: `Tenant distinto del pedido anterior #${d.previousOrder.id}` };
      }
      return { ...base, status: "ok", at: activeAt, detail: `Mismo tenant${o.tenantId ? ` (${o.tenantId})` : ""}: compra sobre la plataforma existente` };
    }
    const t = d.trial;
    if (!t) return { ...base, status: "pending", at: null, detail: "No se puede leer la prueba del pedido" };
    const parts = [`Prueba #${t.id} en «${t.state}»`, `tenant de la prueba ${t.tenantId ?? "—"}`, `tenant del pedido ${o.tenantId ?? "—"}`];
    if (t.tenantId && o.tenantId && t.tenantId !== o.tenantId) {
      incidents.push("Conversión de prueba: el pedido no usa el tenant de la prueba");
      return { ...base, status: "failed", at: null, detail: parts.join(" · ") };
    }
    if (d.companyTenant !== undefined && d.companyTenant !== null && t.tenantId && d.companyTenant !== t.tenantId) {
      incidents.push("Conversión de prueba: la empresa tiene otra plataforma distinta de la de la prueba");
      return { ...base, status: "failed", at: null, detail: `${parts.join(" · ")} · la empresa apunta a ${d.companyTenant}` };
    }
    if (d.companyTenant !== undefined) parts.push(d.companyTenant === t.tenantId ? "sin otra plataforma aprovisionada" : "la empresa aún no tiene tenant asociado");
    if (t.state === "converted") {
      if (t.convertedSubscriptionId !== null && o.subscriptionId !== null && t.convertedSubscriptionId !== o.subscriptionId) {
        incidents.push("Conversión de prueba: la prueba consta convertida en otra suscripción");
        return { ...base, status: "failed", at: t.updatedAt, detail: `${parts.join(" · ")} · convertida en la suscripción #${t.convertedSubscriptionId}` };
      }
      return { ...base, status: "ok", at: t.updatedAt, detail: `${parts.join(" · ")} · misma empresa y misma plataforma` };
    }
    if (activeAt !== null && now - activeAt > T.activationMs) {
      incidents.push("Conversión de prueba: el pedido está activo y la prueba no consta como convertida");
      return { ...base, status: "failed", at: null, detail: parts.join(" · ") };
    }
    return { ...base, status: "pending", at: null, detail: `${parts.join(" · ")} · la prueba se marca convertida al activar el pedido` };
  })();

  // 6. Factura
  const invoice = ((): TraceStep => {
    const base = { id: "invoice" as const, title: "Factura emitida" };
    const notes: string[] = [];
    const ids = pay?.providerRef ? [pay.providerRef] : [];
    const own = d.ownInvoices.filter((i) => i.billingRef === `order:${o.id}` || (i.paymentRef !== null && ids.some((x) => i.paymentRef === `stripe:in:${x}`)));
    const issued = own.find((i) => (i.status === "issued" || i.status === "rectified") && i.number);
    const docs = d.fiscalDocuments.filter((f) => f.kind === "invoice" && (!ids.length || ids.includes(f.stripeInvoiceId)));
    const doc = docs.find((f) => f.status === "issued" && f.externalRef) ?? docs.find((f) => f.status === "failed") ?? docs[0] ?? null;
    const mailOf = (key: string) => d.mails.find((m) => m.key === key) ?? null;
    if (d.stripeInvoices.some((i) => ids.includes(i.id))) notes.push("copia de la factura de Stripe registrada");
    if (pay) {
      const notice = mailOf(`order:${o.id}:invoice_available:p${pay.id}`);
      notes.push(`aviso «factura disponible» al cliente: ${notice ? mailLabel(notice.status) : "no consta"}`);
    }
    if (issued) {
      const sent = mailOf(`invoicing:invoice:${issued.id}:${issued.number}`);
      return { ...base, status: "ok", at: issued.issuedAt, detail: [`Factura ${issued.number} expedida`, `envío: ${sent ? mailLabel(sent.status) : "no consta"}`, ...notes].join(" · ") };
    }
    if (doc?.status === "issued") return { ...base, status: "ok", at: doc.issuedAt, detail: [`Documento fiscal ${doc.externalRef} emitido`, ...notes].join(" · ") };
    if (!pay) {
      if (o.confirmation?.kind === "admin_approval" && o.confirmation.category !== "offline_payment") return { ...base, status: "not_applicable", at: null, detail: "Sin cobro: no hay factura que emitir" };
      return { ...base, status: "pending", at: null, detail: own.length ? `Borrador #${own[0].id} a la espera del cobro` : "A la espera del cobro" };
    }
    if (doc?.status === "failed") {
      incidents.push(`Factura: el documento fiscal #${doc.id} falló${doc.lastError ? ` (${doc.lastError.slice(0, 120)})` : ""}`);
      return { ...base, status: "failed", at: null, detail: [`Documento fiscal #${doc.id} fallido${doc.lastError ? `: ${doc.lastError.slice(0, 160)}` : ""}`, ...notes].join(" · ") };
    }
    if (doc) notes.unshift(`documento fiscal #${doc.id} en cola (pendiente de número)`);
    if (own.length) notes.unshift(`borrador propio #${own[0].id} sin expedir`);
    notes.push("sin proforma: el primer cobro es inmediato (la proforma de 5 días solo precede a las mensualidades programadas)");
    const ref = paidAt ?? pay.settledAt ?? pay.createdAt;
    if (now - ref > T.invoiceMs) {
      incidents.push(`Factura sin emitir ${dur(now - ref)} después del cobro (plazo ${T.invoiceMs / (60 * MIN)} h)`);
      return { ...base, status: "failed", at: null, detail: [`Sin factura con número ${dur(now - ref)} después del cobro`, ...notes].join(" · ") };
    }
    return { ...base, status: "pending", at: null, detail: [`Dentro del plazo (${T.invoiceMs / (60 * MIN)} h tras el cobro)`, ...notes].join(" · ") };
  })();

  const steps = [payment, webhook, subscription, licences, data, invoice].map((s) => ({ ...s, detail: sanitize(s.detail) }));
  const status = steps.some((s) => s.status === "failed") || incidents.length ? "failed" : steps.every((s) => s.status === "ok" || s.status === "not_applicable") ? "ok" : "in_progress";
  return {
    orderId: o.id,
    reference: o.reference,
    kind: o.kind,
    state: o.state,
    companyId: o.companyId,
    tenantId: o.tenantId,
    mode: pay?.mode ?? null,
    amount: pay ? { cents: pay.amountCents, currency: pay.currency.toUpperCase() } : null,
    paidAt,
    status,
    steps,
    incidents: Array.from(new Set(incidents.map(sanitize))),
    evaluatedAt: now,
    thresholds: { webhookMinutes: T.webhookMs / MIN, activationMinutes: T.activationMs / MIN, invoiceHours: T.invoiceMs / (60 * MIN) },
  };
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export interface SaleTraceDeps {
  orders: Pick<OrderStore, "get" | "events" | "payments">;
  reader: SaleTraceReader;
  /** Modo de cobro del entorno (el listado muestra solo las ventas de ese modo salvo que se pida otro). */
  mode: PaymentMode;
  capabilities?: { list(tenantId: string): Promise<CapabilityGrant[]> } | null;
  subscriptions?: { get(id: number): Promise<{ id: number; status: string; tenantId: string | null } | null> } | null;
  trials?: { get(id: number): Promise<{ id: number; state: string; tenantId: string | null; convertedSubscriptionId: number | null; updatedAt: number | null } | null> } | null;
  companyTenant?: ((companyId: number) => Promise<string | null>) | null;
  /** Nombre del tenant en el registro (para reconocer las empresas internas de pruebas). */
  tenantName?: ((tenantId: string) => Promise<string | null>) | null;
  /** Empresas internas de pruebas configuradas (además del patrón de nombres de prueba). */
  internalTenants?: ReadonlySet<string>;
  now?: () => number;
}

export interface SaleSummary {
  orderId: number;
  reference: string | null;
  kind: CommercialOrder["kind"];
  state: CommercialOrder["state"];
  companyId: number;
  tenantId: string | null;
  paidAt: number;
  amount: SaleTrace["amount"];
  status: SaleTrace["status"];
  steps: Array<{ id: TraceStepId; status: TraceStepStatus }>;
  incidents: string[];
}

export class SaleTraceService {
  private now: () => number;
  constructor(private d: SaleTraceDeps) {
    this.now = d.now ?? Date.now;
  }

  get mode(): PaymentMode {
    return this.d.mode;
  }

  /** Lee todo lo necesario para la traza de un pedido; null si no existe. */
  async load(orderId: number): Promise<SaleTraceData | null> {
    const order = await this.d.orders.get(orderId);
    if (!order) return null;
    const r = this.d.reader;
    const [events, payments, sessions, change] = await Promise.all([this.d.orders.events(order.id), this.d.orders.payments(order.id), r.sessions(order.id), r.change(order.id)]);
    const stripeInvoices = await r.stripeInvoices(order.id);
    const pay = salePayment(payments);
    const invoiceIds = Array.from(new Set([...(pay?.providerRef && isStripeProvider(pay.provider) ? [pay.providerRef] : []), ...(change?.stripeInvoiceId ? [change.stripeInvoiceId] : []), ...stripeInvoices.filter((i) => i.purpose !== "renewal").map((i) => i.id)]));
    const stripeSubscriptions = await r.stripeSubscriptions(order.id, change ? [change.stripeSubscriptionId] : []);
    const subIds = change ? [change.stripeSubscriptionId] : stripeSubscriptions.filter((s) => s.orderId === order.id).map((s) => s.id);
    // Eventos del alta: de la creación del pedido a un día después del cobro (las renovaciones posteriores no cuentan)
    const until = (pay?.settledAt ?? this.now()) + 24 * 60 * MIN;
    const stripeEvents = (await r.stripeEvents([...sessions.map((s) => s.id), ...subIds, ...invoiceIds])).filter((e) => e.stripeCreated * 1000 >= order.createdAt - MIN && e.stripeCreated * 1000 <= until);
    const fiscalDocuments = await r.fiscalDocuments(order.id);
    const ownInvoices = await r.ownInvoices({ orderId: order.id, companyId: order.companyId, stripeInvoiceIds: pay?.providerRef ? [pay.providerRef] : [] });
    const issued = ownInvoices.filter((i) => i.number);
    const mails = await r.mails(order.tenantId, [...(pay ? [`order:${order.id}:invoice_available:p${pay.id}`] : []), ...issued.map((i) => `invoicing:invoice:${i.id}:${i.number}`)]);
    const grants = this.d.capabilities && order.tenantId ? await this.d.capabilities.list(order.tenantId) : this.d.capabilities ? [] : null;
    const subscription = order.subscriptionId && this.d.subscriptions ? await this.d.subscriptions.get(order.subscriptionId) : null;
    const trialRow = order.trialId && this.d.trials ? await this.d.trials.get(order.trialId) : null;
    const prev = order.previousOrderId ? await this.d.orders.get(order.previousOrderId) : null;
    const companyTenant = this.d.companyTenant ? await this.d.companyTenant(order.companyId).catch(() => undefined) : undefined;
    return {
      order,
      events,
      payments,
      sessions,
      change,
      stripeSubscriptions,
      stripeEvents,
      stripeInvoices,
      fiscalDocuments,
      ownInvoices,
      mails,
      grants,
      subscription: subscription ? { id: subscription.id, status: subscription.status, tenantId: subscription.tenantId } : null,
      trial: trialRow ? { id: trialRow.id, state: trialRow.state, tenantId: trialRow.tenantId, convertedSubscriptionId: trialRow.convertedSubscriptionId, updatedAt: trialRow.updatedAt } : null,
      previousOrder: prev ? { id: prev.id, tenantId: prev.tenantId } : null,
      companyTenant,
    };
  }

  async trace(orderId: number): Promise<SaleTrace | null> {
    const data = await this.load(orderId);
    return data ? buildSaleTrace(data, this.now()) : null;
  }

  /** ¿Empresa interna de pruebas? (patrón de nombres de prueba o lista configurada). */
  async internal(tenantId: string | null): Promise<boolean> {
    if (!tenantId) return false;
    if (this.d.internalTenants?.has(tenantId)) return true;
    const name = this.d.tenantName ? await this.d.tenantName(tenantId).catch(() => null) : null;
    return isTestTenant(tenantId, name);
  }

  /** Altas de pago (primer cobro de un alta o de una compra) desde `since`, sin las empresas internas de pruebas. */
  async recentPaid(since: number, mode: PaymentMode = this.d.mode): Promise<Array<{ order: CommercialOrder; paidAt: number }>> {
    const out: Array<{ order: CommercialOrder; paidAt: number }> = [];
    for (const s of await this.d.reader.recentSales(since, mode)) {
      const order = await this.d.orders.get(s.orderId);
      if (!order || (await this.internal(order.tenantId))) continue;
      out.push({ order, paidAt: s.paidAt });
    }
    return out;
  }

  /** Listado de las altas de pago de los últimos `days` días con su traza resumida. */
  async recent(days: number, mode: PaymentMode = this.d.mode): Promise<SaleSummary[]> {
    const out: SaleSummary[] = [];
    for (const s of await this.recentPaid(this.now() - days * 24 * 60 * MIN, mode)) {
      const t = await this.trace(s.order.id);
      if (!t) continue;
      out.push({ orderId: t.orderId, reference: t.reference, kind: t.kind, state: t.state, companyId: t.companyId, tenantId: t.tenantId, paidAt: t.paidAt ?? s.paidAt, amount: t.amount, status: t.status, steps: t.steps.map((x) => ({ id: x.id, status: x.status })), incidents: t.incidents });
    }
    return out;
  }
}

// ── Alerta ────────────────────────────────────────────────────────────────────

/** Fase más reciente ya vencida para un cobro (null: ninguna). */
export function duePhase(paidAt: number, now: number): SaleTracePhase | null {
  let due: SaleTracePhase | null = null;
  for (const p of SALE_TRACE_PHASES) if (now >= paidAt + p.afterMs) due = p;
  return due;
}

export const saleTraceKey = (orderId: number, phase: SaleTracePhase["id"]) => `sale-trace:${orderId}:${phase}`;

/** Hechos de la alerta de traza de un alta (puro). */
export function saleTraceAlertFacts(t: SaleTrace, phase: SaleTracePhase, company: string | null): AlertFacts {
  const applicable = t.steps.filter((s) => s.status !== "not_applicable");
  const ok = applicable.filter((s) => s.status === "ok").length;
  const problems = t.incidents.length > 0 || t.steps.some((s) => s.status === "failed");
  return {
    key: saleTraceKey(t.orderId, phase.id),
    occurredAt: t.evaluatedAt,
    tenantId: t.tenantId,
    companyId: t.companyId,
    company,
    summary: `Traza del alta de pago (${KIND_LABEL[t.kind]}${t.mode === "test" ? ", modo de pruebas" : ""}), ${phase.label}: ${ok} de ${applicable.length} pasos completados${problems ? `; ${t.incidents.length || "hay"} incidencias` : t.status === "ok" ? "; todo correcto" : "; el resto sigue en plazo"}.`,
    status: problems ? { label: "Con incidencias", tone: "error" } : t.status === "ok" ? { label: "Todo correcto", tone: "success" } : { label: "En curso", tone: "info" },
    amount: t.amount,
    reference: t.reference,
    details: [
      ...t.steps.map((s) => ({ label: s.title, value: `${STATUS_LABEL[s.status]} · ${s.detail}`.slice(0, 400) })),
      ...t.incidents.slice(0, 8).map((x, i) => ({ label: `Incidencia ${i + 1}`, value: x.slice(0, 300) })),
      { label: "Traza completa", value: `GET /cp/v1/orders/${t.orderId}/trace` },
    ],
    link: `#/comercial/contrataciones/${t.orderId}`,
    intervention: problems,
    severity: problems ? "important" : "info",
  };
}

/**
 * Vigilancia de las altas de pago (ciclo de alertas administrativas): por cada primer cobro de un alta o compra
 * (sin empresas internas de pruebas) evalúa la traza al detectarlo, a los 20 minutos y a las 48 horas, y lanza
 * `admin.sale_trace` una vez por pedido y fase (clave `sale-trace:<pedido>:<fase>`). Si una fase se detecta tarde, solo
 * se avisa de la más reciente. Al activarse por primera vez empieza en ese instante: nunca avisa de cobros anteriores.
 */
export class SaleTraceWatcher {
  constructor(
    private d: {
      traces: Pick<SaleTraceService, "recentPaid" | "trace">;
      store: Pick<AdminAlertStore, "getState" | "setState" | "list">;
      raise: (alertId: string, f: AlertFacts) => Promise<unknown>;
      companyName?: (companyId: number) => Promise<string | null>;
      now?: () => number;
    },
  ) {}

  async tick(): Promise<number> {
    const now = (this.d.now ?? Date.now)();
    const since = await this.d.store.getState(STATE_SINCE);
    if (since === null) {
      await this.d.store.setState(STATE_SINCE, now, now);
      return 0;
    }
    const sales = await this.d.traces.recentPaid(Math.max(since, now - WATCH_LOOKBACK_MS));
    if (!sales.length) return 0;
    const done = new Set((await this.d.store.list({ alertId: SALE_TRACE_ALERT, limit: 200 })).map((r) => r.eventKey));
    let raised = 0;
    for (const s of sales) {
      const phase = duePhase(s.paidAt, now);
      if (!phase || done.has(saleTraceKey(s.order.id, phase.id))) continue;
      const t = await this.d.traces.trace(s.order.id);
      if (!t) continue;
      const company = this.d.companyName ? await this.d.companyName(t.companyId).catch(() => null) : null;
      await this.d.raise(SALE_TRACE_ALERT, saleTraceAlertFacts(t, phase, company));
      raised++;
    }
    return raised;
  }
}
