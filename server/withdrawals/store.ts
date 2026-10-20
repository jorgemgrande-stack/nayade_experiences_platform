/**
 * Registro auditable de las solicitudes de desistimiento (CRM 0022): la solicitud con su evaluación, su estado y
 * su resolución, y un historial con cada paso (quién, qué y cuándo). Una solicitud abierta como mucho por
 * contrato; la misma petición repetida (clave de idempotencia) devuelve la misma solicitud.
 */
import type mysql from "mysql2/promise";
import type { WithdrawalAssessment } from "./assessment";

export const WITHDRAWAL_STATES = ["received", "under_review", "accepted", "rejected", "completed"] as const;
export type WithdrawalState = (typeof WITHDRAWAL_STATES)[number];
export const OPEN_STATES: readonly WithdrawalState[] = ["received", "under_review", "accepted"];

export interface WithdrawalResolution {
  note: string;
  /** Referencia del reembolso o de la baja ejecutados a mano (al completar). */
  refundReference: string | null;
  decidedBy: string;
  decidedAt: number;
}

export interface WithdrawalRequest {
  id: number;
  /** Referencia del justificante (DS-AAAAMMDD-XXXXXX). */
  reference: string;
  idempotencyKey: string;
  /** Pedido vigente al pedirlo y pedido del contrato (alta o conversión) del que se desiste. */
  orderId: number;
  contractOrderId: number;
  companyId: number;
  tenantId: string | null;
  channel: "platform" | "support";
  requestedBy: string;
  contactEmail: string;
  statement: string | null;
  requestedAt: number;
  assessment: WithdrawalAssessment;
  status: WithdrawalState;
  resolution: WithdrawalResolution | null;
  receiptSentAt: number | null;
  version: number;
  updatedAt: number;
}

export interface WithdrawalEvent {
  withdrawalId: number;
  action: string;
  fromStatus: WithdrawalState | null;
  toStatus: WithdrawalState;
  actor: string;
  note: string | null;
  at: number;
}

export type WithdrawalDraft = Omit<WithdrawalRequest, "id" | "status" | "resolution" | "receiptSentAt" | "version" | "updatedAt">;

export class WithdrawalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalConflictError";
  }
}

export interface WithdrawalStore {
  /** Crea la solicitud (o devuelve la de la misma clave). Si el contrato ya tiene una abierta, conflicto. */
  create(d: WithdrawalDraft, actor: string): Promise<{ request: WithdrawalRequest; created: boolean }>;
  get(id: number): Promise<WithdrawalRequest | null>;
  list(f?: { status?: WithdrawalState; limit?: number }): Promise<WithdrawalRequest[]>;
  ofContract(contractOrderId: number): Promise<WithdrawalRequest[]>;
  /** Cambio de estado con versión optimista y su evento, en una transacción. */
  transition(id: number, expectedVersion: number, to: WithdrawalState, resolution: WithdrawalResolution | null, ev: { action: string; actor: string; note: string | null; at: number }): Promise<WithdrawalRequest>;
  markReceiptSent(id: number, at: number): Promise<void>;
  events(id: number): Promise<WithdrawalEvent[]>;
}

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

export class MemoryWithdrawalStore implements WithdrawalStore {
  rows: WithdrawalRequest[] = [];
  evs: WithdrawalEvent[] = [];
  async create(d: WithdrawalDraft, actor: string) {
    const same = this.rows.find((r) => r.idempotencyKey === d.idempotencyKey);
    if (same) return { request: structuredClone(same), created: false };
    if (this.rows.some((r) => r.contractOrderId === d.contractOrderId && OPEN_STATES.includes(r.status))) throw new WithdrawalConflictError("Ya hay una solicitud de desistimiento abierta para este contrato");
    const r: WithdrawalRequest = { ...structuredClone(d), id: this.rows.length + 1, status: "received", resolution: null, receiptSentAt: null, version: 1, updatedAt: d.requestedAt };
    this.rows.push(r);
    this.evs.push({ withdrawalId: r.id, action: "requested", fromStatus: null, toStatus: "received", actor, note: null, at: d.requestedAt });
    return { request: structuredClone(r), created: true };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async list(f: { status?: WithdrawalState; limit?: number } = {}) {
    return this.rows.filter((r) => !f.status || r.status === f.status).sort((a, b) => b.id - a.id).slice(0, f.limit ?? 100).map((r) => structuredClone(r));
  }
  async ofContract(contractOrderId: number) {
    return this.rows.filter((r) => r.contractOrderId === contractOrderId).sort((a, b) => b.id - a.id).map((r) => structuredClone(r));
  }
  async transition(id: number, expectedVersion: number, to: WithdrawalState, resolution: WithdrawalResolution | null, ev: { action: string; actor: string; note: string | null; at: number }) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.version !== expectedVersion) throw new WithdrawalConflictError("La solicitud ha cambiado: vuelve a cargarla");
    this.evs.push({ withdrawalId: id, action: ev.action, fromStatus: r.status, toStatus: to, actor: ev.actor, note: ev.note, at: ev.at });
    Object.assign(r, { status: to, resolution: resolution ?? r.resolution, version: r.version + 1, updatedAt: ev.at });
    return structuredClone(r);
  }
  async markReceiptSent(id: number, at: number) {
    const r = this.rows.find((x) => x.id === id);
    if (r && !r.receiptSentAt) r.receiptSentAt = at;
  }
  async events(id: number) {
    return this.evs.filter((e) => e.withdrawalId === id).map((e) => structuredClone(e));
  }
}

// ── MySQL (BD del CRM) ───────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

export class MysqlWithdrawalStore implements WithdrawalStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private row = (r: Row): WithdrawalRequest => ({
    id: Number(r.id),
    reference: String(r.reference),
    idempotencyKey: String(r.idempotency_key),
    orderId: Number(r.order_id),
    contractOrderId: Number(r.contract_order_id),
    companyId: Number(r.company_id),
    tenantId: (r.tenant_id as string | null) ?? null,
    channel: r.channel as WithdrawalRequest["channel"],
    requestedBy: String(r.requested_by),
    contactEmail: String(r.contact_email),
    statement: (r.statement as string | null) ?? null,
    requestedAt: Number(r.requested_at),
    assessment: parse<WithdrawalAssessment>(r.assessment_json),
    status: r.status as WithdrawalState,
    resolution: r.resolution_json ? parse<WithdrawalResolution>(r.resolution_json) : null,
    receiptSentAt: r.receipt_sent_at === null ? null : Number(r.receipt_sent_at),
    version: Number(r.version),
    updatedAt: Number(r.updated_at),
  });
  private async byKey(key: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM consumer_withdrawals WHERE livemode = ? AND idempotency_key = ?", [this.lm, key]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async create(d: WithdrawalDraft, actor: string) {
    const prev = await this.byKey(d.idempotencyKey);
    if (prev) return { request: prev, created: false };
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.query<mysql.ResultSetHeader>(
        "INSERT INTO consumer_withdrawals (livemode, reference, idempotency_key, order_id, contract_order_id, company_id, tenant_id, channel, requested_by, contact_email, statement, requested_at, deadline_at, within_term, assessment_json, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 1, ?)",
        [this.lm, d.reference, d.idempotencyKey, d.orderId, d.contractOrderId, d.companyId, d.tenantId, d.channel, d.requestedBy.slice(0, 120), d.contactEmail.slice(0, 200), d.statement?.slice(0, 1000) ?? null, d.requestedAt, d.assessment.deadlineAt, d.assessment.withinTerm ? 1 : 0, JSON.stringify(d.assessment), d.requestedAt],
      );
      await conn.query("INSERT INTO consumer_withdrawal_events (withdrawal_id, action, from_status, to_status, actor, note, at) VALUES (?, 'requested', NULL, 'received', ?, NULL, ?)", [res.insertId, actor.slice(0, 120), d.requestedAt]);
      await conn.commit();
      return { request: (await this.get(res.insertId))!, created: true };
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (isDup(e)) {
        const again = await this.byKey(d.idempotencyKey);
        if (again) return { request: again, created: false };
        throw new WithdrawalConflictError("Ya hay una solicitud de desistimiento abierta para este contrato");
      }
      throw e;
    } finally {
      conn.release();
    }
  }
  async get(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM consumer_withdrawals WHERE id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async list(f: { status?: WithdrawalState; limit?: number } = {}) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM consumer_withdrawals WHERE livemode = ?${f.status ? " AND status = ?" : ""} ORDER BY id DESC LIMIT ?`, [this.lm, ...(f.status ? [f.status] : []), Math.min(f.limit ?? 100, 500)]);
    return rows.map(this.row);
  }
  async ofContract(contractOrderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM consumer_withdrawals WHERE livemode = ? AND contract_order_id = ? ORDER BY id DESC", [this.lm, contractOrderId]);
    return rows.map(this.row);
  }
  async transition(id: number, expectedVersion: number, to: WithdrawalState, resolution: WithdrawalResolution | null, ev: { action: string; actor: string; note: string | null; at: number }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [cur] = await conn.query<Row[]>("SELECT status, version FROM consumer_withdrawals WHERE id = ? AND livemode = ? FOR UPDATE", [id, this.lm]);
      if (!cur[0] || Number(cur[0].version) !== expectedVersion) throw new WithdrawalConflictError("La solicitud ha cambiado: vuelve a cargarla");
      await conn.query(`UPDATE consumer_withdrawals SET status = ?, version = version + 1, updated_at = ?${resolution ? ", resolution_json = ?" : ""} WHERE id = ?`, [to, ev.at, ...(resolution ? [JSON.stringify(resolution)] : []), id]);
      await conn.query("INSERT INTO consumer_withdrawal_events (withdrawal_id, action, from_status, to_status, actor, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, ev.action, cur[0].status, to, ev.actor.slice(0, 120), ev.note?.slice(0, 1000) ?? null, ev.at]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
    return (await this.get(id))!;
  }
  async markReceiptSent(id: number, at: number) {
    await this.pool.query("UPDATE consumer_withdrawals SET receipt_sent_at = COALESCE(receipt_sent_at, ?) WHERE id = ? AND livemode = ?", [at, id, this.lm]);
  }
  async events(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM consumer_withdrawal_events WHERE withdrawal_id = ? ORDER BY id", [id]);
    return rows.map((r) => ({ withdrawalId: Number(r.withdrawal_id), action: String(r.action), fromStatus: (r.from_status as WithdrawalState | null) ?? null, toStatus: r.to_status as WithdrawalState, actor: String(r.actor), note: (r.note as string | null) ?? null, at: Number(r.at) }));
  }
}
