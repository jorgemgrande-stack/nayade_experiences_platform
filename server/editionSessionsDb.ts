/**
 * Sesiones de una convocatoria (lógica de BD): un paquete que se vende una vez con varias fechas.
 *
 * - No hay inscripción por sesión: las inscripciones confirmadas de la convocatoria son las participantes de todas sus
 *   sesiones (una sola venta y un solo cobro por paquete).
 * - Cuando una convocatoria tiene sesiones, sus fechas (`starts_at`/`ends_at`) se recalculan a partir de la primera y la
 *   última sesión vigente; así la web, el CRM, los avisos y el filtro de «terminadas» usan las mismas fechas.
 * - `private_note` es solo para el equipo: nunca sale por las consultas públicas ni en el calendario operativo.
 *
 * Sin la migración 0077 (tabla `edition_sessions`) las lecturas públicas y de resumen devuelven vacío y las convocatorias
 * siguen funcionando como siempre; el panel avisa de que las sesiones aún no están activadas.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { cleanText } from "../shared/editions";
import {
  SESSION_LIMITS,
  chronologicalOrder,
  deriveEditionRange,
  findDuplicateSession,
  normalizeTime,
  toPublicSessions,
  validateSessionInput,
  weeklySeriesDates,
  type PublicEditionSession,
  type SessionInput,
  type SessionStatus,
} from "../shared/editionSessions";
import { EditionError, isMissingEditionsSchema } from "./editionsDb";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r?.affectedRows ?? 0), insertId: Number(r?.insertId ?? 0) };
}

// ─── Modelo ──────────────────────────────────────────────────────────────────

export interface EditionSession {
  id: number;
  editionId: number;
  position: number;
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  title: string;
  status: SessionStatus;
  /** Solo para el equipo; no se publica */
  privateNote: string;
  createdAt: number;
  updatedAt: number;
}

/** Columnas con la fecha y la hora como texto (mysql2 devuelve DATE como objeto Date y lo movería de día). */
const COLS = sql`id, edition_id, position, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes, timezone, title, status, private_note, created_at, updated_at`;

export function toSession(r: Record<string, any>): EditionSession {
  const status = String(r.status ?? "scheduled");
  return {
    id: Number(r.id),
    editionId: Number(r.edition_id),
    position: Number(r.position ?? 0),
    startsOn: String(r.starts_on ?? "").slice(0, 10),
    startTime: normalizeTime(r.start_time),
    durationMinutes: r.duration_minutes == null ? null : Number(r.duration_minutes),
    timezone: String(r.timezone ?? "Europe/Madrid"),
    title: String(r.title ?? ""),
    status: (status === "done" || status === "cancelled" ? status : "scheduled") as SessionStatus,
    privateNote: String(r.private_note ?? ""),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Normaliza y valida lo que llega del panel (el servidor no se fía de la validación del navegador). */
export function parseSessionInput(i: SessionInput): SessionInput {
  const clean: SessionInput = {
    startsOn: String(i.startsOn ?? "").trim(),
    startTime: i.startTime == null || String(i.startTime).trim() === "" ? null : String(i.startTime).trim(),
    durationMinutes: i.durationMinutes ?? null,
    timezone: String(i.timezone ?? "").trim(),
    title: cleanText(i.title ?? "", SESSION_LIMITS.title),
    status: i.status,
    privateNote: cleanText(i.privateNote ?? "", SESSION_LIMITS.privateNote, true),
  };
  const first = Object.values(validateSessionInput(clean))[0];
  if (first) throw new EditionError("BAD_REQUEST", first);
  return clean;
}

async function lockEdition(exec: Exec, editionId: number): Promise<{ id: number; timezone: string; status: string }> {
  const [e] = await rows(exec, sql`SELECT id, timezone, status FROM product_editions WHERE id = ${editionId} FOR UPDATE`);
  if (!e) throw new EditionError("NOT_FOUND", "Esta convocatoria ya no existe.");
  return { id: Number(e.id), timezone: String(e.timezone ?? "Europe/Madrid"), status: String(e.status) };
}

async function sessionsOf(exec: Exec, editionId: number): Promise<EditionSession[]> {
  const r = await rows(exec, sql`SELECT ${COLS} FROM edition_sessions WHERE edition_id = ${editionId} ORDER BY position ASC, id ASC`);
  return r.map(toSession);
}

/** Vuelve a numerar en orden cronológico (los empates conservan el orden manual). */
async function renumber(exec: Exec, editionId: number, now: number): Promise<void> {
  const ordered = chronologicalOrder(await sessionsOf(exec, editionId));
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].position !== i + 1) await run(exec, sql`UPDATE edition_sessions SET position = ${i + 1}, updated_at = ${now} WHERE id = ${ordered[i].id}`);
  }
}

/**
 * Fechas de la convocatoria a partir de sus sesiones vigentes. Sin sesiones vigentes no se toca nada (la convocatoria
 * conserva las fechas que tenga). Devuelve si cambió algo.
 */
export async function syncEditionDates(exec: Exec, editionId: number, now = Date.now()): Promise<boolean> {
  const [e] = await rows(exec, sql`SELECT id, timezone, starts_at, ends_at FROM product_editions WHERE id = ${editionId}`);
  if (!e) return false;
  const range = deriveEditionRange(await sessionsOf(exec, editionId), String(e.timezone ?? "Europe/Madrid"));
  if (!range) return false;
  if (Number(e.starts_at) === range.startsAt && (e.ends_at == null ? null : Number(e.ends_at)) === range.endsAt) return false;
  await run(exec, sql`UPDATE product_editions SET starts_at = ${range.startsAt}, ends_at = ${range.endsAt}, updated_at = ${now} WHERE id = ${editionId}`);
  return true;
}

/** Igual que `syncEditionDates`, pero sin fallar si la empresa aún no tiene la tabla de sesiones (tras editar una convocatoria). */
export async function syncEditionDatesIfAny(editionId: number, now = Date.now()): Promise<void> {
  try {
    await syncEditionDates(await db(), editionId, now);
  } catch (err) {
    if (!isMissingEditionsSchema(err)) throw err;
  }
}

// ─── Administración ──────────────────────────────────────────────────────────

/** Sesiones de una convocatoria (con la nota interna: solo panel de administración). */
export async function listSessions(editionId: number): Promise<EditionSession[]> {
  const d = await db();
  return sessionsOf(d, editionId);
}

/** Número de sesiones (no canceladas) por convocatoria; vacío si la empresa no tiene aún la tabla. */
export async function sessionCounts(exec: Exec, editionIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!editionIds.length) return out;
  try {
    const r = await rows<{ edition_id: number; n: number }>(
      exec,
      sql`SELECT edition_id, COUNT(*) AS n FROM edition_sessions WHERE status <> 'cancelled' AND edition_id IN (${sql.join(editionIds.map((i) => sql`${i}`), sql`, `)}) GROUP BY edition_id`,
    );
    for (const x of r) out.set(Number(x.edition_id), Number(x.n));
  } catch (err) {
    if (!isMissingEditionsSchema(err)) throw err;
  }
  return out;
}

function checkDuplicate(existing: EditionSession[], candidate: { startsOn: string; startTime: string | null; status: string }, exceptId?: number) {
  if (candidate.status === "cancelled") return;
  const dup = findDuplicateSession(existing, candidate, exceptId);
  if (dup) throw new EditionError("CONFLICT", `Ya hay una sesión el ${dup.startsOn}${dup.startTime ? ` a las ${dup.startTime}` : " con la hora por confirmar"}.`);
}

export async function createSession(editionId: number, input: SessionInput, now = Date.now()): Promise<EditionSession> {
  const clean = parseSessionInput(input);
  const d = await db();
  const id = await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    await lockEdition(t, editionId);
    const existing = await sessionsOf(t, editionId);
    if (existing.length >= SESSION_LIMITS.perEdition) throw new EditionError("BAD_REQUEST", `Una convocatoria puede tener como máximo ${SESSION_LIMITS.perEdition} sesiones.`);
    checkDuplicate(existing, clean);
    const r = await run(
      t,
      sql`INSERT INTO edition_sessions (edition_id, position, starts_on, start_time, duration_minutes, timezone, title, status, private_note, created_at, updated_at)
          VALUES (${editionId}, ${existing.length + 1}, ${clean.startsOn}, ${clean.startTime}, ${clean.durationMinutes}, ${clean.timezone}, ${clean.title || null}, ${clean.status}, ${clean.privateNote || null}, ${now}, ${now})`,
    );
    await renumber(t, editionId, now);
    await syncEditionDates(t, editionId, now);
    return r.insertId;
  });
  const [row] = await rows(d, sql`SELECT ${COLS} FROM edition_sessions WHERE id = ${id}`);
  return toSession(row);
}

export interface WeeklySeriesInput {
  firstDate: string;
  count: number;
  everyWeeks?: number;
  startTime: string | null;
  durationMinutes: number | null;
  title?: string;
}

/** «N sesiones semanales desde una fecha». Todo o nada: si una fecha choca con otra sesión, no se crea ninguna. */
export async function createWeeklySeries(editionId: number, input: WeeklySeriesInput, now = Date.now()): Promise<EditionSession[]> {
  let dates: string[];
  try {
    dates = weeklySeriesDates(input.firstDate, input.count, input.everyWeeks ?? 1);
  } catch (e) {
    throw new EditionError("BAD_REQUEST", (e as Error).message);
  }
  const d = await db();
  await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    const ed = await lockEdition(t, editionId);
    const existing = await sessionsOf(t, editionId);
    if (existing.length + dates.length > SESSION_LIMITS.perEdition) throw new EditionError("BAD_REQUEST", `Una convocatoria puede tener como máximo ${SESSION_LIMITS.perEdition} sesiones (ya tiene ${existing.length}).`);
    const base = parseSessionInput({ startsOn: dates[0], startTime: input.startTime, durationMinutes: input.durationMinutes, timezone: ed.timezone, title: input.title ?? "", status: "scheduled", privateNote: "" });
    let pos = existing.length;
    for (const day of dates) {
      checkDuplicate(existing, { startsOn: day, startTime: base.startTime, status: "scheduled" });
      await run(
        t,
        sql`INSERT INTO edition_sessions (edition_id, position, starts_on, start_time, duration_minutes, timezone, title, status, private_note, created_at, updated_at)
            VALUES (${editionId}, ${++pos}, ${day}, ${base.startTime}, ${base.durationMinutes}, ${base.timezone}, ${base.title || null}, 'scheduled', NULL, ${now}, ${now})`,
      );
    }
    await renumber(t, editionId, now);
    await syncEditionDates(t, editionId, now);
  });
  return listSessions(editionId);
}

export async function updateSession(id: number, input: SessionInput, now = Date.now()): Promise<EditionSession> {
  const clean = parseSessionInput(input);
  const d = await db();
  await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    // Bloqueo ANTES de cualquier lectura sin bloqueo: así la transacción ve lo que otras ya confirmaron
    const [cur] = await rows(t, sql`SELECT edition_id FROM edition_sessions WHERE id = ${id} FOR UPDATE`);
    if (!cur) throw new EditionError("NOT_FOUND", "Esta sesión ya no existe.");
    const editionId = Number(cur.edition_id);
    await lockEdition(t, editionId);
    checkDuplicate(await sessionsOf(t, editionId), clean, id);
    await run(
      t,
      sql`UPDATE edition_sessions SET starts_on = ${clean.startsOn}, start_time = ${clean.startTime}, duration_minutes = ${clean.durationMinutes}, timezone = ${clean.timezone},
          title = ${clean.title || null}, status = ${clean.status}, private_note = ${clean.privateNote || null}, updated_at = ${now} WHERE id = ${id}`,
    );
    await renumber(t, editionId, now);
    await syncEditionDates(t, editionId, now);
  });
  const [row] = await rows(d, sql`SELECT ${COLS} FROM edition_sessions WHERE id = ${id}`);
  return toSession(row);
}

/** Marca una sesión como realizada, cancelada o de nuevo programada (sin tocar el resto de sus datos). */
export async function setSessionStatus(id: number, status: SessionStatus, now = Date.now()): Promise<EditionSession> {
  const d = await db();
  await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    const [cur] = await rows(t, sql`SELECT edition_id FROM edition_sessions WHERE id = ${id} FOR UPDATE`);
    if (!cur) throw new EditionError("NOT_FOUND", "Esta sesión ya no existe.");
    const editionId = Number(cur.edition_id);
    await lockEdition(t, editionId);
    await run(t, sql`UPDATE edition_sessions SET status = ${status}, updated_at = ${now} WHERE id = ${id}`);
    await renumber(t, editionId, now);
    await syncEditionDates(t, editionId, now);
  });
  const [row] = await rows(d, sql`SELECT ${COLS} FROM edition_sessions WHERE id = ${id}`);
  return toSession(row);
}

export async function deleteSession(id: number, now = Date.now()): Promise<{ editionId: number }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    const [cur] = await rows(t, sql`SELECT edition_id FROM edition_sessions WHERE id = ${id} FOR UPDATE`);
    if (!cur) throw new EditionError("NOT_FOUND", "Esta sesión ya no existe.");
    const editionId = Number(cur.edition_id);
    await lockEdition(t, editionId);
    // Sin borrado físico: una sesión retirada queda cancelada (historial y asistencia futura); deja de verse en la web
    await run(t, sql`UPDATE edition_sessions SET status = 'cancelled', updated_at = ${now} WHERE id = ${id}`);
    await renumber(t, editionId, now);
    await syncEditionDates(t, editionId, now);
    return { editionId };
  });
}

/** Orden manual: `ids` tiene que ser exactamente el conjunto de sesiones de la convocatoria. */
export async function reorderSessions(editionId: number, ids: number[], now = Date.now()): Promise<EditionSession[]> {
  const d = await db();
  await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    await lockEdition(t, editionId);
    const cur = await sessionsOf(t, editionId);
    const have = new Set(cur.map((s) => s.id));
    if (ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((x) => have.has(x))) throw new EditionError("BAD_REQUEST", "La lista de sesiones no coincide con las de la convocatoria. Recarga la página.");
    for (let i = 0; i < ids.length; i++) await run(t, sql`UPDATE edition_sessions SET position = ${i + 1}, updated_at = ${now} WHERE id = ${ids[i]} AND edition_id = ${editionId}`);
  });
  return listSessions(editionId);
}

// ─── Web pública ─────────────────────────────────────────────────────────────

/** Sesiones publicables de varias convocatorias (sin nota interna ni canceladas). Vacío si la empresa no tiene la tabla. */
export async function listPublicSessions(exec: Exec, editionIds: number[]): Promise<Map<number, PublicEditionSession[]>> {
  const out = new Map<number, PublicEditionSession[]>();
  if (!editionIds.length) return out;
  let r: Record<string, any>[];
  try {
    // Sin `private_note` en la consulta: lo que no se lee no se puede publicar por error
    r = await rows(
      exec,
      sql`SELECT id, edition_id, position, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes, timezone, status
          FROM edition_sessions WHERE status <> 'cancelled' AND edition_id IN (${sql.join(editionIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY edition_id, position, id`,
    );
  } catch (err) {
    if (isMissingEditionsSchema(err)) return out;
    throw err;
  }
  const by = new Map<number, EditionSession[]>();
  for (const x of r) {
    const s = toSession(x);
    by.set(s.editionId, [...(by.get(s.editionId) ?? []), s]);
  }
  by.forEach((list, id) => out.set(id, toPublicSessions(list)));
  return out;
}

// ─── Calendario operativo ────────────────────────────────────────────────────

export interface CalendarSessionEvent {
  sessionId: number;
  editionId: number;
  experienceId: number;
  productTitle: string;
  editionLabel: string;
  editionStatus: string;
  /** «YYYY-MM-DD» */
  scheduledDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  title: string;
  status: SessionStatus;
  /** Número de la sesión dentro del paquete (sin contar las canceladas) y total */
  index: number;
  total: number;
  /** Plazas confirmadas (suma de las inscripciones confirmadas): participan en todas las sesiones */
  participants: number;
  confirmedEnrollments: number;
}

/**
 * Sesiones (no canceladas, de convocatorias no canceladas) entre dos días, para el calendario operativo. Solo lectura y
 * sin la nota interna. Vacío si la empresa no tiene aún las tablas.
 */
export async function listCalendarSessions(from: string, to: string, opts: { includeDrafts?: boolean } = {}): Promise<CalendarSessionEvent[]> {
  const d = await getDb();
  if (!d) return [];
  let r: Record<string, any>[];
  try {
    r = await rows(
      d,
      sql`SELECT s.id, s.edition_id, s.position, DATE_FORMAT(s.starts_on, '%Y-%m-%d') AS starts_on, TIME_FORMAT(s.start_time, '%H:%i') AS start_time, s.duration_minutes, s.timezone, s.title, s.status,
                 e.label, e.status AS edition_status, e.experience_id, x.title AS product_title,
                 (SELECT COUNT(*) FROM edition_sessions s2 WHERE s2.edition_id = s.edition_id AND s2.status <> 'cancelled' AND (s2.position < s.position OR (s2.position = s.position AND s2.id <= s.id))) AS idx,
                 (SELECT COUNT(*) FROM edition_sessions s3 WHERE s3.edition_id = s.edition_id AND s3.status <> 'cancelled') AS total,
                 (SELECT COALESCE(SUM(n.seats), 0) FROM edition_enrollments n WHERE n.edition_id = s.edition_id AND n.status = 'confirmada') AS participants,
                 (SELECT COUNT(*) FROM edition_enrollments n2 WHERE n2.edition_id = s.edition_id AND n2.status = 'confirmada') AS confirmed
          FROM edition_sessions s
          JOIN product_editions e ON e.id = s.edition_id
          LEFT JOIN experiences x ON x.id = e.experience_id
          WHERE s.status <> 'cancelled' AND e.status <> 'cancelled' AND (${opts.includeDrafts ? 1 : 0} = 1 OR e.status <> 'draft') AND s.starts_on >= ${from} AND s.starts_on <= ${to}
          ORDER BY s.starts_on ASC, s.start_time IS NULL, s.start_time ASC, s.id ASC
          LIMIT 1000`,
    );
  } catch (err) {
    if (isMissingEditionsSchema(err)) return [];
    throw err;
  }
  return r.map((x) => {
    const s = toSession(x);
    return {
      sessionId: s.id,
      editionId: s.editionId,
      experienceId: Number(x.experience_id),
      productTitle: String(x.product_title ?? ""),
      editionLabel: String(x.label ?? ""),
      editionStatus: String(x.edition_status ?? ""),
      scheduledDate: s.startsOn,
      startTime: s.startTime,
      durationMinutes: s.durationMinutes,
      timezone: s.timezone,
      title: s.title,
      status: s.status,
      index: Number(x.idx ?? 0),
      total: Number(x.total ?? 0),
      participants: Number(x.participants ?? 0),
      confirmedEnrollments: Number(x.confirmed ?? 0),
    };
  });
}
