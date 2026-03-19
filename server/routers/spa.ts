import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAllSpaCategories, getActiveSpaCategories, createSpaCategory, updateSpaCategory, deleteSpaCategory,
  getAllSpaTreatments, getActiveSpaTreatments, getSpaTreatmentBySlug, getSpaTreatmentById,
  createSpaTreatment, updateSpaTreatment, deleteSpaTreatment, toggleSpaTreatmentActive,
  getAllSpaResources, createSpaResource, updateSpaResource, deleteSpaResource,
  getSpaSlotsByDate, getSpaSlotsByDateRange, createSpaSlot, updateSpaSlot, deleteSpaSlot,
  getSpaScheduleTemplates, createSpaScheduleTemplate, updateSpaScheduleTemplate, deleteSpaScheduleTemplate,
  generateSlotsFromTemplates,
} from "../spaDb";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

export const spaRouter = router({

  // ── PUBLIC ────────────────────────────────────────────────────────────────

  getCategories: publicProcedure.query(() => getActiveSpaCategories()),

  getTreatments: publicProcedure
    .input(z.object({ categoryId: z.number().int().optional() }))
    .query(({ input }) => getActiveSpaTreatments(input.categoryId)),

  getTreatmentBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const t = await getSpaTreatmentBySlug(input.slug);
      if (!t || !t.isActive) throw new TRPCError({ code: "NOT_FOUND" });
      return t;
    }),

  /** Slots disponibles para un mes completo (para el calendario de disponibilidad) */
  getSlotsByMonth: publicProcedure
    .input(z.object({
      treatmentId: z.number().int(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      const slots = await getSpaSlotsByDateRange(input.startDate, input.endDate, input.treatmentId);
      return slots
        .filter(s => s.status !== "bloqueado")
        .map(s => ({ date: s.date, capacity: s.capacity, bookedCount: s.bookedCount }));
    }),

  /** Slots disponibles para un tratamiento en una fecha */
  getAvailableSlots: publicProcedure
    .input(z.object({
      treatmentId: z.number().int(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      const slots = await getSpaSlotsByDate(input.treatmentId, input.date);
      return slots.filter(s => s.status !== "bloqueado" && s.bookedCount < s.capacity);
    }),

  // ── ADMIN: CATEGORIES ─────────────────────────────────────────────────────

  adminGetCategories: adminProcedure.query(() => getAllSpaCategories()),

  adminCreateCategory: adminProcedure
    .input(z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      iconName: z.string().optional(),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(({ input }) => createSpaCategory(input)),

  adminUpdateCategory: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().optional(),
      description: z.string().optional(),
      iconName: z.string().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateSpaCategory(id, data);
    }),

  adminDeleteCategory: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteSpaCategory(input.id)),

  // ── ADMIN: TREATMENTS ─────────────────────────────────────────────────────

  adminGetTreatments: adminProcedure.query(() => getAllSpaTreatments()),

  adminCreateTreatment: adminProcedure
    .input(z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      categoryId: z.number().int().nullable().optional(),
      shortDescription: z.string().optional(),
      description: z.string().optional(),
      benefits: z.array(z.string()).optional(),
      coverImageUrl: z.string().optional(),
      image1: z.string().optional(),
      image2: z.string().optional(),
      gallery: z.array(z.string()).optional(),
      durationMinutes: z.number().int().min(5).default(60),
      price: z.string(),
      maxPersons: z.number().int().min(1).default(1),
      cabinRequired: z.boolean().default(true),
      isFeatured: z.boolean().default(false),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => createSpaTreatment(input)),

  adminUpdateTreatment: adminProcedure
    .input(z.object({
      id: z.number().int(),
      slug: z.string().optional(),
      name: z.string().optional(),
      categoryId: z.number().int().nullable().optional(),
      shortDescription: z.string().optional(),
      description: z.string().optional(),
      benefits: z.array(z.string()).optional(),
      coverImageUrl: z.string().optional(),
      image1: z.string().optional(),
      image2: z.string().optional(),
      gallery: z.array(z.string()).optional(),
      durationMinutes: z.number().int().optional(),
      price: z.string().optional(),
      maxPersons: z.number().int().optional(),
      cabinRequired: z.boolean().optional(),
      isFeatured: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateSpaTreatment(id, data);
    }),

  adminDeleteTreatment: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteSpaTreatment(input.id)),

  adminToggleTreatmentActive: adminProcedure
    .input(z.object({ id: z.number().int(), isActive: z.boolean() }))
    .mutation(({ input }) => toggleSpaTreatmentActive(input.id, input.isActive)),

  // ── ADMIN: RESOURCES ──────────────────────────────────────────────────────

  adminGetResources: adminProcedure.query(() => getAllSpaResources()),

  adminCreateResource: adminProcedure
    .input(z.object({
      type: z.enum(["cabina", "terapeuta"]),
      name: z.string().min(1),
      description: z.string().optional(),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(({ input }) => createSpaResource(input)),

  adminUpdateResource: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateSpaResource(id, data);
    }),

  adminDeleteResource: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteSpaResource(input.id)),

  // ── ADMIN: SLOTS ──────────────────────────────────────────────────────────

  adminGetSlots: adminProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      treatmentId: z.number().int().optional(),
    }))
    .query(({ input }) => getSpaSlotsByDateRange(input.startDate, input.endDate, input.treatmentId)),

  adminCreateSlot: adminProcedure
    .input(z.object({
      treatmentId: z.number().int(),
      resourceId: z.number().int().nullable().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      capacity: z.number().int().min(1).default(1),
      status: z.enum(["disponible", "reservado", "bloqueado"]).default("disponible"),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => createSpaSlot(input)),

  adminUpdateSlot: adminProcedure
    .input(z.object({
      id: z.number().int(),
      capacity: z.number().int().optional(),
      bookedCount: z.number().int().optional(),
      status: z.enum(["disponible", "reservado", "bloqueado"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateSpaSlot(id, data);
    }),

  adminDeleteSlot: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteSpaSlot(input.id)),

  // ── ADMIN: SCHEDULE TEMPLATES ─────────────────────────────────────────────

  adminGetTemplates: adminProcedure
    .input(z.object({ treatmentId: z.number().int().optional() }))
    .query(({ input }) => getSpaScheduleTemplates(input.treatmentId)),

  adminCreateTemplate: adminProcedure
    .input(z.object({
      treatmentId: z.number().int(),
      resourceId: z.number().int().nullable().optional(),
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      capacity: z.number().int().min(1).default(1),
      isActive: z.boolean().default(true),
    }))
    .mutation(({ input }) => createSpaScheduleTemplate(input)),

  adminUpdateTemplate: adminProcedure
    .input(z.object({
      id: z.number().int(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      capacity: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateSpaScheduleTemplate(id, data);
    }),

  adminDeleteTemplate: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteSpaScheduleTemplate(input.id)),

  adminGenerateSlots: adminProcedure
    .input(z.object({
      treatmentId: z.number().int(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(({ input }) => generateSlotsFromTemplates(input.treatmentId, input.startDate, input.endDate)),
});
