/**
 * Correspondencia local con Stripe (migración CRM 0012_stripe_billing). Solo identificadores y estados:
 * nunca correos, tarjetas, URL de sesión ni cuerpos de eventos. Todas las filas son de pruebas
 * (livemode = 0, impuesto también por la BD).
 */
import type mysql from "mysql2/promise";
import type { GwSubscription } from "./gateway";

export interface StripePriceLink {
  webPriceId: number;
  stripeProductId: string;
  stripePriceId: string;
  lookupKey: string;
  status: "active" | "archived";
}

export interface StripeCustomerLink {
  companyId: number;
  tenantId: string | null;
  stripeCustomerId: string;
}

export type SessionStatus = "open" | "complete" | "expired";
export interface StripeSessionRow {
  orderId: number;
  stripeSessionId: string;
  idempotencyKey: string;
  priceIds: string[];
  status: SessionStatus;
  paymentStatus: string | null;
  expiresAt: number;
  createdAt: number;
  completedAt: number | null;
}

export interface StripeSubscriptionRow extends Omit<GwSubscription, "metadata"> {
  companyId: number;
  orderId: number | null;
  tenantId: string | null;
  syncedAt: number;
}

export class StripeStoreError extends Error {
  constructor(
    public readonly code: "price_conflict" | "open_session_exists",
    message: string,
  ) {
    super(message);
    this.name = "StripeStoreError";
  }
}

export interface StripeStore {
  /** Enlaza un precio aprobado con su Price. Nunca cambia en silencio a otro Price: conflicto. */
  upsertPrice(p: { webPriceId: number; stripeProductId: string; stripePriceId: string; lookupKey: string; now: number }): Promise<StripePriceLink>;
  priceForWebPrice(webPriceId: number): Promise<StripePriceLink | null>;
  listPrices(): Promise<StripePriceLink[]>;
  customerByCompany(companyId: number): Promise<StripeCustomerLink | null>;
  /** Inserta o devuelve el existente (otra ejecución pudo enlazarlo antes). */
  linkCustomer(c: StripeCustomerLink & { now: number }): Promise<{ link: StripeCustomerLink; created: boolean }>;
  openSession(orderId: number): Promise<StripeSessionRow | null>;
  session(stripeSessionId: string): Promise<StripeSessionRow | null>;
  countSessions(orderId: number): Promise<number>;
  /** ¿Algún pago de este pedido ya se completó en Stripe? Entonces nunca se abre otra sesión. */
  hasCompletedSession(orderId: number): Promise<boolean>;
  /** Lanza `open_session_exists` si el pedido ya tiene una sesión abierta. */
  insertSession(s: StripeSessionRow): Promise<void>;
  updateSession(stripeSessionId: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }): Promise<void>;
  upsertSubscription(s: StripeSubscriptionRow): Promise<void>;
  subscription(id: string): Promise<StripeSubscriptionRow | null>;
}

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

export class MemoryStripeStore implements StripeStore {
  prices = new Map<number, StripePriceLink>();
  customers = new Map<number, StripeCustomerLink>();
  sessions = new Map<string, StripeSessionRow>();
  subscriptions = new Map<string, StripeSubscriptionRow>();

  async upsertPrice(p: { webPriceId: number; stripeProductId: string; stripePriceId: string; lookupKey: string }) {
    const cur = this.prices.get(p.webPriceId);
    if (cur && (cur.stripePriceId !== p.stripePriceId || cur.lookupKey !== p.lookupKey)) {
      throw new StripeStoreError("price_conflict", `El precio ${p.webPriceId} ya está enlazado con otro Price`);
    }
    for (const x of Array.from(this.prices.values())) {
      if (x.webPriceId !== p.webPriceId && (x.stripePriceId === p.stripePriceId || x.lookupKey === p.lookupKey)) throw new StripeStoreError("price_conflict", "Price o lookup_key ya enlazados con otro precio");
    }
    const link: StripePriceLink = { webPriceId: p.webPriceId, stripeProductId: p.stripeProductId, stripePriceId: p.stripePriceId, lookupKey: p.lookupKey, status: "active" };
    this.prices.set(p.webPriceId, link);
    return { ...link };
  }
  async priceForWebPrice(id: number) {
    const x = this.prices.get(id);
    return x && x.status === "active" ? { ...x } : null;
  }
  async listPrices() {
    return Array.from(this.prices.values()).map((x) => ({ ...x }));
  }
  async customerByCompany(companyId: number) {
    const x = this.customers.get(companyId);
    return x ? { ...x } : null;
  }
  async linkCustomer(c: StripeCustomerLink) {
    const cur = this.customers.get(c.companyId);
    if (cur) return { link: { ...cur }, created: false };
    this.customers.set(c.companyId, { companyId: c.companyId, tenantId: c.tenantId, stripeCustomerId: c.stripeCustomerId });
    return { link: { ...c }, created: true };
  }
  async openSession(orderId: number) {
    const x = Array.from(this.sessions.values()).find((s) => s.orderId === orderId && s.status === "open");
    return x ? { ...x, priceIds: [...x.priceIds] } : null;
  }
  async session(id: string) {
    const x = this.sessions.get(id);
    return x ? { ...x, priceIds: [...x.priceIds] } : null;
  }
  async countSessions(orderId: number) {
    return Array.from(this.sessions.values()).filter((s) => s.orderId === orderId).length;
  }
  async hasCompletedSession(orderId: number) {
    return Array.from(this.sessions.values()).some((s) => s.orderId === orderId && s.status === "complete");
  }
  async insertSession(s: StripeSessionRow) {
    if (s.status === "open" && (await this.openSession(s.orderId))) throw new StripeStoreError("open_session_exists", "El pedido ya tiene una sesión de Checkout abierta");
    this.sessions.set(s.stripeSessionId, { ...s, priceIds: [...s.priceIds] });
  }
  async updateSession(id: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }) {
    const x = this.sessions.get(id);
    if (x) this.sessions.set(id, { ...x, ...patch });
  }
  async upsertSubscription(s: StripeSubscriptionRow) {
    this.subscriptions.set(s.id, { ...s, priceIds: [...s.priceIds] });
  }
  async subscription(id: string) {
    const x = this.subscriptions.get(id);
    return x ? { ...x, priceIds: [...x.priceIds] } : null;
  }
}

// ── MySQL (BD del CRM) ───────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const json = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []) as string[];
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

export class MysqlStripeStore implements StripeStore {
  constructor(private pool: mysql.Pool) {}

  private priceRow = (r: Row): StripePriceLink => ({
    webPriceId: Number(r.web_price_id),
    stripeProductId: String(r.stripe_product_id),
    stripePriceId: String(r.stripe_price_id),
    lookupKey: String(r.lookup_key),
    status: r.status as StripePriceLink["status"],
  });
  private sessionRow = (r: Row): StripeSessionRow => ({
    orderId: Number(r.order_id),
    stripeSessionId: String(r.stripe_session_id),
    idempotencyKey: String(r.idempotency_key),
    priceIds: json(r.price_ids_json),
    status: r.status as SessionStatus,
    paymentStatus: (r.payment_status as string | null) ?? null,
    expiresAt: Number(r.expires_at),
    createdAt: Number(r.created_at),
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
  });

  async upsertPrice(p: { webPriceId: number; stripeProductId: string; stripePriceId: string; lookupKey: string; now: number }) {
    const cur = await this.priceForWebPriceAny(p.webPriceId);
    if (cur) {
      if (cur.stripePriceId !== p.stripePriceId || cur.lookupKey !== p.lookupKey) throw new StripeStoreError("price_conflict", `El precio ${p.webPriceId} ya está enlazado con otro Price`);
      await this.pool.query("UPDATE stripe_prices SET synced_at = ? WHERE web_price_id = ?", [p.now, p.webPriceId]);
      return cur;
    }
    try {
      await this.pool.query(
        "INSERT INTO stripe_prices (web_price_id, stripe_product_id, stripe_price_id, lookup_key, livemode, status, created_at, synced_at) VALUES (?, ?, ?, ?, 0, 'active', ?, ?)",
        [p.webPriceId, p.stripeProductId, p.stripePriceId, p.lookupKey, p.now, p.now],
      );
    } catch (e) {
      if (isDup(e)) throw new StripeStoreError("price_conflict", "Price o lookup_key ya enlazados con otro precio");
      throw e;
    }
    return { webPriceId: p.webPriceId, stripeProductId: p.stripeProductId, stripePriceId: p.stripePriceId, lookupKey: p.lookupKey, status: "active" as const };
  }
  private async priceForWebPriceAny(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_prices WHERE web_price_id = ?", [id]);
    return rows[0] ? this.priceRow(rows[0]) : null;
  }
  async priceForWebPrice(id: number) {
    const x = await this.priceForWebPriceAny(id);
    return x && x.status === "active" ? x : null;
  }
  async listPrices() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_prices ORDER BY web_price_id");
    return rows.map(this.priceRow);
  }
  async customerByCompany(companyId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT company_id, tenant_id, stripe_customer_id FROM stripe_customers WHERE company_id = ?", [companyId]);
    const r = rows[0];
    return r ? { companyId: Number(r.company_id), tenantId: (r.tenant_id as string | null) ?? null, stripeCustomerId: String(r.stripe_customer_id) } : null;
  }
  async linkCustomer(c: StripeCustomerLink & { now: number }) {
    try {
      await this.pool.query("INSERT INTO stripe_customers (company_id, tenant_id, stripe_customer_id, livemode, created_at) VALUES (?, ?, ?, 0, ?)", [c.companyId, c.tenantId, c.stripeCustomerId, c.now]);
      return { link: { companyId: c.companyId, tenantId: c.tenantId, stripeCustomerId: c.stripeCustomerId }, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
      const cur = await this.customerByCompany(c.companyId);
      if (!cur) throw e;
      return { link: cur, created: false };
    }
  }
  async openSession(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_checkout_sessions WHERE order_id = ? AND status = 'open'", [orderId]);
    return rows[0] ? this.sessionRow(rows[0]) : null;
  }
  async session(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_checkout_sessions WHERE stripe_session_id = ?", [id]);
    return rows[0] ? this.sessionRow(rows[0]) : null;
  }
  async countSessions(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT COUNT(*) AS n FROM stripe_checkout_sessions WHERE order_id = ?", [orderId]);
    return Number(rows[0]?.n ?? 0);
  }
  async hasCompletedSession(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT 1 FROM stripe_checkout_sessions WHERE order_id = ? AND status = 'complete' LIMIT 1", [orderId]);
    return rows.length > 0;
  }
  async insertSession(s: StripeSessionRow) {
    try {
      await this.pool.query(
        "INSERT INTO stripe_checkout_sessions (order_id, stripe_session_id, idempotency_key, price_ids_json, status, payment_status, expires_at, livemode, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        [s.orderId, s.stripeSessionId, s.idempotencyKey, JSON.stringify(s.priceIds), s.status, s.paymentStatus, s.expiresAt, s.createdAt, s.completedAt],
      );
    } catch (e) {
      if (isDup(e)) throw new StripeStoreError("open_session_exists", "El pedido ya tiene una sesión de Checkout abierta (o la sesión ya existe)");
      throw e;
    }
  }
  async updateSession(id: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }) {
    await this.pool.query("UPDATE stripe_checkout_sessions SET status = ?, payment_status = ?, completed_at = COALESCE(completed_at, ?) WHERE stripe_session_id = ?", [patch.status, patch.paymentStatus, patch.completedAt, id]);
  }
  async upsertSubscription(s: StripeSubscriptionRow) {
    await this.pool.query(
      `INSERT INTO stripe_subscriptions (stripe_subscription_id, stripe_customer_id, company_id, order_id, tenant_id, status, cancel_at, cancel_at_period_end, current_period_end, latest_invoice_id, price_ids_json, livemode, synced_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)
       ON DUPLICATE KEY UPDATE status = VALUES(status), cancel_at = VALUES(cancel_at), cancel_at_period_end = VALUES(cancel_at_period_end),
         current_period_end = VALUES(current_period_end), latest_invoice_id = VALUES(latest_invoice_id), price_ids_json = VALUES(price_ids_json),
         synced_at = VALUES(synced_at), version = version + 1`,
      [s.id, s.customerId, s.companyId, s.orderId, s.tenantId, s.status, s.cancelAt, s.cancelAtPeriodEnd ? 1 : 0, s.currentPeriodEnd, s.latestInvoiceId, JSON.stringify(s.priceIds), s.syncedAt],
    );
  }
  async subscription(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ?", [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.stripe_subscription_id),
      customerId: String(r.stripe_customer_id),
      companyId: Number(r.company_id),
      orderId: r.order_id == null ? null : Number(r.order_id),
      tenantId: (r.tenant_id as string | null) ?? null,
      status: r.status as StripeSubscriptionRow["status"],
      cancelAt: r.cancel_at == null ? null : Number(r.cancel_at),
      cancelAtPeriodEnd: Number(r.cancel_at_period_end) === 1,
      currentPeriodEnd: r.current_period_end == null ? null : Number(r.current_period_end),
      latestInvoiceId: (r.latest_invoice_id as string | null) ?? null,
      priceIds: json(r.price_ids_json),
      syncedAt: Number(r.synced_at),
    };
  }
}
