/**
 * financeSync.ts — puesta en marcha de Elephant Finance Sync (capacidad `bank-import-pos`, ver routeGuard): estado de
 * los pasos, buzón de tickets del datáfono en la bóveda de la empresa, su comprobación y la lectura automática.
 * La lógica está en server/financeSyncSetup.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { defaultFinanceSyncDeps, FinanceSyncSetupError, getFinanceSyncSetup, saveMailbox, setMailboxIngestion, testMailbox } from "../financeSyncSetup";

function mapError(e: unknown): never {
  if (e instanceof FinanceSyncSetupError) throw new TRPCError({ code: e.code, message: e.message });
  throw e;
}

const actorName = (u: { id: number; name?: string | null; email?: string | null }) => u.name ?? u.email ?? `Usuario ${u.id}`;

export const financeSyncRouter = router({
  setup: adminProcedure.query(async () => getFinanceSyncSetup(await defaultFinanceSyncDeps())),

  saveMailbox: adminProcedure
    .input(z.object({ values: z.record(z.string().max(64), z.string().max(1024)) }))
    .mutation(async ({ ctx, input }) => saveMailbox(await defaultFinanceSyncDeps(), input.values, { id: ctx.user.id, name: actorName(ctx.user) }).catch(mapError)),

  testMailbox: adminProcedure.mutation(async ({ ctx }) => testMailbox(await defaultFinanceSyncDeps(), `user:${ctx.user.id}`).catch(mapError)),

  setIngestion: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => setMailboxIngestion(await defaultFinanceSyncDeps(), input.enabled, { id: ctx.user.id, name: actorName(ctx.user) }).catch(mapError)),
});
