/**
 * learning.* — Elephant LMS: formación digital de pago con acceso privado por alumno.
 *
 *  - `learning.my.*`: el aula del alumno (protectedProcedure, cuenta individual). Nunca devuelve ficheros ni enlaces
 *    permanentes: solo estructura, textos y estado de acceso; los recursos se sirven aparte, con comprobación de matrícula.
 *  - `learning.admin.*`: administración del tenant (adminProcedure): matrículas, reglas, prórrogas y revocaciones con motivo.
 *
 * La lógica y sus reglas de seguridad están en server/learningDb.ts y shared/learning.ts. Todo va contra la BD de la
 * empresa en curso: el aislamiento entre empresas es el de siempre.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { LearningRuleError, START_MODES, evaluateAny } from "../../shared/learning";
import {
  LearningError, addModules, grantDemo, canAccessModule, enrollmentEvents, enrollmentViews, extendEnrollment, getEnrollment, grantAdmin, grantFromPayment, isMissingLearningSchema,
  listEnrollments, listRules, myCourses, reactivateEnrollment, recordProgress, revokeEnrollment, saveRule, suspendEnrollment,
} from "../learningDb";
import { getDb } from "../db";
import { grantLearningFromEnrollment, sendLearningInvitation } from "../learningFlow";
import { ensureAccount } from "../communitiesDb";
import { InventoryError, planInventory } from "../../shared/learningImport";
import { applyImportPlan, courseCoverage } from "../learningImport";
import { sql } from "drizzle-orm";

const id = z.number().int().positive();
const reason = z.string().min(1).max(600);

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LearningRuleError) throw new TRPCError({ code: e.code === "PAYMENT_NOT_CONFIRMED" ? "PRECONDITION_FAILED" : "BAD_REQUEST", message: e.message });
    if (e instanceof LearningError) throw new TRPCError({ code: e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "FORBIDDEN" ? "FORBIDDEN" : e.code === "CONFLICT" ? "CONFLICT" : "BAD_REQUEST", message: e.message });
    if (isMissingLearningSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La formación digital todavía no está activada en esta empresa." });
    throw e;
  }
}

async function rowsOf(q: ReturnType<typeof sql>) {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  const [r] = (await d.execute(q)) as unknown as [Array<Record<string, any>>];
  return Array.isArray(r) ? r : [];
}

const my = router({
  courses: protectedProcedure.query(({ ctx }) => guard(() => myCourses(ctx.user.id))),

  /** Índice del curso: todos los módulos y lecciones (títulos), con `unlocked` según la matrícula de esta persona. */
  course: protectedProcedure.input(z.object({ courseId: id })).query(({ ctx, input }) =>
    guard(async () => {
      const now = Date.now();
      const [course] = await rowsOf(sql`SELECT id, slug, title, description, language FROM learning_courses WHERE id = ${input.courseId} AND status = 'published'`);
      if (!course) throw new LearningError("NOT_FOUND", "El curso no existe.");
      const views = await enrollmentViews(ctx.user.id, input.courseId);
      if (!views.length) throw new LearningError("FORBIDDEN", "No tienes una matrícula de este curso.");
      const modules = await rowsOf(sql`SELECT id, position, title FROM learning_modules WHERE course_id = ${input.courseId} ORDER BY position`);
      const lessons = await rowsOf(sql`SELECT l.id, l.module_id, l.position, l.title FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${input.courseId} ORDER BY l.position`);
      const done = new Set((await rowsOf(sql`SELECT lesson_id FROM learning_progress WHERE user_id = ${ctx.user.id} AND status = 'completed'`)).map((r) => Number(r.lesson_id)));
      return {
        course: { id: Number(course.id), slug: String(course.slug), title: String(course.title), description: course.description ?? null, language: String(course.language) },
        modules: modules.map((m) => {
          const unlocked = evaluateAny(views, Number(m.id), now).allowed;
          return {
            id: Number(m.id), position: Number(m.position), title: String(m.title), unlocked,
            lessons: lessons.filter((l) => Number(l.module_id) === Number(m.id)).map((l) => ({ id: Number(l.id), position: Number(l.position), title: String(l.title), completed: done.has(Number(l.id)) })),
          };
        }),
      };
    })),

  /** Bloques de una lección. Solo con matrícula activa que abra su módulo. Los recursos van sin URL: se piden aparte. */
  lesson: protectedProcedure.input(z.object({ lessonId: id })).query(({ ctx, input }) =>
    guard(async () => {
      const [loc] = await rowsOf(sql`SELECT l.id, l.title, m.id AS module_id, m.course_id FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE l.id = ${input.lessonId}`);
      if (!loc) throw new LearningError("NOT_FOUND", "La lección no existe.");
      const dec = await canAccessModule(ctx.user.id, Number(loc.course_id), Number(loc.module_id));
      if (!dec.allowed) throw new LearningError("FORBIDDEN", "No tienes acceso a esta lección.");
      const blocks = await rowsOf(sql`SELECT b.id, b.position, b.kind, b.title, b.body, b.resource_id, b.external_url, b.duration_seconds, b.activity, b.attribution, r.status AS resource_status, r.kind AS resource_kind, r.size_bytes
        FROM learning_blocks b LEFT JOIN learning_resources r ON r.id = b.resource_id WHERE b.lesson_id = ${input.lessonId} ORDER BY b.position`);
      return {
        lesson: { id: Number(loc.id), title: String(loc.title) },
        blocks: blocks.map((b) => ({
          id: Number(b.id), position: Number(b.position), kind: String(b.kind), title: String(b.title), body: b.body ?? null, externalUrl: b.external_url ?? null,
          durationSeconds: b.duration_seconds == null ? null : Number(b.duration_seconds), activity: b.activity ?? null, attribution: b.attribution ?? null,
          resourceId: b.resource_id == null ? null : Number(b.resource_id),
          resource: b.resource_status ? { status: String(b.resource_status), kind: String(b.resource_kind), sizeBytes: b.size_bytes == null ? null : Number(b.size_bytes) } : null,
        })),
      };
    })),

  progress: protectedProcedure.input(z.object({ lessonId: id, completed: z.boolean().optional(), lastBlockId: id.nullable().optional() })).mutation(({ ctx, input }) =>
    guard(() => recordProgress(ctx.user.id, input.lessonId, { completed: input.completed, lastBlockId: input.lastBlockId ?? null }))),
});

const admin = router({
  enrollments: adminProcedure.input(z.object({ userId: id.optional(), courseId: id.optional() }).optional()).query(({ input }) => guard(() => listEnrollments(input ?? {}))),
  events: adminProcedure.input(z.object({ enrollmentId: id })).query(({ input }) => guard(() => enrollmentEvents(input.enrollmentId))),
  rules: adminProcedure.query(() => guard(() => listRules())),
  saveRule: adminProcedure
    .input(z.object({ id: id.optional(), experienceId: id, variantId: id.nullable(), courseId: id, moduleIds: z.array(id).min(1).max(50), durationDays: z.number().int().min(1).max(3650).nullable(), startMode: z.enum(START_MODES), fixedStart: z.number().int().nullable(), active: z.boolean() }))
    .mutation(({ input }) => guard(async () => ({ id: await saveRule({ ...input }, input.id) }))),

  /** Concesión administrativa expresamente registrada: motivo obligatorio, autor y huella en el historial. */
  grant: adminProcedure
    .input(z.object({ userId: id, courseId: id, moduleIds: z.array(id).min(1).max(50), durationDays: z.number().int().min(1).max(3650).nullable(), reason, nonce: z.string().min(8).max(60) }))
    .mutation(({ ctx, input }) => guard(() => grantAdmin({ ...input, actorUserId: ctx.user.id }))),

  /**
   * Libera el acceso de una compra con PAGO CONFIRMADO (vía manual verificada). Exige la referencia y el importe; la
   * inscripción debe estar confirmada. Idempotente: repetir la llamada no crea otra matrícula.
   */
  grantFromPayment: adminProcedure
    .input(z.object({ userId: id, clientId: id.nullable().optional(), experienceId: id, variantId: id.nullable(), operation: z.object({ kind: z.enum(["enrollment", "order", "quote"]), id }), payment: z.object({ reference: z.string().max(190), amountCents: z.number().int().min(0).max(100_000_000) }) }))
    .mutation(({ ctx, input }) => guard(() => grantFromPayment({ ...input, clientId: input.clientId ?? null, payment: { ...input.payment, verifiedBy: ctx.user.name || ctx.user.email || `usuario ${ctx.user.id}` }, actorUserId: ctx.user.id }))),

  /**
   * Importa inventarios de Articulate (JSON por módulo): crea el curso (en borrador), sus módulos, lecciones y bloques, con
   * recursos `pending` (sin fichero). Idempotente: reimportar no duplica. `dryRun` devuelve solo el informe de cobertura.
   */
  importInventory: adminProcedure
    .input(z.object({ inventories: z.array(z.unknown()).min(1).max(12), courseSlug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/), courseTitle: z.string().min(2).max(300), language: z.string().min(2).max(8).optional(), dryRun: z.boolean().default(false) }))
    .mutation(({ input }) => guard(async () => {
      let plan;
      try {
        plan = planInventory(input.inventories, { courseSlug: input.courseSlug, courseTitle: input.courseTitle, language: input.language });
      } catch (e) {
        if (e instanceof InventoryError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message, cause: e });
        throw e;
      }
      if (input.dryRun) return { dryRun: true as const, report: plan.report };
      const result = await applyImportPlan(plan);
      return { dryRun: false as const, report: plan.report, result, coverage: await courseCoverage(result.courseId) };
    })),
  coverage: adminProcedure.input(z.object({ courseId: id })).query(({ input }) => guard(() => courseCoverage(input.courseId))),

  /**
   * «Liberar acceso» de una inscripción confirmada: aplica las reglas de catálogo si su presupuesto está cobrado. Se usa cuando
   * el cobro llegó después de confirmar la plaza; repetirlo no duplica. No envía correo.
   */
  grantForEnrollment: adminProcedure.input(z.object({ enrollmentId: id })).mutation(({ ctx, input }) => guard(() => grantLearningFromEnrollment(input.enrollmentId, { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null }))),
  /** Acción EXPRESA de la administración: renueva la invitación de la cuenta (enlace de un solo uso) y envía el correo. */
  sendInvite: adminProcedure.input(z.object({ userId: id })).mutation(({ input }) => guard(async () => {
    const [u] = await rowsOf(sql`SELECT id, name, email FROM users WHERE id = ${input.userId}`);
    if (!u || !u.email) throw new LearningError("NOT_FOUND", "La persona no existe o no tiene correo.");
    const acc = await ensureAccount(String(u.name ?? u.email), String(u.email));
    if (!acc.invite) return { sent: false, reason: "already_active" as const };
    return { sent: await sendLearningInvitation(acc.invite), reason: null };
  })),

  /** Acceso de demostración (60 minutos por defecto): individual, de un disparador por persona, sobre los módulos indicados. */
  grantDemo: adminProcedure
    .input(z.object({ userId: id, courseId: id, moduleIds: z.array(id).min(1).max(50), trigger: z.string().min(3).max(80), minutes: z.number().int().min(1).max(1440).optional() }))
    .mutation(({ ctx, input }) => guard(() => grantDemo({ ...input, actorUserId: ctx.user.id }))),

  revoke: adminProcedure.input(z.object({ enrollmentId: id, reason })).mutation(({ ctx, input }) => guard(() => revokeEnrollment(input.enrollmentId, input.reason, ctx.user.id))),
  suspend: adminProcedure.input(z.object({ enrollmentId: id, reason })).mutation(({ ctx, input }) => guard(() => suspendEnrollment(input.enrollmentId, input.reason, ctx.user.id))),
  reactivate: adminProcedure.input(z.object({ enrollmentId: id, reason })).mutation(({ ctx, input }) => guard(() => reactivateEnrollment(input.enrollmentId, input.reason, ctx.user.id))),
  extend: adminProcedure.input(z.object({ enrollmentId: id, newEndsAt: z.number().int().nullable(), reason })).mutation(({ ctx, input }) => guard(() => extendEnrollment(input.enrollmentId, input.newEndsAt, input.reason, ctx.user.id))),
  addModules: adminProcedure.input(z.object({ enrollmentId: id, moduleIds: z.array(id).min(1).max(50), reason, paymentRef: z.string().max(190).nullable().optional() }))
    .mutation(({ ctx, input }) => guard(() => addModules(input.enrollmentId, input.moduleIds, input.reason, ctx.user.id, { paymentRef: input.paymentRef ?? null }))),
  get: adminProcedure.input(z.object({ enrollmentId: id })).query(({ input }) => guard(async () => (await getEnrollment(input.enrollmentId)) ?? (() => { throw new LearningError("NOT_FOUND", "La matrícula no existe."); })())),
});

export const learningRouter = router({ my, admin });
