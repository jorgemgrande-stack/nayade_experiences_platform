import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAllRoomTypes, getActiveRoomTypes, getRoomTypeBySlug, getRoomTypeById,
  createRoomType, updateRoomType, deleteRoomType, toggleRoomTypeActive,
  getAllRateSeasons, createRateSeason, updateRateSeason, deleteRateSeason,
  getRatesByRoomType, createRoomRate, updateRoomRate, deleteRoomRate,
  getRoomBlocksForRange, getAllBlocksForRange, upsertRoomBlock, deleteRoomBlock,
  searchAvailability, getRoomCalendar,
} from "../hotelDb";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

export const hotelRouter = router({

  // ── PUBLIC ────────────────────────────────────────────────────────────────

  /** Lista pública de tipologías activas */
  getRoomTypes: publicProcedure.query(() => getActiveRoomTypes()),

  /** Detalle de una habitación por slug */
  getRoomTypeBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const room = await getRoomTypeBySlug(input.slug);
      if (!room || !room.isActive) throw new TRPCError({ code: "NOT_FOUND" });
      return room;
    }),

  /** Buscar disponibilidad para un rango de fechas */
  searchAvailability: publicProcedure
    .input(z.object({
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      adults: z.number().int().min(1).max(10).default(2),
      children: z.number().int().min(0).max(10).default(0),
    }))
    .query(({ input }) => searchAvailability(input)),

  /** Calendario de precios y disponibilidad para una habitación */
  getRoomCalendar: publicProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      year: z.number().int().min(2024).max(2030),
      month: z.number().int().min(1).max(12),
    }))
    .query(({ input }) => getRoomCalendar(input.roomTypeId, input.year, input.month)),

  // ── ADMIN: ROOM TYPES ─────────────────────────────────────────────────────

  adminGetRoomTypes: adminProcedure.query(() => getAllRoomTypes()),

  adminCreateRoomType: adminProcedure
    .input(z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      shortDescription: z.string().optional(),
      description: z.string().optional(),
      coverImageUrl: z.string().optional(),
      image1: z.string().optional(),
      image2: z.string().optional(),
      image3: z.string().optional(),
      image4: z.string().optional(),
      gallery: z.array(z.string()).optional(),
      maxAdults: z.number().int().min(1).default(2),
      maxChildren: z.number().int().min(0).default(0),
      maxOccupancy: z.number().int().min(1).default(2),
      surfaceM2: z.number().int().optional(),
      amenities: z.array(z.string()).optional(),
      basePrice: z.string(),
      totalUnits: z.number().int().min(1).default(1),
      isFeatured: z.boolean().default(false),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => createRoomType(input)),

  adminUpdateRoomType: adminProcedure
    .input(z.object({
      id: z.number().int(),
      slug: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      shortDescription: z.string().optional(),
      description: z.string().optional(),
      coverImageUrl: z.string().optional(),
      image1: z.string().optional(),
      image2: z.string().optional(),
      image3: z.string().optional(),
      image4: z.string().optional(),
      gallery: z.array(z.string()).optional(),
      maxAdults: z.number().int().min(1).optional(),
      maxChildren: z.number().int().min(0).optional(),
      maxOccupancy: z.number().int().min(1).optional(),
      surfaceM2: z.number().int().optional(),
      amenities: z.array(z.string()).optional(),
      basePrice: z.string().optional(),
      totalUnits: z.number().int().min(1).optional(),
      isFeatured: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateRoomType(id, data);
    }),

  adminDeleteRoomType: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteRoomType(input.id)),

  adminToggleRoomTypeActive: adminProcedure
    .input(z.object({ id: z.number().int(), isActive: z.boolean() }))
    .mutation(({ input }) => toggleRoomTypeActive(input.id, input.isActive)),

  // ── ADMIN: RATE SEASONS ───────────────────────────────────────────────────

  adminGetRateSeasons: adminProcedure.query(() => getAllRateSeasons()),

  adminCreateRateSeason: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(({ input }) => createRateSeason(input)),

  adminUpdateRateSeason: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateRateSeason(id, data);
    }),

  adminDeleteRateSeason: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteRateSeason(input.id)),

  // ── ADMIN: ROOM RATES ─────────────────────────────────────────────────────

  adminGetRates: adminProcedure
    .input(z.object({ roomTypeId: z.number().int() }))
    .query(({ input }) => getRatesByRoomType(input.roomTypeId)),

  adminCreateRate: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      seasonId: z.number().int().nullable().optional(),
      dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
      specificDate: z.string().nullable().optional(),
      pricePerNight: z.string(),
      supplement: z.string().optional(),
      supplementLabel: z.string().optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(({ input }) => createRoomRate(input)),

  adminUpdateRate: adminProcedure
    .input(z.object({
      id: z.number().int(),
      pricePerNight: z.string().optional(),
      supplement: z.string().optional(),
      supplementLabel: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateRoomRate(id, data);
    }),

  adminDeleteRate: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteRoomRate(input.id)),

  // ── ADMIN: CALENDAR / BLOCKS ──────────────────────────────────────────────

  adminGetBlocks: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int().optional(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(({ input }) => {
      if (input.roomTypeId) {
        return getRoomBlocksForRange(input.roomTypeId, input.startDate, input.endDate);
      }
      return getAllBlocksForRange(input.startDate, input.endDate);
    }),

  adminUpsertBlock: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      availableUnits: z.number().int().min(0),
      reason: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => upsertRoomBlock({ ...input, createdBy: ctx.user.id })),

  adminDeleteBlock: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteRoomBlock(input.id)),

  adminGetCalendar: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
    }))
    .query(({ input }) => getRoomCalendar(input.roomTypeId, input.year, input.month)),
});
