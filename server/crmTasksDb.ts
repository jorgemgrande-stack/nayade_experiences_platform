/**
 * Tareas y recordatorios internos del CRM (crm-tasks): título, descripción, vencimiento, responsable,
 * estado, prioridad y vínculo opcional a un cliente, una oportunidad o un presupuesto.
 *
 * Todo vive en la BD de la empresa en curso (`getDb()` resuelve la del tenant). No envía correos:
 * los avisos son el Inicio del panel y la campana de notificaciones. Tablas de
 * db/migrations/0008_crm_tags_tasks.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { clients, crmTasks, leads, quotes, users } from "../drizzle/schema";
import { getDb } from "./db";
import { localYmd, type TaskEntityType, type TaskPriority, type TaskStatus } from "../shared/crmTagsTasks";

/** Roles que pueden ser responsables de una tarea (equipo comercial). */
export const TASK_ASSIGNEE_ROLES = ["admin", "agente"] as const;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  return db;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  assignedTo?: number | null;
  priority?: TaskPriority;
  entityType?: TaskEntityType | null;
  entityId?: number | null;
}

export interface TaskListFilter {
  /** «mine»: asignadas a quien consulta; «all»: todas las de la empresa. */
  scope: "mine" | "all";
  status?: TaskStatus | "todas";
  overdue?: boolean;
  assignedTo?: number;
  entityType?: TaskEntityType;
  entityId?: number;
  limit: number;
  offset: number;
}

/** Usuarios activos del equipo que pueden ser responsables. */
export async function listAssignees(): Promise<Array<{ id: number; name: string }>> {
  const db = await requireDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, [...TASK_ASSIGNEE_ROLES])))
    .orderBy(asc(users.name));
  return rows.map((r) => ({ id: r.id, name: (r.name ?? "").trim() || r.email || `Usuario ${r.id}` }));
}

async function assertAssignee(userId: number): Promise<void> {
  const db = await requireDb();
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), inArray(users.role, [...TASK_ASSIGNEE_ROLES])))
    .limit(1);
  if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "El responsable debe ser un usuario activo del equipo" });
}

async function assertEntity(entityType: TaskEntityType, entityId: number): Promise<void> {
  const db = await requireDb();
  const table = entityType === "client" ? clients : entityType === "lead" ? leads : quotes;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "El elemento vinculado no existe" });
}

function blankToNull(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

export async function createTask(input: TaskInput, userId: number): Promise<{ id: number }> {
  const db = await requireDb();
  if (input.assignedTo != null) await assertAssignee(input.assignedTo);
  if (input.entityType && input.entityId != null) await assertEntity(input.entityType, input.entityId);
  const [res] = await db.insert(crmTasks).values({
    title: input.title.trim(),
    description: blankToNull(input.description),
    dueDate: input.dueDate || null,
    assignedTo: input.assignedTo ?? null,
    priority: input.priority ?? "media",
    entityType: input.entityType && input.entityId != null ? input.entityType : null,
    entityId: input.entityType && input.entityId != null ? input.entityId : null,
    createdBy: userId,
  });
  return { id: Number((res as { insertId: number }).insertId) };
}

async function requireTask(id: number) {
  const db = await requireDb();
  const [t] = await db.select().from(crmTasks).where(eq(crmTasks.id, id)).limit(1);
  if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tarea no encontrada" });
  return t;
}

export async function updateTask(id: number, input: Partial<TaskInput>): Promise<void> {
  const db = await requireDb();
  await requireTask(id);
  const set: Partial<typeof crmTasks.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.description !== undefined) set.description = blankToNull(input.description);
  if (input.dueDate !== undefined) set.dueDate = input.dueDate || null;
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.assignedTo !== undefined) {
    if (input.assignedTo != null) await assertAssignee(input.assignedTo);
    set.assignedTo = input.assignedTo;
  }
  if (input.entityType !== undefined || input.entityId !== undefined) {
    if (input.entityType && input.entityId != null) {
      await assertEntity(input.entityType, input.entityId);
      set.entityType = input.entityType;
      set.entityId = input.entityId;
    } else {
      set.entityType = null;
      set.entityId = null;
    }
  }
  if (!Object.keys(set).length) return;
  await db.update(crmTasks).set(set).where(eq(crmTasks.id, id));
}

export async function setTaskStatus(id: number, status: TaskStatus, userId: number): Promise<void> {
  const db = await requireDb();
  await requireTask(id);
  await db
    .update(crmTasks)
    .set(status === "hecha" ? { status, completedAt: new Date(), completedBy: userId } : { status, completedAt: null, completedBy: null })
    .where(eq(crmTasks.id, id));
}

export async function deleteTask(id: number): Promise<void> {
  const db = await requireDb();
  await requireTask(id);
  await db.delete(crmTasks).where(eq(crmTasks.id, id));
}

function filterConditions(f: Omit<TaskListFilter, "limit" | "offset">, userId: number, today: string): SQL | undefined {
  const c: SQL[] = [];
  if (f.scope === "mine") c.push(eq(crmTasks.assignedTo, userId));
  else if (f.assignedTo) c.push(eq(crmTasks.assignedTo, f.assignedTo));
  const status = f.status ?? "pendiente";
  if (status !== "todas") c.push(eq(crmTasks.status, status));
  if (f.overdue) c.push(eq(crmTasks.status, "pendiente"), lt(crmTasks.dueDate, today));
  if (f.entityType && f.entityId != null) c.push(eq(crmTasks.entityType, f.entityType), eq(crmTasks.entityId, f.entityId));
  return c.length ? and(...c) : undefined;
}

export interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: number | null;
  assigneeName: string | null;
  entityType: TaskEntityType | null;
  entityId: number | null;
  /** Nombre del cliente u oportunidad, o número del presupuesto (null si ya no existe). */
  entityLabel: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** Nombres legibles de las entidades vinculadas, en pocas consultas. */
async function entityLabels(rows: Array<{ entityType: string | null; entityId: number | null }>): Promise<Map<string, string>> {
  const db = await requireDb();
  const ids = (t: string) => Array.from(new Set(rows.filter((r) => r.entityType === t && r.entityId != null).map((r) => r.entityId!)));
  const out = new Map<string, string>();
  const [c, l, q] = [ids("client"), ids("lead"), ids("quote")];
  if (c.length) for (const r of await db.select({ id: clients.id, label: clients.name }).from(clients).where(inArray(clients.id, c))) out.set(`client:${r.id}`, r.label);
  if (l.length) for (const r of await db.select({ id: leads.id, label: leads.name }).from(leads).where(inArray(leads.id, l))) out.set(`lead:${r.id}`, r.label ?? "");
  if (q.length) for (const r of await db.select({ id: quotes.id, label: quotes.quoteNumber }).from(quotes).where(inArray(quotes.id, q))) out.set(`quote:${r.id}`, r.label);
  return out;
}

export async function listTasks(f: TaskListFilter, userId: number, today: string = localYmd()): Promise<{ rows: TaskRow[]; total: number }> {
  const db = await requireDb();
  const where = filterConditions(f, userId, today);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: crmTasks.id,
        title: crmTasks.title,
        description: crmTasks.description,
        dueDate: crmTasks.dueDate,
        status: crmTasks.status,
        priority: crmTasks.priority,
        assignedTo: crmTasks.assignedTo,
        assigneeName: users.name,
        entityType: crmTasks.entityType,
        entityId: crmTasks.entityId,
        completedAt: crmTasks.completedAt,
        createdAt: crmTasks.createdAt,
      })
      .from(crmTasks)
      .leftJoin(users, eq(users.id, crmTasks.assignedTo))
      .where(where)
      // Pendientes primero; dentro, por vencimiento (sin fecha al final) y prioridad
      .orderBy(
        desc(sql`${crmTasks.status} = 'pendiente'`),
        asc(sql`${crmTasks.dueDate} IS NULL`),
        asc(crmTasks.dueDate),
        desc(sql`FIELD(${crmTasks.priority}, 'baja', 'media', 'alta')`),
        desc(crmTasks.id),
      )
      .limit(f.limit)
      .offset(f.offset),
    db.select({ total: count() }).from(crmTasks).where(where),
  ]);
  const labels = await entityLabels(rows);
  return {
    rows: rows.map((r) => ({
      ...r,
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
      entityType: (r.entityType as TaskEntityType | null) ?? null,
      entityLabel: r.entityType && r.entityId != null ? labels.get(`${r.entityType}:${r.entityId}`) ?? null : null,
    })),
    total: Number(total),
  };
}

export interface TaskSummary {
  /** Pendientes asignadas a quien consulta. */
  minePending: number;
  mineOverdue: number;
  mineDueToday: number;
  /** Pendientes de la empresa sin responsable. */
  unassigned: number;
}

export async function taskSummary(userId: number, today: string = localYmd()): Promise<TaskSummary> {
  const db = await requireDb();
  const pending = eq(crmTasks.status, "pendiente");
  const mine = and(pending, eq(crmTasks.assignedTo, userId));
  const [[a], [b], [c], [d]] = await Promise.all([
    db.select({ n: count() }).from(crmTasks).where(mine),
    db.select({ n: count() }).from(crmTasks).where(and(mine, lt(crmTasks.dueDate, today))),
    db.select({ n: count() }).from(crmTasks).where(and(mine, eq(crmTasks.dueDate, today))),
    db.select({ n: count() }).from(crmTasks).where(and(pending, isNull(crmTasks.assignedTo))),
  ]);
  return { minePending: Number(a.n), mineOverdue: Number(b.n), mineDueToday: Number(c.n), unassigned: Number(d.n) };
}

/** Tareas pendientes de un usuario que vencen hoy o antes (para la campana de avisos). */
export async function dueTasksFor(userId: number, today: string = localYmd()): Promise<Array<{ id: number; title: string; dueDate: string; priority: TaskPriority }>> {
  const db = await requireDb();
  const rows = await db
    .select({ id: crmTasks.id, title: crmTasks.title, dueDate: crmTasks.dueDate, priority: crmTasks.priority })
    .from(crmTasks)
    .where(and(eq(crmTasks.status, "pendiente"), eq(crmTasks.assignedTo, userId), sql`${crmTasks.dueDate} <= ${today}`))
    .orderBy(asc(crmTasks.dueDate), desc(crmTasks.id));
  return rows.map((r) => ({ ...r, dueDate: String(r.dueDate).slice(0, 10) }));
}
