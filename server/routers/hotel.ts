import { router, publicProcedure, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { companyName } from "../tenantBrand";
import { publicBaseUrl } from "../_core/productIdentity";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAllRoomTypes, getActiveRoomTypes, getRoomTypeBySlug, getRoomTypeById,
  createRoomType, updateRoomType, deleteRoomType, toggleRoomTypeActive,
  getAllRateSeasons, createRateSeason, updateRateSeason, deleteRateSeason,
  getRatesByRoomType, createRoomRate, updateRoomRate, deleteRoomRate,
  getRoomBlocksForRange, getAllBlocksForRange, upsertRoomBlock, deleteRoomBlock,
  searchAvailability, getRoomCalendar, resolveNightlyPrice,
} from "../hotelDb";
import { getRatingsByEntityType } from "../db/reviewsDb";
import { holdHotelRoomAndCreateReservation, releaseInventoryHold, reconcileInventory, createStaffHotelReservation } from "../inventoryHoldsDb";
import { buildRedsysForm, generateMerchantOrder } from "../redsys";
import { assertModuleEnabled } from "../_core/flagGuard";
import { resolveSiteFilter, resolveSiteForWrite, siteCondition } from "../sitesDb";
import { ROOM_OPERATIONAL_STATUSES, isIsoDate, nightsBetween, restrictionInputError } from "../hotelPms";
import {
  hotelRooms, listHotelRooms, createHotelRoom, updateHotelRoom, deleteHotelRoom, toggleHotelRoomActive,
  setHotelRoomState, getHotelRoomStateHistory, listHotelReservationsWithRooms, assignRoomToReservation,
  assignRoomWithinTx, unassignRoomFromReservation, autoAssignReservation, autoAssignRange, getRoomPlanning,
  getReceptionDashboard, applyStayTransition, listStayRestrictions, setStayRestrictions, stayRestrictionReason,
} from "../hotelPmsDb";

const isoDate = z.string().refine(isIsoDate, "Fecha no válida (AAAA-MM-DD)");
/** Rango de fechas inclusivo y acotado (planning, listados y restricciones). */
const dateRange = (maxDays: number) => z.object({ from: isoDate, to: isoDate }).refine(
  (r) => r.from <= r.to && nightsBetween(r.from, r.to) <= maxDays,
  `El rango de fechas no es válido (máximo ${maxDays} días)`,
);
const roomFields = {
  roomTypeId: z.number().int().positive(),
  code: z.string().trim().min(1).max(32),
  name: z.string().max(120).nullable().optional(),
  floor: z.string().max(32).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  attributes: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};


const adminProcedure = permissionProcedure("settings.manage", ["admin"]).use(async ({ ctx, next }) => {
  await assertModuleEnabled("hotel_module_enabled");
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
      fiscalRegime: z.enum(["reav", "general", "mixed"]).default("general"),
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
      fiscalRegime: z.enum(["reav", "general", "mixed"]).optional(),
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

  /**
   * Reconciliación del hotel: sincroniza las retenciones con su reserva (con `apply: true`) e informa de
   * noches con más habitaciones ocupadas que capacidad y de pagos sin plaza (conflictos).
   */
  adminReconcileInventory: adminProcedure
    .input(z.object({ apply: z.boolean().default(false) }))
    .mutation(({ input }) => reconcileInventory({ apply: input.apply, kind: "hotel_room" })),

  // ── ADMIN: PMS · HABITACIONES FÍSICAS ─────────────────────────────────────

  adminGetRooms: adminProcedure
    .input(z.object({ roomTypeId: z.number().int().optional(), siteId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const site = await resolveSiteFilter(input?.siteId);
      return listHotelRooms({ roomTypeId: input?.roomTypeId, siteCondition: site ? siteCondition(hotelRooms.siteId, site) : null });
    }),

  adminCreateRoom: adminProcedure
    .input(z.object({ ...roomFields, siteId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { siteId, ...data } = input;
      return createHotelRoom(data, await resolveSiteForWrite(siteId));
    }),

  adminUpdateRoom: adminProcedure
    .input(z.object({ id: z.number().int(), ...roomFields, roomTypeId: roomFields.roomTypeId.optional(), code: roomFields.code.optional() }))
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return updateHotelRoom(id, patch);
    }),

  adminDeleteRoom: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteHotelRoom(input.id)),

  adminToggleRoomActive: adminProcedure
    .input(z.object({ id: z.number().int(), isActive: z.boolean() }))
    .mutation(({ input }) => toggleHotelRoomActive(input.id, input.isActive)),

  /** Cambia el estado operativo de una habitación (queda en su historial). */
  adminSetRoomState: adminProcedure
    .input(z.object({ hotelRoomId: z.number().int(), toStatus: z.enum(ROOM_OPERATIONAL_STATUSES), reason: z.string().max(255).optional() }))
    .mutation(({ input, ctx }) => setHotelRoomState(input.hotelRoomId, input.toStatus, { userId: ctx.user.id, reason: input.reason })),

  adminGetRoomStateHistory: adminProcedure
    .input(z.object({ hotelRoomId: z.number().int() }))
    .query(({ input }) => getHotelRoomStateHistory(input.hotelRoomId)),

  // ── ADMIN: PMS · RESERVAS Y ASIGNACIÓN ────────────────────────────────────

  /** Reservas de hotel cuya estancia solapa el rango, con su habitación asignada. */
  adminListReservations: adminProcedure
    .input(z.object({
      range: dateRange(400),
      status: z.enum(["pending_payment", "paid", "cancelled", "failed"]).optional(),
    }))
    .query(({ input }) => listHotelReservationsWithRooms({ from: input.range.from, to: input.range.to, status: input.status, limit: 1000 })),

  /**
   * Alta de reserva por recepción (mostrador, teléfono o correo). El importe por defecto es el de la tarifa de cada
   * noche (misma regla que la web); la habitación queda retenida al crearla y, si se indica, asignada en la misma
   * transacción. «Forzar» aloja aunque la tipología esté completa o la estancia incumpla las restricciones.
   */
  adminCreateReservation: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      checkIn: isoDate,
      checkOut: isoDate,
      adults: z.number().int().min(1).max(20),
      children: z.number().int().min(0).max(20).default(0),
      totalEuros: z.number().min(0).max(1_000_000).optional(),
      channel: z.enum(["MANUAL", "TELEFONO", "EMAIL", "TPV_FISICO"]).default("MANUAL"),
      customerName: z.string().trim().min(2).max(255),
      customerEmail: z.string().trim().email().max(255).optional().or(z.literal("")),
      customerPhone: z.string().trim().max(50).optional(),
      notes: z.string().max(2000).optional(),
      force: z.boolean().default(false),
      hotelRoomId: z.number().int().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const room = await getRoomTypeById(input.roomTypeId);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Tipología no encontrada" });
      const nights = nightsBetween(input.checkIn, input.checkOut);
      if (nights < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "La salida debe ser posterior a la entrada" });
      if (nights > 90) throw new TRPCError({ code: "BAD_REQUEST", message: "La estancia no puede superar 90 noches" });
      if (!input.force) {
        const why = await stayRestrictionReason(input.roomTypeId, input.checkIn, input.checkOut);
        if (why) throw new TRPCError({ code: "BAD_REQUEST", message: `${why} Usa «Forzar» para alojar igualmente.` });
      }

      let totalEuros = input.totalEuros;
      if (totalEuros === undefined) {
        const [rates, seasons] = await Promise.all([getRatesByRoomType(input.roomTypeId), getAllRateSeasons()]);
        totalEuros = 0;
        for (let i = 0; i < nights; i++) {
          const d = new Date(`${input.checkIn}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + i);
          totalEuros += resolveNightlyPrice(rates, seasons, String(room.basePrice ?? 0), d.toISOString().slice(0, 10));
        }
      }
      const amountCents = Math.round(totalEuros * 100);
      const extrasJson = JSON.stringify({
        type: "hotel",
        roomTypeId: input.roomTypeId,
        roomName: room.name,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights,
        adults: input.adults,
        children: input.children,
        pricePerNight: Math.round((totalEuros / nights) * 100) / 100,
        source: "pms_recepcion",
      });
      const held = await createStaffHotelReservation(
        { roomTypeId: input.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, units: 1 },
        {
          productId: input.roomTypeId,
          productName: `Hotel: ${room.name} (${nights} noche${nights > 1 ? "s" : ""})`,
          bookingDate: input.checkIn,
          people: input.adults + input.children,
          extrasJson,
          amountTotal: amountCents,
          customerName: input.customerName,
          // La columna admite NULL: sin correo no se guarda una cadena vacía
          customerEmail: (input.customerEmail || null) as unknown as string,
          customerPhone: input.customerPhone || undefined,
          merchantOrder: generateMerchantOrder(),
          notes: input.notes || undefined,
        },
        {
          channel: input.channel,
          force: input.force,
          afterCreate: input.hotelRoomId != null
            ? async (tx, reservationId) => { await assignRoomWithinTx(tx, { reservationId, hotelRoomId: input.hotelRoomId!, userId: ctx.user.id }); }
            : undefined,
        },
      );
      if (!held.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No quedan habitaciones de esa tipología para esas fechas. Usa «Forzar» para alojar igualmente." });
      }
      return { id: held.reservation.id, reservationNumber: held.reservation.reservationNumber, amountCents };
    }),

  /** Asigna o cambia la habitación física de una reserva (fechas de la reserva; sin solapes). */
  adminAssignRoom: adminProcedure
    .input(z.object({ reservationId: z.number().int(), hotelRoomId: z.number().int(), notes: z.string().max(2000).optional() }))
    .mutation(({ input, ctx }) => assignRoomToReservation({ ...input, userId: ctx.user.id })),

  adminUnassignRoom: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .mutation(({ input }) => unassignRoomFromReservation(input.reservationId)),

  /** Asigna automáticamente la primera habitación libre de la tipología. */
  adminAutoAssignRoom: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .mutation(async ({ input }) => {
      const r = await autoAssignReservation(input.reservationId);
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.reason });
      return r;
    }),

  /** Asigna automáticamente todas las reservas sin habitación del rango. */
  adminAutoAssignAll: adminProcedure
    .input(dateRange(62))
    .mutation(({ input }) => autoAssignRange(input.from, input.to)),

  /** Planning / rack de ocupación por habitación física. */
  adminGetPlanning: adminProcedure
    .input(dateRange(62))
    .query(({ input }) => getRoomPlanning(input.from, input.to)),

  // ── ADMIN: PMS · RECEPCIÓN ────────────────────────────────────────────────

  adminGetReceptionDashboard: adminProcedure.query(() => getReceptionDashboard()),

  /** Check-in: la estancia pasa a «en curso» y la habitación asignada (o la automática) queda ocupada. */
  adminCheckIn: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .mutation(({ input, ctx }) => applyStayTransition(input.reservationId, "checkin", ctx.user.id)),

  /** Check-out: solo con check-in previo; la estancia finaliza y la habitación queda sucia. */
  adminCheckOut: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .mutation(({ input, ctx }) => applyStayTransition(input.reservationId, "checkout", ctx.user.id)),

  /** No-show: el huésped no llegó; la habitación asignada queda libre. */
  adminMarkNoShow: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .mutation(({ input, ctx }) => applyStayTransition(input.reservationId, "noshow", ctx.user.id)),

  // ── ADMIN: PMS · RESTRICCIONES DE ESTANCIA ────────────────────────────────

  adminGetStayRestrictions: adminProcedure
    .input(z.object({ range: dateRange(400), roomTypeId: z.number().int().optional() }))
    .query(({ input }) => listStayRestrictions(input.range.from, input.range.to, input.roomTypeId)),

  /** Estancia mínima y máxima y cierre a llegadas o salidas de una tipología en cada día del rango (0/vacío = sin restricción). */
  adminSetStayRestrictions: adminProcedure
    .input(z.object({
      roomTypeId: z.number().int(),
      range: dateRange(366),
      minStay: z.number().int().min(0).max(365).nullable(),
      maxStay: z.number().int().min(0).max(365).nullable(),
      closedToArrival: z.boolean(),
      closedToDeparture: z.boolean(),
    }))
    .mutation(({ input, ctx }) => {
      const r = { minStay: input.minStay, maxStay: input.maxStay, closedToArrival: input.closedToArrival, closedToDeparture: input.closedToDeparture };
      const why = restrictionInputError(r);
      if (why) throw new TRPCError({ code: "BAD_REQUEST", message: why });
      return setStayRestrictions({ roomTypeId: input.roomTypeId, from: input.range.from, to: input.range.to, userId: ctx.user.id, ...r });
    }),

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

      // 2b. Restricciones de estancia (estancia mínima/máxima, cierre a llegadas o salidas): las mismas que el buscador
      const restriction = await stayRestrictionReason(input.roomTypeId, input.checkIn, input.checkOut);
      if (restriction) throw new TRPCError({ code: "BAD_REQUEST", message: restriction });

      // 3. Calcular precio por noche con la MISMA lógica que la visualización
      //    (resolveNightlyPrice): así lo cobrado coincide exactamente con lo mostrado
      //    en buscador y calendario, y se respeta la temporada de cada noche.
      const rates = await getRatesByRoomType(input.roomTypeId);
      const seasons = await getAllRateSeasons();
      let totalEuros = 0;
      for (let i = 0; i < nights; i++) {
        const d = new Date(checkInDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        totalEuros += resolveNightlyPrice(rates, seasons, String(room.basePrice ?? 0), dateStr);
      }
      const pricePerNight = nights > 0 ? totalEuros / nights : parseFloat(String(room.basePrice ?? 0));

      // 4. Total = suma de los precios/noche (el precio ya incluye la habitación completa)
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

      //    La habitación queda retenida cada noche de la estancia en la misma transacción que crea
      //    la reserva: si en alguna noche no queda ninguna libre, no se crea nada.
      const held = await holdHotelRoomAndCreateReservation(
        { roomTypeId: input.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, units: 1 },
        {
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
        },
      );
      if (!held.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No quedan habitaciones de este tipo disponibles para esas fechas" });
      }

      // 7. Construir el formulario Redsys (si falla, la habitación no se queda retenida hasta que caduque)
      let redsysForm;
      try {
        redsysForm = await buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `Hotel ${companyName()}: ${room.name} · ${nights} noche${nights > 1 ? 's' : ''} · ${input.adults} adulto${input.adults > 1 ? 's' : ''}`,
          notifyUrl: `${publicBaseUrl()}/api/redsys/notification`,
          okUrl: `${publicBaseUrl()}/reserva/ok?order=${merchantOrder}`,
          koUrl: `${publicBaseUrl()}/reserva/error?order=${merchantOrder}`,
          holderName: input.customerName,
        });
      } catch (err) {
        await releaseInventoryHold(held.reservation.id, "pago_fallido").catch(() => undefined);
        throw err;
      }

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
