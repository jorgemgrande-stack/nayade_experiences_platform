/**
 * Estado de la empresa en el registro según su situación comercial real.
 *
 * Hasta ahora nada movía el registro: una empresa que pagaba, impagaba, se suspendía o terminaba seguía
 * en `trial`. La regla (pura) sale de los pedidos de la empresa:
 *
 *   pedido activo o con cancelación programada  → active
 *   impago dentro de la gracia                  → grace
 *   suspendido (impago agotado o retención)     → suspended
 *   suscripción terminada                       → suspended (panel en solo lectura, web pública cerrada,
 *                                                  datos conservados). Archivar o borrar es manual (D-17).
 *   sin pedido vivo ni terminado                → no se toca (prueba, alta en curso…)
 *
 * Nunca se tocan empresas en `provisioning`, `archived`, `deleting` o `deleted`: esas las decide un
 * operador. El cambio se aplica con `setStatus` del registro (idempotente, transición validada y auditada
 * en `tenant_events`) y queda además en el registro de eventos comerciales. Un fallo aquí nunca deshace
 * un pago ni una activación: lo repara la revisión periódica.
 */
import type { TenantStatus } from "../_core/tenantRegistry/contract";
import type { Actor } from "../_core/tenantRegistry/service";
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import type { CommercialEventDraft, CommercialEventSink } from "../commercialEvents/types";
import type { CommercialOrder } from "./types";

/** Estados que solo cambia un operador (o el alta): la sincronización comercial no los toca. */
const OPERATOR_OWNED: ReadonlySet<TenantStatus> = new Set<TenantStatus>(["provisioning", "archived", "deleting", "deleted"]);

export interface TenantStatusDecision {
  status: TenantStatus;
  /** Código del motivo (se guarda en el registro). */
  reason: string;
  /** Pedido que lo determina. */
  orderId: number;
}

/**
 * Estado que corresponde a la empresa según sus pedidos (de cualquier tipo: alta, conversión o cambio).
 * `null`: ningún pedido decide (se deja como está).
 */
export function desiredTenantStatus(orders: CommercialOrder[]): TenantStatusDecision | null {
  const latest = (states: CommercialOrder["state"][]) => orders.filter((o) => states.includes(o.state)).sort((a, b) => b.id - a.id)[0];
  const live = latest(["active", "cancel_scheduled"]);
  if (live) return { status: "active", reason: live.state === "active" ? "commercial:order_active" : "commercial:cancel_scheduled", orderId: live.id };
  const pastDue = latest(["past_due"]);
  if (pastDue) return { status: "grace", reason: "commercial:payment_overdue", orderId: pastDue.id };
  const suspended = latest(["suspended"]);
  if (suspended) return { status: "suspended", reason: "commercial:suspended", orderId: suspended.id };
  const ended = latest(["cancelled"]);
  if (ended) return { status: "suspended", reason: "commercial:subscription_ended", orderId: ended.id };
  return null;
}

export interface TenantStatusSyncDeps {
  /** Lectura del estado actual de la empresa en el registro. */
  getTenant(tenantId: string): Promise<{ id: string; status: TenantStatus } | null>;
  /** Cambio de estado en el registro (idempotente, validado y auditado). */
  setStatus(tenantId: string, to: TenantStatus, actor: Actor, opts: { reason?: string }): Promise<unknown>;
  /** Pedidos de una empresa. */
  orders(companyId: number): Promise<CommercialOrder[]>;
  events?: CommercialEventSink;
  now?: () => number;
}

export type TenantSyncResult = { changed: false; status: TenantStatus | null; skipped?: string } | { changed: true; from: TenantStatus; to: TenantStatus; reason: string };

export class TenantStatusSync {
  private now: () => number;
  constructor(private d: TenantStatusSyncDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Lleva la empresa del pedido al estado que corresponde. Idempotente. */
  async sync(order: Pick<CommercialOrder, "tenantId" | "companyId">, actor: string): Promise<TenantSyncResult> {
    if (!order.tenantId) return { changed: false, status: null, skipped: "no_tenant" };
    const tenant = await this.d.getTenant(order.tenantId);
    if (!tenant) return { changed: false, status: null, skipped: "unknown_tenant" };
    if (OPERATOR_OWNED.has(tenant.status)) return { changed: false, status: tenant.status, skipped: "operator_owned" };
    // Solo los pedidos de ESTA empresa en ESTA plataforma (nunca los de otra)
    const mine = (await this.d.orders(order.companyId)).filter((o) => o.tenantId === order.tenantId);
    const want = desiredTenantStatus(mine);
    if (!want || want.status === tenant.status) return { changed: false, status: tenant.status };
    await this.d.setStatus(tenant.id, want.status, { type: "system", id: actor.slice(0, 100) }, { reason: want.reason });
    const cause = mine.find((o) => o.id === want.orderId)!;
    await this.record(cause, tenant.status, want, actor);
    opsLog("info", "Orders", "tenant_status_synced", { tenantId: tenant.id, from: tenant.status, to: want.status, orderId: want.orderId });
    return { changed: true, from: tenant.status, to: want.status, reason: want.reason };
  }

  /** Igual que `sync`, pero nunca lanza: el pago o la activación ya están guardados. */
  async syncSafely(order: Pick<CommercialOrder, "id" | "tenantId" | "companyId">, actor: string): Promise<TenantSyncResult | null> {
    try {
      return await this.sync(order, actor);
    } catch (e) {
      opsLog("error", "Orders", "tenant_status_sync_failed", { orderId: order.id, tenantId: order.tenantId, error: e instanceof Error ? e.name : "error" });
      recordFailure("orders.tenant_sync_failed");
      return null;
    }
  }

  private async record(cause: CommercialOrder, from: TenantStatus, want: TenantStatusDecision, actor: string) {
    if (!this.d.events) return;
    const draft: CommercialEventDraft = {
      key: `order:${cause.id}:v${cause.version}:tenant_status:${want.status}`,
      type: "tenant.status_changed",
      aggregate: { type: "order", id: String(cause.id), version: cause.version },
      correlationId: `order:${cause.id}`,
      tenantId: cause.tenantId,
      companyId: cause.companyId,
      orderId: cause.id,
      subscriptionId: cause.subscriptionId,
      trialId: cause.trialId,
      paymentId: null,
      stripeRef: null,
      fromState: from,
      toState: want.status,
      actor,
      occurredAt: this.now(),
      data: { reason: want.reason, orderState: cause.state },
    };
    // Otra BD (CRM) que el registro: si falla, el estado ya cambió y la revisión no lo repetirá; se avisa
    await this.d.events.append(null, [draft]).catch((e) => opsLog("warn", "Orders", "tenant_status_event_failed", { orderId: cause.id, error: e instanceof Error ? e.name : "error" }));
  }
}
