/**
 * Motor de transiciones temporales del circuito comercial.
 *
 * `plan(now)` es de SOLO LECTURA: calcula qué toca hacer porque ha pasado el tiempo. `run(now)` lo
 * aplica, siempre por los caminos que ya existen y con sus mismas garantías:
 *
 *   renovación o fin de periodo     → `orchestrator.review` (renew: periodo nuevo o cancelación efectiva)
 *   recibo vencido sin pagar        → `orchestrator.review` (activo → impago, con gracia)
 *   gracia agotada (sin Stripe)     → `orchestrator.review` (impago → suspendido, licencias suspendidas)
 *   partidas que empiezan o acaban  → `licensing.apply` (solo altas nuevas, bajas y cambios de fecha;
 *                                     nunca reactiva una licencia suspendida o en solo lectura)
 *
 * Lo demás solo se SEÑALA, para quien deba actuar:
 *   avisos de impago y de fin de prueba  → el futuro despachador de notificaciones (no se envía nada);
 *   vencimiento de la prueba             → la tarea de pruebas existente (`CP_TRIALS_SCHEDULER_ENABLED`);
 *   impago de un pedido cobrado en Stripe → Stripe (sus reintentos deciden la suspensión);
 *   revisión de conservación (D-17)      → un operador. Nada se archiva ni se borra.
 *   aviso previo al archivado            → evento `access.archive_notice` (lo envía el despachador). No archiva.
 *
 * Idempotente: cada transición la protege su almacén (versión esperada); repetir un tick no repite nada.
 * Sin conversión automática de la prueba a pago (D-16).
 */
import { opsLog } from "../_core/ops/log";
import { COMPANY_WIDE, type CapabilityGrant } from "../_core/capabilities/model";
import type { LicencePlan, LicensingService } from "../licensing/service";
import type { CommercialOrchestrator } from "../orchestrator/service";
import { isStripeProvider } from "../orchestrator/service";
import type { OrderStore } from "../orchestrator/store";
import type { CommercialOrder, OrderState } from "../orchestrator/types";
import type { SubscriptionStore } from "../subscriptions/store";
import type { TrialStore } from "../trials/store";
import type { LifecyclePolicy } from "./policy";
import type { CapabilityStore } from "../_core/capabilities/store";
import type { CommercialEventSink } from "../commercialEvents/types";

const DAY = 86_400_000;
export const LIFECYCLE_ACTOR = "system:lifecycle";

export type LifecycleActionKind =
  | "renew"
  | "end_subscription"
  | "mark_past_due"
  | "suspend"
  | "licence_sync"
  | "licence_drift"
  | "dunning_notice"
  | "stripe_dunning"
  | "trial_notice"
  | "trial_expire"
  | "retention_review"
  | "read_only_end"
  | "archive_notice";

/** Quién ejecuta la acción: este motor, otro proceso existente, el despachador futuro o una persona. */
export type LifecycleExecutor = "engine" | "trial_scheduler" | "stripe" | "notifications" | "operator";

export interface LifecycleAction {
  kind: LifecycleActionKind;
  executor: LifecycleExecutor;
  dueAt: number;
  orderId: number | null;
  trialId: number | null;
  subscriptionId: number | null;
  tenantId: string | null;
  detail: Record<string, string | number | boolean | null>;
}

export interface LifecyclePlan {
  at: number;
  actions: LifecycleAction[];
  /** Recuento por tipo de acción. */
  counts: Partial<Record<LifecycleActionKind, number>>;
  /** Pedidos que no se han podido evaluar (sin detalles internos). */
  errors: Array<{ orderId: number | null; trialId: number | null; error: string }>;
}

export interface LifecycleRun {
  at: number;
  mode: LifecyclePolicy["mode"];
  skipped: "locked" | null;
  planned: LifecyclePlan["counts"];
  applied: { review: Record<string, number> | null; licenceSynced: number; readOnlyEnded: number; archiveNotices: number };
  errors: number;
}

export interface LifecycleDeps {
  orders: Pick<OrderStore, "list" | "payments">;
  subscriptions: Pick<SubscriptionStore, "get">;
  licensing: Pick<LicensingService, "preview" | "apply">;
  orchestrator: Pick<CommercialOrchestrator, "review">;
  trials?: Pick<TrialStore, "list">;
  /** Retención vigente por reembolso o disputa (Stripe): sus licencias no se tocan. */
  coverageHeld?: (orderId: number) => Promise<boolean>;
  /** Licencias del registro: fin de la solo lectura tras terminar (sin ellas, solo lo decide el acceso). */
  capabilities?: Pick<CapabilityStore, "list" | "apply">;
  /** Registro de eventos comerciales (fin de la solo lectura). */
  events?: CommercialEventSink;
  /** Gracia del orquestador (ms). */
  graceMs: number;
  policy: Pick<LifecyclePolicy, "mode" | "dunningDays" | "trialNoticeDays" | "retentionDays"> & Partial<Pick<LifecyclePolicy, "archiveNoticeDays">>;
  lock?: { acquire(name: string): Promise<(() => Promise<void>) | null> };
  now?: () => number;
}

export const LIFECYCLE_LOCK = "elephant_lifecycle_engine";
const LIVE_OR_ENDING: OrderState[] = ["active", "past_due", "suspended", "cancel_scheduled"];
const BATCH = 1000;
const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 200);

/**
 * ¿Se puede aplicar este cambio de licencias solo por el paso del tiempo? Sí: una baja (cancelled), una
 * capacidad que aún no existe (partida que empieza) o un cambio de fecha sin cambio de estado. No: volver a
 * activar algo suspendido, en solo lectura o cancelado (eso lo decide un pago o una persona).
 */
export function temporalChange(c: LicencePlan["changes"][number], current: CapabilityGrant[]): boolean {
  if (c.status === "cancelled") return true;
  const cur = current.find((g) => g.capabilityId === c.capabilityId && g.siteId === (c.siteId ?? COMPANY_WIDE));
  if (!cur) return true;
  return cur.status === c.status;
}

export class LifecycleEngine {
  private now: () => number;
  constructor(private d: LifecycleDeps) {
    this.now = d.now ?? Date.now;
  }

  private action(kind: LifecycleActionKind, executor: LifecycleExecutor, dueAt: number, ids: Partial<Pick<LifecycleAction, "orderId" | "trialId" | "subscriptionId" | "tenantId">>, detail: LifecycleAction["detail"] = {}): LifecycleAction {
    return { kind, executor, dueAt, orderId: ids.orderId ?? null, trialId: ids.trialId ?? null, subscriptionId: ids.subscriptionId ?? null, tenantId: ids.tenantId ?? null, detail };
  }

  /** Último umbral alcanzado de una lista de días (avisos): el aviso que corresponde ahora, no todos. */
  private lastReached(from: number, list: number[], now: number, sign: 1 | -1) {
    const reached = list.filter((d) => (sign === 1 ? from + d * DAY <= now : from - d * DAY <= now));
    if (!reached.length) return null;
    return sign === 1 ? Math.max(...reached) : Math.min(...reached);
  }

  /** Aviso de archivado que toca ahora (el último umbral alcanzado antes del archivado), o null. */
  private archiveNotice(endedAt: number, now: number, retention: number): number | null {
    const list = (this.d.policy.archiveNoticeDays ?? []).filter((d) => d * DAY < retention);
    if (!list.length || now >= endedAt + retention) return null;
    return this.lastReached(endedAt, list, now, 1);
  }

  /** Licencias propias de un pedido terminado en solo lectura cuyo plazo ya venció. */
  private async readOnlyExpired(o: CommercialOrder, now: number) {
    if (!this.d.capabilities || !o.tenantId || !o.subscriptionId) return [];
    const source = `subscription:${o.subscriptionId}`;
    return (await this.d.capabilities.list(o.tenantId)).filter((g) => g.source === source && g.status === "read_only" && g.validUntil !== null && g.validUntil <= now);
  }

  private async licencePlan(o: CommercialOrder): Promise<LicencePlan | null> {
    if (!o.subscriptionId || !o.tenantId || (o.state !== "active" && o.state !== "cancel_scheduled")) return null;
    if (this.d.coverageHeld && (await this.d.coverageHeld(o.id))) return null;
    const plan = await this.d.licensing.preview(o.subscriptionId, { activate: true });
    return plan.changes.length ? plan : null;
  }

  private async orderActions(o: CommercialOrder, now: number, out: LifecycleAction[]) {
    const ids = { orderId: o.id, subscriptionId: o.subscriptionId, tenantId: o.tenantId };
    const payments = await this.d.orders.payments(o.id);
    const stripe = payments.some((p) => isStripeProvider(p.provider));
    const managed = stripe ? "stripe" : "internal";
    const sub = o.subscriptionId ? await this.d.subscriptions.get(o.subscriptionId) : null;
    if (sub && sub.status !== "canceled" && now >= sub.currentPeriodEnd) {
      const ending = sub.cancelAt !== null && sub.cancelAt <= sub.currentPeriodEnd;
      out.push(this.action(ending ? "end_subscription" : "renew", "engine", sub.currentPeriodEnd, ids, { managedBy: managed }));
    }
    if (o.state === "active") {
      const due = payments.find((p) => p.purpose === "renewal" && p.status !== "succeeded" && p.dueAt !== null && p.dueAt <= now);
      if (due) out.push(this.action("mark_past_due", "engine", due.dueAt!, ids, { paymentId: due.id, managedBy: managed }));
    }
    if (o.state === "past_due" && o.graceEndsAt !== null) {
      const since = o.graceEndsAt - this.d.graceMs;
      const day = this.lastReached(since, this.d.policy.dunningDays, now, 1);
      if (day !== null && now < o.graceEndsAt) out.push(this.action("dunning_notice", "notifications", since + day * DAY, ids, { day, graceEndsAt: o.graceEndsAt, managedBy: managed }));
      if (now >= o.graceEndsAt) out.push(stripe ? this.action("stripe_dunning", "stripe", o.graceEndsAt, ids, { graceEndsAt: o.graceEndsAt }) : this.action("suspend", "engine", o.graceEndsAt, ids, { graceEndsAt: o.graceEndsAt }));
    }
    const lic = await this.licencePlan(o);
    if (lic) {
      const temporal = lic.changes.every((c) => temporalChange(c, lic.current));
      const ending = lic.changes.filter((c) => c.status === "cancelled").length;
      out.push(this.action(temporal ? "licence_sync" : "licence_drift", temporal ? "engine" : "operator", now, ids, { changes: lic.changes.length, removals: ending }));
    }
  }

  async plan(now = this.now()): Promise<LifecyclePlan> {
    const actions: LifecycleAction[] = [];
    const errors: LifecyclePlan["errors"] = [];
    for (const o of await this.d.orders.list({ states: LIVE_OR_ENDING, limit: BATCH })) {
      try {
        await this.orderActions(o, now, actions);
      } catch (e) {
        errors.push({ orderId: o.id, trialId: null, error: msg(e) });
      }
    }
    // Conservación tras el fin (D-17 propuesto): solo se señala
    const retention = this.d.policy.retentionDays * DAY;
    for (const o of await this.d.orders.list({ states: ["cancelled"], limit: BATCH })) {
      const endedAt = o.updatedAt ?? o.createdAt;
      if (endedAt + retention <= now) actions.push(this.action("retention_review", "operator", endedAt + retention, { orderId: o.id, subscriptionId: o.subscriptionId, tenantId: o.tenantId }, { endedAt }));
      const notice = this.archiveNotice(endedAt, now, retention);
      if (notice !== null) actions.push(this.action("archive_notice", "notifications", endedAt + notice * DAY, { orderId: o.id, subscriptionId: o.subscriptionId, tenantId: o.tenantId }, { day: notice, archiveAt: endedAt + retention, companyId: o.companyId ?? null }));
      // Plazo de solo lectura vencido: el acceso ya lo deniega; aquí se cancelan las licencias (registro limpio)
      const expired = await this.readOnlyExpired(o, now);
      if (expired.length) actions.push(this.action("read_only_end", "engine", Math.max(...expired.map((g) => g.validUntil!)), { orderId: o.id, subscriptionId: o.subscriptionId, tenantId: o.tenantId }, { licences: expired.length }));
    }
    if (this.d.trials) {
      for (const t of await this.d.trials.list({ states: ["active", "expired"], limit: BATCH })) {
        if (t.endsAt === null) continue;
        const ids = { trialId: t.id, tenantId: t.tenantId };
        if (t.state === "active" && t.endsAt <= now) actions.push(this.action("trial_expire", "trial_scheduler", t.endsAt, ids));
        if (t.state === "active" && now < t.endsAt) {
          const d = this.lastReached(t.endsAt, this.d.policy.trialNoticeDays, now, -1);
          if (d !== null) actions.push(this.action("trial_notice", "notifications", t.endsAt - d * DAY, ids, { daysLeft: d, endsAt: t.endsAt }));
        }
        if (t.state === "expired" && t.endsAt + retention <= now) actions.push(this.action("retention_review", "operator", t.endsAt + retention, ids, { endedAt: t.endsAt }));
        const notice = t.state === "expired" ? this.archiveNotice(t.endsAt, now, retention) : null;
        if (notice !== null) actions.push(this.action("archive_notice", "notifications", t.endsAt + notice * DAY, ids, { day: notice, archiveAt: t.endsAt + retention, companyId: null }));
      }
    }
    const counts: LifecyclePlan["counts"] = {};
    for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    return { at: now, actions, counts, errors };
  }

  /** Un tick: planifica y, en modo «apply», ejecuta lo que corresponde al motor. */
  async run(now = this.now()): Promise<LifecycleRun> {
    const out: LifecycleRun = { at: now, mode: this.d.policy.mode, skipped: null, planned: {}, applied: { review: null, licenceSynced: 0, readOnlyEnded: 0, archiveNotices: 0 }, errors: 0 };
    const release = this.d.lock ? await this.d.lock.acquire(LIFECYCLE_LOCK) : async () => undefined;
    if (!release) {
      out.skipped = "locked";
      return out;
    }
    try {
      const plan = await this.plan(now);
      out.planned = plan.counts;
      out.errors = plan.errors.length;
      if (this.d.policy.mode === "apply") {
        const orderWork = plan.actions.some((a) => a.executor === "engine" && a.kind !== "licence_sync" && a.kind !== "read_only_end");
        if (orderWork) {
          const r = await this.d.orchestrator.review(LIFECYCLE_ACTOR);
          const { errors, ...counts } = r;
          out.applied.review = counts;
          out.errors += errors.length;
        }
        for (const a of plan.actions.filter((x) => x.kind === "licence_sync")) {
          try {
            // Se recalcula: la revisión pudo haberlas aplicado ya (renovación) o cambiar el pedido
            const orders = await this.d.orders.list({ states: ["active", "cancel_scheduled"], limit: BATCH });
            const o = orders.find((x) => x.id === a.orderId);
            const lic = o ? await this.licencePlan(o) : null;
            if (!lic || !lic.changes.every((c) => temporalChange(c, lic.current))) continue;
            await this.d.licensing.apply(lic.subscriptionId, { activate: true, actor: LIFECYCLE_ACTOR, reason: "Partidas que empiezan o terminan por fecha" });
            out.applied.licenceSynced++;
          } catch {
            out.errors++;
          }
        }
        for (const a of plan.actions.filter((x) => x.kind === "read_only_end")) {
          try {
            const o = (await this.d.orders.list({ states: ["cancelled"], limit: BATCH })).find((x) => x.id === a.orderId);
            if (!o || !this.d.capabilities) continue;
            const expired = await this.readOnlyExpired(o, now);
            if (!expired.length) continue;
            const source = `subscription:${o.subscriptionId}`;
            await this.d.capabilities.apply(o.tenantId!, expired.map((g) => ({ capabilityId: g.capabilityId, siteId: g.siteId, status: "cancelled" as const, validUntil: g.validUntil, source })), { actor: LIFECYCLE_ACTOR, reason: "Fin del periodo de solo lectura tras terminar la suscripción", now });
            await this.d.events?.append(null, [
              {
                key: `order:${o.id}:read_only_ended`,
                type: "access.read_only_ended",
                aggregate: { type: "order", id: String(o.id), version: o.version },
                correlationId: `order:${o.id}`,
                tenantId: o.tenantId,
                companyId: o.companyId,
                orderId: o.id,
                subscriptionId: o.subscriptionId,
                trialId: o.trialId,
                paymentId: null,
                stripeRef: null,
                fromState: "read_only",
                toState: "cancelled",
                actor: LIFECYCLE_ACTOR,
                occurredAt: now,
                data: { licences: expired.length },
              },
            ]);
            out.applied.readOnlyEnded++;
          } catch {
            out.errors++;
          }
        }
        // Avisos previos al archivado: un evento por umbral (la clave lo hace idempotente); lo envía el despachador
        for (const a of plan.actions.filter((x) => x.kind === "archive_notice")) {
          if (!this.d.events) break;
          try {
            const agg = a.orderId !== null ? { type: "order" as const, id: String(a.orderId) } : { type: "trial" as const, id: String(a.trialId) };
            const r = await this.d.events.append(null, [
              {
                key: `${agg.type}:${agg.id}:archive_notice:${a.detail.day}`,
                type: "access.archive_notice",
                aggregate: { ...agg, version: null },
                correlationId: `${agg.type}:${agg.id}`,
                tenantId: a.tenantId,
                companyId: typeof a.detail.companyId === "number" ? a.detail.companyId : null,
                orderId: a.orderId,
                subscriptionId: a.subscriptionId,
                trialId: a.trialId,
                paymentId: null,
                stripeRef: null,
                fromState: null,
                toState: null,
                actor: LIFECYCLE_ACTOR,
                occurredAt: now,
                data: { day: a.detail.day, archiveAt: a.detail.archiveAt },
              },
            ]);
            out.applied.archiveNotices += r.written;
          } catch {
            out.errors++;
          }
        }
      }
    } finally {
      await release().catch(() => undefined);
    }
    if (Object.keys(out.planned).length || out.errors) opsLog(out.errors ? "warn" : "info", "Lifecycle", "tick", { mode: out.mode, planned: out.planned, review: out.applied.review, licenceSynced: out.applied.licenceSynced, readOnlyEnded: out.applied.readOnlyEnded, archiveNotices: out.applied.archiveNotices, errors: out.errors });
    return out;
  }
}

/** Tarea periódica. No hace nada al arrancar (primer tick al cabo de un minuto) y nunca solapa ticks. */
export function startLifecycleScheduler(o: { engine: LifecycleEngine; policy: Pick<LifecyclePolicy, "enabled" | "intervalMs">; timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } }) {
  if (!o.policy.enabled) return { enabled: false, stop: () => undefined };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  let busy = false;
  let stopped = false;
  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await o.engine.run();
    } catch (e) {
      opsLog("error", "Lifecycle", "tick_failed", { error: e instanceof Error ? e.name : "error" });
    } finally {
      busy = false;
    }
  };
  const first = timers.setTimeout(() => void run(), Math.min(o.policy.intervalMs, 60_000));
  const every = timers.setInterval(() => void run(), o.policy.intervalMs);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  return {
    enabled: true,
    stop: () => {
      stopped = true;
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}
