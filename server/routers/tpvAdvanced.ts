/**
 * TPV Advanced (namespace `tpvAdvanced`, Elephant Connect, capacidad `pos-advanced`): arqueos y conciliaciones,
 * turnos, entrega y recepción de caja, autorizaciones especiales, auditoría e informes con exportación CSV.
 *
 * Licencia: la del namespace en server/_core/capabilities/routeGuard.ts y, además, en cada procedimiento
 * (`tpvAdvancedAllowed`): las consultas del histórico se permiten también en solo lectura; registrar exige la licencia
 * activa. Perder la licencia nunca borra nada. En la instalación única, todo permitido.
 * Permisos: los del TPV (`tpv.access` consultar, `tpv.open_close` operar la caja, `tpv.backoffice` reglas, informes,
 * auditoría y correcciones) y `tpv.authorize` para autorizar (por defecto, administración).
 * La lógica vive en server/tpvAdvancedDb.ts y shared/tpvAdvanced.ts. No cambia el flujo de cobro de `tpv`.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { permissionProcedure, router } from "../_core/trpc";
import { checkPermission } from "../customRolesAccess";
import { userMayUseSite } from "../sitesDb";
import { IDEMPOTENCY_KEY_RE } from "../tpvSaleIdempotency";
import { tpvAdvancedAllowed } from "../tpvRulesDb";
import * as adv from "../tpvAdvancedDb";
import { advCsvFilename, advSectionCsv } from "../tpvAdvancedCsv";
import { ADV_REPORT_SECTIONS, AUDIT_TYPES, AUTH_KINDS, AUTH_STATUSES, CORRECTION_TARGETS, COUNT_KINDS, type AdvReportSection } from "../../shared/tpvAdvanced";

const NOT_INCLUDED = "TPV Advanced no está incluido en tu plan. Puedes solicitarlo desde «Suscripción».";
const READ_ONLY = "Tu licencia de TPV Advanced está en solo lectura: puedes consultar el histórico, pero no registrar operaciones nuevas.";

/** Además del guardián de rutas: consultas en solo lectura; registrar exige la licencia activa. */
const licensed = <P extends { use: (fn: any) => P }>(p: P): P =>
  p.use(async ({ type, next }: { type: string; next: () => Promise<unknown> }) => {
    if (type === "mutation" && !(await tpvAdvancedAllowed(true))) {
      throw new TRPCError({ code: "FORBIDDEN", message: (await tpvAdvancedAllowed(false)) ? READ_ONLY : NOT_INCLUDED });
    }
    if (type !== "mutation" && !(await tpvAdvancedAllowed(false))) throw new TRPCError({ code: "FORBIDDEN", message: NOT_INCLUDED });
    return next();
  });

const accessProc = licensed(permissionProcedure("tpv.access", ["admin", "agente"]));
const operateProc = licensed(permissionProcedure("tpv.open_close", ["admin", "agente"]));
const backofficeProc = licensed(permissionProcedure("tpv.backoffice", ["admin"]));
const authorizeProc = licensed(permissionProcedure("tpv.authorize", ["admin"]));

type U = { id: number; name?: string | null; email?: string | null; role: unknown };
const actorOf = (u: U): adv.Actor => ({ id: u.id, name: u.name || u.email || "Operador" });
const isManager = (u: U) => checkPermission(u.id, u.role as string, "tpv.backoffice", ["admin"]);
const isSupervisor = (u: U) => checkPermission(u.id, u.role as string, "tpv.authorize", ["admin"]);

/** La caja es de una sede en la que trabaja el usuario (varias sedes, Business). */
async function assertSessionSite(u: U, sessionId: number) {
  const s = await adv.getSession(sessionId);
  if (!(await userMayUseSite({ id: u.id, role: String(u.role) }, s.siteId))) throw new TRPCError({ code: "FORBIDDEN", message: "Esta caja es de una sede en la que no trabajas" });
  return s;
}

const id = z.number().int().positive();
const key = z.string().regex(IDEMPOTENCY_KEY_RE);
const amount = z.number().finite().min(0).max(9_999_999);
const note = z.string().trim().max(500).nullish();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: day, to: day, registerId: id.nullish() });

const auditFilter = { types: z.array(z.enum(AUDIT_TYPES)).max(AUDIT_TYPES.length).optional(), actor: z.string().trim().max(100).nullish() };

async function sectionData(section: AdvReportSection, f: z.infer<typeof range> & { types?: (typeof AUDIT_TYPES)[number][]; actor?: string | null }) {
  switch (section) {
    case "turnos":
      return { turnos: await adv.shiftsReport(f) };
    case "operadores":
      return { operadores: await adv.operatorsReport(f) };
    case "arqueos":
      return { arqueos: await adv.countsReport(f) };
    case "entregas":
      return { entregas: await adv.handoversReport(f) };
    case "autorizaciones":
      return { autorizaciones: await adv.authorizationsReport(f) };
    case "auditoria":
      return { auditoria: (await adv.buildAudit(f)).events };
  }
}

export const tpvAdvancedRouter = router({
  // Estado para el panel: si se puede registrar (licencia activa) y qué puede hacer el usuario
  status: accessProc.query(async ({ ctx }) => {
    const [canWrite, manager, supervisor] = await Promise.all([tpvAdvancedAllowed(true), isManager(ctx.user), isSupervisor(ctx.user)]);
    return { canWrite, isManager: manager, isSupervisor: supervisor, userId: ctx.user.id };
  }),

  // Solo las cajas de las sedes en las que trabaja el usuario (varias sedes, Business)
  sessions: accessProc.query(({ ctx }) => adv.listSessions(7, (siteId) => userMayUseSite({ id: ctx.user.id, role: String(ctx.user.role) }, siteId))),
  sessionDetail: accessProc.input(z.object({ sessionId: id })).query(async ({ ctx, input }) => {
    await assertSessionSite(ctx.user, input.sessionId);
    const d = await adv.sessionDetail(input.sessionId);
    // Las solicitudes de autorización de otros solo las ven supervisores y administración del TPV
    if (!(await isSupervisor(ctx.user)) && !(await isManager(ctx.user))) d.authorizations = d.authorizations.filter((a) => a.requestedBy === ctx.user.id);
    return d;
  }),
  operators: accessProc.query(() => adv.listOperators()),

  // ── Arqueos y conciliaciones ──────────────────────────────────────────────
  createCount: operateProc
    .input(z.object({
      sessionId: id,
      kind: z.enum(COUNT_KINDS),
      denominations: z.record(z.string().regex(/^\d{1,5}$/), z.number().int().min(0).max(100_000)),
      declaredCard: amount.nullish(),
      declaredBizum: amount.nullish(),
      declaredOther: amount.nullish(),
      notes: note,
      idempotencyKey: key,
    }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, input.sessionId);
      const { idempotencyKey, ...rest } = input;
      return adv.createCount({ ...rest, key: idempotencyKey }, actorOf(ctx.user));
    }),

  // ── Turnos ────────────────────────────────────────────────────────────────
  startShift: operateProc
    .input(z.object({ sessionId: id, openingCash: amount, notes: note, idempotencyKey: key }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, input.sessionId);
      return adv.startShift({ sessionId: input.sessionId, openingCash: input.openingCash, notes: input.notes, key: input.idempotencyKey }, actorOf(ctx.user));
    }),
  endShift: operateProc
    .input(z.object({ shiftId: id, closingCash: amount, notes: note, idempotencyKey: key }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, (await adv.getShift(input.shiftId)).sessionId);
      return adv.endShift({ shiftId: input.shiftId, closingCash: input.closingCash, notes: input.notes, key: input.idempotencyKey }, actorOf(ctx.user), await isManager(ctx.user));
    }),

  // ── Entrega y recepción de caja ──────────────────────────────────────────
  declareHandover: operateProc
    .input(z.object({ sessionId: id, declaredCash: amount, toUserId: id.nullish(), notes: note, idempotencyKey: key }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, input.sessionId);
      return adv.declareHandover({ sessionId: input.sessionId, declaredCash: input.declaredCash, toUserId: input.toUserId, notes: input.notes, key: input.idempotencyKey }, actorOf(ctx.user));
    }),
  receiveHandover: operateProc
    .input(z.object({ handoverId: id, receivedCash: amount, notes: note, idempotencyKey: key }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, (await adv.getHandover(input.handoverId)).sessionId);
      return adv.receiveHandover({ handoverId: input.handoverId, receivedCash: input.receivedCash, notes: input.notes, key: input.idempotencyKey }, actorOf(ctx.user));
    }),
  cancelHandover: operateProc
    .input(z.object({ handoverId: id }))
    .mutation(async ({ ctx, input }) => {
      await assertSessionSite(ctx.user, (await adv.getHandover(input.handoverId)).sessionId);
      return adv.cancelHandover(input.handoverId, actorOf(ctx.user), await isManager(ctx.user));
    }),

  // ── Correcciones trazables de un arqueo, turno o entrega (el original no cambia) ──
  addCorrection: backofficeProc
    .input(z.object({
      targetKind: z.enum(CORRECTION_TARGETS),
      targetId: id,
      amount: z.number().finite().refine((n) => Math.abs(n) < 1e7, "Importe no válido").nullable(),
      reason: z.string().trim().min(5).max(500),
      idempotencyKey: key,
    }))
    .mutation(({ ctx, input }) => adv.addRecordCorrection({ targetKind: input.targetKind, targetId: input.targetId, amount: input.amount, reason: input.reason, key: input.idempotencyKey }, actorOf(ctx.user))),

  // ── Autorizaciones especiales ────────────────────────────────────────────
  rules: accessProc.query(() => adv.listRules()),
  setRule: backofficeProc
    .input(z.object({ kind: z.enum(AUTH_KINDS), enabled: z.boolean(), threshold: z.number().finite().nullable() }))
    .mutation(({ ctx, input }) => adv.setRule(input, actorOf(ctx.user))),
  checkAuthorization: accessProc
    .input(z.object({ kind: z.enum(AUTH_KINDS), amount: z.number().finite().nullish() }))
    .query(({ input }) => adv.checkRequirement(input.kind, input.amount ?? null)),
  requestAuthorization: operateProc
    .input(z.object({
      kind: z.enum(AUTH_KINDS),
      sessionId: id.nullish(),
      amount: amount.nullish(),
      reference: z.string().trim().max(120).nullish(),
      reason: z.string().trim().min(3).max(500),
      idempotencyKey: key,
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId) await assertSessionSite(ctx.user, input.sessionId);
      return adv.requestAuthorization({ kind: input.kind, sessionId: input.sessionId, amount: input.amount, reference: input.reference, reason: input.reason, key: input.idempotencyKey }, actorOf(ctx.user));
    }),
  decideAuthorization: authorizeProc
    .input(z.object({ id, approve: z.boolean(), note }))
    .mutation(async ({ ctx, input }) => {
      const a = await adv.getAuthorization(input.id);
      if (a.sessionId) await assertSessionSite(ctx.user, a.sessionId);
      return adv.decideAuthorization(input, actorOf(ctx.user));
    }),
  cancelAuthorization: operateProc
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => adv.cancelAuthorization(input.id, actorOf(ctx.user), await isManager(ctx.user))),
  // Aplicar una autorización aprobada a la operación hecha (una vez; p. ej. el número de ticket)
  useAuthorization: operateProc
    .input(z.object({ id, kind: z.enum(AUTH_KINDS), amount: amount.nullish(), sessionId: id.nullish(), usedRef: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const a = await adv.getAuthorization(input.id);
      if (a.requestedBy !== ctx.user.id && !(await isManager(ctx.user))) throw new TRPCError({ code: "FORBIDDEN", message: "Solo quien pidió la autorización o la administración del TPV puede aplicarla." });
      return adv.consumeAuthorization(input);
    }),
  // Supervisores y administración: todas; el resto, las suyas
  authorizations: accessProc
    .input(z.object({ status: z.enum(AUTH_STATUSES).nullish(), sessionId: id.nullish() }).optional())
    .query(async ({ ctx, input }) => {
      const all = (await isSupervisor(ctx.user)) || (await isManager(ctx.user));
      return adv.listAuthorizations({ status: input?.status ?? null, sessionId: input?.sessionId ?? null, requestedBy: all ? null : ctx.user.id });
    }),

  // ── Auditoría e informes (administración del TPV) ─────────────────────────
  audit: backofficeProc
    .input(range.extend(auditFilter))
    .query(({ input }) => adv.buildAudit(input)),
  report: backofficeProc
    .input(range.extend({ section: z.enum(ADV_REPORT_SECTIONS) }))
    .query(({ input }) => sectionData(input.section, input)),
  // El CSV de la auditoría respeta los mismos filtros que la pantalla
  exportCsv: backofficeProc
    .input(range.extend({ section: z.enum(ADV_REPORT_SECTIONS), ...auditFilter }))
    .query(async ({ input }) => ({ filename: advCsvFilename(input.section, input.from, input.to), csv: advSectionCsv(input.section, await sectionData(input.section, input)) })),
});
