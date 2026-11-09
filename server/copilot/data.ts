/**
 * Lecturas del Core que usan las herramientas de Elephant Copilot. SOLO LECTURA (SELECT) y SQL parametrizado, siempre
 * sobre la BD de la empresa en curso (`getTenantDatabase()` resuelve la de la petición): nunca mezcla empresas.
 * Los totales (ventas, ocupación, facturas pendientes) se agregan aquí en SQL para que sean completos con cualquier
 * volumen; el reparto y el formato viven en server/copilot/tools.ts (puros, con pruebas).
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

/** Ventas cobradas agregadas en SQL: total y operaciones exactos del periodo, y su reparto por hora (UTC). */
export interface SalesSummary { cents: number; ops: number; byHour: Array<{ hourStartMs: number; cents: number; ops: number }> }
export interface ProductSalesRow { productId: number; productName: string; cents: number; people: number; lines: number }
export interface OccupancyRow { bookingDate: string; productId: number; productName: string; people: number }
export interface ReservationRow { id: number; number: string | null; bookingDate: string; time: string | null; productId: number; productName: string; people: number; customerName: string; status: string; statusReservation: string | null; statusPayment: string | null; slotId: number | null }
export interface SlotRow { id: number; productId: number; label: string; startTime: string | null; daysOfWeek: string | null; capacity: number | null }
export interface ClientRow { id: number; name: string; email: string; phone: string | null; company: string | null; city: string | null; notes: string | null; tags: string[]; totalBookings: number; totalSpent: number; lastBookingAt: number | null; createdAt: number | null }
export interface LeadRow { id: number; name: string; company: string | null; status: string; priority: string; source: string | null; product: string | null; createdAt: number | null; lastContactAt: number | null }
export interface QuoteRow { id: number; number: string; title: string; total: number; status: string; sentAt: number | null; validUntil: number | null }
export interface UnpaidInvoiceRow { id: number; number: string; clientName: string; status: string; issuedAt: number | null; pendingCents: number }
/** Facturas pendientes de cobro tras sus abonos: recuento e importe exactos (SQL) y las `max` más antiguas. */
export interface UnpaidInvoices { count: number; cents: number; rows: UnpaidInvoiceRow[] }
export interface HrSummaryRows { leave: Array<{ type: string; requests: number; days: number }>; pending: number; openClocks: number }
export interface ProductRow { id: number; title: string; shortDescription: string | null; description: string | null; duration: string | null; basePrice: number | null; currency: string; minPersons: number | null; maxPersons: number | null; includes: string[] }

/** Puerto de datos de Copilot (en pruebas, un doble en memoria). */
export interface CopilotData {
  salesSummary(fromMs: number, toMsExclusive: number): Promise<SalesSummary>;
  salesByProduct(fromMs: number, toMsExclusive: number): Promise<ProductSalesRow[]>;
  occupancy(fromDay: string, toDay: string): Promise<OccupancyRow[]>;
  reservations(fromDay: string, toDay: string, max: number): Promise<ReservationRow[]>;
  activeSlots(productIds: number[]): Promise<SlotRow[]>;
  searchClients(text: string | null, max: number): Promise<ClientRow[]>;
  client(id: number): Promise<ClientRow | null>;
  clientReservations(clientId: number, email: string, max: number): Promise<ReservationRow[]>;
  openLeads(fromMs: number | null, toMsExclusive: number | null, max: number): Promise<{ rows: LeadRow[]; byStatus: Array<{ status: string; n: number }> }>;
  pendingQuotes(max: number): Promise<{ rows: QuoteRow[]; count: number; total: number }>;
  unpaidInvoices(max: number): Promise<UnpaidInvoices>;
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

// Ventas cobradas: reservas en estado pagado (las escriben la tienda online, las reservas y presupuestos cobrados y
// cada venta del TPV). Importe cobrado si lo hay, si no el total; una operación por pedido (número de pedido).
const SALE_AT = sql`COALESCE(paid_at, created_at)`;
const SALE_CENTS = sql`CASE WHEN COALESCE(amount_paid, 0) > 0 THEN amount_paid ELSE amount_total END`;
const SALE_KEY = sql`CASE WHEN merchant_order IS NULL OR merchant_order = '' THEN CONCAT('r:', id) ELSE CONCAT('p:', merchant_order) END`;
const paidSalesWhere = (fromMs: number, toMsExclusive: number) => sql`status = 'paid' AND ${SALE_AT} >= ${fromMs} AND ${SALE_AT} < ${toMsExclusive}`;
// Reservas que ocupan plaza: pagadas o pendientes de pago, no anuladas ni no presentadas
const ACTIVE_RESERVATION = sql`status IN ('paid', 'pending_payment') AND (status_reservation IS NULL OR status_reservation NOT IN ('ANULADA', 'NO_SHOW'))`;

const RESERVATION_COLUMNS = sql`id, reservation_number, booking_date, selected_time, product_id, product_name, people, customer_name, status, status_reservation, status_payment, selected_time_slot_id`;

export class TenantDbCopilotData implements CopilotData {
  // Agregado en SQL (sin traer líneas): con cualquier volumen el total es completo
  async salesSummary(fromMs: number, toMsExclusive: number): Promise<SalesSummary> {
    const where = paidSalesWhere(fromMs, toMsExclusive);
    const agg = (await q(sql`SELECT COALESCE(SUM(${SALE_CENTS}), 0) AS cents, COUNT(DISTINCT ${SALE_KEY}) AS ops FROM reservations WHERE ${where}`))[0] ?? {};
    // Por hora: el día de Madrid de cada hora es exacto (su desfase es de horas enteras) y son como mucho 24 filas por día
    const byHour = await q(sql`
      SELECT FLOOR(${SALE_AT} / 3600000) AS h, COALESCE(SUM(${SALE_CENTS}), 0) AS cents, COUNT(DISTINCT ${SALE_KEY}) AS ops
        FROM reservations
       WHERE ${where}
       GROUP BY h`);
    return { cents: num(agg.cents), ops: num(agg.ops), byHour: byHour.map((r) => ({ hourStartMs: num(r.h) * 3600000, cents: num(r.cents), ops: num(r.ops) })) };
  }

  async salesByProduct(fromMs: number, toMsExclusive: number): Promise<ProductSalesRow[]> {
    const rows = await q(sql`
      SELECT product_id, product_name, COALESCE(SUM(${SALE_CENTS}), 0) AS cents, COALESCE(SUM(people), 0) AS people, COUNT(*) AS n
        FROM reservations
       WHERE ${paidSalesWhere(fromMs, toMsExclusive)}
       GROUP BY product_id, product_name`);
    return rows.map((r) => ({ productId: num(r.product_id), productName: String(r.product_name ?? ""), cents: num(r.cents), people: num(r.people), lines: num(r.n) }));
  }

  // Personas por día y producto agregadas en SQL: no depende de cuántas reservas haya
  async occupancy(fromDay: string, toDay: string): Promise<OccupancyRow[]> {
    const rows = await q(sql`
      SELECT booking_date, product_id, MIN(product_name) AS product_name, COALESCE(SUM(people), 0) AS people
        FROM reservations
       WHERE booking_date >= ${fromDay} AND booking_date <= ${toDay} AND ${ACTIVE_RESERVATION}
       GROUP BY booking_date, product_id`);
    return rows.map((r) => ({ bookingDate: String(r.booking_date ?? ""), productId: num(r.product_id), productName: String(r.product_name ?? ""), people: num(r.people) }));
  }

  async reservations(fromDay: string, toDay: string, max: number): Promise<ReservationRow[]> {
    const rows = await q(sql`
      SELECT ${RESERVATION_COLUMNS}
        FROM reservations
       WHERE booking_date >= ${fromDay} AND booking_date <= ${toDay} AND ${ACTIVE_RESERVATION}
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

  async unpaidInvoices(max: number): Promise<UnpaidInvoices> {
    // La misma regla que la portada del panel (server/coreHomeDb.ts, unpaidAfterCredits): emitidas o enviadas, sin
    // pedido cobrado enlazado, menos sus abonos no anulados; solo las que aún tienen algo pendiente. Recuento e
    // importe agregados en SQL: son exactos aunque haya miles de facturas.
    const pending = sql`ROUND(i.total * 100) - ROUND(COALESCE(c.credited, 0) * 100)`;
    const from = sql`
        FROM invoices i
        LEFT JOIN (SELECT creditNoteForId, SUM(ABS(total)) AS credited FROM invoices
                    WHERE invoiceType = 'abono' AND status <> 'anulada' AND creditNoteForId IS NOT NULL
                    GROUP BY creditNoteForId) c ON c.creditNoteForId = i.id
       WHERE i.status IN ('generada', 'enviada') AND i.invoiceType = 'factura'
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.status = 'paid' AND (r.id = i.reservationId OR r.invoiceId = i.id))
         AND ${pending} > 0`;
    const agg = (await q(sql`SELECT COUNT(*) AS n, COALESCE(SUM(${pending}), 0) AS cents ${from}`))[0] ?? {};
    const rows = await q(sql`SELECT i.id, i.invoiceNumber, i.clientName, i.status, i.issuedAt, ${pending} AS pending_cents ${from} ORDER BY i.issuedAt, i.id LIMIT ${max}`);
    return {
      count: num(agg.n),
      cents: num(agg.cents),
      rows: rows.map((r) => ({ id: num(r.id), number: String(r.invoiceNumber ?? ""), clientName: String(r.clientName ?? ""), status: String(r.status), issuedAt: ms(r.issuedAt), pendingCents: num(r.pending_cents) })),
    };
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
