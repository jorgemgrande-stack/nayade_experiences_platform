/**
 * Fase 2 (Stripe y conciliación): lectura de las facturas propias en SOLO LECTURA, sin tope de volumen, y cerrojo por
 * factura para los cobros por transferencia.
 *
 *  - `MysqlOwnInvoiceDirectory` lee la tabla `invoices` (CRM 0027) del entorno indicado: por factura de Stripe
 *    (`payment_ref = stripe:in:<id>`), por id, paginada y candidatas a un cobro. Nunca escribe: el estado de cobro de
 *    la factura es de `server/invoicing` (aquí solo se consulta).
 *  - `ownInvoicesFromStore` adapta un `InvoicingStore` (pruebas en memoria) a la misma interfaz.
 *  - `mysqlKeyedLock` / `memoryKeyedLock`: ejecuta una función con un cerrojo por clave (`GET_LOCK` con espera en
 *    MySQL), para que comprobar lo pendiente de una factura y conciliar su cobro no se crucen entre peticiones.
 */
import type mysql from "mysql2/promise";
import type { InvoicingStore } from "../invoicing/store";
import type { FiscalParty, Invoice } from "../invoicing/types";
import { FinanceError } from "./types";

/** Factura propia tal y como la usa la conciliación. */
export interface OwnInvoice {
  id: number;
  number: string | null;
  kind: Invoice["kind"];
  status: Invoice["status"];
  issueDate: string | null;
  operationDate: string;
  companyId: number;
  customerName: string | null;
  totalCents: number;
  currency: string;
  paymentStatus: Invoice["paymentStatus"];
  paymentRef: string | null;
}

export interface OwnInvoiceQuery {
  from?: string;
  to?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface OwnInvoiceDirectory {
  /** Facturas (no rectificativas) cobradas por estas facturas de Stripe (`paymentRef = stripe:in:<id>`). */
  byStripeIds(stripeInvoiceIds: string[]): Promise<OwnInvoice[]>;
  byIds(ids: number[]): Promise<OwnInvoice[]>;
  /** Expedidas (o rectificadas), no rectificativas y de importe positivo, por fecha descendente. */
  list(q: OwnInvoiceQuery): Promise<{ items: OwnInvoice[]; total: number }>;
  /** Candidatas a un cobro: expedidas, no cobradas, total ≥ `minTotalCents` y fecha desde `from`. */
  openCandidates(q: { minTotalCents: number; from: string; limit: number }): Promise<OwnInvoice[]>;
}

export const STRIPE_PAYMENT_REF = (stripeInvoiceId: string) => `stripe:in:${stripeInvoiceId}`;
const dateOf = (o: Pick<OwnInvoice, "issueDate" | "operationDate">) => o.issueDate ?? o.operationDate;
const listable = (o: OwnInvoice) => (o.status === "issued" || o.status === "rectified") && o.kind !== "rectification" && o.totalCents > 0;
const matchesText = (o: OwnInvoice, q?: string) => !q || (o.number ?? "").toLowerCase().includes(q.toLowerCase()) || (o.customerName ?? "").toLowerCase().includes(q.toLowerCase());

export const ownOf = (i: Invoice): OwnInvoice => ({
  id: i.id,
  number: i.number,
  kind: i.kind,
  status: i.status,
  issueDate: i.issueDate,
  operationDate: i.operationDate,
  companyId: i.companyId,
  customerName: i.customer?.legalName ?? null,
  totalCents: i.totalCents,
  currency: i.currency,
  paymentStatus: i.paymentStatus,
  paymentRef: i.paymentRef,
});

/** Adaptador de un `InvoicingStore` (pruebas en memoria): lee todo de una vez, sin tope. */
export function ownInvoicesFromStore(store: Pick<InvoicingStore, "list">): OwnInvoiceDirectory {
  const all = async () => (await store.list({ limit: Number.MAX_SAFE_INTEGER })).map(ownOf);
  const sorted = (xs: OwnInvoice[]) => xs.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.id - a.id);
  return {
    async byStripeIds(ids) {
      const refs = new Set(ids.map(STRIPE_PAYMENT_REF));
      return (await all()).filter((o) => o.kind !== "rectification" && o.status !== "draft" && o.paymentRef !== null && refs.has(o.paymentRef));
    },
    async byIds(ids) {
      return (await all()).filter((o) => ids.includes(o.id));
    },
    async list(q) {
      const xs = sorted((await all()).filter((o) => listable(o) && (!q.from || dateOf(o) >= q.from) && (!q.to || dateOf(o) <= q.to) && matchesText(o, q.q)));
      return { items: xs.slice(q.offset, q.offset + q.limit), total: xs.length };
    },
    async openCandidates(q) {
      return sorted((await all()).filter((o) => o.status === "issued" && o.kind !== "rectification" && o.paymentStatus !== "paid" && o.totalCents >= q.minTotalCents && dateOf(o) >= q.from)).slice(0, q.limit);
    },
  };
}

type Row = mysql.RowDataPacket & Record<string, unknown>;
const COLS = "id, number, kind, status, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_day, DATE_FORMAT(operation_date, '%Y-%m-%d') AS operation_day, company_id, customer_json, total_cents, currency, payment_status, payment_ref";
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const rowOf = (r: Row): OwnInvoice => {
  let customer: FiscalParty | null = null;
  try {
    customer = typeof r.customer_json === "string" && r.customer_json ? (JSON.parse(r.customer_json) as FiscalParty) : null;
  } catch {
    customer = null;
  }
  return {
    id: Number(r.id),
    number: (r.number as string | null) ?? null,
    kind: r.kind as Invoice["kind"],
    status: r.status as Invoice["status"],
    issueDate: (r.issue_day as string | null) ?? null,
    operationDate: String(r.operation_day),
    companyId: Number(r.company_id),
    customerName: customer?.legalName ?? null,
    totalCents: Number(r.total_cents),
    currency: String(r.currency),
    paymentStatus: r.payment_status as Invoice["paymentStatus"],
    paymentRef: (r.payment_ref as string | null) ?? null,
  };
};

/** Facturas propias leídas de la tabla `invoices` (solo lectura) del entorno de la facturación (test/live). */
export class MysqlOwnInvoiceDirectory implements OwnInvoiceDirectory {
  private readonly lm: 0 | 1;
  constructor(
    private pool: Pick<mysql.Pool, "query">,
    mode: "test" | "live" = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private async rows(sql: string, args: unknown[]) {
    const [rows] = await this.pool.query<Row[]>(sql, args);
    return rows.map(rowOf);
  }
  async byStripeIds(ids: string[]) {
    if (!ids.length) return [];
    return this.rows(`SELECT ${COLS} FROM invoices WHERE livemode = ? AND kind <> 'rectification' AND status <> 'draft' AND payment_ref IN (?)`, [this.lm, ids.map(STRIPE_PAYMENT_REF)]);
  }
  async byIds(ids: number[]) {
    if (!ids.length) return [];
    return this.rows(`SELECT ${COLS} FROM invoices WHERE livemode = ? AND id IN (?)`, [this.lm, ids]);
  }
  async list(q: OwnInvoiceQuery) {
    const w = ["livemode = ?", "status IN ('issued','rectified')", "kind <> 'rectification'", "total_cents > 0"];
    const a: unknown[] = [this.lm];
    const day = "COALESCE(issue_date, operation_date)";
    if (q.from) (w.push(`${day} >= ?`), a.push(q.from));
    if (q.to) (w.push(`${day} <= ?`), a.push(q.to));
    if (q.q) (w.push("(LOWER(number) LIKE LOWER(?) OR LOWER(JSON_UNQUOTE(JSON_EXTRACT(customer_json, '$.legalName'))) LIKE LOWER(?))"), a.push(like(q.q), like(q.q)));
    const where = `WHERE ${w.join(" AND ")}`;
    const [[count]] = await this.pool.query<Row[]>(`SELECT COUNT(*) AS n FROM invoices ${where}`, a);
    const items = await this.rows(`SELECT ${COLS} FROM invoices ${where} ORDER BY ${day} DESC, id DESC LIMIT ? OFFSET ?`, [...a, q.limit, q.offset]);
    return { items, total: Number(count.n) };
  }
  openCandidates(q: { minTotalCents: number; from: string; limit: number }) {
    return this.rows(
      `SELECT ${COLS} FROM invoices WHERE livemode = ? AND status = 'issued' AND kind <> 'rectification' AND payment_status <> 'paid' AND total_cents >= ? AND COALESCE(issue_date, operation_date) >= ? ORDER BY COALESCE(issue_date, operation_date) DESC, id DESC LIMIT ?`,
      [this.lm, q.minTotalCents, q.from, q.limit],
    );
  }
}

// ── Cerrojo por clave ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ejecuta `fn` con el cerrojo `key` tomado (las demás peticiones con la misma clave esperan su turno). */
export type KeyedLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/** Segundos que se espera un cerrojo de MySQL antes de rendirse (503). */
export const LOCK_WAIT_SECONDS = 10;

/** `GET_LOCK` de MySQL con espera, en una conexión propia que se libera siempre. */
export function mysqlKeyedLock(pool: Pick<mysql.Pool, "getConnection">): KeyedLock {
  return async (key, fn) => {
    const c = await pool.getConnection();
    try {
      const [r] = await c.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS ok", [key, LOCK_WAIT_SECONDS]);
      if (Number(r[0]?.ok) !== 1) throw new FinanceError("unavailable", "Otra operación sobre la misma factura sigue en curso: inténtalo de nuevo");
      try {
        return await fn();
      } finally {
        await c.query("SELECT RELEASE_LOCK(?)", [key]).catch(() => undefined);
      }
    } finally {
      c.release();
    }
  };
}

/** Cerrojo en memoria (pruebas o un único proceso): encadena las funciones de la misma clave. */
export function memoryKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, fn: () => Promise<T>) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** Clave del cerrojo de una factura (cobros por transferencia). */
export const invoiceLockKey = (invoiceId: number) => `fin-invoice-${invoiceId}`;
