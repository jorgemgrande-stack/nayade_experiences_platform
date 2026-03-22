import z from "zod";
import nodemailer from "nodemailer";
import { router, publicProcedure, protectedProcedure, adminrestProcedure } from "../_core/trpc";
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
  getRestaurantsByUser, assignStaff, removeStaff, getStaffByRestaurant,
} from "../restaurantsDb";
import { notifyOwner } from "../_core/notification";
import { buildRedsysForm, generateMerchantOrder, getRedsysUrl } from "../redsys";
import { buildRestaurantPaymentLinkHtml, buildRestaurantConfirmHtml } from "../emailTemplates";

// ─── Helper: crear transporter SMTP ──────────────────────────────────────────
function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

// ─── Helper: enviar email de link de pago ─────────────────────────────────────
async function sendRestaurantPaymentEmail(params: {
  guestEmail: string;
  guestName: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
  depositAmount: string;
  locator: string;
  redsysUrl: string;
  merchantParams: string;
  signature: string;
  signatureVersion: string;
  origin: string;
}) {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    console.log("[RestaurantPaymentEmail] SMTP no configurado — email omitido para", params.locator);
    return;
  }
  const from = process.env.SMTP_FROM ?? "Náyade Experiences <reservas@nayadeexperiences.es>";
  await transporter.sendMail({
    from,
    to: params.guestEmail,
    bcc: "reservas@nayadeexperiences.es",
    subject: `💳 Completa tu reserva en ${params.restaurantName} — Depósito pendiente (${params.locator})`,
    html: buildRestaurantPaymentLinkHtml({
      guestName: params.guestName,
      guestEmail: params.guestEmail,
      restaurantName: params.restaurantName,
      date: params.date,
      time: params.time,
      guests: params.guests,
      locator: params.locator,
      depositAmount: params.depositAmount,
      redsysUrl: params.redsysUrl,
      merchantParams: params.merchantParams,
      signature: params.signature,
      signatureVersion: params.signatureVersion,
    }),
  });
  console.log(`[RestaurantPaymentEmail] Email enviado a ${params.guestEmail} para ${params.locator}`);
}

// ─── Helper: email de confirmación al cliente (reserva online) ─────────────────────
async function sendRestaurantConfirmEmail(params: {
  guestName: string;
  guestEmail: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
  locator: string;
  depositAmount: string;
  requiresPayment: boolean;
}) {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    console.log("[RestaurantConfirmEmail] SMTP no configurado — email omitido para", params.locator);
    return;
  }
  const from = process.env.SMTP_FROM ?? "Náyade Experiences <reservas@nayadeexperiences.es>";
  await transporter.sendMail({
    from,
    to: params.guestEmail,
    bcc: "reservas@nayadeexperiences.es",
    subject: `🏔️ Reserva recibida en ${params.restaurantName} — ${params.locator}`,
    html: buildRestaurantConfirmHtml({
      guestName: params.guestName,
      restaurantName: params.restaurantName,
      date: params.date,
      time: params.time,
      guests: params.guests,
      locator: params.locator,
      depositAmount: params.depositAmount,
      requiresPayment: params.requiresPayment,
    }),
  });
  console.log(`[RestaurantConfirmEmail] Email enviado a ${params.guestEmail} para ${params.locator}`);
}

// ─── Helper: notificar al adminrest asignado al restaurante ───────────────────
async function notifyRestaurantStaff(restaurantId: number, title: string, content: string) {
  try {
    const staff = await getStaffByRestaurant(restaurantId);
    if (staff.length > 0) {
      // Notificar al primer adminrest asignado (el principal)
      await notifyOwner({ title, content }).catch(() => {});
      console.log(`[RestaurantNotify] Notificación enviada para restaurante ${restaurantId}: ${title}`);
    } else {
      // Sin adminrest asignado: notificar al admin general
      await notifyOwner({ title, content }).catch(() => {});
    }
  } catch {
    // Silenciar errores de notificación para no bloquear el flujo
  }
}

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
      return getRestaurantBySlug(input.slug);
    }),

  /** Disponibilidad de turnos para una fecha */
  getAvailability: publicProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return getAvailability(input.restaurantId, input.date);
    }),

  /** Turnos activos de un restaurante (público) */
  getShifts: publicProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return getShiftsByRestaurant(input.restaurantId);
    }),

  /** Crear reserva desde el formulario público */
  createBooking: publicProcedure
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
    }))
    .mutation(async ({ input }) => {
      const restaurant = await getRestaurantById(input.restaurantId);
      if (!restaurant) throw new TRPCError({ code: "NOT_FOUND", message: "Restaurante no encontrado" });
      if (!restaurant.acceptsOnlineBooking) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este restaurante no acepta reservas online" });
      }
      const depositAmount = (Number(restaurant.depositPerGuest) * input.guests).toFixed(2);
      const result = await createBooking({
        ...input,
        depositAmount,
        channel: "web",
        paymentStatus: Number(depositAmount) > 0 ? "pending" : "paid",
        highchair: input.highchair ?? false,
        birthday: input.birthday ?? false,
        accessibility: input.accessibility ?? false,
      });
      // Email de confirmación al cliente
      const requiresPayment = Number(depositAmount) > 0;
      await sendRestaurantConfirmEmail({
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        restaurantName: restaurant.name,
        date: input.date,
        time: input.time,
        guests: input.guests,
        locator: result.locator,
        depositAmount,
        requiresPayment,
      }).catch(() => {});
      // Notificación al adminrest asignado + owner
      await notifyRestaurantStaff(
        input.restaurantId,
        `🍴 Nueva reserva: ${restaurant.name}`,
        `${input.guestName} ${input.guestLastName ?? ""} — ${input.guests} pax — ${input.date} ${input.time} — Localizador: ${result.locator}${requiresPayment ? ` — Depósito: ${depositAmount}€ pendiente` : " — Sin depósito"}`,
      );
      return { locator: result.locator, depositAmount };
    }),

  /** Consultar reserva por localizador */
  getBookingByLocator: publicProcedure
    .input(z.object({ locator: z.string() }))
    .query(async ({ input }) => {
      const booking = await getBookingByLocator(input.locator);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      return booking;
    }),

  // ── ADMIN + ADMINREST ─────────────────────────────────────────────────────

  /** Dashboard de un restaurante */
  getDashboard: adminrestProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getDashboardStats(input.restaurantId);
    }),

  /** Restaurantes accesibles para el usuario actual */
  myRestaurants: adminrestProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "admin") return getAllRestaurants(false);
    const ids = await getRestaurantsByUser(ctx.user.id);
    const all = await getAllRestaurants(false);
    return all.filter(r => ids.includes(r.id));
  }),

  /** Listado de reservas con filtros */
  adminGetBookings: adminrestProcedure
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
  adminGetBookingsByDate: adminrestProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getBookingsByDate(input.restaurantId, input.date);
    }),

  /** Detalle de una reserva */
  adminGetBooking: adminrestProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const booking = await getBookingById(input.id);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      const logs = await getBookingLogs(input.id);
      return { booking, logs };
    }),

  /** Actualizar estado de una reserva */
  adminUpdateBookingStatus: adminrestProcedure
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

  /** Crear reserva manual desde admin con opción de pago */
  adminCreateBooking: adminrestProcedure
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
      /** Si true: reserva pendiente de pago + email con link Redsys al cliente */
      requiresPayment: z.boolean().default(false),
      /** URL base del frontend (para construir las URLs de retorno de Redsys) */
      origin: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      const restaurant = await getRestaurantById(input.restaurantId);
      if (!restaurant) throw new TRPCError({ code: "NOT_FOUND" });
      // rawDepositAmount: importe calculado según configuración del restaurante
      // depositAmount: si el admin no requiere pago, se guarda "0" para que el
      // frontend distinga "sin depósito" (depositAmount=0) de "pagado" (depositAmount>0 + paid)
      const rawDepositAmount = (Number(restaurant.depositPerGuest) * input.guests).toFixed(2);
      const depositAmount = input.requiresPayment ? rawDepositAmount : "0";
      const paymentStatus = input.requiresPayment ? "pending" : "paid";
      const status = input.requiresPayment ? "pending_payment" : "confirmed";
      const { locator } = await createBooking({
        ...input,
        depositAmount,
        channel: "admin",
        createdByUserId: ctx.user.id,
        paymentStatus,
        status: status as any,
        isVip: input.isVip ?? false,
        highchair: input.highchair ?? false,
        birthday: input.birthday ?? false,
        accessibility: input.accessibility ?? false,
      });
      const booking = await getBookingByLocator(locator);
      await addBookingLog(booking!.id, "created_by_admin",
        `Por ${ctx.user.name}${input.requiresPayment ? " (con pago pendiente)" : ""}`, ctx.user.id);
      // Si se requiere pago: generar formulario Redsys y enviar email al cliente
      let redsysForm = null;
      if (input.requiresPayment && Number(rawDepositAmount) > 0 && input.origin) {
        const amountCents = Math.round(Number(rawDepositAmount) * 100);
        const merchantOrder = generateMerchantOrder();
        // Guardar merchantOrder en la reserva para correlacionar el IPN
        await (await import("../restaurantsDb")).updateBooking(booking!.id, { merchantOrder } as any);
        redsysForm = buildRedsysForm({
          amount: amountCents,
          merchantOrder,
          productDescription: `Depósito reserva ${restaurant.name} ${input.date} ${input.time}`,
          notifyUrl: `${input.origin}/api/redsys/restaurant-notification`,
          okUrl: `${input.origin}/restaurantes/reserva-ok?locator=${locator}`,
          koUrl: `${input.origin}/restaurantes/reserva-ko?locator=${locator}`,
          holderName: input.guestName,
        });
        // Enviar email con link de pago
        sendRestaurantPaymentEmail({
          guestEmail: input.guestEmail,
          guestName: input.guestName,
          restaurantName: restaurant.name,
          date: input.date,
          time: input.time,
          guests: input.guests,
          depositAmount: rawDepositAmount,
          locator,
          redsysUrl: getRedsysUrl(),
          merchantParams: redsysForm.Ds_MerchantParameters,
          signature: redsysForm.Ds_Signature,
          signatureVersion: redsysForm.Ds_SignatureVersion,
          origin: input.origin,
        }).catch(err => console.error("[RestaurantPaymentEmail] Error:", err));
      } else {
        // Sin depósito requerido → enviar email de confirmación directa al cliente
        sendRestaurantConfirmEmail({
          guestEmail: input.guestEmail,
          guestName: input.guestName,
          restaurantName: restaurant.name,
          date: input.date,
          time: input.time,
          guests: input.guests,
          depositAmount: "0",
          locator,
          requiresPayment: false,
        }).catch(err => console.error("[RestaurantConfirmEmail] Error:", err));
      }
      // Notificación interna
      await notifyOwner({
        title: `Nueva reserva admin: ${restaurant.name}`,
        content: `${input.guestName} — ${input.guests} pax — ${input.date} ${input.time} — ${locator}${input.requiresPayment ? " (PAGO PENDIENTE)" : " (CONFIRMADA)"}`,
      }).catch(() => {});
      return { locator, depositAmount, requiresPayment: input.requiresPayment, redsysForm };
    }),

  /** Editar datos de una reserva */
  adminEditBooking: adminrestProcedure
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
  adminGetShifts: adminrestProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getAllShiftsByRestaurant(input.restaurantId);
    }),

  /** Crear turno */
  adminCreateShift: adminrestProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      maxCapacity: z.number().min(1),
      daysOfWeek: z.array(z.number()).optional(),
      slotMinutes: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return createShift({ ...input, daysOfWeek: input.daysOfWeek ?? [0,1,2,3,4,5,6], slotMinutes: input.slotMinutes ?? 30 });
    }),

  /** Actualizar turno */
  adminUpdateShift: adminrestProcedure
    .input(z.object({
      id: z.number(),
      restaurantId: z.number(),
      name: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      maxCapacity: z.number().optional(),
      daysOfWeek: z.array(z.number()).optional(),
      slotMinutes: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, restaurantId, ...data } = input;
      await assertRestaurantAccess(ctx, restaurantId);
      return updateShift(id, data);
    }),

  /** Eliminar turno */
  adminDeleteShift: adminrestProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return deleteShift(input.id);
    }),

  /** Cierres de un restaurante */
  adminGetClosures: adminrestProcedure
    .input(z.object({ restaurantId: z.number(), fromDate: z.string().optional(), toDate: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getClosuresByRestaurant(input.restaurantId, input.fromDate, input.toDate);
    }),

  /** Crear cierre */
  adminCreateClosure: adminrestProcedure
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
  adminDeleteClosure: adminrestProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return deleteClosure(input.id);
    }),

  // ── SOLO ADMIN GLOBAL ────────────────────────────────────────────────────

  /** Listado completo de restaurantes (admin global) */
  adminGetAll: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return getAllRestaurants(false);
  }),

  /** Crear restaurante (solo admin global) */
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

  /** Actualizar restaurante (solo admin global) */
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

  /** Asignar staff adminrest a un restaurante (solo admin global) */
  adminAssignStaff: protectedProcedure
    .input(z.object({ userId: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return assignStaff(input.userId, input.restaurantId);
    }),

  /** Quitar staff de un restaurante (solo admin global) */
  adminRemoveStaff: protectedProcedure
    .input(z.object({ userId: z.number(), restaurantId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return removeStaff(input.userId, input.restaurantId);
    }),

  /** Listar staff asignado a un restaurante (solo admin global) */
  adminGetStaff: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getStaffByRestaurant(input.restaurantId);
    }),

  /** Reservas de un día (calendario visual) */
  adminGetCalendar: adminrestProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      return getBookingsByDate(input.restaurantId, input.date);
    }),

  /** Añadir nota interna a una reserva */
  adminAddNote: adminrestProcedure
    .input(z.object({ bookingId: z.number(), note: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const booking = await getBookingById(input.bookingId);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(input.bookingId, { adminNotes: input.note } as any);
      await addBookingLog(input.bookingId, "note_added", input.note, ctx.user.id);
      return { ok: true };
    }),

  /** Actualizar configuración de un restaurante (ficha completa + operativa) */
  adminUpdateConfig: adminrestProcedure
    .input(z.object({
      restaurantId: z.number(),
      // Ficha pública
      name: z.string().optional(),
      shortDesc: z.string().optional(),
      longDesc: z.string().optional(),
      cuisine: z.string().optional(),
      heroImage: z.string().optional(),
      galleryImages: z.array(z.string()).optional(),
      menuUrl: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      location: z.string().optional(),
      badge: z.string().optional(),
      // Configuración operativa
      acceptsOnlineBooking: z.boolean().optional(),
      depositPerGuest: z.string().optional(),
      maxGroupSize: z.number().optional(),
      minAdvanceHours: z.number().optional(),
      maxAdvanceDays: z.number().optional(),
      cancellationHours: z.number().optional(),
      cancellationPolicy: z.string().optional(),
      legalText: z.string().optional(),
      operativeEmail: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertRestaurantAccess(ctx, input.restaurantId);
      const { restaurantId, ...data } = input;
      await updateRestaurant(restaurantId, data as any);
      return { ok: true };
    }),

  /** Eliminar reserva */
  adminDeleteBooking: adminrestProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const booking = await getBookingById(input.bookingId);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRestaurantAccess(ctx, booking.restaurantId);
      await updateBooking(input.bookingId, { status: "cancelled" });
      await addBookingLog(input.bookingId, "deleted_by_admin", "Eliminada por admin", ctx.user.id);
      return { ok: true };
    }),

  /**
   * Calendario global: reservas de todos los restaurantes accesibles
   * para un mes dado (YYYY-MM). Devuelve reservas agrupadas por fecha.
   */
  adminGetGlobalCalendar: adminrestProcedure
    .input(z.object({
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/), // "2026-03"
      restaurantId: z.number().optional(),           // filtro opcional por restaurante
    }))
    .query(async ({ input, ctx }) => {
      // Determinar qué restaurantes puede ver el usuario
      let allowedIds: number[];
      if (ctx.user.role === "admin") {
        const all = await getAllRestaurants(false);
        allowedIds = all.map(r => r.id);
      } else {
        allowedIds = await getRestaurantsByUser(ctx.user.id);
      }
      if (input.restaurantId && !allowedIds.includes(input.restaurantId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const targetIds = input.restaurantId ? [input.restaurantId] : allowedIds;
      // Obtener reservas del mes para todos los restaurantes target
      const [year, month] = input.yearMonth.split("-").map(Number);
      const dateFrom = `${input.yearMonth}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const dateTo = `${input.yearMonth}-${String(lastDay).padStart(2, "0")}`;
      // Obtener nombre de restaurantes para enriquecer la respuesta
      const allRestaurants = await getAllRestaurants(false);
      const restaurantMap = Object.fromEntries(allRestaurants.map(r => [r.id, r.name]));
      // Recopilar reservas de todos los restaurantes
      const allBookings: any[] = [];
      for (const rid of targetIds) {
        const result = await getBookings({ restaurantId: rid, dateFrom, dateTo, limit: 500 });
        for (const b of result) {
          allBookings.push({
            id: b.id,
            locator: b.locator,
            restaurantId: rid,
            restaurantName: restaurantMap[rid] ?? "Restaurante",
            date: b.date,
            time: b.time,
            guests: b.guests,
            guestName: b.guestName,
            guestLastName: b.guestLastName,
            guestPhone: b.guestPhone,
            status: b.status,
            paymentStatus: b.paymentStatus,
            depositAmount: b.depositAmount,
          });
        }
      }
      // Ordenar por fecha y hora
      allBookings.sort((a, b) => {
        const da = `${a.date} ${a.time}`;
        const db = `${b.date} ${b.time}`;
        return da < db ? -1 : da > db ? 1 : 0;
      });
      // Agrupar por fecha
      const byDate: Record<string, typeof allBookings> = {};
      for (const b of allBookings) {
        if (!byDate[b.date]) byDate[b.date] = [];
        byDate[b.date].push(b);
      }
      return {
        yearMonth: input.yearMonth,
        restaurantId: input.restaurantId ?? null,
        bookings: allBookings,
        byDate,
        restaurants: allRestaurants
          .filter(r => allowedIds.includes(r.id))
          .map(r => ({ id: r.id, name: r.name, slug: r.slug })),
      };
    }),
});
