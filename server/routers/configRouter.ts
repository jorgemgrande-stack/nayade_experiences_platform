import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { router, protectedProcedure } from "../_core/trpc";
import { featureFlags, systemSettings } from "../../drizzle/schema";
import { invalidateConfigCache } from "../config";

function getDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { role: string }).role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

export const configRouter = router({
  listFeatureFlags: adminProcedure.query(async () => {
    const db = getDb();
    return db.select().from(featureFlags).orderBy(featureFlags.module, featureFlags.key);
  }),

  listSystemSettings: adminProcedure.query(async () => {
    const db = getDb();
    const rows = await db.select().from(systemSettings).orderBy(systemSettings.category, systemSettings.key);
    return rows.map(r => ({
      ...r,
      value: r.isSensitive ? null : r.value,
    }));
  }),

  updateFeatureFlag: adminProcedure
    .input(z.object({
      key: z.string(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(featureFlags)
        .set({ enabled: input.enabled })
        .where(eq(featureFlags.key, input.key));
      invalidateConfigCache();
      return { ok: true };
    }),

  updateSystemSetting: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [row] = await db.select({ isSensitive: systemSettings.isSensitive })
        .from(systemSettings)
        .where(eq(systemSettings.key, input.key))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Configuración no encontrada" });
      if (row.isSensitive) throw new TRPCError({ code: "FORBIDDEN", message: "Este ajuste es sensible y no puede modificarse desde el panel" });
      await db.update(systemSettings)
        .set({ value: input.value })
        .where(eq(systemSettings.key, input.key));
      invalidateConfigCache();
      return { ok: true };
    }),
});
