/**
 * voiceSetup.ts — puesta en marcha de «Llamadas IA» (Elephant Voice, capacidad `voice-ai`, ver routeGuard; se comprueba
 * también aquí: sin licencia, 403; en solo lectura, solo consultas). Solo administración. La lógica está en
 * server/voiceSetup.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { VOICE_CAPABILITY } from "../../shared/voiceSetup";
import { connectVoice, defaultVoiceSetupDeps, disconnectVoice, getVoiceSetup, listVoiceResources, saveVoiceKey, verifyVoice, VoiceSetupError } from "../voiceSetup";

function mapError(e: unknown): never {
  if (e instanceof VoiceSetupError) throw new TRPCError({ code: e.code, message: e.message });
  throw e;
}

const admin = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(VOICE_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Llamadas IA no está incluida en tu plan" });
  return next();
});

const vapiId = z.string().min(8).max(80).regex(/^[A-Za-z0-9-]+$/);

export const voiceSetupRouter = router({
  status: admin.query(async () => getVoiceSetup(await defaultVoiceSetupDeps()).catch(mapError)),
  resources: admin.query(async () => listVoiceResources(await defaultVoiceSetupDeps()).catch(mapError)),
  verify: admin.query(async () => verifyVoice(await defaultVoiceSetupDeps()).catch(mapError)),

  saveKey: admin
    .input(z.object({ apiKey: z.string().max(600) }))
    .mutation(async ({ ctx, input }) => saveVoiceKey(await defaultVoiceSetupDeps(), input.apiKey, { id: ctx.user.id }).catch(mapError)),
  connect: admin
    .input(z.object({ assistantId: vapiId, phoneNumberId: vapiId, replaceExisting: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => connectVoice(await defaultVoiceSetupDeps(), input, { id: ctx.user.id }).catch(mapError)),
  disconnect: admin.mutation(async ({ ctx }) => disconnectVoice(await defaultVoiceSetupDeps(), { id: ctx.user.id }).catch(mapError)),
});
