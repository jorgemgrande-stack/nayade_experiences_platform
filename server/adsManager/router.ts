/**
 * Elephant Ads Manager (namespace `adsManager`, licenciado con la capacidad `ads-manager` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, solo
 * consultas). Solo administración. Nunca crea ni modifica campañas en Meta ni en Google: solo lee sus informes.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { ADS_PLATFORMS, isDay } from "../../shared/adsManager";
import { ADS_CAPABILITY, type AdsActor } from "./service";
import { adsManagerService } from "./runtime";

const id = z.number().int().positive();
const day = z.string().refine(isDay, "La fecha no es válida.");
const platform = z.enum(ADS_PLATFORMS);
/** CSV de hasta ~6 MB (texto). */
const csvText = z.string().min(1).max(6_000_000);
const tagField = (n: number) => z.string().max(n).nullish().transform((v) => v ?? null);
const actorOf = (ctx: { user: { id: number; role: unknown } }): AdsActor => ({ userId: ctx.user.id, role: String(ctx.user.role) });

const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(ADS_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Ads Manager no está incluido en tu plan" });
  return next();
});

export const adsManagerRouter = router({
  dashboard: licensed
    .input(z.object({ from: day.optional(), to: day.optional(), days: z.number().int().min(1).max(730).optional() }).optional())
    .query(({ input }) => adsManagerService().dashboard(input ?? {})),
  connections: licensed.query(() => adsManagerService().connections()),
  campaigns: licensed.input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ input }) => adsManagerService().campaigns(input?.includeArchived)),

  // ── Importación ─────────────────────────────────────────────────────────
  sync: licensed
    .input(z.object({ platform, since: day.optional(), until: day.optional() }))
    .mutation(({ ctx, input }) => adsManagerService().sync(input.platform, { trigger: "manual", actor: actorOf(ctx), since: input.since, until: input.until })),
  importCsv: licensed
    .input(z.object({ platform, text: csvText, fileName: z.string().max(190).nullish() }))
    .mutation(({ ctx, input }) => adsManagerService().importAdsCsv(input, actorOf(ctx))),
  importSaleTags: licensed
    .input(z.object({ text: csvText, fileName: z.string().max(190).nullish() }))
    .mutation(({ ctx, input }) => adsManagerService().importSaleTagsCsv(input, actorOf(ctx))),
  tagSale: licensed
    .input(z.object({ reference: z.string().min(1).max(40), utmSource: tagField(120), utmMedium: tagField(120), utmCampaign: tagField(160), gclid: tagField(255), fbclid: tagField(255) }))
    .mutation(({ ctx, input }) => adsManagerService().tagSale(input, actorOf(ctx))),

  // ── Campañas ────────────────────────────────────────────────────────────
  setCampaignUtm: licensed.input(z.object({ id, utmCampaign: z.string().max(160).nullable() })).mutation(({ ctx, input }) => adsManagerService().setCampaignUtm(input.id, input.utmCampaign, actorOf(ctx))),
  setCampaignArchived: licensed.input(z.object({ id, archived: z.boolean() })).mutation(({ ctx, input }) => adsManagerService().setCampaignArchived(input.id, input.archived, actorOf(ctx))),

  // ── Presupuestos y ajustes ──────────────────────────────────────────────
  budgets: licensed.query(() => adsManagerService().budgets()),
  saveBudget: licensed
    .input(z.object({ scope: z.enum(["total", "platform", "campaign"]), platform: platform.nullish(), campaignId: id.nullish(), monthlyCents: z.number().int().positive().max(100_000_000_000) }))
    .mutation(({ ctx, input }) => adsManagerService().saveBudget(input, actorOf(ctx))),
  archiveBudget: licensed.input(z.object({ id })).mutation(({ ctx, input }) => adsManagerService().archiveBudget(input.id, actorOf(ctx))),
  settings: licensed.query(() => adsManagerService().settings()),
  saveSettings: licensed
    .input(z.object({ autoSync: z.boolean(), noConvMinSpendCents: z.number().int().min(0).max(1_000_000_000), noConvDays: z.number().int().min(3).max(90) }))
    .mutation(({ ctx, input }) => adsManagerService().saveSettings(input, actorOf(ctx))),
});
