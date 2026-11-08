/**
 * Life Net · organización personal y familiar (capacidad `life-net`) — acceso a datos. Lógica pura en shared/lifeNet.ts;
 * procedimientos en server/routers/lifeNet.ts; recordatorios por correo en server/lifeNet/reminders.ts.
 *
 *  - El hogar es la empresa (tenant): todo vive en su BD (`getDb()` resuelve la de la petición o la de la tarea).
 *  - Hogar y titular (J6): fila única de `life_settings` (nombre del hogar, nombre y apellidos del titular, NIF opcional).
 *    No cambia el modelo de empresa del CRM ni el registro de empresas.
 *  - Miembros (J5): perfiles sin acceso (p. ej. un menor) o vinculados a un usuario del panel (los usuarios e invitaciones
 *    de siempre). Cupo `household_members` del plan; si el plan no lo define, LIFE_HOUSEHOLD_MEMBERS_INCLUDED (5).
 *  - Quién accede: la administración del hogar y los usuarios vinculados a un miembro activo. Gestionar el hogar y los
 *    miembros es de la administración; el resto (agenda, tareas, marcar hecho) de cualquier miembro con acceso.
 *  - Nada se borra: tareas y eventos se archivan, los miembros se desactivan. Las filas de participantes y responsables
 *    se sustituyen con el ORM al editar.
 *
 * Las tablas (db/migrations/0047_life_net) no están en `drizzle/schema.ts` a propósito, como las de los otros productos
 * Net. Sin la migración, cada operación responde que Life Net aún no está preparado.
 */
import { TRPCError } from "@trpc/server";
import { eq, sql, type SQL } from "drizzle-orm";
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import { getDb } from "./db";
import { currentBusinessLimit } from "./businessQuotas";
import {
  EVENT_KINDS,
  HOUSEHOLD_MEMBERS_METRIC,
  LIFE_COLORS,
  LIFE_DEFAULT_TIME_ZONE,
  LIFE_RELATIONSHIPS,
  addDays,
  defaultHouseholdName,
  eventProblem,
  householdProblem,
  memberLimitOf,
  memberLimitProblem,
  memberTracking,
  reminderStamp,
  safeZone,
  taskProblem,
  taskState,
  wallClock,
  type LifeColor,
  type LifeEventKind,
  type LifeRelationship,
  type MemberTracking,
  type TaskState,
} from "../shared/lifeNet";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute" | "delete">;

export const LIFE_NOT_INSTALLED_MESSAGE = "Life Net aún no está preparado en tu hogar: falta aplicar la actualización 0047_life_net de su base de datos. Inténtalo de nuevo en unos minutos.";

/** Roles con acceso al panel que pueden vincularse a un miembro (los de `subscription.overview`). */
export const LIFE_PANEL_ROLES = ["admin", "agente", "monitor", "adminrest", "controler", "readonly"] as const;

/** Solo para sustituir participantes y responsables con el ORM (el resto va en SQL explícito). */
const lifeEventMembers = mysqlTable("life_event_members", { eventId: int("event_id").notNull(), memberId: int("member_id").notNull() });
const lifeTaskAssignees = mysqlTable("life_task_assignees", { taskId: int("task_id").notNull(), memberId: int("member_id").notNull() });

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const forbidden = (message: string) => new TRPCError({ code: "FORBIDDEN", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));

function errCode(e: unknown): string | undefined {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  return undefined;
}

/** Falta la migración 0047 (o una de sus tablas) en esta empresa. */
export function isMissingLifeSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /life_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
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
    if (isMissingLifeSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: LIFE_NOT_INSTALLED_MESSAGE, cause: e });
    if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Esa persona ya está vinculada a otro miembro del hogar.", cause: e });
    throw e;
  }
}
const inTx = <T>(fn: (tx: Exec) => Promise<T>) => run((d) => d.transaction((tx) => fn(tx as unknown as Exec)));

async function rows<T = any>(exec: Pick<Db, "execute">, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Pick<Db, "execute">, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}
const inList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
// Fechas y horas de pared del hogar guardadas como texto (AAAA-MM-DD y AAAA-MM-DD HH:MM): sin zonas horarias
const day = (v: unknown): string | null => (v == null || v === "" ? null : String(v).slice(0, 10));
const stamp = (v: unknown): string | null => (v == null || v === "" ? null : String(v).slice(0, 16));

// ─── Quién actúa ─────────────────────────────────────────────────────────────

export interface LifeActor {
  userId: number;
  role: string;
}
export interface LifeAccess {
  isAdmin: boolean;
  /** Miembro activo vinculado a quien actúa (null si no lo está). */
  memberId: number | null;
  canWrite: boolean;
}

/**
 * Acceso a Life Net de quien actúa: la administración del hogar o un usuario vinculado a un miembro activo. El resto de
 * usuarios del panel no ve nada del hogar. `readonly` lee pero no escribe.
 */
export async function accessOf(actor: LifeActor): Promise<LifeAccess> {
  return run(async (d) => {
    const isAdmin = actor.role === "admin";
    const [m] = await rows(d, sql`SELECT id FROM life_members WHERE user_id = ${actor.userId} AND is_active = 1 LIMIT 1`);
    const memberId = m ? num(m.id) : null;
    if (!isAdmin && memberId === null) throw forbidden("Solo los miembros del hogar con acceso pueden ver su organización. Pide a la persona titular que te vincule como miembro.");
    return { isAdmin, memberId, canWrite: actor.role !== "readonly" };
  });
}
async function writer(actor: LifeActor): Promise<LifeAccess> {
  const a = await accessOf(actor);
  if (!a.canWrite) throw forbidden("Tu acceso es de solo lectura.");
  return a;
}
async function adminOnly(actor: LifeActor): Promise<void> {
  if (actor.role !== "admin") throw forbidden("Solo la persona titular o la administración del hogar puede hacerlo.");
}

// ─── Hogar y titular (J6) ─────────────────────────────────────────────────────

export interface Household {
  configured: boolean;
  householdName: string;
  holderFirstName: string;
  holderLastName: string;
  holderTaxId: string | null;
  timeZone: string;
  memberLimit: number | null;
  activeMembers: number;
}

async function settingsRow(exec: Pick<Db, "execute">): Promise<any | null> {
  const [r] = await rows(exec, sql`SELECT * FROM life_settings WHERE id = 1`);
  return r ?? null;
}

/** Zona horaria del hogar (la de por defecto si no está configurado). */
export async function householdTimeZone(): Promise<string> {
  return run(async (d) => safeZone(str((await settingsRow(d))?.time_zone) ?? LIFE_DEFAULT_TIME_ZONE));
}

/** Cupo vigente: el del plan (`household_members`) o el incluido por defecto. */
export async function memberLimit(): Promise<number | null> {
  const eff = await currentBusinessLimit(HOUSEHOLD_MEMBERS_METRIC).catch(() => null);
  return memberLimitOf(eff ? eff.limit : undefined);
}

async function activeMemberCount(exec: Pick<Db, "execute">): Promise<number> {
  const [r] = await rows(exec, sql`SELECT COUNT(*) AS n FROM life_members WHERE is_active = 1`);
  return num(r?.n);
}

export async function getHousehold(): Promise<Household> {
  const limit = await memberLimit();
  return run(async (d) => {
    const s = await settingsRow(d);
    const first = str(s?.holder_first_name) ?? "";
    const last = str(s?.holder_last_name) ?? "";
    return {
      configured: !!s,
      householdName: str(s?.household_name) || defaultHouseholdName({ firstName: first, lastName: last }),
      holderFirstName: first,
      holderLastName: last,
      holderTaxId: str(s?.holder_tax_id),
      timeZone: safeZone(str(s?.time_zone)),
      memberLimit: limit,
      activeMembers: await activeMemberCount(d),
    };
  });
}

/**
 * Guarda los datos del hogar y del titular. La primera vez crea además el miembro titular vinculado a quien lo guarda
 * (si esa persona aún no es miembro), dentro del cupo.
 */
export async function saveHousehold(input: { householdName?: string | null; holderFirstName: string; holderLastName: string; holderTaxId?: string | null }, actor: LifeActor): Promise<Household> {
  await adminOnly(actor);
  const p = householdProblem({ firstName: input.holderFirstName, lastName: input.holderLastName, taxId: input.holderTaxId, householdName: input.householdName });
  if (p) throw bad(p);
  const limit = await memberLimit();
  const first = input.holderFirstName.trim();
  const last = input.holderLastName.trim();
  const name = input.householdName?.trim() || null;
  const taxId = input.holderTaxId?.trim() ? input.holderTaxId.trim().toUpperCase().replace(/[\s.-]/g, "") : null;
  await inTx(async (tx) => {
    await tx.execute(sql`
      INSERT INTO life_settings (id, household_name, holder_first_name, holder_last_name, holder_tax_id, updated_by)
      VALUES (1, ${name}, ${first}, ${last}, ${taxId}, ${actor.userId})
      ON DUPLICATE KEY UPDATE household_name = VALUES(household_name), holder_first_name = VALUES(holder_first_name),
        holder_last_name = VALUES(holder_last_name), holder_tax_id = VALUES(holder_tax_id), updated_by = VALUES(updated_by)`);
    const [holder] = await rows(tx, sql`SELECT id FROM life_members WHERE is_holder = 1 LIMIT 1 FOR UPDATE`);
    if (holder) {
      await tx.execute(sql`UPDATE life_members SET display_name = ${first} WHERE id = ${num(holder.id)}`);
      return;
    }
    const problem = memberLimitProblem(await activeMemberCount(tx), limit);
    if (problem) throw bad(problem);
    const [linked] = await rows(tx, sql`SELECT id FROM life_members WHERE user_id = ${actor.userId} LIMIT 1`);
    await tx.execute(sql`
      INSERT INTO life_members (display_name, relationship, color, user_id, is_holder, created_by)
      VALUES (${first}, 'titular', 'rojo', ${linked ? null : actor.userId}, 1, ${actor.userId})`);
  });
  return getHousehold();
}

// ─── Miembros (J5, F2 y F6) ───────────────────────────────────────────────────

export interface LifeMember {
  id: number;
  displayName: string;
  relationship: LifeRelationship;
  color: LifeColor;
  userId: number | null;
  /** Usuario vinculado (solo nombre y correo, para la administración). */
  userName: string | null;
  userEmail: string | null;
  hasAccess: boolean;
  isHolder: boolean;
  isActive: boolean;
}

const toMember = (r: any): LifeMember => ({
  id: num(r.id),
  displayName: String(r.display_name),
  relationship: (LIFE_RELATIONSHIPS as readonly string[]).includes(r.relationship) ? r.relationship : "otro",
  color: (LIFE_COLORS as readonly string[]).includes(r.color) ? r.color : "azul",
  userId: r.user_id == null ? null : num(r.user_id),
  userName: str(r.user_name),
  userEmail: str(r.user_email),
  hasAccess: r.user_id != null && Number(r.user_active) === 1,
  isHolder: Number(r.is_holder) === 1,
  isActive: Number(r.is_active) === 1,
});

async function membersOf(exec: Pick<Db, "execute">, includeArchived: boolean): Promise<LifeMember[]> {
  const list = await rows(exec, sql`
    SELECT m.*, u.name AS user_name, u.email AS user_email, u.isActive AS user_active
    FROM life_members m LEFT JOIN users u ON u.id = m.user_id
    ${includeArchived ? sql`` : sql`WHERE m.is_active = 1`}
    ORDER BY m.is_active DESC, m.is_holder DESC, m.display_name`);
  return list.map(toMember);
}

/** Miembros del hogar. El correo del usuario vinculado solo lo ve la administración. */
export async function listMembers(actor: LifeActor, includeArchived = false): Promise<LifeMember[]> {
  const a = await accessOf(actor);
  return run(async (d) => (await membersOf(d, includeArchived && a.isAdmin)).map((m) => (a.isAdmin ? m : { ...m, userEmail: null })));
}

/** Usuarios del panel que se pueden vincular a un miembro (activos y con un rol de panel). Solo la administración. */
export async function linkableUsers(actor: LifeActor): Promise<Array<{ id: number; name: string | null; email: string | null; role: string; memberId: number | null }>> {
  await adminOnly(actor);
  return run(async (d) =>
    (await rows(d, sql`
      SELECT u.id, u.name, u.email, u.role, m.id AS member_id FROM users u LEFT JOIN life_members m ON m.user_id = u.id
      WHERE u.isActive = 1 AND u.role IN (${sql.join(LIFE_PANEL_ROLES.map((r) => sql`${r}`), sql`, `)})
      ORDER BY u.name, u.email`)).map((r) => ({ id: num(r.id), name: str(r.name), email: str(r.email), role: String(r.role), memberId: r.member_id == null ? null : num(r.member_id) })),
  );
}

async function assertLinkableUser(exec: Pick<Db, "execute">, userId: number): Promise<void> {
  const [u] = await rows(exec, sql`SELECT id, role, isActive FROM users WHERE id = ${userId}`);
  if (!u || Number(u.isActive) !== 1 || !(LIFE_PANEL_ROLES as readonly string[]).includes(String(u.role))) {
    throw bad("Esa persona no tiene acceso al panel. Invítala primero desde «Usuarios y permisos».");
  }
}

export interface MemberInput {
  id?: number;
  displayName: string;
  relationship: LifeRelationship;
  color: LifeColor;
  /** Usuario del panel vinculado (con acceso) o null (perfil sin acceso). */
  userId: number | null;
}

export async function upsertMember(input: MemberInput, actor: LifeActor): Promise<LifeMember> {
  await adminOnly(actor);
  const name = input.displayName.trim();
  if (!name) throw bad("Indica el nombre del miembro.");
  if (name.length > 120) throw bad("El nombre es demasiado largo.");
  if (input.relationship === "titular") throw bad("El titular se define en los datos del hogar.");
  const limit = await memberLimit();
  const id = await inTx(async (tx) => {
    if (input.userId != null) await assertLinkableUser(tx, input.userId);
    if (input.id) {
      const [cur] = await rows(tx, sql`SELECT id, is_holder FROM life_members WHERE id = ${input.id} FOR UPDATE`);
      if (!cur) throw notFound("El miembro");
      const rel = Number(cur.is_holder) === 1 ? "titular" : input.relationship;
      await tx.execute(sql`UPDATE life_members SET display_name = ${name}, relationship = ${rel}, color = ${input.color}, user_id = ${input.userId} WHERE id = ${input.id}`);
      return input.id;
    }
    // Bloqueo de los miembros activos: dos altas a la vez no superan el cupo
    await rows(tx, sql`SELECT id FROM life_members WHERE is_active = 1 FOR UPDATE`);
    const problem = memberLimitProblem(await activeMemberCount(tx), limit);
    if (problem) throw bad(problem);
    return (await header(tx, sql`
      INSERT INTO life_members (display_name, relationship, color, user_id, created_by)
      VALUES (${name}, ${input.relationship}, ${input.color}, ${input.userId}, ${actor.userId})`)).insertId;
  });
  return run(async (d) => (await membersOf(d, true)).find((m) => m.id === id)!);
}

/** Archiva o recupera un miembro (recuperar cuenta en el cupo). El titular no se archiva. */
export async function setMemberActive(id: number, active: boolean, actor: LifeActor): Promise<{ ok: true }> {
  await adminOnly(actor);
  const limit = await memberLimit();
  await inTx(async (tx) => {
    const [cur] = await rows(tx, sql`SELECT id, is_holder, is_active FROM life_members WHERE id = ${id} FOR UPDATE`);
    if (!cur) throw notFound("El miembro");
    if (!active && Number(cur.is_holder) === 1) throw bad("El titular del hogar no se puede archivar.");
    if (active && Number(cur.is_active) !== 1) {
      await rows(tx, sql`SELECT id FROM life_members WHERE is_active = 1 FOR UPDATE`);
      const problem = memberLimitProblem(await activeMemberCount(tx), limit);
      if (problem) throw bad(problem);
    }
    await tx.execute(sql`UPDATE life_members SET is_active = ${active ? 1 : 0} WHERE id = ${id}`);
  });
  return { ok: true };
}

async function assertActiveMembers(exec: Pick<Db, "execute">, ids: number[]): Promise<number[]> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return unique;
  const found = await rows(exec, sql`SELECT id FROM life_members WHERE is_active = 1 AND id IN (${inList(unique)})`);
  if (found.length !== unique.length) throw bad("Uno de los miembros elegidos no existe o está archivado.");
  return unique;
}

// ─── Agenda (F3) y actividades compartidas (F5) ──────────────────────────────

export interface LifeEvent {
  id: number;
  title: string;
  kind: LifeEventKind;
  notes: string | null;
  location: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  remindAt: string | null;
  memberIds: number[];
  createdBy: number | null;
}

async function linkIds(exec: Pick<Db, "execute">, table: "life_event_members" | "life_task_assignees", col: "event_id" | "task_id", ids: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!ids.length) return out;
  const list = await rows(exec, sql`SELECT ${sql.raw(col)} AS item_id, member_id FROM ${sql.raw(table)} WHERE ${sql.raw(col)} IN (${inList(ids)}) ORDER BY member_id`);
  for (const r of list) out.set(num(r.item_id), [...(out.get(num(r.item_id)) ?? []), num(r.member_id)]);
  return out;
}

const toEvent = (r: any, members: Map<number, number[]>): LifeEvent => ({
  id: num(r.id),
  title: String(r.title),
  kind: (EVENT_KINDS as readonly string[]).includes(r.kind) ? r.kind : "actividad",
  notes: str(r.notes),
  location: str(r.location),
  date: day(r.event_date)!,
  startTime: str(r.start_time),
  endTime: str(r.end_time),
  remindAt: stamp(r.remind_at),
  memberIds: members.get(num(r.id)) ?? [],
  createdBy: r.created_by == null ? null : num(r.created_by),
});

async function eventsBetween(exec: Pick<Db, "execute">, from: string, to: string, memberId?: number | null): Promise<LifeEvent[]> {
  const list = await rows(exec, sql`
    SELECT e.* FROM life_events e
    WHERE e.is_archived = 0 AND e.event_date BETWEEN ${from} AND ${to}
    ${memberId ? sql`AND EXISTS (SELECT 1 FROM life_event_members em WHERE em.event_id = e.id AND em.member_id = ${memberId})` : sql``}
    ORDER BY e.event_date, e.start_time IS NULL DESC, e.start_time, e.id`);
  const members = await linkIds(exec, "life_event_members", "event_id", list.map((r) => num(r.id)));
  return list.map((r) => toEvent(r, members));
}

/** Agenda del hogar entre dos fechas (máximo 93 días), de todos o de un miembro. */
export async function listEvents(input: { from: string; to: string; memberId?: number | null }, actor: LifeActor): Promise<LifeEvent[]> {
  await accessOf(actor);
  if (input.to < input.from) throw bad("La fecha final debe ser posterior a la inicial.");
  if (addDays(input.from, 93) < input.to) throw bad("Consulta como mucho tres meses seguidos.");
  return run((d) => eventsBetween(d, input.from, input.to, input.memberId));
}

export interface EventInput {
  id?: number;
  title: string;
  kind: LifeEventKind;
  notes?: string | null;
  location?: string | null;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  remindDate?: string | null;
  remindTime?: string | null;
  memberIds: number[];
}

async function canEditItem(exec: Pick<Db, "execute">, a: LifeAccess, actor: LifeActor, createdBy: unknown, linkTable: "life_event_members" | "life_task_assignees", col: "event_id" | "task_id", id: number): Promise<boolean> {
  if (a.isAdmin || (createdBy != null && num(createdBy) === actor.userId)) return true;
  if (a.memberId === null) return false;
  const [r] = await rows(exec, sql`SELECT 1 AS x FROM ${sql.raw(linkTable)} WHERE ${sql.raw(col)} = ${id} AND member_id = ${a.memberId}`);
  return !!r;
}

export async function upsertEvent(input: EventInput, actor: LifeActor): Promise<LifeEvent> {
  const a = await writer(actor);
  const p = eventProblem({ ...input });
  if (p) throw bad(p);
  const remind = reminderStamp(input.remindDate, input.remindTime) as string | null;
  const title = input.title.trim();
  const notes = input.notes?.trim() || null;
  const location = input.location?.trim() || null;
  const id = await inTx(async (tx) => {
    const memberIds = await assertActiveMembers(tx, input.memberIds);
    let eventId = input.id ?? 0;
    if (eventId) {
      const [cur] = await rows(tx, sql`SELECT id, created_by FROM life_events WHERE id = ${eventId} AND is_archived = 0 FOR UPDATE`);
      if (!cur) throw notFound("La actividad");
      if (!(await canEditItem(tx, a, actor, cur.created_by, "life_event_members", "event_id", eventId))) throw forbidden("Solo quien la creó, sus participantes o la administración pueden cambiarla.");
      await tx.execute(sql`
        UPDATE life_events SET title = ${title}, kind = ${input.kind}, notes = ${notes}, location = ${location}, event_date = ${input.date},
          start_time = ${input.startTime || null}, end_time = ${input.endTime || null}, remind_at = ${remind}
        WHERE id = ${eventId}`);
      await tx.delete(lifeEventMembers).where(eq(lifeEventMembers.eventId, eventId));
    } else {
      eventId = (await header(tx, sql`
        INSERT INTO life_events (title, kind, notes, location, event_date, start_time, end_time, remind_at, created_by)
        VALUES (${title}, ${input.kind}, ${notes}, ${location}, ${input.date}, ${input.startTime || null}, ${input.endTime || null}, ${remind}, ${actor.userId})`)).insertId;
    }
    for (const m of memberIds) await tx.execute(sql`INSERT INTO life_event_members (event_id, member_id) VALUES (${eventId}, ${m})`);
    return eventId;
  });
  return run(async (d) => {
    const [r] = await rows(d, sql`SELECT * FROM life_events WHERE id = ${id}`);
    return toEvent(r, await linkIds(d, "life_event_members", "event_id", [id]));
  });
}

export async function archiveEvent(id: number, actor: LifeActor): Promise<{ ok: true }> {
  const a = await writer(actor);
  await inTx(async (tx) => {
    const [cur] = await rows(tx, sql`SELECT id, created_by FROM life_events WHERE id = ${id} AND is_archived = 0 FOR UPDATE`);
    if (!cur) throw notFound("La actividad");
    if (!(await canEditItem(tx, a, actor, cur.created_by, "life_event_members", "event_id", id))) throw forbidden("Solo quien la creó, sus participantes o la administración pueden quitarla.");
    await tx.execute(sql`UPDATE life_events SET is_archived = 1 WHERE id = ${id}`);
  });
  return { ok: true };
}

// ─── Tareas y recordatorios (F4) ─────────────────────────────────────────────

export interface LifeTask {
  id: number;
  title: string;
  notes: string | null;
  dueDate: string | null;
  dueTime: string | null;
  remindAt: string | null;
  status: "pending" | "done";
  state: TaskState;
  doneAt: number | null;
  doneByMemberId: number | null;
  doneByUserId: number | null;
  assigneeIds: number[];
  createdBy: number | null;
}

const toTask = (r: any, assignees: Map<number, number[]>, now: { day: string; time: string }): LifeTask => {
  const t = {
    id: num(r.id),
    title: String(r.title),
    notes: str(r.notes),
    dueDate: day(r.due_date),
    dueTime: str(r.due_time),
    remindAt: stamp(r.remind_at),
    status: (r.status === "done" ? "done" : "pending") as "pending" | "done",
    doneAt: r.done_at_ms == null ? null : Math.round(Number(r.done_at_ms)),
    doneByMemberId: r.done_by_member_id == null ? null : num(r.done_by_member_id),
    doneByUserId: r.done_by_user_id == null ? null : num(r.done_by_user_id),
    assigneeIds: assignees.get(num(r.id)) ?? [],
    createdBy: r.created_by == null ? null : num(r.created_by),
  };
  return { ...t, state: taskState(t, now) };
};

async function nowOf(exec: Pick<Db, "execute">, now: Date): Promise<{ day: string; time: string; stamp: string; timeZone: string }> {
  const tz = safeZone(str((await settingsRow(exec))?.time_zone));
  return { ...wallClock(now, tz), timeZone: tz };
}

async function tasksWhere(exec: Pick<Db, "execute">, where: SQL, now: { day: string; time: string }, limit = 500): Promise<LifeTask[]> {
  const list = await rows(exec, sql`
    SELECT t.*, UNIX_TIMESTAMP(t.done_at) * 1000 AS done_at_ms FROM life_tasks t WHERE t.is_archived = 0 AND ${where}
    ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.id DESC LIMIT ${limit}`);
  const assignees = await linkIds(exec, "life_task_assignees", "task_id", list.map((r) => num(r.id)));
  return list.map((r) => toTask(r, assignees, now));
}

/** Tareas del hogar: abiertas, hechas (últimas 200) o todas; de todos o de un miembro. */
export async function listTasks(input: { status: "open" | "done" | "all"; memberId?: number | null }, actor: LifeActor, now = new Date()): Promise<LifeTask[]> {
  await accessOf(actor);
  return run(async (d) => {
    const n = await nowOf(d, now);
    const status = input.status === "open" ? sql`t.status = 'pending'` : input.status === "done" ? sql`t.status = 'done'` : sql`1 = 1`;
    const member = input.memberId ? sql`AND EXISTS (SELECT 1 FROM life_task_assignees ta WHERE ta.task_id = t.id AND ta.member_id = ${input.memberId})` : sql``;
    return tasksWhere(d, sql`${status} ${member}`, n, input.status === "done" ? 200 : 500);
  });
}

export interface TaskInput {
  id?: number;
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  remindDate?: string | null;
  remindTime?: string | null;
  assigneeIds: number[];
}

export async function upsertTask(input: TaskInput, actor: LifeActor, now = new Date()): Promise<LifeTask> {
  const a = await writer(actor);
  const p = taskProblem(input);
  if (p) throw bad(p);
  const remind = reminderStamp(input.remindDate, input.remindTime) as string | null;
  const title = input.title.trim();
  const notes = input.notes?.trim() || null;
  const id = await inTx(async (tx) => {
    const assignees = await assertActiveMembers(tx, input.assigneeIds);
    let taskId = input.id ?? 0;
    if (taskId) {
      const [cur] = await rows(tx, sql`SELECT id, created_by FROM life_tasks WHERE id = ${taskId} AND is_archived = 0 FOR UPDATE`);
      if (!cur) throw notFound("La tarea");
      if (!(await canEditItem(tx, a, actor, cur.created_by, "life_task_assignees", "task_id", taskId))) throw forbidden("Solo quien la creó, sus responsables o la administración pueden cambiarla.");
      await tx.execute(sql`
        UPDATE life_tasks SET title = ${title}, notes = ${notes}, due_date = ${input.dueDate || null}, due_time = ${input.dueTime || null}, remind_at = ${remind}
        WHERE id = ${taskId}`);
      await tx.delete(lifeTaskAssignees).where(eq(lifeTaskAssignees.taskId, taskId));
    } else {
      taskId = (await header(tx, sql`
        INSERT INTO life_tasks (title, notes, due_date, due_time, remind_at, created_by)
        VALUES (${title}, ${notes}, ${input.dueDate || null}, ${input.dueTime || null}, ${remind}, ${actor.userId})`)).insertId;
    }
    for (const m of assignees) await tx.execute(sql`INSERT INTO life_task_assignees (task_id, member_id) VALUES (${taskId}, ${m})`);
    return taskId;
  });
  return run(async (d) => (await tasksWhere(d, sql`t.id = ${id}`, await nowOf(d, now)))[0]);
}

/**
 * Marca una tarea como hecha (quién y cuándo) o la reabre. Por defecto la hace el miembro de quien actúa; la
 * administración puede indicar otro miembro.
 */
export async function setTaskDone(input: { id: number; done: boolean; doneByMemberId?: number | null }, actor: LifeActor, now = new Date()): Promise<LifeTask> {
  const a = await writer(actor);
  await inTx(async (tx) => {
    const [cur] = await rows(tx, sql`SELECT id, created_by, status FROM life_tasks WHERE id = ${input.id} AND is_archived = 0 FOR UPDATE`);
    if (!cur) throw notFound("La tarea");
    if (!(await canEditItem(tx, a, actor, cur.created_by, "life_task_assignees", "task_id", input.id))) throw forbidden("Solo sus responsables, quien la creó o la administración pueden marcarla.");
    if (!input.done) {
      await tx.execute(sql`UPDATE life_tasks SET status = 'pending', done_at = NULL, done_by_member_id = NULL, done_by_user_id = NULL WHERE id = ${input.id}`);
      return;
    }
    let by = a.memberId;
    if (input.doneByMemberId != null && input.doneByMemberId !== a.memberId) {
      if (!a.isAdmin) throw forbidden("Solo la administración puede marcarla en nombre de otro miembro.");
      by = (await assertActiveMembers(tx, [input.doneByMemberId]))[0];
    }
    if (cur.status === "done") return; // ya estaba hecha: se conserva quién y cuándo
    await tx.execute(sql`UPDATE life_tasks SET status = 'done', done_at = CURRENT_TIMESTAMP(3), done_by_member_id = ${by}, done_by_user_id = ${actor.userId} WHERE id = ${input.id}`);
  });
  return run(async (d) => (await tasksWhere(d, sql`t.id = ${input.id}`, await nowOf(d, now)))[0]);
}

export async function archiveTask(id: number, actor: LifeActor): Promise<{ ok: true }> {
  const a = await writer(actor);
  await inTx(async (tx) => {
    const [cur] = await rows(tx, sql`SELECT id, created_by FROM life_tasks WHERE id = ${id} AND is_archived = 0 FOR UPDATE`);
    if (!cur) throw notFound("La tarea");
    if (!(await canEditItem(tx, a, actor, cur.created_by, "life_task_assignees", "task_id", id))) throw forbidden("Solo quien la creó, sus responsables o la administración pueden quitarla.");
    await tx.execute(sql`UPDATE life_tasks SET is_archived = 1 WHERE id = ${id}`);
  });
  return { ok: true };
}

// ─── Seguimiento (F7) y organización personal (F1) ───────────────────────────

export interface Tracking {
  today: string;
  members: Array<LifeMember & MemberTracking>;
  /** Últimas tareas hechas: qué, quién y cuándo. */
  recentDone: Array<{ id: number; title: string; doneAt: number | null; doneByMemberId: number | null }>;
}

export async function tracking(actor: LifeActor, now = new Date()): Promise<Tracking> {
  const a = await accessOf(actor);
  return run(async (d) => {
    const n = await nowOf(d, now);
    const members = (await membersOf(d, false)).map((m) => (a.isAdmin ? m : { ...m, userEmail: null }));
    const tasks = await tasksWhere(d, sql`(t.status = 'pending' OR t.done_at >= NOW(3) - INTERVAL 30 DAY)`, n, 2000);
    const events = await eventsBetween(d, addDays(n.day, -30), addDays(n.day, 30));
    const stats = memberTracking(members.map((m) => m.id), tasks, events, n);
    const recentDone = tasks
      .filter((t) => t.status === "done")
      .sort((x, y) => (y.doneAt ?? 0) - (x.doneAt ?? 0))
      .slice(0, 15)
      .map((t) => ({ id: t.id, title: t.title, doneAt: t.doneAt, doneByMemberId: t.doneByMemberId }));
    return { today: n.day, members: members.map((m, i) => ({ ...m, ...stats[i] })), recentDone };
  });
}

export interface LifeOverview {
  today: string;
  household: Household;
  memberId: number | null;
  isAdmin: boolean;
  /** Mis tareas abiertas (vencidas primero) o, sin miembro vinculado, las del hogar. */
  myTasks: LifeTask[];
  /** Mi agenda de los próximos 7 días (o la del hogar). */
  myEvents: LifeEvent[];
  counts: { openTasks: number; overdueTasks: number; eventsToday: number };
}

export async function overview(actor: LifeActor, now = new Date()): Promise<LifeOverview> {
  const a = await accessOf(actor);
  const household = await getHousehold();
  return run(async (d) => {
    const n = await nowOf(d, now);
    const mine = a.memberId ? sql`AND EXISTS (SELECT 1 FROM life_task_assignees ta WHERE ta.task_id = t.id AND ta.member_id = ${a.memberId})` : sql``;
    const open = await tasksWhere(d, sql`t.status = 'pending' ${mine}`, n, 200);
    const all = await tasksWhere(d, sql`t.status = 'pending'`, n, 2000);
    const events = await eventsBetween(d, n.day, addDays(n.day, 7), a.memberId);
    const order = (t: LifeTask) => (t.state === "overdue" ? 0 : 1);
    return {
      today: n.day,
      household,
      memberId: a.memberId,
      isAdmin: a.isAdmin,
      myTasks: open.sort((x, y) => order(x) - order(y)).slice(0, 10),
      myEvents: events.slice(0, 10),
      counts: { openTasks: all.length, overdueTasks: all.filter((t) => t.state === "overdue").length, eventsToday: events.filter((e) => e.date === n.day).length },
    };
  });
}

// ─── Recordatorios (tarea programada) ────────────────────────────────────────

export interface ReminderTarget {
  kind: "task" | "event";
  itemId: number;
  title: string;
  /** Fecha y hora del elemento (vencimiento de la tarea o inicio de la actividad). */
  date: string | null;
  time: string | null;
  location: string | null;
  remindAt: string;
  memberId: number;
  memberName: string;
  email: string;
  userName: string | null;
}

/**
 * Recordatorios que tocan ahora (desde `floor` hasta `now`, hora de pared del hogar), para los miembros con acceso,
 * usuario activo y correo. Tareas pendientes (a sus responsables) y actividades (a sus participantes).
 */
export async function dueReminderTargets(nowStamp: string, floorStamp: string, limit = 200): Promise<ReminderTarget[]> {
  return run(async (d) => {
    const recipients = sql`JOIN life_members m ON m.id = x.member_id AND m.is_active = 1 AND m.user_id IS NOT NULL
      JOIN users u ON u.id = m.user_id AND u.isActive = 1 AND u.email IS NOT NULL AND u.email <> ''`;
    const tasks = await rows(d, sql`
      SELECT t.id, t.title, t.due_date AS d, t.due_time AS tm, NULL AS loc, t.remind_at, m.id AS member_id, m.display_name, u.email, u.name AS user_name
      FROM life_tasks t JOIN life_task_assignees x ON x.task_id = t.id ${recipients}
      WHERE t.is_archived = 0 AND t.status = 'pending' AND t.remind_at IS NOT NULL AND t.remind_at <= ${nowStamp} AND t.remind_at >= ${floorStamp}
      ORDER BY t.remind_at, t.id LIMIT ${limit}`);
    const events = await rows(d, sql`
      SELECT e.id, e.title, e.event_date AS d, e.start_time AS tm, e.location AS loc, e.remind_at, m.id AS member_id, m.display_name, u.email, u.name AS user_name
      FROM life_events e JOIN life_event_members x ON x.event_id = e.id ${recipients}
      WHERE e.is_archived = 0 AND e.remind_at IS NOT NULL AND e.remind_at <= ${nowStamp} AND e.remind_at >= ${floorStamp}
      ORDER BY e.remind_at, e.id LIMIT ${limit}`);
    const map = (kind: "task" | "event") => (r: any): ReminderTarget => ({
      kind,
      itemId: num(r.id),
      title: String(r.title),
      date: day(r.d),
      time: str(r.tm),
      location: str(r.loc),
      remindAt: stamp(r.remind_at)!,
      memberId: num(r.member_id),
      memberName: String(r.display_name),
      email: String(r.email),
      userName: str(r.user_name),
    });
    return [...tasks.map(map("task")), ...events.map(map("event"))].slice(0, limit);
  });
}

/**
 * Reserva el envío de un recordatorio (una vez por elemento, miembro y hora). Devuelve true si este proceso debe
 * enviarlo: fila nueva, o un intento fallido (o abandonado a medias hace más de 30 minutos) con intentos disponibles.
 * Un recordatorio enviado nunca se vuelve a enviar; y si se reintenta, el correo lleva su propia clave de idempotencia
 * y la bandeja de salida no lo duplica.
 */
const STALE_SENDING_MINUTES = 30;
export async function claimReminder(t: Pick<ReminderTarget, "kind" | "itemId" | "memberId" | "remindAt">, maxAttempts: number): Promise<boolean> {
  return run(async (d) => {
    const ins = await header(d, sql`
      INSERT IGNORE INTO life_reminders (item_kind, item_id, member_id, remind_at, status, attempts)
      VALUES (${t.kind}, ${t.itemId}, ${t.memberId}, ${t.remindAt}, 'sending', 1)`);
    if (ins.affectedRows === 1) return true;
    const retry = await header(d, sql`
      UPDATE life_reminders SET status = 'sending', attempts = attempts + 1
      WHERE item_kind = ${t.kind} AND item_id = ${t.itemId} AND member_id = ${t.memberId} AND remind_at = ${t.remindAt}
        AND attempts < ${maxAttempts}
        AND (status = 'failed' OR (status = 'sending' AND updated_at < NOW(3) - INTERVAL ${STALE_SENDING_MINUTES} MINUTE))`);
    return retry.affectedRows === 1;
  });
}

export async function settleReminder(t: Pick<ReminderTarget, "kind" | "itemId" | "memberId" | "remindAt">, ok: boolean): Promise<void> {
  await run((d) =>
    d.execute(sql`
      UPDATE life_reminders SET status = ${ok ? "sent" : "failed"}, sent_at = ${ok ? sql`CURRENT_TIMESTAMP(3)` : sql`NULL`}
      WHERE item_kind = ${t.kind} AND item_id = ${t.itemId} AND member_id = ${t.memberId} AND remind_at = ${t.remindAt} AND status = 'sending'`),
  );
}
