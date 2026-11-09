/**
 * Lecturas del Core que usan las herramientas de Elephant Copilot. SOLO LECTURA (SELECT) y SQL parametrizado, siempre
 * sobre la BD de la empresa en curso (`getTenantDatabase()` resuelve la de la petición): nunca mezcla empresas.
 * La agregación y el formato viven en server/copilot/tools.ts (puros, con pruebas); aquí solo filas.
 */
import { sql } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";

type Row = Record<string, any>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0] ?? [];
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown) => (v == null || v === "" ? null : num(v));
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const ms = (v: unknown) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v)) || null);

export interface SaleRow { id: number; merchantOrder: string | null; at: number; amountTotal: number; amountPaid: number; productId: number; productName: string; people: number }
export interface ReservationRow { id: number; number: string | null; bookingDate: string; time: string | null; productId: number; productName: string; people: number; customerName: string; status: string; statusReservation: string | null; statusPayment: string | null; slotId: number | null }
export interface SlotRow { id: number; productId: number; label: string; startTime: string | null; daysOfWeek: string | null; capacity: number | null }
export interface ClientRow { id: number; name: string; email: string; phone: string | null; company: string | null; city: string | null; notes: string | null; tags: string[]; totalBookings: number; totalSpent: number; lastBookingAt: number | null; createdAt: number | null }
export interface LeadRow { id: number; name: string; company: string | null; status: string; priority: string; source: string | null; product: string | null; createdAt: number | null; lastContactAt: number | null }
export interface QuoteRow { id: number; number: string; title: string; total: number; status: string; sentAt: number | null; validUntil: number | null }
export interface InvoiceRow { id: number; number: string; clientName: string; total: number; status: string; issuedAt: number | null }
export interface CreditRow { creditNoteForId: number | null; total: number }
export interface HrSummaryRows { leave: Array<{ type: string; requests: number; days: number }>; pending: number; openClocks: number }
export interface ProductRow { id: number; title: string; shortDescription: string | null; description: string | null; duration: string | null; basePrice: number | null; currency: string; minPersons: number | null; maxPersons: number | null; includes: string[] }

/** Puerto de datos de Copilot (en pruebas, un doble en memoria). */
export interface CopilotData {
  paidSales(fromMs: number, toMsExclusive: number): Promise<SaleRow[]>;
  reservations(fromDay: string, toDay: string, max: number): Promise<ReservationRow[]>;
  activeSlots(productIds: number[]): Promise<SlotRow[]>;
  searchClients(text: string | null, max: number): Promise<ClientRow[]>;
  client(id: number): Promise<ClientRow | null>;
  clientReservations(clientId: number, email: string, max: number): Promise<ReservationRow[]>;
  openLeads(fromMs: number | null, toMsExclusive: number | null, max: number): Promise<{ rows: LeadRow[]; byStatus: Array<{ status: string; n: number }> }>;
  pendingQuotes(max: number): Promise<{ rows: QuoteRow[]; count: number; total: number }>;
  unpaidInvoices(): Promise<InvoiceRow[]>;
  credits(invoiceIds: number[]): Promise<CreditRow[]>;
  hrSummary(fromDay: string, toDay: string): Promise<HrSummaryRows>;
  product(id: number): Promise<ProductRow | null>;
}

async function db() {
  const d = await getTenantDatabase();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
const q = async (query: ReturnType<typeof sql>) => rowsOf(await (await db()).execute(query));
const list = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

function toReservation(r: Row): ReservationRow {
  return {
    id: num(r.id),
    number: str(r.reservation_number),
    bookingDate: String(r.booking_date ?? ""),
    time: str(r.selected_time),
    productId: num(r.product_id),
    productName: String(r.product_name ?? ""),
    people: num(r.people),
    customerName: String(r.customer_name ?? ""),
    status: String(r.status ?? ""),
    statusReservation: str(r.status_reservation),
    statusPayment: str(r.status_payment),
    slotId: numOrNull(r.selected_time_slot_id),
  };
}

function tagsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toClient(r: Row): ClientRow {
  return {
    id: num(r.id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    phone: str(r.phone),
    company: str(r.company),
    city: str(r.city),
    notes: str(r.notes),
    tags: tagsOf(r.tags),
    totalBookings: num(r.totalBookings),
    totalSpent: num(r.totalSpent),
    lastBookingAt: ms(r.lastBookingAt),
    createdAt: ms(r.createdAt),
  };
}

const RESERVATION_COLUMNS = sql`id, reservation_number, booking_date, selected_time, product_id, product_name, people, customer_name, status, status_reservation, status_payment, selected_time_slot_id`;

export class TenantDbCopilotData implements CopilotData {
  async paidSales(fromMs: number, toMsExclusive: number): Promise<SaleRow[]> {
    const rows = await q(sql`
      SELECT id, merchant_order, COALESCE(paid_at, created_at) AS at, amount_total, amount_paid, product_id, product_name, people
        FROM reservations
       WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= ${fromMs} AND COALESCE(paid_at, created_at) < ${toMsExclusive}
       LIMIT 20000`);
    return rows.map((r) => ({ id: num(r.id), merchantOrder: str(r.merchant_order), at: num(r.at), amountTotal: num(r.amount_total), amountPaid: num(r.amount_paid), productId: num(r.product_id), productName: String(r.product_name ?? ""), people: num(r.people) }));
  }

  async reservations(fromDay: string, toDay: string, max: number): Promise<ReservationRow[]> {
    const rows = await q(sql`
      SELECT ${RESERVATION_COLUMNS}
        FROM reservations
       WHERE booking_date >= ${fromDay} AND booking_date <= ${toDay}
         AND status IN ('paid', 'pending_payment')
         AND (status_reservation IS NULL OR status_reservation NOT IN ('ANULADA', 'NO_SHOW'))
       ORDER BY booking_date, selected_time, id
       LIMIT ${max}`);
    return rows.map(toReservation);
  }

  async activeSlots(productIds: number[]): Promise<SlotRow[]> {
    if (!productIds.length) return [];
    const rows = await q(sql`SELECT id, product_id, label, start_time, days_of_week, capacity FROM product_time_slots WHERE active = 1 AND product_id IN (${list(productIds)}) ORDER BY product_id, sort_order, id`);
    return rows.map((r) => ({ id: num(r.id), productId: num(r.product_id), label: String(r.label ?? ""), startTime: str(r.start_time), daysOfWeek: str(r.days_of_week), capacity: numOrNull(r.capacity) }));
  }

  async searchClients(text: string | null, max: number): Promise<ClientRow[]> {
    const cols = sql`id, name, email, phone, company, city, notes, tags, totalBookings, totalSpent, lastBookingAt, createdAt`;
    if (!text) return (await q(sql`SELECT ${cols} FROM clients ORDER BY CAST(totalSpent AS DECIMAL(12,2)) DESC, id DESC LIMIT ${max}`)).map(toClient);
    // Comodines del usuario escapados: la búsqueda es literal
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (await q(sql`SELECT ${cols} FROM clients WHERE name LIKE ${like} OR email LIKE ${like} OR company LIKE ${like} ORDER BY lastBookingAt DESC, id DESC LIMIT ${max}`)).map(toClient);
  }

  async client(id: number): Promise<ClientRow | null> {
    const rows = await q(sql`SELECT id, name, email, phone, company, city, notes, tags, totalBookings, totalSpent, lastBookingAt, createdAt FROM clients WHERE id = ${id} LIMIT 1`);
    return rows[0] ? toClient(rows[0]) : null;
  }

  async clientReservations(clientId: number, email: string, max: number): Promise<ReservationRow[]> {
    const rows = await q(sql`
      SELECT ${RESERVATION_COLUMNS}
        FROM reservations
       WHERE (client_id = ${clientId} OR (${email} <> '' AND customer_email = ${email}))
         AND status <> 'draft'
       ORDER BY booking_date DESC, id DESC
       LIMIT ${max}`);
    return rows.map(toReservation);
  }

  async openLeads(fromMs: number | null, toMsExclusive: number | null, max: number) {
    const range = fromMs != null && toMsExclusive != null ? sql`AND createdAt >= ${new Date(fromMs)} AND createdAt < ${new Date(toMsExclusive)}` : sql``;
    const rows = await q(sql`
      SELECT id, name, company, status, priority, source, selectedProduct, createdAt, lastContactAt
        FROM leads
       WHERE status IN ('nuevo', 'contactado', 'en_proceso') ${range}
       ORDER BY FIELD(priority, 'alta', 'media', 'baja'), createdAt DESC
       LIMIT ${max}`);
    const byStatus = await q(sql`SELECT status, COUNT(*) AS n FROM leads WHERE status IN ('nuevo', 'contactado', 'en_proceso') ${range} GROUP BY status`);
    return {
      rows: rows.map((r) => ({ id: num(r.id), name: String(r.name ?? ""), company: str(r.company), status: String(r.status), priority: String(r.priority), source: str(r.source), product: str(r.selectedProduct), createdAt: ms(r.createdAt), lastContactAt: ms(r.lastContactAt) })),
      byStatus: byStatus.map((r) => ({ status: String(r.status), n: num(r.n) })),
    };
  }

  async pendingQuotes(max: number) {
    const rows = await q(sql`SELECT id, quoteNumber, title, total, status, sentAt, validUntil FROM quotes WHERE status IN ('enviado', 'visualizado') ORDER BY sentAt DESC, id DESC LIMIT ${max}`);
    const agg = (await q(sql`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM quotes WHERE status IN ('enviado', 'visualizado')`))[0] ?? {};
    return {
      rows: rows.map((r) => ({ id: num(r.id), number: String(r.quoteNumber ?? ""), title: String(r.title ?? ""), total: num(r.total), status: String(r.status), sentAt: ms(r.sentAt), validUntil: ms(r.validUntil) })),
      count: num(agg.n),
      total: num(agg.total),
    };
  }

  async unpaidInvoices(): Promise<InvoiceRow[]> {
    // La misma regla que la portada del panel (server/coreHomeDb.ts): emitidas o enviadas, sin pedido cobrado enlazado
    const rows = await q(sql`
      SELECT i.id, i.invoiceNumber, i.clientName, i.total, i.status, i.issuedAt
        FROM invoices i
       WHERE i.status IN ('generada', 'enviada') AND i.invoiceType = 'factura'
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.status = 'paid' AND (r.id = i.reservationId OR r.invoiceId = i.id))
       ORDER BY i.issuedAt, i.id
       LIMIT 2000`);
    return rows.map((r) => ({ id: num(r.id), number: String(r.invoiceNumber ?? ""), clientName: String(r.clientName ?? ""), total: num(r.total), status: String(r.status), issuedAt: ms(r.issuedAt) }));
  }

  async credits(invoiceIds: number[]): Promise<CreditRow[]> {
    if (!invoiceIds.length) return [];
    const rows = await q(sql`SELECT creditNoteForId, total FROM invoices WHERE invoiceType = 'abono' AND status <> 'anulada' AND creditNoteForId IN (${list(invoiceIds)})`);
    return rows.map((r) => ({ creditNoteForId: numOrNull(r.creditNoteForId), total: num(r.total) }));
  }

  async hrSummary(fromDay: string, toDay: string): Promise<HrSummaryRows> {
    const leave = await q(sql`
      SELECT type, COUNT(*) AS n, COALESCE(SUM(days), 0) AS days
        FROM hr_leave_requests
       WHERE status = 'aprobada' AND from_date <= ${toDay} AND to_date >= ${fromDay}
       GROUP BY type`);
    const pending = (await q(sql`SELECT COUNT(*) AS n FROM hr_leave_requests WHERE status = 'pendiente'`))[0];
    const open = (await q(sql`SELECT COUNT(*) AS n FROM hr_time_clock WHERE status = 'open' AND clock_out_at IS NULL`))[0];
    return { leave: leave.map((r) => ({ type: String(r.type), requests: num(r.n), days: num(r.days) })), pending: num(pending?.n), openClocks: num(open?.n) };
  }

  async product(id: number): Promise<ProductRow | null> {
    const r = (await q(sql`SELECT id, title, shortDescription, description, duration, basePrice, currency, minPersons, maxPersons, includes FROM experiences WHERE id = ${id} LIMIT 1`))[0];
    if (!r) return null;
    return { id: num(r.id), title: String(r.title ?? ""), shortDescription: str(r.shortDescription), description: str(r.description), duration: str(r.duration), basePrice: numOrNull(r.basePrice), currency: String(r.currency || "EUR"), minPersons: numOrNull(r.minPersons), maxPersons: numOrNull(r.maxPersons), includes: tagsOf(r.includes) };
  }
}
