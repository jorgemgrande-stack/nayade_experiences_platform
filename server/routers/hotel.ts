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
import { getRatingsByEntityType } from "../db/reviewsDb";
import { createReservation } from "../db";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores" });
  }
  return next({ ctx });
});

export const hotelRouter = router({

  // ── PUBLIC ────────────────────────────────────────────────────────────────

  /** Lista pública de tipologías activas con puntuación media */
  getRoomTypes: publicProcedure.query(async () => {
    const [rooms, ratings] = await Promise.all([
      getActiveRoomTypes(),
      getRatingsByEntityType("hotel"),
    ]);
    return rooms.map(room => ({
      ...room,
      avgRating: ratings.get(room.id)?.avgRating ?? 0,
      reviewCount: ratings.get(room.id)?.reviewCount ?? 0,
    }));
  }),

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
      // Descuento promocional
      discountPercent: z.string().optional(),
      discountLabel: z.string().optional(),
      discountExpiresAt: z.string().optional(),
      // Régimen fiscal
      fiscalRegime: z.enum(["reav", "general_21", "mixed"]).default("general_21"),
      productType: z.enum(["own", "semi_own", "third_party"]).default("own"),
      providerPercent: z.string().optional(),
      agencyMarginPercent: z.string().optional(),
      // Proveedor y liquidaciones
      supplierId: z.number().int().nullable().optional(),
      supplierCommissionPercent: z.string().optional(),
      supplierCostType: z.enum(["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).optional(),
      settlementFrequency: z.enum(["semanal", "quincenal", "mensual", "manual"]).optional(),
      isSettlable: z.boolean().default(false),
      isPresentialSale: z.boolean().default(false),
      isFeatured: z.boolean().default(false),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const data: Record<string, unknown> = { ...input };
      if (data.discountExpiresAt && typeof data.discountExpiresAt === "string") {
        data.discountExpiresAt = new Date(data.discountExpiresAt as string);
      } else if (data.discountExpiresAt === "") {
        data.discountExpiresAt = null;
      }
      return createRoomType(data as Parameters<typeof createRoomType>[0]);
    }),

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
      // Descuento promocional
      discountPercent: z.string().nullable().optional(),
      discountLabel: z.string().nullable().optional(),
      discountExpiresAt: z.string().nullable().optional(),
      // Régimen fiscal
      fiscalRegime: z.enum(["reav", "general_21", "mixed"]).optional(),
      productType: z.enum(["own", "semi_own", "third_party"]).optional(),
      providerPercent: z.string().nullable().optional(),
      agencyMarginPercent: z.string().nullable().optional(),
      // Proveedor y liquidaciones
      supplierId: z.number().int().nullable().optional(),
      supplierCommissionPercent: z.string().nullable().optional(),
      supplierCostType: z.enum(["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).nullable().optional(),
      settlementFrequency: z.enum(["semanal", "quincenal", "mensual", "manual"]).nullable().optional(),
      isSettlable: z.boolean().optional(),
      isPresentialSale: z.boolean().optional(),
      isFeatured: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (data.discountExpiresAt && typeof data.discountExpiresAt === "string") {
        data.discountExpiresAt = new Date(data.discountExpiresAt as string);
      } else if (data.discountExpiresAt === "" || data.discountExpiresAt === null) {
        data.discountExpiresAt = null;
      }
      return updateRoomType(id, data as Parameters<typeof updateRoomType>[1]);
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

  // ── BOOKING ───────────────────────────────────────────────────────────────

  /**
   * Crea una pre-reserva de hotel y devuelve el formulario Redsys para el pago.
   * El importe se calcula SIEMPRE en backend: precio_noche × noches × personas.
   */
  createHotelBooking: publicProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      adults: z.number().int().min(1).max(10),
      children: z.number().int().min(0).max(10).default(0),
      childrenAges: z.array(z.number().int().min(0).max(17)).optional(),
      customerName: z.string().min(2),
      customerEmail: z.string().email(),
      customerPhone: z.string().optional(),
      notes: z.string().optional(),
      origin: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      // 1. Obtener la tipología y validar
      const room = await getRoomTypeById(input.roomTypeId);
      if (!room || !room.isActive) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Habitación no encontrada" });
      }

      // 2. Calcular número de noches
      const checkInDate = new Date(input.checkIn);
      const checkOutDate = new Date(input.checkOut);
      const nights = Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));
      if (nights < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de salida debe ser posterior a la de entrada" });
      }

      // 3. Calcular precio: obtener precio real de la temporada para el check-in
      //    Si no hay tarifa específica, usar basePrice de la tipología
      const rates = await getRatesByRoomType(input.roomTypeId);
      const seasons = await getAllRateSeasons();
      const checkInMs = checkInDate.getTime();
      let pricePerNight = parseFloat(String(room.basePrice ?? 0));
      for (const rate of rates) {
        // Si la tarifa tiene fecha específica, comparar directamente
        if (rate.specificDate && rate.specificDate === input.checkIn) {
          pricePerNight = parseFloat(String(rate.pricePerNight));
          break;
        }
        // Si la tarifa tiene temporada, buscar las fechas de la temporada
        if (rate.seasonId) {
          const season = seasons.find(s => s.id === rate.seasonId);
          if (season) {
            const from = new Date(season.startDate).getTime();
            const to = new Date(season.endDate).getTime();
            if (checkInMs >= from && checkInMs <= to) {
              pricePerNight = parseFloat(String(rate.pricePerNight));
              break;
            }
          }
        }
      }

      // 4. Total = precio/noche × noches (el precio ya incluye la habitación completa)
      const totalEuros = pricePerNight * nights;
      const amountCents = Math.round(totalEuros * 100);

      // 5. Generar merchantOrder único
      const merchantOrder = generateMerchantOrder();

      // 6. Crear la pre-reserva en BD con estado pending_payment
      //    Usamos productId=0 para reservas de hotel y guardamos los detalles en notes
      const bookingDetails = JSON.stringify({
        type: "hotel",
        roomTypeId: input.roomTypeId,
        roomName: room.name,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights,
        adults: input.adults,
        children: input.children,
        childrenAges: input.childrenAges ?? [],
        pricePerNight,
      });

      await createReservation({
        productId: input.roomTypeId,
        productName: `Hotel: ${room.name} (${nights} noche${nights > 1 ? 's' : ''})`,
        bookingDate: input.checkIn,
        people: input.adults + input.children,
        extrasJson: bookingDetails,
        amountTotal: amountCents,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        merchantOrder,
        notes: input.notes,
      });

      // 7. Construir el formulario Redsys
      const redsysForm = buildRedsysForm({
        amount: amountCents,
        merchantOrder,
        productDescription: `Hotel Náyade: ${room.name} · ${nights} noche${nights > 1 ? 's' : ''} · ${input.adults} adulto${input.adults > 1 ? 's' : ''}`,
        notifyUrl: `${input.origin}/api/redsys/notification`,
        okUrl: `${input.origin}/reserva/ok?order=${merchantOrder}`,
        koUrl: `${input.origin}/reserva/error?order=${merchantOrder}`,
        holderName: input.customerName,
      });

      return {
        merchantOrder,
        amountCents,
        amountEuros: totalEuros,
        nights,
        pricePerNight,
        roomName: room.name,
        redsysForm,
      };
    }),
});
