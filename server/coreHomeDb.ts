/**
 * Inicio del panel (Elephant Core): actividad reciente de la empresa en curso, con datos reales de su propia BD.
 *
 * Cada fuente se incluye solo si su capacidad está contratada (activa o en solo lectura): quien no tiene caja no ve
 * ventas en caja, aunque existieran filas de antes. Nunca mezcla empresas: `getDb()` resuelve la BD del tenant.
 */
import { desc } from "drizzle-orm";
import { clients, invoices, leads, quotes, reservations, tpvSales } from "../drizzle/schema";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";

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
      db.select({ customer: reservations.customerName, product: reservations.productName, at: reservations.createdAt }).from(reservations).orderBy(desc(reservations.createdAt)).limit(PER_SOURCE)
        .then((rows) => rows.map((r) => ({ kind: "order" as const, title: `Pedido de ${r.customer}`, detail: r.product, at: ts(r.at), href: "/admin/crm?tab=reservations" }))),
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
