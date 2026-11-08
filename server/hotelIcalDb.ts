/**
 * Hotel Net · sincronización iCal (migración db/migrations/0050_hotel_net_ical, capacidad `hotel-net`): exportación
 * e importación de disponibilidad por tipología o habitación. Tablas fuera de `drizzle/schema.ts` a propósito (como
 * las de Life Net): SQL parametrizado aquí. Lógica pura en server/hotelIcal.ts; descarga en server/hotelIcalFetch.ts.
 *
 *  - Exportación: un enlace secreto por destino (tipología o habitación) y canal. Una noche se publica como «No
 *    disponible» si la tipología no tiene unidades libres (reservas vivas, cupos de `room_blocks` y bloqueos de OTROS
 *    canales); para una habitación, además, si está asignada a una reserva viva o la marca otro canal. Lo importado
 *    del mismo canal y destino no se reexporta (evita que el canal se bloquee a sí mismo para siempre).
 *  - Importación: la URL iCal de cada canal crea, cambia o cancela (por UID) bloqueos de origen externo en
 *    `hotel_ical_blocks`; nunca toca reservas propias ni `room_blocks`. Si la descarga o la lectura falla, se conservan
 *    los bloqueos anteriores (más vale no vender que vender dos veces) y el error queda a la vista en el panel.
 *  - Sin la migración: el panel lo explica (PRECONDITION_FAILED) y la ruta pública responde «no disponible».
 */
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getModuleAccess } from "./_core/modules/runtime";
import { sessionSecret } from "./_core/sessionSecret";
import { getTenantIdOrDefault } from "./_core/tenant";
import { getFeatureFlag } from "./config";
import { HOTEL_CAPABILITY } from "./hotelFolioCharges";
import { reservationOccupies, todayInTimeZone } from "./hotelPms";
import { hotelOccupancy } from "./inventoryHoldsDb";
import { externalBlockRows } from "./hotelIcalOccupancy";
import { fetchIcal } from "./hotelIcalFetch";
import { nightCapacity } from "./inventoryHolds";
import {
  ICAL_CHANNELS, ICAL_LIMITS, ICAL_TOKEN_RE, addDays, buildCalendar, deriveExportToken, exportTokenHash, maskUrl, newExportNonce, nightRanges, nightsOf,
  normalizeFeedUrl, parseCalendar, planBlocks, uidHash, type IcalChannel, type IcalTargetKind, type StoredBlock,
} from "./hotelIcal";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

export const ICAL_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] Los canales iCal aún no están preparados en tu empresa: falta aplicar la actualización 0050_hotel_net_ical de su base de datos.";

export class IcalNotInstalled extends Error {
  constructor() {
    super(ICAL_NOT_INSTALLED_MESSAGE);
    this.name = "IcalNotInstalled";
  }
}

function isMissingIcalSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    const msg = String(x.sqlMessage ?? x.message ?? "");
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /hotel_ical_/.test(msg)) return true;
  }
  return false;
}

async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}

async function affected(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}

/** BD de la empresa; sin la migración 0050, `IcalNotInstalled`. */
async function withIcalDb<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  try {
    return await fn(d);
  } catch (e) {
    if (isMissingIcalSchema(e)) throw new IcalNotInstalled();
    throw e;
  }
}

/** Errores del panel: sin la migración, mensaje claro. */
async function panel<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IcalNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: ICAL_NOT_INSTALLED_MESSAGE });
    throw e;
  }
}

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

/** Hotel Net activo (licencia con escritura), módulo de hotel disponible y encendido. */
export async function icalAvailable(): Promise<boolean> {
  try {
    if (!(await getCapabilityAccess().check(HOTEL_CAPABILITY, { write: true })).allowed) return false;
    if (!(await getModuleAccess().isModuleAvailable("hotel"))) return false;
    return await getFeatureFlag("hotel_module_enabled", false);
  } catch {
    return false;
  }
}

async function assertAvailable(): Promise<void> {
  if (!(await icalAvailable())) throw new TRPCError({ code: "FORBIDDEN", message: "Los canales iCal necesitan Hotel Net activo en tu plan." });
}

// ─── Destinos (tipologías y habitaciones) ────────────────────────────────────

export interface IcalTarget {
  kind: IcalTargetKind;
  id: number;
  roomTypeId: number;
  name: string;
}

async function roomsOf(d: Exec): Promise<Array<{ id: number; roomTypeId: number; code: string; name: string | null; isActive: boolean }>> {
  try {
    return (await rows(d, sql`SELECT id, room_type_id, code, name, is_active FROM hotel_rooms ORDER BY sort_order, code`)).map((r) => ({
      id: Number(r.id), roomTypeId: Number(r.room_type_id), code: String(r.code), name: r.name ?? null, isActive: Number(r.is_active) === 1,
    }));
  } catch (e) {
    // Sin la migración 0032 (PMS) no hay habitaciones físicas: solo tipologías
    if ((e as { code?: string })?.code === "ER_NO_SUCH_TABLE" || (e as { cause?: { code?: string } })?.cause?.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function resolveTarget(d: Exec, kind: IcalTargetKind, id: number): Promise<IcalTarget | null> {
  if (kind === "room_type") {
    const [t] = await rows(d, sql`SELECT id, name FROM room_types WHERE id = ${id}`);
    return t ? { kind, id, roomTypeId: Number(t.id), name: String(t.name) } : null;
  }
  const [r] = await rows(d, sql`SELECT h.id, h.code, h.room_type_id, t.name AS type_name FROM hotel_rooms h JOIN room_types t ON t.id = h.room_type_id WHERE h.id = ${id}`).catch(() => []);
  return r ? { kind, id, roomTypeId: Number(r.room_type_id), name: `${r.type_name} · ${r.code}` } : null;
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────

async function autoSyncEnabled(d: Exec): Promise<boolean> {
  const [s] = await rows(d, sql`SELECT auto_sync_enabled FROM hotel_ical_settings WHERE id = 1`);
  return Number(s?.auto_sync_enabled ?? 0) === 1;
}

async function writeAutoSync(d: Exec, enabled: boolean, actor: string, now: number, onlyIfMissing = false): Promise<void> {
  if (onlyIfMissing) {
    await d.execute(sql`INSERT IGNORE INTO hotel_ical_settings (id, auto_sync_enabled, updated_by, updated_at) VALUES (1, ${enabled ? 1 : 0}, ${actor.slice(0, 100)}, ${now})`);
    return;
  }
  await d.execute(sql`INSERT INTO hotel_ical_settings (id, auto_sync_enabled, updated_by, updated_at) VALUES (1, ${enabled ? 1 : 0}, ${actor.slice(0, 100)}, ${now})
    ON DUPLICATE KEY UPDATE auto_sync_enabled = VALUES(auto_sync_enabled), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`);
}

export function setAutoSync(enabled: boolean, actor: string, now = Date.now()) {
  return panel(async () => {
    await assertAvailable();
    await withIcalDb((d) => writeAutoSync(d, enabled, actor, now));
    return { autoSync: enabled };
  });
}

// ─── Exportación ─────────────────────────────────────────────────────────────

interface ExportRow {
  id: number;
  targetKind: IcalTargetKind;
  targetId: number;
  channel: IcalChannel;
  nonce: string;
  tokenHash: string;
  fetchCount: number;
  lastFetchedAt: number | null;
  createdAt: number;
}

const toExport = (r: any): ExportRow => ({
  id: Number(r.id), targetKind: r.target_kind, targetId: Number(r.target_id), channel: r.channel, nonce: String(r.nonce), tokenHash: String(r.token_hash),
  fetchCount: Number(r.fetch_count ?? 0), lastFetchedAt: r.last_fetched_at == null ? null : Number(r.last_fetched_at), createdAt: Number(r.created_at),
});

function serverKey(): string {
  const k = sessionSecret();
  if (!k) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Falta la clave del servidor (JWT_SECRET): no se pueden emitir enlaces de calendario." });
  return k;
}

/** URL pública del enlace, o null si la clave del servidor cambió desde que se emitió (hay que rotarlo). */
async function exportUrl(e: Pick<ExportRow, "nonce" | "tokenHash">): Promise<string | null> {
  const key = sessionSecret();
  if (!key) return null;
  const tenant = getTenantIdOrDefault();
  const token = deriveExportToken(e.nonce, tenant, key);
  if (exportTokenHash(token, tenant) !== e.tokenHash) return null;
  const { publicUrl } = await import("./netPublic/html");
  return publicUrl(`/ical/${token}.ics`);
}

/** Emite (o rota) el enlace de exportación del destino y canal: el anterior deja de valer en la misma transacción. */
export function issueExport(input: { targetKind: IcalTargetKind; targetId: number; channel: IcalChannel; actor: string; now?: number }) {
  const now = input.now ?? Date.now();
  return panel(async () => {
    await assertAvailable();
    const key = serverKey();
    return withIcalDb(async (d) => {
      if (!(await resolveTarget(d, input.targetKind, input.targetId))) bad("La tipología o habitación no existe.");
      const tenant = getTenantIdOrDefault();
      const nonce = newExportNonce();
      const hash = exportTokenHash(deriveExportToken(nonce, tenant, key), tenant);
      const id = await d.transaction(async (tx) => {
        await tx.execute(sql`UPDATE hotel_ical_exports SET status = 'revoked', revoked_at = ${now}, revoked_by = ${input.actor.slice(0, 100)}
          WHERE target_kind = ${input.targetKind} AND target_id = ${input.targetId} AND channel = ${input.channel} AND status = 'active'`);
        return (await affected(tx, sql`INSERT INTO hotel_ical_exports (target_kind, target_id, channel, nonce, token_hash, status, created_by, created_at)
          VALUES (${input.targetKind}, ${input.targetId}, ${input.channel}, ${nonce}, ${hash}, 'active', ${input.actor.slice(0, 100)}, ${now})`)).insertId;
      });
      return { id, url: await exportUrl({ nonce, tokenHash: hash }) };
    });
  });
}

export function revokeExport(id: number, actor: string, now = Date.now()) {
  return panel(async () => {
    await assertAvailable();
    return withIcalDb(async (d) => ({
      revoked: (await affected(d, sql`UPDATE hotel_ical_exports SET status = 'revoked', revoked_at = ${now}, revoked_by = ${actor.slice(0, 100)} WHERE id = ${id} AND status = 'active'`)).affectedRows > 0,
    }));
  });
}

/**
 * Enlace activo de un token. Cualquier otro caso (formato, inexistente, de otra empresa o revocado) es null, sin
 * distinguir. Sin la migración, `IcalNotInstalled`.
 */
export async function resolveExport(token: unknown): Promise<ExportRow | null> {
  if (typeof token !== "string" || !ICAL_TOKEN_RE.test(token)) return null;
  return withIcalDb(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM hotel_ical_exports WHERE token_hash = ${exportTokenHash(token, getTenantIdOrDefault())} AND status = 'active' LIMIT 1`);
    return r ? toExport(r) : null;
  });
}

/** Noches no disponibles del destino tal como las verá el canal del enlace (lo importado de ese canal no cuenta). */
export async function busyNightsFor(d: Exec, e: Pick<ExportRow, "targetKind" | "targetId" | "channel">, from: string, to: string, now = Date.now()): Promise<{ target: IcalTarget | null; nights: string[] }> {
  const target = await resolveTarget(d, e.targetKind, e.targetId);
  if (!target) return { target: null, nights: [] };
  const exclude = (await rows(d, sql`SELECT id FROM hotel_ical_feeds WHERE target_kind = ${e.targetKind} AND target_id = ${e.targetId} AND channel = ${e.channel}`)).map((r) => Number(r.id));
  const [type] = await rows(d, sql`SELECT totalUnits FROM room_types WHERE id = ${target.roomTypeId}`);
  const total = Number(type?.totalUnits ?? 0);
  const occ = (await hotelOccupancy(d, [target.roomTypeId], from, to, now, undefined, { excludeFeedIds: exclude })).get(target.roomTypeId) ?? new Map<string, number>();
  const blocks = new Map((await rows(d, sql`SELECT date, availableUnits FROM room_blocks WHERE roomTypeId = ${target.roomTypeId} AND date >= ${from} AND date < ${to}`)).map((b) => [String(b.date), Number(b.availableUnits)]));
  const busy = new Set<string>();
  for (const n of nightsOf(from, to)) if (nightCapacity(total, blocks.get(n)) - (occ.get(n) ?? 0) <= 0) busy.add(n);
  if (target.kind === "room") {
    // La habitación concreta: sus reservas asignadas vivas y lo que marcan otros canales para ella
    const assigned = await rows(d, sql`
      SELECT a.check_in, a.check_out, r.status, r.status_reservation, r.hold_status, r.hold_expires_at
      FROM hotel_room_assignments a JOIN reservations r ON r.id = a.reservation_id
      WHERE a.hotel_room_id = ${target.id} AND a.check_in < ${to} AND a.check_out > ${from}`);
    for (const a of assigned) {
      const expires = a.hold_expires_at == null ? null : Number(a.hold_expires_at);
      const live = reservationOccupies({
        checkIn: a.check_in, checkOut: a.check_out, status: a.status, statusReservation: a.status_reservation, holdStatus: a.hold_status,
        holdLive: a.hold_status !== "retenida" || expires === null || expires > now,
      }) || a.status_reservation === "EN_CURSO";
      if (!live) continue;
      for (const n of nightsOf(a.check_in > from ? a.check_in : from, a.check_out < to ? a.check_out : to)) busy.add(n);
    }
    for (const b of await externalBlockRows(d, [target.roomTypeId], from, to, { excludeFeedIds: exclude })) {
      if (b.hotelRoomId !== target.id) continue;
      for (const n of nightsOf(b.start > from ? b.start : from, b.end < to ? b.end : to)) busy.add(n);
    }
  }
  return { target, nights: Array.from(busy) };
}

/** VCALENDAR del enlace (anota la consulta). Null si el destino ya no existe. */
export function exportCalendar(e: ExportRow, now = Date.now()): Promise<string | null> {
  return withIcalDb(async (d) => {
    const today = todayInTimeZone(new Date(now));
    const from = addDays(today, -1);
    const to = addDays(today, ICAL_LIMITS.exportDays);
    const { target, nights } = await busyNightsFor(d, e, from, to, now);
    if (!target) return null;
    await d.execute(sql`UPDATE hotel_ical_exports SET fetch_count = fetch_count + 1, last_fetched_at = ${now} WHERE id = ${e.id}`);
    return buildCalendar({ name: target.name, seed: `${e.id}:${e.nonce}`, ranges: nightRanges(nights), now: new Date(now) });
  });
}

// ─── Importación ─────────────────────────────────────────────────────────────

interface FeedRow {
  id: number;
  targetKind: IcalTargetKind;
  targetId: number;
  channel: IcalChannel;
  label: string | null;
  url: string;
  status: "active" | "paused" | "archived";
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  eventCount: number;
  lastAdded: number;
  lastUpdated: number;
  lastCancelled: number;
  createdAt: number;
}

const n0 = (v: unknown) => (v == null ? null : Number(v));
const toFeed = (r: any): FeedRow => ({
  id: Number(r.id), targetKind: r.target_kind, targetId: Number(r.target_id), channel: r.channel, label: r.label ?? null, url: String(r.url), status: r.status,
  lastAttemptAt: n0(r.last_attempt_at), lastSuccessAt: n0(r.last_success_at), lastStatus: r.last_status ?? null, lastError: r.last_error ?? null,
  consecutiveFailures: Number(r.consecutive_failures ?? 0), eventCount: Number(r.event_count ?? 0), lastAdded: Number(r.last_added ?? 0),
  lastUpdated: Number(r.last_updated ?? 0), lastCancelled: Number(r.last_cancelled ?? 0), createdAt: Number(r.created_at),
});

/** Alta de una URL de importación. La primera de la empresa enciende la sincronización automática. */
export function addFeed(input: { targetKind: IcalTargetKind; targetId: number; channel: IcalChannel; label?: string | null; url: string; actor: string; now?: number }) {
  const now = input.now ?? Date.now();
  return panel(async () => {
    await assertAvailable();
    const u = normalizeFeedUrl(input.url);
    if (!u.ok) bad(u.error);
    const url = (u as { url: string }).url;
    return withIcalDb(async (d) => {
      if (!(await resolveTarget(d, input.targetKind, input.targetId))) bad("La tipología o habitación no existe.");
      const [{ n }] = await rows(d, sql`SELECT COUNT(*) AS n FROM hotel_ical_feeds WHERE status <> 'archived'`);
      if (Number(n) >= ICAL_LIMITS.maxFeeds) bad(`Como máximo ${ICAL_LIMITS.maxFeeds} URLs de importación.`);
      const [dup] = await rows(d, sql`SELECT id FROM hotel_ical_feeds WHERE status <> 'archived' AND url = ${url} AND target_kind = ${input.targetKind} AND target_id = ${input.targetId} LIMIT 1`);
      if (dup) bad("Esa URL ya está configurada para este destino.");
      const { insertId } = await affected(d, sql`INSERT INTO hotel_ical_feeds (target_kind, target_id, channel, label, url, status, created_by, created_at, updated_at)
        VALUES (${input.targetKind}, ${input.targetId}, ${input.channel}, ${input.label?.trim().slice(0, 120) || null}, ${url}, 'active', ${input.actor.slice(0, 100)}, ${now}, ${now})`);
      await writeAutoSync(d, true, input.actor, now, true);
      return { id: insertId };
    });
  });
}

/** Pausa, reactiva o archiva una URL. Pausada o archivada, sus bloqueos dejan de contar; archivada, se cancelan. */
export function setFeedStatus(id: number, status: "active" | "paused" | "archived", now = Date.now()) {
  return panel(async () => {
    await assertAvailable();
    return withIcalDb(async (d) => {
      const r = await affected(d, sql`UPDATE hotel_ical_feeds SET status = ${status}, updated_at = ${now} WHERE id = ${id} AND status <> 'archived'`);
      if (!r.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "URL de importación no encontrada." });
      if (status === "archived") await d.execute(sql`UPDATE hotel_ical_blocks SET status = 'cancelled', cancelled_at = ${now}, updated_at = ${now} WHERE feed_id = ${id} AND status = 'active'`);
      return { ok: true };
    });
  });
}

export interface SyncResult {
  feedId: number;
  ok: boolean;
  error?: string;
  events?: number;
  added?: number;
  updated?: number;
  cancelled?: number;
}

type Fetcher = (url: string) => Promise<{ ok: true; body: string } | { ok: false; error: string }>;

async function recordFailure(d: Exec, id: number, error: string, now: number): Promise<SyncResult> {
  await d.execute(sql`UPDATE hotel_ical_feeds SET last_attempt_at = ${now}, last_status = 'error', last_error = ${error.slice(0, 500)},
    consecutive_failures = consecutive_failures + 1, updated_at = ${now} WHERE id = ${id}`);
  return { feedId: id, ok: false, error };
}

/**
 * Sincroniza una URL: descarga, lee y aplica las altas, cambios y bajas por UID. Un fallo no toca los bloqueos.
 * `fetcher` se sustituye en las pruebas.
 */
export async function syncFeedNow(feedId: number, opts: { now?: number; fetcher?: Fetcher; signal?: AbortSignal } = {}): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  // La señal del trabajo (tiempo máximo por empresa) corta también la descarga en curso
  const fetcher = opts.fetcher ?? ((url: string) => fetchIcal(url, { signal: opts.signal }));
  return withIcalDb(async (d) => {
    const [row] = await rows(d, sql`SELECT * FROM hotel_ical_feeds WHERE id = ${feedId}`);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "URL de importación no encontrada." });
    const feed = toFeed(row);
    if (feed.status !== "active") return { feedId, ok: false, error: "La URL está en pausa o archivada." };
    const target = await resolveTarget(d, feed.targetKind, feed.targetId);
    if (!target) return recordFailure(d, feedId, "La tipología o habitación de esta URL ya no existe.", now);
    const got = await fetcher(feed.url);
    if (!got.ok) return recordFailure(d, feedId, got.error, now);
    const parsed = parseCalendar(got.body, { today: todayInTimeZone(new Date(now)) });
    if (parsed.invalid) return recordFailure(d, feedId, "Lo descargado no es un calendario iCal (falta BEGIN:VCALENDAR): revisa la URL.", now);
    const hotelRoomId = target.kind === "room" ? target.id : null;
    const plan = await d.transaction(async (tx) => {
      // Una sincronización a la vez por URL (botón y trabajo): bloqueo de la fila de la URL
      await tx.execute(sql`SELECT id FROM hotel_ical_feeds WHERE id = ${feedId} FOR UPDATE`);
      const stored: StoredBlock[] = (await rows(tx, sql`SELECT id, uid_hash, start_date, end_date, status FROM hotel_ical_blocks WHERE feed_id = ${feedId}`)).map((b) => ({
        id: Number(b.id), uidHash: String(b.uid_hash), start: String(b.start_date), end: String(b.end_date), status: b.status,
      }));
      const p = planBlocks(stored, parsed.events);
      for (const e of p.insert) {
        await tx.execute(sql`INSERT INTO hotel_ical_blocks (feed_id, uid_hash, uid, room_type_id, hotel_room_id, start_date, end_date, status, first_seen_at, updated_at)
          VALUES (${feedId}, ${uidHash(e.uid)}, ${e.uid}, ${target.roomTypeId}, ${hotelRoomId}, ${e.start}, ${e.end}, 'active', ${now}, ${now})
          ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), end_date = VALUES(end_date), status = 'active', cancelled_at = NULL, updated_at = VALUES(updated_at)`);
      }
      for (const u of p.update) {
        await tx.execute(sql`UPDATE hotel_ical_blocks SET start_date = ${u.event.start}, end_date = ${u.event.end}, status = 'active', cancelled_at = NULL, updated_at = ${now} WHERE id = ${u.id}`);
      }
      if (p.cancel.length) {
        await tx.execute(sql`UPDATE hotel_ical_blocks SET status = 'cancelled', cancelled_at = ${now}, updated_at = ${now}
          WHERE feed_id = ${feedId} AND status = 'active' AND id IN (${sql.join(p.cancel.map((i) => sql`${i}`), sql`, `)})`);
      }
      // La habitación pudo cambiar de tipología: los bloqueos siguen a su destino
      await tx.execute(sql`UPDATE hotel_ical_blocks SET room_type_id = ${target.roomTypeId}, hotel_room_id = ${hotelRoomId} WHERE feed_id = ${feedId} AND (room_type_id <> ${target.roomTypeId} OR NOT (hotel_room_id <=> ${hotelRoomId}))`);
      await tx.execute(sql`UPDATE hotel_ical_feeds SET last_attempt_at = ${now}, last_success_at = ${now}, last_status = 'ok', last_error = NULL, consecutive_failures = 0,
        event_count = ${parsed.events.length}, last_added = ${p.insert.length}, last_updated = ${p.update.length}, last_cancelled = ${p.cancel.length}, updated_at = ${now}
        WHERE id = ${feedId}`);
      return p;
    });
    return { feedId, ok: true, events: parsed.events.length, added: plan.insert.length, updated: plan.update.length, cancelled: plan.cancel.length };
  });
}

/** «Sincronizar ahora» del panel: una URL o todas las activas de la empresa (sin esperar al intervalo). */
export function syncNow(feedId: number | null, opts: { now?: number; fetcher?: Fetcher } = {}) {
  return panel(async () => {
    await assertAvailable();
    if (feedId != null) return [await syncFeedNow(feedId, opts)];
    const ids = await withIcalDb(async (d) => (await rows(d, sql`SELECT id FROM hotel_ical_feeds WHERE status = 'active' ORDER BY id LIMIT ${ICAL_LIMITS.feedsPerRun}`)).map((r) => Number(r.id)));
    // De 5 en 5: la respuesta del panel no espera a cada canal por turno
    const out: SyncResult[] = [];
    for (let i = 0; i < ids.length; i += 5) {
      out.push(...(await Promise.all(ids.slice(i, i + 5).map((id) => syncFeedNow(id, opts).catch((e): SyncResult => ({ feedId: id, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" }))))));
    }
    return out;
  });
}

/**
 * Pasada del trabajo programado en la empresa en curso: si la sincronización automática está encendida, las URLs
 * activas que llevan más de 15 minutos sin intentarse (las más antiguas primero, con tope por pasada).
 */
export async function syncDueFeeds(opts: { now?: number; fetcher?: Fetcher; signal?: AbortSignal } = {}): Promise<{ skipped?: string; results: SyncResult[] }> {
  const now = opts.now ?? Date.now();
  const due = await withIcalDb(async (d) => {
    if (!(await autoSyncEnabled(d))) return null;
    const limit = now - ICAL_LIMITS.syncEveryMinutes * 60_000 + 30_000; // margen: el cron no cae justo en el minuto
    return (await rows(d, sql`SELECT id FROM hotel_ical_feeds WHERE status = 'active' AND (last_attempt_at IS NULL OR last_attempt_at < ${limit})
      ORDER BY last_attempt_at IS NOT NULL, last_attempt_at, id LIMIT ${ICAL_LIMITS.feedsPerRun}`)).map((r) => Number(r.id));
  });
  if (due == null) return { skipped: "apagada", results: [] };
  const results: SyncResult[] = [];
  for (const id of due) {
    if (opts.signal?.aborted) break;
    try {
      results.push(await syncFeedNow(id, opts));
    } catch (e) {
      results.push({ feedId: id, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  return { results };
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function icalPanel(now = Date.now()) {
  return panel(async () => {
    await assertAvailable();
    return withIcalDb(async (d) => {
      const types = (await rows(d, sql`SELECT id, name, totalUnits, isActive FROM room_types ORDER BY sortOrder, id`)).map((t) => ({
        id: Number(t.id), name: String(t.name), totalUnits: Number(t.totalUnits), isActive: Number(t.isActive) === 1,
      }));
      const rooms = await roomsOf(d);
      const exportsList = await Promise.all(
        (await rows(d, sql`SELECT * FROM hotel_ical_exports WHERE status = 'active' ORDER BY id`)).map(toExport).map(async (e) => ({
          id: e.id, targetKind: e.targetKind, targetId: e.targetId, channel: e.channel, url: await exportUrl(e), fetchCount: e.fetchCount, lastFetchedAt: e.lastFetchedAt, createdAt: e.createdAt,
        })),
      );
      const today = todayInTimeZone(new Date(now));
      const upcoming = new Map(
        (await rows(d, sql`SELECT feed_id, COUNT(*) AS n, MIN(start_date) AS next_start FROM hotel_ical_blocks WHERE status = 'active' AND end_date > ${today} GROUP BY feed_id`))
          .map((r) => [Number(r.feed_id), { upcoming: Number(r.n), nextStart: r.next_start ? String(r.next_start) : null }]),
      );
      const feeds = (await rows(d, sql`SELECT * FROM hotel_ical_feeds WHERE status <> 'archived' ORDER BY id`)).map(toFeed).map((f) => ({
        id: f.id, targetKind: f.targetKind, targetId: f.targetId, channel: f.channel, label: f.label, url: maskUrl(f.url), status: f.status,
        lastAttemptAt: f.lastAttemptAt, lastSuccessAt: f.lastSuccessAt, lastStatus: f.lastStatus, lastError: f.lastError, consecutiveFailures: f.consecutiveFailures,
        eventCount: f.eventCount, lastAdded: f.lastAdded, lastUpdated: f.lastUpdated, lastCancelled: f.lastCancelled,
        upcoming: upcoming.get(f.id)?.upcoming ?? 0, nextStart: upcoming.get(f.id)?.nextStart ?? null,
      }));
      const blocks = (await rows(d, sql`SELECT b.feed_id, b.start_date, b.end_date FROM hotel_ical_blocks b JOIN hotel_ical_feeds f ON f.id = b.feed_id AND f.status = 'active'
        WHERE b.status = 'active' AND b.end_date > ${today} ORDER BY b.start_date, b.id LIMIT 100`)).map((b) => ({ feedId: Number(b.feed_id), start: String(b.start_date), end: String(b.end_date) }));
      return { autoSync: await autoSyncEnabled(d), syncEveryMinutes: ICAL_LIMITS.syncEveryMinutes, channels: ICAL_CHANNELS, types, rooms, exports: exportsList, feeds, blocks };
    });
  });
}
