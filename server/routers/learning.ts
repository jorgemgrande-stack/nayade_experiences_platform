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
import { LearningRuleError, START_MODES, courseOpensFor, evaluateAny } from "../../shared/learning";
import { randomBytes } from "node:crypto";
import {
  LearningError, addModules, grantDemo, canAccessModule, enrollmentEvents, enrollmentViews, extendEnrollment, getEnrollment, grantAdmin, grantFromPayment, isMissingLearningSchema,
  grantTechnical, listEnrollments, listPreviewAccess, listRules, logPreviewAccess, myCourses, previewCourseIndex, previewLessonBlocks, reactivateEnrollment, recordProgress, revokeEnrollment, saveRule, suspendEnrollment,
} from "../learningDb";
import { getDb } from "../db";
import { grantLearningFromEnrollment, grantLearningFromOrder, pendingLearningOrders, sendLearningInvitation } from "../learningFlow";
import { ensureAccount } from "../communitiesDb";
import { InventoryError, planInventory } from "../../shared/learningImport";
import { applyImportPlan, courseCoverage } from "../learningImport";
import { sql } from "drizzle-orm";
import { describeRule } from "../../shared/learningRules";
import { addBlock, addLesson, addModule, archiveCourse, courseOutline, createCourse, duplicateCourse } from "../learningAuthoring";
import { BLOCK_KINDS } from "../../shared/learningAuthoring";
import { discardStaged, listMaterials, publishStaged, restoreFile } from "../learningMaterials";
import { discardDraft, getEditorState, publishDraft, restoreVersion, saveDraft } from "../learningEditor";

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
      const [course] = await rowsOf(sql`SELECT id, slug, title, description, language, status FROM learning_courses WHERE id = ${input.courseId} AND status IN ('published', 'draft')`);
      if (!course) throw new LearningError("NOT_FOUND", "El curso no existe.");
      // Borrador: solo lo abren las matrículas técnicas (validación); publicado: todas
      const views = (await enrollmentViews(ctx.user.id, input.courseId)).filter((v) => courseOpensFor(String(course.status), !!v.technical));
      // Un borrador no existe para quien no tiene matrícula técnica (no se revela ni su existencia)
      if (!views.length && String(course.status) === "draft") throw new LearningError("NOT_FOUND", "El curso no existe.");
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
  /** Reglas con nombres comerciales (producto, modalidad, módulos) además de los ids: la pantalla muestra nombres, no números. */
  rules: adminProcedure.query(() => guard(async () => {
    const rules = await listRules();
    const exp = await rowsOf(sql`SELECT id, title FROM experiences`).catch(() => []);
    const vars = await rowsOf(sql`SELECT id, name FROM experience_variants`).catch(() => []);
    const mods = await rowsOf(sql`SELECT m.id, m.title, c.title AS course_title FROM learning_modules m JOIN learning_courses c ON c.id = m.course_id`).catch(() => []);
    return rules.map((r) => describeRule(r, { experiences: exp, variants: vars, modules: mods }));
  })),
  /** Materiales (lote 2): biblioteca de recursos, ficheros pendientes de publicar, sustitución segura y recuperación. */
  materials: router({
    list: adminProcedure.query(() => guard(() => listMaterials())),
    publish: adminProcedure.input(z.object({ resourceId: id, fileId: id })).mutation(({ ctx, input }) => guard(() => publishStaged(input.resourceId, input.fileId, ctx.user.id))),
    discard: adminProcedure.input(z.object({ resourceId: id })).mutation(({ ctx, input }) => guard(() => discardStaged(input.resourceId, ctx.user.id))),
    restore: adminProcedure.input(z.object({ resourceId: id, fileId: id })).mutation(({ ctx, input }) => guard(() => restoreFile(input.resourceId, input.fileId, ctx.user.id))),
  }),
  /** Creación de formaciones (lote 3): cursos nuevos en borrador, estructura, duplicado y archivado. */
  authoring: router({
    outline: adminProcedure.input(z.object({ courseId: id })).query(({ input }) => guard(() => courseOutline(input.courseId))),
    createCourse: adminProcedure.input(z.object({ title: z.string().max(300), description: z.string().max(5000).nullish(), language: z.string().min(2).max(8).optional() })).mutation(({ ctx, input }) => guard(() => createCourse(input, ctx.user.id))),
    addModule: adminProcedure.input(z.object({ courseId: id, title: z.string().max(300) })).mutation(({ ctx, input }) => guard(() => addModule(input.courseId, input.title, ctx.user.id))),
    addLesson: adminProcedure.input(z.object({ moduleId: id, title: z.string().max(300) })).mutation(({ ctx, input }) => guard(() => addLesson(input.moduleId, input.title, ctx.user.id))),
    addBlock: adminProcedure.input(z.object({ lessonId: id, kind: z.enum(BLOCK_KINDS), title: z.string().max(300), body: z.string().max(100000).nullish(), externalUrl: z.string().max(600).nullish(), resourceId: id.nullish() })).mutation(({ ctx, input }) => guard(() => addBlock(input.lessonId, input, ctx.user.id))),
    duplicateCourse: adminProcedure.input(z.object({ courseId: id })).mutation(({ ctx, input }) => guard(() => duplicateCourse(input.courseId, ctx.user.id))),
    archiveCourse: adminProcedure.input(z.object({ courseId: id, archive: z.boolean() })).mutation(({ ctx, input }) => guard(() => archiveCourse(input.courseId, input.archive, ctx.user.id))),
  }),
  /** Opciones con nombres comerciales para configurar reglas: productos con sus modalidades, y cursos con sus módulos. Solo lectura. */
  catalog: adminProcedure.query(() => guard(async () => {
    const exp = await rowsOf(sql`SELECT id, title FROM experiences ORDER BY title`).catch(() => []);
    const vars = await rowsOf(sql`SELECT id, experienceId, name FROM experience_variants ORDER BY name`).catch(() => []);
    const mods = await rowsOf(sql`SELECT m.id, m.course_id, m.title FROM learning_modules m ORDER BY m.course_id, m.position`);
    const courses = await rowsOf(sql`SELECT id, title, status FROM learning_courses ORDER BY title`);
    return {
      experiences: exp.map((e) => ({ id: Number(e.id), title: String(e.title), variants: vars.filter((v) => Number(v.experienceId) === Number(e.id)).map((v) => ({ id: Number(v.id), name: String(v.name) })) })),
      courses: courses.map((c) => ({ id: Number(c.id), title: String(c.title), status: String(c.status), modules: mods.filter((m) => Number(m.course_id) === Number(c.id)).map((m) => ({ id: Number(m.id), title: String(m.title) })) })),
    };
  })),
  /** Progreso de las personas matriculadas en un curso: lecciones completadas y última actividad. Solo lectura. */
  progress: adminProcedure.input(z.object({ courseId: id })).query(({ input }) => guard(async () => {
    const total = Number((await rowsOf(sql`SELECT COUNT(*) AS c FROM learning_lessons l JOIN learning_modules m ON m.id = l.module_id WHERE m.course_id = ${input.courseId}`))[0]?.c ?? 0);
    const list = await rowsOf(sql`SELECT e.user_id, u.name AS user_name, u.email AS user_email,
        MAX(e.id) AS enrollment_id,
        SUBSTRING_INDEX(GROUP_CONCAT(e.status ORDER BY e.id DESC), ',', 1) AS status,
        MAX(e.ends_at) AS ends_at,
        (SELECT COUNT(*) FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE p.user_id = e.user_id AND m.course_id = ${input.courseId} AND p.status = 'completed') AS completed,
        (SELECT COUNT(*) FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE p.user_id = e.user_id AND m.course_id = ${input.courseId} AND p.status = 'in_progress') AS in_progress,
        (SELECT MAX(p.updated_at) FROM learning_progress p JOIN learning_lessons l ON l.id = p.lesson_id JOIN learning_modules m ON m.id = l.module_id WHERE p.user_id = e.user_id AND m.course_id = ${input.courseId}) AS last_activity
      FROM learning_enrollments e LEFT JOIN users u ON u.id = e.user_id WHERE e.course_id = ${input.courseId} GROUP BY e.user_id, u.name, u.email ORDER BY last_activity DESC, e.user_id LIMIT 500`);
    return {
      lessonsTotal: total,
      learners: list.map((r) => ({ userId: Number(r.user_id), name: r.user_name ?? null, email: r.user_email ?? null, enrollmentId: Number(r.enrollment_id), status: String(r.status ?? ""), endsAt: r.ends_at == null ? null : Number(r.ends_at), completed: Number(r.completed ?? 0), inProgress: Number(r.in_progress ?? 0), lastActivity: r.last_activity == null ? null : Number(r.last_activity) })),
    };
  })),
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
  /** Pedidos pagados con regla activa y sin matrícula: la cola de recuperación (cada uno se repara con `grantForOrder`). */
  pendingOrders: adminProcedure.query(() => guard(() => pendingLearningOrders())),
  /**
   * Recuperación manual de un PEDIDO de tienda pagado: vuelve a aplicar las reglas de catálogo a sus líneas pagadas (misma
   * función que ejecuta el cierre automático del pedido). Repetirlo no duplica matrículas ni correos.
   */
  grantForOrder: adminProcedure.input(z.object({ merchantOrder: z.string().trim().min(3).max(30) })).mutation(({ ctx, input }) => guard(() => grantLearningFromOrder(input.merchantOrder, { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null }))),
  /** Acción EXPRESA de la administración: renueva la invitación de la cuenta (enlace de un solo uso) y envía el correo. */
  sendInvite: adminProcedure.input(z.object({ userId: id })).mutation(({ input }) => guard(async () => {
    const [u] = await rowsOf(sql`SELECT id, name, email FROM users WHERE id = ${input.userId}`);
    if (!u || !u.email) throw new LearningError("NOT_FOUND", "La persona no existe o no tiene correo.");
    const acc = await ensureAccount(String(u.name ?? u.email), String(u.email));
    if (!acc.invite) return { sent: false, reason: "already_active" as const };
    return { sent: await sendLearningInvitation(acc.invite), reason: null };
  })),

  /** Cursos con sus módulos, cobertura de ficheros y los recursos pendientes (para subirlos desde el panel). */
  courses: adminProcedure.query(() => guard(async () => {
    const courses = await rowsOf(sql`SELECT id, slug, title, language, status, source_note FROM learning_courses ORDER BY id`);
    const modules = await rowsOf(sql`SELECT id, course_id, position, title FROM learning_modules ORDER BY course_id, position`);
    const out = [];
    for (const c of courses) {
      const pending = await rowsOf(sql`SELECT r.id AS resource_id, r.kind, r.original_name, m.position AS module_position, l.position AS lesson_position, l.title AS lesson_title
        FROM learning_resources r JOIN learning_blocks b ON b.resource_id = r.id JOIN learning_lessons l ON l.id = b.lesson_id JOIN learning_modules m ON m.id = l.module_id
        WHERE m.course_id = ${Number(c.id)} AND r.status = 'pending' ORDER BY m.position, l.position, b.position LIMIT 300`);
      out.push({
        id: Number(c.id), slug: String(c.slug), title: String(c.title), language: String(c.language), status: String(c.status), sourceNote: c.source_note ?? null,
        modules: modules.filter((m) => Number(m.course_id) === Number(c.id)).map((m) => ({ id: Number(m.id), position: Number(m.position), title: String(m.title) })),
        coverage: await courseCoverage(Number(c.id)),
        pending: pending.map((r) => ({ resourceId: Number(r.resource_id), kind: String(r.kind), originalName: r.original_name ?? null, module: Number(r.module_position), lesson: Number(r.lesson_position), lessonTitle: String(r.lesson_title) })),
      });
    }
    return out;
  })),
  /** Publicar o archivar un curso: solo un curso publicado lo ve un alumno con matrícula. Un curso incompleto se deja en borrador. */
  setCourseStatus: adminProcedure.input(z.object({ courseId: id, status: z.enum(["draft", "published", "archived"]) })).mutation(({ input }) => guard(async () => {
    const d = await getDb();
    if (!d) throw new Error("Base de datos no disponible");
    await d.execute(sql`UPDATE learning_courses SET status = ${input.status}, updated_at = ${Date.now()} WHERE id = ${input.courseId}`);
    return { ok: true };
  })),
  /** Demostración para una persona por correo (crea su cuenta sin enviar nada; la invitación es una acción aparte). */
  /**
   * Matrícula técnica de validación: concesión administrativa «[PRUEBA TÉCNICA]» con caducidad forzosa en un día. Es la única que
   * abre un curso en borrador. NO crea invitación, NO envía correo, NO simula pago y NO toca las reglas comerciales.
   * La persona debe existir (cuenta propia del Core): se crea la cuenta sin enviar nada y se activa con el procedimiento normal.
   */
  grantTechnical: adminProcedure
    .input(z.object({ email: z.string().email().max(320), name: z.string().min(2).max(200), courseId: id, moduleIds: z.array(id).min(1).max(50), note: z.string().max(300).nullable().optional() }))
    .mutation(({ ctx, input }) => guard(async () => {
      const acc = await ensureAccount(input.name, input.email);
      const r = await grantTechnical({ userId: acc.userId, courseId: input.courseId, moduleIds: input.moduleIds, note: input.note, actorUserId: ctx.user.id, nonce: randomBytes(8).toString("hex") });
      return { created: r.created, enrollment: r.enrollment, accountCreated: acc.created, invitePending: !!acc.invite, userId: acc.userId };
    })),

  /** Vista previa como alumno: estructura del curso con todo abierto, sin matrícula ni progreso. Cada acceso queda auditado. */
  previewCourse: adminProcedure.input(z.object({ courseId: id })).query(({ ctx, input }) =>
    guard(async () => {
      const r = await previewCourseIndex(input.courseId);
      await logPreviewAccess(ctx.user.id, "course", { courseId: input.courseId });
      return r;
    })),
  previewLesson: adminProcedure.input(z.object({ lessonId: id })).query(({ ctx, input }) =>
    guard(async () => {
      const r = await previewLessonBlocks(input.lessonId);
      await logPreviewAccess(ctx.user.id, "lesson", { courseId: r.courseId, lessonId: input.lessonId });
      return r;
    })),
  previewAccess: adminProcedure.query(() => guard(() => listPreviewAccess(100))),

  grantDemoByEmail: adminProcedure
    .input(z.object({ email: z.string().email().max(320), name: z.string().min(2).max(200), courseId: id, moduleIds: z.array(id).min(1).max(50), trigger: z.string().min(3).max(80), minutes: z.number().int().min(1).max(1440).optional() }))
    .mutation(({ ctx, input }) => guard(async () => {
      const acc = await ensureAccount(input.name, input.email);
      const r = await grantDemo({ userId: acc.userId, courseId: input.courseId, moduleIds: input.moduleIds, trigger: input.trigger, minutes: input.minutes, actorUserId: ctx.user.id });
      return { created: r.created, enrollment: r.enrollment, accountCreated: acc.created, invitePending: !!acc.invite };
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
  /**
   * Editor de formación (lote 1): borrador, publicación y versiones de la estructura y los textos. Editar NO cambia lo que ven los
   * alumnos; solo «publish» lo hace, conservando los ids (progreso, matrículas y accesos intactos). Ver server/learningEditor.ts.
   */
  editor: router({
    state: adminProcedure.input(z.object({ courseId: id })).query(({ input }) => guard(() => getEditorState(input.courseId))),
    saveDraft: adminProcedure
      .input(z.object({
        courseId: id,
        expectedUpdatedAt: z.number().int().nullable().optional(),
        tree: z.object({
          course: z.object({ title: z.string().max(2000), description: z.string().max(20000).nullable() }),
          modules: z.array(z.object({
            id, title: z.string().max(2000),
            lessons: z.array(z.object({
              id, title: z.string().max(2000),
              blocks: z.array(z.object({ id, title: z.string().max(2000), body: z.string().max(400000).nullable(), attribution: z.string().max(2000).nullable() })).max(500),
            })).max(500),
          })).max(200),
        }),
      }))
      .mutation(({ ctx, input }) => guard(() => saveDraft(input.courseId, input.tree, ctx.user.id, input.expectedUpdatedAt ?? null))),
    discardDraft: adminProcedure.input(z.object({ courseId: id })).mutation(({ input }) => guard(() => discardDraft(input.courseId))),
    publish: adminProcedure.input(z.object({ courseId: id, note: z.string().max(300).nullable().optional() })).mutation(({ ctx, input }) => guard(() => publishDraft(input.courseId, ctx.user.id, input.note ?? null))),
    restoreVersion: adminProcedure.input(z.object({ courseId: id, versionId: id, replace: z.boolean().default(false) })).mutation(({ ctx, input }) => guard(() => restoreVersion(input.courseId, input.versionId, ctx.user.id, input.replace))),
  }),

});

export const learningRouter = router({ my, admin });
