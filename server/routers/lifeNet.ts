/**
 * Life Net · organización personal y familiar (namespace `lifeNet`, licenciado con la capacidad `life-net` en
 * server/_core/capabilities/routeGuard.ts: sin ella, 403; en solo lectura, solo consultas).
 *
 * Permisos (server/lifeNetDb.ts): ver y organizar el hogar es de la administración y de los usuarios vinculados a un
 * miembro activo; los datos del hogar y los miembros, solo de la administración. La lógica vive en server/lifeNetDb.ts.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as life from "../lifeNetDb";
import { EVENT_KINDS, LIFE_COLORS, LIFE_RELATIONSHIPS } from "../../shared/lifeNet";

const id = z.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const actorOf = (ctx: { user: { id: number; role: unknown } }): life.LifeActor => ({ userId: ctx.user.id, role: String(ctx.user.role) });

export const lifeNetRouter = router({
  // ── Organización personal (F1) ─────────────────────────────────────────
  overview: protectedProcedure.query(({ ctx }) => life.overview(actorOf(ctx))),
  access: protectedProcedure.query(({ ctx }) => life.accessOf(actorOf(ctx))),

  // ── Hogar y titular (J6) ───────────────────────────────────────────────
  household: protectedProcedure.query(async ({ ctx }) => {
    await life.accessOf(actorOf(ctx));
    return life.getHousehold();
  }),
  saveHousehold: protectedProcedure
    .input(z.object({
      householdName: z.string().max(160).nullish(),
      holderFirstName: z.string().max(100),
      holderLastName: z.string().max(160),
      holderTaxId: z.string().max(20).nullish(),
    }))
    .mutation(({ ctx, input }) => life.saveHousehold(input, actorOf(ctx))),

  // ── Miembros del hogar (F2 y F6) ───────────────────────────────────────
  members: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => life.listMembers(actorOf(ctx), input?.includeArchived)),
  linkableUsers: protectedProcedure.query(({ ctx }) => life.linkableUsers(actorOf(ctx))),
  upsertMember: protectedProcedure
    .input(z.object({
      id: id.optional(),
      displayName: z.string().max(120),
      relationship: z.enum(LIFE_RELATIONSHIPS),
      color: z.enum(LIFE_COLORS),
      userId: id.nullable(),
    }))
    .mutation(({ ctx, input }) => life.upsertMember(input, actorOf(ctx))),
  setMemberActive: protectedProcedure.input(z.object({ id, active: z.boolean() })).mutation(({ ctx, input }) => life.setMemberActive(input.id, input.active, actorOf(ctx))),

  // ── Calendario y agenda (F3) y actividades compartidas (F5) ────────────
  events: protectedProcedure
    .input(z.object({ from: day, to: day, memberId: id.nullish() }))
    .query(({ ctx, input }) => life.listEvents(input, actorOf(ctx))),
  upsertEvent: protectedProcedure
    .input(z.object({
      id: id.optional(),
      title: z.string().max(200),
      kind: z.enum(EVENT_KINDS),
      notes: z.string().max(1000).nullish(),
      location: z.string().max(200).nullish(),
      date: day,
      startTime: time.nullish(),
      endTime: time.nullish(),
      remindDate: day.nullish(),
      remindTime: time.nullish(),
      memberIds: z.array(id).max(50),
    }))
    .mutation(({ ctx, input }) => life.upsertEvent(input, actorOf(ctx))),
  archiveEvent: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => life.archiveEvent(input.id, actorOf(ctx))),

  // ── Tareas y recordatorios (F4) ────────────────────────────────────────
  tasks: protectedProcedure
    .input(z.object({ status: z.enum(["open", "done", "all"]).default("open"), memberId: id.nullish() }))
    .query(({ ctx, input }) => life.listTasks(input, actorOf(ctx))),
  upsertTask: protectedProcedure
    .input(z.object({
      id: id.optional(),
      title: z.string().max(200),
      notes: z.string().max(1000).nullish(),
      dueDate: day.nullish(),
      dueTime: time.nullish(),
      remindDate: day.nullish(),
      remindTime: time.nullish(),
      assigneeIds: z.array(id).max(50),
    }))
    .mutation(({ ctx, input }) => life.upsertTask(input, actorOf(ctx))),
  setTaskDone: protectedProcedure
    .input(z.object({ id, done: z.boolean(), doneByMemberId: id.nullish() }))
    .mutation(({ ctx, input }) => life.setTaskDone(input, actorOf(ctx))),
  archiveTask: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => life.archiveTask(input.id, actorOf(ctx))),

  // ── Seguimiento de actividades y compromisos (F7) ──────────────────────
  tracking: protectedProcedure.query(({ ctx }) => life.tracking(actorOf(ctx))),
});
