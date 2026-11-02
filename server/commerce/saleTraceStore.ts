/**
 * Lecturas de la traza de un alta de pago (./saleTrace.ts) en la BD del CRM. SOLO LECTURA (SELECT) sobre tablas que ya
 * existen: Checkout (0012), suscripciones y eventos de Stripe (0012), facturas de Stripe y documentos fiscales (0016),
 * cambios de partidas (0018), facturación propia (0027), bandeja de correo (0011) y pagos de los pedidos (0010).
 * Cada lectura filtra por el modo de Stripe del entorno (`livemode`). Una tabla que aún no existe se lee vacía.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { PaymentMode } from "../orchestrator/types";
import type {
  SaleTraceReader,
  TraceChange,
  TraceFiscalDocument,
  TraceMail,
  TraceOwnInvoice,
  TraceSession,
  TraceStripeEvent,
  TraceStripeInvoice,
  TraceStripeSubscription,
} from "./saleTrace";

type Row = RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
/** Plataforma: los correos de la facturación propia se encolan con este tenant. */
const PLATFORM_TENANT = "platform";

export class MysqlSaleTraceReader implements SaleTraceReader {
  private readonly lm: number;
  constructor(
    private pool: mysql.Pool,
    mode: PaymentMode,
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }

  /** Consulta tolerante: sin la tabla (migración aún no aplicada), lista vacía. */
  private async rows(sql: string, args: unknown[]): Promise<Row[]> {
    try {
      const [rows] = await this.pool.query<Row[]>(sql, args);
      return rows;
    } catch (e) {
      if ((e as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
      throw e;
    }
  }

  async sessions(orderId: number): Promise<TraceSession[]> {
    const rows = await this.rows("SELECT stripe_session_id, status, payment_status, created_at, completed_at FROM stripe_checkout_sessions WHERE order_id = ? AND livemode = ? ORDER BY id", [orderId, this.lm]);
    return rows.map((r) => ({ id: String(r.stripe_session_id), status: r.status as TraceSession["status"], paymentStatus: str(r.payment_status), createdAt: Number(r.created_at), completedAt: num(r.completed_at) }));
  }

  async change(orderId: number): Promise<TraceChange | null> {
    const [r] = await this.rows("SELECT stripe_subscription_id, status, stripe_invoice_id, detail, created_at, updated_at FROM stripe_subscription_changes WHERE order_id = ? AND livemode = ? LIMIT 1", [orderId, this.lm]);
    return r ? { stripeSubscriptionId: String(r.stripe_subscription_id), status: r.status as TraceChange["status"], stripeInvoiceId: str(r.stripe_invoice_id), detail: str(r.detail), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) } : null;
  }

  async stripeSubscriptions(orderId: number, ids: string[]): Promise<TraceStripeSubscription[]> {
    const rows = await this.rows(
      `SELECT stripe_subscription_id, status, order_id, company_id, tenant_id, synced_at FROM stripe_subscriptions WHERE livemode = ? AND (order_id = ?${ids.length ? " OR stripe_subscription_id IN (?)" : ""})`,
      ids.length ? [this.lm, orderId, ids] : [this.lm, orderId],
    );
    return rows.map((r) => ({ id: String(r.stripe_subscription_id), status: String(r.status), orderId: num(r.order_id), companyId: Number(r.company_id), tenantId: str(r.tenant_id), syncedAt: Number(r.synced_at) }));
  }

  async stripeEvents(objectIds: string[]): Promise<TraceStripeEvent[]> {
    const ids = Array.from(new Set(objectIds.filter(Boolean)));
    if (!ids.length) return [];
    const rows = await this.rows(
      "SELECT event_id, type, object_id, status, attempts, last_error, source, stripe_created, received_at, processed_at, next_attempt_at FROM stripe_events WHERE livemode = ? AND object_id IN (?) ORDER BY received_at LIMIT 200",
      [this.lm, ids],
    );
    return rows.map((r) => ({
      id: String(r.event_id),
      type: String(r.type),
      objectId: str(r.object_id),
      status: r.status as TraceStripeEvent["status"],
      attempts: Number(r.attempts),
      lastError: str(r.last_error),
      source: r.source as TraceStripeEvent["source"],
      stripeCreated: Number(r.stripe_created),
      receivedAt: Number(r.received_at),
      processedAt: num(r.processed_at),
      nextAttemptAt: num(r.next_attempt_at),
    }));
  }

  async stripeInvoices(orderId: number): Promise<TraceStripeInvoice[]> {
    const rows = await this.rows("SELECT stripe_invoice_id, status, purpose, total_cents, currency, created_at FROM stripe_invoices WHERE order_id = ? AND livemode = ? ORDER BY created_at LIMIT 50", [orderId, this.lm]);
    return rows.map((r) => ({ id: String(r.stripe_invoice_id), status: String(r.status), purpose: String(r.purpose), totalCents: Number(r.total_cents), currency: String(r.currency), createdAt: Number(r.created_at) }));
  }

  async fiscalDocuments(orderId: number): Promise<TraceFiscalDocument[]> {
    const rows = await this.rows("SELECT id, kind, stripe_invoice_id, status, external_ref, issued_at, last_error, created_at FROM fiscal_documents WHERE order_id = ? AND livemode = ? ORDER BY id LIMIT 50", [orderId, this.lm]);
    return rows.map((r) => ({ id: Number(r.id), kind: r.kind as TraceFiscalDocument["kind"], stripeInvoiceId: String(r.stripe_invoice_id), status: r.status as TraceFiscalDocument["status"], externalRef: str(r.external_ref), issuedAt: num(r.issued_at), lastError: str(r.last_error), createdAt: Number(r.created_at) }));
  }

  async ownInvoices(q: { orderId: number; companyId: number; stripeInvoiceIds: string[] }): Promise<TraceOwnInvoice[]> {
    const refs = q.stripeInvoiceIds.map((id) => `stripe:in:${id}`);
    const rows = await this.rows(
      `SELECT id, status, number, payment_ref, billing_ref, issued_at FROM invoices WHERE livemode = ? AND company_id = ? AND kind = 'invoice' AND (billing_ref = ?${refs.length ? " OR payment_ref IN (?)" : ""}) ORDER BY id LIMIT 20`,
      refs.length ? [this.lm, q.companyId, `order:${q.orderId}`, refs] : [this.lm, q.companyId, `order:${q.orderId}`],
    );
    return rows.map((r) => ({ id: Number(r.id), status: String(r.status), number: str(r.number), paymentRef: str(r.payment_ref), billingRef: String(r.billing_ref), issuedAt: num(r.issued_at) }));
  }

  async mails(tenantId: string | null, keys: string[]): Promise<TraceMail[]> {
    if (!keys.length) return [];
    const tenants = Array.from(new Set([PLATFORM_TENANT, ...(tenantId ? [tenantId] : [])]));
    const rows = await this.rows("SELECT idempotency_key, status, created_at FROM mail_outbox WHERE tenant_id IN (?) AND idempotency_key IN (?) LIMIT 20", [tenants, keys]);
    return rows.map((r) => ({ key: String(r.idempotency_key), status: String(r.status), createdAt: Number(r.created_at) }));
  }

  async recentSales(since: number, mode: PaymentMode): Promise<Array<{ orderId: number; paidAt: number }>> {
    const rows = await this.rows(
      "SELECT order_id, MIN(COALESCE(settled_at, created_at)) AS paid_at FROM commercial_payments WHERE status = 'succeeded' AND purpose IN ('initial','change') AND mode = ? AND COALESCE(settled_at, created_at) >= ? GROUP BY order_id ORDER BY paid_at DESC LIMIT 200",
      [mode, since],
    );
    return rows.map((r) => ({ orderId: Number(r.order_id), paidAt: Number(r.paid_at) }));
  }
}
