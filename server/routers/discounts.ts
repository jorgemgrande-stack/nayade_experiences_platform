import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { discountCodes, discountCodeUses, compensationVouchers } from "../../drizzle/schema";
import { eq, desc, like, and, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Comprueba si un código ha caducado por fecha o por usos */
function isCodeExpired(code: typeof discountCodes.$inferSelect): boolean {
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return true;
  if (code.maxUses !== null && code.currentUses >= code.maxUses) return true;
  return false;
}

/** Valida un código y devuelve el porcentaje de descuento o lanza error */
export async function validateAndGetDiscount(codeStr: string): Promise<{
  id: number;
  code: string;
  name: string;
  discountPercent: number;
}> {
  const [row] = await db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.code, codeStr.toUpperCase().trim()))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Código de descuento no encontrado" });
  }
  if (row.status === "inactive") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El código de descuento está inactivo" });
  }
  if (isCodeExpired(row)) {
    // Auto-mark as expired
    await db.update(discountCodes).set({ status: "expired" }).where(eq(discountCodes.id, row.id));
    throw new TRPCError({ code: "BAD_REQUEST", message: "El código de descuento ha caducado o alcanzó su límite de usos" });
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discountPercent: parseFloat(row.discountPercent as unknown as string),
  };
}

/** Registra el uso de un código y actualiza el contador */
export async function recordDiscountUse(params: {
  discountCodeId: number;
  code: string;
  discountPercent: number;
  discountAmount: number;
  originalAmount: number;
  finalAmount: number;
  channel: "tpv" | "online" | "crm" | "delegated";
  reservationId?: number;
  tpvSaleId?: number;
  appliedByUserId?: string;
}): Promise<void> {
  await db.insert(discountCodeUses).values({
    discountCodeId: params.discountCodeId,
    code: params.code,
    discountPercent: params.discountPercent.toString() as unknown as any,
    discountAmount: params.discountAmount.toString() as unknown as any,
    originalAmount: params.originalAmount.toString() as unknown as any,
    finalAmount: params.finalAmount.toString() as unknown as any,
    channel: params.channel,
    reservationId: params.reservationId ?? null,
    tpvSaleId: params.tpvSaleId ?? null,
    appliedByUserId: params.appliedByUserId ?? null,
  });
  await db
    .update(discountCodes)
    .set({ currentUses: sql`current_uses + 1` })
    .where(eq(discountCodes.id, params.discountCodeId));

  // ── Sincronizar bono compensatorio si este código proviene de uno ────────────
  // Cuando el código es de origin='voucher' y alcanza maxUses, marcamos el voucher
  // como 'canjeado' automáticamente, sin intervención manual del admin.
  try {
    const [updated] = await db
      .select({
        origin: discountCodes.origin,
        compensationVoucherId: discountCodes.compensationVoucherId,
        currentUses: discountCodes.currentUses,
        maxUses: discountCodes.maxUses,
      })
      .from(discountCodes)
      .where(eq(discountCodes.id, params.discountCodeId))
      .limit(1);

    if (
      updated?.origin === "voucher" &&
      updated.compensationVoucherId &&
      updated.maxUses !== null &&
      updated.currentUses >= updated.maxUses
    ) {
      await db
        .update(compensationVouchers)
        .set({ status: "canjeado", redeemedAt: new Date() })
        .where(eq(compensationVouchers.id, updated.compensationVoucherId));
    }
  } catch (e) {
    // No crítico: el descuento ya se registró correctamente
    console.error("[discounts] Error sincronizando estado del bono compensatorio:", e);
  }
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const discountsRouter = router({
  /** Validar un código (acceso público para checkout online y TPV) */
  validate: publicProcedure
    .input(z.object({ code: z.string().min(1), amount: z.number().optional() }))
    .mutation(async ({ input }) => {
      const result = await validateAndGetDiscount(input.code);
      return { valid: true, ...result };
    }),

  /**
   * Verificar un bono compensatorio por código (acceso público).
   * Devuelve el estado del voucher sin modificar nada.
   */
  verifyVoucher: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      const normalizedCode = input.code.toUpperCase().trim();

      // Buscar en discount_codes el código
      const [dc] = await db
        .select()
        .from(discountCodes)
        .where(and(
          eq(discountCodes.code, normalizedCode),
          eq(discountCodes.origin, "voucher"),
        ))
        .limit(1);

      if (!dc) {
        return { found: false } as const;
      }

      // Buscar el voucher vinculado
      let voucher: typeof compensationVouchers.$inferSelect | null = null;
      if (dc.compensationVoucherId) {
        const [v] = await db
          .select()
          .from(compensationVouchers)
          .where(eq(compensationVouchers.id, dc.compensationVoucherId))
          .limit(1);
        voucher = v ?? null;
      }

      const isExpiredByDate = dc.expiresAt ? new Date(dc.expiresAt) < new Date() : false;
      const isUsed = dc.maxUses !== null && dc.currentUses >= dc.maxUses;

      return {
        found: true,
        code: dc.code,
        value: Number(dc.discountAmount ?? 0),
        discountType: dc.discountType,
        status: isUsed ? "canjeado" : isExpiredByDate ? "caducado" : (voucher?.status ?? "enviado"),
        expiresAt: dc.expiresAt ?? voucher?.expiresAt ?? null,
        conditions: voucher?.conditions ?? null,
        activityName: voucher?.activityName ?? null,
        clientName: dc.clientName ?? null,
      };
    }),

  /** Listar todos los códigos (admin) */
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["active", "inactive", "expired", "all"]).default("all"),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const conditions = [];
      if (input.search) {
        conditions.push(or(
          like(discountCodes.code, `%${input.search}%`),
          like(discountCodes.name, `%${input.search}%`),
        ));
      }
      if (input.status !== "all") {
        conditions.push(eq(discountCodes.status, input.status as any));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [items, countResult] = await Promise.all([
        db.select().from(discountCodes)
          .where(where)
          .orderBy(desc(discountCodes.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ count: sql<number>`COUNT(*)` }).from(discountCodes).where(where),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  /** Obtener un código por ID (admin) */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Código no encontrado" });
      return row;
    }),

  /** Crear un código (admin) */
  create: protectedProcedure
    .input(z.object({
      code: z.string().min(2).max(50).transform(v => v.toUpperCase().trim()),
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      discountPercent: z.number().min(1).max(100),
      expiresAt: z.string().nullable().optional(),
      maxUses: z.number().int().positive().nullable().optional(),
      observations: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Verificar unicidad
      const [existing] = await db.select({ id: discountCodes.id })
        .from(discountCodes).where(eq(discountCodes.code, input.code));
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un código con ese nombre" });

      await db.insert(discountCodes).values({
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        discountPercent: input.discountPercent.toString() as unknown as any,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxUses: input.maxUses ?? null,
        observations: input.observations ?? null,
        status: "active",
        currentUses: 0,
      });
      const [created] = await db.select().from(discountCodes).where(eq(discountCodes.code, input.code));
      return created;
    }),

  /** Actualizar un código (admin) */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      discountPercent: z.number().min(1).max(100).optional(),
      expiresAt: z.string().nullable().optional(),
      maxUses: z.number().int().positive().nullable().optional(),
      observations: z.string().optional(),
      status: z.enum(["active", "inactive", "expired"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: Record<string, any> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.discountPercent !== undefined) updateData.discountPercent = data.discountPercent.toString();
      if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
      if (data.maxUses !== undefined) updateData.maxUses = data.maxUses;
      if (data.observations !== undefined) updateData.observations = data.observations;
      if (data.status !== undefined) updateData.status = data.status;
      await db.update(discountCodes).set(updateData).where(eq(discountCodes.id, id));
      const [updated] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
      return updated;
    }),

  /** Activar/desactivar un código (admin) */
  toggleStatus: protectedProcedure
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.update(discountCodes)
        .set({ status: input.active ? "active" : "inactive" })
        .where(eq(discountCodes.id, input.id));
      return { success: true };
    }),

  /** Duplicar un código (admin) */
  duplicate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [original] = await db.select().from(discountCodes).where(eq(discountCodes.id, input.id));
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Código no encontrado" });
      const newCode = `${original.code}-COPIA-${Date.now().toString().slice(-4)}`;
      await db.insert(discountCodes).values({
        code: newCode,
        name: `${original.name} (copia)`,
        description: original.description,
        discountPercent: original.discountPercent,
        expiresAt: original.expiresAt,
        maxUses: original.maxUses,
        observations: original.observations,
        status: "active",
        currentUses: 0,
      });
      const [created] = await db.select().from(discountCodes).where(eq(discountCodes.code, newCode));
      return created;
    }),

  /** Eliminar un código (admin) — solo si no tiene usos */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Código no encontrado" });
      if (row.currentUses > 0) {
        // Soft delete: desactivar en lugar de eliminar
        await db.update(discountCodes).set({ status: "inactive" }).where(eq(discountCodes.id, input.id));
        return { success: true, softDeleted: true };
      }
      await db.delete(discountCodes).where(eq(discountCodes.id, input.id));
      return { success: true, softDeleted: false };
    }),

  /** Historial de usos de un código (admin) */
  getUses: protectedProcedure
    .input(z.object({ discountCodeId: z.number() }))
    .query(async ({ input }) => {
      return db.select().from(discountCodeUses)
        .where(eq(discountCodeUses.discountCodeId, input.discountCodeId))
        .orderBy(desc(discountCodeUses.appliedAt))
        .limit(100);
    }),
});
