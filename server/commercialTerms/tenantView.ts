/**
 * Lo que una empresa ve de sus condiciones comerciales en «Mi plan»: SOLO lectura y con la presentación que eligió el
 * administrador (con cuota global no sale ningún precio por partida). La empresa nunca puede modificar sus precios
 * negociados: no hay ninguna ruta de escritura para su token.
 */
import { isEconomicOnly } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { presentTerms, type ClientView } from "./presentation";
import type { CommercialTermsService } from "./service";
import type { ContractingStage } from "./stripeBilling";
import type { TermsStore } from "./store";

/**
 * Contratación ya FORMALIZADA (acuerdo aceptado) vista por la empresa mientras sigue en prueba o después. Todo sale de las
 * fuentes reales (el acuerdo aceptado y el estado de cobro verificado por Stripe); nada se supone. Solo lectura.
 */
export interface TenantContracting {
  /** Plan Core del acuerdo (null si el acuerdo no incluye plan: solo extensiones o servicios). */
  planName: string | null;
  /** Resto de partidas recurrentes del acuerdo (extensiones, módulos). */
  extensions: string[];
  /** Cuándo aceptó el cliente (ms) o null si no consta. */
  acceptedAt: number | null;
  /** Etapa del cobro (la misma que ve Administración): payment_pending, activation_scheduled, active, payment_failed… */
  stage: ContractingStage["stage"];
  /** Solo true con el cobro enlazado por webhook verificado de Stripe (nunca por volver de una página de éxito). */
  paymentMethodAuthorized: boolean;
  /** Prueba todavía vigente y su fin (ms). */
  trialActive: boolean;
  trialEndsAt: number | null;
  /** Primer cobro (o próximo) previsto (ms); null si no hay método autorizado. NO es un cobro efectuado. */
  nextChargeAt: number | null;
  /** Cuota que se cobrará, con IVA desglosado (céntimos). */
  recurring: { netCents: number; taxCents: number; totalCents: number; currency: string } | null;
}

export interface TenantCustomTerms {
  /** Condiciones vigentes, tal como se le presentaron al cliente. */
  current: ClientView;
  /** Cuota recurrente que rige hoy (puede diferir de la inicial si venció un descuento temporal). */
  today: { netCents: number; taxCents: number; totalCents: number };
  /** Condiciones ya pactadas que entrarán en vigor más adelante. */
  upcoming: ClientView | null;
  renewsAt: number | null;
  /** Contratación formalizada y estado de cobro (null si no se pudo leer o no hay acuerdo aceptado). */
  contracting?: TenantContracting | null;
  timeZone: "Europe/Madrid";
}

export function tenantTermsReader(terms: CommercialTermsService, store: TermsStore, subscriptions: Pick<SubscriptionStore, "list"> & Partial<Pick<SubscriptionStore, "items">>, now: () => number, contractingOf?: (subscriptionId: number) => Promise<ContractingStage | null>) {
  /**
   * Suscripción solo económica (`isEconomicOnly`: partidas a medida y servicios puros, nada que conceda algo en la
   * plataforma): no es el plan de ninguna plataforma. No se muestra en «Mi plan» ni estorba a la suscripción que sí lo es.
   */
  // Una enlazada a una plataforma es del SaaS aunque un acuerdo la haya dejado sin plan
  const economicOnly = async (s: { id: number; tenantId: string | null }) => !s.tenantId && !!subscriptions.items && isEconomicOnly(await subscriptions.items(s.id), now());
  return async (tenantId: string, companyId: number, subscriptionId?: number | null): Promise<TenantCustomTerms | null> => {
    // La suscripción viva de ESA empresa y ESA plataforma: la del pedido vigente si la hay; si no, la única que tenga
    // (si no es única, no se muestra nada). Nunca la de otra empresa
    const live = [];
    for (const s of (await subscriptions.list({ companyId })).filter((s) => s.status !== "canceled" && s.companyId === companyId && (s.tenantId === tenantId || s.tenantId === null))) if (!(await economicOnly(s))) live.push(s);
    const sub = subscriptionId != null ? live.find((s) => s.id === subscriptionId) : live.length === 1 ? live[0] : undefined;
    if (!sub) return null;
    const cur = await terms.currentTerms(sub.id);
    if (!cur || cur.companyId !== companyId) return null;
    const all = await store.list({ subscriptionId: sub.id, status: ["active", "scheduled"] });
    const next = cur.nextTermsId !== null ? (all.find((t) => t.id === cur.nextTermsId) ?? null) : null;
    const upcoming = all.filter((t) => t.id !== cur.id && t.effectiveFrom !== null && t.effectiveFrom > now() && (t.closedAt === null || t.closedAt > t.effectiveFrom)).sort((a, b) => a.effectiveFrom! - b.effectiveFrom!)[0] ?? null;
    const today = (await terms.ofSubscription(sub.id)).currentRecurring;
    const view = presentTerms(cur, next);
    // Acuerdo ACEPTADO y su cobro, de las fuentes reales; si no se puede leer, la pantalla sigue como siempre (nunca rompe «Mi plan»)
    const st = contractingOf ? await contractingOf(sub.id).catch(() => null) : null;
    const isPlan = (l: { kind: string; chargeClass: string; catalog?: { family?: string } | null }) => l.kind === "catalog" && l.chargeClass === "recurring" && l.catalog?.family === "core_plan";
    const recurringLines = cur.lines.filter((l) => l.chargeClass === "recurring");
    const contracting: TenantContracting | null =
      st && st.acceptedAt !== null
        ? {
            planName: recurringLines.find(isPlan)?.name ?? null,
            extensions: recurringLines.filter((l) => !isPlan(l)).map((l) => l.name),
            acceptedAt: st.acceptedAt,
            stage: st.stage,
            paymentMethodAuthorized: st.paymentMethodAuthorized,
            trialActive: st.trialActive,
            trialEndsAt: st.trialEndsAt,
            nextChargeAt: st.nextChargeAt,
            recurring: st.recurring ? { netCents: st.recurring.netCents, taxCents: st.recurring.taxCents, totalCents: st.recurring.totalCents, currency: st.recurring.currency } : null,
          }
        : null;
    return {
      current: view,
      today: today ? { netCents: today.netCents, taxCents: today.taxCents, totalCents: today.totalCents } : { netCents: view.recurring.netCents, taxCents: view.recurring.taxCents, totalCents: view.recurring.totalCents },
      upcoming: upcoming ? presentTerms(upcoming) : null,
      renewsAt: sub.cancelAt ? null : sub.currentPeriodEnd,
      contracting,
      timeZone: "Europe/Madrid",
    };
  };
}
