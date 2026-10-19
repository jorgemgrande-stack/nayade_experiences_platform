/**
 * Orquestador comercial: encadena lo que YA existe (CRM, cotizador, suscripciones, licencias por
 * capacidad, pruebas y aprovisionamiento) sin duplicarlo.
 *
 *   Solicitud → Cotización → Contrato → Confirmación → Suscripción → Licencia → Activación
 *
 * Reglas:
 *  - Nada se activa por una solicitud: sin CONFIRMACIÓN no hay suscripción de pago ni licencias. La
 *    confirmación es SOLO un pago verificado (evento firmado del proveedor de pruebas), una aprobación
 *    administrativa registrada o, en un cambio sin importe que no añade capacidades, la del pedido al que
 *    sustituye. Las licencias de una PRUEBA válida las gestiona la propia prueba (con caducidad).
 *  - Cada paso es idempotente y recuperable: se apoya en lo ya persistido (contrato, suscripción viva
 *    del contrato, licencias aplicadas) y puede repetirse tras cualquier fallo (`advance`, `review`).
 *  - Estados explícitos con versión optimista; cada cambio y cada fallo quedan como evento.
 *  - Licencias: solo capacidades (Elephant Control). Los entitlements por módulo del motor anterior no
 *    se tocan (los contratos con configuración no llevan módulos).
 *  - Impago: 7 días de gracia (regla del motor de facturación) y después suspensión reversible de las
 *    licencias; nunca se borran datos. Nada de esto ocurre solo: lo aplica `review`, una acción explícita.
 */
import crypto from "node:crypto";
import type { QuoteRequest, QuoteResult } from "../catalog/quote";
import { parseQuoteRequest } from "../catalog/request";
import type { CapabilityStore } from "../_core/capabilities/store";
import type { CrmService } from "../crm/service";
import type { CrmStore } from "../crm/store";
import type { Company, Contact, Contract, ContractConfiguration, RequestConfiguration } from "../crm/types";
import type { LicensingService } from "../licensing/service";
import type { CatalogPort } from "../subscriptions/ports";
import { stableHash } from "../subscriptions/pricing";
import type { ItemSpec, SubscriptionService } from "../subscriptions/service";
import type { ShadowBillingService } from "../subscriptions/shadow";
import type { SubscriptionStore } from "../subscriptions/store";
import type { Interval, Subscription } from "../subscriptions/types";
import type { TrialService } from "../trials/service";
import { nextOrderState, type OrderAction } from "./machine";
import type { TestPaymentPort } from "./payments";
import type { OrderStore } from "./store";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { APPROVAL_CATEGORIES, OrderError, type ApprovalCategory, type CommercialOrder, type Confirmation, type OrderPatch, type OrderPayment, type OrderQuote, type OrderState, type PaymentMode, type PaymentPurpose } from "./types";

export const GRACE_DAYS = 7;
/** Proveedor de los pagos verificados en Stripe Billing (modo pruebas). Sus pedidos no reciben recibos simulados. */
export const STRIPE_PAYMENT_PROVIDER = "stripe_test";
/** Proveedor de los pagos verificados en Stripe Billing en modo live (cuenta real). */
export const STRIPE_LIVE_PAYMENT_PROVIDER = "stripe";
/** Proveedor de los pagos de Stripe según el modo del entorno. */
export const stripePaymentProvider = (mode: PaymentMode) => (mode === "live" ? STRIPE_LIVE_PAYMENT_PROVIDER : STRIPE_PAYMENT_PROVIDER);
/** ¿Es un pago verificado en Stripe Billing (de cualquier modo)? */
export const isStripeProvider = (provider: string) => provider === STRIPE_PAYMENT_PROVIDER || provider === STRIPE_LIVE_PAYMENT_PROVIDER;
const DAY = 86_400_000;
const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
const LIVE: OrderState[] = ["active", "past_due", "suspended"];

export interface PlatformPort {
  /** Alta (idempotente) de la plataforma de la empresa con su administrador. */
  activate(input: { contract: Contract; company: Company; contact: Contact | null }): Promise<{ tenantId: string }>;
}

export interface OrchestratorDeps {
  store: OrderStore;
  crm: CrmService;
  crmStore: CrmStore;
  subscriptions: SubscriptionService;
  subscriptionStore: Pick<SubscriptionStore, "items">;
  shadow: Pick<ShadowBillingService, "preview">;
  catalog: CatalogPort;
  quote: (r: QuoteRequest) => Promise<QuoteResult>;
  licensing: Pick<LicensingService, "apply" | "preview">;
  capabilities: CapabilityStore;
  platform?: PlatformPort;
  trials?: TrialService;
  /** ¿El cobro del pedido está revertido en Stripe (reembolso total o disputa perdida)? Entonces no se activa. */
  coverageHeld?: (orderId: number) => Promise<boolean>;
  payments?: TestPaymentPort | null;
  /**
   * Modo de cobro del entorno (el de Stripe Billing; por defecto «test»). En «live» NO se admite el
   * proveedor de pagos simulados (`payments`): el orquestador no se crea.
   */
  mode?: PaymentMode;
  graceDays?: number;
  now?: () => number;
  /**
   * Aviso tras cada cambio de estado ya guardado (correo transaccional). No forma parte de la transición:
   * se lanza sin esperar y un fallo solo se registra.
   */
  notify?: OrderNotifier;
}

/**
 * Avisos sin cambio de estado: `payment_recorded` = cobro VERIFICADO de una renovación o de un cambio
 * (detalle: `paymentId`, `purpose`). El cobro del alta se avisa con `confirm` (base `payment`).
 */
export type OrderNotice = "payment_recorded";
export type OrderNotifier = (e: { order: CommercialOrder; action: OrderAction | OrderNotice; detail: Record<string, unknown> | null }) => Promise<void>;

export interface CreateOrderInput {
  idempotencyKey: string;
  leadRequestId?: number;
  trialId?: number;
  companyId?: number;
  changeOf?: number;
  request?: unknown;
  interval?: Interval;
}

export type Waiting = "acceptance" | "confirmation" | null;
export interface AdvanceResult {
  order: CommercialOrder;
  waitingFor: Waiting;
  error: string | null;
}

/** Configuración de «Construye tu Elephant» (ids del catálogo) → petición del cotizador. Los intereses no se contratan. */
export function requestFromWebConfiguration(cfg: RequestConfiguration, interval: Interval): QuoteRequest {
  if (!cfg.plan) throw new OrderError("invalid_input", "La solicitud no indica un plan: completa la configuración antes de contratar");
  const keys = Array.from(new Set([...cfg.extensions, ...cfg.industries]));
  return { plan: cfg.plan, interval, items: keys.map((key) => ({ key })) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);

export class CommercialOrchestrator {
  private now: () => number;
  private grace: number;
  private mode: PaymentMode;
  constructor(private d: OrchestratorDeps) {
    this.now = d.now ?? Date.now;
    this.grace = (d.graceDays ?? GRACE_DAYS) * DAY;
    this.mode = d.mode ?? "test";
    if (this.mode !== "test" && this.mode !== "live") throw new Error("Modo de cobro no admitido");
    // Los pagos simulados son SOLO de pruebas: en live nunca se montan
    if (this.mode === "live" && d.payments) throw new Error("El proveedor de pagos simulados no puede montarse en modo live");
    if (d.payments && d.payments.mode !== "test") throw new Error("El proveedor de pagos simulados solo admite el modo pruebas");
  }

  get paymentsConfig() {
    const p = this.d.payments;
    return { enabled: !!p, provider: p?.kind ?? null, mode: this.mode, stripeProvider: stripePaymentProvider(this.mode), autoCharge: false as const, graceDays: this.grace / DAY };
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  async must(id: number) {
    const o = await this.d.store.get(id);
    if (!o) throw new OrderError("not_found", "Pedido no encontrado");
    return o;
  }
  async detail(id: number) {
    const order = await this.must(id);
    const [events, payments] = await Promise.all([this.d.store.events(id), this.d.store.payments(id)]);
    return { order, events, payments, waitingFor: this.waiting(order, payments) };
  }
  list(f: Parameters<OrderStore["list"]>[0]) {
    return this.d.store.list(f);
  }
  /**
   * ¿Pago cobrado que cuenta como base en ESTE entorno? Solo los de su modo; en live, además, solo los
   * verificados en Stripe (proveedor `stripe`). Un pago de otro modo nunca confirma ni activa nada.
   */
  private verifiedPayment(p: OrderPayment) {
    return p.status === "succeeded" && p.mode === this.mode && (this.mode !== "live" || p.provider === STRIPE_LIVE_PAYMENT_PROVIDER);
  }
  private waiting(o: CommercialOrder, payments: OrderPayment[]): Waiting {
    if (o.state === "quoted") return "acceptance";
    if (o.state === "contracted") return payments.some((p) => this.verifiedPayment(p) && p.purpose !== "renewal") ? null : "confirmation";
    return null;
  }

  // ── Transiciones ───────────────────────────────────────────────────────────

  private async move(o: CommercialOrder, action: OrderAction, actor: string, patch: OrderPatch = {}, detail: Record<string, unknown> | null = null) {
    const to = nextOrderState(o.state, action);
    if (!to) throw new OrderError("invalid_state", `No se puede «${action}» un pedido en estado «${o.state}»`);
    const moved = await this.d.store.transition(o.id, o.version, { ...patch, state: to }, { kind: action, detail, actor, at: this.now() });
    this.emit(moved, action, detail);
    return moved;
  }
  /** Lanza el aviso sin esperar; un fallo solo se registra. */
  private emit(order: CommercialOrder, action: OrderAction | OrderNotice, detail: Record<string, unknown> | null) {
    if (this.d.notify)
      void this.d.notify({ order, action, detail }).catch((e) => opsLog("error", "Orders", "notify_failed", { orderId: order.id, action, error: e instanceof Error ? e.name : "error" }));
  }

  /**
   * Aviso de un cobro VERIFICADO que no cambia el estado del pedido (renovación o cambio cobrados). Lo
   * llama quien registra el pago (eventos de pruebas o procesador de Stripe). No toca el pedido; el
   * correo es idempotente por pago.
   */
  async paymentRecorded(orderId: number, paymentId: number): Promise<void> {
    const o = await this.must(orderId);
    const p = (await this.d.store.payments(o.id)).find((x) => x.id === paymentId);
    if (!p || !this.verifiedPayment(p) || p.purpose === "initial") return;
    this.emit(o, "payment_recorded", { paymentId: p.id, purpose: p.purpose });
  }
  /** Evento sin cambio de estado (pago solicitado, fallo de un paso, renovación…). */
  private note(o: CommercialOrder, kind: string, actor: string, detail: Record<string, unknown> | null, patch: OrderPatch = {}) {
    return this.d.store.transition(o.id, o.version, patch, { kind, detail, actor, at: this.now() });
  }

  // ── Alta del pedido (Solicitud) ────────────────────────────────────────────

  /** Crea el pedido (idempotente por clave) y prepara cotización y borrador de contrato. No activa nada. */
  async create(input: CreateOrderInput, actor: string): Promise<{ created: boolean } & AdvanceResult> {
    if (!KEY_RE.test(input.idempotencyKey ?? "")) throw new OrderError("invalid_input", "Clave de idempotencia no válida (16–80 caracteres: letras, números, - y _)");
    const { idempotencyKey, ...payload } = input;
    const payloadHash = stableHash(payload);
    const again = await this.d.store.byKey(idempotencyKey);
    if (again) {
      if (again.payloadHash !== payloadHash) throw new OrderError("conflict", "Esa clave de idempotencia ya se usó con otra petición");
      return { created: false, ...(await this.result(again)) };
    }
    const sources = [input.leadRequestId, input.trialId, input.companyId, input.changeOf].filter((x) => x !== undefined);
    if (sources.length !== 1) throw new OrderError("invalid_input", "Indica exactamente un origen: solicitud web, prueba, empresa o pedido a cambiar");
    const base = await this.resolveSource(input);
    const parsed = parseQuoteRequest(base.request, { allowOwned: false });
    if (!parsed.ok) throw new OrderError("invalid_input", parsed.message);
    const request = { ...parsed.value, items: parsed.value.items ?? [] };
    const { order, created } = await this.d.store.insert({
      idempotencyKey,
      payloadHash,
      kind: base.kind,
      state: "requested",
      companyId: base.companyId,
      leadRequestId: input.leadRequestId ?? null,
      trialId: input.trialId ?? null,
      previousOrderId: input.changeOf ?? null,
      request,
      quote: null,
      contractId: null,
      subscriptionId: base.subscriptionId,
      tenantId: base.tenantId,
      confirmation: null,
      graceEndsAt: null,
      attempts: 0,
      lastError: null,
      createdAt: this.now(),
      createdBy: actor,
    });
    if (!created) return { created, ...(await this.result(order)) };
    return { created, ...(await this.advance(order.id, actor)) };
  }

  private async resolveSource(input: CreateOrderInput): Promise<{ kind: CommercialOrder["kind"]; companyId: number; request: unknown; subscriptionId: number | null; tenantId: string | null }> {
    if (input.changeOf !== undefined) {
      const prev = await this.must(input.changeOf);
      if (!LIVE.includes(prev.state)) throw new OrderError("invalid_state", "Solo se cambia un pedido activo (también en gracia o suspendido)");
      if (!input.request) throw new OrderError("invalid_input", "Indica la nueva configuración");
      const r = parseQuoteRequest(input.request, { allowOwned: false });
      if (r.ok && r.value.interval !== prev.request.interval && r.value.plan !== prev.request.plan) {
        throw new OrderError("invalid_input", "Cambia el plan y la periodicidad en dos pedidos distintos (primero el plan)");
      }
      if (r.ok && stableHash({ ...r.value, items: r.value.items ?? [] }) === stableHash(prev.request)) throw new OrderError("invalid_input", "Es la misma configuración que la vigente");
      return { kind: "change", companyId: prev.companyId, request: input.request, subscriptionId: prev.subscriptionId, tenantId: prev.tenantId };
    }
    if (input.trialId !== undefined) {
      if (!this.d.trials) throw new OrderError("unavailable", "Las pruebas no están configuradas");
      const t = await this.d.trials.must(input.trialId);
      if (!["active", "expired", "suspended"].includes(t.state) || !t.tenantId) throw new OrderError("invalid_state", `La prueba está en «${t.state}»: no se puede convertir`);
      const company = (await this.d.crmStore.list("companies", { tenantId: t.tenantId }, { limit: 1 }))[0];
      if (!company) throw new OrderError("invalid_state", "No se encuentra la empresa de la prueba");
      const sub = (await this.d.subscriptions.list({ companyId: company.id })).find((s) => s.status !== "canceled");
      if (!sub) throw new OrderError("invalid_state", "La prueba no tiene suscripción");
      const request = input.request ?? { plan: t.configuration.plan ?? "essential", interval: input.interval ?? "month", items: t.configuration.addons.map((key) => ({ key })) };
      return { kind: "trial_conversion", companyId: company.id, request, subscriptionId: sub.id, tenantId: t.tenantId };
    }
    let companyId: number;
    let request = input.request;
    if (input.leadRequestId !== undefined) {
      const lr = await this.d.crmStore.get("leadRequests", input.leadRequestId);
      if (!lr) throw new OrderError("not_found", "Solicitud web no encontrada");
      const lead = await this.d.crmStore.get("leads", lr.leadId);
      const cid = lead?.convertedCompanyId ?? lead?.companyId ?? null;
      if (!cid) throw new OrderError("invalid_state", "Convierte antes el lead en empresa (la solicitud no tiene empresa)");
      companyId = cid;
      if (request === undefined) {
        if (!lr.configuration) throw new OrderError("invalid_input", "La solicitud no trae configuración: indica la petición");
        request = requestFromWebConfiguration(lr.configuration, input.interval ?? "month");
      }
    } else {
      companyId = input.companyId!;
      if (!(await this.d.crmStore.get("companies", companyId))) throw new OrderError("not_found", "Empresa no encontrada");
      if (request === undefined) throw new OrderError("invalid_input", "Indica la configuración a contratar");
    }
    const live = (await this.d.subscriptions.list({ companyId })).find((s) => s.status !== "canceled");
    if (live) throw new OrderError("conflict", "La empresa ya tiene una suscripción viva: usa un cambio de plan o la conversión de su prueba");
    return { kind: "new", companyId, request, subscriptionId: null, tenantId: null };
  }

  // ── Avance (idempotente y recuperable) ─────────────────────────────────────

  private async result(o: CommercialOrder, error: string | null = null): Promise<AdvanceResult> {
    return { order: o, waitingFor: this.waiting(o, await this.d.store.payments(o.id)), error };
  }

  /** Avanza todo lo posible. Se detiene a la espera de la aceptación o de la confirmación, o en un fallo (registrado). */
  async advance(id: number, actor: string, acceptance?: { signatureRef: string; approvalReason?: string }): Promise<AdvanceResult> {
    for (let guard = 0; guard < 12; guard++) {
      const o = await this.must(id);
      try {
        // Un pago revertido en Stripe no da de alta ni activa nada (tampoco desde /review o /advance)
        if ((o.state === "confirmed" || o.state === "subscribed" || o.state === "licensed") && this.d.coverageHeld && (await this.d.coverageHeld(o.id))) {
          throw new OrderError("invalid_state", "El cobro de este pedido se revirtió en Stripe (reembolso o disputa): no se activa");
        }
        switch (o.state) {
          case "requested":
            await this.stepQuote(o, actor);
            continue;
          case "quoted":
            if (!(await this.stepContract(o, actor, acceptance))) return this.result(await this.must(id));
            continue;
          case "contracted":
            if (!(await this.stepConfirm(o, actor))) return this.result(o);
            continue;
          case "confirmed":
            await this.stepSubscribe(o, actor);
            continue;
          case "subscribed":
            await this.stepLicense(o, actor);
            continue;
          case "licensed":
            await this.stepActivate(o, actor);
            continue;
          default:
            return this.result(o);
        }
      } catch (e) {
        // Otro proceso avanzó el mismo pedido: se relee y se sigue
        if (e instanceof OrderError && e.code === "conflict" && /cambió mientras tanto/.test(e.message)) continue;
        const cur = await this.must(id);
        const failed = await this.note(cur, "step_failed", actor, { step: cur.state, error: message(e) }, { attempts: cur.attempts + 1, lastError: message(e) });
        return this.result(failed, message(e));
      }
    }
    return this.result(await this.must(id));
  }

  /** Cotización del servidor con el catálogo publicado. Lo «Próximamente» bloquea. */
  private async stepQuote(o: CommercialOrder, actor: string) {
    const q = await this.d.quote(o.request);
    if (!q.ok) throw new OrderError("invalid_input", `Configuración no válida: ${q.errors.join("; ")}`);
    if (q.blocking.length) throw new OrderError("invalid_state", `Incluye productos que aún no se pueden contratar: ${q.blocking.join(", ")}`);
    const t = q.totals;
    const quote: OrderQuote = {
      catalogVersion: q.catalogVersion,
      currency: q.currency,
      contractAmountCents: o.request.interval === "month" ? t.monthlyCents : t.annualizedCents,
      firstPeriodCents: o.request.interval === "month" ? t.monthlyCents + t.monthlyTaxCents : t.yearlyCents + t.yearlyTaxCents + t.monthlyCents + t.monthlyTaxCents,
      capabilities: q.capabilities,
      blocking: q.blocking,
      onRequest: q.lines.filter((l) => l.commercialStatus === "on_request").map((l) => l.name),
      contractable: q.contractable,
    };
    await this.move(o, "quote", actor, { quote, lastError: null }, { catalogVersion: q.catalogVersion, firstPeriodCents: quote.firstPeriodCents, currency: quote.currency });
  }

  private configuration(o: CommercialOrder, q: QuoteResult): ContractConfiguration {
    // Misma forma que la que guarda la API del CRM al configurar un contrato (crm/api.ts)
    return {
      request: o.request as ContractConfiguration["request"],
      quote: {
        catalogVersion: q.catalogVersion,
        currency: q.currency,
        lines: q.lines.map((l) => ({ key: l.key, name: l.name, family: l.family, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, interval: l.interval, status: l.status, commercialStatus: l.commercialStatus, note: l.note })),
        totals: q.totals,
        capabilities: q.capabilities,
        contractable: q.contractable,
        blocking: q.blocking,
        warnings: q.warnings,
      },
      quotedAt: this.now(),
    } as ContractConfiguration;
  }

  /**
   * Contrato: borrador con la configuración cotizada (renovación del vigente en un cambio). Con la
   * aceptación (firma registrada; motivo de aprobación si hay productos «bajo solicitud») queda firmado.
   * Devuelve true si el contrato está firmado.
   */
  private async stepContract(o: CommercialOrder, actor: string, acceptance?: { signatureRef: string; approvalReason?: string }): Promise<boolean> {
    let contractId = o.contractId;
    if (!contractId) {
      const q = await this.d.quote(o.request);
      const terms = { configuration: this.configuration(o, q), planId: o.request.plan, billingInterval: o.request.interval, currency: o.quote!.currency, amountCents: o.quote!.contractAmountCents };
      let contract: Contract;
      if (o.kind === "change") {
        const prev = await this.must(o.previousOrderId!);
        const open = (await this.d.crmStore.list("contracts", { previousContractId: prev.contractId! })).find((c) => c.status === "draft" || c.status === "sent");
        const renewal = open ?? (await this.d.crm.renewContract(prev.contractId!, actor));
        contract = await this.d.crm.updateContract(renewal.id, { ...terms, reason: `Cambio del pedido ${o.reference}` }, actor);
      } else {
        const opportunityId = o.leadRequestId ? ((await this.d.crmStore.get("leads", (await this.d.crmStore.get("leadRequests", o.leadRequestId))!.leadId))?.convertedOpportunityId ?? undefined) : undefined;
        contract = await this.d.crm.createContract({ companyId: o.companyId, ...(opportunityId ? { opportunityId } : {}), ...terms }, actor);
      }
      await this.d.crm.log("contract", contract.id, "note", `Pedido ${o.reference}: contrato preparado por el orquestador`, actor);
      o = await this.note(o, "contract_drafted", actor, { contractId: contract.id, reference: contract.reference }, { contractId: contract.id });
      contractId = contract.id;
    }
    let contract = (await this.d.crmStore.get("contracts", contractId))!;
    if (contract.status === "cancelled") throw new OrderError("invalid_state", "El contrato del pedido está cancelado");
    if (contract.status !== "signed" && contract.status !== "active") {
      if (!acceptance) return false;
      if (!acceptance.signatureRef?.trim()) throw new OrderError("invalid_input", "Falta la referencia de la aceptación (firma)");
      if (o.kind === "trial_conversion") await this.ensureContact(o, actor);
      const opts = { signatureRef: acceptance.signatureRef.trim(), approvalReason: acceptance.approvalReason };
      if (contract.status === "draft") contract = await this.d.crm.setContractStatus(contractId, "sent", actor, opts);
      contract = await this.d.crm.setContractStatus(contractId, "signed", actor, opts);
    }
    await this.move(o, "sign", actor, { lastError: null }, { contractId, signatureRef: contract.signatureRef });
    return true;
  }

  /** La activación del contrato necesita un contacto con correo (administrador): en una prueba, el de la prueba. */
  private async ensureContact(o: CommercialOrder, actor: string) {
    const contacts = (await this.d.crmStore.list("contacts", { companyId: o.companyId })).filter((c) => c.status !== "inactive" && c.email);
    if (contacts.length || !this.d.trials || !o.trialId) return;
    const t = await this.d.trials.must(o.trialId);
    await this.d.crm.createContact(o.companyId, { name: t.companyName, email: t.email, role: "Administración", isPrimary: true }, actor);
  }

  /** Confirmación por pago verificado o, en un cambio sin importe que no añade capacidades, heredada. */
  private async stepConfirm(o: CommercialOrder, actor: string): Promise<boolean> {
    const paid = (await this.d.store.payments(o.id)).find((p) => this.verifiedPayment(p) && p.purpose !== "renewal");
    if (paid) {
      await this.move(o, "confirm", actor, { confirmation: { kind: "payment", ref: String(paid.id), actor, reason: null, at: this.now() }, lastError: null }, { basis: "payment", paymentId: paid.id });
      return true;
    }
    if (o.kind === "change" && (await this.amountDue(o)) <= 0 && (await this.addsNoCapability(o))) {
      const prev = await this.must(o.previousOrderId!);
      await this.move(o, "confirm", actor, { confirmation: { kind: "inherited", ref: String(prev.id), actor, reason: "Cambio sin importe que no añade capacidades", at: this.now() }, lastError: null }, { basis: "inherited", from: prev.id });
      return true;
    }
    return false;
  }

  private async addsNoCapability(o: CommercialOrder) {
    const prev = await this.must(o.previousOrderId!);
    const had = new Set(prev.quote?.capabilities ?? []);
    return (o.quote?.capabilities ?? []).every((c) => had.has(c));
  }

  /** Importe a pagar para confirmar: el primer periodo (alta) o la diferencia con el pedido anterior (cambio). */
  private async amountDue(o: CommercialOrder) {
    if (!o.quote) return 0;
    if (o.kind !== "change") return o.quote.firstPeriodCents;
    const prev = await this.must(o.previousOrderId!);
    return Math.max(0, o.quote.firstPeriodCents - (prev.quote?.firstPeriodCents ?? 0));
  }

  /**
   * Comprobación final antes de conceder licencias de pago: SOLO pago verificado, aprobación
   * administrativa registrada o herencia de un pedido con base válida.
   */
  async paidBasis(o: CommercialOrder, depth = 0): Promise<Confirmation["kind"]> {
    const c = o.confirmation;
    if (!c) throw new OrderError("forbidden", "Sin confirmación (pago verificado o aprobación administrativa) no se activan licencias de pago");
    if (c.kind === "payment") {
      const p = (await this.d.store.payments(o.id)).find((x) => String(x.id) === c.ref);
      if (!p || !this.verifiedPayment(p)) throw new OrderError("forbidden", "El pago de la confirmación no está verificado (o no es de este modo)");
      return "payment";
    }
    if (c.kind === "admin_approval") {
      if (!c.actor || !c.reason || c.reason.trim().length < 5) throw new OrderError("forbidden", "Aprobación administrativa sin responsable o sin motivo");
      return "admin_approval";
    }
    if (depth > 10 || !o.previousOrderId || c.ref !== String(o.previousOrderId)) throw new OrderError("forbidden", "Confirmación heredada sin pedido de origen");
    await this.paidBasis(await this.must(o.previousOrderId), depth + 1);
    return "inherited";
  }

  // ── Suscripción ────────────────────────────────────────────────────────────

  private async priceFor(key: string, interval: Interval, core: boolean): Promise<number> {
    const p = (await this.d.catalog.offer()).find((x) => x.key === key);
    if (!p) throw new OrderError("invalid_state", `«${key}» no está publicado`);
    const prefer =
      p.family === "service" ? ["one_time"] : p.family === "usage" ? ["usage"] : core ? [interval === "year" ? "yearly" : "monthly"] : interval === "year" ? ["yearly", "monthly"] : ["monthly"];
    for (const k of prefer) {
      const price = p.prices.find((x) => x.kind === k && x.status === "approved");
      if (price) return price.id;
    }
    throw new OrderError("invalid_state", `«${p.name}» no tiene precio aprobado para esa periodicidad`);
  }
  private async specs(o: CommercialOrder): Promise<{ plan: ItemSpec; addons: ItemSpec[] }> {
    const plan = { productKey: o.request.plan, priceId: await this.priceFor(o.request.plan, o.request.interval, true) };
    const addons: ItemSpec[] = [];
    for (const i of o.request.items) addons.push({ productKey: i.key, priceId: await this.priceFor(i.key, o.request.interval, false), ...(i.quantity ? { quantity: i.quantity } : {}) });
    return { plan, addons };
  }

  private async stepSubscribe(o: CommercialOrder, actor: string) {
    await this.paidBasis(o);
    const contract = (await this.d.crmStore.get("contracts", o.contractId!))!;
    if (contract.status !== "signed" && contract.status !== "active") throw new OrderError("invalid_state", "El contrato del pedido no está firmado");
    const reason = `Pedido ${o.reference}`;
    let sub: Subscription;
    let tenantId = o.tenantId;
    if (o.kind === "new") {
      const company = (await this.d.crmStore.get("companies", o.companyId))!;
      tenantId = company.tenantId;
      if (!tenantId) {
        // Plataforma de la empresa (idempotente por tenant): sin licencias hasta el paso siguiente
        if (!this.d.platform) throw new OrderError("unavailable", "El alta de plataformas no está configurada");
        const contacts = (await this.d.crmStore.list("contacts", { companyId: company.id })).filter((x) => x.status !== "inactive" && x.email);
        const contact = contacts.find((x) => x.isPrimary) ?? contacts[0] ?? null;
        if (!contact) throw new OrderError("invalid_state", "La empresa necesita un contacto activo con correo (será el administrador de la plataforma)");
        tenantId = (await this.d.platform.activate({ contract, company, contact })).tenantId;
        await this.d.crmStore.update("companies", company.id, { tenantId, updatedAt: this.now() });
      }
      const live = (await this.d.subscriptions.list({ companyId: o.companyId })).find((s) => s.status !== "canceled" && s.contractId === contract.id);
      if (live) sub = live;
      else {
        const { plan, addons } = await this.specs(o);
        sub = await this.d.subscriptions.create({ companyId: o.companyId, contractId: contract.id, tenantId, interval: o.request.interval, plan, addons, reason }, actor);
      }
    } else {
      sub = await this.d.subscriptions.must(o.subscriptionId!);
      if (sub.status === "canceled") throw new OrderError("invalid_state", "La suscripción está cancelada");
      if (sub.contractId !== contract.id) {
        if (o.kind === "trial_conversion") {
          if (sub.status !== "trialing") throw new OrderError("invalid_state", "La suscripción de la prueba ya no está en prueba: revísala antes de convertir");
          const { plan, addons } = await this.specs(o);
          sub = (await this.d.subscriptions.convertTrial(sub.id, { contractId: contract.id, interval: o.request.interval, plan, addons, reason }, sub.version, actor)).subscription;
        } else {
          sub = await this.applyChange(o, sub, actor, reason);
          sub = (await this.d.subscriptions.linkContract(sub.id, { contractId: contract.id, reason }, sub.version, actor)).subscription;
        }
      }
    }
    await this.move(o, "subscribe", actor, { subscriptionId: sub.id, tenantId: tenantId ?? sub.tenantId, lastError: null }, { subscriptionId: sub.id, reference: sub.reference });
  }

  /** Cambio sobre la suscripción viva: plan (subida inmediata, bajada a fin de periodo), complementos y periodicidad. */
  private async applyChange(o: CommercialOrder, sub: Subscription, actor: string, reason: string): Promise<Subscription> {
    const now = this.now();
    const live = (await this.d.subscriptionStore.items(sub.id)).filter((i) => i.effectiveFrom <= now && (i.effectiveTo === null || i.effectiveTo > now));
    const core = live.find((i) => i.family === "core_plan");
    if (!core) throw new OrderError("invalid_state", "La suscripción no tiene plan Core vigente");
    const reread = () => this.d.subscriptions.must(sub.id);
    if (o.request.interval !== sub.interval && o.request.interval !== sub.pendingInterval) {
      const prices = [];
      for (const i of live.filter((x) => x.priceKind === "monthly" || x.priceKind === "yearly")) {
        const mustChange = i.family === "core_plan" || (i.priceKind === "yearly" && o.request.interval === "month");
        if (mustChange) prices.push({ itemId: i.id, priceId: await this.priceFor(i.productKey, o.request.interval, i.family === "core_plan") });
      }
      sub = (await this.d.subscriptions.changeInterval(sub.id, { interval: o.request.interval, prices, reason }, sub.version, actor)).subscription;
    }
    if (core.productKey !== o.request.plan) {
      const plan = { productKey: o.request.plan, priceId: await this.priceFor(o.request.plan, sub.interval, true) };
      sub = (await this.d.subscriptions.changePlan(sub.id, { plan, reason }, sub.version, actor)).subscription;
    }
    const wanted = new Set(o.request.items.map((i) => i.key));
    const addons = live.filter((i) => i.family !== "core_plan" && (i.effectiveTo === null || i.effectiveTo > now));
    for (const i of o.request.items.filter((x) => !addons.some((a) => a.productKey === x.key))) {
      sub = await reread();
      sub = (await this.d.subscriptions.addItem(sub.id, { item: { productKey: i.key, priceId: await this.priceFor(i.key, sub.interval, false), ...(i.quantity ? { quantity: i.quantity } : {}) }, reason }, sub.version, actor)).subscription;
    }
    for (const a of addons.filter((x) => !wanted.has(x.productKey) && x.effectiveTo === null)) {
      sub = await reread();
      sub = (await this.d.subscriptions.removeItem(sub.id, a.id, { when: "period_end", reason }, sub.version, actor)).subscription;
    }
    return reread();
  }

  // ── Licencias y activación ─────────────────────────────────────────────────

  private async stepLicense(o: CommercialOrder, actor: string) {
    const basis = await this.paidBasis(o);
    const r = await this.d.licensing.apply(o.subscriptionId!, { activate: true, actor, reason: `Pedido ${o.reference} (${basis})` });
    await this.move(o, "license", actor, { tenantId: r.tenantId, lastError: null }, { basis, changes: r.applied.length, capabilities: r.desired.length });
  }

  private async stepActivate(o: CommercialOrder, actor: string) {
    const contract = (await this.d.crmStore.get("contracts", o.contractId!))!;
    if (contract.status !== "active") await this.d.crm.setContractStatus(contract.id, "active", actor);
    if (o.kind === "trial_conversion" && this.d.trials && o.trialId) {
      const t = await this.d.trials.must(o.trialId);
      if (t.state !== "converted") await this.d.trials.convert(t.id, t.version, o.subscriptionId!, actor);
    }
    if (o.kind === "change" && o.previousOrderId) {
      const prev = await this.must(o.previousOrderId);
      const pc = prev.contractId ? await this.d.crmStore.get("contracts", prev.contractId) : null;
      if (pc && pc.status === "active") {
        await this.d.crm.setContractStatus(pc.id, "cancelled", actor);
        await this.d.crm.log("contract", pc.id, "note", `Sustituido por ${contract.reference} (pedido ${o.reference})`, actor);
      }
      if (prev.state !== "superseded") await this.move(prev, "supersede", actor, {}, { by: o.id });
    }
    await this.d.crm.log("contract", contract.id, "note", `Pedido ${o.reference} activo: suscripción #${o.subscriptionId} y licencias aplicadas`, actor);
    await this.move(o, "activate", actor, { lastError: null }, { contractId: contract.id, subscriptionId: o.subscriptionId, tenantId: o.tenantId });
  }

  /** Reaplica las licencias según el estado: suspendido → suspendidas; si no, las de la suscripción. */
  private async syncLicences(o: CommercialOrder, actor: string, reason: string) {
    if (!o.subscriptionId || !o.tenantId) return 0;
    if (o.state === "suspended") return this.markLicences(o, "suspended", actor, reason);
    await this.paidBasis(o);
    return (await this.d.licensing.apply(o.subscriptionId, { activate: true, actor, reason })).applied.length;
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  /** Aceptación del cliente: firma registrada del contrato (y motivo si hay productos «bajo solicitud»). */
  async accept(id: number, input: { signatureRef: string; approvalReason?: string }, actor: string) {
    const o = await this.must(id);
    if (o.state !== "quoted" && o.state !== "requested") throw new OrderError("invalid_state", `El pedido está en «${o.state}»: no espera aceptación`);
    return this.advance(id, actor, input);
  }

  /**
   * Aprobación administrativa registrada (sin pago de Stripe): confirma y avanza. Es la vía EXCEPCIONAL; la
   * ordinaria es el pago verificado. Nunca crea un pago ni un documento fiscal.
   * En live: categoría obligatoria, motivo de al menos 20 caracteres, referencia del cobro externo si es
   * `offline_payment`, y nunca con un cobro ya en curso. Cada aprobación en live abre una incidencia.
   */
  async approve(id: number, input: { reason: string; category?: ApprovalCategory; reference?: string | null }, actor: string) {
    const reason = (input.reason ?? "").trim();
    const live = this.mode === "live";
    if (reason.length < (live ? 20 : 5)) throw new OrderError("invalid_input", `Indica el motivo de la aprobación (mínimo ${live ? 20 : 5} caracteres)`);
    if (input.category !== undefined && !APPROVAL_CATEGORIES.includes(input.category)) throw new OrderError("invalid_input", "Tipo de aprobación no admitido");
    if (live && !input.category) throw new OrderError("invalid_input", "En el entorno real indica el tipo de aprobación (interna, promocional, partner, excepción o cobro fuera de Stripe)");
    const category: ApprovalCategory = input.category ?? "exception";
    const reference = (input.reference ?? "").trim() || null;
    if (category === "offline_payment" && (!reference || reference.length < 3)) throw new OrderError("invalid_input", "Un cobro fuera de Stripe necesita la referencia del cobro (p. ej. de la transferencia)");
    const o = await this.must(id);
    if (o.state !== "contracted") throw new OrderError("invalid_state", `Solo se aprueba un pedido con el contrato firmado (está en «${o.state}»)`);
    // Con un cobro en curso o ya hecho, aprobar sin pago podría duplicar la activación o el cobro
    if (live && (await this.d.store.payments(o.id)).some((p) => p.status === "pending" || p.status === "succeeded")) {
      throw new OrderError("invalid_state", "El pedido tiene un cobro en curso o ya cobrado: no se aprueba sin pago");
    }
    const r300 = reason.slice(0, 300);
    await this.move(
      o,
      "confirm",
      actor,
      { confirmation: { kind: "admin_approval", ref: null, actor, reason: r300, at: this.now(), category, ...(reference ? { reference: reference.slice(0, 80) } : {}) }, lastError: null },
      { basis: "admin_approval", reason: r300, category, ...(reference ? { reference: reference.slice(0, 80) } : {}) },
    );
    opsLog(live ? "warn" : "info", "Orders", "admin_approval", { orderId: o.id, category, actor, mode: this.mode });
    if (live) recordFailure("orders.admin_approval_live");
    return this.advance(id, actor);
  }

  /** Solicita el pago de PRUEBA que confirma el pedido (checkout). Idempotente: devuelve el pendiente. */
  async requestPayment(id: number, actor: string): Promise<{ payment: OrderPayment; created: boolean }> {
    const provider = this.d.payments;
    if (!provider) throw new OrderError("unavailable", "Pagos de prueba no configurados: usa la aprobación administrativa");
    const o = await this.must(id);
    if (o.state !== "contracted") throw new OrderError("invalid_state", `El pago se solicita con el contrato firmado (el pedido está en «${o.state}»)`);
    const amount = await this.amountDue(o);
    if (amount <= 0) throw new OrderError("invalid_state", "No hay importe que pagar en este pedido");
    const purpose: PaymentPurpose = o.kind === "change" ? "change" : "initial";
    const prior = (await this.d.store.payments(o.id)).filter((p) => p.purpose === purpose);
    const last = prior[prior.length - 1];
    if (last && last.status !== "failed") return { payment: last, created: false };
    const key = `ord:${o.id}:${purpose}:a${prior.length + 1}`;
    const { providerRef } = await provider.checkout({ key, amountCents: amount, currency: o.quote!.currency, description: `Pedido ${o.reference}` });
    const r = await this.d.store.insertPayment({ orderId: o.id, idempotencyKey: key, purpose, periodStart: null, amountCents: amount, currency: o.quote!.currency, status: "pending", provider: provider.kind, mode: provider.mode, providerRef, dueAt: this.now(), createdAt: this.now(), settledAt: null });
    if (r.created) await this.note(o, "payment_requested", actor, { paymentId: r.payment.id, amountCents: amount, currency: r.payment.currency, attempt: prior.length + 1 });
    return r;
  }

  /**
   * Evento del proveedor de pruebas. Solo uno firmado y verificado cuenta; cada evento se aplica una
   * vez; importe y moneda deben coincidir; un pago confirmado no se pisa con eventos tardíos.
   */
  async handlePaymentEvent(rawBody: string, signature: string) {
    if (!this.d.payments) throw new OrderError("unavailable", "Pagos de prueba no configurados");
    const ev = this.d.payments.verify(rawBody, signature, this.now());
    const r = await this.d.store.paymentEvent({ providerEventId: ev.id, type: ev.type, paymentKey: ev.paymentKey, receivedAt: this.now() }, (p) => {
      if (!p) return { outcome: "rejected", detail: "Pago desconocido", result: null };
      if (p.amountCents !== ev.amountCents || p.currency !== ev.currency) return { outcome: "rejected", detail: "Importe o moneda no coinciden con el pago", result: null };
      if (p.status === "succeeded") return { outcome: "ignored", detail: "El pago ya estaba confirmado", result: null };
      if (p.status === "failed" && ev.type === "payment.failed") return { outcome: "ignored", detail: "El pago ya constaba como fallido", result: null };
      return { status: ev.type === "payment.succeeded" ? "succeeded" : "failed", providerRef: ev.providerRef, outcome: "applied", result: null };
    });
    if (r.duplicate) return { status: "duplicate" as const, outcome: null };
    if (r.outcome !== "applied" || !r.payment) return { status: "processed" as const, outcome: r.outcome };
    try {
      await this.afterPayment(r.payment, "system:payments");
    } catch (e) {
      // El pago ya consta (misma transacción que el evento); el efecto en el pedido lo retoma `review`
      opsLog("error", "Orders", "payment_effect_pending", { orderId: r.payment.orderId, error: e instanceof Error ? e.name : "error" });
      recordFailure("orders.failed");
    }
    return { status: "processed" as const, outcome: r.outcome };
  }

  /** Efecto de un pago verificado sobre el pedido (recuperable: `review` lo repite si aquí falla). */
  private async afterPayment(p: OrderPayment, actor: string) {
    let o = await this.must(p.orderId);
    if (p.purpose !== "renewal") {
      if (p.status === "failed") return void (await this.note(o, "payment_failed", actor, { paymentId: p.id }));
      if (o.state === "contracted") await this.advance(o.id, actor);
      return;
    }
    if (p.status === "succeeded") await this.paymentRecorded(o.id, p.id);
    if (p.status === "failed" && o.state === "active") {
      await this.move(o, "payment_failed", actor, { graceEndsAt: this.now() + this.grace }, { paymentId: p.id, graceEndsAt: this.now() + this.grace });
      return;
    }
    if (p.status === "succeeded" && (o.state === "past_due" || o.state === "suspended")) {
      if ((await this.d.store.payments(o.id)).some((x) => x.purpose === "renewal" && x.status !== "succeeded")) return; // queda otro recibo sin pagar
      o = await this.move(o, "payment_recovered", actor, { graceEndsAt: null }, { paymentId: p.id });
      await this.syncLicences(o, actor, `Pago recibido: pedido ${o.reference} al corriente`);
    }
  }

  /** Cancelación: contrato cancelado → suscripción a fin de periodo → (al vencer) licencias canceladas. Nada se borra. */
  async cancel(id: number, input: { reason: string }, actor: string) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) throw new OrderError("invalid_input", "Indica el motivo de la cancelación");
    const o = await this.must(id);
    if (!LIVE.includes(o.state)) throw new OrderError("invalid_state", `Solo se cancela un pedido activo (está en «${o.state}»)`);
    if (await this.stripeBilled(o)) throw new OrderError("invalid_state", "Este pedido se cobra en Stripe: cancélalo en Stripe (Customer Portal o Dashboard del sandbox) y el cambio se reflejará solo");
    await this.cascadeCancel(o, reason, actor);
    return this.detail(id);
  }

  private async cascadeCancel(o: CommercialOrder, reason: string, actor: string) {
    const contract = o.contractId ? await this.d.crmStore.get("contracts", o.contractId) : null;
    if (contract && contract.status !== "cancelled") {
      await this.d.crm.setContractStatus(contract.id, "cancelled", actor);
      await this.d.crm.log("contract", contract.id, "note", `Cancelación (pedido ${o.reference}): ${reason}`, actor);
    }
    const sub = await this.d.subscriptions.must(o.subscriptionId!);
    if (sub.status !== "canceled" && sub.cancelAt === null) await this.d.subscriptions.scheduleCancel(sub.id, { reason }, sub.version, actor);
    const after = await this.d.subscriptions.must(o.subscriptionId!);
    return this.move(o, "cancel", actor, {}, { reason, cancelAt: after.cancelAt });
  }

  /** Abandono antes de confirmar: el contrato se cancela y no se activa nada. */
  async reject(id: number, input: { reason: string }, actor: string) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) throw new OrderError("invalid_input", "Indica el motivo");
    const o = await this.must(id);
    if (await this.stripeBilled(o)) throw new OrderError("invalid_state", "Este pedido se cobra en Stripe: cancélalo en Stripe (Customer Portal o Dashboard del sandbox) y el cambio se reflejará solo");
    const contract = o.contractId ? await this.d.crmStore.get("contracts", o.contractId) : null;
    if (nextOrderState(o.state, "reject") && contract && contract.status !== "cancelled" && contract.status !== "active") await this.d.crm.setContractStatus(contract.id, "cancelled", actor);
    return this.move(o, "reject", actor, {}, { reason });
  }

  /**
   * Renovación sincronizada: aplica los periodos vencidos de la suscripción, reaplica licencias, deja
   * constancia en el contrato y, si el pedido se paga en línea, emite el recibo de PRUEBA del periodo
   * nuevo (nunca se cobra solo). Una cancelación programada termina aquí: licencias canceladas.
   */
  async renew(id: number, actor: string) {
    let o = await this.must(id);
    if (!LIVE.includes(o.state) && o.state !== "cancel_scheduled") throw new OrderError("invalid_state", `El pedido está en «${o.state}»: no se renueva`);
    const before = await this.d.subscriptions.must(o.subscriptionId!);
    const sub = await this.d.subscriptions.applyRenewals(before.id, actor);
    if (sub.status === "canceled") {
      if (LIVE.includes(o.state)) o = await this.move(o, "cancel", actor, {}, { reason: "Suscripción cancelada", cancelAt: sub.canceledAt });
      const changed = (await this.d.licensing.apply(sub.id, { activate: true, actor, reason: `Fin del pedido ${o.reference}` })).applied.length;
      o = await this.move(o, "cancelled", actor, { graceEndsAt: null }, { canceledAt: sub.canceledAt, licencesCancelled: changed });
      return { order: o, subscription: sub, payment: null };
    }
    if (sub.currentPeriodStart === before.currentPeriodStart) return { order: o, subscription: sub, payment: null };
    const changed = await this.syncLicences(o, actor, `Renovación del pedido ${o.reference}`);
    if (o.contractId) await this.d.crm.log("contract", o.contractId, "note", `Periodo renovado (suscripción #${sub.id}) hasta ${new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)}`, actor);
    let payment: OrderPayment | null = null;
    // Los pedidos cobrados por Stripe Billing renuevan en Stripe: aquí no se emite ningún recibo simulado
    const own = await this.d.store.payments(o.id);
    const online = own.some((p) => p.status === "succeeded") && !own.some((p) => isStripeProvider(p.provider));
    if (online && this.d.payments) {
      const amount = (await this.d.shadow.preview(sub.id)).drafts.filter((x) => x.kind === "renewal").reduce((a, x) => a + x.totalCents, 0);
      if (amount > 0) {
        const key = `ord:${o.id}:renewal:${sub.currentPeriodStart}`;
        const { providerRef } = await this.d.payments.checkout({ key, amountCents: amount, currency: sub.currency, description: `Renovación ${o.reference}` });
        payment = (await this.d.store.insertPayment({ orderId: o.id, idempotencyKey: key, purpose: "renewal", periodStart: sub.currentPeriodStart, amountCents: amount, currency: sub.currency, status: "pending", provider: this.d.payments.kind, mode: this.d.payments.mode, providerRef, dueAt: sub.currentPeriodStart, createdAt: this.now(), settledAt: null })).payment;
      }
    }
    o = await this.note(await this.must(id), "renewed", actor, { periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, licencesChanged: changed, paymentId: payment?.id ?? null });
    return { order: o, subscription: sub, payment };
  }

  /**
   * Revisión EXPLÍCITA (nada la programa sola): impagos (gracia → suspensión), recibos vencidos,
   * fin de periodos con cancelación, contratos cancelados fuera del orquestador y pedidos atascados.
   */
  async review(actor: string) {
    const now = this.now();
    const out = { suspended: 0, pastDue: 0, renewed: 0, cancelled: 0, cascaded: 0, resumed: 0, errors: [] as Array<{ orderId: number; error: string }> };
    const run = async (o: CommercialOrder, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        out.errors.push({ orderId: o.id, error: message(e) });
      }
    };
    for (const o of await this.d.store.list({ states: ["active", "past_due", "suspended", "cancel_scheduled"], limit: 1000 })) {
      await run(o, async () => {
        let cur = o;
        const stripe = await this.stripeBilled(cur);
        // Contrato cancelado fuera del orquestador: la suscripción se cancela a fin de periodo
        const contract = cur.contractId ? await this.d.crmStore.get("contracts", cur.contractId) : null;
        if (stripe && LIVE.includes(cur.state) && contract?.status === "cancelled") {
          // En Stripe sigue viva: no se cancela aquí (volvería a reactivarse); se avisa para cancelarla allí
          opsLog("warn", "Orders", "stripe_contract_cancelled", { orderId: cur.id });
          recordFailure("orders.stripe_contract_cancelled");
        } else if (LIVE.includes(cur.state) && contract?.status === "cancelled") {
          cur = await this.cascadeCancel(cur, "Contrato cancelado en el CRM", actor);
          out.cascaded++;
        }
        const sub = cur.subscriptionId ? await this.d.subscriptions.must(cur.subscriptionId) : null;
        if (sub && sub.status !== "canceled" && now >= sub.currentPeriodEnd) {
          const r = await this.renew(cur.id, actor);
          cur = r.order;
          if (cur.state === "cancelled") out.cancelled++;
          else out.renewed++;
        }
        if (cur.state === "active") {
          const due = (await this.d.store.payments(cur.id)).find((p) => p.purpose === "renewal" && p.status !== "succeeded" && p.dueAt !== null && p.dueAt <= now);
          if (due) {
            cur = await this.move(cur, "payment_failed", actor, { graceEndsAt: due.dueAt! + this.grace }, { paymentId: due.id, reason: "Recibo vencido sin pagar", graceEndsAt: due.dueAt! + this.grace });
            out.pastDue++;
          }
        }
        if (!stripe && cur.state === "past_due" && cur.graceEndsAt !== null && cur.graceEndsAt <= now) {
          cur = await this.move(cur, "suspend", actor, {}, { reason: "Fin del periodo de gracia sin pago" });
          await this.syncLicences(cur, actor, `Suspensión por impago (pedido ${cur.reference}); los datos se conservan`);
          out.suspended++;
        }
      });
    }
    // Recuperación: pedidos confirmados o con pago verificado que no llegaron al final
    for (const o of await this.d.store.list({ states: ["contracted", "confirmed", "subscribed", "licensed"], limit: 1000 })) {
      if (o.state === "contracted" && !(await this.d.store.payments(o.id)).some((p) => this.verifiedPayment(p))) continue;
      await run(o, async () => {
        const r = await this.advance(o.id, actor);
        if (r.error) throw new OrderError("invalid_state", r.error);
        out.resumed++;
      });
    }
    return out;
  }
  // ── Cobro externo verificado (Stripe Billing) ───────────────────────────────

  /**
   * Estado de cobro VERIFICADO en un proveedor externo (Stripe Billing: el objeto se relee en su API,
   * nunca se toma del cuerpo de un evento). Refleja impago con gracia, suspensión, recuperación,
   * cancelación programada, reactivación y fin de la suscripción. Idempotente: el mismo estado aplicado
   * dos veces no cambia nada. Los pedidos aún en alta o ya terminados no se tocan. Nunca borra datos:
   * lo peor es solo lectura.
   *
   * `coverageLost`: el cobro que cubría el periodo se ha revertido (reembolso total o disputa perdida). El
   * pedido se suspende aunque Stripe siga mostrando la suscripción activa, y NO se reactiva solo mientras
   * dure la retención (la levanta un pago nuevo, una disputa ganada o un operador).
   */
  async applyExternalBilling(id: number, s: { status: "active" | "past_due" | "unpaid" | "canceled"; cancelAt: number | null; coverageLost?: boolean }, actor: string): Promise<{ order: CommercialOrder; changed: OrderAction[] }> {
    let o = await this.must(id);
    const changed: OrderAction[] = [];
    if (!LIVE.includes(o.state) && o.state !== "cancel_scheduled") return { order: o, changed };
    const step = async (action: OrderAction, patch: OrderPatch, detail: Record<string, unknown>) => {
      o = await this.move(o, action, actor, patch, { source: "stripe", ...detail });
      changed.push(action);
    };
    if (s.status === "canceled") {
      if (LIVE.includes(o.state)) await step("cancel", {}, { reason: "Suscripción cancelada en Stripe" });
      const contract = o.contractId ? await this.d.crmStore.get("contracts", o.contractId) : null;
      if (contract && contract.status !== "cancelled") {
        await this.d.crm.setContractStatus(contract.id, "cancelled", actor);
        await this.d.crm.log("contract", contract.id, "note", `Fin de la suscripción en Stripe (pedido ${o.reference})`, actor);
      }
      const n = await this.markLicences(o, "read_only", actor, `Fin de la suscripción (pedido ${o.reference}): solo lectura, los datos se conservan`);
      await step("cancelled", { graceEndsAt: null }, { licencesReadOnly: n });
      return { order: o, changed };
    }
    if (s.coverageLost) {
      const reason = `Cobro revertido en Stripe (pedido ${o.reference}): acceso suspendido, los datos se conservan`;
      if (o.state === "active") await step("payment_failed", { graceEndsAt: this.now() }, { reason: "coverage_lost", graceEndsAt: this.now() });
      if (o.state === "past_due") {
        await step("suspend", {}, { reason: "Cobro revertido (reembolso total o disputa perdida)" });
        await this.syncLicences(o, actor, reason);
      }
      if (o.state === "cancel_scheduled" && (await this.markLicences(o, "suspended", actor, reason))) changed.push("suspend");
      // Sin recuperación, reactivación ni cambios de fecha mientras dure la retención
      return { order: o, changed };
    }
    if (s.status === "active" && (o.state === "past_due" || o.state === "suspended")) {
      await step("payment_recovered", { graceEndsAt: null }, {});
      await this.syncLicences(o, actor, `Pago recibido en Stripe: pedido ${o.reference} al corriente`);
    }
    if ((s.status === "past_due" || s.status === "unpaid") && o.state === "active") {
      await step("payment_failed", { graceEndsAt: this.now() + this.grace }, { graceEndsAt: this.now() + this.grace });
    }
    if (s.status === "unpaid" && o.state === "past_due") {
      await step("suspend", {}, { reason: "Stripe agotó los reintentos de cobro" });
      await this.syncLicences(o, actor, `Suspensión por impago (pedido ${o.reference}); los datos se conservan`);
    }
    // La fecha de fin la decide Stripe (`cancel_at`): la suscripción interna NO se programa para cancelarse,
    // así su fin de periodo nunca corta antes el acceso que el cliente ha pagado. El fin llega con «canceled».
    if (s.cancelAt !== null && LIVE.includes(o.state)) {
      await step("cancel", {}, { cancelAt: s.cancelAt });
    } else if (s.cancelAt === null && s.status === "active" && o.state === "cancel_scheduled" && (await this.lastCancelFromStripe(o))) {
      await step("reactivate", {}, {});
      await this.syncLicences(o, actor, `Cancelación deshecha en Stripe: pedido ${o.reference}`);
    }
    // Con la cancelación programada siguen valiendo el impago y la recuperación
    if (o.state === "cancel_scheduled" && s.status === "unpaid") {
      if (await this.markLicences(o, "suspended", actor, `Impago con cancelación programada (pedido ${o.reference}); los datos se conservan`)) changed.push("suspend");
    } else if (o.state === "cancel_scheduled" && s.status === "active") {
      await this.syncLicences(o, actor, `Pedido ${o.reference} al corriente en Stripe`);
    }
    return { order: o, changed };
  }

  /** ¿El pedido se cobra en Stripe Billing? (tiene pagos verificados de Stripe). */
  private async stripeBilled(o: CommercialOrder) {
    return (await this.d.store.payments(o.id)).some((p) => isStripeProvider(p.provider));
  }

  /** ¿La última cancelación del pedido vino de Stripe? Solo esa la puede deshacer Stripe. */
  private async lastCancelFromStripe(o: CommercialOrder) {
    const last = (await this.d.store.events(o.id)).filter((e) => e.kind === "cancel").pop();
    return !!last && last.detail?.source === "stripe";
  }

  /** Lleva las licencias propias de la suscripción del pedido a un estado (suspendidas o solo lectura). */
  private async markLicences(o: CommercialOrder, status: "suspended" | "read_only", actor: string, reason: string) {
    if (!o.subscriptionId || !o.tenantId) return 0;
    const source = `subscription:${o.subscriptionId}`;
    const own = (await this.d.capabilities.list(o.tenantId)).filter((g) => g.source === source && g.status !== "cancelled" && g.status !== status);
    if (!own.length) return 0;
    return (await this.d.capabilities.apply(o.tenantId, own.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId, status, validUntil: g.validUntil, source })), { actor, reason, now: this.now() })).length;
  }
}
