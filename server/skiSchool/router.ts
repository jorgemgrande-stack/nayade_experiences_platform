/**
 * API tRPC de Ski Net · Escuela (`skiSchool.*`). Solo administración: todavía no hay reserva pública ni portal del
 * profesor.
 *
 * La licencia NO va en `capabilityRouteGuard` (que no conoce la sede): la aplica el servicio en cada procedimiento
 * con la licencia por capacidad `ski-school` de la sede. Los errores del SDK salen tipados
 * (`[module_not_licensed] …`, `[module_read_only] …`, `[module_not_active] …`, `[module_not_installed] …`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, employeeProcedure, router } from "../_core/trpc";
import { getSystemSetting } from "../config";
import { SdkError, getSdkRuntime, installSdkModule, toTrpcError } from "../sdk";
import { skiSchoolModule } from "./manifest";
import { ABSENCE_KINDS, PRODUCT_KINDS } from "./rules";
import { SkiSchoolError, SkiSchoolService } from "./service";
import { TenantDbSkiSchoolStore } from "./store";
import { SkiTeacherService } from "./teacherService";
import { TenantDbSkiTeacherStore } from "./teacherStore";
import { ATTENDANCE_STATUSES, PAY_MODES } from "./teachers";

// Un módulo que no valida no impide arrancar al Core: queda sin registrar y sus rutas responden NOT_FOUND
try {
  installSdkModule(skiSchoolModule);
} catch (e) {
  console.warn(JSON.stringify({ ctx: "SkiSchool", event: "install_failed", error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

const school = new TenantDbSkiSchoolStore();
const service = new SkiSchoolService({
  store: school,
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});
const teachers = new SkiTeacherService({
  store: new TenantDbSkiTeacherStore(),
  school,
  gate: () => getSdkRuntime().gate,
  events: () => getSdkRuntime().events,
});

const CODES: Record<SkiSchoolError["code"], TRPCError["code"]> = { invalid_input: "BAD_REQUEST", not_found: "NOT_FOUND", conflict: "CONFLICT" };

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SdkError) throw toTrpcError(e);
    if (e instanceof SkiSchoolError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    throw e;
  }
}

const site = z.object({ siteId: z.string().min(1).max(63) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const id = z.number().int().positive();
const codes = z.array(z.string().max(16)).max(20);
const optText = (max: number) => z.string().max(max).nullable().optional();
const optAge = z.number().int().min(0).max(120).nullable().optional();
const codeLabels = z.array(z.object({ code: z.string().max(16), label: z.string().max(60) })).max(20);
const weekly = z.array(z.object({ day: z.number().int().min(0).max(6), start: time, end: time })).max(42);
const actor = (ctx: { user: { id: number } }) => `user:${ctx.user.id}`;

const instructorFields = {
  fullName: z.string().max(120),
  email: optText(200),
  phone: optText(30),
  modalities: codes.optional(),
  levels: codes.optional(),
  languages: codes.optional(),
  minAge: optAge,
  maxAge: optAge,
  weekly: weekly.optional(),
  notes: optText(1000),
};
const productFields = {
  name: z.string().max(120),
  kind: z.enum(PRODUCT_KINDS),
  durationMinutes: z.number().int(),
  capacity: z.number().int(),
  level: z.string().max(16).nullable().optional(),
  modality: z.string().max(16).nullable().optional(),
  minAge: optAge,
  maxAge: optAge,
};

export const skiSchoolRouter = router({
  status: adminProcedure.input(site).query(({ input }) => handle(() => service.status(input.siteId))),
  activateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.activateSite(input.siteId, actor(ctx)))),
  deactivateSite: adminProcedure.input(site).mutation(({ input, ctx }) => handle(() => service.deactivateSite(input.siteId, actor(ctx)))),
  updateConfig: adminProcedure
    .input(
      site.extend({
        levels: codeLabels.optional(),
        modalities: codeLabels.optional(),
        languages: codeLabels.optional(),
        dayStart: time.optional(),
        dayEnd: time.optional(),
        limits: z.object({ maxDailySessions: z.number().int().optional(), maxConsecutiveSessions: z.number().int().optional(), minTransferMinutes: z.number().int().optional() }).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => service.updateConfig(siteId, rest, actor(ctx)));
    }),

  listInstructors: adminProcedure.input(site).query(({ input }) => handle(() => service.listInstructors(input.siteId))),
  createInstructor: adminProcedure.input(site.extend(instructorFields)).mutation(({ input }) => {
    const { siteId, ...rest } = input;
    return handle(() => service.createInstructor(siteId, rest));
  }),
  updateInstructor: adminProcedure
    .input(site.extend({ ...instructorFields, fullName: instructorFields.fullName.optional(), instructorId: id, active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const { siteId, instructorId, ...rest } = input;
      return handle(() => service.updateInstructor(siteId, instructorId, rest));
    }),
  listAbsences: adminProcedure
    .input(site.extend({ from: day, to: day, instructorId: id.optional() }))
    .query(({ input }) => handle(() => service.listAbsences(input.siteId, input.from, input.to, input.instructorId))),
  addAbsence: adminProcedure
    .input(site.extend({ instructorId: id, startDate: day, endDate: day.optional(), kind: z.enum(ABSENCE_KINDS), startTime: time.nullable().optional(), endTime: time.nullable().optional(), reason: optText(200) }))
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => service.addAbsence(siteId, rest, actor(ctx)));
    }),
  cancelAbsence: adminProcedure.input(site.extend({ absenceId: id })).mutation(({ input }) => handle(() => service.cancelAbsence(input.siteId, input.absenceId))),

  listProducts: adminProcedure.input(site).query(({ input }) => handle(() => service.listProducts(input.siteId))),
  createProduct: adminProcedure.input(site.extend(productFields)).mutation(({ input }) => {
    const { siteId, ...rest } = input;
    return handle(() => service.createProduct(siteId, rest));
  }),
  updateProduct: adminProcedure
    .input(
      site.extend({
        productId: id,
        name: productFields.name.optional(),
        kind: productFields.kind.optional(),
        durationMinutes: productFields.durationMinutes.optional(),
        capacity: productFields.capacity.optional(),
        level: productFields.level,
        modality: productFields.modality,
        minAge: optAge,
        maxAge: optAge,
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { siteId, productId, ...rest } = input;
      return handle(() => service.updateProduct(siteId, productId, rest));
    }),

  listSessions: adminProcedure.input(site.extend({ from: day, to: day })).query(({ input }) => handle(() => service.listSessions(input.siteId, input.from, input.to))),
  getSession: adminProcedure.input(site.extend({ sessionId: id })).query(({ input }) => handle(() => service.getSession(input.siteId, input.sessionId))),
  findReservation: adminProcedure.input(site.extend({ reservationId: id })).query(({ input }) => handle(() => service.findReservation(input.siteId, input.reservationId))),
  createSession: adminProcedure
    .input(
      site.extend({
        productId: id,
        date: day,
        startTime: time,
        endTime: time.optional(),
        modality: z.string().max(16).nullable().optional(),
        level: z.string().max(16).nullable().optional(),
        language: z.string().max(16).nullable().optional(),
        capacity: z.number().int().optional(),
        reservationId: id.nullable().optional(),
        meetingPoint: optText(120),
        notes: optText(1000),
      }),
    )
    .mutation(({ input, ctx }) => {
      const { siteId, ...rest } = input;
      return handle(() => service.createSession(siteId, rest, actor(ctx)));
    }),
  updateSession: adminProcedure
    .input(site.extend({ sessionId: id, capacity: z.number().int().optional(), level: z.string().max(16).nullable().optional(), language: z.string().max(16).nullable().optional(), meetingPoint: optText(120), notes: optText(1000) }))
    .mutation(({ input }) => {
      const { siteId, sessionId, ...rest } = input;
      return handle(() => service.updateSession(siteId, sessionId, rest));
    }),
  cancelSession: adminProcedure.input(site.extend({ sessionId: id })).mutation(({ input }) => handle(() => service.cancelSession(input.siteId, input.sessionId))),
  completeSession: adminProcedure.input(site.extend({ sessionId: id })).mutation(({ input }) => handle(() => service.completeSession(input.siteId, input.sessionId))),
  assignInstructor: adminProcedure
    .input(site.extend({ sessionId: id, instructorId: id }))
    .mutation(({ input }) => handle(() => service.assignInstructor(input.siteId, input.sessionId, input.instructorId))),
  unassignInstructor: adminProcedure.input(site.extend({ sessionId: id })).mutation(({ input }) => handle(() => service.unassignInstructor(input.siteId, input.sessionId))),
  suggestInstructors: adminProcedure.input(site.extend({ sessionId: id })).query(({ input }) => handle(() => service.suggestInstructors(input.siteId, input.sessionId))),
  addParticipant: adminProcedure
    .input(site.extend({ sessionId: id, name: z.string().max(120), age: optAge, level: z.string().max(16).nullable().optional(), notes: optText(500) }))
    .mutation(({ input }) => {
      const { siteId, sessionId, ...rest } = input;
      return handle(() => service.addParticipant(siteId, sessionId, rest));
    }),
  cancelParticipant: adminProcedure.input(site.extend({ participantId: id })).mutation(({ input }) => handle(() => service.cancelParticipant(input.siteId, input.participantId))),

  planning: adminProcedure.input(site.extend({ date: day })).query(({ input }) => handle(() => service.planning(input.siteId, input.date))),
  // ── Profesores: horas, asistencia, liquidaciones y portal ──
  updateTerms: adminProcedure
    .input(
      site.extend({
        instructorId: id,
        payMode: z.enum(PAY_MODES).nullable(),
        hourlyRateCents: z.number().int().nullable().optional(),
        percentBp: z.number().int().nullable().optional(),
        monthlyCents: z.number().int().nullable().optional(),
        requiredMinutesWeek: z.number().int().nullable().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const { siteId, instructorId, ...terms } = input;
      return handle(() => teachers.updateTerms(siteId, instructorId, terms, actor(ctx)));
    }),
  linkUser: adminProcedure
    .input(site.extend({ instructorId: id, email: z.string().max(200).nullable() }))
    .mutation(({ input, ctx }) => handle(() => teachers.linkUser(input.siteId, input.instructorId, input.email, actor(ctx)))),
  hoursSummary: adminProcedure.input(site.extend({ from: day, to: day })).query(({ input }) => handle(() => teachers.hoursSummary(input.siteId, input.from, input.to))),
  getAttendance: adminProcedure.input(site.extend({ sessionId: id })).query(({ input }) => handle(() => teachers.getAttendance(input.siteId, input.sessionId))),
  recordAttendance: adminProcedure
    .input(site.extend({ sessionId: id, entries: z.array(z.object({ participantId: id, status: z.enum(ATTENDANCE_STATUSES) })).max(100) }))
    .mutation(({ input, ctx }) => handle(() => teachers.recordAttendance(input.siteId, input.sessionId, input.entries, actor(ctx)))),
  previewSettlement: adminProcedure
    .input(site.extend({ instructorId: id, from: day, to: day }))
    .query(({ input }) => handle(() => teachers.previewSettlement(input.siteId, input.instructorId, input.from, input.to))),
  closeSettlement: adminProcedure
    .input(site.extend({ instructorId: id, from: day, to: day }))
    .mutation(({ input, ctx }) => handle(() => teachers.closeSettlement(input.siteId, input.instructorId, input.from, input.to, actor(ctx)))),
  voidSettlement: adminProcedure
    .input(site.extend({ settlementId: id, reason: z.string().max(300) }))
    .mutation(({ input, ctx }) => handle(() => teachers.voidSettlement(input.siteId, input.settlementId, input.reason, actor(ctx)))),
  listSettlements: adminProcedure.input(site.extend({ instructorId: id.optional() })).query(({ input }) => handle(() => teachers.listSettlements(input.siteId, input.instructorId))),
  getSettlement: adminProcedure.input(site.extend({ settlementId: id })).query(({ input }) => handle(() => teachers.getSettlement(input.siteId, input.settlementId))),
  exportSettlementCsv: adminProcedure.input(site.extend({ settlementId: id })).query(({ input }) => handle(() => teachers.exportCsv(input.siteId, input.settlementId))),
  exportSettlementPdf: adminProcedure.input(site.extend({ settlementId: id })).mutation(async ({ input }) => {
    const company = await getSystemSetting("brand_name", "");
    return handle(() => teachers.exportPdf(input.siteId, input.settlementId, company));
  }),
  /** Portal del empleado: el profesor vinculado a este usuario ve sus próximas clases y sus horas del mes. */
  myClasses: employeeProcedure.query(({ ctx }) => handle(() => teachers.myClasses(ctx.user.id))),
});
