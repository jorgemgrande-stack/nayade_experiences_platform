import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { desc } from "drizzle-orm";
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
});

