/**
 * Cuotas en MySQL (tabla `tenant_quotas` del registro, esquema 0002).
 * El Core solo lee; las escrituras del plano de control dejan evento de auditoría.
 */
import type mysql from "mysql2/promise";
import type { Quota, QuotaEnforcement, QuotaPeriod, QuotaPolicyReader } from "./types";
import type { PolicyPeriod, QuotaException } from "./policy";
import { CONFLICT_MESSAGE, QuotaExceptionError, blocking, checkRevoke, historyDetails, validateNewException, type NewQuotaException, type QuotaExceptionHistoryRow, type QuotaExceptionReader, type QuotaExceptionStore } from "./quotaExceptions";

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

// ── Excepciones comerciales de cuota (registro 0016) ─────────────────────────
const actorType = (a: string): Actor["type"] => (a.startsWith("crm:") ? "crm" : a.startsWith("system:") ? "system" : "operator");
const excOf = (r: mysql.RowDataPacket): QuotaException => ({
  id: Number(r.id),
  tenantId: String(r.tenant_id),
  metric: String(r.metric),
  period: r.period as PolicyPeriod,
  originalLimit: r.original_limit === null ? null : Number(r.original_limit),
  newLimit: r.new_limit === null ? null : Number(r.new_limit),
  reason: String(r.reason),
  operator: String(r.operator),
  startsAt: Number(r.starts_at),
  expiresAt: Number(r.expires_at),
  status: r.status === "revoked" ? "revoked" : "active",
  revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
  revokedBy: r.revoked_by ?? null,
  revokeReason: r.revoke_reason ?? null,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

/** Lectura (Core, usuario de solo lectura del registro). */
export class MysqlQuotaExceptionReader implements QuotaExceptionReader {
  constructor(protected pool: Pick<mysql.Pool, "query">) {}
  async exceptions(tenantId: string): Promise<QuotaException[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_quota_exceptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 500", [tenantId]);
    return rows.map(excOf);
  }
}

/** Alta, revocación e historial (plano de control). Cada cambio, en una transacción con su historial y su evento. */
export class MysqlQuotaExceptionStore extends MysqlQuotaExceptionReader implements QuotaExceptionStore {
  constructor(private admin: mysql.Pool) {
    super(admin);
  }

  private async tx<T>(fn: (c: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const c = await this.admin.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn(c);
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async create(input: NewQuotaException, now: number): Promise<QuotaException> {
    const x = validateNewException(input, now);
    return this.tx(async (c) => {
      // Bloquea la empresa: dos altas a la vez de la misma cuota no pueden pasar las dos
      const [t] = await c.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [x.tenantId]);
      if (!t.length) throw new QuotaExceptionError("not_found", "Empresa no encontrada");
      const [cur] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_quota_exceptions WHERE tenant_id = ? AND metric = ? AND period = ? AND status = 'active'", [x.tenantId, x.metric, x.period]);
      if (blocking(cur.map(excOf), x, now)) throw new QuotaExceptionError("conflict", CONFLICT_MESSAGE);
      const [r] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO tenant_quota_exceptions (tenant_id, metric, period, original_limit, new_limit, reason, operator, starts_at, expires_at, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
        [x.tenantId, x.metric, x.period, x.originalLimit, x.newLimit, x.reason, x.operator, x.startsAt, x.expiresAt, now, now],
      );
      const row: QuotaException = { ...x, id: Number(r.insertId), status: "active", revokedAt: null, revokedBy: null, revokeReason: null, createdAt: now, updatedAt: now };
      await this.log(c, row, "created", x.operator, now, historyDetails(row));
      return row;
    });
  }

  async revoke(tenantId: string, id: number, meta: { actor: string; reason: string; now: number }): Promise<QuotaException> {
    return this.tx(async (c) => {
      const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_quota_exceptions WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, id]);
      if (!rows.length) throw new QuotaExceptionError("not_found", "Excepción no encontrada");
      const row = excOf(rows[0]);
      const reason = checkRevoke(row, meta);
      const actor = meta.actor.slice(0, 100);
      await c.query("UPDATE tenant_quota_exceptions SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", [meta.now, actor, reason, meta.now, tenantId, id]);
      const out: QuotaException = { ...row, status: "revoked", revokedAt: meta.now, revokedBy: actor, revokeReason: reason, updatedAt: meta.now };
      await this.log(c, out, "revoked", actor, meta.now, { ...historyDetails(out), reason });
      return out;
    });
  }

  private async log(c: mysql.PoolConnection, e: QuotaException, action: "created" | "revoked", actor: string, at: number, details: Record<string, unknown>) {
    await c.query("INSERT INTO tenant_quota_exception_history (exception_id, tenant_id, action, actor, at, details) VALUES (?,?,?,?,?,?)", [e.id, e.tenantId, action, actor, at, JSON.stringify(details)]);
    // Auditoría general de la empresa (fuera del prefijo «quota.» del historial de ajustes)
    await c.query("INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)", [e.tenantId, actorType(actor), actor.slice(0, 100), `quota_exception.${action}`, JSON.stringify({ id: e.id, ...details })]);
  }

  async history(tenantId: string, limit = 200): Promise<QuotaExceptionHistoryRow[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_quota_exception_history WHERE tenant_id = ? ORDER BY at DESC, id DESC LIMIT ?", [tenantId, Math.min(Math.max(1, limit), 1000)]);
    return rows.map((r) => ({
      id: Number(r.id),
      exceptionId: Number(r.exception_id),
      tenantId: String(r.tenant_id),
      action: r.action === "revoked" ? "revoked" : "created",
      actor: String(r.actor),
      at: Number(r.at),
      details: (() => {
        try {
          return JSON.parse(String(r.details));
        } catch {
          return {};
        }
      })(),
    }));
  }
}
