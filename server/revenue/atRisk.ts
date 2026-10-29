/**
 * Bandeja «Cobros en riesgo» del Control Center: suscripciones SaaS con el cobro fallido (pedido en `past_due`, dentro
 * de la gracia, o `suspended`, gracia agotada) y servicios externos con pago pendiente.
 *
 * Por cada caso: empresa, importe pendiente, motivo del fallo, próximo reintento automático, gracia y el historial
 * de eventos comerciales. Acciones de recuperación (nunca envían comunicaciones al cliente):
 *  - sincronizar: relee la suscripción en Stripe y aplica su estado (idempotente; el mismo camino que el webhook);
 *  - reintentar: cobra la factura abierta con el método por defecto. En modo live solo si el entorno lo autoriza
 *    (CP_RECOVERY_LIVE_RETRY=1); con la misma clave de idempotencia por intento, repetirlo no cobra dos veces;
 *  - portal: enlace temporal al portal de pago del cliente para que el operador se lo haga llegar.
 */
import type { CommercialOrder } from "../orchestrator/types";
import type { CommercialEvent } from "../commercialEvents/types";
import type { StripeInvoiceRecord } from "../stripe/fiscalDocuments";
import type { GwInvoice, GwPaymentFailure, GwSubscription } from "../stripe/gateway";

export interface AtRiskDeps {
  orders(): Promise<CommercialOrder[]>;
  company(id: number): Promise<{ id: number; name: string; tenantId?: string | null } | null>;
  invoices?(orderId: number): Promise<StripeInvoiceRecord[]>;
  events?(orderId: number): Promise<CommercialEvent[]>;
  stripe?: {
    mode: "test" | "live";
    liveRetryAllowed: boolean;
    invoice(id: string): Promise<GwInvoice | null>;
    failure?(invoiceId: string): Promise<GwPaymentFailure | null>;
    pay?(invoiceId: string, idempotencyKey: string): Promise<GwInvoice>;
    subscriptionOf(companyId: number): Promise<GwSubscription | null>;
    settle(sub: GwSubscription): Promise<string>;
    portal?(companyId: number): Promise<{ url: string } | null>;
  };
  /** Servicios externos con pago pendiente (de las métricas de ingresos). */
  external?(): Promise<Array<{ externalId: number; companyId: number; serviceName: string; amountDueCents: number | null; graceUntil: number | null; overdue: boolean }>>;
  now?: () => number;
}

export interface AtRiskCase {
  kind: "subscription" | "external";
  orderId: number | null;
  externalId: number | null;
  company: { id: number; name: string; tenantId: string | null };
  state: string;
  amountDueCents: number | null;
  currency: string;
  reason: string | null;
  attempts: number | null;
  nextAttemptAt: number | null;
  grace: { endsAt: number | null; expired: boolean; daysLeft: number | null };
  invoice: { id: string; number: string | null; hostedUrl: string | null } | null;
  events: Array<{ at: number; type: string; from: string | null; to: string | null; actor: string }>;
  actions: { sync: boolean; retry: boolean; portal: boolean };
}

export class AtRiskError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_state" | "forbidden" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;
const AT_RISK: CommercialOrder["state"][] = ["past_due", "suspended"];

/** Motivo legible del rechazo (códigos de Stripe más habituales). */
export function failureText(f: GwPaymentFailure | null): string | null {
  if (!f) return null;
  const known: Record<string, string> = {
    insufficient_funds: "Fondos insuficientes",
    expired_card: "Tarjeta caducada",
    card_declined: "Tarjeta rechazada por el banco",
    authentication_required: "El banco exige autenticación del titular",
    incorrect_cvc: "CVC incorrecto",
    lost_card: "Tarjeta denunciada como perdida",
    stolen_card: "Tarjeta denunciada como robada",
    do_not_honor: "El banco no autoriza el cargo",
    processing_error: "Error del procesador de pagos",
  };
  return known[f.declineCode ?? ""] ?? known[f.code ?? ""] ?? f.message ?? f.code ?? null;
}

export class AtRiskService {
  private now: () => number;
  constructor(private d: AtRiskDeps) {
    this.now = d.now ?? Date.now;
  }

  private async order(orderId: number) {
    const o = (await this.d.orders()).find((x) => x.id === orderId);
    if (!o || !AT_RISK.includes(o.state)) throw new AtRiskError("not_found", "El pedido no tiene un cobro en riesgo");
    return o;
  }

  /** Factura abierta más reciente del pedido (la que hay que cobrar). */
  private async openInvoice(orderId: number) {
    const rows = this.d.invoices ? await this.d.invoices(orderId) : [];
    return rows.filter((r) => r.status === "open").sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  async list(): Promise<{ cases: AtRiskCase[]; totals: { count: number; amountDueCents: number }; stripe: { mode: string | null; liveRetryAllowed: boolean } }> {
    const now = this.now();
    const orders = (await this.d.orders()).filter((o) => AT_RISK.includes(o.state));
    const cases: AtRiskCase[] = [];
    for (const o of orders) {
      const company = await this.d.company(o.companyId);
      const open = await this.openInvoice(o.id);
      const live = open && this.d.stripe ? await this.d.stripe.invoice(open.stripeInvoiceId).catch(() => null) : null;
      const failure = open && this.d.stripe?.failure ? await this.d.stripe.failure(open.stripeInvoiceId).catch(() => null) : null;
      const events = this.d.events ? await this.d.events(o.id).catch(() => []) : [];
      const graceEnd = o.graceEndsAt;
      cases.push({
        kind: "subscription",
        orderId: o.id,
        externalId: null,
        company: { id: o.companyId, name: company?.name ?? `Empresa ${o.companyId}`, tenantId: o.tenantId },
        state: o.state,
        amountDueCents: live?.amountRemaining ?? (open ? open.totalCents - open.amountPaidCents : null),
        currency: (open?.currency ?? o.quote?.currency ?? "EUR").toUpperCase(),
        reason: failureText(failure) ?? (open ? "Cobro de la factura no completado" : null),
        attempts: live?.attemptCount ?? null,
        nextAttemptAt: live?.nextPaymentAttempt ? live.nextPaymentAttempt * 1000 : null,
        grace: { endsAt: graceEnd, expired: graceEnd !== null && graceEnd <= now, daysLeft: graceEnd !== null ? Math.max(0, Math.ceil((graceEnd - now) / DAY)) : null },
        invoice: open ? { id: open.stripeInvoiceId, number: open.number, hostedUrl: live?.hostedInvoiceUrl ?? null } : null,
        events: events
          .sort((a, b) => b.occurredAt - a.occurredAt)
          .slice(0, 20)
          .map((e) => ({ at: e.occurredAt, type: e.type, from: e.fromState, to: e.toState, actor: e.actor })),
        actions: {
          sync: !!this.d.stripe,
          retry: !!open && !!this.d.stripe?.pay && (this.d.stripe.mode === "test" || this.d.stripe.liveRetryAllowed),
          portal: !!this.d.stripe?.portal,
        },
      });
    }
    for (const x of this.d.external ? await this.d.external() : []) {
      const company = await this.d.company(x.companyId);
      cases.push({
        kind: "external",
        orderId: null,
        externalId: x.externalId,
        company: { id: x.companyId, name: company?.name ?? `Empresa ${x.companyId}`, tenantId: company?.tenantId ?? null },
        state: "past_due",
        amountDueCents: x.amountDueCents,
        currency: "EUR",
        reason: `Servicio externo «${x.serviceName}»: cobro pendiente`,
        attempts: null,
        nextAttemptAt: null,
        grace: { endsAt: x.graceUntil, expired: x.overdue, daysLeft: x.graceUntil !== null ? Math.max(0, Math.ceil((x.graceUntil - now) / DAY)) : null },
        invoice: null,
        events: [],
        actions: { sync: false, retry: false, portal: false },
      });
    }
    // Primero lo que vence antes (sin gracia, al final)
    cases.sort((a, b) => (a.grace.endsAt ?? Infinity) - (b.grace.endsAt ?? Infinity));
    return {
      cases,
      totals: { count: cases.length, amountDueCents: cases.reduce((s, c) => s + (c.amountDueCents ?? 0), 0) },
      stripe: { mode: this.d.stripe?.mode ?? null, liveRetryAllowed: !!this.d.stripe?.liveRetryAllowed },
    };
  }

  /** Relee la suscripción en Stripe y aplica su estado (idempotente). */
  async sync(orderId: number): Promise<{ outcome: string }> {
    const o = await this.order(orderId);
    if (!this.d.stripe) throw new AtRiskError("unavailable", "Stripe no está configurado");
    const sub = await this.d.stripe.subscriptionOf(o.companyId);
    if (!sub) throw new AtRiskError("unavailable", "La empresa no tiene una suscripción en Stripe");
    return { outcome: await this.d.stripe.settle(sub) };
  }

  /**
   * Reintento del cobro de la factura abierta. La clave de idempotencia es la factura y su número de intentos: un
   * doble clic o un reintento de red no cobra dos veces. En live, solo con CP_RECOVERY_LIVE_RETRY=1.
   */
  async retry(orderId: number): Promise<{ status: string | null; amountRemaining: number | null }> {
    const o = await this.order(orderId);
    const st = this.d.stripe;
    if (!st?.pay) throw new AtRiskError("unavailable", "Stripe no está configurado");
    if (st.mode === "live" && !st.liveRetryAllowed) throw new AtRiskError("forbidden", "El reintento manual de cobros reales no está autorizado en este entorno (CP_RECOVERY_LIVE_RETRY)");
    const open = await this.openInvoice(o.id);
    if (!open) throw new AtRiskError("invalid_state", "No hay ninguna factura abierta que cobrar");
    const cur = await st.invoice(open.stripeInvoiceId);
    if (!cur || cur.status !== "open") throw new AtRiskError("invalid_state", "La factura ya no está abierta: sincroniza el estado");
    const inv = await st.pay(open.stripeInvoiceId, `recovery:${open.stripeInvoiceId}:${cur.attemptCount ?? 0}`);
    return { status: inv.status, amountRemaining: inv.amountRemaining ?? null };
  }

  /** Enlace temporal al portal de pago del cliente (el operador lo hace llegar; aquí no se envía nada). */
  async portal(orderId: number): Promise<{ url: string }> {
    const o = await this.order(orderId);
    const p = this.d.stripe?.portal ? await this.d.stripe.portal(o.companyId) : null;
    if (!p) throw new AtRiskError("unavailable", "El portal de pago no está disponible para esta empresa");
    return p;
  }
}
