/**
 * Persistencia del orquestador comercial (BD del CRM, migración 0010) + implementación en memoria.
 *
 *  - Alta idempotente por clave; la BD impide un segundo pedido abierto (no terminal) de alta o
 *    conversión por empresa y un segundo cambio en curso por suscripción (columnas generadas únicas).
 *  - Cada cambio exige la versión leída y escribe su evento en la MISMA transacción.
 *  - Pagos idempotentes por clave; cada evento del proveedor se registra una sola vez (clave
 *    primaria) junto con su efecto sobre el pago, todo o nada.
 *  - Con registro de eventos comerciales (migración 0014), cada alta, transición y cambio de pago
 *    escribe además su evento comercial en esa misma transacción.
 */
import type mysql from "mysql2/promise";
import { orderCreated, orderTransition, paymentChanged } from "../commercialEvents/derive";
import type { CommercialEventSink } from "../commercialEvents/types";
import {
  OrderError,
  TERMINAL_STATES,
  PIPELINE,
  type CommercialOrder,
  type OrderEvent,
  type OrderPatch,
  type OrderPayment,
  type OrderState,
  type PaymentEventOutcome,
  type PaymentEventRecord,
  type PaymentStatus,
  PAYMENT_MODES,
} from "./types";

export type NewOrder = Omit<CommercialOrder, "id" | "reference" | "version" | "updatedAt" | "updatedBy">;
export interface OrderEventDraft {
  kind: string;
  detail: Record<string, unknown> | null;
  actor: string;
  at: number;
}
export interface PaymentDecision<T> {
  status?: PaymentStatus;
  providerRef?: string | null;
  outcome: PaymentEventOutcome;
  detail?: string | null;
  result: T;
}
export type PaymentEventResult<T> = { duplicate: true } | { duplicate: false; payment: OrderPayment | null; outcome: PaymentEventOutcome; result: T };

export interface OrderFilter {
  states?: OrderState[];
  companyId?: number;
  subscriptionId?: number;
  trialId?: number;
  limit?: number;
}

export interface OrderStore {
  insert(o: NewOrder): Promise<{ order: CommercialOrder; created: boolean }>;
  get(id: number): Promise<CommercialOrder | null>;
  byKey(key: string): Promise<CommercialOrder | null>;
  list(f?: OrderFilter): Promise<CommercialOrder[]>;
  transition(id: number, expectedVersion: number, patch: OrderPatch, event: OrderEventDraft): Promise<CommercialOrder>;
  events(orderId: number): Promise<OrderEvent[]>;
  insertPayment(p: Omit<OrderPayment, "id">): Promise<{ payment: OrderPayment; created: boolean }>;
  paymentByKey(key: string): Promise<OrderPayment | null>;
  payments(orderId: number): Promise<OrderPayment[]>;
  paymentEvent<T>(e: { providerEventId: string; type: string; paymentKey: string; receivedAt: number }, decide: (p: OrderPayment | null) => PaymentDecision<T>): Promise<PaymentEventResult<T>>;
  paymentEvents(paymentId: number): Promise<PaymentEventRecord[]>;
}

export const orderReference = (id: number, createdAt: number) => `PED-${new Date(createdAt).getUTCFullYear()}-${String(id).padStart(6, "0")}`;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
/** Claves de unicidad «abierta» (mismas reglas que las columnas generadas de la migración 0010). */
const openCompany = (o: Pick<CommercialOrder, "kind" | "state" | "companyId">) => (o.kind !== "change" && !TERMINAL_STATES.has(o.state) ? o.companyId : null);
const pendingChange = (o: Pick<CommercialOrder, "kind" | "state" | "subscriptionId">) => (o.kind === "change" && PIPELINE.includes(o.state) ? o.subscriptionId : null);
/** Actor de los cambios de pago (el origen real, p. ej. Stripe, lo aporta el contexto de la operación). */
const PAYMENT_ACTOR = "system:payments";
const DUP_COMPANY = "La empresa ya tiene un pedido de contratación abierto";
const DUP_CHANGE = "La suscripción ya tiene un cambio en curso";

// ── Memoria ─────────────────────────────────────────────────────────────────────

export class MemoryOrderStore implements OrderStore {
  private orders = new Map<number, CommercialOrder>();
  private evs: OrderEvent[] = [];
  private pays = new Map<number, OrderPayment>();
  private payEvents = new Map<string, PaymentEventRecord>();
  private seq = 0;
  private lock: Promise<unknown> = Promise.resolve();
  /** El registro de eventos se escribe al FINAL de cada operación: si algo antes falla, no se escribe. */
  constructor(private commercialEvents?: CommercialEventSink) {}

  private atomic<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const snap = clone({ o: Array.from(this.orders.entries()), e: this.evs, p: Array.from(this.pays.entries()), pe: Array.from(this.payEvents.entries()), seq: this.seq });
      try {
        return await fn();
      } catch (err) {
        this.orders = new Map(snap.o);
        this.evs = snap.e;
        this.pays = new Map(snap.p);
        this.payEvents = new Map(snap.pe);
        this.seq = snap.seq;
        throw err;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private assertUnique(o: CommercialOrder) {
    for (const x of Array.from(this.orders.values())) {
      if (x.id === o.id) continue;
      const c = openCompany(o);
      if (c !== null && openCompany(x) === c) throw new OrderError("conflict", DUP_COMPANY);
      const s = pendingChange(o);
      if (s !== null && pendingChange(x) === s) throw new OrderError("conflict", DUP_CHANGE);
    }
  }

  insert(o: NewOrder) {
    return this.atomic(async () => {
      const ex = Array.from(this.orders.values()).find((x) => x.idempotencyKey === o.idempotencyKey);
      if (ex) return { order: clone(ex), created: false };
      const id = ++this.seq;
      const full: CommercialOrder = { ...clone(o), id, reference: orderReference(id, o.createdAt), version: 1, updatedAt: null, updatedBy: null };
      this.assertUnique(full);
      this.orders.set(id, full);
      this.evs.push({ id: ++this.seq, orderId: id, kind: "created", fromState: null, toState: full.state, version: 1, detail: { kind: full.kind }, actor: o.createdBy, createdAt: o.createdAt });
      await this.commercialEvents?.append(null, orderCreated(full, o.createdBy, o.createdAt));
      return { order: clone(full), created: true };
    });
  }
  async get(id: number) {
    const o = this.orders.get(id);
    return o ? clone(o) : null;
  }
  async byKey(key: string) {
    const o = Array.from(this.orders.values()).find((x) => x.idempotencyKey === key);
    return o ? clone(o) : null;
  }
  async list(f: OrderFilter = {}) {
    return Array.from(this.orders.values())
      .filter((o) => (!f.states || f.states.includes(o.state)) && (f.companyId === undefined || o.companyId === f.companyId) && (f.subscriptionId === undefined || o.subscriptionId === f.subscriptionId) && (f.trialId === undefined || o.trialId === f.trialId))
      .sort((a, b) => b.id - a.id)
      .slice(0, f.limit ?? 200)
      .map(clone);
  }
  transition(id: number, expectedVersion: number, patch: OrderPatch, e: OrderEventDraft) {
    return this.atomic(async () => {
      const cur = this.orders.get(id);
      if (!cur) throw new OrderError("not_found", "Pedido no encontrado");
      if (cur.version !== expectedVersion) throw new OrderError("conflict", "El pedido cambió mientras tanto; vuelve a leerlo");
      const next: CommercialOrder = { ...cur, ...clone(patch), version: cur.version + 1, updatedAt: e.at, updatedBy: e.actor };
      this.assertUnique(next);
      this.orders.set(id, next);
      this.evs.push({ id: ++this.seq, orderId: id, kind: e.kind, fromState: cur.state, toState: next.state, version: next.version, detail: clone(e.detail), actor: e.actor, createdAt: e.at });
      await this.commercialEvents?.append(null, orderTransition(cur, next, e));
      return clone(next);
    });
  }
  async events(orderId: number) {
    return clone(this.evs.filter((e) => e.orderId === orderId));
  }
  insertPayment(p: Omit<OrderPayment, "id">) {
    if (!PAYMENT_MODES.includes(p.mode)) return Promise.reject(new Error("Modo de pago desconocido"));
    return this.atomic(async () => {
      const ex = Array.from(this.pays.values()).find((x) => x.idempotencyKey === p.idempotencyKey);
      if (ex) return { payment: clone(ex), created: false };
      const full = { ...clone(p), id: ++this.seq };
      this.pays.set(full.id, full);
      await this.commercialEvents?.append(null, paymentChanged(full, null, this.orders.get(p.orderId) ?? null, PAYMENT_ACTOR, p.createdAt));
      return { payment: clone(full), created: true };
    });
  }
  async paymentByKey(key: string) {
    const p = Array.from(this.pays.values()).find((x) => x.idempotencyKey === key);
    return p ? clone(p) : null;
  }
  async payments(orderId: number) {
    return clone(Array.from(this.pays.values()).filter((p) => p.orderId === orderId).sort((a, b) => a.id - b.id));
  }
  paymentEvent<T>(e: { providerEventId: string; type: string; paymentKey: string; receivedAt: number }, decide: (p: OrderPayment | null) => PaymentDecision<T>) {
    return this.atomic(async (): Promise<PaymentEventResult<T>> => {
      if (this.payEvents.has(e.providerEventId)) return { duplicate: true };
      const cur = Array.from(this.pays.values()).find((x) => x.idempotencyKey === e.paymentKey) ?? null;
      const d = decide(cur ? clone(cur) : null);
      let payment = cur;
      if (cur && d.status) {
        payment = { ...cur, status: d.status, providerRef: d.providerRef ?? cur.providerRef, settledAt: d.status === "pending" ? null : e.receivedAt };
        this.pays.set(cur.id, payment);
      }
      this.payEvents.set(e.providerEventId, { providerEventId: e.providerEventId, paymentId: cur?.id ?? null, type: e.type, outcome: d.outcome, detail: d.detail ?? null, receivedAt: e.receivedAt });
      if (cur && payment) await this.commercialEvents?.append(null, paymentChanged(payment, cur.status, this.orders.get(cur.orderId) ?? null, PAYMENT_ACTOR, e.receivedAt));
      return { duplicate: false, payment: payment ? clone(payment) : null, outcome: d.outcome, result: d.result };
    });
  }
  async paymentEvents(paymentId: number) {
    return clone(Array.from(this.payEvents.values()).filter((x) => x.paymentId === paymentId));
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v);
function orderRow(r: Record<string, unknown>): CommercialOrder {
  return {
    id: Number(r.id),
    reference: (r.reference as string) ?? null,
    idempotencyKey: String(r.idempotency_key),
    payloadHash: String(r.payload_hash),
    kind: r.kind as CommercialOrder["kind"],
    state: r.state as OrderState,
    companyId: Number(r.company_id),
    leadRequestId: num(r.lead_request_id),
    trialId: num(r.trial_id),
    previousOrderId: num(r.previous_order_id),
    request: json(r.request_json) as CommercialOrder["request"],
    quote: json(r.quote_json) as CommercialOrder["quote"],
    contractId: num(r.contract_id),
    subscriptionId: num(r.subscription_id),
    tenantId: (r.tenant_id as string) ?? null,
    confirmation: json(r.confirmation_json) as CommercialOrder["confirmation"],
    graceEndsAt: num(r.grace_ends_at),
    attempts: Number(r.attempts),
    lastError: (r.last_error as string) ?? null,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
    updatedAt: num(r.updated_at),
    updatedBy: (r.updated_by as string) ?? null,
  };
}
/** Modo de un pago leído de la BD: solo «test» o «live»; cualquier otro valor se rechaza. */
function modeOf(v: unknown): OrderPayment["mode"] {
  if (!PAYMENT_MODES.includes(v as OrderPayment["mode"])) throw new Error("Modo de pago desconocido en commercial_payments");
  return v as OrderPayment["mode"];
}
function paymentRow(r: Record<string, unknown>): OrderPayment {
  return {
    id: Number(r.id),
    orderId: Number(r.order_id),
    idempotencyKey: String(r.idempotency_key),
    purpose: r.purpose as OrderPayment["purpose"],
    periodStart: num(r.period_start),
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    status: r.status as PaymentStatus,
    provider: String(r.provider),
    mode: modeOf(r.mode),
    providerRef: (r.provider_ref as string) ?? null,
    dueAt: num(r.due_at),
    createdAt: Number(r.created_at),
    settledAt: num(r.settled_at),
  };
}
const PATCH_COLS: Record<keyof OrderPatch, string> = {
  state: "state",
  quote: "quote_json",
  contractId: "contract_id",
  subscriptionId: "subscription_id",
  tenantId: "tenant_id",
  confirmation: "confirmation_json",
  graceEndsAt: "grace_ends_at",
  attempts: "attempts",
  lastError: "last_error",
};
const JSON_COLS = new Set<keyof OrderPatch>(["quote", "confirmation"]);
const dupOf = (e: unknown) => ((e as { code?: string }).code === "ER_DUP_ENTRY" ? (e as Error).message : null);
function uniqueError(e: unknown): never {
  const m = dupOf(e);
  if (m && /uq_order_open_company/.test(m)) throw new OrderError("conflict", DUP_COMPANY);
  if (m && /uq_order_pending_change/.test(m)) throw new OrderError("conflict", DUP_CHANGE);
  throw e;
}

export class MysqlOrderStore implements OrderStore {
  constructor(
    private pool: mysql.Pool,
    /** Registro de eventos comerciales (0014); sin él, todo funciona igual y no se registra nada. */
    private commercialEvents?: CommercialEventSink,
  ) {}

  /** Datos del pedido que acompañan a un evento de pago (leídos en la misma transacción). */
  private async orderOf(c: mysql.PoolConnection, orderId: number) {
    const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE id = ?", [orderId]);
    return r[0] ? orderRow(r[0]) : null;
  }

  private async inTx<T>(fn: (c: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn(c);
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  private async event(c: mysql.PoolConnection, orderId: number, kind: string, from: OrderState | null, to: OrderState, version: number, detail: unknown, actor: string, at: number) {
    await c.query("INSERT INTO commercial_order_events (order_id, kind, from_state, to_state, version, detail_json, actor, created_at) VALUES (?,?,?,?,?,?,?,?)", [
      orderId, kind, from, to, version, detail === null || detail === undefined ? null : JSON.stringify(detail), actor.slice(0, 100), at,
    ]);
  }

  async insert(o: NewOrder) {
    const again = await this.byKey(o.idempotencyKey);
    if (again) return { order: again, created: false };
    try {
      const order = await this.inTx(async (c) => {
        const [res] = await c.query<mysql.ResultSetHeader>(
          `INSERT INTO commercial_orders (idempotency_key, payload_hash, kind, state, company_id, lead_request_id, trial_id, previous_order_id, request_json, quote_json,
             contract_id, subscription_id, tenant_id, confirmation_json, grace_ends_at, attempts, last_error, version, created_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          [
            o.idempotencyKey, o.payloadHash, o.kind, o.state, o.companyId, o.leadRequestId, o.trialId, o.previousOrderId, JSON.stringify(o.request), o.quote ? JSON.stringify(o.quote) : null,
            o.contractId, o.subscriptionId, o.tenantId, o.confirmation ? JSON.stringify(o.confirmation) : null, o.graceEndsAt, o.attempts, o.lastError, o.createdAt, o.createdBy.slice(0, 100),
          ],
        );
        await c.query("UPDATE commercial_orders SET reference = ? WHERE id = ?", [orderReference(res.insertId, o.createdAt), res.insertId]);
        await this.event(c, res.insertId, "created", null, o.state, 1, { kind: o.kind }, o.createdBy, o.createdAt);
        const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE id = ?", [res.insertId]);
        const created = orderRow(r[0]);
        if (this.commercialEvents) await this.commercialEvents.append(c, orderCreated(created, o.createdBy, o.createdAt));
        return created;
      });
      return { order, created: true };
    } catch (e) {
      // Dos altas simultáneas con la misma clave: gana una y la otra devuelve la existente
      if (dupOf(e) && /uq_order_idempotency/.test(dupOf(e)!)) {
        const ex = await this.byKey(o.idempotencyKey);
        if (ex) return { order: ex, created: false };
      }
      return uniqueError(e);
    }
  }
  async get(id: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE id = ?", [id]);
    return r[0] ? orderRow(r[0]) : null;
  }
  async byKey(key: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE idempotency_key = ?", [key]);
    return r[0] ? orderRow(r[0]) : null;
  }
  async list(f: OrderFilter = {}) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (f.states?.length) (w.push(`state IN (${f.states.map(() => "?").join(",")})`), a.push(...f.states));
    if (f.companyId !== undefined) (w.push("company_id = ?"), a.push(f.companyId));
    if (f.subscriptionId !== undefined) (w.push("subscription_id = ?"), a.push(f.subscriptionId));
    if (f.trialId !== undefined) (w.push("trial_id = ?"), a.push(f.trialId));
    const [r] = await this.pool.query<mysql.RowDataPacket[]>(`SELECT * FROM commercial_orders${w.length ? ` WHERE ${w.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...a, Math.min(f.limit ?? 200, 1000)]);
    return r.map(orderRow);
  }
  async transition(id: number, expectedVersion: number, patch: OrderPatch, e: OrderEventDraft) {
    try {
      return await this.inTx(async (c) => {
        const [cur] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE id = ? FOR UPDATE", [id]);
        if (!cur[0]) throw new OrderError("not_found", "Pedido no encontrado");
        const before = orderRow(cur[0]);
        if (before.version !== expectedVersion) throw new OrderError("conflict", "El pedido cambió mientras tanto; vuelve a leerlo");
        const entries = Object.entries(patch) as Array<[keyof OrderPatch, unknown]>;
        const sets = ["version = version + 1", "updated_at = ?", "updated_by = ?", ...entries.map(([k]) => `${PATCH_COLS[k]} = ?`)];
        const args = [e.at, e.actor.slice(0, 100), ...entries.map(([k, v]) => (JSON_COLS.has(k) ? (v === null || v === undefined ? null : JSON.stringify(v)) : v))];
        const [upd] = await c.query<mysql.ResultSetHeader>(`UPDATE commercial_orders SET ${sets.join(", ")} WHERE id = ? AND version = ?`, [...args, id, expectedVersion]);
        if (upd.affectedRows !== 1) throw new OrderError("conflict", "El pedido cambió mientras tanto; vuelve a leerlo");
        const [after] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_orders WHERE id = ?", [id]);
        const next = orderRow(after[0]);
        await this.event(c, id, e.kind, before.state, next.state, next.version, e.detail, e.actor, e.at);
        if (this.commercialEvents) await this.commercialEvents.append(c, orderTransition(before, next, e));
        return next;
      });
    } catch (err) {
      return uniqueError(err);
    }
  }
  async events(orderId: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_order_events WHERE order_id = ? ORDER BY id", [orderId]);
    return r.map((x) => ({
      id: Number(x.id),
      orderId: Number(x.order_id),
      kind: String(x.kind),
      fromState: (x.from_state as OrderState) ?? null,
      toState: x.to_state as OrderState,
      version: Number(x.version),
      detail: json(x.detail_json) as Record<string, unknown> | null,
      actor: String(x.actor),
      createdAt: Number(x.created_at),
    }));
  }
  async insertPayment(p: Omit<OrderPayment, "id">) {
    const again = await this.paymentByKey(p.idempotencyKey);
    if (again) return { payment: again, created: false };
    try {
      const payment = await this.inTx(async (c) => {
        const [res] = await c.query<mysql.ResultSetHeader>(
          `INSERT INTO commercial_payments (order_id, idempotency_key, purpose, period_start, amount_cents, currency, status, provider, mode, provider_ref, due_at, created_at, settled_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p.orderId, p.idempotencyKey, p.purpose, p.periodStart, p.amountCents, p.currency, p.status, p.provider, modeOf(p.mode), p.providerRef, p.dueAt, p.createdAt, p.settledAt],
        );
        const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_payments WHERE id = ?", [res.insertId]);
        const created = paymentRow(r[0]);
        if (this.commercialEvents) await this.commercialEvents.append(c, paymentChanged(created, null, await this.orderOf(c, created.orderId), PAYMENT_ACTOR, created.createdAt));
        return created;
      });
      return { payment, created: true };
    } catch (e) {
      if (dupOf(e) && /uq_payment_key/.test(dupOf(e)!)) {
        const ex = await this.paymentByKey(p.idempotencyKey);
        if (ex) return { payment: ex, created: false };
      }
      throw e;
    }
  }
  async paymentByKey(key: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_payments WHERE idempotency_key = ?", [key]);
    return r[0] ? paymentRow(r[0]) : null;
  }
  async payments(orderId: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_payments WHERE order_id = ? ORDER BY id", [orderId]);
    return r.map(paymentRow);
  }
  async paymentEvent<T>(e: { providerEventId: string; type: string; paymentKey: string; receivedAt: number }, decide: (p: OrderPayment | null) => PaymentDecision<T>): Promise<PaymentEventResult<T>> {
    try {
      return await this.inTx(async (c) => {
        // La clave primaria del evento decide: un duplicado (también simultáneo) choca aquí
        await c.query("INSERT INTO commercial_payment_events (provider_event_id, type, outcome, received_at) VALUES (?,?, 'ignored', ?)", [e.providerEventId, e.type.slice(0, 40), e.receivedAt]);
        const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_payments WHERE idempotency_key = ? FOR UPDATE", [e.paymentKey]);
        const cur = r[0] ? paymentRow(r[0]) : null;
        const d = decide(cur);
        let payment = cur;
        if (cur && d.status) {
          await c.query("UPDATE commercial_payments SET status = ?, provider_ref = ?, settled_at = ? WHERE id = ?", [d.status, d.providerRef ?? cur.providerRef, d.status === "pending" ? null : e.receivedAt, cur.id]);
          payment = { ...cur, status: d.status, providerRef: d.providerRef ?? cur.providerRef, settledAt: d.status === "pending" ? null : e.receivedAt };
        }
        await c.query("UPDATE commercial_payment_events SET payment_id = ?, outcome = ?, detail = ? WHERE provider_event_id = ?", [cur?.id ?? null, d.outcome, d.detail?.slice(0, 200) ?? null, e.providerEventId]);
        if (cur && payment && payment.status !== cur.status && this.commercialEvents) await this.commercialEvents.append(c, paymentChanged(payment, cur.status, await this.orderOf(c, cur.orderId), PAYMENT_ACTOR, e.receivedAt));
        return { duplicate: false as const, payment, outcome: d.outcome, result: d.result };
      });
    } catch (err) {
      if (dupOf(err) && /PRIMARY/.test(dupOf(err)!)) return { duplicate: true };
      throw err;
    }
  }
  async paymentEvents(paymentId: number) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM commercial_payment_events WHERE payment_id = ? ORDER BY received_at", [paymentId]);
    return r.map((x) => ({ providerEventId: String(x.provider_event_id), paymentId: num(x.payment_id), type: String(x.type), outcome: x.outcome as PaymentEventOutcome, detail: (x.detail as string) ?? null, receivedAt: Number(x.received_at) }));
  }
}
