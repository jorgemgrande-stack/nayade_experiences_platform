/**
 * Limitadores por tenant: tasa (cubo de fichas) y concurrencia. Evitan que una empresa
 * degrade el servicio de las demás («vecino ruidoso»).
 */
export class TenantRateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private now: () => number = Date.now,
    private maxTenants = 5000,
  ) {}

  /**
   * Intenta consumir una ficha. `perMinute` es la tasa sostenida; la ráfaga admitida es la
   * misma cantidad. Devuelve `retryAfterMs` si no hay ficha.
   */
  take(tenantId: string, perMinute: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const t = this.now();
    let b = this.buckets.get(tenantId);
    if (!b) {
      if (this.buckets.size >= this.maxTenants) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
      b = { tokens: perMinute, at: t };
      this.buckets.set(tenantId, b);
    }
    const ratePerMs = perMinute / 60_000;
    b.tokens = Math.min(perMinute, b.tokens + (t - b.at) * ratePerMs);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil((1 - b.tokens) / ratePerMs) };
  }
}

/**
 * Concurrencia por tenant: POR PROCESO a propósito. Es la protección inmediata (no puede depender de una ida y vuelta a la
 * base) y una plaza ocupada se libera al cerrar la respuesta, cosa que un contador compartido perdería si la réplica muere.
 * Límite conocido: con R réplicas, el máximo efectivo de un tenant es `max × R` (el balanceador reparte las peticiones).
 */
export class TenantConcurrencyLimiter {
  private inflight = new Map<string, number>();

  /** Devuelve una función de liberación, o `null` si se alcanzó el máximo. */
  acquire(tenantId: string, max: number): (() => void) | null {
    const cur = this.inflight.get(tenantId) ?? 0;
    if (cur >= max) return null;
    this.inflight.set(tenantId, cur + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.inflight.get(tenantId) ?? 1) - 1;
      if (n <= 0) this.inflight.delete(tenantId);
      else this.inflight.set(tenantId, n);
    };
  }

  current(tenantId: string): number {
    return this.inflight.get(tenantId) ?? 0;
  }
}

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

/** Lo que la guarda HTTP necesita de un limitador de tasa (local o distribuido). */
export interface TenantRateGate {
  take(tenantId: string, perMinute: number): RateDecision | Promise<RateDecision>;
}

/** Contador atómico por ventana (lo implementan `MemoryCounterStore` y `MysqlCounterStore` de `./usage`). */
export interface RateCounterStore {
  incr(k: { tenantId: string; metric: string; period: "minute"; windowStart: number }, delta: number): Promise<number>;
}

export interface DistributedRateOptions {
  now?: () => number;
  /** Métrica del contador compartido (por defecto `http.request`). */
  metric?: string;
  /** Fracción del límite que reserva cada réplica de una vez (por defecto 5 %). */
  leaseFraction?: number;
  /** Tope del bloque (por defecto 50 peticiones). */
  maxLease?: number;
  /** Réplicas estimadas: con el almacén caído, cada una aplica `límite / réplicas` en local (por defecto 2). */
  replicasEstimate?: number;
  /** Espera máxima de una reserva: más lenta se trata como almacén caído (por defecto 500 ms). */
  storeTimeoutMs?: number;
  /** Tras un fallo del almacén, tiempo sin volver a intentarlo (por defecto 5 s). */
  retryStoreAfterMs?: number;
  maxTenants?: number;
  /** Aviso de degradación (opsLog + métrica en producción). */
  onDegraded?: (op: string, e: unknown) => void;
}

type LeaseState = { window: number; available: number; exhausted: boolean; inflight: Promise<void> | null };

/**
 * Limitador de tasa COMPARTIDO entre réplicas: ventana fija de un minuto en un contador global atómico.
 * Diseño por «leases»: cada réplica reserva del contador global un bloque de N peticiones (5 % del límite, máx. 50) y lo
 * gasta en memoria, así que la base recibe 1 escritura cada N peticiones y no una por petición; como cada bloque se
 * concede a partir del valor atómico devuelto, la suma de lo admitido por TODAS las réplicas nunca supera el límite.
 * Coste conocido: lo reservado y no gastado al cerrar el minuto se pierde (como mucho N por réplica y tenant), y la
 * ventana fija admite una ráfaga de hasta 2× el límite en torno al cambio de minuto.
 * Si el almacén falla, degrada al cubo de fichas local con `límite / réplicas estimadas` (prudente: el total entre
 * réplicas queda cerca del límite sin conocer el estado global) y deja de consultar la base unos segundos.
 */
export class DistributedRateLimiter implements TenantRateGate {
  private state = new Map<string, LeaseState>();
  private readonly local: TenantRateLimiter;
  private readonly now: () => number;
  private storeDownUntil = 0;

  constructor(
    private store: RateCounterStore,
    private opts: DistributedRateOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.local = new TenantRateLimiter(this.now, opts.maxTenants);
  }

  /** ¿Está aplicando ahora el límite local de emergencia? */
  degraded(): boolean {
    return this.now() < this.storeDownUntil;
  }

  private leaseSize(perMinute: number): number {
    return Math.max(1, Math.min(this.opts.maxLease ?? 50, Math.ceil(perMinute * (this.opts.leaseFraction ?? 0.05))));
  }

  private fallback(tenantId: string, perMinute: number): RateDecision {
    const replicas = Math.max(1, this.opts.replicasEstimate ?? 2);
    return this.local.take(tenantId, Math.max(1, Math.floor(perMinute / replicas)));
  }

  async take(tenantId: string, perMinute: number): Promise<RateDecision> {
    if (perMinute <= 0) return { ok: false, retryAfterMs: 60_000 };
    // Cada vuelta o concede, o reserva un bloque nuevo (el contador avanza), o encuentra el minuto agotado: termina
    for (;;) {
      if (this.degraded()) return this.fallback(tenantId, perMinute);
      const t = this.now();
      const w = Math.floor(t / 60_000) * 60_000;
      let s = this.state.get(tenantId);
      if (!s || s.window !== w) {
        if (!s && this.state.size >= (this.opts.maxTenants ?? 5000)) {
          const oldest = this.state.keys().next();
          if (!oldest.done) this.state.delete(oldest.value);
        }
        s = { window: w, available: 0, exhausted: false, inflight: null };
        this.state.set(tenantId, s);
      }
      if (s.available >= 1) {
        s.available--;
        return { ok: true };
      }
      if (s.exhausted) return { ok: false, retryAfterMs: Math.max(1, w + 60_000 - t) };
      // Una sola reserva en vuelo por tenant: las peticiones simultáneas esperan a la misma
      if (!s.inflight) s.inflight = this.lease(tenantId, perMinute, s).finally(() => (s!.inflight = null));
      try {
        await s.inflight;
      } catch (e) {
        this.storeDownUntil = this.now() + (this.opts.retryStoreAfterMs ?? 5_000);
        this.opts.onDegraded?.("rate_lease", e);
        return this.fallback(tenantId, perMinute);
      }
    }
  }

  private async lease(tenantId: string, perMinute: number, s: LeaseState): Promise<void> {
    const n = this.leaseSize(perMinute);
    const ms = this.opts.storeTimeoutMs ?? 500;
    let timer: NodeJS.Timeout | undefined;
    const total = await Promise.race([
      this.store.incr({ tenantId, metric: this.opts.metric ?? "http.request", period: "minute", windowStart: s.window }, n),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("tiempo de espera del almacén de contadores")), ms);
      }),
    ]).finally(() => clearTimeout(timer));
    const granted = Math.max(0, Math.min(n, perMinute - (total - n)));
    s.available += granted;
    if (granted < n) s.exhausted = true; // el contador global ya no admite más en este minuto
  }
}
