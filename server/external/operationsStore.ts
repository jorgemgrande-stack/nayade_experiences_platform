/**
 * Almacén MySQL de las operaciones de clientes externos (CRM 0041): operaciones, periodos y su historial. Separado por
 * modo de Stripe (`livemode`) como las suscripciones externas: un entorno de pruebas nunca ve las operaciones de live.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeMode } from "../stripe/config";
import type { ExternalOperation, NewOperation, NewPeriod, OpEvent, OperationStore, OpPatch, OpPeriod, PeriodPatch } from "./operations";
import { ExternalError } from "./types";

type Row = RowDataPacket & Record<string, unknown>;
const json = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const OP_COLS: Array<[keyof ExternalOperation, string, "s" | "n" | "j"]> = [
  ["status", "status", "s"],
  ["title", "title", "s"],
  ["currency", "currency", "s"],
  ["taxRateBp", "tax_rate_bp", "n"],
  ["lines", "lines_json", "j"],
  ["adjustment", "adjustment_json", "j"],
  ["dueDate", "due_date", "s"],
  ["billingDay", "billing_day", "n"],
  ["dueDays", "due_days", "n"],
  ["startPeriod", "start_period", "s"],
  ["capCents", "cap_cents", "n"],
  ["recipientName", "recipient_name", "s"],
  ["recipientEmail", "recipient_email", "s"],
  ["notes", "notes", "s"],
];
const P_COLS: Array<[keyof OpPeriod, string, "s" | "n" | "j" | "b"]> = [
  ["status", "status", "s"],
  ["lines", "lines_json", "j"],
  ["usage", "usage_json", "j"],
  ["baseCents", "base_cents", "n"],
  ["adjustmentCents", "adjustment_cents", "n"],
  ["netCents", "net_cents", "n"],
  ["taxCents", "tax_cents", "n"],
  ["totalCents", "total_cents", "n"],
  ["dueDate", "due_date", "s"],
  ["overCap", "over_cap", "b"],
  ["overCapAuthorized", "over_cap_json", "j"],
  ["chargeId", "charge_id", "n"],
  ["invoiceId", "invoice_id", "n"],
  ["sentAt", "sent_at", "n"],
  ["sentTo", "sent_to", "s"],
];
const read = (t: "s" | "n" | "j" | "b", v: unknown) => (t === "n" ? num(v) : t === "j" ? json(v) : t === "b" ? Number(v) === 1 : str(v));
const write = (t: "s" | "n" | "j" | "b", v: unknown) => (v === undefined || v === null ? null : t === "j" ? JSON.stringify(v) : t === "b" ? (v ? 1 : 0) : v);

export class MysqlOperationStore implements OperationStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    readonly mode: StripeMode = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private op = (r: Row): ExternalOperation => {
    const out: Record<string, unknown> = { id: Number(r.id), companyId: Number(r.company_id), kind: String(r.kind), version: Number(r.version), createdBy: String(r.created_by), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
    for (const [k, c, t] of OP_COLS) out[k] = read(t, r[c]);
    return out as unknown as ExternalOperation;
  };
  private per = (r: Row): OpPeriod => {
    const out: Record<string, unknown> = { id: Number(r.id), operationId: Number(r.operation_id), period: String(r.period), version: Number(r.version), createdBy: String(r.created_by), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
    for (const [k, c, t] of P_COLS) out[k] = read(t, r[c]);
    return out as unknown as OpPeriod;
  };
  async insert(o: NewOperation) {
    const cols = ["livemode", "company_id", "kind", "created_by", "created_at", "updated_at", ...OP_COLS.map(([, c]) => c)];
    const vals = [this.lm, o.companyId, o.kind, o.createdBy, o.createdAt, o.createdAt, ...OP_COLS.map(([k, , t]) => write(t, o[k as keyof NewOperation]))];
    const [r] = await this.pool.query<mysql.ResultSetHeader>(`INSERT INTO external_operations (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
    return (await this.get(r.insertId))!;
  }
  async get(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_operations WHERE id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.op(rows[0]) : null;
  }
  async list(f: { companyId?: number } = {}) {
    const w = ["livemode = ?"];
    const a: unknown[] = [this.lm];
    if (f.companyId !== undefined) (w.push("company_id = ?"), a.push(f.companyId));
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM external_operations WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, a);
    return rows.map(this.op);
  }
  async update(id: number, expectedVersion: number, patch: OpPatch, now: number) {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, c, t] of OP_COLS) if (k in patch) (sets.push(`${c} = ?`), args.push(write(t, (patch as Record<string, unknown>)[k])));
    const [r] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE external_operations SET ${[...sets, "version = version + 1", "updated_at = ?"].join(", ")} WHERE id = ? AND version = ? AND livemode = ?`, [...args, now, id, expectedVersion, this.lm]);
    if (r.affectedRows !== 1) {
      if (!(await this.get(id))) throw new ExternalError("not_found", "Operación no encontrada");
      throw new ExternalError("conflict", "La operación cambió mientras tanto: vuelve a intentarlo");
    }
    return (await this.get(id))!;
  }
  async insertPeriod(p: NewPeriod) {
    const cols = ["operation_id", "period", "created_by", "created_at", "updated_at", ...P_COLS.map(([, c]) => c)];
    const vals = [p.operationId, p.period, p.createdBy, p.createdAt, p.createdAt, ...P_COLS.map(([k, , t]) => write(t, p[k as keyof NewPeriod]))];
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(`INSERT INTO external_operation_periods (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
      return { period: (await this.period(r.insertId))!, created: true };
    } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_operation_periods WHERE operation_id = ? AND period = ?", [p.operationId, p.period]);
      return { period: this.per(rows[0]), created: false };
    }
  }
  async period(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_operation_periods WHERE id = ?", [id]);
    return rows[0] ? this.per(rows[0]) : null;
  }
  async periods(operationId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_operation_periods WHERE operation_id = ? ORDER BY period DESC", [operationId]);
    return rows.map(this.per);
  }
  async updatePeriod(id: number, expectedVersion: number, patch: PeriodPatch, now: number) {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, c, t] of P_COLS) if (k in patch) (sets.push(`${c} = ?`), args.push(write(t, (patch as Record<string, unknown>)[k])));
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE external_operation_periods SET ${[...sets, "version = version + 1", "updated_at = ?"].join(", ")} WHERE id = ? AND version = ?`, [...args, now, id, expectedVersion]);
      if (r.affectedRows !== 1) {
        if (!(await this.period(id))) throw new ExternalError("not_found", "Periodo no encontrado");
        throw new ExternalError("conflict", "El periodo cambió mientras tanto: vuelve a intentarlo");
      }
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ExternalError("conflict", "El cargo ya pertenece a otro periodo");
      throw e;
    }
    return (await this.period(id))!;
  }
  async event(e: Omit<OpEvent, "id">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("INSERT IGNORE INTO external_operation_events (operation_id, kind, ref, detail_json, actor, at) VALUES (?, ?, ?, ?, ?, ?)", [e.operationId, e.kind, e.ref, e.detail ? JSON.stringify(e.detail) : null, e.actor.slice(0, 100), e.at]);
    return { created: r.affectedRows === 1 };
  }
  async events(operationId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_operation_events WHERE operation_id = ? ORDER BY at, id", [operationId]);
    return rows.map((r) => ({ id: Number(r.id), operationId: Number(r.operation_id), kind: String(r.kind), ref: str(r.ref), detail: json(r.detail_json) as Record<string, unknown> | null, actor: String(r.actor), at: Number(r.at) }));
  }
}
