/**
 * Fase 3: facturas expedidas con sus datos fiscales (cliente congelado al expedir y líneas por tipo), en SOLO LECTURA y
 * por fecha de expedición, para los libros registro y los modelos 303 (casillas informativas), 347 y 349. La facturación
 * propia (`server/invoicing`) es la dueña de estas filas: aquí nunca se escribe. Su almacén solo devuelve 500 filas por
 * consulta, así que la lectura por rango de fechas se hace aquí directamente sobre `invoices` e `invoice_lines`.
 */
import type mysql from "mysql2/promise";
import type { InvoicingStore } from "../invoicing/store";
import type { FiscalParty, Invoice, InvoiceLine } from "../invoicing/types";

export interface FiscalInvoiceSource {
  /** Expedidas o rectificadas (también las rectificativas) con fecha de expedición en el rango. */
  issuedBetween(from: string, to: string): Promise<Invoice[]>;
  /** Por id (las facturas rectificadas de las rectificativas del rango). */
  byIds(ids: number[]): Promise<Invoice[]>;
}

const issued = (i: Invoice) => (i.status === "issued" || i.status === "rectified") && !!i.number && !!i.issueDate;

/** Adaptador de un `InvoicingStore` (pruebas en memoria). */
export function fiscalInvoicesFromStore(store: Pick<InvoicingStore, "list">): FiscalInvoiceSource {
  const all = () => store.list({ limit: Number.MAX_SAFE_INTEGER });
  return {
    async issuedBetween(from, to) {
      return (await all()).filter((i) => issued(i) && i.issueDate! >= from && i.issueDate! <= to);
    },
    async byIds(ids) {
      return (await all()).filter((i) => ids.includes(i.id));
    },
  };
}

type Row = mysql.RowDataPacket & Record<string, unknown>;
const COLS =
  "id, source_key, kind, status, payment_status, company_id, billing_ref, payment_ref, original_invoice_id, series_code, number, DATE_FORMAT(operation_date, '%Y-%m-%d') AS operation_day, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_day, currency, base_cents, tax_cents, total_cents, customer_json, issued_at, created_by, created_at, updated_at";
const party = (v: unknown): FiscalParty | null => {
  try {
    return typeof v === "string" && v ? (JSON.parse(v) as FiscalParty) : null;
  } catch {
    return null;
  }
};

/** Lectura directa de `invoices` (CRM 0027) del entorno de la facturación (test/live). */
export class MysqlFiscalInvoiceSource implements FiscalInvoiceSource {
  private readonly lm: 0 | 1;
  constructor(
    private pool: Pick<mysql.Pool, "query">,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private async read(where: string, args: unknown[]): Promise<Invoice[]> {
    const [rows] = await this.pool.query<Row[]>(`SELECT ${COLS} FROM invoices WHERE livemode = ? AND ${where} ORDER BY issue_date, number LIMIT 20000`, [this.lm, ...args]);
    const ids = rows.map((r) => Number(r.id));
    const lines = new Map<number, InvoiceLine[]>();
    for (let k = 0; k < ids.length; k += 1000) {
      const [ls] = await this.pool.query<Row[]>("SELECT invoice_id, position, concept, quantity, unit_cents, base_cents, tax_rate_bp, tax_cents FROM invoice_lines WHERE invoice_id IN (?) ORDER BY invoice_id, position", [ids.slice(k, k + 1000)]);
      for (const l of ls) {
        const id = Number(l.invoice_id);
        lines.set(id, [...(lines.get(id) ?? []), { position: Number(l.position), concept: String(l.concept), quantity: Number(l.quantity), unitCents: Number(l.unit_cents), baseCents: Number(l.base_cents), taxRateBp: Number(l.tax_rate_bp), taxCents: Number(l.tax_cents) }]);
      }
    }
    return rows.map((r) => ({
      id: Number(r.id),
      sourceKey: String(r.source_key),
      kind: r.kind as Invoice["kind"],
      status: r.status as Invoice["status"],
      paymentStatus: r.payment_status as Invoice["paymentStatus"],
      companyId: Number(r.company_id),
      billingRef: String(r.billing_ref),
      paymentRef: (r.payment_ref as string | null) ?? null,
      originalInvoiceId: r.original_invoice_id === null ? null : Number(r.original_invoice_id),
      seriesCode: (r.series_code as string | null) ?? null,
      number: (r.number as string | null) ?? null,
      operationDate: String(r.operation_day),
      periodStart: null,
      periodEnd: null,
      periodLabel: null,
      issueDate: (r.issue_day as string | null) ?? null,
      currency: String(r.currency),
      baseCents: Number(r.base_cents),
      taxCents: Number(r.tax_cents),
      totalCents: Number(r.total_cents),
      issuer: null,
      customer: party(r.customer_json),
      hash: null,
      previousHash: null,
      notes: null,
      issuedAt: r.issued_at === null ? null : Number(r.issued_at),
      issuedBy: null,
      paidAt: null,
      createdBy: String(r.created_by),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      version: 0,
      lines: lines.get(Number(r.id)) ?? [],
    }));
  }
  issuedBetween(from: string, to: string) {
    return this.read("status IN ('issued','rectified') AND number IS NOT NULL AND issue_date BETWEEN ? AND ?", [from, to]);
  }
  byIds(ids: number[]) {
    return ids.length ? this.read("id IN (?)", [ids]) : Promise.resolve([]);
  }
}
