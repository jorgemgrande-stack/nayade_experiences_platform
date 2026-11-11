/**
 * Suscripciones SOLO ECONÓMICAS (acuerdos sin plan Core): reglas puras, sin dependencias.
 *
 * Viven aquí, y no en `server/subscriptions/`, porque también las usa código que entra en el binario de Náyade
 * (`server/organization/service.ts`), que no puede importar el motor de suscripciones (server/nayadeBundle.test.ts).
 * `server/subscriptions/service.ts` las reexporta.
 */

/** Partida tal como la ven estas reglas (un subconjunto de `SubscriptionItem`). */
export interface EconomicItem {
  productKey: string;
  family: string;
  activationKind?: string | null;
  effectiveFrom: number;
  effectiveTo: number | null;
}

/** Activación que no concede nada DENTRO de la plataforma: un servicio o nada. */
export const independentActivation = (kind: string | null | undefined): boolean => kind === "none" || kind === "service";

/**
 * ¿Concede la partida algo en la plataforma? El plan y todo producto con activación dentro de ella. Una partida a
 * medida o un ajuste de un acuerdo (clave con «:», imposible en el catálogo) y un servicio puro, no.
 */
export const grantsOnPlatform = (i: Pick<EconomicItem, "productKey" | "family" | "activationKind">): boolean =>
  !i.productKey.includes(":") && (i.family === "core_plan" || !independentActivation(i.activationKind));

/**
 * Suscripción SOLO ECONÓMICA: ninguna de sus partidas vivas o programadas concede nada en la plataforma (solo partidas
 * a medida y servicios puros del catálogo). No es «la suscripción» de la empresa para el circuito del SaaS (pruebas,
 * pedidos, licencias, límites, «Mi plan»): es invisible para él. Una suscripción ordinaria viva siempre tiene su plan.
 */
export function isEconomicOnly(items: ReadonlyArray<EconomicItem>, now: number): boolean {
  return !items.some((i) => (i.effectiveTo === null || (i.effectiveTo > now && i.effectiveTo > i.effectiveFrom)) && grantsOnPlatform(i));
}
