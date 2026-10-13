/**
 * Almacén MySQL del registro (esquema: db/registry/0000_registry.sql).
 *
 * Dos usos, con credenciales distintas:
 *  - Core (lectura): pool con un usuario de SOLO LECTURA; solo se invocan los métodos de
 *    `TenantRegistryReader`. La base de datos impide cualquier escritura aunque el código
 *    fallase.
 *  - Servicio (escritura): pool con usuario de administración; `transaction()`.
 *
 * Las restricciones de integridad (dominio único, un primario por tenant, una BD activa por
 * tenant, auditoría de solo anexado) las impone la propia base de datos.
 */
import type mysql from "mysql2/promise";
import {
  REGISTRY_CONTRACT_VERSION,
  RegistryError,
  type Tenant,
  type TenantDatabaseRef,
  type TenantDomain,
  type TenantEvent,
} from "./contract";
import type { DomainResolution, RegistryTx, TenantRegistryStore, TenantVersionInfo } from "./store";

type Q = Pick<mysql.Pool, "query">;

const toDate = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);

function mapTenant(r: any): Tenant {
  return {
    id: r.id,
    displayName: r.display_name,
    status: r.status,
    statusReason: r.status_reason ?? null,
    baselineVersion: r.baseline_version ?? null,
    schemaVersion: r.schema_version ?? null,
    registryVersion: Number(r.registry_version),
    createdAt: toDate(r.created_at)!,
    updatedAt: toDate(r.updated_at)!,
  };
}
function mapDomain(r: any): TenantDomain {
  return {
    domain: r.domain,
    tenantId: r.tenant_id,
    kind: r.kind,
    status: r.status,
    isPrimary: !!r.is_primary,
    verificationToken: r.verification_token ?? null,
    verifiedAt: toDate(r.verified_at),
    activatedAt: toDate(r.activated_at),
    createdAt: toDate(r.created_at)!,
  };
}
function mapDatabase(r: any): TenantDatabaseRef {
  return {
    id: Number(r.id),
    tenantId: r.tenant_id,
    state: r.state,
    dsnCipher: r.dsn_cipher,
    keyId: r.key_id,
    serverAlias: r.server_alias ?? null,
    createdAt: toDate(r.created_at)!,
    rotatedAt: toDate(r.rotated_at),
  };
}
function mapEvent(r: any): TenantEvent {
  return {
    id: Number(r.id),
    tenantId: r.tenant_id,
    at: toDate(r.at)!,
    actorType: r.actor_type,
    actorId: r.actor_id,
    action: r.action,
    fromState: r.from_state ?? null,
    toState: r.to_state ?? null,
    details: typeof r.details === "string" ? JSON.parse(r.details) : (r.details ?? null),
    requestId: r.request_id ?? null,
  };
}

function mapError(e: unknown): never {
  const err = e as { code?: string; sqlMessage?: string };
  if (err.code === "ER_DUP_ENTRY") throw new RegistryError("conflict", "El registro ya existe o viola una restricción de unicidad");
  if (err.code === "ER_NO_REFERENCED_ROW_2") throw new RegistryError("not_found", "Referencia a un tenant inexistente");
  if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED") throw new RegistryError("conflict", "Valor no válido");
  throw e;
}

class MysqlReader {
  constructor(protected q: Q) {}

  async contractVersion(): Promise<string> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'contract_version'");
    return rows[0]?.v ?? REGISTRY_CONTRACT_VERSION;
  }
  async getTenant(id: string): Promise<Tenant | null> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenants WHERE id = ?", [id]);
    return rows[0] ? mapTenant(rows[0]) : null;
  }
  async listTenants(): Promise<Tenant[]> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenants ORDER BY id");
    return rows.map(mapTenant);
  }
  async resolveDomain(domain: string): Promise<DomainResolution | null> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>(
      `SELECT d.domain AS d_domain, d.tenant_id AS d_tenant_id, d.kind AS d_kind, d.status AS d_status,
              d.is_primary AS d_is_primary, d.verification_token AS d_verification_token,
              d.verified_at AS d_verified_at, d.activated_at AS d_activated_at, d.created_at AS d_created_at,
              t.id AS t_id, t.display_name AS t_display_name, t.status AS t_status,
              t.status_reason AS t_status_reason, t.baseline_version AS t_baseline_version,
              t.schema_version AS t_schema_version, t.registry_version AS t_registry_version,
              t.created_at AS t_created_at, t.updated_at AS t_updated_at
         FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id WHERE d.domain = ?`,
      [domain],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      domain: mapDomain({
        domain: r.d_domain, tenant_id: r.d_tenant_id, kind: r.d_kind, status: r.d_status, is_primary: r.d_is_primary,
        verification_token: r.d_verification_token, verified_at: r.d_verified_at, activated_at: r.d_activated_at,
        created_at: r.d_created_at,
      }),
      tenant: mapTenant({
        id: r.t_id, display_name: r.t_display_name, status: r.t_status, status_reason: r.t_status_reason,
        baseline_version: r.t_baseline_version, schema_version: r.t_schema_version,
        registry_version: r.t_registry_version, created_at: r.t_created_at, updated_at: r.t_updated_at,
      }),
    };
  }
  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_domains WHERE tenant_id = ? ORDER BY domain", [tenantId]);
    return rows.map(mapDomain);
  }
  async getActiveDatabase(tenantId: string): Promise<TenantDatabaseRef | null> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>(
      "SELECT * FROM tenant_databases WHERE tenant_id = ? AND state = 'active' LIMIT 1",
      [tenantId],
    );
    return rows[0] ? mapDatabase(rows[0]) : null;
  }
  async listDatabases(tenantId: string): Promise<TenantDatabaseRef[]> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_databases WHERE tenant_id = ? ORDER BY id", [tenantId]);
    return rows.map(mapDatabase);
  }
  async listVersions(): Promise<TenantVersionInfo[]> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT id, status, registry_version FROM tenants");
    return rows.map((r) => ({ tenantId: r.id, status: r.status, registryVersion: Number(r.registry_version) }));
  }
  async listEvents(tenantId: string, limit = 100): Promise<TenantEvent[]> {
    const [rows] = await this.q.query<mysql.RowDataPacket[]>(
      "SELECT * FROM (SELECT * FROM tenant_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?) x ORDER BY id",
      [tenantId, limit],
    );
    return rows.map(mapEvent);
  }
}

class MysqlTx extends MysqlReader implements RegistryTx {
  async insertTenant(t: Omit<Tenant, "registryVersion" | "createdAt" | "updatedAt">): Promise<Tenant> {
    try {
      await this.q.query(
        "INSERT INTO tenants (id, display_name, status, status_reason, baseline_version, schema_version) VALUES (?,?,?,?,?,?)",
        [t.id, t.displayName, t.status, t.statusReason, t.baselineVersion, t.schemaVersion],
      );
    } catch (e) {
      mapError(e);
    }
    return (await this.getTenant(t.id))!;
  }

  async updateTenant(id: string, expectedVersion: number, patch: Parameters<RegistryTx["updateTenant"]>[2]): Promise<Tenant> {
    const sets: string[] = ["registry_version = registry_version + 1"];
    const vals: unknown[] = [];
    const col: Record<string, string> = {
      displayName: "display_name",
      status: "status",
      statusReason: "status_reason",
      baselineVersion: "baseline_version",
      schemaVersion: "schema_version",
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !col[k]) continue;
      sets.push(`${col[k]} = ?`);
      vals.push(v);
    }
    const [res] = await this.q.query<mysql.ResultSetHeader>(
      `UPDATE tenants SET ${sets.join(", ")} WHERE id = ? AND registry_version = ?`,
      [...vals, id, expectedVersion],
    );
    if (res.affectedRows === 0) {
      const cur = await this.getTenant(id);
      if (!cur) throw new RegistryError("not_found", `Tenant ${id} no encontrado`);
      throw new RegistryError("stale_version", `El tenant ${id} cambió (versión ${cur.registryVersion})`);
    }
    return (await this.getTenant(id))!;
  }

  async insertDomain(d: Omit<TenantDomain, "createdAt">): Promise<TenantDomain> {
    try {
      await this.q.query(
        `INSERT INTO tenant_domains (domain, tenant_id, kind, status, is_primary, verification_token, verified_at, activated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [d.domain, d.tenantId, d.kind, d.status, d.isPrimary ? 1 : 0, d.verificationToken, d.verifiedAt, d.activatedAt],
      );
    } catch (e) {
      mapError(e);
    }
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_domains WHERE domain = ?", [d.domain]);
    return mapDomain(rows[0]);
  }

  async updateDomain(domain: string, patch: Parameters<RegistryTx["updateDomain"]>[1]): Promise<TenantDomain> {
    const col: Record<string, string> = {
      kind: "kind", status: "status", isPrimary: "is_primary", verificationToken: "verification_token",
      verifiedAt: "verified_at", activatedAt: "activated_at",
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !col[k]) continue;
      sets.push(`${col[k]} = ?`);
      vals.push(k === "isPrimary" ? (v ? 1 : 0) : v);
    }
    if (sets.length) {
      try {
        const [res] = await this.q.query<mysql.ResultSetHeader>(
          `UPDATE tenant_domains SET ${sets.join(", ")} WHERE domain = ?`,
          [...vals, domain],
        );
        if (res.affectedRows === 0) throw new RegistryError("not_found", `Dominio ${domain} no encontrado`);
      } catch (e) {
        if (e instanceof RegistryError) throw e;
        mapError(e);
      }
    }
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_domains WHERE domain = ?", [domain]);
    if (!rows[0]) throw new RegistryError("not_found", `Dominio ${domain} no encontrado`);
    return mapDomain(rows[0]);
  }

  async insertDatabase(d: Omit<TenantDatabaseRef, "id" | "createdAt" | "rotatedAt">): Promise<TenantDatabaseRef> {
    let id = 0;
    try {
      const [res] = await this.q.query<mysql.ResultSetHeader>(
        "INSERT INTO tenant_databases (tenant_id, state, dsn_cipher, key_id, server_alias) VALUES (?,?,?,?,?)",
        [d.tenantId, d.state, d.dsnCipher, d.keyId, d.serverAlias],
      );
      id = res.insertId;
    } catch (e) {
      mapError(e);
    }
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_databases WHERE id = ?", [id]);
    return mapDatabase(rows[0]);
  }

  async updateDatabase(id: number, patch: Parameters<RegistryTx["updateDatabase"]>[1]): Promise<TenantDatabaseRef> {
    const col: Record<string, string> = { state: "state", dsnCipher: "dsn_cipher", keyId: "key_id", rotatedAt: "rotated_at" };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !col[k]) continue;
      sets.push(`${col[k]} = ?`);
      vals.push(v);
    }
    if (sets.length) {
      try {
        const [res] = await this.q.query<mysql.ResultSetHeader>(
          `UPDATE tenant_databases SET ${sets.join(", ")} WHERE id = ?`,
          [...vals, id],
        );
        if (res.affectedRows === 0) throw new RegistryError("not_found", `Base de datos ${id} no encontrada`);
      } catch (e) {
        if (e instanceof RegistryError) throw e;
        mapError(e);
      }
    }
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_databases WHERE id = ?", [id]);
    if (!rows[0]) throw new RegistryError("not_found", `Base de datos ${id} no encontrada`);
    return mapDatabase(rows[0]);
  }

  async insertEvent(e: Omit<TenantEvent, "id" | "at">): Promise<TenantEvent> {
    const [res] = await this.q.query<mysql.ResultSetHeader>(
      `INSERT INTO tenant_events (tenant_id, actor_type, actor_id, action, from_state, to_state, details, request_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [e.tenantId, e.actorType, e.actorId, e.action, e.fromState, e.toState, e.details ? JSON.stringify(e.details) : null, e.requestId],
    );
    const [rows] = await this.q.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_events WHERE id = ?", [res.insertId]);
    return mapEvent(rows[0]);
  }
}

export class MysqlTenantRegistryStore extends MysqlReader implements TenantRegistryStore {
  constructor(private pool: mysql.Pool) {
    super(pool);
  }

  async transaction<T>(fn: (tx: RegistryTx) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(new MysqlTx(conn as unknown as Q));
      await conn.commit();
      return result;
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* conexión ya perdida */
      }
      throw e;
    } finally {
      conn.release();
    }
  }
}
