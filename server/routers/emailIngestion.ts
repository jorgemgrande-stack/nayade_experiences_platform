import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { emailIngestionLogs } from "../../drizzle/schema";
import { runEmailIngestion } from "../services/emailTpvIngestionService";
import { assertModuleEnabled } from "../_core/flagGuard";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(pool);

const adminProc = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  await assertModuleEnabled("email_ingestion_enabled");
  return next({ ctx });
});

export const emailIngestionRouter = router({
  triggerSync: adminProc
    .input(z.object({ retryErrors: z.boolean().default(false) }).optional())
    .mutation(async ({ input }) => {
      return runEmailIngestion(input?.retryErrors ?? false);
    }),

  listLogs: adminProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(emailIngestionLogs)
        .orderBy(desc(emailIngestionLogs.createdAt))
        .limit(input.limit);
    }),

  // Resets logs for a given date to "skipped" so the next cron reprocesses them.
  // Safe: cardTerminalOperations.duplicateKey prevents re-inserting existing ops.
  resetLogsForDate: adminProc
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      const from = new Date(`${input.date}T00:00:00Z`);
      const to   = new Date(`${input.date}T23:59:59Z`);
      const result = await db
        .update(emailIngestionLogs)
        .set({ status: "skipped" })
        .where(and(
          eq(emailIngestionLogs.status, "ok"),
          gte(emailIngestionLogs.receivedAt, from),
          lte(emailIngestionLogs.receivedAt, to),
        ));
      const affected = (result[0] as any)?.affectedRows ?? 0;
      return { reset: affected };
    }),
});

