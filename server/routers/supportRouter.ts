/**
 * support.* — incidencias de la empresa en curso con el equipo de Elephant Source, desde su panel.
 *
 * El servidor del Core habla con el plano de control con la empresa de la SESIÓN (nunca del navegador) y el correo
 * del usuario que actúa. No está en TRPC_ROUTER_CAPABILITIES: pedir ayuda debe funcionar también en solo lectura,
 * suspendida o con la prueba vencida (y está en READ_ONLY_ALLOWED del middleware de empresa).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getTenantId, getTenantMode } from "../_core/tenant";
import { CommerceError, commerceClientFromEnv, type CommerceClient } from "../commerceClient";
import { PANEL_ROLES } from "../subscriptionDb";

const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 503: "PRECONDITION_FAILED" };
const CATEGORIES = ["general", "billing", "technical", "account", "data"] as const;

async function withSupport<T>(user: { role?: unknown; email?: unknown }, fn: (c: CommerceClient, tenantId: string, email: string) => Promise<T>): Promise<T> {
  if (!(PANEL_ROLES as readonly string[]).includes(String(user.role))) throw new TRPCError({ code: "FORBIDDEN" });
  const client = commerceClientFromEnv();
  if (getTenantMode() !== "multi" || !client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El soporte desde el panel no está disponible: escríbenos por correo" });
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!z.string().email().safeParse(email).success) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu usuario no tiene un correo válido para recibir las respuestas" });
  try {
    return await fn(client, getTenantId(), email);
  } catch (e) {
    if (e instanceof CommerceError) throw new TRPCError({ code: TRPC_CODE[e.status] ?? "INTERNAL_SERVER_ERROR", message: e.message });
    throw e;
  }
}

const ticketId = z.object({ id: z.number().int().positive() });

export const supportRouter = router({
  /** ¿Está disponible? (sin canal con el plano de control, la pantalla muestra solo el correo de soporte). */
  available: protectedProcedure.query(() => getTenantMode() === "multi" && !!commerceClientFromEnv()),
  list: protectedProcedure.query(({ ctx }) => withSupport(ctx.user, (c, t) => c.tickets(t))),
  get: protectedProcedure.input(ticketId).query(({ ctx, input }) => withSupport(ctx.user, (c, t) => c.ticket(t, input.id))),
  open: protectedProcedure
    .input(z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(10_000), category: z.enum(CATEGORIES).optional() }).strict())
    .mutation(({ ctx, input }) => withSupport(ctx.user, (c, t, email) => c.openTicket(t, { ...input, requestedBy: email }))),
  reply: protectedProcedure
    .input(ticketId.extend({ text: z.string().trim().min(1).max(5000) }).strict())
    .mutation(({ ctx, input }) => withSupport(ctx.user, (c, t, email) => c.replyTicket(t, input.id, { text: input.text, requestedBy: email }))),
  reopen: protectedProcedure
    .input(ticketId.extend({ reason: z.string().trim().min(3).max(2000) }).strict())
    .mutation(({ ctx, input }) => withSupport(ctx.user, (c, t, email) => c.reopenTicket(t, input.id, { reason: input.reason, requestedBy: email }))),
});
