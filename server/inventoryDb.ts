/**
 * Inventario de la empresa (capacidad Business `inventory-basic`) — acceso a datos. Lógica pura en shared/inventory.ts.
 *
 * Dónde se mueven las existencias:
 *  - Venta del TPV: dentro de la transacción del cobro (tpv.createSale), descontando en la sede de la caja. Si la
 *    política es «bloquear» y no hay unidades, el cobro se rechaza antes de numerarlo (comprobación previa) y, si otra
 *    venta se lleva la última unidad a la vez, el descuento condicional falla y la transacción entera se deshace.
 *  - Pedido de la tienda online: al confirmarse el pago (notificación de Redsys), en la sede principal. El cobro ya se
 *    ha hecho: si faltan unidades no se rechaza, se descuenta y el movimiento queda marcado «vendido sin existencias»
 *    para que la empresa lo resuelva. Antes de pagar, la tienda rechaza lo que ya no tiene existencias (política
 *    «bloquear»), así que solo ocurre si dos compradores pagan a la vez la última unidad.
 *  - Anulaciones y devoluciones (módulo de anulaciones y control diario): se reponen las
 *    unidades de cada venta, una sola vez.
 *  - Panel: entradas, ajustes con motivo y traspasos entre sedes (solo administración).
 *
 * Atomicidad: cada movimiento es un UPDATE condicional de la fila de existencias (`on_hand >= n` cuando no se permite
 * quedar en negativo); InnoDB serializa las escrituras sobre la fila, así que dos ventas simultáneas nunca dejan el
 * stock en negativo con la política «bloquear».
 * Idempotencia: cada movimiento lleva una clave única (documento + línea, o la reversión del movimiento). Se inserta
 * primero con INSERT IGNORE: si ya existía, el documento ya se aplicó y no se vuelve a mover nada.
 *
 * Las tablas (migración db/migrations/0025_inventory) no están en `drizzle/schema.ts` a propósito, como las retenciones
 * de plazas: así el resto del código no depende de que la migración esté aplicada. Sin las tablas, nada se descuenta.
 * Essential (sin `inventory-basic`): nunca se descuenta ni se bloquea nada.
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import {
  INVENTORY_CAPABILITY,
  demandByItem,
  itemForLine,
  outOfStockMessage,
  type MovementKind,
  type OversellPolicy,
  type SaleLine,
  type TrackedItem,
} from "../shared/inventory";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type InventoryExec = Pick<Db, "execute">;

export interface Actor {
  id: number | null;
  name: string | null;
}

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows<T>(exec: InventoryExec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function header(exec: InventoryExec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}

/** Empresa sin la migración 0025: no hay inventario (todo como siempre). */
export function isMissingInventorySchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_NO_SUCH_TABLE" || x.code === "ER_BAD_FIELD_ERROR") return true;
  }
  return false;
}

/** ¿Incluye el plan el inventario? (`write`: activo; sin `write`: activo o solo lectura). Si no puede verificarse, no. */
export async function inventoryLicensed(write: boolean): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(INVENTORY_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export async function assertInventory(write: boolean): Promise<void> {
  if (!(await inventoryLicensed(write))) throw new TRPCError({ code: "FORBIDDEN", message: "El inventario no está incluido en tu plan." });
}

interface ItemRow extends TrackedItem {
  minStock: number;
}

const toPolicy = (p: unknown): OversellPolicy => (p === "allow" ? "allow" : "block");

/** Artículos inventariables de esos productos. */
async function trackedItems(exec: InventoryExec, productIds: number[]): Promise<ItemRow[]> {
  const ids = Array.from(new Set(productIds.filter((n) => Number.isInteger(n) && n > 0)));
  if (!ids.length) return [];
  const r = await rows<{ id: number; product_id: number; variant_id: number; oversell_policy: string; min_stock: number }>(
    exec,
    sql`SELECT id, product_id, variant_id, oversell_policy, min_stock FROM inventory_items WHERE tracked = 1 AND product_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
  );
  return r.map((x) => ({ id: Number(x.id), productId: Number(x.product_id), variantId: Number(x.variant_id), policy: toPolicy(x.oversell_policy), minStock: Number(x.min_stock) }));
}

const siteKey = (site: string | null) => site ?? "";

async function ensureLevel(exec: InventoryExec, itemId: number, site: string | null, now: number): Promise<void> {
  await exec.execute(sql`INSERT IGNORE INTO inventory_levels (item_id, site_id, on_hand, updated_at) VALUES (${itemId}, ${site}, 0, ${now})`);
}

export async function onHandAt(exec: InventoryExec, itemId: number, site: string | null): Promise<number> {
  const [r] = await rows<{ on_hand: number }>(exec, sql`SELECT on_hand FROM inventory_levels WHERE item_id = ${itemId} AND site_key = ${siteKey(site)}`);
  return r ? Number(r.on_hand) : 0;
}

/** Suma `delta` a las existencias. `floor`: no deja bajar de ese valor (null = sin límite). Devuelve si se aplicó. */
async function moveLevel(exec: InventoryExec, itemId: number, site: string | null, delta: number, floor: number | null, now: number): Promise<boolean> {
  const cond = floor === null ? sql`` : sql` AND on_hand + ${delta} >= ${floor}`;
  const r = await header(exec, sql`UPDATE inventory_levels SET on_hand = on_hand + ${delta}, updated_at = ${now} WHERE item_id = ${itemId} AND site_key = ${siteKey(site)}${cond}`);
  return r.affectedRows > 0;
}

interface MovementInput {
  item: Pick<TrackedItem, "id" | "productId" | "variantId">;
  site: string | null;
  kind: MovementKind;
  quantity: number;
  reason?: string | null;
  sourceType: string;
  sourceId: string;
  sourceRef?: string | null;
  reversesId?: number | null;
  idemKey: string;
  actor: Actor;
}

/** Inserta el movimiento si su clave no existía. Devuelve su id, o null si el documento ya estaba aplicado. */
async function claimMovement(exec: InventoryExec, m: MovementInput, now: number): Promise<number | null> {
  const r = await header(
    exec,
    sql`INSERT IGNORE INTO inventory_movements (item_id, product_id, variant_id, site_id, kind, quantity, reason, source_type, source_id, source_ref, reverses_id, idem_key, user_id, user_name, created_at)
        VALUES (${m.item.id}, ${m.item.productId}, ${m.item.variantId}, ${m.site}, ${m.kind}, ${m.quantity}, ${m.reason?.slice(0, 300) ?? null}, ${m.sourceType}, ${m.sourceId.slice(0, 64)}, ${m.sourceRef?.slice(0, 100) ?? null}, ${m.reversesId ?? null}, ${m.idemKey.slice(0, 160)}, ${m.actor.id}, ${m.actor.name?.slice(0, 200) ?? null}, ${now})`,
  );
  return r.affectedRows > 0 ? r.insertId : null;
}

/** Anota las existencias resultantes. `sale`: una venta que deja el stock en negativo queda marcada «sin existencias». */
async function settleMovement(exec: InventoryExec, movementId: number, itemId: number, site: string | null, sale = false): Promise<number> {
  const balance = await onHandAt(exec, itemId, site);
  await exec.execute(sql`UPDATE inventory_movements SET balance_after = ${balance}, shortfall = ${sale && balance < 0 ? 1 : 0} WHERE id = ${movementId}`);
  return balance;
}

/** Ejecuta en una transacción (o en la que ya está en curso). */
async function inTx<T>(fn: (tx: InventoryExec) => Promise<T>, exec?: InventoryExec): Promise<T> {
  if (exec) return fn(exec);
  const d = await db();
  return d.transaction((tx) => fn(tx as unknown as InventoryExec));
}

// ─── Ventas ──────────────────────────────────────────────────────────────────

export interface StockSaleLine extends SaleLine {
  /** Identifica la línea dentro del documento (clave de idempotencia). */
  key: string;
  name: string;
}

/**
 * Comprobación previa a una venta (antes de numerar el ticket o de crear el pedido): rechaza lo que no tiene
 * existencias con la política «bloquear». Sin inventario contratado o sin artículos inventariables, no hace nada.
 */
export async function assertStockAvailable(lines: readonly StockSaleLine[], site: string | null): Promise<void> {
  if (!lines.length || !(await inventoryLicensed(true))) return;
  try {
    const d = await db();
    const items = await trackedItems(d, lines.map((l) => l.productId));
    if (!items.length) return;
    for (const { item, quantity } of Array.from(demandByItem(lines, items).values())) {
      if (item.policy !== "block") continue;
      const available = await onHandAt(d, item.id, site);
      if (available < quantity) {
        const name = lines.find((l) => itemForLine(l, [item]))?.name ?? `#${item.productId}`;
        throw new TRPCError({ code: "BAD_REQUEST", message: outOfStockMessage(name, available) });
      }
    }
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // Un fallo al consultar el inventario nunca impide vender (el descuento real se hace al cobrar)
    if (!isMissingInventorySchema(e)) console.error("[Inventario] Comprobación omitida:", (e as Error).message);
  }
}

export interface SaleStockResult {
  applied: number;
  /** Artículos vendidos sin existencias suficientes (política «permitir» o cobro online ya hecho). */
  shortfalls: string[];
}

export interface SaleDocument {
  sourceType: "tpv_sale" | "reservation";
  sourceId: string;
  sourceRef?: string | null;
  site: string | null;
  actor: Actor;
  /**
   * `reject`: con la política «bloquear», si falta stock se lanza un error (el llamante deshace la venta).
   * `record`: el cobro ya está hecho; se descuenta igualmente y el movimiento queda marcado «vendido sin existencias».
   */
  onShortage: "reject" | "record";
}

/**
 * Descuenta las existencias de una venta. Idempotente por documento y línea. `exec`: la transacción del cobro (lo
 * descontado se deshace con ella). Devuelve los movimientos aplicados y los artículos que quedan en negativo (aviso).
 */
export async function applySaleStock(doc: SaleDocument, lines: readonly StockSaleLine[], exec?: InventoryExec): Promise<SaleStockResult> {
  const none: SaleStockResult = { applied: 0, shortfalls: [] };
  if (!lines.length || !(await inventoryLicensed(false))) return none;
  const enforce = await inventoryLicensed(true);
  try {
    return await inTx(async (tx) => {
      const items = await trackedItems(tx, lines.map((l) => l.productId));
      if (!items.length) return none;
      const resolved = lines
        .map((line) => ({ line, item: itemForLine(line, items) }))
        .filter((x): x is { line: StockSaleLine; item: ItemRow } => !!x.item && x.line.quantity > 0)
        // Orden fijo de bloqueo (por artículo) para que dos ventas a la vez no se interbloqueen
        .sort((a, b) => a.item.id - b.item.id);
      const out: SaleStockResult = { applied: 0, shortfalls: [] };
      const now = Date.now();
      for (const { line, item } of resolved) {
        const qty = Math.trunc(line.quantity);
        await ensureLevel(tx, item.id, doc.site, now);
        const movementId = await claimMovement(tx, {
          item, site: doc.site, kind: "venta", quantity: -qty, sourceType: doc.sourceType, sourceId: doc.sourceId, sourceRef: doc.sourceRef,
          idemKey: `${doc.sourceType}:${doc.sourceId}:${line.key}`, actor: doc.actor,
        }, now);
        if (movementId === null) continue;
        const blocking = enforce && item.policy === "block";
        if (!(await moveLevel(tx, item.id, doc.site, -qty, blocking ? 0 : null, now))) {
          if (doc.onShortage === "reject") {
            throw new TRPCError({ code: "CONFLICT", message: outOfStockMessage(line.name, await onHandAt(tx, item.id, doc.site)) });
          }
          // Cobro ya hecho: se descuenta igualmente y el movimiento queda marcado
          await moveLevel(tx, item.id, doc.site, -qty, null, now);
        }
        if ((await settleMovement(tx, movementId, item.id, doc.site, true)) < 0) out.shortfalls.push(line.name);
        out.applied++;
      }
      return out;
    }, exec);
  } catch (e) {
    if (isMissingInventorySchema(e)) return none;
    throw e;
  }
}

/**
 * Repone las unidades de las ventas de esos documentos (anulación o devolución). Una sola vez por movimiento: repetirlo
 * no repone dos veces. No exige la capacidad: si se descontó, se repone.
 */
export async function restockSources(sources: Array<{ sourceType: "tpv_sale" | "reservation"; sourceId: string }>, actor: Actor, reason: string): Promise<number> {
  if (!sources.length) return 0;
  try {
    return await inTx(async (tx) => {
      let applied = 0;
      for (const s of sources) {
        const sales = await rows<{ id: number; item_id: number; product_id: number; variant_id: number; site_id: string | null; quantity: number; source_ref: string | null }>(
          tx,
          sql`SELECT id, item_id, product_id, variant_id, site_id, quantity, source_ref FROM inventory_movements WHERE source_type = ${s.sourceType} AND source_id = ${s.sourceId} AND kind = 'venta' ORDER BY item_id, id`,
        );
        const now = Date.now();
        for (const m of sales) {
          const qty = Math.abs(Number(m.quantity));
          const item = { id: Number(m.item_id), productId: Number(m.product_id), variantId: Number(m.variant_id) };
          const movementId = await claimMovement(tx, {
            item, site: m.site_id, kind: "devolucion", quantity: qty, reason, sourceType: s.sourceType, sourceId: s.sourceId, sourceRef: m.source_ref,
            reversesId: Number(m.id), idemKey: `rev:${m.id}`, actor,
          }, now);
          if (movementId === null) continue;
          await ensureLevel(tx, item.id, m.site_id, now);
          await moveLevel(tx, item.id, m.site_id, qty, null, now);
          await settleMovement(tx, movementId, item.id, m.site_id);
          applied++;
        }
      }
      return applied;
    });
  } catch (e) {
    if (isMissingInventorySchema(e)) return 0;
    throw e;
  }
}

/** Repone una venta del TPV anulada. Nunca rompe la anulación: un fallo se registra y se sigue. */
export async function restockTpvSale(saleId: number, actor: Actor): Promise<void> {
  try {
    await restockSources([{ sourceType: "tpv_sale", sourceId: String(saleId) }], actor, "Venta del TPV anulada");
  } catch (e) {
    console.error("[Inventario] No se pudieron reponer las unidades de la venta", saleId, (e as Error).message);
  }
}

/** Repone una reserva o pedido anulado (y la venta del TPV que la originó, si la hay). Nunca rompe la anulación. */
export async function restockReservations(reservationIds: number[], actor: Actor, reason = "Pedido o reserva anulada"): Promise<void> {
  const ids = reservationIds.filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return;
  try {
    const d = await db();
    const sales = await rows<{ id: number }>(d, sql`SELECT id FROM tpv_sales WHERE reservationId IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await restockSources(
      [...ids.map((i) => ({ sourceType: "reservation" as const, sourceId: String(i) })), ...sales.map((s) => ({ sourceType: "tpv_sale" as const, sourceId: String(s.id) }))],
      actor,
      reason,
    );
  } catch (e) {
    console.error("[Inventario] No se pudieron reponer las unidades de", ids.join(","), (e as Error).message);
  }
}

/** Unidades de una línea de pedido online: las unidades reservadas (precio por unidad) o la cantidad. */
export function orderLineQuantity(r: { pricing_type?: string | null; units_booked?: number | null; people?: number | null }): number {
  if (r.pricing_type === "per_unit" && r.units_booked && r.units_booked > 0) return Number(r.units_booked);
  return Math.max(1, Number(r.people) || 1);
}

/**
 * Pedido de la tienda online pagado: descuenta cada línea marcada al crear el pedido (sede principal). Idempotente: una
 * notificación de pago repetida no descuenta dos veces. Solo compras directas (sin presupuesto).
 */
export async function applyOnlineOrderStock(merchantOrder: string): Promise<number> {
  if (!(await inventoryLicensed(false))) return 0;
  try {
    const d = await db();
    const lines = await rows<{ id: number; product_id: number; product_name: string; people: number; pricing_type: string | null; units_booked: number | null; stock_variant_id: number | null; reservation_number: string | null }>(
      d,
      sql`SELECT id, product_id, product_name, people, pricing_type, units_booked, stock_variant_id, reservation_number FROM reservations
          WHERE merchant_order = ${merchantOrder} AND status = 'paid' AND channel = 'ONLINE_DIRECTO' AND quote_id IS NULL AND stock_variant_id IS NOT NULL ORDER BY id`,
    );
    let applied = 0;
    for (const r of lines) {
      applied += (await applySaleStock(
        { sourceType: "reservation", sourceId: String(r.id), sourceRef: r.reservation_number ?? merchantOrder, site: null, actor: { id: null, name: "Tienda online" }, onShortage: "record" },
        [{ key: "1", productId: Number(r.product_id), variantId: r.stock_variant_id, quantity: orderLineQuantity(r), name: r.product_name }],
      )).applied;
    }
    return applied;
  } catch (e) {
    if (isMissingInventorySchema(e)) return 0;
    throw e;
  }
}

/**
 * Línea de la tienda online de un artículo inventariable: se marca al crear el pedido (`stock_variant_id`: 0 = producto
 * entero, >0 = variante elegida) para descontarla al confirmarse el pago. Lo que no se marca (no inventariable, packs,
 * pedidos de presupuestos) nunca descuenta.
 */
export async function markOrderStockLine(reservationId: number, productId: number, variantId: number | null | undefined): Promise<void> {
  if (!(await inventoryLicensed(false))) return;
  try {
    const d = await db();
    const items = await trackedItems(d, [productId]);
    if (!itemForLine({ productId, variantId, quantity: 1 }, items)) return;
    await d.execute(sql`UPDATE reservations SET stock_variant_id = ${variantId && variantId > 0 ? variantId : 0} WHERE id = ${reservationId}`);
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // Un fallo al consultar el inventario nunca impide vender (el descuento real se hace al cobrar)
    if (!isMissingInventorySchema(e)) console.error("[Inventario] Comprobación omitida:", (e as Error).message);
  }
}

// ─── Panel: artículos, existencias y movimientos manuales ─────────────────────

export interface ItemSummary {
  id: number;
  productId: number;
  variantId: number;
  title: string | null;
  variantName: string | null;
  policy: OversellPolicy;
  minStock: number;
  levels: Array<{ siteId: string | null; onHand: number; minStock: number | null }>;
}

export async function listTrackedItems(): Promise<ItemSummary[]> {
  const d = await db();
  const items = await rows<{ id: number; product_id: number; variant_id: number; oversell_policy: string; min_stock: number; title: string | null; variant_name: string | null }>(
    d,
    sql`SELECT i.id, i.product_id, i.variant_id, i.oversell_policy, i.min_stock, e.title, v.name AS variant_name
        FROM inventory_items i LEFT JOIN experiences e ON e.id = i.product_id LEFT JOIN experience_variants v ON v.id = i.variant_id AND i.variant_id > 0
        WHERE i.tracked = 1 ORDER BY e.title, i.variant_id`,
  );
  const levels = await rows<{ item_id: number; site_id: string | null; on_hand: number; min_stock: number | null }>(
    d,
    sql`SELECT l.item_id, l.site_id, l.on_hand, l.min_stock FROM inventory_levels l JOIN inventory_items i ON i.id = l.item_id WHERE i.tracked = 1`,
  );
  const byItem = new Map<number, ItemSummary["levels"]>();
  for (const l of levels) {
    const list = byItem.get(Number(l.item_id)) ?? [];
    list.push({ siteId: l.site_id, onHand: Number(l.on_hand), minStock: l.min_stock == null ? null : Number(l.min_stock) });
    byItem.set(Number(l.item_id), list);
  }
  return items.map((i) => ({
    id: Number(i.id), productId: Number(i.product_id), variantId: Number(i.variant_id), title: i.title, variantName: i.variant_name,
    policy: toPolicy(i.oversell_policy), minStock: Number(i.min_stock), levels: byItem.get(Number(i.id)) ?? [],
  }));
}

/** Productos del catálogo (y sus variantes) que se pueden marcar como inventariables. */
export async function catalogForTracking() {
  const d = await db();
  const products = await rows<{ id: number; title: string; is_active: number }>(d, sql`SELECT id, title, isActive AS is_active FROM experiences ORDER BY title`);
  const variants = await rows<{ id: number; experience_id: number; name: string }>(d, sql`SELECT id, experienceId AS experience_id, name FROM experience_variants ORDER BY sortOrder, id`);
  const tracked = await rows<{ product_id: number; variant_id: number; tracked: number }>(d, sql`SELECT product_id, variant_id, tracked FROM inventory_items`);
  const isTracked = (p: number, v: number) => tracked.some((t) => Number(t.product_id) === p && Number(t.variant_id) === v && Number(t.tracked) === 1);
  return products.map((p) => ({
    id: Number(p.id),
    title: p.title,
    active: !!Number(p.is_active),
    tracked: isTracked(Number(p.id), 0),
    variants: variants.filter((v) => Number(v.experience_id) === Number(p.id)).map((v) => ({ id: Number(v.id), name: v.name, tracked: isTracked(Number(p.id), Number(v.id)) })),
  }));
}

/** Marca (o actualiza) un producto o variante como inventariable. Las existencias y el historial se conservan. */
export async function trackItem(input: { productId: number; variantId: number; policy: OversellPolicy; minStock: number }): Promise<{ id: number }> {
  const d = await db();
  const [p] = await rows<{ id: number }>(d, sql`SELECT id FROM experiences WHERE id = ${input.productId}`);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
  if (input.variantId > 0) {
    const [v] = await rows<{ id: number }>(d, sql`SELECT id FROM experience_variants WHERE id = ${input.variantId} AND experienceId = ${input.productId}`);
    if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "La variante no es de ese producto" });
  }
  const now = Date.now();
  await d.execute(sql`INSERT INTO inventory_items (product_id, variant_id, tracked, oversell_policy, min_stock, created_at, updated_at)
    VALUES (${input.productId}, ${input.variantId}, 1, ${input.policy}, ${input.minStock}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE tracked = 1, oversell_policy = VALUES(oversell_policy), min_stock = VALUES(min_stock), updated_at = VALUES(updated_at)`);
  const [row] = await rows<{ id: number }>(d, sql`SELECT id FROM inventory_items WHERE product_id = ${input.productId} AND variant_id = ${input.variantId}`);
  return { id: Number(row.id) };
}

export async function updateItem(itemId: number, patch: { policy?: OversellPolicy; minStock?: number }): Promise<void> {
  const d = await db();
  await getItem(d, itemId);
  const sets: SQL[] = [sql`updated_at = ${Date.now()}`];
  if (patch.policy) sets.push(sql`oversell_policy = ${patch.policy}`);
  if (patch.minStock !== undefined) sets.push(sql`min_stock = ${patch.minStock}`);
  await d.execute(sql`UPDATE inventory_items SET ${sql.join(sets, sql`, `)} WHERE id = ${itemId}`);
}

/** Deja de controlar el artículo: se vende como siempre. Existencias e historial se conservan por si se reactiva. */
export async function untrackItem(itemId: number): Promise<void> {
  const d = await db();
  await getItem(d, itemId);
  await d.execute(sql`UPDATE inventory_items SET tracked = 0, updated_at = ${Date.now()} WHERE id = ${itemId}`);
}

async function getItem(exec: InventoryExec, itemId: number): Promise<TrackedItem> {
  const [r] = await rows<{ id: number; product_id: number; variant_id: number; oversell_policy: string; tracked: number }>(exec, sql`SELECT id, product_id, variant_id, oversell_policy, tracked FROM inventory_items WHERE id = ${itemId}`);
  if (!r || !Number(r.tracked)) throw new TRPCError({ code: "NOT_FOUND", message: "Artículo de inventario no encontrado" });
  return { id: Number(r.id), productId: Number(r.product_id), variantId: Number(r.variant_id), policy: toPolicy(r.oversell_policy) };
}

/** Mínimo de alerta propio de una sede (null = el del artículo). */
export async function setLevelMin(itemId: number, site: string | null, minStock: number | null): Promise<void> {
  const d = await db();
  await getItem(d, itemId);
  const now = Date.now();
  await ensureLevel(d, itemId, site, now);
  await d.execute(sql`UPDATE inventory_levels SET min_stock = ${minStock}, updated_at = ${now} WHERE item_id = ${itemId} AND site_key = ${siteKey(site)}`);
}

export interface ManualResult {
  applied: boolean;
  onHand: number;
}

/** Entrada de unidades (compra o recepción). */
export async function receiveStock(input: { itemId: number; site: string | null; quantity: number; reason: string | null; reference: string | null; key: string; actor: Actor }): Promise<ManualResult> {
  return inTx(async (tx) => {
    const item = await getItem(tx, input.itemId);
    const now = Date.now();
    await ensureLevel(tx, item.id, input.site, now);
    const id = await claimMovement(tx, {
      item, site: input.site, kind: "entrada", quantity: input.quantity, reason: input.reason, sourceType: "manual", sourceId: input.key, sourceRef: input.reference,
      idemKey: `manual:${input.key}`, actor: input.actor,
    }, now);
    if (id === null) return { applied: false, onHand: await onHandAt(tx, item.id, input.site) };
    await moveLevel(tx, item.id, input.site, input.quantity, null, now);
    return { applied: true, onHand: await settleMovement(tx, id, item.id, input.site) };
  });
}

/**
 * Ajuste manual con motivo: suma o resta unidades (`delta`) o fija el recuento (`set`). Nunca deja las existencias en
 * negativo.
 */
export async function adjustStock(input: { itemId: number; site: string | null; mode: "delta" | "set"; quantity: number; reason: string; key: string; actor: Actor }): Promise<ManualResult> {
  return inTx(async (tx) => {
    const item = await getItem(tx, input.itemId);
    const now = Date.now();
    await ensureLevel(tx, item.id, input.site, now);
    // Bloquea la fila: el recuento se calcula sobre las existencias de este instante
    const [locked] = await rows<{ on_hand: number }>(tx, sql`SELECT on_hand FROM inventory_levels WHERE item_id = ${item.id} AND site_key = ${siteKey(input.site)} FOR UPDATE`);
    const current = Number(locked?.on_hand ?? 0);
    const delta = input.mode === "set" ? input.quantity - current : input.quantity;
    if (current + delta < 0) throw new TRPCError({ code: "BAD_REQUEST", message: `No puedes dejar las existencias en negativo (hay ${current}).` });
    const id = await claimMovement(tx, {
      item, site: input.site, kind: "ajuste", quantity: delta, reason: input.reason, sourceType: "manual", sourceId: input.key,
      idemKey: `manual:${input.key}`, actor: input.actor,
    }, now);
    if (id === null) return { applied: false, onHand: current };
    if (delta !== 0) await moveLevel(tx, item.id, input.site, delta, null, now);
    return { applied: true, onHand: await settleMovement(tx, id, item.id, input.site) };
  });
}

/** Traspaso entre sedes: sale de una y entra en otra en la misma transacción. Nunca deja el origen en negativo. */
export async function transferStock(input: { itemId: number; from: string | null; to: string | null; quantity: number; reason: string | null; key: string; actor: Actor }): Promise<{ applied: boolean; fromOnHand: number; toOnHand: number }> {
  if (siteKey(input.from) === siteKey(input.to)) throw new TRPCError({ code: "BAD_REQUEST", message: "Elige dos sedes distintas" });
  return inTx(async (tx) => {
    const item = await getItem(tx, input.itemId);
    const now = Date.now();
    // Orden fijo de bloqueo entre las dos filas
    for (const s of [input.from, input.to].sort((a, b) => siteKey(a).localeCompare(siteKey(b)))) await ensureLevel(tx, item.id, s, now);
    const out = await claimMovement(tx, {
      item, site: input.from, kind: "traspaso_salida", quantity: -input.quantity, reason: input.reason, sourceType: "transfer", sourceId: input.key,
      idemKey: `transfer:${input.key}:out`, actor: input.actor,
    }, now);
    if (out === null) return { applied: false, fromOnHand: await onHandAt(tx, item.id, input.from), toOnHand: await onHandAt(tx, item.id, input.to) };
    if (!(await moveLevel(tx, item.id, input.from, -input.quantity, 0, now))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `No hay unidades suficientes en la sede de origen (hay ${await onHandAt(tx, item.id, input.from)}).` });
    }
    const fromOnHand = await settleMovement(tx, out, item.id, input.from);
    const inn = await claimMovement(tx, {
      item, site: input.to, kind: "traspaso_entrada", quantity: input.quantity, reason: input.reason, sourceType: "transfer", sourceId: input.key,
      idemKey: `transfer:${input.key}:in`, actor: input.actor,
    }, now);
    await moveLevel(tx, item.id, input.to, input.quantity, null, now);
    const toOnHand = inn === null ? await onHandAt(tx, item.id, input.to) : await settleMovement(tx, inn, item.id, input.to);
    return { applied: true, fromOnHand, toOnHand };
  });
}

export interface MovementFilter {
  itemId?: number;
  /** Sede (valor guardado: NULL = principal) o undefined para todas. */
  site?: { stored: string | null } | undefined;
  /** Sedes visibles para el usuario (valores guardados); undefined = todas. */
  scope?: Array<string | null>;
  kind?: MovementKind;
  fromMs?: number;
  toMs?: number;
  limit: number;
  offset: number;
}

export interface MovementRow {
  id: number;
  itemId: number;
  productId: number;
  variantId: number;
  title: string | null;
  variantName: string | null;
  siteId: string | null;
  kind: MovementKind;
  quantity: number;
  balanceAfter: number | null;
  shortfall: boolean;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceRef: string | null;
  userName: string | null;
  createdAt: number;
}

function scopeCondition(column: SQL, scope: Array<string | null>): SQL {
  const named = scope.filter((s): s is string => !!s);
  const parts: SQL[] = [];
  if (scope.includes(null)) parts.push(sql`${column} IS NULL`);
  if (named.length) parts.push(sql`${column} IN (${sql.join(named.map((s) => sql`${s}`), sql`, `)})`);
  return parts.length ? sql`(${sql.join(parts, sql` OR `)})` : sql`1 = 0`;
}

export async function listMovements(f: MovementFilter): Promise<{ items: MovementRow[]; total: number }> {
  const d = await db();
  const conds: SQL[] = [sql`1 = 1`];
  if (f.itemId) conds.push(sql`m.item_id = ${f.itemId}`);
  if (f.site) conds.push(f.site.stored === null ? sql`m.site_id IS NULL` : sql`m.site_id = ${f.site.stored}`);
  if (f.scope) conds.push(scopeCondition(sql`m.site_id`, f.scope));
  if (f.kind) conds.push(sql`m.kind = ${f.kind}`);
  if (f.fromMs !== undefined) conds.push(sql`m.created_at >= ${f.fromMs}`);
  if (f.toMs !== undefined) conds.push(sql`m.created_at < ${f.toMs}`);
  const where = sql.join(conds, sql` AND `);
  const [count] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM inventory_movements m WHERE ${where}`);
  const list = await rows<any>(
    d,
    sql`SELECT m.*, e.title, v.name AS variant_name FROM inventory_movements m
        LEFT JOIN experiences e ON e.id = m.product_id LEFT JOIN experience_variants v ON v.id = m.variant_id AND m.variant_id > 0
        WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
  );
  return {
    total: Number(count?.n ?? 0),
    items: list.map((m) => ({
      id: Number(m.id), itemId: Number(m.item_id), productId: Number(m.product_id), variantId: Number(m.variant_id), title: m.title ?? null, variantName: m.variant_name ?? null,
      siteId: m.site_id ?? null, kind: m.kind, quantity: Number(m.quantity), balanceAfter: m.balance_after == null ? null : Number(m.balance_after), shortfall: !!Number(m.shortfall),
      reason: m.reason ?? null, sourceType: m.source_type ?? null, sourceId: m.source_id ?? null, sourceRef: m.source_ref ?? null, userName: m.user_name ?? null, createdAt: Number(m.created_at),
    })),
  };
}
