/**
 * Router: Gestión de Plantillas de Email
 * CRUD completo: listar, obtener, previsualizar, editar, crear, eliminar y restaurar plantillas.
 * Las plantillas del sistema se pre-cargan en BD al primer acceso (seed automático).
 */
import { router, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { emailTemplates } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

import { sendEmail } from "../mailer";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);
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
const adminProcedure = permissionProcedure("settings.manage", ["admin"]);

// ─── Seed data: plantillas del sistema ───────────────────────────────────────
interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  recipient: string;
  subject: string;
  headerTitle: string;
  headerSubtitle: string;
  variables: string;
  buildHtml: () => string;
}

const SYSTEM_TEMPLATES: SeedTemplate[] = [
  {
    id: "reservation_confirm",
    name: "Confirmación de Reserva",
    description: "Email enviado al cliente cuando su reserva es confirmada con pago.",
    category: "reservas", recipient: "cliente",
    subject: "✅ Reserva confirmada · Náyade Experiences",
    headerTitle: "¡Reserva Confirmada!", headerSubtitle: "Tu aventura en el lago está asegurada",
    variables: JSON.stringify(["merchantOrder","productName","customerName","date","people","amount"]),
    buildHtml: () => buildReservationConfirmHtml({ merchantOrder:"NAY-2026-0042", productName:"Wakeboard para principiantes", customerName:"María García López", date:"15 de agosto de 2026", people:2, amount:"89.00" }),
  },
  {
    id: "reservation_failed",
    name: "Reserva Fallida",
    description: "Email enviado al cliente cuando el pago de su reserva no se ha podido procesar.",
    category: "reservas", recipient: "cliente",
    subject: "⚠️ Pago no completado · Náyade Experiences",
    headerTitle: "Pago No Completado", headerSubtitle: "No hemos podido procesar tu pago",
    variables: JSON.stringify(["merchantOrder","productName","customerName","responseCode"]),
    buildHtml: () => buildReservationFailedHtml({ merchantOrder:"NAY-2026-0043", productName:"Kayak en el lago", customerName:"Carlos Martínez", responseCode:"0190" }),
  },
  {
    id: "reservation_confirmation_full",
    name: "Confirmación Completa de Reserva",
    description: "Email completo con todos los detalles de la reserva, instrucciones y mapa.",
    category: "reservas", recipient: "cliente",
    subject: "🎉 ¡Todo listo para tu experiencia! · Náyade Experiences",
    headerTitle: "¡Todo Listo!", headerSubtitle: "Aquí tienes todos los detalles de tu reserva",
    variables: JSON.stringify(["clientName","reservationRef","quoteTitle","items","total","bookingDate"]),
    buildHtml: () => buildConfirmationHtml({ clientName:"Ana Rodríguez", reservationRef:"FAC-2026-0044", quoteTitle:"SUP Yoga al amanecer", items:[{description:"SUP Yoga al amanecer (1 persona)",quantity:1,unitPrice:45,total:45}], total:"45.00", bookingDate:"10 de septiembre de 2026", contactEmail:"reservas@nayadeexperiences.es", contactPhone:"+34 911 67 51 89" }),
  },
  {
    id: "transfer_confirmation",
    name: "Confirmación de Transferencia",
    description: "Email enviado al cliente cuando realiza el pago por transferencia bancaria.",
    category: "reservas", recipient: "cliente",
    subject: "🏦 Transferencia recibida · Náyade Experiences",
    headerTitle: "Transferencia Recibida", headerSubtitle: "Estamos verificando tu pago",
    variables: JSON.stringify(["clientName","invoiceNumber","reservationRef","quoteTitle","total"]),
    buildHtml: () => buildTransferConfirmationHtml({ clientName:"Pedro Sánchez", invoiceNumber:"FAC-2026-0045", reservationRef:"NAY-2026-0045", quoteTitle:"Curso de vela ligera", items:[{description:"Curso de vela ligera (3 personas)",quantity:3,unitPrice:70,total:210}], subtotal:"210.00", taxAmount:"0.00", total:"210.00" }),
  },
  {
    id: "restaurant_confirm",
    name: "Confirmación de Reserva de Restaurante",
    description: "Email enviado al cliente cuando confirma una reserva en el restaurante.",
    category: "reservas", recipient: "cliente",
    subject: "🍽️ Reserva de restaurante confirmada · Náyade Experiences",
    headerTitle: "Mesa Reservada", headerSubtitle: "¡Te esperamos!",
    variables: JSON.stringify(["guestName","restaurantName","date","time","guests","locator"]),
    buildHtml: () => buildRestaurantConfirmHtml({ guestName:"Elena Martínez", restaurantName:"Restaurante El Lago", date:"25 de agosto de 2026", time:"14:00", guests:4, locator:"REST-2026-0012", depositAmount:"30", requiresPayment:false }),
  },
  {
    id: "restaurant_payment_link",
    name: "Enlace de Pago — Restaurante",
    description: "Email con enlace de pago para confirmar reserva de restaurante con señal.",
    category: "reservas", recipient: "cliente",
    subject: "💳 Confirma tu reserva con señal · Náyade Experiences",
    headerTitle: "Confirma tu Mesa", headerSubtitle: "Paga la señal para asegurar tu reserva",
    variables: JSON.stringify(["guestName","restaurantName","date","time","guests","depositAmount"]),
    buildHtml: () => buildRestaurantPaymentLinkHtml({ guestName:"Elena Martínez", guestEmail:"elena@ejemplo.com", restaurantName:"Restaurante El Lago", date:"25 de agosto de 2026", time:"14:00", guests:4, locator:"REST-2026-0012", depositAmount:"30", redsysUrl:"https://sis-t.redsys.es:25443/sis/realizarPago", merchantParams:"eyJEU19NRVJDSEFOVF9BTU9VTlQiOiIzMDAwIn0=", signatureVersion:"HMAC_SHA256_V1", signature:"PREVIEW_SIGNATURE" }),
  },
  {
    id: "budget_request_user",
    name: "Solicitud de Presupuesto — Cliente",
    description: "Email de acuse de recibo enviado al cliente cuando solicita un presupuesto.",
    category: "presupuestos", recipient: "cliente",
    subject: "📋 Solicitud recibida · Náyade Experiences",
    headerTitle: "Solicitud Recibida", headerSubtitle: "Tu experiencia perfecta empieza aquí",
    variables: JSON.stringify(["name","email","phone","arrivalDate","adults","children","selectedCategory"]),
    buildHtml: () => buildBudgetRequestUserHtml({ name:"Laura Fernández", email:"laura@empresa.com", phone:"612 345 678", arrivalDate:"15 de noviembre de 2026", adults:25, children:0, selectedCategory:"Team Building", selectedProduct:"Actividad de team building acuático", comments:"Somos un grupo de empresa.", submittedAt:new Date().toLocaleDateString("es-ES") }),
  },
  {
    id: "budget_request_admin",
    name: "Solicitud de Presupuesto — Equipo",
    description: "Alerta interna enviada al equipo cuando llega una nueva solicitud de presupuesto.",
    category: "presupuestos", recipient: "admin",
    subject: "🔔 Nueva solicitud de presupuesto",
    headerTitle: "Nueva Solicitud", headerSubtitle: "Nuevo lead en el sistema",
    variables: JSON.stringify(["name","email","phone","arrivalDate","adults","children","selectedCategory"]),
    buildHtml: () => buildBudgetRequestAdminHtml({ name:"Laura Fernández", email:"laura@empresa.com", phone:"612 345 678", arrivalDate:"15 de noviembre de 2026", adults:25, children:0, selectedCategory:"Team Building", selectedProduct:"Actividad de team building acuático", comments:"Somos un grupo de empresa.", submittedAt:new Date().toLocaleDateString("es-ES") }),
  },
  {
    id: "quote_sent",
    name: "Presupuesto Enviado al Cliente",
    description: "Email con el presupuesto detallado y enlace de pago.",
    category: "presupuestos", recipient: "cliente",
    subject: "📄 Tu presupuesto personalizado · Náyade Experiences",
    headerTitle: "Tu Presupuesto", headerSubtitle: "Hemos preparado una propuesta a tu medida",
    variables: JSON.stringify(["quoteNumber","title","clientName","items","total","validUntil","paymentLinkUrl"]),
    buildHtml: () => buildQuoteHtml({ quoteNumber:"PRE-2026-0015", title:"Team Building Acuático", clientName:"Laura Fernández", items:[{description:"Kayak doble (12 uds)",quantity:12,unitPrice:35,total:420},{description:"SUP (8 uds)",quantity:8,unitPrice:30,total:240}], subtotal:"660.00", discount:"0", tax:"138.60", total:"798.60", validUntil:new Date("2026-10-30"), paymentLinkUrl:"https://nayadeexperiences.es/pago/PRE-2026-0015" }),
  },
  {
    id: "cancellation_received",
    name: "Anulación Recibida",
    description: "Email de acuse de recibo enviado al cliente cuando envía su solicitud de anulación.",
    category: "anulaciones", recipient: "cliente",
    subject: "📩 Solicitud de anulación recibida · Náyade Experiences",
    headerTitle: "Solicitud Recibida", headerSubtitle: "Hemos recibido tu solicitud de anulación",
    variables: JSON.stringify(["fullName","requestId","locator","reason"]),
    buildHtml: () => buildCancellationReceivedHtml({ fullName:"Roberto Jiménez", requestId:23, locator:"NAY-2026-0038", reason:"Enfermedad acreditada con parte médico" }),
  },
  {
    id: "cancellation_rejected",
    name: "Anulación Rechazada",
    description: "Email enviado al cliente cuando su solicitud de anulación no es aceptada.",
    category: "anulaciones", recipient: "cliente",
    subject: "❌ Solicitud de anulación no aceptada · Náyade Experiences",
    headerTitle: "Anulación No Aceptada", headerSubtitle: "Tu solicitud no cumple los requisitos",
    variables: JSON.stringify(["fullName","requestId","adminText"]),
    buildHtml: () => buildCancellationRejectedHtml({ fullName:"Roberto Jiménez", requestId:23, adminText:"La solicitud fue recibida fuera del plazo de cancelación establecido." }),
  },
  {
    id: "cancellation_accepted_refund",
    name: "Anulación Aceptada — Devolución",
    description: "Email enviado al cliente cuando se aprueba una devolución económica.",
    category: "anulaciones", recipient: "cliente",
    subject: "✅ Anulación aceptada con reembolso · Náyade Experiences",
    headerTitle: "Anulación Aceptada", headerSubtitle: "Procesaremos tu reembolso en breve",
    variables: JSON.stringify(["fullName","requestId","amount","isPartial"]),
    buildHtml: () => buildCancellationAcceptedRefundHtml({ fullName:"Roberto Jiménez", requestId:23, amount:"89.00", isPartial:false }),
  },
  {
    id: "cancellation_accepted_voucher",
    name: "Anulación Aceptada — Bono",
    description: "Email enviado al cliente cuando se emite un bono de compensación.",
    category: "anulaciones", recipient: "cliente",
    subject: "🎫 Bono compensatorio generado · Náyade Experiences",
    headerTitle: "Bono Generado", headerSubtitle: "Úsalo en tu próxima visita",
    variables: JSON.stringify(["fullName","requestId","voucherCode","activityName","value","expiresAt"]),
    buildHtml: () => buildCancellationAcceptedVoucherHtml({ fullName:"Roberto Jiménez", requestId:23, voucherCode:"BON-2026-XK7F2A", activityName:"Wakeboard para principiantes", value:"89.00", expiresAt:"31 de diciembre de 2026", isPartial:false }),
  },
  {
    id: "cancellation_documentation",
    name: "Documentación Requerida — Anulación",
    description: "Email enviado al cliente solicitando documentación adicional para su anulación.",
    category: "anulaciones", recipient: "cliente",
    subject: "📎 Documentación requerida · Náyade Experiences",
    headerTitle: "Documentación Requerida", headerSubtitle: "Necesitamos más información",
    variables: JSON.stringify(["fullName","requestId","adminText"]),
    buildHtml: () => buildCancellationDocumentationHtml({ fullName:"Roberto Jiménez", requestId:23, adminText:"Para continuar necesitamos: (1) Parte médico oficial, (2) DNI del titular." }),
  },
  {
    id: "tpv_ticket",
    name: "Ticket de Compra TPV",
    description: "Email con el ticket de compra enviado al cliente tras una venta presencial en el TPV.",
    category: "tpv", recipient: "cliente",
    subject: "🧾 Tu ticket de compra · Náyade Experiences",
    headerTitle: "Ticket de Compra", headerSubtitle: "Gracias por tu compra en Náyade Experiences",
    variables: JSON.stringify(["ticketNumber","customerName","items","total","paymentMethod"]),
    buildHtml: () => buildTpvTicketHtml({ ticketNumber:"T-2026-0847", customerName:"Isabel Torres", createdAt:Date.now(), items:[{name:"Wakeboard 1h",quantity:2,unitPrice:35,total:70},{name:"Alquiler de neopreno",quantity:2,unitPrice:8,total:16}], payments:[{method:"card",amount:86}], total:86, subtotal:71.07, taxAmount:14.93 }),
  },
  {
    id: "coupon_received",
    name: "Canje de Cupón — Solicitud Recibida",
    description: "Email de acuse de recibo enviado al cliente cuando envía sus cupones para canje.",
    category: "ticketing", recipient: "cliente",
    subject: "🎟️ Solicitud de canje recibida · Náyade Experiences",
    headerTitle: "Solicitud Recibida", headerSubtitle: "Procesaremos tu canje en breve",
    variables: JSON.stringify(["customerName","coupons","submissionId","requestedDate"]),
    buildHtml: () => buildCouponRedemptionReceivedHtml({ customerName:"Miguel Ángel Ruiz", coupons:[{couponCode:"GV-2026-ABC123",provider:"Groupon"},{couponCode:"GV-2026-DEF456",provider:"Groupon"}], submissionId:"TKT-2026-0091", requestedDate:"22 de agosto de 2026" }),
  },
  {
    id: "coupon_postponed",
    name: "Canje de Cupón — Sin Disponibilidad",
    description: "Email enviado al cliente cuando no hay disponibilidad para la fecha solicitada.",
    category: "ticketing", recipient: "cliente",
    subject: "📅 Sin disponibilidad para tu fecha · Náyade Experiences",
    headerTitle: "Sin Disponibilidad", headerSubtitle: "Propón otra fecha",
    variables: JSON.stringify(["customerName","couponCode","provider","productName","requestedDate"]),
    buildHtml: () => buildCouponPostponedHtml({ customerName:"Miguel Ángel Ruiz", couponCode:"GV-2026-ABC123", provider:"Groupon", productName:"Wakeboard 1 hora", requestedDate:"22 de agosto de 2026" }),
  },
  {
    id: "coupon_internal_alert",
    name: "Canje de Cupón — Alerta Interna",
    description: "Alerta interna enviada al equipo cuando un cliente envía cupones para canje.",
    category: "ticketing", recipient: "admin",
    subject: "🔔 Nuevo canje de cupón",
    headerTitle: "Nuevo Canje", headerSubtitle: "Se ha recibido una solicitud de canje",
    variables: JSON.stringify(["customerName","email","phone","coupons","submissionId","requestedDate"]),
    buildHtml: () => buildCouponInternalAlertHtml({ customerName:"Miguel Ángel Ruiz", email:"miguel@ejemplo.com", phone:"634 567 890", coupons:[{couponCode:"GV-2026-ABC123",provider:"Groupon"}], submissionId:"TKT-2026-0091", requestedDate:"22 de agosto de 2026" }),
  },
  {
    id: "invite",
    name: "Invitación de Usuario",
    description: "Email enviado cuando se invita a un nuevo usuario a la plataforma.",
    category: "sistema", recipient: "admin",
    subject: "👋 Invitación al panel de gestión · Náyade Experiences",
    headerTitle: "Bienvenido al Equipo", headerSubtitle: "Has sido invitado al panel de gestión",
    variables: JSON.stringify(["name","role","setPasswordUrl"]),
    buildHtml: () => buildInviteHtml({ name:"Nuevo Usuario", role:"agente", setPasswordUrl:"https://nayadeexperiences.es/set-password?token=abc123xyz" }),
  },
  {
    id: "password_reset",
    name: "Recuperación de Contraseña",
    description: "Email enviado al usuario cuando solicita restablecer su contraseña.",
    category: "sistema", recipient: "admin",
    subject: "🔑 Restablece tu contraseña · Náyade Experiences",
    headerTitle: "Restablecer Contraseña", headerSubtitle: "Solicitud de cambio de contraseña",
    variables: JSON.stringify(["name","resetUrl","expiryMinutes"]),
    buildHtml: () => buildPasswordResetHtml({ name:"María García", resetUrl:"https://nayadeexperiences.es/reset-password?token=xyz789abc", expiryMinutes:60 }),
  },
];

// ─── Helper: seed templates to DB if empty ───────────────────────────────────
async function ensureTemplatesSeeded() {
  const existing = await db.select({ id: emailTemplates.id }).from(emailTemplates).limit(1);
  if (existing.length > 0) return;

  for (const tpl of SYSTEM_TEMPLATES) {
    await db.insert(emailTemplates).values({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      category: tpl.category,
      recipient: tpl.recipient,
      subject: tpl.subject,
      headerTitle: tpl.headerTitle,
      headerSubtitle: tpl.headerSubtitle,
      bodyHtml: tpl.buildHtml(),
      variables: tpl.variables,
      isCustom: false,
      isActive: true,
    }).onDuplicateKeyUpdate({ set: { name: tpl.name } });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const emailTemplatesRouter = router({
  // ── Listar todas las plantillas ───────────────────────────────────────────
  list: adminProcedure.query(async () => {
    await ensureTemplatesSeeded();
    return db.select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      description: emailTemplates.description,
      category: emailTemplates.category,
      recipient: emailTemplates.recipient,
      subject: emailTemplates.subject,
      isCustom: emailTemplates.isCustom,
      isActive: emailTemplates.isActive,
      updatedAt: emailTemplates.updatedAt,
    }).from(emailTemplates).orderBy(emailTemplates.category, emailTemplates.name);
  }),

  // ── Obtener una plantilla completa (para editar) ──────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      await ensureTemplatesSeeded();
      const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.id}' no encontrada` });
      return row;
    }),

  // ── Previsualizar HTML de una plantilla ───────────────────────────────────
  preview: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      await ensureTemplatesSeeded();
      const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.id}' no encontrada` });
      return { id: row.id, name: row.name, subject: row.subject, html: row.bodyHtml };
    }),

  // ── Guardar cambios en una plantilla ─────────────────────────────────────
  save: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(200),
      subject: z.string().min(1).max(300),
      description: z.string().optional(),
      headerTitle: z.string().optional(),
      headerSubtitle: z.string().optional(),
      headerImageUrl: z.string().optional(),
      bodyHtml: z.string().min(1),
      footerText: z.string().optional(),
      ctaLabel: z.string().optional(),
      ctaUrl: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select({ id: emailTemplates.id }).from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.id}' no encontrada` });

      await db.update(emailTemplates).set({
        name: input.name,
        subject: input.subject,
        description: input.description ?? undefined,
        headerTitle: input.headerTitle ?? undefined,
        headerSubtitle: input.headerSubtitle ?? undefined,
        headerImageUrl: input.headerImageUrl ?? undefined,
        bodyHtml: input.bodyHtml,
        footerText: input.footerText ?? undefined,
        ctaLabel: input.ctaLabel ?? undefined,
        ctaUrl: input.ctaUrl ?? undefined,
        isActive: input.isActive ?? true,
      }).where(eq(emailTemplates.id, input.id));

      return { ok: true };
    }),

  // ── Crear nueva plantilla personalizada ──────────────────────────────────
  create: adminProcedure
    .input(z.object({
      id: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, "Solo letras minúsculas, números y guiones"),
      name: z.string().min(1).max(200),
      subject: z.string().min(1).max(300),
      description: z.string().optional(),
      category: z.string().default("general"),
      recipient: z.string().default("cliente"),
      headerTitle: z.string().optional(),
      headerSubtitle: z.string().optional(),
      bodyHtml: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select({ id: emailTemplates.id }).from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: `Ya existe una plantilla con id '${input.id}'` });

      await db.insert(emailTemplates).values({
        id: input.id,
        name: input.name,
        subject: input.subject,
        description: input.description,
        category: input.category,
        recipient: input.recipient,
        headerTitle: input.headerTitle,
        headerSubtitle: input.headerSubtitle,
        bodyHtml: input.bodyHtml,
        isCustom: true,
        isActive: true,
      });

      return { ok: true, id: input.id };
    }),

  // ── Eliminar plantilla personalizada ─────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const [row] = await db.select({ isCustom: emailTemplates.isCustom }).from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla no encontrada" });
      if (!row.isCustom) throw new TRPCError({ code: "FORBIDDEN", message: "Las plantillas del sistema no se pueden eliminar" });

      await db.delete(emailTemplates).where(eq(emailTemplates.id, input.id));
      return { ok: true };
    }),

  // ── Restaurar plantilla del sistema a su estado original ─────────────────
  restore: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const systemTpl = SYSTEM_TEMPLATES.find(t => t.id === input.id);
      if (!systemTpl) throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla del sistema no encontrada" });

      await db.update(emailTemplates).set({
        name: systemTpl.name,
        description: systemTpl.description,
        subject: systemTpl.subject,
        headerTitle: systemTpl.headerTitle,
        headerSubtitle: systemTpl.headerSubtitle,
        bodyHtml: systemTpl.buildHtml(),
        isActive: true,
      }).where(eq(emailTemplates.id, input.id));

      return { ok: true };
    }),

  // ── Enviar prueba de una plantilla ────────────────────────────────────────
  sendTest: adminProcedure
    .input(z.object({
      id: z.string(),
      toEmail: z.string().email(),
    }))
    .mutation(async ({ input }) => {
      const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Plantilla '${input.id}' no encontrada` });

      await sendEmail({
        to: input.toEmail,
        subject: `[PRUEBA] ${row.subject}`,
        html: row.bodyHtml,
      });
      return { ok: true, templateName: row.name, sentTo: input.toEmail };
    }),

  // ── Enviar TODAS las plantillas de prueba ─────────────────────────────────
  sendAllTests: adminProcedure
    .input(z.object({ toEmail: z.string().email() }))
    .mutation(async ({ input }) => {
      await ensureTemplatesSeeded();
      const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.isActive, true));
      const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

      for (const row of rows) {
        try {
          await sendEmail({
            to: input.toEmail,
            subject: `[PRUEBA] ${row.subject}`,
            html: row.bodyHtml,
          });
          results.push({ id: row.id, name: row.name, ok: true });
        } catch (err) {
          results.push({ id: row.id, name: row.name, ok: false, error: String(err) });
        }
      }

      return {
        sent: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        total: rows.length,
        results,
      };
    }),
});

