/**
 * Inicio del panel (Elephant Core): actividad reciente de la empresa en curso, con datos reales de su propia BD.
 *
 * Cada fuente se incluye solo si su capacidad está contratada (activa o en solo lectura): quien no tiene caja no ve
 * ventas en caja, aunque existieran filas de antes. Nunca mezcla empresas: `getDb()` resuelve la BD del tenant.
 */
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, ne, sql, sum } from "drizzle-orm";
import { clients, invoices, leads, quotes, reservations, tpvSales } from "../drizzle/schema";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { orderActivityTitle } from "../shared/cashSaleLabel";

export type RecentKind = "client" | "lead" | "quote" | "order" | "invoice" | "sale";
export interface RecentItem {
  kind: RecentKind;
  title: string;
  detail: string | null;
  at: number;
  href: string;
}

/** Capacidad que licencia cada fuente de actividad. */
export const RECENT_CAPABILITY: Record<RecentKind, string> = {
  client: "crm-contacts",
  lead: "crm-leads",
  quote: "crm-quotes",
  order: "shop-orders",
  invoice: "bill-invoices",
  sale: "bill-cash",
};

const PER_SOURCE = 5;
const ts = (v: Date | string | number | null | undefined) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : v ? new Date(v).getTime() : 0);
const money = (v: string | number | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : null;
};

/** Mezcla, ordena (lo más reciente primero) y recorta. Pura: la usan las pruebas. */
export function mergeRecent(groups: RecentItem[][], limit: number): RecentItem[] {
  return groups
    .flat()
    .filter((i) => i.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

async function allowedKinds(): Promise<Set<RecentKind>> {
  const access = getCapabilityAccess();
  const out = new Set<RecentKind>();
  for (const [kind, cap] of Object.entries(RECENT_CAPABILITY) as Array<[RecentKind, string]>) {
    try {
      if ((await access.check(cap, { write: false })).allowed) out.add(kind);
    } catch {
      // Sin poder verificar la licencia, esa fuente no se muestra
    }
  }
  return out;
}

export async function recentActivity(limit = 8): Promise<RecentItem[]> {
  const db = await getDb();
  if (!db) return [];
  const kinds = await allowedKinds();
  const tasks: Array<Promise<RecentItem[]>> = [];
  if (kinds.has("client")) {
    tasks.push(
      db.select({ name: clients.name, at: clients.createdAt }).from(clients).orderBy(desc(clients.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "client" as const, title: "Nuevo cliente", detail: r.name, at: ts(r.at), href: "/admin/crm/clientes" }))),
    );
  }
  if (kinds.has("lead")) {
    tasks.push(
      db.select({ name: leads.name, at: leads.createdAt }).from(leads).orderBy(desc(leads.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "lead" as const, title: "Nueva oportunidad", detail: r.name, at: ts(r.at), href: "/admin/crm?tab=leads" }))),
    );
  }
  if (kinds.has("quote")) {
    tasks.push(
      db.select({ number: quotes.quoteNumber, title: quotes.title, total: quotes.total, at: quotes.createdAt }).from(quotes).orderBy(desc(quotes.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "quote" as const, title: `Presupuesto ${r.number}`, detail: [r.title, money(r.total)].filter(Boolean).join(" · "), at: ts(r.at), href: "/admin/crm?tab=quotes" }))),
    );
  }
  if (kinds.has("order")) {
    tasks.push(
      db.select({ customer: reservations.customerName, invoiceClient: invoices.clientName, product: reservations.productName, at: reservations.createdAt })
        .from(reservations).leftJoin(invoices, eq(invoices.id, reservations.invoiceId)).orderBy(desc(reservations.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "order" as const, title: orderActivityTitle({ customerName: r.customer, invoiceClientName: r.invoiceClient }), detail: r.product, at: ts(r.at), href: "/admin/crm?tab=reservations" }))),
    );
  }
  if (kinds.has("invoice")) {
    tasks.push(
      db.select({ number: invoices.invoiceNumber, client: invoices.clientName, total: invoices.total, at: invoices.createdAt }).from(invoices).orderBy(desc(invoices.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "invoice" as const, title: `Factura ${r.number}`, detail: [r.client, money(r.total)].filter(Boolean).join(" · "), at: ts(r.at), href: "/admin/crm?tab=invoices" }))),
    );
  }
  if (kinds.has("sale")) {
    tasks.push(
      db.select({ number: tpvSales.ticketNumber, total: tpvSales.total, at: tpvSales.createdAt }).from(tpvSales).orderBy(desc(tpvSales.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "sale" as const, title: `Venta en caja ${r.number}`, detail: money(r.total), at: ts(r.at), href: "/admin/tpv" }))),
    );
  }
  return mergeRecent(await Promise.all(tasks), limit);
}

// ── Indicadores del Inicio ────────────────────────────────────────────────────

/**
 * Cifras del Inicio, todas de la BD de la empresa en curso. Cada bloque es null si su capacidad no está contratada
 * (no se enseña), y un número (0 incluido) si lo está: nunca se inventa ni se estima nada.
 *  - Ventas de hoy y del mes: pedidos cobrados (los tickets de caja generan su pedido), por la fecha de cobro y con
 *    el importe cobrado, en hora de Madrid; la misma regla que Informes › Resumen. Se cuentan operaciones, no
 *    líneas: las líneas de un pedido de la tienda comparten número de pedido y son una sola venta.
 *  - Facturas pendientes de cobro: facturas emitidas o enviadas sin marcar como cobradas (ni anuladas ni abonos) y
 *    que no son de un pedido ya cobrado (la venta en caja o el pedido manual cobrado generan su factura sin marcarla),
 *    por lo que queda de cada una después de sus abonos (un abono parcial reduce lo pendiente).
 *  - Presupuestos enviados sin respuesta: enviados o vistos por el cliente, sin aceptar ni rechazar.
 *  - Clientes nuevos: dados de alta este mes.
 *  - Pedidos online pendientes: de la tienda online, cobrados y aún sin finalizar.
 */
export interface HomeIndicators {
  sales: { today: { amount: number; count: number }; month: { amount: number; count: number } } | null;
  unpaidInvoices: { count: number; amount: number } | null;
  awaitingQuotes: { count: number; amount: number } | null;
  newClients: { count: number } | null;
  pendingOnlineOrders: { count: number } | null;
}

const MADRID_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Inicio del día y del mes en curso en hora de Madrid (ms). Pura: la usan las pruebas. */
export function madridPeriodStarts(now: number): { dayStart: number; monthStart: number } {
  const p = Object.fromEntries(MADRID_PARTS.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const [y, m, d] = [Number(p.year), Number(p.month), Number(p.day)];
  // Diferencia entre la hora de Madrid y UTC en este instante (1 h en invierno, 2 h en verano)
  const offset = Date.UTC(y, m - 1, d, Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(now / 1000) * 1000;
  return { dayStart: Date.UTC(y, m - 1, d) - offset, monthStart: Date.UTC(y, m - 1, 1) - offset };
}

/** Lo pendiente de cobro de cada factura después de sus abonos (que se guardan en negativo). Pura: la usan las pruebas. */
export function unpaidAfterCredits(pending: Array<{ id: number; total: unknown }>, credits: Array<{ creditNoteForId: number | null; total: unknown }>) {
  const credited = new Map<number, number>();
  for (const c of credits) {
    if (c.creditNoteForId == null) continue;
    credited.set(c.creditNoteForId, (credited.get(c.creditNoteForId) ?? 0) + Math.abs(Number(c.total) || 0));
  }
  let n = 0;
  let cents = 0;
  for (const p of pending) {
    const left = Math.round((Number(p.total) || 0) * 100) - Math.round((credited.get(p.id) ?? 0) * 100);
    if (left <= 0) continue;
    n++;
    cents += left;
  }
  return { count: n, amount: cents / 100 };
}

/** Suma de ventas cobradas (importes en céntimos) de hoy y del mes. Pura: la usan las pruebas. */
export function summarizeSales(rows: Array<{ at: number; amountTotal: number | null; amountPaid: number | null; key?: string | null }>, starts: { dayStart: number; monthStart: number }) {
  const out = { today: { amount: 0, count: 0 }, month: { amount: 0, count: 0 } };
  // Una venta por operación: las líneas con la misma clave (el número de pedido) cuentan una vez
  const monthKeys = new Set<string>();
  const todayKeys = new Set<string>();
  rows.forEach((r, idx) => {
    if (!(r.at >= starts.monthStart)) return;
    const key = r.key ?? `#${idx}`;
    const cents = Number(r.amountPaid) > 0 ? Number(r.amountPaid) : Number(r.amountTotal) || 0;
    out.month.amount += cents;
    monthKeys.add(key);
    if (r.at >= starts.dayStart) {
      out.today.amount += cents;
      todayKeys.add(key);
    }
  });
  out.month.count = monthKeys.size;
  out.today.count = todayKeys.size;
  out.today.amount = Math.round(out.today.amount) / 100;
  out.month.amount = Math.round(out.month.amount) / 100;
  return out;
}

async function allowed(cap: string): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(cap, { write: false })).allowed;
  } catch {
    // Sin poder verificar la licencia, ese bloque no se muestra
    return false;
  }
}

export async function homeIndicators(now = Date.now()): Promise<HomeIndicators> {
  const empty: HomeIndicators = { sales: null, unpaidInvoices: null, awaitingQuotes: null, newClients: null, pendingOnlineOrders: null };
  const db = await getDb();
  if (!db) return empty;
  const [orders, cash, inv, quo, cli] = await Promise.all(["shop-orders", "bill-cash", "bill-invoices", "crm-quotes", "crm-contacts"].map(allowed));
  const starts = madridPeriodStarts(now);
  const paidAt = sql<number>`COALESCE(${reservations.paidAt}, ${reservations.createdAt})`;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const [salesRows, invRow, quoRow, cliRow, onlineRow] = await Promise.all([
    orders || cash
      ? db.select({ id: reservations.id, merchantOrder: reservations.merchantOrder, at: paidAt, amountTotal: reservations.amountTotal, amountPaid: reservations.amountPaid }).from(reservations).where(and(eq(reservations.status, "paid"), sql`${paidAt} >= ${starts.monthStart}`))
      : null,
    inv
      ? db
          .select({ id: invoices.id, total: invoices.total })
          .from(invoices)
          .where(and(
            inArray(invoices.status, ["generada", "enviada"]),
            eq(invoices.invoiceType, "factura"),
            sql`NOT EXISTS (SELECT 1 FROM ${reservations} WHERE ${reservations.status} = 'paid' AND (${reservations.id} = ${invoices.reservationId} OR ${reservations.invoiceId} = ${invoices.id}))`,
          ))
          .then(async (pending) => {
            const ids = pending.map((p) => p.id);
            const credits = ids.length
              ? await db
                  .select({ creditNoteForId: invoices.creditNoteForId, total: invoices.total })
                  .from(invoices)
                  .where(and(eq(invoices.invoiceType, "abono"), ne(invoices.status, "anulada"), inArray(invoices.creditNoteForId, ids)))
              : [];
            return unpaidAfterCredits(pending, credits);
          })
      : null,
    quo ? db.select({ n: count(), total: sum(quotes.total) }).from(quotes).where(inArray(quotes.status, ["enviado", "visualizado"])).then((r) => r[0]) : null,
    cli ? db.select({ n: count() }).from(clients).where(gte(clients.createdAt, new Date(starts.monthStart))).then((r) => r[0]) : null,
    orders
      ? db
          // Pedidos (no líneas) de la tienda, igual que «Pedidos de la tienda»: pagados o preparados (shared/shopOrders.ts)
          .select({ n: countDistinct(reservations.merchantOrder) })
          .from(reservations)
          .where(and(
            eq(reservations.channel, "ONLINE_DIRECTO"),
            isNull(reservations.quoteId),
            eq(reservations.status, "paid"),
            inArray(reservations.statusReservation, ["PENDIENTE_CONFIRMACION", "CONFIRMADA", "EN_CURSO"]),
          ))
          .then((r) => r[0])
      : null,
  ]);
  return {
    sales: salesRows ? summarizeSales(salesRows.map((r) => ({ at: num(r.at), amountTotal: r.amountTotal, amountPaid: r.amountPaid, key: r.merchantOrder ? `p:${r.merchantOrder}` : `r:${r.id}` })), starts) : null,
    unpaidInvoices: invRow,
    awaitingQuotes: quoRow ? { count: num(quoRow.n), amount: num(quoRow.total) } : null,
    newClients: cliRow ? { count: num(cliRow.n) } : null,
    pendingOnlineOrders: onlineRow ? { count: num(onlineRow.n) } : null,
  };
}
