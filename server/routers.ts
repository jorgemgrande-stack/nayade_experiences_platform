import { COOKIE_NAME } from "@shared/const";
import {
  getActiveGalleryItems,
  getGalleryCategories,
  getAllGalleryItems,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  reorderGalleryItems,
} from "./galleryDb";
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
  getAllBookings,
  createBooking,
  updateBookingStatus,
  getAllTransactions,
  getDashboardMetrics,
  getDashboardOverview,
  getAllSlideshowItems,
  createSlideshowItem,
  updateSlideshowItem,
  deleteSlideshowItem,
  getAllMediaFiles,
  createMediaFile,
  deleteMediaFile,
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
  getAllPages,
  getPageBySlug,
  upsertPage,
  getPageBlocks,
  savePageBlocks,
} from "./db";
import {
  buildRedsysForm,
  validateRedsysNotification,
  generateMerchantOrder,
} from "./redsys";
import { sendInviteEmail } from "./inviteEmail";
import nodemailer from "nodemailer";
import {
  buildBudgetRequestUserHtml, buildBudgetRequestAdminHtml,
  buildReservationConfirmHtml, buildReservationFailedHtml,
  buildRestaurantConfirmHtml, buildRestaurantPaymentLinkHtml,
  buildPasswordResetHtml, buildQuoteHtml, buildConfirmationHtml,
  buildTransferConfirmationHtml,
} from "./emailTemplates";
import { getDb } from "./db";
import { siteSettings } from "../drizzle/schema";
import { hotelRouter } from "./routers/hotel";
import { spaRouter } from "./routers/spa";
import { reviewsRouter } from "./routers/reviews";
import { restaurantsRouter } from "./routers/restaurants";
import { crmRouter } from "./routers/crm";
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

    submitBudget: publicProcedure
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(6),
        arrivalDate: z.string(),
        adults: z.number().int().min(1).default(1),
        children: z.number().int().min(0).default(0),
        selectedCategory: z.string().min(1),
        selectedProduct: z.string().min(1),
        activitiesJson: z.array(z.object({
          experienceId: z.number(),
          experienceTitle: z.string(),
          family: z.string(),
          participants: z.number(),
          details: z.record(z.string(), z.union([z.string(), z.number()])),
        })).optional(),
        comments: z.string().optional(),
        honeypot: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Anti-spam: honeypot
        if (input.honeypot) return { success: true };

        const lead = await createLead({
          name: input.name,
          email: input.email,
          phone: input.phone,
          message: input.comments,
          preferredDate: input.arrivalDate,
          numberOfAdults: input.adults,
          numberOfChildren: input.children,
          numberOfPersons: input.adults + input.children,
          selectedCategory: input.selectedCategory,
          selectedProduct: input.selectedProduct,
          activitiesJson: input.activitiesJson ?? null,
          source: "landing_presupuesto",
        });

        // Enviar emails (try/catch independientes: si el email del usuario falla, el del admin sigue)
        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const smtpPort = parseInt(process.env.SMTP_PORT ?? "465", 10);
        const from = process.env.SMTP_FROM ?? `"Náyade Experiences" <${smtpUser}>`;

        if (smtpHost && smtpUser && smtpPass) {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: smtpUser, pass: smtpPass },
            tls: { rejectUnauthorized: false },
          });

          const emailData = {
            name: input.name,
            email: input.email,
            phone: input.phone,
            arrivalDate: new Date(input.arrivalDate).toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            adults: input.adults,
            children: input.children,
            selectedCategory: input.selectedCategory,
            selectedProduct: input.selectedProduct,
            comments: input.comments ?? "",
            submittedAt: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
            activitiesJson: input.activitiesJson ?? undefined,
          };

          // Email al usuario (independiente: si su email es inválido no bloquea el del admin)
          try {
            await transporter.sendMail({
              from,
              to: input.email,
              bcc: "reservas@nayadeexperiences.es",
              subject: "Solicitud de presupuesto recibida — Náyade Experiences",
              html: buildBudgetRequestUserHtml(emailData),
            });
          } catch (userEmailErr) {
            console.error("[submitBudget] Email al usuario fallido:", userEmailErr);
          }

          // Email al administrador (siempre intenta, independiente del email del usuario)
          try {
            const adminEmail = process.env.ADMIN_EMAIL ?? "reservas@nayadeexperiences.es";
            await transporter.sendMail({
              from,
              to: adminEmail,
              subject: `⚠️ Nueva solicitud — ${input.name} (${input.selectedCategory})`,
              html: buildBudgetRequestAdminHtml(emailData),
            });
          } catch (adminEmailErr) {
            console.error("[submitBudget] Email al admin fallido:", adminEmailErr);
          }
        }

        return { success: true, leadId: lead.id };
      }),

    getPublicPage: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const page = await getPageBySlug(input.slug);
        return page || null;
      }),

    getPublicPageBlocks: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        return getPageBlocks(input.slug);
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

    deleteMediaFile: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteMediaFile(input.id);
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

    // ── Pages ──────────────────────────────────────────────────────────────────────────────
    getPages: adminProcedure.query(async () => {
      return getAllPages();
    }),

    getPageBlocks: adminProcedure
      .input(z.object({ pageSlug: z.string() }))
      .query(async ({ input }) => {
        return getPageBlocks(input.pageSlug);
      }),

    savePageBlocks: adminProcedure
      .input(z.object({
        pageSlug: z.string(),
        blocks: z.array(z.object({
          id: z.number().optional(),
          blockType: z.string(),
          sortOrder: z.number(),
          data: z.record(z.string(), z.unknown()),
          isVisible: z.boolean().default(true),
        })),
      }))
      .mutation(async ({ input }) => {
        return savePageBlocks(input.pageSlug, input.blocks as any[]);
      }),

    upsertPage: adminProcedure
      .input(z.object({
        slug: z.string(),
        title: z.string(),
        isPublished: z.boolean(),
        metaTitle: z.string().optional(),
        metaDescription: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return upsertPage(input);
      }),

    // ── Site Settings ─────────────────────────────────────────────────────────
    getSiteSettings: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return {};
      const rows = await db.select().from(siteSettings);
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    }),
    updateSiteSettings: adminProcedure
      .input(z.object({ settings: z.record(z.string(), z.string().nullable()) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
        for (const [key, value] of Object.entries(input.settings)) {
          await db.insert(siteSettings)
            .values({ key, value: value ?? "", type: "text" })
            .onDuplicateKeyUpdate({ set: { value: value ?? "" } });
        }
        return { ok: true };
      }),
  }),

  // ─── PUBLIC: Page Blocks ──────────────────────────────────────────────────────────────────────────────

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

  // ─── ADMIN: BOOKINGS & CALENDAR───────────────────────────────────────────
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
    getOverview: adminProcedure.query(async () => {
      return getDashboardOverview();
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
      role: z.enum(["user", "admin", "monitor", "agente", "adminrest"]),
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
      role: z.enum(["user", "admin", "monitor", "agente", "adminrest"]),
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
    sendEmailPreview: adminProcedure.input(z.object({
      templateId: z.string(),
      to: z.string().email(),
    })).mutation(async ({ input }) => {
      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
      if (!smtpHost || !smtpUser || !smtpPass) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "SMTP no configurado" });
      const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false } });
      const from = process.env.SMTP_FROM || `"Náyade Experiences" <${smtpUser}>`;
      const TEMPLATES: Record<string, { subject: string; html: string }> = {
        "budget-user": {
          subject: "[PREVIEW] Solicitud de presupuesto recibida",
          html: buildBudgetRequestUserHtml({ name: "Carlos Pedraza", email: input.to, phone: "+34 600 000 000", arrivalDate: "23 de marzo de 2026", adults: 5, children: 2, selectedCategory: "Packs de Experiencias", selectedProduct: "Pack Cable Ski Experience", comments: "Queremos hacer el pack completo para una despedida de soltero", submittedAt: new Date().toLocaleString("es-ES"), activitiesJson: [] }),
        },
        "budget-admin": {
          subject: "[PREVIEW] Nueva solicitud de presupuesto — Admin",
          html: buildBudgetRequestAdminHtml({ name: "Carlos Pedraza", email: input.to, phone: "+34 600 000 000", arrivalDate: "23 de marzo de 2026", adults: 5, children: 2, selectedCategory: "Packs de Experiencias", selectedProduct: "Pack Cable Ski Experience", comments: "Queremos hacer el pack completo para una despedida de soltero", submittedAt: new Date().toLocaleString("es-ES"), activitiesJson: [] }),
        },
        "reservation-confirm": {
          subject: "[PREVIEW] Reserva Confirmada — Náyade Experiences",
          html: buildReservationConfirmHtml({ merchantOrder: "NE20260323001", productName: "Pack Cable Ski Experience", customerName: "Carlos Pedraza", date: "23 de marzo de 2026", people: 5, amount: "175,00 €", extras: "Alquiler de neopreno x5" }),
        },
        "reservation-failed": {
          subject: "[PREVIEW] Pago No Completado — Náyade Experiences",
          html: buildReservationFailedHtml({ merchantOrder: "NE20260323001", productName: "Pack Cable Ski Experience", customerName: "Carlos Pedraza", responseCode: "0190" }),
        },
        "restaurant-confirm": {
          subject: "[PREVIEW] Reserva en Restaurante — Náyade Experiences",
          html: buildRestaurantConfirmHtml({ guestName: "Carlos Pedraza", restaurantName: "Restaurante Náyade", date: "23 de marzo de 2026", time: "14:00", guests: 8, locator: "REST-2026-001", depositAmount: "80", requiresPayment: false }),
        },
        "restaurant-payment": {
          subject: "[PREVIEW] Confirma tu reserva de restaurante",
          html: buildRestaurantPaymentLinkHtml({ guestName: "Carlos Pedraza", guestEmail: input.to, restaurantName: "Restaurante Náyade", date: "23 de marzo de 2026", time: "14:00", guests: 8, locator: "REST-2026-001", depositAmount: "80", redsysUrl: "https://sis.redsys.es/sis/realizarPago", merchantParams: "BASE64PARAMS", signatureVersion: "HMAC_SHA256_V1", signature: "SIGNATURE" }),
        },
        "password-reset": {
          subject: "[PREVIEW] Recuperar contraseña — Náyade Experiences",
          html: buildPasswordResetHtml({ name: "Carlos Pedraza", resetUrl: "https://nayadeexperiences.es/reset?token=abc123", expiryMinutes: 30 }),
        },
        "quote": {
          subject: "[PREVIEW] Presupuesto PRE-2026-001 — Náyade Experiences",
          html: buildQuoteHtml({ quoteNumber: "PRE-2026-001", title: "Pack Cable Ski Experience + Restaurante", clientName: "Carlos Pedraza", items: [{ description: "Pack Cable Ski Experience (5 pax)", quantity: 5, unitPrice: 35, total: 175 }, { description: "Menú Náyade (8 pax)", quantity: 8, unitPrice: 28, total: 224 }], subtotal: "399", discount: "0", tax: "83.79", total: "482.79", validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), notes: "Precio especial por grupo. Incluye alquiler de neopreno.", conditions: "Reserva sujeta a disponibilidad. Cancelación gratuita hasta 48h antes.", paymentLinkUrl: "https://nayadeexperiences.es/pago/PRE-2026-001" }),
        },
        "confirmation": {
          subject: "[PREVIEW] Reserva Confirmada FAC-2026-001 — Náyade Experiences",
          html: buildConfirmationHtml({ clientName: "Carlos Pedraza", reservationRef: "FAC-2026-001", quoteNumber: "PRE-2026-001", quoteTitle: "Pack Cable Ski Experience + Restaurante", items: [{ description: "Pack Cable Ski Experience (5 pax)", quantity: 5, unitPrice: 35, total: 175 }, { description: "Menú Náyade (8 pax)", quantity: 8, unitPrice: 28, total: 224 }], subtotal: "399", taxAmount: "83.79", total: "482.79", invoiceUrl: "https://cdn.nayadeexperiences.es/facturas/FAC-2026-001.pdf", bookingDate: "23 de marzo de 2026" }),
        },
        "transfer-confirm": {
          subject: "[PREVIEW] Pago por transferencia confirmado — Náyade Experiences",
          html: buildTransferConfirmationHtml({ clientName: "Carlos Pedraza", invoiceNumber: "FAC-2026-001", reservationRef: "RES-2026-001", quoteTitle: "Pack Cable Ski Experience + Restaurante", quoteNumber: "PRE-2026-001", items: [{ description: "Pack Cable Ski Experience (5 pax)", quantity: 5, unitPrice: 35, total: 175 }, { description: "Menú Náyade (8 pax)", quantity: 8, unitPrice: 28, total: 224 }], subtotal: "399", taxAmount: "83.79", total: "482.79", invoiceUrl: "https://cdn.nayadeexperiences.es/facturas/FAC-2026-001.pdf", confirmedBy: "Admin Náyade", confirmedAt: new Date() }),
        },
      };
      const tpl = TEMPLATES[input.templateId];
      if (!tpl) throw new TRPCError({ code: "BAD_REQUEST", message: `Plantilla desconocida: ${input.templateId}` });
      await transporter.sendMail({ from, to: input.to, subject: tpl.subject, html: tpl.html });
      return { success: true, templateId: input.templateId, to: input.to };
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
          amountPaid: reservation.amountPaid ?? null,
          customerName: reservation.customerName,
          customerEmail: reservation.customerEmail,
          quoteSource: reservation.quoteSource ?? null,
          notes: reservation.notes ?? null,
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
    /**
     * Checkout multi-artículo del carrito.
     * Crea una reserva por cada artículo con el mismo merchantOrder de grupo.
     * Devuelve el formulario Redsys para el pago unificado.
     */
    cartCheckout: publicProcedure
      .input(z.object({
        items: z.array(z.object({
          productId: z.number(),
          bookingDate: z.string(),
          people: z.number().min(1).max(100),
          variantId: z.number().optional(),
          extras: z.array(z.object({
            name: z.string(),
            price: z.number(),
            quantity: z.number(),
          })).default([]),
        })).min(1).max(20),
        customerName: z.string().min(2),
        customerEmail: z.string().email(),
        customerPhone: z.string().optional(),
        origin: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        const { getExperienceById: getExpById, getVariantsByExperience: getVariants } = await import("./db");
        // 1. Calcular el importe total de todos los artículos en backend
        let totalAmountCents = 0;
        const itemsWithPrices: Array<{
          productId: number;
          productName: string;
          bookingDate: string;
          people: number;
          extrasJson: string;
          amountTotal: number;
        }> = [];
        const productNames: string[] = [];
        for (const item of input.items) {
          const product = await getExpById(item.productId);
          if (!product) throw new TRPCError({ code: "NOT_FOUND", message: `Producto ${item.productId} no encontrado` });
          if (!product.basePrice) throw new TRPCError({ code: "BAD_REQUEST", message: `El producto ${product.title} no tiene precio fijo` });
          const basePrice = parseFloat(String(product.basePrice));
          let pricePerPerson = basePrice;
          if (item.variantId) {
            const variants = await getVariants(item.productId);
            const variant = variants.find(v => v.id === item.variantId);
            if (variant) {
              const mod = parseFloat(String(variant.priceModifier ?? 0));
              pricePerPerson = variant.priceType === "percentage"
                ? basePrice + (basePrice * mod / 100)
                : mod;
            }
          }
          const extrasTotal = item.extras.reduce((s, e) => s + e.price * e.quantity, 0);
          const itemTotalEuros = pricePerPerson * item.people + extrasTotal;
          const itemAmountCents = Math.round(itemTotalEuros * 100);
          totalAmountCents += itemAmountCents;
          itemsWithPrices.push({
            productId: item.productId,
            productName: product.title,
            bookingDate: item.bookingDate,
            people: item.people,
            extrasJson: JSON.stringify(item.extras),
            amountTotal: itemAmountCents,
          });
          productNames.push(product.title);
        }
        // 2. Generar un merchantOrder único para todo el carrito
        const merchantOrder = generateMerchantOrder();
        // 3. Crear una reserva por cada artículo, todas con el mismo merchantOrder
        for (const item of itemsWithPrices) {
          await createReservation({
            ...item,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            merchantOrder,
            notes: `Carrito: ${productNames.join(", ")}`,
          });
        }
        // 4. Construir el formulario Redsys con el importe total
        const description = productNames.length === 1
          ? productNames[0]
          : `${productNames.length} experiencias — Náyade`;
        const redsysForm = buildRedsysForm({
          amount: totalAmountCents,
          merchantOrder,
          productDescription: description.slice(0, 125),
          notifyUrl: `${input.origin}/api/redsys/notification`,
          okUrl: `${input.origin}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${input.origin}/reserva/error?order=${merchantOrder}`,
          holderName: input.customerName,
        });
        return {
          merchantOrder,
          totalAmountCents,
          totalAmountEuros: totalAmountCents / 100,
          itemCount: input.items.length,
          redsysForm,
        };
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
  hotel: hotelRouter,
  spa: spaRouter,
  reviews: reviewsRouter,
  restaurants: restaurantsRouter,
  crm: crmRouter,
  gallery: router({
    /** Público: obtener fotos activas */
    getItems: publicProcedure
      .input(z.object({ category: z.string().optional() }))
      .query(async ({ input }) => {
        const items = await getActiveGalleryItems();
        if (input.category && input.category !== "Todas") {
          return items.filter((i) => i.category === input.category);
        }
        return items;
      }),
    /** Público: obtener categorías únicas */
    getCategories: publicProcedure.query(async () => getGalleryCategories()),
    /** Admin: obtener todas las fotos */
    adminGetAll: adminProcedure.query(async () => getAllGalleryItems()),
    /** Admin: crear foto */
    adminCreate: adminProcedure
      .input(z.object({
        imageUrl: z.string().url(),
        fileKey: z.string(),
        title: z.string().optional(),
        category: z.string().default("General"),
        isActive: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => createGalleryItem(input)),
    /** Admin: actualizar foto */
    adminUpdate: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        category: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateGalleryItem(id, data);
      }),
    /** Admin: eliminar foto */
    adminDelete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteGalleryItem(input.id);
        return { success: true };
      }),
    /** Admin: reordenar fotos */
    adminReorder: adminProcedure
      .input(z.object({ orderedIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        await reorderGalleryItems(input.orderedIds);
        return { success: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
