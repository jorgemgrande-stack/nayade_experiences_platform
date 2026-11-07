/**
 * Care Net · bonos y paquetes de sesiones y reservas de SPA (capacidad `care-net`) — acceso a datos. Lógica pura en
 * shared/careNet.ts; procedimientos en server/routers/careNet.ts.
 *
 *  - Bonos: definición (care_session_packs) → venta a un cliente del CRM (care_pack_purchases) cobrada SIEMPRE con
 *    el TPV del Core (tpv.createSale inyectado por el router, clave de idempotencia por compra, numeración, IVA y
 *    caja de la sesión). Sin cobro el bono queda pendiente y no se puede usar.
 *  - Consumo: una sesión por reserva de SPA del Core (las de la web o una cita en mostrador), con el bono bloqueado
 *    (FOR UPDATE) y un UPDATE condicional del contador: nunca se consumen más sesiones de las compradas, ni dos veces
 *    por la misma reserva (índice único). Consumir confirma la reserva (pagada con bono) y su plaza retenida.
 *    Anular el consumo devuelve la sesión y, si se pide, anula la reserva y libera su plaza.
 *  - Reservas de SPA: las del Core (`reservations` con retención de franja, migración 0004) por fechas.
 *  - Aislamiento: BD de la empresa (getDb del tenant de la petición).
 *
 * Las tablas (migración db/migrations/0037_care_bonos) no están en `drizzle/schema.ts` a propósito, como el
 * inventario o las comunidades. Sin la migración, cada operación responde que el módulo no está instalado.
 * Desarrollo nuevo (no existe en la aplicación de origen); el listado de reservas se inspira en su
 * `spa.getReservasByDateRange` adaptado a las retenciones de plaza del Core.
 */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { ModuleNotInstalled } from "./sdk";
import { holdSpaSlotAndCreateReservation, confirmInventoryHold, releaseInventoryHold } from "./inventoryHoldsDb";
import { generateMerchantOrder } from "./redsys";
import {
  CARE_NET_CAPABILITY,
  consumeProblem,
  daysBetween,
  expiresAtOf,
  packProblem,
  packSaleKey,
  pickPurchase,
  purchaseState,
  remainingOf,
  spaBookingState,
  type PackScope,
  type PurchaseState,
  type SpaBookingState,
} from "../shared/careNet";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export function isMissingCareSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /care_session_packs|care_pack_/.test(msg)) return true;
  }
  return false;
}

function isDuplicate(e: unknown, key: string): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    if ((x.code === "ER_DUP_ENTRY" || x.errno === 1062) && String(x.sqlMessage ?? x.message ?? "").includes(key)) return true;
  }
  return false;
}

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await fn(await database());
  } catch (e) {
    if (isMissingCareSchema(e)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Los bonos de Care Net aún no están instalados en esta empresa. Pide a soporte que los activen.",
        cause: new ModuleNotInstalled(CARE_NET_CAPABILITY),
      });
    }
    throw e;
  }
}
const inTx = <T>(fn: (tx: Exec) => Promise<T>) => run((d) => d.transaction((tx) => fn(tx as unknown as Exec)));

async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}
function ids(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" && v ? (() => { try { return JSON.parse(v); } catch { return []; } })() : [];
  return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

// ─── Definiciones de bono ────────────────────────────────────────────────────

export interface SessionPack extends PackScope {
  id: number;
  name: string;
  description: string | null;
  sessions: number;
  validityDays: number;
  price: number;
  isActive: boolean;
}
const toPack = (r: any): SessionPack => ({
  id: num(r.id), name: String(r.name), description: r.description ?? null, sessions: num(r.sessions), validityDays: num(r.validity_days),
  price: Number(r.price), treatmentIds: ids(r.treatment_ids), categoryIds: ids(r.category_ids), isActive: Number(r.is_active) === 1,
});

export function listPacks(includeArchived = false): Promise<SessionPack[]> {
  return run(async (d) => (await rows(d, includeArchived
    ? sql`SELECT * FROM care_session_packs ORDER BY is_active DESC, name`
    : sql`SELECT * FROM care_session_packs WHERE is_active = 1 ORDER BY name`)).map(toPack));
}

export function upsertPack(input: { id?: number; name: string; description?: string | null; sessions: number; validityDays: number; price: number; treatmentIds: number[]; categoryIds: number[] }): Promise<{ id: number }> {
  return run(async (d) => {
    const p = packProblem(input);
    if (p) throw bad(p);
    const tIds = Array.from(new Set(input.treatmentIds));
    const cIds = Array.from(new Set(input.categoryIds));
    if (tIds.length) {
      const found = await rows(d, sql`SELECT id FROM spa_treatments WHERE id IN (${sql.join(tIds.map((i) => sql`${i}`), sql`, `)})`);
      if (found.length !== tIds.length) throw notFound("Uno de los tratamientos");
    }
    if (cIds.length) {
      const found = await rows(d, sql`SELECT id FROM spa_categories WHERE id IN (${sql.join(cIds.map((i) => sql`${i}`), sql`, `)})`);
      if (found.length !== cIds.length) throw notFound("Una de las categorías");
    }
    const now = Date.now();
    const desc = input.description?.trim() || null;
    if (input.id) {
      const r = await header(d, sql`UPDATE care_session_packs SET name = ${input.name.trim()}, description = ${desc}, sessions = ${input.sessions}, validity_days = ${input.validityDays},
        price = ${input.price.toFixed(2)}, treatment_ids = ${JSON.stringify(tIds)}, category_ids = ${JSON.stringify(cIds)}, updated_at = ${now} WHERE id = ${input.id}`);
      if (!r.affectedRows) throw notFound("El bono");
      return { id: input.id };
    }
    const r = await header(d, sql`INSERT INTO care_session_packs (name, description, sessions, validity_days, price, treatment_ids, category_ids, is_active, created_at, updated_at)
      VALUES (${input.name.trim()}, ${desc}, ${input.sessions}, ${input.validityDays}, ${input.price.toFixed(2)}, ${JSON.stringify(tIds)}, ${JSON.stringify(cIds)}, 1, ${now}, ${now})`);
    return { id: r.insertId };
  });
}

/** Archiva o recupera una definición (los bonos ya vendidos no cambian: llevan su foto). */
export function setPackActive(id: number, active: boolean): Promise<{ ok: true }> {
  return run(async (d) => {
    const r = await header(d, sql`UPDATE care_session_packs SET is_active = ${active ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${id}`);
    if (!r.affectedRows) throw notFound("El bono");
    return { ok: true as const };
  });
}

// ─── Clientes del CRM ────────────────────────────────────────────────────────

export function searchClients(q: string): Promise<Array<{ id: number; name: string; email: string; phone: string | null }>> {
  return run(async (d) => {
    const term = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (await rows(d, sql`SELECT id, name, email, phone FROM clients WHERE name LIKE ${term} OR email LIKE ${term} OR phone LIKE ${term} ORDER BY name LIMIT 10`))
      .map((r: any) => ({ id: num(r.id), name: String(r.name), email: String(r.email), phone: r.phone || null }));
  });
}

async function clientById(exec: Exec, id: number): Promise<{ id: number; name: string; email: string; phone: string | null } | null> {
  const [c] = await rows(exec, sql`SELECT id, name, email, phone FROM clients WHERE id = ${id}`);
  return c ? { id: num(c.id), name: String(c.name), email: String(c.email), phone: c.phone || null } : null;
}

// ─── Bonos vendidos ──────────────────────────────────────────────────────────

export interface Purchase extends PackScope {
  id: number;
  packId: number;
  packName: string;
  clientId: number;
  clientName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  remaining: number;
  price: number;
  validityDays: number;
  status: string;
  state: PurchaseState;
  tpvSaleId: number | null;
  purchasedAt: number | null;
  expiresAt: number | null;
  siteId: string | null;
}
function toPurchase(r: any, now = Date.now()): Purchase {
  const base = {
    id: num(r.id), packId: num(r.pack_id), packName: String(r.pack_name), clientId: num(r.client_id), clientName: String(r.client_name),
    sessionsTotal: num(r.sessions_total), sessionsUsed: num(r.sessions_used), price: Number(r.price), validityDays: num(r.validity_days),
    status: String(r.status), tpvSaleId: numOrNull(r.tpv_sale_id), purchasedAt: numOrNull(r.purchased_at), expiresAt: numOrNull(r.expires_at),
    treatmentIds: ids(r.treatment_ids), categoryIds: ids(r.category_ids), siteId: r.site_id ?? null,
  };
  return { ...base, remaining: remainingOf(base), state: purchaseState(base, now) };
}

async function purchaseById(exec: Exec, id: number, lock = false): Promise<Purchase | null> {
  const [r] = await rows(exec, lock ? sql`SELECT * FROM care_pack_purchases WHERE id = ${id} FOR UPDATE` : sql`SELECT * FROM care_pack_purchases WHERE id = ${id}`);
  return r ? toPurchase(r) : null;
}

export interface TpvPackSaleRequest {
  sessionId: number;
  idempotencyKey: string;
  clientId: number;
  customerName: string;
  customerEmail?: string;
  notes: string;
  items: Array<{ productType: "extra"; productId: number; productName: string; quantity: number; unitPrice: number; discountPercent: number; participants: number }>;
  payments: Array<{ method: "cash" | "card" | "bizum" | "other"; amount: number; amountTendered?: number }>;
}
export type CreatePackSale = (req: TpvPackSaleRequest) => Promise<{ saleId: number; replayed: boolean }>;

/**
 * Vende un bono a un cliente del CRM y lo cobra con el TPV del Core. `requestKey` (la genera el panel por intento)
 * hace que un doble clic no cree dos bonos; la clave del TPV es la de la compra, así que repetir el cobro devuelve la
 * misma venta. Si el TPV rechaza el cobro, el bono queda pendiente (se puede volver a cobrar o anular).
 */
export async function sellPack(
  input: { packId: number; clientId: number; sessionId: number; payments: TpvPackSaleRequest["payments"]; requestKey: string; notes?: string | null },
  userId: number,
  createSale: CreatePackSale,
): Promise<{ purchase: Purchase; saleId: number; replayed: boolean }> {
  const purchaseId = await inTx(async (tx) => {
    const [existing] = await rows(tx, sql`SELECT id, client_id, pack_id FROM care_pack_purchases WHERE request_key = ${input.requestKey}`);
    if (existing) {
      if (num(existing.client_id) !== input.clientId || num(existing.pack_id) !== input.packId) throw conflict("Esta venta ya se registró con otro cliente o bono. Recarga la pantalla.");
      return num(existing.id);
    }
    const [pk] = await rows(tx, sql`SELECT * FROM care_session_packs WHERE id = ${input.packId} AND is_active = 1`);
    if (!pk) throw notFound("El bono");
    const pack = toPack(pk);
    // Antes de registrar nada: los pagos deben cuadrar con el precio
    if (Math.round(input.payments.reduce((s, x) => s + x.amount, 0) * 100) !== Math.round(pack.price * 100)) {
      throw bad(`Los pagos no coinciden con el precio del bono (${pack.price.toFixed(2)} €).`);
    }
    const client = await clientById(tx, input.clientId);
    if (!client) throw notFound("El cliente");
    const now = Date.now();
    try {
      const r = await header(tx, sql`INSERT INTO care_pack_purchases (pack_id, pack_name, client_id, client_name, sessions_total, sessions_used, price, treatment_ids, category_ids, validity_days, status, sold_by, notes, request_key, created_at, updated_at)
        VALUES (${pack.id}, ${pack.name}, ${client.id}, ${client.name}, ${pack.sessions}, 0, ${pack.price.toFixed(2)}, ${JSON.stringify(pack.treatmentIds)}, ${JSON.stringify(pack.categoryIds)},
          ${pack.validityDays}, 'pending', ${userId}, ${input.notes?.trim().slice(0, 500) || null}, ${input.requestKey}, ${now}, ${now})`);
      return r.insertId;
    } catch (e) {
      if (isDuplicate(e, "uq_care_pack_purchases_request")) throw conflict("Esta venta ya se está registrando. Espera unos segundos.");
      throw e;
    }
  });
  return payPurchase(purchaseId, input.sessionId, input.payments, createSale);
}

/** Cobra (o vuelve a intentar cobrar) un bono pendiente. Uno ya cobrado devuelve su venta. */
export async function payPurchase(purchaseId: number, sessionId: number, payments: TpvPackSaleRequest["payments"], createSale: CreatePackSale): Promise<{ purchase: Purchase; saleId: number; replayed: boolean }> {
  const p = await run((d) => purchaseById(d, purchaseId));
  if (!p) throw notFound("El bono vendido");
  if (p.status === "active" && p.tpvSaleId != null) return { purchase: p, saleId: p.tpvSaleId, replayed: true };
  if (p.status === "cancelled") throw bad("Este bono está anulado.");
  const paid = Math.round(payments.reduce((s, x) => s + x.amount, 0) * 100);
  if (paid !== Math.round(p.price * 100)) throw bad(`Los pagos no coinciden con el precio del bono (${p.price.toFixed(2)} €).`);
  const client = await run((d) => clientById(d, p.clientId));
  const sale = await createSale({
    sessionId,
    idempotencyKey: packSaleKey(p.id),
    clientId: p.clientId,
    customerName: client?.name ?? p.clientName,
    customerEmail: client?.email || undefined,
    notes: `Bono ${p.id}: ${p.packName}`,
    items: [{ productType: "extra", productId: p.packId, productName: `Bono: ${p.packName} (${p.sessionsTotal} sesiones)`, quantity: 1, unitPrice: p.price, discountPercent: 0, participants: 1 }],
    payments,
  });
  await run(async (d) => {
    const [s] = await rows(d, sql`SELECT site_id FROM tpv_sales WHERE id = ${sale.saleId}`);
    const now = Date.now();
    await d.execute(sql`UPDATE care_pack_purchases SET status = 'active', tpv_sale_id = ${sale.saleId}, site_id = ${s?.site_id ?? null}, purchased_at = ${now},
      expires_at = ${expiresAtOf(now, p.validityDays)}, updated_at = ${now} WHERE id = ${p.id} AND status = 'pending'`);
  });
  const purchase = (await run((d) => purchaseById(d, p.id)))!;
  return { purchase, saleId: purchase.tpvSaleId ?? sale.saleId, replayed: sale.replayed };
}

/** Anula un bono pendiente de cobro (uno cobrado se devuelve desde el TPV, no aquí). */
export function cancelPendingPurchase(purchaseId: number): Promise<{ ok: true }> {
  return run(async (d) => {
    const r = await header(d, sql`UPDATE care_pack_purchases SET status = 'cancelled', updated_at = ${Date.now()} WHERE id = ${purchaseId} AND status = 'pending'`);
    if (!r.affectedRows) throw bad("Solo se puede anular un bono pendiente de cobro.");
    return { ok: true as const };
  });
}

export interface ClientWithPacks {
  clientId: number;
  clientName: string;
  email: string | null;
  purchases: Purchase[];
  remaining: number;
  nextExpiry: number | null;
}

/** Clientes con bonos (activos, caducados con sesiones sin usar, agotados…) y su saldo de sesiones. */
export function clientsWithPacks(filter: "active" | "expired" | "all", search?: string): Promise<ClientWithPacks[]> {
  return run(async (d) => {
    const term = search?.trim() ? `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const list = (await rows(d, sql`SELECT p.*, c.email AS client_email FROM care_pack_purchases p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.status IN ('active', 'pending')${term ? sql` AND (p.client_name LIKE ${term} OR c.email LIKE ${term})` : sql``}
      ORDER BY p.client_name, p.expires_at`)).map((r: any) => ({ p: toPurchase(r), email: r.client_email ?? null }));
    const by = new Map<number, ClientWithPacks>();
    for (const { p, email } of list) {
      const keep = filter === "all" || (filter === "active" ? p.state === "active" || p.state === "pending" : p.state === "expired" && p.remaining > 0);
      if (!keep) continue;
      const c: ClientWithPacks = by.get(p.clientId) ?? { clientId: p.clientId, clientName: p.clientName, email, purchases: [], remaining: 0, nextExpiry: null };
      c.purchases.push(p);
      if (p.state === "active") {
        c.remaining += p.remaining;
        if (p.expiresAt != null && (c.nextExpiry == null || p.expiresAt < c.nextExpiry)) c.nextExpiry = p.expiresAt;
      }
      by.set(p.clientId, c);
    }
    return Array.from(by.values());
  });
}

export interface Consumption {
  id: number;
  purchaseId: number;
  packName: string;
  reservationId: number | null;
  treatmentName: string | null;
  date: string | null;
  time: string | null;
  source: string;
  status: string;
  consumedAt: number;
  revertedAt: number | null;
  revertReason: string | null;
}

/** Bonos de un cliente con su historial de consumos. */
export function clientPacks(clientId: number): Promise<{ client: { id: number; name: string; email: string } | null; purchases: Purchase[]; consumptions: Consumption[] }> {
  return run(async (d) => {
    const client = await clientById(d, clientId);
    const purchases = (await rows(d, sql`SELECT * FROM care_pack_purchases WHERE client_id = ${clientId} ORDER BY created_at DESC`)).map((r) => toPurchase(r));
    const consumptions = (await rows(d, sql`SELECT k.*, p.pack_name, t.name AS treatment_name, s.date AS slot_date, s.startTime AS slot_time
      FROM care_pack_consumptions k JOIN care_pack_purchases p ON p.id = k.purchase_id
      LEFT JOIN spa_treatments t ON t.id = k.treatment_id LEFT JOIN spa_slots s ON s.id = k.slot_id
      WHERE k.client_id = ${clientId} ORDER BY k.consumed_at DESC LIMIT 200`)).map((r: any) => ({
      id: num(r.id), purchaseId: num(r.purchase_id), packName: String(r.pack_name), reservationId: numOrNull(r.reservation_id), treatmentName: r.treatment_name ?? null,
      date: r.slot_date ?? null, time: r.slot_time ?? null, source: String(r.source), status: String(r.status), consumedAt: num(r.consumed_at),
      revertedAt: numOrNull(r.reverted_at), revertReason: r.revert_reason ?? null,
    }));
    return { client: client ? { id: client.id, name: client.name, email: client.email } : null, purchases, consumptions };
  });
}

// ─── Reservas de SPA y consumo de sesiones ───────────────────────────────────

interface SpaReservationRow {
  id: number;
  clientId: number | null;
  customerEmail: string | null;
  status: string;
  holdStatus: string | null;
  slotId: number;
  treatmentId: number;
  categoryId: number | null;
}

async function spaReservation(exec: Exec, reservationId: number, lock = false): Promise<SpaReservationRow | null> {
  const [r] = await rows(exec, sql`SELECT r.id, r.client_id, r.customer_email, r.status, r.hold_status, r.inventory_ref_id, s.treatmentId, t.categoryId
    FROM reservations r JOIN spa_slots s ON s.id = r.inventory_ref_id LEFT JOIN spa_treatments t ON t.id = s.treatmentId
    WHERE r.id = ${reservationId} AND r.inventory_kind = 'spa_slot'${lock ? sql` FOR UPDATE` : sql``}`);
  return r ? { id: num(r.id), clientId: numOrNull(r.client_id), customerEmail: r.customer_email ?? null, status: String(r.status), holdStatus: r.hold_status ?? null, slotId: num(r.inventory_ref_id), treatmentId: num(r.treatmentId), categoryId: numOrNull(r.categoryId) } : null;
}

/**
 * Consume una sesión de un bono para una reserva de SPA (la elegida o, si no se indica, la del cliente que caduca
 * antes y vale para el tratamiento). La reserva queda pagada con bono y su plaza confirmada.
 */
export async function consumeForReservation(input: { reservationId: number; purchaseId?: number | null; clientId?: number | null }, userId: number, source: "reservation" | "counter" = "reservation"): Promise<{ consumptionId: number; purchase: Purchase }> {
  const out = await inTx(async (tx) => {
    const r = await spaReservation(tx, input.reservationId, true);
    if (!r) throw notFound("La reserva de SPA");
    if (r.status === "cancelled" || r.status === "failed" || r.holdStatus === "liberada") throw bad("La reserva está anulada o su plaza se liberó.");
    if (r.status === "paid" && source === "reservation") throw bad("La reserva ya está pagada: no se descuenta ninguna sesión.");
    // Cliente: el de la reserva, el indicado o el del CRM con su correo
    let clientId = r.clientId ?? input.clientId ?? null;
    if (clientId == null && r.customerEmail) {
      const [c] = await rows(tx, sql`SELECT id FROM clients WHERE email = ${r.customerEmail} LIMIT 1`);
      clientId = c ? num(c.id) : null;
    }
    if (clientId == null) throw bad("La reserva no está vinculada a un cliente del CRM con bono.");
    if (input.clientId != null && input.clientId !== clientId) throw bad("El bono es de otro cliente.");
    const treatment = { id: r.treatmentId, categoryId: r.categoryId };
    const now = Date.now();
    let purchase: Purchase | null;
    if (input.purchaseId != null) {
      purchase = await purchaseById(tx, input.purchaseId, true);
      if (!purchase || purchase.clientId !== clientId) throw notFound("El bono del cliente");
    } else {
      const list = (await rows(tx, sql`SELECT * FROM care_pack_purchases WHERE client_id = ${clientId} AND status = 'active' FOR UPDATE`)).map((x) => toPurchase(x, now));
      purchase = pickPurchase(list, treatment, now);
      if (!purchase) throw bad("El cliente no tiene ningún bono con sesiones válido para este tratamiento.");
    }
    const problem = consumeProblem(purchase, treatment, now);
    if (problem) throw bad(problem);
    // Contador condicional: nunca más sesiones de las compradas aunque dos consumos lleguen a la vez
    const up = await header(tx, sql`UPDATE care_pack_purchases SET sessions_used = sessions_used + 1, updated_at = ${now}
      WHERE id = ${purchase.id} AND status = 'active' AND sessions_used < sessions_total AND (expires_at IS NULL OR expires_at > ${now})`);
    if (!up.affectedRows) throw conflict("El bono acaba de quedarse sin sesiones. Revisa su saldo.");
    let consumptionId: number;
    try {
      consumptionId = (await header(tx, sql`INSERT INTO care_pack_consumptions (site_id, purchase_id, client_id, reservation_id, treatment_id, slot_id, source, status, consumed_by, consumed_at)
        VALUES (${purchase.siteId}, ${purchase.id}, ${clientId}, ${r.id}, ${r.treatmentId}, ${r.slotId}, ${source}, 'consumed', ${userId}, ${now})`)).insertId;
    } catch (e) {
      if (isDuplicate(e, "uq_care_pack_consumptions_reservation")) throw conflict("Esta reserva ya se pagó con una sesión de bono.");
      throw e;
    }
    await tx.execute(sql`UPDATE reservations SET status = 'paid', status_payment = 'PAGADO', status_reservation = 'CONFIRMADA', paymentMethod = 'otro', paid_at = ${now},
      client_id = ${clientId}, notes = CONCAT(COALESCE(notes, ''), ${` [Pagada con bono ${purchase.id}: ${purchase.packName}]`}), updated_at = ${now} WHERE id = ${r.id}`);
    return { consumptionId, purchaseId: purchase.id };
  });
  // La plaza retenida pasa a confirmada (idempotente; fuera de la transacción: tiene la suya)
  await confirmInventoryHold(input.reservationId);
  return { consumptionId: out.consumptionId, purchase: (await run((d) => purchaseById(d, out.purchaseId)))! };
}

/**
 * Cita en mostrador con bono: retiene la plaza de la franja, crea la reserva del cliente y consume la sesión. Si el
 * bono no vale, la plaza se libera y la reserva queda anulada (no queda nada a medias ocupando sitio).
 */
export async function counterAppointment(input: { clientId: number; slotId: number; persons?: number; purchaseId?: number | null; notes?: string | null }, userId: number): Promise<{ reservationId: number; consumptionId: number; purchase: Purchase }> {
  const pre = await run(async (d) => {
    const client = await clientById(d, input.clientId);
    if (!client) throw notFound("El cliente");
    const [s] = await rows(d, sql`SELECT s.id, s.treatmentId, s.date, s.startTime, s.status, t.name FROM spa_slots s JOIN spa_treatments t ON t.id = s.treatmentId WHERE s.id = ${input.slotId}`);
    if (!s) throw notFound("El horario");
    if (s.status === "bloqueado") throw bad("Este horario está bloqueado.");
    return { client, slot: { id: num(s.id), treatmentId: num(s.treatmentId), date: String(s.date), time: String(s.startTime), name: String(s.name) } };
  });
  const persons = Math.max(1, Math.min(20, input.persons ?? 1));
  const held = await holdSpaSlotAndCreateReservation(
    { slotId: pre.slot.id, treatmentId: pre.slot.treatmentId, date: pre.slot.date, units: persons },
    {
      productId: pre.slot.treatmentId,
      productName: `SPA: ${pre.slot.name} · ${pre.slot.time}`,
      bookingDate: pre.slot.date,
      people: persons,
      amountTotal: 0,
      customerName: pre.client.name,
      customerEmail: pre.client.email,
      customerPhone: pre.client.phone ?? undefined,
      notes: input.notes?.trim() || "Cita en mostrador con bono",
      merchantOrder: generateMerchantOrder(),
    },
  );
  if (!held.ok) throw bad(held.available > 0 ? `Solo quedan ${held.available} plazas en este horario.` : "Este horario está completo.");
  const reservationId = held.reservation.id;
  await run((d) => d.execute(sql`UPDATE reservations SET client_id = ${pre.client.id}, channel = 'TPV_FISICO' WHERE id = ${reservationId}`));
  try {
    const c = await consumeForReservation({ reservationId, purchaseId: input.purchaseId ?? null, clientId: pre.client.id }, userId, "counter");
    return { reservationId, consumptionId: c.consumptionId, purchase: c.purchase };
  } catch (e) {
    await releaseInventoryHold(reservationId, "cancelada").catch(() => undefined);
    await run((d) => d.execute(sql`UPDATE reservations SET status = 'cancelled', status_reservation = 'ANULADA', updated_at = ${Date.now()} WHERE id = ${reservationId}`)).catch(() => undefined);
    throw e;
  }
}

/**
 * Anula un consumo: la sesión vuelve al bono (aunque haya caducado después, queda devuelta). `cancelReservation`:
 * además anula la reserva y libera su plaza.
 */
export async function revertConsumption(consumptionId: number, reason: string, cancelReservation: boolean, userId: number): Promise<{ purchase: Purchase }> {
  const why = reason.trim();
  if (why.length < 3) throw bad("Indica el motivo de la anulación.");
  const out = await inTx(async (tx) => {
    const [k] = await rows(tx, sql`SELECT * FROM care_pack_consumptions WHERE id = ${consumptionId} FOR UPDATE`);
    if (!k) throw notFound("El consumo");
    if (String(k.status) !== "consumed") throw bad("Este consumo ya está anulado.");
    const now = Date.now();
    await purchaseById(tx, num(k.purchase_id), true);
    await tx.execute(sql`UPDATE care_pack_consumptions SET status = 'reverted', reverted_by = ${userId}, reverted_at = ${now}, revert_reason = ${why.slice(0, 255)} WHERE id = ${consumptionId}`);
    await tx.execute(sql`UPDATE care_pack_purchases SET sessions_used = GREATEST(sessions_used - 1, 0), updated_at = ${now} WHERE id = ${num(k.purchase_id)}`);
    const reservationId = numOrNull(k.reservation_id);
    if (reservationId != null) {
      if (cancelReservation) {
        await tx.execute(sql`UPDATE reservations SET status = 'cancelled', status_reservation = 'ANULADA', notes = CONCAT(COALESCE(notes, ''), ${` [Bono devuelto y reserva anulada: ${why.slice(0, 200)}]`}), updated_at = ${now} WHERE id = ${reservationId}`);
      } else {
        // La reserva sigue, pero ya no está pagada con el bono
        await tx.execute(sql`UPDATE reservations SET status = 'pending_payment', status_payment = 'PENDIENTE', paid_at = NULL, notes = CONCAT(COALESCE(notes, ''), ${` [Sesión de bono devuelta: ${why.slice(0, 200)}]`}), updated_at = ${now} WHERE id = ${reservationId}`);
      }
    }
    return { purchaseId: num(k.purchase_id), reservationId };
  });
  if (cancelReservation && out.reservationId != null) await releaseInventoryHold(out.reservationId, "cancelada");
  return { purchase: (await run((d) => purchaseById(d, out.purchaseId)))! };
}

export interface SpaReservation {
  id: number;
  reservationNumber: string | null;
  date: string;
  startTime: string;
  endTime: string;
  slotId: number;
  treatmentId: number;
  treatmentName: string | null;
  people: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  clientId: number | null;
  amountTotal: number;
  status: string;
  holdStatus: string | null;
  state: SpaBookingState;
  channel: string | null;
  consumption: { id: number; purchaseId: number; packName: string } | null;
}

/** Reservas de SPA del Core entre dos fechas (por la fecha de su franja), con su sesión de bono si la pagó así. */
export function spaReservations(from: string, to: string): Promise<SpaReservation[]> {
  return run(async (d) => {
    if (daysBetween(from, to).length === 0) throw bad("Rango de fechas no válido.");
    const list = await rows(d, sql`SELECT r.id, r.reservation_number, r.people, r.customer_name, r.customer_email, r.customer_phone, r.client_id, r.amount_total, r.status,
        r.status_reservation, r.hold_status, r.channel, s.id AS slot_id, s.date, s.startTime, s.endTime, s.treatmentId, t.name AS treatment_name,
        k.id AS k_id, k.purchase_id AS k_purchase, p.pack_name AS k_pack
      FROM reservations r JOIN spa_slots s ON s.id = r.inventory_ref_id LEFT JOIN spa_treatments t ON t.id = s.treatmentId
      LEFT JOIN care_pack_consumptions k ON k.reservation_id = r.id AND k.status = 'consumed' LEFT JOIN care_pack_purchases p ON p.id = k.purchase_id
      WHERE r.inventory_kind = 'spa_slot' AND s.date BETWEEN ${from} AND ${to}
      ORDER BY s.date, s.startTime, r.id`);
    return list.map((r: any) => ({
      id: num(r.id), reservationNumber: r.reservation_number ?? null, date: String(r.date), startTime: String(r.startTime), endTime: String(r.endTime), slotId: num(r.slot_id),
      treatmentId: num(r.treatmentId), treatmentName: r.treatment_name ?? null, people: num(r.people), customerName: String(r.customer_name), customerEmail: r.customer_email ?? null,
      customerPhone: r.customer_phone ?? null, clientId: numOrNull(r.client_id), amountTotal: num(r.amount_total) / 100, status: String(r.status), holdStatus: r.hold_status ?? null,
      state: spaBookingState({ status: String(r.status), holdStatus: r.hold_status ?? null, statusReservation: r.status_reservation ?? null }), channel: r.channel ?? null,
      consumption: r.k_id != null ? { id: num(r.k_id), purchaseId: num(r.k_purchase), packName: String(r.k_pack) } : null,
    }));
  });
}

/** Franjas de SPA de un día con sus plazas libres (para la cita en mostrador). */
export function spaSlotsOfDay(date: string): Promise<Array<{ id: number; treatmentId: number; treatmentName: string; startTime: string; endTime: string; free: number }>> {
  return run(async (d) => (await rows(d, sql`SELECT s.id, s.treatmentId, t.name, s.startTime, s.endTime, s.capacity, s.bookedCount, s.status
      FROM spa_slots s JOIN spa_treatments t ON t.id = s.treatmentId WHERE s.date = ${date} AND s.status <> 'bloqueado' ORDER BY s.startTime, t.name`))
    .map((r: any) => ({ id: num(r.id), treatmentId: num(r.treatmentId), treatmentName: String(r.name), startTime: String(r.startTime), endTime: String(r.endTime), free: Math.max(0, num(r.capacity) - num(r.bookedCount)) })));
}

/** Tratamientos y categorías del SPA (para el ámbito de un bono y la cita en mostrador). */
export function spaCatalog(): Promise<{ treatments: Array<{ id: number; name: string; categoryId: number | null; isActive: boolean }>; categories: Array<{ id: number; name: string }> }> {
  return run(async (d) => ({
    treatments: (await rows(d, sql`SELECT id, name, categoryId, isActive FROM spa_treatments ORDER BY name`)).map((r: any) => ({ id: num(r.id), name: String(r.name), categoryId: numOrNull(r.categoryId), isActive: Number(r.isActive) === 1 })),
    categories: (await rows(d, sql`SELECT id, name FROM spa_categories ORDER BY sortOrder, name`)).map((r: any) => ({ id: num(r.id), name: String(r.name) })),
  }));
}
