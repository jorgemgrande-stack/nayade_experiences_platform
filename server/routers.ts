import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getPublicExperiences,
  getFeaturedExperiences,
  getPublicCategories,
  getPublicLocations,
  getExperienceBySlug,
  createLead,
  getSlideshowItems,
  // Admin queries
  getAllExperiences,
  getAllCategories,
  getAllLocations,
  createExperience,
  updateExperience,
  deleteExperience,
  createCategory,
  updateCategory,
  deleteCategory,
  createLocation,
  updateLocation,
  deleteLocation,
  getAllLeads,
  updateLeadStatus,
  getAllQuotes,
  createQuote,
  updateQuoteStatus,
  getAllBookings,
  createBooking,
  updateBookingStatus,
  getAllTransactions,
  getDashboardMetrics,
  getAllSlideshowItems,
  createSlideshowItem,
  updateSlideshowItem,
  deleteSlideshowItem,
  getAllMediaFiles,
  getAllUsers,
} from "./db";

// Admin middleware
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

// Staff middleware (admin + agente)
const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["admin", "agente"].includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido al equipo" });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── PUBLIC ROUTES ────────────────────────────────────────────────────────
  public: router({
    getFeaturedExperiences: publicProcedure.query(async () => {
      return getFeaturedExperiences();
    }),

    getExperiences: publicProcedure
      .input(z.object({
        categorySlug: z.string().optional(),
        locationSlug: z.string().optional(),
        limit: z.number().min(1).max(50).default(12),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        return getPublicExperiences(input);
      }),

    getExperienceBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const exp = await getExperienceBySlug(input.slug);
        if (!exp) throw new TRPCError({ code: "NOT_FOUND" });
        return exp;
      }),

    getCategories: publicProcedure.query(async () => {
      return getPublicCategories();
    }),

    getLocations: publicProcedure.query(async () => {
      return getPublicLocations();
    }),

    getSlideshowItems: publicProcedure.query(async () => {
      return getSlideshowItems();
    }),

    submitLead: publicProcedure
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        company: z.string().optional(),
        message: z.string().optional(),
        experienceId: z.number().optional(),
        locationId: z.number().optional(),
        preferredDate: z.string().optional(),
        numberOfPersons: z.number().optional(),
        budget: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createLead(input);
      }),
  }),

  // ─── ADMIN: CMS ───────────────────────────────────────────────────────────
  cms: router({
    getSlideshowItems: adminProcedure.query(async () => {
      return getAllSlideshowItems();
    }),

    createSlideshowItem: adminProcedure
      .input(z.object({
        imageUrl: z.string().url(),
        badge: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        ctaText: z.string().optional(),
        ctaUrl: z.string().optional(),
        reserveUrl: z.string().optional(),
        sortOrder: z.number().default(0),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        return createSlideshowItem(input);
      }),
    updateSlideshowItem: adminProcedure
      .input(z.object({
        id: z.number(),
        imageUrl: z.string().url().optional(),
        badge: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        ctaText: z.string().optional(),
        ctaUrl: z.string().optional(),
        reserveUrl: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateSlideshowItem(id, data);
      }),

    deleteSlideshowItem: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteSlideshowItem(input.id);
      }),

    getMediaFiles: adminProcedure.query(async () => {
      return getAllMediaFiles();
    }),
  }),

  // ─── ADMIN: PRODUCTS ──────────────────────────────────────────────────────
  products: router({
    getAll: adminProcedure.query(async () => {
      return getAllExperiences();
    }),

    create: adminProcedure
      .input(z.object({
        slug: z.string(),
        title: z.string(),
        shortDescription: z.string().optional(),
        description: z.string().optional(),
        categoryId: z.number(),
        locationId: z.number(),
        coverImageUrl: z.string().optional(),
        basePrice: z.string(),
        duration: z.string().optional(),
        minPersons: z.number().optional(),
        maxPersons: z.number().optional(),
        difficulty: z.enum(["facil", "moderado", "dificil", "experto"]).optional(),
        isFeatured: z.boolean().default(false),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        return createExperience(input);
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        shortDescription: z.string().optional(),
        description: z.string().optional(),
        basePrice: z.string().optional(),
        isFeatured: z.boolean().optional(),
        isActive: z.boolean().optional(),
        coverImageUrl: z.string().optional(),
        duration: z.string().optional(),
        difficulty: z.enum(["facil", "moderado", "dificil", "experto"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateExperience(id, data);
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteExperience(input.id);
      }),

    getCategories: adminProcedure.query(async () => {
      return getAllCategories();
    }),

    createCategory: adminProcedure
      .input(z.object({
        slug: z.string(),
        name: z.string(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        iconName: z.string().optional(),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        return createCategory(input);
      }),

    updateCategory: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateCategory(id, data);
      }),

    deleteCategory: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteCategory(input.id);
      }),

    getLocations: adminProcedure.query(async () => {
      return getAllLocations();
    }),

    createLocation: adminProcedure
      .input(z.object({
        slug: z.string(),
        name: z.string(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        address: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createLocation(input);
      }),

    updateLocation: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateLocation(id, data);
      }),

    deleteLocation: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteLocation(input.id);
      }),
  }),

  // ─── ADMIN: LEADS & QUOTES ────────────────────────────────────────────────
  leads: router({
    getAll: staffProcedure
      .input(z.object({
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllLeads(input);
      }),

    updateStatus: staffProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["nuevo", "contactado", "en_proceso", "convertido", "perdido"]),
        assignedTo: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        return updateLeadStatus(input.id, input.status, input.assignedTo);
      }),
  }),

  quotes: router({
    getAll: staffProcedure
      .input(z.object({
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllQuotes(input);
      }),

    create: staffProcedure
      .input(z.object({
        leadId: z.number(),
        title: z.string(),
        description: z.string().optional(),
        items: z.array(z.object({
          description: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
          total: z.number(),
        })),
        subtotal: z.string(),
        discount: z.string().default("0"),
        tax: z.string().default("0"),
        total: z.string(),
        validUntil: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return createQuote({ ...input, agentId: ctx.user.id });
      }),

    updateStatus: staffProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["borrador", "enviado", "aceptado", "rechazado", "expirado"]),
      }))
      .mutation(async ({ input }) => {
        return updateQuoteStatus(input.id, input.status);
      }),
  }),

  // ─── ADMIN: BOOKINGS & CALENDAR ───────────────────────────────────────────
  bookings: router({
    getAll: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllBookings(input);
      }),

    create: staffProcedure
      .input(z.object({
        experienceId: z.number(),
        quoteId: z.number().optional(),
        clientName: z.string(),
        clientEmail: z.string().email(),
        clientPhone: z.string().optional(),
        scheduledDate: z.string(),
        numberOfPersons: z.number(),
        totalAmount: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createBooking(input);
      }),

    updateStatus: staffProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pendiente", "confirmado", "en_curso", "completado", "cancelado"]),
        internalNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return updateBookingStatus(input.id, input.status, input.internalNotes);
      }),
  }),

  // ─── ADMIN: ACCOUNTING ────────────────────────────────────────────────────
  accounting: router({
    getTransactions: adminProcedure
      .input(z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllTransactions(input);
      }),

    getDashboardMetrics: adminProcedure.query(async () => {
      return getDashboardMetrics();
    }),
  }),

  // ─── ADMIN: USERS ─────────────────────────────────────────────────────────
  admin: router({
    getUsers: adminProcedure.query(async () => {
      return getAllUsers();
    }),
  }),
});

export type AppRouter = typeof appRouter;
