/**
 * domains.* — dominios propios de la empresa en curso (autoservicio del panel).
 *
 * Solo la administración (permiso settings.manage). La empresa sale SIEMPRE de la sesión (getTenantId) y el plano de
 * control decide todo lo demás: si el plan lo permite, si el dominio está libre, la verificación, el alta en el
 * proveedor y la activación (solo tras comprobar que la web responde por HTTPS). Fuera del modo multiempresa o sin el
 * canal con el plano de control, `status` lo indica y nada más está disponible.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getTenantId, getTenantMode } from "../_core/tenant";
import { CommerceError, commerceClientFromEnv, type CommerceClient } from "../commerceClient";
import type { CustomDomainView, DomainsOverview } from "../../shared/customDomains";

const TRPC_CODE: Record<number, TRPCError["code"]> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "TOO_MANY_REQUESTS", 503: "PRECONDITION_FAILED" };
const UNAVAILABLE = "La conexión de dominios propios no está disponible en este entorno";

const domainInput = z.object({ domain: z.string().trim().min(3).max(260) }).strict();

function client(): CommerceClient | null {
  if (getTenantMode() !== "multi") return null;
  const c = commerceClientFromEnv();
  return c && c.domains && c.addDomain && c.domainAction ? c : null;
}

async function reach<T>(fn: (c: Required<Pick<CommerceClient, "domains" | "addDomain" | "domainAction">>, tenantId: string) => Promise<T>): Promise<T> {
  const c = client();
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: UNAVAILABLE });
  try {
    return await fn(c as Required<Pick<CommerceClient, "domains" | "addDomain" | "domainAction">>, getTenantId());
  } catch (e) {
    if (e instanceof CommerceError) throw new TRPCError({ code: TRPC_CODE[e.status] ?? "INTERNAL_SERVER_ERROR", message: e.message });
    throw e;
  }
}

const who = (u: { id: number | string; email?: string | null }) => `user:${u.id}`;

export const domainsRouter = router({
  /** Estado completo (dominios, respaldo, principal y lo que permite el plan). `available:false` si no aplica aquí. */
  status: adminProcedure.query(async (): Promise<{ available: true; overview: DomainsOverview } | { available: false; reason: string }> => {
    if (!client()) return { available: false, reason: UNAVAILABLE };
    return { available: true, overview: (await reach((c, t) => c.domains(t))) as DomainsOverview };
  }),
  add: adminProcedure.input(domainInput).mutation(async ({ ctx, input }) => (await reach((c, t) => c.addDomain(t, { domain: input.domain, requestedBy: who(ctx.user) }))) as CustomDomainView),
  check: adminProcedure.input(domainInput).mutation(async ({ ctx, input }) => ((await reach((c, t) => c.domainAction(t, input.domain, "check", { requestedBy: who(ctx.user) }))) as { domain: CustomDomainView }).domain),
  setPrimary: adminProcedure.input(domainInput).mutation(async ({ ctx, input }) => ((await reach((c, t) => c.domainAction(t, input.domain, "primary", { requestedBy: who(ctx.user) }))) as { overview: DomainsOverview }).overview),
  disconnect: adminProcedure.input(domainInput).mutation(async ({ ctx, input }) => ((await reach((c, t) => c.domainAction(t, input.domain, "disconnect", { requestedBy: who(ctx.user) }))) as { overview: DomainsOverview }).overview),
});
