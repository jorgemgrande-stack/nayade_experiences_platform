/**
 * API tRPC de Brevo marketing (`brevoMarketing.*`). Solo administración. La licencia `email-campaigns` la exige el
 * guardián de rutas (TRPC_ROUTER_CAPABILITIES); en multiempresa la clave sale de la bóveda de la empresa en curso.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { CONSENT_SOURCES } from "./plan";
import { BrevoMarketingError } from "./service";
import { BREVO_CAPABILITY, brevoMarketingService } from "./runtime";
import { BrevoNotInstalled, RunInProgress } from "./store";
import { unsubscribeUrl } from "../netPublic/brevoUnsubscribe";

const CODES: Record<BrevoMarketingError["code"], TRPCError["code"]> = {
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
    if (e instanceof BrevoMarketingError) throw new TRPCError({ code: CODES[e.code], message: e.message });
    if (e instanceof RunInProgress) throw new TRPCError({ code: "CONFLICT", message: e.message });
    if (e instanceof BrevoNotInstalled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    throw e;
  }
}
const actor = (ctx: { user: { id: number } }) => `user:${ctx.user.id}`;
const id = z.number().int().positive();
const svc = () => brevoMarketingService();

/** Además del guardián de rutas: licencia `email-campaigns` (consultas en solo lectura; operar exige la licencia activa). */
const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(BREVO_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "El email marketing no está incluido en tu plan" });
  return next();
});

export const brevoMarketingRouter = router({
  status: licensed.query(() => handle(() => svc().status())),
  testConnection: licensed.mutation(() => handle(() => svc().testConnection())),
  lists: licensed.query(() => handle(() => svc().lists())),
  chooseList: licensed.input(z.object({ listId: id })).mutation(({ input, ctx }) => handle(() => svc().chooseList(input.listId, actor(ctx)))),
  setAutoSync: licensed.input(z.object({ on: z.boolean() })).mutation(({ input, ctx }) => handle(() => svc().setAutoSync(input.on, actor(ctx)))),
  disconnect: licensed.mutation(({ ctx }) => handle(() => svc().disconnect(actor(ctx)))),

  clients: licensed.input(z.object({ q: z.string().max(100).default("") })).query(({ input }) => handle(() => svc().clients(input.q))),
  grantConsent: licensed
    .input(z.object({ clientId: id, source: z.enum(CONSENT_SOURCES), evidence: z.string().max(500) }))
    .mutation(({ input, ctx }) => handle(() => svc().grantConsent(input.clientId, input.source, input.evidence, actor(ctx)))),
  withdrawConsent: licensed
    .input(z.object({ clientId: id, reason: z.string().max(500).default("") }))
    .mutation(({ input, ctx }) => handle(() => svc().withdrawConsent(input.clientId, input.reason, actor(ctx)))),
  consentLog: licensed.input(z.object({ clientId: id })).query(({ input }) => handle(() => svc().consentLog(input.clientId))),
  /** Enlace público de baja del cliente (/baja/<cliente>.<firma>): para el pie de las campañas o enviarlo a mano. */
  unsubscribeLink: licensed.input(z.object({ clientId: id })).query(({ input }) => ({ url: unsubscribeUrl(input.clientId) })),

  preview: licensed.query(() => handle(() => svc().preview())),
  sync: licensed.mutation(({ ctx }) => handle(() => svc().sync("manual", actor(ctx)))),
  retry: licensed.input(z.object({ runId: id })).mutation(({ input, ctx }) => handle(() => svc().retry(input.runId, actor(ctx)))),
  runs: licensed.query(() => handle(() => svc().runs())),
});
