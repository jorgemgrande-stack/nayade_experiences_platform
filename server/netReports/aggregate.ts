/**
 * Informes sectoriales de Elephant Net — cálculos puros (sin base de datos). Cada informe lee filas ya filtradas por
 * periodo, sede y empresa (`store.ts`) y aquí se agregan. Importes en céntimos; fechas en la zona del Core (Madrid).
 */

export const REPORT_TIME_ZONE = "Europe/Madrid";

/** Fecha local (YYYY-MM-DD) y hora (0–23) de un instante en Madrid. */
export function localParts(ms: number, timeZone = REPORT_TIME_ZONE): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Instante (ms) del comienzo de un día local de Madrid. */
export function localDayStartMs(date: string, timeZone = REPORT_TIME_ZONE): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  // Desfase de Madrid en ese momento (1 o 2 h): se corrige con la hora local que da el formateador
  const { date: d, hour } = localParts(guess, timeZone);
  const offsetH = d === date ? hour : hour - 24;
  return guess - offsetH * 3_600_000;
}

/** Intervalo [desde, hasta) en ms de un periodo de días locales [from, to] (ambos inclusive). */
export function periodMs(from: string, to: string): { fromMs: number; toMs: number } {
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { fromMs: localDayStartMs(from), toMs: localDayStartMs(next.toISOString().slice(0, 10)) };
}

const round = (n: number) => Math.round(n);
const avg = (sum: number, n: number) => (n > 0 ? round(sum / n) : 0);
const pctBp = (part: number, total: number) => (total > 0 ? round((part / total) * 10000) : 0);

function groupBy<T, K extends string | number>(list: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Percentil (0–100) de una lista de números (método del rango más cercano). */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

// ─── Restaurant Net · informes operativos ─────────────────────────────────────

export type Shift = "manana" | "comida" | "cena";
export const SHIFT_LABEL: Record<Shift, string> = { manana: "Mañana", comida: "Comida", cena: "Cena" };

/** Turno por la hora local de apertura de la comanda: antes de las 12, mañana; de 12 a 17, comida; después, cena. */
export function shiftOf(hour: number): Shift {
  if (hour < 12) return "manana";
  if (hour < 17) return "comida";
  return "cena";
}

export interface RestaurantOrder {
  id: number;
  openedAt: number;
  totalCents: number;
  guests: number;
  roomName: string | null;
  waiterName: string | null;
}

export interface RestaurantItem {
  orderId: number;
  name: string;
  quantity: number;
  amountCents: number;
  station: string | null;
  firedAt: number | null;
  readyAt: number | null;
}

interface SalesRow { key: string; orders: number; guests: number; salesCents: number; avgTicketCents: number }

function salesRows<T extends RestaurantOrder>(orders: readonly T[], key: (o: T) => string): SalesRow[] {
  return Array.from(groupBy(orders, key).entries())
    .map(([k, list]) => {
      const sales = list.reduce((s, o) => s + o.totalCents, 0);
      return { key: k, orders: list.length, guests: list.reduce((s, o) => s + o.guests, 0), salesCents: sales, avgTicketCents: avg(sales, list.length) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Ventas cobradas (comandas pagadas) por día, turno, sala y camarero; ticket medio por comanda y por comensal; platos
 * más vendidos (sin anulados) y tiempos de cocina por estación (envío a cocina → listo), con el % fuera de plazo.
 */
export function restaurantReport(orders: readonly RestaurantOrder[], items: readonly RestaurantItem[], slaByStation: ReadonlyMap<string, number>) {
  const sales = orders.reduce((s, o) => s + o.totalCents, 0);
  const guests = orders.reduce((s, o) => s + o.guests, 0);
  const local = orders.map((o) => ({ ...o, ...localParts(o.openedAt) }));
  const dishes = Array.from(groupBy(items, (i) => i.name).entries())
    .map(([name, list]) => ({ name, quantity: list.reduce((s, i) => s + i.quantity, 0), salesCents: list.reduce((s, i) => s + i.amountCents, 0) }))
    .sort((a, b) => b.quantity - a.quantity || b.salesCents - a.salesCents || a.name.localeCompare(b.name, "es"));
  const timed = items.filter((i) => i.firedAt != null && i.readyAt != null && i.readyAt >= i.firedAt);
  const kitchen = Array.from(groupBy(timed, (i) => i.station ?? "Sin estación").entries())
    .map(([station, list]) => {
      const minutes = list.map((i) => (i.readyAt! - i.firedAt!) / 60_000);
      const sla = slaByStation.get(station) ?? null;
      const late = sla === null ? 0 : minutes.filter((m) => m > sla).length;
      return {
        station, items: list.length, avgMinutes: Math.round((minutes.reduce((s, m) => s + m, 0) / list.length) * 10) / 10,
        p90Minutes: Math.round(percentile(minutes, 90) * 10) / 10, slaMinutes: sla, lateBp: pctBp(late, list.length),
      };
    })
    .sort((a, b) => a.station.localeCompare(b.station, "es"));
  return {
    totals: { orders: orders.length, guests, salesCents: sales, avgTicketCents: avg(sales, orders.length), avgPerGuestCents: avg(sales, guests) },
    byDay: salesRows(local, (o) => o.date),
    byShift: salesRows(local, (o) => shiftOf(o.hour)).map((r) => ({ ...r, label: SHIFT_LABEL[r.key as Shift] })),
    byRoom: salesRows(local, (o) => o.roomName ?? "Sin sala").sort((a, b) => b.salesCents - a.salesCents),
    byWaiter: salesRows(local, (o) => o.waiterName ?? "Sin asignar").sort((a, b) => b.salesCents - a.salesCents),
    topDishes: dishes.slice(0, 20),
    kitchen,
  };
}

// ─── Care Net · estadísticas del centro ───────────────────────────────────────

export interface CareSlot {
  id: number;
  resourceId: number | null;
  resourceName: string | null;
  resourceType: string | null;
  treatmentId: number;
  minutes: number;
  capacity: number;
  bookedCount: number;
  blocked: boolean;
}

export interface CareAppointment {
  slotId: number;
  treatmentId: number;
  treatmentName: string;
  amountCents: number;
  paid: boolean;
  people: number;
}

export interface CarePurchase { packName: string; priceCents: number; purchasedAt: number | null }
export interface CareConsumption { consumedAt: number }
export interface CareExpiry { packName: string; sessionsLeft: number }

/**
 * Ocupación por cabina y profesional (minutos reservados sobre minutos ofrecidos en franjas no bloqueadas), citas e
 * ingresos por tratamiento (citas cobradas) y bonos vendidos, consumidos y caducados con sesiones sin usar.
 */
export function careReport(input: {
  slots: readonly CareSlot[];
  appointments: readonly CareAppointment[];
  purchases: readonly CarePurchase[];
  consumptions: readonly CareConsumption[];
  expired: readonly CareExpiry[];
}) {
  const open = input.slots.filter((s) => !s.blocked);
  const occupancy = Array.from(groupBy(open, (s) => `${s.resourceType ?? "sin"}|${s.resourceId ?? 0}`).entries())
    .map(([, list]) => {
      const offered = list.reduce((s, x) => s + x.minutes * Math.max(1, x.capacity), 0);
      const booked = list.reduce((s, x) => s + x.minutes * Math.min(Math.max(0, x.bookedCount), Math.max(1, x.capacity)), 0);
      return {
        resourceId: list[0].resourceId, name: list[0].resourceName ?? "Sin cabina ni profesional", type: list[0].resourceType ?? "sin_recurso",
        slots: list.length, offeredMinutes: offered, bookedMinutes: booked, occupancyBp: pctBp(booked, offered),
      };
    })
    .sort((a, b) => b.occupancyBp - a.occupancyBp || a.name.localeCompare(b.name, "es"));
  const byTreatment = Array.from(groupBy(input.appointments, (a) => a.treatmentId).entries())
    .map(([treatmentId, list]) => ({
      treatmentId, name: list[0].treatmentName, appointments: list.length, people: list.reduce((s, a) => s + a.people, 0),
      revenueCents: list.filter((a) => a.paid).reduce((s, a) => s + a.amountCents, 0),
    }))
    .sort((a, b) => b.appointments - a.appointments || a.name.localeCompare(b.name, "es"));
  const appointmentRevenue = input.appointments.filter((a) => a.paid).reduce((s, a) => s + a.amountCents, 0);
  const packRevenue = input.purchases.reduce((s, p) => s + p.priceCents, 0);
  return {
    totals: {
      appointments: input.appointments.length, revenueCents: appointmentRevenue + packRevenue, appointmentRevenueCents: appointmentRevenue,
      packRevenueCents: packRevenue, occupancyBp: pctBp(occupancy.reduce((s, o) => s + o.bookedMinutes, 0), occupancy.reduce((s, o) => s + o.offeredMinutes, 0)),
    },
    occupancy,
    byTreatment,
    packs: {
      sold: input.purchases.length,
      consumedSessions: input.consumptions.length,
      expired: input.expired.length,
      expiredSessionsLeft: input.expired.reduce((s, e) => s + e.sessionsLeft, 0),
      byPack: Array.from(groupBy(input.purchases, (p) => p.packName).entries())
        .map(([name, list]) => ({ name, sold: list.length, revenueCents: list.reduce((s, p) => s + p.priceCents, 0) }))
        .sort((a, b) => b.sold - a.sold),
    },
  };
}

// ─── Ski Net · estadísticas operativas ────────────────────────────────────────

export interface SkiSession {
  id: number;
  productName: string;
  level: string | null;
  minutes: number;
  instructorId: number | null;
  instructorName: string | null;
  status: string;
  participants: number;
}

export interface SkiDeliveryLine { assetType: string; unitId: number }
export interface SkiWorkshopTicket { status: string; resolution: string | null; openedAt: number; closedAt: number | null }

/**
 * Sesiones y alumnos por producto y nivel (sin canceladas), horas por profesor (sesiones asignadas o completadas),
 * alquileres y rotación de material (salidas por unidad de cada tipo) e incidencias de taller.
 */
export function skiReport(input: {
  sessions: readonly SkiSession[];
  deliveries: number;
  lines: readonly SkiDeliveryLine[];
  unitsByType: ReadonlyMap<string, number>;
  tickets: readonly SkiWorkshopTicket[];
}) {
  const live = input.sessions.filter((s) => s.status !== "cancelled");
  const byProduct = Array.from(groupBy(live, (s) => `${s.productName}|${s.level ?? ""}`).entries())
    .map(([, list]) => ({ product: list[0].productName, level: list[0].level ?? "—", sessions: list.length, participants: list.reduce((s, x) => s + x.participants, 0) }))
    .sort((a, b) => b.sessions - a.sessions || a.product.localeCompare(b.product, "es"));
  const worked = live.filter((s) => s.instructorId != null && (s.status === "assigned" || s.status === "completed"));
  const byInstructor = Array.from(groupBy(worked, (s) => s.instructorId!).entries())
    .map(([instructorId, list]) => ({
      instructorId, name: list[0].instructorName ?? `Profesor ${instructorId}`, sessions: list.length,
      hours: Math.round((list.reduce((s, x) => s + x.minutes, 0) / 60) * 10) / 10, completed: list.filter((x) => x.status === "completed").length,
    }))
    .sort((a, b) => b.hours - a.hours);
  const types = new Set<string>([...Array.from(input.unitsByType.keys()), ...input.lines.map((l) => l.assetType)]);
  const rotation = Array.from(types)
    .map((type) => {
      const outs = input.lines.filter((l) => l.assetType === type).length;
      const units = input.unitsByType.get(type) ?? 0;
      return { assetType: type, units, rentals: outs, rotation: units > 0 ? Math.round((outs / units) * 100) / 100 : 0 };
    })
    .sort((a, b) => b.rentals - a.rentals || a.assetType.localeCompare(b.assetType, "es"));
  const closed = input.tickets.filter((t) => t.closedAt != null);
  const days = closed.map((t) => (t.closedAt! - t.openedAt) / 86_400_000);
  return {
    totals: {
      sessions: live.length, participants: live.reduce((s, x) => s + x.participants, 0), cancelled: input.sessions.length - live.length,
      instructorHours: Math.round((worked.reduce((s, x) => s + x.minutes, 0) / 60) * 10) / 10, deliveries: input.deliveries, rentedUnits: input.lines.length,
    },
    byProduct,
    byInstructor,
    rotation,
    workshop: {
      opened: input.tickets.length,
      open: input.tickets.filter((t) => t.status === "open").length,
      closed: closed.length,
      avgDaysToClose: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : 0,
      byResolution: Array.from(groupBy(closed, (t) => t.resolution ?? "sin_resolucion").entries()).map(([resolution, list]) => ({ resolution, tickets: list.length })),
    },
  };
}

// ─── Travel Net · informes comerciales ────────────────────────────────────────

export interface TravelFileRow { id: number; status: string; createdAt: number }
export interface TravelServiceRow {
  fileId: number;
  fileStatus: string;
  supplierId: number | null;
  supplierName: string | null;
  month: string;
  netCents: number;
  sellingCents: number;
  commissionBp: number | null;
  pricingMode: string;
}
export interface TravelOperationRow { status: string; slaDeadlineAt: number | null }

const SOLD = new Set(["reservado", "cerrado"]);
const OPERATION_DONE = new Set(["consolidated", "provider_cancelled", "internally_cancelled"]);

/**
 * Expedientes por estado, margen y comisiones por proveedor y por mes (servicios de expedientes reservados o cerrados;
 * comisión = margen de los servicios a comisión) y operaciones pendientes con las que superan su plazo.
 */
export function travelReport(input: { files: readonly TravelFileRow[]; services: readonly TravelServiceRow[]; operations: readonly TravelOperationRow[]; now: number }) {
  const sold = input.services.filter((s) => SOLD.has(s.fileStatus));
  const agg = (list: readonly TravelServiceRow[]) => {
    const selling = list.reduce((s, x) => s + x.sellingCents, 0);
    const net = list.reduce((s, x) => s + x.netCents, 0);
    const commission = list.filter((x) => x.pricingMode === "comision").reduce((s, x) => s + (x.sellingCents - x.netCents), 0);
    return { services: list.length, sellingCents: selling, netCents: net, marginCents: selling - net, marginBp: pctBp(selling - net, selling), commissionCents: commission };
  };
  const pending = input.operations.filter((o) => !OPERATION_DONE.has(o.status));
  return {
    totals: { files: input.files.length, ...agg(sold) },
    byStatus: Array.from(groupBy(input.files, (f) => f.status).entries()).map(([status, list]) => ({ status, files: list.length })).sort((a, b) => b.files - a.files),
    bySupplier: Array.from(groupBy(sold, (s) => s.supplierId ?? 0).entries())
      .map(([supplierId, list]) => ({ supplierId: supplierId || null, name: list[0].supplierName ?? "Inventario propio", ...agg(list) }))
      .sort((a, b) => b.sellingCents - a.sellingCents),
    byMonth: Array.from(groupBy(sold, (s) => s.month).entries()).map(([month, list]) => ({ month, ...agg(list) })).sort((a, b) => (a.month < b.month ? -1 : 1)),
    operations: {
      pending: pending.length,
      overdue: pending.filter((o) => o.slaDeadlineAt != null && o.slaDeadlineAt < input.now).length,
      byStatus: Array.from(groupBy(pending, (o) => o.status).entries()).map(([status, list]) => ({ status, operations: list.length })).sort((a, b) => b.operations - a.operations),
    },
  };
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** CSV seguro para hojas de cálculo (separador «;», todo entre comillas, sin fórmulas). */
export function toCsv(rows: ReadonlyArray<Record<string, string | number | null>>): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [cols.map(cell).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\r\n");
}

/** Euros con coma decimal para el CSV (los importes se guardan en céntimos). */
export const csvEuros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
