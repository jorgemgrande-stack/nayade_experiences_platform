/**
 * Router: Gestión de Plantillas de Email
 * Permite listar, previsualizar y enviar pruebas de todas las plantillas de email del sistema.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sendEmail } from "../mailer";
import {
  buildReservationConfirmHtml,
  buildReservationFailedHtml,
  buildRestaurantConfirmHtml,
  buildRestaurantPaymentLinkHtml,
  buildInviteHtml,
  buildPasswordResetHtml,
  buildBudgetRequestUserHtml,
  buildBudgetRequestAdminHtml,
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildCancellationReceivedHtml,
  buildCancellationRejectedHtml,
  buildCancellationAcceptedRefundHtml,
  buildCancellationAcceptedVoucherHtml,
  buildCancellationDocumentationHtml,
  buildTpvTicketHtml,
  buildCouponRedemptionReceivedHtml,
  buildCouponPostponedHtml,
  buildCouponInternalAlertHtml,
} from "../emailTemplates";

// ─── Admin guard ──────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores" });
  }
  return next({ ctx });
});

// ─── Template registry ────────────────────────────────────────────────────────
type TemplateCategory = "reservas" | "presupuestos" | "anulaciones" | "tpv" | "ticketing" | "sistema";

interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  recipient: "cliente" | "admin" | "ambos";
  buildPreview: () => string;
}

const TEMPLATES: TemplateDef[] = [
  // ── RESERVAS ──────────────────────────────────────────────────────────────
  {
    id: "reservation_confirm",
    name: "Confirmación de Reserva",
    description: "Email enviado al cliente cuando su reserva es confirmada con pago.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildReservationConfirmHtml({
      fullName: "María García López",
      email: "maria@ejemplo.com",
      activityName: "Wakeboard para principiantes",
      activityDate: "15 de agosto de 2026",
      activityTime: "10:00",
      participants: 2,
      totalAmount: "89.00",
      locator: "NAY-2026-0042",
      paymentMethod: "Tarjeta bancaria",
      origin: "https://nayadeexperiences.es",
    }),
  },
  {
    id: "reservation_failed",
    name: "Reserva Fallida",
    description: "Email enviado al cliente cuando el pago de su reserva no se ha podido procesar.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildReservationFailedHtml({
      merchantOrder: "NAY-2026-0043",
      productName: "Kayak en el lago",
      customerName: "Carlos Martínez",
      responseCode: "0190",
    }),
  },
  {
    id: "reservation_confirmation_full",
    name: "Confirmación Completa de Reserva",
    description: "Email completo con todos los detalles de la reserva, instrucciones y mapa.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildConfirmationHtml({
      clientName: "Ana Rodríguez",
      reservationRef: "FAC-2026-0044",
      quoteTitle: "SUP Yoga al amanecer",
      items: [
        { description: "SUP Yoga al amanecer (1 persona)", quantity: 1, unitPrice: 45, total: 45 },
      ],
      total: "45.00",
      bookingDate: "10 de septiembre de 2026",
      contactEmail: "reservas@nayadeexperiences.es",
      contactPhone: "+34 930 34 77 91",
    }),
  },
  {
    id: "transfer_confirmation",
    name: "Confirmación de Transferencia",
    description: "Email enviado al cliente cuando realiza el pago por transferencia bancaria.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildTransferConfirmationHtml({
      clientName: "Pedro Sánchez",
      invoiceNumber: "FAC-2026-0045",
      reservationRef: "NAY-2026-0045",
      quoteTitle: "Curso de vela ligera",
      items: [
        { description: "Curso de vela ligera (3 personas)", quantity: 3, unitPrice: 70, total: 210 },
      ],
      subtotal: "210.00",
      taxAmount: "0.00",
      total: "210.00",
    }),
  },
  // ── PRESUPUESTOS ──────────────────────────────────────────────────────────
  {
    id: "budget_request_user",
    name: "Solicitud de Presupuesto — Cliente",
    description: "Email de acuse de recibo enviado al cliente cuando solicita un presupuesto.",
    category: "presupuestos",
    recipient: "cliente",
    buildPreview: () => buildBudgetRequestUserHtml({
      name: "Laura Fernández",
      email: "laura@empresa.com",
      phone: "612 345 678",
      arrivalDate: "15 de noviembre de 2026",
      adults: 25,
      children: 0,
      selectedCategory: "Team Building",
      selectedProduct: "Actividad de team building acuático",
      comments: "Somos un grupo de empresa y nos gustaría organizar una jornada de team building con actividades acuáticas para 25 personas.",
      submittedAt: new Date().toLocaleDateString("es-ES"),
    }),
  },
  {
    id: "budget_request_admin",
    name: "Solicitud de Presupuesto — Interno",
    description: "Alerta interna enviada al equipo cuando llega una nueva solicitud de presupuesto.",
    category: "presupuestos",
    recipient: "admin",
    buildPreview: () => buildBudgetRequestAdminHtml({
      name: "Laura Fernández",
      email: "laura@empresa.com",
      phone: "612 345 678",
      arrivalDate: "15 de noviembre de 2026",
      adults: 25,
      children: 0,
      selectedCategory: "Team Building",
      selectedProduct: "Actividad de team building acuático",
      comments: "Somos un grupo de empresa y nos gustaría organizar una jornada de team building con actividades acuáticas para 25 personas.",
      submittedAt: new Date().toLocaleDateString("es-ES"),
    }),
  },
  {
    id: "quote_sent",
    name: "Presupuesto Enviado al Cliente",
    description: "Email con el presupuesto detallado y enlace de pago enviado al cliente.",
    category: "presupuestos",
    recipient: "cliente",
    buildPreview: () => buildQuoteHtml({
      quoteNumber: "PRE-2026-0015",
      title: "Team Building Acuático",
      clientName: "Laura Fernández",
      items: [
        { description: "Kayak doble (12 unidades)", quantity: 12, unitPrice: 35, total: 420 },
        { description: "SUP (8 unidades)", quantity: 8, unitPrice: 30, total: 240 },
        { description: "Monitor especializado (4h)", quantity: 4, unitPrice: 60, total: 240 },
      ],
      subtotal: "900.00",
      discount: "0",
      tax: "189.00",
      total: "1089.00",
      validUntil: new Date("2026-10-30"),
      notes: "Precio incluye material, monitores y seguro de actividad.",
      paymentLinkUrl: "https://nayadeexperiences.es/pago/PRE-2026-0015",
    }),
  },
  // ── ANULACIONES ───────────────────────────────────────────────────────────
  {
    id: "cancellation_received",
    name: "Anulación Recibida",
    description: "Email de acuse de recibo enviado al cliente cuando envía su solicitud de anulación.",
    category: "anulaciones",
    recipient: "cliente",
    buildPreview: () => buildCancellationReceivedHtml({
      fullName: "Roberto Jiménez",
      requestId: 23,
      locator: "NAY-2026-0038",
      reason: "Enfermedad acreditada con parte médico",
    }),
  },
  {
    id: "cancellation_rejected",
    name: "Anulación Rechazada",
    description: "Email enviado al cliente cuando su solicitud de anulación no es aceptada.",
    category: "anulaciones",
    recipient: "cliente",
    buildPreview: () => buildCancellationRejectedHtml({
      fullName: "Roberto Jiménez",
      requestId: 23,
      adminText: "La solicitud fue recibida fuera del plazo de cancelación establecido en nuestras condiciones (más de 48h antes de la actividad).",
    }),
  },
  {
    id: "cancellation_accepted_refund",
    name: "Anulación Aceptada — Devolución",
    description: "Email enviado al cliente cuando se aprueba una devolución económica total o parcial.",
    category: "anulaciones",
    recipient: "cliente",
    buildPreview: () => buildCancellationAcceptedRefundHtml({
      fullName: "Roberto Jiménez",
      requestId: 23,
      amount: "89.00",
      isPartial: false,
    }),
  },
  {
    id: "cancellation_accepted_voucher",
    name: "Anulación Aceptada — Bono",
    description: "Email enviado al cliente cuando se emite un bono de compensación por la anulación.",
    category: "anulaciones",
    recipient: "cliente",
    buildPreview: () => buildCancellationAcceptedVoucherHtml({
      fullName: "Roberto Jiménez",
      requestId: 23,
      voucherCode: "BON-2026-XK7F2A",
      activityName: "Wakeboard para principiantes",
      value: "89.00",
      expiresAt: "31 de diciembre de 2026",
      isPartial: false,
    }),
  },
  {
    id: "cancellation_documentation",
    name: "Documentación Requerida",
    description: "Email enviado al cliente solicitando documentación adicional para su anulación.",
    category: "anulaciones",
    recipient: "cliente",
    buildPreview: () => buildCancellationDocumentationHtml({
      fullName: "Roberto Jiménez",
      requestId: 23,
      adminText: "Para continuar con la revisión, necesitamos que nos envíes: (1) Parte médico o informe del médico que acredite la enfermedad, (2) DNI del titular de la reserva.",
    }),
  },
  // ── TPV ───────────────────────────────────────────────────────────────────
  {
    id: "tpv_ticket",
    name: "Ticket de Compra TPV",
    description: "Email con el ticket de compra enviado al cliente tras una venta presencial en el TPV.",
    category: "tpv",
    recipient: "cliente",
    buildPreview: () => buildTpvTicketHtml({
      ticketNumber: "T-2026-0847",
      customerName: "Isabel Torres",
      createdAt: Date.now(),
      items: [
        { name: "Wakeboard 1h", quantity: 2, unitPrice: 35, total: 70 },
        { name: "Alquiler de neopreno", quantity: 2, unitPrice: 8, total: 16 },
      ],
      payments: [
        { method: "card", amount: 86 },
      ],
      total: 86,
      subtotal: 71.07,
      taxAmount: 14.93,
    }),
  },
  // ── TICKETING / CUPONES ───────────────────────────────────────────────────
  {
    id: "coupon_received",
    name: "Canje de Cupón — Solicitud Recibida",
    description: "Email de acuse de recibo enviado al cliente cuando envía sus cupones para canje.",
    category: "ticketing",
    recipient: "cliente",
    buildPreview: () => buildCouponRedemptionReceivedHtml({
      customerName: "Miguel Ángel Ruiz",
      coupons: [
        { couponCode: "GV-2026-ABC123", provider: "Groupon" },
        { couponCode: "GV-2026-DEF456", provider: "Groupon" },
      ],
      submissionId: "TKT-2026-0091",
      requestedDate: "22 de agosto de 2026",
    }),
  },
  {
    id: "coupon_postponed",
    name: "Canje de Cupón — Sin Disponibilidad",
    description: "Email enviado al cliente cuando no hay disponibilidad para la fecha solicitada.",
    category: "ticketing",
    recipient: "cliente",
    buildPreview: () => buildCouponPostponedHtml({
      customerName: "Miguel Ángel Ruiz",
      couponCode: "GV-2026-ABC123",
      provider: "Groupon",
      productName: "Wakeboard 1 hora",
      requestedDate: "22 de agosto de 2026",
    }),
  },
  {
    id: "coupon_internal_alert",
    name: "Canje de Cupón — Alerta Interna",
    description: "Alerta interna enviada al equipo cuando un cliente envía cupones para canje.",
    category: "ticketing",
    recipient: "admin",
    buildPreview: () => buildCouponInternalAlertHtml({
      customerName: "Miguel Ángel Ruiz",
      email: "miguel@ejemplo.com",
      phone: "634 567 890",
      coupons: [
        { couponCode: "GV-2026-ABC123", provider: "Groupon" },
        { couponCode: "GV-2026-DEF456", provider: "Groupon" },
      ],
      submissionId: "TKT-2026-0091",
      requestedDate: "22 de agosto de 2026",
    }),
  },
  // ── SISTEMA ───────────────────────────────────────────────────────────────
  {
    id: "invite",
    name: "Invitación de Usuario",
    description: "Email enviado cuando se invita a un nuevo usuario a la plataforma.",
    category: "sistema",
    recipient: "cliente",
    buildPreview: () => buildInviteHtml({
      name: "Nuevo Usuario",
      role: "agente",
      setPasswordUrl: "https://nayadeexperiences.es/set-password?token=abc123xyz",
    }),
  },
  {
    id: "password_reset",
    name: "Recuperación de Contraseña",
    description: "Email enviado al usuario cuando solicita restablecer su contraseña.",
    category: "sistema",
    recipient: "cliente",
    buildPreview: () => buildPasswordResetHtml({
      name: "María García",
      resetUrl: "https://nayadeexperiences.es/reset-password?token=xyz789abc",
      expiryMinutes: 60,
    }),
  },
  {
    id: "restaurant_confirm",
    name: "Confirmación de Reserva de Restaurante",
    description: "Email enviado al cliente cuando confirma una reserva en el restaurante.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildRestaurantConfirmHtml({
      guestName: "Elena Martínez",
      restaurantName: "Restaurante El Lago",
      date: "25 de agosto de 2026",
      time: "14:00",
      guests: 4,
      locator: "REST-2026-0012",
      depositAmount: "30",
      requiresPayment: false,
    }),
  },
  {
    id: "restaurant_payment_link",
    name: "Enlace de Pago — Restaurante",
    description: "Email con enlace de pago enviado al cliente para confirmar su reserva de restaurante.",
    category: "reservas",
    recipient: "cliente",
    buildPreview: () => buildRestaurantPaymentLinkHtml({
      guestName: "Elena Martínez",
      guestEmail: "elena@ejemplo.com",
      restaurantName: "Restaurante El Lago",
      date: "25 de agosto de 2026",
      time: "14:00",
      guests: 4,
      locator: "REST-2026-0012",
      depositAmount: "30",
      redsysUrl: "https://sis-t.redsys.es:25443/sis/realizarPago",
      merchantParams: "eyJEU19NRVJDSEFOVF9BTU9VTlQiOiIzMDAwIn0=",
      signatureVersion: "HMAC_SHA256_V1",
      signature: "PREVIEW_SIGNATURE",
    }),
  },
];

// ─── Router ───────────────────────────────────────────────────────────────────
export const emailTemplatesRouter = router({
  // ── Listar todas las plantillas ───────────────────────────────────────────
  list: adminProcedure.query(() => {
    return TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      recipient: t.recipient,
    }));
  }),

  // ── Previsualizar una plantilla ───────────────────────────────────────────
  preview: adminProcedure
    .input(z.object({ templateId: z.string() }))
    .query(({ input }) => {
      const tpl = TEMPLATES.find(t => t.id === input.templateId);
      if (!tpl) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.templateId}' no encontrada` });
      }
      return {
        id: tpl.id,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        recipient: tpl.recipient,
        html: tpl.buildPreview(),
      };
    }),

  // ── Enviar prueba de una plantilla ────────────────────────────────────────
  sendTest: adminProcedure
    .input(z.object({
      templateId: z.string(),
      toEmail: z.string().email(),
    }))
    .mutation(async ({ input }) => {
      const tpl = TEMPLATES.find(t => t.id === input.templateId);
      if (!tpl) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.templateId}' no encontrada` });
      }
      const html = tpl.buildPreview();
      await sendEmail({
        to: input.toEmail,
        subject: `[PRUEBA] ${tpl.name} · Náyade Experiences`,
        html,
      });
      return { ok: true, templateName: tpl.name, sentTo: input.toEmail };
    }),

  // ── Enviar TODAS las plantillas de prueba ─────────────────────────────────
  sendAllTests: adminProcedure
    .input(z.object({ toEmail: z.string().email() }))
    .mutation(async ({ input }) => {
      const results: { id: string; name: string; ok: boolean; error?: string }[] = [];
      for (const tpl of TEMPLATES) {
        try {
          const html = tpl.buildPreview();
          await sendEmail({
            to: input.toEmail,
            subject: `[PRUEBA ${tpl.category.toUpperCase()}] ${tpl.name} · Náyade Experiences`,
            html,
          });
          results.push({ id: tpl.id, name: tpl.name, ok: true });
        } catch (err) {
          results.push({ id: tpl.id, name: tpl.name, ok: false, error: String(err) });
        }
      }
      const sent = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).length;
      return { sent, failed, total: TEMPLATES.length, results };
    }),
});
