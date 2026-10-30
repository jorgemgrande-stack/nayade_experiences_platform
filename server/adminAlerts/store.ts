/**
 * Registro de las alertas administrativas (CRM 0030): una fila por hecho y tipo de alerta. La clave única
 * `(alert_id, event_key)` es la idempotencia por evento: un hecho repetido (reintento, dos réplicas, evento duplicado
 * de Stripe) no añade fila y no vuelve a avisar.
 */
import type mysql from "mysql2/promise";
import type { AlertSeverity } from "./templates";

export const LOG_STATUSES = ["sent", "grouped", "digested", "disabled", "no_recipients", "unavailable", "failed"] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export interface AlertLogRow {
  id: number;
  alertId: string;
  eventKey: string;
  severity: AlertSeverity;
  status: LogStatus;
  tenantId: string | null;
  companyId: number | null;
  company: string | null;
  summary: string;
  link: string | null;
  recipients: number;
  occurredAt: number;
  createdAt: number;
  digestAt: number | null;
}
export type NewAlertLog = Omit<AlertLogRow, "id" | "digestAt" | "recipients">;

export interface AlertLogQuery {
  alertId?: string;
  status?: LogStatus;
  tenantId?: string;
  beforeId?: number;
  limit?: number;
}

export interface AdminAlertStore {
  /** Inserta el hecho; `null` si ya existía (duplicado). */
  insert(r: NewAlertLog): Promise<number | null>;
  finish(id: number, status: LogStatus, recipients: number): Promise<void>;
  /** Último aviso ENVIADO de una alerta (y empresa, si se da) desde `since`. */
  lastSent(alertId: string, groupKey: string | null, since: number): Promise<AlertLogRow | null>;
  /** Cuántos hechos de una alerta (y empresa) desde `since` (para elevar la prioridad por repetición). */
  countSince(alertId: string, tenantId: string | null, since: number): Promise<number>;
  /** Avisos agrupados pendientes de resumen. */
  grouped(limit: number): Promise<AlertLogRow[]>;
  markDigested(ids: number[], at: number): Promise<void>;
  list(q: AlertLogQuery): Promise<AlertLogRow[]>;
  getState(name: string): Promise<number | null>;
  setState(name: string, value: number, now: number): Promise<void>;
}

const MAX = 200;

export class MemoryAdminAlertStore implements AdminAlertStore {
  rows: AlertLogRow[] = [];
  state = new Map<string, number>();
  async insert(r: NewAlertLog) {
    if (this.rows.some((x) => x.alertId === r.alertId && x.eventKey === r.eventKey)) return null;
    const id = this.rows.length + 1;
    this.rows.push({ ...r, id, recipients: 0, digestAt: null });
    return id;
  }
  async finish(id: number, status: LogStatus, recipients: number) {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { status, recipients });
  }
  async lastSent(alertId: string, groupKey: string | null, since: number) {
    const m = this.rows.filter((x) => x.alertId === alertId && x.status === "sent" && x.createdAt >= since && (groupKey === null || x.tenantId === groupKey));
    return m.length ? { ...m[m.length - 1] } : null;
  }
  async countSince(alertId: string, tenantId: string | null, since: number) {
    return this.rows.filter((x) => x.alertId === alertId && x.createdAt >= since && x.tenantId === tenantId).length;
  }
  async grouped(limit: number) {
    return this.rows.filter((x) => x.status === "grouped").slice(0, limit).map((x) => ({ ...x }));
  }
  async markDigested(ids: number[], at: number) {
    for (const r of this.rows) if (ids.includes(r.id)) Object.assign(r, { status: "digested", digestAt: at });
  }
  async list(q: AlertLogQuery) {
    return this.rows
      .filter((x) => (!q.alertId || x.alertId === q.alertId) && (!q.status || x.status === q.status) && (!q.tenantId || x.tenantId === q.tenantId) && (!q.beforeId || x.id < q.beforeId))
      .sort((a, b) => b.id - a.id)
      .slice(0, Math.min(q.limit ?? 50, MAX))
      .map((x) => ({ ...x }));
  }
  async getState(name: string) {
    return this.state.get(name) ?? null;
  }
  async setState(name: string, value: number) {
    this.state.set(name, value);
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const row = (r: Record<string, unknown>): AlertLogRow => ({
  id: Number(r.id),
  alertId: String(r.alert_id),
  eventKey: String(r.event_key),
  severity: r.severity as AlertSeverity,
  status: r.status as LogStatus,
  tenantId: (r.tenant_id as string) ?? null,
  companyId: num(r.company_id),
  company: (r.company as string) ?? null,
  summary: String(r.summary),
  link: (r.link as string) ?? null,
  recipients: Number(r.recipients),
  occurredAt: Number(r.occurred_at),
  createdAt: Number(r.created_at),
  digestAt: num(r.digest_at),
});

export class MysqlAdminAlertStore implements AdminAlertStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}
  async insert(r: NewAlertLog) {
    try {
      const [res] = (await this.pool.query(
        "INSERT INTO admin_alert_log (alert_id, event_key, severity, status, tenant_id, company_id, company, summary, link, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.alertId, r.eventKey.slice(0, 190), r.severity, r.status, r.tenantId, r.companyId, r.company?.slice(0, 160) ?? null, r.summary.slice(0, 400), r.link?.slice(0, 300) ?? null, r.occurredAt, r.createdAt],
      )) as unknown as [{ insertId: number }];
      return Number(res.insertId);
    } catch (e) {
      // Hecho ya registrado (clave única): idempotencia, no es un error
      if ((e as { errno?: number }).errno === 1062) return null;
      throw e;
    }
  }
  async finish(id: number, status: LogStatus, recipients: number) {
    await this.pool.query("UPDATE admin_alert_log SET status = ?, recipients = ? WHERE id = ?", [status, recipients, id]);
  }
  async lastSent(alertId: string, groupKey: string | null, since: number) {
    const [rows] = (await this.pool.query(
      `SELECT * FROM admin_alert_log WHERE alert_id = ? AND status = 'sent' AND created_at >= ?${groupKey === null ? "" : " AND tenant_id = ?"} ORDER BY id DESC LIMIT 1`,
      groupKey === null ? [alertId, since] : [alertId, since, groupKey],
    )) as unknown as [Record<string, unknown>[]];
    return rows[0] ? row(rows[0]) : null;
  }
  async countSince(alertId: string, tenantId: string | null, since: number) {
    const [rows] = (await this.pool.query(`SELECT COUNT(*) AS n FROM admin_alert_log WHERE alert_id = ? AND created_at >= ? AND tenant_id ${tenantId === null ? "IS NULL" : "= ?"}`, tenantId === null ? [alertId, since] : [alertId, since, tenantId])) as unknown as [Array<{ n: number }>];
    return Number(rows[0]?.n ?? 0);
  }
  async grouped(limit: number) {
    const [rows] = (await this.pool.query("SELECT * FROM admin_alert_log WHERE status = 'grouped' ORDER BY id LIMIT ?", [limit])) as unknown as [Record<string, unknown>[]];
    return rows.map(row);
  }
  async markDigested(ids: number[], at: number) {
    if (!ids.length) return;
    await this.pool.query(`UPDATE admin_alert_log SET status = 'digested', digest_at = ? WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'grouped'`, [at, ...ids]);
  }
  async list(q: AlertLogQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.alertId) (w.push("alert_id = ?"), a.push(q.alertId));
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.tenantId) (w.push("tenant_id = ?"), a.push(q.tenantId));
    if (q.beforeId) (w.push("id < ?"), a.push(q.beforeId));
    const [rows] = (await this.pool.query(`SELECT * FROM admin_alert_log ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...a, Math.min(q.limit ?? 50, MAX)])) as unknown as [Record<string, unknown>[]];
    return rows.map(row);
  }
  async getState(name: string) {
    const [rows] = (await this.pool.query("SELECT value FROM admin_alert_state WHERE name = ?", [name])) as unknown as [Array<{ value: number }>];
    return rows[0] ? Number(rows[0].value) : null;
  }
  async setState(name: string, value: number, now: number) {
    await this.pool.query("INSERT INTO admin_alert_state (name, value, updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)", [name, value, now]);
  }
}

/** ¿Existe la migración 0030? */
export async function adminAlertTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  return pool.query("SELECT 1 FROM admin_alert_state LIMIT 0").then(() => true, () => false);
}
