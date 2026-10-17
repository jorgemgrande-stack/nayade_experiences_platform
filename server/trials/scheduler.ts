/**
 * Tarea programada de la prueba gratuita (APAGADA por defecto: `CP_TRIALS_SCHEDULER_ENABLED=1`).
 *
 * Cada `tick(now)` es idempotente y hace, en este orden:
 *  1. Marca «vencidas» las pruebas activas cuyo plazo ya pasó y encola el aviso de vencimiento (0 días).
 *     Vencer NO toca las licencias ni borra nada: ya caducaron solas al final de la prueba (solo lectura).
 *  2. Encola los avisos de 3 y 1 días antes del fin, UNA vez por prueba y fecha de fin (constancia en el
 *     historial de la prueba, `notice_queued`; además la bandeja de salida es idempotente por clave).
 *  3. Anula las solicitudes sin verificar con el enlace caducado y más antiguas que su vida máxima
 *     (libera el correo para que la persona pueda registrarse de nuevo).
 *
 * Exclusión entre réplicas: bloqueo con nombre en la BD (`GET_LOCK` de MySQL, sin espera). Si otra
 * réplica lo tiene, este tick no hace nada. El bloqueo se libera al terminar o si se cae la conexión.
 * Nunca suspende, nunca cancela pruebas activas y nunca borra datos.
 */
import type mysql from "mysql2/promise";
import { opsLog } from "../_core/ops/log";
import { NOTICE_DAYS, type TrialNotifier } from "./onboarding";
import { TrialError, TrialService, type TrialLimits } from "./service";
import type { TrialRequest, TrialStore } from "./store";

const DAY = 86_400_000;
export const SCHEDULER_ACTOR = "system:trial-scheduler";
export const SCHEDULER_LOCK = "elephant_trials_scheduler";

/** Bloqueo exclusivo entre réplicas. `acquire` devuelve la función de liberar, o null si está ocupado. */
export interface SchedulerLock {
  acquire(name: string): Promise<(() => Promise<void>) | null>;
}

/** `GET_LOCK` de MySQL en una conexión propia (se libera al soltarla o si se corta). */
export function mysqlAdvisoryLock(pool: Pick<mysql.Pool, "getConnection">): SchedulerLock {
  return {
    async acquire(name) {
      const c = await pool.getConnection();
      try {
        const [r] = await c.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS ok", [name]);
        if (Number(r[0]?.ok) !== 1) {
          c.release();
          return null;
        }
      } catch (e) {
        c.release();
        throw e;
      }
      return async () => {
        try {
          await c.query("SELECT RELEASE_LOCK(?)", [name]);
        } finally {
          c.release();
        }
      };
    },
  };
}

/** Bloqueo en memoria (pruebas o un único proceso). */
export function memoryLock(): SchedulerLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async acquire(name) {
      if (held.has(name)) return null;
      held.add(name);
      return async () => void held.delete(name);
    },
  };
}

export interface TickResult {
  at: number;
  skipped: "locked" | null;
  expired: number;
  noticesQueued: number;
  verificationsExpired: number;
  errors: number;
}

export interface TrialSchedulerDeps {
  store: TrialStore;
  notify: TrialNotifier;
  lock: SchedulerLock;
  now?: () => number;
  limits?: Partial<TrialLimits>;
  /** Máximo de pruebas por paso y tick (el resto queda para el siguiente). */
  batch?: number;
  log?: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
}

export class TrialScheduler {
  private now: () => number;
  private batch: number;
  private log: NonNullable<TrialSchedulerDeps["log"]>;
  constructor(private d: TrialSchedulerDeps) {
    this.now = d.now ?? Date.now;
    this.batch = Math.max(1, Math.min(d.batch ?? 200, 1000));
    this.log = d.log ?? ((level, event, data) => opsLog(level, "Trials", event, data));
  }

  async tick(now = this.now()): Promise<TickResult> {
    const out: TickResult = { at: now, skipped: null, expired: 0, noticesQueued: 0, verificationsExpired: 0, errors: 0 };
    const release = await this.d.lock.acquire(SCHEDULER_LOCK);
    if (!release) {
      out.skipped = "locked";
      return out;
    }
    try {
      // Mismo instante para todo el tick (también en las comprobaciones del servicio)
      const trials = new TrialService({ store: this.d.store, now: () => now, limits: this.d.limits });
      await this.expireDue(trials, now, out);
      await this.queueNotices(trials, now, out);
      await this.expireStaleVerifications(trials, now, out);
    } finally {
      await release().catch(() => undefined);
    }
    if (out.expired || out.noticesQueued || out.verificationsExpired || out.errors) this.log(out.errors ? "warn" : "info", "scheduler_tick", { ...out });
    return out;
  }

  /** `slot`: aviso que toca (3, 1 o 0); `daysLeft`: días que quedan de verdad (para el texto). */
  private async notice(trials: TrialService, t: TrialRequest, slot: number, out: TickResult, daysLeft = slot) {
    if (t.endsAt === null) return;
    const key = TrialService.noticeKey({ endsAt: t.endsAt }, slot);
    if (await trials.noticeQueued(t.id, key)) return;
    try {
      await this.d.notify.expiryNotice(t.email, { trialId: t.id, endsAt: t.endsAt, daysLeft });
    } catch (e) {
      // Sin constancia: se reintenta en el siguiente tick
      out.errors++;
      return void this.log("error", "scheduler_notice_failed", { trialId: t.id, daysLeft, error: e instanceof Error ? e.name : "error" });
    }
    await trials.recordNotice(t.id, key, SCHEDULER_ACTOR);
    out.noticesQueued++;
  }

  private async expireDue(trials: TrialService, now: number, out: TickResult) {
    for (const t of await this.d.store.list({ states: ["active"], endsBefore: now, limit: this.batch })) {
      if (t.endsAt === null || t.endsAt > now) continue;
      try {
        const e = await trials.markExpired(t.id, t.version, SCHEDULER_ACTOR);
        out.expired++;
        await this.notice(trials, e, 0, out);
      } catch (e) {
        // Un operador la cambió a la vez (ampliación, suspensión…): se deja para el siguiente tick
        if (e instanceof TrialError && (e.code === "conflict" || e.code === "invalid_state")) continue;
        out.errors++;
        this.log("error", "scheduler_expire_failed", { trialId: t.id, error: e instanceof Error ? e.name : "error" });
      }
    }
  }

  private async queueNotices(trials: TrialService, now: number, out: TickResult) {
    const horizon = now + Math.max(...NOTICE_DAYS) * DAY;
    for (const t of await this.d.store.list({ states: ["active"], endsBefore: horizon, limit: this.batch })) {
      if (t.endsAt === null || t.endsAt <= now) continue;
      const daysLeft = Math.ceil((t.endsAt - now) / DAY);
      // El aviso más cercano que toca (si el proceso estuvo parado, no se manda el de 3 días el último día)
      const due = (NOTICE_DAYS as readonly number[]).filter((d) => d > 0 && d >= daysLeft).sort((a, b) => a - b)[0];
      if (due === undefined) continue;
      try {
        await this.notice(trials, t, due, out, daysLeft);
      } catch (e) {
        out.errors++;
        this.log("error", "scheduler_notice_failed", { trialId: t.id, error: e instanceof Error ? e.name : "error" });
      }
    }
  }

  private async expireStaleVerifications(trials: TrialService, now: number, out: TickResult) {
    const maxAge = trials.effectiveLimits.pendingMaxAgeMs;
    for (const t of await this.d.store.list({ states: ["pending_verification"], verificationExpiredBefore: now, createdBefore: now - maxAge, limit: this.batch })) {
      try {
        await trials.expireVerification(t.id, t.version, SCHEDULER_ACTOR);
        out.verificationsExpired++;
      } catch (e) {
        if (e instanceof TrialError && (e.code === "conflict" || e.code === "invalid_state")) continue;
        out.errors++;
        this.log("error", "scheduler_verification_expire_failed", { trialId: t.id, error: e instanceof Error ? e.name : "error" });
      }
    }
  }
}

export interface SchedulerConfig {
  enabled: boolean;
  intervalMs: number;
}

const MIN_INTERVAL = 60_000;
const MAX_INTERVAL = DAY;
export const DEFAULT_INTERVAL = 15 * 60_000;

/** `CP_TRIALS_SCHEDULER_ENABLED=1` (exacto) y `CP_TRIALS_SCHEDULER_INTERVAL_MS` (1 min – 24 h; 15 min por defecto). */
export function schedulerConfigFromEnv(env: NodeJS.ProcessEnv): SchedulerConfig {
  const raw = Number(env.CP_TRIALS_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL);
  const intervalMs = Number.isFinite(raw) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(raw))) : DEFAULT_INTERVAL;
  return { enabled: env.CP_TRIALS_SCHEDULER_ENABLED === "1", intervalMs };
}

/**
 * Monta la tarea programada si está habilitada. No hace nada al arrancar (el primer tick llega al cabo
 * de un minuto como mínimo) y nunca solapa dos ticks en el mismo proceso. Devuelve `stop()`.
 * Ejemplo de montaje en `server/controlPlane/main.ts`: docs/elephant-source/PRUEBA_GRATUITA_AUTONOMA.md.
 */
export function startTrialScheduler(o: {
  scheduler: TrialScheduler;
  env: NodeJS.ProcessEnv;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  log?: (data: Record<string, unknown>) => void;
}): { enabled: boolean; intervalMs: number; stop: () => void; running: () => boolean } {
  const cfg = schedulerConfigFromEnv(o.env);
  const log = o.log ?? ((data) => console.log(JSON.stringify({ ctx: "Trials", event: "scheduler", ...data })));
  log({ enabled: cfg.enabled, intervalMs: cfg.intervalMs });
  if (!cfg.enabled) return { enabled: false, intervalMs: cfg.intervalMs, stop: () => undefined, running: () => false };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  let busy = false;
  let stopped = false;
  const run = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await o.scheduler.tick();
    } catch (e) {
      log({ error: "tick_failed", name: e instanceof Error ? e.name : "error" });
    } finally {
      busy = false;
    }
  };
  const first = timers.setTimeout(() => void run(), Math.min(cfg.intervalMs, MIN_INTERVAL));
  const every = timers.setInterval(() => void run(), cfg.intervalMs);
  (first as { unref?: () => void }).unref?.();
  (every as { unref?: () => void }).unref?.();
  return {
    enabled: true,
    intervalMs: cfg.intervalMs,
    running: () => busy,
    stop: () => {
      stopped = true;
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}
