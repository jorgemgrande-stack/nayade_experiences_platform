/**
 * Recuperación de las activaciones atascadas tras el cobro (confirmed → subscribed → licensed → active).
 *
 * Reglas:
 *  - Solo pedidos con confirmación (pago verificado, aprobación registrada o herencia): un cobro rechazado, cancelado
 *    o caducado nunca llega aquí (su pedido no pasa de «contracted» o queda rechazado). Cada paso vuelve a comprobar la
 *    base (`paidBasis`) y la retención por reembolso o disputa.
 *  - Reintentos progresivos ante fallos TRANSITORIOS (red, tiempo agotado, servicio no disponible, bloqueo o
 *    concurrencia): 1, 5, 15 y 60 minutos y después cada 6 horas, hasta MAX_ACTIVATION_ATTEMPTS fallos o
 *    MAX_ACTIVATION_WINDOW_MS desde la confirmación. Un fallo DEFINITIVO (validación, datos inconsistentes, capacidad
 *    inexistente, sin base de pago) o los reintentos agotados son «Error de activación»: ya no se reintenta solo.
 *  - Todo se deduce de los eventos `step_failed` del pedido (detalle: `transient`, `retryable`), sin migración.
 *  - Idempotencia: los pasos se apoyan en lo ya persistido (suscripción viva del contrato, única por la BD; partidas
 *    y cambios ya aplicados; licencias por diferencia; contrato ya activo); ningún paso cobra.
 */
import type { CommercialOrder, OrderEvent, OrderState } from "./types";

const MIN = 60_000;
/** Esperas tras el 1.º, 2.º, 3.º y 4.º fallo; después, LATE_RETRY_MS. */
export const RETRY_DELAYS_MS: readonly number[] = [1 * MIN, 5 * MIN, 15 * MIN, 60 * MIN];
export const LATE_RETRY_MS = 6 * 60 * MIN;
export const MAX_ACTIVATION_ATTEMPTS = 10;
export const MAX_ACTIVATION_WINDOW_MS = 72 * 60 * MIN;
/** Un pedido en activación sin fallos ni cambios en este tiempo se considera atascado (proceso caído a medias). */
export const STALE_ACTIVATION_MS = 2 * MIN;
/** Estados de activación posteriores al cobro (los únicos que se reanudan). */
export const POST_CONFIRM: readonly OrderState[] = ["confirmed", "subscribed", "licensed"];

export interface ActivationRecovery {
  /** Fallos desde la confirmación. */
  attempts: number;
  lastError: string | null;
  /** Motivo tipificado del último fallo (p. ej. `payment_reversed`: cobro revertido), o null. */
  code: string | null;
  /** Tipo del último fallo (null sin fallos). */
  transient: boolean | null;
  /** Fallo definitivo o reintentos agotados: «Error de activación». */
  failed: boolean;
  exhausted: boolean;
  /** Reintentar es seguro: hay confirmación y el último fallo no niega la base de pago. */
  retryable: boolean;
  /** Próximo reintento automático (null sin fallos o si ya no se reintenta solo). */
  nextRetryAt: number | null;
}

export const retryDelay = (attempt: number) => RETRY_DELAYS_MS[attempt - 1] ?? LATE_RETRY_MS;

/** Estado de recuperación de un pedido en activación a partir de sus eventos; null si no está en activación. */
export function activationRecovery(o: Pick<CommercialOrder, "state" | "confirmation">, events: readonly Pick<OrderEvent, "kind" | "toState" | "detail" | "createdAt">[]): ActivationRecovery | null {
  if (!POST_CONFIRM.includes(o.state)) return null;
  const since = o.confirmation?.at ?? 0;
  const fails = events.filter((e) => e.kind === "step_failed" && e.createdAt >= since && POST_CONFIRM.includes(e.toState));
  const last = fails[fails.length - 1];
  const safe = !!o.confirmation && last?.detail?.retryable !== false;
  if (!last) return { attempts: 0, lastError: null, code: null, transient: null, failed: false, exhausted: false, retryable: false, nextRetryAt: null };
  // Los fallos anteriores a esta clasificación no la llevan: se tratan como transitorios
  const transient = last.detail?.transient !== false;
  const next = last.createdAt + retryDelay(fails.length);
  const exhausted = transient && (fails.length >= MAX_ACTIVATION_ATTEMPTS || next > since + MAX_ACTIVATION_WINDOW_MS);
  const failed = !transient || exhausted;
  return {
    attempts: fails.length,
    lastError: typeof last.detail?.error === "string" ? last.detail.error : null,
    code: typeof last.detail?.code === "string" ? last.detail.code : null,
    transient,
    failed,
    exhausted,
    retryable: safe,
    nextRetryAt: failed ? null : next,
  };
}

/** ¿Toca reanudarlo ahora? Con fallos, al vencer la espera; sin fallos, si lleva STALE_ACTIVATION_MS sin moverse. */
export function recoveryDue(o: Pick<CommercialOrder, "state" | "confirmation" | "updatedAt" | "createdAt">, events: Parameters<typeof activationRecovery>[1], now: number, opts: { ignoreBackoff?: boolean } = {}): boolean {
  const r = activationRecovery(o, events);
  if (!r || r.failed || !o.confirmation) return false;
  if (r.attempts === 0) return now - (o.updatedAt ?? o.createdAt) >= STALE_ACTIVATION_MS;
  return opts.ignoreBackoff === true || now >= r.nextRetryAt!;
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ESOCKETTIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH",
  "PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS",
  "ER_SERVER_SHUTDOWN", "ER_QUERY_INTERRUPTED", "ER_CLIENT_INTERACTION_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
]);
/** Códigos de los errores de dominio (pedidos, CRM, suscripciones, licencias, pruebas). */
const TRANSIENT_DOMAIN = new Set(["conflict", "version_conflict", "unavailable", "limit"]);
const DEFINITIVE_DOMAIN = new Set(["not_found", "invalid_input", "invalid_state", "forbidden"]);
const TRANSIENT_NAMES = new Set(["AbortError", "TimeoutError", "FetchError", "DuplicateKeyError"]);
const DEFINITIVE_NAMES = new Set(["TypeError", "RangeError", "SyntaxError", "ReferenceError"]);

/**
 * Clasifica un fallo de un paso: transitorio (se reintenta solo) o definitivo. `retryable: false` solo cuando el
 * fallo niega la base para activar (sin pago verificado, cobro revertido): reintentar no es seguro.
 * Un error desconocido se trata como transitorio (los pasos son idempotentes y el número de reintentos es finito).
 */
export function classifyStepError(e: unknown): { transient: boolean; retryable: boolean } {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 3; cur = (cur as { cause?: unknown }).cause, depth++) {
    const x = cur as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
    if (typeof x.code === "string") {
      if (TRANSIENT_CODES.has(x.code) || TRANSIENT_DOMAIN.has(x.code)) return { transient: true, retryable: true };
      if (DEFINITIVE_DOMAIN.has(x.code)) return { transient: false, retryable: x.code !== "forbidden" };
    }
    const status = typeof x.status === "number" ? x.status : typeof x.statusCode === "number" ? x.statusCode : null;
    if (status !== null) return status === 429 || status === 408 || status >= 500 ? { transient: true, retryable: true } : { transient: false, retryable: true };
    if (typeof x.name === "string") {
      if (TRANSIENT_NAMES.has(x.name)) return { transient: true, retryable: true };
      if (DEFINITIVE_NAMES.has(x.name)) return { transient: false, retryable: true };
    }
  }
  return { transient: true, retryable: true };
}

// ── Tareas periódicas: recuperación frecuente y conciliación diaria ───────────

const DAY = 24 * 60 * MIN;
export interface OrderRecoveryPolicy {
  /** Apagada solo con CP_ORDERS_RECOVERY_ENABLED=0. */
  enabled: boolean;
  /** Reintentos que vencen (CP_ORDERS_RECOVERY_INTERVAL_MS; 30 s – 1 h; por defecto 1 min). */
  intervalMs: number;
  /** Conciliación de respaldo (CP_ORDERS_RECONCILE_INTERVAL_MS; 1 h – 7 días; por defecto 24 h). */
  reconcileMs: number;
  /** Días sin cambios tras los que vence un pedido sin cobro (CP_ORDERS_EXPIRY_DAYS; 1–365; 0 = no vence). */
  expiryDays: number;
  /**
   * CP_ORDERS_EXPIRY_MODE: «report» (POR DEFECTO) solo registra los candidatos al vencimiento; «apply» los rechaza
   * (code «expired»). Cualquier otro valor es «report»: nunca se cambian estados comerciales sin decisión explícita.
   */
  expiryMode: ExpiryMode;
}
export type ExpiryMode = "report" | "apply";
const clampEnv = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
export function orderRecoveryPolicyFromEnv(env: NodeJS.ProcessEnv, defaultExpiryDays = 30): OrderRecoveryPolicy {
  const rawExpiry = Number(env.CP_ORDERS_EXPIRY_DAYS ?? defaultExpiryDays);
  return {
    enabled: env.CP_ORDERS_RECOVERY_ENABLED !== "0",
    intervalMs: clampEnv(env.CP_ORDERS_RECOVERY_INTERVAL_MS, MIN, 30_000, 60 * MIN),
    reconcileMs: clampEnv(env.CP_ORDERS_RECONCILE_INTERVAL_MS, DAY, 60 * MIN, 7 * DAY),
    expiryDays: Number.isInteger(rawExpiry) && rawExpiry >= 0 && rawExpiry <= 365 ? rawExpiry : defaultExpiryDays,
    expiryMode: (env.CP_ORDERS_EXPIRY_MODE ?? "").trim().toLowerCase() === "apply" ? "apply" : "report",
  };
}

export const RECOVERY_ACTOR = "system:order-recovery";
const RECOVERY_LOCK = "cp:orders:recovery";
const RECONCILE_LOCK = "cp:orders:reconcile";
type Lock = { acquire(name: string): Promise<(() => Promise<void>) | null> };
interface RecoveryTarget {
  recoverActivations(actor: string): Promise<{ resumed: number; activated: number; failed: number; errors: unknown[] }>;
  reconcile(actor: string, opts: { maxIdleMs: number; expiryMode?: ExpiryMode }): Promise<{ activations: { resumed: number; activated: number; failed: number; errors: unknown[] }; expiry: { candidates: number; expired: number; errors: unknown[] } }>;
}
type Timers = { setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };

/**
 * Arranca las dos tareas (mismo patrón que el resto: `setInterval` con `unref`, una réplica por tick con GET_LOCK y
 * un fallo solo se registra). La conciliación corre una vez al poco de arrancar y después cada `reconcileMs`.
 */
export function startOrderRecovery(o: { orchestrator: RecoveryTarget; policy: OrderRecoveryPolicy; lock?: Lock; log?: (level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) => void; timers?: Timers }) {
  if (!o.policy.enabled) return { enabled: false, stop: () => undefined, tick: async () => undefined, daily: async () => undefined };
  const timers = o.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout };
  const log = o.log ?? (() => undefined);
  const busy = { tick: false, daily: false };
  let stopped = false;
  const guarded = async (which: "tick" | "daily", lockName: string, fn: () => Promise<Record<string, unknown> | null>) => {
    if (busy[which] || stopped) return;
    busy[which] = true;
    let release: (() => Promise<void>) | null = null;
    try {
      release = o.lock ? await o.lock.acquire(lockName) : async () => undefined;
      if (!release) return;
      const r = await fn();
      if (r) log("info", which === "tick" ? "recovery_tick" : "reconcile", r);
    } catch (e) {
      log("error", which === "tick" ? "recovery_failed" : "reconcile_failed", { error: e instanceof Error ? e.name : "error" });
    } finally {
      busy[which] = false;
      await release?.().catch(() => undefined);
    }
  };
  const tick = () =>
    guarded("tick", RECOVERY_LOCK, async () => {
      const r = await o.orchestrator.recoverActivations(RECOVERY_ACTOR);
      return r.resumed ? { resumed: r.resumed, activated: r.activated, failed: r.failed, errors: r.errors.length } : null;
    });
  const daily = () =>
    guarded("daily", RECONCILE_LOCK, async () => {
      const r = await o.orchestrator.reconcile(RECOVERY_ACTOR, { maxIdleMs: o.policy.expiryDays > 0 ? o.policy.expiryDays * DAY : Number.POSITIVE_INFINITY, expiryMode: o.policy.expiryMode });
      return { resumed: r.activations.resumed, activated: r.activations.activated, failed: r.activations.failed, expiryMode: o.policy.expiryMode, expiryCandidates: r.expiry.candidates, expired: r.expiry.expired, errors: r.activations.errors.length + r.expiry.errors.length };
    });
  const every = timers.setInterval(() => void tick(), o.policy.intervalMs);
  const first = timers.setTimeout(() => void daily(), Math.min(o.policy.intervalMs, 5 * MIN));
  const days = timers.setInterval(() => void daily(), o.policy.reconcileMs);
  for (const t of [every, first, days]) (t as { unref?: () => void }).unref?.();
  return {
    enabled: true,
    tick,
    daily,
    stop: () => {
      stopped = true;
      timers.clearInterval(every);
      timers.clearTimeout(first);
      timers.clearInterval(days);
    },
  };
}
