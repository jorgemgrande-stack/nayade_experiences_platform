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
import type { SubscriptionStore } from "../subscriptions/store";
import type { BillingLink, BillingPlan, NegotiatedBillingGateway, TermsBillingService } from "./billing";
import { BillingStoreConflict, LINKED_STATES, type BillingState, type CheckoutOffer, type TermsBillingPatch, type TermsBillingRow, type TermsBillingStore } from "./billingStore";
import { requireCustomPricing } from "./permission";
import { NEGOTIATED_MARK, NegotiatedGatewayError, StripeNegotiatedGateway } from "./stripeGateway";
import { effectiveStatus } from "./service";
import type { TermsStore } from "./store";

const DAY = 86_400_000;
/** Por debajo de este margen, una sesión abierta se sustituye en lugar de reutilizarse. */
const REUSE_MARGIN_MS = 10 * 60_000;
const MAX_KEY_ATTEMPTS = 3;
/** Margen mínimo para aplazar el primer cargo (Stripe exige 48 h para `trial_end` en Checkout; se deja holgura). */
const AHEAD_MIN_MS = 49 * 3600_000;

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
      /** Fecha del primer cargo si se aplaza al inicio del acuerdo (hoy solo se autoriza el método de pago); null: se cobra al pagar. */
      firstChargeAt: number | null;
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
  billing: Pick<TermsBillingService, "plan" | "syncIfOpen" | "recordSent" | "reconcile" | "nextStart" | "changedSinceSync" | "sentOneOffs">;
  termsStore: Pick<TermsStore, "get" | "log">;
  /** Suscripción interna: una vez enlazada, el reloj es el de Stripe (sus periodos y su fin siguen a los de Stripe). */
  subscriptionStore: Pick<SubscriptionStore, "get" | "mutate">;
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
 * Una factura de Stripe frente a lo pactado: la base (sin impuestos), el impuesto, el total y lo cobrado.
 *  - Base: si se sabe cuál debía ser (`expectedSubtotal`: el primer pago ofrecido, o la cuota vigente más los importes
 *    únicos de esa factura), tiene que ser EXACTAMENTE esa → si no, `amount_mismatch`.
 *  - Impuesto (solo con la política live): con Stripe Tax el tipo lo decide Stripe según el cliente; aquí se comprueba
 *    que el resultado es el del acuerdo. Con un único tipo pactado en la factura, el impuesto tiene que ser exactamente
 *    uno de los dos que da ese tipo: redondeado una vez sobre la base (como el acuerdo: 44,63 € al 21 % son 9,37 €) o
 *    redondeado línea a línea (como puede hacerlo Stripe con varias líneas). Cualquier otro céntimo es `tax_mismatch`.
 *    Con tipos distintos en la misma factura no se puede repartir la base: debe quedar entre el del menor y el del mayor.
 *  - Total: base + impuesto, exacto → si no, `tax_mismatch`.
 *  - Cobro: lo cobrado tiene que ser el total (un saldo a favor aplicado o un cobro fuera de Stripe) → `payment_mismatch`.
 * null: no hay nada que comprobar.
 */
export function invoiceTaxCheck(
  policy: StripeTaxPolicy | null,
  ratesBp: number[],
  inv: Pick<GwInvoice, "subtotal" | "taxCents" | "lines" | "total"> & { amountPaid?: number },
  expectedSubtotal: number | null = null,
): "ok" | "amount_mismatch" | "tax_unknown" | "tax_mismatch" | "payment_mismatch" | null {
  if (expectedSubtotal !== null && inv.subtotal !== expectedSubtotal) return "amount_mismatch";
  // Una factura de total negativo (un abono mayor que la cuota) no cobra nada: lo esperado es 0, no el total
  const paid = () => (inv.amountPaid !== undefined && inv.total !== null && inv.total !== undefined && inv.amountPaid !== Math.max(inv.total, 0) ? ("payment_mismatch" as const) : ("ok" as const));
  if (policy !== LIVE_TAX_TREATMENT || !ratesBp.length) return expectedSubtotal !== null ? paid() : null;
  if (inv.taxCents === null || inv.taxCents === undefined || inv.subtotal === null) return "tax_unknown";
  if (inv.total !== null && inv.total !== undefined && inv.total !== inv.subtotal + inv.taxCents) return "tax_mismatch";
  const taxOf = (base: number, bp: number) => Math.round((base * bp) / 10_000);
  const rates = Array.from(new Set(ratesBp));
  if (rates.length === 1) {
    const whole = taxOf(inv.subtotal, rates[0]);
    const perLine = inv.lines?.length ? inv.lines.reduce((a, l) => a + taxOf(l.amount, rates[0]), 0) : whole;
    return inv.taxCents === whole || inv.taxCents === perLine ? paid() : "tax_mismatch";
  }
  const slack = Math.max(1, inv.lines?.length ?? 1);
  const bounds = rates.map((bp) => taxOf(inv.subtotal!, bp));
  return inv.taxCents >= Math.min(...bounds) - slack && inv.taxCents <= Math.max(...bounds) + slack ? paid() : "tax_mismatch";
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

  /**
   * Por qué terminó la suscripción de Stripe:
   *  - `wanted`: la contratación termina dentro o lo ordenó un operador → solo lectura y fin de la contratación;
   *  - `unpaid`: Stripe la canceló por IMPAGO (venía de impago o suspensión, o su última factura quedó sin cobrar) →
   *    las mismas consecuencias que cualquier fin por impago (solo lectura y fin), nunca licencias activas sin cobro;
   *  - `terms_ended`: las condiciones terminaron sin sucesor y la sincronización programó el fin;
   *  - `stripe_only`: alguien la canceló en Stripe con todo al corriente → solo se avisa.
   */
  private async cancelKind(row: TermsBillingRow, sub: GwSubscription, plan: BillingPlan | null, lastPaid: string | null): Promise<"wanted" | "unpaid" | "terms_ended" | "stripe_only"> {
    if (await this.endWanted(row)) return "wanted";
    if (row.status === "past_due" || row.status === "suspended") return "unpaid";
    const latest = sub.latestInvoiceId && sub.latestInvoiceId !== lastPaid ? await this.d.store.invoice(sub.latestInvoiceId) : null;
    if (latest && (latest.status === "open" || latest.status === "uncollectible")) return "unpaid";
    return plan && (plan.termsId === null || !plan.items.length) ? "terms_ended" : "stripe_only";
  }

  /** ¿Termina la contratación por voluntad propia? (dentro: cancelada o con fin programado; o por orden de un operador). */
  private async endWanted(row: TermsBillingRow): Promise<boolean> {
    if (row.cancelRequestedAt !== null && row.cancelRequestedAt !== undefined) return true;
    const sub = await this.d.subscriptionStore.get(row.subscriptionId);
    return !sub || sub.status === "canceled" || sub.cancelAt !== null;
  }

  /**
   * Fecha desde la que se cobra una suscripción puesta a cobrar por adelantado (primer cargo aplazado al inicio del
   * acuerdo), mientras no haya llegado. Hasta entonces, lo que se envía a Stripe y se concilia es lo que regirá ese día.
   */
  billFrom = async (subscriptionId: number): Promise<number | null> => {
    const r = await this.d.store.bySubscription(subscriptionId);
    // Solo mientras el aplazamiento sigue vivo: ya enlazada, o pendiente con su sesión abierta y sin caducar (o ya
    // completada). Una sesión aplazada que el cliente dejó caducar no sigue desplazando el plan a esa fecha
    const alive = !!r && (LINKED_STATES.includes(r.status) || (r.status === "pending" && (r.stripeSubscriptionId !== null || r.sessionStatus === "complete" || (r.sessionStatus === "open" && (r.sessionExpiresAt ?? 0) > this.now()))));
    const at = r && alive ? (r.checkout?.firstChargeAt ?? null) : null;
    return at !== null && at > this.now() ? at : null;
  };

  /** ¿Pidió un operador de forma expresa el fin de la suscripción de Stripe? */
  cancelRequested = async (subscriptionId: number): Promise<boolean> => ((await this.d.store.bySubscription(subscriptionId))?.cancelRequestedAt ?? null) !== null;

  /** Huella de lo que ofrece una sesión de pago para un plan y una fecha de primer cargo. */
  private offerHashOf(plan: BillingPlan, at: number | null, sent: Set<string>): string {
    const charges = at === null ? plan.oneOffs.filter((o) => o.due && o.amountCents > 0 && !sent.has(o.key)) : [];
    return `${offerHash(plan, Object.fromEntries(charges.map((o) => [o.key, o.amountCents])))}${at === null ? "" : `@${at}`}`.slice(0, 48);
  }

  /**
   * Las condiciones han cambiado: una sesión de pago ABIERTA que ofrece otra cosa se cierra, para que el cliente no
   * pague lo que ya no rige. Solo llama a Stripe si hay una sesión abierta de esta contratación.
   */
  invalidate = async (subscriptionId: number): Promise<void> => {
    const row = await this.d.store.bySubscription(subscriptionId);
    if (!row || row.status !== "pending" || !row.sessionId || row.sessionStatus !== "open" || row.stripeSubscriptionId || !row.checkout) return;
    const begin = await this.billingStart(subscriptionId).catch(() => null);
    if (begin && begin.plan.items.length && this.offerHashOf(begin.plan, begin.at, await this.sentBefore(row)) === row.checkout.hash) return;
    const sessionId = row.sessionId;
    const closed = await this.d.gateway.expireCheckoutSession(sessionId).catch(() => this.d.gateway.checkoutSession(sessionId));
    opsLog("info", "CommercialTerms", "billing_session_invalidated", { subscriptionId, status: closed?.status ?? null });
    if (closed?.status === "expired") await this.patch(row, { sessionStatus: "expired" }).catch(() => undefined);
  };

  /**
   * Importes únicos de la contratación ya enviados a Stripe ANTES de la oferta de esta sesión (en una suscripción de
   * Stripe anterior): al volver a poner a cobrar no se cobran ni se abonan otra vez. Los de la propia oferta no cuentan.
   */
  private async sentBefore(row: TermsBillingRow | null): Promise<Set<string>> {
    // Los de la oferta en curso aún no constan enviados (se anotan al enlazar), así que no hay nada que apartar
    return row ? this.d.billing.sentOneOffs(row.subscriptionId) : new Set<string>();
  }

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
      setPaused: (id, p, k) => a.setPaused(id, p, k),
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
  private async blockers(subscriptionId: number, plan: BillingPlan, at: number | null = null): Promise<string[]> {
    const out: string[] = [];
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) return ["Suscripción no encontrada"];
    if (sub.status !== "active") out.push(sub.status === "trialing" ? "La suscripción está en periodo de prueba" : "La suscripción está cancelada");
    if (sub.cancelAt != null) out.push("La suscripción tiene su cancelación programada");
    if (plan.termsId === null || !plan.items.length) out.push("La suscripción no tiene condiciones personalizadas vigentes con cuotas recurrentes");
    else if (plan.recurringNetCents <= 0) out.push("La cuota recurrente total es 0: una contratación gratuita no se pone a cobrar en Stripe");
    else {
      // Estado EFECTIVO en la fecha desde la que se cobra: un acuerdo activado con inicio futuro consta «programado» y
      // nadie reescribe ese valor al llegar su fecha
      const t = await this.d.termsStore.get(plan.termsId);
      if (!t || effectiveStatus(t, at ?? this.now()) !== "active") out.push("Las condiciones personalizadas no están activas (aceptadas y en vigor)");
    }
    if (this.d.orderBilled && (await this.d.orderBilled(subscriptionId))) out.push("La suscripción ya se cobra en Stripe por el circuito ordinario (pedido): no admite el cobro de condiciones personalizadas");
    if (!this.policy) out.push("Política fiscal pendiente: en modo live no se cobra hasta decidir el tratamiento fiscal (CP_STRIPE_TAX_POLICY)");
    return out;
  }

  /**
   * Desde cuándo se cobra y qué. Con condiciones ya en vigor: desde que el cliente pague (`at` null). Con un acuerdo
   * activado que empieza en una fecha futura: el cliente autoriza ya su método de pago y el primer cargo es ESE día,
   * por el primer periodo completo (`at` = inicio). Stripe exige al menos 48 h de margen: con menos, hay que esperar.
   */
  private async billingStart(subscriptionId: number, settle = false): Promise<{ plan: BillingPlan; at: number | null }> {
    const now = this.now();
    const today = await this.d.billing.plan(subscriptionId, { settle, at: now });
    if (today.termsId !== null && today.items.length) return { plan: today, at: null };
    const next = await this.d.billing.nextStart(subscriptionId);
    if (next === null) return { plan: today, at: null };
    if (next - now < AHEAD_MIN_MS) throw new NegotiatedBillingError("invalid_state", `Las condiciones empiezan el ${new Date(next).toISOString().slice(0, 16).replace("T", " ")} UTC, en menos de 48 horas: Stripe no admite aplazar el primer cargo con tan poco margen. Ponla a cobrar a partir de esa fecha`);
    return { plan: await this.d.billing.plan(subscriptionId, { at: next }), at: next };
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
    if (row?.status === "canceled") {
      // Terminó en Stripe. Si la contratación sigue viva dentro (nadie la terminó: el fin fue solo en Stripe), se puede
      // volver a poner a cobrar con una suscripción de Stripe nueva; si terminó también dentro, no
      const sub = await this.d.subscriptionStore.get(subscriptionId);
      if (!sub || sub.status !== "active" || sub.cancelAt !== null) throw new NegotiatedBillingError("invalid_state", "El cobro en Stripe de esta suscripción ya terminó: requiere una contratación nueva");
    }
    if (row?.stripeSubscriptionId && row.status !== "abandoned" && row.status !== "canceled") {
      if (row.status === "pending") return { status: "processing", subscriptionId, message: "El cliente ya completó la página de pago: falta la confirmación del cobro por Stripe" };
      return { status: "linked", subscriptionId, stripeSubscriptionId: row.stripeSubscriptionId, state: row.status };
    }
    const { plan, at } = await this.billingStart(subscriptionId, true);
    const blockers = await this.blockers(subscriptionId, plan, at);
    if (blockers.length) throw new NegotiatedBillingError("invalid_state", blockers.join(". "));
    // Lo ya cobrado o abonado en una suscripción de Stripe anterior de esta contratación no se repite
    const sent = await this.d.billing.sentOneOffs(subscriptionId);
    // Reinicio tras un fin solo en Stripe: la fila se reabre DESPUÉS de comprobar que se puede (si no, sigue terminada)
    if (row?.status === "canceled") row = await this.patch(row, { status: "abandoned", cancelRequestedAt: null, cancelAt: null, readOnlyUntil: null });
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
    // Con el primer cargo aplazado al inicio del acuerdo, hoy no se cobra nada: cargos y abonos únicos de esa fecha se
    // envían al enlazar como importes únicos y van, con la primera cuota, en la factura de ese día
    const due = plan.oneOffs.filter((o) => o.due && !sent.has(o.key));
    const charges = at === null ? due.filter((o) => o.amountCents > 0) : [];
    const credits = at === null ? due.filter((o) => o.amountCents < 0) : [];
    // Los cargos únicos van sobre el Product genérico (no se crea un Product por cargo)
    const chargeProduct = charges.length ? await this.d.adapter.customServiceProduct().catch((e) => Promise.reject(e instanceof NegotiatedGatewayError ? new NegotiatedBillingError("unavailable", e.message) : e)) : null;
    const oneOffs = Object.fromEntries(charges.map((o) => [o.key, o.amountCents]));
    const firstChargeCents = plan.recurringNetCents + (at === null ? charges : due).reduce((a, o) => a + o.amountCents, 0);
    const offer: CheckoutOffer = { hash: this.offerHashOf(plan, at, sent), termsId: plan.termsId!, currency: plan.currency.toUpperCase(), recurringCents: plan.recurringNetCents, firstChargeCents, firstChargeAt: at, oneOffs, deferredCredits: credits.map((o) => o.key), taxTreatment: policy };
    const view = (s: GwCheckoutSession, reused: boolean): StartResult => ({ status: "pending", subscriptionId, sessionId: s.id, url: s.url, expiresAt: s.expiresAt * 1000, reused, currency: offer.currency, recurringCents: offer.recurringCents, firstChargeCents: offer.firstChargeCents, firstChargeAt: at, taxTreatment: policy, deferredCredits: credits.map((o) => ({ key: o.key, name: o.name, amountCents: o.amountCents })) });

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
            // Antes del inicio del acuerdo: el cliente autoriza su método de pago y el primer cargo es ESE día (periodo completo)
            ...(at !== null ? { trialEnd: Math.floor(at / 1000) } : {}),
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
    // Primera vez que se ve esta suscripción y la fila tiene OTRA sesión: si esa sesión ya creó otra suscripción, esta
    // sobra (no se enlaza y se avisa); si sigue abierta, se cierra para que no se pague una segunda vez
    if (first && row.sessionId && mapped !== null) {
      const s = await this.d.gateway.checkoutSession(row.sessionId);
      if (s?.subscriptionId && s.subscriptionId !== sub.id) {
        opsLog("error", "CommercialTerms", "billing_duplicate_subscription", { subscriptionId: row.subscriptionId, linked: s.subscriptionId, other: sub.id });
        recordFailure("stripe.negotiated_duplicate");
        return "Suscripción de Stripe de otra sesión de pago de la misma contratación: no se enlaza (requiere revisión)";
      }
      if (s?.status === "open") await this.d.gateway.expireCheckoutSession(s.id).catch(() => undefined);
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

    // Primer pago que falla sin haberse cobrado nada (un método de pago asíncrono rechazado días después): la
    // contratación no queda «pendiente» para siempre; vuelve a poder iniciarse y se avisa (la suscripción de Stripe
    // sigue viva hasta que Stripe la dé por caducada o alguien la cancele)
    if (row.status === "pending" && !lastPaid && (mapped === "past_due" || mapped === "unpaid")) {
      await this.patch(row, { status: "abandoned", stripeSubscriptionId: sub.id, stripeStatus: sub.status, syncedAt: now });
      opsLog("warn", "CommercialTerms", "billing_first_payment_failed", { subscriptionId: row.subscriptionId, stripeStatus: sub.status });
      recordFailure("stripe.negotiated_first_payment_failed");
      return "El primer pago falló sin cobrarse nada: contratación sin cobro (se puede volver a iniciar)";
    }
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
    } else if (next === "canceled" && prev !== "canceled" && (await this.cancelKind(row, sub, plan, lastPaid)) === "terms_ended") {
      // Las condiciones terminaron sin sucesor y la sincronización programó este fin: Stripe deja de cobrar sus partidas;
      // la contratación interna y sus licencias siguen su curso (ya no dependen de este cobro)
      opsLog("info", "CommercialTerms", "billing_ended_with_terms", { subscriptionId: row.subscriptionId });
    } else if (next === "canceled" && prev !== "canceled" && (await this.cancelKind(row, sub, plan, lastPaid)) === "stripe_only") {
      // Stripe terminó la suscripción SIN que la contratación termine dentro ni lo pidiera un operador (alguien la canceló
      // en Stripe): Stripe ya no cobra, pero la contratación y sus licencias no se tocan solas. Se avisa para que una
      // persona decida: volver a ponerla a cobrar o terminarla
      opsLog("error", "CommercialTerms", "billing_ended_only_in_stripe", { subscriptionId: row.subscriptionId });
      recordFailure("stripe.negotiated_ended_in_stripe");
    } else if (next === "canceled" && prev !== "canceled") {
      changes.readOnlyUntil = now + this.readOnly;
      await this.markLicences(row.subscriptionId, "read_only", `Fin de la suscripción en Stripe (${reference}): solo lectura hasta ${new Date(now + this.readOnly).toISOString().slice(0, 10)}, los datos se conservan`, now + this.readOnly);
      await this.endInternal(row.subscriptionId);
    } else if ((next === "active" || next === "cancel_scheduled") && prev === "suspended") {
      await this.restoreLicences(row, `Pago recibido en Stripe: ${reference} al corriente`);
      changes.suspendedCapabilities = null;
    }
    const fresh = await this.patch(row, { ...base, ...changes, status: next });

    // Una vez enlazada, el reloj es el de Stripe: el periodo de la suscripción interna es el que Stripe está cobrando
    if (LINKED_STATES.includes(next)) await this.followStripePeriod(row.subscriptionId, sub);
    if (next !== prev) {
      opsLog("info", "CommercialTerms", "billing_state", { subscriptionId: row.subscriptionId, from: prev, to: next, stripeStatus: sub.status });
      await this.history(plan?.termsId ?? row.checkout?.termsId ?? null, "billing_state", `Cobro en Stripe: ${prev} → ${next}`, { subscriptionId: row.subscriptionId, from: prev, to: next, stripeStatus: sub.status, graceEndsAt: fresh.graceEndsAt, readOnlyUntil: fresh.readOnlyUntil, cancelAt: fresh.cancelAt }, this.actor);
    }
    // Recién enlazada: los cargos del primer pago constan como enviados y se deja en Stripe lo que rige hoy (claves de
    // las partidas, abonos pendientes). Un fallo aquí queda registrado en el acuerdo y se reintenta al sincronizar
    if ((prev === "pending" || prev === "abandoned") && next !== prev) {
      // Lo que el cliente pagó tiene que ser lo que rige: si las condiciones cambiaron con la sesión ya abierta y aun así
      // se pagó, se avisa (la sincronización de abajo deja en Stripe lo vigente antes de la siguiente factura)
      if (plan && plan.termsId !== null && row.checkout && this.offerHashOf(plan, row.checkout.firstChargeAt ?? null, await this.sentBefore(row)) !== row.checkout.hash) {
        opsLog("error", "CommercialTerms", "billing_paid_stale_offer", { subscriptionId: row.subscriptionId, offered: row.checkout.recurringCents, inForce: plan.recurringNetCents });
        recordFailure("stripe.negotiated_invoice_mismatch");
      }
      const sent = Object.fromEntries(Object.keys(row.checkout?.oneOffs ?? {}).map((k) => [k, `checkout:${row.sessionId ?? sub.id}`]));
      await this.d.billing.recordSent(row.subscriptionId, sub.id, sent, this.actor).catch((e) => opsLog("warn", "CommercialTerms", "billing_record_sent_failed", { subscriptionId: row.subscriptionId, error: e instanceof Error ? e.name : "error" }));
      await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
    }
    return next !== prev ? `Contratación negociada: ${prev} → ${next}` : `Contratación negociada ${next}: sin cambios`;
  }

  /**
   * Registra la última factura de la suscripción (y la del evento, si es otra). Devuelve la que consta pagada, si
   * alguna. Cada factura pagada se contrasta con lo pactado (base, impuesto, total y cobro). El contraste y sus avisos
   * van ANTES de guardarla: si el proceso se corta a medias, el reintento los repite en lugar de darla por vista.
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
      // Siempre, también en un reintento: una factura en otra moneda no es de esta contratación
      if (isPaid && plan && inv.currency !== plan.currency.toUpperCase()) throw new StripeMismatchError("La moneda de la factura no es la de la contratación");
      const known = await this.d.store.invoice(inv.id);
      const created = isPaid && known?.status !== "paid";
      let taxCheck: string | null = null;
      if (created) {
        const expected = await this.expectedOf(row, sub, plan, inv);
        // Stripe embebe solo las 10 primeras líneas: con más, se leen todas para el redondeo línea a línea
        const lines = inv.linesTruncated && this.d.gateway.invoiceLineAmounts ? (await this.d.gateway.invoiceLineAmounts(inv.id)).map((amount) => ({ amount })) : inv.lines;
        taxCheck = invoiceTaxCheck(this.policy, expected.ratesBp, { ...inv, lines: lines as GwInvoice["lines"] }, expected.subtotal);
        opsLog("info", "CommercialTerms", "billing_payment_verified", { subscriptionId: row.subscriptionId, invoiceId: inv.id, reason: inv.billingReason, ...(inv.taxCents != null ? { taxCents: inv.taxCents } : {}) });
        if (taxCheck === "amount_mismatch") {
          // La base facturada no es la pactada (primer pago ofrecido, o cuota vigente más importes únicos)
          opsLog("error", "CommercialTerms", "billing_invoice_amount_mismatch", { subscriptionId: row.subscriptionId, invoiceId: inv.id, reason: inv.billingReason, expected: expected.subtotal, invoiced: inv.subtotal });
          recordFailure("stripe.negotiated_invoice_mismatch");
        } else if (taxCheck && taxCheck !== "ok") {
          opsLog("warn", "CommercialTerms", "billing_invoice_tax_mismatch", { subscriptionId: row.subscriptionId, invoiceId: inv.id, problem: taxCheck, taxCents: inv.taxCents ?? null, subtotal: inv.subtotal, total: inv.total ?? null, amountPaid: inv.amountPaid, ratesBp: expected.ratesBp });
          recordFailure("stripe.negotiated_tax_mismatch");
        }
      }
      await this.d.store.upsertInvoice(
        { billingId: row.id, subscriptionId: row.subscriptionId, stripeInvoiceId: inv.id, status: inv.status ?? "unknown", billingReason: inv.billingReason, number: inv.number ?? null, currency: inv.currency, subtotalCents: inv.subtotal, taxCents: inv.taxCents ?? null, totalCents: inv.total ?? null, amountPaidCents: inv.amountPaid, periodStart: inv.periodStart === null ? null : inv.periodStart * 1000, taxCheck, coverageLost: known?.coverageLost ?? false, paidAt: isPaid ? this.now() : null },
        this.now(),
      );
      if (!isPaid) continue;
      if (created) await this.history(plan?.termsId ?? row.checkout?.termsId ?? null, "billing_payment", `Factura de Stripe cobrada (${inv.billingReason ?? "sin motivo"})`, { subscriptionId: row.subscriptionId, invoiceId: inv.id, number: inv.number ?? null, subtotalCents: inv.subtotal, taxCents: inv.taxCents ?? null, totalCents: inv.total ?? null, taxCheck }, this.actor);
      // La última factura de la suscripción manda (la del evento puede ser anterior)
      if (!out || inv.id === sub.latestInvoiceId) out = { created, invoiceId: inv.id, reason: inv.billingReason };
    }
    return out;
  }

  /**
   * Lo que debía llevar la factura según lo pactado: la base (sin impuestos) y los tipos de lo que va EN ELLA (las
   * cuotas vigentes y los importes únicos de esa factura, no los cobrados en otras). Base null: no se puede saber.
   *  - Alta: el primer pago ofrecido en la sesión (0 si el primer cargo se aplazó al inicio del acuerdo).
   *  - Renovación: la cuota vigente más los importes únicos nuestros que Stripe metió en ESA factura.
   */
  private async expectedOf(row: TermsBillingRow, sub: GwSubscription, plan: BillingPlan | null, inv: GwInvoice): Promise<{ subtotal: number | null; ratesBp: number[] }> {
    const rates = (keys: string[]) => Array.from(new Set([...(plan?.items ?? []).map((i) => i.taxRateBp), ...(plan?.oneOffs ?? []).filter((o) => keys.includes(o.key)).map((o) => o.taxRateBp)]));
    if (inv.billingReason === "subscription_create") return { subtotal: row.checkout ? (row.checkout.firstChargeAt ? 0 : row.checkout.firstChargeCents) : null, ratesBp: rates(Object.keys(row.checkout?.oneOffs ?? {})) };
    if (inv.billingReason !== "subscription_cycle" || !plan || plan.termsId === null || !this.d.gateway.invoiceItemsOfCustomer) return { subtotal: null, ratesBp: rates([]) };
    const oneOffs = (await this.d.gateway.invoiceItemsOfCustomer(sub.customerId)).filter((i) => i.invoiceId === inv.id && i.metadata.es_stripe_subscription === sub.id);
    return { subtotal: plan.recurringNetCents + oneOffs.reduce((a, i) => a + i.amount, 0), ratesBp: rates(oneOffs.map((i) => i.metadata.es_key ?? "")) };
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
    // También con el interruptor apagado: lo ya enlazado se sigue comparando (y su fin se sigue llevando a Stripe)
    for (const row of await this.d.store.list({ status: LINKED_STATES, limit })) {
      try {
        // Fechas de corte: si lo pactado cambió por una FECHA (fin de una condición temporal, acuerdo programado que
        // empieza, cargo que vence) o el último envío falló, se deja en Stripe ahora, para que no siga cobrando lo
        // anterior. Solo envía lo que rige DENTRO; lo que alguien cambie en Stripe a mano nunca se corrige solo
        if (this.d.enabled && (await this.d.billing.changedSinceSync(row.subscriptionId))) {
          opsLog("info", "CommercialTerms", "billing_sync_by_date", { subscriptionId: row.subscriptionId });
          await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
        }
        let r = await this.d.billing.reconcile(row.subscriptionId, { whenOff: true });
        // Condiciones terminadas sin sucesor: la sincronización programa el fin en Stripe (y avisa); no sigue cobrándolas
        if (this.d.enabled && r.available && !r.plan.items.length && r.stripe && r.stripe.status !== "canceled" && r.stripe.cancelAtPeriodEnd === false) {
          await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
          r = await this.d.billing.reconcile(row.subscriptionId, { whenOff: true });
        }
        if (!r.available) continue;
        // Única corrección automática, y en el sentido prudente: una contratación que termina deja de renovarse en
        // Stripe al final del periodo ya pagado. Todo lo demás solo se avisa
        if (r.differences.some((x) => x.key === "fin_sin_programar")) {
          await this.d.billing.syncIfOpen(row.subscriptionId, this.actor);
          r = await this.d.billing.reconcile(row.subscriptionId, { whenOff: true });
          if (!r.available) continue;
        }
        out.checked++;
        const differences: Array<{ key: string; kind: string }> = r.differences.map((x) => ({ key: x.key, kind: x.kind }));
        // La última factura cobrada: si su base o su impuesto no son los pactados, cuenta como diferencia hasta que
        // otra factura posterior salga bien
        const last = row.lastPaidInvoiceId ? await this.d.store.invoice(row.lastPaidInvoiceId) : null;
        if (last?.taxCheck && last.taxCheck !== "ok") differences.push({ key: `factura:${last.stripeInvoiceId}:${last.taxCheck}`, kind: "invoice" });
        // Un envío que sigue fallando (cambio de periodicidad, Product sin enlazar…) se reintenta cada vez más espaciado y
        // sin llenar el historial, pero aquí cuenta en cada pasada hasta que se resuelva
        if (r.syncStatus === "failed") differences.push({ key: "sincronización_fallida", kind: "sync" });
        if (differences.length) out.drifted.push({ subscriptionId: row.subscriptionId, differences });
      } catch (e) {
        out.errors++;
        opsLog("warn", "CommercialTerms", "billing_reconcile_failed", { subscriptionId: row.subscriptionId, error: e instanceof Error ? e.name : "error" });
      }
    }
    // Terminadas en Stripe con todo al corriente y la contratación viva dentro (alguien la canceló en Stripe): ya no se
    // cobran y nadie lo ha resuelto. Siguen contando en cada pasada hasta que se vuelvan a poner a cobrar o se terminen
    for (const row of await this.d.store.list({ status: ["canceled"], limit })) {
      try {
        if (row.readOnlyUntil !== null || row.cancelRequestedAt !== null) continue;
        const sub = await this.d.subscriptionStore.get(row.subscriptionId);
        if (!sub || sub.status !== "active" || sub.cancelAt !== null) continue;
        const plan = await this.d.billing.plan(row.subscriptionId);
        if (plan.termsId !== null && plan.items.length) out.drifted.push({ subscriptionId: row.subscriptionId, differences: [{ key: "terminada_solo_en_stripe", kind: "status" }] });
      } catch {
        out.errors++;
      }
    }
    for (const x of out.drifted) opsLog("warn", "CommercialTerms", "billing_drift", { subscriptionId: x.subscriptionId, differences: x.differences });
    if (out.drifted.length) recordFailure("stripe.negotiated_drift");
    return out;
  }

  // ── Operador ────────────────────────────────────────────────────────────────

  /** Programa (o deshace) el fin de la suscripción de Stripe al final del periodo ya pagado. No cobra ni abona nada. */
  async setCancel(subscriptionId: number, cancel: boolean, actor: string) {
    // Programar el FIN sigue permitido con el interruptor apagado (es la forma de dejar de cobrar a un cliente);
    // deshacerlo vuelve a cobrar, así que exige el interruptor
    if (!this.d.enabled && !cancel) throw new NegotiatedBillingError("disabled", "El cobro en Stripe de condiciones personalizadas está apagado");
    let row = await this.d.store.bySubscription(subscriptionId);
    if (!row?.stripeSubscriptionId || !LINKED_STATES.includes(row.status)) throw new NegotiatedBillingError("invalid_state", "Esta suscripción no se cobra en Stripe");
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!cancel && sub && (sub.status === "canceled" || sub.cancelAt != null)) throw new NegotiatedBillingError("invalid_state", "La contratación interna está cancelada o tiene su fin programado: deshazlo primero en la suscripción");
    try {
      // Cada orden del operador es una petición nueva para Stripe (el efecto ya es idempotente: fija un valor)
      await this.d.adapter.setCancelAtPeriodEnd(row.stripeSubscriptionId!, cancel, `terms-cancel-${subscriptionId}-${cancel ? "on" : "off"}-${row.version}-${this.now()}`);
      // La orden queda anotada solo cuando Stripe la ha aceptado: un fin pedido por un operador no es una diferencia de
      // conciliación, pero una orden que falló no puede dar por querido un fin posterior en Stripe
      row = await this.patch((await this.d.store.bySubscription(subscriptionId)) ?? row, { cancelRequestedAt: cancel ? this.now() : null });
    } catch (e) {
      if (e instanceof NegotiatedGatewayError) throw new NegotiatedBillingError("unavailable", e.message);
      throw e;
    }
    opsLog("info", "CommercialTerms", cancel ? "billing_cancel_scheduled" : "billing_cancel_undone", { subscriptionId, actor });
    const fresh = await this.d.gateway.subscription(row.stripeSubscriptionId!);
    if (fresh) await this.handleSubscription(fresh);
    return this.status(subscriptionId);
  }

  /** Estado del cobro para el CRM. Solo lectura; no llama a Stripe. */
  async status(subscriptionId: number) {
    const sub = await this.d.subscriptionStore.get(subscriptionId);
    if (!sub) throw new NegotiatedBillingError("not_found", "Suscripción no encontrada");
    const row = await this.d.store.bySubscription(subscriptionId);
    const plan = await this.d.billing.plan(subscriptionId);
    const pending = !row || row.status === "abandoned" || !row.stripeSubscriptionId;
    const begin = pending ? await this.billingStart(subscriptionId).catch((e) => (e instanceof NegotiatedBillingError ? e.message : Promise.reject(e))) : null;
    const blockers = !pending ? [] : typeof begin === "string" ? [begin] : await this.blockers(subscriptionId, begin!.plan, begin!.at);
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
    // Nada se suspendió (p. ej. un acuerdo sin plan ni plataforma: no hay licencias): nada que devolver ni que alinear
    if (!row.suspendedCapabilities?.length) return;
    const tenantId = await this.tenantOf(row.subscriptionId);
    if (this.d.capabilities && tenantId) {
      const source = `subscription:${row.subscriptionId}`;
      const mine = new Set(row.suspendedCapabilities.map((c) => `${c.capabilityId}\u0000${c.siteId ?? ""}`));
      const back = (await this.d.capabilities.list(tenantId)).filter((g) => g.source === source && g.status === "suspended" && mine.has(`${g.capabilityId}\u0000${g.siteId ?? ""}`));
      if (back.length) await this.d.capabilities.apply(tenantId, back.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId, status: "active" as const, validUntil: g.validUntil, source })), { actor: this.actor, reason, now: this.now() });
    }
    await this.d.licences?.ensure(row.subscriptionId, this.actor, { changed: true }).catch(() => undefined);
  }

  /**
   * El reloj de una contratación enlazada es el de Stripe: el periodo interno pasa a ser el que Stripe está cobrando
   * (empieza cuando el cliente pagó, o en el inicio del acuerdo si el primer cargo se aplazó a esa fecha). Así la
   * renovación interna no depende de que el periodo propio haya vencido, y un fin programado termina con Stripe.
   * Durante el aplazamiento del primer cargo no se toca: el periodo interno ya empieza en el inicio del acuerdo.
   */
  private async followStripePeriod(subscriptionId: number, sub: GwSubscription) {
    if (sub.status === "trialing" || sub.currentPeriodEnd === null || sub.currentPeriodStart === null || sub.currentPeriodStart === undefined) return;
    const start = sub.currentPeriodStart * 1000;
    const end = sub.currentPeriodEnd * 1000;
    try {
      const cur = await this.d.subscriptionStore.get(subscriptionId);
      if (!cur || cur.status === "canceled" || end <= start || (cur.currentPeriodStart === start && cur.currentPeriodEnd === end)) return;
      await this.d.subscriptionStore.mutate(subscriptionId, null, this.actor, this.now(), async (_tx, s) => ({
        patch: { currentPeriodStart: start, currentPeriodEnd: end, anchorDay: new Date(start).getUTCDate(), ...(s.cancelAt !== null ? { cancelAt: end } : {}) },
        event: { kind: "renewed" as const, before: { periodStart: s.currentPeriodStart, periodEnd: s.currentPeriodEnd }, after: { periodStart: start, periodEnd: end, source: "stripe" }, reason: "El periodo sigue al de la suscripción de Stripe" },
        result: null,
      }));
    } catch (e) {
      opsLog("warn", "CommercialTerms", "billing_period_follow_failed", { subscriptionId, error: e instanceof Error ? e.name : "error" });
    }
  }

  /**
   * Fin en Stripe: la suscripción interna termina AHORA, aunque tenga renovaciones propias sin aplicar o su periodo
   * aún no haya vencido (Stripe ya no cobrará más). Se cierran sus partidas vivas; nada se borra.
   */
  private async endInternal(subscriptionId: number) {
    try {
      const sub = await this.d.subscriptionStore.get(subscriptionId);
      if (!sub || sub.status === "canceled") return;
      const now = this.now();
      await this.d.subscriptionStore.mutate(subscriptionId, null, this.actor, now, async (tx, s) => {
        for (const i of await tx.items()) if (i.effectiveTo === null || i.effectiveTo > now) await tx.endItem(i.id, Math.max(i.effectiveFrom, now));
        return { patch: { status: "canceled" as const, canceledAt: now, cancelAt: s.cancelAt ?? now }, event: { kind: "canceled" as const, before: { status: s.status }, after: { canceledAt: now, source: "stripe" }, reason: "Fin de la suscripción en Stripe" }, result: null };
      });
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
      if (e instanceof BillingStoreConflict) return void res.status(409).json({ error: "conflict", message: "Otra operación cambió el cobro de esta suscripción: inténtalo de nuevo" });
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
