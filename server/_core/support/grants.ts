/**
 * Acceso delegado de soporte: concesiones temporales y auditadas.
 *
 *  - Una concesión la crea un operador (plano de control) para UN tenant, con motivo y una
 *    duración máxima de 4 h; nace de solo lectura salvo que se pida lo contrario.
 *  - El Core solo LEE las concesiones (registro, solo lectura) y valida cada petición.
 *  - Revocable en cualquier momento; todo queda en `tenant_events`.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const MAX_SUPPORT_MINUTES = 240;

export interface SupportGrant {
  id: string;
  tenantId: string;
  operator: string;
  reason: string;
  readOnly: boolean;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
}

export interface SupportGrantReader {
  getGrant(id: string): Promise<SupportGrant | null>;
}

export function grantActive(g: SupportGrant, now = Date.now()): boolean {
  return g.revokedAt === null && g.expiresAt > now;
}

export class MemorySupportStore implements SupportGrantReader {
  grants = new Map<string, SupportGrant>();
  async getGrant(id: string) {
    return this.grants.get(id) ?? null;
  }
  create(input: { tenantId: string; operator: string; reason: string; minutes: number; readOnly?: boolean }, now = Date.now()): SupportGrant {
    const g = buildGrant(input, now);
    this.grants.set(g.id, g);
    return g;
  }
  revoke(id: string, now = Date.now()) {
    const g = this.grants.get(id);
    if (g) g.revokedAt = now;
  }
}

export function buildGrant(
  input: { tenantId: string; operator: string; reason: string; minutes: number; readOnly?: boolean },
  now: number,
): SupportGrant {
  if (!input.reason || input.reason.trim().length < 5) throw new Error("El motivo es obligatorio");
  if (!(input.minutes >= 1 && input.minutes <= MAX_SUPPORT_MINUTES)) {
    throw new Error(`La duración debe estar entre 1 y ${MAX_SUPPORT_MINUTES} minutos`);
  }
  return {
    id: crypto.randomBytes(16).toString("hex"),
    tenantId: input.tenantId,
    operator: input.operator.slice(0, 100),
    reason: input.reason.trim().slice(0, 300),
    readOnly: input.readOnly ?? true,
    expiresAt: now + input.minutes * 60_000,
    createdAt: now,
    revokedAt: null,
  };
}

const map = (r: any): SupportGrant => ({
  id: r.id,
  tenantId: r.tenant_id,
  operator: r.operator,
  reason: r.reason,
  readOnly: !!r.read_only,
  expiresAt: new Date(r.expires_at).getTime(),
  createdAt: new Date(r.created_at).getTime(),
  revokedAt: r.revoked_at ? new Date(r.revoked_at).getTime() : null,
});

export class MysqlSupportReader implements SupportGrantReader {
  constructor(protected pool: Pick<mysql.Pool, "query">) {}
  async getGrant(id: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM support_grants WHERE id = ?", [id]);
    return rows[0] ? map(rows[0]) : null;
  }
}

/** Escrituras del plano de control, con evento de auditoría en la misma transacción. */
export class SupportAdmin extends MysqlSupportReader {
  constructor(private admin: mysql.Pool) {
    super(admin);
  }

  async create(input: { tenantId: string; operator: string; reason: string; minutes: number; readOnly?: boolean }): Promise<SupportGrant> {
    const g = buildGrant(input, Date.now());
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      const [t] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [g.tenantId]);
      if (!t[0]) throw new Error("Tenant no encontrado");
      await conn.query(
        "INSERT INTO support_grants (id, tenant_id, operator, reason, read_only, expires_at) VALUES (?,?,?,?,?,?)",
        [g.id, g.tenantId, g.operator, g.reason, g.readOnly ? 1 : 0, new Date(g.expiresAt)],
      );
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [g.tenantId, "operator", g.operator, "support.granted", JSON.stringify({ grantId: g.id, reason: g.reason, readOnly: g.readOnly, expiresAt: new Date(g.expiresAt).toISOString() })],
      );
      await conn.commit();
      return g;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  async revoke(id: string, operator: string): Promise<void> {
    const g = await this.getGrant(id);
    if (!g) throw new Error("Concesión no encontrada");
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE support_grants SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL", [id]);
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [g.tenantId, "operator", operator.slice(0, 100), "support.revoked", JSON.stringify({ grantId: id })],
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
