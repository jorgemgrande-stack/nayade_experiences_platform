import { COOKIE_NAME } from "@shared/const";
import JSZip from "jszip";
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
import { publicProcedure, protectedProcedure, staffProcedure, router, permissionProcedure } from "./_core/trpc";
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
  getTransactionsCount,
  getTransactionById,
  deleteTransaction,
  getAccountingReports,
  getTpvReservationsToday,
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
  createReavExpedient,
  attachReavDocument,
  listReavExpedients,
  getReavExpedientById,
  updateReavExpedient,
  recalculateReavMargins,
  addReavDocument,
  deleteReavDocument,
  addReavCost,
  updateReavCost,
  deleteReavCost,
  deleteReavExpedient,
} from "./db";
import {
  buildRedsysForm,
  validateRedsysNotification,
  generateMerchantOrder,
} from "./redsys";
import { sendInviteEmail } from "./inviteEmail";
import { testGHLConnection } from "./ghl";
import { sendEmail } from "./mailer";
import {
  buildBudgetRequestUserHtml, buildBudgetRequestAdminHtml,
  buildReservationConfirmHtml, buildReservationFailedHtml,
  buildRestaurantConfirmHtml, buildRestaurantPaymentLinkHtml,
  buildPasswordResetHtml, buildQuoteHtml, buildConfirmationHtml,
  buildTransferConfirmationHtml,
} from "./emailTemplates";
import { getDb } from "./db";
import { siteSettings, systemSettings, packs, legoPacks as legoPacksTable, reservations as reservationsSchema, reservationOperational as reservationOperationalSchema, discountCodes } from "../drizzle/schema";

// ─── Pricing helper (per_person | per_unit) ───────────────────────────────────
/**
 * Calcula el importe en EUROS dado el precio base, el tipo de tarificación y el
 * número de personas. Devuelve también el nº de unidades realmente reservadas.
 */
function calcPricing(
  priceUnit: number,          // precio base por persona o por unidad
  people: number,
  pricingType: "per_person" | "per_unit",
  unitCapacity: number | null | undefined,
  maxUnits: number | null | undefined,
): { totalEuros: number; unitsBooked: number } {
  if (pricingType === "per_unit" && unitCapacity && unitCapacity > 0) {
    let units = Math.ceil(people / unitCapacity);
    if (maxUnits && units > maxUnits) units = maxUnits;
    return { totalEuros: units * priceUnit, unitsBooked: units };
  }
  // per_person (default, retrocompatible)
  return { totalEuros: priceUnit * people, unitsBooked: 0 };
}
import { eq, and, desc, inArray, sql as sqlDrizzle } from "drizzle-orm";
import { hotelRouter } from "./routers/hotel";
import { spaRouter } from "./routers/spa";
import { reviewsRouter } from "./routers/reviews";
import { restaurantsRouter } from "./routers/restaurants";
import { crmRouter } from "./routers/crm";
import { suppliersRouter, settlementsRouter } from "./routers/suppliers";
import { timeSlotsRouter } from "./routers/timeSlots";
import { tpvRouter } from "./routers/tpv";
import { discountsRouter } from "./routers/discounts";
import { legoPacksRouter, calculateLegoPackPrice } from "./routers/legoPacks";
import { expensesModuleRouter } from "./routers/expenses";
import { ticketingRouter } from "./routers/ticketing";
import { cancellationsRouter } from "./routers/cancellations";
import { emailTemplatesRouter } from "./routers/emailTemplatesRouter";
import { pdfTemplatesRouter } from "./routers/pdfTemplatesRouter";
import { operationsRouter } from "./routers/operations";
import { bankMovementsRouter } from "./routers/bankMovements";
import { cashRegisterRouter } from "./routers/cashRegister";
import { getBusinessEmail } from "./config";
import { cardTerminalOperationsRouter } from "./routers/cardTerminalOperations";
import { cardTerminalBatchesRouter } from "./routers/cardTerminalBatches";
import { emailIngestionRouter } from "./routers/emailIngestion";
import { configRouter } from "./routers/configRouter";
import { onboardingRouter } from "./routers/onboardingRouter";
import { dailyControlRouter } from "./routers/dailyControl";
import { proposalsRouter } from "./routers/proposals";
import { commercialFollowupRouter } from "./routers/commercialFollowup";
import { ghlInboxRouter } from "./routers/ghlInbox";
import { vapiCallsRouter } from "./routers/vapiCalls";
import { emailAccountsRouter } from "./routers/emailAccounts";
import { emailInboxRouter } from "./routers/emailInbox";
import { getAllCounters, updateCounterPrefix, resetCounter, getDocumentNumberLogs } from "./documentNumbers";
import type { DocumentType } from "./documentNumbers";
const adminProcedure = permissionProcedure("settings.manage", ["admin"]);


export const appRouter = router({
  system: systemRouter,
  financial: expensesModuleRouter,
  bankMovements: bankMovementsRouter,
  cashRegister: cashRegisterRouter,
  cardTerminalOperations: cardTerminalOperationsRouter,
  cardTerminalBatches: cardTerminalBatchesRouter,
  dailyControl: dailyControlRouter,
  emailIngestion: emailIngestionRouter,
  config: configRouter,
  onboarding: onboardingRouter,
  cancellations: cancellationsRouter,
  proposals: proposalsRouter,
  emailTemplates: emailTemplatesRouter,
  operations: operationsRouter,
  pdfTemplates: pdfTemplatesRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    myPermissions: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { getUserPermissions } = await import("./_core/rbac");
        return await getUserPermissions(ctx.user.id, ctx.user.role as string);
      } catch {
        return [] as string[];
      }
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
        selectedCategory: z.string().optional(),
        selectedProduct: z.string().optional(),
        source: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createLead({
          ...input,
          source: input.source ?? "web_experiencia",
        });
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

        // Enviar emails (fire-and-forget: no bloquea la respuesta al cliente)
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

        // Email al usuario
        sendEmail({
          to: input.email,
          subject: "Solicitud de presupuesto recibida — Náyade Experiences",
          html: buildBudgetRequestUserHtml(emailData),
        }).catch(err => console.error("[submitBudget] Email al usuario fallido:", err));

        // Email al administrador
        const adminEmail = process.env.ADMIN_EMAIL ?? await getBusinessEmail('reservations');
        sendEmail({
          to: adminEmail,
          subject: `⚠️ Nueva solicitud — ${input.name} (${input.selectedCategory})`,
          html: buildBudgetRequestAdminHtml(emailData),
        }).catch(err => console.error("[submitBudget] Email al admin fallido:", err));

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
        imageUrl: z.string().min(1),
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
        imageUrl: z.string().min(1).optional(),
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

    // ── Site Settings — lee y escribe en system_settings (fuente de verdad única) ──
    getSiteSettings: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return {};
      // Reverse map: clave de system_settings → clave camelCase que espera Settings.tsx
      const REV: Record<string, string> = {
        brand_name:                      "businessName",
        brand_phone:                     "businessPhone",
        site_business_email:             "businessEmail",
        brand_location:                  "businessAddress",
        brand_website_url:               "businessWebsite",
        site_business_description:       "businessDescription",
        site_schedule_high_open:         "scheduleHighOpen",
        site_schedule_high_close:        "scheduleHighClose",
        site_schedule_low_open:          "scheduleLowOpen",
        site_schedule_low_close:         "scheduleLowClose",
        site_schedule_days:              "scheduleDays",
        tax_rate_general:                "paymentVat",
        site_payment_currency:           "paymentCurrency",
        quote_validity_days:             "paymentQuoteValidity",
        site_payment_deposit_restaurant: "paymentDepositRestaurant",
        site_legal_name:                 "legalCompanyName",
        brand_nif:                       "legalCompanyCif",
        site_legal_phone:                "legalCompanyPhone",
        brand_address:                   "legalCompanyAddress",
        site_legal_zip:                  "legalCompanyZip",
        site_legal_city:                 "legalCompanyCity",
        site_legal_province:             "legalCompanyProvince",
        site_legal_email:                "legalCompanyEmail",
        site_legal_iban:                 "legalCompanyIban",
        email_reservations:              "notifEmailBooking",
        site_notif_email_restaurant:     "notifEmailRestaurant",
        site_ghl_api_key:                "ghlApiKey",
        site_ghl_location_id:            "ghlLocationId",
      };
      const rows = await db
        .select({ key: systemSettings.key, value: systemSettings.value, isSensitive: systemSettings.isSensitive })
        .from(systemSettings);
      const out: Record<string, string | null> = {};
      for (const row of rows) {
        const camelKey = REV[row.key];
        if (camelKey) out[camelKey] = row.isSensitive ? null : (row.value ?? "");
      }
      return out;
    }),
    updateSiteSettings: adminProcedure
      .input(z.object({ settings: z.record(z.string(), z.string().nullable()) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
        const KEY_MAP: Record<string, string> = {
          businessName:             "brand_name",
          businessPhone:            "brand_phone",
          businessEmail:            "site_business_email",
          businessAddress:          "brand_location",
          businessWebsite:          "brand_website_url",
          businessDescription:      "site_business_description",
          scheduleHighOpen:         "site_schedule_high_open",
          scheduleHighClose:        "site_schedule_high_close",
          scheduleLowOpen:          "site_schedule_low_open",
          scheduleLowClose:         "site_schedule_low_close",
          scheduleDays:             "site_schedule_days",
          paymentVat:               "tax_rate_general",
          paymentCurrency:          "site_payment_currency",
          paymentQuoteValidity:     "quote_validity_days",
          paymentDepositRestaurant: "site_payment_deposit_restaurant",
          legalCompanyName:         "site_legal_name",
          legalCompanyCif:          "brand_nif",
          legalCompanyPhone:        "site_legal_phone",
          legalCompanyAddress:      "brand_address",
          legalCompanyZip:          "site_legal_zip",
          legalCompanyCity:         "site_legal_city",
          legalCompanyProvince:     "site_legal_province",
          legalCompanyEmail:        "site_legal_email",
          legalCompanyIban:         "site_legal_iban",
          notifEmailBooking:        "email_reservations",
          notifEmailRestaurant:     "site_notif_email_restaurant",
          ghlApiKey:                "site_ghl_api_key",
          ghlLocationId:            "site_ghl_location_id",
        };
        for (const [camelKey, value] of Object.entries(input.settings)) {
          const sysKey = KEY_MAP[camelKey] ?? camelKey;
          await db.update(systemSettings)
            .set({ value: value ?? "" })
            .where(eq(systemSettings.key, sysKey));
        }
        return { ok: true };
      }),

    testGHLConnection: adminProcedure
      .input(z.object({ apiKey: z.string(), locationId: z.string() }))
      .mutation(async ({ input }) => {
        return testGHLConnection(input.apiKey, input.locationId);
      }),

    getGHLStatus: adminProcedure.query(async () => {
      const db = await getDb();
      const envKey = process.env.GHL_API_KEY;
      const envLoc = process.env.GHL_LOCATION_ID;
      let dbKey = "";
      let dbLoc = "";
      if (db) {
        const rows = await db
          .select({ key: systemSettings.key, value: systemSettings.value })
          .from(systemSettings)
          .where(sqlDrizzle`${systemSettings.key} IN ('site_ghl_api_key','site_ghl_location_id')`);
        const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
        dbKey = map.site_ghl_api_key ?? "";
        dbLoc = map.site_ghl_location_id ?? "";
      }
      return {
        configured: !!(envKey || dbKey) && !!(envLoc || dbLoc),
        fromEnv: !!(envKey && envLoc),
        apiKeySet: !!(envKey || dbKey),
        locationIdSet: !!(envLoc || dbLoc),
        // Return masked values for display (never return plain key)
        apiKeyMasked: (envKey || dbKey) ? "••••••••" + (envKey || dbKey).slice(-4) : "",
        locationId: envLoc || dbLoc || "",
      };
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
        isPublished: z.boolean().default(true),
        isPresentialSale: z.boolean().default(false),
        supplierId: z.number().optional(),
        supplierCommissionPercent: z.string().optional(),
        supplierCostType: z.string().optional(),
        settlementFrequency: z.string().optional(),
        isSettlable: z.boolean().optional(),
        hasTimeSlots: z.boolean().optional(),
        fiscalRegime: z.enum(["general", "reav", "general_21", "mixed"]).default("general"),
        productType: z.string().optional(),
        providerPercent: z.string().optional(),
        agencyMarginPercent: z.string().optional(),
        includes: z.array(z.string()).optional(),
        excludes: z.array(z.string()).optional(),
        discountPercent: z.string().optional(),
        discountExpiresAt: z.string().optional(),
        pricingType: z.enum(["per_person", "per_unit"]).default("per_person"),
        unitCapacity: z.number().optional(),
        maxUnits: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        // Coerce legacy "general_21" → "general" (DB enum migration)
        const fiscalRegime = (input.fiscalRegime === "general_21" ? "general" : input.fiscalRegime) as "reav" | "general" | "mixed";
        const processedData: Record<string, unknown> = {
          ...input,
          fiscalRegime,
          coverImageUrl: input.image1 ?? undefined,
        };
        if (processedData.discountExpiresAt && typeof processedData.discountExpiresAt === "string") {
          processedData.discountExpiresAt = new Date(processedData.discountExpiresAt as string);
        }
        if (processedData.discountPercent === "") processedData.discountPercent = null;
        if (processedData.providerPercent && processedData.providerPercent !== "") {
          processedData.providerPercent = parseFloat(processedData.providerPercent as string);
        }
        if (processedData.agencyMarginPercent && processedData.agencyMarginPercent !== "") {
          processedData.agencyMarginPercent = parseFloat(processedData.agencyMarginPercent as string);
        }
        return createExperience(processedData as any);
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        slug: z.string().optional(),
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
        minPersons: z.number().optional(),
        maxPersons: z.number().optional(),
        includes: z.array(z.string()).optional(),
        excludes: z.array(z.string()).optional(),
        discountPercent: z.string().optional(),
        discountExpiresAt: z.string().optional(),
        fiscalRegime: z.enum(["general", "reav", "general_21", "mixed"]).optional(),
        productType: z.string().optional(),
        providerPercent: z.string().optional(),
        agencyMarginPercent: z.string().optional(),
        supplierId: z.number().optional(),
        supplierCommissionPercent: z.string().optional(),
        supplierCostType: z.string().optional(),
        settlementFrequency: z.string().optional(),
        isSettlable: z.boolean().optional(),
        isPresentialSale: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        hasTimeSlots: z.boolean().optional(),
        pricingType: z.enum(["per_person", "per_unit"]).optional(),
        unitCapacity: z.number().optional(),
        maxUnits: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        // Sync coverImageUrl with image1
        if (data.image1 !== undefined) (data as Record<string, unknown>).coverImageUrl = data.image1;
        // Coerce legacy "general_21" → "general" (DB enum migration)
        if ((data as Record<string, unknown>).fiscalRegime === "general_21") {
          (data as Record<string, unknown>).fiscalRegime = "general";
        }
        // Convert discountExpiresAt string to Date for Drizzle timestamp column
        const processedData: Record<string, unknown> = { ...data };
        if (processedData.discountExpiresAt && typeof processedData.discountExpiresAt === "string") {
          processedData.discountExpiresAt = processedData.discountExpiresAt
            ? new Date(processedData.discountExpiresAt as string)
            : null;
        }
        // Convert discountPercent string to number for Drizzle decimal column
        if (processedData.discountPercent !== undefined && processedData.discountPercent !== null && processedData.discountPercent !== "") {
          processedData.discountPercent = parseFloat(processedData.discountPercent as string);
        } else if (processedData.discountPercent === "") {
          processedData.discountPercent = null;
        }
        // Convert providerPercent and agencyMarginPercent to numbers
        if (processedData.providerPercent !== undefined && processedData.providerPercent !== "") {
          processedData.providerPercent = parseFloat(processedData.providerPercent as string);
        } else if (processedData.providerPercent === "") {
          processedData.providerPercent = null;
        }
        if (processedData.agencyMarginPercent !== undefined && processedData.agencyMarginPercent !== "") {
          processedData.agencyMarginPercent = parseFloat(processedData.agencyMarginPercent as string);
        } else if (processedData.agencyMarginPercent === "") {
          processedData.agencyMarginPercent = null;
        }
        return updateExperience(id, processedData);
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
    // Migrado: ahora devuelve reservations + reservation_operational en lugar de la tabla bookings legacy
    getAll: staffProcedure
      .input(z.object({
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        // Map legacy status filter to reservations status
        let statusWhere: any = undefined;
        if (input.status && input.status !== "all") {
          const legacyMap: Record<string, string[]> = {
            pendiente: ["pending_payment"],
            confirmado: ["paid"],
            completado: ["paid"],
            cancelado: ["cancelled"],
          };
          const mapped = legacyMap[input.status];
          if (mapped) statusWhere = inArray(reservationsSchema.status, mapped as any[]);
        }
        const rows = await db.select({
          id: reservationsSchema.id,
          bookingNumber: reservationsSchema.merchantOrder,
          clientName: reservationsSchema.customerName,
          clientEmail: reservationsSchema.customerEmail,
          scheduledDate: reservationsSchema.bookingDate,
          numberOfPersons: reservationsSchema.people,
          totalAmount: reservationsSchema.amountTotal,
          status: reservationsSchema.status,
          experienceId: reservationsSchema.productId,
          reservationId: reservationsSchema.id,
          sourceChannel: reservationsSchema.paymentMethod,
          opStatus: reservationOperationalSchema.opStatus,
        })
          .from(reservationsSchema)
          .leftJoin(reservationOperationalSchema, and(
            eq(reservationOperationalSchema.reservationId, reservationsSchema.id),
            eq(reservationOperationalSchema.reservationType, "activity")
          ))
          .where(statusWhere ?? sqlDrizzle`1=1`)
          .orderBy(desc(reservationsSchema.bookingDate))
          .limit(input.limit)
          .offset(input.offset);
        // Map to legacy shape expected by BookingsList.tsx
        return rows.map(r => ({
          id: r.id,
          bookingNumber: r.bookingNumber ?? `RES-${r.id}`,
          clientName: r.clientName,
          clientEmail: r.clientEmail,
          scheduledDate: r.scheduledDate ? new Date(`${r.scheduledDate}T10:00:00Z`) : new Date(),
          numberOfPersons: r.numberOfPersons,
          totalAmount: r.totalAmount ? (r.totalAmount / 100).toFixed(2) : "0.00",
          status: r.opStatus ?? (r.status === "paid" ? "confirmado" : r.status === "pending_payment" ? "pendiente" : "cancelado"),
          experienceId: r.experienceId ?? 0,
          reservationId: r.reservationId,
          sourceChannel: r.sourceChannel ?? "otro",
        }));
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
        saleChannel: z.string().optional(),
        fiscalRegime: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }))
      .query(async ({ input }) => {
        return getAllTransactions(input);
      }),

    getTransactionsCount: adminProcedure
      .input(z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        saleChannel: z.string().optional(),
        fiscalRegime: z.string().optional(),
        search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return getTransactionsCount(input);
      }),

    getReports: adminProcedure
      .input(z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return getAccountingReports(input);
      }),

    getTpvReservationsToday: adminProcedure.query(async () => {
      return getTpvReservationsToday();
    }),

    getDashboardMetrics: adminProcedure.query(async () => {
      return getDashboardMetrics();
    }),
    getOverview: adminProcedure.query(async () => {
      return getDashboardOverview();
    }),

    getTransactionById: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        return getTransactionById(input.id);
      }),

    deleteTransaction: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteTransaction(input.id);
        return { ok: true };
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
      role: z.enum(["user", "admin", "monitor", "agente", "adminrest", "controler"]),
      origin: z.string(),
      rbacRoleKeys: z.array(z.string().min(1).max(64)).optional(),
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
      // Assign RBAC roles — fail-safe: never breaks legacy user creation.
      // If rbacRoleKeys not provided, fall back to the legacy role key (keys match 1:1).
      const rbacKeysToAssign = input.rbacRoleKeys?.length
        ? input.rbacRoleKeys
        : [input.role];
      if (result.id) {
        const db = await getDb();
        if (db) {
          const { sql } = await import("drizzle-orm");
          for (const roleKey of rbacKeysToAssign) {
            try {
              const roleResult = await db.execute(sql`SELECT id FROM rbac_roles WHERE \`key\` = ${roleKey} AND is_active = 1`);
              const roleRow = (roleResult as any[][])[0]?.[0] as { id: number } | undefined;
              if (roleRow) {
                await db.execute(sql`INSERT IGNORE INTO rbac_user_roles (user_id, role_id) VALUES (${result.id}, ${roleRow.id})`);
              } else {
                console.warn(`[createUser] RBAC role not found or inactive: "${roleKey}"`);
              }
            } catch (rbacErr) {
              console.warn(`[createUser] Failed to assign RBAC role "${roleKey}" to user ${result.id}:`, rbacErr);
            }
          }
        }
      }
      return { ...result, token };
    }),
    changeUserRole: adminProcedure.input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin", "monitor", "agente", "adminrest", "controler"]),
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
      role: z.string().optional(),
      origin: z.string(),
    })).mutation(async ({ input }) => {
      const { nanoid } = await import("nanoid");
      const token = nanoid(48);
      const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await resendUserInvite(input.userId, token, expiry);
      const setPasswordUrl = `${input.origin}/establecer-contrasena?token=${token}`;
      await sendInviteEmail({ name: input.name, email: input.email, setPasswordUrl, role: input.role ?? "user" });
      return { success: true };
    }),
    setUserPassword: adminProcedure.input(z.object({
      userId: z.number(),
      password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    })).mutation(async ({ input }) => {
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(input.password, 12);
      await setUserPassword(input.userId, passwordHash);
      return { success: true };
    }),
    deleteUser: adminProcedure.input(z.object({
      userId: z.number(),
    })).mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes eliminarte a ti mismo" });
      return deleteUser(input.userId);
    }),
    // ─── RBAC Phase 3: user role assignments ─────────────────────────────────
    getRbacUsersData: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return {} as Record<number, { roles: Array<{ key: string; name: string; isLegacy: boolean }>; permissions: string[] }>;
      try {
        const { sql } = await import("drizzle-orm");
        const result = await db.execute(sql`
          SELECT
            ur.user_id,
            rr.\`key\`       AS role_key,
            rr.name         AS role_name,
            rr.is_legacy    AS role_is_legacy,
            rr.sort_order   AS role_sort_order,
            p.\`key\`        AS permission_key
          FROM rbac_user_roles ur
          JOIN rbac_roles rr ON rr.id = ur.role_id
          LEFT JOIN rbac_role_permissions rrp ON rrp.role_id = rr.id
          LEFT JOIN rbac_permissions p ON p.id = rrp.permission_id
          WHERE rr.is_active = 1
          ORDER BY ur.user_id, rr.sort_order, p.\`key\`
        `);
        const rows = (result as any[][])[0] as Array<{
          user_id: number;
          role_key: string;
          role_name: string;
          role_is_legacy: number;
          permission_key: string | null;
        }>;
        const map: Record<number, { roles: Array<{ key: string; name: string; isLegacy: boolean }>; permissions: string[] }> = {};
        for (const row of rows) {
          const uid = Number(row.user_id);
          if (!map[uid]) map[uid] = { roles: [], permissions: [] };
          if (!map[uid].roles.find(r => r.key === row.role_key)) {
            map[uid].roles.push({ key: row.role_key, name: row.role_name, isLegacy: Boolean(row.role_is_legacy) });
          }
          if (row.permission_key && !map[uid].permissions.includes(row.permission_key)) {
            map[uid].permissions.push(row.permission_key);
          }
        }
        return map;
      } catch {
        return {};
      }
    }),
    assignRbacRole: adminProcedure.input(z.object({
      userId: z.number(),
      roleKey: z.string().min(1).max(64),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB no disponible" });
      const { sql } = await import("drizzle-orm");
      const roleResult = await db.execute(sql`SELECT id FROM rbac_roles WHERE \`key\` = ${input.roleKey} AND is_active = 1`);
      const roleRow = (roleResult as any[][])[0]?.[0] as { id: number } | undefined;
      if (!roleRow) throw new TRPCError({ code: "NOT_FOUND", message: "Rol RBAC no encontrado" });
      await db.execute(sql`INSERT IGNORE INTO rbac_user_roles (user_id, role_id) VALUES (${input.userId}, ${roleRow.id})`);
      return { success: true };
    }),
    removeRbacRole: adminProcedure.input(z.object({
      userId: z.number(),
      roleKey: z.string().min(1).max(64),
    })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB no disponible" });
      const { sql } = await import("drizzle-orm");
      if (input.roleKey === 'admin') {
        // Guard 1: can't remove last RBAC admin globally
        const cntResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM rbac_user_roles ur
          JOIN rbac_roles rr ON rr.id = ur.role_id
          WHERE rr.\`key\` = 'admin'
        `);
        const count = Number((cntResult as any[][])[0]?.[0]?.cnt ?? 0);
        if (count <= 1) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No puedes eliminar el rol admin del único administrador RBAC. Asigna primero otro administrador." });
        }
        // Guard 2: can't self-demote from admin if no other admin would remain
        if (input.userId === ctx.user.id) {
          const otherAdminResult = await db.execute(sql`
            SELECT COUNT(*) AS cnt FROM rbac_user_roles ur
            JOIN rbac_roles rr ON rr.id = ur.role_id
            WHERE rr.\`key\` = 'admin' AND ur.user_id != ${ctx.user.id}
          `);
          const otherAdminCount = Number((otherAdminResult as any[][])[0]?.[0]?.cnt ?? 0);
          if (otherAdminCount === 0) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No puedes quitarte el rol admin si no hay otro administrador RBAC asignado." });
          }
        }
      }
      const roleResult = await db.execute(sql`SELECT id FROM rbac_roles WHERE \`key\` = ${input.roleKey}`);
      const roleRow = (roleResult as any[][])[0]?.[0] as { id: number } | undefined;
      if (!roleRow) throw new TRPCError({ code: "NOT_FOUND", message: "Rol RBAC no encontrado" });
      await db.execute(sql`DELETE FROM rbac_user_roles WHERE user_id = ${input.userId} AND role_id = ${roleRow.id}`);
      return { success: true };
    }),
    getRbacRolePermissions: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return {} as Record<string, string[]>;
      try {
        const { sql } = await import("drizzle-orm");
        const result = await db.execute(sql`
          SELECT rr.\`key\` AS role_key, p.\`key\` AS permission_key
          FROM rbac_role_permissions rrp
          JOIN rbac_roles rr ON rr.id = rrp.role_id
          JOIN rbac_permissions p ON p.id = rrp.permission_id
          WHERE rr.is_active = 1
          ORDER BY rr.sort_order, p.\`key\`
        `);
        const rows = (result as any[][])[0] as Array<{ role_key: string; permission_key: string }>;
        const map: Record<string, string[]> = {};
        for (const row of rows) {
          if (!map[row.role_key]) map[row.role_key] = [];
          map[row.role_key].push(row.permission_key);
        }
        return map;
      } catch {
        return {} as Record<string, string[]>;
      }
    }),
    sendEmailPreview: adminProcedure.input(z.object({
      templateId: z.string(),
      to: z.string().email(),
    })).mutation(async ({ input }) => {
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
      const sent = await sendEmail({ to: input.to, subject: tpl.subject, html: tpl.html });
      if (!sent) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al enviar email" });
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
        // Time slots (optional, retrocompatible)
        selectedTimeSlotId: z.number().int().optional().nullable(),
        selectedTime: z.string().max(10).optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        // 1. Obtener el producto y validar que existe y tiene precio
        const { getExperienceById, getVariantsByExperience } = await import("./db");
        const product = await getExperienceById(input.productId);
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Producto no encontrado" });
        if (!product.basePrice) throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto no tiene precio fijo" });

        // 1b. Validar time slot si el producto lo requiere
        if ((product as any).hasTimeSlots && !input.selectedTimeSlotId && !input.selectedTime) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto requiere seleccionar un horario" });
        }

        // 2. Calcular el importe total en backend (nunca confiar en el frontend)
        const basePrice = parseFloat(String(product.basePrice));
        if (!(basePrice > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto no tiene un precio válido (debe ser > 0)" });
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

        // 2b. Calcular importe con lógica dual per_person / per_unit
        const pricingType = (product as any).pricingType ?? "per_person";
        const unitCapacity = (product as any).unitCapacity ?? null;
        const maxUnits = (product as any).maxUnits ?? null;
        const { totalEuros: baseTotal, unitsBooked } = calcPricing(
          pricePerPerson, input.people, pricingType, unitCapacity, maxUnits
        );
        // SECURITY NOTE: Los extras no se validan contra BD porque no existe tabla de catálogo de extras.
        const extrasTotal = input.extras.reduce((sum, e) => sum + e.price * e.quantity, 0);
        const totalEuros = baseTotal + extrasTotal;
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
          // Time slots (optional, retrocompatible)
          selectedTimeSlotId: input.selectedTimeSlotId ?? undefined,
          selectedTime: input.selectedTime ?? undefined,
          // Pricing snapshot
          pricingType,
          unitCapacity: unitCapacity ?? undefined,
          unitsBooked: unitsBooked || undefined,
        });

        // 5. Construir el formulario Redsys
        const pricingDesc = pricingType === "per_unit" && unitsBooked
          ? `${product.title} x${unitsBooked} unidad${unitsBooked !== 1 ? "es" : ""}`
          : `${product.title} x${input.people} persona${input.people !== 1 ? "s" : ""}`;
        const redsysForm = buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: pricingDesc,
          notifyUrl: `${process.env.APP_URL}/api/redsys/notification`,
          okUrl: `${process.env.APP_URL}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${process.env.APP_URL}/reserva/error?order=${merchantOrder}`,
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
        channel: z.string().optional(),
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
        discountCodeId: z.number().optional(),
        // discountPercent ya no se acepta del cliente — se consulta en BD por discountCodeId
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
          pricingType?: "per_person" | "per_unit";
          unitCapacity?: number;
          unitsBooked?: number;
        }> = [];
        const productNames: string[] = [];
        for (const item of input.items) {
          const product = await getExpById(item.productId);
          if (!product) {
            // Fallback: try lego pack
            const dbInst = await getDb();
            if (!dbInst) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
            const [packRow] = await dbInst.select().from(legoPacksTable).where(eq(legoPacksTable.id, item.productId)).limit(1);
            if (!packRow) throw new TRPCError({ code: "NOT_FOUND", message: `Producto ${item.productId} no encontrado` });
            if (!packRow.isOnlineSale) throw new TRPCError({ code: "BAD_REQUEST", message: `El pack "${packRow.title}" no está disponible para venta online` });
            const pricing = await calculateLegoPackPrice(item.productId);
            const packPricePerPerson = pricing.totalFinal;
            if (!(packPricePerPerson > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: `El pack "${packRow.title}" no tiene precio configurado` });
            const extrasTotal = item.extras.reduce((s, e) => s + e.price * e.quantity, 0);
            const itemAmountCents = Math.round((packPricePerPerson * item.people + extrasTotal) * 100);
            totalAmountCents += itemAmountCents;
            itemsWithPrices.push({
              productId: item.productId,
              productName: packRow.title,
              bookingDate: item.bookingDate,
              people: item.people,
              extrasJson: JSON.stringify(item.extras),
              amountTotal: itemAmountCents,
              pricingType: "per_person",
            });
            productNames.push(packRow.title);
            continue;
          }
          if (!product.basePrice) throw new TRPCError({ code: "BAD_REQUEST", message: `El producto ${product.title} no tiene precio fijo` });
          const basePrice = parseFloat(String(product.basePrice));
          if (!(basePrice > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: `El producto ${product.title} no tiene un precio válido (debe ser > 0)` });
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
          const itemPricingType = (product as any).pricingType ?? "per_person";
          const itemUnitCap = (product as any).unitCapacity ?? null;
          const itemMaxUnits = (product as any).maxUnits ?? null;
          const { totalEuros: itemBase, unitsBooked: itemUnits } = calcPricing(
            pricePerPerson, item.people, itemPricingType, itemUnitCap, itemMaxUnits
          );
          const itemTotalEuros = itemBase + extrasTotal;
          const itemAmountCents = Math.round(itemTotalEuros * 100);
          totalAmountCents += itemAmountCents;
          itemsWithPrices.push({
            productId: item.productId,
            productName: product.title,
            bookingDate: item.bookingDate,
            people: item.people,
            extrasJson: JSON.stringify(item.extras),
            amountTotal: itemAmountCents,
            pricingType: itemPricingType,
            unitCapacity: itemUnitCap ?? undefined,
            unitsBooked: itemUnits || undefined,
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
            pricingType: item.pricingType,
            unitCapacity: item.unitCapacity,
            unitsBooked: item.unitsBooked,
          });
        }
        // 3b. Aplicar descuento por código si se proporcionó — validar SIEMPRE en servidor
        let finalAmountCents = totalAmountCents;
        if (input.discountCodeId) {
          const db = await getDb();
          const [discountRow] = await db!
            .select({ discountType: discountCodes.discountType, discountPercent: discountCodes.discountPercent, discountAmount: discountCodes.discountAmount, status: discountCodes.status, expiresAt: discountCodes.expiresAt, maxUses: discountCodes.maxUses, currentUses: discountCodes.currentUses })
            .from(discountCodes)
            .where(eq(discountCodes.id, input.discountCodeId))
            .limit(1);
          if (discountRow && discountRow.status === "active") {
            const expired = (discountRow.expiresAt && new Date(discountRow.expiresAt) < new Date())
              || (discountRow.maxUses !== null && discountRow.currentUses >= discountRow.maxUses);
            if (!expired) {
              let discountCents: number;
              if (discountRow.discountType === "fixed") {
                const fixedEuros = parseFloat((discountRow.discountAmount as unknown as string) ?? "0");
                discountCents = Math.round(fixedEuros * 100);
              } else {
                const pct = parseFloat(discountRow.discountPercent as unknown as string);
                discountCents = Math.round(totalAmountCents * pct / 100);
              }
              finalAmountCents = Math.max(0, totalAmountCents - discountCents);
            }
          }
        }
        // 4. Construir el formulario Redsys con el importe total
        const description = productNames.length === 1
          ? productNames[0]
          : `${productNames.length} experiencias — Náyade`;
        const redsysForm = buildRedsysForm({
          amount: finalAmountCents,
          merchantOrder,
          productDescription: description.slice(0, 125),
          notifyUrl: `${process.env.APP_URL}/api/redsys/notification`,
          okUrl: `${process.env.APP_URL}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${process.env.APP_URL}/reserva/error?order=${merchantOrder}`,
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
    // NOTE: Public procedures (getByCategory, getBySlug) removed in v22.8.
    // The packs table and admin procedures are preserved for TPV, supplier liquidations, and LegoPacksManager.
    /** Listado público ligero de títulos por categoría (para formulario hero) */
    getTitlesByCategory: publicProcedure
      .input(z.object({ category: z.enum(["dia", "escolar", "empresa"]) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const rows = await db.select({ id: packs.id, title: packs.title })
          .from(packs)
          .where(and(eq(packs.category, input.category), eq(packs.isActive, true)))
          .orderBy(packs.sortOrder);
        return rows;
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
        isPresentialSale: z.boolean().default(false),
        sortOrder: z.number().default(0),
        fiscalRegime: z.enum(["general", "reav"]).default("general"),
        productType: z.string().optional(),
        providerPercent: z.number().optional(),
        agencyMarginPercent: z.number().optional(),
        supplierId: z.number().optional(),
        supplierCommissionPercent: z.string().optional(),
        supplierCostType: z.string().optional(),
        settlementFrequency: z.string().optional(),
        isSettlable: z.boolean().optional(),
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
        discountPercent: z.string().optional(),
        discountExpiresAt: z.string().optional(),
        fiscalRegime: z.enum(["general", "reav"]).optional(),
        productType: z.string().optional(),
        providerPercent: z.number().optional(),
        agencyMarginPercent: z.number().optional(),
        supplierId: z.number().optional(),
        supplierCommissionPercent: z.string().optional(),
        supplierCostType: z.string().optional(),
        settlementFrequency: z.string().optional(),
        isSettlable: z.boolean().optional(),
        isPresentialSale: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        // Convert discountExpiresAt string to Date for Drizzle timestamp column
        const processedData: Record<string, unknown> = { ...data };
        if (processedData.discountExpiresAt && typeof processedData.discountExpiresAt === "string") {
          processedData.discountExpiresAt = new Date(processedData.discountExpiresAt as string);
        } else if (processedData.discountExpiresAt === "") {
          processedData.discountExpiresAt = null;
        }
        // Convert discountPercent string to number for Drizzle decimal column
        if (processedData.discountPercent !== undefined && processedData.discountPercent !== null && processedData.discountPercent !== "") {
          processedData.discountPercent = parseFloat(processedData.discountPercent as string);
        } else if (processedData.discountPercent === "") {
          processedData.discountPercent = null;
        }
        return updatePack(id, processedData as any);
      }),
    // Toggle activo/inactivo
    toggle: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => togglePackActive(input.id)),

    // Borrar definitivamente
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => hardDeletePack(input.id)),

    // Clonar
    clone: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => clonePack(input.id)),
    // Reordenar
    reorder: adminProcedure
      .input(z.object({ items: z.array(z.object({ id: z.number(), sortOrder: z.number() })) }))
      .mutation(async ({ input }) => reorderPacks(input.items)),
  }),
  hotel: hotelRouter,
  spa: spaRouter,
  reviews: reviewsRouter,
  restaurants: restaurantsRouter,
  crm: crmRouter,
  commercialFollowup: commercialFollowupRouter,
  ghlInbox: ghlInboxRouter,
  vapiCalls: vapiCallsRouter,
  emailAccounts: emailAccountsRouter,
  emailInbox: emailInboxRouter,
  suppliers: suppliersRouter,
  timeSlots: timeSlotsRouter,
  tpv: tpvRouter,
  discounts: discountsRouter,
  settlements: settlementsRouter,
  legoPacks: legoPacksRouter,
  ticketing: ticketingRouter,
  reav: router({
    // Expedientes
    list: adminProcedure
      .input(z.object({
        fiscalStatus: z.string().optional(),
        operativeStatus: z.string().optional(),
        agentId: z.number().optional(),
      }))
      .query(async ({ input }) => listReavExpedients(input)),

    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => getReavExpedientById(input.id)),

    create: adminProcedure
      .input(z.object({
        invoiceId: z.number().optional(),
        reservationId: z.number().optional(),
        clientId: z.number().optional(),
        agentId: z.number().optional(),
        serviceDescription: z.string().optional(),
        serviceDate: z.string().optional(),
        serviceEndDate: z.string().optional(),
        destination: z.string().optional(),
        numberOfPax: z.number().optional(),
        saleAmountTotal: z.string().optional(),
        providerCostEstimated: z.string().optional(),
        agencyMarginEstimated: z.string().optional(),
        internalNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => createReavExpedient(input)),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        serviceDescription: z.string().optional(),
        serviceDate: z.string().optional(),
        serviceEndDate: z.string().optional(),
        destination: z.string().optional(),
        numberOfPax: z.number().optional(),
        saleAmountTotal: z.string().optional(),
        providerCostEstimated: z.string().optional(),
        agencyMarginEstimated: z.string().optional(),
        fiscalStatus: z.enum(["pendiente_documentacion","documentacion_completa","en_revision","cerrado","anulado"]).optional(),
        operativeStatus: z.enum(["abierto","en_proceso","cerrado","anulado"]).optional(),
        internalNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateReavExpedient(id, data);
      }),

    recalculate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => recalculateReavMargins(input.id)),

    // Documentos
    addDocument: adminProcedure
      .input(z.object({
        expedientId: z.number(),
        side: z.enum(["client","provider"]),
        docType: z.enum(["factura_emitida","factura_recibida","contrato","voucher","confirmacion_proveedor","otro"]),
        title: z.string(),
        fileUrl: z.string().optional(),
        fileKey: z.string().optional(),
        mimeType: z.string().optional(),
        fileSize: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => addReavDocument({ ...input, uploadedBy: ctx.user.id })),

    deleteDocument: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => { await deleteReavDocument(input.id); return { success: true }; }),

    // Costes
    addCost: adminProcedure
      .input(z.object({
        expedientId: z.number(),
        description: z.string(),
        providerName: z.string().optional(),
        providerNif: z.string().optional(),
        invoiceRef: z.string().optional(),
        invoiceDate: z.string().optional(),
        amount: z.string(),
        currency: z.string().default("EUR"),
        category: z.enum(["transporte","alojamiento","actividad","restauracion","guia","seguro","otros"]).default("otros"),
        isPaid: z.boolean().default(false),
        includesVat: z.boolean().default(true),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => addReavCost({ ...input, createdBy: ctx.user.id })),

    updateCost: adminProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
        providerName: z.string().optional(),
        amount: z.string().optional(),
        isPaid: z.boolean().optional(),
        includesVat: z.boolean().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => { const { id, ...data } = input; await updateReavCost(id, data); return { success: true }; }),

    deleteCost: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => { await deleteReavCost(input.id); return { success: true }; }),

    exportZip: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const exp = await getReavExpedientById(input.id);
        if (!exp) throw new TRPCError({ code: "NOT_FOUND" });

        const zip = new JSZip();

        // ── Resumen del expediente (texto) ────────────────────────────────────
        const sale = parseFloat(exp.saleAmountTotal ?? "0");
        const costReal = parseFloat(exp.providerCostReal ?? "0");
        const marginReal = parseFloat(exp.agencyMarginReal ?? "0");
        const taxBase = parseFloat(exp.reavTaxBase ?? "0");
        const taxAmount = parseFloat(exp.reavTaxAmount ?? "0");

        const summary = [
          `EXPEDIENTE REAV — ${exp.expedientNumber}`,
          `${"=".repeat(60)}`,
          ``,
          `DATOS DEL SERVICIO`,
          `  Descripción:    ${exp.serviceDescription ?? "—"}`,
          `  Destino:        ${exp.destination ?? "—"}`,
          `  Fecha servicio: ${exp.serviceDate ?? "—"}`,
          `  N.º Pax:        ${exp.numberOfPax ?? "—"}`,
          `  Canal:          ${exp.channel ?? "—"}`,
          `  Referencia:     ${exp.sourceRef ?? "—"}`,
          ``,
          `DATOS DEL CLIENTE`,
          `  Nombre:         ${exp.clientName ?? "—"}`,
          `  Email:          ${exp.clientEmail ?? "—"}`,
          `  Teléfono:       ${exp.clientPhone ?? "—"}`,
          `  DNI/NIF:        ${exp.clientDni ?? "—"}`,
          `  Dirección:      ${exp.clientAddress ?? "—"}`,
          ``,
          `IMPORTES`,
          `  Venta total:    ${sale.toFixed(2)} €`,
          `  Coste real:     ${costReal.toFixed(2)} €`,
          `  Margen real:    ${marginReal.toFixed(2)} €`,
          `  Base imponible: ${taxBase.toFixed(2)} €`,
          `  IVA REAV 21%:   ${taxAmount.toFixed(2)} €`,
          ``,
          `ESTADO`,
          `  Fiscal:         ${exp.fiscalStatus ?? "—"}`,
          `  Operativo:      ${exp.operativeStatus ?? "—"}`,
          ``,
          `COSTES DE PROVEEDOR`,
          ...(exp.costs?.length
            ? exp.costs.map((c: any) =>
                `  [${c.category}] ${c.description} — ${parseFloat(c.amount).toFixed(2)} € (${c.includesVat ? "IVA incl." : "neto s/IVA"}) — ${c.providerName ?? "—"}${c.isPaid ? " ✓ Pagado" : ""}`
              )
            : ["  Sin costes registrados"]),
          ``,
          `DOCUMENTOS ADJUNTOS`,
          ...(exp.documents?.length
            ? exp.documents.map((d: any) =>
                `  [${d.side}/${d.docType}] ${d.title}${d.fileUrl ? ` — ${d.fileUrl}` : ""}`
              )
            : ["  Sin documentos adjuntos"]),
          ``,
          `Generado: ${new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`,
        ].join("\n");

        zip.file("resumen.txt", summary);

        // ── Descargar documentos adjuntos ─────────────────────────────────────
        const docFolder = zip.folder("documentos")!;
        let docIndex = 1;
        for (const doc of (exp.documents ?? []) as any[]) {
          if (!doc.fileUrl) continue;
          try {
            const res = await fetch(doc.fileUrl);
            if (!res.ok) continue;
            const buf = await res.arrayBuffer();
            const ext = doc.mimeType === "application/pdf" ? ".pdf"
              : doc.mimeType?.startsWith("image/") ? "." + doc.mimeType.split("/")[1]
              : "";
            const safeName = `${String(docIndex).padStart(2, "0")}_${doc.title.replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ ]/g, "_").substring(0, 60)}${ext}`;
            docFolder.file(safeName, buf);
            docIndex++;
          } catch {
            // Documento no descargable — incluir nota
            docFolder.file(`${String(docIndex).padStart(2, "0")}_${doc.title.substring(0, 40)}_ERROR.txt`,
              `No se pudo descargar: ${doc.fileUrl}`);
            docIndex++;
          }
        }

        const zipBuffer = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
        return {
          base64: zipBuffer,
          filename: `${exp.expedientNumber}_REAV.zip`,
        };
      }),

    deleteExpedient: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const expedientNumber = await deleteReavExpedient(input.id);
        return { success: true, expedientNumber };
      }),
  }),

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

  // ─── SERIES DE NUMERACIÓN ─────────────────────────────────────────────────
  documentNumbers: router({
    /** Obtener todos los contadores actuales */
    getCounters: adminProcedure.query(async () => {
      return getAllCounters();
    }),

    /** Actualizar el prefijo de una serie */
    updatePrefix: adminProcedure
      .input(z.object({
        documentType: z.enum(["presupuesto", "factura", "reserva", "tpv", "cupon", "liquidacion", "anulacion"]),
        year: z.number().int().min(2020).max(2099),
        newPrefix: z.string().min(1).max(16).regex(/^[A-Z0-9-]+$/, "Solo mayúsculas, números y guiones"),
      }))
      .mutation(async ({ input }) => {
        await updateCounterPrefix(input.documentType as DocumentType, input.year, input.newPrefix);
        return { success: true };
      }),

    /** Resetear manualmente un contador (solo para correcciones de inicio de año) */
    resetCounter: adminProcedure
      .input(z.object({
        documentType: z.enum(["presupuesto", "factura", "reserva", "tpv", "cupon", "liquidacion", "anulacion"]),
        year: z.number().int().min(2020).max(2099),
        newValue: z.number().int().min(0),
      }))
      .mutation(async ({ input, ctx }) => {
        await resetCounter(input.documentType as DocumentType, input.year, input.newValue, String(ctx.user.id));
        return { success: true };
      }),

    /** Historial de generación de números */
    getLogs: adminProcedure
      .input(z.object({
        documentType: z.enum(["presupuesto", "factura", "reserva", "tpv", "cupon", "liquidacion", "anulacion"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }))
      .query(async ({ input }) => {
        return getDocumentNumberLogs(input.documentType as DocumentType | undefined, input.limit);
      }),
  }),
});
export type AppRouter = typeof appRouter;
