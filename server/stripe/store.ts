/**
 * Correspondencia local con Stripe (migraciones CRM 0012_stripe_billing y 0013_stripe_livemode). Solo
 * identificadores y estados: nunca correos, tarjetas, URL de sesión ni cuerpos de eventos.
 *
 * Cada almacén trabaja en UN modo (por defecto pruebas): escribe `livemode` según él (0 pruebas, 1 live)
 * y solo lee, cuenta, actualiza o purga filas de su modo. Una fila del otro modo se ignora en las
 * lecturas y se rechaza al escribir (duplicado o `mode_mismatch`): un entorno nunca usa filas del otro.
 *
 * Con registro de eventos comerciales (CRM 0015), un reembolso nuevo, la pérdida o recuperación de la
 * cobertura y cada cambio de disputa se registran en la misma transacción que el ajuste del cargo.
 */
import type mysql from "mysql2/promise";
import { chargeAdjusted } from "../commercialEvents/derive";
import type { CommercialEventSink } from "../commercialEvents/types";
import type { StripeMode } from "./config";
import type { GwSubscription } from "./gateway";
import type { BuyerProfile, ConsentRecord } from "./buyerProfile";
import type { VatCheck } from "./vies";
import type { FiscalDocument, FiscalDocumentDraft, FiscalDocumentStatus, StripeInvoiceRecord } from "./fiscalDocuments";

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
  /** Suscripciones de Stripe no terminadas de la empresa (copias releídas), la más reciente primero. */
  subscriptionsOfCompany(companyId: number): Promise<string[]>;
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

  /** Perfil fiscal del comprador de un pedido (0014). `null` si no hay o si la tabla no existe. */
  buyerProfile(orderId: number): Promise<BuyerProfile | null>;
  /** Crea o sustituye el perfil (versión + 1) y deja la instantánea en el historial, en una transacción. */
  saveBuyerProfile(p: BuyerProfileDraft, actor: string): Promise<BuyerProfile>;
  /** ¿Se guarda el domicilio de facturación (CRM 0020)? Sin él, la dirección la pide Checkout como antes. */
  hasBuyerAddressColumn(): Promise<boolean>;

  /** Comprobaciones de NIF-IVA en VIES (0021): cada consulta, con su resultado y su número de consulta. */
  recordVatCheck(c: VatCheck): Promise<void>;
  /** Última comprobación VÁLIDA de un NIF-IVA en este modo, o null. */
  lastValidVatCheck(country: string, vatNumber: string): Promise<VatCheck | null>;
  /** Comprobaciones de un pedido (más recientes primero). */
  vatChecksOfOrder(orderId: number): Promise<VatCheck[]>;
  /** ¿Existe la tabla (0021)? Sin ella no hay evidencia y no se aplica la inversión del sujeto pasivo. */
  hasVatCheckTable(): Promise<boolean>;

  /** Registro de facturas cobradas (0016). Crea o actualiza el estado y los importes; nunca cambia el pedido. */
  upsertInvoiceRecord(r: StripeInvoiceRecord): Promise<void>;
  invoiceRecord(stripeInvoiceId: string): Promise<StripeInvoiceRecord | null>;
  listInvoiceRecords(q: { orderId?: number; limit: number }): Promise<StripeInvoiceRecord[]>;
  /** Total reembolsado de una factura: solo sube (una lectura antigua no lo rebaja). */
  setInvoiceRefunded(stripeInvoiceId: string, refundedCents: number, now: number): Promise<void>;
  /** Documento fiscal idempotente por clave de origen: el mismo hecho devuelve el documento existente. */
  enqueueFiscalDocument(d: FiscalDocumentDraft): Promise<{ created: boolean; document: FiscalDocument }>;
  fiscalDocumentBySource(sourceKey: string): Promise<FiscalDocument | null>;
  listFiscalDocuments(q: { status?: FiscalDocumentStatus; orderId?: number; limit: number }): Promise<FiscalDocument[]>;
  /** Registra la emisión en el sistema legal (pendiente o fallido → emitido). Repetirla con la misma referencia no cambia nada. */
  markFiscalDocumentIssued(id: number, externalRef: string, by: string, at: number): Promise<FiscalDocument | null>;
}

/** El documento ya está emitido con OTRA referencia: no se sobrescribe un número legal. */
export class FiscalDocumentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalDocumentConflictError";
  }
}

export type BuyerProfileDraft = Omit<BuyerProfile, "version" | "createdAt" | "updatedAt"> & { now: number };

// ── Memoria (pruebas) ────────────────────────────────────────────────────────

type Table = "prices" | "customers" | "sessions" | "subscriptions" | "events" | "adjustments" | "buyers" | "invoices" | "documents";
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
    Object.assign(o, { livemodes: this.livemodes, events: this.events, state: this.state, adjustments: this.adjustments, prices: this.prices, customers: this.customers, sessions: this.sessions, subscriptions: this.subscriptions, buyers: this.buyers, buyerHistory: this.buyerHistory, invoiceRecords: this.invoiceRecords, fiscalDocs: this.fiscalDocs });
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
  async subscriptionsOfCompany(companyId: number) {
    return Array.from(this.subscriptions.values())
      .filter((x) => x.companyId === companyId && this.mine("subscriptions", x.id) && x.status !== "canceled" && x.status !== "incomplete_expired")
      .sort((a, b) => b.syncedAt - a.syncedAt)
      .map((x) => x.id);
  }

  invoiceRecords = new Map<string, StripeInvoiceRecord>();
  fiscalDocs: FiscalDocument[] = [];
  async upsertInvoiceRecord(r: StripeInvoiceRecord) {
    const prev = this.invoiceRecords.get(r.stripeInvoiceId);
    if (prev && this.foreign("invoices", r.stripeInvoiceId)) throw new StripeStoreError("mode_mismatch", "La factura pertenece a otro modo");
    this.invoiceRecords.set(r.stripeInvoiceId, prev ? { ...r, createdAt: prev.createdAt, amountRefundedCents: Math.max(prev.amountRefundedCents, r.amountRefundedCents) } : { ...r });
    this.stamp("invoices", r.stripeInvoiceId);
  }
  async invoiceRecord(id: string) {
    const r = this.invoiceRecords.get(id);
    return r && this.mine("invoices", id) ? { ...r } : null;
  }
  async listInvoiceRecords(q: { orderId?: number; limit: number }) {
    return Array.from(this.invoiceRecords.values())
      .filter((r) => this.mine("invoices", r.stripeInvoiceId) && (q.orderId === undefined || r.orderId === q.orderId))
      .slice(0, q.limit)
      .map((r) => ({ ...r }));
  }
  async setInvoiceRefunded(id: string, refunded: number, now: number) {
    const r = this.invoiceRecords.get(id);
    if (r && this.mine("invoices", id) && refunded > r.amountRefundedCents) this.invoiceRecords.set(id, { ...r, amountRefundedCents: refunded, updatedAt: now });
  }
  async enqueueFiscalDocument(d: FiscalDocumentDraft) {
    const prev = this.fiscalDocs.find((x) => x.sourceKey === d.sourceKey && this.mine("documents", x.id));
    if (prev) return { created: false, document: { ...prev } };
    const doc: FiscalDocument = { ...d, id: this.fiscalDocs.length + 1, status: "pending", externalRef: null, issuedAt: null, issuedBy: null, lastError: null };
    this.fiscalDocs.push(doc);
    this.stamp("documents", doc.id);
    return { created: true, document: { ...doc } };
  }
  async fiscalDocumentBySource(key: string) {
    const d = this.fiscalDocs.find((x) => x.sourceKey === key && this.mine("documents", x.id));
    return d ? { ...d } : null;
  }
  async listFiscalDocuments(q: { status?: FiscalDocumentStatus; orderId?: number; limit: number }) {
    return this.fiscalDocs
      .filter((x) => this.mine("documents", x.id) && (!q.status || x.status === q.status) && (q.orderId === undefined || x.orderId === q.orderId))
      .slice(0, q.limit)
      .map((x) => ({ ...x }));
  }
  async markFiscalDocumentIssued(id: number, externalRef: string, by: string, at: number) {
    const d = this.fiscalDocs.find((x) => x.id === id && this.mine("documents", x.id));
    if (!d) return null;
    if (d.status === "issued") {
      if (d.externalRef !== externalRef) throw new FiscalDocumentConflictError("El documento ya está emitido con otra referencia");
      return { ...d };
    }
    Object.assign(d, { status: "issued", externalRef, issuedAt: at, issuedBy: by, lastError: null });
    return { ...d };
  }

  buyers = new Map<number, BuyerProfile>();
  buyerHistory: Array<{ orderId: number; version: number; actor: string; snapshot: BuyerProfile }> = [];
  async buyerProfile(orderId: number) {
    const p = this.buyers.get(orderId);
    return p && this.mine("buyers", orderId) ? structuredClone(p) : null;
  }
  async hasBuyerAddressColumn() {
    return true;
  }
  vatChecks: VatCheck[] = [];
  async recordVatCheck(c: VatCheck) {
    this.vatChecks.push(structuredClone(c));
  }
  async lastValidVatCheck(country: string, vatNumber: string) {
    const hit = this.vatChecks.filter((x) => x.country === country && x.vatNumber === vatNumber && x.status === "valid").sort((a, b) => b.checkedAt - a.checkedAt)[0];
    return hit ? structuredClone(hit) : null;
  }
  async vatChecksOfOrder(orderId: number) {
    // Más recientes primero; a igual hora, la última registrada (como MySQL: checked_at DESC, id DESC)
    return this.vatChecks.map((x, i) => ({ x, i })).filter(({ x }) => x.orderId === orderId).sort((a, b) => b.x.checkedAt - a.x.checkedAt || b.i - a.i).map(({ x }) => structuredClone(x));
  }
  async hasVatCheckTable() {
    return true;
  }
  async saveBuyerProfile(d: BuyerProfileDraft, actor: string) {
    const prev = this.buyers.get(d.orderId);
    if (prev && this.foreign("buyers", d.orderId)) throw new StripeStoreError("mode_mismatch", "El perfil del comprador pertenece a otro modo");
    const { now, ...rest } = d;
    const p: BuyerProfile = { ...structuredClone(rest), version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now, updatedAt: now };
    this.buyers.set(d.orderId, p);
    this.stamp("buyers", d.orderId);
    this.buyerHistory.push({ orderId: d.orderId, version: p.version, actor, snapshot: structuredClone(p) });
    return structuredClone(p);
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
    /** Registro de eventos comerciales (0015); sin él, todo funciona igual y no se registra nada. */
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
  async subscriptionsOfCompany(companyId: number) {
    const [rows] = await this.pool.query<Row[]>(
      "SELECT stripe_subscription_id FROM stripe_subscriptions WHERE company_id = ? AND livemode = ? AND status NOT IN ('canceled','incomplete_expired') ORDER BY synced_at DESC",
      [companyId, this.lm],
    );
    return rows.map((r) => String(r.stripe_subscription_id));
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

  private invoiceRow = (r: Row): StripeInvoiceRecord => ({
    stripeInvoiceId: String(r.stripe_invoice_id),
    orderId: Number(r.order_id),
    stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (r.stripe_subscription_id as string | null) ?? null,
    number: (r.number as string | null) ?? null,
    status: r.status as StripeInvoiceRecord["status"],
    billingReason: (r.billing_reason as string | null) ?? null,
    purpose: r.purpose as StripeInvoiceRecord["purpose"],
    currency: String(r.currency),
    subtotalCents: Number(r.subtotal_cents),
    taxCents: r.tax_cents === null || r.tax_cents === undefined ? null : Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    amountPaidCents: Number(r.amount_paid_cents),
    amountRefundedCents: Number(r.amount_refunded_cents),
    periodStart: r.period_start === null || r.period_start === undefined ? null : Number(r.period_start),
    customerCountry: (r.customer_country as string | null) ?? null,
    customerPostalCode: (r.customer_postal_code as string | null) ?? null,
    buyerScenario: (r.buyer_scenario as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });
  private docRow = (r: Row): FiscalDocument => ({
    id: Number(r.id),
    kind: r.kind as FiscalDocument["kind"],
    sourceKey: String(r.source_key),
    orderId: Number(r.order_id),
    stripeInvoiceId: String(r.stripe_invoice_id),
    stripeChargeId: (r.stripe_charge_id as string | null) ?? null,
    originalDocumentId: r.original_document_id === null || r.original_document_id === undefined ? null : Number(r.original_document_id),
    currency: String(r.currency),
    baseCents: Number(r.base_cents),
    taxCents: r.tax_cents === null || r.tax_cents === undefined ? null : Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    status: r.status as FiscalDocumentStatus,
    externalRef: (r.external_ref as string | null) ?? null,
    issuedAt: r.issued_at === null || r.issued_at === undefined ? null : Number(r.issued_at),
    issuedBy: (r.issued_by as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    createdAt: Number(r.created_at),
  });
  async upsertInvoiceRecord(r: StripeInvoiceRecord) {
    const [cur] = await this.pool.query<Row[]>("SELECT livemode FROM stripe_invoices WHERE stripe_invoice_id = ?", [r.stripeInvoiceId]);
    if (cur[0] && Number(cur[0].livemode) !== this.lm) throw new StripeStoreError("mode_mismatch", "La factura pertenece a otro modo");
    await this.pool.query(
      `INSERT INTO stripe_invoices (stripe_invoice_id, livemode, order_id, stripe_customer_id, stripe_subscription_id, number, status, billing_reason, purpose, currency, subtotal_cents, tax_cents, total_cents, amount_paid_cents, amount_refunded_cents, period_start, customer_country, customer_postal_code, buyer_scenario, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE number = VALUES(number), status = VALUES(status), subtotal_cents = VALUES(subtotal_cents), tax_cents = VALUES(tax_cents), total_cents = VALUES(total_cents),
         amount_paid_cents = VALUES(amount_paid_cents), amount_refunded_cents = GREATEST(amount_refunded_cents, VALUES(amount_refunded_cents)), updated_at = VALUES(updated_at)`,
      [r.stripeInvoiceId, this.lm, r.orderId, r.stripeCustomerId, r.stripeSubscriptionId, r.number, r.status, r.billingReason, r.purpose, r.currency, r.subtotalCents, r.taxCents, r.totalCents, r.amountPaidCents, r.amountRefundedCents, r.periodStart, r.customerCountry, r.customerPostalCode, r.buyerScenario, r.createdAt, r.updatedAt],
    );
  }
  async invoiceRecord(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_invoices WHERE stripe_invoice_id = ? AND livemode = ?", [id, this.lm]);
    return rows[0] ? this.invoiceRow(rows[0]) : null;
  }
  async listInvoiceRecords(q: { orderId?: number; limit: number }) {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT * FROM stripe_invoices WHERE livemode = ?${q.orderId === undefined ? "" : " AND order_id = ?"} ORDER BY created_at DESC LIMIT ?`,
      q.orderId === undefined ? [this.lm, q.limit] : [this.lm, q.orderId, q.limit],
    );
    return rows.map(this.invoiceRow);
  }
  async setInvoiceRefunded(id: string, refunded: number, now: number) {
    await this.pool.query("UPDATE stripe_invoices SET amount_refunded_cents = ?, updated_at = ? WHERE stripe_invoice_id = ? AND livemode = ? AND amount_refunded_cents < ?", [refunded, now, id, this.lm, refunded]);
  }
  async enqueueFiscalDocument(d: FiscalDocumentDraft) {
    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(
        "INSERT INTO fiscal_documents (livemode, kind, source_key, order_id, stripe_invoice_id, stripe_charge_id, original_document_id, currency, base_cents, tax_cents, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [this.lm, d.kind, d.sourceKey, d.orderId, d.stripeInvoiceId, d.stripeChargeId, d.originalDocumentId, d.currency, d.baseCents, d.taxCents, d.totalCents, d.createdAt],
      );
      const [rows] = await this.pool.query<Row[]>("SELECT * FROM fiscal_documents WHERE id = ?", [res.insertId]);
      return { created: true, document: this.docRow(rows[0]) };
    } catch (e) {
      if (!isDup(e)) throw e;
      const existing = await this.fiscalDocumentBySource(d.sourceKey);
      if (!existing) throw new StripeStoreError("mode_mismatch", "El documento fiscal pertenece a otro modo");
      return { created: false, document: existing };
    }
  }
  async fiscalDocumentBySource(key: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fiscal_documents WHERE source_key = ? AND livemode = ?", [key, this.lm]);
    return rows[0] ? this.docRow(rows[0]) : null;
  }
  async listFiscalDocuments(q: { status?: FiscalDocumentStatus; orderId?: number; limit: number }) {
    const where = ["livemode = ?"];
    const args: unknown[] = [this.lm];
    if (q.status) {
      where.push("status = ?");
      args.push(q.status);
    }
    if (q.orderId !== undefined) {
      where.push("order_id = ?");
      args.push(q.orderId);
    }
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM fiscal_documents WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`, [...args, q.limit]);
    return rows.map(this.docRow);
  }
  async markFiscalDocumentIssued(id: number, externalRef: string, by: string, at: number) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      "UPDATE fiscal_documents SET status = 'issued', external_ref = ?, issued_at = ?, issued_by = ?, last_error = NULL WHERE id = ? AND livemode = ? AND status IN ('pending','failed')",
      [externalRef, at, by.slice(0, 120), id, this.lm],
    );
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM fiscal_documents WHERE id = ? AND livemode = ?", [id, this.lm]);
    if (!rows[0]) return null;
    const d = this.docRow(rows[0]);
    if (res.affectedRows === 0 && d.externalRef !== externalRef) throw new FiscalDocumentConflictError("El documento ya está emitido con otra referencia");
    return d;
  }

  private vatTable?: Promise<boolean>;
  hasVatCheckTable(): Promise<boolean> {
    this.vatTable ??= this.pool.query("SELECT 1 FROM stripe_vat_checks LIMIT 0").then(
      () => true,
      () => false,
    );
    return this.vatTable;
  }
  private vatRow = (r: Row): VatCheck => ({
    status: r.status as VatCheck["status"],
    country: String(r.country),
    vatNumber: String(r.vat_number),
    checkedAt: Number(r.checked_at),
    consultationNumber: (r.consultation_number as string | null) ?? null,
    traderName: (r.trader_name as string | null) ?? null,
    traderAddress: (r.trader_address as string | null) ?? null,
    detail: (r.detail as string | null) ?? null,
    orderId: r.order_id === null || r.order_id === undefined ? null : Number(r.order_id),
  });
  async recordVatCheck(c: VatCheck) {
    await this.pool.query(
      "INSERT INTO stripe_vat_checks (livemode, country, vat_number, status, consultation_number, trader_name, trader_address, detail, order_id, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [this.lm, c.country, c.vatNumber.slice(0, 20), c.status, c.consultationNumber?.slice(0, 64) ?? null, c.traderName?.slice(0, 400) ?? null, c.traderAddress?.slice(0, 400) ?? null, c.detail?.slice(0, 64) ?? null, c.orderId, c.checkedAt],
    );
  }
  async lastValidVatCheck(country: string, vatNumber: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_vat_checks WHERE livemode = ? AND country = ? AND vat_number = ? AND status = 'valid' ORDER BY checked_at DESC LIMIT 1", [this.lm, country, vatNumber]);
    return rows[0] ? this.vatRow(rows[0]) : null;
  }
  async vatChecksOfOrder(orderId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_vat_checks WHERE livemode = ? AND order_id = ? ORDER BY checked_at DESC, id DESC LIMIT 50", [this.lm, orderId]);
    return rows.map(this.vatRow);
  }

  private buyerRow = (r: Row): BuyerProfile => ({
    orderId: Number(r.order_id),
    type: r.buyer_type as BuyerProfile["type"],
    territory: r.territory as BuyerProfile["territory"],
    scenario: String(r.scenario) as BuyerProfile["scenario"],
    country: String(r.country),
    postalCode: (r.postal_code as string | null) ?? null,
    displayName: String(r.display_name),
    taxId: (r.tax_id as string | null) ?? null,
    taxIdStatus: r.tax_id_status as BuyerProfile["taxIdStatus"],
    billingEmail: (r.billing_email as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    billingAddress: (typeof r.billing_address_json === "string" ? JSON.parse(r.billing_address_json) : (r.billing_address_json ?? null)) as BuyerProfile["billingAddress"],
    consent: (typeof r.consent_json === "string" ? JSON.parse(r.consent_json) : r.consent_json) as ConsentRecord,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });
  async buyerProfile(orderId: number) {
    try {
      const [rows] = await this.pool.query<Row[]>("SELECT * FROM stripe_buyer_profiles WHERE order_id = ? AND livemode = ?", [orderId, this.lm]);
      return rows[0] ? this.buyerRow(rows[0]) : null;
    } catch (e) {
      // Sin la migración 0014 no hay perfiles: el llamador decide (en live, Checkout no se abre)
      if ((e as { code?: string })?.code === "ER_NO_SUCH_TABLE") return null;
      throw e;
    }
  }
  /** ¿Existe el domicilio de facturación del perfil (CRM 0020)? Se comprueba una vez; sin él no se guarda. */
  private addressColumn?: Promise<boolean>;
  hasBuyerAddressColumn(): Promise<boolean> {
    this.addressColumn ??= this.pool.query("SELECT billing_address_json FROM stripe_buyer_profiles LIMIT 0").then(
      () => true,
      () => false,
    );
    return this.addressColumn;
  }
  async saveBuyerProfile(d: BuyerProfileDraft, actor: string) {
    const withAddress = await this.hasBuyerAddressColumn();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [cur] = await conn.query<Row[]>("SELECT version, livemode, created_at FROM stripe_buyer_profiles WHERE order_id = ? FOR UPDATE", [d.orderId]);
      if (cur[0] && Number(cur[0].livemode) !== this.lm) throw new StripeStoreError("mode_mismatch", "El perfil del comprador pertenece a otro modo");
      const version = (cur[0] ? Number(cur[0].version) : 0) + 1;
      const createdAt = cur[0] ? Number(cur[0].created_at) : d.now;
      const cols = [d.type, d.territory, d.scenario, d.country, d.postalCode, d.displayName, d.taxId, d.taxIdStatus, d.billingEmail, d.contactName, JSON.stringify(d.consent), version, d.now];
      // Domicilio (0020): solo si la columna existe; si no, el perfil se guarda como antes y sin dirección
      const addrCol = withAddress ? ", billing_address_json = ?" : "";
      const addrVal = withAddress ? [d.billingAddress ? JSON.stringify(d.billingAddress) : null] : [];
      if (cur[0]) {
        await conn.query(
          `UPDATE stripe_buyer_profiles SET buyer_type = ?, territory = ?, scenario = ?, country = ?, postal_code = ?, display_name = ?, tax_id = ?, tax_id_status = ?, billing_email = ?, contact_name = ?, consent_json = ?, version = ?, updated_at = ?${addrCol} WHERE order_id = ? AND livemode = ?`,
          [...cols, ...addrVal, d.orderId, this.lm],
        );
      } else {
        await conn.query(
          `INSERT INTO stripe_buyer_profiles (buyer_type, territory, scenario, country, postal_code, display_name, tax_id, tax_id_status, billing_email, contact_name, consent_json, version, updated_at, order_id, livemode, created_at${withAddress ? ", billing_address_json" : ""}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withAddress ? ", ?" : ""})`,
          [...cols, d.orderId, this.lm, createdAt, ...addrVal],
        );
      }
      const { now, ...rest } = d;
      const saved: BuyerProfile = { ...rest, billingAddress: withAddress ? (d.billingAddress ?? null) : null, version, createdAt, updatedAt: now };
      await conn.query("INSERT INTO stripe_buyer_profile_events (order_id, livemode, version, actor, snapshot_json, at) VALUES (?, ?, ?, ?, ?, ?)", [d.orderId, this.lm, version, actor.slice(0, 120), JSON.stringify(saved), now]);
      await conn.commit();
      return saved;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }
}
