/**
 * Cambios de partidas enviados a Stripe (CRM 0018): lo que el servidor PIDIÓ en cada compra (partidas
 * resultantes esperadas, clave de idempotencia, factura del prorrateo) para reconocer después, releyendo
 * Stripe, si el cambio se aplicó (cobrado), sigue pendiente o caducó sin cobro.
 *
 *  - Un pedido, un cambio. Una suscripción, como mucho un cambio `pending` (la BD lo garantiza).
 *  - Las transiciones solo salen de `pending` (aplicado, caducado o fallido son finales). Nunca se borra nada.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeMode } from "./config";
import type { SubscriptionItemsChange } from "./gateway";

export type SubscriptionChangeStatus = "pending" | "applied" | "expired" | "failed";
export interface ExpectedItem {
  priceId: string;
  quantity: number;
}
export interface SubscriptionChange {
  id: number;
  orderId: number;
  companyId: number;
  stripeSubscriptionId: string;
  idempotencyKey: string;
  /** Partidas enviadas a Stripe (operaciones). */
  items: SubscriptionItemsChange["items"];
  /** Partidas que debe tener la suscripción si el cambio se aplica (precio y cantidad). */
  expectedItems: ExpectedItem[];
  status: SubscriptionChangeStatus;
  stripeInvoiceId: string | null;
  amountDueCents: number | null;
  /** Caducidad del cambio pendiente en Stripe (ms). */
  expiresAt: number | null;
  detail: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
export type NewSubscriptionChange = Omit<SubscriptionChange, "id" | "status" | "stripeInvoiceId" | "amountDueCents" | "expiresAt" | "detail" | "updatedAt">;

export class SubscriptionChangeError extends Error {
  constructor(
    public readonly code: "pending_exists" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionChangeError";
  }
}

/** ¿La suscripción tiene exactamente estas partidas (precio y cantidad, sin importar el orden)? */
export function sameItems(a: ExpectedItem[], b: ExpectedItem[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a.map((x) => [x.priceId, x.quantity]));
  return b.every((x) => m.get(x.priceId) === x.quantity);
}

export interface SubscriptionChangeStore {
  readonly mode: StripeMode;
  /** Inserta el cambio o devuelve el del mismo pedido (idempotente). `pending_exists`: otro pendiente en la suscripción. */
  insert(c: NewSubscriptionChange): Promise<{ change: SubscriptionChange; created: boolean }>;
  byOrder(orderId: number): Promise<SubscriptionChange | null>;
  /** Cambios de una suscripción, el más reciente primero. */
  ofSubscription(stripeSubscriptionId: string): Promise<SubscriptionChange[]>;
  pending(limit: number): Promise<SubscriptionChange[]>;
  /** Anota la factura del cambio (sigue pendiente). */
  setInvoice(id: number, p: { stripeInvoiceId: string | null; amountDueCents: number | null; expiresAt: number | null }, now: number): Promise<SubscriptionChange>;
  /** Sale de `pending`. false si ya no estaba pendiente (otra ejecución lo resolvió). */
  resolve(id: number, status: Exclude<SubscriptionChangeStatus, "pending">, detail: string | null, now: number): Promise<boolean>;
}

export class MemorySubscriptionChangeStore implements SubscriptionChangeStore {
  rows: SubscriptionChange[] = [];
  private seq = 0;
  constructor(readonly mode: StripeMode = "test") {}
  private copy = (c: SubscriptionChange): SubscriptionChange => structuredClone(c);
  async insert(c: NewSubscriptionChange) {
    const prev = this.rows.find((x) => x.orderId === c.orderId || x.idempotencyKey === c.idempotencyKey);
    if (prev) {
      if (prev.orderId !== c.orderId || prev.idempotencyKey !== c.idempotencyKey) throw new SubscriptionChangeError("conflict", "Clave o pedido ya usados por otro cambio");
      return { change: this.copy(prev), created: false };
    }
    if (this.rows.some((x) => x.status === "pending" && x.stripeSubscriptionId === c.stripeSubscriptionId)) throw new SubscriptionChangeError("pending_exists", "La suscripción ya tiene un cambio pendiente de cobro");
    const row: SubscriptionChange = { ...structuredClone(c), id: ++this.seq, status: "pending", stripeInvoiceId: null, amountDueCents: null, expiresAt: null, detail: null, updatedAt: c.createdAt };
    this.rows.push(row);
    return { change: this.copy(row), created: true };
  }
  async byOrder(orderId: number) {
    const r = this.rows.find((x) => x.orderId === orderId);
    return r ? this.copy(r) : null;
  }
  async ofSubscription(id: string) {
    return this.rows.filter((x) => x.stripeSubscriptionId === id).sort((a, b) => b.id - a.id).map(this.copy);
  }
  async pending(limit: number) {
    return this.rows.filter((x) => x.status === "pending").slice(0, limit).map(this.copy);
  }
  async setInvoice(id: number, p: { stripeInvoiceId: string | null; amountDueCents: number | null; expiresAt: number | null }, now: number) {
    const r = this.rows.find((x) => x.id === id)!;
    Object.assign(r, p, { updatedAt: now });
    return this.copy(r);
  }
  async resolve(id: number, status: Exclude<SubscriptionChangeStatus, "pending">, detail: string | null, now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== "pending") return false;
    Object.assign(r, { status, detail: detail?.slice(0, 300) ?? null, updatedAt: now });
    return true;
  }
}

type Row = RowDataPacket & Record<string, unknown>;
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

export class MysqlSubscriptionChangeStore implements SubscriptionChangeStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    readonly mode: StripeMode = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private row = (r: Row): SubscriptionChange => ({
    id: Number(r.id),
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    stripeSubscriptionId: String(r.stripe_subscription_id),
    idempotencyKey: String(r.idempotency_key),
    items: json(r.items_json),
    expectedItems: json(r.expected_items_json),
    status: r.status as SubscriptionChangeStatus,
    stripeInvoiceId: (r.stripe_invoice_id as string | null) ?? null,
    amountDueCents: r.amount_due_cents == null ? null : Number(r.amount_due_cents),
    expiresAt: r.expires_at == null ? null : Number(r.expires_at),
    detail: (r.detail as string | null) ?? null,
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });
  private async one(where: string, args: unknown[]) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM stripe_subscription_changes WHERE ${where} AND livemode = ? LIMIT 1`, [...args, this.lm]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async insert(c: NewSubscriptionChange) {
    try {
      await this.pool.query(
        `INSERT INTO stripe_subscription_changes (livemode, order_id, company_id, stripe_subscription_id, idempotency_key, items_json, expected_items_json, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [this.lm, c.orderId, c.companyId, c.stripeSubscriptionId, c.idempotencyKey, JSON.stringify(c.items), JSON.stringify(c.expectedItems), c.createdBy.slice(0, 100), c.createdAt, c.createdAt],
      );
      return { change: (await this.byOrder(c.orderId))!, created: true };
    } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      const prev = (await this.byOrder(c.orderId)) ?? (await this.one("idempotency_key = ?", [c.idempotencyKey]));
      if (prev) {
        if (prev.orderId !== c.orderId || prev.idempotencyKey !== c.idempotencyKey) throw new SubscriptionChangeError("conflict", "Clave o pedido ya usados por otro cambio");
        return { change: prev, created: false };
      }
      throw new SubscriptionChangeError("pending_exists", "La suscripción ya tiene un cambio pendiente de cobro");
    }
  }
  byOrder(orderId: number) {
    return this.one("order_id = ?", [orderId]);
  }
  async ofSubscription(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_subscription_changes WHERE stripe_subscription_id = ? AND livemode = ? ORDER BY id DESC", [id, this.lm]);
    return rows.map(this.row);
  }
  async pending(limit: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_subscription_changes WHERE status = 'pending' AND livemode = ? ORDER BY id LIMIT ?", [this.lm, limit]);
    return rows.map(this.row);
  }
  async setInvoice(id: number, p: { stripeInvoiceId: string | null; amountDueCents: number | null; expiresAt: number | null }, now: number) {
    await this.pool.query("UPDATE stripe_subscription_changes SET stripe_invoice_id = ?, amount_due_cents = ?, expires_at = ?, updated_at = ? WHERE id = ? AND livemode = ?", [p.stripeInvoiceId, p.amountDueCents, p.expiresAt, now, id, this.lm]);
    return (await this.one("id = ?", [id]))!;
  }
  async resolve(id: number, status: Exclude<SubscriptionChangeStatus, "pending">, detail: string | null, now: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE stripe_subscription_changes SET status = ?, detail = ?, updated_at = ? WHERE id = ? AND livemode = ? AND status = 'pending'", [status, detail?.slice(0, 300) ?? null, now, id, this.lm]);
    return r.affectedRows === 1;
  }
}
