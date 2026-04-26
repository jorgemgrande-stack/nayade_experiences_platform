import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { router, protectedProcedure } from "../_core/trpc";
import { featureFlags, systemSettings, configChangeLogs } from "../../drizzle/schema";
import { invalidateConfigCache } from "../config";
import type { User } from "../../drizzle/schema";

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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [old] = await db.select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(eq(featureFlags.key, input.key))
        .limit(1);
      if (!old) throw new TRPCError({ code: "NOT_FOUND", message: "Flag no encontrado" });

      await db.update(featureFlags)
        .set({ enabled: input.enabled })
        .where(eq(featureFlags.key, input.key));

      const user = ctx.user as User;
      await db.insert(configChangeLogs).values({
        entityType: "feature_flag",
        key: input.key,
        oldValue: String(old.enabled),
        newValue: String(input.enabled),
        changedById: user.id,
        changedByName: user.name ?? user.email ?? "Admin",
      });

      invalidateConfigCache();
      return { ok: true };
    }),

  updateSystemSetting: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [row] = await db.select({ isSensitive: systemSettings.isSensitive, value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, input.key))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Configuración no encontrada" });
      if (row.isSensitive) throw new TRPCError({ code: "FORBIDDEN", message: "Este ajuste es sensible y no puede modificarse desde el panel" });

      await db.update(systemSettings)
        .set({ value: input.value })
        .where(eq(systemSettings.key, input.key));

      const user = ctx.user as User;
      await db.insert(configChangeLogs).values({
        entityType: "system_setting",
        key: input.key,
        oldValue: row.value ?? null,
        newValue: input.value,
        changedById: user.id,
        changedByName: user.name ?? user.email ?? "Admin",
      });

      invalidateConfigCache();
      return { ok: true };
    }),

  listChangeLogs: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      return db.select()
        .from(configChangeLogs)
        .orderBy(desc(configChangeLogs.changedAt))
        .limit(input?.limit ?? 50);
    }),
});
