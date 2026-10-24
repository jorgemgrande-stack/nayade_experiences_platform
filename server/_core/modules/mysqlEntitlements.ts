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

type Actor = { type: "system" | "operator" | "crm"; id: string; requestId?: string | null };

/** Estado final deseado de una licencia (PUT del plano de control). */
export type EntitlementTarget = { status: EntitlementStatus; validUntil: Date | null };

export type ApplyResult = { changed: boolean; previous: Entitlement | null; entitlement: Entitlement };
export type RemoveResult = { changed: boolean; previous: Entitlement | null };

/** Fila del listado «qué empresas tienen este módulo» (solo hechos del registro). */
export type ModuleTenantRow = {
  tenantId: string;
  displayName: string;
  tenantStatus: string;
  /** Licencia registrada; null si el módulo va incluido en la base y no hay fila. */
  licenseStatus: EntitlementStatus | null;
  validUntil: Date | null;
  source: "operator" | "crm" | null;
  updatedAt: Date | null;
};

/** Empresas que no cuentan como usuarias de módulos (igual que el catálogo). */
const EXCLUDED_TENANT_STATUSES = ["deleted", "archived"];

const sameInstant = (a: Date | null, b: Date | null) => (a ? a.getTime() : null) === (b ? b.getTime() : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function map(r: any): Entitlement {
  return {
    tenantId: r.tenant_id,
    moduleId: r.module_id,
    status: r.status,
    validUntil: r.valid_until ? new Date(r.valid_until) : null,
    source: r.source,
  };
}

function assertModuleId(moduleId: string): void {
  if (!MODULE_ID_RE.test(moduleId)) throw new ModuleError("invalid_manifest", "Identificador de módulo no válido");
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

  private async tx<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.admin.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  private async lockTenant(conn: mysql.PoolConnection, tenantId: string): Promise<void> {
    const [t] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [tenantId]);
    if (!t[0]) throw new ModuleError("not_found", `Tenant ${tenantId} no encontrado`);
  }

  private async lockRow(conn: mysql.PoolConnection, tenantId: string, moduleId: string): Promise<Entitlement | null> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT tenant_id, module_id, status, valid_until, source FROM tenant_entitlements WHERE tenant_id = ? AND module_id = ? FOR UPDATE",
      [tenantId, moduleId],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  /** Sube la versión del registro y deja UN evento inmutable (misma transacción). */
  private async audit(
    conn: mysql.PoolConnection,
    tenantId: string,
    moduleId: string,
    actor: Actor,
    action: string,
    fromState: string | null,
    toState: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await conn.query("UPDATE tenants SET registry_version = registry_version + 1 WHERE id = ?", [tenantId]);
    await conn.query(
      "INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, from_state, to_state, details, request_id) VALUES (?,?,?,?,?,?,?,?)",
      [tenantId, actor.type, actor.id, action, fromState, toState, JSON.stringify({ moduleId, ...details }), actor.requestId ?? null],
    );
  }

  private async write(
    tenantId: string,
    moduleId: string,
    actor: Actor,
    action: string,
    sql: string,
    params: unknown[],
    details: Record<string, unknown>,
    toState: EntitlementStatus | null,
  ): Promise<void> {
    assertModuleId(moduleId);
    await this.tx(async (conn) => {
      await this.lockTenant(conn, tenantId);
      const prev = await this.lockRow(conn, tenantId, moduleId);
      await conn.query(sql, params);
      await this.audit(conn, tenantId, moduleId, actor, action, prev?.status ?? null, toState, details);
    });
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
      { validUntil: iso(until) },
      "active",
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
      status,
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
      null,
    );
  }

  /**
   * Lleva la licencia al estado final indicado en UNA transacción, de forma idempotente:
   * si nada cambia no escribe, no deja evento ni sube la versión del registro.
   */
  async apply(tenantId: string, moduleId: string, target: EntitlementTarget, actor: Actor, reason?: string): Promise<ApplyResult> {
    assertModuleId(moduleId);
    const validUntil = target.validUntil ?? null;
    return this.tx(async (conn) => {
      await this.lockTenant(conn, tenantId);
      const prev = await this.lockRow(conn, tenantId, moduleId);
      if (prev && prev.status === target.status && sameInstant(prev.validUntil, validUntil)) {
        return { changed: false, previous: prev, entitlement: prev };
      }
      const source = actor.type === "crm" ? "crm" : "operator";
      await conn.query(
        `INSERT INTO tenant_entitlements (tenant_id, module_id, status, valid_until, source)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), valid_until = VALUES(valid_until), source = VALUES(source)`,
        [tenantId, moduleId, target.status, validUntil, source],
      );
      const action = !prev ? "entitlement.granted" : prev.status !== target.status ? "entitlement.status" : "entitlement.updated";
      await this.audit(conn, tenantId, moduleId, actor, action, prev?.status ?? null, target.status, {
        validUntil: iso(validUntil),
        previousValidUntil: iso(prev?.validUntil ?? null),
        reason: reason ?? null,
      });
      return { changed: true, previous: prev, entitlement: { tenantId, moduleId, status: target.status, validUntil, source } };
    });
  }

  /** Retira la licencia (no toca datos de la empresa). Sin fila → sin cambios ni evento. */
  async remove(tenantId: string, moduleId: string, actor: Actor, reason?: string): Promise<RemoveResult> {
    assertModuleId(moduleId);
    return this.tx(async (conn) => {
      await this.lockTenant(conn, tenantId);
      const prev = await this.lockRow(conn, tenantId, moduleId);
      if (!prev) return { changed: false, previous: null };
      await conn.query("DELETE FROM tenant_entitlements WHERE tenant_id = ? AND module_id = ?", [tenantId, moduleId]);
      await this.audit(conn, tenantId, moduleId, actor, "entitlement.revoked", prev.status, null, {
        validUntil: iso(prev.validUntil),
        reason: reason ?? null,
      });
      return { changed: true, previous: prev };
    });
  }

  /**
   * Empresas con este módulo, en UNA consulta. Si va incluido en la base: todas las empresas
   * vigentes (con su licencia si existiera); si no, solo las que tienen fila de licencia.
   */
  async listModuleTenants(moduleId: string, includedInBase: boolean): Promise<ModuleTenantRow[]> {
    assertModuleId(moduleId);
    const [rows] = await this.admin.query<mysql.RowDataPacket[]>(
      `SELECT t.id AS tenant_id, t.display_name, t.status AS tenant_status,
              e.status, e.valid_until, e.source, e.updated_at
         FROM tenants t
         ${includedInBase ? "LEFT" : "INNER"} JOIN tenant_entitlements e ON e.tenant_id = t.id AND e.module_id = ?
        WHERE t.status NOT IN (?)
        ORDER BY t.id`,
      [moduleId, EXCLUDED_TENANT_STATUSES],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      displayName: r.display_name,
      tenantStatus: r.tenant_status,
      licenseStatus: r.status ?? null,
      validUntil: r.valid_until ? new Date(r.valid_until) : null,
      source: r.source ?? null,
      updatedAt: r.updated_at ? new Date(r.updated_at) : null,
    }));
  }

  /** Empresas vigentes con licencia activa y no caducada, por módulo (consulta agregada). */
  async activeCounts(now: Date): Promise<Map<string, number>> {
    const [rows] = await this.admin.query<mysql.RowDataPacket[]>(
      `SELECT e.module_id, COUNT(*) AS n
         FROM tenant_entitlements e
         JOIN tenants t ON t.id = e.tenant_id
        WHERE t.status NOT IN (?) AND e.status = 'active' AND (e.valid_until IS NULL OR e.valid_until > ?)
        GROUP BY e.module_id`,
      [EXCLUDED_TENANT_STATUSES, now],
    );
    return new Map(rows.map((r) => [r.module_id as string, Number(r.n)]));
  }
}
