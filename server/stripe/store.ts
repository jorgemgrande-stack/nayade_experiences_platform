/**
 * Correspondencia local con Stripe (migraciones CRM 0012_stripe_billing y 0013_stripe_livemode). Solo
 * identificadores y estados: nunca correos, tarjetas, URL de sesión ni cuerpos de eventos.
 *
 * Cada almacén trabaja en UN modo (por defecto pruebas): escribe `livemode` según él (0 pruebas, 1 live)
 * y solo lee, cuenta, actualiza o purga filas de su modo. Una fila del otro modo se ignora en las
 * lecturas y se rechaza al escribir (duplicado o `mode_mismatch`): un entorno nunca usa filas del otro.
 *
 * Con registro de eventos comerciales (CRM 0014), un reembolso nuevo, la pérdida o recuperación de la
 * cobertura y cada cambio de disputa se registran en la misma transacción que el ajuste del cargo.
 */
import type mysql from "mysql2/promise";
import { chargeAdjusted } from "../commercialEvents/derive";
import type { CommercialEventSink } from "../commercialEvents/types";
import type { StripeMode } from "./config";
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

export interface StripeEventRow {
  eventId: string;
  type: string;
  objectType: string | null;
  objectId: string | null;
  stripeCreated: number;
  source: "webhook" | "reconcile";
  status: "received" | "processing" | "processed" | "ignored" | "failed";
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  receivedAt: number;
}

/** Reembolso o disputa de un cargo de una suscripción de Elephant Source (estado releído en Stripe). */
export interface StripeChargeAdjustment {
  chargeId: string;
  invoiceId: string | null;
  subscriptionId: string | null;
  orderId: number;
  companyId: number;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  disputeStatus: string | null;
  /** Reembolso total o disputa perdida: el cobro ya no cubre el periodo. */
  coverageLost: boolean;
  resolvedAt: number | null;
  resolution: string | null;
  createdAt: number;
  updatedAt: number;
}
export type AdjustmentInput = Omit<StripeChargeAdjustment, "resolvedAt" | "resolution" | "createdAt" | "updatedAt">;

export class StripeStoreError extends Error {
  constructor(
    public readonly code: "price_conflict" | "open_session_exists" | "mode_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "StripeStoreError";
  }
}

export interface StripeStore {
  /** Modo de las filas que lee y escribe (obligatorio: el plano de control exige el de la configuración). */
  readonly mode: StripeMode;
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
  /** Conjuntos de Prices que el servidor envió a Stripe en las sesiones de este pedido. */
  sessionPriceSets(orderId: number): Promise<string[][]>;
  /** ¿Algún pago de este pedido ya se completó en Stripe? Entonces nunca se abre otra sesión. */
  hasCompletedSession(orderId: number): Promise<boolean>;
  /** Lanza `open_session_exists` si el pedido ya tiene una sesión abierta. */
  insertSession(s: StripeSessionRow): Promise<void>;
  updateSession(stripeSessionId: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }): Promise<void>;
  upsertSubscription(s: StripeSubscriptionRow): Promise<void>;
  subscription(id: string): Promise<StripeSubscriptionRow | null>;
  // ── Eventos (webhook y conciliación) ──
  /** Registra un evento una sola vez (clave primaria = id de Stripe). `created: false` si ya existía. */
  recordEvent(e: { eventId: string; type: string; apiVersion: string | null; objectType: string | null; objectId: string | null; stripeCreated: number; source: "webhook" | "reconcile"; now: number }): Promise<{ created: boolean }>;
  /**
   * Toma hasta `limit` eventos pendientes (nuevos, con reintento vencido o con arrendamiento caducado) y
   * los marca `processing` con arrendamiento hasta `now + leaseMs`. Seguro con varias réplicas.
   */
  claimEvents(now: number, limit: number, leaseMs: number): Promise<StripeEventRow[]>;
  finishEvent(eventId: string, outcome: "processed" | "ignored", detail: string | null, now: number): Promise<void>;
  /** Fallo: con `nextAttemptAt` se reintenta; con null queda fallido definitivo (alerta). */
  failEvent(eventId: string, error: string, nextAttemptAt: number | null): Promise<void>;
  event(eventId: string): Promise<StripeEventRow | null>;
  eventCounts(): Promise<Record<StripeEventRow["status"], number>>;
  // ── Conciliación ──
  /** Suscripciones no terminadas cuya copia es anterior a `syncedBefore` (las más antiguas primero). */
  subscriptionsToRefresh(syncedBefore: number, limit: number): Promise<string[]>;
  /** Sesiones que constan abiertas pero cuya caducidad ya pasó. */
  openSessionsExpiredBefore(now: number, limit: number): Promise<string[]>;
  // ── Bloqueos y cursores de las tareas (stripe_sync_state) ──
  /** Arrendamiento exclusivo entre réplicas: true si se obtiene hasta `until`. */
  acquireLease(name: string, until: number, now: number): Promise<boolean>;
  releaseLease(name: string, until: number): Promise<void>;
  getState(name: string): Promise<Record<string, unknown> | null>;
  setState(name: string, value: Record<string, unknown>, now: number): Promise<void>;
  // ── Reembolsos y disputas (stripe_charge_adjustments) ──
  /**
   * Inserta o actualiza el estado releído del cargo. Devuelve el anterior (null si es nuevo). Una pérdida
   * NUEVA de cobertura (0 → 1) reabre la retención aunque un operador la hubiera resuelto antes.
   */
  upsertAdjustment(a: AdjustmentInput, now: number): Promise<{ previous: StripeChargeAdjustment | null; current: StripeChargeAdjustment }>;
  adjustment(chargeId: string): Promise<StripeChargeAdjustment | null>;
  listAdjustments(limit: number): Promise<StripeChargeAdjustment[]>;
  /** Retenciones vigentes del pedido (cobertura perdida y sin resolver). */
  activeHolds(orderId: number): Promise<StripeChargeAdjustment[]>;
  /** Resuelve retenciones vigentes: de un cargo, o de un pedido salvo las de una factura. Devuelve cuántas. */
  resolveHolds(f: { chargeId: string } | { orderId: number; exceptInvoiceId: string | null }, resolution: string, now: number): Promise<number>;
  // ── Retención de eventos ──
  /** Borra hasta `limit` eventos TERMINADOS (procesados o ignorados) recibidos antes de `before`. Nunca fallidos ni pendientes. */
  purgeEvents(before: number, limit: number): Promise<{ processed: number; ignored: number }>;
}

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

type Table = "prices" | "customers" | "sessions" | "subscriptions" | "events" | "adjustments";
/** Los ajustes los escribe siempre el procesador de eventos de Stripe. */
const ADJUSTMENT_ACTOR = "system:stripe";

export class MemoryStripeStore implements StripeStore {
  /** `livemode` de cada fila (`tabla:clave`), como la columna de la BD. Sin marca, la fila es de este modo. */
  livemodes = new Map<string, boolean>();
  constructor(
    readonly mode: StripeMode = "test",
    private commercialEvents?: CommercialEventSink,
  ) {}
  private mine(t: Table, k: string | number) {
    const v = this.livemodes.get(`${t}:${k}`);
    return v === undefined || v === (this.mode === "live");
  }
  private stamp(t: Table, k: string | number) {
    this.livemodes.set(`${t}:${k}`, this.mode === "live");
  }
  private foreign(t: Table, k: string | number) {
    return !this.mine(t, k);
  }
  /** Otra vista de los MISMOS datos en otro modo (imita dos entornos que apuntaran a la misma BD). */
  withMode(mode: StripeMode): MemoryStripeStore {
    const o = new MemoryStripeStore(mode);
    Object.assign(o, { livemodes: this.livemodes, events: this.events, state: this.state, adjustments: this.adjustments, prices: this.prices, customers: this.customers, sessions: this.sessions, subscriptions: this.subscriptions });
    return o;
  }

  events = new Map<string, StripeEventRow & { lockedUntil: number | null; processedAt: number | null }>();
  state = new Map<string, { value: Record<string, unknown>; lockedUntil: number | null }>();
  async recordEvent(e: { eventId: string; type: string; apiVersion: string | null; objectType: string | null; objectId: string | null; stripeCreated: number; source: "webhook" | "reconcile"; now: number }) {
    // Como INSERT IGNORE: un id ya registrado (de este modo o del otro) no se vuelve a guardar
    if (this.events.has(e.eventId)) return { created: false };
    this.events.set(e.eventId, { eventId: e.eventId, type: e.type, objectType: e.objectType, objectId: e.objectId, stripeCreated: e.stripeCreated, source: e.source, status: "received", attempts: 0, nextAttemptAt: null, lastError: null, receivedAt: e.now, lockedUntil: null, processedAt: null });
    this.stamp("events", e.eventId);
    return { created: true };
  }
  private ownEvents() {
    return Array.from(this.events.values()).filter((e) => this.mine("events", e.eventId));
  }
  async claimEvents(now: number, limit: number, leaseMs: number) {
    const due = this.ownEvents()
      .filter((e) => e.status === "received" || (e.status === "failed" && e.nextAttemptAt !== null && e.nextAttemptAt <= now) || (e.status === "processing" && (e.lockedUntil ?? 0) < now))
      .sort((a, b) => a.receivedAt - b.receivedAt)
      .slice(0, limit);
    for (const e of due) Object.assign(e, { status: "processing", lockedUntil: now + leaseMs, attempts: e.attempts + 1 });
    return due.map(({ lockedUntil: _l, processedAt: _p, ...r }) => ({ ...r }));
  }
  async finishEvent(id: string, outcome: "processed" | "ignored", detail: string | null, now: number) {
    const e = this.events.get(id);
    if (e && this.mine("events", id)) Object.assign(e, { status: outcome, lastError: detail, lockedUntil: null, nextAttemptAt: null, processedAt: now });
  }
  async failEvent(id: string, error: string, nextAttemptAt: number | null) {
    const e = this.events.get(id);
    if (e && this.mine("events", id)) Object.assign(e, { status: "failed", lastError: error.slice(0, 300), lockedUntil: null, nextAttemptAt });
  }
  async event(id: string) {
    const e = this.events.get(id);
    if (!e || this.foreign("events", id)) return null;
    const { lockedUntil: _l, processedAt: _p, ...r } = e;
    return { ...r };
  }
  async eventCounts() {
    const out = { received: 0, processing: 0, processed: 0, ignored: 0, failed: 0 };
    for (const e of this.ownEvents()) out[e.status]++;
    return out;
  }
  async subscriptionsToRefresh(syncedBefore: number, limit: number) {
    return Array.from(this.subscriptions.values())
      .filter((x) => this.mine("subscriptions", x.id) && x.status !== "canceled" && x.status !== "incomplete_expired" && x.syncedAt < syncedBefore)
      .sort((a, b) => a.syncedAt - b.syncedAt)
      .slice(0, limit)
      .map((x) => x.id);
  }
  async openSessionsExpiredBefore(now: number, limit: number) {
    return this.ownSessions()
      .filter((x) => x.status === "open" && x.expiresAt < now)
      .slice(0, limit)
      .map((x) => x.stripeSessionId);
  }
  async acquireLease(name: string, until: number, now: number) {
    const cur = this.state.get(name) ?? { value: {}, lockedUntil: null };
    if (cur.lockedUntil !== null && cur.lockedUntil >= now) return false;
    this.state.set(name, { ...cur, lockedUntil: until });
    return true;
  }
  async releaseLease(name: string, until: number) {
    const cur = this.state.get(name);
    if (cur && cur.lockedUntil === until) cur.lockedUntil = null;
  }
  async getState(name: string) {
    const cur = this.state.get(name);
    return cur ? { ...cur.value } : null;
  }
  async setState(name: string, value: Record<string, unknown>) {
    const cur = this.state.get(name) ?? { value: {}, lockedUntil: null };
    this.state.set(name, { ...cur, value: { ...value } });
  }
  adjustments = new Map<string, StripeChargeAdjustment>();
  private ownAdjustments() {
    return Array.from(this.adjustments.values()).filter((x) => this.mine("adjustments", x.chargeId));
  }
  async upsertAdjustment(a: AdjustmentInput, now: number) {
    if (this.adjustments.has(a.chargeId) && this.foreign("adjustments", a.chargeId)) throw new StripeStoreError("mode_mismatch", "El cargo ya consta con otro modo (pruebas/live): rechazado");
    const prev = this.adjustments.get(a.chargeId) ?? null;
    const reopen = !!prev && !prev.coverageLost && a.coverageLost;
    const cur: StripeChargeAdjustment = {
      ...a,
      resolvedAt: prev && !reopen ? prev.resolvedAt : null,
      resolution: prev && !reopen ? prev.resolution : null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.adjustments.set(a.chargeId, cur);
    this.stamp("adjustments", a.chargeId);
    await this.commercialEvents?.append(null, chargeAdjusted(prev, cur, null, ADJUSTMENT_ACTOR, now));
    return { previous: prev ? { ...prev } : null, current: { ...cur } };
  }
  async adjustment(id: string) {
    const x = this.adjustments.get(id);
    return x && this.mine("adjustments", id) ? { ...x } : null;
  }
  async listAdjustments(limit: number) {
    return this.ownAdjustments().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map((x) => ({ ...x }));
  }
  async activeHolds(orderId: number) {
    return this.ownAdjustments().filter((x) => x.orderId === orderId && x.coverageLost && x.resolvedAt === null).map((x) => ({ ...x }));
  }
  async resolveHolds(f: { chargeId: string } | { orderId: number; exceptInvoiceId: string | null }, resolution: string, now: number) {
    let n = 0;
    for (const x of this.ownAdjustments()) {
      if (!x.coverageLost || x.resolvedAt !== null) continue;
      const hit = "chargeId" in f ? x.chargeId === f.chargeId : x.orderId === f.orderId && x.invoiceId !== f.exceptInvoiceId;
      if (!hit) continue;
      Object.assign(x, { resolvedAt: now, resolution: resolution.slice(0, 300), updatedAt: now });
      n++;
    }
    return n;
  }
  async purgeEvents(before: number, limit: number) {
    const out = { processed: 0, ignored: 0 };
    const old = this.ownEvents().filter((e) => (e.status === "processed" || e.status === "ignored") && e.receivedAt < before).sort((a, b) => a.receivedAt - b.receivedAt).slice(0, limit);
    for (const e of old) {
      out[e.status as "processed" | "ignored"]++;
      this.events.delete(e.eventId);
    }
    return out;
  }
  prices = new Map<number, StripePriceLink>();
  customers = new Map<number, StripeCustomerLink>();
  sessions = new Map<string, StripeSessionRow>();
  subscriptions = new Map<string, StripeSubscriptionRow>();
  private ownSessions() {
    return Array.from(this.sessions.values()).filter((s) => this.mine("sessions", s.stripeSessionId));
  }

  async upsertPrice(p: { webPriceId: number; stripeProductId: string; stripePriceId: string; lookupKey: string }) {
    // Como la BD: el enlace de otro modo no se ve, pero sus claves únicas siguen ocupadas (conflicto)
    if (this.prices.has(p.webPriceId) && this.foreign("prices", p.webPriceId)) throw new StripeStoreError("price_conflict", "Price o lookup_key ya enlazados con otro precio");
    const cur = this.prices.get(p.webPriceId);
    if (cur && (cur.stripePriceId !== p.stripePriceId || cur.lookupKey !== p.lookupKey)) {
      throw new StripeStoreError("price_conflict", `El precio ${p.webPriceId} ya está enlazado con otro Price`);
    }
    for (const x of Array.from(this.prices.values())) {
      if (x.webPriceId !== p.webPriceId && (x.stripePriceId === p.stripePriceId || x.lookupKey === p.lookupKey)) throw new StripeStoreError("price_conflict", "Price o lookup_key ya enlazados con otro precio");
    }
    const link: StripePriceLink = { webPriceId: p.webPriceId, stripeProductId: p.stripeProductId, stripePriceId: p.stripePriceId, lookupKey: p.lookupKey, status: "active" };
    this.prices.set(p.webPriceId, link);
    this.stamp("prices", p.webPriceId);
    return { ...link };
  }
  async priceForWebPrice(id: number) {
    const x = this.prices.get(id);
    return x && x.status === "active" && this.mine("prices", id) ? { ...x } : null;
  }
  async listPrices() {
    return Array.from(this.prices.values()).filter((x) => this.mine("prices", x.webPriceId)).map((x) => ({ ...x }));
  }
  async customerByCompany(companyId: number) {
    const x = this.customers.get(companyId);
    return x && this.mine("customers", companyId) ? { ...x } : null;
  }
  async linkCustomer(c: StripeCustomerLink) {
    const cur = this.customers.get(c.companyId);
    // El cliente de otro modo nunca se reutiliza: como en la BD, la clave única está ocupada
    if (cur && this.foreign("customers", c.companyId)) throw new StripeStoreError("mode_mismatch", "La empresa ya tiene cliente de Stripe con otro modo (pruebas/live): rechazado");
    if (cur) return { link: { ...cur }, created: false };
    this.customers.set(c.companyId, { companyId: c.companyId, tenantId: c.tenantId, stripeCustomerId: c.stripeCustomerId });
    this.stamp("customers", c.companyId);
    return { link: { ...c }, created: true };
  }
  async openSession(orderId: number) {
    const x = this.ownSessions().find((s) => s.orderId === orderId && s.status === "open");
    return x ? { ...x, priceIds: [...x.priceIds] } : null;
  }
  async session(id: string) {
    const x = this.sessions.get(id);
    return x && this.mine("sessions", id) ? { ...x, priceIds: [...x.priceIds] } : null;
  }
  async countSessions(orderId: number) {
    return this.ownSessions().filter((s) => s.orderId === orderId).length;
  }
  async sessionPriceSets(orderId: number) {
    return this.ownSessions().filter((s) => s.orderId === orderId).map((s) => [...s.priceIds]);
  }
  async hasCompletedSession(orderId: number) {
    return this.ownSessions().some((s) => s.orderId === orderId && s.status === "complete");
  }
  async insertSession(s: StripeSessionRow) {
    if (this.sessions.has(s.stripeSessionId) && this.foreign("sessions", s.stripeSessionId)) throw new StripeStoreError("open_session_exists", "El pedido ya tiene una sesión de Checkout abierta (o la sesión ya existe)");
    if (s.status === "open" && (await this.openSession(s.orderId))) throw new StripeStoreError("open_session_exists", "El pedido ya tiene una sesión de Checkout abierta");
    this.sessions.set(s.stripeSessionId, { ...s, priceIds: [...s.priceIds] });
    this.stamp("sessions", s.stripeSessionId);
  }
  async updateSession(id: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }) {
    const x = this.sessions.get(id);
    if (x && this.mine("sessions", id)) this.sessions.set(id, { ...x, ...patch });
  }
  async upsertSubscription(s: StripeSubscriptionRow) {
    if (this.subscriptions.has(s.id) && this.foreign("subscriptions", s.id)) throw new StripeStoreError("mode_mismatch", "La suscripción ya existe con otro modo (pruebas/live): rechazada");
    this.subscriptions.set(s.id, { ...s, priceIds: [...s.priceIds] });
    this.stamp("subscriptions", s.id);
  }
  async subscription(id: string) {
    const x = this.subscriptions.get(id);
    return x && this.mine("subscriptions", id) ? { ...x, priceIds: [...x.priceIds] } : null;
  }
}

// ── MySQL (BD del CRM) ───────────────────────────────────────────────────────

type Row = mysql.RowDataPacket & Record<string, unknown>;
const json = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []) as string[];
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

export class MysqlStripeStore implements StripeStore {
  /** `livemode` de las filas de este entorno (0 pruebas, 1 live): se escribe y se exige en cada consulta. */
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    readonly mode: StripeMode = "test",
    /** Registro de eventos comerciales (0014); sin él, todo funciona igual y no se registra nada. */
    private commercialEvents?: CommercialEventSink,
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }

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
      await this.pool.query("UPDATE stripe_prices SET synced_at = ? WHERE web_price_id = ? AND livemode = ?", [p.now, p.webPriceId, this.lm]);
      return cur;
    }
    try {
      await this.pool.query(
        "INSERT INTO stripe_prices (web_price_id, stripe_product_id, stripe_price_id, lookup_key, livemode, status, created_at, synced_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
        [p.webPriceId, p.stripeProductId, p.stripePriceId, p.lookupKey, this.lm, p.now, p.now],
      );
    } catch (e) {
      if (isDup(e)) throw new StripeStoreError("price_conflict", "Price o lookup_key ya enlazados con otro precio");
      throw e;
    }
    return { webPriceId: p.webPriceId, stripeProductId: p.stripeProductId, stripePriceId: p.stripePriceId, lookupKey: p.lookupKey, status: "active" as const };
  }
  private async priceForWebPriceAny(id: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_prices WHERE web_price_id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.priceRow(rows[0]) : null;
  }
  async priceForWebPrice(id: number) {
    const x = await this.priceForWebPriceAny(id);
    return x && x.status === "active" ? x : null;
  }
  async listPrices() {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_prices WHERE livemode = ? ORDER BY web_price_id", [this.lm]);
    return rows.map(this.priceRow);
  }
  async customerByCompany(companyId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT company_id, tenant_id, stripe_customer_id FROM stripe_customers WHERE company_id = ? AND livemode = ?", [companyId, this.lm]);
    const r = rows[0];
    return r ? { companyId: Number(r.company_id), tenantId: (r.tenant_id as string | null) ?? null, stripeCustomerId: String(r.stripe_customer_id) } : null;
  }
  async linkCustomer(c: StripeCustomerLink & { now: number }) {
    try {
      await this.pool.query("INSERT INTO stripe_customers (company_id, tenant_id, stripe_customer_id, livemode, created_at) VALUES (?, ?, ?, ?, ?)", [c.companyId, c.tenantId, c.stripeCustomerId, this.lm, c.now]);
      return { link: { companyId: c.companyId, tenantId: c.tenantId, stripeCustomerId: c.stripeCustomerId }, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
      const cur = await this.customerByCompany(c.companyId);
      if (cur) return { link: cur, created: false };
      // Sin fila de este modo: si choca con una del OTRO modo se rechaza como en memoria, nunca se reutiliza
      const [other] = await this.pool.query<Row[]>(
        "SELECT 1 FROM stripe_customers WHERE livemode <> ? AND (company_id = ? OR stripe_customer_id = ? OR (tenant_id IS NOT NULL AND tenant_id = ?)) LIMIT 1",
        [this.lm, c.companyId, c.stripeCustomerId, c.tenantId],
      );
      if (other.length) throw new StripeStoreError("mode_mismatch", "La empresa ya tiene cliente de Stripe con otro modo (pruebas/live): rechazado");
      throw e;
    }
  }
  async openSession(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_checkout_sessions WHERE order_id = ? AND status = 'open' AND livemode = ?", [orderId, this.lm]);
    return rows[0] ? this.sessionRow(rows[0]) : null;
  }
  async session(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_checkout_sessions WHERE stripe_session_id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.sessionRow(rows[0]) : null;
  }
  async countSessions(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT COUNT(*) AS n FROM stripe_checkout_sessions WHERE order_id = ? AND livemode = ?", [orderId, this.lm]);
    return Number(rows[0]?.n ?? 0);
  }
  async sessionPriceSets(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT price_ids_json FROM stripe_checkout_sessions WHERE order_id = ? AND livemode = ? ORDER BY id", [orderId, this.lm]);
    return rows.map((r) => json(r.price_ids_json));
  }
  async hasCompletedSession(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT 1 FROM stripe_checkout_sessions WHERE order_id = ? AND status = 'complete' AND livemode = ? LIMIT 1", [orderId, this.lm]);
    return rows.length > 0;
  }
  async insertSession(s: StripeSessionRow) {
    try {
      await this.pool.query(
        "INSERT INTO stripe_checkout_sessions (order_id, stripe_session_id, idempotency_key, price_ids_json, status, payment_status, expires_at, livemode, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [s.orderId, s.stripeSessionId, s.idempotencyKey, JSON.stringify(s.priceIds), s.status, s.paymentStatus, s.expiresAt, this.lm, s.createdAt, s.completedAt],
      );
    } catch (e) {
      if (isDup(e)) throw new StripeStoreError("open_session_exists", "El pedido ya tiene una sesión de Checkout abierta (o la sesión ya existe)");
      throw e;
    }
  }
  async updateSession(id: string, patch: { status: SessionStatus; paymentStatus: string | null; completedAt: number | null }) {
    await this.pool.query("UPDATE stripe_checkout_sessions SET status = ?, payment_status = ?, completed_at = COALESCE(completed_at, ?) WHERE stripe_session_id = ? AND livemode = ?", [patch.status, patch.paymentStatus, patch.completedAt, id, this.lm]);
  }
  async upsertSubscription(s: StripeSubscriptionRow) {
    // Una suscripción de OTRO modo con el mismo id nunca se toca: se rechaza (y la actualización solo
    // cambia columnas si la fila es de este modo, por si otra petición la insertara entre medias)
    const [cur] = await this.pool.query<Row[]>("SELECT livemode FROM stripe_subscriptions WHERE stripe_subscription_id = ?", [s.id]);
    if (cur[0] && Number(cur[0].livemode) !== this.lm) throw new StripeStoreError("mode_mismatch", "La suscripción ya existe con otro modo (pruebas/live): rechazada");
    const own = (col: string) => `${col} = IF(livemode = VALUES(livemode), VALUES(${col}), ${col})`;
    await this.pool.query(
      `INSERT INTO stripe_subscriptions (stripe_subscription_id, stripe_customer_id, company_id, order_id, tenant_id, status, cancel_at, cancel_at_period_end, current_period_end, latest_invoice_id, price_ids_json, livemode, synced_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE version = IF(livemode = VALUES(livemode), version + 1, version),
         ${["status", "cancel_at", "cancel_at_period_end", "current_period_end", "latest_invoice_id", "price_ids_json", "synced_at"].map(own).join(", ")}`,
      [s.id, s.customerId, s.companyId, s.orderId, s.tenantId, s.status, s.cancelAt, s.cancelAtPeriodEnd ? 1 : 0, s.currentPeriodEnd, s.latestInvoiceId, JSON.stringify(s.priceIds), this.lm, s.syncedAt],
    );
  }
  async subscription(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ? AND livemode = ?", [id, this.lm]);
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
  private eventRow = (r: Row): StripeEventRow => ({
    eventId: String(r.event_id),
    type: String(r.type),
    objectType: (r.object_type as string | null) ?? null,
    objectId: (r.object_id as string | null) ?? null,
    stripeCreated: Number(r.stripe_created),
    source: r.source as StripeEventRow["source"],
    status: r.status as StripeEventRow["status"],
    attempts: Number(r.attempts),
    nextAttemptAt: r.next_attempt_at == null ? null : Number(r.next_attempt_at),
    lastError: (r.last_error as string | null) ?? null,
    receivedAt: Number(r.received_at),
  });
  async recordEvent(e: { eventId: string; type: string; apiVersion: string | null; objectType: string | null; objectId: string | null; stripeCreated: number; source: "webhook" | "reconcile"; now: number }) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO stripe_events (event_id, type, api_version, object_type, object_id, stripe_created, source, status, attempts, livemode, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', 0, ?, ?)",
      [e.eventId, e.type.slice(0, 80), e.apiVersion, e.objectType, e.objectId, e.stripeCreated, e.source, this.lm, e.now],
    );
    return { created: res.affectedRows === 1 };
  }
  async claimEvents(now: number, limit: number, leaseMs: number) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<Row[]>(
        `SELECT * FROM stripe_events
          WHERE livemode = ?
            AND (status = 'received'
             OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
             OR (status = 'processing' AND locked_until < ?))
          ORDER BY received_at LIMIT ? FOR UPDATE SKIP LOCKED`,
        [this.lm, now, now, limit],
      );
      if (rows.length) {
        await conn.query("UPDATE stripe_events SET status = 'processing', locked_until = ?, attempts = attempts + 1 WHERE event_id IN (?)", [now + leaseMs, rows.map((r) => r.event_id)]);
      }
      await conn.commit();
      return rows.map((r) => ({ ...this.eventRow(r), status: "processing" as const, attempts: Number(r.attempts) + 1 }));
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
  async finishEvent(id: string, outcome: "processed" | "ignored", detail: string | null, now: number) {
    await this.pool.query("UPDATE stripe_events SET status = ?, last_error = ?, locked_until = NULL, next_attempt_at = NULL, processed_at = ? WHERE event_id = ? AND livemode = ?", [outcome, detail?.slice(0, 300) ?? null, now, id, this.lm]);
  }
  async failEvent(id: string, error: string, nextAttemptAt: number | null) {
    await this.pool.query("UPDATE stripe_events SET status = 'failed', last_error = ?, locked_until = NULL, next_attempt_at = ? WHERE event_id = ? AND livemode = ?", [error.slice(0, 300), nextAttemptAt, id, this.lm]);
  }
  async event(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_events WHERE event_id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.eventRow(rows[0]) : null;
  }
  async eventCounts() {
    const out = { received: 0, processing: 0, processed: 0, ignored: 0, failed: 0 };
    const [rows] = await this.pool.query<Row[]>("SELECT status, COUNT(*) AS n FROM stripe_events WHERE livemode = ? GROUP BY status", [this.lm]);
    for (const r of rows) out[r.status as keyof typeof out] = Number(r.n);
    return out;
  }
  async subscriptionsToRefresh(syncedBefore: number, limit: number) {
    const [rows] = await this.pool.query<Row[]>(
      "SELECT stripe_subscription_id FROM stripe_subscriptions WHERE livemode = ? AND status NOT IN ('canceled','incomplete_expired') AND synced_at < ? ORDER BY synced_at LIMIT ?",
      [this.lm, syncedBefore, limit],
    );
    return rows.map((r) => String(r.stripe_subscription_id));
  }
  async openSessionsExpiredBefore(now: number, limit: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT stripe_session_id FROM stripe_checkout_sessions WHERE livemode = ? AND status = 'open' AND expires_at < ? LIMIT ?", [this.lm, now, limit]);
    return rows.map((r) => String(r.stripe_session_id));
  }
  async acquireLease(name: string, until: number, now: number) {
    await this.pool.query("INSERT IGNORE INTO stripe_sync_state (name, value_json, locked_until, updated_at) VALUES (?, '{}', NULL, ?)", [name, now]);
    const [res] = await this.pool.query<mysql.ResultSetHeader>("UPDATE stripe_sync_state SET locked_until = ? WHERE name = ? AND (locked_until IS NULL OR locked_until < ?)", [until, name, now]);
    return res.affectedRows === 1;
  }
  async releaseLease(name: string, until: number) {
    await this.pool.query("UPDATE stripe_sync_state SET locked_until = NULL WHERE name = ? AND locked_until = ?", [name, until]);
  }
  async getState(name: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT value_json FROM stripe_sync_state WHERE name = ?", [name]);
    if (!rows[0]) return null;
    const v = rows[0].value_json;
    return (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;
  }
  async setState(name: string, value: Record<string, unknown>, now: number) {
    await this.pool.query("INSERT INTO stripe_sync_state (name, value_json, locked_until, updated_at) VALUES (?, ?, NULL, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)", [name, JSON.stringify(value), now]);
  }
  private adjustmentRow = (r: Row): StripeChargeAdjustment => ({
    chargeId: String(r.stripe_charge_id),
    invoiceId: (r.stripe_invoice_id as string | null) ?? null,
    subscriptionId: (r.stripe_subscription_id as string | null) ?? null,
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    amountCents: Number(r.amount_cents),
    amountRefundedCents: Number(r.amount_refunded_cents),
    currency: String(r.currency),
    disputeStatus: (r.dispute_status as string | null) ?? null,
    coverageLost: Number(r.coverage_lost) === 1,
    resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
    resolution: (r.resolution as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });
  async upsertAdjustment(a: AdjustmentInput, now: number) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<Row[]>("SELECT * FROM stripe_charge_adjustments WHERE stripe_charge_id = ? FOR UPDATE", [a.chargeId]);
      if (rows[0] && Number(rows[0].livemode) !== this.lm) throw new StripeStoreError("mode_mismatch", "El cargo ya consta con otro modo (pruebas/live): rechazado");
      const prev = rows[0] ? this.adjustmentRow(rows[0]) : null;
      const reopen = !!prev && !prev.coverageLost && a.coverageLost;
      if (!prev) {
        await conn.query(
          "INSERT INTO stripe_charge_adjustments (stripe_charge_id, stripe_invoice_id, stripe_subscription_id, order_id, company_id, amount_cents, amount_refunded_cents, currency, dispute_status, coverage_lost, livemode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [a.chargeId, a.invoiceId, a.subscriptionId, a.orderId, a.companyId, a.amountCents, a.amountRefundedCents, a.currency, a.disputeStatus, a.coverageLost ? 1 : 0, this.lm, now, now],
        );
      } else {
        await conn.query(
          `UPDATE stripe_charge_adjustments SET amount_cents = ?, amount_refunded_cents = ?, currency = ?, dispute_status = ?, coverage_lost = ?,
             resolved_at = IF(?, NULL, resolved_at), resolution = IF(?, NULL, resolution), updated_at = ? WHERE stripe_charge_id = ? AND livemode = ?`,
          [a.amountCents, a.amountRefundedCents, a.currency, a.disputeStatus, a.coverageLost ? 1 : 0, reopen ? 1 : 0, reopen ? 1 : 0, now, a.chargeId, this.lm],
        );
      }
      const [after] = await conn.query<Row[]>("SELECT * FROM stripe_charge_adjustments WHERE stripe_charge_id = ?", [a.chargeId]);
      const current = this.adjustmentRow(after[0]);
      if (this.commercialEvents) {
        const [o] = await conn.query<Row[]>("SELECT tenant_id, subscription_id FROM commercial_orders WHERE id = ?", [a.orderId]);
        const order = o[0] ? { tenantId: (o[0].tenant_id as string | null) ?? null, subscriptionId: o[0].subscription_id == null ? null : Number(o[0].subscription_id) } : null;
        await this.commercialEvents.append(conn, chargeAdjusted(prev, current, order, ADJUSTMENT_ACTOR, now));
      }
      await conn.commit();
      return { previous: prev, current };
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
  async adjustment(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_charge_adjustments WHERE stripe_charge_id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.adjustmentRow(rows[0]) : null;
  }
  async listAdjustments(limit: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_charge_adjustments WHERE livemode = ? ORDER BY updated_at DESC LIMIT ?", [this.lm, limit]);
    return rows.map(this.adjustmentRow);
  }
  async activeHolds(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_charge_adjustments WHERE order_id = ? AND coverage_lost = 1 AND resolved_at IS NULL AND livemode = ?", [orderId, this.lm]);
    return rows.map(this.adjustmentRow);
  }
  async resolveHolds(f: { chargeId: string } | { orderId: number; exceptInvoiceId: string | null }, resolution: string, now: number) {
    const [res] =
      "chargeId" in f
        ? await this.pool.query<mysql.ResultSetHeader>("UPDATE stripe_charge_adjustments SET resolved_at = ?, resolution = ?, updated_at = ? WHERE stripe_charge_id = ? AND coverage_lost = 1 AND resolved_at IS NULL AND livemode = ?", [now, resolution.slice(0, 300), now, f.chargeId, this.lm])
        : await this.pool.query<mysql.ResultSetHeader>(
            "UPDATE stripe_charge_adjustments SET resolved_at = ?, resolution = ?, updated_at = ? WHERE order_id = ? AND coverage_lost = 1 AND resolved_at IS NULL AND livemode = ? AND (stripe_invoice_id IS NULL OR stripe_invoice_id <> ?)",
            [now, resolution.slice(0, 300), now, f.orderId, this.lm, f.exceptInvoiceId ?? ""],
          );
    return res.affectedRows;
  }
  async purgeEvents(before: number, limit: number) {
    const out = { processed: 0, ignored: 0 };
    for (const status of ["processed", "ignored"] as const) {
      const left = limit - out.processed - out.ignored;
      if (left <= 0) break;
      const [res] = await this.pool.query<mysql.ResultSetHeader>("DELETE FROM stripe_events WHERE status = ? AND livemode = ? AND received_at < ? ORDER BY received_at LIMIT ?", [status, this.lm, before, left]);
      out[status] = res.affectedRows;
    }
    return out;
  }
}
