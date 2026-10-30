/**
 * Solicitudes de derechos de protección de datos (RGPD: acceso, portabilidad o exportación, supresión, rectificación,
 * oposición o limitación) de clientes o contactos (CRM 0034). Una fila por solicitud con su plazo legal de respuesta.
 * Sin documentos ni datos de identidad más allá del nombre y el correo de quien la presenta.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";

export const DATA_REQUEST_KINDS = ["access", "export", "erasure", "rectification", "objection"] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];
export const DATA_REQUEST_STATUSES = ["received", "in_progress", "resolved", "rejected"] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];
export const DATA_REQUEST_CHANNELS = ["email", "web", "phone", "post", "crm"] as const;
export type DataRequestChannel = (typeof DATA_REQUEST_CHANNELS)[number];
export const OPEN_STATUSES: readonly DataRequestStatus[] = ["received", "in_progress"];

export const KIND_LABEL: Record<DataRequestKind, string> = {
  access: "acceso a los datos",
  export: "exportación (portabilidad) de los datos",
  erasure: "supresión de los datos",
  rectification: "rectificación de los datos",
  objection: "oposición o limitación del tratamiento",
};

export interface DataRequest {
  id: number;
  reference: string;
  kind: DataRequestKind;
  status: DataRequestStatus;
  channel: DataRequestChannel;
  requesterName: string;
  requesterEmail: string;
  companyId: number | null;
  tenantId: string | null;
  details: string | null;
  receivedAt: number;
  /** Plazo legal de respuesta (30 días desde la recepción). */
  dueAt: number;
  resolvedAt: number | null;
  resolution: string | null;
  createdBy: string;
  updatedAt: number;
}
export type NewDataRequest = Omit<DataRequest, "id" | "reference" | "resolvedAt" | "resolution">;

export interface DataRequestStore {
  create(r: NewDataRequest): Promise<DataRequest>;
  get(id: number): Promise<DataRequest | null>;
  list(q: { status?: DataRequestStatus; open?: boolean; limit?: number }): Promise<DataRequest[]>;
  /** Cambia el estado si sigue en `from` (concurrencia); null si ya no lo estaba. */
  setStatus(id: number, from: DataRequestStatus, to: DataRequestStatus, o: { resolvedAt: number | null; resolution: string | null; updatedAt: number }): Promise<DataRequest | null>;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReference(now: number): string {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  return `RGPD-${d}-${Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

const MAX = 200;

export class MemoryDataRequestStore implements DataRequestStore {
  rows: DataRequest[] = [];
  async create(r: NewDataRequest) {
    const row: DataRequest = { ...r, id: this.rows.length + 1, reference: newReference(r.receivedAt), resolvedAt: null, resolution: null };
    this.rows.push(row);
    return { ...row };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async list(q: { status?: DataRequestStatus; open?: boolean; limit?: number }) {
    return this.rows
      .filter((x) => (!q.status || x.status === q.status) && (!q.open || OPEN_STATUSES.includes(x.status)))
      .sort((a, b) => b.id - a.id)
      .slice(0, Math.min(q.limit ?? 50, MAX))
      .map((x) => ({ ...x }));
  }
  async setStatus(id: number, from: DataRequestStatus, to: DataRequestStatus, o: { resolvedAt: number | null; resolution: string | null; updatedAt: number }) {
    const r = this.rows.find((x) => x.id === id && x.status === from);
    if (!r) return null;
    Object.assign(r, { status: to, ...o });
    return { ...r };
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const row = (r: Record<string, unknown>): DataRequest => ({
  id: Number(r.id),
  reference: String(r.reference),
  kind: r.kind as DataRequestKind,
  status: r.status as DataRequestStatus,
  channel: r.channel as DataRequestChannel,
  requesterName: String(r.requester_name),
  requesterEmail: String(r.requester_email),
  companyId: num(r.company_id),
  tenantId: (r.tenant_id as string) ?? null,
  details: (r.details as string) ?? null,
  receivedAt: Number(r.received_at),
  dueAt: Number(r.due_at),
  resolvedAt: num(r.resolved_at),
  resolution: (r.resolution as string) ?? null,
  createdBy: String(r.created_by),
  updatedAt: Number(r.updated_at),
});

export class MysqlDataRequestStore implements DataRequestStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}
  async create(r: NewDataRequest) {
    const reference = newReference(r.receivedAt);
    const [res] = (await this.pool.query(
      "INSERT INTO data_requests (reference, kind, status, channel, requester_name, requester_email, company_id, tenant_id, details, received_at, due_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [reference, r.kind, r.status, r.channel, r.requesterName, r.requesterEmail, r.companyId, r.tenantId, r.details, r.receivedAt, r.dueAt, r.createdBy, r.updatedAt],
    )) as unknown as [{ insertId: number }];
    return (await this.get(Number(res.insertId)))!;
  }
  async get(id: number) {
    const [rows] = (await this.pool.query("SELECT * FROM data_requests WHERE id = ?", [id])) as unknown as [Record<string, unknown>[]];
    return rows[0] ? row(rows[0]) : null;
  }
  async list(q: { status?: DataRequestStatus; open?: boolean; limit?: number }) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.open) w.push(`status IN (${OPEN_STATUSES.map(() => "?").join(",")})`), a.push(...OPEN_STATUSES);
    const [rows] = (await this.pool.query(`SELECT * FROM data_requests ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...a, Math.min(q.limit ?? 50, MAX)])) as unknown as [Record<string, unknown>[]];
    return rows.map(row);
  }
  async setStatus(id: number, from: DataRequestStatus, to: DataRequestStatus, o: { resolvedAt: number | null; resolution: string | null; updatedAt: number }) {
    const [res] = (await this.pool.query("UPDATE data_requests SET status = ?, resolved_at = ?, resolution = ?, updated_at = ? WHERE id = ? AND status = ?", [to, o.resolvedAt, o.resolution, o.updatedAt, id, from])) as unknown as [{ affectedRows: number }];
    return res.affectedRows ? this.get(id) : null;
  }
}

/** ¿Existe la migración 0034? */
export async function dataRequestTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  return pool.query("SELECT 1 FROM data_requests LIMIT 0").then(() => true, () => false);
}
