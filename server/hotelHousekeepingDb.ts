/**
 * Hotel Net · housekeeping — acceso a datos: tareas de limpieza por habitación y día, asignadas a usuarios del panel de
 * la empresa (no hay tabla de empleados propia ni dependencia de Elephant People), e incidencias de habitación con tipos
 * configurables. La lógica vive en `hotelHousekeeping.ts`.
 *
 * Tablas de db/migrations/0038_hotel_housekeeping (fuera de drizzle/schema.ts, como las de 0032): sin la migración, cada
 * función responde con un error claro (`[module_not_installed]`).
 *
 * Cada cambio de estado de una tarea o incidencia que afecta a la habitación se hace en la misma transacción que
 * actualiza su estado operativo y su historial (`setRoomStateLocked`), con la tarea y la habitación bloqueadas.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { users } from "../drizzle/schema";
import {
  DEFAULT_INCIDENT_TYPES,
  HK_ASSIGNEE_ROLES,
  incidentTypeName,
  planTasks,
  roomStateForIncident,
  roomStateForTask,
  taskActorError,
  taskTransitionError,
  type HkRoomDay,
  type HkTaskKind,
  type HkTaskStatus,
  type IncidentStatus,
} from "./hotelHousekeeping";
import { addDaysIso } from "./hotelPms";
import { assignmentsForReservations, db, inTx, isMissingPmsSchema, listHotelReservations, rows, setRoomStateLocked, type Db, type Exec } from "./hotelPmsDb";

export const HOUSEKEEPING_NOT_INSTALLED_MESSAGE =
  "[module_not_installed] El housekeeping del hotel aún no está preparado en tu empresa: falta aplicar la actualización 0038_hotel_housekeeping de su base de datos.";

async function hk<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingPmsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: HOUSEKEEPING_NOT_INSTALLED_MESSAGE, cause: e });
    for (let x: any = e, i = 0; x && i < 5; x = x.cause, i++) {
      if (x.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya existe con ese nombre o para ese día.", cause: e });
    }
    throw e;
  }
}

function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

// ─── Personas ─────────────────────────────────────────────────────────────────

/** Usuarios activos del panel de la empresa a los que se pueden asignar tareas. */
export async function listHousekeepingAssignees(): Promise<Array<{ id: number; name: string }>> {
  const d = await db();
  const list = await d.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, [...HK_ASSIGNEE_ROLES])));
  return list
    .map((u) => ({ id: u.id, name: (u.name ?? "").trim() || u.email || `Usuario ${u.id}` }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function assertAssignee(userId: number) {
  const ok = (await listHousekeepingAssignees()).some((u) => u.id === userId);
  if (!ok) bad("La persona debe ser un usuario activo del panel de la empresa.");
}

// ─── Tareas ───────────────────────────────────────────────────────────────────

interface TaskRow {
  id: number;
  hotel_room_id: number;
  task_date: string;
  kind: string;
  status: string;
  assigned_user_id: number | null;
  notes: string | null;
  done_at: number | string | null;
  inspected_at: number | string | null;
  room_code: string;
  room_floor: string | null;
  room_status: string;
  room_type_name: string | null;
  user_name: string | null;
  user_email: string | null;
}

const TASK_SELECT = sql.raw(`
  SELECT t.id, t.hotel_room_id, t.task_date, t.kind, t.status, t.assigned_user_id, t.notes, t.done_at, t.inspected_at,
    h.code AS room_code, h.floor AS room_floor, h.operational_status AS room_status, rt.name AS room_type_name,
    u.name AS user_name, u.email AS user_email
  FROM hotel_housekeeping_tasks t
  JOIN hotel_rooms h ON h.id = t.hotel_room_id
  LEFT JOIN room_types rt ON rt.id = h.room_type_id
  LEFT JOIN users u ON u.id = t.assigned_user_id`);

const toTask = (r: TaskRow) => ({
  id: Number(r.id),
  hotelRoomId: Number(r.hotel_room_id),
  taskDate: r.task_date,
  kind: r.kind,
  status: r.status,
  assignedUserId: r.assigned_user_id === null ? null : Number(r.assigned_user_id),
  assignedName: r.assigned_user_id === null ? null : (r.user_name ?? "").trim() || r.user_email || `Usuario ${r.assigned_user_id}`,
  notes: r.notes,
  doneAt: r.done_at === null ? null : Number(r.done_at),
  inspectedAt: r.inspected_at === null ? null : Number(r.inspected_at),
  roomCode: r.room_code,
  roomFloor: r.room_floor,
  roomStatus: r.room_status,
  roomTypeName: r.room_type_name,
});

export async function listHousekeepingTasks(date: string, f: { assignedUserId?: number } = {}) {
  return hk(async () => {
    const d = await db();
    const list = await rows<TaskRow>(d, sql`${TASK_SELECT}
      WHERE t.task_date = ${date} ${f.assignedUserId != null ? sql`AND t.assigned_user_id = ${f.assignedUserId}` : sql``}
      ORDER BY h.floor, h.sort_order, h.code`);
    return list.map(toTask);
  });
}

/** Salida y estancia de cada habitación ese día, desde las asignaciones de las reservas vivas. */
async function roomDays(exec: Pick<Db, "execute">, date: string): Promise<Map<number, HkRoomDay>> {
  const list = await listHotelReservations({ from: addDaysIso(date, -1), to: date, limit: 2000 }, exec);
  const byRes = await assignmentsForReservations(exec, list.map((r) => r.id));
  const out = new Map<number, HkRoomDay>();
  for (const r of list) {
    const a = byRes.get(r.id);
    if (!a || !a.active || r.statusReservation === "NO_SHOW") continue;
    const cur = out.get(a.hotelRoomId) ?? { departure: false, stayover: false };
    if (a.checkOut === date && a.checkIn < date) cur.departure = true;
    if (a.checkIn < date && date < a.checkOut) cur.stayover = true;
    out.set(a.hotelRoomId, cur);
  }
  return out;
}

/**
 * Genera las tareas del día: limpieza de salida en las habitaciones con salida, repaso en las ocupadas y limpieza en
 * las sucias sin huésped. Idempotente: una tarea por habitación y día.
 */
export async function generateHousekeepingTasks(date: string, userId: number | null) {
  return hk(async () => {
    const d = await db();
    const rooms = (await rows<{ id: number; is_active: number; operational_status: string }>(d, sql`
      SELECT id, is_active, operational_status FROM hotel_rooms`)).map((r) => ({ id: Number(r.id), isActive: !!Number(r.is_active), operationalStatus: r.operational_status }));
    const existing = new Set((await rows<{ hotel_room_id: number }>(d, sql`SELECT hotel_room_id FROM hotel_housekeeping_tasks WHERE task_date = ${date}`)).map((r) => Number(r.hotel_room_id)));
    const plan = planTasks(rooms, await roomDays(d, date), existing);
    const now = Date.now();
    let created = 0;
    for (const p of plan) {
      const [res] = (await d.execute(sql`
        INSERT INTO hotel_housekeeping_tasks (hotel_room_id, task_date, kind, status, created_by, created_at, updated_at)
        VALUES (${p.hotelRoomId}, ${date}, ${p.kind}, 'pendiente', ${userId}, ${now}, ${now})
        ON DUPLICATE KEY UPDATE id = id`)) as unknown as [{ affectedRows: number }];
      if (res.affectedRows === 1) created++;
    }
    return { created, skipped: plan.length - created };
  });
}

/** Tarea a petición (limpieza o repaso) para una habitación y día concretos. */
export async function createHousekeepingTask(input: { hotelRoomId: number; date: string; kind: HkTaskKind; assignedUserId: number | null; notes?: string; userId: number | null }) {
  return hk(async () => {
    const d = await db();
    const [room] = await rows<{ id: number }>(d, sql`SELECT id FROM hotel_rooms WHERE id = ${input.hotelRoomId}`);
    if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada" });
    if (input.assignedUserId != null) await assertAssignee(input.assignedUserId);
    const now = Date.now();
    await d.execute(sql`
      INSERT INTO hotel_housekeeping_tasks (hotel_room_id, task_date, kind, status, assigned_user_id, notes, created_by, created_at, updated_at)
      VALUES (${input.hotelRoomId}, ${input.date}, ${input.kind}, 'pendiente', ${input.assignedUserId}, ${input.notes?.trim() || null}, ${input.userId}, ${now}, ${now})`);
    return { ok: true as const };
  });
}

export async function assignHousekeepingTask(taskId: number, assignedUserId: number | null) {
  return hk(async () => {
    if (assignedUserId != null) await assertAssignee(assignedUserId);
    const d = await db();
    const [t] = await rows<{ status: string }>(d, sql`SELECT status FROM hotel_housekeeping_tasks WHERE id = ${taskId}`);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tarea no encontrada" });
    if (t.status === "inspeccionada") bad("La tarea ya está inspeccionada.");
    await d.execute(sql`UPDATE hotel_housekeeping_tasks SET assigned_user_id = ${assignedUserId}, updated_at = ${Date.now()} WHERE id = ${taskId}`);
    return { ok: true as const };
  });
}

/**
 * Cambia el estado de una tarea (quien la tiene asignada o quien gestiona el hotel; inspeccionar, solo quien gestiona) y
 * el estado operativo de la habitación con su historial, en una transacción.
 */
export async function setHousekeepingTaskStatus(input: { taskId: number; to: HkTaskStatus; notes?: string; actor: { userId: number; canManage: boolean } }) {
  return hk(() => inTx(async (tx: Exec) => {
    const [t] = await rows<{ id: number; hotel_room_id: number; kind: string; status: string; assigned_user_id: number | null }>(tx, sql`
      SELECT id, hotel_room_id, kind, status, assigned_user_id FROM hotel_housekeeping_tasks WHERE id = ${input.taskId} FOR UPDATE`);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tarea no encontrada" });
    const who = taskActorError({ assignedUserId: t.assigned_user_id === null ? null : Number(t.assigned_user_id) }, input.actor, input.to);
    if (who) throw new TRPCError({ code: "FORBIDDEN", message: who });
    const why = taskTransitionError(t.status, input.to);
    if (why) bad(why);
    const now = Date.now();
    const uid = input.actor.userId;
    await tx.execute(sql`
      UPDATE hotel_housekeeping_tasks SET status = ${input.to}, updated_at = ${now},
        started_at = ${input.to === "en_curso" ? sql`COALESCE(started_at, ${now})` : sql`started_at`},
        done_at = ${input.to === "hecha" ? sql`${now}` : input.to === "inspeccionada" ? sql`done_at` : sql`NULL`},
        done_by = ${input.to === "hecha" ? sql`${uid}` : input.to === "inspeccionada" ? sql`done_by` : sql`NULL`},
        inspected_at = ${input.to === "inspeccionada" ? sql`${now}` : sql`NULL`},
        inspected_by = ${input.to === "inspeccionada" ? sql`${uid}` : sql`NULL`}
        ${input.notes !== undefined ? sql`, notes = ${input.notes.trim().slice(0, 500) || null}` : sql``}
      WHERE id = ${t.id}`);
    const [room] = await rows<{ operational_status: string }>(tx, sql`SELECT operational_status FROM hotel_rooms WHERE id = ${t.hotel_room_id} FOR UPDATE`);
    const next = room ? roomStateForTask(t.kind, input.to, room.operational_status) : null;
    if (next) {
      const label = input.to === "en_curso" ? "en curso" : input.to === "hecha" ? "hecha" : input.to === "inspeccionada" ? "inspeccionada" : "pendiente";
      await setRoomStateLocked(tx, Number(t.hotel_room_id), next, { userId: uid, reason: `Housekeeping: limpieza ${label}` });
    }
    return { ok: true as const, roomStatus: next };
  }));
}

// ─── Incidencias ──────────────────────────────────────────────────────────────

/** Tipos de incidencia (la primera vez crea los de por defecto; el nombre único impide duplicarlos). */
export async function listIncidentTypes() {
  return hk(async () => {
    const d = await db();
    let list = await rows<{ id: number; name: string; is_active: number; sort_order: number }>(d, sql`
      SELECT id, name, is_active, sort_order FROM hotel_incident_types ORDER BY sort_order, name`);
    if (list.length === 0) {
      const now = Date.now();
      for (let i = 0; i < DEFAULT_INCIDENT_TYPES.length; i++) {
        const name = DEFAULT_INCIDENT_TYPES[i];
        await d.execute(sql`INSERT INTO hotel_incident_types (name, is_active, sort_order, created_at) VALUES (${name}, 1, ${i}, ${now}) ON DUPLICATE KEY UPDATE id = id`);
      }
      list = await rows(d, sql`SELECT id, name, is_active, sort_order FROM hotel_incident_types ORDER BY sort_order, name`);
    }
    return list.map((t) => ({ id: Number(t.id), name: t.name, isActive: !!Number(t.is_active), sortOrder: Number(t.sort_order) }));
  });
}

export async function saveIncidentType(input: { id?: number; name: string; isActive?: boolean; sortOrder?: number }) {
  return hk(async () => {
    const name = incidentTypeName(input.name);
    if (!name) bad("El nombre del tipo debe tener entre 2 y 80 caracteres.");
    const d = await db();
    if (input.id == null) {
      await d.execute(sql`INSERT INTO hotel_incident_types (name, is_active, sort_order, created_at) VALUES (${name}, ${input.isActive === false ? 0 : 1}, ${input.sortOrder ?? 100}, ${Date.now()})`);
    } else {
      await d.execute(sql`
        UPDATE hotel_incident_types SET name = ${name}
          ${input.isActive !== undefined ? sql`, is_active = ${input.isActive ? 1 : 0}` : sql``}
          ${input.sortOrder !== undefined ? sql`, sort_order = ${input.sortOrder}` : sql``}
        WHERE id = ${input.id}`);
    }
    return { ok: true as const };
  });
}

export async function listRoomIncidents(f: { status?: IncidentStatus | "abiertas"; hotelRoomId?: number } = {}) {
  return hk(async () => {
    const d = await db();
    const where = [
      f.status === "abiertas" ? sql`i.status <> 'resuelta'` : f.status ? sql`i.status = ${f.status}` : sql`1 = 1`,
      f.hotelRoomId != null ? sql`i.hotel_room_id = ${f.hotelRoomId}` : sql`1 = 1`,
    ];
    const list = await rows<{
      id: number; hotel_room_id: number; type_id: number; type_name: string | null; description: string | null; priority: string; status: string;
      blocks_room: number; created_at: number | string; resolved_at: number | string | null; room_code: string; reporter: string | null;
    }>(d, sql`
      SELECT i.id, i.hotel_room_id, i.type_id, ty.name AS type_name, i.description, i.priority, i.status, i.blocks_room, i.created_at, i.resolved_at,
        h.code AS room_code, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS reporter
      FROM hotel_room_incidents i
      JOIN hotel_rooms h ON h.id = i.hotel_room_id
      LEFT JOIN hotel_incident_types ty ON ty.id = i.type_id
      LEFT JOIN users u ON u.id = i.reported_by
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY FIELD(i.status, 'abierta', 'en_curso', 'resuelta'), FIELD(i.priority, 'alta', 'media', 'baja'), i.created_at DESC
      LIMIT 500`);
    return list.map((i) => ({
      id: Number(i.id), hotelRoomId: Number(i.hotel_room_id), roomCode: i.room_code, typeId: Number(i.type_id), typeName: i.type_name ?? "—",
      description: i.description, priority: i.priority, status: i.status, blocksRoom: !!Number(i.blocks_room),
      createdAt: Number(i.created_at), resolvedAt: i.resolved_at === null ? null : Number(i.resolved_at), reporter: i.reporter,
    }));
  });
}

/** Abre una incidencia; si bloquea la habitación, la deja bloqueada por mantenimiento (con su historial). */
export async function createRoomIncident(input: { hotelRoomId: number; typeId: number; description?: string; priority: "baja" | "media" | "alta"; blocksRoom: boolean; userId: number | null }) {
  return hk(() => inTx(async (tx: Exec) => {
    const [room] = await rows<{ id: number }>(tx, sql`SELECT id FROM hotel_rooms WHERE id = ${input.hotelRoomId} FOR UPDATE`);
    if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada" });
    const [type] = await rows<{ id: number; is_active: number }>(tx, sql`SELECT id, is_active FROM hotel_incident_types WHERE id = ${input.typeId}`);
    if (!type || !Number(type.is_active)) bad("Elige un tipo de incidencia activo.");
    const now = Date.now();
    await tx.execute(sql`
      INSERT INTO hotel_room_incidents (hotel_room_id, type_id, description, priority, status, blocks_room, reported_by, created_at, updated_at)
      VALUES (${input.hotelRoomId}, ${input.typeId}, ${input.description?.trim().slice(0, 1000) || null}, ${input.priority}, 'abierta', ${input.blocksRoom ? 1 : 0},
        ${input.userId}, ${now}, ${now})`);
    if (input.blocksRoom) {
      const next = roomStateForIncident("abierta", 0);
      if (next) await setRoomStateLocked(tx, input.hotelRoomId, next, { userId: input.userId, reason: "Incidencia abierta" });
    }
    return { ok: true as const };
  }));
}

/** Cambia el estado de una incidencia; al resolver la última que bloqueaba la habitación, esta queda sucia. */
export async function setRoomIncidentStatus(input: { id: number; status: IncidentStatus; userId: number | null }) {
  return hk(() => inTx(async (tx: Exec) => {
    const [i] = await rows<{ id: number; hotel_room_id: number; status: string; blocks_room: number }>(tx, sql`
      SELECT id, hotel_room_id, status, blocks_room FROM hotel_room_incidents WHERE id = ${input.id} FOR UPDATE`);
    if (!i) throw new TRPCError({ code: "NOT_FOUND", message: "Incidencia no encontrada" });
    if (i.status === input.status) bad("La incidencia ya está en ese estado.");
    if (i.status === "resuelta") bad("La incidencia ya está resuelta.");
    const now = Date.now();
    const resolved = input.status === "resuelta";
    await tx.execute(sql`
      UPDATE hotel_room_incidents SET status = ${input.status}, updated_at = ${now},
        resolved_at = ${resolved ? sql`${now}` : sql`NULL`}, resolved_by = ${resolved ? sql`${input.userId}` : sql`NULL`}
      WHERE id = ${i.id}`);
    if (resolved && Number(i.blocks_room)) {
      await rows(tx, sql`SELECT id FROM hotel_rooms WHERE id = ${i.hotel_room_id} FOR UPDATE`);
      const [o] = await rows<{ n: number }>(tx, sql`
        SELECT COUNT(*) AS n FROM hotel_room_incidents WHERE hotel_room_id = ${i.hotel_room_id} AND blocks_room = 1 AND status <> 'resuelta' AND id <> ${i.id}`);
      const [room] = await rows<{ operational_status: string }>(tx, sql`SELECT operational_status FROM hotel_rooms WHERE id = ${i.hotel_room_id}`);
      const next = roomStateForIncident("resuelta", Number(o?.n ?? 0));
      // Solo se desbloquea lo que bloqueó la incidencia (no una habitación puesta fuera de servicio a mano)
      if (next && room?.operational_status === "bloqueada_mantenimiento") {
        await setRoomStateLocked(tx, Number(i.hotel_room_id), next, { userId: input.userId, reason: "Incidencia resuelta" });
      }
    }
    return { ok: true as const };
  }));
}
