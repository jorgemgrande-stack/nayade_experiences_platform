import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { emailIngestionLogs } from "../../drizzle/schema";
import { runEmailIngestion } from "../services/emailTpvIngestionService";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(pool);

const adminProc = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new Error("Forbidden");
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
