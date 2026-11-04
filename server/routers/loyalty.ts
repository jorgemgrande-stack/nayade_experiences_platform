/**
 * loyalty.* — Social Token Net · Tokens internos (capacidad `social-token-net-tokens`) desde el panel de la empresa.
 *
 * La licencia la aplica el guardián de rutas (`loyalty` → social-token-net-tokens en TRPC_ROUTER_CAPABILITIES) y cada
 * procedimiento la comprueba además aquí. Consultar (resumen, monederos, historial): el equipo del panel. Programa,
 * reglas, campañas, ajustes, anulaciones y acciones: solo administración. La emisión por compras y su anulación están
 * en server/loyaltyDb.ts (TPV, tienda online y anulaciones).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  LIMIT_PERIODS,
  LOYALTY_ACTIONS,
  NAME_MAX,
  OPERATION_KEY_RE,
  POINTS_MAX,
  REASON_MAX,
  RULE_CALCS,
  RULE_SCOPES,
  RULE_TRIGGERS,
} from "../../shared/loyalty";
import {
  adjustPoints,
  assertLoyalty,
  awardActionPoints,
  campaignUsage,
  catalogOptions,
  clientLedger,
  expireAllWallets,
  expireWallet,
  getProgram,
  listCampaigns,
  listRules,
  listWallets,
  reverseMovement,
  saveCampaign,
  saveProgram,
  saveRule,
  searchClients,
  stats,
  walletOf,
} from "../loyaltyDb";

const id = z.number().int().positive();
const opKey = z.string().regex(OPERATION_KEY_RE);
const points = z.number().int().min(1).max(POINTS_MAX);
const reason = z.string().trim().max(REASON_MAX);
const ms = z.number().int().min(0).nullable();

const actorOf = (u: { id: number; name?: string | null; email?: string | null }) => ({ id: u.id, name: u.name || u.email || `usuario-${u.id}` });

/** El equipo del panel consulta (nunca la cuenta de cliente). */
const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === "user") throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso al panel" });
  return next();
});

const ruleInput = z.object({
  name: z.string().trim().min(2).max(NAME_MAX),
  trigger: z.enum(RULE_TRIGGERS),
  actionKey: z.enum(LOYALTY_ACTIONS).nullable(),
  scope: z.enum(RULE_SCOPES),
  scopeId: id.nullable(),
  calc: z.enum(RULE_CALCS),
  rate: z.number().min(0).max(10_000).nullable(),
  fixedPoints: z.number().int().min(0).max(POINTS_MAX).nullable(),
  minSpend: z.number().min(0).max(1_000_000).nullable(),
  maxPoints: z.number().int().min(1).max(POINTS_MAX).nullable(),
  limitCount: z.number().int().min(1).max(10_000).nullable(),
  limitPeriod: z.enum(LIMIT_PERIODS).nullable(),
  priority: z.number().int().min(-1000).max(1000),
  active: z.boolean(),
  startsAt: ms,
  endsAt: ms,
}).strict().superRefine((r, c) => {
  if (r.trigger === "action" && !r.actionKey) c.addIssue({ code: "custom", message: "Elige la acción que premia la regla", path: ["actionKey"] });
  if (r.trigger === "action" && r.calc !== "fixed") c.addIssue({ code: "custom", message: "Las acciones dan puntos fijos", path: ["calc"] });
  if (r.calc === "fixed" && !(r.fixedPoints && r.fixedPoints > 0)) c.addIssue({ code: "custom", message: "Indica los puntos fijos", path: ["fixedPoints"] });
  if (r.calc !== "fixed" && !(r.rate && r.rate > 0)) c.addIssue({ code: "custom", message: "Indica la tasa de puntos", path: ["rate"] });
  if (r.scope !== "all" && !r.scopeId) c.addIssue({ code: "custom", message: "Elige el producto o la categoría", path: ["scopeId"] });
  if (r.limitCount != null && !r.limitPeriod) c.addIssue({ code: "custom", message: "Elige el periodo del límite", path: ["limitPeriod"] });
  if (r.startsAt != null && r.endsAt != null && r.endsAt < r.startsAt) c.addIssue({ code: "custom", message: "La vigencia termina antes de empezar", path: ["endsAt"] });
});

const campaignInput = z.object({
  name: z.string().trim().min(2).max(NAME_MAX),
  scope: z.enum(RULE_SCOPES),
  scopeId: id.nullable(),
  multiplier: z.number().min(1).max(100).nullable(),
  bonusPoints: z.number().int().min(1).max(POINTS_MAX).nullable(),
  budgetPoints: z.number().int().min(1).max(1_000_000_000).nullable(),
  perClientLimit: z.number().int().min(1).max(POINTS_MAX).nullable(),
  limitPeriod: z.enum(LIMIT_PERIODS).nullable(),
  priority: z.number().int().min(-1000).max(1000),
  active: z.boolean(),
  startsAt: ms,
  endsAt: ms,
}).strict().superRefine((x, c) => {
  if (x.multiplier == null && x.bonusPoints == null) c.addIssue({ code: "custom", message: "Indica un multiplicador o una bonificación", path: ["multiplier"] });
  if (x.scope !== "all" && !x.scopeId) c.addIssue({ code: "custom", message: "Elige el producto o la categoría", path: ["scopeId"] });
  if (x.perClientLimit != null && !x.limitPeriod) c.addIssue({ code: "custom", message: "Elige el periodo del límite", path: ["limitPeriod"] });
  if (x.startsAt != null && x.endsAt != null && x.endsAt < x.startsAt) c.addIssue({ code: "custom", message: "La vigencia termina antes de empezar", path: ["endsAt"] });
});

async function canManage(role: string): Promise<boolean> {
  if (role !== "admin") return false;
  return assertLoyalty(true).then(() => true, () => false);
}

export const loyaltyRouter = router({
  /** Programa, estadísticas y qué puede hacer el usuario. */
  overview: staffProcedure.query(async ({ ctx }) => {
    await assertLoyalty(false);
    const [program, s, manage] = await Promise.all([getProgram(), stats(), canManage(ctx.user.role)]);
    return { program, stats: s, canManage: manage };
  }),

  saveProgram: adminProcedure
    .input(z.object({
      enabled: z.boolean(),
      pointsName: z.string().trim().min(2).max(40),
      eqPoints: z.number().int().min(1).max(POINTS_MAX).nullable(),
      eqEuros: z.number().min(0.01).max(100_000).nullable(),
      expiryMonths: z.number().int().min(1).max(120).nullable(),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertLoyalty(true);
      if ((input.eqPoints == null) !== (input.eqEuros == null)) throw new TRPCError({ code: "BAD_REQUEST", message: "La equivalencia necesita puntos y euros" });
      return saveProgram(input, actorOf(ctx.user));
    }),

  rules: staffProcedure.query(async () => {
    await assertLoyalty(false);
    return listRules();
  }),

  saveRule: adminProcedure
    .input(z.object({ id: id.nullable(), rule: ruleInput }).strict())
    .mutation(async ({ input }) => {
      await assertLoyalty(true);
      const r = input.rule;
      return saveRule(input.id, { ...r, actionKey: r.trigger === "action" ? r.actionKey : null, scope: r.trigger === "action" ? "all" : r.scope, scopeId: r.trigger === "action" || r.scope === "all" ? null : r.scopeId });
    }),

  campaigns: staffProcedure.query(async () => {
    await assertLoyalty(false);
    const [list, usage] = await Promise.all([listCampaigns(), campaignUsage()]);
    return list.map((c) => ({ ...c, used: usage.get(c.id) ?? 0 }));
  }),

  saveCampaign: adminProcedure
    .input(z.object({ id: id.nullable(), campaign: campaignInput }).strict())
    .mutation(async ({ input }) => {
      await assertLoyalty(true);
      const c = input.campaign;
      return saveCampaign(input.id, { ...c, scopeId: c.scope === "all" ? null : c.scopeId });
    }),

  catalog: adminProcedure.query(async () => {
    await assertLoyalty(false);
    return catalogOptions();
  }),

  wallets: staffProcedure
    .input(z.object({ search: z.string().max(120).optional(), page: z.number().int().min(1).max(10_000).default(1), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      await assertLoyalty(false);
      return listWallets({ search: input.search, limit: input.limit, offset: (input.page - 1) * input.limit });
    }),

  /** Monedero e historial de un cliente (aplica antes la caducidad pendiente). */
  wallet: staffProcedure.input(z.object({ clientId: id })).query(async ({ input }) => {
    await assertLoyalty(false);
    if (await assertLoyalty(true).then(() => true, () => false)) await expireWallet(input.clientId);
    const w = await walletOf(input.clientId);
    if (!w) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente no encontrado" });
    return { wallet: w, ledger: await clientLedger(input.clientId) };
  }),

  searchClients: staffProcedure.input(z.object({ q: z.string().trim().min(2).max(120) })).query(async ({ input }) => {
    await assertLoyalty(false);
    return searchClients(input.q);
  }),

  /** Ajuste manual con motivo (solo administración). */
  adjust: adminProcedure
    .input(z.object({ clientId: id, direction: z.enum(["credit", "debit"]), amount: points, reason: reason.min(3), key: opKey }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertLoyalty(true);
      return adjustPoints({ ...input, actor: actorOf(ctx.user) });
    }),

  /** Anula un movimiento con otro de signo contrario (una sola vez). */
  reverse: adminProcedure
    .input(z.object({ ledgerId: id, reason: reason.min(3) }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertLoyalty(true);
      return reverseMovement(input.ledgerId, input.reason, actorOf(ctx.user));
    }),

  /** Registra una acción permitida del cliente y concede los puntos de su regla. */
  awardAction: adminProcedure
    .input(z.object({ clientId: id, action: z.enum(LOYALTY_ACTIONS), key: opKey, note: reason.optional() }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertLoyalty(true);
      return awardActionPoints({ clientId: input.clientId, action: input.action, key: input.key, note: input.note || null, actor: actorOf(ctx.user) });
    }),

  /** Procesa la caducidad de los puntos vencidos de todos los monederos. */
  runExpiry: adminProcedure.mutation(async () => {
    await assertLoyalty(true);
    return expireAllWallets();
  }),
});
