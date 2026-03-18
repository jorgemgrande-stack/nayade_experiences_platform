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
  createInvitedUser,
  changeUserRole,
  toggleUserActive,
  getUserByInviteToken,
  setUserPassword,
  resendUserInvite,
  deleteUser,
  getHomeModuleItems,
  setHomeModuleItems,
  createReservation,
  getReservationByMerchantOrder,
  getAllReservations,
  getReservationById,
  getVariantsByExperience,
  getAllVariantsGrouped,
  createVariant,
  updateVariant,
  deleteVariant,
  hardDeleteExperience,
  toggleExperienceActive,
  cloneExperience,
  hardDeleteCategory,
  toggleCategoryActive,
  cloneCategory,
  hardDeleteLocation,
  toggleLocationActive,
  cloneLocation,
  getPublicPacks,
  getPackBySlug,
  getPackCrossSells,
  getAllPacksAdmin,
  createPack,
  updatePack,
  togglePackActive,
  hardDeletePack,
  clonePack,
  getAllMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  reorderMenuItems,
  reorderExperiences,
  reorderPacks,
  reorderCategories,
  reorderLocations,
  reorderSlideshowItems,
} from "./db";
import {
  buildRedsysForm,
  validateRedsysNotification,
  generateMerchantOrder,
} from "./redsys";
import { sendInviteEmail } from "./inviteEmail";
// Admin middlewaree
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

    getVariantsByExperience: publicProcedure
      .input(z.object({ experienceId: z.number() }))
      .query(async ({ input }) => {
        return getVariantsByExperience(input.experienceId);
      }),

    setPassword: publicProcedure.input(z.object({
      token: z.string(),
      password: z.string().min(6),
    })).mutation(async ({ input }) => {
      const bcrypt = await import("bcryptjs");
      const user = await getUserByInviteToken(input.token);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Token inválido o expirado" });
      if (user.inviteTokenExpiry && new Date() > user.inviteTokenExpiry) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace ha expirado. Solicita un nuevo enlace al administrador." });
      }
      const passwordHash = await bcrypt.hash(input.password, 12);
      await setUserPassword(user.id, passwordHash);
      return { success: true, name: user.name };
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

    getMenuItems: publicProcedure
      .input(z.object({ zone: z.enum(["header", "footer"]).default("header") }))
      .query(async ({ input }) => {
        return getAllMenuItems(input.zone);
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

    reorderSlideshowItems: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => {
        return reorderSlideshowItems(input.items);
      }),

    getMediaFiles: adminProcedure.query(async () => {
      return getAllMediaFiles();
    }),

    // ── Menu Items ────────────────────────────────────────────────────────────
    getMenuItems: adminProcedure
      .input(z.object({ zone: z.enum(["header", "footer"]).default("header") }))
      .query(async ({ input }) => {
        return getAllMenuItems(input.zone);
      }),

    createMenuItem: adminProcedure
      .input(z.object({
        label: z.string().min(1),
        url: z.string().nullable().optional(),
        parentId: z.number().nullable().optional(),
        target: z.enum(["_self", "_blank"]).default("_self"),
        sortOrder: z.number().default(0),
        isActive: z.boolean().default(true),
        menuZone: z.enum(["header", "footer"]).default("header"),
      }))
      .mutation(async ({ input }) => {
        return createMenuItem(input);
      }),

    updateMenuItem: adminProcedure
      .input(z.object({
        id: z.number(),
        label: z.string().min(1).optional(),
        url: z.string().nullable().optional(),
        parentId: z.number().nullable().optional(),
        target: z.enum(["_self", "_blank"]).optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateMenuItem(id, data);
      }),

    deleteMenuItem: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteMenuItem(input.id);
      }),

    reorderMenuItems: adminProcedure
      .input(z.object({
        items: z.array(z.object({ id: z.number(), sortOrder: z.number() })),
      }))
      .mutation(async ({ input }) => {
        return reorderMenuItems(input.items);
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

    hardDelete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return hardDeleteExperience(input.id);
      }),

    toggleActive: adminProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        return toggleExperienceActive(input.id, input.isActive);
      }),

    clone: adminProcedure
      .input(z.object({ id: z.number(), newName: z.string().optional() }))
      .mutation(async ({ input }) => {
        return cloneExperience(input.id, input.newName);
      }),

    reorder: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => {
        return reorderExperiences(input.items);
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

    hardDeleteCategory: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return hardDeleteCategory(input.id);
      }),

    toggleCategoryActive: adminProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        return toggleCategoryActive(input.id, input.isActive);
      }),

    cloneCategory: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return cloneCategory(input.id);
      }),

    reorderCategories: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => {
        return reorderCategories(input.items);
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

    hardDeleteLocation: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return hardDeleteLocation(input.id);
      }),

    toggleLocationActive: adminProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        return toggleLocationActive(input.id, input.isActive);
      }),

    cloneLocation: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return cloneLocation(input.id);
      }),

    reorderLocations: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => {
        return reorderLocations(input.items);
      }),

    // ── VARIANTS ──────────────────────────────────────────────────────────────
    getVariants: adminProcedure
      .input(z.object({ experienceId: z.number().optional() }))
      .query(async ({ input }) => {
        if (input.experienceId) {
          return getVariantsByExperience(input.experienceId);
        }
        return getAllVariantsGrouped();
      }),

    createVariant: adminProcedure
      .input(z.object({
        experienceId: z.number(),
        name: z.string().min(1),
        description: z.string().optional(),
        priceModifier: z.string(),
        priceType: z.enum(["fixed", "percentage", "per_person"]),
        isRequired: z.boolean().default(false),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        return createVariant(input);
      }),

    updateVariant: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        priceModifier: z.string().optional(),
        priceType: z.enum(["fixed", "percentage", "per_person"]).optional(),
        isRequired: z.boolean().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateVariant(id, data as any);
      }),

    deleteVariant: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteVariant(input.id);
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
    createUser: adminProcedure.input(z.object({
      name: z.string().min(2),
      email: z.string().email(),
      role: z.enum(["user", "admin", "monitor", "agente"]),
      origin: z.string(),
    })).mutation(async ({ input }) => {
      const { nanoid } = await import("nanoid");
      const token = nanoid(48);
      const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
      const result = await createInvitedUser({
        name: input.name,
        email: input.email,
        role: input.role,
        inviteToken: token,
        inviteTokenExpiry: expiry,
      });
      // Send invite email
      const setPasswordUrl = `${input.origin}/establecer-contrasena?token=${token}`;
      await sendInviteEmail({ name: input.name, email: input.email, setPasswordUrl, role: input.role });
      return { ...result, token };
    }),
    changeUserRole: adminProcedure.input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin", "monitor", "agente"]),
    })).mutation(async ({ input }) => {
      return changeUserRole(input.userId, input.role);
    }),
    toggleUserActive: adminProcedure.input(z.object({
      userId: z.number(),
    })).mutation(async ({ input }) => {
      return toggleUserActive(input.userId);
    }),
    resendInvite: adminProcedure.input(z.object({
      userId: z.number(),
      email: z.string().email(),
      name: z.string(),
      origin: z.string(),
    })).mutation(async ({ input }) => {
      const { nanoid } = await import("nanoid");
      const token = nanoid(48);
      const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await resendUserInvite(input.userId, token, expiry);
      const setPasswordUrl = `${input.origin}/establecer-contrasena?token=${token}`;
      await sendInviteEmail({ name: input.name, email: input.email, setPasswordUrl, role: "user" });
      return { success: true };
    }),
    deleteUser: adminProcedure.input(z.object({
      userId: z.number(),
    })).mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes eliminarte a ti mismo" });
      return deleteUser(input.userId);
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
        variantId: z.number().optional(),
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
        const { getExperienceById, getVariantsByExperience } = await import("./db");
        const product = await getExperienceById(input.productId);
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
        if (!product.basePrice) throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto no tiene precio fijo" });

        // 2. Calcular el importe total en backend (nunca confiar en el frontend)
        const basePrice = parseFloat(String(product.basePrice));
        let pricePerPerson = basePrice;

        // Si se seleccionó una variante, usar su precio
        if (input.variantId) {
          const variants = await getVariantsByExperience(input.productId);
          const variant = variants.find(v => v.id === input.variantId);
          if (variant) {
            const mod = parseFloat(String(variant.priceModifier ?? 0));
            if (variant.priceType === "percentage") {
              pricePerPerson = basePrice + (basePrice * mod / 100);
            } else {
              // fixed o per_person: el valor es el precio directo
              pricePerPerson = mod;
            }
          }
        }

        let totalEuros = pricePerPerson * input.people;
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

  // ─── PACKS ───────────────────────────────────────────────────────────────────
  packs: router({
    /** Listado público por categoría */
    getByCategory: publicProcedure
      .input(z.object({ category: z.enum(["dia", "escolar", "empresa"]).optional() }))
      .query(async ({ input }) => getPublicPacks(input.category)),

    /** Detalle público por slug */
    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const pack = await getPackBySlug(input.slug);
        if (!pack) throw new TRPCError({ code: "NOT_FOUND" });
        const crossSells = await getPackCrossSells(pack.id);
        return { ...pack, crossSells };
      }),

    /** Listado admin */
    getAll: adminProcedure
      .input(z.object({ category: z.string().optional(), search: z.string().optional(), limit: z.number().default(50), offset: z.number().default(0) }))
      .query(async ({ input }) => getAllPacksAdmin(input)),

    /** Crear pack */
    create: adminProcedure
      .input(z.object({
        slug: z.string(),
        category: z.enum(["dia", "escolar", "empresa"]),
        title: z.string(),
        subtitle: z.string().optional(),
        shortDescription: z.string().optional(),
        description: z.string().optional(),
        includes: z.array(z.string()).default([]),
        excludes: z.array(z.string()).default([]),
        schedule: z.string().optional(),
        note: z.string().optional(),
        image1: z.string().optional(),
        image2: z.string().optional(),
        image3: z.string().optional(),
        image4: z.string().optional(),
        basePrice: z.string().default("0"),
        priceLabel: z.string().optional(),
        duration: z.string().optional(),
        minPersons: z.number().default(1),
        maxPersons: z.number().optional(),
        targetAudience: z.string().optional(),
        badge: z.string().optional(),
        hasStay: z.boolean().default(false),
        isOnlinePurchase: z.boolean().default(false),
        isFeatured: z.boolean().default(false),
        isActive: z.boolean().default(true),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => createPack(input as any)),

    /** Actualizar pack */
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        slug: z.string().optional(),
        category: z.enum(["dia", "escolar", "empresa"]).optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        shortDescription: z.string().optional(),
        description: z.string().optional(),
        includes: z.array(z.string()).optional(),
        excludes: z.array(z.string()).optional(),
        schedule: z.string().optional(),
        note: z.string().optional(),
        image1: z.string().optional(),
        image2: z.string().optional(),
        image3: z.string().optional(),
        image4: z.string().optional(),
        basePrice: z.string().optional(),
        priceLabel: z.string().optional(),
        duration: z.string().optional(),
        minPersons: z.number().optional(),
        maxPersons: z.number().optional(),
        targetAudience: z.string().optional(),
        badge: z.string().optional(),
        hasStay: z.boolean().optional(),
        isOnlinePurchase: z.boolean().optional(),
        isFeatured: z.boolean().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ input }) => { const { id, ...data } = input; return updatePack(id, data as any); }),

    /** Toggle activo/inactivo */
    toggle: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => togglePackActive(input.id)),

    /** Borrar definitivamente */
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => hardDeletePack(input.id)),

    /** Clonar */
    clone: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => clonePack(input.id)),
    /** Reordenar */
    reorder: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => reorderPacks(input.items)),
  }),
});
export type AppRouter = typeof appRouter;
