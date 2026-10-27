/**
 * Conciliación periódica con Stripe (Fase C), en modo pruebas o live (solo eventos de su modo). Recuperable
 * y segura con varias réplicas:
 * un arrendamiento en `stripe_sync_state` impide que dos ejecuciones se solapen.
 *
 * En cada pasada:
 *  1. Webhooks perdidos: lista `GET /v1/events` (tipos gestionados) desde el último cursor, con un margen
 *     hacia atrás, y registra los que falten (`source = reconcile`). Stripe conserva los eventos 30 días.
 *  2. Procesa los eventos pendientes o con reintento vencido.
 *  3. Relee las suscripciones no terminadas cuya copia es antigua. Así se recuperan pagos confirmados
 *     no aplicados, altas interrumpidas (el orquestador retoma el paso pendiente) y licencias desfasadas.
 *  4. Cierra en la BD las sesiones de Checkout que ya caducaron.
 *  5. Una vez al día, purga los eventos TERMINADOS (procesados o ignorados) más antiguos que la retención
 *     (180 días por defecto, nunca menos de 35: más que los 30 días que Stripe los conserva). Los fallidos
 *     y los pendientes no se purgan nunca. Cada purga deja constancia (`stripe_sync_state.events_purge`:
 *     fecha, corte, borrados por estado y total acumulado) y una línea de log.
 *
 * No se programa sola: `startStripeWorker` solo arranca con CP_STRIPE_WORKER_ENABLED=1.
 */
import { opsLog } from "../_core/ops/log";
import { recordFailure } from "../_core/ops/failureAlerts";
import { DEFAULT_EVENTS_RETENTION_DAYS, MIN_EVENTS_RETENTION_DAYS, livemodeMatches, type StripeMode } from "./config";
import { HANDLED, type StripeEventProcessor } from "./events";
import type { StripeGateway } from "./gateway";
import type { StripeStore } from "./store";

const LEASE = "reconcile";
const CURSOR = "events_cursor";
/** Margen hacia atrás al pedir eventos (s): cubre relojes desiguales y eventos creados durante la pasada. */
const OVERLAP_S = 600;
/** Primera pasada sin cursor: 3 días atrás (s). */
const FIRST_LOOKBACK_S = 3 * 86_400;
const PURGE = "events_purge";
const DAY_MS = 86_400_000;
/** Por pasada: lotes acotados para no bloquear la tabla (el resto, al día siguiente). */
const PURGE_BATCH = 1000;
const PURGE_MAX_BATCHES = 20;

export interface ReconcileDeps {
  store: StripeStore;
  gateway: StripeGateway;
  processor: Pick<StripeEventProcessor, "processDue" | "handleSubscription">;
  now?: () => number;
  leaseMs?: number;
  /** Antigüedad a partir de la cual se relee una suscripción (ms). */
  refreshAfterMs?: number;
  maxEventPages?: number;
  /** Días que se conservan los eventos terminados (mínimo 35). */
  retentionDays?: number;
  /** Modo del entorno (por defecto «test»): solo se registran eventos con su `livemode`. */
  mode?: StripeMode;
}

export interface ReconcileResult {
  skipped: boolean;
  recovered: number;
  events: { processed: number; ignored: number; failed: number; retried: number };
  refreshed: number;
  refreshErrors: number;
  sessionsClosed: number;
  purged: number;
}

export class StripeReconciler {
  private now: () => number;
  private mode: StripeMode;
  constructor(private d: ReconcileDeps) {
    this.now = d.now ?? Date.now;
    this.mode = d.mode ?? "test";
  }

  async tick(): Promise<ReconcileResult> {
    const start = this.now();
    const until = start + (this.d.leaseMs ?? 10 * 60_000);
    const empty = { processed: 0, ignored: 0, failed: 0, retried: 0 };
    if (!(await this.d.store.acquireLease(LEASE, until, start))) return { skipped: true, recovered: 0, events: empty, refreshed: 0, refreshErrors: 0, sessionsClosed: 0, purged: 0 };
    try {
      // 1. Eventos que no llegaron por webhook
      const state = (await this.d.store.getState(CURSOR)) ?? {};
      const cursor = typeof state.cursor === "number" ? state.cursor : Math.floor(start / 1000) - FIRST_LOOKBACK_S;
      let maxCreated = cursor;
      let recovered = 0;
      let startingAfter: string | undefined;
      let complete = false;
      for (let page = 0; page < (this.d.maxEventPages ?? 50); page++) {
        // Sin filtro `types`: Stripe admite como máximo 20 tipos y se gestionan más. Se filtra aquí.
        const r = await this.d.gateway.listEvents({ createdGte: cursor - OVERLAP_S, startingAfter, limit: 100 });
        for (const ev of r.events) {
          if (!HANDLED.has(ev.type)) continue;
          // Un evento de OTRO modo nunca se registra (mismo tratamiento que en el webhook)
          if (!livemodeMatches(ev.livemode, this.mode)) {
            if (this.mode === "live") recordFailure("stripe.test_event_rejected");
            else recordFailure("stripe.live_event_rejected");
            continue;
          }
          const rec = await this.d.store.recordEvent({ eventId: ev.id, type: ev.type, apiVersion: ev.apiVersion, objectType: ev.objectType, objectId: ev.objectId, stripeCreated: ev.created, source: "reconcile", now: this.now() });
          if (rec.created) recovered++;
          if (ev.created > maxCreated) maxCreated = ev.created;
        }
        if (!r.hasMore || !r.events.length) {
          complete = true;
          break;
        }
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
      // Stripe lista primero lo más reciente: si quedaron páginas, el cursor NO avanza (lo pendiente es más antiguo)
      if (!complete) {
        recordFailure("stripe.reconcile_backlog");
        opsLog("warn", "StripeReconcile", "backlog", { pages: this.d.maxEventPages ?? 50 });
      }
      await this.d.store.setState(CURSOR, { cursor: complete ? maxCreated : cursor, lastRunAt: this.now(), recovered, complete }, this.now());
      if (recovered) opsLog("warn", "StripeReconcile", "missed_webhooks_recovered", { recovered });
      // 5. Retención de eventos (una vez al día; un fallo aquí no tumba la conciliación)
      let purged = 0;
      try {
        purged = await this.purge();
      } catch (e) {
        recordFailure("stripe.events_purge_failed");
        opsLog("error", "StripeReconcile", "events_purge_failed", { error: e instanceof Error ? e.name : "error" });
      }
      return { skipped: false, recovered, events, refreshed, refreshErrors, sessionsClosed, purged };
    } finally {
      await this.d.store.releaseLease(LEASE, until);
    }
  }

  /** Purga diaria y acotada de eventos terminados. Devuelve cuántos borró (0 si hoy ya se hizo). */
  async purge(): Promise<number> {
    const now = this.now();
    const prev = (await this.d.store.getState(PURGE)) ?? {};
    if (typeof prev.lastRunAt === "number" && now - prev.lastRunAt < DAY_MS && prev.complete !== false) return 0;
    const days = Math.max(MIN_EVENTS_RETENTION_DAYS, this.d.retentionDays ?? DEFAULT_EVENTS_RETENTION_DAYS);
    const cutoff = now - days * DAY_MS;
    const byStatus = { processed: 0, ignored: 0 };
    let complete = false;
    for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
      const r = await this.d.store.purgeEvents(cutoff, PURGE_BATCH);
      byStatus.processed += r.processed;
      byStatus.ignored += r.ignored;
      if (r.processed + r.ignored < PURGE_BATCH) {
        complete = true;
        break;
      }
    }
    const deleted = byStatus.processed + byStatus.ignored;
    const totalDeleted = (typeof prev.totalDeleted === "number" ? prev.totalDeleted : 0) + deleted;
    await this.d.store.setState(PURGE, { lastRunAt: now, cutoff, retentionDays: days, deleted, byStatus, totalDeleted, complete }, now);
    if (deleted) opsLog("info", "StripeReconcile", "events_purged", { deleted, ...byStatus, retentionDays: days, cutoff, complete });
    return deleted;
  }
}

/**
 * Programación: procesa eventos pendientes cada `everyMs` y concilia cada `reconcileEveryMs`. APAGADO
 * salvo CP_STRIPE_WORKER_ENABLED=1. Devuelve la función que la detiene.
 */
export function startStripeWorker(d: { processor: Pick<StripeEventProcessor, "processDue">; reconciler: StripeReconciler; everyMs?: number; reconcileEveryMs?: number; /** Tareas periódicas junto a la conciliación (p. ej. el margen de cobro de los servicios externos). */ extra?: () => Promise<unknown> }): () => void {
  let busy = false;
  let lastReconcile = 0;
  const every = Math.max(10_000, d.everyMs ?? 60_000);
  const reconcileEvery = Math.max(60_000, d.reconcileEveryMs ?? 15 * 60_000);
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    const job = now - lastReconcile >= reconcileEvery ? d.reconciler.tick().then(async () => void ((lastReconcile = now), await d.extra?.())) : d.processor.processDue(50);
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
