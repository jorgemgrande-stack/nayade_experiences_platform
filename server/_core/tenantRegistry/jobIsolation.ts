/**
 * Aislamiento operativo entre empresas en las tareas en segundo plano (modo multi).
 *
 * Piezas puras y sin E/S que usan `jobs.ts` y `scheduler.ts`:
 *  - Política por tarea (`jobIsolationPolicy`): tiempo máximo por empresa, empresas a la vez, límite de ejecuciones
 *    colgadas, cortocircuito y reintentos. Valores por defecto prudentes; cada tarea puede ajustarlos.
 *  - `Semaphore`: concurrencia global del proceso y por empresa (una empresa lenta no acapara las plazas).
 *  - `withDeadline`: tiempo máximo con `AbortController`; si la tarea no atiende la señal se deja de esperar
 *    (la ejecución queda «colgada» y se cuenta hasta que termine de verdad).
 *  - `JobCircuitBreakers`: tras N fallos seguidos de una tarea en una empresa se salta esa empresa durante una
 *    espera creciente (backoff exponencial con tope); pasada la espera se hace UNA ejecución de prueba.
 *  - `retryTransient`: reintentos limitados con backoff SOLO para errores de conexión (nunca de negocio).
 */

// ── Política por tarea ─────────────────────────────────────────────────────────

export interface JobIsolationPolicy {
  /** Tiempo máximo de la ejecución de UNA empresa (incluye preparación del contexto). */
  timeoutMs: number;
  /** Empresas a la vez dentro de una pasada de la tarea. */
  concurrency: number;
  /** Ejecuciones abandonadas por tiempo que siguen vivas: alcanzado el límite, la tarea no arranca más empresas. */
  maxHung: number;
  /** Fallos seguidos (errores o tiempo agotado) que abren el cortocircuito de una empresa. */
  failureThreshold: number;
  /** Primera espera con el cortocircuito abierto; se duplica en cada reapertura hasta `maxCooldownMs`. */
  baseCooldownMs: number;
  maxCooldownMs: number;
  /** Intentos totales ante errores transitorios (1 = sin reintentos). */
  retryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

const MIN = 60_000;

export const DEFAULT_JOB_ISOLATION: Readonly<JobIsolationPolicy> = {
  timeoutMs: 5 * MIN,
  concurrency: 4,
  maxHung: 2,
  failureThreshold: 3,
  baseCooldownMs: 5 * MIN,
  maxCooldownMs: 6 * 60 * MIN,
  retryAttempts: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5_000,
};

/** Ajustes por tarea (nombre del programador). Lo no indicado toma el valor por defecto. */
export const JOB_ISOLATION_POLICIES: Readonly<Record<string, Partial<JobIsolationPolicy>>> = {
  // Buzones IMAP: un servidor colgado no puede comerse el ciclo siguiente (cada 5-10 min)
  "email-tpv-ingestion": { timeoutMs: 4 * MIN },
  "expense-email-ingestion": { timeoutMs: 8 * MIN },
  "commercial-email-sync": { timeoutMs: 4 * MIN },
  "email-automation": { timeoutMs: 8 * MIN },
  // Una exportación puede ser grande: más margen y menos empresas a la vez
  "data-export": { timeoutMs: 30 * MIN, concurrency: 2 },
};

const overrides = new Map<string, Partial<JobIsolationPolicy>>();

/** Ajuste en caliente (pruebas o configuración). `null` lo retira. */
export function setJobIsolationPolicy(job: string, p: Partial<JobIsolationPolicy> | null): void {
  if (p) overrides.set(job, p);
  else overrides.delete(job);
}

export function jobIsolationPolicy(job: string): JobIsolationPolicy {
  return { ...DEFAULT_JOB_ISOLATION, ...(JOB_ISOLATION_POLICIES[job] ?? {}), ...(overrides.get(job) ?? {}) };
}

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Ejecuciones de empresa a la vez en todo el proceso (todas las tareas): `JOBS_GLOBAL_CONCURRENCY`, por defecto 8. */
export const globalJobConcurrency = (env: NodeJS.ProcessEnv = process.env) => positiveInt(env.JOBS_GLOBAL_CONCURRENCY, 8);
/** Tareas a la vez de una misma empresa: `JOBS_TENANT_CONCURRENCY`, por defecto 2. */
export const tenantJobConcurrency = (env: NodeJS.ProcessEnv = process.env) => positiveInt(env.JOBS_TENANT_CONCURRENCY, 2);

// ── Concurrencia ───────────────────────────────────────────────────────────────

/** Semáforo FIFO. `acquire` devuelve la función que libera la plaza (idempotente). */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    else this.active++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    };
  }

  get inUse(): number {
    return this.active;
  }
}

/** Recorre `items` con `limit` a la vez, conservando el orden de los resultados. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

// ── Tiempo máximo ──────────────────────────────────────────────────────────────

export class JobTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Tiempo máximo agotado (${timeoutMs} ms)`);
    this.name = "JobTimeoutError";
  }
}

/**
 * Ejecuta `fn(signal)` con tiempo máximo. Al agotarse aborta la señal y rechaza con `JobTimeoutError` SIN esperar
 * a `fn`: si la tarea no atiende la señal sigue viva y `settled` permite saber cuándo termina de verdad.
 * `timeoutMs` ≤ 0: sin tiempo máximo.
 */
export function withDeadline<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): { result: Promise<T>; settled: Promise<void> } {
  const ctl = new AbortController();
  const run = Promise.resolve().then(() => fn(ctl.signal));
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  if (!(timeoutMs > 0)) return { result: run, settled };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort(new JobTimeoutError(timeoutMs));
      reject(new JobTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  const result = Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  return { result, settled };
}

// ── Errores transitorios y reintentos ──────────────────────────────────────────

/** Códigos de error de conexión (red o MySQL): reintentar tiene sentido. Nada de errores de negocio ni de SQL. */
const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  "ETIMEDOUT_CONNECT",
]);
const TRANSIENT_NAMES = new Set(["DbCapacityError"]);

/** ¿Error transitorio de conexión? Recorre la cadena `cause` (los ORM envuelven el error del controlador). */
export function isTransientError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur !== "object") return false;
    const o = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (o.name === "JobTimeoutError" || o.name === "AbortError") return false;
    if (typeof o.code === "string" && TRANSIENT_CODES.has(o.code)) return true;
    if (typeof o.name === "string" && TRANSIENT_NAMES.has(o.name)) return true;
    cur = o.cause;
  }
  return false;
}

export const retryDelayMs = (attempt: number, p: Pick<JobIsolationPolicy, "retryBaseDelayMs" | "retryMaxDelayMs">) =>
  Math.min(p.retryMaxDelayMs, p.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1));

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("abortado"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("abortado"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Ejecuta `fn` con reintentos limitados ante errores transitorios. Un error de negocio, o la señal abortada,
 * corta en seco. `onRetry` recibe el intento que falló (1, 2…) y la espera antes del siguiente.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  p: Pick<JobIsolationPolicy, "retryAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs">,
  opts: { signal?: AbortSignal; onRetry?: (attempt: number, delayMs: number, e: unknown) => void; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, p.retryAttempts);
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= attempts || !isTransientError(e) || opts.signal?.aborted) throw e;
      const delay = retryDelayMs(attempt, p);
      opts.onRetry?.(attempt, delay, e);
      await (opts.sleep ?? abortableSleep)(delay, opts.signal);
    }
  }
}

// ── Cortocircuito por tarea y empresa ──────────────────────────────────────────

export interface CircuitState {
  job: string;
  tenantId: string;
  state: "closed" | "open" | "half_open";
  /** Fallos seguidos desde el último éxito. */
  consecutiveFailures: number;
  /** Aperturas seguidas (marca el escalón del backoff). */
  opens: number;
  /** Hasta cuándo se salta la empresa (ms desde epoch); null si está cerrado. */
  openUntil: number | null;
  lastError: string | null;
  lastFailureAt: number | null;
}

export type CircuitEvent =
  | { type: "opened"; job: string; tenantId: string; consecutiveFailures: number; opens: number; retryAt: number; lastError: string | null; reopen: boolean }
  | { type: "closed"; job: string; tenantId: string; downMs: number };

export type CircuitAdmission = { allowed: true; trial: boolean } | { allowed: false; retryAt: number };

const ckey = (job: string, tenantId: string) => `${job}\u0000${tenantId}`;

export function circuitCooldownMs(opens: number, p: Pick<JobIsolationPolicy, "baseCooldownMs" | "maxCooldownMs">): number {
  return Math.min(p.maxCooldownMs, p.baseCooldownMs * 2 ** Math.max(0, opens - 1));
}

export class JobCircuitBreakers {
  private states = new Map<string, CircuitState & { trialInFlight: boolean; firstOpenAt: number | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  private get(job: string, tenantId: string) {
    const k = ckey(job, tenantId);
    let s = this.states.get(k);
    if (!s) {
      s = { job, tenantId, state: "closed", consecutiveFailures: 0, opens: 0, openUntil: null, lastError: null, lastFailureAt: null, trialInFlight: false, firstOpenAt: null };
      this.states.set(k, s);
    }
    return s;
  }

  /** ¿Puede ejecutarse? Con el cortocircuito abierto y la espera cumplida deja pasar UNA ejecución de prueba. */
  admit(job: string, tenantId: string): CircuitAdmission {
    const s = this.states.get(ckey(job, tenantId));
    if (!s || s.state === "closed") return { allowed: true, trial: false };
    const now = this.now();
    if (s.openUntil !== null && now < s.openUntil) return { allowed: false, retryAt: s.openUntil };
    if (s.trialInFlight) return { allowed: false, retryAt: now };
    s.state = "half_open";
    s.trialInFlight = true;
    return { allowed: true, trial: true };
  }

  success(job: string, tenantId: string): CircuitEvent | null {
    const s = this.states.get(ckey(job, tenantId));
    if (!s) return null;
    const wasOpen = s.state !== "closed";
    const downMs = s.firstOpenAt !== null ? this.now() - s.firstOpenAt : 0;
    this.states.delete(ckey(job, tenantId));
    return wasOpen ? { type: "closed", job, tenantId, downMs } : null;
  }

  failure(job: string, tenantId: string, error: string, p: Pick<JobIsolationPolicy, "failureThreshold" | "baseCooldownMs" | "maxCooldownMs">): CircuitEvent | null {
    const s = this.get(job, tenantId);
    const now = this.now();
    s.consecutiveFailures++;
    s.lastError = error.slice(0, 200);
    s.lastFailureAt = now;
    const trial = s.state === "half_open";
    s.trialInFlight = false;
    if (!trial && s.consecutiveFailures < Math.max(1, p.failureThreshold)) return null;
    s.opens++;
    s.state = "open";
    s.openUntil = now + circuitCooldownMs(s.opens, p);
    if (s.firstOpenAt === null) s.firstOpenAt = now;
    return { type: "opened", job, tenantId, consecutiveFailures: s.consecutiveFailures, opens: s.opens, retryAt: s.openUntil, lastError: s.lastError, reopen: s.opens > 1 };
  }

  /** La ejecución de prueba no llegó a correr (omitida por otro motivo): se libera la plaza de prueba. */
  releaseTrial(job: string, tenantId: string): void {
    const s = this.states.get(ckey(job, tenantId));
    if (s?.state === "half_open") {
      s.trialInFlight = false;
    }
  }

  /** Estado de las tareas con fallos (abiertos, en prueba o acumulando fallos), sin datos internos. */
  list(filter: { tenantId?: string; onlyOpen?: boolean } = {}): CircuitState[] {
    const out: CircuitState[] = [];
    for (const s of Array.from(this.states.values())) {
      if (filter.tenantId && s.tenantId !== filter.tenantId) continue;
      if (filter.onlyOpen && s.state === "closed") continue;
      const { trialInFlight: _t, firstOpenAt: _f, ...pub } = s;
      out.push({ ...pub });
    }
    return out.sort((a, b) => a.job.localeCompare(b.job) || a.tenantId.localeCompare(b.tenantId));
  }

  clear(): void {
    this.states.clear();
  }
}
