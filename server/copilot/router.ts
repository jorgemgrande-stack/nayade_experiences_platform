/**
 * API tRPC de Elephant Copilot avanzado (namespace `copilot`, licenciado con la capacidad `copilot-advanced` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, historial y
 * consultas rápidas, sin preguntas nuevas a la IA). Equipo del panel (permiso crm.view); cada herramienta exige además
 * su permiso (facturación, RRHH) y la capacidad de sus datos. Solo en la instalación multiempresa.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { isMultiTenant } from "../_core/tenant";
import { COPILOT_CAPABILITY, COPILOT_DRAFT_KINDS, COPILOT_LIMITS, COPILOT_TONES, COPILOT_TOOL_NAMES } from "../../shared/copilot";
import { CopilotError, type CopilotActor } from "./service";
import { copilotAiAvailable, copilotService, resolveCopilotAccess } from "./runtime";
import { CopilotNotInstalled } from "./store";

const CODES: Record<CopilotError["code"], TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  unavailable: "PRECONDITION_FAILED",
  busy: "TOO_MANY_REQUESTS",
};

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CopilotError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof CopilotNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}

const licensed = staffProcedure.use(async ({ ctx, type, next }) => {
  if (!isMultiTenant()) throw new TRPCError({ code: "FORBIDDEN", message: "Copilot no está disponible en esta instalación." });
  const d = await getCapabilityAccess().check(COPILOT_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Elephant Copilot avanzado no está incluido en tu plan" });
  const u = ctx.user as { id: number; role: unknown; name?: string | null };
  const actor: CopilotActor = { userId: u.id, name: u.name ?? null, access: await resolveCopilotAccess(u) };
  return next({ ctx: { ...ctx, actor } });
});

const svc = () => copilotService();
const id = z.number().int().positive();

export const copilotRouter = router({
  /** Qué ofrece Copilot a este usuario: herramientas, borradores y si la IA está disponible. */
  status: licensed.query(({ ctx }) => ({ aiAvailable: copilotAiAvailable(), ...svc().capabilities(ctx.actor) })),

  ask: licensed
    .input(z.object({ conversationId: id.nullish(), question: z.string().max(COPILOT_LIMITS.questionMax + 100) }))
    .mutation(({ ctx, input }) => handle(() => svc().ask(ctx.actor, input))),

  /** Consulta rápida sin IA (los mismos datos y permisos que las herramientas). */
  quick: licensed
    .input(z.object({ tool: z.enum(COPILOT_TOOL_NAMES), args: z.record(z.string(), z.unknown()).default({}) }))
    .query(({ ctx, input }) => handle(() => svc().quick(ctx.actor, input.tool, input.args))),

  draft: licensed
    .input(z.object({
      kind: z.enum(COPILOT_DRAFT_KINDS),
      tone: z.enum(COPILOT_TONES).default("cercano"),
      text: z.string().max(COPILOT_LIMITS.draftInputMax + 100).nullish(),
      notes: z.string().max(COPILOT_LIMITS.draftNotesMax + 100).nullish(),
      clienteId: id.nullish(),
      productoId: id.nullish(),
    }))
    .mutation(({ ctx, input }) => handle(() => svc().draft(ctx.actor, input))),

  conversations: licensed
    .input(z.object({ archived: z.boolean().default(false) }).optional())
    .query(({ ctx, input }) => handle(() => svc().conversations(ctx.actor, input?.archived ?? false))),
  conversation: licensed.input(z.object({ id })).query(({ ctx, input }) => handle(() => svc().conversation(ctx.actor, input.id))),
  setArchived: licensed.input(z.object({ id, archived: z.boolean() })).mutation(({ ctx, input }) => handle(() => svc().archive(ctx.actor, input.id, input.archived))),
});
