/**
 * Lo que una empresa ve de sus condiciones comerciales en «Mi plan»: SOLO lectura y con la presentación que eligió el
 * administrador (con cuota global no sale ningún precio por partida). La empresa nunca puede modificar sus precios
 * negociados: no hay ninguna ruta de escritura para su token.
 */
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

export function tenantTermsReader(terms: CommercialTermsService, store: TermsStore, subscriptions: Pick<SubscriptionStore, "list">, now: () => number) {
  return async (tenantId: string, companyId: number): Promise<TenantCustomTerms | null> => {
    // La suscripción viva de ESA empresa y ESA plataforma; si no es única, no se muestra nada (nunca la de otra)
    const live = (await subscriptions.list({ companyId })).filter((s) => s.status !== "canceled" && s.companyId === companyId && (s.tenantId === tenantId || s.tenantId === null));
    if (live.length !== 1) return null;
    const sub = live[0];
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
