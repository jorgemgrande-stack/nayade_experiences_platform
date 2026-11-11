/**
 * Puesta en cobro y estado de pago en Stripe de una suscripción con condiciones comerciales personalizadas (fase 4),
 * sobre la integración de Stripe que YA existe: el mismo Customer por empresa (`stripe_customers`), el mismo Checkout
 * alojado por Stripe, los mismos webhooks firmados y la misma conciliación. No hay otra cuenta, otra clave ni otro
 * destino de webhooks.
 *
 * Cerrojos (todos necesarios):
 *  1. el interruptor `CP_CUSTOM_TERMS_BILLING_ENABLED=1` (apagado: aquí no se llama a Stripe ni se crea nada);
 *  2. la pasarela real (`stripeGateway.ts`) montada sobre el Stripe del entorno;
 *  3. que un OPERADOR ponga a cobrar ESA suscripción (`start`): es lo único que crea su fila en
 *     `commercial_terms_billing`. Encender el interruptor no cobra a nadie, y una suscripción ordinaria (de un pedido)
 *     nunca entra aquí.
 *
 * Cómo empieza el cobro: `start` abre una sesión de Checkout en modo suscripción con las partidas pactadas como
 * precio en línea (sin Prices públicos) y los cargos únicos ya vencidos; el CLIENTE pone su método de pago en la
 * página de Stripe. Repetir `start` devuelve la misma sesión mientras siga viva y ofrezca lo mismo: nunca hay dos
 * sesiones vivas ni dos suscripciones. Al completarse el pago, el webhook de siempre enlaza la suscripción de Stripe
 * con la interna; desde ahí, cambiar las condiciones es la sincronización (`billing.ts`).
 *
 * Estado de pago: llega por los webhooks y la conciliación existentes, releyendo siempre la suscripción y su factura
 * en Stripe (un evento repetido o fuera de orden no cambia nada). Reglas, las mismas que el cobro ordinario
 * (`orchestrator.applyExternalBilling`): impago → gracia de GRACE_DAYS; reintentos agotados o gracia vencida →
 * licencias suspendidas; cobro recuperado → se devuelven; fin en Stripe → solo lectura READ_ONLY_DAYS; cobro revertido
 * (reembolso total o disputa perdida) → suspendida hasta un pago nuevo. Las licencias siguen saliendo del CONTRATO
 * (los productos del acuerdo, `licences.ts`); el pago solo las suspende, las deja en solo lectura o las devuelve, y
 * solo las propias de la suscripción (`subscription:<id>`).
 */
import crypto from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { getAuth, requireScope } from "../controlPlane/auth";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CapabilityChange, CapabilityStore } from "../_core/capabilities/store";
import type { CrmStore } from "../crm/store";
import { GRACE_DAYS, READ_ONLY_DAYS } from "../orchestrator/service";
import { INTEGRATION_IDENTIFIER, LIVE_TAX_NOTICE, LIVE_TAX_TREATMENT, SESSION_TTL_MS, TEST_TAX_NOTICE, TEST_TAX_TREATMENT, eligibilityMessage, spanishTaxIdOf } from "../stripe/checkout";
import type { StripeMode, StripeTaxPolicy } from "../stripe/config";
import { checkEligibility, type EligibilityConfig } from "../stripe/eligibility";
import { StripeMismatchError, coverageLostOf } from "../stripe/events";
import { StripeGatewayError, type GwCharge, type GwCheckoutSession, type GwInvoice, type GwSubscription, type StripeGateway } from "../stripe/gateway";
import { checkoutStatusView, type CheckoutStatusView } from "../stripe/status";
import type { StripeStore } from "../stripe/store";
import { needsVies, type VatVerifier } from "../stripe/vies";
import type { SubscriptionService } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import type { BillingLink, BillingPlan, NegotiatedBillingGateway, TermsBillingService } from "./billing";
import { BillingStoreConflict, LINKED_STATES, type BillingState, type CheckoutOffer, type TermsBillingPatch, type TermsBillingRow, type TermsBillingStore } from "./billingStore";
import { requireCustomPricing } from "./permission";
import { NEGOTIATED_MARK, NegotiatedGatewayError, StripeNegotiatedGateway } from "./stripeGateway";
import type { TermsStore } from "./store";

const DAY = 86_400_000;
/** Por debajo de este margen, una sesión abierta se sustituye en lugar de reutilizarse. */
const REUSE_MARGIN_MS = 10 * 60_000;
const MAX_KEY_ATTEMPTS = 3;

export class NegotiatedBillingError extends Error {
  constructor(
    public readonly code: "disabled" | "not_found" | "invalid_state" | "unavailable" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "NegotiatedBillingError";
  }
}

export type StartResult =
  | {
      status: "pending";
      subscriptionId: number;
      sessionId: string;
      /** Página de pago alojada por Stripe: se entrega al cliente. */
      url: string | null;
      expiresAt: number;
      reused: boolean;
      currency: string;
      /** Cuota recurrente y primer pago, sin impuestos (céntimos). */
      recurringCents: number;
      firstChargeCents: number;
      taxTreatment: string;
      /** Abonos de un solo uso que irán en la factura siguiente (Checkout no admite importes negativos). */
      deferredCredits: Array<{ key: string; name: string; amountCents: number }>;
    }
  | { status: "linked"; subscriptionId: number; stripeSubscriptionId: string; state: BillingState }
  | { status: "processing"; subscriptionId: number; message: string };

export interface NegotiatedBillingDeps {
  /** Interruptor `CP_CUSTOM_TERMS_BILLING_ENABLED`. */
  enabled: boolean;
  store: TermsBillingStore;
  stripeStore: Pick<StripeStore, "customerByCompany" | "linkCustomer" | "acquireLease" | "releaseLease">;
  gateway: StripeGateway;
  adapter: StripeNegotiatedGateway;
  billing: Pick<TermsBillingService, "plan" | "syncIfOpen" | "recordSent" | "reconcile">;
  termsStore: Pick<TermsStore, "get" | "log">;
  subscriptionStore: Pick<SubscriptionStore, "get">;
  /** Suscripción interna: sus periodos siguen a los cobros de Stripe y su fin, al de Stripe. */
  subscriptions?: Pick<SubscriptionService, "applyRenewals" | "scheduleCancel">;
  crmStore: Pick<CrmStore, "get" | "list">;
  /** Registro de licencias: solo para suspender, dejar en solo lectura o devolver las PROPIAS de la suscripción. */
  capabilities?: Pick<CapabilityStore, "list" | "apply">;
  /** Tras devolver las licencias, se alinean con lo contratado (aplicación restringida de `licences.ts`). */
  licences?: { ensure(subscriptionId: number, actor: string, o?: { changed?: boolean }): Promise<unknown> };
  /** ¿La cobra ya el circuito ordinario (pedido con pagos de Stripe)? Entonces nunca se toca desde aquí. */
  orderBilled?: (subscriptionId: number) => Promise<boolean>;
  urls: { success: string; cancel: string };
  namespace: string;
  mode: StripeMode;
  taxPolicy: StripeTaxPolicy | null;
  /** En live, el mismo control de elegibilidad fiscal que el Checkout ordinario, con los datos fiscales de la empresa. */
  fiscal?: { config: EligibilityConfig; vat?: Pick<VatVerifier, "verify"> };
  graceDays?: number;
  readOnlyDays?: number;
  now?: () => number;
}

type Company = { id: number; name: string; legalName?: string | null; taxId?: string | null; address?: string | null; postalCode?: string | null; city?: string | null; country?: string | null; billingEmail?: string | null; email?: string | null; tenantId?: string | null };

const offerHash = (plan: BillingPlan, oneOffs: Record<string, number>) => crypto.createHash("sha256").update(JSON.stringify({ c: plan.currency, i: plan.items.map((i) => [i.key, i.amountCents, i.interval]).sort(), o: Object.entries(oneOffs).sort() })).digest("hex").slice(0, 24);

/** Estado interno que corresponde a un estado de suscripción de Stripe (igual que el cobro ordinario). null: sin efecto. */
export const mapStripeStatus = (s: GwSubscription["status"]): "active" | "past_due" | "unpaid" | "canceled" | null =>
  s === "active" || s === "trialing" ? "active" : s === "past_due" ? "past_due" : s === "unpaid" || s === "paused" ? "unpaid" : s === "canceled" || s === "incomplete_expired" ? "canceled" : null;

/**
 * Impuesto de una factura de Stripe frente al tipo pactado. Con Stripe Tax el tipo lo decide Stripe según el cliente:
 * aquí se comprueba que el resultado es el que dice el acuerdo (un mismo tipo: base × tipo, con un céntimo de holgura
 * por línea; tipos distintos: entre el menor y el mayor). null: no hay nada que comprobar (pruebas, sin impuestos).
 */
export function invoiceTaxCheck(policy: StripeTaxPolicy | null, ratesBp: number[], inv: Pick<GwInvoice, "subtotal" | "taxCents" | "lines">): "ok" | "tax_unknown" | "tax_mismatch" | null {
  if (policy !== LIVE_TAX_TREATMENT || !ratesBp.length) return null;
  if (inv.taxCents === null || inv.taxCents === undefined || inv.subtotal === null) return "tax_unknown";
  const slack = Math.max(1, inv.lines?.length ?? 1);
  const lo = Math.round((inv.subtotal * Math.min(...ratesBp)) / 10_000);
  const hi = Math.round((inv.subtotal * Math.max(...ratesBp)) / 10_000);
  return inv.taxCents >= Math.min(lo, hi) - slack && inv.taxCents <= Math.max(lo, hi) + slack ? "ok" : "tax_mismatch";
}

export class NegotiatedBillingService {
  private now: () => number;
  private grace: number;
  private readOnly: number;
  private actor = "system:stripe";
  /** Tratamiento fiscal efectivo; null en live sin política decidida (no se cobra). */
  private policy: StripeTaxPolicy | null;
  constructor(private d: NegotiatedBillingDeps) {
    this.now = d.now ?? Date.now;
    this.grace = (d.graceDays ?? GRACE_DAYS) * DAY;
    this.readOnly = (d.readOnlyDays ?? READ_ONLY_DAYS) * DAY;
    this.policy = d.mode === "test" ? TEST_TAX_TREATMENT : d.taxPolicy === LIVE_TAX_TREATMENT ? LIVE_TAX_TREATMENT : null;
  }

  // ── Cerrojos ────────────────────────────────────────────────────────────────

  /** Enlace con Stripe de una suscripción: SOLO si un operador la puso a cobrar y su suscripción de Stripe sigue viva. */
  link = async (subscriptionId: number): Promise<BillingLink | null> => {
    const r = await this.d.store.bySubscription(subscriptionId);
    return r && r.stripeSubscriptionId && LINKED_STATES.includes(r.status) ? { customerId: r.stripeCustomerId, subscriptionId: r.stripeSubscriptionId } : null;
  };

  /** ¿Consta esta suscripción de Stripe como puesta a cobrar por un operador? (segundo cerrojo de la pasarela). */
  allowed = async (stripeSubscriptionId: string): Promise<boolean> => !!(await this.d.store.byStripeSubscription(stripeSubscriptionId));

  /**
   * Pasarela para `TermsBillingService`: la real, y además reconoce como ya cobrados los cargos únicos que fueron en
   * el primer pago del Checkout (allí no llevan metadato propio; constan en la oferta de la sesión, cuyo importe se
   * contrastó con la primera factura).
   */
  gatewayFor(): NegotiatedBillingGateway {
    const a = this.d.adapter;
    return {
      applyItems: (i, k) => a.applyItems(i, k),
      addOneOff: (i, k) => a.addOneOff(i, k),
      current: (id) => a.current(id),
      setCancelAtPeriodEnd: (id, c, k) => a.setCancelAtPeriodEnd(id, c, k),
      findOneOff: async (id, key) => {
        const hit = await a.findOneOff(id, key);
        if (hit) return hit;
        const row = await this.d.store.byStripeSubscription(id);
        const cents = row?.checkout?.oneOffs[key];
        return row && row.linkedAt !== null && cents !== undefined ? { ref: `checkout:${row.sessionId ?? row.id}`, amountCents: cents } : null;
      },
    };
  }

  private async withLease<T>(subscriptionId: number, fn: () => Promise<T>, busy: () => Error): Promise<T> {
    const lease = `terms-billing:${subscriptionId}`;
    const until = this.now() + 2 * 60_000;
    if (!(await this.d.stripeStore.acquireLease(lease, until, this.now()))) throw busy();
    try {
      return await fn();
    } finally {
      await this.d.stripeStore.releaseLease(lease, until);
    }
  }

  private async patch(row: TermsBillingRow, patch: TermsBillingPatch): Promise<TermsBillingRow> {
    return this.d.store.patch(row.id, patch, row.version, this.now());
  }

  private async history(termsId: number | null, kind: string, reason: string, after: unknown, actor: string) {
    if (termsId === null) return;
    await this.d.termsStore.log(termsId, { kind, actor, reason: reason.slice(0, 500), before: null, after, effectiveAt: null, acceptanceStatus: null, syncResult: null, economic: null }, this.now()).catch(() => undefined);
  }

  // ── Puesta en cobro (acción expresa de un operador) ─────────────────────────

  /** Qué impide poner a cobrar la suscripción (vacío: se puede). No llama a Stripe. */
  private async blockers(subscriptionId: number, plan: BillingPlan): Promise<string[]> {
    const out: string[] = [];
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) return ["Suscripción no encontrada"];
    if (sub.status !== "active") out.push(sub.status === "trialing" ? "La suscripción está en periodo de prueba" : "La suscripción está cancelada");
    if (sub.cancelAt != null) out.push("La suscripción tiene su cancelación programada");
    if (plan.termsId === null || !plan.items.length) out.push("La suscripción no tiene condiciones personalizadas vigentes con cuotas recurrentes");
    else if ((await this.d.termsStore.get(plan.termsId))?.status !== "active") out.push("Las condiciones personalizadas no están activas (aceptadas y en vigor)");
    if (this.d.orderBilled && (await this.d.orderBilled(subscriptionId))) out.push("La suscripción ya se cobra en Stripe por el circuito ordinario (pedido): no admite el cobro de condiciones personalizadas");
    if (!this.policy) out.push("Política fiscal pendiente: en modo live no se cobra hasta decidir el tratamiento fiscal (CP_STRIPE_TAX_POLICY)");
    return out;
  }

  /**
   * Pone a cobrar la suscripción: abre (o reutiliza) su sesión de Checkout con las partidas pactadas. Idempotente: con
   * la suscripción ya enlazada devuelve el enlace; con una sesión viva que ofrece lo mismo, esa sesión.
   */
  async start(subscriptionId: number, actor: string): Promise<StartResult> {
    if (!this.d.enabled) throw new NegotiatedBillingError("disabled", "El cobro en Stripe de condiciones personalizadas está apagado (CP_CUSTOM_TERMS_BILLING_ENABLED): la suscripción sigue en simulación de facturación");
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new NegotiatedBillingError("not_found", "Suscripción no encontrada");
    return this.withLease(subscriptionId, () => this.startLocked(subscriptionId, sub.companyId, actor), () => new NegotiatedBillingError("conflict", "Ya se está poniendo a cobrar esta suscripción: inténtalo de nuevo en unos segundos"));
  }

  private async startLocked(subscriptionId: number, companyId: number, actor: string): Promise<StartResult> {
    let row = await this.d.store.bySubscription(subscriptionId);
    // Ya enlazada: nunca una segunda suscripción de Stripe
    if (row?.stripeSubscriptionId && row.status !== "abandoned") {
      if (row.status === "canceled") throw new NegotiatedBillingError("invalid_state", "El cobro en Stripe de esta suscripción ya terminó: requiere una contratación nueva");
      if (row.status === "pending") return { status: "processing", subscriptionId, message: "El cliente ya completó la página de pago: falta la confirmación del cobro por Stripe" };
      return { status: "linked", subscriptionId, stripeSubscriptionId: row.stripeSubscriptionId, state: row.status };
    }
    const plan = await this.d.billing.plan(subscriptionId, { settle: true });
    const blockers = await this.blockers(subscriptionId, plan);
    if (blockers.length) throw new NegotiatedBillingError("invalid_state", blockers.join(". "));
    const policy = this.policy!;
    // Partidas: forma válida y Product de Stripe de cada una (el catálogo enlazado; nunca se crea nada en él)
    let products: Map<string, string>;
    try {
      StripeNegotiatedGateway.check(plan.items);
      products = await this.d.adapter.productsFor(plan.items);
    } catch (e) {
      if (e instanceof NegotiatedGatewayError) throw new NegotiatedBillingError("unavailable", e.message);
      throw e;
    }
    // Cargos únicos ya vencidos: van en el primer pago. Los abonos (importe negativo) no caben en Checkout: a la factura siguiente
    const due = plan.oneOffs.filter((o) => o.due);
    const charges = due.filter((o) => o.amountCents > 0);
    const credits = due.filter((o) => o.amountCents < 0);
    // Los cargos únicos van sobre el Product genérico (no se crea un Product por cargo)
    const chargeProduct = charges.length ? await this.d.adapter.customServiceProduct().catch((e) => Promise.reject(e instanceof NegotiatedGatewayError ? new NegotiatedBillingError("unavailable", e.message) : e)) : null;
    const oneOffs = Object.fromEntries(charges.map((o) => [o.key, o.amountCents]));
    const offer: CheckoutOffer = { hash: offerHash(plan, oneOffs), termsId: plan.termsId!, currency: plan.currency.toUpperCase(), recurringCents: plan.recurringNetCents, firstChargeCents: plan.recurringNetCents + charges.reduce((a, o) => a + o.amountCents, 0), oneOffs, deferredCredits: credits.map((o) => o.key), taxTreatment: policy };
    const view = (s: GwCheckoutSession, reused: boolean): StartResult => ({ status: "pending", subscriptionId, sessionId: s.id, url: s.url, expiresAt: s.expiresAt * 1000, reused, currency: offer.currency, recurringCents: offer.recurringCents, firstChargeCents: offer.firstChargeCents, taxTreatment: policy, deferredCredits: credits.map((o) => ({ key: o.key, name: o.name, amountCents: o.amountCents })) });

    const company = (await this.d.crmStore.get("companies", companyId)) as Company | null;
    if (!company) throw new NegotiatedBillingError("not_found", "Empresa no encontrada");
    const buyer = await this.eligible(company);
    const customerId = row?.stripeCustomerId ?? (await this.ensureCustomer(company, buyer));
    if (!row) row = (await this.d.store.create({ subscriptionId, companyId, stripeCustomerId: customerId, startedBy: actor, now: this.now() })).row;
    if (row.stripeCustomerId !== customerId) throw new NegotiatedBillingError("conflict", "El cliente de Stripe de la empresa no es el del registro de cobro: requiere revisión");
    const now = this.now();

    // Sesión viva: se reutiliza si ofrece exactamente lo mismo; si no, se cierra antes de abrir otra
    if (row.sessionId && row.status !== "abandoned") {
      const s = await this.d.gateway.checkoutSession(row.sessionId);
      if (s && s.status === "open" && s.expiresAt * 1000 > now + REUSE_MARGIN_MS && row.checkout?.hash === offer.hash) return view(s, true);
      const closed = s && s.status === "open" ? await this.d.gateway.expireCheckoutSession(s.id).catch(async () => (await this.d.gateway.checkoutSession(s.id)) ?? s) : s;
      if (closed?.status === "complete") {
        const adopted = await this.adopt(row, closed);
        if (adopted) return adopted;
        row = (await this.d.store.bySubscription(subscriptionId)) ?? row;
      } else if (closed?.status === "open") throw new NegotiatedBillingError("unavailable", "No se pudo cerrar la sesión de pago anterior en Stripe: inténtalo de nuevo");
      else row = await this.patch(row, { sessionStatus: "expired" });
    }
    // Sesiones de ESTA suscripción que existen en Stripe y no constan aquí (caída entre crearlas y guardarlas): una
    // pagada se adopta; una abierta se cierra. Así nunca quedan dos sesiones vivas
    for (const s of await this.d.gateway.sessionsOfCustomer(customerId)) {
      if (s.metadata.es_terms_subscription !== String(subscriptionId) || s.metadata.es_env !== this.d.namespace || s.metadata[NEGOTIATED_MARK] !== "1" || s.id === row.sessionId) continue;
      if (s.status === "expired") continue;
      const closed = s.status === "open" ? await this.d.gateway.expireCheckoutSession(s.id).catch(async () => (await this.d.gateway.checkoutSession(s.id)) ?? s) : s;
      if (s.status === "open") opsLog("warn", "CommercialTerms", "billing_orphan_session", { subscriptionId, status: closed.status });
      if (closed.status === "complete") {
        const adopted = await this.adopt(row, closed);
        if (adopted) return adopted;
        row = (await this.d.store.bySubscription(subscriptionId)) ?? row;
      }
      if (closed.status === "open") throw new NegotiatedBillingError("unavailable", "Hay una sesión de pago abierta en Stripe que no se pudo cerrar: inténtalo de nuevo");
    }
    if (!this.d.gateway.createNegotiatedCheckoutSession) throw new NegotiatedBillingError("unavailable", "El acceso a Stripe no admite el Checkout de condiciones personalizadas");

    const metadata: Record<string, string> = { [NEGOTIATED_MARK]: "1", es_terms_subscription: String(subscriptionId), es_terms: String(plan.termsId), es_company_id: String(companyId), es_env: this.d.namespace, es_tax_treatment: policy, ...(company.tenantId ? { es_tenant_id: company.tenantId } : {}) };
    const lines = [
      ...plan.items.map((i) => ({ productId: products.get(i.key)!, unitAmount: i.amountCents, currency: offer.currency, interval: i.interval })),
      ...charges.map((o) => ({ productId: chargeProduct!, unitAmount: o.amountCents, currency: offer.currency, interval: null })),
    ];
    let session: GwCheckoutSession | null = null;
    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS && !session; attempt++) {
      // El número de intento se guarda ANTES de crear: tras una caída, la sesión huérfana se encuentra por sus metadatos
      row = await this.patch(row, { sessionSeq: row.sessionSeq + 1, sessionId: null, sessionStatus: null, sessionExpiresAt: null, checkout: offer, status: "pending", stripeSubscriptionId: null });
      try {
        const s = await this.d.gateway.createNegotiatedCheckoutSession(
          {
            customerId,
            lines,
            clientReferenceId: `es-terms-${subscriptionId}`,
            metadata,
            successUrl: `${this.d.urls.success}?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: this.d.urls.cancel,
            expiresAt: Math.floor((now + SESSION_TTL_MS) / 1000),
            integrationIdentifier: INTEGRATION_IDENTIFIER,
            notice: policy === LIVE_TAX_TREATMENT ? LIVE_TAX_NOTICE : TEST_TAX_NOTICE,
            ...(policy === LIVE_TAX_TREATMENT ? { automaticTax: true } : {}),
          },
          `es-${this.d.namespace}-terms-checkout-${subscriptionId}-${row.sessionSeq}`,
        );
        if (s.status === "open" && s.expiresAt * 1000 > now + REUSE_MARGIN_MS) session = s;
        else if (s.status === "complete") {
          // Stripe repitió la respuesta de un intento anterior ya pagado: se adopta en lugar de abrir otra
          const adopted = await this.adopt(row, (await this.d.gateway.checkoutSession(s.id)) ?? s);
          if (adopted) return adopted;
          row = (await this.d.store.bySubscription(subscriptionId)) ?? row;
        }
      } catch (e) {
        // Clave ya usada con otros parámetros (un intento anterior que no llegó a registrarse): se usa la siguiente
        if (!(e instanceof StripeGatewayError && e.code === "idempotency_error")) throw e;
        opsLog("warn", "CommercialTerms", "billing_idempotency_key_skipped", { subscriptionId, attempt: row.sessionSeq });
      }
    }
    if (!session) throw new NegotiatedBillingError("unavailable", "Stripe no devolvió una sesión de pago utilizable: inténtalo de nuevo");
    row = await this.patch(row, { sessionId: session.id, sessionStatus: "open", sessionExpiresAt: session.expiresAt * 1000 });
    opsLog("info", "CommercialTerms", "billing_started", { subscriptionId, sessionId: session.id, actor });
    await this.history(plan.termsId, "billing_started", "Puesta en cobro en Stripe: sesión de pago creada para el cliente", { subscriptionId, sessionId: session.id, recurringCents: offer.recurringCents, firstChargeCents: offer.firstChargeCents, deferredCredits: offer.deferredCredits, taxTreatment: policy }, actor);
    return view(session, false);
  }

  /**
   * La sesión ya está completada: se enlaza su suscripción (lo mismo que hará el webhook). null si esa suscripción ya
   * murió sin cobrarse (el cliente no llegó a pagar): la sesión no vale y se puede abrir otra.
   */
  private async adopt(row: TermsBillingRow, s: GwCheckoutSession): Promise<StartResult | null> {
    const sub = s.subscriptionId ? await this.d.gateway.subscription(s.subscriptionId) : null;
    if (sub && mapStripeStatus(sub.status) === "canceled" && row.stripeSubscriptionId !== sub.id) return null;
    if (sub && row.status === "abandoned" && row.stripeSubscriptionId === sub.id) return null;
    if (row.sessionId !== s.id || row.sessionStatus !== "complete") row = await this.patch(row, { sessionId: s.id, sessionStatus: "complete" });
    if (sub) await this.applyLocked(row, sub);
    const fresh = (await this.d.store.bySubscription(row.subscriptionId)) ?? row;
    if (fresh.status === "abandoned") return null;
    return fresh.stripeSubscriptionId && LINKED_STATES.includes(fresh.status)
      ? { status: "linked", subscriptionId: row.subscriptionId, stripeSubscriptionId: fresh.stripeSubscriptionId, state: fresh.status }
      : { status: "processing", subscriptionId: row.subscriptionId, message: "El cliente ya completó la página de pago: falta la confirmación del cobro por Stripe" };
  }

  /** En live, el control de elegibilidad fiscal del Checkout ordinario con los datos fiscales de la empresa (B2B). */
  private async eligible(company: Company) {
    const country = (company.country ?? "").trim().toUpperCase();
    const buyer = { type: "business" as const, country, postalCode: company.postalCode ?? null, taxId: company.taxId ?? null, address: company.address?.trim() && company.city?.trim() ? { line1: company.address.trim(), city: company.city.trim() } : null };
    if (this.d.mode !== "live") return buyer;
    const cfg = this.d.fiscal?.config;
    if (!cfg) throw new NegotiatedBillingError("unavailable", "Falta la configuración fiscal aprobada del entorno (escenarios y tratamiento del impuesto): no se abre el pago");
    const scenario = checkEligibility({ type: "business", country, postalCode: buyer.postalCode, taxId: buyer.taxId, hasAddress: !!buyer.address }, cfg, { requireAddress: true }).scenario;
    const vat = scenario && needsVies(cfg.taxExpectations.get(scenario)) && buyer.taxId && this.d.fiscal?.vat ? await this.d.fiscal.vat.verify(country, buyer.taxId, {}) : null;
    const r = checkEligibility({ type: "business", country, postalCode: buyer.postalCode, taxId: buyer.taxId, hasAddress: !!buyer.address, vat: vat?.status }, cfg, { requireAddress: true });
    if (!r.eligible) {
      opsLog("warn", "CommercialTerms", "billing_not_eligible", { companyId: company.id, reasons: r.reasons });
      throw new NegotiatedBillingError("unavailable", eligibilityMessage(r.scenario ?? "desconocido", r.reasons));
    }
    return buyer;
  }

  /** El Customer de Stripe de la empresa: el que ya tenga (`stripe_customers`); solo si no tiene, se crea. Nunca un segundo. */
  private async ensureCustomer(company: Company, buyer: { country: string; postalCode: string | null; taxId: string | null; address: { line1: string; city: string } | null }): Promise<string> {
    const cur = await this.d.stripeStore.customerByCompany(company.id);
    if (cur) {
      const c = await this.d.gateway.customer(cur.stripeCustomerId);
      if (!c || c.deleted) throw new NegotiatedBillingError("conflict", "El cliente de Stripe de esta empresa ya no existe: requiere revisión");
      return cur.stripeCustomerId;
    }
    const contacts = (await this.d.crmStore.list("contacts", { companyId: company.id })) as Array<{ email?: string | null; status?: string; isPrimary?: boolean }>;
    const active = contacts.filter((c) => c.status !== "inactive" && c.email);
    const email = company.billingEmail ?? (active.find((c) => c.isPrimary) ?? active[0])?.email ?? company.email ?? null;
    const taxId = this.d.mode === "live" && /^[A-Z]{2}$/.test(buyer.country) ? spanishTaxIdOf({ type: "business", country: buyer.country, taxId: buyer.taxId }) : null;
    // La MISMA clave que el Checkout ordinario: dos altas simultáneas de la empresa reciben el mismo Customer
    const key = `es-${this.d.namespace}-customer-${company.id}-${crypto.createHash("sha256").update(`${this.d.namespace}:${company.id}`).digest("hex").slice(0, 8)}`;
    const created = await this.d.gateway.createCustomer(
      {
        name: company.legalName?.trim() || company.name,
        email,
        metadata: { es_company_id: String(company.id), es_env: this.d.namespace, ...(company.tenantId ? { es_tenant_id: company.tenantId } : {}), es_buyer_type: "business" },
        ...(/^[A-Z]{2}$/.test(buyer.country) ? { address: { country: buyer.country, postalCode: buyer.postalCode, ...(buyer.address ?? {}) } } : {}),
        ...(taxId ? { taxIds: [taxId] } : {}),
      },
      key,
    );
    const { link } = await this.d.stripeStore.linkCustomer({ companyId: company.id, tenantId: company.tenantId ?? null, stripeCustomerId: created.id, now: this.now() });
    return link.stripeCustomerId;
  }

  // ── Webhooks y conciliación ─────────────────────────────────────────────────

  /** Evento de una sesión de Checkout. null: la sesión no es de condiciones personalizadas (sin llamar a Stripe). */
  async handleSession(sessionId: string): Promise<string | null> {
    const row = await this.d.store.bySession(sessionId);
    if (!row) return null;
    const s = await this.d.gateway.checkoutSession(sessionId);
    if (!s) return "La sesión no existe en Stripe";
    if (s.metadata.es_terms_subscription !== String(row.subscriptionId) || s.metadata.es_env !== this.d.namespace || s.customerId !== row.stripeCustomerId) throw new StripeMismatchError("La sesión de Checkout no corresponde a su contratación negociada");
    const status = s.status === "complete" ? "complete" : s.status === "expired" ? "expired" : "open";
    if (status === "complete" && s.subscriptionId) {
      const sub = await this.d.gateway.subscription(s.subscriptionId);
      if (sub) return this.handleSubscription(sub);
    }
    if (row.sessionStatus !== status) await this.patch(row, { sessionStatus: status }).catch((e) => (e instanceof BillingStoreConflict ? undefined : Promise.reject(e)));
    return `Sesión ${status}`;
  }

  /** Núcleo: aplica el estado ACTUAL de la suscripción de Stripe (ya releída) a la contratación negociada. */
  async handleSubscription(sub: GwSubscription, hint?: GwInvoice | null): Promise<string> {
    const subscriptionId = Number(sub.metadata.es_terms_subscription);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) throw new StripeMismatchError("Suscripción negociada sin contratación");
    const row = (await this.d.store.byStripeSubscription(sub.id)) ?? (await this.d.store.bySubscription(subscriptionId));
    // Sin que un operador la pusiera a cobrar no hay nada que aplicar: se avisa y no se toca nada
    if (!row || row.subscriptionId !== subscriptionId) throw new StripeMismatchError("Suscripción de Stripe marcada como negociada sin registro de puesta en cobro");
    if (sub.customerId !== row.stripeCustomerId || sub.metadata.es_company_id !== String(row.companyId)) throw new StripeMismatchError("El cliente de Stripe no es el de la contratación negociada");
    return this.withLease(subscriptionId, async () => this.applyLocked((await this.d.store.bySubscription(subscriptionId)) ?? row, sub, hint ?? undefined), () => new Error("La contratación se está procesando: se reintenta"));
  }

  private async applyLocked(row: TermsBillingRow, sub: GwSubscription, hint?: GwInvoice): Promise<string> {
    const mapped = mapStripeStatus(sub.status);
    // Otra suscripción de Stripe para la misma contratación: nunca se enlaza una segunda
    if (row.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id && row.status !== "abandoned") {
      if (mapped === "canceled") return "Otra suscripción de Stripe de la misma contratación, ya terminada: sin cambios";
      opsLog("error", "CommercialTerms", "billing_duplicate_subscription", { subscriptionId: row.subscriptionId, linked: row.stripeSubscriptionId, other: sub.id });
      recordFailure("stripe.negotiated_duplicate");
      return "Segunda suscripción de Stripe para una contratación ya enlazada: no se enlaza (requiere revisión)";
    }
    const now = this.now();
    const first = row.stripeSubscriptionId !== sub.id;
    // Una suscripción ya muerta que no es la del intento en curso (p. ej. un evento atrasado de un intento anterior
    // abandonado) no cambia nada: nunca pisa una sesión de pago que sigue viva
    if (first && mapped === "canceled") return "Suscripción de Stripe ya terminada de un intento anterior: sin cambios";
    if (row.status === "pending" && mapped === "canceled") {
      // El cliente no llegó a pagar y Stripe la dio por caducada: se puede volver a poner a cobrar
      await this.patch(row, { status: "abandoned", stripeStatus: sub.status, syncedAt: now });
      return "El primer pago no se completó: contratación sin cobro (se puede volver a iniciar)";
    }
    const plan = await this.d.billing.plan(row.subscriptionId).catch(() => null);
    const paid = await this.recordInvoices(row, sub, plan, hint);
    // Última factura PAGADA: la última de la suscripción si está pagada; si no, la que ya constaba (un evento atrasado
    // de una factura anterior nunca la hace retroceder)
    const lastPaid = paid && paid.invoiceId === sub.latestInvoiceId ? paid.invoiceId : (row.lastPaidInvoiceId ?? paid?.invoiceId ?? null);
    const cancelAt = sub.cancelAt ?? (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null);
    const base: TermsBillingPatch = { stripeSubscriptionId: sub.id, stripeStatus: sub.status, currentPeriodEnd: sub.currentPeriodEnd === null ? null : sub.currentPeriodEnd * 1000, cancelAt: cancelAt === null ? null : cancelAt * 1000, lastPaidInvoiceId: lastPaid, syncedAt: now, ...(first ? { sessionStatus: "complete" as const } : {}) };
    // Un cobro de un periodo nuevo levanta la retención de un cobro revertido anterior
    let held = row.heldInvoiceId;
    if (held && lastPaid && held !== lastPaid) held = null;
    base.heldInvoiceId = held;

    const prev = row.status;
    let next: BillingState = prev;
    const changes: TermsBillingPatch = {};
    const live = (cancelAt !== null ? "cancel_scheduled" : "active") as BillingState;
    if (prev === "pending" || prev === "abandoned") {
      // Hasta el primer cobro verificado no se da por iniciada
      if (mapped === "active" && lastPaid) next = live;
      else if ((mapped === "past_due" || mapped === "unpaid") && lastPaid) next = "past_due";
      if (next !== prev) changes.linkedAt = now;
    }
    if (next !== "pending" && next !== "abandoned") {
      if (mapped === "canceled") next = "canceled";
      else if (held && held === lastPaid) next = "suspended";
      else if (mapped === "active") next = live;
      else if (mapped === "unpaid") next = "suspended";
      else if (mapped === "past_due") next = prev === "suspended" ? "suspended" : prev === "past_due" && row.graceEndsAt !== null && now >= row.graceEndsAt ? "suspended" : "past_due";
    }
    if (next === "past_due" && prev !== "past_due") changes.graceEndsAt = now + this.grace;
    if (next === "active" || next === "cancel_scheduled" || next === "canceled") changes.graceEndsAt = null;

    // Licencias: solo las PROPIAS de la suscripción, y solo por el estado de pago
    const reference = `suscripción #${row.subscriptionId}`;
    if (next === "suspended" && prev !== "suspended") {
      const done = await this.markLicences(row.subscriptionId, "suspended", held && held === lastPaid ? `Cobro revertido en Stripe (${reference}): acceso suspendido, los datos se conservan` : `Suspensión por impago (${reference}); los datos se conservan`);
      changes.suspendedCapabilities = [...(row.suspendedCapabilities ?? []), ...done];
    } else if (next === "canceled" && prev !== "canceled") {
      changes.readOnlyUntil = now + this.readOnly;
      await this.markLicences(row.subscriptionId, "read_only", `Fin de la suscripción en Stripe (${reference}): solo lectura hasta ${new Date(now + this.readOnly).toISOString().slice(0, 10)}, los datos se conservan`, now + this.readOnly);
      await this.endInternal(row.subscriptionId);
    } else if ((next === "active" || next === "cancel_scheduled") && prev === "suspended") {
      await this.restoreLicences(row, `Pago recibido en Stripe: ${reference} al corriente`);
      changes.suspendedCapabilities = null;
    }
    const fresh = await this.patch(row, { ...base, ...changes, status: next });

    // Renovación cobrada: el periodo de la suscripción interna sigue al de Stripe
    if (paid?.created && paid.reason === "subscription_cycle" && this.d.subscriptions) await this.d.subscriptions.applyRenewals(row.subscriptionId, this.actor).catch((e) => opsLog("warn", "CommercialTerms", "billing_renew_skipped", { subscriptionId: row.subscriptionId, error: e instanceof Error ? e.name : "error" }));
    if (next !== prev) {
      opsLog("info", "CommercialTerms", "billing_state", { subscriptionId: row.subscriptionId, from: prev, to: next, stripeStatus: sub.status });
      await this.history(plan?.termsId ?? row.checkout?.termsId ?? null, "billing_state", `Cobro en Stripe: ${prev} → ${next}`, { subscriptionId: row.subscriptionId, from: prev, to: next, stripeStatus: sub.status, graceEndsAt: fresh.graceEndsAt, readOnlyUntil: fresh.readOnlyUntil, cancelAt: fresh.cancelAt }, this.actor);
    }
    // Recién enlazada: los cargos del primer pago constan como enviados y se deja en Stripe lo que rige hoy (claves de
    // las partidas, abonos pendientes). Un fallo aquí queda registrado en el acuerdo y se reintenta al sincronizar
    if ((prev === "pending" || prev === "abandoned") && next !== prev) {
      const sent = Object.fromEntries(Object.keys(row.checkout?.oneOffs ?? {}).map((k) => [k, `checkout:${row.sessionId ?? sub.id}`]));
      await this.d.billing.recordSent(row.subscriptionId, sub.id, sent, this.actor).catch((e) => opsLog("warn", "CommercialTerms", "billing_record_sent_failed", { subscriptionId: row.subscriptionId, error: e instanceof Error ? e.name : "error" }));
      await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
    }
    return next !== prev ? `Contratación negociada: ${prev} → ${next}` : `Contratación negociada ${next}: sin cambios`;
  }

  /**
   * Registra la última factura de la suscripción (y la del evento, si es otra). Devuelve la que acaba de quedar
   * pagada, si alguna. Comprueba que el primer pago es el ofrecido y que el impuesto corresponde al tipo pactado.
   */
  private async recordInvoices(row: TermsBillingRow, sub: GwSubscription, plan: BillingPlan | null, hint?: GwInvoice): Promise<{ created: boolean; invoiceId: string; reason: string | null } | null> {
    const invoices: GwInvoice[] = [];
    if (hint && hint.subscriptionId === sub.id) invoices.push(hint);
    if (sub.latestInvoiceId && sub.latestInvoiceId !== hint?.id) {
      const inv = await this.d.gateway.invoice(sub.latestInvoiceId);
      if (inv) invoices.push(inv);
    }
    let out: { created: boolean; invoiceId: string; reason: string | null } | null = null;
    for (const inv of invoices) {
      if (inv.subscriptionId !== sub.id || inv.customerId !== sub.customerId) throw new StripeMismatchError("La factura no es de la suscripción negociada");
      const isPaid = inv.status === "paid";
      const rates = plan ? Array.from(new Set([...plan.items.map((i) => i.taxRateBp), ...plan.oneOffs.filter((o) => o.due).map((o) => o.taxRateBp)])) : [];
      const taxCheck = isPaid ? invoiceTaxCheck(this.policy, rates, inv) : null;
      const { previous } = await this.d.store.upsertInvoice(
        { billingId: row.id, subscriptionId: row.subscriptionId, stripeInvoiceId: inv.id, status: inv.status ?? "unknown", billingReason: inv.billingReason, number: inv.number ?? null, currency: inv.currency, subtotalCents: inv.subtotal, taxCents: inv.taxCents ?? null, totalCents: inv.total ?? null, amountPaidCents: inv.amountPaid, periodStart: inv.periodStart === null ? null : inv.periodStart * 1000, taxCheck, coverageLost: (await this.d.store.invoice(inv.id))?.coverageLost ?? false, paidAt: isPaid ? this.now() : null },
        this.now(),
      );
      if (!isPaid) continue;
      const created = previous?.status !== "paid";
      if (created) {
        opsLog("info", "CommercialTerms", "billing_payment_verified", { subscriptionId: row.subscriptionId, invoiceId: inv.id, reason: inv.billingReason, ...(inv.taxCents != null ? { taxCents: inv.taxCents } : {}) });
        if (plan && inv.currency !== plan.currency.toUpperCase()) throw new StripeMismatchError("La moneda de la factura no es la de la contratación");
        // Primer pago: exactamente lo ofrecido en la sesión (neto, antes de impuestos)
        if (inv.billingReason === "subscription_create" && row.checkout && inv.subtotal !== row.checkout.firstChargeCents) {
          opsLog("error", "CommercialTerms", "billing_first_invoice_mismatch", { subscriptionId: row.subscriptionId, invoiceId: inv.id, expected: row.checkout.firstChargeCents, invoiced: inv.subtotal });
          recordFailure("stripe.negotiated_invoice_mismatch");
        }
        if (taxCheck && taxCheck !== "ok") {
          opsLog("warn", "CommercialTerms", "billing_invoice_tax_mismatch", { subscriptionId: row.subscriptionId, invoiceId: inv.id, problem: taxCheck, taxCents: inv.taxCents ?? null, subtotal: inv.subtotal, ratesBp: rates });
          recordFailure("stripe.negotiated_tax_mismatch");
        }
        await this.history(plan?.termsId ?? row.checkout?.termsId ?? null, "billing_payment", `Factura de Stripe cobrada (${inv.billingReason ?? "sin motivo"})`, { subscriptionId: row.subscriptionId, invoiceId: inv.id, number: inv.number ?? null, subtotalCents: inv.subtotal, taxCents: inv.taxCents ?? null, totalCents: inv.total ?? null, taxCheck }, this.actor);
      }
      // La última factura de la suscripción manda (la del evento puede ser anterior)
      if (!out || inv.id === sub.latestInvoiceId) out = { created, invoiceId: inv.id, reason: inv.billingReason };
    }
    return out;
  }

  /** Reembolso o disputa de un cargo de la suscripción (cargo, factura y suscripción ya releídos en Stripe). */
  async handleCharge(c: GwCharge, inv: GwInvoice, sub: GwSubscription): Promise<string> {
    const row = await this.d.store.byStripeSubscription(sub.id);
    if (!row) throw new StripeMismatchError("Cargo de una suscripción negociada sin registro de puesta en cobro");
    if (c.customerId !== row.stripeCustomerId || inv.customerId !== row.stripeCustomerId) throw new StripeMismatchError("El cargo no es del cliente de la contratación negociada");
    return this.withLease(row.subscriptionId, async () => {
      const cur = (await this.d.store.bySubscription(row.subscriptionId)) ?? row;
      const known = await this.d.store.invoice(inv.id);
      const lost = coverageLostOf(c);
      await this.d.store.upsertInvoice(
        { billingId: cur.id, subscriptionId: cur.subscriptionId, stripeInvoiceId: inv.id, status: inv.status ?? "unknown", billingReason: inv.billingReason, number: inv.number ?? null, currency: inv.currency, subtotalCents: inv.subtotal, taxCents: inv.taxCents ?? null, totalCents: inv.total ?? null, amountPaidCents: inv.amountPaid, periodStart: inv.periodStart === null ? null : inv.periodStart * 1000, taxCheck: null, coverageLost: lost, paidAt: known?.paidAt ?? null },
        this.now(),
      );
      const log = { subscriptionId: cur.subscriptionId, chargeId: c.id, refunded: c.amountRefunded, amount: c.amount, dispute: c.disputeStatus };
      if (lost && !known?.coverageLost) {
        opsLog("warn", "CommercialTerms", "billing_coverage_lost", log);
        recordFailure("stripe.coverage_lost");
      } else if (!lost && c.amountRefunded > 0) {
        opsLog("warn", "CommercialTerms", "billing_partial_refund", log);
        recordFailure("stripe.partial_refund");
      }
      // Solo el cobro revertido del ÚLTIMO periodo pagado retiene el acceso; si se restablece, se levanta
      let held = cur.heldInvoiceId;
      if (lost && cur.lastPaidInvoiceId === inv.id) held = inv.id;
      else if (!lost && held === inv.id) held = null;
      const withHold = held === cur.heldInvoiceId ? cur : await this.patch(cur, { heldInvoiceId: held });
      const state = await this.applyLocked(withHold, sub);
      return `Cargo ${lost ? "sin cobertura" : c.amountRefunded ? "reembolsado en parte" : "al corriente"}; ${state}`.slice(0, 300);
    }, () => new Error("La contratación se está procesando: se reintenta"));
  }

  /** Suscripciones de Stripe que conviene releer (copia antigua, impago con la gracia vencida). Para la conciliación. */
  async toRefresh(syncedBefore: number, limit = 200): Promise<string[]> {
    const rows = await this.d.store.list({ status: ["pending", ...LINKED_STATES], syncedBefore, limit });
    return rows.map((r) => r.stripeSubscriptionId).filter((x): x is string => !!x);
  }

  /** Sesiones de pago que caducaron sin evento: se anotan como caducadas (releyéndolas en Stripe). */
  async closeExpiredSessions(limit = 200): Promise<number> {
    let n = 0;
    for (const row of await this.d.store.list({ status: ["pending"], sessionExpiredBefore: this.now(), limit })) {
      if (!row.sessionId) continue;
      const r = await this.handleSession(row.sessionId).catch(() => null);
      if (r) n++;
    }
    return n;
  }

  /**
   * Conciliación de todas las contrataciones enlazadas: compara lo que rige hoy con lo que Stripe tiene (partidas,
   * importes, moneda, importes únicos, impuestos y estado). Las diferencias se avisan; nunca se corrigen solas.
   */
  async reconcileAll(limit = 200): Promise<{ checked: number; drifted: Array<{ subscriptionId: number; differences: Array<{ key: string; kind: string }> }>; errors: number }> {
    const out = { checked: 0, drifted: [] as Array<{ subscriptionId: number; differences: Array<{ key: string; kind: string }> }>, errors: 0 };
    if (!this.d.enabled) return out;
    for (const row of await this.d.store.list({ status: LINKED_STATES, limit })) {
      try {
        let r = await this.d.billing.reconcile(row.subscriptionId);
        if (!r.available) continue;
        // Única corrección automática, y en el sentido prudente: una contratación que termina deja de renovarse en
        // Stripe al final del periodo ya pagado. Todo lo demás solo se avisa
        if (r.differences.some((x) => x.key === "fin_sin_programar")) {
          await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
          r = await this.d.billing.reconcile(row.subscriptionId);
          if (!r.available) continue;
        }
        out.checked++;
        if (!r.consistent) out.drifted.push({ subscriptionId: row.subscriptionId, differences: r.differences.map((x) => ({ key: x.key, kind: x.kind })) });
      } catch (e) {
        out.errors++;
        opsLog("warn", "CommercialTerms", "billing_reconcile_failed", { subscriptionId: row.subscriptionId, error: e instanceof Error ? e.name : "error" });
      }
    }
    for (const x of out.drifted) opsLog("warn", "CommercialTerms", "billing_drift", { subscriptionId: x.subscriptionId, differences: x.differences });
    if (out.drifted.length) recordFailure("stripe.negotiated_drift");
    return out;
  }

  // ── Operador ────────────────────────────────────────────────────────────────

  /** Programa (o deshace) el fin de la suscripción de Stripe al final del periodo ya pagado. No cobra ni abona nada. */
  async setCancel(subscriptionId: number, cancel: boolean, actor: string) {
    if (!this.d.enabled) throw new NegotiatedBillingError("disabled", "El cobro en Stripe de condiciones personalizadas está apagado");
    const row = await this.d.store.bySubscription(subscriptionId);
    if (!row?.stripeSubscriptionId || !LINKED_STATES.includes(row.status)) throw new NegotiatedBillingError("invalid_state", "Esta suscripción no se cobra en Stripe");
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!cancel && sub && (sub.status === "canceled" || sub.cancelAt != null)) throw new NegotiatedBillingError("invalid_state", "La contratación interna está cancelada o tiene su fin programado: deshazlo primero en la suscripción");
    try {
      await this.d.adapter.setCancelAtPeriodEnd(row.stripeSubscriptionId, cancel, `terms-cancel-${subscriptionId}-${cancel ? "on" : "off"}-${row.version}`);
    } catch (e) {
      if (e instanceof NegotiatedGatewayError) throw new NegotiatedBillingError("unavailable", e.message);
      throw e;
    }
    opsLog("info", "CommercialTerms", cancel ? "billing_cancel_scheduled" : "billing_cancel_undone", { subscriptionId, actor });
    const fresh = await this.d.gateway.subscription(row.stripeSubscriptionId);
    if (fresh) await this.handleSubscription(fresh);
    return this.status(subscriptionId);
  }

  /** Estado del cobro para el CRM. Solo lectura; no llama a Stripe. */
  async status(subscriptionId: number) {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new NegotiatedBillingError("not_found", "Suscripción no encontrada");
    const row = await this.d.store.bySubscription(subscriptionId);
    const plan = await this.d.billing.plan(subscriptionId);
    const blockers = row && row.status !== "abandoned" && row.stripeSubscriptionId ? [] : await this.blockers(subscriptionId, plan);
    return {
      enabled: this.d.enabled,
      mode: this.d.mode,
      taxTreatment: this.policy,
      /** ¿Se puede poner a cobrar ahora? (interruptor encendido y sin impedimentos). */
      canStart: this.d.enabled && !blockers.length && (!row || row.status === "pending" || row.status === "abandoned"),
      blockers: this.d.enabled ? blockers : ["El cobro en Stripe de condiciones personalizadas está apagado", ...blockers],
      billing: row
        ? { status: row.status, stripeSubscriptionId: row.stripeSubscriptionId, stripeStatus: row.stripeStatus, session: row.sessionId ? { id: row.sessionId, status: row.sessionStatus, expiresAt: row.sessionExpiresAt } : null, offer: row.checkout, currentPeriodEnd: row.currentPeriodEnd, cancelAt: row.cancelAt, graceEndsAt: row.graceEndsAt, readOnlyUntil: row.readOnlyUntil, coverageHeld: !!row.heldInvoiceId && row.heldInvoiceId === row.lastPaidInvoiceId, startedBy: row.startedBy, startedAt: row.startedAt, linkedAt: row.linkedAt, syncedAt: row.syncedAt }
        : null,
      invoices: row ? await this.d.store.invoices(row.id, 24) : [],
    };
  }

  /**
   * Estado PÚBLICO tras volver de la página de pago (mismo contrato que el alta ordinaria, sin datos personales).
   * null: la sesión no es de condiciones personalizadas. Nunca dice «listo» por haber vuelto: lo decide el cobro verificado.
   */
  async publicStatus(sessionId: string, platformDomain: string | null): Promise<CheckoutStatusView | null> {
    const row = await this.d.store.bySession(sessionId);
    if (!row) return null;
    if (LINKED_STATES.includes(row.status)) {
      const tenantId = await this.tenantOf(row.subscriptionId);
      return checkoutStatusView("ready", tenantId && platformDomain ? `https://${tenantId}.${platformDomain}` : undefined);
    }
    if (row.status === "abandoned" || row.status === "canceled") return checkoutStatusView("failed");
    if (row.sessionStatus === "complete" || row.stripeSubscriptionId) return checkoutStatusView("payment_processing");
    return checkoutStatusView(row.sessionStatus === "expired" || (row.sessionExpiresAt !== null && row.sessionExpiresAt < this.now()) ? "expired" : "pending_payment");
  }

  // ── Licencias (solo las propias de la suscripción) y suscripción interna ────

  private async tenantOf(subscriptionId: number) {
    return (await this.d.subscriptionStore.get(subscriptionId))?.tenantId ?? null;
  }

  /** Suspende o deja en solo lectura las licencias PROPIAS vivas de la suscripción. Devuelve las que cambió. */
  private async markLicences(subscriptionId: number, status: "suspended" | "read_only", reason: string, validUntil?: number): Promise<Array<{ capabilityId: string; siteId: string | null }>> {
    const tenantId = await this.tenantOf(subscriptionId);
    if (!this.d.capabilities || !tenantId) return [];
    const source = `subscription:${subscriptionId}`;
    const own = (await this.d.capabilities.list(tenantId)).filter((g) => g.source === source && g.status !== "cancelled" && g.status !== status && (status === "read_only" || g.status === "active"));
    if (!own.length) return [];
    const changes: CapabilityChange[] = own.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId, status, validUntil: validUntil ?? g.validUntil, source }));
    await this.d.capabilities.apply(tenantId, changes, { actor: this.actor, reason, now: this.now() });
    return own.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId }));
  }

  /** Devuelve SOLO las licencias que suspendió el impago (no las que bloqueó un operador) y las alinea con lo contratado. */
  private async restoreLicences(row: TermsBillingRow, reason: string) {
    const tenantId = await this.tenantOf(row.subscriptionId);
    if (this.d.capabilities && tenantId && row.suspendedCapabilities?.length) {
      const source = `subscription:${row.subscriptionId}`;
      const mine = new Set(row.suspendedCapabilities.map((c) => `${c.capabilityId}\u0000${c.siteId ?? ""}`));
      const back = (await this.d.capabilities.list(tenantId)).filter((g) => g.source === source && g.status === "suspended" && mine.has(`${g.capabilityId}\u0000${g.siteId ?? ""}`));
      if (back.length) await this.d.capabilities.apply(tenantId, back.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId, status: "active" as const, validUntil: g.validUntil, source })), { actor: this.actor, reason, now: this.now() });
    }
    await this.d.licences?.ensure(row.subscriptionId, this.actor, { changed: true }).catch(() => undefined);
  }

  /** Fin en Stripe: la suscripción interna termina (cancelación programada y, si su periodo ya venció, aplicada). */
  private async endInternal(subscriptionId: number) {
    if (!this.d.subscriptions) return;
    try {
      const sub = await this.d.subscriptionStore.get(subscriptionId);
      if (!sub || sub.status === "canceled") return;
      if (sub.cancelAt == null) await this.d.subscriptions.scheduleCancel(subscriptionId, { reason: "Fin de la suscripción en Stripe" }, sub.version, this.actor);
      await this.d.subscriptions.applyRenewals(subscriptionId, this.actor);
    } catch (e) {
      opsLog("warn", "CommercialTerms", "billing_end_internal_failed", { subscriptionId, error: e instanceof Error ? e.name : "error" });
    }
  }
}

/**
 * `/cp/v1/subscriptions/:id/terms/billing/…`: estado del cobro (lectura) y acciones expresas de un operador con el
 * permiso de precios personalizados: poner a cobrar, programar el fin y deshacerlo.
 */
export function createNegotiatedBillingRouter(svc: NegotiatedBillingService): Router {
  const r = express.Router();
  const id = z.coerce.number().int().positive();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => {
      if (e instanceof NegotiatedBillingError) return void res.status(e.code === "not_found" ? 404 : e.code === "unavailable" ? 503 : 409).json({ error: e.code, message: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "invalid_request", message: "Petición no válida" });
      if (e instanceof StripeGatewayError) return void res.status(502).json({ error: "stripe_error", message: e.message });
      opsLog("error", "CommercialTerms", "billing_error", { error: e instanceof Error ? e.name : "error" });
      res.status(500).json({ error: "internal_error", message: "Error interno" });
    });
  const actor = (req: Request) => {
    const a = getAuth(req)!.actor;
    return `${a.type}:${a.id}`;
  };
  r.get("/subscriptions/:id/terms/billing/stripe", requireScope("subscriptions:read"), wrap(async (req, res) => void res.json(await svc.status(id.parse(req.params.id)))));
  r.post("/subscriptions/:id/terms/billing/start", requireCustomPricing(), wrap(async (req, res) => void res.json(await svc.start(id.parse(req.params.id), actor(req)))));
  r.post("/subscriptions/:id/terms/billing/cancel", requireCustomPricing(), wrap(async (req, res) => void res.json(await svc.setCancel(id.parse(req.params.id), true, actor(req)))));
  r.post("/subscriptions/:id/terms/billing/resume", requireCustomPricing(), wrap(async (req, res) => void res.json(await svc.setCancel(id.parse(req.params.id), false, actor(req)))));
  return r;
}
