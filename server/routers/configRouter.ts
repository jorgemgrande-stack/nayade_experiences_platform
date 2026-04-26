import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, like, gte, lte } from "drizzle-orm";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { router, permissionProcedure } from "../_core/trpc";
import { featureFlags, systemSettings, configChangeLogs } from "../../drizzle/schema";
import { invalidateConfigCache } from "../config";
import type { User } from "../../drizzle/schema";

function getDb() {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool);
}

// RBAC-aware procedures. Fallback: users.role === "admin".
const settingsViewProc     = permissionProcedure("settings.view",     ["admin"]);
const settingsManageProc   = permissionProcedure("settings.manage",   ["admin"]);
const settingsAdvancedProc = permissionProcedure("settings.advanced", ["admin"]);

// ─── Validation ───────────────────────────────────────────────────────────────

function validateSettingValue(key: string, value: string, valueType: string): void {
  if (!value.trim()) return; // blank = clear the setting, always valid

  if (valueType === "number") {
    const n = Number(value);
    if (isNaN(n)) throw new TRPCError({ code: "BAD_REQUEST", message: "El valor debe ser numérico" });
    if (n < 0)   throw new TRPCError({ code: "BAD_REQUEST", message: "El valor debe ser positivo (≥ 0)" });
  }

  if (valueType === "boolean") {
    if (value !== "true" && value !== "false")
      throw new TRPCError({ code: "BAD_REQUEST", message: 'El valor debe ser "true" o "false"' });
  }

  if (valueType === "string") {
    // Email fields
    if (key.startsWith("email_")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Dirección de email inválida" });
    }

    // Web URL (must be a full URL)
    if (key === "brand_website_url") {
      try { new URL(value.startsWith("http") ? value : `https://${value}`); }
      catch { throw new TRPCError({ code: "BAD_REQUEST", message: "URL inválida" }); }
    }

    // Domain (just a hostname, no path/port required)
    if (key === "brand_domain") {
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(value))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Dominio inválido (ej: tuempresa.com)" });
    }

    // Hex color
    if (key.endsWith("_color")) {
      if (!/^#[0-9a-fA-F]{6}$/.test(value))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Color inválido. Usa formato hexadecimal #RRGGBB" });
    }

    // NIF / CIF — 9 alphanumeric chars (strips hyphens/spaces)
    if (key === "brand_nif") {
      const normalized = value.replace(/[-\s]/g, "");
      if (!/^[A-Za-z0-9]{7,11}$/.test(normalized))
        throw new TRPCError({ code: "BAD_REQUEST", message: "NIF/CIF inválido (7–11 caracteres alfanuméricos)" });
    }
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const configRouter = router({
  listFeatureFlags: settingsAdvancedProc.query(async () => {
    const db = getDb();
    return db.select().from(featureFlags).orderBy(featureFlags.module, featureFlags.key);
  }),

  listSystemSettings: settingsViewProc.query(async () => {
    const db = getDb();
    const rows = await db.select().from(systemSettings).orderBy(systemSettings.category, systemSettings.key);
    return rows.map(r => ({
      ...r,
      value: r.isSensitive ? null : r.value,
    }));
  }),

  updateFeatureFlag: settingsAdvancedProc
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

  updateSystemSetting: settingsManageProc
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [row] = await db
        .select({ isSensitive: systemSettings.isSensitive, value: systemSettings.value, valueType: systemSettings.valueType })
        .from(systemSettings)
        .where(eq(systemSettings.key, input.key))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Configuración no encontrada" });
      if (row.isSensitive) throw new TRPCError({ code: "FORBIDDEN", message: "Este ajuste es sensible y no puede modificarse desde el panel" });

      validateSettingValue(input.key, input.value, row.valueType);

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

  listChangeLogs: settingsViewProc
    .input(z.object({
      limit:         z.number().min(1).max(200).default(50),
      key:           z.string().optional(),
      entityType:    z.enum(["feature_flag", "system_setting"]).optional(),
      changedByName: z.string().optional(),
      dateFrom:      z.string().optional(),
      dateTo:        z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();

      const conditions = [];
      if (input?.key)           conditions.push(like(configChangeLogs.key, `%${input.key}%`));
      if (input?.entityType)    conditions.push(eq(configChangeLogs.entityType, input.entityType));
      if (input?.changedByName) conditions.push(like(configChangeLogs.changedByName!, `%${input.changedByName}%`));
      if (input?.dateFrom)      conditions.push(gte(configChangeLogs.changedAt, new Date(input.dateFrom)));
      if (input?.dateTo) {
        const to = new Date(input.dateTo);
        to.setHours(23, 59, 59, 999);
        conditions.push(lte(configChangeLogs.changedAt, to));
      }

      return db.select()
        .from(configChangeLogs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(configChangeLogs.changedAt))
        .limit(input?.limit ?? 50);
    }),
});
