/**
 * Elephant GEO Control (namespace `geoControl`, licenciado con la capacidad `geo-control` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí, como Brevo marketing: sin licencia, 403; en solo
 * lectura, solo consultas). Solo administración. La lógica vive en server/geoControlDb.ts y shared/geoControl.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { invokeLLM } from "../_core/llm";
import { AiUnavailableError } from "../ai/provider";
import * as geo from "../geoControlDb";
import { GEO_INTENTS, GEO_OPPORTUNITY_STATUSES, GEO_SURFACES, isDay } from "../../shared/geoControl";

const id = z.number().int().positive();
const priority = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const actorOf = (ctx: { user: { id: number; role: unknown } }): geo.GeoActor => ({ userId: ctx.user.id, role: String(ctx.user.role) });

/** Además del guardián de rutas: licencia `geo-control` (consultas en solo lectura; operar exige la licencia activa). */
const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(geo.GEO_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "GEO Control no está incluido en tu plan" });
  return next();
});

/**
 * Respuesta de referencia con la IA central del Core (proveedor de la empresa o el central de Big Elephant; consumo
 * medido y limitado por empresa en `invokeLLM`). Es una estimación: el modelo no navega ni ve lo que ve un usuario.
 */
const askCentralAi: geo.AskAi = async (question, context) => {
  const where = [context.sector, context.zone].filter(Boolean).join(" · ");
  let res;
  try {
    res = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de IA generalista. Responde en español a la pregunta del usuario como lo harías normalmente, de forma breve (máximo 180 palabras). Si recomiendas negocios, marcas o webs, nómbralos. Después devuelve, en orden de aparición, los negocios o marcas que has nombrado y las URL que hayas citado. No inventes URL.",
        },
        { role: "user", content: where ? `${question}\n\n(Contexto: ${where}, España)` : question },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "geo_reference_answer",
          strict: true,
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              businesses: { type: "array", items: { type: "string" } },
              urls: { type: "array", items: { type: "string" } },
            },
            required: ["answer", "businesses", "urls"],
            additionalProperties: false,
          },
        },
      },
    });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La IA de Big Elephant no está disponible para tu empresa en este momento." });
    throw e;
  }
  const raw = res.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => ("text" in p ? p.text : "")).join("") : "";
  try {
    const p = JSON.parse(text) as { answer?: unknown; businesses?: unknown; urls?: unknown };
    return {
      text: String(p.answer ?? ""),
      businesses: Array.isArray(p.businesses) ? p.businesses.map(String) : [],
      urls: Array.isArray(p.urls) ? p.urls.map(String) : [],
    };
  } catch {
    // El modelo no devolvió JSON: se analiza el texto tal cual
    return { text, businesses: [], urls: text.match(/https?:\/\/[^\s)"'<>]+/g) ?? [] };
  }
};

export const geoControlRouter = router({
  // ── Ajustes de la marca ─────────────────────────────────────────────────
  settings: licensed.query(() => geo.getSettings()),
  saveSettings: licensed
    .input(z.object({
      brandName: z.string().max(160),
      aliases: z.array(z.string().max(120)).max(10).optional(),
      domain: z.string().max(255).nullish(),
      sector: z.string().max(160).nullish(),
      zone: z.string().max(160).nullish(),
    }))
    .mutation(({ ctx, input }) => geo.saveSettings(input, actorOf(ctx))),

  // ── Consultas ───────────────────────────────────────────────────────────
  queries: licensed.input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ input }) => geo.listQueries(input?.includeArchived)),
  upsertQuery: licensed
    .input(z.object({ id: id.optional(), queryText: z.string().max(300), intent: z.enum(GEO_INTENTS), priority }))
    .mutation(({ ctx, input }) => geo.upsertQuery(input, actorOf(ctx))),
  setQueryArchived: licensed.input(z.object({ id, archived: z.boolean() })).mutation(({ ctx, input }) => geo.setQueryArchived(input.id, input.archived, actorOf(ctx))),
  suggestions: licensed.query(() => geo.suggestions()),
  addSuggestions: licensed
    .input(z.object({ items: z.array(z.object({ queryText: z.string().max(300), intent: z.enum(GEO_INTENTS), priority })).min(1).max(30) }))
    .mutation(({ ctx, input }) => geo.addSuggestions(input.items, actorOf(ctx))),

  // ── Observaciones ───────────────────────────────────────────────────────
  observations: licensed
    .input(z.object({ queryId: id.optional(), surface: z.string().max(24).optional(), limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(({ input }) => geo.listObservations(input ?? {})),
  recordObservation: licensed
    .input(z.object({
      queryId: id,
      surface: z.enum(GEO_SURFACES),
      observedOn: z.string().refine(isDay, "La fecha no es válida."),
      brandMentioned: z.boolean(),
      domainCited: z.boolean(),
      citedUrl: z.string().max(512).nullish(),
      position: z.number().int().min(1).max(50).nullish(),
      competitors: z.array(z.string().max(120)).max(20).optional(),
      note: z.string().max(1000).nullish(),
    }))
    .mutation(({ ctx, input }) => geo.recordObservation(input, actorOf(ctx))),
  archiveObservation: licensed.input(z.object({ id })).mutation(({ ctx, input }) => geo.archiveObservation(input.id, actorOf(ctx))),
  askReferenceAi: licensed.input(z.object({ queryId: id })).mutation(({ ctx, input }) => geo.askReferenceAi(input.queryId, actorOf(ctx), askCentralAi)),

  // ── Panel y oportunidades ───────────────────────────────────────────────
  dashboard: licensed
    .input(z.object({ days: z.number().int().min(7).max(730).default(90), granularity: z.enum(["week", "month"]).default("week") }).optional())
    .query(({ input }) => geo.dashboard({ days: input?.days ?? 90, granularity: input?.granularity ?? "week" })),
  opportunities: licensed
    .input(z.object({ status: z.enum([...GEO_OPPORTUNITY_STATUSES, "active", "all"] as const).default("active") }).optional())
    .query(({ input }) => geo.listOpportunities(input?.status ?? "active")),
  reconcile: licensed.mutation(({ ctx }) => geo.reconcile(actorOf(ctx))),
  setOpportunityStatus: licensed
    .input(z.object({ id, status: z.enum(GEO_OPPORTUNITY_STATUSES), note: z.string().max(500).nullish() }))
    .mutation(({ ctx, input }) => geo.setOpportunityStatus(input, actorOf(ctx))),
});
