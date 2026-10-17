/**
 * Tareas y recordatorios internos del CRM (capacidad `crm-tasks`). Equipo comercial: admin y agente
 * consultan y modifican; `readonly` solo consulta (sus mutaciones las rechaza readOnlyGuard). La
 * licencia la aplica el guardián de rutas (`crmTasks` → crm-tasks en TRPC_ROUTER_CAPABILITIES).
 * No envía correos.
 */
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import {
  TASK_DESCRIPTION_MAX, TASK_ENTITY_TYPES, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, isValidYmd,
} from "../../shared/crmTagsTasks";
import { createTask, deleteTask, listAssignees, listTasks, setTaskStatus, taskSummary, updateTask } from "../crmTasksDb";

const id = z.number().int().positive();
const title = z.string().trim().min(1, "Indica el título de la tarea").max(TASK_TITLE_MAX, `El título admite como máximo ${TASK_TITLE_MAX} caracteres`);
const description = z.string().max(TASK_DESCRIPTION_MAX, `La descripción admite como máximo ${TASK_DESCRIPTION_MAX} caracteres`).nullable();
const dueDate = z.string().refine(isValidYmd, "Indica una fecha válida (AAAA-MM-DD)").nullable();
const entityType = z.enum(TASK_ENTITY_TYPES);
const bothOrNone = (v: { entityType?: string | null; entityId?: number | null }) =>
  (v.entityType == null) === (v.entityId == null);
const BOTH_OR_NONE = { message: "Indica a la vez el tipo y el elemento vinculado, o ninguno", path: ["entityId"] };

export const crmTasksRouter = router({
  list: staffProcedure
    .input(
      z.object({
        scope: z.enum(["mine", "all"]).default("mine"),
        status: z.enum([...TASK_STATUSES, "todas"]).optional(),
        overdue: z.boolean().optional(),
        assignedTo: id.optional(),
        entityType: entityType.optional(),
        entityId: id.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ input, ctx }) => listTasks(input, ctx.user.id)),

  /** Recuento para el Inicio: mis pendientes, vencidas y de hoy, y las que no tienen responsable. */
  summary: staffProcedure.query(({ ctx }) => taskSummary(ctx.user.id)),

  /** Usuarios del equipo que pueden ser responsables. */
  assignees: staffProcedure.query(() => listAssignees()),

  create: staffProcedure
    .input(
      z
        .object({
          title,
          description: description.optional(),
          dueDate: dueDate.optional(),
          assignedTo: id.nullable().optional(),
          priority: z.enum(TASK_PRIORITIES).optional(),
          entityType: entityType.nullable().optional(),
          entityId: id.nullable().optional(),
        })
        .refine(bothOrNone, BOTH_OR_NONE),
    )
    .mutation(({ input, ctx }) => createTask(input, ctx.user.id)),

  update: staffProcedure
    .input(
      z
        .object({
          id,
          title: title.optional(),
          description: description.optional(),
          dueDate: dueDate.optional(),
          assignedTo: id.nullable().optional(),
          priority: z.enum(TASK_PRIORITIES).optional(),
          entityType: entityType.nullable().optional(),
          entityId: id.nullable().optional(),
        })
        .refine((v) => (v.entityType === undefined && v.entityId === undefined) || bothOrNone(v), BOTH_OR_NONE),
    )
    .mutation(async ({ input }) => {
      const { id: taskId, ...rest } = input;
      await updateTask(taskId, rest);
      return { success: true };
    }),

  setStatus: staffProcedure
    .input(z.object({ id, status: z.enum(TASK_STATUSES) }))
    .mutation(async ({ input, ctx }) => {
      await setTaskStatus(input.id, input.status, ctx.user.id);
      return { success: true };
    }),

  delete: staffProcedure.input(z.object({ id })).mutation(async ({ input }) => {
    await deleteTask(input.id);
    return { success: true };
  }),
});
