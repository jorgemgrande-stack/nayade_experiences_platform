/**
 * Límites contratados en el Core (registro 0013): los lee la empresa en curso, con caché corta, y declara su uso
 * real (usuarios con plaza, bytes almacenados) para el plano de control. Solo en modo `multi` y con el registro
 * configurado; en instalación única o sin configurar, `limit` devuelve `undefined` (se aplica lo de siempre: lo
 * incluido en el plan) y declarar el uso no hace nada.
 *
 * Si el registro no responde, `limit` también devuelve `undefined`: se aplica lo incluido en el plan, que nunca
 * es más que lo contratado (un fallo no da plazas de más). Declarar el uso nunca bloquea ni falla la operación.
 */
import { opsLog } from "../ops/log";
import { getTenantId, getTenantMode } from "../tenant";
import type { LimitMetric, TenantLimitStore, UsageMetric } from "./store";

export interface LimitAccessOptions {
  ttlMs?: number;
  now?: () => number;
  /** Fuerza el uso fuera del modo multi (pruebas). */
  enforce?: boolean;
}

export class LimitAccess {
  private cache = new Map<string, { at: number; limits: Map<LimitMetric, number | null> }>();
  private ttl: number;
  private now: () => number;
  constructor(
    private store: Pick<TenantLimitStore, "limits" | "reportUsage">,
    private opts: LimitAccessOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }
  private active(): string | null {
    if (!(this.opts.enforce ?? getTenantMode() === "multi")) return null;
    try {
      return getTenantId();
    } catch {
      return null; // sin empresa en curso (p. ej. fuera de una petición)
    }
  }
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
  /** Límite vigente de la empresa en curso: número, null (sin tope) o undefined (sin dato: lo del plan). */
  async limit(metric: LimitMetric): Promise<number | null | undefined> {
    const tenantId = this.active();
    if (!tenantId) return undefined;
    const t = this.now();
    let c = this.cache.get(tenantId);
    if (!c || t - c.at >= this.ttl) {
      try {
        const rows = await this.store.limits(tenantId);
        c = { at: t, limits: new Map(rows.map((r) => [r.metric, r.limit])) };
        this.cache.set(tenantId, c);
      } catch (e) {
        opsLog("warn", "Limits", "read_failed", { tenantId, error: e instanceof Error ? e.name : "error" });
        return undefined;
      }
    }
    return c.limits.has(metric) ? c.limits.get(metric)! : undefined;
  }
  /** Declara el uso real de la empresa en curso (sin esperar ni fallar). */
  report(metric: UsageMetric, used: number): void {
    const tenantId = this.active();
    if (!tenantId) return;
    void this.store.reportUsage(tenantId, metric, used, this.now()).catch((e) => opsLog("warn", "Limits", "usage_report_failed", { tenantId, metric, error: e instanceof Error ? e.name : "error" }));
  }
}

let current: LimitAccess | null = null;
export function configureLimitAccess(store: Pick<TenantLimitStore, "limits" | "reportUsage"> | null, opts: LimitAccessOptions = {}): void {
  current = store ? new LimitAccess(store, opts) : null;
}
/** null si no está configurado (instalación única o sin registro). */
export function getLimitAccess(): LimitAccess | null {
  return current;
}
