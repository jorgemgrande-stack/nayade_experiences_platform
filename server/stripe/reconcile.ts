/**
 * Conciliación periódica con Stripe (Fase C). SOLO MODO PRUEBAS. Recuperable y segura con varias réplicas:
 * un arrendamiento en `stripe_sync_state` impide que dos ejecuciones se solapen.
 *
 * En cada pasada:
 *  1. Webhooks perdidos: lista `GET /v1/events` (tipos gestionados) desde el último cursor, con un margen
 *     hacia atrás, y registra los que falten (`source = reconcile`). Stripe conserva los eventos 30 días.
 *  2. Procesa los eventos pendientes o con reintento vencido.
 *  3. Relee las suscripciones no terminadas cuya copia es antigua. Así se recuperan pagos confirmados
 *     no aplicados, altas interrumpidas (el orquestador retoma el paso pendiente) y licencias desfasadas.
 *  4. Cierra en la BD las sesiones de Checkout que ya caducaron.
 *
 * No se programa sola: `startStripeWorker` solo arranca con CP_STRIPE_WORKER_ENABLED=1.
 */
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { HANDLED_EVENTS, type StripeEventProcessor } from "./events";
import type { StripeGateway } from "./gateway";
import type { StripeStore } from "./store";

const LEASE = "reconcile";
const CURSOR = "events_cursor";
/** Margen hacia atrás al pedir eventos (s): cubre relojes desiguales y eventos creados durante la pasada. */
const OVERLAP_S = 600;
/** Primera pasada sin cursor: 3 días atrás (s). */
const FIRST_LOOKBACK_S = 3 * 86_400;

export interface ReconcileDeps {
  store: StripeStore;
  gateway: StripeGateway;
  processor: Pick<StripeEventProcessor, "processDue" | "handleSubscription">;
  now?: () => number;
  leaseMs?: number;
  /** Antigüedad a partir de la cual se relee una suscripción (ms). */
  refreshAfterMs?: number;
  maxEventPages?: number;
}

export interface ReconcileResult {
  skipped: boolean;
  recovered: number;
  events: { processed: number; ignored: number; failed: number; retried: number };
  refreshed: number;
  refreshErrors: number;
  sessionsClosed: number;
}

export class StripeReconciler {
  private now: () => number;
  constructor(private d: ReconcileDeps) {
    this.now = d.now ?? Date.now;
  }

  async tick(): Promise<ReconcileResult> {
    const start = this.now();
    const until = start + (this.d.leaseMs ?? 10 * 60_000);
    const empty = { processed: 0, ignored: 0, failed: 0, retried: 0 };
    if (!(await this.d.store.acquireLease(LEASE, until, start))) return { skipped: true, recovered: 0, events: empty, refreshed: 0, refreshErrors: 0, sessionsClosed: 0 };
    try {
      // 1. Eventos que no llegaron por webhook
      const state = (await this.d.store.getState(CURSOR)) ?? {};
      const cursor = typeof state.cursor === "number" ? state.cursor : Math.floor(start / 1000) - FIRST_LOOKBACK_S;
      let maxCreated = cursor;
      let recovered = 0;
      let startingAfter: string | undefined;
      for (let page = 0; page < (this.d.maxEventPages ?? 10); page++) {
        const r = await this.d.gateway.listEvents({ createdGte: cursor - OVERLAP_S, types: [...HANDLED_EVENTS], startingAfter, limit: 100 });
        for (const ev of r.events) {
          if (ev.livemode !== false) {
            recordFailure("stripe.live_event_rejected");
            continue;
          }
          const rec = await this.d.store.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "reconcile", now: this.now() });
          if (rec.created) recovered++;
          if (ev.created > maxCreated) maxCreated = ev.created;
        }
        if (!r.hasMore || !r.events.length) break;
        startingAfter = r.events[r.events.length - 1].id;
      }
      // 2. Pendientes y reintentos
      const events = await this.d.processor.processDue(100);
      // 3. Copias antiguas: relectura del estado actual
      let refreshed = 0;
      let refreshErrors = 0;
      for (const id of await this.d.store.subscriptionsToRefresh(this.now() - (this.d.refreshAfterMs ?? 15 * 60_000), 200)) {
        try {
          await this.d.processor.handleSubscription(id);
          refreshed++;
        } catch (e) {
          refreshErrors++;
          opsLog("warn", "StripeReconcile", "refresh_failed", { subscriptionId: id, error: e instanceof Error ? e.name : "error" });
        }
      }
      if (refreshErrors) recordFailure("stripe.reconcile_refresh_failed");
      // 4. Sesiones que caducaron sin evento
      let sessionsClosed = 0;
      for (const id of await this.d.store.openSessionsExpiredBefore(this.now(), 200)) {
        const s = await this.d.gateway.checkoutSession(id);
        const status = !s || s.status === "expired" ? "expired" : s.status === "complete" ? "complete" : null;
        if (!status) continue;
        await this.d.store.updateSession(id, { status, paymentStatus: s?.paymentStatus ?? null, completedAt: status === "complete" ? this.now() : null });
        sessionsClosed++;
      }
      await this.d.store.setState(CURSOR, { cursor: maxCreated, lastRunAt: this.now(), recovered }, this.now());
      if (recovered) opsLog("warn", "StripeReconcile", "missed_webhooks_recovered", { recovered });
      return { skipped: false, recovered, events, refreshed, refreshErrors, sessionsClosed };
    } finally {
      await this.d.store.releaseLease(LEASE, until);
    }
  }
}

/**
 * Programación: procesa eventos pendientes cada `everyMs` y concilia cada `reconcileEveryMs`. APAGADO
 * salvo CP_STRIPE_WORKER_ENABLED=1. Devuelve la función que la detiene.
 */
export function startStripeWorker(d: { processor: Pick<StripeEventProcessor, "processDue">; reconciler: StripeReconciler; everyMs?: number; reconcileEveryMs?: number }): () => void {
  let busy = false;
  let lastReconcile = 0;
  const every = Math.max(10_000, d.everyMs ?? 60_000);
  const reconcileEvery = Math.max(60_000, d.reconcileEveryMs ?? 15 * 60_000);
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    const job = now - lastReconcile >= reconcileEvery ? d.reconciler.tick().then(() => void (lastReconcile = now)) : d.processor.processDue(50);
    void job
      .catch((e) => {
        opsLog("error", "StripeWorker", "tick_failed", { error: e instanceof Error ? e.name : "error" });
        recordFailure("stripe.worker_failed");
      })
      .finally(() => void (busy = false));
  }, every);
  t.unref?.();
  return () => clearInterval(t);
}
