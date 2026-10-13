/**
 * Almacén MySQL de facturación (`db/billing/0000_billing.sql`): BD comercial separada del
 * registro y de las BD de los tenants. Documentos JSON con columnas indexadas para consulta.
 */
import type mysql from "mysql2/promise";
import type { BillingStore } from "./ports";
import type { Invoice, Subscription } from "./types";

const doc = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

export class MysqlBillingStore implements BillingStore {
  constructor(private pool: mysql.Pool) {}

  async getSubscription(id: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT doc FROM billing_subscriptions WHERE id = ?", [id]);
    return r[0] ? doc<Subscription>(r[0].doc) : null;
  }
  async getSubscriptionByTenant(tenantId: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT doc FROM billing_subscriptions WHERE tenant_id = ?", [tenantId]);
    return r[0] ? doc<Subscription>(r[0].doc) : null;
  }
  async putSubscription(s: Subscription) {
    await this.pool.query(
      `INSERT INTO billing_subscriptions (id, tenant_id, status, period_end, doc) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), period_end = VALUES(period_end), doc = VALUES(doc)`,
      [s.id, s.tenantId, s.status, new Date(s.currentPeriodEnd), JSON.stringify(s)],
    );
  }
  async listSubscriptions() {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT doc FROM billing_subscriptions");
    return r.map((x) => doc<Subscription>(x.doc));
  }
  async getInvoice(id: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT doc FROM billing_invoices WHERE id = ?", [id]);
    return r[0] ? doc<Invoice>(r[0].doc) : null;
  }
  async listInvoices(tenantId: string) {
    const [r] = await this.pool.query<mysql.RowDataPacket[]>("SELECT doc FROM billing_invoices WHERE tenant_id = ? ORDER BY issued_at", [tenantId]);
    return r.map((x) => doc<Invoice>(x.doc));
  }
  async putInvoice(i: Invoice) {
    await this.pool.query(
      `INSERT INTO billing_invoices (id, tenant_id, number, status, issued_at, doc) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), doc = VALUES(doc)`,
      [i.id, i.tenantId, i.number, i.status, new Date(i.issuedAt), JSON.stringify(i)],
    );
  }
  /** Correlativo atómico por año (sin huecos por concurrencia). */
  async nextInvoiceNumber(year: number) {
    const conn = await this.pool.getConnection();
    try {
      await conn.query(
        "INSERT INTO billing_counters (year, last_number) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)",
        [year],
      );
      const [r] = await conn.query<mysql.RowDataPacket[]>("SELECT LAST_INSERT_ID() AS n");
      return `SAAS-${year}-${String(Number(r[0].n)).padStart(6, "0")}`;
    } finally {
      conn.release();
    }
  }
  async recordEvent(providerEventId: string, at: number) {
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO billing_events (provider_event_id, received_at) VALUES (?, ?)",
      [providerEventId, new Date(at)],
    );
    return res.affectedRows === 1;
  }
}
