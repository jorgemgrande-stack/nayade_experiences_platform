/**
 * API tRPC de Elephant WhatsApp AI (namespace `whatsappCloud`, licenciado con la capacidad `whatsapp-ai` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, solo
 * consultas). Bandeja (conversaciones, responder, plantillas, sugerencias de la IA): administración y ventas;
 * verificación de la conexión y configuración de la IA: administración. Solo en la instalación multiempresa (cada
 * empresa con su propio número de WhatsApp Business). Nunca devuelve credenciales.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router, staffProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { isMultiTenant } from "../_core/tenant";
import { WHATSAPP_AI_MODES, WHATSAPP_CAPABILITY, WHATSAPP_LIMITS } from "../../shared/whatsappCloud";
import { WhatsappError } from "./service";
import { whatsappService } from "./runtime";
import { WhatsappNotInstalled } from "./store";

const CODES: Record<WhatsappError["code"], TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  not_configured: "PRECONDITION_FAILED",
  unavailable: "BAD_GATEWAY",
  outside_window: "PRECONDITION_FAILED",
};

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WhatsappError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof WhatsappNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}

const gate = async (type: string) => {
  if (!isMultiTenant()) throw new TRPCError({ code: "FORBIDDEN", message: "WhatsApp Business no está disponible en esta instalación." });
  const d = await getCapabilityAccess().check(WHATSAPP_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "WhatsApp Business con IA no está incluido en tu plan" });
};
const admin = adminProcedure.use(async ({ type, next }) => {
  await gate(type);
  return next();
});
const staff = staffProcedure.use(async ({ type, next }) => {
  await gate(type);
  return next();
});

const svc = () => whatsappService();
const id = z.number().int().positive();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM).");
const L = WHATSAPP_LIMITS;

export const whatsappCloudRouter = router({
  // ── Conexión ─────────────────────────────────────────────────────────────────
  status: staff.query(() => handle(() => svc().status())),
  verify: admin.mutation(() => handle(() => svc().verify())),
  templates: staff.query(() => handle(() => svc().templates())),

  // ── Configuración de la IA (administración) ──────────────────────────────────
  settings: staff.query(() => handle(() => svc().settings())),
  saveSettings: admin
    .input(
      z.object({
        aiMode: z.enum(WHATSAPP_AI_MODES),
        autoHours: z.array(z.object({ day: z.number().int().min(0).max(6), from: hhmm, to: hhmm })).max(21),
        autoDailyLimit: z.number().int(),
        handoffKeywords: z.string().max(L.keywordsMax + 50).nullish(),
        extraRules: z.string().max(L.extraRulesMax + 100).nullish(),
        timezone: z.string().max(40).default("Europe/Madrid"),
      }),
    )
    .mutation(({ ctx, input }) => handle(() => svc().saveSettings({ ...input, autoHours: input.autoHours as any, handoffKeywords: input.handoffKeywords ?? null, extraRules: input.extraRules ?? null }, ctx.user.id))),

  // ── Bandeja (administración y ventas) ────────────────────────────────────────
  conversations: staff
    .input(z.object({ search: z.string().max(100).optional(), needsHuman: z.boolean().optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) }).optional())
    .query(({ input }) => handle(() => svc().conversations({ limit: 50, offset: 0, ...(input ?? {}), search: input?.search?.trim() || undefined }))),
  conversation: staff.input(z.object({ id })).query(({ input }) => handle(() => svc().conversation(input.id))),
  markRead: staff.input(z.object({ id })).mutation(({ input }) => handle(() => svc().markRead(input.id))),
  setNeedsHuman: staff.input(z.object({ id, value: z.boolean() })).mutation(({ input }) => handle(() => svc().setNeedsHuman(input.id, input.value))),
  reply: staff
    .input(z.object({ id, text: z.string().max(L.textMax + 100), fromSuggestion: z.boolean().default(false) }))
    .mutation(({ ctx, input }) => handle(() => svc().reply(input.id, input.text, ctx.user.id, input.fromSuggestion))),
  sendTemplate: staff
    .input(z.object({ id, name: z.string().min(1).max(512), language: z.string().min(2).max(15), params: z.array(z.string().max(L.templateParamMax + 50)).max(L.templateParamsMax) }))
    .mutation(({ ctx, input }) => handle(() => svc().sendTemplate(input.id, { name: input.name, language: input.language, params: input.params }, ctx.user.id))),
  // Pedir una sugerencia consume IA (y la registra): es una operación de escritura, bloqueada en solo lectura
  suggest: staff.input(z.object({ id })).mutation(({ ctx, input }) => handle(() => svc().suggest(input.id, ctx.user.id))),
  aiLog: staff.input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional()).query(({ input }) => handle(() => svc().aiLog(input?.limit ?? 50))),
});
