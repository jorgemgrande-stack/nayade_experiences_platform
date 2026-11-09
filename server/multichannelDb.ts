/**
 * Venta multicanal (capacidad `multichannel`) — acceso a datos. Lógica pura en shared/multichannel.ts; procedimientos
 * en server/routers/multichannel.ts; enlace de entrada de cada canal en server/multichannel/publicRoutes.ts; pantalla
 * en /admin/multicanal.
 *
 *  - Todo vive en la BD de la empresa en curso (`getDb()` resuelve la de la petición o la del dominio).
 *  - Una venta de canal crea la reserva del Core YA PAGADA (el canal cobró al cliente), con canal `API`, el nombre del
 *    canal en `channel_detail`/`platform_name` y origen `multicanal`. En spa y hotel la plaza se retiene con la misma
 *    regla atómica que la venta web (server/inventoryHoldsDb.ts, retención confirmada); en experiencias con franja de
 *    capacidad se comprueba la capacidad de la franja con su fila bloqueada.
 *  - No hay sobreventa del cupo: el consumo del cupo de cada día es una actualización bajo bloqueo de fila en la misma
 *    transacción que la reserva; si un día no tiene cupo o el Core no tiene plaza, no se crea nada y la venta queda
 *    «sin cupo» o «sin plaza» para gestionarla (se puede reintentar con la misma referencia).
 *  - Idempotente por (canal, referencia del canal): repetir la venta no crea otra reserva; la cancelación devuelve el
 *    cupo y libera la plaza una sola vez.
 *  - Nada se borra: los canales y publicaciones se desactivan; las ventas cambian de estado.
 *
 * Las tablas (db/migrations/0059_extra_multicanal) no están en `drizzle/schema.ts` a propósito, como las de GEO
 * Control. Sin la migración, cada operación responde que la Venta multicanal aún no está preparada.
 */
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb, createReservation, generateReservationNumber, postConfirmOperation } from "./db";
import { isDeadlock } from "./creditNoteNumber";
import { isMultiTenant, getTenantIdOrDefault } from "./_core/tenant";
import { holdConfirmedForChannelSale, hotelRoomFree, releaseInventoryHold, spaSlotFree } from "./inventoryHoldsDb";
import {
  MC_CAPABILITY,
  MC_CHANNEL_KINDS,
  MC_LIMITS,
  MC_PROVIDERS,
  MC_RETRYABLE,
  MC_TARGET_KINDS,
  MC_TOKEN_RE,
  MC_CODE_RE,
  addDays,
  channelProblem,
  commissionOf,
  daysConsumed,
  daysInclusive,
  isDay,
  parseCsvMapping,
  parseSalesCsv,
  salesCsv,
  sellable,
  todayMadrid,
  totalsByChannel,
  type McChannelKind,
  type McCsvField,
  type McProvider,
  type McSaleInput,
  type McSaleSource,
  type McSaleStatus,
  type McTargetKind,
} from "../shared/multichannel";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute" | "insert">;

export { MC_CAPABILITY };
export const MC_NOT_INSTALLED_MESSAGE =
  "La Venta multicanal aún no está preparada en tu empresa: falta aplicar la actualización 0059_extra_multicanal de su base de datos. Inténtalo de nuevo en unos minutos.";

export class McNotInstalled extends Error {
  constructor() {
    super(MC_NOT_INSTALLED_MESSAGE);
    this.name = "McNotInstalled";
  }
}

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const forbidden = (message: string) => new TRPCError({ code: "FORBIDDEN", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const oneLine = (v: string | null | undefined, max: number) => (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function errCode(e: unknown): string | undefined {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  return undefined;
}

/** Falta la migración 0059 (o una de sus tablas) en esta empresa. */
export function isMissingMcSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /mc_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

async function database(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return d;
}

/** Panel: solo multiempresa; sin la migración, mensaje claro; nombres repetidos, conflicto. */
async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  if (!isMultiTenant()) throw forbidden("La Venta multicanal no está disponible en esta instalación.");
  const d = await database();
  try {
    return await fn(d);
  } catch (e) {
    if (e instanceof McNotInstalled || isMissingMcSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: MC_NOT_INSTALLED_MESSAGE, cause: e });
    if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe un canal o una publicación con ese mismo nombre o código.", cause: e });
    throw e;
  }
}

async function rows<T = any>(exec: Pick<Db, "execute">, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Pick<Db, "execute">, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}
const idList = (ids: readonly (number | string)[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** Transacción READ COMMITTED con reintento ante interbloqueo (mismo criterio que las retenciones de plazas). */
async function inTx<T>(d: Db, fn: (tx: Exec) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await d.transaction((tx) => fn(tx as unknown as Exec), { isolationLevel: "read committed" });
    } catch (err) {
      if (attempt >= 5 || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * attempt));
    }
  }
}

export interface McActor {
  userId: number;
  role: string;
}
function writer(actor: McActor) {
  if (actor.role === "readonly") throw forbidden("Tu acceso es de solo lectura.");
}

// ─── Enlace de entrada (token por canal) ─────────────────────────────────────

/** Huella del token ligada a la empresa (es lo único que se guarda y se busca). */
export function inboundTokenHash(token: string, tenantId: string): string {
  return crypto.createHash("sha256").update(`mc-inbound:${tenantId}:${token}`).digest("hex");
}
export const newInboundToken = () => crypto.randomBytes(32).toString("base64url");

// ─── Canales ─────────────────────────────────────────────────────────────────

export interface McChannel {
  id: number;
  name: string;
  kind: McChannelKind;
  provider: McProvider;
  commissionPct: number;
  commissionFixedCents: number;
  settlementDays: number | null;
  isActive: boolean;
  inboundEnabled: boolean;
  inboundTokenHint: string | null;
  csvMapping: Partial<Record<McCsvField, string>>;
  notes: string | null;
  listings: number;
  createdAt: string | null;
}

function mapChannel(r: any): McChannel {
  return {
    id: num(r.id),
    name: String(r.name),
    kind: (MC_CHANNEL_KINDS as readonly string[]).includes(r.kind) ? r.kind : "otro",
    provider: (MC_PROVIDERS as readonly string[]).includes(r.provider) ? r.provider : "generic",
    commissionPct: Number(r.commission_pct ?? 0),
    commissionFixedCents: num(r.commission_fixed_cents),
    settlementDays: r.settlement_days == null ? null : num(r.settlement_days),
    isActive: bool(r.is_active),
    inboundEnabled: r.inbound_token_hash != null,
    inboundTokenHint: str(r.inbound_token_hint),
    csvMapping: parseCsvMapping(r.csv_mapping),
    notes: str(r.notes),
    listings: num(r.listings),
    createdAt: iso(r.created_at),
  };
}

async function channelById(exec: Pick<Db, "execute">, id: number): Promise<McChannel | null> {
  const [r] = await rows(exec, sql`SELECT c.*, (SELECT COUNT(*) FROM mc_listings l WHERE l.channel_id = c.id AND l.is_active = 1) AS listings FROM mc_channels c WHERE c.id = ${id}`);
  return r ? mapChannel(r) : null;
}

export const listChannels = () =>
  run(async (d) => (await rows(d, sql`SELECT c.*, (SELECT COUNT(*) FROM mc_listings l WHERE l.channel_id = c.id AND l.is_active = 1) AS listings FROM mc_channels c ORDER BY c.is_active DESC, c.name`)).map(mapChannel));

export interface McChannelInput {
  id?: number;
  name: string;
  kind: McChannelKind;
  provider: McProvider;
  commissionPct: number;
  commissionFixedCents: number;
  settlementDays?: number | null;
  csvMapping?: Partial<Record<McCsvField, string>>;
  notes?: string | null;
}

export async function upsertChannel(input: McChannelInput, actor: McActor): Promise<McChannel> {
  writer(actor);
  const name = oneLine(input.name, 120);
  const problem = channelProblem({ name, commissionPct: input.commissionPct, commissionFixedCents: input.commissionFixedCents });
  if (problem) throw bad(problem);
  const mapping = JSON.stringify(parseCsvMapping(JSON.stringify(input.csvMapping ?? {})));
  const notes = oneLine(input.notes, 1000) || null;
  const pct = Math.round(input.commissionPct * 100) / 100;
  return run(async (d) => {
    let id = input.id ?? 0;
    if (id) {
      const r = await header(d, sql`
        UPDATE mc_channels SET name = ${name}, kind = ${input.kind}, provider = ${input.provider}, commission_pct = ${pct},
          commission_fixed_cents = ${input.commissionFixedCents}, settlement_days = ${input.settlementDays ?? null},
          csv_mapping = ${mapping === "{}" ? null : mapping}, notes = ${notes}
        WHERE id = ${id}`);
      if (r.affectedRows === 0 && !(await channelById(d, id))) throw notFound("El canal");
    } else {
      id = (await header(d, sql`
        INSERT INTO mc_channels (name, kind, provider, commission_pct, commission_fixed_cents, settlement_days, csv_mapping, notes, created_by)
        VALUES (${name}, ${input.kind}, ${input.provider}, ${pct}, ${input.commissionFixedCents}, ${input.settlementDays ?? null},
          ${mapping === "{}" ? null : mapping}, ${notes}, ${actor.userId})`)).insertId;
    }
    return (await channelById(d, id))!;
  });
}

export async function setChannelActive(id: number, active: boolean, actor: McActor): Promise<McChannel> {
  writer(actor);
  return run(async (d) => {
    await d.execute(sql`UPDATE mc_channels SET is_active = ${active ? 1 : 0} WHERE id = ${id}`);
    const c = await channelById(d, id);
    if (!c) throw notFound("El canal");
    return c;
  });
}

/** Genera (o cambia) el enlace de entrada del canal. El token solo se muestra ahora: se guarda su huella. */
export async function rotateInboundToken(id: number, actor: McActor): Promise<{ token: string; path: string; availabilityPath: string }> {
  writer(actor);
  return run(async (d) => {
    if (!(await channelById(d, id))) throw notFound("El canal");
    const token = newInboundToken();
    await d.execute(sql`UPDATE mc_channels SET inbound_token_hash = ${inboundTokenHash(token, getTenantIdOrDefault())}, inbound_token_hint = ${token.slice(-4)} WHERE id = ${id}`);
    return { token, path: `/canal/${token}/ventas`, availabilityPath: `/canal/${token}/disponibilidad` };
  });
}

export async function revokeInboundToken(id: number, actor: McActor): Promise<McChannel> {
  writer(actor);
  return run(async (d) => {
    await d.execute(sql`UPDATE mc_channels SET inbound_token_hash = NULL, inbound_token_hint = NULL WHERE id = ${id}`);
    const c = await channelById(d, id);
    if (!c) throw notFound("El canal");
    return c;
  });
}

// ─── Productos del Core que se pueden publicar ───────────────────────────────

export interface McTargetOption {
  kind: McTargetKind;
  id: number;
  name: string;
  priceCents: number | null;
  slots: Array<{ id: number; label: string; startTime: string | null; capacity: number | null }>;
}

async function optionalRows(exec: Pick<Db, "execute">, q: SQL): Promise<any[]> {
  try {
    return await rows(exec, q);
  } catch (e) {
    // Un módulo sin sus tablas (p. ej. sin spa) no impide publicar los demás
    if (errCode(e) === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

export const listTargets = () =>
  run(async (d) => {
    const out: McTargetOption[] = [];
    const exps = await optionalRows(d, sql`SELECT id, title, basePrice FROM experiences WHERE isActive = 1 ORDER BY title LIMIT 500`);
    const slots = exps.length
      ? await optionalRows(d, sql`SELECT id, product_id, label, start_time, capacity FROM product_time_slots WHERE active = 1 AND product_id IN (${idList(exps.map((e) => num(e.id)))}) ORDER BY sort_order, id`)
      : [];
    for (const e of exps) {
      out.push({
        kind: "experience",
        id: num(e.id),
        name: String(e.title),
        priceCents: e.basePrice == null ? null : Math.round(Number(e.basePrice) * 100),
        slots: slots.filter((s) => num(s.product_id) === num(e.id)).map((s) => ({ id: num(s.id), label: String(s.label ?? ""), startTime: str(s.start_time), capacity: s.capacity == null ? null : num(s.capacity) })),
      });
    }
    for (const t of await optionalRows(d, sql`SELECT id, name, price FROM spa_treatments WHERE isActive = 1 ORDER BY name LIMIT 500`)) {
      out.push({ kind: "spa", id: num(t.id), name: String(t.name), priceCents: Math.round(Number(t.price ?? 0) * 100), slots: [] });
    }
    for (const r of await optionalRows(d, sql`SELECT id, name, basePrice FROM room_types WHERE isActive = 1 ORDER BY name LIMIT 500`)) {
      out.push({ kind: "hotel", id: num(r.id), name: String(r.name), priceCents: Math.round(Number(r.basePrice ?? 0) * 100), slots: [] });
    }
    return out;
  });

async function targetName(exec: Pick<Db, "execute">, kind: McTargetKind, id: number): Promise<string | null> {
  const q =
    kind === "experience" ? sql`SELECT title AS n FROM experiences WHERE id = ${id}`
    : kind === "spa" ? sql`SELECT name AS n FROM spa_treatments WHERE id = ${id}`
    : sql`SELECT name AS n FROM room_types WHERE id = ${id}`;
  const [r] = await optionalRows(exec, q);
  return r ? String(r.n) : null;
}

// ─── Publicaciones ───────────────────────────────────────────────────────────

export interface McListing {
  id: number;
  channelId: number;
  externalCode: string;
  label: string | null;
  targetKind: McTargetKind;
  targetId: number;
  targetName: string | null;
  timeSlotId: number | null;
  unitPriceCents: number | null;
  isActive: boolean;
}

function mapListing(r: any, name: string | null): McListing {
  return {
    id: num(r.id),
    channelId: num(r.channel_id),
    externalCode: String(r.external_code),
    label: str(r.label),
    targetKind: r.target_kind as McTargetKind,
    targetId: num(r.target_id),
    targetName: name,
    timeSlotId: r.time_slot_id == null ? null : num(r.time_slot_id),
    unitPriceCents: r.unit_price_cents == null ? null : num(r.unit_price_cents),
    isActive: bool(r.is_active),
  };
}

export const listListings = (channelId?: number) =>
  run(async (d) => {
    const list = await rows(d, sql`SELECT * FROM mc_listings ${channelId ? sql`WHERE channel_id = ${channelId}` : sql``} ORDER BY is_active DESC, external_code LIMIT 1000`);
    const out: McListing[] = [];
    for (const r of list) out.push(mapListing(r, await targetName(d, r.target_kind, num(r.target_id))));
    return out;
  });

export interface McListingInput {
  id?: number;
  channelId: number;
  externalCode: string;
  label?: string | null;
  targetKind: McTargetKind;
  targetId: number;
  timeSlotId?: number | null;
  unitPriceCents?: number | null;
}

export async function upsertListing(input: McListingInput, actor: McActor): Promise<McListing> {
  writer(actor);
  const code = oneLine(input.externalCode, 80);
  if (!MC_CODE_RE.test(code)) throw bad("Escribe el código con el que el canal identifica el producto.");
  if (!(MC_TARGET_KINDS as readonly string[]).includes(input.targetKind)) throw bad("Elige el tipo de producto.");
  if (input.unitPriceCents != null && !(Number.isInteger(input.unitPriceCents) && input.unitPriceCents >= 0 && input.unitPriceCents <= MC_LIMITS.maxCents)) throw bad("El precio no es válido.");
  return run(async (d) => {
    if (!(await channelById(d, input.channelId))) throw notFound("El canal");
    const name = await targetName(d, input.targetKind, input.targetId);
    if (!name) throw bad("El producto elegido no existe en tu catálogo.");
    let slot: number | null = null;
    if (input.targetKind === "experience" && input.timeSlotId) {
      const [s] = await rows(d, sql`SELECT id FROM product_time_slots WHERE id = ${input.timeSlotId} AND product_id = ${input.targetId}`);
      if (!s) throw bad("La franja no pertenece a esa experiencia.");
      slot = input.timeSlotId;
    }
    const label = oneLine(input.label, 200) || null;
    let id = input.id ?? 0;
    if (id) {
      const [cur] = await rows(d, sql`SELECT channel_id FROM mc_listings WHERE id = ${id}`);
      if (!cur || num(cur.channel_id) !== input.channelId) throw notFound("La publicación");
      await d.execute(sql`
        UPDATE mc_listings SET external_code = ${code}, label = ${label}, target_kind = ${input.targetKind}, target_id = ${input.targetId},
          time_slot_id = ${slot}, unit_price_cents = ${input.unitPriceCents ?? null}
        WHERE id = ${id}`);
    } else {
      id = (await header(d, sql`
        INSERT INTO mc_listings (channel_id, external_code, label, target_kind, target_id, time_slot_id, unit_price_cents, created_by)
        VALUES (${input.channelId}, ${code}, ${label}, ${input.targetKind}, ${input.targetId}, ${slot}, ${input.unitPriceCents ?? null}, ${actor.userId})`)).insertId;
    }
    const [r] = await rows(d, sql`SELECT * FROM mc_listings WHERE id = ${id}`);
    return mapListing(r, name);
  });
}

export async function setListingActive(id: number, active: boolean, actor: McActor): Promise<{ ok: true }> {
  writer(actor);
  return run(async (d) => {
    const r = await header(d, sql`UPDATE mc_listings SET is_active = ${active ? 1 : 0} WHERE id = ${id}`);
    if (r.affectedRows === 0 && !(await rows(d, sql`SELECT id FROM mc_listings WHERE id = ${id}`)).length) throw notFound("La publicación");
    return { ok: true as const };
  });
}

// ─── Cupo por canal y día ────────────────────────────────────────────────────

/** Plazas libres en el Core para una publicación y un día (null: el Core no limita ese producto). */
async function coreFree(exec: Pick<Db, "execute">, l: { target_kind: string; target_id: unknown; time_slot_id: unknown }, day: string, now = Date.now()): Promise<number | null> {
  const id = num(l.target_id);
  if (l.target_kind === "hotel") return hotelRoomFree(exec, id, day, addDays(day, 1), now);
  if (l.target_kind === "spa") {
    const slots = await optionalRows(exec, sql`SELECT id FROM spa_slots WHERE treatmentId = ${id} AND date = ${day} AND status <> 'bloqueado'`);
    let free = 0;
    for (const s of slots) free += await spaSlotFree(exec, num(s.id), now);
    return free;
  }
  if (l.time_slot_id == null) return null;
  const [s] = await rows(exec, sql`SELECT capacity FROM product_time_slots WHERE id = ${num(l.time_slot_id)}`);
  if (!s || s.capacity == null || num(s.capacity) <= 0) return null;
  return Math.max(0, num(s.capacity) - (await experienceBooked(exec, id, num(l.time_slot_id), day)));
}

/** Personas de reservas vivas de una experiencia, franja y día (misma regla que la disponibilidad del Core). */
async function experienceBooked(exec: Pick<Db, "execute">, productId: number, slotId: number, day: string): Promise<number> {
  const [b] = await rows(exec, sql`
    SELECT COALESCE(SUM(people), 0) AS people FROM reservations
    WHERE product_id = ${productId} AND booking_date = ${day} AND selected_time_slot_id = ${slotId}
      AND status IN ('paid', 'pending_payment') AND (status_reservation IS NULL OR status_reservation <> 'ANULADA')`);
  return num(b?.people);
}

export interface McAllocation {
  id: number;
  listingId: number;
  channelId: number;
  day: string;
  quota: number;
  sold: number;
  coreFree: number | null;
  sellable: number;
}

export async function listAllocations(f: { channelId?: number; listingId?: number; from?: string; to?: string }): Promise<McAllocation[]> {
  const from = f.from && isDay(f.from) ? f.from : todayMadrid();
  const to = f.to && isDay(f.to) ? f.to : addDays(from, 30);
  return run(async (d) => {
    const list = await rows(d, sql`
      SELECT a.*, l.target_kind, l.target_id, l.time_slot_id FROM mc_allocations a JOIN mc_listings l ON l.id = a.listing_id
      WHERE a.day >= ${from} AND a.day <= ${to}
        ${f.channelId ? sql`AND a.channel_id = ${f.channelId}` : sql``}
        ${f.listingId ? sql`AND a.listing_id = ${f.listingId}` : sql``}
      ORDER BY a.day, a.listing_id LIMIT 800`);
    const out: McAllocation[] = [];
    for (const a of list) {
      const free = await coreFree(d, a, String(a.day));
      out.push({ id: num(a.id), listingId: num(a.listing_id), channelId: num(a.channel_id), day: String(a.day), quota: num(a.quota_units), sold: num(a.sold_units), coreFree: free, sellable: sellable(num(a.quota_units), num(a.sold_units), free) });
    }
    return out;
  });
}

/**
 * Fija el cupo de una publicación para cada día de [from, to] (opcionalmente solo unos días de la semana, 1 = lunes).
 * Nunca por debajo de lo ya vendido: esos días se informan y no se cambian. Con cupo 0 se cierra la venta del día.
 */
export async function setAllocations(input: { listingId: number; from: string; to: string; quota: number; weekdays?: number[] }, actor: McActor): Promise<{ updated: number; skipped: Array<{ day: string; sold: number }> }> {
  writer(actor);
  if (!Number.isInteger(input.quota) || input.quota < 0 || input.quota > 100_000) throw bad("El cupo debe ser un número entero de 0 en adelante.");
  const days = daysInclusive(input.from, input.to).filter((day) => {
    if (!input.weekdays?.length) return true;
    const w = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
    return input.weekdays.includes(w);
  });
  if (days.length === 0) throw bad(`Elige un rango de fechas válido (como mucho ${MC_LIMITS.allocationDays} días).`);
  return run(async (d) => {
    const [l] = await rows(d, sql`SELECT id, channel_id FROM mc_listings WHERE id = ${input.listingId}`);
    if (!l) throw notFound("La publicación");
    return inTx(d, async (tx) => {
      const current = await rows(tx, sql`SELECT day, sold_units FROM mc_allocations WHERE listing_id = ${input.listingId} AND day IN (${idList(days)}) FOR UPDATE`);
      const soldBy = new Map(current.map((c) => [String(c.day), num(c.sold_units)]));
      const skipped: Array<{ day: string; sold: number }> = [];
      let updated = 0;
      for (const day of days) {
        const sold = soldBy.get(day) ?? 0;
        if (sold > input.quota) {
          skipped.push({ day, sold });
          continue;
        }
        await tx.execute(sql`
          INSERT INTO mc_allocations (listing_id, channel_id, day, quota_units, updated_by) VALUES (${input.listingId}, ${num(l.channel_id)}, ${day}, ${input.quota}, ${actor.userId})
          ON DUPLICATE KEY UPDATE quota_units = VALUES(quota_units), updated_by = VALUES(updated_by)`);
        updated++;
      }
      return { updated, skipped };
    });
  });
}

// ─── Ventas ──────────────────────────────────────────────────────────────────

export interface McIngestOutcome {
  ref: string;
  status: McSaleStatus;
  saleId: number;
  reservationId: number | null;
  duplicate: boolean;
  problem: string | null;
}

/** Efectos tras confirmar la venta (booking operativo y transacción contable del Core); sustituible en pruebas. */
export type McAfterRegister = (s: { reservationId: number; productId: number; productName: string; day: string; people: number; grossCents: number; netCents: number; customerName: string; customerEmail: string | null; customerPhone: string | null; channelName: string; ref: string; merchantOrder: string }) => Promise<void>;

export const defaultAfterRegister: McAfterRegister = async (s) => {
  await postConfirmOperation({
    reservationId: s.reservationId,
    productId: s.productId,
    productName: s.productName,
    serviceDate: s.day,
    people: s.people,
    amountCents: s.netCents,
    customerName: s.customerName,
    customerEmail: s.customerEmail ?? "",
    customerPhone: s.customerPhone,
    totalAmount: s.grossCents / 100,
    paymentMethod: "otro",
    saleChannel: "delegado",
    reservationRef: s.merchantOrder,
    description: `Venta en ${s.channelName} — ${s.ref} — ${s.productName}`,
    sourceChannel: "otro",
    sendConfirmationEmail: false,
  });
};

interface ChannelRow {
  id: number;
  name: string;
  commission_pct: unknown;
  commission_fixed_cents: unknown;
  is_active: unknown;
}

/** Señal interna: la venta cabe y hace falta el número de reserva (se pide fuera de la transacción). */
const NEED_NUMBER = new Error("mc:need-reservation-number");
const isNeedNumber = (e: unknown) => {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (x === NEED_NUMBER || x.message === NEED_NUMBER.message) return true;
  return false;
};

const merchantOrderOf = (channelId: number) => `MC${channelId}-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`.slice(0, 30);

type Planned =
  | { ok: false; status: "rechazada" | "sin_plaza"; problem: string }
  | {
      ok: true;
      listing: any;
      kind: McTargetKind;
      productId: number;
      productName: string;
      day: string;
      endDay: string | null;
      time: string | null;
      units: number;
      people: number;
      spaSlotId: number | null;
      expSlotId: number | null;
    };

/** Qué hay que reservar en el Core (dentro de la transacción; sin escribir nada todavía). */
async function plan(tx: Exec, channelId: number, s: McSaleInput): Promise<Planned> {
  const listings = await rows(tx, sql`SELECT * FROM mc_listings WHERE channel_id = ${channelId} AND is_active = 1 ${s.code ? sql`AND external_code = ${s.code}` : sql``} LIMIT 2`);
  if (listings.length === 0) return { ok: false, status: "rechazada", problem: s.code ? `El código de producto «${s.code}» no está publicado en este canal.` : "El canal no tiene productos publicados." };
  if (listings.length > 1) return { ok: false, status: "rechazada", problem: "Falta el código del producto y el canal tiene varias publicaciones." };
  const l = listings[0];
  const kind = l.target_kind as McTargetKind;
  if (!s.day || !isDay(s.day)) return { ok: false, status: "rechazada", problem: "La fecha del servicio no es válida." };
  const productId = num(l.target_id);
  const name = await targetName(tx, kind, productId);
  if (!name) return { ok: false, status: "rechazada", problem: "El producto publicado ya no existe en el catálogo." };
  const base = { ok: true as const, listing: l, kind, productId, day: s.day, units: s.units, time: s.time, spaSlotId: null as number | null, expSlotId: null as number | null };

  if (kind === "hotel") {
    const endDay = s.endDay && isDay(s.endDay) ? s.endDay : addDays(s.day, 1);
    const nights = daysConsumed("hotel", s.day, endDay);
    if (nights.length === 0 || nights.length > MC_LIMITS.maxNights) return { ok: false, status: "rechazada", problem: "La fecha de salida debe ser posterior a la de entrada (como mucho 60 noches)." };
    return { ...base, endDay, people: s.people ?? s.units, productName: `Hotel: ${name} (${nights.length} noche${nights.length > 1 ? "s" : ""})` };
  }
  if (kind === "spa") {
    const slots = await rows(tx, sql`SELECT id, startTime FROM spa_slots WHERE treatmentId = ${productId} AND date = ${s.day} ${s.time ? sql`AND startTime = ${s.time}` : sql``} ORDER BY startTime LIMIT 2`);
    if (slots.length === 0) return { ok: false, status: "sin_plaza", problem: s.time ? `No hay franja de spa a las ${s.time} ese día.` : "No hay franjas de spa ese día." };
    if (slots.length > 1) return { ok: false, status: "rechazada", problem: "Falta la hora: ese día hay varias franjas de spa." };
    return { ...base, endDay: null, time: String(slots[0].startTime), spaSlotId: num(slots[0].id), people: s.units, productName: `SPA: ${name} · ${slots[0].startTime}` };
  }
  // Experiencia: la franja de la publicación o, si no la fija, la de la hora que informa el canal
  let slotId: number | null = l.time_slot_id == null ? null : num(l.time_slot_id);
  let time = s.time;
  if (slotId == null && s.time) {
    const [sl] = await rows(tx, sql`SELECT id FROM product_time_slots WHERE product_id = ${productId} AND active = 1 AND start_time = ${s.time} LIMIT 1`);
    if (sl) slotId = num(sl.id);
  }
  if (slotId != null) {
    const [sl] = await rows(tx, sql`SELECT start_time FROM product_time_slots WHERE id = ${slotId}`);
    time = sl?.start_time ? String(sl.start_time) : time;
  }
  return { ...base, endDay: null, time, expSlotId: slotId, people: s.units, productName: time ? `${name} · ${time}` : name };
}

/**
 * Registra una venta del canal (o su cancelación). Idempotente por (canal, referencia). Una venta sin cupo o sin plaza
 * no crea nada en el Core y queda anotada con el motivo; reenviarla con la misma referencia la vuelve a intentar.
 */
export async function ingestSale(
  channel: ChannelRow,
  s: McSaleInput,
  o: { source: McSaleSource; importId?: number | null; actorId?: number | null; after?: McAfterRegister; now?: number },
): Promise<McIngestOutcome> {
  const d = await database();
  const now = o.now ?? Date.now();
  if (s.event === "cancelacion") return cancelByRef(d, channel, s.ref, o, now);
  if (!bool(channel.is_active)) return { ref: s.ref, status: "rechazada", saleId: 0, reservationId: null, duplicate: false, problem: "El canal está desactivado." };
  // El número de reserva se pide solo cuando la venta va a crear la reserva (fuera de la transacción, para no ocupar
  // una segunda conexión dentro de ella): repetir o rechazar ventas no gasta numeración
  let reservationNumber: string | null = null;
  let registered: Parameters<McAfterRegister>[0] | null = null;
  const attempt = () => inTx(d, async (tx): Promise<McIngestOutcome> => {
    // 1. La fila de la venta (bloqueada): si ya está registrada o cancelada, no se repite nada
    let [sale] = await rows(tx, sql`SELECT id, status, reservation_id FROM mc_sales WHERE channel_id = ${channel.id} AND external_ref = ${s.ref} FOR UPDATE`);
    if (sale && !MC_RETRYABLE.has(String(sale.status))) {
      return { ref: s.ref, status: sale.status, saleId: num(sale.id), reservationId: sale.reservation_id == null ? null : num(sale.reservation_id), duplicate: true, problem: null };
    }
    if (!sale) {
      try {
        const id = (await header(tx, sql`
          INSERT INTO mc_sales (channel_id, external_ref, source, status, units, import_id, created_by)
          VALUES (${channel.id}, ${s.ref}, ${o.source}, 'rechazada', ${s.units}, ${o.importId ?? null}, ${o.actorId ?? null})`)).insertId;
        sale = { id, status: "rechazada", reservation_id: null };
      } catch (e) {
        if (errCode(e) !== "ER_DUP_ENTRY") throw e;
        // Otra entrega simultánea de la misma venta: se espera a que termine y se responde lo que hizo
        const [other] = await rows(tx, sql`SELECT id, status, reservation_id FROM mc_sales WHERE channel_id = ${channel.id} AND external_ref = ${s.ref} FOR UPDATE`);
        return { ref: s.ref, status: other.status, saleId: num(other.id), reservationId: other.reservation_id == null ? null : num(other.reservation_id), duplicate: true, problem: null };
      }
    }
    const saleId = num(sale.id);
    const fail = async (status: "rechazada" | "sin_cupo" | "sin_plaza", problem: string, extra: SQL = sql``): Promise<McIngestOutcome> => {
      await tx.execute(sql`UPDATE mc_sales SET status = ${status}, problem = ${problem.slice(0, 500)}, units = ${s.units}, service_day = ${s.day}, service_time = ${s.time} ${extra} WHERE id = ${saleId}`);
      return { ref: s.ref, status, saleId, reservationId: null, duplicate: false, problem };
    };

    // 2. Qué se vende
    const p = await plan(tx, channel.id, s);
    if (!p.ok) return fail(p.status, p.problem);
    const listingId = num(p.listing.id);
    const gross = s.grossCents ?? (p.listing.unit_price_cents == null ? 0 : num(p.listing.unit_price_cents) * p.units);
    if (gross < 0 || gross > MC_LIMITS.maxCents) return fail("rechazada", "El importe no es válido.", sql`, listing_id = ${listingId}`);
    const { commissionCents, netCents } = commissionOf(gross, { pct: Number(channel.commission_pct ?? 0), fixedCents: num(channel.commission_fixed_cents) }, s.commissionCents);

    // 3. Cupo del canal: cada día bajo bloqueo de fila (orden por id)
    const days = daysConsumed(p.kind, p.day, p.endDay);
    const allocs = await rows(tx, sql`SELECT id, day, quota_units, sold_units FROM mc_allocations WHERE listing_id = ${listingId} AND day IN (${idList(days)}) ORDER BY id FOR UPDATE`);
    const byDay = new Map(allocs.map((a) => [String(a.day), a]));
    const short = days.filter((day) => {
      const a = byDay.get(day);
      return !a || num(a.quota_units) - num(a.sold_units) < p.units;
    });
    if (short.length) return fail("sin_cupo", `Sin cupo para este canal el ${short.slice(0, 5).join(", ")}${short.length > 5 ? "…" : ""}.`, sql`, listing_id = ${listingId}`);

    // 4. Plaza en el Core y reserva (misma transacción)
    if (!reservationNumber) throw NEED_NUMBER;
    const customerName = s.customerName || `Cliente de ${channel.name}`;
    const merchantOrder = merchantOrderOf(channel.id);
    const data = {
      productId: p.productId,
      productName: p.productName.slice(0, 255),
      bookingDate: p.day,
      people: p.people,
      amountTotal: gross,
      customerName: customerName.slice(0, 255),
      customerEmail: s.customerEmail ?? "",
      customerPhone: s.customerPhone ?? undefined,
      merchantOrder,
      notes: `Venta en ${channel.name} · referencia ${s.ref}`,
      reservationNumber,
      ...(p.expSlotId != null ? { selectedTimeSlotId: p.expSlotId } : {}),
      ...(p.time ? { selectedTime: p.time } : {}),
    };
    let reservationId: number;
    if (p.kind === "spa" || p.kind === "hotel") {
      const held = await holdConfirmedForChannelSale(
        tx,
        p.kind === "spa"
          ? { kind: "spa_slot", slotId: p.spaSlotId!, treatmentId: p.productId, date: p.day, units: p.units }
          : { kind: "hotel_room", roomTypeId: p.productId, checkIn: p.day, checkOut: p.endDay!, units: p.units },
        data,
        now,
      );
      if (!held.ok) return fail("sin_plaza", `El Core no tiene plaza: quedan ${held.available}.`, sql`, listing_id = ${listingId}`);
      reservationId = held.reservation.id;
    } else {
      if (p.expSlotId != null) {
        const [slot] = await rows(tx, sql`SELECT capacity FROM product_time_slots WHERE id = ${p.expSlotId} FOR UPDATE`);
        const cap = slot?.capacity == null ? 0 : num(slot.capacity);
        if (cap > 0) {
          const booked = await experienceBooked(tx, p.productId, p.expSlotId, p.day);
          if (booked + p.people > cap) return fail("sin_plaza", `El Core no tiene plaza en la franja: quedan ${Math.max(0, cap - booked)}.`, sql`, listing_id = ${listingId}`);
        }
      }
      reservationId = (await createReservation(data, tx)).id;
    }

    // 5. Consumo del cupo (condicionado: nunca por encima del cupo aunque algo cambiara)
    for (const day of days) {
      const a = byDay.get(day)!;
      const r = await header(tx, sql`UPDATE mc_allocations SET sold_units = sold_units + ${p.units} WHERE id = ${num(a.id)} AND sold_units + ${p.units} <= quota_units`);
      if (r.affectedRows !== 1) throw new Error("Cupo del canal modificado durante la venta");
      await tx.execute(sql`INSERT INTO mc_sale_allocations (sale_id, allocation_id, units) VALUES (${saleId}, ${num(a.id)}, ${p.units}) ON DUPLICATE KEY UPDATE units = VALUES(units)`);
    }

    // 6. La reserva queda pagada por el canal y confirmada, con su origen
    await tx.execute(sql`
      UPDATE reservations SET status = 'paid', amount_paid = ${gross}, channel = 'API', channel_detail = ${channel.name.slice(0, 128)},
        origin_source = 'multicanal', platform_name = ${channel.name.slice(0, 128)}, status_reservation = 'CONFIRMADA', status_payment = 'PAGADO',
        paymentMethod = 'otro', paid_at = ${now}, updated_at = ${now}, customer_email = ${s.customerEmail ?? null}
      WHERE id = ${reservationId}`);
    await tx.execute(sql`
      UPDATE mc_sales SET status = 'registrada', problem = NULL, listing_id = ${listingId}, service_day = ${p.day}, service_end_day = ${p.endDay},
        service_time = ${p.time}, units = ${p.units}, people = ${p.people}, gross_cents = ${gross}, commission_cents = ${commissionCents}, net_cents = ${netCents},
        customer_name = ${customerName.slice(0, 200)}, customer_email = ${s.customerEmail}, customer_phone = ${s.customerPhone},
        reservation_id = ${reservationId}, import_id = ${o.importId ?? null}, sold_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${saleId}`);
    registered = { reservationId, productId: p.productId, productName: p.productName, day: p.day, people: p.people, grossCents: gross, netCents, customerName, customerEmail: s.customerEmail, customerPhone: s.customerPhone, channelName: channel.name, ref: s.ref, merchantOrder };
    return { ref: s.ref, status: "registrada", saleId, reservationId, duplicate: false, problem: null };
  });

  let outcome: McIngestOutcome;
  try {
    outcome = await attempt();
  } catch (e) {
    if (!isNeedNumber(e)) throw e;
    // Cabe: se pide el número y se repite la transacción (el estado se vuelve a comprobar bajo bloqueo)
    reservationNumber = await generateReservationNumber();
    outcome = await attempt();
  }

  if (registered) {
    try {
      await (o.after ?? defaultAfterRegister)(registered);
    } catch (e) {
      console.error(JSON.stringify({ ctx: "Multicanal", event: "after_register_failed", saleId: outcome.saleId, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    }
  }
  return outcome;
}

/** Cancela dentro de la transacción: devuelve el cupo, anula la reserva y libera la plaza. Idempotente. */
async function cancelLocked(tx: Exec, sale: any, now: number): Promise<void> {
  if (sale.status === "registrada") {
    for (const a of await rows(tx, sql`SELECT allocation_id, units FROM mc_sale_allocations WHERE sale_id = ${num(sale.id)} ORDER BY allocation_id`)) {
      await tx.execute(sql`UPDATE mc_allocations SET sold_units = GREATEST(CAST(sold_units AS SIGNED) - ${num(a.units)}, 0) WHERE id = ${num(a.allocation_id)}`);
    }
    if (sale.reservation_id != null) {
      const rid = num(sale.reservation_id);
      await tx.execute(sql`UPDATE reservations SET status = 'cancelled', status_reservation = 'ANULADA', updated_at = ${now} WHERE id = ${rid}`);
      await releaseInventoryHold(rid, "cancelada", tx, now);
    }
  }
  await tx.execute(sql`UPDATE mc_sales SET status = 'cancelada', cancelled_at = CURRENT_TIMESTAMP(3) WHERE id = ${num(sale.id)}`);
}

async function cancelByRef(d: Db, channel: ChannelRow, ref: string, o: { source: McSaleSource; importId?: number | null; actorId?: number | null }, now: number): Promise<McIngestOutcome> {
  return inTx(d, async (tx) => {
    const [sale] = await rows(tx, sql`SELECT * FROM mc_sales WHERE channel_id = ${channel.id} AND external_ref = ${ref} FOR UPDATE`);
    if (!sale) {
      // Cancelada antes de conocer la venta: queda anotada para que una venta tardía con esa referencia no reserve
      try {
        const id = (await header(tx, sql`
          INSERT INTO mc_sales (channel_id, external_ref, source, status, problem, import_id, created_by, cancelled_at)
          VALUES (${channel.id}, ${ref}, ${o.source}, 'cancelada', 'Cancelación recibida antes que la venta.', ${o.importId ?? null}, ${o.actorId ?? null}, CURRENT_TIMESTAMP(3))`)).insertId;
        return { ref, status: "cancelada" as const, saleId: id, reservationId: null, duplicate: false, problem: null };
      } catch (e) {
        if (errCode(e) !== "ER_DUP_ENTRY") throw e;
        const [other] = await rows(tx, sql`SELECT * FROM mc_sales WHERE channel_id = ${channel.id} AND external_ref = ${ref} FOR UPDATE`);
        if (other.status !== "cancelada") await cancelLocked(tx, other, now);
        return { ref, status: "cancelada" as const, saleId: num(other.id), reservationId: other.reservation_id == null ? null : num(other.reservation_id), duplicate: other.status === "cancelada", problem: null };
      }
    }
    if (sale.status === "cancelada") return { ref, status: "cancelada" as const, saleId: num(sale.id), reservationId: sale.reservation_id == null ? null : num(sale.reservation_id), duplicate: true, problem: null };
    await cancelLocked(tx, sale, now);
    return { ref, status: "cancelada" as const, saleId: num(sale.id), reservationId: sale.reservation_id == null ? null : num(sale.reservation_id), duplicate: false, problem: null };
  });
}

async function channelRow(exec: Pick<Db, "execute">, id: number): Promise<ChannelRow | null> {
  const [c] = await rows(exec, sql`SELECT id, name, commission_pct, commission_fixed_cents, is_active FROM mc_channels WHERE id = ${id}`);
  return c ? { ...c, id: num(c.id), name: String(c.name) } : null;
}

/** Alta manual de una venta del canal desde el panel (p. ej. una venta que llegó por correo). */
export async function recordSale(channelId: number, s: McSaleInput, actor: McActor, after?: McAfterRegister): Promise<McIngestOutcome> {
  writer(actor);
  return run(async (d) => {
    const c = await channelRow(d, channelId);
    if (!c) throw notFound("El canal");
    return ingestSale(c, s, { source: "manual", actorId: actor.userId, after });
  });
}

export async function cancelSale(saleId: number, actor: McActor): Promise<McIngestOutcome> {
  writer(actor);
  return run(async (d) => {
    const [sale] = await rows(d, sql`SELECT channel_id, external_ref FROM mc_sales WHERE id = ${saleId}`);
    if (!sale) throw notFound("La venta");
    const c = await channelRow(d, num(sale.channel_id));
    return cancelByRef(d, c!, String(sale.external_ref), { source: "manual", actorId: actor.userId }, Date.now());
  });
}

/** Vuelve a intentar una venta sin cupo, sin plaza o rechazada con los datos que ya se guardaron. */
export async function retrySale(saleId: number, actor: McActor, after?: McAfterRegister): Promise<McIngestOutcome> {
  writer(actor);
  return run(async (d) => {
    const [sale] = await rows(d, sql`SELECT s.*, l.external_code FROM mc_sales s LEFT JOIN mc_listings l ON l.id = s.listing_id WHERE s.id = ${saleId}`);
    if (!sale) throw notFound("La venta");
    if (!MC_RETRYABLE.has(String(sale.status))) throw bad("Solo se reintentan las ventas sin cupo, sin plaza o rechazadas.");
    if (!sale.service_day) throw bad("Esa venta llegó sin fecha: vuelve a importarla corregida.");
    const c = await channelRow(d, num(sale.channel_id));
    return ingestSale(c!, {
      ref: String(sale.external_ref), event: "venta", code: str(sale.external_code), day: String(sale.service_day), endDay: str(sale.service_end_day), time: str(sale.service_time),
      units: num(sale.units) || 1, people: null, grossCents: sale.gross_cents ? num(sale.gross_cents) : null, commissionCents: null,
      customerName: str(sale.customer_name), customerEmail: str(sale.customer_email), customerPhone: str(sale.customer_phone),
    }, { source: "manual", actorId: actor.userId, after });
  });
}

export interface McSaleRow {
  id: number;
  channelId: number;
  channelName: string;
  externalRef: string;
  externalCode: string | null;
  source: string;
  status: McSaleStatus;
  problem: string | null;
  serviceDay: string | null;
  serviceEndDay: string | null;
  serviceTime: string | null;
  units: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  customerName: string | null;
  reservationId: number | null;
  reservationNumber: string | null;
  reservationStatus: string | null;
  settlementId: number | null;
  createdAt: string | null;
}

function mapSale(r: any): McSaleRow {
  return {
    id: num(r.id),
    channelId: num(r.channel_id),
    channelName: String(r.channel_name ?? ""),
    externalRef: String(r.external_ref),
    externalCode: str(r.external_code),
    source: String(r.source),
    status: r.status as McSaleStatus,
    problem: str(r.problem),
    serviceDay: str(r.service_day),
    serviceEndDay: str(r.service_end_day),
    serviceTime: str(r.service_time),
    units: num(r.units),
    grossCents: num(r.gross_cents),
    commissionCents: num(r.commission_cents),
    netCents: num(r.net_cents),
    customerName: str(r.customer_name),
    reservationId: r.reservation_id == null ? null : num(r.reservation_id),
    reservationNumber: str(r.reservation_number),
    reservationStatus: str(r.reservation_status),
    settlementId: r.settlement_id == null ? null : num(r.settlement_id),
    createdAt: iso(r.created_at),
  };
}

export interface McSaleFilter {
  channelId?: number;
  status?: McSaleStatus | "pendientes" | "todas";
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function saleWhere(f: McSaleFilter): SQL {
  const parts: SQL[] = [sql`1 = 1`];
  if (f.channelId) parts.push(sql`s.channel_id = ${f.channelId}`);
  if (f.status === "pendientes") parts.push(sql`s.status IN ('sin_cupo', 'sin_plaza', 'rechazada')`);
  else if (f.status && f.status !== "todas") parts.push(sql`s.status = ${f.status}`);
  if (f.from && isDay(f.from)) parts.push(sql`s.service_day >= ${f.from}`);
  if (f.to && isDay(f.to)) parts.push(sql`s.service_day <= ${f.to}`);
  if (f.search?.trim()) {
    const like = `%${f.search.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(sql`(s.external_ref LIKE ${like} OR s.customer_name LIKE ${like})`);
  }
  return sql.join(parts, sql` AND `);
}

const SALE_SELECT = sql`
  SELECT s.*, c.name AS channel_name, l.external_code, r.reservation_number, r.status AS reservation_status
  FROM mc_sales s JOIN mc_channels c ON c.id = s.channel_id
  LEFT JOIN mc_listings l ON l.id = s.listing_id
  LEFT JOIN reservations r ON r.id = s.reservation_id`;

export const listSales = (f: McSaleFilter) =>
  run(async (d) => {
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const list = await rows(d, sql`${SALE_SELECT} WHERE ${saleWhere(f)} ORDER BY s.id DESC LIMIT ${limit} OFFSET ${Math.max(f.offset ?? 0, 0)}`);
    const [t] = await rows(d, sql`SELECT COUNT(*) AS n FROM mc_sales s WHERE ${saleWhere(f)}`);
    return { items: list.map(mapSale), total: num(t?.n) };
  });

export const exportSalesCsv = (f: McSaleFilter) =>
  run(async (d) => {
    const list = (await rows(d, sql`${SALE_SELECT} WHERE ${saleWhere(f)} ORDER BY s.service_day, s.id LIMIT 20000`)).map(mapSale);
    const cents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    return salesCsv(
      list.map((s) => ({ ...s, gross: cents(s.grossCents), commission: cents(s.commissionCents), net: cents(s.netCents), settled: s.settlementId ? "Sí" : "No" })),
      [["channelName", "Canal"], ["externalRef", "Referencia"], ["externalCode", "Producto"], ["serviceDay", "Fecha"], ["serviceTime", "Hora"], ["units", "Unidades"], ["gross", "Importe"], ["commission", "Comisión"], ["net", "Neto"], ["status", "Estado"], ["reservationNumber", "Reserva"], ["customerName", "Cliente"], ["settled", "Liquidada"], ["problem", "Motivo"]],
    );
  });

// ─── Importación del informe CSV ─────────────────────────────────────────────

export interface McImportResult {
  importId: number;
  rows: number;
  registered: number;
  cancelled: number;
  duplicates: number;
  rejected: number;
  problems: Array<{ line: number; ref: string | null; problem: string }>;
}

export async function importCsv(channelId: number, text: string, fileName: string | null, actor: McActor, after?: McAfterRegister): Promise<McImportResult> {
  writer(actor);
  if (Buffer.byteLength(text) > MC_LIMITS.csvBytes) throw bad("El fichero supera 2 MB: divídelo por fechas.");
  return run(async (d) => {
    const c = await channelRow(d, channelId);
    if (!c) throw notFound("El canal");
    if (!bool(c.is_active)) throw bad("El canal está desactivado.");
    const [m] = await rows(d, sql`SELECT csv_mapping FROM mc_channels WHERE id = ${channelId}`);
    const parsed = parseSalesCsv(text, parseCsvMapping(m?.csv_mapping));
    if (parsed.missing.length) throw bad(`No se encuentran las columnas de ${parsed.missing.map((x) => (x === "ref" ? "referencia" : "fecha")).join(" y ")}. Indica sus nombres en la ficha del canal.`);
    if (parsed.rows.length === 0) throw bad("El fichero no tiene ventas.");
    const importId = (await header(d, sql`INSERT INTO mc_imports (channel_id, file_name, rows_total, created_by) VALUES (${channelId}, ${oneLine(fileName, 200) || null}, ${parsed.rows.length}, ${actor.userId})`)).insertId;
    const res: McImportResult = { importId, rows: parsed.rows.length, registered: 0, cancelled: 0, duplicates: 0, rejected: 0, problems: [] };
    for (const r of parsed.rows) {
      if (!r.sale) {
        res.rejected++;
        res.problems.push({ line: r.line, ref: null, problem: r.problem ?? "Fila no válida." });
        continue;
      }
      const out = await ingestSale(c, r.sale, { source: "csv", importId, actorId: actor.userId, after });
      if (out.duplicate) res.duplicates++;
      else if (out.status === "registrada") res.registered++;
      else if (out.status === "cancelada") res.cancelled++;
      else {
        res.rejected++;
        res.problems.push({ line: r.line, ref: r.sale.ref, problem: out.problem ?? out.status });
      }
    }
    await d.execute(sql`
      UPDATE mc_imports SET registered = ${res.registered}, cancelled = ${res.cancelled}, duplicates = ${res.duplicates}, rejected = ${res.rejected},
        report = ${JSON.stringify(res.problems.slice(0, 200))}
      WHERE id = ${importId}`);
    return res;
  });
}

export const listImports = (channelId?: number) =>
  run(async (d) =>
    (await rows(d, sql`SELECT i.*, c.name AS channel_name FROM mc_imports i JOIN mc_channels c ON c.id = i.channel_id ${channelId ? sql`WHERE i.channel_id = ${channelId}` : sql``} ORDER BY i.id DESC LIMIT 50`)).map((r) => ({
      id: num(r.id), channelId: num(r.channel_id), channelName: String(r.channel_name), fileName: str(r.file_name), rows: num(r.rows_total), registered: num(r.registered),
      cancelled: num(r.cancelled), duplicates: num(r.duplicates), rejected: num(r.rejected), createdAt: iso(r.created_at),
    })),
  );

// ─── Conciliación y liquidaciones ────────────────────────────────────────────

export async function reconciliation(f: { from?: string; to?: string; channelId?: number }) {
  const to = f.to && isDay(f.to) ? f.to : todayMadrid();
  const from = f.from && isDay(f.from) ? f.from : addDays(to, -30);
  return run(async (d) => {
    const sales = await rows(d, sql`
      SELECT channel_id, status, units, gross_cents, commission_cents, net_cents, settlement_id FROM mc_sales
      WHERE service_day >= ${from} AND service_day <= ${to} ${f.channelId ? sql`AND channel_id = ${f.channelId}` : sql``}`);
    const totals = totalsByChannel(sales.map((s) => ({ channelId: num(s.channel_id), status: String(s.status), units: num(s.units), grossCents: num(s.gross_cents), commissionCents: num(s.commission_cents), netCents: num(s.net_cents), settlementId: s.settlement_id == null ? null : num(s.settlement_id) })));
    const names = new Map((await rows(d, sql`SELECT id, name FROM mc_channels`)).map((c) => [num(c.id), String(c.name)]));
    // Desajustes: venta registrada cuya reserva se anuló o desapareció en el Core (el cupo sigue consumido)
    const mismatches = (await rows(d, sql`
      ${SALE_SELECT} WHERE s.status = 'registrada' AND (r.id IS NULL OR r.status IN ('cancelled', 'failed') OR r.status_reservation = 'ANULADA')
        ${f.channelId ? sql`AND s.channel_id = ${f.channelId}` : sql``}
      ORDER BY s.id DESC LIMIT 100`)).map(mapSale);
    const pending = (await rows(d, sql`${SALE_SELECT} WHERE s.status IN ('sin_cupo', 'sin_plaza', 'rechazada') ${f.channelId ? sql`AND s.channel_id = ${f.channelId}` : sql``} ORDER BY s.id DESC LIMIT 100`)).map(mapSale);
    const settlements = (await rows(d, sql`SELECT * FROM mc_settlements ${f.channelId ? sql`WHERE channel_id = ${f.channelId}` : sql``} ORDER BY id DESC LIMIT 50`)).map((s) => ({
      id: num(s.id), channelId: num(s.channel_id), channelName: names.get(num(s.channel_id)) ?? "", periodFrom: String(s.period_from), periodTo: String(s.period_to), reference: str(s.reference),
      salesCount: num(s.sales_count), expectedNetCents: num(s.expected_net_cents), receivedCents: s.received_cents == null ? null : num(s.received_cents),
      differenceCents: s.received_cents == null ? null : num(s.received_cents) - num(s.expected_net_cents), note: str(s.note), createdAt: iso(s.created_at),
    }));
    return { from, to, totals: totals.map((t) => ({ ...t, channelName: names.get(t.channelId) ?? "" })), mismatches, pending, settlements };
  });
}

/**
 * Liquidación del canal: agrupa las ventas registradas y aún sin liquidar con servicio en [from, to] y anota lo que el
 * canal ha pagado (la diferencia con el neto esperado queda a la vista). Cada venta entra en una sola liquidación.
 */
export async function createSettlement(input: { channelId: number; from: string; to: string; reference?: string | null; receivedCents?: number | null; note?: string | null }, actor: McActor) {
  writer(actor);
  if (!isDay(input.from) || !isDay(input.to) || input.to < input.from) throw bad("Elige el periodo de la liquidación.");
  if (input.receivedCents != null && !(Number.isInteger(input.receivedCents) && Math.abs(input.receivedCents) <= MC_LIMITS.maxCents)) throw bad("El importe recibido no es válido.");
  return run(async (d) => {
    if (!(await channelRow(d, input.channelId))) throw notFound("El canal");
    return inTx(d, async (tx) => {
      const list = await rows(tx, sql`
        SELECT id, net_cents FROM mc_sales WHERE channel_id = ${input.channelId} AND status = 'registrada' AND settlement_id IS NULL
          AND service_day >= ${input.from} AND service_day <= ${input.to} FOR UPDATE`);
      if (list.length === 0) throw bad("No hay ventas registradas sin liquidar en ese periodo.");
      const expected = list.reduce((a, s) => a + num(s.net_cents), 0);
      const id = (await header(tx, sql`
        INSERT INTO mc_settlements (channel_id, period_from, period_to, reference, sales_count, expected_net_cents, received_cents, note, created_by)
        VALUES (${input.channelId}, ${input.from}, ${input.to}, ${oneLine(input.reference, 120) || null}, ${list.length}, ${expected}, ${input.receivedCents ?? null}, ${oneLine(input.note, 500) || null}, ${actor.userId})`)).insertId;
      await tx.execute(sql`UPDATE mc_sales SET settlement_id = ${id} WHERE id IN (${idList(list.map((s) => num(s.id)))}) AND settlement_id IS NULL`);
      return { id, salesCount: list.length, expectedNetCents: expected, receivedCents: input.receivedCents ?? null, differenceCents: input.receivedCents == null ? null : input.receivedCents - expected };
    });
  });
}

// ─── Enlace de entrada del canal (ruta pública) ──────────────────────────────

/** Canal del token (activo y con el enlace vigente) o null. Sin la migración, `McNotInstalled`. */
export async function resolveInboundChannel(token: unknown): Promise<ChannelRow | null> {
  if (typeof token !== "string" || !MC_TOKEN_RE.test(token)) return null;
  const d = await database();
  try {
    const [c] = await rows(d, sql`
      SELECT id, name, commission_pct, commission_fixed_cents, is_active FROM mc_channels
      WHERE inbound_token_hash = ${inboundTokenHash(token, getTenantIdOrDefault())} AND is_active = 1 LIMIT 1`);
    return c ? { ...c, id: num(c.id), name: String(c.name) } : null;
  } catch (e) {
    if (isMissingMcSchema(e)) throw new McNotInstalled();
    throw e;
  }
}

/** Lo que el canal puede vender desde hoy (como mucho 120 días): su cupo restante, limitado por el Core. */
export async function availabilityFeed(channelId: number, days = 60, now = Date.now()) {
  const d = await database();
  const from = todayMadrid(new Date(now));
  const to = addDays(from, Math.min(Math.max(days, 1), 120) - 1);
  try {
    const list = await rows(d, sql`
      SELECT a.day, a.quota_units, a.sold_units, l.external_code, l.label, l.target_kind, l.target_id, l.time_slot_id
      FROM mc_allocations a JOIN mc_listings l ON l.id = a.listing_id
      WHERE a.channel_id = ${channelId} AND l.is_active = 1 AND a.day >= ${from} AND a.day <= ${to}
      ORDER BY l.external_code, a.day LIMIT 2000`);
    const out: Array<{ code: string; label: string | null; date: string; available: number }> = [];
    for (const a of list) {
      const free = await coreFree(d, a, String(a.day), now);
      out.push({ code: String(a.external_code), label: str(a.label), date: String(a.day), available: sellable(num(a.quota_units), num(a.sold_units), free) });
    }
    return { from, to, items: out };
  } catch (e) {
    if (isMissingMcSchema(e)) throw new McNotInstalled();
    throw e;
  }
}
