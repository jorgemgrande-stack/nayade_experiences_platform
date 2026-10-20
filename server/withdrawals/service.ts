/**
 * Función de DESISTIMIENTO de consumidores, separada de la cancelación ordinaria de la suscripción.
 *
 *  - Cancelación ordinaria (Customer Portal): la suscripción termina al FINAL del periodo pagado, sin reembolso.
 *    Es para cualquier cliente.
 *  - Desistimiento (esta función): un PARTICULAR deja sin efecto el contrato en los 14 días siguientes a celebrarlo,
 *    con reembolso de lo pagado menos la parte prestada si pidió la ejecución inmediata. Lo pide desde su cuenta
 *    (o por otro canal, y lo registra soporte), recibe un JUSTIFICANTE con referencia, fecha y hora, y una persona
 *    lo resuelve.
 *
 * Sin política jurídica aprobada, esta función NO ejecuta reembolsos ni bajas en Stripe ni cambia la suscripción:
 * registra, evalúa, avisa y guarda la resolución. La ejecución (reembolso y fin del servicio) la hace el equipo a
 * mano y la anota al completar la solicitud (`refundReference`).
 */
import crypto from "node:crypto";
import { opsLog } from "../_core/ops/log";
import type { CommercialEventDraft, CommercialEventSink } from "../commercialEvents/types";
import type { CrmStore } from "../crm/store";
import type { CommercialOrder, OrderPayment } from "../orchestrator/types";
import type { BuyerProfile } from "../stripe/buyerProfile";
import { assessWithdrawal, type WithdrawalAssessment } from "./assessment";
import { OPEN_STATES, WithdrawalConflictError, type WithdrawalRequest, type WithdrawalResolution, type WithdrawalState, type WithdrawalStore } from "./store";

export class WithdrawalError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "not_applicable" | "conflict" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

/** Avisos al consumidor (acuse de recibo y resolución). Sin él, solo queda el justificante en la cuenta. */
export interface WithdrawalNotifier {
  /** `queued`: el aviso entró en la bandeja de salida (con el correo apagado no cuenta como enviado). */
  receipt(to: string, r: WithdrawalRequest): Promise<{ queued: boolean }>;
  resolution(to: string, r: WithdrawalRequest): Promise<{ queued: boolean }>;
}

export interface WithdrawalDeps {
  store: WithdrawalStore;
  crmStore: Pick<CrmStore, "list">;
  orders: { list(f: { companyId: number }): Promise<CommercialOrder[]>; get(id: number): Promise<CommercialOrder | null>; payments(orderId: number): Promise<OrderPayment[]> };
  buyers: { buyerProfile(orderId: number): Promise<BuyerProfile | null> };
  /** Periodo de la suscripción interna (para la parte proporcional). */
  subscriptions?: { get(id: number): Promise<{ currentPeriodStart: number; currentPeriodEnd: number } | null> };
  notify?: WithdrawalNotifier;
  events?: CommercialEventSink;
  now?: () => number;
}

/** Pedidos que mantienen vivo el contrato (también en impago o con la baja programada: se puede desistir). */
const LIVE = ["active", "past_due", "suspended", "cancel_scheduled"];
const TENANT = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 86_400_000;

export interface WithdrawalStatus {
  /** ¿Se ofrece el botón ahora? (particular, contrato de pago, dentro del plazo y sin otra solicitud abierta) */
  available: boolean;
  assessment: Pick<WithdrawalAssessment, "applicability" | "deadlineAt" | "withinTerm" | "extended" | "immediateExecution" | "summary">;
  /** Última solicitud del contrato (si hay), para mostrar su estado y su justificante. */
  request: Pick<WithdrawalRequest, "reference" | "status" | "requestedAt"> | null;
}

/** Transiciones permitidas en la gestión administrativa. */
const ACTIONS: Record<"review" | "accept" | "reject" | "complete", { from: WithdrawalState[]; to: WithdrawalState; note: boolean }> = {
  review: { from: ["received"], to: "under_review", note: false },
  accept: { from: ["received", "under_review"], to: "accepted", note: true },
  reject: { from: ["received", "under_review"], to: "rejected", note: true },
  complete: { from: ["accepted"], to: "completed", note: true },
};
export type WithdrawalAction = keyof typeof ACTIONS;

export class WithdrawalService {
  private now: () => number;
  constructor(private d: WithdrawalDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Contrato del que se desistiría: pedido vigente del tenant y su pedido de alta (o de conversión). */
  private async context(tenantId: string) {
    if (!TENANT.test(tenantId)) throw new WithdrawalError("invalid_input", "Empresa no válida");
    const company = (await this.d.crmStore.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number } | undefined;
    if (!company) throw new WithdrawalError("not_found", "Empresa no encontrada");
    const orders = await this.d.orders.list({ companyId: company.id });
    const current = orders.filter((o) => LIVE.includes(o.state) && o.tenantId === tenantId).sort((a, b) => b.id - a.id)[0] ?? null;
    // Un cambio de plan no es un contrato nuevo: se sube hasta el pedido que lo celebró
    let contract: CommercialOrder | null = current;
    for (let i = 0; contract && contract.kind === "change" && contract.previousOrderId && i < 50; i++) contract = await this.d.orders.get(contract.previousOrderId);
    const buyer = contract ? await this.d.buyers.buyerProfile(contract.id) : null;
    const paidRow = contract ? (await this.d.orders.payments(contract.id)).filter((p) => p.status === "succeeded" && p.purpose !== "renewal" && p.purpose !== "change").sort((a, b) => a.createdAt - b.createdAt)[0] : undefined;
    const contractAt = contract?.confirmation?.at ?? null;
    let period: { start: number; end: number } | null = null;
    if (contract && contractAt !== null) {
      const sub = contract.subscriptionId && this.d.subscriptions ? await this.d.subscriptions.get(contract.subscriptionId).catch(() => null) : null;
      period = sub && sub.currentPeriodStart <= contractAt + DAY ? { start: sub.currentPeriodStart, end: sub.currentPeriodEnd } : { start: contractAt, end: contractAt + (contract.request.interval === "year" ? 365 : 30) * DAY };
    }
    const assessment = assessWithdrawal({ buyer, contractAt, paid: paidRow ? { amountCents: paidRow.amountCents, currency: paidRow.currency } : null, period }, this.now());
    return { company, current, contract, assessment };
  }

  /** Lo que ve el cliente en su cuenta: si puede desistir ahora y el estado de su solicitud. */
  async status(tenantId: string): Promise<WithdrawalStatus> {
    const c = await this.context(tenantId);
    const last = c.contract ? (await this.d.store.ofContract(c.contract.id))[0] ?? null : null;
    const open = !!last && OPEN_STATES.includes(last.status);
    const { applicability, deadlineAt, withinTerm, extended, immediateExecution, summary } = c.assessment;
    return {
      available: applicability === "applicable" && withinTerm && !open,
      assessment: { applicability, deadlineAt, withinTerm, extended, immediateExecution, summary },
      request: last ? { reference: last.reference, status: last.status, requestedAt: last.requestedAt } : null,
    };
  }

  /**
   * Solicitud de desistimiento. Idempotente por clave. Se registra SIEMPRE que haya un contrato de un particular,
   * también fuera de plazo (lo decide una persona; nunca se pierde una reclamación). Devuelve el justificante.
   */
  async request(tenantId: string, input: { idempotencyKey: string; requestedBy: string; contactEmail: string; statement?: string | null; channel?: "platform" | "support" }, actor: string) {
    if (!/^[A-Za-z0-9:_-]{16,100}$/.test(input.idempotencyKey)) throw new WithdrawalError("invalid_input", "Clave de idempotencia no válida");
    const email = input.contactEmail.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) throw new WithdrawalError("invalid_input", "Indica un correo electrónico válido para enviarte el justificante");
    const c = await this.context(tenantId);
    if (!c.contract || !c.current) throw new WithdrawalError("not_applicable", c.assessment.summary);
    if (c.assessment.applicability !== "applicable") throw new WithdrawalError("not_applicable", c.assessment.summary);
    const now = this.now();
    const key = `wd-${tenantId}-${input.idempotencyKey}`.slice(0, 100);
    const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
    const reference = `DS-${day}-${crypto.createHash("sha256").update(`${key}|${now}`).digest("hex").slice(0, 6).toUpperCase()}`;
    let r: { request: WithdrawalRequest; created: boolean };
    try {
      r = await this.d.store.create(
        { reference, idempotencyKey: key, orderId: c.current.id, contractOrderId: c.contract.id, companyId: c.company.id, tenantId, channel: input.channel ?? "platform", requestedBy: input.requestedBy.slice(0, 120), contactEmail: email, statement: input.statement?.trim().slice(0, 1000) || null, requestedAt: now, assessment: c.assessment },
        actor,
      );
    } catch (e) {
      if (e instanceof WithdrawalConflictError) throw new WithdrawalError("conflict", "Ya tienes una solicitud de desistimiento en curso para este contrato");
      throw e;
    }
    if (r.created) {
      opsLog("info", "Withdrawals", "requested", { id: r.request.id, contractOrderId: c.contract.id, withinTerm: c.assessment.withinTerm, channel: r.request.channel });
      await this.event(r.request, "order.withdrawal_requested", null, "received", actor, { withinTerm: c.assessment.withinTerm, channel: r.request.channel });
    }
    // Acuse de recibo (idempotente en la bandeja por referencia); el justificante queda además en la cuenta
    if (!r.request.receiptSentAt && this.d.notify) {
      await this.d.notify.receipt(r.request.contactEmail, r.request).then(
        (x) => (x.queued ? this.d.store.markReceiptSent(r.request.id, this.now()) : undefined),
        (e) => opsLog("warn", "Withdrawals", "receipt_not_sent", { id: r.request.id, error: e instanceof Error ? e.name : "error" }),
      );
    }
    return { created: r.created, receipt: receiptOf((await this.d.store.get(r.request.id)) ?? r.request) };
  }

  list(f: { status?: WithdrawalState; limit?: number } = {}) {
    return this.d.store.list(f);
  }

  async detail(id: number) {
    const r = await this.d.store.get(id);
    if (!r) throw new WithdrawalError("not_found", "Solicitud no encontrada");
    return { request: r, events: await this.d.store.events(id) };
  }

  /**
   * Gestión administrativa: revisar, aceptar, rechazar (con motivo) o completar (cuando el equipo ya ha ejecutado a
   * mano el reembolso y el fin del servicio, con su referencia). Nunca ejecuta nada en Stripe.
   */
  async decide(id: number, action: WithdrawalAction, input: { note?: string | null; refundReference?: string | null; expectedVersion: number }, actor: string) {
    const rule = ACTIONS[action];
    const r = await this.d.store.get(id);
    if (!r) throw new WithdrawalError("not_found", "Solicitud no encontrada");
    if (!rule.from.includes(r.status)) throw new WithdrawalError("invalid_state", `No se puede «${action}» una solicitud en «${r.status}»`);
    const note = input.note?.trim() || null;
    if (rule.note && (!note || note.length < 5)) throw new WithdrawalError("invalid_input", "Indica el motivo o la explicación de la decisión");
    const at = this.now();
    const resolution: WithdrawalResolution | null = action === "review" ? null : { note: note!, refundReference: action === "complete" ? (input.refundReference?.trim().slice(0, 120) || null) : (r.resolution?.refundReference ?? null), decidedBy: actor, decidedAt: at };
    let next: WithdrawalRequest;
    try {
      next = await this.d.store.transition(id, input.expectedVersion, rule.to, resolution, { action, actor, note, at });
    } catch (e) {
      if (e instanceof WithdrawalConflictError) throw new WithdrawalError("conflict", e.message);
      throw e;
    }
    opsLog("info", "Withdrawals", "decided", { id, action, status: next.status });
    if (action !== "review") await this.event(next, "order.withdrawal_resolved", r.status, next.status, actor, { action });
    // Se comunica al consumidor la aceptación o el rechazo (la ejecución, al completar)
    if ((action === "accept" || action === "reject" || action === "complete") && this.d.notify)
      await this.d.notify.resolution(next.contactEmail, next).catch((e) => opsLog("warn", "Withdrawals", "resolution_not_sent", { id, error: e instanceof Error ? e.name : "error" }));
    return next;
  }

  private async event(r: WithdrawalRequest, type: "order.withdrawal_requested" | "order.withdrawal_resolved", from: string | null, to: string, actor: string, data: Record<string, string | boolean>) {
    if (!this.d.events) return;
    const draft: CommercialEventDraft = {
      key: `withdrawal:${r.id}:${to}`,
      type,
      aggregate: { type: "order", id: String(r.contractOrderId), version: null },
      correlationId: r.reference,
      tenantId: r.tenantId,
      companyId: r.companyId,
      orderId: r.contractOrderId,
      subscriptionId: null,
      trialId: null,
      paymentId: null,
      stripeRef: null,
      fromState: from,
      toState: to,
      actor,
      occurredAt: this.now(),
      data: { reference: r.reference, ...data },
    };
    await this.d.events.append(null, [draft]).catch((e) => opsLog("warn", "Withdrawals", "event_not_recorded", { id: r.id, error: e instanceof Error ? e.name : "error" }));
  }
}

/** Justificante para el consumidor (sin datos internos). */
export function receiptOf(r: WithdrawalRequest) {
  return {
    reference: r.reference,
    requestedAt: r.requestedAt,
    status: r.status,
    channel: r.channel,
    deadlineAt: r.assessment.deadlineAt,
    withinTerm: r.assessment.withinTerm,
    receiptSent: !!r.receiptSentAt,
    text:
      `Hemos recibido tu solicitud de desistimiento con la referencia ${r.reference} el ${new Date(r.requestedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} (hora de Madrid). ` +
      (r.assessment.withinTerm ? "Se ha presentado dentro del plazo de desistimiento. " : "Consta presentada fuera del plazo de desistimiento: la revisaremos igualmente. ") +
      "Revisaremos la solicitud y te comunicaremos la resolución y, si procede, el reembolso. Hasta entonces no se ha cobrado ni devuelto nada por este motivo.",
  };
}
