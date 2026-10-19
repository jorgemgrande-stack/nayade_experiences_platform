/**
 * Registro de eventos comerciales: escritura dentro de la transacción de quien llama y lectura filtrada.
 *
 *  - Duplicados: `uq_commercial_event_key`. Un hecho repetido (reintento, evento duplicado de Stripe,
 *    dos réplicas) no añade fila ni deshace la transacción: `ON DUPLICATE KEY UPDATE id = id`.
 *  - Entorno: cada fila lleva el entorno de este registro; las lecturas solo ven el suyo. Al montarlo,
 *    `checkEnvironment` impide usarlo sobre una BD con filas del otro entorno.
 *  - Sin la tabla (migración 0015 sin aplicar) el registro no se monta y los almacenes funcionan igual.
 */
import type mysql from "mysql2/promise";
import { currentCause, sourceOfActor } from "./context";
import {
  COMMERCIAL_EVENT_SCHEMA_VERSION,
  type CommercialEnvironment,
  type CommercialEvent,
  type CommercialEventDraft,
  type CommercialEventFilter,
  type CommercialEventSink,
  type SqlTx,
} from "./types";

export interface CommercialEventReader {
  list(f: CommercialEventFilter): Promise<CommercialEvent[]>;
}

const MAX_LIMIT = 1000;
const cut = (s: string | null, n: number) => (s === null ? null : s.slice(0, n));

/** Completa el borrador con entorno, origen y causa (del contexto en curso o del actor). */
function complete(d: CommercialEventDraft, environment: CommercialEnvironment): Omit<CommercialEvent, "id"> {
  const cause = currentCause();
  return {
    ...d,
    key: d.key.slice(0, 160),
    actor: d.actor.slice(0, 100),
    schemaVersion: COMMERCIAL_EVENT_SCHEMA_VERSION,
    environment,
    source: cause?.source ?? sourceOfActor(d.actor),
    causationId: cause?.causationId ?? null,
    dispatchStatus: "pending",
  };
}

function matches(e: CommercialEvent, f: CommercialEventFilter) {
  return (
    (f.correlationId === undefined || e.correlationId === f.correlationId) &&
    (f.tenantId === undefined || e.tenantId === f.tenantId) &&
    (f.companyId === undefined || e.companyId === f.companyId) &&
    (f.orderId === undefined || e.orderId === f.orderId) &&
    (f.subscriptionId === undefined || e.subscriptionId === f.subscriptionId) &&
    (f.trialId === undefined || e.trialId === f.trialId) &&
    (!f.types?.length || f.types.includes(e.type)) &&
    (f.afterId === undefined || e.id > f.afterId)
  );
}

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

export class MemoryCommercialEventLog implements CommercialEventSink, CommercialEventReader {
  private rows: CommercialEvent[] = [];
  private seq = 0;
  constructor(readonly environment: CommercialEnvironment = "test") {}

  async append(_tx: SqlTx | null, drafts: CommercialEventDraft[]) {
    let written = 0;
    let duplicates = 0;
    for (const d of drafts) {
      const e = complete(d, this.environment);
      if (this.rows.some((x) => x.key === e.key)) {
        duplicates++;
        continue;
      }
      this.rows.push(JSON.parse(JSON.stringify({ ...e, id: ++this.seq })));
      written++;
    }
    return { written, duplicates };
  }
  async list(f: CommercialEventFilter = {}) {
    return this.rows
      .filter((e) => e.environment === this.environment && matches(e, f))
      .slice(0, Math.min(f.limit ?? 200, MAX_LIMIT))
      .map((e) => JSON.parse(JSON.stringify(e)) as CommercialEvent);
  }
  /** Solo pruebas: todas las filas, de cualquier entorno. */
  all() {
    return this.rows.map((e) => ({ ...e }));
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────

const INSERT = `INSERT INTO commercial_events (event_key, type, schema_version, environment, source, actor, tenant_id, company_id, correlation_id, causation_id,
  aggregate_type, aggregate_id, aggregate_version, order_id, subscription_id, trial_id, payment_id, stripe_ref, from_state, to_state, data_json, occurred_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id = id`;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function eventRow(r: Record<string, unknown>): CommercialEvent {
  const data = r.data_json === null || r.data_json === undefined ? {} : typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json;
  return {
    id: Number(r.id),
    key: String(r.event_key),
    type: r.type as CommercialEvent["type"],
    schemaVersion: Number(r.schema_version),
    environment: r.environment as CommercialEnvironment,
    source: r.source as CommercialEvent["source"],
    actor: String(r.actor),
    tenantId: (r.tenant_id as string) ?? null,
    companyId: num(r.company_id),
    correlationId: String(r.correlation_id),
    causationId: (r.causation_id as string) ?? null,
    aggregate: { type: r.aggregate_type as CommercialEvent["aggregate"]["type"], id: String(r.aggregate_id), version: num(r.aggregate_version) },
    orderId: num(r.order_id),
    subscriptionId: num(r.subscription_id),
    trialId: num(r.trial_id),
    paymentId: num(r.payment_id),
    stripeRef: (r.stripe_ref as string) ?? null,
    fromState: (r.from_state as string) ?? null,
    toState: (r.to_state as string) ?? null,
    data: data as CommercialEvent["data"],
    occurredAt: Number(r.occurred_at),
    dispatchStatus: r.dispatch_status as CommercialEvent["dispatchStatus"],
  };
}

export class MysqlCommercialEventLog implements CommercialEventSink, CommercialEventReader {
  constructor(
    private pool: mysql.Pool,
    readonly environment: CommercialEnvironment,
  ) {}

  /** Escribe en la transacción del almacén (o, sin ella, en una sentencia propia). */
  async append(tx: SqlTx | null, drafts: CommercialEventDraft[]) {
    const q: SqlTx = tx ?? { query: (sql, values) => this.pool.query(sql, values) };
    let written = 0;
    let duplicates = 0;
    for (const d of drafts) {
      const e = complete(d, this.environment);
      const [res] = (await q.query(INSERT, [
        e.key, e.type, e.schemaVersion, e.environment, e.source, e.actor, cut(e.tenantId, 63), e.companyId, e.correlationId.slice(0, 40), e.causationId,
        e.aggregate.type, e.aggregate.id.slice(0, 80), e.aggregate.version, e.orderId, e.subscriptionId, e.trialId, e.paymentId, cut(e.stripeRef, 120),
        cut(e.fromState, 30), cut(e.toState, 30), JSON.stringify(e.data ?? {}), e.occurredAt,
      ])) as [mysql.ResultSetHeader];
      // affectedRows: 1 = nueva; 0 = ya existía (ON DUPLICATE KEY UPDATE sin cambios)
      if (res.affectedRows === 1) written++;
      else duplicates++;
    }
    return { written, duplicates };
  }

  async list(f: CommercialEventFilter = {}) {
    const w = ["environment = ?"];
    const a: unknown[] = [this.environment];
    if (f.correlationId !== undefined) (w.push("correlation_id = ?"), a.push(f.correlationId));
    if (f.tenantId !== undefined) (w.push("tenant_id = ?"), a.push(f.tenantId));
    if (f.companyId !== undefined) (w.push("company_id = ?"), a.push(f.companyId));
    if (f.orderId !== undefined) (w.push("order_id = ?"), a.push(f.orderId));
    if (f.subscriptionId !== undefined) (w.push("subscription_id = ?"), a.push(f.subscriptionId));
    if (f.trialId !== undefined) (w.push("trial_id = ?"), a.push(f.trialId));
    if (f.types?.length) (w.push(`type IN (${f.types.map(() => "?").join(",")})`), a.push(...f.types));
    if (f.afterId !== undefined) (w.push("id > ?"), a.push(f.afterId));
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT * FROM commercial_events WHERE ${w.join(" AND ")} ORDER BY id LIMIT ?`, [...a, Math.min(f.limit ?? 200, MAX_LIMIT)]);
    return rows.map(eventRow);
  }
}

/**
 * ¿Se puede montar el registro en esta BD? `missing_table` si falta la migración 0015;
 * `environment_mismatch` si ya hay filas de otro entorno (p. ej. una BD de pruebas apuntada desde live).
 */
export async function commercialEventsProblem(pool: mysql.Pool, environment: CommercialEnvironment): Promise<null | "missing_table" | "environment_mismatch"> {
  const ok = await pool.query("SELECT 1 FROM commercial_events LIMIT 0").then(() => true, () => false);
  if (!ok) return "missing_table";
  const [r] = await pool.query<mysql.RowDataPacket[]>("SELECT 1 FROM commercial_events WHERE environment <> ? LIMIT 1", [environment]);
  return r.length ? "environment_mismatch" : null;
}
