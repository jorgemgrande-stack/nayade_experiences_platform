/**
 * Límites contratados y uso declarado de cada empresa (registro 0013).
 *
 *  - Límites: los escribe el plano de control al aplicar las licencias (plan + ampliaciones). La empresa los lee
 *    para aplicar el tope de usuarios y de almacenamiento. Sin fila: lo incluido en su plan (como hasta ahora).
 *  - Uso: lo declara la propia empresa (usuarios con plaza, bytes almacenados); el plano de control lo lee para no
 *    permitir bajar una ampliación por debajo de lo usado. El plano de control nunca accede a los datos de la empresa.
 *
 * Cada lectura y escritura va acotada por `tenant_id`: una empresa nunca ve ni escribe los de otra.
 */
import type mysql from "mysql2/promise";

export const LIMIT_METRICS = ["users", "sites", "storage_gb"] as const;
export type LimitMetric = (typeof LIMIT_METRICS)[number];
export const USAGE_METRICS = ["users", "sites", "storage_bytes"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface TenantLimit {
  metric: LimitMetric;
  /** null = sin tope técnico (por contrato). */
  limit: number | null;
  source: string;
  updatedAt: number;
}
export interface LimitChange {
  metric: LimitMetric;
  from: number | null | undefined;
  to: number | null;
}
export interface TenantUsage {
  metric: UsageMetric;
  used: number;
  measuredAt: number;
}

export interface TenantLimitReader {
  limits(tenantId: string): Promise<TenantLimit[]>;
}
export interface TenantLimitStore extends TenantLimitReader {
  /** Fija los límites de las métricas indicadas. Devuelve solo los que cambian (idempotente). */
  setLimits(tenantId: string, limits: Array<{ metric: LimitMetric; limit: number | null }>, meta: { source: string; actor: string; now: number }): Promise<LimitChange[]>;
  usage(tenantId: string): Promise<TenantUsage[]>;
  /** Uso actual declarado por la empresa (sustituye al anterior si es más reciente). */
  reportUsage(tenantId: string, metric: UsageMetric, used: number, now: number): Promise<void>;
}

const check = (tenantId: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantId)) throw new Error("Tenant no válido");
};

export class MemoryTenantLimitStore implements TenantLimitStore {
  private rows = new Map<string, TenantLimit>();
  private used = new Map<string, TenantUsage>();
  async limits(tenantId: string) {
    return Array.from(this.rows.entries())
      .filter(([k]) => k.startsWith(`${tenantId}|`))
      .map(([, v]) => ({ ...v }));
  }
  async setLimits(tenantId: string, limits: Array<{ metric: LimitMetric; limit: number | null }>, meta: { source: string; actor: string; now: number }) {
    check(tenantId);
    const out: LimitChange[] = [];
    for (const l of limits) {
      const k = `${tenantId}|${l.metric}`;
      const cur = this.rows.get(k);
      if (cur && cur.limit === l.limit && cur.source === meta.source) continue;
      if (!cur || cur.limit !== l.limit) out.push({ metric: l.metric, from: cur?.limit, to: l.limit });
      this.rows.set(k, { metric: l.metric, limit: l.limit, source: meta.source, updatedAt: meta.now });
    }
    return out;
  }
  async usage(tenantId: string) {
    return Array.from(this.used.entries())
      .filter(([k]) => k.startsWith(`${tenantId}|`))
      .map(([, v]) => ({ ...v }));
  }
  async reportUsage(tenantId: string, metric: UsageMetric, used: number, now: number) {
    check(tenantId);
    const k = `${tenantId}|${metric}`;
    const cur = this.used.get(k);
    if (cur && cur.measuredAt > now) return;
    this.used.set(k, { metric, used: Math.max(0, Math.round(used)), measuredAt: now });
  }
}

export class MysqlTenantLimitStore implements TenantLimitStore {
  constructor(private pool: mysql.Pool) {}
  async limits(tenantId: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT metric, limit_value, source, updated_at FROM tenant_entitlement_limits WHERE tenant_id = ?", [tenantId]);
    return rows.map((r) => ({ metric: r.metric as LimitMetric, limit: r.limit_value === null ? null : Number(r.limit_value), source: String(r.source), updatedAt: Number(r.updated_at) }));
  }
  async setLimits(tenantId: string, limits: Array<{ metric: LimitMetric; limit: number | null }>, meta: { source: string; actor: string; now: number }) {
    check(tenantId);
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [cur] = await c.query<mysql.RowDataPacket[]>("SELECT metric, limit_value, source FROM tenant_entitlement_limits WHERE tenant_id = ? FOR UPDATE", [tenantId]);
      const before = new Map(cur.map((r) => [String(r.metric), { limit: r.limit_value === null ? null : Number(r.limit_value), source: String(r.source) }]));
      const out: LimitChange[] = [];
      for (const l of limits) {
        const b = before.get(l.metric);
        if (b && b.limit === l.limit && b.source === meta.source) continue;
        if (!b || b.limit !== l.limit) out.push({ metric: l.metric, from: b?.limit, to: l.limit });
        await c.query(
          `INSERT INTO tenant_entitlement_limits (tenant_id, metric, limit_value, source, updated_at, updated_by) VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE limit_value = VALUES(limit_value), source = VALUES(source), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
          [tenantId, l.metric, l.limit, meta.source.slice(0, 80), meta.now, meta.actor.slice(0, 100)],
        );
      }
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  async usage(tenantId: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT metric, used, measured_at FROM tenant_usage WHERE tenant_id = ?", [tenantId]);
    return rows.map((r) => ({ metric: r.metric as UsageMetric, used: Number(r.used), measuredAt: Number(r.measured_at) }));
  }
  async reportUsage(tenantId: string, metric: UsageMetric, used: number, now: number) {
    check(tenantId);
    // Solo sustituye una medida anterior: dos réplicas que miden a la vez no retroceden el dato
    await this.pool.query(
      `INSERT INTO tenant_usage (tenant_id, metric, used, measured_at) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE used = IF(VALUES(measured_at) >= measured_at, VALUES(used), used), measured_at = GREATEST(measured_at, VALUES(measured_at))`,
      [tenantId, metric, Math.max(0, Math.round(used)), now],
    );
  }
}
