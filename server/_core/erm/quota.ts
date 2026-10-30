/**
 * Política y aplicación de cuotas.
 *
 *  - Los límites vienen de un `QuotaPolicyReader` (plano de control); si un tenant no tiene
 *    límite propio para una métrica se aplica el valor por defecto de la plataforma: en modo
 *    multi nadie es «ilimitado» por omisión.
 *  - `check()` suma el consumo volcado + el pendiente en memoria (sin ventana ciega).
 *  - Los límites por minuto los aplican los limitadores de tasa, no el almacén horario.
 *  - Si el almacén de uso cae, se decide con lo conocido en memoria y se marca `unavailable`:
 *    la medición caída no debe tumbar el servicio, pero tampoco se concede lo ya excedido.
 */
import { getTenantId, getTenantMode } from "../tenant";
import { Metrics } from "../metering";
import { QuotaExceededError } from "./types";
import type { AlertSink, Quota, QuotaDecision, QuotaPeriod, QuotaPolicyReader, UsageStore } from "./types";
import { activeException, type QuotaException } from "./policy";
import type { QuotaExceptionReader } from "./quotaExceptions";
import { UsageAggregator } from "./usage";

export type DefaultQuota = Omit<Quota, "tenantId">;

/** Valores por defecto de plataforma para el modo multi (ajustables con ERM_DEFAULT_QUOTAS). */
export const DEFAULT_QUOTAS: DefaultQuota[] = [
  { metric: Metrics.HTTP_REQUEST, period: "minute", limit: 1200, enforcement: "hard" },
  { metric: Metrics.STORAGE_WRITE_BYTES, period: "month", limit: 5 * 1024 ** 3, enforcement: "hard" },
  { metric: Metrics.EMAIL_SENT, period: "day", limit: 1000, enforcement: "hard" },
  { metric: Metrics.LLM_TOKENS_INPUT, period: "month", limit: 2_000_000, enforcement: "soft" },
  { metric: Metrics.LLM_TOKENS_OUTPUT, period: "month", limit: 1_000_000, enforcement: "soft" },
  // Exportación de datos: solicitudes al día y volumen generado al mes (sin comprimir) por empresa
  { metric: Metrics.DATA_EXPORT_RUNS, period: "day", limit: 5, enforcement: "hard" },
  { metric: Metrics.DATA_EXPORT_BYTES, period: "month", limit: 20 * 1024 ** 3, enforcement: "hard" },
];

export const DEFAULT_MAX_CONCURRENT = 60;

export function parseDefaultQuotas(json: string | undefined): DefaultQuota[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    const periods = ["minute", "hour", "day", "month"];
    return arr.filter(
      (q) =>
        q &&
        typeof q.metric === "string" &&
        periods.includes(q.period) &&
        Number.isFinite(q.limit) &&
        q.limit >= 0 &&
        (q.enforcement === "hard" || q.enforcement === "soft"),
    );
  } catch {
    return null;
  }
}

export function windowStart(period: QuotaPeriod, now: number): number {
  const d = new Date(now);
  switch (period) {
    case "minute":
      return Math.floor(now / 60_000) * 60_000;
    case "hour":
      return Math.floor(now / 3_600_000) * 3_600_000;
    case "day":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    case "month":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
}

export interface QuotaEngineOptions {
  defaults?: DefaultQuota[];
  /** Si es `false` (modo single), no se aplican límites por defecto, solo los del tenant. */
  applyDefaults?: boolean;
  alerts?: AlertSink;
  ttlMs?: number;
  now?: () => number;
}

type QuotaCache = { at: number; list: Quota[] };

export class QuotaEngine {
  private cache = new Map<string, QuotaCache>();
  private alerted = new Set<string>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(
    private policy: QuotaPolicyReader,
    private store: UsageStore,
    private aggregator: UsageAggregator,
    private opts: QuotaEngineOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  private applyDefaults(): boolean {
    return this.opts.applyDefaults ?? getTenantMode() === "multi";
  }

  /** Límites efectivos del tenant: los propios, más los de plataforma para lo no definido. */
  async quotasFor(tenantId: string): Promise<Quota[]> {
    const t = this.now();
    const c = this.cache.get(tenantId);
    let own: Quota[];
    if (c && t - c.at < this.ttl) own = c.list;
    else {
      try {
        own = await this.policy.listQuotas(tenantId);
        this.cache.set(tenantId, { at: t, list: own });
      } catch {
        own = c?.list ?? []; // origen caído: último conocido o solo los de plataforma
      }
    }
    if (!this.applyDefaults()) return own;
    const defaults = (this.opts.defaults ?? DEFAULT_QUOTAS).filter(
      (d) => !own.some((o) => o.metric === d.metric && o.period === d.period),
    );
    return [...own, ...defaults.map((d) => ({ ...d, tenantId }))];
  }

  async limitPerMinute(metric: string, tenantId: string): Promise<number | null> {
    const q = (await this.quotasFor(tenantId)).find((x) => x.metric === metric && x.period === "minute");
    return q ? q.limit : null;
  }

  /** Consumo de la métrica en la ventana (volcado + pendiente). */
  async usage(tenantId: string, metric: string, period: QuotaPeriod): Promise<{ used: number; reliable: boolean }> {
    const t = this.now();
    const from = windowStart(period, t);
    const pending = this.aggregator.pendingSum(tenantId, metric, from, t + 3_600_000);
    try {
      return { used: (await this.store.sum(tenantId, metric, from, t + 3_600_000)) + pending, reliable: true };
    } catch {
      return { used: pending, reliable: false };
    }
  }

  async check(metric: string, quantity = 1, tenantId: string = getTenantId()): Promise<QuotaDecision> {
    const quotas = (await this.quotasFor(tenantId)).filter((q) => q.metric === metric && q.period !== "minute");
    let decision: QuotaDecision = { allowed: true, reason: "ok", metric };
    for (const q of quotas) {
      const { used, reliable } = await this.usage(tenantId, metric, q.period);
      const after = used + quantity;
      this.maybeAlert(tenantId, q, used, after);
      if (after > q.limit) {
        if (q.enforcement === "hard") {
          return { allowed: false, reason: "exceeded", metric, limit: q.limit, used, period: q.period };
        }
        decision = { allowed: true, reason: "soft_exceeded", metric, limit: q.limit, used, period: q.period };
      } else if (!reliable && decision.reason === "ok") {
        decision = { allowed: true, reason: "unavailable", metric, limit: q.limit, used, period: q.period };
      }
    }
    return decision;
  }

  /** Lanza `QuotaExceededError` si un límite duro se superaría. */
  async assert(metric: string, quantity = 1, tenantId: string = getTenantId()): Promise<QuotaDecision> {
    const d = await this.check(metric, quantity, tenantId);
    if (!d.allowed) throw new QuotaExceededError(metric, d);
    return d;
  }

  private maybeAlert(tenantId: string, q: Quota, _used: number, after: number): void {
    if (!this.opts.alerts || q.limit <= 0) return;
    const start = windowStart(q.period, this.now());
    for (const threshold of [0.8, 1]) {
      if (after >= q.limit * threshold) {
        const key = `${tenantId}|${q.metric}|${q.period}|${start}|${threshold}`;
        if (this.alerted.has(key)) continue;
        if (this.alerted.size > 10_000) this.alerted.clear();
        this.alerted.add(key);
        this.opts.alerts.alert({
          tenantId,
          metric: q.metric,
          period: q.period,
          threshold,
          used: after,
          limit: q.limit,
          at: this.now(),
        });
      }
    }
  }
}

/**
 * Cuotas del Resource Manager con las excepciones comerciales vigentes aplicadas (registro 0016). La vigencia se decide
 * por fecha en cada lectura: una excepción caducada deja de aplicarse sin tareas. Excepción sin tope (`newLimit` null):
 * se representa con el mayor entero seguro (nunca bloquea). Si las excepciones no se pueden leer (migración sin aplicar
 * o registro caído), se aplican las cuotas de siempre: nunca se dan límites de más por un fallo.
 */
export function withQuotaExceptions(
  reader: QuotaPolicyReader,
  exceptions: QuotaExceptionReader,
  now: () => number = Date.now,
): QuotaPolicyReader {
  return {
    async listQuotas(tenantId: string): Promise<Quota[]> {
      const own = await reader.listQuotas(tenantId);
      let list: QuotaException[];
      try {
        list = await exceptions.exceptions(tenantId);
      } catch {
        return own;
      }
      const t = now();
      const out = own.map((q) => ({ ...q }));
      const periods: QuotaPeriod[] = ["minute", "hour", "day", "month"];
      for (const period of periods) {
        for (const metric of Array.from(new Set(list.filter((e) => e.period === period).map((e) => e.metric)))) {
          const exc = activeException(list, metric, period, t);
          if (!exc) continue;
          const limit = exc.newLimit ?? Number.MAX_SAFE_INTEGER;
          const cur = out.find((q) => q.metric === metric && q.period === period);
          if (cur) cur.limit = limit;
          else out.push({ tenantId, metric, period, limit, enforcement: "hard" });
        }
      }
      return out;
    },
  };
}
