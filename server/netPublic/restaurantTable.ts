/**
 * Restaurant Net · carta QR y pedido desde la mesa (capacidad `restaurant-net` + módulo de restaurantes).
 *
 *  - Cada mesa tiene, como mucho, un enlace activo (`net_public_links`, tipo `restaurant_table`) con token opaco. El
 *    panel lo emite (y lo rota) o lo revoca; el QR impreso deja de valer al rotarlo.
 *  - La página pública muestra la carta activa del restaurante de la mesa y permite enviar un PEDIDO, que queda
 *    pendiente (`restaurant_table_requests`). Nada entra en la comanda ni en cocina hasta que el camarero lo confirma;
 *    al confirmarlo se añade a la comanda abierta de la mesa (o se abre una) con las reglas de siempre
 *    (server/restaurantNetDb.ts: precio, IVA y partida del plato en ese momento).
 *  - No hay cobro en línea: el pago se hace en sala con el TPV del Core (restaurantNet.checkout).
 *  - Límites: 30 líneas, 20 unidades por línea, 60 unidades por pedido y 3 pedidos pendientes por mesa; el envío repetido
 *    del mismo formulario (misma clave) es el mismo pedido.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { getModuleAccess } from "../_core/modules/runtime";
import { RESTAURANT_NET_CAPABILITY, round2 } from "../../shared/restaurantNet";
import * as rn from "../restaurantNetDb";
import { activeLinks, affected, issueLink, revokeLink, rows, withLinksDb, type NetLink } from "./links";
import { publicUrl } from "./html";

export const TABLE_ORDER_LIMITS = { maxLines: 30, maxQtyPerLine: 20, maxUnits: 60, maxPending: 3, noteMax: 300 } as const;
export const SUBMIT_KEY_RE = /^[a-f0-9]{32}$/;

export interface TableOrderLine {
  menuItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
}

/** ¿Está la carta QR disponible en esta empresa? Capacidad activa y módulo de restaurantes. Si no se puede saber, no. */
export async function tableOrderingAvailable(): Promise<boolean> {
  try {
    if (!(await getCapabilityAccess().check(RESTAURANT_NET_CAPABILITY, { write: true })).allowed) return false;
    return await getModuleAccess().isModuleAvailable("restaurants");
  } catch {
    return false;
  }
}

/**
 * Líneas del pedido desde el formulario (`q<idDelPlato>` = unidades). Solo platos activos de la carta del restaurante;
 * las cantidades vacías o 0 se ignoran. Devuelve el error para el cliente si se pasa de los límites.
 */
export function orderLinesFromForm(body: Record<string, unknown>, menu: readonly rn.MenuItem[]): { lines: TableOrderLine[]; error: string | null } {
  const byId = new Map(menu.filter((m) => m.isActive).map((m) => [m.id, m]));
  const lines: TableOrderLine[] = [];
  let keys = 0;
  for (const [k, v] of Object.entries(body)) {
    const m = /^q(\d{1,9})$/.exec(k);
    if (!m) continue;
    if (++keys > 400) return { lines: [], error: "El pedido no es válido." };
    const raw = Array.isArray(v) ? v[0] : v;
    const s = String(raw ?? "").trim();
    if (s === "" || s === "0") continue;
    if (!/^\d{1,3}$/.test(s)) return { lines: [], error: "Revisa las cantidades del pedido." };
    const qty = Number(s);
    if (qty > TABLE_ORDER_LIMITS.maxQtyPerLine) return { lines: [], error: `Como máximo ${TABLE_ORDER_LIMITS.maxQtyPerLine} unidades de cada plato.` };
    const item = byId.get(Number(m[1]));
    if (!item) return { lines: [], error: "Algún plato ya no está disponible. Vuelve a cargar la carta." };
    lines.push({ menuItemId: item.id, name: item.name, quantity: qty, unitPrice: round2(item.price) });
  }
  if (!lines.length) return { lines: [], error: "Elige al menos un plato." };
  if (lines.length > TABLE_ORDER_LIMITS.maxLines) return { lines: [], error: `Como máximo ${TABLE_ORDER_LIMITS.maxLines} platos distintos por pedido.` };
  if (lines.reduce((s, l) => s + l.quantity, 0) > TABLE_ORDER_LIMITS.maxUnits) return { lines: [], error: `Como máximo ${TABLE_ORDER_LIMITS.maxUnits} unidades por pedido. Pide al camarero si sois un grupo grande.` };
  return { lines, error: null };
}

export const estimatedTotal = (lines: readonly TableOrderLine[]) => round2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));

// ─── Pública ───────────────────────────────────────────────────────────────────

export interface PublicTable {
  tableId: number;
  code: string;
  restaurantId: number;
  restaurantName: string;
}

/** Mesa activa del enlace con su restaurante (null si la mesa se archivó). */
export function tableOfLink(link: NetLink): Promise<PublicTable | null> {
  return withLinksDb(async (d) => {
    const [t] = await rows(d, sql`SELECT t.id, t.code, t.restaurant_id, r.name AS restaurant_name FROM dining_tables t JOIN restaurants r ON r.id = t.restaurant_id
      WHERE t.id = ${link.targetId} AND t.is_active = 1`);
    return t ? { tableId: Number(t.id), code: String(t.code), restaurantId: Number(t.restaurant_id), restaurantName: String(t.restaurant_name ?? "") } : null;
  });
}

export const publicMenu = (restaurantId: number) => rn.listMenu(restaurantId);

export type SubmitResult = { ok: true; requestId: number; replayed: boolean } | { ok: false; error: string };

/** Registra el pedido pendiente de la mesa. Idempotente por clave del formulario. */
export function submitTableRequest(link: NetLink, table: PublicTable, lines: TableOrderLine[], note: string | null, submitKey: string, now = Date.now()): Promise<SubmitResult> {
  return withLinksDb((d) =>
    d.transaction(async (tx) => {
      const [same] = await rows(tx, sql`SELECT id FROM restaurant_table_requests WHERE link_id = ${link.id} AND submit_key = ${submitKey}`);
      if (same) return { ok: true as const, requestId: Number(same.id), replayed: true };
      // La mesa bloqueada: el recuento de pendientes no se adelanta con dos envíos a la vez
      await tx.execute(sql`SELECT id FROM dining_tables WHERE id = ${table.tableId} FOR UPDATE`);
      const [p] = await rows<{ n: number }>(tx, sql`SELECT COUNT(*) AS n FROM restaurant_table_requests WHERE table_id = ${table.tableId} AND status IN ('pending', 'accepting')`);
      if (Number(p?.n ?? 0) >= TABLE_ORDER_LIMITS.maxPending) return { ok: false as const, error: "Ya hay pedidos de esta mesa esperando al camarero. Espera a que los confirme." };
      const units = lines.reduce((s, l) => s + l.quantity, 0);
      const r = await affected(tx, sql`INSERT INTO restaurant_table_requests (restaurant_id, table_id, link_id, submit_key, status, lines_json, item_count, estimated_total, guest_note, created_at)
        VALUES (${table.restaurantId}, ${table.tableId}, ${link.id}, ${submitKey}, 'pending', ${JSON.stringify(lines)}, ${units}, ${estimatedTotal(lines).toFixed(2)},
          ${note?.trim().slice(0, TABLE_ORDER_LIMITS.noteMax) || null}, ${now})`);
      await tx.execute(sql`UPDATE net_public_links SET uses = uses + 1, last_used_at = ${now} WHERE id = ${link.id}`);
      return { ok: true as const, requestId: r.insertId, replayed: false };
    }),
  );
}

/** Pedidos de la mesa enviados con este enlace aún sin atender (para mostrarlos en la página). */
export function pendingOfLink(linkId: number): Promise<Array<{ id: number; itemCount: number; createdAt: number }>> {
  return withLinksDb(async (d) =>
    (await rows(d, sql`SELECT id, item_count, created_at FROM restaurant_table_requests WHERE link_id = ${linkId} AND status IN ('pending', 'accepting') ORDER BY id`)).map((r: any) => ({
      id: Number(r.id),
      itemCount: Number(r.item_count),
      createdAt: Number(r.created_at),
    })),
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

const notInstalled = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "La carta QR aún no está instalada en esta empresa (falta la actualización 0046_net_rutas_publicas)." });

async function panel<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === "NetLinksNotInstalled") throw notInstalled();
    throw e;
  }
}

async function tableRestaurant(tableId: number): Promise<{ restaurantId: number; code: string }> {
  const [t] = await withLinksDb(async (d) => rows(d, sql`SELECT restaurant_id, code, is_active FROM dining_tables WHERE id = ${tableId}`));
  if (!t || Number(t.is_active) !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "La mesa no existe o está archivada." });
  return { restaurantId: Number(t.restaurant_id), code: String(t.code) };
}

/** Estado del enlace de cada mesa del restaurante (sin token: solo si hay uno activo y desde cuándo). */
export function tableLinks(guard: rn.Guard, restaurantId: number) {
  return panel(async () => {
    await guard(restaurantId);
    const tables = await rn.listTables(restaurantId);
    const links = await activeLinks("restaurant_table", tables.map((t) => t.id));
    const byTable = new Map(links.map((l) => [l.targetId, l]));
    return tables.map((t) => {
      const l = byTable.get(t.id);
      return { tableId: t.id, code: t.code, active: !!l, createdAt: l?.createdAt ?? null, uses: l?.uses ?? 0, lastUsedAt: l?.lastUsedAt ?? null };
    });
  });
}

/** Emite (o rota) el enlace de la mesa. La URL con el token solo se devuelve aquí, una vez. */
export function issueTableLink(guard: rn.Guard, tableId: number, actor: string) {
  return panel(async () => {
    const t = await tableRestaurant(tableId);
    await guard(t.restaurantId);
    const { link, token } = await issueLink({ kind: "restaurant_table", targetId: tableId, actor });
    return { tableId, code: t.code, url: publicUrl(`/mesa/${token}`), createdAt: link.createdAt };
  });
}

export function revokeTableLink(guard: rn.Guard, tableId: number, actor: string) {
  return panel(async () => {
    const t = await tableRestaurant(tableId);
    await guard(t.restaurantId);
    return { revoked: (await revokeLink("restaurant_table", tableId, actor)) > 0 };
  });
}

export interface TableRequestView {
  id: number;
  tableId: number;
  tableCode: string;
  status: string;
  lines: TableOrderLine[];
  itemCount: number;
  estimatedTotal: number;
  guestNote: string | null;
  hospoOrderId: number | null;
  decisionNote: string | null;
  createdAt: number;
  decidedAt: number | null;
}

const parseLines = (v: unknown): TableOrderLine[] => {
  try {
    const p = JSON.parse(String(v ?? "[]"));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};
const toRequest = (r: any): TableRequestView => ({
  id: Number(r.id),
  tableId: Number(r.table_id),
  tableCode: String(r.table_code ?? ""),
  status: String(r.status),
  lines: parseLines(r.lines_json),
  itemCount: Number(r.item_count),
  estimatedTotal: Number(r.estimated_total),
  guestNote: r.guest_note ?? null,
  hospoOrderId: r.hospo_order_id == null ? null : Number(r.hospo_order_id),
  decisionNote: r.decision_note ?? null,
  createdAt: Number(r.created_at),
  decidedAt: r.decided_at == null ? null : Number(r.decided_at),
});

/** Pedidos desde la mesa del restaurante: los pendientes y los últimos atendidos. */
export function listTableRequests(guard: rn.Guard, restaurantId: number) {
  return panel(async () => {
    await guard(restaurantId);
    return withLinksDb(async (d) => {
      const pending = await rows(d, sql`SELECT q.*, t.code AS table_code FROM restaurant_table_requests q LEFT JOIN dining_tables t ON t.id = q.table_id
        WHERE q.restaurant_id = ${restaurantId} AND q.status IN ('pending', 'accepting') ORDER BY q.id`);
      const recent = await rows(d, sql`SELECT q.*, t.code AS table_code FROM restaurant_table_requests q LEFT JOIN dining_tables t ON t.id = q.table_id
        WHERE q.restaurant_id = ${restaurantId} AND q.status IN ('accepted', 'rejected') ORDER BY q.id DESC LIMIT 20`);
      return { pending: pending.map(toRequest), recent: recent.map(toRequest) };
    });
  });
}

async function requestById(id: number): Promise<TableRequestView & { restaurantId: number }> {
  const [r] = await withLinksDb(async (d) => rows(d, sql`SELECT q.*, t.code AS table_code FROM restaurant_table_requests q LEFT JOIN dining_tables t ON t.id = q.table_id WHERE q.id = ${id}`));
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "El pedido no existe." });
  return { ...toRequest(r), restaurantId: Number(r.restaurant_id) };
}

/**
 * El camarero confirma el pedido: pasa a la comanda abierta de la mesa (o a una nueva) con el precio, el IVA y la
 * partida de cada plato en ese momento. Los platos retirados de la carta desde el envío no se añaden (se informa).
 * No cobra nada.
 */
export function acceptTableRequest(guard: rn.Guard, requestId: number, userId: number) {
  return panel(async () => {
    const q = await requestById(requestId);
    await guard(q.restaurantId);
    const now = Date.now();
    const claimed = await withLinksDb(async (d) =>
      (await affected(d, sql`UPDATE restaurant_table_requests SET status = 'accepting', decided_by = ${userId}, decided_at = ${now} WHERE id = ${requestId} AND status = 'pending'`)).affectedRows === 1,
    );
    if (!claimed) throw new TRPCError({ code: "CONFLICT", message: "Este pedido ya se ha atendido." });
    let orderId: number | null = null;
    const added: string[] = [];
    const skipped: string[] = [];
    try {
      const floor = await rn.getFloor(q.restaurantId);
      const table = floor.tables.find((t) => t.id === q.tableId);
      const primary = table?.mergedInto ?? q.tableId;
      orderId = floor.openOrders.find((o) => o.tableId === primary)?.id ?? null;
      if (orderId == null) orderId = (await rn.openOrder(guard, { tableId: q.tableId, guests: 2 }, userId)).id;
      for (let i = 0; i < q.lines.length; i++) {
        const l = q.lines[i];
        try {
          await rn.addItem(guard, { orderId, menuItemId: Number(l.menuItemId), quantity: Math.min(TABLE_ORDER_LIMITS.maxQtyPerLine, Math.max(1, Number(l.quantity))), notes: added.length === 0 && q.guestNote ? `Desde la mesa: ${q.guestNote}`.slice(0, 500) : null });
          added.push(l.name);
        } catch (e) {
          if (e instanceof TRPCError && e.code === "NOT_FOUND") skipped.push(l.name);
          else throw e;
        }
      }
    } catch (e) {
      // Sin nada añadido, el pedido vuelve a pendiente (se puede reintentar); con algo añadido, queda atendido
      if (added.length === 0) {
        await withLinksDb(async (d) => d.execute(sql`UPDATE restaurant_table_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ${requestId}`));
        throw e;
      }
    }
    const note = skipped.length ? `No disponibles al confirmar: ${skipped.join(", ")}`.slice(0, 255) : null;
    await withLinksDb(async (d) =>
      d.execute(sql`UPDATE restaurant_table_requests SET status = 'accepted', hospo_order_id = ${orderId}, decision_note = ${note} WHERE id = ${requestId}`),
    );
    return { orderId: orderId!, added: added.length, skipped };
  });
}

export function rejectTableRequest(guard: rn.Guard, requestId: number, userId: number, reason: string | null) {
  return panel(async () => {
    const q = await requestById(requestId);
    await guard(q.restaurantId);
    const ok = await withLinksDb(async (d) =>
      (await affected(d, sql`UPDATE restaurant_table_requests SET status = 'rejected', decided_by = ${userId}, decided_at = ${Date.now()}, decision_note = ${reason?.trim().slice(0, 255) || null}
        WHERE id = ${requestId} AND status = 'pending'`)).affectedRows === 1,
    );
    if (!ok) throw new TRPCError({ code: "CONFLICT", message: "Este pedido ya se ha atendido." });
    return { ok: true as const };
  });
}
