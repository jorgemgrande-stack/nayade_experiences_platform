/**
 * Persistencia de suscripciones (BD del CRM, migración 0006) + implementación en memoria.
 *
 * Toda mutación pasa por `mutate()`: una transacción que bloquea la suscripción (FOR UPDATE),
 * comprueba la versión esperada (dos operadores no se pisan), aplica los cambios de partidas,
 * actualiza la suscripción, sube la versión y escribe el evento del historial. Si algo falla, no
 * queda nada a medias.
 */
import type mysql from "mysql2/promise";
import {
  SubscriptionError,
  type ChargeStatus,
  type EventKind,
  type PaymentStatus,
  type ShadowCharge,
  type ShadowInvoice,
  type Subscription,
  type SubscriptionEvent,
  type SubscriptionItem,
  type UsageRecord,
} from "./types";

export type NewSubscription = Omit<Subscription, "id" | "reference" | "version" | "updatedAt" | "updatedBy">;
export type NewItem = Omit<SubscriptionItem, "id" | "subscriptionId">;
export type SubscriptionPatch = Partial<
  Pick<Subscription, "status" | "pendingInterval" | "interval" | "anchorDay" | "currentPeriodStart" | "currentPeriodEnd" | "trialEnd" | "cancelAt" | "canceledAt" | "tenantId" | "contractId">
>;
export interface EventDraft {
  kind: EventKind;
  before: unknown;
  after: unknown;
  reason: string | null;
}
export interface SubscriptionTx {
  items(): Promise<SubscriptionItem[]>;
  insertItem(i: NewItem): Promise<SubscriptionItem>;
  /** Cierra una partida (solo fija effective_to; el importe es inmutable). */
  endItem(itemId: number, effectiveTo: number): Promise<void>;
}
export interface MutationOutcome<T> {
  patch: SubscriptionPatch;
  event: EventDraft;
  result: T;
}

export interface ChargeTx {
  invoice: ShadowInvoice;
  charges: ShadowCharge[];
  insertCharge(c: Omit<ShadowCharge, "id">): Promise<ShadowCharge>;
  updateCharge(id: number, patch: Partial<Pick<ShadowCharge, "status" | "providerRef" | "error" | "settledAt">>): Promise<void>;
  setPaymentStatus(s: PaymentStatus): Promise<void>;
  subscriptionStatus: Subscription["status"];
}

export interface SubscriptionStore {
  create(sub: NewSubscription, items: NewItem[], event: EventDraft): Promise<Subscription>;
  /** `expectedVersion` null = proceso interno (renovación), igualmente bajo bloqueo. */
  mutate<T>(id: number, expectedVersion: number | null, actor: string, now: number, fn: (tx: SubscriptionTx, sub: Subscription) => Promise<MutationOutcome<T>>): Promise<{ subscription: Subscription; result: T }>;
  get(id: number): Promise<Subscription | null>;
  list(f?: { companyId?: number; status?: Subscription["status"]; limit?: number }): Promise<Subscription[]>;
  items(subscriptionId: number): Promise<SubscriptionItem[]>;
  events(subscriptionId: number): Promise<SubscriptionEvent[]>;
  addUsage(r: Omit<UsageRecord, "id">): Promise<{ record: UsageRecord; created: boolean }>;
  usageTotal(itemId: number, periodStart: number): Promise<number>;
  /** Idempotente por (suscripción, tipo, periodo, concepto): si ya existe, devuelve la existente. */
  recordShadowInvoice(inv: Omit<ShadowInvoice, "id">): Promise<{ invoice: ShadowInvoice; created: boolean }>;
  shadowInvoices(subscriptionId: number): Promise<ShadowInvoice[]>;
  shadowInvoice(id: number): Promise<ShadowInvoice | null>;
  charges(invoiceId: number): Promise<ShadowCharge[]>;
  /** Transacción sobre una factura sombra (bloqueada) para registrar intentos de cobro simulados. */
  chargeTx<T>(invoiceId: number, fn: (tx: ChargeTx) => Promise<T>): Promise<T>;
  /**
   * Webhook simulado: inserta el evento y aplica su efecto en la MISMA transacción. Duplicado ya
   * procesado → "duplicate" sin efecto; si falló antes, se reprocesa.
   */
  webhookTx<T>(eventId: string, now: number, fn: (charges: { byKey(key: string): Promise<{ charge: ShadowCharge; tx: ChargeTx } | null> }) => Promise<T>): Promise<{ status: "processed" | "duplicate"; result?: T }>;
}

export class VersionConflict extends SubscriptionError {
  constructor(current: number) {
    super("version_conflict", `Otra persona modificó la suscripción antes (versión actual ${current}). Recarga para no perder cambios.`, { current });
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const refFor = (id: number, createdAt: number) => `SUB-${new Date(createdAt).getUTCFullYear()}-${String(id).padStart(6, "0")}`;

// ── Memoria (pruebas y desarrollo) ──────────────────────────────────────────────

export class MemorySubscriptionStore implements SubscriptionStore {
  private subs = new Map<number, Subscription>();
  private itemsById = new Map<number, SubscriptionItem>();
  private evs: SubscriptionEvent[] = [];
  private usage: UsageRecord[] = [];
  private invoices = new Map<number, ShadowInvoice>();
  private chargeRows = new Map<number, ShadowCharge>();
  private webhooks = new Map<string, { status: "processing" | "processed" | "failed" }>();
  private seq = 0;
  private lock: Promise<unknown> = Promise.resolve();

  /** Serializa las operaciones y deshace todo si fallan (equivalente a una transacción). */
  private atomic<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const snap = clone({
        subs: Array.from(this.subs.entries()),
        items: Array.from(this.itemsById.entries()),
        evs: this.evs,
        usage: this.usage,
        invoices: Array.from(this.invoices.entries()),
        charges: Array.from(this.chargeRows.entries()),
        webhooks: Array.from(this.webhooks.entries()),
        seq: this.seq,
      });
      try {
        return await fn();
      } catch (e) {
        this.subs = new Map(snap.subs);
        this.itemsById = new Map(snap.items);
        this.evs = snap.evs;
        this.usage = snap.usage;
        this.invoices = new Map(snap.invoices);
        this.chargeRows = new Map(snap.charges);
        this.webhooks = new Map(snap.webhooks);
        this.seq = snap.seq;
        throw e;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private tx(subscriptionId: number): SubscriptionTx {
    return {
      items: async () => clone(Array.from(this.itemsById.values()).filter((i) => i.subscriptionId === subscriptionId)),
      insertItem: async (i) => {
        const full = { ...clone(i), id: ++this.seq, subscriptionId };
        this.itemsById.set(full.id, full);
        return clone(full);
      },
      endItem: async (itemId, to) => {
        const it = this.itemsById.get(itemId);
        if (!it || it.subscriptionId !== subscriptionId) throw new SubscriptionError("not_found", "Partida no encontrada");
        this.itemsById.set(itemId, { ...it, effectiveTo: to });
      },
    };
  }

  create(sub: NewSubscription, items: NewItem[], event: EventDraft) {
    return this.atomic(async () => {
      if (sub.contractId !== null && Array.from(this.subs.values()).some((s) => s.contractId === sub.contractId && s.status !== "canceled")) {
        throw new SubscriptionError("conflict", "El contrato ya tiene una suscripción viva");
      }
      const id = ++this.seq;
      const full: Subscription = { ...clone(sub), id, reference: refFor(id, sub.createdAt), version: 1, updatedAt: null, updatedBy: null };
      this.subs.set(id, full);
      const t = this.tx(id);
      for (const i of items) await t.insertItem(i);
      this.evs.push({ id: ++this.seq, subscriptionId: id, version: 1, actor: sub.createdBy, createdAt: sub.createdAt, ...clone(event) });
      return clone(full);
    });
  }

  mutate<T>(id: number, expectedVersion: number | null, actor: string, now: number, fn: (tx: SubscriptionTx, sub: Subscription) => Promise<MutationOutcome<T>>) {
    return this.atomic(async () => {
      const cur = this.subs.get(id);
      if (!cur) throw new SubscriptionError("not_found", "Suscripción no encontrada");
      if (expectedVersion !== null && cur.version !== expectedVersion) throw new VersionConflict(cur.version);
      const out = await fn(this.tx(id), clone(cur));
      const next: Subscription = { ...cur, ...clone(out.patch), version: cur.version + 1, updatedAt: now, updatedBy: actor };
      if (next.contractId !== null && next.status !== "canceled" && Array.from(this.subs.values()).some((s) => s.id !== id && s.contractId === next.contractId && s.status !== "canceled")) {
        throw new SubscriptionError("conflict", "El contrato ya tiene otra suscripción viva");
      }
      this.subs.set(id, next);
      this.evs.push({ id: ++this.seq, subscriptionId: id, version: next.version, actor, createdAt: now, ...clone(out.event) });
      return { subscription: clone(next), result: out.result };
    });
  }

  async get(id: number) {
    const s = this.subs.get(id);
    return s ? clone(s) : null;
  }
  async list(f: { companyId?: number; status?: Subscription["status"]; limit?: number } = {}) {
    return Array.from(this.subs.values())
      .filter((s) => (f.companyId === undefined || s.companyId === f.companyId) && (!f.status || s.status === f.status))
      .sort((a, b) => b.id - a.id)
      .slice(0, f.limit ?? 200)
      .map(clone);
  }
  async items(subscriptionId: number) {
    return clone(Array.from(this.itemsById.values()).filter((i) => i.subscriptionId === subscriptionId).sort((a, b) => a.id - b.id));
  }
  async events(subscriptionId: number) {
    return clone(this.evs.filter((e) => e.subscriptionId === subscriptionId).sort((a, b) => a.id - b.id));
  }
  addUsage(r: Omit<UsageRecord, "id">) {
    return this.atomic(async () => {
      const ex = this.usage.find((u) => u.idempotencyKey === r.idempotencyKey);
      if (ex) return { record: clone(ex), created: false };
      const rec = { ...clone(r), id: ++this.seq };
      this.usage.push(rec);
      return { record: clone(rec), created: true };
    });
  }
  async usageTotal(itemId: number, periodStart: number) {
    return this.usage.filter((u) => u.itemId === itemId && u.periodStart === periodStart).reduce((a, u) => a + u.quantity, 0);
  }
  recordShadowInvoice(inv: Omit<ShadowInvoice, "id">) {
    return this.atomic(async () => {
      const ex = Array.from(this.invoices.values()).find(
        (i) => i.subscriptionId === inv.subscriptionId && i.kind === inv.kind && i.periodStart === inv.periodStart && i.dedupeKey === inv.dedupeKey,
      );
      if (ex) return { invoice: clone(ex), created: false };
      const full = { ...clone(inv), id: ++this.seq };
      this.invoices.set(full.id, full);
      return { invoice: clone(full), created: true };
    });
  }
  async shadowInvoices(subscriptionId: number) {
    return clone(Array.from(this.invoices.values()).filter((i) => i.subscriptionId === subscriptionId).sort((a, b) => a.periodStart - b.periodStart || a.id - b.id));
  }
  async shadowInvoice(id: number) {
    const i = this.invoices.get(id);
    return i ? clone(i) : null;
  }
  async charges(invoiceId: number) {
    return clone(Array.from(this.chargeRows.values()).filter((c) => c.invoiceId === invoiceId).sort((a, b) => a.attempt - b.attempt));
  }
  private chargeTxFor(invoiceId: number): ChargeTx {
    const inv = this.invoices.get(invoiceId)!;
    return {
      invoice: clone(inv),
      charges: clone(Array.from(this.chargeRows.values()).filter((c) => c.invoiceId === invoiceId).sort((a, b) => a.attempt - b.attempt)),
      subscriptionStatus: this.subs.get(inv.subscriptionId)!.status,
      insertCharge: async (c) => {
        if (Array.from(this.chargeRows.values()).some((x) => x.invoiceId === c.invoiceId && x.attempt === c.attempt)) throw new SubscriptionError("conflict", "Intento duplicado");
        const full = { ...clone(c), id: ++this.seq };
        this.chargeRows.set(full.id, full);
        return clone(full);
      },
      updateCharge: async (id, patch) => {
        this.chargeRows.set(id, { ...this.chargeRows.get(id)!, ...clone(patch) });
      },
      setPaymentStatus: async (s) => {
        this.invoices.set(invoiceId, { ...this.invoices.get(invoiceId)!, paymentStatus: s });
      },
    };
  }
  chargeTx<T>(invoiceId: number, fn: (tx: ChargeTx) => Promise<T>) {
    return this.atomic(async () => {
      if (!this.invoices.has(invoiceId)) throw new SubscriptionError("not_found", "Factura sombra no encontrada");
      return fn(this.chargeTxFor(invoiceId));
    });
  }
  async webhookTx<T>(eventId: string, _now: number, fn: Parameters<SubscriptionStore["webhookTx"]>[2]) {
    try {
      return await this.atomic(async () => {
        const ex = this.webhooks.get(eventId);
        if (ex?.status === "processed") return { status: "duplicate" as const };
        this.webhooks.set(eventId, { status: "processing" });
        const result = (await fn({
          byKey: async (key) => {
            const c = Array.from(this.chargeRows.values()).filter((x) => x.idempotencyKey === key).sort((a, b) => b.attempt - a.attempt)[0];
            return c ? { charge: clone(c), tx: this.chargeTxFor(c.invoiceId) } : null;
          },
        })) as T;
        this.webhooks.set(eventId, { status: "processed" });
        return { status: "processed" as const, result };
      });
    } catch (e) {
      this.webhooks.set(eventId, { status: "failed" });
      throw e;
    }
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

type Q = Pick<mysql.PoolConnection, "query">;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? null));

function subRow(r: Record<string, unknown>): Subscription {
  return {
    id: Number(r.id),
    reference: (r.reference as string) ?? null,
    companyId: Number(r.company_id),
    contractId: num(r.contract_id),
    tenantId: (r.tenant_id as string) ?? null,
    status: r.status as Subscription["status"],
    mode: "shadow",
    currency: String(r.currency),
    interval: r.billing_interval as Subscription["interval"],
    pendingInterval: (r.pending_interval as Subscription["interval"]) ?? null,
    startedAt: Number(r.started_at),
    anchorDay: Number(r.anchor_day),
    currentPeriodStart: Number(r.current_period_start),
    currentPeriodEnd: Number(r.current_period_end),
    trialEnd: num(r.trial_end),
    cancelAt: num(r.cancel_at),
    canceledAt: num(r.canceled_at),
    version: Number(r.version),
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
    updatedAt: num(r.updated_at),
    updatedBy: (r.updated_by as string) ?? null,
  };
}
function itemRow(r: Record<string, unknown>): SubscriptionItem {
  return {
    id: Number(r.id),
    subscriptionId: Number(r.subscription_id),
    family: r.family as SubscriptionItem["family"],
    productKey: String(r.product_key),
    productName: String(r.product_name),
    activationKind: String(r.activation_kind),
    activationRef: (r.activation_ref as string) ?? null,
    priceId: num(r.price_id),
    priceSource: r.price_source as SubscriptionItem["priceSource"],
    priceKind: r.price_kind as SubscriptionItem["priceKind"],
    unitAmountCents: Number(r.unit_amount_cents),
    unit: (r.unit as string) ?? null,
    quantity: Number(r.quantity),
    taxRateBp: Number(r.tax_rate_bp),
    taxIncluded: Number(r.tax_included) === 1,
    discount: r.discount_kind
      ? { kind: r.discount_kind as "percent" | "amount", value: Number(r.discount_value), endsAt: num(r.discount_ends_at), note: (r.discount_note as string) ?? null }
      : null,
    effectiveFrom: Number(r.effective_from),
    effectiveTo: num(r.effective_to),
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
  };
}
function invoiceRow(r: Record<string, unknown>): ShadowInvoice {
  return {
    id: Number(r.id),
    subscriptionId: Number(r.subscription_id),
    kind: r.kind as ShadowInvoice["kind"],
    periodStart: Number(r.period_start),
    periodEnd: Number(r.period_end),
    dedupeKey: String(r.dedupe_key),
    currency: String(r.currency),
    subtotalCents: Number(r.subtotal_cents),
    discountCents: Number(r.discount_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    lines: json(r.lines_json) ?? [],
    inputHash: String(r.input_hash),
    contractAmountCents: num(r.contract_amount_cents),
    contractDiffCents: num(r.contract_diff_cents),
    paymentStatus: r.payment_status as PaymentStatus,
    createdAt: Number(r.created_at),
    createdBy: String(r.created_by),
  };
}
function chargeRow(r: Record<string, unknown>): ShadowCharge {
  return {
    id: Number(r.id),
    invoiceId: Number(r.invoice_id),
    idempotencyKey: String(r.idempotency_key),
    attempt: Number(r.attempt),
    status: r.status as ChargeStatus,
    providerRef: (r.provider_ref as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: Number(r.created_at),
    settledAt: num(r.settled_at),
  };
}

async function insertItemSql(c: Q, subscriptionId: number, i: NewItem): Promise<SubscriptionItem> {
  const [res] = await c.query<mysql.ResultSetHeader>(
    `INSERT INTO subscription_items (subscription_id, family, product_key, product_name, activation_kind, activation_ref, price_id, price_source,
       price_kind, unit_amount_cents, unit, quantity, tax_rate_bp, tax_included, discount_kind, discount_value, discount_ends_at, discount_note,
       effective_from, effective_to, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      subscriptionId, i.family, i.productKey, i.productName, i.activationKind, i.activationRef, i.priceId, i.priceSource,
      i.priceKind, i.unitAmountCents, i.unit, i.quantity, i.taxRateBp, i.taxIncluded ? 1 : 0, i.discount?.kind ?? null, i.discount?.value ?? null,
      i.discount?.endsAt ?? null, i.discount?.note ?? null, i.effectiveFrom, i.effectiveTo, i.createdAt, i.createdBy,
    ],
  );
  const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM subscription_items WHERE id = ?", [res.insertId]);
  return itemRow(rows[0]);
}
async function insertEventSql(c: Q, subscriptionId: number, version: number, e: EventDraft, actor: string, at: number) {
  await c.query(
    "INSERT INTO subscription_events (subscription_id, kind, version, before_json, after_json, reason, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [subscriptionId, e.kind, version, e.before === undefined || e.before === null ? null : JSON.stringify(e.before), e.after === undefined || e.after === null ? null : JSON.stringify(e.after), e.reason, actor, at],
  );
}

const PATCH_COLS: Record<keyof SubscriptionPatch, string> = {
  status: "status",
  pendingInterval: "pending_interval",
  interval: "billing_interval",
  anchorDay: "anchor_day",
  currentPeriodStart: "current_period_start",
  currentPeriodEnd: "current_period_end",
  trialEnd: "trial_end",
  cancelAt: "cancel_at",
  canceledAt: "canceled_at",
  tenantId: "tenant_id",
  contractId: "contract_id",
};

export class MysqlSubscriptionStore implements SubscriptionStore {
  constructor(private pool: mysql.Pool) {}

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

  async create(sub: NewSubscription, items: NewItem[], event: EventDraft) {
    try {
      return await this.inTx(async (c) => {
        const [res] = await c.query<mysql.ResultSetHeader>(
          `INSERT INTO subscriptions (company_id, contract_id, tenant_id, status, mode, currency, billing_interval, pending_interval, started_at, anchor_day,
             current_period_start, current_period_end, trial_end, cancel_at, canceled_at, version, created_at, created_by)
           VALUES (?,?,?,?, 'shadow', ?,?,?,?,?,?,?,?,?,?, 1, ?,?)`,
          [
            sub.companyId, sub.contractId, sub.tenantId, sub.status, sub.currency, sub.interval, sub.pendingInterval, sub.startedAt, sub.anchorDay,
            sub.currentPeriodStart, sub.currentPeriodEnd, sub.trialEnd, sub.cancelAt, sub.canceledAt, sub.createdAt, sub.createdBy,
          ],
        );
        const id = res.insertId;
        // Referencia en la MISMA transacción: nunca queda una suscripción sin referencia
        await c.query("UPDATE subscriptions SET reference = ? WHERE id = ?", [refFor(id, sub.createdAt), id]);
        for (const i of items) await insertItemSql(c, id, i);
        await insertEventSql(c, id, 1, event, sub.createdBy, sub.createdAt);
        const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM subscriptions WHERE id = ?", [id]);
        return subRow(rows[0]);
      });
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY" && /live_contract/.test((e as Error).message)) {
        throw new SubscriptionError("conflict", "El contrato ya tiene una suscripción viva");
      }
      throw e;
    }
  }

  async mutate<T>(id: number, expectedVersion: number | null, actor: string, now: number, fn: (tx: SubscriptionTx, sub: Subscription) => Promise<MutationOutcome<T>>) {
    try {
      return await this.mutateTx(id, expectedVersion, actor, now, fn);
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY" && /live_contract/.test((e as Error).message)) {
        throw new SubscriptionError("conflict", "El contrato ya tiene otra suscripción viva");
      }
      throw e;
    }
  }

  private async mutateTx<T>(id: number, expectedVersion: number | null, actor: string, now: number, fn: (tx: SubscriptionTx, sub: Subscription) => Promise<MutationOutcome<T>>) {
    return this.inTx(async (c) => {
      const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM subscriptions WHERE id = ? FOR UPDATE", [id]);
      if (!rows[0]) throw new SubscriptionError("not_found", "Suscripción no encontrada");
      const cur = subRow(rows[0]);
      if (expectedVersion !== null && cur.version !== expectedVersion) throw new VersionConflict(cur.version);
      const tx: SubscriptionTx = {
        items: async () => {
          const [r] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM subscription_items WHERE subscription_id = ? ORDER BY id FOR UPDATE", [id]);
          return r.map(itemRow);
        },
        insertItem: (i) => insertItemSql(c, id, i),
        endItem: async (itemId, to) => {
          const [r] = await c.query<mysql.ResultSetHeader>("UPDATE subscription_items SET effective_to = ? WHERE id = ? AND subscription_id = ?", [to, itemId, id]);
          if (r.affectedRows !== 1) throw new SubscriptionError("not_found", "Partida no encontrada");
        },
      };
      const out = await fn(tx, cur);
      const sets: string[] = ["version = version + 1", "updated_at = ?", "updated_by = ?"];
      const args: unknown[] = [now, actor];
      for (const [k, v] of Object.entries(out.patch) as Array<[keyof SubscriptionPatch, unknown]>) {
        sets.push(`${PATCH_COLS[k]} = ?`);
        args.push(v);
      }
      const [upd] = await c.query<mysql.ResultSetHeader>(`UPDATE subscriptions SET ${sets.join(", ")} WHERE id = ? AND version = ?`, [...args, id, cur.version]);
      if (upd.affectedRows !== 1) throw new VersionConflict(cur.version);
      await insertEventSql(c, id, cur.version + 1, out.event, actor, now);
      const [after] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM subscriptions WHERE id = ?", [id]);
      return { subscription: subRow(after[0]), result: out.result };
    });
  }

  async get(id: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM subscriptions WHERE id = ?", [id]);
    return rows[0] ? subRow(rows[0]) : null;
  }
  async list(f: { companyId?: number; status?: Subscription["status"]; limit?: number } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.companyId !== undefined) {
      where.push("company_id = ?");
      args.push(f.companyId);
    }
    if (f.status) {
      where.push("status = ?");
      args.push(f.status);
    }
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM subscriptions${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
      [...args, Math.min(f.limit ?? 200, 1000)],
    );
    return rows.map(subRow);
  }
  async items(subscriptionId: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM subscription_items WHERE subscription_id = ? ORDER BY id", [subscriptionId]);
    return rows.map(itemRow);
  }
  async events(subscriptionId: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM subscription_events WHERE subscription_id = ? ORDER BY id", [subscriptionId]);
    return rows.map((r) => ({
      id: Number(r.id),
      subscriptionId: Number(r.subscription_id),
      kind: r.kind as EventKind,
      version: Number(r.version),
      before: json(r.before_json),
      after: json(r.after_json),
      reason: (r.reason as string) ?? null,
      actor: String(r.actor),
      createdAt: Number(r.created_at),
    }));
  }
  async addUsage(r: Omit<UsageRecord, "id">) {
    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(
        "INSERT INTO subscription_usage (item_id, period_start, quantity, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?)",
        [r.itemId, r.periodStart, r.quantity, r.source, r.idempotencyKey, r.createdAt],
      );
      return { record: { ...r, id: res.insertId }, created: true };
    } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM subscription_usage WHERE idempotency_key = ?", [r.idempotencyKey]);
      const x = rows[0];
      return {
        record: { id: Number(x.id), itemId: Number(x.item_id), periodStart: Number(x.period_start), quantity: Number(x.quantity), source: String(x.source), idempotencyKey: String(x.idempotency_key), createdAt: Number(x.created_at) },
        created: false,
      };
    }
  }
  async usageTotal(itemId: number, periodStart: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT COALESCE(SUM(quantity), 0) AS q FROM subscription_usage WHERE item_id = ? AND period_start = ?", [itemId, periodStart]);
    return Number(rows[0].q);
  }
  async recordShadowInvoice(inv: Omit<ShadowInvoice, "id">) {
    const select = async () => {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM shadow_invoices WHERE subscription_id = ? AND kind = ? AND period_start = ? AND dedupe_key = ?",
        [inv.subscriptionId, inv.kind, inv.periodStart, inv.dedupeKey],
      );
      return rows[0] ? invoiceRow(rows[0]) : null;
    };
    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(
        `INSERT INTO shadow_invoices (subscription_id, kind, period_start, period_end, dedupe_key, currency, subtotal_cents, discount_cents, tax_cents,
           total_cents, lines_json, input_hash, contract_amount_cents, contract_diff_cents, payment_status, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          inv.subscriptionId, inv.kind, inv.periodStart, inv.periodEnd, inv.dedupeKey, inv.currency, inv.subtotalCents, inv.discountCents, inv.taxCents,
          inv.totalCents, JSON.stringify(inv.lines), inv.inputHash, inv.contractAmountCents, inv.contractDiffCents, inv.paymentStatus, inv.createdAt, inv.createdBy,
        ],
      );
      return { invoice: (await this.shadowInvoice(res.insertId))!, created: true };
    } catch (e) {
      // La clave única garantiza UNA factura por periodo aunque dos procesos simulen a la vez
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
      return { invoice: (await select())!, created: false };
    }
  }
  async shadowInvoices(subscriptionId: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM shadow_invoices WHERE subscription_id = ? ORDER BY period_start, id", [subscriptionId]);
    return rows.map(invoiceRow);
  }
  async shadowInvoice(id: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM shadow_invoices WHERE id = ?", [id]);
    return rows[0] ? invoiceRow(rows[0]) : null;
  }
  async charges(invoiceId: number) {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM shadow_charges WHERE invoice_id = ? ORDER BY attempt", [invoiceId]);
    return rows.map(chargeRow);
  }
  private async chargeTxOn(c: mysql.PoolConnection, invoiceId: number): Promise<ChargeTx> {
    const [inv] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM shadow_invoices WHERE id = ? FOR UPDATE", [invoiceId]);
    if (!inv[0]) throw new SubscriptionError("not_found", "Factura sombra no encontrada");
    const invoice = invoiceRow(inv[0]);
    const [ch] = await c.query<mysql.RowDataPacket[]>("SELECT * FROM shadow_charges WHERE invoice_id = ? ORDER BY attempt FOR UPDATE", [invoiceId]);
    const [s] = await c.query<mysql.RowDataPacket[]>("SELECT status FROM subscriptions WHERE id = ?", [invoice.subscriptionId]);
    return {
      invoice,
      charges: ch.map(chargeRow),
      subscriptionStatus: s[0].status,
      insertCharge: async (x) => {
        const [res] = await c.query<mysql.ResultSetHeader>(
          "INSERT INTO shadow_charges (invoice_id, idempotency_key, attempt, status, provider_ref, error, created_at, settled_at) VALUES (?,?,?,?,?,?,?,?)",
          [x.invoiceId, x.idempotencyKey, x.attempt, x.status, x.providerRef, x.error, x.createdAt, x.settledAt],
        );
        return { ...x, id: res.insertId };
      },
      updateCharge: async (id, patch) => {
        const cols: Record<string, string> = { status: "status", providerRef: "provider_ref", error: "error", settledAt: "settled_at" };
        const entries = Object.entries(patch);
        if (!entries.length) return;
        await c.query(`UPDATE shadow_charges SET ${entries.map(([k]) => `${cols[k]} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
      },
      setPaymentStatus: async (st) => {
        await c.query("UPDATE shadow_invoices SET payment_status = ? WHERE id = ?", [st, invoiceId]);
      },
    };
  }
  chargeTx<T>(invoiceId: number, fn: (tx: ChargeTx) => Promise<T>) {
    return this.inTx(async (c) => fn(await this.chargeTxOn(c, invoiceId)));
  }
  async webhookTx<T>(eventId: string, now: number, fn: Parameters<SubscriptionStore["webhookTx"]>[2]) {
    try {
      return await this.inTx(async (c) => {
        // Bloquea el evento (o lo crea) dentro de la transacción del efecto
        await c.query("INSERT IGNORE INTO shadow_webhook_events (provider_event_id, status, received_at) VALUES (?, 'processing', ?)", [eventId, now]);
        const [ev] = await c.query<mysql.RowDataPacket[]>("SELECT status FROM shadow_webhook_events WHERE provider_event_id = ? FOR UPDATE", [eventId]);
        if (ev[0].status === "processed") return { status: "duplicate" as const };
        const result = (await fn({
          byKey: async (key) => {
            const [rows] = await c.query<mysql.RowDataPacket[]>("SELECT invoice_id FROM shadow_charges WHERE idempotency_key = ? ORDER BY attempt DESC LIMIT 1", [key]);
            if (!rows[0]) return null;
            const tx = await this.chargeTxOn(c, Number(rows[0].invoice_id));
            const charge = tx.charges.filter((x) => x.idempotencyKey === key).sort((a, b) => b.attempt - a.attempt)[0];
            return { charge, tx };
          },
        })) as T;
        await c.query("UPDATE shadow_webhook_events SET status = 'processed', processed_at = ?, error = NULL WHERE provider_event_id = ?", [now, eventId]);
        return { status: "processed" as const, result };
      });
    } catch (e) {
      // El efecto se deshizo con la transacción; el evento queda «failed» para reprocesarlo
      await this.pool
        .query(
          "INSERT INTO shadow_webhook_events (provider_event_id, status, received_at, error) VALUES (?, 'failed', ?, ?) ON DUPLICATE KEY UPDATE status = IF(status = 'processed', status, 'failed'), error = VALUES(error)",
          [eventId, now, String((e as Error)?.message ?? "error").slice(0, 200)],
        )
        .catch(() => undefined);
      throw e;
    }
  }
}
