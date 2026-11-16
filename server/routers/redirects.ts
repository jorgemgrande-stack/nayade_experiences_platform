/**
 * Administración de las redirecciones permanentes de la web de la empresa (`redirects.*`). Solo administración; la licencia
 * es la del editor de contenidos (`cms-editor`, ver routeGuard). La lógica y la auditoría están en server/redirectsDb.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { REDIRECT_LIMITS } from "../../shared/redirects";
import { RedirectError, checkRedirect, createRedirect, deleteRedirect, listRedirectLog, listRedirects, updateRedirect } from "../redirectsDb";

const body = z.object({
  fromPath: z.string().min(1).max(REDIRECT_LIMITS.from),
  toPath: z.string().min(1).max(REDIRECT_LIMITS.to),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  isActive: z.boolean().default(true),
  note: z.string().max(REDIRECT_LIMITS.note).nullish(),
}).strict();

const actorOf = (ctx: { user?: unknown }) => {
  const u = (ctx.user ?? {}) as { id?: number; name?: string | null; email?: string | null };
  return { id: u.id ?? null, name: u.name ?? u.email ?? "Admin" };
};

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RedirectError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    // Empresa aún sin migrar (0074): mensaje claro en vez de un error de SQL
    if (/site_redirects|site_redirect_log/.test(String((e as Error)?.message ?? "")) && /doesn't exist|no existe|ER_NO_SUCH_TABLE/i.test(String((e as Error)?.message ?? ""))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Las redirecciones aún no están disponibles en esta empresa (falta aplicar su migración)." });
    }
    throw e;
  }
}

export const redirectsRouter = router({
  list: adminProcedure.query(() => guard(() => listRedirects())),
  log: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional()).query(({ input }) => guard(() => listRedirectLog(input?.limit ?? 100))),
  /** Valida sin guardar (avisa de bucles, cadenas, rutas existentes y destinos no permitidos). */
  check: adminProcedure.input(body.extend({ id: z.number().int().positive().optional() })).query(({ input }) => guard(async () => {
    const r = await checkRedirect(input, input.id);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  })),
  create: adminProcedure.input(body).mutation(({ input, ctx }) => guard(() => createRedirect(input, actorOf(ctx)))),
  update: adminProcedure.input(body.extend({ id: z.number().int().positive() })).mutation(({ input, ctx }) => guard(() => updateRedirect(input.id, input, actorOf(ctx)))),
  delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input, ctx }) => guard(async () => { await deleteRedirect(input.id, actorOf(ctx)); return { success: true as const }; })),
});
