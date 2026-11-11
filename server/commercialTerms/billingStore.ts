/**
 * Registro del cobro en Stripe de las condiciones personalizadas (CRM 0049): qué suscripciones puso un operador a
 * cobrar, su sesión de Checkout pendiente, la suscripción de Stripe enlazada, su estado de cobro y sus facturas.
 *
 * Es el SEGUNDO cerrojo del cobro: una suscripción sin fila aquí sigue en simulación aunque el interruptor esté
 * encendido, y la pasarela solo toca en Stripe las suscripciones que constan en este registro.
 */
import type mysql from "mysql2/promise";

/**
 * pending: sesión de Checkout creada, sin primer cobro · active: al corriente · past_due: impago, en gracia ·
 * suspended: impago agotado o cobro revertido · cancel_scheduled: al corriente con el fin programado ·
 * canceled: terminada en Stripe · abandoned: el cliente no llegó a pagar y Stripe la dio por caducada.
 */
export type BillingState = "pending" | "active" | "past_due" | "suspended" | "cancel_scheduled" | "canceled" | "abandoned";
export const LINKED_STATES: readonly BillingState[] = ["active", "past_due", "suspended", "cancel_scheduled"];

/** Lo que ofrecía la sesión de Checkout: se compara al reutilizarla y al registrar la primera factura. */
export interface CheckoutOffer {
  /** Huella de las partidas e importes ofrecidos. */
  hash: string;
  /** Fecha del primer cargo si se aplazó al inicio del acuerdo (el cliente solo autoriza el método de pago); null: al pagar. */
  firstChargeAt?: number | null;
  termsId: number;
  currency: string;
  recurringCents: number;
  firstChargeCents: number;
  /** Cargos únicos incluidos en el primer pago: clave → céntimos. */
  oneOffs: Record<string, number>;
  /** Abonos de un solo uso que no caben en Checkout: se envían a la factura siguiente al enlazar. */
  deferredCredits: string[];
  taxTreatment: string;
}

export interface TermsBillingRow {
  id: number;
  subscriptionId: number;
  companyId: number;
  status: BillingState;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  sessionId: string | null;
  sessionStatus: "open" | "complete" | "expired" | null;
  sessionExpiresAt: number | null;
  sessionSeq: number;
  checkout: CheckoutOffer | null;
  stripeStatus: string | null;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  /** Un operador pidió de forma expresa el fin de la suscripción de Stripe (ms); null: no. */
  cancelRequestedAt: number | null;
  graceEndsAt: number | null;
  readOnlyUntil: number | null;
  lastPaidInvoiceId: string | null;
  /** Factura cuyo cobro se revirtió (reembolso total o disputa perdida): retiene el acceso mientras sea la última pagada. */
  heldInvoiceId: string | null;
  /** Licencias que suspendió el impago (para devolver solo esas). */
  suspendedCapabilities: Array<{ capabilityId: string; siteId: string | null }> | null;
  startedBy: string;
  startedAt: number;
  linkedAt: number | null;
  syncedAt: number | null;
  updatedAt: number;
  version: number;
}

export type TermsBillingPatch = Partial<Omit<TermsBillingRow, "id" | "subscriptionId" | "companyId" | "startedBy" | "startedAt" | "version" | "updatedAt">>;

export interface TermsBillingInvoice {
  billingId: number;
  subscriptionId: number;
  stripeInvoiceId: string;
  status: string;
  billingReason: string | null;
  number: string | null;
  currency: string;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  amountPaidCents: number;
  periodStart: number | null;
  /** Resultado de contrastar el impuesto de Stripe con el tipo pactado (null: sin comprobar). */
  taxCheck: string | null;
  coverageLost: boolean;
  paidAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class BillingStoreConflict extends Error {
  constructor(message = "Otro proceso cambió el registro del cobro") {
    super(message);
    this.name = "BillingStoreConflict";
  }
}

export interface TermsBillingStore {
  bySubscription(subscriptionId: number): Promise<TermsBillingRow | null>;
  byStripeSubscription(stripeSubscriptionId: string): Promise<TermsBillingRow | null>;
  bySession(sessionId: string): Promise<TermsBillingRow | null>;
  /** Alta de la fila (una por suscripción). Si ya existe, devuelve la existente con `created: false`. */
  create(r: { subscriptionId: number; companyId: number; stripeCustomerId: string; startedBy: string; now: number }): Promise<{ row: TermsBillingRow; created: boolean }>;
  /** Cambia la fila solo si nadie la tocó desde `expectedVersion` (lanza `BillingStoreConflict`). */
  patch(id: number, patch: TermsBillingPatch, expectedVersion: number, now: number): Promise<TermsBillingRow>;
  list(f: { status?: readonly BillingState[]; syncedBefore?: number; sessionExpiredBefore?: number; limit?: number }): Promise<TermsBillingRow[]>;
  /** Guarda la factura (una fila por factura de Stripe). Devuelve la anterior, si la había. */
  upsertInvoice(i: Omit<TermsBillingInvoice, "createdAt" | "updatedAt">, now: number): Promise<{ previous: TermsBillingInvoice | null; current: TermsBillingInvoice }>;
  invoice(stripeInvoiceId: string): Promise<TermsBillingInvoice | null>;
  invoices(billingId: number, limit?: number): Promise<TermsBillingInvoice[]>;
}

const clone = <T>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

// ── Memoria (pruebas y desarrollo) ──────────────────────────────────────────────

export class MemoryTermsBillingStore implements TermsBillingStore {
  private rows = new Map<number, TermsBillingRow>();
  private invs = new Map<string, TermsBillingInvoice>();
  private seq = 0;

  private find(fn: (r: TermsBillingRow) => boolean) {
    const r = Array.from(this.rows.values()).find(fn);
    return r ? clone(r) : null;
  }
  async bySubscription(id: number) {
    return this.find((r) => r.subscriptionId === id);
  }
  async byStripeSubscription(id: string) {
    return this.find((r) => r.stripeSubscriptionId === id);
  }
  async bySession(id: string) {
    return this.find((r) => r.sessionId === id);
  }
  async create(r: { subscriptionId: number; companyId: number; stripeCustomerId: string; startedBy: string; now: number }) {
    const cur = await this.bySubscription(r.subscriptionId);
    if (cur) return { row: cur, created: false };
    const row: TermsBillingRow = {
      id: ++this.seq,
      subscriptionId: r.subscriptionId,
      companyId: r.companyId,
      status: "pending",
      stripeCustomerId: r.stripeCustomerId,
      stripeSubscriptionId: null,
      sessionId: null,
      sessionStatus: null,
      sessionExpiresAt: null,
      sessionSeq: 0,
      checkout: null,
      stripeStatus: null,
      currentPeriodEnd: null,
      cancelAt: null,
      cancelRequestedAt: null,
      graceEndsAt: null,
      readOnlyUntil: null,
      lastPaidInvoiceId: null,
      heldInvoiceId: null,
      suspendedCapabilities: null,
      startedBy: r.startedBy,
      startedAt: r.now,
      linkedAt: null,
      syncedAt: null,
      updatedAt: r.now,
      version: 1,
    };
    this.rows.set(row.id, row);
    return { row: clone(row), created: true };
  }
  async patch(id: number, patch: TermsBillingPatch, expectedVersion: number, now: number) {
    const cur = this.rows.get(id);
    if (!cur || cur.version !== expectedVersion) throw new BillingStoreConflict();
    if (patch.stripeSubscriptionId && Array.from(this.rows.values()).some((r) => r.id !== id && r.stripeSubscriptionId === patch.stripeSubscriptionId)) throw new BillingStoreConflict("La suscripción de Stripe ya está enlazada a otra contratación");
    const next = { ...cur, ...clone(patch), updatedAt: now, version: cur.version + 1 };
    this.rows.set(id, next);
    return clone(next);
  }
  async list(f: { status?: readonly BillingState[]; syncedBefore?: number; sessionExpiredBefore?: number; limit?: number }) {
    return Array.from(this.rows.values())
      .filter((r) => (!f.status || f.status.includes(r.status)) && (f.syncedBefore === undefined || (r.syncedAt ?? 0) < f.syncedBefore) && (f.sessionExpiredBefore === undefined || (r.sessionStatus === "open" && (r.sessionExpiresAt ?? 0) < f.sessionExpiredBefore)))
      .sort((a, b) => (a.syncedAt ?? 0) - (b.syncedAt ?? 0) || a.id - b.id)
      .slice(0, f.limit ?? 200)
      .map((r) => clone(r));
  }
  async upsertInvoice(i: Omit<TermsBillingInvoice, "createdAt" | "updatedAt">, now: number) {
    const previous = this.invs.get(i.stripeInvoiceId) ?? null;
    // Lo ya sabido no se pierde: el cobro revertido, la comprobación del impuesto y la fecha del primer cobro
    const current: TermsBillingInvoice = { ...i, coverageLost: i.coverageLost, taxCheck: i.taxCheck ?? previous?.taxCheck ?? null, paidAt: previous?.paidAt ?? i.paidAt, createdAt: previous?.createdAt ?? now, updatedAt: now };
    this.invs.set(i.stripeInvoiceId, current);
    return { previous: previous ? clone(previous) : null, current: clone(current) };
  }
  async invoice(id: string) {
    const i = this.invs.get(id);
    return i ? clone(i) : null;
  }
  async invoices(billingId: number, limit = 50) {
    return Array.from(this.invs.values())
      .filter((i) => i.billingId === billingId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((i) => clone(i));
  }
}

// ── MySQL (BD del CRM) ──────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket;
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : ((typeof v === "string" ? JSON.parse(v) : v) as T));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY";

const COLUMNS: Record<keyof TermsBillingPatch, string> = {
  status: "status",
  stripeCustomerId: "stripe_customer_id",
  stripeSubscriptionId: "stripe_subscription_id",
  sessionId: "session_id",
  sessionStatus: "session_status",
  sessionExpiresAt: "session_expires_at",
  sessionSeq: "session_seq",
  checkout: "checkout_json",
  stripeStatus: "stripe_status",
  currentPeriodEnd: "current_period_end",
  cancelAt: "cancel_at",
  cancelRequestedAt: "cancel_requested_at",
  graceEndsAt: "grace_ends_at",
  readOnlyUntil: "read_only_until",
  lastPaidInvoiceId: "last_paid_invoice_id",
  heldInvoiceId: "held_invoice_id",
  suspendedCapabilities: "suspended_capabilities",
  linkedAt: "linked_at",
  syncedAt: "synced_at",
};
const JSON_COLUMNS = new Set<string>(["checkout_json", "suspended_capabilities"]);

export class MysqlTermsBillingStore implements TermsBillingStore {
  private lm: number;
  constructor(
    private pool: mysql.Pool,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }

  private row = (r: Row): TermsBillingRow => ({
    id: Number(r.id),
    subscriptionId: Number(r.subscription_id),
    companyId: Number(r.company_id),
    status: r.status as BillingState,
    stripeCustomerId: String(r.stripe_customer_id),
    stripeSubscriptionId: str(r.stripe_subscription_id),
    sessionId: str(r.session_id),
    sessionStatus: (r.session_status as TermsBillingRow["sessionStatus"]) ?? null,
    sessionExpiresAt: num(r.session_expires_at),
    sessionSeq: Number(r.session_seq),
    checkout: json<CheckoutOffer>(r.checkout_json),
    stripeStatus: str(r.stripe_status),
    currentPeriodEnd: num(r.current_period_end),
    cancelAt: num(r.cancel_at),
    cancelRequestedAt: num(r.cancel_requested_at),
    graceEndsAt: num(r.grace_ends_at),
    readOnlyUntil: num(r.read_only_until),
    lastPaidInvoiceId: str(r.last_paid_invoice_id),
    heldInvoiceId: str(r.held_invoice_id),
    suspendedCapabilities: json(r.suspended_capabilities),
    startedBy: String(r.started_by),
    startedAt: Number(r.started_at),
    linkedAt: num(r.linked_at),
    syncedAt: num(r.synced_at),
    updatedAt: Number(r.updated_at),
    version: Number(r.version),
  });
  private inv = (r: Row): TermsBillingInvoice => ({
    billingId: Number(r.billing_id),
    subscriptionId: Number(r.subscription_id),
    stripeInvoiceId: String(r.stripe_invoice_id),
    status: String(r.status),
    billingReason: str(r.billing_reason),
    number: str(r.invoice_number),
    currency: String(r.currency),
    subtotalCents: num(r.subtotal_cents),
    taxCents: num(r.tax_cents),
    totalCents: num(r.total_cents),
    amountPaidCents: Number(r.amount_paid_cents),
    periodStart: num(r.period_start),
    taxCheck: str(r.tax_check),
    coverageLost: Number(r.coverage_lost) === 1,
    paidAt: num(r.paid_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });

  private async one(where: string, params: unknown[]) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM commercial_terms_billing WHERE ${where} AND livemode = ? LIMIT 1`, [...params, this.lm]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  bySubscription(id: number) {
    return this.one("subscription_id = ?", [id]);
  }
  byStripeSubscription(id: string) {
    return this.one("stripe_subscription_id = ?", [id]);
  }
  bySession(id: string) {
    return this.one("session_id = ?", [id]);
  }
  async create(r: { subscriptionId: number; companyId: number; stripeCustomerId: string; startedBy: string; now: number }) {
    try {
      await this.pool.query("INSERT INTO commercial_terms_billing (subscription_id, company_id, livemode, status, stripe_customer_id, started_by, started_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)", [
        r.subscriptionId,
        r.companyId,
        this.lm,
        r.stripeCustomerId,
        r.startedBy.slice(0, 100),
        r.now,
        r.now,
      ]);
      return { row: (await this.bySubscription(r.subscriptionId))!, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
      const cur = await this.bySubscription(r.subscriptionId);
      // Una fila del OTRO modo (pruebas/live) nunca se reutiliza
      if (!cur) throw new BillingStoreConflict("La suscripción ya tiene un registro de cobro con otro modo de Stripe (pruebas/live)");
      return { row: cur, created: false };
    }
  }
  async patch(id: number, patch: TermsBillingPatch, expectedVersion: number, now: number) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch) as Array<[keyof TermsBillingPatch, unknown]>) {
      const col = COLUMNS[k];
      if (!col || v === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(JSON_COLUMNS.has(col) && v !== null ? JSON.stringify(v) : v);
    }
    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE commercial_terms_billing SET ${[...sets, "updated_at = ?", "version = version + 1"].join(", ")} WHERE id = ? AND version = ? AND livemode = ?`, [...params, now, id, expectedVersion, this.lm]);
      if (res.affectedRows !== 1) throw new BillingStoreConflict();
    } catch (e) {
      if (isDup(e)) throw new BillingStoreConflict("La suscripción o la sesión de Stripe ya está enlazada a otra contratación");
      throw e;
    }
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM commercial_terms_billing WHERE id = ?", [id]);
    return this.row(rows[0]);
  }
  async list(f: { status?: readonly BillingState[]; syncedBefore?: number; sessionExpiredBefore?: number; limit?: number }) {
    const where = ["livemode = ?"];
    const params: unknown[] = [this.lm];
    if (f.status?.length) {
      where.push(`status IN (${f.status.map(() => "?").join(",")})`);
      params.push(...f.status);
    }
    if (f.syncedBefore !== undefined) {
      where.push("COALESCE(synced_at, 0) < ?");
      params.push(f.syncedBefore);
    }
    if (f.sessionExpiredBefore !== undefined) {
      where.push("session_status = 'open' AND COALESCE(session_expires_at, 0) < ?");
      params.push(f.sessionExpiredBefore);
    }
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM commercial_terms_billing WHERE ${where.join(" AND ")} ORDER BY COALESCE(synced_at, 0), id LIMIT ?`, [...params, f.limit ?? 200]);
    return rows.map(this.row);
  }
  async upsertInvoice(i: Omit<TermsBillingInvoice, "createdAt" | "updatedAt">, now: number) {
    const previous = await this.invoice(i.stripeInvoiceId);
    await this.pool.query(
      `INSERT INTO commercial_terms_billing_invoices (billing_id, subscription_id, stripe_invoice_id, status, billing_reason, invoice_number, currency, subtotal_cents, tax_cents, total_cents, amount_paid_cents, period_start, tax_check, coverage_lost, paid_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), billing_reason = VALUES(billing_reason), invoice_number = VALUES(invoice_number), subtotal_cents = VALUES(subtotal_cents), tax_cents = VALUES(tax_cents), total_cents = VALUES(total_cents),
         amount_paid_cents = VALUES(amount_paid_cents), period_start = VALUES(period_start), tax_check = COALESCE(VALUES(tax_check), tax_check), coverage_lost = VALUES(coverage_lost), paid_at = COALESCE(paid_at, VALUES(paid_at)), updated_at = VALUES(updated_at)`,
      [i.billingId, i.subscriptionId, i.stripeInvoiceId, i.status, i.billingReason, i.number, i.currency.slice(0, 3), i.subtotalCents, i.taxCents, i.totalCents, i.amountPaidCents, i.periodStart, i.taxCheck, i.coverageLost ? 1 : 0, i.paidAt, now, now],
    );
    return { previous, current: (await this.invoice(i.stripeInvoiceId))! };
  }
  async invoice(id: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM commercial_terms_billing_invoices WHERE stripe_invoice_id = ?", [id]);
    return rows[0] ? this.inv(rows[0]) : null;
  }
  async invoices(billingId: number, limit = 50) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM commercial_terms_billing_invoices WHERE billing_id = ? ORDER BY id DESC LIMIT ?", [billingId, limit]);
    return rows.map(this.inv);
  }
}
