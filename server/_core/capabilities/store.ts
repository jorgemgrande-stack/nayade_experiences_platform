/**
 * Almacén de licencias por capacidad (registro). Lectura para el Core; escritura solo desde el plano
 * de control, en UNA transacción por aplicación, con un evento por cada cambio de estado.
 */
import type mysql from "mysql2/promise";
import type { CapabilityEvent, CapabilityGrant, CapabilityStatus } from "./model";

export interface CapabilityReader {
  list(tenantId: string): Promise<CapabilityGrant[]>;
}

export interface CapabilityChange {
  capabilityId: string;
  siteId: string;
  status: CapabilityStatus;
  validUntil: number | null;
  source: string;
}

export interface CapabilityStore extends CapabilityReader {
  /** Aplica los cambios de forma atómica y devuelve los que de verdad cambiaron algo. */
  apply(tenantId: string, changes: CapabilityChange[], meta: { actor: string; reason: string | null; now: number }): Promise<CapabilityEvent[]>;
  events(tenantId: string, limit?: number): Promise<CapabilityEvent[]>;
}

const same = (g: CapabilityGrant | undefined, c: CapabilityChange) => !!g && g.status === c.status && g.validUntil === c.validUntil && g.source === c.source;

export class MemoryCapabilityStore implements CapabilityStore {
  private rows = new Map<string, CapabilityGrant>();
  private log: CapabilityEvent[] = [];
  private failing = false;
  setFailing(f: boolean) {
    this.failing = f;
  }
  async list(tenantId: string) {
    if (this.failing) throw new Error("origen de licencias no disponible");
    return Array.from(this.rows.values()).filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }
  // Sin `await` intermedios: atómico en memoria
  async apply(tenantId: string, changes: CapabilityChange[], meta: { actor: string; reason: string | null; now: number }) {
    const out: CapabilityEvent[] = [];
    for (const c of changes) {
      const k = `${tenantId}\u0000${c.capabilityId}\u0000${c.siteId}`;
      const cur = this.rows.get(k);
      if (same(cur, c)) continue;
      this.rows.set(k, { tenantId, capabilityId: c.capabilityId, siteId: c.siteId, status: c.status, validUntil: c.validUntil, source: c.source, updatedAt: meta.now, updatedBy: meta.actor });
      const ev: CapabilityEvent = { tenantId, capabilityId: c.capabilityId, siteId: c.siteId, fromStatus: cur?.status ?? null, toStatus: c.status, source: c.source, actor: meta.actor, reason: meta.reason, at: meta.now };
      this.log.push(ev);
      out.push(ev);
    }
    return out;
  }
  async events(tenantId: string, limit = 200) {
    return this.log.filter((e) => e.tenantId === tenantId).slice(-limit).reverse();
  }
}

const row = (r: mysql.RowDataPacket): CapabilityGrant => ({
  tenantId: String(r.tenant_id),
  capabilityId: String(r.capability_id),
  siteId: String(r.site_id ?? ""),
  status: r.status as CapabilityStatus,
  validUntil: r.valid_until === null ? null : Number(r.valid_until),
  source: String(r.source),
  updatedAt: Number(r.updated_at),
  updatedBy: String(r.updated_by),
});

export class MysqlCapabilityStore implements CapabilityStore {
  constructor(private pool: mysql.Pool) {}
  async list(tenantId: string) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_capabilities WHERE tenant_id = ?", [tenantId]);
    return rows.map(row);
  }
  async apply(tenantId: string, changes: CapabilityChange[], meta: { actor: string; reason: string | null; now: number }) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      // Serializa las aplicaciones concurrentes del mismo tenant
      await c.query("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [tenantId]);
      const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM tenant_capabilities WHERE tenant_id = ? FOR UPDATE", [tenantId]);
      const current = new Map(rows.map(row).map((g) => [`${g.capabilityId}\u0000${g.siteId}`, g]));
      const out: CapabilityEvent[] = [];
      for (const ch of changes) {
        const cur = current.get(`${ch.capabilityId}\u0000${ch.siteId}`);
        if (same(cur, ch)) continue;
        await c.query(
          `INSERT INTO tenant_capabilities (tenant_id, capability_id, site_id, status, valid_until, source, updated_at, updated_by)
           VALUES (?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), valid_until = VALUES(valid_until), source = VALUES(source), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
          [tenantId, ch.capabilityId, ch.siteId, ch.status, ch.validUntil, ch.source, meta.now, meta.actor.slice(0, 100)],
        );
        await c.query(
          "INSERT INTO tenant_capability_events (tenant_id, capability_id, site_id, from_status, to_status, source, actor, reason, at) VALUES (?,?,?,?,?,?,?,?,?)",
          [tenantId, ch.capabilityId, ch.siteId, cur?.status ?? null, ch.status, ch.source, meta.actor.slice(0, 100), meta.reason?.slice(0, 300) ?? null, meta.now],
        );
        out.push({ tenantId, capabilityId: ch.capabilityId, siteId: ch.siteId, fromStatus: cur?.status ?? null, toStatus: ch.status, source: ch.source, actor: meta.actor, reason: meta.reason, at: meta.now });
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
  async events(tenantId: string, limit = 200) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM tenant_capability_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ${Math.min(1000, Math.max(1, Math.floor(limit)))}`,
      [tenantId],
    );
    return rows.map((r) => ({
      tenantId: String(r.tenant_id),
      capabilityId: String(r.capability_id),
      siteId: String(r.site_id ?? ""),
      fromStatus: (r.from_status as CapabilityStatus) ?? null,
      toStatus: r.to_status as CapabilityStatus,
      source: String(r.source),
      actor: String(r.actor),
      reason: (r.reason as string) ?? null,
      at: Number(r.at),
    }));
  }
}
