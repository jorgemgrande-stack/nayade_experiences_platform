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
  getHomeModuleItems,
  setHomeModuleItems,
  createReservation,
  getReservationByMerchantOrder,
  getAllReservations,
  getReservationById,
} from "./db";
import {
  buildRedsysForm,
  validateRedsysNotification,
  generateMerchantOrder,
} from "./redsys";

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
        image1: z.string().optional(),
        image2: z.string().optional(),
        image3: z.string().optional(),
        image4: z.string().optional(),
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
        image1: z.string().optional(),
        image2: z.string().optional(),
        image3: z.string().optional(),
        image4: z.string().optional(),
        duration: z.string().optional(),
        difficulty: z.enum(["facil", "moderado", "dificil", "experto"]).optional(),
        categoryId: z.number().optional(),
        locationId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        // Sync coverImageUrl with image1
        if (data.image1 !== undefined) (data as Record<string, unknown>).coverImageUrl = data.image1;
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
        image1: z.string().optional(),
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
        image1: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        // Sync imageUrl with image1
        if (data.image1 !== undefined) (data as Record<string, unknown>).imageUrl = data.image1;
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

  //   // ─── ADMIN: USERS ─────────────────────────────────────────────────────
  admin: router({
    getUsers: adminProcedure.query(async () => {
      return getAllUsers();
    }),
  }),
  // ─── HOME MODULES ─────────────────────────────────────────────────────
  homeModules: router({
    getModule: publicProcedure
      .input(z.object({ moduleKey: z.string() }))
      .query(async ({ input }) => {
        return getHomeModuleItems(input.moduleKey);
      }),
    setModule: adminProcedure
      .input(z.object({
        moduleKey: z.string(),
        experienceIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        return setHomeModuleItems(input.moduleKey, input.experienceIds);
      }),
  }),

  // ─── RESERVATIONS (Redsys) ─────────────────────────────────────────────────────
  reservations: router({
    /**
     * Crea una pre-reserva con estado pending_payment y devuelve los datos
     * necesarios para redirigir al TPV Redsys.
     * El importe se calcula SIEMPRE en backend desde el precio del producto.
     */
    createAndPay: publicProcedure
      .input(z.object({
        productId: z.number(),
        bookingDate: z.string(),
        people: z.number().min(1).max(100),
        extras: z.array(z.object({
          name: z.string(),
          price: z.number(),
          quantity: z.number(),
        })).default([]),
        customerName: z.string().min(2),
        customerEmail: z.string().email(),
        customerPhone: z.string().optional(),
        notes: z.string().optional(),
        /** URL base del frontend para construir las URLs de retorno */
        origin: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        // 1. Obtener el producto y validar que existe y tiene precio
        const { getExperienceById } = await import("./db");
        const product = await getExperienceById(input.productId);
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
        if (!product.basePrice) throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto no tiene precio fijo" });

        // 2. Calcular el importe total en backend (nunca confiar en el frontend)
        const basePrice = parseFloat(String(product.basePrice));
        let totalEuros = basePrice * input.people;
        const extrasTotal = input.extras.reduce((sum, e) => sum + e.price * e.quantity, 0);
        totalEuros += extrasTotal;
        const amountCents = Math.round(totalEuros * 100); // Redsys usa céntimos

        // 3. Generar merchantOrder único
        const merchantOrder = generateMerchantOrder();

        // 4. Crear la pre-reserva en BD con estado pending_payment
        const extrasJson = JSON.stringify(input.extras);
        await createReservation({
          productId: input.productId,
          productName: product.title,
          bookingDate: input.bookingDate,
          people: input.people,
          extrasJson,
          amountTotal: amountCents,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          merchantOrder,
          notes: input.notes,
        });

        // 5. Construir el formulario Redsys
        const redsysForm = buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `${product.title} x${input.people} personas`,
          notifyUrl: `${input.origin}/api/redsys/notification`,
          okUrl: `${input.origin}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${input.origin}/reserva/error?order=${merchantOrder}`,
          holderName: input.customerName,
        });

        return {
          merchantOrder,
          amountCents,
          amountEuros: totalEuros,
          productName: product.title,
          redsysForm,
        };
      }),

    /** Consulta el estado de una reserva por merchantOrder (para la página OK/KO) */
    getStatus: publicProcedure
      .input(z.object({ merchantOrder: z.string() }))
      .query(async ({ input }) => {
        const reservation = await getReservationByMerchantOrder(input.merchantOrder);
        if (!reservation) throw new TRPCError({ code: "NOT_FOUND" });
        return {
          status: reservation.status,
          productName: reservation.productName,
          bookingDate: reservation.bookingDate,
          people: reservation.people,
          amountTotal: reservation.amountTotal,
          customerName: reservation.customerName,
          customerEmail: reservation.customerEmail,
        };
      }),

    /** Listado de reservas para el panel de admin */
    getAll: adminProcedure
      .input(z.object({
        status: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllReservations(input);
      }),

    /** Detalle de una reserva para el panel de admin */
    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const r = await getReservationById(input.id);
        if (!r) throw new TRPCError({ code: "NOT_FOUND" });
        return r;
      }),
  }),
});
export type AppRouter = typeof appRouter;
