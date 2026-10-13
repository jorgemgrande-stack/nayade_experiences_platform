/**
 * Cuotas en MySQL (tabla `tenant_quotas` del registro, esquema 0002).
 * El Core solo lee; las escrituras del plano de control dejan evento de auditoría.
 */
import type mysql from "mysql2/promise";
import type { Quota, QuotaEnforcement, QuotaPeriod, QuotaPolicyReader } from "./types";

type Actor = { type: "system" | "operator" | "crm"; id: string };

export class MysqlQuotaReader implements QuotaPolicyReader {
  constructor(protected pool: Pick<mysql.Pool, "query">) {}

  async listQuotas(tenantId: string): Promise<Quota[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT tenant_id, metric, period, limit_value, enforcement FROM tenant_quotas WHERE tenant_id = ?",
      [tenantId],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      metric: r.metric,
      period: r.period,
      limit: Number(r.limit_value),
      enforcement: r.enforcement,
    }));
  }
}

export class QuotaAdmin extends MysqlQuotaReader {
  constructor(private admin: mysql.Pool) {
    super(admin);
  }

  async set(
    q: { tenantId: string; metric: string; period: QuotaPeriod; limit: number; enforcement: QuotaEnforcement },
    actor: Actor,
  ): Promise<void> {
    if (!Number.isFinite(q.limit) || q.limit < 0) throw new Error("Límite no válido");
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO tenant_quotas (tenant_id, metric, period, limit_value, enforcement) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE limit_value = VALUES(limit_value), enforcement = VALUES(enforcement)`,
        [q.tenantId, q.metric, q.period, q.limit, q.enforcement],
      );
      await conn.query("UPDATE tenants SET registry_version = registry_version + 1 WHERE id = ?", [q.tenantId]);
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [q.tenantId, actor.type, actor.id, "quota.set", JSON.stringify({ metric: q.metric, period: q.period, limit: q.limit, enforcement: q.enforcement })],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  async remove(tenantId: string, metric: string, period: QuotaPeriod, actor: Actor): Promise<void> {
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM tenant_quotas WHERE tenant_id = ? AND metric = ? AND period = ?", [tenantId, metric, period]);
      await conn.query("UPDATE tenants SET registry_version = registry_version + 1 WHERE id = ?", [tenantId]);
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [tenantId, actor.type, actor.id, "quota.removed", JSON.stringify({ metric, period })],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
}
