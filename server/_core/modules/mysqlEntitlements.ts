/**
 * Almacén MySQL de licencias (tabla `tenant_entitlements` del registro, esquema 0001).
 *
 *  - `MysqlEntitlementReader`: lo que usa el Core (credenciales de solo lectura).
 *  - `EntitlementAdmin`: escrituras del plano de control; cada cambio deja un evento
 *    inmutable en `tenant_events` dentro de la misma transacción.
 */
import type mysql from "mysql2/promise";
import { MODULE_ID_RE, ModuleError } from "./contract";
import type { Entitlement, EntitlementReader, EntitlementStatus } from "./entitlements";

type Actor = { type: "system" | "operator" | "crm"; id: string };

function map(r: any): Entitlement {
  return {
    tenantId: r.tenant_id,
    moduleId: r.module_id,
    status: r.status,
    validUntil: r.valid_until ? new Date(r.valid_until) : null,
    source: r.source,
  };
}

export class MysqlEntitlementReader implements EntitlementReader {
  constructor(protected pool: Pick<mysql.Pool, "query">) {}

  async listEntitlements(tenantId: string): Promise<Entitlement[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT tenant_id, module_id, status, valid_until, source FROM tenant_entitlements WHERE tenant_id = ?",
      [tenantId],
    );
    return rows.map(map);
  }
}

export class EntitlementAdmin extends MysqlEntitlementReader {
  constructor(private admin: mysql.Pool) {
    super(admin);
  }

  private async write(
    tenantId: string,
    moduleId: string,
    actor: Actor,
    action: string,
    sql: string,
    params: unknown[],
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!MODULE_ID_RE.test(moduleId)) throw new ModuleError("invalid_manifest", "Identificador de módulo no válido");
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      const [t] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [tenantId]);
      if (!t[0]) throw new ModuleError("not_found", `Tenant ${tenantId} no encontrado`);
      await conn.query(sql, params);
      await conn.query(
        "UPDATE tenants SET registry_version = registry_version + 1 WHERE id = ?",
        [tenantId],
      );
      await conn.query(
        "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, details) VALUES (?,?,?,?,?)",
        [tenantId, actor.type, actor.id, action, JSON.stringify({ moduleId, ...details })],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  async grant(
    tenantId: string,
    moduleId: string,
    actor: Actor,
    opts: { validUntil?: Date | null } = {},
  ): Promise<void> {
    const until = opts.validUntil ?? null;
    await this.write(
      tenantId,
      moduleId,
      actor,
      "entitlement.granted",
      `INSERT INTO tenant_entitlements (tenant_id, module_id, status, valid_until, source)
       VALUES (?, ?, 'active', ?, ?)
       ON DUPLICATE KEY UPDATE status = 'active', valid_until = VALUES(valid_until), source = VALUES(source)`,
      [tenantId, moduleId, until, actor.type === "crm" ? "crm" : "operator"],
      { validUntil: until ? until.toISOString() : null },
    );
  }

  async setStatus(tenantId: string, moduleId: string, status: EntitlementStatus, actor: Actor): Promise<void> {
    await this.write(
      tenantId,
      moduleId,
      actor,
      "entitlement.status",
      "UPDATE tenant_entitlements SET status = ? WHERE tenant_id = ? AND module_id = ?",
      [status, tenantId, moduleId],
      { status },
    );
  }

  async revoke(tenantId: string, moduleId: string, actor: Actor): Promise<void> {
    await this.write(
      tenantId,
      moduleId,
      actor,
      "entitlement.revoked",
      "DELETE FROM tenant_entitlements WHERE tenant_id = ? AND module_id = ?",
      [tenantId, moduleId],
      {},
    );
  }
}
