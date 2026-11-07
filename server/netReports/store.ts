/**
 * Informes sectoriales — lecturas (solo SELECT) de las tablas de cada producto en la BD de la empresa en curso
 * (`getDb()`): nunca se mezclan empresas. Sin las tablas del producto (migración no aplicada) el informe sale vacío.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { periodMs, type CareAppointment, type CareConsumption, type CareExpiry, type CarePurchase, type CareSlot, type RestaurantItem, type RestaurantOrder, type SkiDeliveryLine, type SkiSession, type SkiWorkshopTicket, type TravelFileRow, type TravelOperationRow, type TravelServiceRow } from "./aggregate";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

async function rows<T>(q: SQL): Promise<T[]> {
  try {
    const [r] = (await (await db()).execute(q)) as unknown as [T[]];
    return r;
  } catch (e) {
    for (let x: any = e, i = 0; x && i < 5; x = x.cause, i++) if (x.code === "ER_NO_SUCH_TABLE" || x.code === "ER_BAD_FIELD_ERROR") return [];
    throw e;
  }
}

const n = (v: unknown) => Number(v ?? 0);
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const list = (ids: readonly number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/** Filtro de sede sobre una columna site_id (la principal incluye lo que no tiene sede). */
function siteWhere(column: string, site: { siteId: string; isPrimary: boolean } | null): SQL {
  if (!site) return sql`1 = 1`;
  const c = sql.raw(column);
  return site.isPrimary ? sql`(${c} IS NULL OR ${c} = ${site.siteId})` : sql`${c} = ${site.siteId}`;
}

export interface Period { from: string; to: string }
export type SiteFilter = { siteId: string; isPrimary: boolean } | null;

// ─── Restaurant Net ───────────────────────────────────────────────────────────

/** Comandas cobradas abiertas en el periodo (de los restaurantes permitidos: null = todos). */
export async function restaurantData(p: Period, site: SiteFilter, restaurantIds: readonly number[] | null) {
  const { fromMs, toMs } = periodMs(p.from, p.to);
  const restaurant = restaurantIds ? (restaurantIds.length ? sql`o.restaurant_id IN (${list(restaurantIds)})` : sql`1 = 0`) : sql`1 = 1`;
  const orders = (await rows<{ id: number; opened_at: number; total: string; guests: number; room_name: string | null; waiter: string | null }>(sql`
    SELECT o.id, o.opened_at, o.total, o.guests, r.name AS room_name, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS waiter
    FROM hospo_orders o
    LEFT JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN dining_rooms r ON r.id = t.room_id
    LEFT JOIN users u ON u.id = o.waiter_user_id
    WHERE o.status = 'paid' AND o.opened_at >= ${fromMs} AND o.opened_at < ${toMs} AND ${restaurant} AND ${siteWhere("o.site_id", site)}`))
    .map((r): RestaurantOrder => ({ id: n(r.id), openedAt: n(r.opened_at), totalCents: cents(r.total), guests: n(r.guests), roomName: r.room_name, waiterName: r.waiter }));
  const items = orders.length
    ? (await rows<{ order_id: number; name: string; quantity: number; unit_price: string; station: string | null; fired_at: number | null; ready_at: number | null }>(sql`
        SELECT order_id, name, quantity, unit_price, station, fired_at, ready_at FROM hospo_order_items
        WHERE status <> 'void' AND order_id IN (${list(orders.map((o) => o.id))})`))
        .map((i): RestaurantItem => ({ orderId: n(i.order_id), name: i.name, quantity: n(i.quantity), amountCents: Math.round(n(i.quantity) * cents(i.unit_price)), station: i.station, firedAt: i.fired_at === null ? null : n(i.fired_at), readyAt: i.ready_at === null ? null : n(i.ready_at) }))
    : [];
  const stations = await rows<{ name: string; sla_minutes: number }>(sql`
    SELECT name, MAX(sla_minutes) AS sla_minutes FROM hospo_kitchen_stations
    WHERE is_active = 1 ${restaurantIds ? (restaurantIds.length ? sql`AND restaurant_id IN (${list(restaurantIds)})` : sql`AND 1 = 0`) : sql``} GROUP BY name`);
  return { orders, items, sla: new Map(stations.map((s) => [s.name, n(s.sla_minutes)])) };
}

// ─── Care Net ─────────────────────────────────────────────────────────────────

/** Franjas, citas, bonos vendidos, sesiones consumidas y bonos caducados del periodo (bonos filtrados por sede). */
export async function careData(p: Period, site: SiteFilter) {
  const { fromMs, toMs } = periodMs(p.from, p.to);
  const slots = (await rows<{ id: number; resourceId: number | null; resource_name: string | null; resource_type: string | null; treatmentId: number; startTime: string; endTime: string; capacity: number; bookedCount: number; status: string }>(sql`
    SELECT s.id, s.resourceId, r.name AS resource_name, r.type AS resource_type, s.treatmentId, s.startTime, s.endTime, s.capacity, s.bookedCount, s.status
    FROM spa_slots s LEFT JOIN spa_resources r ON r.id = s.resourceId
    WHERE s.date >= ${p.from} AND s.date <= ${p.to}`))
    .map((s): CareSlot => {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      return { id: n(s.id), resourceId: s.resourceId === null ? null : n(s.resourceId), resourceName: s.resource_name, resourceType: s.resource_type, treatmentId: n(s.treatmentId), minutes: Math.max(0, eh * 60 + em - (sh * 60 + sm)), capacity: n(s.capacity), bookedCount: n(s.bookedCount), blocked: s.status === "bloqueado" };
    });
  const appointments = (await rows<{ slot_id: number; treatmentId: number; treatment_name: string | null; amount_total: number; status: string; units: number | null }>(sql`
    SELECT r.inventory_ref_id AS slot_id, s.treatmentId, t.name AS treatment_name, r.amount_total, r.status, r.inventory_units AS units
    FROM reservations r
    JOIN spa_slots s ON s.id = r.inventory_ref_id
    LEFT JOIN spa_treatments t ON t.id = s.treatmentId
    WHERE r.inventory_kind = 'spa_slot' AND s.date >= ${p.from} AND s.date <= ${p.to}
      AND r.status NOT IN ('cancelled', 'failed') AND (r.hold_status IS NULL OR r.hold_status IN ('retenida', 'confirmada'))`))
    .map((a): CareAppointment => ({ slotId: n(a.slot_id), treatmentId: n(a.treatmentId), treatmentName: a.treatment_name ?? `Tratamiento ${a.treatmentId}`, amountCents: n(a.amount_total), paid: a.status === "paid", people: Math.max(1, n(a.units)) }));
  const purchases = (await rows<{ pack_name: string; price: string; purchased_at: number }>(sql`
    SELECT pack_name, price, purchased_at FROM care_pack_purchases
    WHERE purchased_at IS NOT NULL AND purchased_at >= ${fromMs} AND purchased_at < ${toMs} AND status <> 'cancelled' AND ${siteWhere("site_id", site)}`))
    .map((x): CarePurchase => ({ packName: x.pack_name, priceCents: cents(x.price), purchasedAt: n(x.purchased_at) }));
  const consumptions = (await rows<{ consumed_at: number }>(sql`
    SELECT consumed_at FROM care_pack_consumptions WHERE status = 'consumed' AND consumed_at >= ${fromMs} AND consumed_at < ${toMs} AND ${siteWhere("site_id", site)}`))
    .map((x): CareConsumption => ({ consumedAt: n(x.consumed_at) }));
  const expired = (await rows<{ pack_name: string; left_: number }>(sql`
    SELECT pack_name, sessions_total - sessions_used AS left_ FROM care_pack_purchases
    WHERE purchased_at IS NOT NULL AND expires_at >= ${fromMs} AND expires_at < ${toMs} AND sessions_used < sessions_total AND status <> 'cancelled'
      AND ${siteWhere("site_id", site)}`))
    .map((x): CareExpiry => ({ packName: x.pack_name, sessionsLeft: n(x.left_) }));
  return { slots, appointments, purchases, consumptions, expired };
}

// ─── Ski Net (siempre de una sede) ────────────────────────────────────────────

export async function skiData(p: Period, siteId: string, parts: { school: boolean; rental: boolean }) {
  const { fromMs, toMs } = periodMs(p.from, p.to);
  const sessions = parts.school
    ? (await rows<{ id: number; product_name: string | null; level: string | null; minutes: number; instructor_id: number | null; instructor_name: string | null; status: string; participants: number }>(sql`
        SELECT s.id, pr.name AS product_name, COALESCE(s.level, pr.level) AS level,
          TIME_TO_SEC(TIMEDIFF(STR_TO_DATE(s.end_time, '%H:%i'), STR_TO_DATE(s.start_time, '%H:%i'))) / 60 AS minutes,
          s.instructor_id, i.full_name AS instructor_name, s.status,
          (SELECT COUNT(*) FROM ski_school_participants pa WHERE pa.session_id = s.id AND pa.status = 'enrolled') AS participants
        FROM ski_school_sessions s
        LEFT JOIN ski_school_products pr ON pr.id = s.product_id
        LEFT JOIN ski_school_instructors i ON i.id = s.instructor_id
        WHERE s.site_id = ${siteId} AND s.session_date >= ${p.from} AND s.session_date <= ${p.to}`))
        .map((s): SkiSession => ({ id: n(s.id), productName: s.product_name ?? "Producto", level: s.level, minutes: n(s.minutes), instructorId: s.instructor_id === null ? null : n(s.instructor_id), instructorName: s.instructor_name, status: s.status, participants: n(s.participants) }))
    : [];
  if (!parts.rental) return { sessions, deliveries: 0, lines: [] as SkiDeliveryLine[], unitsByType: new Map<string, number>(), tickets: [] as SkiWorkshopTicket[] };
  const [dCount] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM ski_rental_deliveries WHERE site_id = ${siteId} AND start_date >= ${p.from} AND start_date <= ${p.to}`);
  const lines = (await rows<{ asset_type: string; unit_id: number }>(sql`
    SELECT m.asset_type, l.unit_id FROM ski_rental_delivery_lines l
    JOIN ski_rental_deliveries d ON d.id = l.delivery_id
    JOIN ski_rental_units u ON u.id = l.unit_id
    JOIN ski_rental_models m ON m.id = u.model_id
    WHERE d.site_id = ${siteId} AND d.start_date >= ${p.from} AND d.start_date <= ${p.to}`)).map((l): SkiDeliveryLine => ({ assetType: l.asset_type, unitId: n(l.unit_id) }));
  const units = await rows<{ asset_type: string; c: number }>(sql`
    SELECT m.asset_type, COUNT(*) AS c FROM ski_rental_units u JOIN ski_rental_models m ON m.id = u.model_id
    WHERE u.site_id = ${siteId} AND u.status <> 'retired' GROUP BY m.asset_type`);
  const tickets = (await rows<{ status: string; resolution: string | null; opened: number; closed: number | null }>(sql`
    SELECT status, resolution, UNIX_TIMESTAMP(created_at) * 1000 AS opened, UNIX_TIMESTAMP(closed_at) * 1000 AS closed FROM ski_rental_workshop_tickets
    WHERE site_id = ${siteId} AND created_at >= FROM_UNIXTIME(${fromMs / 1000}) AND created_at < FROM_UNIXTIME(${toMs / 1000})`))
    .map((t): SkiWorkshopTicket => ({ status: t.status, resolution: t.resolution, openedAt: n(t.opened), closedAt: t.closed === null ? null : n(t.closed) }));
  return { sessions, deliveries: n(dCount?.c), lines, unitsByType: new Map(units.map((u) => [u.asset_type, n(u.c)])), tickets };
}

// ─── Travel Net ───────────────────────────────────────────────────────────────

/** Expedientes creados en el periodo, servicios con fecha en el periodo y operaciones vivas (todas, por sede). */
export async function travelData(p: Period, site: SiteFilter) {
  const { fromMs, toMs } = periodMs(p.from, p.to);
  const files = (await rows<{ id: number; status: string; created_at: number }>(sql`
    SELECT id, status, created_at FROM travel_files f WHERE created_at >= ${fromMs} AND created_at < ${toMs} AND ${siteWhere("f.site_id", site)}`))
    .map((f): TravelFileRow => ({ id: n(f.id), status: f.status, createdAt: n(f.created_at) }));
  const services = (await rows<{ file_id: number; file_status: string; supplier_id: number | null; supplier_name: string | null; day: string; net_cents: number; selling_cents: number; commission_bp: number | null; pricing_mode: string }>(sql`
    SELECT s.file_id, f.status AS file_status, s.supplier_id, COALESCE(NULLIF(sp.commercialName, ''), sp.fiscalName) AS supplier_name,
      COALESCE(s.service_date, f.start_date, DATE_FORMAT(FROM_UNIXTIME(f.created_at / 1000), '%Y-%m-%d')) AS day,
      s.net_cents, s.selling_cents, s.commission_bp, s.pricing_mode
    FROM travel_file_services s JOIN travel_files f ON f.id = s.file_id LEFT JOIN suppliers sp ON sp.id = s.supplier_id
    WHERE ${siteWhere("f.site_id", site)}
    HAVING day >= ${p.from} AND day <= ${p.to}`))
    .map((s): TravelServiceRow => ({ fileId: n(s.file_id), fileStatus: s.file_status, supplierId: s.supplier_id === null ? null : n(s.supplier_id), supplierName: s.supplier_name, month: s.day.slice(0, 7), netCents: n(s.net_cents), sellingCents: n(s.selling_cents), commissionBp: s.commission_bp === null ? null : n(s.commission_bp), pricingMode: s.pricing_mode }));
  const operations = (await rows<{ status: string; sla_deadline_at: number | null }>(sql`
    SELECT o.status, o.sla_deadline_at FROM travel_operations o JOIN travel_files f ON f.id = o.file_id WHERE ${siteWhere("f.site_id", site)}`))
    .map((o): TravelOperationRow => ({ status: o.status, slaDeadlineAt: o.sla_deadline_at === null ? null : n(o.sla_deadline_at) }));
  return { files, services, operations };
}
