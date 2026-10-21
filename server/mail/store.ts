/**
 * Persistencia de la bandeja de salida. El mismo esquema en los dos carriles (migraciones
 * db/migrations/0010_mail_outbox y db/crm/migrations/0011_platform_mail_outbox), así que un único código:
 *  - `MysqlMailStore` sobre un pool mysql2 (el de la empresa o el del CRM comercial).
 *  - `MemoryMailStore` para pruebas unitarias (misma semántica: clave única, reserva, supresiones).
 */
import type mysql from "mysql2/promise";
import type { MailAttachment, MailStatus, OutboxRow } from "./types";

export type NewOutboxRow = Omit<OutboxRow, "id" | "attempts" | "lockedUntil" | "lastError" | "provider" | "providerMessageId" | "updatedAt"> & { provider?: string | null };

export interface SettlePatch {
  status: MailStatus;
  reason?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  lastError?: string | null;
  nextAttemptAt?: number | null;
  /** Borra cuerpo, adjuntos y direcciones completas (estado final de envío). */
  purge?: boolean;
}

export interface MailStore {
  /** Inserta; con la misma (empresa, clave) devuelve la fila existente sin tocarla. */
  insert(row: NewOutboxRow): Promise<{ row: OutboxRow; created: boolean }>;
  get(id: number): Promise<OutboxRow | null>;
  /** Reserva para enviar: pendiente y vencido, o «sending» con el bloqueo caducado. Incrementa intentos. */
  claim(id: number, now: number, lockMs: number): Promise<OutboxRow | null>;
  settle(id: number, patch: SettlePatch, now: number): Promise<void>;
  /** Ids listos para (re)intentar. */
  due(tenantId: string | null, now: number, limit: number): Promise<number[]>;
  /** Mensajes de la empresa (o de un destinatario) creados desde `since`, sin contar los no enviados por política. */
  countSince(tenantId: string, since: number, recipientHash?: string): Promise<number>;
  isSuppressed(tenantId: string, recipientHash: string): Promise<boolean>;
  suppress(tenantId: string, recipientHash: string, reason: string, now: number): Promise<void>;
  /** Evento del historial; `false` si el evento del proveedor ya constaba (no se aplica dos veces). */
  addEvent(e: { outboxId: number; tenantId: string; kind: string; providerEventId: string | null; detail: string | null; at: number }): Promise<boolean>;
  findByMessageId(messageId: string): Promise<OutboxRow | null>;
  /** Cambio de estado por un evento del proveedor, solo si el estado actual es uno de `from`. */
  setStatusIf(id: number, from: MailStatus[], to: MailStatus, reason: string | null, now: number): Promise<boolean>;
}

/**
 * Consulta de la bandeja para la TRAZABILIDAD (solo lectura): qué aviso, a quién (enmascarado), por qué clave de
 * evento, cuándo, en qué estado, con qué error y su historial. Nunca devuelve la dirección completa ni el cuerpo.
 */
export interface LedgerRow {
  id: number;
  tenantId: string;
  /** Plantilla o notificador de origen, deducido de la clave de idempotencia. */
  template: string;
  idempotencyKey: string;
  category: string;
  status: MailStatus;
  reason: string | null;
  recipient: string;
  subject: string;
  provider: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface LedgerEvent {
  kind: string;
  detail: string | null;
  /** Llegó del proveedor (webhook), no de la propia bandeja. */
  fromProvider: boolean;
  at: number;
}
export interface LedgerQuery {
  status?: MailStatus;
  category?: string;
  tenantId?: string;
  template?: string;
  /** Paginación hacia atrás: solo ids menores. */
  beforeId?: number;
  limit?: number;
}
export interface MailLedgerReader {
  list(q: LedgerQuery): Promise<LedgerRow[]>;
  history(id: number): Promise<{ row: LedgerRow; events: LedgerEvent[] } | null>;
}

/** `notif:<plantilla>:v<n>:…` (catálogo) → la plantilla; el resto (`trial:…`, `order:…`) → su notificador. */
export const templateOfKey = (key: string) => (key.startsWith("notif:") ? (key.split(":")[1] ?? "notif") : (key.split(":")[0] ?? key));
const ledgerRow = (r: OutboxRow): LedgerRow => ({
  id: r.id,
  tenantId: r.tenantId,
  template: templateOfKey(r.idempotencyKey),
  idempotencyKey: r.idempotencyKey,
  category: r.category,
  status: r.status,
  reason: r.reason,
  recipient: r.recipientMasked,
  subject: r.subject,
  provider: r.provider,
  attempts: r.attempts,
  lastError: r.lastError,
  nextAttemptAt: r.nextAttemptAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
const ledgerLimit = (n: number | undefined) => Math.min(200, Math.max(1, Math.floor(n ?? 50)));
/** Patrón LIKE de la clave para filtrar por plantilla (con los comodines escapados). */
const templateLike = (t: string) => `${t.includes(".") ? `notif:${t}` : t}:`.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";

const COLS =
  "id, tenant_id, idempotency_key, category, status, reason, recipient_hash, recipient_masked, to_email, cc_json, sender_name, sender_email, reply_to, subject, html_body, text_body, attachments_json, provider, provider_message_id, attempts, next_attempt_at, locked_until, last_error, created_at, updated_at";

const json = <T>(v: unknown, def: T): T => {
  if (v === null || v === undefined) return def;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return def;
    }
  }
  return v as T;
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function fromDb(r: any): OutboxRow {
  return {
    id: Number(r.id),
    tenantId: r.tenant_id,
    idempotencyKey: r.idempotency_key,
    category: r.category,
    status: r.status,
    reason: r.reason ?? null,
    recipientHash: r.recipient_hash,
    recipientMasked: r.recipient_masked,
    toEmail: r.to_email ?? null,
    cc: json<string[]>(r.cc_json, []),
    senderName: r.sender_name,
    senderEmail: r.sender_email,
    replyTo: r.reply_to ?? null,
    subject: r.subject,
    html: r.html_body ?? null,
    text: r.text_body ?? null,
    attachments: json<MailAttachment[]>(r.attachments_json, []),
    provider: r.provider ?? null,
    providerMessageId: r.provider_message_id ?? null,
    attempts: Number(r.attempts),
    nextAttemptAt: num(r.next_attempt_at),
    lockedUntil: num(r.locked_until),
    lastError: r.last_error ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

type Q = Pick<mysql.Pool, "query">;

export class MysqlMailStore implements MailStore, MailLedgerReader {
  constructor(private db: Q) {}

  private async one(where: string, params: unknown[]): Promise<OutboxRow | null> {
    const [rows] = (await this.db.query(`SELECT ${COLS} FROM mail_outbox WHERE ${where} LIMIT 1`, params)) as unknown as [any[]];
    return rows[0] ? fromDb(rows[0]) : null;
  }

  async insert(r: NewOutboxRow) {
    try {
      const [res] = (await this.db.query(
        `INSERT INTO mail_outbox (tenant_id, idempotency_key, category, status, reason, recipient_hash, recipient_masked, to_email, cc_json, sender_name, sender_email, reply_to, subject, html_body, text_body, attachments_json, provider, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          r.tenantId, r.idempotencyKey, r.category, r.status, r.reason, r.recipientHash, r.recipientMasked, r.toEmail,
          r.cc.length ? JSON.stringify(r.cc) : null, r.senderName, r.senderEmail, r.replyTo, r.subject, r.html, r.text,
          r.attachments.length ? JSON.stringify(r.attachments) : null, r.provider ?? null, r.nextAttemptAt, r.createdAt, r.createdAt,
        ],
      )) as unknown as [{ insertId: number }];
      return { row: (await this.get(Number(res.insertId)))!, created: true };
    } catch (e) {
      if ((e as { code?: string })?.code !== "ER_DUP_ENTRY") throw e;
      return { row: (await this.one("tenant_id = ? AND idempotency_key = ?", [r.tenantId, r.idempotencyKey]))!, created: false };
    }
  }

  get(id: number) {
    return this.one("id = ?", [id]);
  }

  async claim(id: number, now: number, lockMs: number) {
    const [res] = (await this.db.query(
      `UPDATE mail_outbox SET status = 'sending', locked_until = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND ((status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'sending' AND locked_until < ?))`,
      [now + lockMs, now, id, now, now],
    )) as unknown as [{ affectedRows: number }];
    return res.affectedRows === 1 ? this.get(id) : null;
  }

  async settle(id: number, p: SettlePatch, now: number) {
    const purge = p.purge ? ", to_email = NULL, cc_json = NULL, html_body = NULL, text_body = NULL, attachments_json = NULL" : "";
    await this.db.query(
      `UPDATE mail_outbox SET status = ?, reason = COALESCE(?, reason), provider = COALESCE(?, provider), provider_message_id = COALESCE(?, provider_message_id),
         last_error = ?, next_attempt_at = ?, locked_until = NULL, updated_at = ?${purge} WHERE id = ?`,
      [p.status, p.reason ?? null, p.provider ?? null, p.providerMessageId ?? null, p.lastError ?? null, p.nextAttemptAt ?? null, now, id],
    );
  }

  async due(tenantId: string | null, now: number, limit: number) {
    const [rows] = (await this.db.query(
      `SELECT id FROM mail_outbox WHERE ((status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'sending' AND locked_until < ?))
       ${tenantId ? "AND tenant_id = ?" : ""} ORDER BY id LIMIT ?`,
      tenantId ? [now, now, tenantId, limit] : [now, now, limit],
    )) as unknown as [{ id: number }[]];
    return rows.map((r) => Number(r.id));
  }

  async countSince(tenantId: string, since: number, recipientHash?: string) {
    const [rows] = (await this.db.query(
      `SELECT COUNT(*) AS n FROM mail_outbox WHERE tenant_id = ? AND created_at >= ? AND status <> 'skipped' ${recipientHash ? "AND recipient_hash = ?" : ""}`,
      recipientHash ? [tenantId, since, recipientHash] : [tenantId, since],
    )) as unknown as [{ n: number }[]];
    return Number(rows[0]?.n ?? 0);
  }

  async isSuppressed(tenantId: string, hash: string) {
    const [rows] = (await this.db.query("SELECT 1 FROM mail_suppressions WHERE tenant_id = ? AND recipient_hash = ? LIMIT 1", [tenantId, hash])) as unknown as [unknown[]];
    return rows.length > 0;
  }

  async suppress(tenantId: string, hash: string, reason: string, now: number) {
    await this.db.query("INSERT IGNORE INTO mail_suppressions (tenant_id, recipient_hash, reason, created_at) VALUES (?, ?, ?, ?)", [tenantId, hash, reason.slice(0, 20), now]);
  }

  async addEvent(e: { outboxId: number; tenantId: string; kind: string; providerEventId: string | null; detail: string | null; at: number }) {
    try {
      await this.db.query("INSERT INTO mail_events (outbox_id, tenant_id, kind, provider_event_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
        e.outboxId, e.tenantId, e.kind.slice(0, 30), e.providerEventId?.slice(0, 200) ?? null, e.detail?.slice(0, 200) ?? null, e.at,
      ]);
      return true;
    } catch (err) {
      if ((err as { code?: string })?.code === "ER_DUP_ENTRY") return false;
      throw err;
    }
  }

  findByMessageId(messageId: string) {
    return this.one("provider_message_id = ?", [messageId]);
  }

  async setStatusIf(id: number, from: MailStatus[], to: MailStatus, reason: string | null, now: number) {
    if (!from.length) return false;
    const [res] = (await this.db.query(`UPDATE mail_outbox SET status = ?, reason = COALESCE(?, reason), updated_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`, [
      to, reason, now, id, ...from,
    ])) as unknown as [{ affectedRows: number }];
    return res.affectedRows === 1;
  }

  // ── Trazabilidad (solo lectura) ──
  async list(q: LedgerQuery): Promise<LedgerRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) (where.push("status = ?"), params.push(q.status));
    if (q.category) (where.push("category = ?"), params.push(q.category));
    if (q.tenantId) (where.push("tenant_id = ?"), params.push(q.tenantId));
    if (q.template) (where.push("idempotency_key LIKE ?"), params.push(templateLike(q.template)));
    if (q.beforeId) (where.push("id < ?"), params.push(q.beforeId));
    const [rows] = (await this.db.query(`SELECT ${COLS} FROM mail_outbox${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [
      ...params,
      ledgerLimit(q.limit),
    ])) as unknown as [any[]];
    return rows.map((r) => ledgerRow(fromDb(r)));
  }

  async history(id: number) {
    const row = await this.get(id);
    if (!row) return null;
    const [ev] = (await this.db.query("SELECT kind, detail, provider_event_id, created_at FROM mail_events WHERE outbox_id = ? AND tenant_id = ? ORDER BY created_at, kind", [
      id,
      row.tenantId,
    ])) as unknown as [any[]];
    return { row: ledgerRow(row), events: ev.map((e) => ({ kind: String(e.kind), detail: e.detail ?? null, fromProvider: e.provider_event_id !== null && e.provider_event_id !== undefined, at: Number(e.created_at) })) };
  }
}

/** Misma semántica en memoria (pruebas unitarias). */
export class MemoryMailStore implements MailStore, MailLedgerReader {
  rows: OutboxRow[] = [];
  events: { outboxId: number; tenantId: string; kind: string; providerEventId: string | null; detail: string | null; at: number }[] = [];
  suppressions = new Map<string, string>();

  async insert(r: NewOutboxRow) {
    const existing = this.rows.find((x) => x.tenantId === r.tenantId && x.idempotencyKey === r.idempotencyKey);
    if (existing) return { row: { ...existing }, created: false };
    const row: OutboxRow = { ...r, id: this.rows.length + 1, attempts: 0, lockedUntil: null, lastError: null, provider: r.provider ?? null, providerMessageId: null, updatedAt: r.createdAt };
    this.rows.push(row);
    return { row: { ...row }, created: true };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async claim(id: number, now: number, lockMs: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    const ok = (r.status === "pending" && (r.nextAttemptAt === null || r.nextAttemptAt <= now)) || (r.status === "sending" && (r.lockedUntil ?? 0) < now);
    if (!ok) return null;
    Object.assign(r, { status: "sending", lockedUntil: now + lockMs, attempts: r.attempts + 1, updatedAt: now });
    return { ...r };
  }
  async settle(id: number, p: SettlePatch, now: number) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, {
      status: p.status,
      reason: p.reason ?? r.reason,
      provider: p.provider ?? r.provider,
      providerMessageId: p.providerMessageId ?? r.providerMessageId,
      lastError: p.lastError ?? null,
      nextAttemptAt: p.nextAttemptAt ?? null,
      lockedUntil: null,
      updatedAt: now,
    });
    if (p.purge) Object.assign(r, { toEmail: null, cc: [], html: null, text: null, attachments: [] });
  }
  async due(tenantId: string | null, now: number, limit: number) {
    return this.rows
      .filter((r) => (!tenantId || r.tenantId === tenantId) && ((r.status === "pending" && (r.nextAttemptAt === null || r.nextAttemptAt <= now)) || (r.status === "sending" && (r.lockedUntil ?? 0) < now)))
      .slice(0, limit)
      .map((r) => r.id);
  }
  async countSince(tenantId: string, since: number, hash?: string) {
    return this.rows.filter((r) => r.tenantId === tenantId && r.createdAt >= since && r.status !== "skipped" && (!hash || r.recipientHash === hash)).length;
  }
  async isSuppressed(tenantId: string, hash: string) {
    return this.suppressions.has(`${tenantId}:${hash}`);
  }
  async suppress(tenantId: string, hash: string, reason: string) {
    if (!this.suppressions.has(`${tenantId}:${hash}`)) this.suppressions.set(`${tenantId}:${hash}`, reason);
  }
  async addEvent(e: { outboxId: number; tenantId: string; kind: string; providerEventId: string | null; detail: string | null; at: number }) {
    if (e.providerEventId && this.events.some((x) => x.providerEventId === e.providerEventId)) return false;
    this.events.push(e);
    return true;
  }
  async findByMessageId(messageId: string) {
    const r = this.rows.find((x) => x.providerMessageId === messageId);
    return r ? { ...r } : null;
  }
  async setStatusIf(id: number, from: MailStatus[], to: MailStatus, reason: string | null, now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || !from.includes(r.status)) return false;
    Object.assign(r, { status: to, reason: reason ?? r.reason, updatedAt: now });
    return true;
  }
  async list(q: LedgerQuery) {
    const prefix = q.template ? `${q.template.includes(".") ? `notif:${q.template}` : q.template}:` : null;
    return this.rows
      .filter((r) => (!q.status || r.status === q.status) && (!q.category || r.category === q.category) && (!q.tenantId || r.tenantId === q.tenantId))
      .filter((r) => (!prefix || r.idempotencyKey.startsWith(prefix)) && (!q.beforeId || r.id < q.beforeId))
      .sort((a, b) => b.id - a.id)
      .slice(0, ledgerLimit(q.limit))
      .map(ledgerRow);
  }
  async history(id: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    const events = this.events
      .filter((e) => e.outboxId === id && e.tenantId === r.tenantId)
      .map((e) => ({ kind: e.kind, detail: e.detail, fromProvider: e.providerEventId !== null, at: e.at }));
    return { row: ledgerRow(r), events };
  }
}
