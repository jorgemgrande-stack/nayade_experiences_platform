/**
 * Estado de activación de cada producto para el panel de una empresa (solo lectura), a partir de sus pedidos
 * comerciales: la licencia solo existe cuando el circuito de siempre (cobro verificado → confirmar → suscripción →
 * licencias) deja el pedido activo. Aquí no se cambia nada.
 *
 *  - active: lo incluye el pedido vigente (activo, impagado, suspendido o con baja programada).
 *  - pending: compra iniciada que espera el cobro (pedido solicitado, presupuestado o contratado).
 *  - processing: cobro verificado; se están concediendo la suscripción y las licencias.
 *  - error: la última compra de ese producto se rechazó o falló hace menos de ERROR_WINDOW_MS; se puede reintentar.
 *  - none: nada de lo anterior.
 */
import type { CrmStore } from "../crm/store";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder, OrderState } from "../orchestrator/types";
import { planFromOrders } from "./panelMarketplace";

export type ActivationState = "none" | "pending" | "processing" | "active" | "error";
export interface PanelActivation {
  state: ActivationState;
  retryable: boolean;
  updatedAt: number | null;
}

/** Cuánto tiempo se muestra una compra fallida como error recuperable. */
export const ERROR_WINDOW_MS = 7 * 24 * 3600 * 1000;
const CURRENT: ReadonlySet<OrderState> = new Set<OrderState>(["active", "past_due", "suspended", "cancel_scheduled"]);
const PENDING: ReadonlySet<OrderState> = new Set<OrderState>(["requested", "quoted", "contracted"]);
const PROCESSING: ReadonlySet<OrderState> = new Set<OrderState>(["confirmed", "subscribed", "licensed"]);

const keysOf = (o: CommercialOrder) => (o.request?.items ?? []).map((i) => i.key).filter((k, i, a) => a.indexOf(k) === i);
const at = (o: CommercialOrder) => o.updatedAt ?? o.createdAt;

/** Estado por clave de producto de los pedidos de UNA empresa (ya filtrados por empresa). */
export function activationFromOrders(orders: readonly CommercialOrder[], tenantId: string, now: number): Map<string, PanelActivation> {
  const own = orders.filter((o) => o.tenantId === tenantId || (o.tenantId === null && PENDING.has(o.state)));
  const out = new Map<string, PanelActivation>();
  const current = own.filter((o) => CURRENT.has(o.state)).sort((a, b) => b.id - a.id)[0];
  if (current) for (const k of keysOf(current)) out.set(k, { state: "active", retryable: false, updatedAt: at(current) });
  // Lo más reciente manda entre las compras en curso o fallidas de cada producto que no está ya activo
  for (const o of [...own].sort((a, b) => a.id - b.id)) {
    if (current && o.id <= current.id) continue;
    const state: ActivationState | null = PENDING.has(o.state) ? "pending" : PROCESSING.has(o.state) ? "processing" : o.state === "rejected" && now - at(o) <= ERROR_WINDOW_MS ? "error" : null;
    if (!state) continue;
    for (const k of keysOf(o)) if (out.get(k)?.state !== "active") out.set(k, { state, retryable: state === "error", updatedAt: at(o) });
  }
  return out;
}

/** Plan vigente de la empresa del tenant (audiencia de las campañas del carrusel), o null. */
export function orderPlan(d: { crm: CrmStore; orders: OrderStore }) {
  return async (tenantId: string): Promise<string | null> => {
    const company = (await d.crm.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number } | undefined;
    return company ? planFromOrders(await d.orders.list({ companyId: company.id }), tenantId) : null;
  };
}

/** Lector para el catálogo del panel: empresa del tenant → sus pedidos → estado por producto. */
export function orderActivation(d: { crm: CrmStore; orders: OrderStore; now?: () => number }) {
  return async (tenantId: string): Promise<Map<string, PanelActivation>> => {
    const company = (await d.crm.list("companies", { tenantId }, { limit: 2 }))[0] as { id: number } | undefined;
    if (!company) return new Map();
    return activationFromOrders(await d.orders.list({ companyId: company.id }), tenantId, (d.now ?? Date.now)());
  };
}
