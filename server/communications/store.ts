/**
 * Persistencia del Centro de envíos (migración 0031): envíos, destinatarios congelados al confirmar y respuestas de la
 * encuesta de soporte. La clave única (envío, huella del correo) impide dos filas —y por tanto dos correos— para la
 * misma persona en un envío; la de la respuesta (ticket) deja una sola valoración por ticket.
 */
import type mysql from "mysql2/promise";
import type { MailStatus } from "../mail/types";

export const SEND_STATUSES = ["draft", "sending", "sent", "cancelled"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];
/** pending: congelado y por enviar · queued: entregado a la bandeja · skipped: no elegible · failed: error al encolar. */
export const RECIPIENT_STATUSES = ["pending", "queued", "skipped", "failed"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
export type RecipientSource = "contact" | "billing" | "ticket";

export interface SendRow {
  id: number;
  templateId: string;
  title: string;
  content: Record<string, unknown>;
  audience: Record<string, unknown>;
  status: SendStatus;
  recipientsCount: number | null;
  eligibleCount: number | null;
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  confirmedBy: string | null;
  confirmedAt: number | null;
  finishedAt: number | null;
}
export type NewSend = Pick<SendRow, "templateId" | "title" | "content" | "audience" | "createdBy" | "createdAt">;
export type SendPatch = Partial<Pick<SendRow, "templateId" | "title" | "content" | "audience" | "status" | "recipientsCount" | "eligibleCount" | "confirmedBy" | "confirmedAt" | "finishedAt">>;

export interface RecipientRow {
  id: number;
  sendId: number;
  recipientKey: string;
  source: RecipientSource;
  contactId: number | null;
  companyId: number | null;
  tenantId: string | null;
  ticketId: number | null;
  label: string | null;
  emailMasked: string | null;
  status: RecipientStatus;
  reason: string | null;
  outboxId: number | null;
  createdAt: number;
  updatedAt: number;
}
export type NewRecipient = Pick<RecipientRow, "recipientKey" | "source" | "contactId" | "companyId" | "tenantId" | "ticketId" | "label" | "emailMasked" | "status" | "reason">;

export interface SurveyResponse {
  id: number;
  ticketId: number;
  tenantId: string | null;
  sendId: number | null;
  rating: number;
  comment: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Recuento por estado del destinatario y estado del correo en la bandeja (null si no llegó a la bandeja). */
export interface StatusBreakdownRow {
  recipientStatus: RecipientStatus;
  mailStatus: MailStatus | null;
  n: number;
}

export interface SendStore {
  create(b: NewSend): Promise<SendRow>;
  get(id: number): Promise<SendRow | null>;
  list(limit: number): Promise<SendRow[]>;
  /** Cambia campos si la versión coincide (y, si se indica, el estado actual); devuelve la fila o null si hubo conflicto. */
  update(id: number, expectedVersion: number, patch: SendPatch, now: number, whenStatus?: SendStatus): Promise<SendRow | null>;
  /** Inserta los destinatarios que falten (los repetidos por la clave única se ignoran). */
  addRecipients(sendId: number, rows: NewRecipient[], now: number): Promise<void>;
  recipients(sendId: number, q: { status?: RecipientStatus; afterId?: number; limit: number }): Promise<RecipientRow[]>;
  setRecipient(id: number, patch: Pick<RecipientRow, "status" | "reason" | "outboxId">, now: number): Promise<void>;
  breakdown(sendId: number): Promise<StatusBreakdownRow[]>;
  /** Tickets que ya recibieron (o tienen en cola) la encuesta en algún envío. */
  surveyedTickets(ticketIds: number[]): Promise<Set<number>>;
  /** Último envío que entregó a la bandeja la encuesta de un ticket. */
  latestSendForTicket(ticketId: number): Promise<number | null>;
  saveResponse(r: Omit<SurveyResponse, "id" | "updatedAt">, now: number): Promise<void>;
  getResponse(ticketId: number): Promise<SurveyResponse | null>;
  responses(sendId: number | null, limit: number): Promise<SurveyResponse[]>;
}

export class MemorySendStore implements SendStore {
  rows: SendRow[] = [];
  recs: RecipientRow[] = [];
  answers: SurveyResponse[] = [];
  /** Estado del correo en la bandeja (en producción, JOIN con `mail_outbox`). */
  constructor(private mailStatus: (outboxId: number) => MailStatus | null = () => null) {}
  async create(b: NewSend) {
    const row: SendRow = { ...structuredClone(b), id: this.rows.length + 1, status: "draft", recipientsCount: null, eligibleCount: null, version: 1, updatedAt: b.createdAt, confirmedBy: null, confirmedAt: null, finishedAt: null };
    this.rows.push(row);
    return structuredClone(row);
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async list(limit: number) {
    return [...this.rows].reverse().slice(0, limit).map((r) => structuredClone(r));
  }
  async update(id: number, v: number, patch: SendPatch, now: number, whenStatus?: SendStatus) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.version !== v || (whenStatus && r.status !== whenStatus)) return null;
    Object.assign(r, structuredClone(patch), { version: r.version + 1, updatedAt: now });
    return structuredClone(r);
  }
  async addRecipients(sendId: number, rows: NewRecipient[], now: number) {
    for (const x of rows) {
      if (this.recs.some((r) => r.sendId === sendId && r.recipientKey === x.recipientKey)) continue;
      this.recs.push({ ...x, id: this.recs.length + 1, sendId, outboxId: null, createdAt: now, updatedAt: now });
    }
  }
  async recipients(sendId: number, q: { status?: RecipientStatus; afterId?: number; limit: number }) {
    return this.recs.filter((r) => r.sendId === sendId && (!q.status || r.status === q.status) && r.id > (q.afterId ?? 0)).slice(0, q.limit).map((r) => ({ ...r }));
  }
  async setRecipient(id: number, patch: Pick<RecipientRow, "status" | "reason" | "outboxId">, now: number) {
    const r = this.recs.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { updatedAt: now });
  }
  async breakdown(sendId: number) {
    const m = new Map<string, StatusBreakdownRow>();
    for (const r of this.recs.filter((x) => x.sendId === sendId)) {
      const mailStatus = r.outboxId ? this.mailStatus(r.outboxId) : null;
      const k = `${r.status}:${mailStatus}`;
      const cur = m.get(k) ?? { recipientStatus: r.status, mailStatus, n: 0 };
      cur.n++;
      m.set(k, cur);
    }
    return Array.from(m.values());
  }
  async surveyedTickets(ids: number[]) {
    return new Set(this.recs.filter((r) => r.ticketId !== null && ids.includes(r.ticketId) && r.status !== "skipped" && r.status !== "failed").map((r) => r.ticketId!));
  }
  async latestSendForTicket(ticketId: number) {
    const r = [...this.recs].reverse().find((x) => x.ticketId === ticketId && x.status === "queued");
    return r ? r.sendId : null;
  }
  async saveResponse(x: Omit<SurveyResponse, "id" | "updatedAt">, now: number) {
    const cur =this.answers.find((a) => a.ticketId === x.ticketId);
    if (cur) Object.assign(cur, { rating: x.rating, comment: x.comment, updatedAt: now });
    else this.answers.push({ ...x, id: this.answers.length + 1, updatedAt: now });
  }
  async getResponse(ticketId: number) {
    const a = this.answers.find((x) => x.ticketId === ticketId);
    return a ? { ...a } : null;
  }
  async responses(sendId: number | null, limit: number) {
    return this.answers.filter((a) => sendId === null || a.sendId === sendId).reverse().slice(0, limit).map((a) => ({ ...a }));
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? {}));
const sendFromRow = (r: any): SendRow => ({
  id: Number(r.id),
  templateId: r.template_id,
  title: r.title,
  content: json(r.content_json),
  audience: json(r.audience_json),
  status: r.status as SendStatus,
  recipientsCount: num(r.recipients_count),
  eligibleCount: num(r.eligible_count),
  version: Number(r.version),
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  confirmedBy: r.confirmed_by ?? null,
  confirmedAt: num(r.confirmed_at),
  finishedAt: num(r.finished_at),
});
const recipientFromRow = (r: any): RecipientRow => ({
  id: Number(r.id),
  sendId: Number(r.send_id),
  recipientKey: r.recipient_key,
  source: r.source as RecipientSource,
  contactId: num(r.contact_id),
  companyId: num(r.company_id),
  tenantId: r.tenant_id ?? null,
  ticketId: num(r.ticket_id),
  label: r.label ?? null,
  emailMasked: r.email_masked ?? null,
  status: r.status as RecipientStatus,
  reason: r.reason ?? null,
  outboxId: num(r.outbox_id),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const responseFromRow = (r: any): SurveyResponse => ({ id: Number(r.id), ticketId: Number(r.ticket_id), tenantId: r.tenant_id ?? null, sendId: num(r.send_id), rating: Number(r.rating), comment: r.comment ?? null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });

const COLUMN: Record<keyof SendPatch, string> = {
  templateId: "template_id",
  title: "title",
  content: "content_json",
  audience: "audience_json",
  status: "status",
  recipientsCount: "recipients_count",
  eligibleCount: "eligible_count",
  confirmedBy: "confirmed_by",
  confirmedAt: "confirmed_at",
  finishedAt: "finished_at",
};

export class MysqlSendStore implements SendStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}
  async create(b: NewSend) {
    const [r] = (await this.pool.query("INSERT INTO comm_sends (template_id, title, content_json, audience_json, status, version, created_by, created_at, updated_at) VALUES (?,?,?,?, 'draft', 1, ?,?,?)", [
      b.templateId,
      b.title,
      JSON.stringify(b.content),
      JSON.stringify(b.audience),
      b.createdBy.slice(0, 120),
      b.createdAt,
      b.createdAt,
    ])) as unknown as [mysql.ResultSetHeader];
    return (await this.get(r.insertId))!;
  }
  async get(id: number) {
    const [rows] = (await this.pool.query("SELECT * FROM comm_sends WHERE id = ?", [id])) as unknown as [any[]];
    return rows[0] ? sendFromRow(rows[0]) : null;
  }
  async list(limit: number) {
    const [rows] = (await this.pool.query("SELECT * FROM comm_sends ORDER BY id DESC LIMIT ?", [Math.min(200, Math.max(1, limit))])) as unknown as [any[]];
    return rows.map(sendFromRow);
  }
  async update(id: number, v: number, patch: SendPatch, now: number, whenStatus?: SendStatus) {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, val] of Object.entries(patch) as Array<[keyof SendPatch, unknown]>) {
      if (val === undefined) continue;
      sets.push(`${COLUMN[k]} = ?`);
      args.push(k === "content" || k === "audience" ? JSON.stringify(val) : val);
    }
    sets.push("version = version + 1", "updated_at = ?");
    args.push(now, id, v);
    let sql = `UPDATE comm_sends SET ${sets.join(", ")} WHERE id = ? AND version = ?`;
    if (whenStatus) (sql += " AND status = ?"), args.push(whenStatus);
    const [r] = (await this.pool.query(sql, args)) as unknown as [mysql.ResultSetHeader];
    return r.affectedRows === 1 ? this.get(id) : null;
  }
  async addRecipients(sendId: number, rows: NewRecipient[], now: number) {
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      if (!part.length) continue;
      await this.pool.query(
        `INSERT IGNORE INTO comm_send_recipients (send_id, recipient_key, source, contact_id, company_id, tenant_id, ticket_id, label, email_masked, status, reason, created_at, updated_at) VALUES ${part.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        part.flatMap((x) => [sendId, x.recipientKey, x.source, x.contactId, x.companyId, x.tenantId, x.ticketId, x.label?.slice(0, 200) ?? null, x.emailMasked?.slice(0, 200) ?? null, x.status, x.reason, now, now]),
      );
    }
  }
  async recipients(sendId: number, q: { status?: RecipientStatus; afterId?: number; limit: number }) {
    const args: unknown[] = [sendId, q.afterId ?? 0];
    let sql = "SELECT * FROM comm_send_recipients WHERE send_id = ? AND id > ?";
    if (q.status) (sql += " AND status = ?"), args.push(q.status);
    sql += " ORDER BY id LIMIT ?";
    args.push(Math.min(500, Math.max(1, q.limit)));
    const [rows] = (await this.pool.query(sql, args)) as unknown as [any[]];
    return rows.map(recipientFromRow);
  }
  async setRecipient(id: number, p: Pick<RecipientRow, "status" | "reason" | "outboxId">, now: number) {
    await this.pool.query("UPDATE comm_send_recipients SET status = ?, reason = ?, outbox_id = ?, updated_at = ? WHERE id = ?", [p.status, p.reason?.slice(0, 64) ?? null, p.outboxId, now, id]);
  }
  async breakdown(sendId: number) {
    // La bandeja de la plataforma vive en la misma base del CRM (migración 0011): su estado lo actualizan los webhooks
    const [rows] = (await this.pool.query(
      "SELECT r.status AS rs, o.status AS os, COUNT(*) AS n FROM comm_send_recipients r LEFT JOIN mail_outbox o ON o.id = r.outbox_id WHERE r.send_id = ? GROUP BY r.status, o.status",
      [sendId],
    )) as unknown as [any[]];
    return rows.map((r) => ({ recipientStatus: r.rs as RecipientStatus, mailStatus: (r.os ?? null) as MailStatus | null, n: Number(r.n) }));
  }
  async surveyedTickets(ids: number[]) {
    const out = new Set<number>();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      if (!part.length) continue;
      const [rows] = (await this.pool.query(`SELECT DISTINCT ticket_id FROM comm_send_recipients WHERE ticket_id IN (${part.map(() => "?").join(",")}) AND status IN ('pending','queued')`, part)) as unknown as [any[]];
      for (const r of rows) out.add(Number(r.ticket_id));
    }
    return out;
  }
  async latestSendForTicket(ticketId: number) {
    const [rows] = (await this.pool.query("SELECT send_id FROM comm_send_recipients WHERE ticket_id = ? AND status = 'queued' ORDER BY id DESC LIMIT 1", [ticketId])) as unknown as [any[]];
    return rows[0] ? Number(rows[0].send_id) : null;
  }
  async saveResponse(x: Omit<SurveyResponse, "id" | "updatedAt">, now: number) {
    await this.pool.query(
      "INSERT INTO comm_survey_responses (ticket_id, tenant_id, send_id, rating, comment, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = VALUES(updated_at)",
      [x.ticketId, x.tenantId, x.sendId, x.rating, x.comment?.slice(0, 2000) ?? null, x.createdAt, now],
    );
  }
  async getResponse(ticketId: number) {
    const [rows] = (await this.pool.query("SELECT * FROM comm_survey_responses WHERE ticket_id = ?", [ticketId])) as unknown as [any[]];
    return rows[0] ? responseFromRow(rows[0]) : null;
  }
  async responses(sendId: number | null, limit: number) {
    const [rows] = (await (sendId === null
      ? this.pool.query("SELECT * FROM comm_survey_responses ORDER BY id DESC LIMIT ?", [Math.min(1000, limit)])
      : this.pool.query("SELECT * FROM comm_survey_responses WHERE send_id = ? ORDER BY id DESC LIMIT ?", [sendId, Math.min(1000, limit)]))) as unknown as [any[]];
    return rows.map(responseFromRow);
  }
}
