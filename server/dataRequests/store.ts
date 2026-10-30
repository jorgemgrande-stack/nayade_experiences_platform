/**
 * Solicitudes de derechos de protección de datos (RGPD: acceso, portabilidad o exportación, supresión, rectificación,
 * oposición o limitación) de clientes o contactos (CRM 0032). Una fila por solicitud con su plazo legal de respuesta y
 * su responsable, más el historial de lo que se ha hecho con ella (`data_request_events`, solo se añaden filas).
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
export const DATA_REQUEST_EVENT_TYPES = ["created", "status_changed", "assigned", "note", "resolved", "escalated"] as const;
export type DataRequestEventType = (typeof DATA_REQUEST_EVENT_TYPES)[number];
/** Plazo: `overdue` vencidas sin resolver; `due_soon` abiertas a las que les quedan `warnMs` o menos. */
export const DEADLINE_FILTERS = ["overdue", "due_soon"] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

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
  /** Responsable asignado: identificador del operador (su usuario) y nombre visible en el momento de asignarlo. */
  assigneeId: string | null;
  assigneeName: string | null;
  resolvedAt: number | null;
  resolution: string | null;
  createdBy: string;
  updatedAt: number;
}
export type NewDataRequest = Omit<DataRequest, "id" | "reference" | "resolvedAt" | "resolution" | "assigneeId" | "assigneeName">;

export interface DataRequestEvent {
  id: number;
  requestId: number;
  at: number;
  actor: string;
  type: DataRequestEventType;
  detail: string | null;
}
export type NewDataRequestEvent = Omit<DataRequestEvent, "id">;

export interface DataRequestQuery {
  status?: DataRequestStatus;
  kind?: DataRequestKind;
  open?: boolean;
  /** Identificador del responsable; `null` = sin asignar. */
  assigneeId?: string | null;
  deadline?: DeadlineFilter;
  /** Momento de referencia y margen para el filtro de plazo. */
  now?: number;
  warnMs?: number;
  limit?: number;
}

export interface DataRequestStore {
  create(r: NewDataRequest): Promise<DataRequest>;
  get(id: number): Promise<DataRequest | null>;
  list(q: DataRequestQuery): Promise<DataRequest[]>;
  /** Cambia el estado si sigue en `from` (concurrencia); null si ya no lo estaba. */
  setStatus(id: number, from: DataRequestStatus, to: DataRequestStatus, o: { resolvedAt: number | null; resolution: string | null; updatedAt: number }): Promise<DataRequest | null>;
  /** Asigna (o retira, con null) el responsable. */
  setAssignee(id: number, a: { id: string; name: string } | null, updatedAt: number): Promise<DataRequest | null>;
  addEvent(e: NewDataRequestEvent): Promise<DataRequestEvent>;
  /** Historial de una solicitud en orden cronológico. */
  events(requestId: number): Promise<DataRequestEvent[]>;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReference(now: number): string {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  return `RGPD-${d}-${Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

const MAX = 200;

/** ¿Cumple la solicitud el filtro de plazo? (pura; mismo criterio que la consulta MySQL) */
export function matchesDeadline(r: Pick<DataRequest, "status" | "dueAt">, f: DeadlineFilter, now: number, warnMs: number): boolean {
  if (!OPEN_STATUSES.includes(r.status)) return false;
  return f === "overdue" ? r.dueAt <= now : r.dueAt > now && r.dueAt <= now + warnMs;
}

export class MemoryDataRequestStore implements DataRequestStore {
  rows: DataRequest[] = [];
  eventRows: DataRequestEvent[] = [];
  async create(r: NewDataRequest) {
    const row: DataRequest = { ...r, id: this.rows.length + 1, reference: newReference(r.receivedAt), assigneeId: null, assigneeName: null, resolvedAt: null, resolution: null };
    this.rows.push(row);
    return { ...row };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async list(q: DataRequestQuery) {
    const now = q.now ?? Date.now();
    return this.rows
      .filter(
        (x) =>
          (!q.status || x.status === q.status) &&
          (!q.kind || x.kind === q.kind) &&
          (!q.open || OPEN_STATUSES.includes(x.status)) &&
          (q.assigneeId === undefined || x.assigneeId === q.assigneeId) &&
          (!q.deadline || matchesDeadline(x, q.deadline, now, q.warnMs ?? 0)),
      )
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
  async setAssignee(id: number, a: { id: string; name: string } | null, updatedAt: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, { assigneeId: a?.id ?? null, assigneeName: a?.name ?? null, updatedAt });
    return { ...r };
  }
  async addEvent(e: NewDataRequestEvent) {
    const row: DataRequestEvent = { ...e, id: this.eventRows.length + 1 };
    this.eventRows.push(row);
    return { ...row };
  }
  async events(requestId: number) {
    return this.eventRows.filter((e) => e.requestId === requestId).sort((a, b) => a.id - b.id).map((e) => ({ ...e }));
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const row = (r: Record<string, unknown>): DataRequest => ({
  id: Number(r.id),
  reference: String(r.reference),
  kind: r.kind as DataRequestKind,
  status: r.status as DataRequestStatus,
  channel: r.channel as DataRequestChannel,
  requesterName: String(r.requester_name),
  requesterEmail: String(r.requester_email),
  companyId: num(r.company_id),
  tenantId: str(r.tenant_id),
  details: str(r.details),
  receivedAt: Number(r.received_at),
  dueAt: Number(r.due_at),
  assigneeId: str(r.assignee_id),
  assigneeName: str(r.assignee_name),
  resolvedAt: num(r.resolved_at),
  resolution: str(r.resolution),
  createdBy: String(r.created_by),
  updatedAt: Number(r.updated_at),
});
const eventRow = (r: Record<string, unknown>): DataRequestEvent => ({
  id: Number(r.id),
  requestId: Number(r.request_id),
  at: Number(r.at),
  actor: String(r.actor),
  type: r.type as DataRequestEventType,
  detail: str(r.detail),
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
  async list(q: DataRequestQuery) {
    const w: string[] = [];
    const a: unknown[] = [];
    const openIn = `status IN (${OPEN_STATUSES.map(() => "?").join(",")})`;
    if (q.status) (w.push("status = ?"), a.push(q.status));
    if (q.kind) (w.push("kind = ?"), a.push(q.kind));
    if (q.open) (w.push(openIn), a.push(...OPEN_STATUSES));
    if (q.assigneeId === null) w.push("assignee_id IS NULL");
    else if (q.assigneeId !== undefined) (w.push("assignee_id = ?"), a.push(q.assigneeId));
    if (q.deadline) {
      const now = q.now ?? Date.now();
      w.push(openIn);
      a.push(...OPEN_STATUSES);
      if (q.deadline === "overdue") (w.push("due_at <= ?"), a.push(now));
      else (w.push("due_at > ? AND due_at <= ?"), a.push(now, now + (q.warnMs ?? 0)));
    }
    const [rows] = (await this.pool.query(`SELECT * FROM data_requests ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...a, Math.min(q.limit ?? 50, MAX)])) as unknown as [Record<string, unknown>[]];
    return rows.map(row);
  }
  async setStatus(id: number, from: DataRequestStatus, to: DataRequestStatus, o: { resolvedAt: number | null; resolution: string | null; updatedAt: number }) {
    const [res] = (await this.pool.query("UPDATE data_requests SET status = ?, resolved_at = ?, resolution = ?, updated_at = ? WHERE id = ? AND status = ?", [to, o.resolvedAt, o.resolution, o.updatedAt, id, from])) as unknown as [{ affectedRows: number }];
    return res.affectedRows ? this.get(id) : null;
  }
  async setAssignee(id: number, a: { id: string; name: string } | null, updatedAt: number) {
    const [res] = (await this.pool.query("UPDATE data_requests SET assignee_id = ?, assignee_name = ?, updated_at = ? WHERE id = ?", [a?.id ?? null, a?.name ?? null, updatedAt, id])) as unknown as [{ affectedRows: number }];
    return res.affectedRows ? this.get(id) : null;
  }
  async addEvent(e: NewDataRequestEvent) {
    const [res] = (await this.pool.query("INSERT INTO data_request_events (request_id, at, actor, type, detail) VALUES (?,?,?,?,?)", [e.requestId, e.at, e.actor, e.type, e.detail])) as unknown as [{ insertId: number }];
    return { ...e, id: Number(res.insertId) };
  }
  async events(requestId: number) {
    const [rows] = (await this.pool.query("SELECT * FROM data_request_events WHERE request_id = ? ORDER BY id", [requestId])) as unknown as [Record<string, unknown>[]];
    return rows.map(eventRow);
  }
}

/** ¿Existe la migración 0032 (solicitudes e historial)? */
export async function dataRequestTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  return pool.query("SELECT 1 FROM data_requests LIMIT 0").then(
    () => pool.query("SELECT 1 FROM data_request_events LIMIT 0").then(() => true, () => false),
    () => false,
  );
}
