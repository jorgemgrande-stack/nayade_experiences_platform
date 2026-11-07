/**
 * Restaurant Net · sala, carta y comandas (capacidad `restaurant-net`) — acceso a datos y reglas de la comanda.
 * Lógica pura en shared/restaurantNet.ts; procedimientos en server/routers/restaurantNet.ts.
 *
 *  - Aislamiento: cada empresa tiene su base de datos (getDb() del tenant de la petición). Dentro de la empresa, cada
 *    operación comprueba el restaurante con el `guard` del router (administración: todos; adminrest: los suyos).
 *  - Una sola comanda abierta por mesa: se comprueba con la mesa bloqueada (FOR UPDATE) y, como última barrera, con el
 *    índice único sobre `open_table_key` (columna generada de las comandas abiertas).
 *  - Cobro: siempre con el TPV del Core (tpv.createSale, inyectado por el router), con su clave de idempotencia por
 *    comanda, su IVA, su numeración y la caja (y sede) de la sesión. Mientras se cobra, la comanda queda «paying» y no
 *    admite cambios; si el cobro falla vuelve a «pide la cuenta»; si se repite, el TPV devuelve la misma venta.
 *  - Nada se borra: salas, mesas y platos se archivan; las líneas se anulan con motivo; las comandas se cierran.
 *
 * Las tablas (migración db/migrations/0033_restaurant_net_sala) no están en `drizzle/schema.ts` a propósito, como el
 * inventario o las comunidades: el resto del código no depende de que la migración esté aplicada. Sin ella, cada
 * operación responde que el módulo no está instalado (ModuleNotInstalled).
 *
 * Adaptado del TPV de hostelería de la aplicación de origen (server/routers/hospo.ts): salas y mesas, unir y separar,
 * comanda por mesa, líneas con partida y tiempos, pedir la cuenta, cobro y reservas sentadas. Cambios: restaurante del
 * Core en lugar de unidades de negocio, sin entidades fijas, cobro con el TPV del Core (sin segundo sistema de cobro),
 * anulación con motivo en lugar de borrar líneas, y lógica fuera del router.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { bigint, int, mysqlTable } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { ModuleNotInstalled } from "./sdk";
import {
  ALLERGEN_KEYS,
  DEFAULT_MENU_TAX_RATE,
  OPEN_ORDER_STATUSES,
  RESTAURANT_NET_CAPABILITY,
  checkoutIdempotencyKey,
  mergePlan,
  mergeProblem,
  normalizeAllergens,
  orderTotals,
  paymentsProblem,
  round2,
  type OrderTotals,
  type PaymentMethod,
  type RoomKind,
  type TableShape,
} from "../shared/restaurantNet";
import { stationFor } from "../shared/restaurantKds";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type RnExec = Pick<Db, "execute">;
/** Comprueba que quien opera gestiona ese restaurante (lanza FORBIDDEN si no). */
export type Guard = (restaurantId: number) => Promise<void>;

const OPEN_SQL = sql.join(OPEN_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `);

// ─── Infraestructura ─────────────────────────────────────────────────────────

/** Empresa sin la migración 0033: tablas o columnas de sala y comandas ausentes. */
export function isMissingSalaSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /dining_|hospo_orders|hospo_order_items|restaurant_menu_items|restaurant_booking_tables|restaurant_booking_seating/.test(msg)) return true;
  }
  return false;
}

function notInstalled(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "La sala y las comandas de Restaurant Net aún no están instaladas en esta empresa. Pide a soporte que las activen.",
    cause: new ModuleNotInstalled(RESTAURANT_NET_CAPABILITY),
  });
}

/**
 * Asignación de mesas a reservas: única tabla de este módulo que se borra (quitar una mesa de una reserva). Se declara
 * aquí, fuera de drizzle/schema.ts (ver arriba), solo para borrar con el constructor tipado.
 */
const restaurantBookingTables = mysqlTable("restaurant_booking_tables", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("booking_id").notNull(),
  tableId: int("table_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

/** Ejecuta con la BD de la empresa; sin la migración, «no instalado». */
async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (isMissingSalaSchema(e)) throw notInstalled();
    throw e;
  }
}

async function inTx<T>(fn: (tx: RnExec) => Promise<T>): Promise<T> {
  return run((d) => d.transaction((tx) => fn(tx as unknown as RnExec)));
}

async function rows<T = any>(exec: RnExec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function header(exec: RnExec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}

function isDuplicate(e: unknown, key: string): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    if ((x.code === "ER_DUP_ENTRY" || x.errno === 1062) && String(x.sqlMessage ?? x.message ?? "").includes(key)) return true;
  }
  return false;
}

const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const bool = (v: unknown) => Number(v) === 1 || v === true;
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

// ─── Filas ───────────────────────────────────────────────────────────────────

export interface DiningRoom {
  id: number;
  restaurantId: number;
  name: string;
  kind: RoomKind;
  sortOrder: number;
  isActive: boolean;
}
const toRoom = (r: any): DiningRoom => ({ id: num(r.id), restaurantId: num(r.restaurant_id), name: String(r.name), kind: r.kind, sortOrder: num(r.sort_order), isActive: bool(r.is_active) });

export interface DiningTable {
  id: number;
  roomId: number;
  restaurantId: number;
  code: string;
  shape: TableShape;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  mergedInto: number | null;
  isActive: boolean;
}
const toTable = (r: any): DiningTable => ({
  id: num(r.id), roomId: num(r.room_id), restaurantId: num(r.restaurant_id), code: String(r.code), shape: r.shape, capacity: num(r.capacity),
  posX: num(r.pos_x), posY: num(r.pos_y), width: num(r.width), height: num(r.height), mergedInto: numOrNull(r.merged_into), isActive: bool(r.is_active),
});

export interface MenuItem {
  id: number;
  restaurantId: number;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  taxRate: number;
  imageUrl: string | null;
  allergens: string[];
  station: string | null;
  isActive: boolean;
  sortOrder: number;
}
function parseAllergens(v: unknown): string[] {
  if (Array.isArray(v)) return normalizeAllergens(v.map(String));
  if (typeof v === "string" && v) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? normalizeAllergens(p.map(String)) : [];
    } catch {
      return [];
    }
  }
  return [];
}
const toMenuItem = (r: any): MenuItem => ({
  id: num(r.id), restaurantId: num(r.restaurant_id), name: String(r.name), description: r.description ?? null, category: r.category ?? null,
  price: Number(r.price), taxRate: Number(r.tax_rate), imageUrl: r.image_url ?? null, allergens: parseAllergens(r.allergens), station: r.station ?? null,
  isActive: bool(r.is_active), sortOrder: num(r.sort_order),
});

export interface HospoOrder {
  id: number;
  siteId: string | null;
  restaurantId: number;
  tableId: number | null;
  waiterUserId: number | null;
  status: string;
  guests: number;
  customerName: string | null;
  orderType: string;
  priority: string;
  restaurantBookingId: number | null;
  tpvSaleId: number | null;
  subtotal: number;
  total: number;
  notes: string | null;
  openedAt: number;
  closedAt: number | null;
}
const toOrder = (r: any): HospoOrder => ({
  id: num(r.id), siteId: r.site_id ?? null, restaurantId: num(r.restaurant_id), tableId: numOrNull(r.table_id), waiterUserId: numOrNull(r.waiter_user_id),
  status: String(r.status), guests: num(r.guests), customerName: r.customer_name ?? null, orderType: String(r.order_type), priority: String(r.priority),
  restaurantBookingId: numOrNull(r.restaurant_booking_id), tpvSaleId: numOrNull(r.tpv_sale_id), subtotal: Number(r.subtotal), total: Number(r.total),
  notes: r.notes ?? null, openedAt: num(r.opened_at), closedAt: numOrNull(r.closed_at),
});

export interface HospoOrderItem {
  id: number;
  orderId: number;
  productType: string;
  productId: number | null;
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  station: string | null;
  course: number;
  seat: number | null;
  status: string;
  notes: string | null;
  voidReason: string | null;
  createdAt: number;
}
const toItem = (r: any): HospoOrderItem => ({
  id: num(r.id), orderId: num(r.order_id), productType: String(r.product_type), productId: numOrNull(r.product_id), name: String(r.name), quantity: num(r.quantity),
  unitPrice: Number(r.unit_price), taxRate: Number(r.tax_rate), station: r.station ?? null, course: num(r.course), seat: numOrNull(r.seat), status: String(r.status),
  notes: r.notes ?? null, voidReason: r.void_reason ?? null, createdAt: num(r.created_at),
});

// ─── Lecturas de apoyo ───────────────────────────────────────────────────────

async function roomById(exec: RnExec, id: number): Promise<DiningRoom | null> {
  const [r] = await rows(exec, sql`SELECT * FROM dining_rooms WHERE id = ${id}`);
  return r ? toRoom(r) : null;
}
async function tableById(exec: RnExec, id: number, lock = false): Promise<DiningTable | null> {
  const [r] = await rows(exec, lock ? sql`SELECT * FROM dining_tables WHERE id = ${id} FOR UPDATE` : sql`SELECT * FROM dining_tables WHERE id = ${id}`);
  return r ? toTable(r) : null;
}
async function orderById(exec: RnExec, id: number, lock = false): Promise<HospoOrder | null> {
  const [r] = await rows(exec, lock ? sql`SELECT * FROM hospo_orders WHERE id = ${id} FOR UPDATE` : sql`SELECT * FROM hospo_orders WHERE id = ${id}`);
  return r ? toOrder(r) : null;
}
async function openOrderOfTable(exec: RnExec, tableId: number): Promise<HospoOrder | null> {
  const [r] = await rows(exec, sql`SELECT * FROM hospo_orders WHERE table_id = ${tableId} AND status IN (${OPEN_SQL}) LIMIT 1`);
  return r ? toOrder(r) : null;
}
async function itemsOf(exec: RnExec, orderId: number): Promise<HospoOrderItem[]> {
  return (await rows(exec, sql`SELECT * FROM hospo_order_items WHERE order_id = ${orderId} ORDER BY id`)).map(toItem);
}
async function restaurantExists(exec: RnExec, restaurantId: number): Promise<boolean> {
  return (await rows(exec, sql`SELECT id FROM restaurants WHERE id = ${restaurantId}`)).length > 0;
}

/** Recalcula subtotal (base) y total (con IVA) de la comanda con sus líneas no anuladas. */
async function recompute(exec: RnExec, orderId: number): Promise<OrderTotals> {
  const t = orderTotals(await itemsOf(exec, orderId));
  await exec.execute(sql`UPDATE hospo_orders SET subtotal = ${t.subtotal.toFixed(2)}, total = ${t.total.toFixed(2)} WHERE id = ${orderId}`);
  return t;
}

/** Comanda modificable (abierta o pidiendo la cuenta), bloqueada en la transacción y con su restaurante comprobado. */
async function editableOrder(tx: RnExec, guard: Guard, orderId: number): Promise<HospoOrder> {
  const o = await orderById(tx, orderId, true);
  if (!o) throw notFound("La comanda");
  await guard(o.restaurantId);
  if (o.status === "paying") throw conflict("Se está cobrando esta comanda. Espera a que termine el cobro.");
  if (o.status !== "open" && o.status !== "bill_requested") throw bad("La comanda ya está cerrada.");
  return o;
}

// ─── Salas ───────────────────────────────────────────────────────────────────

export function listRooms(restaurantId: number, includeArchived = false): Promise<DiningRoom[]> {
  return run(async (d) =>
    (await rows(d, includeArchived
      ? sql`SELECT * FROM dining_rooms WHERE restaurant_id = ${restaurantId} ORDER BY is_active DESC, sort_order, id`
      : sql`SELECT * FROM dining_rooms WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY sort_order, id`)).map(toRoom));
}

export function createRoom(guard: Guard, input: { restaurantId: number; name: string; kind: RoomKind; sortOrder?: number }): Promise<{ id: number }> {
  return run(async (d) => {
    await guard(input.restaurantId);
    if (!(await restaurantExists(d, input.restaurantId))) throw notFound("El restaurante");
    const now = Date.now();
    const r = await header(d, sql`INSERT INTO dining_rooms (restaurant_id, name, kind, sort_order, is_active, created_at, updated_at)
      VALUES (${input.restaurantId}, ${input.name.trim()}, ${input.kind}, ${input.sortOrder ?? 0}, 1, ${now}, ${now})`);
    return { id: r.insertId };
  });
}

export function updateRoom(guard: Guard, input: { id: number; name?: string; kind?: RoomKind; sortOrder?: number; isActive?: boolean }): Promise<{ ok: true }> {
  return run(async (d) => {
    const room = await roomById(d, input.id);
    if (!room) throw notFound("La sala");
    await guard(room.restaurantId);
    if (input.isActive === false) {
      const [busy] = await rows(d, sql`SELECT o.id FROM hospo_orders o JOIN dining_tables t ON t.id = o.table_id WHERE t.room_id = ${room.id} AND o.status IN (${OPEN_SQL}) LIMIT 1`);
      if (busy) throw conflict("Hay mesas de esta sala con comandas abiertas. Cóbralas o libéralas antes de archivarla.");
    }
    const sets: SQL[] = [];
    if (input.name !== undefined) sets.push(sql`name = ${input.name.trim()}`);
    if (input.kind !== undefined) sets.push(sql`kind = ${input.kind}`);
    if (input.sortOrder !== undefined) sets.push(sql`sort_order = ${input.sortOrder}`);
    if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive ? 1 : 0}`);
    if (sets.length) {
      sets.push(sql`updated_at = ${Date.now()}`);
      await d.execute(sql`UPDATE dining_rooms SET ${sql.join(sets, sql`, `)} WHERE id = ${room.id}`);
    }
    return { ok: true as const };
  });
}

// ─── Mesas ───────────────────────────────────────────────────────────────────

export function listTables(restaurantId: number, includeArchived = false): Promise<DiningTable[]> {
  return run(async (d) =>
    (await rows(d, includeArchived
      ? sql`SELECT * FROM dining_tables WHERE restaurant_id = ${restaurantId} ORDER BY is_active DESC, code`
      : sql`SELECT * FROM dining_tables WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY code`)).map(toTable));
}

const DEFAULT_SIZE: Record<TableShape, { w: number; h: number }> = { square: { w: 80, h: 80 }, round: { w: 80, h: 80 }, rect: { w: 120, h: 72 } };

export function createTable(
  guard: Guard,
  input: { roomId: number; code: string; shape: TableShape; capacity: number; posX?: number; posY?: number },
): Promise<{ id: number }> {
  return run(async (d) => {
    const room = await roomById(d, input.roomId);
    if (!room || !room.isActive) throw notFound("La sala");
    await guard(room.restaurantId);
    const now = Date.now();
    const size = DEFAULT_SIZE[input.shape];
    // Sin posición: se coloca en la siguiente casilla libre de una rejilla sencilla
    let posX = input.posX;
    let posY = input.posY;
    if (posX === undefined || posY === undefined) {
      const [c] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM dining_tables WHERE room_id = ${room.id} AND is_active = 1`);
      const i = Number(c?.n ?? 0);
      posX = 40 + (i % 7) * 135;
      posY = 40 + Math.floor(i / 7) * 120;
    }
    try {
      const r = await header(d, sql`INSERT INTO dining_tables (room_id, restaurant_id, code, shape, capacity, pos_x, pos_y, width, height, is_active, created_at, updated_at)
        VALUES (${room.id}, ${room.restaurantId}, ${input.code.trim()}, ${input.shape}, ${input.capacity}, ${Math.round(posX)}, ${Math.round(posY)}, ${size.w}, ${size.h}, 1, ${now}, ${now})`);
      return { id: r.insertId };
    } catch (e) {
      if (isDuplicate(e, "uq_dining_tables_code")) throw conflict(`Ya hay una mesa «${input.code.trim()}» en este restaurante.`);
      throw e;
    }
  });
}

export function updateTable(
  guard: Guard,
  input: { id: number; roomId?: number; code?: string; shape?: TableShape; capacity?: number; posX?: number; posY?: number; width?: number; height?: number; isActive?: boolean },
): Promise<{ ok: true }> {
  return run(async (d) => {
    const t = await tableById(d, input.id);
    if (!t) throw notFound("La mesa");
    await guard(t.restaurantId);
    if (input.roomId !== undefined && input.roomId !== t.roomId) {
      const room = await roomById(d, input.roomId);
      if (!room || room.restaurantId !== t.restaurantId || !room.isActive) throw notFound("La sala");
    }
    if (input.isActive === false) {
      if (await openOrderOfTable(d, t.id)) throw conflict("La mesa tiene una comanda abierta. Cóbrala o libérala antes de archivarla.");
      if (t.mergedInto != null || (await rows(d, sql`SELECT id FROM dining_tables WHERE merged_into = ${t.id} LIMIT 1`)).length) {
        throw conflict("La mesa está unida a otras. Sepáralas antes de archivarla.");
      }
    }
    const sets: SQL[] = [];
    if (input.roomId !== undefined) sets.push(sql`room_id = ${input.roomId}`);
    if (input.code !== undefined) sets.push(sql`code = ${input.code.trim()}`);
    if (input.shape !== undefined) sets.push(sql`shape = ${input.shape}`);
    if (input.capacity !== undefined) sets.push(sql`capacity = ${input.capacity}`);
    if (input.posX !== undefined) sets.push(sql`pos_x = ${Math.round(input.posX)}`);
    if (input.posY !== undefined) sets.push(sql`pos_y = ${Math.round(input.posY)}`);
    if (input.width !== undefined) sets.push(sql`width = ${Math.round(input.width)}`);
    if (input.height !== undefined) sets.push(sql`height = ${Math.round(input.height)}`);
    if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive ? 1 : 0}`);
    if (!sets.length) return { ok: true as const };
    sets.push(sql`updated_at = ${Date.now()}`);
    try {
      await d.execute(sql`UPDATE dining_tables SET ${sql.join(sets, sql`, `)} WHERE id = ${t.id}`);
    } catch (e) {
      if (isDuplicate(e, "uq_dining_tables_code")) throw conflict(`Ya hay una mesa «${input.code?.trim()}» en este restaurante.`);
      throw e;
    }
    return { ok: true as const };
  });
}

/**
 * Une la mesa secundaria a la principal: la comanda vive en la principal. Si la secundaria tenía platos, pasan a la
 * comanda de la principal (o su comanda pasa a la principal si esta no tenía); una comanda vacía se cierra.
 */
export function mergeTables(guard: Guard, primaryId: number, secondaryId: number): Promise<{ ok: true; orderId: number | null }> {
  return inTx(async (tx) => {
    // Bloqueo en orden de id: dos uniones cruzadas no se interbloquean
    const [a, b] = primaryId < secondaryId ? [primaryId, secondaryId] : [secondaryId, primaryId];
    const ta = await tableById(tx, a, true);
    const tb = await tableById(tx, b, true);
    const primary = a === primaryId ? ta : tb;
    const secondary = a === primaryId ? tb : ta;
    if (primary) await guard(primary.restaurantId);
    if (secondary && secondary.restaurantId !== primary?.restaurantId) await guard(secondary.restaurantId);
    const children = secondary ? await rows(tx, sql`SELECT id FROM dining_tables WHERE merged_into = ${secondary.id} LIMIT 1`) : [];
    const problem = mergeProblem(primary, secondary, children.length > 0);
    if (problem) throw bad(problem);
    const pOrder = await openOrderOfTable(tx, primary!.id);
    const sOrder = await openOrderOfTable(tx, secondary!.id);
    if (pOrder?.status === "paying" || sOrder?.status === "paying") throw conflict("Se está cobrando una de las mesas. Espera a que termine el cobro.");
    const sLive = sOrder ? (await itemsOf(tx, sOrder.id)).filter((i) => i.status !== "void").length : 0;
    const now = Date.now();
    let orderId = pOrder?.id ?? null;
    switch (mergePlan(pOrder?.id ?? null, sOrder?.id ?? null, sLive)) {
      case "move":
        await tx.execute(sql`UPDATE hospo_order_items SET order_id = ${pOrder!.id}, updated_at = ${now} WHERE order_id = ${sOrder!.id}`);
        await tx.execute(sql`UPDATE hospo_orders SET status = 'cancelled', closed_at = ${now}, subtotal = 0, total = 0,
          notes = CONCAT(COALESCE(notes, ''), ${`[Unida a la mesa ${primary!.code}: sus platos pasan a la comanda ${pOrder!.id}]`}) WHERE id = ${sOrder!.id}`);
        await tx.execute(sql`UPDATE hospo_orders SET guests = guests + ${sOrder!.guests} WHERE id = ${pOrder!.id}`);
        await recompute(tx, pOrder!.id);
        break;
      case "retable":
        await tx.execute(sql`UPDATE hospo_orders SET table_id = ${primary!.id} WHERE id = ${sOrder!.id}`);
        orderId = sOrder!.id;
        break;
      case "cancelEmpty":
        await tx.execute(sql`UPDATE hospo_orders SET status = 'cancelled', closed_at = ${now} WHERE id = ${sOrder!.id}`);
        break;
      case "none":
        break;
    }
    await tx.execute(sql`UPDATE dining_tables SET merged_into = ${primary!.id}, updated_at = ${now} WHERE id = ${secondary!.id}`);
    return { ok: true as const, orderId };
  });
}

/** Separa una mesa unida: vuelve a ser independiente (la comanda sigue en la principal). */
export function unmergeTable(guard: Guard, tableId: number): Promise<{ ok: true }> {
  return run(async (d) => {
    const t = await tableById(d, tableId);
    if (!t) throw notFound("La mesa");
    await guard(t.restaurantId);
    if (t.mergedInto == null) throw bad("Esta mesa no está unida a otra.");
    await d.execute(sql`UPDATE dining_tables SET merged_into = NULL, updated_at = ${Date.now()} WHERE id = ${t.id}`);
    return { ok: true as const };
  });
}

// ─── Plano ───────────────────────────────────────────────────────────────────

export interface FloorOpenOrder {
  id: number;
  tableId: number | null;
  status: string;
  total: number;
  guests: number;
  customerName: string | null;
  openedAt: number;
  liveItems: number;
  /** Líneas listas en cocina, pendientes de servir (aviso en la sala). */
  readyItems: number;
  waiterUserId: number | null;
}

/** Salas, mesas y comandas abiertas de un restaurante (estado de cada mesa: shared/restaurantNet tableStates). */
export function getFloor(restaurantId: number): Promise<{ rooms: DiningRoom[]; tables: DiningTable[]; openOrders: FloorOpenOrder[] }> {
  return run(async (d) => {
    const rooms = (await rows(d, sql`SELECT * FROM dining_rooms WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY sort_order, id`)).map(toRoom);
    const tables = (await rows(d, sql`SELECT * FROM dining_tables WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY code`)).map(toTable);
    const openOrders = (await rows(d, sql`SELECT o.id, o.table_id, o.status, o.total, o.guests, o.customer_name, o.opened_at, o.waiter_user_id,
        (SELECT COUNT(*) FROM hospo_order_items i WHERE i.order_id = o.id AND i.status <> 'void') AS live_items,
        (SELECT COUNT(*) FROM hospo_order_items i WHERE i.order_id = o.id AND i.status = 'ready') AS ready_items
      FROM hospo_orders o WHERE o.restaurant_id = ${restaurantId} AND o.status IN (${OPEN_SQL}) ORDER BY o.opened_at`)).map((r: any) => ({
      id: num(r.id), tableId: numOrNull(r.table_id), status: String(r.status), total: Number(r.total), guests: num(r.guests),
      customerName: r.customer_name ?? null, openedAt: num(r.opened_at), liveItems: num(r.live_items), readyItems: num(r.ready_items),
      waiterUserId: numOrNull(r.waiter_user_id),
    }));
    return { rooms, tables, openOrders };
  });
}

// ─── Carta ───────────────────────────────────────────────────────────────────

export function listMenu(restaurantId: number, includeArchived = false): Promise<MenuItem[]> {
  return run(async (d) =>
    (await rows(d, includeArchived
      ? sql`SELECT * FROM restaurant_menu_items WHERE restaurant_id = ${restaurantId} ORDER BY sort_order, id`
      : sql`SELECT * FROM restaurant_menu_items WHERE restaurant_id = ${restaurantId} AND is_active = 1 ORDER BY sort_order, id`)).map(toMenuItem));
}

export interface MenuItemInput {
  id?: number;
  restaurantId: number;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  taxRate: number;
  imageUrl?: string | null;
  allergens?: string[];
  station?: string | null;
  isActive?: boolean;
}

export function upsertMenuItem(guard: Guard, input: MenuItemInput): Promise<{ id: number }> {
  return run(async (d) => {
    await guard(input.restaurantId);
    if (!(await restaurantExists(d, input.restaurantId))) throw notFound("El restaurante");
    const allergens = JSON.stringify(normalizeAllergens((input.allergens ?? []).filter((a) => ALLERGEN_KEYS.includes(a))));
    const price = round2(input.price).toFixed(2);
    const tax = round2(input.taxRate).toFixed(2);
    const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
    const now = Date.now();
    if (input.id) {
      const [cur] = await rows(d, sql`SELECT restaurant_id FROM restaurant_menu_items WHERE id = ${input.id}`);
      if (!cur || num(cur.restaurant_id) !== input.restaurantId) throw notFound("El plato");
      await d.execute(sql`UPDATE restaurant_menu_items SET name = ${input.name.trim()}, description = ${clean(input.description)}, category = ${clean(input.category)},
        price = ${price}, tax_rate = ${tax}, image_url = ${clean(input.imageUrl)}, allergens = ${allergens}, station = ${clean(input.station)},
        is_active = ${input.isActive === false ? 0 : 1}, updated_at = ${now} WHERE id = ${input.id}`);
      return { id: input.id };
    }
    const [m] = await rows<{ n: number }>(d, sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM restaurant_menu_items WHERE restaurant_id = ${input.restaurantId}`);
    const r = await header(d, sql`INSERT INTO restaurant_menu_items (restaurant_id, name, description, category, price, tax_rate, image_url, allergens, station, is_active, sort_order, created_at, updated_at)
      VALUES (${input.restaurantId}, ${input.name.trim()}, ${clean(input.description)}, ${clean(input.category)}, ${price}, ${tax}, ${clean(input.imageUrl)}, ${allergens},
        ${clean(input.station)}, ${input.isActive === false ? 0 : 1}, ${Number(m?.n ?? 1)}, ${now}, ${now})`);
    return { id: r.insertId };
  });
}

/** Archiva o recupera un plato (nunca se borra: las ventas cobradas siguen apuntando a él). */
export function setMenuItemActive(guard: Guard, id: number, active: boolean): Promise<{ ok: true }> {
  return run(async (d) => {
    const [cur] = await rows(d, sql`SELECT restaurant_id FROM restaurant_menu_items WHERE id = ${id}`);
    if (!cur) throw notFound("El plato");
    await guard(num(cur.restaurant_id));
    await d.execute(sql`UPDATE restaurant_menu_items SET is_active = ${active ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${id}`);
    return { ok: true as const };
  });
}

/** Nuevo orden de la carta (los ids que no son del restaurante se ignoran). */
export function reorderMenu(guard: Guard, restaurantId: number, ids: number[]): Promise<{ ok: true }> {
  return inTx(async (tx) => {
    await guard(restaurantId);
    const now = Date.now();
    for (let i = 0; i < ids.length; i++) {
      await tx.execute(sql`UPDATE restaurant_menu_items SET sort_order = ${i + 1}, updated_at = ${now} WHERE id = ${ids[i]} AND restaurant_id = ${restaurantId}`);
    }
    return { ok: true as const };
  });
}

// ─── Comandas ────────────────────────────────────────────────────────────────

/** Abre la comanda de una mesa (la principal si está unida). Rechaza una mesa que ya tiene comanda abierta. */
export function openOrder(
  guard: Guard,
  input: { tableId: number; guests: number; customerName?: string | null; restaurantBookingId?: number | null },
  waiterUserId: number,
): Promise<{ id: number }> {
  return inTx(async (tx) => {
    let t = await tableById(tx, input.tableId, true);
    if (!t || !t.isActive) throw notFound("La mesa");
    await guard(t.restaurantId);
    if (t.mergedInto != null) {
      t = await tableById(tx, t.mergedInto, true);
      if (!t) throw notFound("La mesa principal");
    }
    if (await openOrderOfTable(tx, t.id)) throw conflict(`La mesa ${t.code} ya tiene una comanda abierta. Ábrela desde el plano.`);
    try {
      const r = await header(tx, sql`INSERT INTO hospo_orders (restaurant_id, table_id, waiter_user_id, status, guests, customer_name, order_type, priority, restaurant_booking_id, subtotal, total, opened_at)
        VALUES (${t.restaurantId}, ${t.id}, ${waiterUserId}, 'open', ${input.guests}, ${input.customerName?.trim() || null}, 'dine_in', 'normal', ${input.restaurantBookingId ?? null}, 0, 0, ${Date.now()})`);
      return { id: r.insertId };
    } catch (e) {
      if (isDuplicate(e, "uq_hospo_orders_open_table")) throw conflict(`La mesa ${t.code} ya tiene una comanda abierta. Ábrela desde el plano.`);
      throw e;
    }
  });
}

export interface OrderDetail {
  order: HospoOrder;
  items: HospoOrderItem[];
  totals: OrderTotals;
  table: { id: number; code: string; roomId: number; merged: Array<{ id: number; code: string }> } | null;
  booking: { id: number; locator: string; guestName: string; time: string; guests: number } | null;
  /** Camarero asignado (usuario del Core). */
  waiter: { id: number; name: string | null } | null;
}

export function getOrder(guard: Guard, orderId: number): Promise<OrderDetail> {
  return run(async (d) => {
    const order = await orderById(d, orderId);
    if (!order) throw notFound("La comanda");
    await guard(order.restaurantId);
    const items = await itemsOf(d, order.id);
    let table: OrderDetail["table"] = null;
    if (order.tableId != null) {
      const t = await tableById(d, order.tableId);
      if (t) {
        const merged = (await rows(d, sql`SELECT id, code FROM dining_tables WHERE merged_into = ${t.id} ORDER BY code`)).map((r: any) => ({ id: num(r.id), code: String(r.code) }));
        table = { id: t.id, code: t.code, roomId: t.roomId, merged };
      }
    }
    let booking: OrderDetail["booking"] = null;
    if (order.restaurantBookingId != null) {
      const [b] = await rows(d, sql`SELECT id, locator, guestName, guestLastName, time, guests FROM restaurant_bookings WHERE id = ${order.restaurantBookingId}`);
      if (b) booking = { id: num(b.id), locator: String(b.locator), guestName: `${b.guestName ?? ""} ${b.guestLastName ?? ""}`.trim(), time: String(b.time), guests: num(b.guests) };
    }
    let waiter: OrderDetail["waiter"] = null;
    if (order.waiterUserId != null) {
      const [u] = await rows(d, sql`SELECT id, name FROM users WHERE id = ${order.waiterUserId}`);
      if (u) waiter = { id: num(u.id), name: u.name ?? null };
    }
    return { order, items, totals: orderTotals(items), table, booking, waiter };
  });
}

/**
 * Enrutado de la categoría a su partida (migración 0035). Sin la migración del KDS no hay enrutado: la partida es la
 * del plato.
 */
async function routingOf(exec: RnExec, restaurantId: number, category: string | null): Promise<Map<string, string>> {
  if (!category) return new Map();
  try {
    const r = await rows(exec, sql`SELECT category, station FROM hospo_station_routing WHERE restaurant_id = ${restaurantId} AND category = ${category}`);
    return new Map(r.map((x: any) => [String(x.category), String(x.station)] as [string, string]));
  } catch (e) {
    if (isMissingKdsSchema(e)) return new Map();
    throw e;
  }
}

/** Empresa sin la migración 0035 (cocina): tablas de partidas, enrutado, semáforo o incidencias ausentes. */
export function isMissingKdsSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /hospo_kitchen_|hospo_station_routing|hospo_kds_settings/.test(msg)) return true;
  }
  return false;
}

/** Comensales, nombre del cliente o notas de la comanda. */
export function updateOrder(guard: Guard, input: { orderId: number; guests?: number; customerName?: string | null; notes?: string | null }): Promise<{ ok: true }> {
  return inTx(async (tx) => {
    const o = await editableOrder(tx, guard, input.orderId);
    const sets: SQL[] = [];
    if (input.guests !== undefined) sets.push(sql`guests = ${input.guests}`);
    if (input.customerName !== undefined) sets.push(sql`customer_name = ${input.customerName?.trim() || null}`);
    if (input.notes !== undefined) sets.push(sql`notes = ${input.notes?.trim() || null}`);
    if (sets.length) await tx.execute(sql`UPDATE hospo_orders SET ${sql.join(sets, sql`, `)} WHERE id = ${o.id}`);
    return { ok: true as const };
  });
}

/**
 * Añade un plato de la carta (foto de nombre, precio, IVA y partida al pedirlo). Si ya hay una línea igual sin enviar
 * (mismo plato, sin notas, mismo comensal y pase), suma las unidades. Una comanda que pedía la cuenta vuelve a abierta.
 */
export function addItem(
  guard: Guard,
  input: { orderId: number; menuItemId: number; quantity: number; notes?: string | null; seat?: number | null; course?: number },
): Promise<{ itemId: number; totals: OrderTotals }> {
  return inTx(async (tx) => {
    const o = await editableOrder(tx, guard, input.orderId);
    const [m] = await rows(tx, sql`SELECT * FROM restaurant_menu_items WHERE id = ${input.menuItemId} AND restaurant_id = ${o.restaurantId} AND is_active = 1`);
    if (!m) throw notFound("El plato");
    const item = toMenuItem(m);
    const station = stationFor(item.category, item.station, await routingOf(tx, o.restaurantId, item.category));
    const notes = input.notes?.trim() || null;
    const seat = input.seat ?? null;
    const course = input.course ?? 1;
    const now = Date.now();
    let itemId: number;
    const [same] = notes
      ? []
      : await rows(tx, sql`SELECT id, quantity FROM hospo_order_items WHERE order_id = ${o.id} AND product_type = 'restaurant' AND product_id = ${item.id}
          AND status = 'pending' AND notes IS NULL AND course = ${course} AND ${seat == null ? sql`seat IS NULL` : sql`seat = ${seat}`}
          AND unit_price = ${item.price.toFixed(2)} AND tax_rate = ${item.taxRate.toFixed(2)} LIMIT 1`);
    if (same && num(same.quantity) + input.quantity <= 99) {
      itemId = num(same.id);
      await tx.execute(sql`UPDATE hospo_order_items SET quantity = quantity + ${input.quantity}, updated_at = ${now} WHERE id = ${itemId}`);
    } else {
      const r = await header(tx, sql`INSERT INTO hospo_order_items (order_id, product_type, product_id, name, quantity, unit_price, tax_rate, station, course, seat, status, notes, created_at, updated_at)
        VALUES (${o.id}, 'restaurant', ${item.id}, ${item.name}, ${input.quantity}, ${item.price.toFixed(2)}, ${(Number.isFinite(item.taxRate) ? item.taxRate : DEFAULT_MENU_TAX_RATE).toFixed(2)},
          ${station}, ${course}, ${seat}, 'pending', ${notes}, ${now}, ${now})`);
      itemId = r.insertId;
    }
    if (o.status === "bill_requested") await tx.execute(sql`UPDATE hospo_orders SET status = 'open' WHERE id = ${o.id}`);
    return { itemId, totals: await recompute(tx, o.id) };
  });
}

async function editableItem(tx: RnExec, guard: Guard, itemId: number): Promise<{ order: HospoOrder; item: HospoOrderItem }> {
  const [r] = await rows(tx, sql`SELECT * FROM hospo_order_items WHERE id = ${itemId}`);
  if (!r) throw notFound("La línea");
  const item = toItem(r);
  const order = await editableOrder(tx, guard, item.orderId);
  if (item.status === "void") throw bad("Esta línea ya está anulada.");
  return { order, item };
}

/** Cambia las unidades de una línea aún sin enviar a cocina (una enviada se anula con motivo). */
export function setItemQty(guard: Guard, itemId: number, quantity: number): Promise<{ totals: OrderTotals }> {
  return inTx(async (tx) => {
    const { order, item } = await editableItem(tx, guard, itemId);
    if (item.status !== "pending") throw bad("Este plato ya se ha enviado a cocina: anúlalo con un motivo y vuelve a pedirlo.");
    await tx.execute(sql`UPDATE hospo_order_items SET quantity = ${quantity}, updated_at = ${Date.now()} WHERE id = ${item.id}`);
    return { totals: await recompute(tx, order.id) };
  });
}

/** Anula una línea con motivo (queda en la comanda, tachada, y deja de contar en el total). */
export function voidItem(guard: Guard, itemId: number, reason: string, userId: number): Promise<{ totals: OrderTotals }> {
  return inTx(async (tx) => {
    const { order, item } = await editableItem(tx, guard, itemId);
    const why = reason.trim();
    if (why.length < 3) throw bad("Indica el motivo de la anulación.");
    await tx.execute(sql`UPDATE hospo_order_items SET status = 'void', void_reason = ${why.slice(0, 255)}, voided_by = ${userId}, updated_at = ${Date.now()} WHERE id = ${item.id}`);
    return { totals: await recompute(tx, order.id) };
  });
}

/** El cliente pide la cuenta (la mesa se ve «pide la cuenta» en el plano). */
export function requestBill(guard: Guard, orderId: number): Promise<{ ok: true }> {
  return inTx(async (tx) => {
    const o = await editableOrder(tx, guard, orderId);
    const t = orderTotals(await itemsOf(tx, o.id));
    if (t.units === 0) throw bad("La comanda no tiene platos. Si la mesa se va sin consumir, libérala.");
    await tx.execute(sql`UPDATE hospo_orders SET status = 'bill_requested' WHERE id = ${o.id}`);
    return { ok: true as const };
  });
}

/** Vuelve a abrir una comanda que pedía la cuenta (siguen pidiendo). */
export function reopenOrder(guard: Guard, orderId: number): Promise<{ ok: true }> {
  return inTx(async (tx) => {
    const o = await editableOrder(tx, guard, orderId);
    if (o.status === "bill_requested") await tx.execute(sql`UPDATE hospo_orders SET status = 'open' WHERE id = ${o.id}`);
    return { ok: true as const };
  });
}

/** Separa las mesas unidas a la que llevaba la comanda. */
async function freeMergedTables(exec: RnExec, tableId: number | null): Promise<void> {
  if (tableId == null) return;
  await exec.execute(sql`UPDATE dining_tables SET merged_into = NULL, updated_at = ${Date.now()} WHERE merged_into = ${tableId}`);
}

/**
 * Libera la mesa sin cobrar: cierra la comanda («cerrada sin cobro») y separa las mesas unidas. Con platos sin anular
 * exige un motivo (queda en las notas de la comanda). Una comanda ya cobrada solo separa las mesas (idempotente).
 */
export function releaseTable(guard: Guard, orderId: number, reason: string | null, userName: string | null): Promise<{ ok: true; status: string }> {
  return inTx(async (tx) => {
    const o = await orderById(tx, orderId, true);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    if (o.status === "paying") throw conflict("Se está cobrando esta comanda. Espera a que termine el cobro.");
    if (o.status === "paid" || o.status === "cancelled") {
      await freeMergedTables(tx, o.tableId);
      return { ok: true as const, status: o.status };
    }
    const t = orderTotals(await itemsOf(tx, o.id));
    const why = reason?.trim() ?? "";
    if (t.units > 0 && why.length < 3) throw bad("La comanda tiene platos sin cobrar. Indica el motivo para liberar la mesa sin cobrar, o cóbrala.");
    const note = t.units > 0 ? `[Liberada sin cobrar${userName ? ` por ${userName}` : ""}: ${why.slice(0, 200)}]` : null;
    await tx.execute(sql`UPDATE hospo_orders SET status = 'cancelled', closed_at = ${Date.now()}${note ? sql`, notes = CONCAT(COALESCE(notes, ''), ${note})` : sql``} WHERE id = ${o.id}`);
    await freeMergedTables(tx, o.tableId);
    return { ok: true as const, status: "cancelled" };
  });
}

// ─── Cobro con el TPV del Core ───────────────────────────────────────────────

export interface TpvSaleLine {
  productType: "restaurant";
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  participants: number;
  notes?: string;
}

export interface TpvSaleRequest {
  sessionId: number;
  idempotencyKey: string;
  customerName?: string;
  customerEmail?: string;
  notes?: string;
  items: TpvSaleLine[];
  payments: Array<{ method: PaymentMethod; amount: number; amountTendered?: number }>;
}

/** Alta de la venta en el TPV del Core (el router pasa tpv.createSale con la sesión de quien cobra). */
export type CreateTpvSale = (req: TpvSaleRequest) => Promise<{ saleId: number; ticketNumber: string; total: number; replayed: boolean }>;

/** Líneas de la venta: las no anuladas con importe (el TPV no admite líneas a 0 €; no suman nada). */
export function saleLinesOf(items: readonly HospoOrderItem[]): TpvSaleLine[] {
  return items
    .filter((i) => i.status !== "void" && i.unitPrice > 0 && i.quantity > 0)
    .map((i) => ({
      productType: "restaurant" as const,
      productId: i.productId ?? 0,
      productName: i.name,
      quantity: i.quantity,
      unitPrice: round2(i.unitPrice),
      discountPercent: 0,
      participants: 1,
      ...(i.notes ? { notes: i.notes } : {}),
    }));
}

export interface CheckoutResult {
  saleId: number;
  ticketNumber: string | null;
  total: number;
  replayed: boolean;
}

/**
 * Cobra la comanda con el TPV del Core. Una sola venta por comanda: la clave de idempotencia es la de la comanda, así
 * que repetir el cobro (doble clic, red lenta, dos camareros a la vez) devuelve la misma venta. Mientras dura, la
 * comanda queda «paying» (sin cambios); si el TPV rechaza el cobro vuelve a «pide la cuenta» y nada queda a medias.
 * Al terminar: comanda cobrada con su venta y la sede de la caja, mesas unidas separadas y reserva completada.
 */
export async function checkout(
  guard: Guard,
  input: { orderId: number; sessionId: number; payments: Array<{ method: PaymentMethod; amount: number; amountTendered?: number }>; customerName?: string; customerEmail?: string },
  createSale: CreateTpvSale,
): Promise<CheckoutResult> {
  // 1. Reserva de la comanda para el cobro (o la venta ya hecha si se repite)
  const claim = await inTx(async (tx) => {
    const o = await orderById(tx, input.orderId, true);
    if (!o) throw notFound("La comanda");
    await guard(o.restaurantId);
    if (o.status === "paid" && o.tpvSaleId != null) return { done: o as HospoOrder, order: null, items: [] as HospoOrderItem[], totals: null };
    if (o.status === "cancelled" || o.status === "paid") throw bad("La comanda ya está cerrada.");
    const items = await itemsOf(tx, o.id);
    const totals = orderTotals(items);
    const problem = paymentsProblem(totals.total, input.payments);
    if (problem) throw bad(problem);
    if (o.status !== "paying") await tx.execute(sql`UPDATE hospo_orders SET status = 'paying' WHERE id = ${o.id}`);
    return { done: null, order: o, items, totals };
  });
  if (claim.done) return { saleId: claim.done.tpvSaleId!, ticketNumber: null, total: claim.done.total, replayed: true };

  const { items } = claim;
  const order = claim.order!;
  const totals = claim.totals!;
  let sale: Awaited<ReturnType<CreateTpvSale>>;
  try {
    sale = await createSale({
      sessionId: input.sessionId,
      idempotencyKey: checkoutIdempotencyKey(order.id),
      customerName: input.customerName?.trim() || order.customerName || undefined,
      customerEmail: input.customerEmail?.trim() || undefined,
      notes: `Comanda ${order.id}`,
      items: saleLinesOf(items),
      payments: input.payments,
    });
  } catch (e) {
    // El TPV no la registró (o la rechazó): la comanda vuelve a «pide la cuenta» para repetir el cobro
    await run((d) => d.execute(sql`UPDATE hospo_orders SET status = 'bill_requested' WHERE id = ${order.id} AND status = 'paying'`)).catch(() => undefined);
    throw e;
  }

  // 2. Cierre de la comanda con su venta
  await inTx(async (tx) => {
    const [s] = await rows(tx, sql`SELECT site_id FROM tpv_sales WHERE id = ${sale.saleId}`);
    const now = Date.now();
    await tx.execute(sql`UPDATE hospo_orders SET status = 'paid', tpv_sale_id = ${sale.saleId}, site_id = ${s?.site_id ?? null}, closed_at = ${now},
      subtotal = ${totals.subtotal.toFixed(2)}, total = ${totals.total.toFixed(2)} WHERE id = ${order.id} AND status IN (${OPEN_SQL})`);
    await freeMergedTables(tx, order.tableId);
    if (order.restaurantBookingId != null) {
      await tx.execute(sql`UPDATE restaurant_bookings SET status = 'completed' WHERE id = ${order.restaurantBookingId} AND status IN ('confirmed', 'modified', 'pending_payment')`);
    }
  });
  return { saleId: sale.saleId, ticketNumber: sale.ticketNumber, total: sale.total, replayed: sale.replayed };
}

// ─── Reservas de restaurante en la sala ──────────────────────────────────────

export interface DayBooking {
  id: number;
  locator: string;
  time: string;
  guests: number;
  guestName: string;
  guestPhone: string | null;
  status: string;
  allergies: string | null;
  isVip: boolean;
  shiftName: string | null;
  seatedAt: number | null;
  hospoOrderId: number | null;
  tables: Array<{ tableId: number; code: string }>;
}

/** Reservas de un día con sus mesas asignadas (las canceladas no salen). */
export function listDayBookings(restaurantId: number, date: string): Promise<DayBooking[]> {
  return run(async (d) => {
    const list = await rows(d, sql`SELECT b.id, b.locator, b.time, b.guests, b.guestName, b.guestLastName, b.guestPhone, b.status, b.allergies, b.isVip,
        st.seated_at, st.hospo_order_id, s.name AS shift_name
      FROM restaurant_bookings b LEFT JOIN restaurant_shifts s ON s.id = b.shiftId LEFT JOIN restaurant_booking_seating st ON st.booking_id = b.id
      WHERE b.restaurantId = ${restaurantId} AND b.date = ${date} AND b.status NOT IN ('cancelled', 'payment_failed')
      ORDER BY b.time, b.id`);
    const ids = list.map((b: any) => num(b.id));
    const links = ids.length
      ? await rows(d, sql`SELECT bt.booking_id, bt.table_id, t.code FROM restaurant_booking_tables bt JOIN dining_tables t ON t.id = bt.table_id
          WHERE bt.booking_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY t.code`)
      : [];
    return list.map((b: any) => ({
      id: num(b.id), locator: String(b.locator), time: String(b.time), guests: num(b.guests),
      guestName: `${b.guestName ?? ""} ${b.guestLastName ?? ""}`.trim(), guestPhone: b.guestPhone ?? null, status: String(b.status),
      allergies: b.allergies ?? null, isVip: bool(b.isVip), shiftName: b.shift_name ?? null, seatedAt: numOrNull(b.seated_at), hospoOrderId: numOrNull(b.hospo_order_id),
      tables: links.filter((l: any) => num(l.booking_id) === num(b.id)).map((l: any) => ({ tableId: num(l.table_id), code: String(l.code) })),
    }));
  });
}

async function bookingOf(exec: RnExec, bookingId: number): Promise<{ id: number; restaurantId: number; guests: number; status: string; guestName: string; hospoOrderId: number | null } | null> {
  const [b] = await rows(exec, sql`SELECT b.id, b.restaurantId, b.guests, b.status, b.guestName, b.guestLastName, st.hospo_order_id FROM restaurant_bookings b LEFT JOIN restaurant_booking_seating st ON st.booking_id = b.id WHERE b.id = ${bookingId}`);
  return b
    ? { id: num(b.id), restaurantId: num(b.restaurantId), guests: num(b.guests), status: String(b.status), guestName: `${b.guestName ?? ""} ${b.guestLastName ?? ""}`.trim(), hospoOrderId: numOrNull(b.hospo_order_id) }
    : null;
}

export function assignBookingTable(guard: Guard, bookingId: number, tableId: number): Promise<{ ok: true }> {
  return run(async (d) => {
    const b = await bookingOf(d, bookingId);
    if (!b) throw notFound("La reserva");
    await guard(b.restaurantId);
    const t = await tableById(d, tableId);
    if (!t || !t.isActive || t.restaurantId !== b.restaurantId) throw notFound("La mesa");
    await d.execute(sql`INSERT IGNORE INTO restaurant_booking_tables (booking_id, table_id, created_at) VALUES (${b.id}, ${t.id}, ${Date.now()})`);
    return { ok: true as const };
  });
}

export function unassignBookingTable(guard: Guard, bookingId: number, tableId: number): Promise<{ ok: true }> {
  return run(async (d) => {
    const b = await bookingOf(d, bookingId);
    if (!b) throw notFound("La reserva");
    await guard(b.restaurantId);
    await d.delete(restaurantBookingTables).where(and(eq(restaurantBookingTables.bookingId, b.id), eq(restaurantBookingTables.tableId, tableId)));
    return { ok: true as const };
  });
}

/**
 * Sienta una reserva: abre la comanda en su mesa (la indicada o la primera asignada) enlazada a la reserva, con sus
 * comensales y su nombre. Una reserva ya sentada devuelve su comanda; una mesa ocupada por otra comanda se rechaza.
 */
export async function seatBooking(guard: Guard, bookingId: number, tableId: number | null, waiterUserId: number): Promise<{ orderId: number; reused: boolean }> {
  const pre = await run(async (d) => {
    const b = await bookingOf(d, bookingId);
    if (!b) throw notFound("La reserva");
    await guard(b.restaurantId);
    if (["cancelled", "payment_failed", "no_show", "completed"].includes(b.status)) throw bad("Esta reserva no se puede sentar en su estado actual.");
    if (b.hospoOrderId != null) {
      const o = await orderById(d, b.hospoOrderId);
      if (o && (OPEN_ORDER_STATUSES as readonly string[]).includes(o.status)) return { booking: b, reuse: o.id, tableId: null as number | null };
    }
    let target = tableId;
    if (target == null) {
      const [bt] = await rows(d, sql`SELECT table_id FROM restaurant_booking_tables WHERE booking_id = ${b.id} ORDER BY id LIMIT 1`);
      target = bt ? num(bt.table_id) : null;
    }
    if (target == null) throw bad("Asigna una mesa a la reserva antes de sentarla.");
    return { booking: b, reuse: null as number | null, tableId: target };
  });
  if (pre.reuse != null) return { orderId: pre.reuse, reused: true };
  const t = await run((d) => tableById(d, pre.tableId!));
  if (!t || t.restaurantId !== pre.booking.restaurantId) throw notFound("La mesa");
  const { id } = await openOrder(guard, { tableId: t.id, guests: Math.max(1, Math.min(50, pre.booking.guests)), customerName: pre.booking.guestName || null, restaurantBookingId: pre.booking.id }, waiterUserId);
  await run(async (d) => {
    await d.execute(sql`INSERT IGNORE INTO restaurant_booking_tables (booking_id, table_id, created_at) VALUES (${pre.booking.id}, ${t.id}, ${Date.now()})`);
    await d.execute(sql`INSERT INTO restaurant_booking_seating (booking_id, seated_at, hospo_order_id, seated_by) VALUES (${pre.booking.id}, ${Date.now()}, ${id}, ${waiterUserId})
      ON DUPLICATE KEY UPDATE seated_at = VALUES(seated_at), hospo_order_id = VALUES(hospo_order_id), seated_by = VALUES(seated_by)`);
  });
  return { orderId: id, reused: false };
}
