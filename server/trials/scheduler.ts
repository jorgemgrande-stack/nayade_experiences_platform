/**
 * Tarea programada de la prueba gratuita (APAGADA por defecto: `CP_TRIALS_SCHEDULER_ENABLED=1`).
 *
 * Cada `tick(now)` es idempotente y hace, en este orden:
 *  1. Marca «vencidas» las pruebas activas cuyo plazo ya pasó y encola el aviso de vencimiento (0 días).
 *     Vencer NO toca las licencias ni borra nada: ya caducaron solas al final de la prueba (solo lectura).
 *  2. Encola los avisos de 7, 3 y 1 días antes del fin, UNA vez por prueba y fecha de fin (constancia en el
 *     historial de la prueba, `notice_queued`; además la bandeja de salida es idempotente por clave).
 *  3. Anula las solicitudes sin verificar con el enlace caducado y más antiguas que su vida máxima
 *     (libera el correo para que la persona pueda registrarse de nuevo).
 *  4. Solo con la activación automática (`CP_TRIAL_AUTO_PROVISION=1`): reintenta las altas incompletas con
 *     `activate` (la misma que usan la verificación y el operador), que retoma desde el paso pendiente. Son
 *     las pruebas verificadas cuya activación falló (`provisioning_failed` en su historial) y las que siguen
 *     «aprovisionando» sin cambios más allá de `provisioningStaleMs` (caída del proceso). Reintentos acotados
 *     con espera creciente (`ACTIVATION_RETRY_DELAYS_MS`), contados en el historial (`activation_retry`).
 *     Agotados, queda constancia (`activation_gave_up`) y se avisa a administración; al cliente, nada.
 *
 * Exclusión entre réplicas: bloqueo con nombre en la BD (`GET_LOCK` de MySQL, sin espera). Si otra
 * réplica lo tiene, este tick no hace nada. El bloqueo se libera al terminar o si se cae la conexión.
 * Nunca suspende, nunca cancela pruebas activas y nunca borra datos.
 */
import type mysql from "mysql2/promise";
import { opsLog } from "../_core/ops/log";
import { exemptTenantsFromEnv } from "../commercialState";
import type { AlertFacts } from "../adminAlerts/catalog";
import { NOTICE_DAYS, type TrialNotifier } from "./onboarding";
import { TrialError, TrialService, type TrialLimits } from "./service";
import type { TrialRequest, TrialStore } from "./store";

const DAY = 86_400_000;
export const SCHEDULER_ACTOR = "system:trial-scheduler";
export const SCHEDULER_LOCK = "elephant_trials_scheduler";

/** Espera antes de cada reintento automático del alta: 5 min, 15 min, 1 h, 3 h y 12 h. Agotados, se avisa. */
export const ACTIVATION_RETRY_DELAYS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 12 * 60 * 60_000];
/** Altas reintentadas como mucho en cada tick (una tras otra: nunca más que el límite de simultáneas). */
const ACTIVATION_RETRIES_PER_TICK = 3;
/** Alerta de administración al agotar los reintentos (catálogo: n.º 41). */
export const ACTIVATION_GAVE_UP_ALERT = "admin.provisioning_failed";

/** Recuperación automática de altas incompletas (paso 4 del tick). */
export interface TrialRecovery {
  /** El mismo interruptor que la activación al verificar (`CP_TRIAL_AUTO_PROVISION=1`). Apagado, no se reintenta nada. */
  autoProvision: boolean;
  /** `TrialOnboardingService.activate`: idempotente, reanuda y serializa las activaciones de una misma prueba. */
  activate: (trialId: number, actor: string) => Promise<unknown>;
  /** Alerta de administración (`AdminAlertService.raise`). */
  raise?: (alertId: string, f: AlertFacts) => Promise<unknown>;
  /** Esperas entre reintentos (por defecto `ACTIVATION_RETRY_DELAYS_MS`); su número es el máximo de reintentos. */
  delaysMs?: readonly number[];
}

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
  /** Altas incompletas reintentadas, completadas en este tick y abandonadas (reintentos agotados). */
  activationsRetried: number;
  activationsRecovered: number;
  activationsGaveUp: number;
  errors: number;
}

export interface TrialSchedulerDeps {
  store: TrialStore;
  /** Solo hace falta el aviso de vencimiento. */
  notify: Pick<TrialNotifier, "expiryNotice">;
  lock: SchedulerLock;
  now?: () => number;
  limits?: Partial<TrialLimits>;
  /** Máximo de pruebas por paso y tick (el resto queda para el siguiente). */
  batch?: number;
  /**
   * Empresas exentas de la prueba (por defecto, TRIAL_RESTRICTIONS_EXEMPT_TENANTS): ni se vencen ni reciben avisos. Sus pruebas
   * se gestionan a mano (p. ej. Skibox, cuyo contacto es de un cliente externo).
   */
  exempt?: ReadonlySet<string>;
  /**
   * Recuperación de altas incompletas. Se consulta en cada tick: sin ella (o con `null`, p. ej. si la activación
   * todavía no está montada) no se reintenta nada.
   */
  recovery?: () => TrialRecovery | null;
  log?:(level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void;
}

export class TrialScheduler {
  private now: () => number;
  private batch: number;
  private log: NonNullable<TrialSchedulerDeps["log"]>;
  private exempt: ReadonlySet<string>;
  constructor(private d: TrialSchedulerDeps) {
    this.now = d.now ?? Date.now;
    this.exempt = d.exempt ?? exemptTenantsFromEnv();
    this.batch = Math.max(1, Math.min(d.batch ?? 200, 1000));
    this.log = d.log ?? ((level, event, data) => opsLog(level, "Trials", event, data));
  }

  async tick(now = this.now()): Promise<TickResult> {
    const out: TickResult = { at: now, skipped: null, expired: 0, noticesQueued: 0, verificationsExpired: 0, activationsRetried: 0, activationsRecovered: 0, activationsGaveUp: 0, errors: 0 };
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
      await this.recoverActivations(trials, now, out);
    } finally {
      await release().catch(() => undefined);
    }
    if (out.expired || out.noticesQueued || out.verificationsExpired || out.activationsRetried || out.activationsGaveUp || out.errors) this.log(out.errors ? "warn" : "info", "scheduler_tick", { ...out });
    return out;
  }

  private isExempt(t: TrialRequest): boolean {
    return !!t.tenantId && this.exempt.has(t.tenantId);
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
      if (t.endsAt === null || t.endsAt > now || this.isExempt(t)) continue;
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
      if (t.endsAt === null || t.endsAt <= now || this.isExempt(t)) continue;
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

  /**
   * Altas incompletas: verificadas con la activación fallida o «aprovisionando» sin cambios más allá de
   * `provisioningStaleMs`. Cada reintento deja constancia ANTES de empezar (una caída a mitad también cuenta) y
   * espera lo que toca desde el último cambio o reintento. Las réplicas no se pisan: el tick va bajo el bloqueo
   * y `activate` serializa las activaciones de una misma prueba.
   */
  private async recoverActivations(trials: TrialService, now: number, out: TickResult) {
    const r = this.d.recovery?.() ?? null;
    if (!r?.autoProvision) return;
    const delays = r.delaysMs?.length ? r.delaysMs : ACTIVATION_RETRY_DELAYS_MS;
    const candidates = [
      ...(await this.d.store.list({ states: ["provisioning"], updatedBefore: now - trials.effectiveLimits.provisioningStaleMs, limit: this.batch })),
      ...(await this.d.store.list({ states: ["verified"], updatedBefore: now - delays[0], limit: this.batch })),
    ];
    let started = 0;
    for (const t of candidates) {
      if (started >= ACTIVATION_RETRIES_PER_TICK) break;
      try {
        const events = await this.d.store.events(t.id);
        if (events.some((e) => e.action === "activation_gave_up")) continue;
        // Verificada sin activación fallida: nadie intentó activarla (p. ej. antes de encender la activación automática)
        if (t.state === "verified" && (t.verifiedAt === null || !events.some((e) => e.action === "provisioning_failed"))) continue;
        const retries = events.filter((e) => e.action === "activation_retry");
        if (retries.length >= delays.length) {
          await this.giveUp(r, t, retries.length, events, now, out);
          continue;
        }
        const last = Math.max(t.updatedAt ?? t.createdAt, ...retries.map((e) => e.createdAt));
        if (now < last + delays[retries.length]) continue;
        // Otra persona o proceso la cambió desde el listado: se deja para el siguiente tick
        const cur = await this.d.store.get(t.id);
        if (!cur || cur.state !== t.state || cur.version !== t.version) continue;
        const attempt = retries.length + 1;
        started++;
        await this.d.store.note(t.id, { action: "activation_retry", detail: `intento ${attempt} de ${delays.length}`, actor: SCHEDULER_ACTOR, at: now });
        out.activationsRetried++;
        try {
          await r.activate(t.id, SCHEDULER_ACTOR);
          out.activationsRecovered++;
          this.log("info", "scheduler_activation_recovered", { trialId: t.id, attempt });
        } catch (e) {
          this.log("warn", "scheduler_activation_retry_failed", { trialId: t.id, attempt, error: e instanceof Error ? e.name : "error" });
          if (attempt >= delays.length) await this.giveUp(r, t, attempt, await this.d.store.events(t.id), now, out);
        }
      } catch (e) {
        out.errors++;
        this.log("error", "scheduler_activation_recovery_failed", { trialId: t.id, error: e instanceof Error ? e.name : "error" });
      }
    }
  }

  /** Reintentos agotados: alerta de administración y constancia (después: si la alerta falla, se repite en el siguiente tick). */
  private async giveUp(r: TrialRecovery, t: TrialRequest, attempts: number, events: Array<{ action: string; detail: string | null }>, now: number, out: TickResult) {
    const cur = (await this.d.store.get(t.id)) ?? t;
    // Se completó a la vez (p. ej. un operador): no hay nada que avisar
    if (cur.state !== "verified" && cur.state !== "provisioning") return;
    const lastError = [...events].reverse().find((e) => e.action === "provisioning_failed")?.detail ?? null;
    await r.raise?.(ACTIVATION_GAVE_UP_ALERT, {
      key: `trial:${t.id}:activation_gave_up`,
      occurredAt: now,
      tenantId: cur.tenantId,
      company: cur.companyName,
      summary: `El alta de la prueba gratuita #${t.id} no se ha completado tras ${attempts} reintentos automáticos: requiere revisión manual.`,
      status: { label: "Alta incompleta", tone: "error" },
      reference: `Prueba #${t.id}`,
      details: [{ label: "Estado de la prueba", value: cur.state === "verified" ? "Verificada (sin plataforma)" : "Aprovisionando (interrumpida)" }, ...(lastError ? [{ label: "Último error", value: lastError.slice(0, 200) }] : [])],
      link: "#/operacion/pruebas",
      intervention: true,
    });
    await this.d.store.note(t.id, { action: "activation_gave_up", detail: `${attempts} reintentos automáticos sin éxito`, actor: SCHEDULER_ACTOR, at: now });
    out.activationsGaveUp++;
    this.log("error", "scheduler_activation_gave_up", { trialId: t.id, attempts });
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
