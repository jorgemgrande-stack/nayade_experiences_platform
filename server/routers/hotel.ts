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
  searchAvailability, getRoomCalendar, resolveNightlyPrice, stayNightCents,
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
import {
  getFolio, addFolioCharge, addFolioPayment, deleteFolioItem, closeFolio, postAccommodationOnCheckIn,
  getPmsSettings, setPmsSettings, getHotelReport, runNightAudit,
} from "../hotelFolioDb";
import { FOLIO_CHARGE_CATEGORIES, FOLIO_PAYMENT_METHODS, normalizeTaxBp } from "../hotelFolio";
import {
  listHousekeepingAssignees, listHousekeepingTasks, generateHousekeepingTasks, createHousekeepingTask, assignHousekeepingTask,
  setHousekeepingTaskStatus, listIncidentTypes, saveIncidentType, listRoomIncidents, createRoomIncident, setRoomIncidentStatus,
} from "../hotelHousekeepingDb";
import { HK_ASSIGNEE_ROLES, HK_TASK_KINDS, HK_TASK_STATUSES, INCIDENT_PRIORITIES, INCIDENT_STATUSES } from "../hotelHousekeeping";
import { checkPermission } from "../customRolesAccess";
import {
  listStayGuests, saveStayGuest, removeStayGuest, searchGuests, guestDetail, updateGuest, getGuestSettings, setGuestSettings,
  anonymizeExpiredGuests, listRatePlans, saveRatePlan, ratePlanForBooking,
} from "../hotelGuestsDb";
import { ADJUST_TYPES, DOC_TYPES, SEXES, applyPlanToStay, ratePlanError, retentionError } from "../hotelGuests";
import { todayInTimeZone } from "../hotelPms";

const guestDate = z.string().refine(isIsoDate, "Fecha no válida (AAAA-MM-DD)");
const guestOpt = (max: number) => z.string().max(max).nullable().optional();
const guestFields = z.object({
  firstName: guestOpt(120), lastName: guestOpt(160), secondLastName: guestOpt(160), sex: z.enum(SEXES).nullable().optional(),
  birthDate: guestDate.nullable().optional(), nationality: guestOpt(80), docType: z.enum(DOC_TYPES).nullable().optional(),
  docNumber: guestOpt(64), docSupportNumber: guestOpt(64), docIssueDate: guestDate.nullable().optional(),
  address: guestOpt(255), city: guestOpt(120), postalCode: guestOpt(16), country: guestOpt(80), phone: guestOpt(40),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal("")),
});
const toGuestInput = (g: z.infer<typeof guestFields>) => ({
  ...g, firstName: g.firstName ?? null, lastName: g.lastName ?? null, birthDate: g.birthDate ?? null, nationality: g.nationality ?? null, email: g.email || null,
});

/**
 * Personal del hotel (housekeeping): cualquier usuario del panel con un rol de equipo, con el módulo de hotel activo.
 * Solo ve y cambia SUS tareas (lo comprueba setHousekeepingTaskStatus); quien gestiona el hotel (mismo permiso que
 * adminProcedure) puede además inspeccionar y operar todas.
 */
const hotelStaffProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await assertModuleEnabled("hotel_module_enabled");
  const canManage = await checkPermission(ctx.user.id, ctx.user.role as string, "settings.manage", ["admin"]);
  if (!canManage && !(HK_ASSIGNEE_ROLES as readonly string[]).includes(ctx.user.role as string)) throw new TRPCError({ code: "FORBIDDEN", message: "Acceso denegado" });
  return next({ ctx: { ...ctx, canManageHotel: canManage } });
});

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
      ratePlanId: z.number().int().optional(),
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

      const plan = input.ratePlanId != null ? await ratePlanForBooking(input.roomTypeId, input.ratePlanId) : null;
      let totalEuros = input.totalEuros;
      if (totalEuros === undefined) {
        const [rates, seasons] = await Promise.all([getRatesByRoomType(input.roomTypeId), getAllRateSeasons()]);
        // Precio de cada noche (misma regla que la web) con el plan de tarifa, si se eligió
        totalEuros = applyPlanToStay(stayNightCents(rates, seasons, String(room.basePrice ?? 0), input.checkIn, nights), plan) / 100;
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
        ...(plan ? { ratePlan: { id: plan.id, name: plan.name, refundable: plan.refundable, includesBreakfast: plan.includesBreakfast } } : {}),
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
    .mutation(async ({ input, ctx }) => {
      const r = await applyStayTransition(input.reservationId, "checkin", ctx.user.id);
      // El alojamiento entra en el folio al hacer el check-in (sin la migración 0034 no hace nada)
      await postAccommodationOnCheckIn(input.reservationId, ctx.user.id).catch((e) => console.warn("[hotel] Folio: alojamiento no cargado al hacer check-in:", e instanceof Error ? e.message : e));
      return r;
    }),

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

  // ── ADMIN: PMS · FOLIO DE ESTANCIA ────────────────────────────────────────

  /** Folio de la reserva: cargos, pagos y saldo (se abre y carga el alojamiento la primera vez tras el check-in). */
  adminGetFolio: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .query(({ input, ctx }) => getFolio(input.reservationId, ctx.user.id)),

  adminAddFolioCharge: adminProcedure
    .input(z.object({
      reservationId: z.number().int(),
      category: z.enum(FOLIO_CHARGE_CATEGORIES).exclude(["alojamiento"]),
      description: z.string().trim().min(1).max(255),
      quantity: z.number().int().min(1).max(999),
      unitPriceCents: z.number().int().min(1).max(10_000_000),
      taxRateBp: z.number().int().min(0).max(3000),
    }))
    .mutation(({ input, ctx }) => addFolioCharge({ ...input, userId: ctx.user.id })),

  adminAddFolioPayment: adminProcedure
    .input(z.object({
      reservationId: z.number().int(),
      method: z.enum(FOLIO_PAYMENT_METHODS),
      amountCents: z.number().int().min(1).max(100_000_000),
      description: z.string().max(255).optional(),
    }))
    .mutation(({ input, ctx }) => addFolioPayment({ ...input, userId: ctx.user.id })),

  adminDeleteFolioItem: adminProcedure
    .input(z.object({ reservationId: z.number().int(), itemId: z.number().int() }))
    .mutation(({ input }) => deleteFolioItem(input)),

  /** Cierra el folio (saldo 0) y emite su factura con la numeración de la empresa. */
  adminCloseFolio: adminProcedure
    .input(z.object({
      reservationId: z.number().int(),
      clientName: z.string().max(256).optional(),
      clientNif: z.string().max(32).optional(),
      clientAddress: z.string().max(500).optional(),
    }))
    .mutation(({ input, ctx }) => closeFolio({ ...input, userId: ctx.user.id })),

  adminGetPmsSettings: adminProcedure.query(() => getPmsSettings()),

  /** IVA del alojamiento de la empresa (por defecto 10 %). */
  adminSetPmsSettings: adminProcedure
    .input(z.object({ accommodationTaxBp: z.number().int() }))
    .mutation(({ input, ctx }) => {
      const bp = normalizeTaxBp(input.accommodationTaxBp);
      if (bp === null) throw new TRPCError({ code: "BAD_REQUEST", message: "IVA no válido (entre 0 % y 30 %)" });
      return setPmsSettings({ accommodationTaxBp: bp, userId: ctx.user.id });
    }),

  // ── ADMIN: PMS · CIERRE DEL DÍA E INFORMES ────────────────────────────────

  /** Ocupación, ingresos de alojamiento, ADR y RevPAR por día del rango, con el resumen y los cierres guardados. */
  adminGetReport: adminProcedure
    .input(dateRange(370))
    .query(({ input }) => getHotelReport(input.from, input.to)),

  /** «Cerrar día»: guarda los indicadores del día (repetirlo los recalcula). */
  adminRunNightAudit: adminProcedure
    .input(z.object({ businessDate: isoDate }))
    .mutation(({ input, ctx }) => runNightAudit(input.businessDate, { userId: ctx.user.id, source: "manual" })),

  // ── ADMIN: PMS · HOUSEKEEPING ─────────────────────────────────────────────

  adminHkAssignees: adminProcedure.query(() => listHousekeepingAssignees()),

  adminHkTasks: adminProcedure
    .input(z.object({ date: isoDate, assignedUserId: z.number().int().optional() }))
    .query(({ input }) => listHousekeepingTasks(input.date, { assignedUserId: input.assignedUserId })),

  /** Genera las tareas del día (salidas → limpieza de salida; ocupadas → repaso; sucias → limpieza). Idempotente. */
  adminHkGenerateTasks: adminProcedure
    .input(z.object({ date: isoDate }))
    .mutation(({ input, ctx }) => generateHousekeepingTasks(input.date, ctx.user.id)),

  adminHkCreateTask: adminProcedure
    .input(z.object({ hotelRoomId: z.number().int(), date: isoDate, kind: z.enum(HK_TASK_KINDS), assignedUserId: z.number().int().nullable(), notes: z.string().max(500).optional() }))
    .mutation(({ input, ctx }) => createHousekeepingTask({ ...input, userId: ctx.user.id })),

  adminHkAssignTask: adminProcedure
    .input(z.object({ taskId: z.number().int(), assignedUserId: z.number().int().nullable() }))
    .mutation(({ input }) => assignHousekeepingTask(input.taskId, input.assignedUserId)),

  adminHkIncidentTypes: adminProcedure.query(() => listIncidentTypes()),

  adminHkSaveIncidentType: adminProcedure
    .input(z.object({ id: z.number().int().optional(), name: z.string().max(80), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() }))
    .mutation(({ input }) => saveIncidentType(input)),

  adminHkIncidents: adminProcedure
    .input(z.object({ status: z.enum([...INCIDENT_STATUSES, "abiertas"]).optional(), hotelRoomId: z.number().int().optional() }).optional())
    .query(({ input }) => listRoomIncidents(input ?? {})),

  adminHkSetIncidentStatus: adminProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(INCIDENT_STATUSES) }))
    .mutation(({ input, ctx }) => setRoomIncidentStatus({ ...input, userId: ctx.user.id })),

  // ── PERSONAL: PMS · HOUSEKEEPING (vista por persona) ──────────────────────

  /** Tareas del día de quien entra (y si puede gestionar el hotel, para mostrarle la vista completa). */
  hkMyTasks: hotelStaffProcedure
    .input(z.object({ date: isoDate }))
    .query(async ({ input, ctx }) => ({
      canManage: ctx.canManageHotel,
      tasks: await listHousekeepingTasks(input.date, { assignedUserId: ctx.user.id }),
    })),

  /** Cambia el estado de una tarea: la persona asignada (en curso, hecha) o quien gestiona (también inspeccionar). */
  hkSetTaskStatus: hotelStaffProcedure
    .input(z.object({ taskId: z.number().int(), to: z.enum(HK_TASK_STATUSES), notes: z.string().max(500).optional() }))
    .mutation(({ input, ctx }) => setHousekeepingTaskStatus({ taskId: input.taskId, to: input.to, notes: input.notes, actor: { userId: ctx.user.id, canManage: ctx.canManageHotel } })),

  /** Tipos de incidencia activos (para el formulario del personal). */
  hkIncidentTypes: hotelStaffProcedure.query(async () => (await listIncidentTypes()).filter((t) => t.isActive)),

  /** Abre una incidencia de habitación (personal o recepción); puede bloquear la habitación. */
  hkReportIncident: hotelStaffProcedure
    .input(z.object({ hotelRoomId: z.number().int(), typeId: z.number().int(), description: z.string().max(1000).optional(), priority: z.enum(INCIDENT_PRIORITIES).default("media"), blocksRoom: z.boolean().default(false) }))
    .mutation(({ input, ctx }) => createRoomIncident({ ...input, userId: ctx.user.id })),

  // ── ADMIN: PMS · FICHAS DE HUÉSPED (RD 933/2021) ──────────────────────────
  // Datos personales: solo quien gestiona el hotel (adminProcedure). Sin rutas públicas ni check-in en línea.

  /** Huéspedes de la reserva (titular y acompañantes) con lo que falta para el registro de viajeros. */
  adminGetStayGuests: adminProcedure
    .input(z.object({ reservationId: z.number().int() }))
    .query(({ input }) => listStayGuests(input.reservationId)),

  adminSaveStayGuest: adminProcedure
    .input(z.object({ reservationId: z.number().int(), guestId: z.number().int().nullable().optional(), isLead: z.boolean(), kinship: guestOpt(40), guest: guestFields }))
    .mutation(({ input, ctx }) => saveStayGuest({ reservationId: input.reservationId, guestId: input.guestId, isLead: input.isLead, kinship: input.kinship, guest: toGuestInput(input.guest), userId: ctx.user.id })),

  adminRemoveStayGuest: adminProcedure
    .input(z.object({ reservationId: z.number().int(), guestId: z.number().int() }))
    .mutation(({ input }) => removeStayGuest(input.reservationId, input.guestId)),

  adminSearchGuests: adminProcedure
    .input(z.object({ q: z.string().max(100).default("") }))
    .query(({ input }) => searchGuests(input.q)),

  adminGetGuest: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => guestDetail(input.id)),

  adminUpdateGuest: adminProcedure
    .input(z.object({ id: z.number().int(), guest: guestFields, notes: z.string().max(1000).nullable().optional() }))
    .mutation(({ input, ctx }) => updateGuest(input.id, toGuestInput(input.guest), input.notes ?? null, ctx.user.id)),

  adminGetGuestSettings: adminProcedure.query(() => getGuestSettings()),

  /** Conservación de las fichas (meses tras la última estancia; null = desactivada, el valor por defecto). */
  adminSetGuestSettings: adminProcedure
    .input(z.object({ retentionMonths: z.number().int().nullable() }))
    .mutation(({ input, ctx }) => {
      const why = retentionError(input.retentionMonths);
      if (why) throw new TRPCError({ code: "BAD_REQUEST", message: why });
      return setGuestSettings(input.retentionMonths, ctx.user.id);
    }),

  /** Aplica ahora la conservación configurada (sin plazo configurado no hace nada). */
  adminRunGuestRetention: adminProcedure.mutation(() => anonymizeExpiredGuests(todayInTimeZone())),

  // ── ADMIN: PMS · PLANES DE TARIFA ─────────────────────────────────────────

  adminListRatePlans: adminProcedure
    .input(z.object({ roomTypeId: z.number().int().optional() }).optional())
    .query(({ input }) => listRatePlans(input?.roomTypeId)),

  /** Alta o cambio de un plan de la tipología: ajuste en % (puntos básicos) o fijo por noche (céntimos). */
  adminSaveRatePlan: adminProcedure
    .input(z.object({
      id: z.number().int().optional(), roomTypeId: z.number().int(), code: z.string().max(32).nullable().optional(), name: z.string().max(120),
      description: z.string().max(255).nullable().optional(), refundable: z.boolean(), includesBreakfast: z.boolean(), adjustType: z.enum(ADJUST_TYPES),
      adjustValue: z.number().int(), sortOrder: z.number().int().min(0).max(1000).default(0), isActive: z.boolean().default(true),
    }))
    .mutation(({ input }) => {
      const why = ratePlanError(input);
      if (why) throw new TRPCError({ code: "BAD_REQUEST", message: why });
      return saveRatePlan({ ...input, code: input.code ?? null, description: input.description ?? null });
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
      /** Plan de tarifa de la tipología (opcional: sin él, el precio de siempre). */
      ratePlanId: z.number().int().optional(),
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
      const nightCents: number[] = [];
      for (let i = 0; i < nights; i++) {
        const d = new Date(checkInDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const night = resolveNightlyPrice(rates, seasons, String(room.basePrice ?? 0), dateStr);
        totalEuros += night;
        nightCents.push(Math.round(night * 100));
      }
      // Plan de tarifa elegido en la web (solo si se indica: sin él, todo igual que siempre)
      const ratePlan = input.ratePlanId != null ? await ratePlanForBooking(input.roomTypeId, input.ratePlanId) : null;
      if (ratePlan) totalEuros = applyPlanToStay(nightCents, ratePlan) / 100;
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
        ...(ratePlan ? { ratePlan: { id: ratePlan.id, name: ratePlan.name, refundable: ratePlan.refundable, includesBreakfast: ratePlan.includesBreakfast } } : {}),
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
