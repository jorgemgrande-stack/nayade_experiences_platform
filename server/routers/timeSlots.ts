/**
 * Router: Product Time Slots
 * Sistema modular de horarios por producto — completamente retrocompatible.
 * Si has_time_slots = false en el producto, este módulo no afecta ningún flujo existente.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { productTimeSlots, experiences } from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const timeSlotSchema = z.object({
  productId: z.number().int().positive(),
  type: z.enum(["fixed", "flexible", "range"]),
  label: z.string().min(1).max(128),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  daysOfWeek: z.string().max(32).optional().nullable(), // "1,2,3,4,5"
  capacity: z.number().int().positive().optional().nullable(),
  priceOverride: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const timeSlotsRouter = router({

  // ── Public: get active time slots for a product ──────────────────────────
  getByProduct: publicProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const slots = await db
        .select()
        .from(productTimeSlots)
        .where(and(
          eq(productTimeSlots.productId, input.productId),
          eq(productTimeSlots.active, true)
        ))
        .orderBy(asc(productTimeSlots.sortOrder), asc(productTimeSlots.id));
      return slots;
    }),

  // ── Admin: get all time slots for a product (including inactive) ─────────
  getByProductAdmin: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const slots = await db
        .select()
        .from(productTimeSlots)
        .where(eq(productTimeSlots.productId, input.productId))
        .orderBy(asc(productTimeSlots.sortOrder), asc(productTimeSlots.id));
      return slots;
    }),

  // ── Admin: create a time slot ────────────────────────────────────────────
  create: protectedProcedure
    .input(timeSlotSchema)
    .mutation(async ({ input }) => {
      const [result] = await db.insert(productTimeSlots).values({
        productId: input.productId,
        type: input.type,
        label: input.label,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        daysOfWeek: input.daysOfWeek ?? null,
        capacity: input.capacity ?? null,
        priceOverride: input.priceOverride ?? null,
        sortOrder: input.sortOrder,
        active: input.active,
      });
      return { id: (result as any).insertId, success: true };
    }),

  // ── Admin: update a time slot ────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(timeSlotSchema.partial()))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const [existing] = await db
        .select()
        .from(productTimeSlots)
        .where(eq(productTimeSlots.id, id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Time slot no encontrado" });

      await db.update(productTimeSlots).set({
        ...(data.type !== undefined && { type: data.type }),
        ...(data.label !== undefined && { label: data.label }),
        ...(data.startTime !== undefined && { startTime: data.startTime }),
        ...(data.endTime !== undefined && { endTime: data.endTime }),
        ...(data.daysOfWeek !== undefined && { daysOfWeek: data.daysOfWeek }),
        ...(data.capacity !== undefined && { capacity: data.capacity }),
        ...(data.priceOverride !== undefined && { priceOverride: data.priceOverride }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.active !== undefined && { active: data.active }),
      }).where(eq(productTimeSlots.id, id));
      return { success: true };
    }),

  // ── Admin: delete a time slot ────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await db.delete(productTimeSlots).where(eq(productTimeSlots.id, input.id));
      return { success: true };
    }),

  // ── Admin: reorder time slots ────────────────────────────────────────────
  reorder: protectedProcedure
    .input(z.object({
      items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() }))
    }))
    .mutation(async ({ input }) => {
      for (const item of input.items) {
        await db.update(productTimeSlots)
          .set({ sortOrder: item.sortOrder })
          .where(eq(productTimeSlots.id, item.id));
      }
      return { success: true };
    }),

  // ── Admin: toggle has_time_slots on experience ───────────────────────────
  toggleProductTimeSlots: protectedProcedure
    .input(z.object({
      productId: z.number().int().positive(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.update(experiences)
        .set({ hasTimeSlots: input.enabled })
        .where(eq(experiences.id, input.productId));
      return { success: true };
    }),
});
