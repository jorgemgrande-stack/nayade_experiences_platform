/**
 * Excepciones comerciales de cuota en el Core (registro 0016, solo lectura): las de la empresa en curso, con caché
 * corta. La vigencia se decide por fecha en cada consulta (no en la caché): al caducar, vuelve el límite contractual.
 *
 * Solo en modo `multi` y con el registro configurado. Si el registro no responde (o la migración 0016 no está aplicada),
 * no hay excepción: se aplica lo contractual, que nunca da más de lo contratado.
 */
import { opsLog } from "../ops/log";
import { getTenantId, getTenantMode } from "../tenant";
import { activeException, type PolicyPeriod, type QuotaException } from "./policy";
import type { QuotaExceptionReader } from "./quotaExceptions";

export interface QuotaExceptionAccessOptions {
  ttlMs?: number;
  now?: () => number;
  /** Fuerza el uso fuera del modo multi (pruebas). */
  enforce?: boolean;
}

export class QuotaExceptionAccess {
  private cache = new Map<string, { at: number; list: QuotaException[] }>();
  private ttl: number;
  private now: () => number;
  constructor(
    private reader: QuotaExceptionReader,
    private opts: QuotaExceptionAccessOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }
  private tenant(): string | null {
    if (!(this.opts.enforce ?? getTenantMode() === "multi")) return null;
    try {
      return getTenantId();
    } catch {
      return null;
    }
  }
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
  /** Excepción vigente de la empresa en curso para la métrica, o null. */
  async active(metric: string, period: PolicyPeriod = "total"): Promise<QuotaException | null> {
    const tenantId = this.tenant();
    if (!tenantId) return null;
    const t = this.now();
    let c = this.cache.get(tenantId);
    if (!c || t - c.at >= this.ttl) {
      try {
        c = { at: t, list: await this.reader.exceptions(tenantId) };
        this.cache.set(tenantId, c);
      } catch (e) {
        opsLog("warn", "QuotaExceptions", "read_failed", { tenantId, error: e instanceof Error ? e.name : "error" });
        return null;
      }
    }
    return activeException(c.list, metric, period, t);
  }
}

let current: QuotaExceptionAccess | null = null;
export function configureQuotaExceptions(reader: QuotaExceptionReader | null, opts: QuotaExceptionAccessOptions = {}): void {
  current = reader ? new QuotaExceptionAccess(reader, opts) : null;
}
/** null si no está configurado (instalación única o sin registro). */
export function getQuotaExceptionAccess(): QuotaExceptionAccess | null {
  return current;
}
