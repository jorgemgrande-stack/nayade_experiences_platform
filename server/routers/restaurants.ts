import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getAllRestaurants, getRestaurantBySlug, getRestaurantById,
  createRestaurant, updateRestaurant,
  getShiftsByRestaurant, getAllShiftsByRestaurant, createShift, updateShift, deleteShift,
  getClosuresByRestaurant, createClosure, deleteClosure,
  getAvailability,
  createBooking, getBookingByLocator, getBookingById, updateBooking, getBookings, getBookingsByDate,
  addBookingLog, getBookingLogs,
  getDashboardStats,
  getRestaurantsByUser, assignStaff, removeStaff,
} from "../restaurantsDb";
import { notifyOwner } from "../_core/notification";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function assertRestaurantAccess(ctx: any, restaurantId: number) {
  if (ctx.user.role === "admin") return; // admin global tiene acceso a todo
  if (ctx.user.role === "adminrest") {
    const allowed = await getRestaurantsByUser(ctx.user.id);
    if (!allowed.includes(restaurantId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este restaurante" });
    }
    return;
  }
  throw new TRPCError({ code: "FORBIDDEN" });
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const restaurantsRouter = router({

  // ── PÚBLICO ──────────────────────────────────────────────────────────────

  /** Listado público de restaurantes activos */
  getAll: publicProcedure.query(async () => {
    return getAllRestaurants(true);
  }),

  /** Detalle de un restaurante por slug */
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const r = await getRestaurantBySlug(input.slug);
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      return r;
    }),

  /** Disponibilidad de un restaurante para una fecha */
  getAvailability: publicProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return getAvailability(input.restaurantId, input.date);
    }),

  /** Turnos activos de un restaurante */
  getShifts: publicProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return getShiftsByRestaurant(input.restaurantId);
    }),

  /** Crear reserva (público — sin autenticación) */
  createBooking: publicProcedure
    .input(z.object({
      restaurantId: z.number(),
      shiftId: z.number(),
      date: z.string(),
      time: z.string(),
      guests: z.number().min(1).max(30),
      guestName: z.string().min(1),
      guestLastName: z.string().optional(),
      guestEmail: z.string().email(),
      guestPhone: z.string().optional(),
      highchair: z.boolean().optional(),
      allergies: z.string().optional(),
      birthday: z.boolean().optional(),
      specialRequests: z.string().optional(),
      accessibility: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const restaurant = await getRestaurantById(input.restaurantId);
      if (!restaurant) throw new TRPCError({ code: "NOT_FOUND", message: "Restaurante no encontrado" });
      if (!restaurant.acceptsOnlineBooking) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este restaurante no acepta reservas online" });
      }

      // Verificar disponibilidad
      const availability = await getAvailability(input.restaurantId, input.date);
      const shift = availability.find(s => s.shiftId === input.shiftId);
      if (!shift) throw new TRPCError({ code: "BAD_REQUEST", message: "Turno no disponible" });
      if (shift.available < input.guests) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Solo quedan ${shift.available} plazas disponibles` });
      }

      const depositAmount = (Number(restaurant.depositPerGuest) * input.guests).toFixed(2);

      const { locator } = await createBooking({
        restaurantId: input.restaurantId,
        shiftId: input.shiftId,
        date: input.date,
        time: input.time,
        guests: input.guests,
        depositAmount,
        guestName: input.guestName,
        guestLastName: input.guestLastName,
        guestEmail: input.guestEmail,
        guestPhone: input.guestPhone,
        highchair: input.highchair ?? false,
        allergies: input.allergies,
        birthday: input.birthday ?? false,
        specialRequests: input.specialRequests,
        accessibility: input.accessibility ?? false,
        isVip: false,
        status: "pending_payment",
        channel: "web",
        paymentStatus: "pending",
      });

      // Notificar al owner
      await notifyOwner({
        title: `Nueva reserva restaurante: ${restaurant.name}`,
        content: `Localizador: ${locator} | ${input.guestName} | ${input.guests} personas | ${input.date} ${input.time}`,
      });

      return { locator, depositAmount };
    }),

  /** Consultar reserva por localizador (para página de confirmación) */
  getBookingByLocator: publicProcedure
    .input(z.object({ locator: z.string() }))
    .query(async ({ input }) => {
      const booking = await getBookingByLocator(input.locator);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      return booking;
    }),

  // ── ADMIN / ADMINREST ────────────────────────────────────────────────────

  /** Dashboard de un restaurante */
  getDashboard: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getDashboardStats(input.restaurantId);
    }),

  /** Listado de reservas con filtros */
  adminGetBookings: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      date: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getBookings(input);
    }),

  /** Reservas de un día concreto */
  adminGetBookingsByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getBookingsByDate(input.restaurantId, input.date);
    }),

  /** Detalle de una reserva */
  adminGetBooking: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const booking = await getBookingById(input.id);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      const logs = await getBookingLogs(input.id);
      return { booking, logs };
    }),

  /** Actualizar estado de una reserva */
  adminUpdateBookingStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["confirmed", "cancelled", "modified", "no_show", "completed"]),
      cancellationReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const booking = await getBookingById(input.id);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(input.id, {
        status: input.status,
        cancellationReason: input.cancellationReason,
      });
      await addBookingLog(input.id, `status_changed_to_${input.status}`,
        input.cancellationReason, ctx.user.id);
      return { ok: true };
    }),

  /** Crear reserva manual desde admin */
  adminCreateBooking: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      shiftId: z.number(),
      date: z.string(),
      time: z.string(),
      guests: z.number().min(1),
      guestName: z.string().min(1),
      guestLastName: z.string().optional(),
      guestEmail: z.string().email(),
      guestPhone: z.string().optional(),
      highchair: z.boolean().optional(),
      allergies: z.string().optional(),
      birthday: z.boolean().optional(),
      specialRequests: z.string().optional(),
      accessibility: z.boolean().optional(),
      isVip: z.boolean().optional(),
      status: z.enum(["confirmed", "pending_payment"]).default("confirmed"),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      const restaurant = await getRestaurantById(input.restaurantId);
      if (!restaurant) throw new TRPCError({ code: "NOT_FOUND" });
      const depositAmount = (Number(restaurant.depositPerGuest) * input.guests).toFixed(2);
      const { locator } = await createBooking({
        ...input,
        depositAmount,
        channel: "admin",
        createdByUserId: ctx.user.id,
        paymentStatus: input.status === "confirmed" ? "paid" : "pending",
        isVip: input.isVip ?? false,
        highchair: input.highchair ?? false,
        birthday: input.birthday ?? false,
        accessibility: input.accessibility ?? false,
      });
      await addBookingLog((await getBookingByLocator(locator))!.id,
        "created_by_admin", `Por ${ctx.user.name}`, ctx.user.id);
      return { locator };
    }),

  /** Editar datos de una reserva */
  adminEditBooking: protectedProcedure
    .input(z.object({
      id: z.number(),
      guestName: z.string().optional(),
      guestLastName: z.string().optional(),
      guestEmail: z.string().email().optional(),
      guestPhone: z.string().optional(),
      guests: z.number().optional(),
      date: z.string().optional(),
      time: z.string().optional(),
      shiftId: z.number().optional(),
      highchair: z.boolean().optional(),
      allergies: z.string().optional(),
      birthday: z.boolean().optional(),
      specialRequests: z.string().optional(),
      accessibility: z.boolean().optional(),
      isVip: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const booking = await getBookingById(id);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(id, data);
      await addBookingLog(id, "edited_by_admin", `Por ${ctx.user.name}`, ctx.user.id);
      return { ok: true };
    }),

  /** Turnos de un restaurante (admin) */
  adminGetShifts: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getAllShiftsByRestaurant(input.restaurantId);
    }),

  /** Crear turno */
  adminCreateShift: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      maxCapacity: z.number().min(1),
      daysOfWeek: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return createShift({ ...input, daysOfWeek: input.daysOfWeek ?? [0,1,2,3,4,5,6] });
    }),

  /** Actualizar turno */
  adminUpdateShift: protectedProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      name: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      maxCapacity: z.number().optional(),
      daysOfWeek: z.array(z.number()).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, restaurantId, ...data } = input;
      await assertRestaurantAccess(ctx, restaurantId);
      return updateShift(id, data);
    }),

  /** Eliminar turno */
  adminDeleteShift: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return deleteShift(input.id);
    }),

  /** Cierres de un restaurante */
  adminGetClosures: protectedProcedure
    .input(z.object({ restaurantId: z.number(), fromDate: z.string().optional(), toDate: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getClosuresByRestaurant(input.restaurantId, input.fromDate, input.toDate);
    }),

  /** Crear cierre */
  adminCreateClosure: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      date: z.string(),
      shiftId: z.number().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return createClosure(input.restaurantId, input.date, input.shiftId, input.reason);
    }),

  /** Eliminar cierre */
  adminDeleteClosure: protectedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return deleteClosure(input.id);
    }),

  // ── SOLO ADMIN GLOBAL ────────────────────────────────────────────────────

  /** Listado completo de restaurantes (admin) */
  adminGetAll: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return getAllRestaurants(false);
  }),

  /** Crear restaurante */
  adminCreate: protectedProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      shortDesc: z.string().optional(),
      longDesc: z.string().optional(),
      cuisine: z.string().optional(),
      heroImage: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      location: z.string().optional(),
      badge: z.string().optional(),
      depositPerGuest: z.string().optional(),
      maxGroupSize: z.number().optional(),
      cancellationHours: z.number().optional(),
      cancellationPolicy: z.string().optional(),
      legalText: z.string().optional(),
      operativeEmail: z.string().optional(),
      acceptsOnlineBooking: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return createRestaurant(input as any);
    }),

  /** Actualizar restaurante */
  adminUpdate: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      shortDesc: z.string().optional(),
      longDesc: z.string().optional(),
      cuisine: z.string().optional(),
      heroImage: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      location: z.string().optional(),
      badge: z.string().optional(),
      depositPerGuest: z.string().optional(),
      maxGroupSize: z.number().optional(),
      cancellationHours: z.number().optional(),
      cancellationPolicy: z.string().optional(),
      legalText: z.string().optional(),
      operativeEmail: z.string().optional(),
      acceptsOnlineBooking: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { id, ...data } = input;
      return updateRestaurant(id, data as any);
    }),

  /** Asignar staff adminrest a un restaurante */
  adminAssignStaff: protectedProcedure
    .input(z.object({ userId: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return assignStaff(input.userId, input.restaurantId);
    }),

  /** Quitar staff de un restaurante */
  adminRemoveStaff: protectedProcedure
    .input(z.object({ userId: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return removeStaff(input.userId, input.restaurantId);
    }),

  /** Reservas de un día (calendario visual) */
  adminGetCalendar: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getBookingsByDate(input.restaurantId, input.date);
    }),

  /** Añadir nota interna a una reserva */
  adminAddNote: protectedProcedure
    .input(z.object({ bookingId: z.number(), note: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const booking = await getBookingById(input.bookingId);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(input.bookingId, { adminNotes: input.note } as any);
      await addBookingLog(input.bookingId, "note_added", input.note, ctx.user.id);
      return { ok: true };
    }),

  /** Actualizar configuración de un restaurante */
  adminUpdateConfig: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      acceptsOnlineBooking: z.boolean().optional(),
      depositPerGuest: z.string().optional(),
      maxGroupSize: z.number().optional(),
      cancellationPolicy: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      const { restaurantId, ...data } = input;
      await updateRestaurant(restaurantId, data as any);
      return { ok: true };
    }),

  /** Eliminar reserva */
  adminDeleteBooking: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const booking = await getBookingById(input.bookingId);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(input.bookingId, { status: "cancelled" });
      await addBookingLog(input.bookingId, "deleted_by_admin", "Eliminada por admin", ctx.user.id);
      return { ok: true };
    }),

  /** Restaurantes asignados al usuario actual (para adminrest) */
  myRestaurants: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "admin") return getAllRestaurants(false);
    if (ctx.user.role === "adminrest") {
      const ids = await getRestaurantsByUser(ctx.user.id);
      const all = await getAllRestaurants(false);
      return all.filter(r => ids.includes(r.id));
    }
    throw new TRPCError({ code: "FORBIDDEN" });
  }),
});
