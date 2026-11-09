/**
 * Elephant SEO Control (namespace `seoControl`, licenciado con la capacidad `seo-control` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí, como GEO Control: sin licencia, 403; en solo
 * lectura, solo consultas). Solo administración. La lógica vive en server/seoControlDb.ts y shared/seoControl.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import * as seo from "../seoControlDb";
import { SEO_REVIEW_SOURCES, isDay } from "../../shared/seoControl";

const id = z.number().int().positive();
const actorOf = (ctx: { user: { id: number; role: unknown } }): seo.SeoActor => ({ userId: ctx.user.id, role: String(ctx.user.role) });

/** Además del guardián de rutas: licencia `seo-control` (consultas en solo lectura; operar exige la licencia activa). */
const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(seo.SEO_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "SEO Control no está incluido en tu plan" });
  return next();
});

export const seoControlRouter = router({
  // ── Panel ───────────────────────────────────────────────────────────────
  dashboard: licensed
    .input(z.object({ days: z.number().int().min(14).max(400).default(90) }).optional())
    .query(({ input }) => seo.dashboard({ days: input?.days ?? 90 })),
  connectors: licensed.query(() => seo.connectors()),
  webHosts: licensed.query(async () => ({ hosts: await seo.companyHosts() })),

  // ── Palabras clave y posiciones ─────────────────────────────────────────
  keywords: licensed.input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ input }) => seo.listKeywords(input?.includeArchived)),
  upsertKeyword: licensed
    .input(z.object({ id: id.optional(), keyword: z.string().max(300), targetUrl: z.string().max(600).nullish() }))
    .mutation(({ ctx, input }) => seo.upsertKeyword(input, actorOf(ctx))),
  setKeywordArchived: licensed.input(z.object({ id, archived: z.boolean() })).mutation(({ ctx, input }) => seo.setKeywordArchived(input.id, input.archived, actorOf(ctx))),
  recordPosition: licensed
    .input(z.object({
      keywordId: id,
      observedOn: z.string().refine(isDay, "La fecha no es válida."),
      position: z.number().min(1).max(100).nullable(),
      rankingUrl: z.string().max(600).nullish(),
      note: z.string().max(500).nullish(),
    }))
    .mutation(({ ctx, input }) => seo.recordPosition(input, actorOf(ctx))),
  keywordHistory: licensed
    .input(z.object({ keywordId: id, days: z.number().int().min(7).max(400).default(90) }))
    .query(({ input }) => seo.keywordHistory(input.keywordId, input.days)),

  // ── Google Search Console ───────────────────────────────────────────────
  importSearchConsole: licensed
    .input(z.object({ days: z.number().int().min(7).max(90).default(28) }).optional())
    .mutation(({ ctx, input }) => seo.importSearchConsole({ days: input?.days ?? 28 }, actorOf(ctx))),
  searchPerformance: licensed
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100), search: z.string().max(120).nullish() }).optional())
    .query(({ input }) => seo.searchPerformance({ limit: input?.limit ?? 100, search: input?.search })),

  // ── Auditoría on-page ───────────────────────────────────────────────────
  audit: licensed.query(() => seo.latestAudit()),
  runAudit: licensed.input(z.object({ startUrl: z.string().max(600).nullish() }).optional()).mutation(({ ctx, input }) => seo.runAudit({ startUrl: input?.startUrl }, actorOf(ctx))),

  // ── Reseñas ─────────────────────────────────────────────────────────────
  reviews: licensed.query(() => seo.reviewsOverview()),
  syncReviews: licensed.input(z.object({ source: z.enum(SEO_REVIEW_SOURCES) })).mutation(({ ctx, input }) => seo.syncReviews(input.source, actorOf(ctx))),
});
