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
