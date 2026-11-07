/**
 * Restaurant Net · cocina (KDS) y camareros (capacidad `restaurant-net`) — acceso a datos. Lógica pura en
 * shared/restaurantKds.ts; procedimientos en server/routers/restaurantNet.ts (namespace `restaurantNet.kds`).
 *
 *  - Marchar: la sala envía a cocina las líneas pendientes de una comanda (todas o las de un pase) y se sella
 *    fired_at. La pantalla de cocina las avanza (en preparación → lista → servida) sellando cada tiempo; deshacer un
 *    paso borra el tiempo del paso deshecho. La sala ve el estado de cada línea en su comanda (consulta periódica).
 *  - Partidas y enrutado por categoría (migración 0035): la partida de una línea se decide al pedir el plato
 *    (restaurantNetDb.addItem). Semáforo por restaurante; incidencias y métricas del día.
 *  - Camareros: usuarios del Core (administración y el personal asignado al restaurante en restaurant_staff). Sin
 *    PIN ni sesión propia: cada uno entra con su cuenta.
 *  - Aislamiento: BD de la empresa; cada operación comprueba el restaurante con el `guard` del router.
 *
 * Adaptado del KDS de la aplicación de origen (server/routers/hospo.ts: sendToKitchen, kdsList, kdsSetStatus,
 * kdsServeOrder, partidas, enrutado, ajustes, incidencias y métricas). Cambios: restaurante del Core en lugar de
 * unidades de negocio, transiciones validadas, deshacer un paso, tonos por significado en lugar de colores fijos,
 * archivar partidas en lugar de borrarlas y camareros del Core en lugar del comandero con PIN.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { bigint, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { ModuleNotInstalled } from "./sdk";
import { isMissingKdsSchema, isMissingSalaSchema, type Guard, type RnExec } from "./restaurantNetDb";
import { OPEN_ORDER_STATUSES, RESTAURANT_NET_CAPABILITY } from "../shared/restaurantNet";
import {
  DEFAULT_KDS_SETTINGS,
  KITCHEN_FLOW,
  STATUS_STAMP,
  kdsSettingsProblem,
  kitchenMetrics,
  kitchenTransitionProblem,
  madridDayRange,
  type IncidentType,
  type KitchenMetrics,
  type KitchenStatus,
  type StationTone,
} from "../shared/restaurantKds";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Enrutado categoría → partida: se borra al quitar el enrutado de una categoría (constructor tipado, sin SQL crudo). */
const stationRouting = mysqlTable("hospo_station_routing", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurant_id").notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  station: varchar("station", { length: 40 }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

const OPEN_SQL = sql.join(OPEN_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

function notInstalled(what: "sala" | "cocina"): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: what === "sala"
      ? "La sala y las comandas de Restaurant Net aún no están instaladas en esta empresa. Pide a soporte que las activen."
      : "La cocina (KDS) de Restaurant Net aún no está instalada en esta empresa. Pide a soporte que la active.",
    cause: new ModuleNotInstalled(RESTAURANT_NET_CAPABILITY),
  });
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    const d = await getDb();
    if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
    return await fn(d);
  } catch (e) {
    if (isMissingKdsSchema(e)) throw notInstalled("cocina");
    if (isMissingSalaSchema(e)) throw notInstalled("sala");
    throw e;
  }
}

async function rows<T = any>(exec: RnExec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function affected(exec: RnExec, q: SQL): Promise<number> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number }];
  return r.affectedRows ?? 0;
}

async function orderRestaurant(exec: RnExec, orderId: number): Promise<{ id: number; restaurantId: number; status: string } | null> {
  const [o] = await rows(exec, sql`SELECT id, restaurant_id, status FROM hospo_orders WHERE id = ${orderId}`);
  return o ? { id: num(o.id), restaurantId: num(o.restaurant_id), status: String(o.status) } : null;
}

// ─── Marchar a cocina ────────────────────────────────────────────────────────

/** Envía a cocina las líneas pendientes (todas o las de un pase). Devuelve cuántas se marcharon. */
export function fireItems(guard: Guard, orderId: number, course: number | null): Promise<{ fired: number }> {
  return run(async (d) => {
    const o = await orderRestaurant(d, orderId);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    if (o.status !== "open" && o.status !== "bill_requested") throw bad("La comanda ya está cerrada o se está cobrando.");
    const fired = await affected(d, sql`UPDATE hospo_order_items SET status = 'sent', fired_at = ${Date.now()}, updated_at = ${Date.now()}
      WHERE order_id = ${o.id} AND status = 'pending'${course != null ? sql` AND course = ${course}` : sql``}`);
    if (fired === 0) throw bad(course != null ? `No hay platos del pase ${course} por marchar.` : "No hay platos por marchar.");
    return { fired };
  });
}

// ─── Pantalla de cocina ──────────────────────────────────────────────────────

export interface KdsLine {
  id: number;
  orderId: number;
  tableCode: string | null;
  guests: number;
  customerName: string | null;
  priority: string;
  waiterName: string | null;
  name: string;
  quantity: number;
  notes: string | null;
  seat: number | null;
  course: number;
  station: string | null;
  status: KitchenStatus;
  firedAt: number | null;
  prepStartedAt: number | null;
  readyAt: number | null;
}

export interface KdsStation {
  id: number;
  restaurantId: number;
  name: string;
  tone: StationTone;
  slaMinutes: number;
  sortOrder: number;
  isActive: boolean;
}
const toStation = (r: any): KdsStation => ({ id: num(r.id), restaurantId: num(r.restaurant_id), name: String(r.name), tone: r.tone, slaMinutes: num(r.sla_minutes), sortOrder: num(r.sort_order), isActive: Number(r.is_active) === 1 });

export interface KdsSettings {
  greenMaxMin: number;
  amberMaxMin: number;
}

async function settingsOf(exec: RnExec, restaurantId: number): Promise<KdsSettings> {
  const [s] = await rows(exec, sql`SELECT green_max_min, amber_max_min FROM hospo_kds_settings WHERE restaurant_id = ${restaurantId}`);
  return s ? { greenMaxMin: num(s.green_max_min), amberMaxMin: num(s.amber_max_min) } : { ...DEFAULT_KDS_SETTINGS };
}

/**
 * Líneas en cocina (marchadas, en preparación o listas) de las comandas abiertas del restaurante, de la más antigua a
 * la más reciente (las de prioridad alta primero). `station`: solo esa partida; "" = las que no tienen partida.
 */
export function kdsBoard(restaurantId: number, station: string | null): Promise<{ lines: KdsLine[]; stations: KdsStation[]; settings: KdsSettings; now: number }> {
  return run(async (d) => {
    const cond = station == null ? sql`` : station === "" ? sql` AND (i.station IS NULL OR i.station = '')` : sql` AND i.station = ${station}`;
    const list = await rows(d, sql`SELECT i.id, i.order_id, i.name, i.quantity, i.notes, i.seat, i.course, i.station, i.status, i.fired_at, i.prep_started_at, i.ready_at,
        o.guests, o.customer_name, o.priority, t.code AS table_code, u.name AS waiter_name
      FROM hospo_order_items i
      JOIN hospo_orders o ON o.id = i.order_id
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN users u ON u.id = o.waiter_user_id
      WHERE o.restaurant_id = ${restaurantId} AND o.status IN (${OPEN_SQL}) AND i.status IN ('sent', 'preparing', 'ready')${cond}
      ORDER BY (o.priority = 'high') DESC, i.fired_at, i.id`);
    const stations = (await rows(d, sql`SELECT * FROM hospo_kitchen_stations WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY sort_order, name`)).map(toStation);
    return {
      lines: list.map((r: any) => ({
        id: num(r.id), orderId: num(r.order_id), tableCode: r.table_code ?? null, guests: num(r.guests), customerName: r.customer_name ?? null, priority: String(r.priority),
        waiterName: r.waiter_name ?? null, name: String(r.name), quantity: num(r.quantity), notes: r.notes ?? null, seat: numOrNull(r.seat), course: num(r.course),
        station: r.station ?? null, status: r.status as KitchenStatus, firedAt: numOrNull(r.fired_at), prepStartedAt: numOrNull(r.prep_started_at), readyAt: numOrNull(r.ready_at),
      })),
      stations,
      settings: await settingsOf(d, restaurantId),
      now: Date.now(),
    };
  });
}

/** Cambia el estado de una línea desde cocina: sella el tiempo del nuevo estado y, al deshacer, borra el del deshecho. */
export function setKitchenStatus(guard: Guard, itemId: number, to: KitchenStatus): Promise<{ ok: true; status: KitchenStatus }> {
  return run(async (d) => {
    const [it] = await rows(d, sql`SELECT i.id, i.status, o.restaurant_id, o.status AS order_status FROM hospo_order_items i JOIN hospo_orders o ON o.id = i.order_id WHERE i.id = ${itemId}`);
    if (!it) throw notFound("La línea");
    await guard(num(it.restaurant_id));
    const problem = kitchenTransitionProblem(String(it.status), to);
    if (problem) throw bad(problem);
    if (String(it.status) === to) return { ok: true as const, status: to };
    const now = Date.now();
    const target = KITCHEN_FLOW.indexOf(to);
    const sets: SQL[] = [sql`status = ${to}`, sql`updated_at = ${now}`];
    if (target > KITCHEN_FLOW.indexOf(String(it.status) as KitchenStatus)) {
      // Avanzar (también saltando pasos): sella el nuevo estado y los saltados que no tenían tiempo
      for (let k = 1; k <= target; k++) {
        const col = sql.raw(STATUS_STAMP[KITCHEN_FLOW[k]]);
        sets.push(k === target ? sql`${col} = ${now}` : sql`${col} = COALESCE(${col}, ${now})`);
      }
    } else {
      for (let k = target + 1; k < KITCHEN_FLOW.length; k++) sets.push(sql`${sql.raw(STATUS_STAMP[KITCHEN_FLOW[k]])} = NULL`);
    }
    // Condición sobre el estado leído: dos pantallas a la vez no pisan el cambio de la otra
    const n = await affected(d, sql`UPDATE hospo_order_items SET ${sql.join(sets, sql`, `)} WHERE id = ${itemId} AND status = ${String(it.status)}`);
    if (n === 0) throw new TRPCError({ code: "CONFLICT", message: "Otra pantalla acaba de cambiar esta línea. Se ha actualizado la vista." });
    return { ok: true as const, status: to };
  });
}

/** «Servir mesa»: las líneas listas de la comanda pasan a servidas. */
export function serveReady(guard: Guard, orderId: number): Promise<{ served: number }> {
  return run(async (d) => {
    const o = await orderRestaurant(d, orderId);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    const now = Date.now();
    return { served: await affected(d, sql`UPDATE hospo_order_items SET status = 'served', served_at = ${now}, updated_at = ${now} WHERE order_id = ${o.id} AND status = 'ready'`) };
  });
}

export function setPriority(guard: Guard, orderId: number, priority: "normal" | "high"): Promise<{ ok: true }> {
  return run(async (d) => {
    const o = await orderRestaurant(d, orderId);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    await d.execute(sql`UPDATE hospo_orders SET priority = ${priority} WHERE id = ${o.id}`);
    return { ok: true as const };
  });
}

// ─── Partidas, enrutado y semáforo ───────────────────────────────────────────

export function listStations(restaurantId: number, includeArchived = false): Promise<KdsStation[]> {
  return run(async (d) =>
    (await rows(d, includeArchived
      ? sql`SELECT * FROM hospo_kitchen_stations WHERE restaurant_id = ${restaurantId} ORDER BY is_active DESC, sort_order, name`
      : sql`SELECT * FROM hospo_kitchen_stations WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY sort_order, name`)).map(toStation));
}

export function upsertStation(guard: Guard, input: { id?: number; restaurantId: number; name: string; tone: StationTone; slaMinutes: number; isActive?: boolean }): Promise<{ id: number }> {
  return run(async (d) => {
    await guard(input.restaurantId);
    const now = Date.now();
    const name = input.name.trim();
    try {
      if (input.id) {
        const [cur] = await rows(d, sql`SELECT restaurant_id, name FROM hospo_kitchen_stations WHERE id = ${input.id}`);
        if (!cur || num(cur.restaurant_id) !== input.restaurantId) throw notFound("La partida");
        await d.execute(sql`UPDATE hospo_kitchen_stations SET name = ${name}, tone = ${input.tone}, sla_minutes = ${input.slaMinutes},
          is_active = ${input.isActive === false ? 0 : 1}, updated_at = ${now} WHERE id = ${input.id}`);
        // Renombrar: el enrutado y los platos de la carta siguen a la partida
        if (String(cur.name) !== name) {
          await d.execute(sql`UPDATE hospo_station_routing SET station = ${name}, updated_at = ${now} WHERE restaurant_id = ${input.restaurantId} AND station = ${String(cur.name)}`);
          await d.execute(sql`UPDATE restaurant_menu_items SET station = ${name}, updated_at = ${now} WHERE restaurant_id = ${input.restaurantId} AND station = ${String(cur.name)}`);
        }
        return { id: input.id };
      }
      const [m] = await rows(d, sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM hospo_kitchen_stations WHERE restaurant_id = ${input.restaurantId}`);
      const [r] = (await d.execute(sql`INSERT INTO hospo_kitchen_stations (restaurant_id, name, tone, sla_minutes, sort_order, is_active, created_at, updated_at)
        VALUES (${input.restaurantId}, ${name}, ${input.tone}, ${input.slaMinutes}, ${num(m?.n ?? 1)}, 1, ${now}, ${now})`)) as unknown as [{ insertId: number }];
      return { id: Number(r.insertId) };
    } catch (e) {
      const x = e as any;
      if ((x?.code ?? x?.cause?.code) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: `Ya hay una partida «${name}» en este restaurante.` });
      throw e;
    }
  });
}

export function listRouting(restaurantId: number): Promise<Array<{ category: string; station: string }>> {
  return run(async (d) => (await rows(d, sql`SELECT category, station FROM hospo_station_routing WHERE restaurant_id = ${restaurantId} ORDER BY category`)).map((r: any) => ({ category: String(r.category), station: String(r.station) })));
}

/** Partida de una categoría de la carta (null = quitar el enrutado). Afecta a los platos que se pidan desde ahora. */
export function setRouting(guard: Guard, restaurantId: number, category: string, station: string | null): Promise<{ ok: true }> {
  return run(async (d) => {
    await guard(restaurantId);
    const cat = category.trim();
    if (station == null) {
      await d.delete(stationRouting).where(and(eq(stationRouting.restaurantId, restaurantId), eq(stationRouting.category, cat)));
      return { ok: true as const };
    }
    const [s] = await rows(d, sql`SELECT id FROM hospo_kitchen_stations WHERE restaurant_id = ${restaurantId} AND name = ${station} AND is_active = 1`);
    if (!s) throw notFound("La partida");
    const now = Date.now();
    await d.execute(sql`INSERT INTO hospo_station_routing (restaurant_id, category, station, created_at, updated_at) VALUES (${restaurantId}, ${cat}, ${station}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE station = VALUES(station), updated_at = VALUES(updated_at)`);
    return { ok: true as const };
  });
}

export function getKdsSettings(restaurantId: number): Promise<KdsSettings> {
  return run((d) => settingsOf(d, restaurantId));
}

export function setKdsSettings(guard: Guard, restaurantId: number, s: KdsSettings, userId: number): Promise<{ ok: true }> {
  return run(async (d) => {
    await guard(restaurantId);
    const problem = kdsSettingsProblem(s.greenMaxMin, s.amberMaxMin);
    if (problem) throw bad(problem);
    await d.execute(sql`INSERT INTO hospo_kds_settings (restaurant_id, green_max_min, amber_max_min, updated_by, updated_at) VALUES (${restaurantId}, ${s.greenMaxMin}, ${s.amberMaxMin}, ${userId}, ${Date.now()})
      ON DUPLICATE KEY UPDATE green_max_min = VALUES(green_max_min), amber_max_min = VALUES(amber_max_min), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
    return { ok: true as const };
  });
}

// ─── Incidencias y métricas ──────────────────────────────────────────────────

export function createIncident(guard: Guard, input: { orderId: number; itemId?: number | null; type: IncidentType; reason?: string | null }, userId: number): Promise<{ id: number }> {
  return run(async (d) => {
    const o = await orderRestaurant(d, input.orderId);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    if (input.itemId != null) {
      const [it] = await rows(d, sql`SELECT id FROM hospo_order_items WHERE id = ${input.itemId} AND order_id = ${o.id}`);
      if (!it) throw notFound("La línea");
    }
    const [r] = (await d.execute(sql`INSERT INTO hospo_kitchen_incidents (restaurant_id, order_id, item_id, type, reason, by_user_id, created_at)
      VALUES (${o.restaurantId}, ${o.id}, ${input.itemId ?? null}, ${input.type}, ${input.reason?.trim().slice(0, 255) || null}, ${userId}, ${Date.now()})`)) as unknown as [{ insertId: number }];
    return { id: Number(r.insertId) };
  });
}

export interface Incident {
  id: number;
  orderId: number;
  itemId: number | null;
  itemName: string | null;
  tableCode: string | null;
  type: IncidentType;
  reason: string | null;
  byName: string | null;
  createdAt: number;
}

export function listIncidents(restaurantId: number, date: string): Promise<Incident[]> {
  return run(async (d) => {
    const { start, end } = madridDayRange(date);
    return (await rows(d, sql`SELECT k.id, k.order_id, k.item_id, k.type, k.reason, k.created_at, i.name AS item_name, t.code AS table_code, u.name AS by_name
      FROM hospo_kitchen_incidents k
      LEFT JOIN hospo_order_items i ON i.id = k.item_id
      LEFT JOIN hospo_orders o ON o.id = k.order_id
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN users u ON u.id = k.by_user_id
      WHERE k.restaurant_id = ${restaurantId} AND k.created_at BETWEEN ${start} AND ${end}
      ORDER BY k.created_at DESC LIMIT 200`)).map((r: any) => ({
      id: num(r.id), orderId: num(r.order_id), itemId: numOrNull(r.item_id), itemName: r.item_name ?? null, tableCode: r.table_code ?? null,
      type: r.type, reason: r.reason ?? null, byName: r.by_name ?? null, createdAt: num(r.created_at),
    }));
  });
}

/** Métricas de cocina de un día (líneas marchadas ese día, también las de comandas ya cerradas). */
export function kitchenMetricsOf(restaurantId: number, date: string): Promise<KitchenMetrics> {
  return run(async (d) => {
    const { start, end } = madridDayRange(date);
    const lines = await rows(d, sql`SELECT i.name, i.station, i.quantity, i.fired_at, i.ready_at, i.served_at FROM hospo_order_items i JOIN hospo_orders o ON o.id = i.order_id
      WHERE o.restaurant_id = ${restaurantId} AND i.status <> 'void' AND i.fired_at BETWEEN ${start} AND ${end}`);
    const sla = new Map((await rows(d, sql`SELECT name, sla_minutes FROM hospo_kitchen_stations WHERE restaurant_id = ${restaurantId}`)).map((s: any) => [String(s.name), num(s.sla_minutes)] as [string, number]));
    const [inc] = await rows(d, sql`SELECT COUNT(*) AS n FROM hospo_kitchen_incidents WHERE restaurant_id = ${restaurantId} AND created_at BETWEEN ${start} AND ${end}`);
    return kitchenMetrics(
      lines.map((l: any) => ({ name: String(l.name), station: l.station ?? null, quantity: num(l.quantity), firedAt: numOrNull(l.fired_at), readyAt: numOrNull(l.ready_at), servedAt: numOrNull(l.served_at) })),
      sla,
      num(inc?.n),
    );
  });
}

// ─── Camareros (usuarios del Core) ───────────────────────────────────────────

export interface Waiter {
  id: number;
  name: string | null;
  role: string;
}

/** Quien puede llevar mesas en el restaurante: administración y el personal asignado a él (restaurant_staff). */
export function listWaiters(restaurantId: number): Promise<Waiter[]> {
  return run(async (d) =>
    (await rows(d, sql`SELECT u.id, u.name, u.role FROM users u
      WHERE u.isActive = 1 AND (u.role = 'admin' OR u.id IN (SELECT s.userId FROM restaurant_staff s WHERE s.restaurantId = ${restaurantId}))
      ORDER BY u.name, u.id`)).map((r: any) => ({ id: num(r.id), name: r.name ?? null, role: String(r.role) })));
}

/** Asigna (o quita, con null) el camarero de una comanda abierta: debe poder llevar mesas en ese restaurante. */
export function assignWaiter(guard: Guard, orderId: number, userId: number | null): Promise<{ ok: true }> {
  return run(async (d) => {
    const o = await orderRestaurant(d, orderId);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    if (!(OPEN_ORDER_STATUSES as readonly string[]).includes(o.status)) throw bad("La comanda ya está cerrada.");
    if (userId != null) {
      const ok = (await listWaitersIn(d, o.restaurantId)).some((w) => w.id === userId);
      if (!ok) throw bad("Esa persona no lleva mesas en este restaurante. Asígnala al restaurante en «Reservas y mesas» o elige otra.");
    }
    await d.execute(sql`UPDATE hospo_orders SET waiter_user_id = ${userId} WHERE id = ${o.id}`);
    return { ok: true as const };
  });
}

async function listWaitersIn(d: RnExec, restaurantId: number): Promise<Array<{ id: number }>> {
  return (await rows(d, sql`SELECT u.id FROM users u WHERE u.isActive = 1 AND (u.role = 'admin' OR u.id IN (SELECT s.userId FROM restaurant_staff s WHERE s.restaurantId = ${restaurantId}))`)).map((r: any) => ({ id: num(r.id) }));
}
