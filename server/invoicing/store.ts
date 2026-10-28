/**
 * Almacén de la facturación propia (CRM 0027). Separa cada entorno por `livemode` (como Stripe) y garantiza:
 *  - una factura por hecho facturable (`source_key` única): crear dos veces devuelve la existente;
 *  - número correlativo por serie y año, asignado al EXPEDIR en una transacción con bloqueo de la serie;
 *  - huella encadenada con la anterior expedida de la serie.
 */
import type mysql from "mysql2/promise";
import { InvoicingError, type FiscalParty, type Invoice, type InvoiceLine, type NewInvoice, type PaymentStatus } from "./types";
import { invoiceHash, invoiceNumber } from "./rules";

export interface IssueInput {
  id: number;
  seriesCode: string;
  issueDate: string;
  issuer: FiscalParty;
  customer: FiscalParty;
  issuedBy: string;
  issuedAt: number;
}

export interface InvoicingStore {
  /** Crea el borrador del hecho o devuelve el que ya existe (`created: false`). */
  insertDraft(n: NewInvoice): Promise<{ invoice: Invoice; created: boolean }>;
  get(id: number): Promise<Invoice | null>;
  bySource(sourceKey: string): Promise<Invoice | null>;
  list(f?: { companyId?: number; status?: string; billingRef?: string; limit?: number }): Promise<Invoice[]>;
  /** Estado de cobro (independiente de la emisión). */
  setPayment(id: number, p: { paymentStatus: PaymentStatus; paymentRef: string | null; paidAt: number | null }, now: number): Promise<Invoice>;
  /** Expide un borrador: número correlativo, datos congelados y huella encadenada. `invalid_state` si ya no es borrador. */
  issue(i: IssueInput): Promise<Invoice>;
  /** Una factura expedida pasa a «rectificada» (su rectificativa total ya está expedida). */
  setStatus(id: number, status: "rectified", now: number): Promise<Invoice>;
}

const yearOf = (date: string) => Number(date.slice(0, 4));

export class MemoryInvoicingStore implements InvoicingStore {
  rows: Invoice[] = [];
  series = new Map<string, { next: number; lastHash: string | null }>();
  private seq = 0;
  private clone = (x: Invoice): Invoice => structuredClone(x);
  async insertDraft(n: NewInvoice) {
    const cur = this.rows.find((r) => r.sourceKey === n.sourceKey);
    if (cur) return { invoice: this.clone(cur), created: false };
    const inv: Invoice = { ...structuredClone(n), id: ++this.seq, status: "draft", seriesCode: null, number: null, issueDate: null, issuer: null, hash: null, previousHash: null, issuedAt: null, issuedBy: null, paidAt: null, updatedAt: n.createdAt, version: 1 };
    this.rows.push(inv);
    return { invoice: this.clone(inv), created: true };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? this.clone(r) : null;
  }
  async bySource(sourceKey: string) {
    const r = this.rows.find((x) => x.sourceKey === sourceKey);
    return r ? this.clone(r) : null;
  }
  async list(f: { companyId?: number; status?: string; billingRef?: string; limit?: number } = {}) {
    return this.rows
      .filter((r) => (f.companyId === undefined || r.companyId === f.companyId) && (!f.status || r.status === f.status) && (!f.billingRef || r.billingRef === f.billingRef))
      .sort((a, b) => b.id - a.id)
      .slice(0, f.limit ?? 200)
      .map(this.clone);
  }
  async setPayment(id: number, p: { paymentStatus: PaymentStatus; paymentRef: string | null; paidAt: number | null }, now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new InvoicingError("not_found", "Factura no encontrada");
    Object.assign(r, p, { updatedAt: now, version: r.version + 1 });
    return this.clone(r);
  }
  async setStatus(id: number, status: "rectified", now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new InvoicingError("not_found", "Factura no encontrada");
    if (r.status !== "issued") throw new InvoicingError("invalid_state", "Solo una factura expedida pasa a rectificada");
    Object.assign(r, { status, updatedAt: now, version: r.version + 1 });
    return this.clone(r);
  }
  async issue(i: IssueInput) {
    const r = this.rows.find((x) => x.id === i.id);
    if (!r) throw new InvoicingError("not_found", "Factura no encontrada");
    if (r.status !== "draft") throw new InvoicingError("invalid_state", `La factura ya está ${r.status === "issued" ? "expedida" : "rectificada"}`);
    const key = `${i.seriesCode}:${yearOf(i.issueDate)}`;
    const s = this.series.get(key) ?? { next: 1, lastHash: null };
    const number = invoiceNumber(i.seriesCode, yearOf(i.issueDate), s.next);
    const hash = invoiceHash(s.lastHash, { ...r, number, issueDate: i.issueDate, issuerTaxId: i.issuer.taxId, customerTaxId: i.customer.taxId });
    Object.assign(r, { status: "issued", seriesCode: i.seriesCode, number, issueDate: i.issueDate, issuer: i.issuer, customer: i.customer, previousHash: s.lastHash, hash, issuedAt: i.issuedAt, issuedBy: i.issuedBy, updatedAt: i.issuedAt, version: r.version + 1 });
    this.series.set(key, { next: s.next + 1, lastHash: hash });
    return this.clone(r);
  }
}

type Row = mysql.RowDataPacket & Record<string, unknown>;
const json = <T>(v: unknown): T | null => (typeof v === "string" && v ? (JSON.parse(v) as T) : null);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class MysqlInvoicingStore implements InvoicingStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private async lines(ids: number[]): Promise<Map<number, InvoiceLine[]>> {
    const out = new Map<number, InvoiceLine[]>();
    if (!ids.length) return out;
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM invoice_lines WHERE invoice_id IN (?) ORDER BY invoice_id, position", [ids]);
    for (const l of rows) {
      const id = Number(l.invoice_id);
      out.set(id, [...(out.get(id) ?? []), { position: Number(l.position), concept: String(l.concept), quantity: Number(l.quantity), unitCents: Number(l.unit_cents), baseCents: Number(l.base_cents), taxRateBp: Number(l.tax_rate_bp), taxCents: Number(l.tax_cents) }]);
    }
    return out;
  }
  private row(r: Row, lines: InvoiceLine[]): Invoice {
    return {
      id: Number(r.id),
      sourceKey: String(r.source_key),
      kind: r.kind as Invoice["kind"],
      status: r.status as Invoice["status"],
      paymentStatus: r.payment_status as Invoice["paymentStatus"],
      companyId: Number(r.company_id),
      billingRef: String(r.billing_ref),
      paymentRef: (r.payment_ref as string | null) ?? null,
      originalInvoiceId: numOrNull(r.original_invoice_id),
      seriesCode: (r.series_code as string | null) ?? null,
      number: (r.number as string | null) ?? null,
      operationDate: String(r.operation_date),
      periodStart: numOrNull(r.period_start),
      periodEnd: numOrNull(r.period_end),
      periodLabel: (r.period_label as string | null) ?? null,
      issueDate: (r.issue_date as string | null) ?? null,
      currency: String(r.currency),
      baseCents: Number(r.base_cents),
      taxCents: Number(r.tax_cents),
      totalCents: Number(r.total_cents),
      issuer: json<FiscalParty>(r.issuer_json),
      customer: json<FiscalParty>(r.customer_json),
      hash: (r.hash as string | null) ?? null,
      previousHash: (r.previous_hash as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      issuedAt: numOrNull(r.issued_at),
      issuedBy: (r.issued_by as string | null) ?? null,
      paidAt: numOrNull(r.paid_at),
      createdBy: String(r.created_by),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      version: Number(r.version),
      lines,
    };
  }
  private async many(where: string, args: unknown[], limit = 200) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM invoices WHERE livemode = ?${where ? ` AND ${where}` : ""} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(limit, 500))}`, [this.lm, ...args]);
    const lines = await this.lines(rows.map((r) => Number(r.id)));
    return rows.map((r) => this.row(r, lines.get(Number(r.id)) ?? []));
  }
  async get(id: number) {
    return (await this.many("id = ?", [id], 1))[0] ?? null;
  }
  async bySource(sourceKey: string) {
    return (await this.many("source_key = ?", [sourceKey], 1))[0] ?? null;
  }
  async list(f: { companyId?: number; status?: string; billingRef?: string; limit?: number } = {}) {
    const w: string[] = [];
    const a: unknown[] = [];
    if (f.companyId !== undefined) (w.push("company_id = ?"), a.push(f.companyId));
    if (f.status) (w.push("status = ?"), a.push(f.status));
    if (f.billingRef) (w.push("billing_ref = ?"), a.push(f.billingRef));
    return this.many(w.join(" AND "), a, f.limit);
  }
  async insertDraft(n: NewInvoice) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      let id: number;
      try {
        const [r] = await conn.query<mysql.ResultSetHeader>(
          `INSERT INTO invoices (livemode, source_key, kind, status, payment_status, company_id, billing_ref, payment_ref, original_invoice_id, operation_date, period_start, period_end, period_label, currency, base_cents, tax_cents, total_cents, customer_json, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [this.lm, n.sourceKey, n.kind, n.paymentStatus, n.companyId, n.billingRef, n.paymentRef, n.originalInvoiceId, n.operationDate, n.periodStart, n.periodEnd, n.periodLabel, n.currency, n.baseCents, n.taxCents, n.totalCents, n.customer ? JSON.stringify(n.customer) : null, n.notes, n.createdBy, n.createdAt, n.createdAt],
        );
        id = r.insertId;
      } catch (e) {
        if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
        await conn.rollback();
        return { invoice: (await this.bySource(n.sourceKey))!, created: false };
      }
      for (const l of n.lines) await conn.query("INSERT INTO invoice_lines (invoice_id, position, concept, quantity, unit_cents, base_cents, tax_rate_bp, tax_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, l.position, l.concept, l.quantity, l.unitCents, l.baseCents, l.taxRateBp, l.taxCents]);
      await conn.commit();
      return { invoice: (await this.get(id))!, created: true };
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }
  async setPayment(id: number, p: { paymentStatus: PaymentStatus; paymentRef: string | null; paidAt: number | null }, now: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE invoices SET payment_status = ?, payment_ref = ?, paid_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND livemode = ?", [p.paymentStatus, p.paymentRef, p.paidAt, now, id, this.lm]);
    if (!r.affectedRows) throw new InvoicingError("not_found", "Factura no encontrada");
    return (await this.get(id))!;
  }
  async setStatus(id: number, status: "rectified", now: number) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>("UPDATE invoices SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND livemode = ? AND status = 'issued'", [status, now, id, this.lm]);
    if (!r.affectedRows) throw new InvoicingError("invalid_state", "Solo una factura expedida pasa a rectificada");
    return (await this.get(id))!;
  }
  async issue(i: IssueInput) {
    const year = yearOf(i.issueDate);
    // La serie existe antes de la transacción; dentro, siempre se bloquea primero la serie y después la factura (mismo
    // orden en todas las expediciones: sin interbloqueos). Un interbloqueo residual se reintenta.
    await this.pool.query("INSERT IGNORE INTO invoice_series (livemode, code, year, next_number, created_at) VALUES (?, ?, ?, 1, ?)", [this.lm, i.seriesCode, year, i.issuedAt]);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.issueOnce(i, year);
      } catch (e) {
        if ((e as { code?: string }).code !== "ER_LOCK_DEADLOCK" || attempt >= 4) throw e;
      }
    }
  }
  private async issueOnce(i: IssueInput, year: number) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [s] = await conn.query<Row[]>("SELECT next_number, last_hash FROM invoice_series WHERE livemode = ? AND code = ? AND year = ? FOR UPDATE", [this.lm, i.seriesCode, year]);
      const [cur] = await conn.query<Row[]>("SELECT * FROM invoices WHERE id = ? AND livemode = ? FOR UPDATE", [i.id, this.lm]);
      if (!cur[0]) throw new InvoicingError("not_found", "Factura no encontrada");
      if (cur[0].status !== "draft") throw new InvoicingError("invalid_state", "La factura ya no es un borrador");
      const next = Number(s[0].next_number);
      const prev = (s[0].last_hash as string | null) ?? null;
      const lines = (await this.lines([i.id])).get(i.id) ?? [];
      const inv = this.row(cur[0], lines);
      const number = invoiceNumber(i.seriesCode, year, next);
      const hash = invoiceHash(prev, { ...inv, number, issueDate: i.issueDate, issuerTaxId: i.issuer.taxId, customerTaxId: i.customer.taxId });
      await conn.query(
        "UPDATE invoices SET status = 'issued', series_code = ?, number = ?, issue_date = ?, issuer_json = ?, customer_json = ?, previous_hash = ?, hash = ?, issued_at = ?, issued_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'draft'",
        [i.seriesCode, number, i.issueDate, JSON.stringify(i.issuer), JSON.stringify(i.customer), prev, hash, i.issuedAt, i.issuedBy, i.issuedAt, i.id],
      );
      await conn.query("UPDATE invoice_series SET next_number = next_number + 1, last_hash = ? WHERE livemode = ? AND code = ? AND year = ?", [hash, this.lm, i.seriesCode, year]);
      await conn.commit();
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
    return (await this.get(i.id))!;
  }
}
