/**
 * communities.* (segunda parte) — encuestas y preguntas, propuestas de miembros y reportes de contenido.
 * Se monta dentro de communitiesRouter (server/routers/communities.ts): misma licencia (`social-token-net`), misma
 * separación entre la administración del panel (`admin.*`) y el área de miembros (`member.*`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { REASON_MAX, sanitizeText } from "../../shared/communities";
import {
  ATTENDANCE_VALUES,
  OPEN_TEXT_MAX,
  OPTION_MAX,
  PROPOSAL_STATUSES,
  QUESTION_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGETS,
  RESULTS_VISIBILITY,
  isOpenForResponses,
  canRespondAgain,
  resultsVisible,
  validateQuestionOptions,
} from "../../shared/communityPolls";
import { assertCommunities, canSeePost, getComment, getPost, requireActiveMember, requireCommunity } from "../communitiesDb";
import {
  convertProposal,
  createPoll,
  createReport,
  listPolls,
  listProposals,
  listReports,
  moderateProposal,
  myResponse,
  pollResults,
  reportTargetCommunity,
  requirePoll,
  requireProposal,
  resolveReports,
  searchExperiences,
  setPollStatus,
  setValueModeration,
  submitProposal,
  submitResponse,
  toggleSupport,
  updatePoll,
  type PollInput,
} from "../communityPollsDb";

const id = z.number().int().positive();
const ms = z.number().int().positive().nullable().optional();
const read = () => assertCommunities(false);
const write = () => assertCommunities(true);
const clean = (s: string | null | undefined, max: number) => (s == null ? null : sanitizeText(s, max) || null);

const pollInput = z.object({
  title: z.string().max(400),
  description: z.string().max(8000).nullable().optional(),
  questionType: z.enum(QUESTION_TYPES),
  options: z.array(z.object({ label: z.string().max(OPTION_MAX * 2), isPositiveIntent: z.boolean().default(false) })).max(40).default([]),
  startsAt: ms,
  endsAt: ms,
  resultsVisibility: z.enum(RESULTS_VISIBILITY).default("after_vote"),
  allowChangeResponse: z.boolean().default(true),
  experienceId: id.nullable().optional(),
  eventAt: ms,
});

/** Valida y limpia la configuración de una encuesta (la misma regla que en Segolife para tipo y opciones). */
function toPollInput(raw: z.infer<typeof pollInput>): PollInput {
  const title = sanitizeText(raw.title, 200);
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "La pregunta no puede estar vacía." });
  const v = validateQuestionOptions(raw.questionType, raw.options.map((o) => o.label));
  if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.error! });
  if (raw.startsAt && raw.endsAt && raw.endsAt <= raw.startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "El cierre debe ser posterior a la apertura." });
  const positive = new Map(raw.options.map((o) => [o.label.replace(/<[^>]*>/g, "").trim().slice(0, OPTION_MAX), o.isPositiveIntent]));
  return {
    title,
    description: clean(raw.description, 4000),
    questionType: raw.questionType,
    options: v.cleanOptions.map((label) => ({ label, isPositiveIntent: raw.questionType === "single_choice" && !!positive.get(label) })),
    startsAt: raw.startsAt ?? null,
    endsAt: raw.endsAt ?? null,
    resultsVisibility: raw.resultsVisibility,
    allowChangeResponse: raw.allowChangeResponse,
    experienceId: raw.experienceId ?? null,
    eventAt: raw.eventAt ?? null,
  };
}

const responsePayload = z.discriminatedUnion("questionType", [
  z.object({ questionType: z.literal("single_choice"), optionId: id }),
  z.object({ questionType: z.literal("yes_no"), value: z.enum(["yes", "no"]) }),
  z.object({ questionType: z.literal("percentage_scale"), values: z.array(z.object({ optionId: id, value: z.number().int() })).max(40) }),
  z.object({ questionType: z.literal("scale_1_5"), value: z.number().int() }),
  z.object({ questionType: z.literal("multiselect"), optionIds: z.array(id).max(40) }),
  z.object({ questionType: z.literal("ranking"), orderedOptionIds: z.array(id).max(40) }),
  z.object({ questionType: z.literal("attendance_intention"), value: z.enum(ATTENDANCE_VALUES) }),
  z.object({ questionType: z.literal("me_apunto") }),
  z.object({ questionType: z.literal("open_text"), text: z.string().max(OPEN_TEXT_MAX * 2) }),
]);

const proposalInput = z.object({
  title: z.string().max(400),
  description: z.string().max(8000).nullable().optional(),
  proposedQuestionType: z.enum(QUESTION_TYPES).nullable().optional(),
  proposedOptions: z.array(z.string().max(OPTION_MAX * 2)).max(40).default([]),
});

// ─── Panel de administración ──────────────────────────────────────────────────

export const adminPollRouters = {
  polls: router({
    list: adminProcedure.input(z.object({ communityId: id })).query(async ({ input, ctx }) => {
      await read();
      await requireCommunity(input.communityId);
      return listPolls(input.communityId, ctx.user.id, { includeDrafts: true });
    }),
    create: adminProcedure.input(pollInput.extend({ communityId: id, publish: z.boolean().default(true) })).mutation(async ({ input, ctx }) => {
      await write();
      const c = await requireCommunity(input.communityId);
      if (c.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "La comunidad está archivada." });
      return createPoll(c.id, toPollInput(input), { publish: input.publish, actorId: ctx.user.id });
    }),
    update: adminProcedure.input(pollInput.extend({ pollId: id })).mutation(async ({ input }) => {
      await write();
      return updatePoll(await requirePoll(input.pollId), toPollInput(input));
    }),
    setStatus: adminProcedure.input(z.object({ pollId: id, action: z.enum(["publish", "close", "cancel"]) })).mutation(async ({ input, ctx }) => {
      await write();
      return setPollStatus(await requirePoll(input.pollId), input.action, ctx.user.id);
    }),
    results: adminProcedure.input(z.object({ pollId: id })).query(async ({ input }) => {
      await read();
      return pollResults(await requirePoll(input.pollId), true);
    }),
    moderateAnswer: adminProcedure.input(z.object({ valueId: id, hidden: z.boolean().optional(), featured: z.boolean().optional() })).mutation(async ({ input }) => {
      await write();
      await setValueModeration(input.valueId, input);
      return { ok: true };
    }),
    experiences: adminProcedure.input(z.object({ search: z.string().max(100).default("") })).query(async ({ input }) => {
      await read();
      return searchExperiences(input.search);
    }),
  }),

  proposals: router({
    list: adminProcedure.input(z.object({ communityId: id, status: z.enum(PROPOSAL_STATUSES).optional() })).query(async ({ input, ctx }) => {
      await read();
      return listProposals(input.communityId, ctx.user.id, { moderate: true, status: input.status });
    }),
    moderate: adminProcedure
      .input(z.object({ proposalId: id, action: z.enum(["approve", "reject"]), reasonForMember: z.string().max(REASON_MAX).nullable().optional(), internalNote: z.string().max(REASON_MAX).nullable().optional() }))
      .mutation(async ({ input, ctx }) => {
        await write();
        if (input.action === "reject" && !input.reasonForMember?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Indica a la persona el motivo del rechazo." });
        await moderateProposal(await requireProposal(input.proposalId), input.action, clean(input.reasonForMember, REASON_MAX), clean(input.internalNote, REASON_MAX), ctx.user.id);
        return { ok: true };
      }),
    convert: adminProcedure.input(pollInput.extend({ proposalId: id, publish: z.boolean().default(true) })).mutation(async ({ input, ctx }) => {
      await write();
      return convertProposal(await requireProposal(input.proposalId), toPollInput(input), input.publish, ctx.user.id);
    }),
  }),

  reports: router({
    list: adminProcedure.input(z.object({ communityId: id, status: z.enum(REPORT_STATUSES).default("open") })).query(async ({ input }) => {
      await read();
      return listReports(input.communityId, input.status);
    }),
    resolve: adminProcedure.input(z.object({ communityId: id, target: z.enum(REPORT_TARGETS), targetId: id, action: z.enum(["hide", "dismiss"]) })).mutation(async ({ input, ctx }) => {
      await write();
      return { resolved: await resolveReports(input.communityId, input.target, input.targetId, input.action, ctx.user.id) };
    }),
  }),
};

// ─── Área de miembros ─────────────────────────────────────────────────────────

async function pollForMember(pollId: number, userId: number) {
  const poll = await requirePoll(pollId);
  const ctx = await requireActiveMember(poll.communityId, userId);
  if (poll.status === "draft" || poll.status === "cancelled") throw new TRPCError({ code: "NOT_FOUND", message: "Encuesta no encontrada." });
  return { poll, ...ctx };
}

export const memberPollProcedures = {
  polls: protectedProcedure.input(z.object({ communityId: id })).query(async ({ input, ctx }) => {
    await read();
    await requireActiveMember(input.communityId, ctx.user.id);
    return listPolls(input.communityId, ctx.user.id, { includeDrafts: false });
  }),

  /** Detalle para responder: la encuesta, mi respuesta y los resultados si son visibles para mí. */
  poll: protectedProcedure.input(z.object({ pollId: id })).query(async ({ input, ctx }) => {
    await read();
    const { poll, perms } = await pollForMember(input.pollId, ctx.user.id);
    const mine = await myResponse(poll.id, ctx.user.id);
    const now = Date.now();
    const visible = perms.moderate || resultsVisible(poll, !!mine, now);
    return {
      poll,
      myResponse: mine,
      canRespond: isOpenForResponses(poll, now) && perms.comment && (!mine || canRespondAgain(poll)),
      results: visible ? await pollResults(poll, false) : null,
    };
  }),

  respond: protectedProcedure.input(z.object({ pollId: id, payload: responsePayload })).mutation(async ({ input, ctx }) => {
    await write();
    const { poll, perms } = await pollForMember(input.pollId, ctx.user.id);
    if (!perms.comment) throw new TRPCError({ code: "FORBIDDEN", message: "La comunidad está archivada." });
    return submitResponse(poll, ctx.user.id, input.payload);
  }),

  proposals: protectedProcedure.input(z.object({ communityId: id })).query(async ({ input, ctx }) => {
    await read();
    const { perms } = await requireActiveMember(input.communityId, ctx.user.id);
    const list = await listProposals(input.communityId, ctx.user.id, { moderate: perms.moderate });
    // La nota interna nunca sale al área de miembros
    return list.map((p) => ({ ...p, internalNote: null }));
  }),

  propose: protectedProcedure.input(proposalInput.extend({ communityId: id })).mutation(async ({ input, ctx }) => {
    await write();
    const { community, perms } = await requireActiveMember(input.communityId, ctx.user.id);
    if (!perms.comment) throw new TRPCError({ code: "FORBIDDEN", message: "La comunidad está archivada." });
    const title = sanitizeText(input.title, 200);
    if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "Pon un título a tu propuesta." });
    let options: string[] = [];
    if (input.proposedQuestionType) {
      const v = validateQuestionOptions(input.proposedQuestionType, input.proposedOptions);
      if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.error! });
      options = v.cleanOptions;
    }
    const p = await submitProposal(community, ctx.user.id, { title, description: clean(input.description, 4000), proposedQuestionType: input.proposedQuestionType ?? null, proposedOptions: options });
    return { ...p, internalNote: null };
  }),

  support: protectedProcedure.input(z.object({ proposalId: id })).mutation(async ({ input, ctx }) => {
    await write();
    const p = await requireProposal(input.proposalId, ctx.user.id);
    const { perms } = await requireActiveMember(p.communityId, ctx.user.id);
    if (!perms.react) throw new TRPCError({ code: "FORBIDDEN", message: "La comunidad está archivada." });
    if (!perms.moderate && p.status !== "approved" && p.status !== "converted" && !p.isOwn) throw new TRPCError({ code: "NOT_FOUND", message: "Propuesta no encontrada." });
    return toggleSupport(p, ctx.user.id);
  }),

  /** Reportar contenido a la moderación (publicación, comentario o propuesta de la propia comunidad). */
  report: protectedProcedure
    .input(z.object({ target: z.enum(REPORT_TARGETS), targetId: id, reason: z.enum(REPORT_REASONS), details: z.string().max(1000).nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      await write();
      const t = await reportTargetCommunity(input.target, input.targetId);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Contenido no encontrado." });
      const { perms } = await requireActiveMember(t.communityId, ctx.user.id);
      if (input.target === "post") {
        const p = await getPost(input.targetId);
        if (!p || !canSeePost(p, ctx.user.id, perms.moderate)) throw new TRPCError({ code: "NOT_FOUND", message: "Contenido no encontrado." });
      } else if (input.target === "comment") {
        const c = await getComment(input.targetId);
        if (!c || (c.hidden && !perms.moderate)) throw new TRPCError({ code: "NOT_FOUND", message: "Contenido no encontrado." });
      }
      if (t.authorUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes reportar tu propio contenido." });
      return createReport(t.communityId, input.target, input.targetId, ctx.user.id, input.reason, clean(input.details, 500));
    }),

  /** Reportes pendientes para la moderación de la comunidad. */
  reports: protectedProcedure.input(z.object({ communityId: id })).query(async ({ input, ctx }) => {
    await read();
    const { perms } = await requireActiveMember(input.communityId, ctx.user.id);
    if (!perms.moderate) throw new TRPCError({ code: "FORBIDDEN", message: "Tu rol en la comunidad no permite esta acción." });
    return listReports(input.communityId, "open");
  }),

  resolveReport: protectedProcedure.input(z.object({ communityId: id, target: z.enum(REPORT_TARGETS), targetId: id, action: z.enum(["hide", "dismiss"]) })).mutation(async ({ input, ctx }) => {
    await write();
    const { perms } = await requireActiveMember(input.communityId, ctx.user.id);
    if (!perms.moderate) throw new TRPCError({ code: "FORBIDDEN", message: "Tu rol en la comunidad no permite esta acción." });
    return { resolved: await resolveReports(input.communityId, input.target, input.targetId, input.action, ctx.user.id) };
  }),
};
