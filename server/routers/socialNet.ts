/**
 * socialNet.* — Social Token Net Complete: integración de Comunidades y Tokens internos desde el panel.
 *
 * El guardián de rutas exige los tokens internos (`socialNet` → social-token-net-tokens) y cada procedimiento comprueba
 * además las DOS capacidades (assertStn): con una sola, nada de esto responde y los paneles no lo muestran (lo saben por
 * `loyalty.overview.integration` y `communities.admin.integration`). Consultar: el equipo del panel; reglas,
 * exclusividad de recompensas y recuperación: solo administración.
 *
 * Al cargarse conecta la integración con el punto de extensión de Comunidades (registerStnCompleteIntegration).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { LIMIT_PERIODS, NAME_MAX } from "../../shared/loyalty";
import { COMMUNITY_REWARD_EVENTS, COMMUNITY_RULE_POINTS_MAX, isRevocableEvent } from "../../shared/stnComplete";
import {
  assertStn,
  catchUpCommunityRewards,
  communityOptions,
  listCommunityRules,
  memberPoints,
  registerStnCompleteIntegration,
  saveCommunityRule,
  setRewardCommunities,
  topMembers,
  unifiedStats,
  walletCommunities,
} from "../stnCompleteDb";
import { stnIntegrationActive } from "../stnIntegration";

registerStnCompleteIntegration();

const id = z.number().int().positive();
const ms = z.number().int().min(0).nullable();

const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === "user") throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso al panel" });
  return next();
});

const ruleInput = z.object({
  name: z.string().trim().min(2).max(NAME_MAX),
  eventType: z.enum(COMMUNITY_REWARD_EVENTS),
  communityId: id.nullable(),
  points: z.number().int().min(1).max(COMMUNITY_RULE_POINTS_MAX),
  limitCount: z.number().int().min(1).max(10_000).nullable(),
  limitPeriod: z.enum(LIMIT_PERIODS).nullable(),
  revokeHidden: z.boolean(),
  priority: z.number().int().min(-1000).max(1000),
  active: z.boolean(),
  startsAt: ms,
  endsAt: ms,
}).strict().superRefine((r, c) => {
  if (r.limitCount != null && !r.limitPeriod) c.addIssue({ code: "custom", message: "Elige el periodo del límite", path: ["limitPeriod"] });
  if (r.startsAt != null && r.endsAt != null && r.endsAt < r.startsAt) c.addIssue({ code: "custom", message: "La vigencia termina antes de empezar", path: ["endsAt"] });
});

export const socialNetRouter = router({
  /** ¿Está activa la integración? (comunidades y tokens a la vez). */
  status: staffProcedure.query(async ({ ctx }) => {
    const integration = await stnIntegrationActive(false);
    return { integration, canManage: integration && ctx.user.role === "admin" && (await stnIntegrationActive(true)) };
  }),

  communities: staffProcedure.query(async () => {
    await assertStn(false);
    return communityOptions();
  }),

  rules: staffProcedure.query(async () => {
    await assertStn(false);
    return listCommunityRules();
  }),

  saveRule: adminProcedure.input(z.object({ id: id.nullable(), rule: ruleInput }).strict()).mutation(async ({ input }) => {
    await assertStn(true);
    const r = input.rule;
    return saveCommunityRule(input.id, { ...r, limitPeriod: r.limitCount != null ? r.limitPeriod : null, revokeHidden: isRevocableEvent(r.eventType) && r.revokeHidden });
  }),

  /** Participación y puntos por comunidad. */
  stats: staffProcedure.query(async () => {
    await assertStn(false);
    return unifiedStats();
  }),

  topMembers: staffProcedure.input(z.object({ communityId: id.nullable().default(null), limit: z.number().int().min(1).max(50).default(10) })).query(async ({ input }) => {
    await assertStn(false);
    return topMembers(input.communityId, input.limit);
  }),

  /** Desde la comunidad: saldo de cada miembro y lo ganado participando en ella. */
  memberPoints: staffProcedure.input(z.object({ communityId: id })).query(async ({ input }) => {
    await assertStn(false);
    return memberPoints(input.communityId);
  }),

  /** Desde el monedero: las comunidades del cliente. */
  walletCommunities: staffProcedure.input(z.object({ clientId: id })).query(async ({ input }) => {
    await assertStn(false);
    return walletCommunities(input.clientId);
  }),

  /** Recompensa exclusiva para miembros de esas comunidades (lista vacía: para todos). */
  setRewardCommunities: adminProcedure.input(z.object({ rewardId: id, communityIds: z.array(id).max(50) }).strict()).mutation(async ({ input }) => {
    await assertStn(true);
    return setRewardCommunities(input.rewardId, input.communityIds);
  }),

  /** Pasada de recuperación: procesa los hechos de comunidad pendientes (idempotente). */
  catchUp: adminProcedure.mutation(async () => {
    await assertStn(true);
    return catchUpCommunityRewards();
  }),
});
