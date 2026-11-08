/**
 * API tRPC de Elephant Campaigns (`brevoMarketing.campaigns.*`). Solo administración. Cuelga del namespace
 * `brevoMarketing`, así que el guardián de rutas exige la licencia `email-campaigns`; además la comprueba cada
 * procedimiento (consultas en solo lectura; enviar o editar exige la licencia activa).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { BREVO_CAPABILITY } from "../brevoMarketing/runtime";
import { BrevoNotInstalled } from "../brevoMarketing/store";
import { CampaignError } from "./service";
import { campaignService } from "./runtime";
import { CampaignsNotInstalled } from "./store";

const CODES: Record<CampaignError["code"], TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  not_configured: "PRECONDITION_FAILED",
  rejected: "PRECONDITION_FAILED",
  unavailable: "BAD_GATEWAY",
};

async function handle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CampaignError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof CampaignsNotInstalled || e instanceof BrevoNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}
const actor = (ctx: { user: { id: number } }) => `user:${ctx.user.id}`;
const id = z.number().int().positive();
const svc = () => campaignService();

const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(BREVO_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Las campañas de correo no están incluidas en tu plan" });
  return next();
});

const block = z.union([
  z.object({ type: z.literal("heading"), text: z.string().max(200) }),
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({ type: z.literal("button"), label: z.string().max(80), url: z.string().max(1000) }),
  z.object({ type: z.literal("image"), url: z.string().max(1000), alt: z.string().max(200).default("") }),
  z.object({ type: z.literal("divider") }),
]);
const tagMode = z.enum(["any", "all"]);
const draft = z.object({
  name: z.string().max(120),
  subject: z.string().max(200).default(""),
  previewText: z.string().max(200).nullish(),
  senderId: z.number().int().positive().nullish(),
  replyTo: z.string().max(190).nullish(),
  blocks: z.array(block).max(40),
  tagIds: z.array(id).max(20).default([]),
  tagMode: tagMode.default("any"),
});

export const campaignsRouter = router({
  status: licensed.query(() => handle(() => svc().status())),
  senders: licensed.query(() => handle(() => svc().senders())),
  tags: licensed.query(() => handle(() => svc().tags())),
  list: licensed.query(() => handle(() => svc().list())),
  get: licensed.input(z.object({ id })).query(({ input }) => handle(() => svc().get(input.id))),
  audience: licensed.input(z.object({ tagIds: z.array(id).max(20), tagMode })).query(({ input }) => handle(() => svc().audience(input.tagIds, input.tagMode))),
  preview: licensed.input(z.object({ id })).query(({ input }) => handle(() => svc().preview(input.id))),

  create: licensed.input(draft).mutation(({ input, ctx }) => handle(() => svc().create(input, actor(ctx)))),
  update: licensed.input(draft.extend({ id })).mutation(({ input, ctx }) => handle(() => svc().update(input.id, input, actor(ctx)))),
  duplicate: licensed.input(z.object({ id })).mutation(({ input, ctx }) => handle(() => svc().duplicate(input.id, actor(ctx)))),
  sendTest: licensed.input(z.object({ id, email: z.string().max(190) })).mutation(({ input, ctx }) => handle(() => svc().sendTest(input.id, input.email, actor(ctx)))),
  /** Enviar ya (`scheduledAt` vacío) o programar (fecha ISO). */
  launch: licensed
    .input(z.object({ id, scheduledAt: z.string().datetime({ offset: true }).nullish() }))
    .mutation(({ input, ctx }) => handle(() => svc().launch(input.id, { at: input.scheduledAt ? new Date(input.scheduledAt) : null }, actor(ctx)))),
  /** Avanza una campaña que se está preparando y lee las estadísticas y bajas de Brevo. */
  refresh: licensed.input(z.object({ id })).mutation(({ input, ctx }) => handle(() => svc().refresh(input.id, actor(ctx)))),
});
