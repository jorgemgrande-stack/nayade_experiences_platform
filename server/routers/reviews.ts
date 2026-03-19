import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getPublicReviews,
  getReviewStats,
  createReview,
  adminGetReviews,
  approveReview,
  rejectReview,
  deleteReview,
  replyToReview,
  adminGetReviewStats,
} from "../db/reviewsDb";

const entityTypeSchema = z.enum(["hotel", "spa"]);

export const reviewsRouter = router({
  // ─── PÚBLICOS ────────────────────────────────────────────────────────────────

  /** Obtiene reseñas aprobadas + estadísticas para una entidad */
  getPublicReviews: publicProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        entityId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const [reviewsData, stats] = await Promise.all([
        getPublicReviews(input.entityType, input.entityId, input.limit, input.offset),
        getReviewStats(input.entityType, input.entityId),
      ]);
      return { ...reviewsData, stats };
    }),

  /** Envía una nueva reseña (queda en estado pending) */
  submitReview: publicProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        entityId: z.number().int().positive(),
        authorName: z.string().min(2).max(256),
        authorEmail: z.string().email().optional(),
        rating: z.number().int().min(1).max(5),
        title: z.string().max(256).optional(),
        body: z.string().min(10).max(2000),
        stayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const review = await createReview(input);
      return { success: true, reviewId: review.id };
    }),

  // ─── ADMIN ───────────────────────────────────────────────────────────────────

  /** Listado completo de reseñas para el panel de admin */
  adminGetReviews: protectedProcedure
    .input(
      z.object({
        entityType: entityTypeSchema.optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return adminGetReviews(input);
    }),

  /** Estadísticas globales de reseñas para el dashboard */
  adminGetStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return adminGetReviewStats();
  }),

  /** Aprueba una reseña */
  adminApprove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await approveReview(input.id);
      return { success: true };
    }),

  /** Rechaza una reseña */
  adminReject: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await rejectReview(input.id);
      return { success: true };
    }),

  /** Elimina una reseña definitivamente */
  adminDelete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await deleteReview(input.id);
      return { success: true };
    }),

  /** Responde a una reseña como admin */
  adminReply: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reply: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await replyToReview(input.id, input.reply);
      return { success: true };
    }),
});
