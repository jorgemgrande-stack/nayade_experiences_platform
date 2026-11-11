/**
 * Lo que una empresa ve de sus condiciones comerciales en «Mi plan»: SOLO lectura y con la presentación que eligió el
 * administrador (con cuota global no sale ningún precio por partida). La empresa nunca puede modificar sus precios
 * negociados: no hay ninguna ruta de escritura para su token.
 */
import { isEconomicOnly } from "../subscriptions/service";
import type { SubscriptionStore } from "../subscriptions/store";
import { presentTerms, type ClientView } from "./presentation";
import type { CommercialTermsService } from "./service";
import type { TermsStore } from "./store";

export interface TenantCustomTerms {
  /** Condiciones vigentes, tal como se le presentaron al cliente. */
  current: ClientView;
  /** Cuota recurrente que rige hoy (puede diferir de la inicial si venció un descuento temporal). */
  today: { netCents: number; taxCents: number; totalCents: number };
  /** Condiciones ya pactadas que entrarán en vigor más adelante. */
  upcoming: ClientView | null;
  renewsAt: number | null;
  timeZone: "Europe/Madrid";
}

export function tenantTermsReader(terms: CommercialTermsService, store: TermsStore, subscriptions: Pick<SubscriptionStore, "list"> & Partial<Pick<SubscriptionStore, "items">>, now: () => number) {
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
    return {
      current: view,
      today: today ? { netCents: today.netCents, taxCents: today.taxCents, totalCents: today.totalCents } : { netCents: view.recurring.netCents, taxCents: view.recurring.taxCents, totalCents: view.recurring.totalCents },
      upcoming: upcoming ? presentTerms(upcoming) : null,
      renewsAt: sub.cancelAt ? null : sub.currentPeriodEnd,
      timeZone: "Europe/Madrid",
    };
  };
}
