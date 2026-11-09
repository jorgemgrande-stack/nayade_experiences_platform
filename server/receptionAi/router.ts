/**
 * API tRPC de Elephant Reception AI (namespace `receptionAi`, licenciado con la capacidad `reception-ai` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, solo
 * consultas). Configuración y sincronización con Vapi: administración; registro de conversaciones: también ventas.
 * Solo en la instalación multiempresa (cada empresa con su propia cuenta de Vapi).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router, staffProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { isMultiTenant } from "../_core/tenant";
import {
  KNOWLEDGE_KINDS,
  RECEPTION_CAPABILITY,
  RECEPTION_CHANNELS,
  RECEPTION_LANGUAGES,
  RECEPTION_LIMITS,
  RECEPTION_MANUAL_OUTCOMES,
  RECEPTION_OUTCOMES,
  RECEPTION_TONES,
} from "../../shared/receptionAi";
import { ReceptionError } from "./service";
import { receptionService } from "./runtime";
import { ReceptionNotInstalled } from "./store";

const CODES: Record<ReceptionError["code"], TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  not_configured: "PRECONDITION_FAILED",
  unavailable: "BAD_GATEWAY",
};

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ReceptionError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof ReceptionNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}

const gate = async (type: string) => {
  if (!isMultiTenant()) throw new TRPCError({ code: "FORBIDDEN", message: "La recepcionista virtual no está disponible en esta instalación." });
  const d = await getCapabilityAccess().check(RECEPTION_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "La recepcionista virtual no está incluida en tu plan" });
};
const admin = adminProcedure.use(async ({ type, next }) => {
  await gate(type);
  return next();
});
const staff = staffProcedure.use(async ({ type, next }) => {
  await gate(type);
  return next();
});

const svc = () => receptionService();
const id = z.number().int().positive();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM).");
const L = RECEPTION_LIMITS;

const settingsInput = z.object({
  enabled: z.boolean(),
  assistantName: z.string().max(L.assistantNameMax + 20),
  language: z.enum(RECEPTION_LANGUAGES),
  tone: z.enum(RECEPTION_TONES),
  greeting: z.string().max(L.greetingMax + 50).nullish(),
  businessSummary: z.string().max(L.businessSummaryMax + 100).nullish(),
  address: z.string().max(L.addressMax + 50).nullish(),
  openingHours: z.string().max(L.openingHoursMax + 50).nullish(),
  humanHours: z.array(z.object({ day: z.number().int().min(0).max(6), from: hhmm, to: hhmm })).max(7 * L.rangesPerDayMax),
  timezone: z.string().max(40).default("Europe/Madrid"),
  includeCatalog: z.boolean(),
  transferEnabled: z.boolean(),
  transferNumber: z.string().max(30).nullish(),
  leadEnabled: z.boolean(),
  callbackEnabled: z.boolean(),
  extraRules: z.string().max(L.extraRulesMax + 100).nullish(),
  chatEnabled: z.boolean(),
  chatDailyLimit: z.number().int(),
});
const knowledgeInput = z.object({ kind: z.enum(KNOWLEDGE_KINDS), question: z.string().max(L.questionMax + 50), answer: z.string().max(L.answerMax + 100) });

export const receptionAiRouter = router({
  // ── Configuración y conocimiento (administración) ────────────────────────────
  overview: admin.query(() => handle(() => svc().overview())),
  saveSettings: admin.input(settingsInput).mutation(({ ctx, input }) =>
    handle(() =>
      svc().saveSettings(
        { ...input, greeting: input.greeting ?? null, businessSummary: input.businessSummary ?? null, address: input.address ?? null, openingHours: input.openingHours ?? null, transferNumber: input.transferNumber ?? null, extraRules: input.extraRules ?? null, humanHours: input.humanHours as any },
        ctx.user.id,
      ),
    ),
  ),
  addKnowledge: admin.input(knowledgeInput).mutation(({ ctx, input }) => handle(async () => ({ id: await svc().addKnowledge(input, ctx.user.id) }))),
  updateKnowledge: admin.input(knowledgeInput.extend({ id, sortOrder: z.number().int().min(-1000).max(1000).optional() })).mutation(({ input }) => handle(() => svc().updateKnowledge(input.id, input))),
  archiveKnowledge: admin.input(z.object({ id, archived: z.boolean() })).mutation(({ input }) => handle(() => svc().archiveKnowledge(input.id, input.archived))),
  previewPrompt: admin.input(z.object({ channel: z.enum(RECEPTION_CHANNELS) })).query(({ input }) => handle(async () => ({ prompt: await svc().previewPrompt(input.channel) }))),
  tryChat: admin.input(z.object({ question: z.string().max(L.chatMessageMax + 50) })).mutation(({ input }) => handle(() => svc().tryChat(input.question))),

  // ── Voz (Vapi de la empresa) ─────────────────────────────────────────────────
  voiceStatus: admin.query(() => handle(() => svc().voiceStatus())),
  syncVoice: admin.mutation(() => handle(() => svc().syncVoice())),

  // ── Chat de la web ───────────────────────────────────────────────────────────
  regenerateChatLink: admin.mutation(() => handle(() => svc().regenerateChatKey())),

  // ── Registro de conversaciones (administración y ventas) ─────────────────────
  stats: staff.input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional()).query(({ input }) => handle(() => svc().stats(input?.days ?? 30))),
  conversations: staff
    .input(z.object({
      channel: z.enum(RECEPTION_CHANNELS).optional(),
      outcome: z.enum(RECEPTION_OUTCOMES).optional(),
      days: z.number().int().min(1).max(365).default(30),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).max(100_000).default(0),
    }).optional())
    .query(({ input }) => handle(() => svc().conversations({ days: 30, limit: 50, offset: 0, ...(input ?? {}), search: input?.search?.trim() || undefined }))),
  conversation: staff.input(z.object({ id })).query(({ input }) => handle(() => svc().conversation(input.id))),
  setOutcome: staff.input(z.object({ id, outcome: z.enum(RECEPTION_MANUAL_OUTCOMES as [string, ...string[]]) })).mutation(({ input }) => handle(() => svc().setOutcome(input.id, input.outcome as any))),
});
