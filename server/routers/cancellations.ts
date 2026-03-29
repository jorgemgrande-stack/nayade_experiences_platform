/**
 * Router: Solicitudes de Anulación
 * Módulo CRM para gestión completa del pipeline de anulaciones.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  cancellationRequests,
  cancellationLogs,
  compensationVouchers,
  type CancellationRequest,
} from "../../drizzle/schema";
import { eq, desc, and, like, or, sql } from "drizzle-orm";
import { sendEmail } from "../mailer";
import { storagePut } from "../storage";

const _pool = mysql.createPool(process.env.DATABASE_URL!);
const db = drizzle(_pool);

const COPY_EMAIL = "reservas@nayadeexperiences.es";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateVoucherCode(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `BON-${year}-${rand}`;
}

async function addLog(
  requestId: number,
  actionType: string,
  payload: Record<string, unknown> = {},
  adminUserId?: number,
  adminUserName?: string,
  oldStatus?: string,
  newStatus?: string
) {
  await db.insert(cancellationLogs).values({
    requestId,
    actionType,
    oldStatus,
    newStatus,
    payload,
    adminUserId,
    adminUserName,
  });
}

// ─── Email templates ──────────────────────────────────────────────────────────

function emailAcuseRecibo(fullName: string, requestId: number): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e5e5e5;padding:32px;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <img src="https://nayade-shop-av298fs8.manus.space/logo.png" alt="Náyade Experiences" style="height:48px;" />
      </div>
      <h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Solicitud de anulación recibida</h2>
      <p style="color:#aaa;margin-bottom:16px;">Hola <strong style="color:#e5e5e5">${fullName}</strong>,</p>
      <p style="color:#aaa;line-height:1.6;">Hemos recibido tu solicitud de anulación con el número de referencia <strong style="color:#f97316">#${requestId}</strong>. Nuestro equipo la revisará y te contactará en el menor tiempo posible.</p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="color:#888;font-size:13px;margin:0;">Si tienes alguna duda, puedes contactarnos en <a href="mailto:reservas@nayadeexperiences.es" style="color:#f97316;">reservas@nayadeexperiences.es</a></p>
      </div>
      <p style="color:#555;font-size:12px;text-align:center;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
    </div>`;
}

function emailRechazo(fullName: string, requestId: number, adminText?: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e5e5e5;padding:32px;border-radius:12px;">
      <h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Resolución de tu solicitud de anulación #${requestId}</h2>
      <p style="color:#aaa;margin-bottom:16px;">Hola <strong style="color:#e5e5e5">${fullName}</strong>,</p>
      <p style="color:#aaa;line-height:1.6;">Tras revisar tu solicitud de anulación, la reclamación no se encuentra sujeta a los supuestos de devolución recogidos en los términos y condiciones de Náyade Experiences.</p>
      ${adminText ? `<div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:16px 0;"><p style="color:#ccc;margin:0;">${adminText}</p></div>` : ""}
      <p style="color:#555;font-size:12px;text-align:center;margin-top:24px;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
    </div>`;
}

function emailAceptacionDevolucion(fullName: string, requestId: number, amount: string, isPartial: boolean): string {
  const tipo = isPartial ? "parcial" : "total";
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e5e5e5;padding:32px;border-radius:12px;">
      <h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Aceptación ${tipo} de tu solicitud #${requestId}</h2>
      <p style="color:#aaa;margin-bottom:16px;">Hola <strong style="color:#e5e5e5">${fullName}</strong>,</p>
      <p style="color:#aaa;line-height:1.6;">Nos complace informarte que tu solicitud de anulación ha sido aceptada de forma <strong style="color:#22c55e">${tipo}</strong>. Se procederá a la devolución económica de <strong style="color:#f97316">${amount} €</strong>.</p>
      <p style="color:#aaa;line-height:1.6;">La devolución se realizará por el mismo medio de pago utilizado en la reserva original en un plazo de 5-10 días hábiles.</p>
      <p style="color:#555;font-size:12px;text-align:center;margin-top:24px;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
    </div>`;
}

function emailAceptacionBono(fullName: string, requestId: number, voucherCode: string, activityName: string, value: string, expiresAt: string, isPartial: boolean): string {
  const tipo = isPartial ? "parcial" : "total";
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e5e5e5;padding:32px;border-radius:12px;">
      <h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Bono de compensación — Solicitud #${requestId}</h2>
      <p style="color:#aaa;margin-bottom:16px;">Hola <strong style="color:#e5e5e5">${fullName}</strong>,</p>
      <p style="color:#aaa;line-height:1.6;">Tu solicitud de anulación ha sido resuelta de forma <strong style="color:#22c55e">${tipo}</strong> mediante un bono de actividades.</p>
      <div style="background:#1a1a1a;border:1px solid #f97316;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
        <p style="color:#f97316;font-size:24px;font-weight:bold;margin:0 0 8px;">${voucherCode}</p>
        <p style="color:#ccc;margin:0 0 4px;">${activityName}</p>
        <p style="color:#888;font-size:14px;margin:0;">Valor: <strong style="color:#e5e5e5">${value} €</strong> · Caduca: ${expiresAt}</p>
      </div>
      <p style="color:#aaa;line-height:1.6;font-size:13px;">Para canjear este bono, contacta con nosotros indicando el código anterior.</p>
      <p style="color:#555;font-size:12px;text-align:center;margin-top:24px;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
    </div>`;
}

function emailSolicitudDocumentacion(fullName: string, requestId: number, adminText: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#e5e5e5;padding:32px;border-radius:12px;">
      <h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Documentación requerida — Solicitud #${requestId}</h2>
      <p style="color:#aaa;margin-bottom:16px;">Hola <strong style="color:#e5e5e5">${fullName}</strong>,</p>
      <p style="color:#aaa;line-height:1.6;">Para continuar con la revisión de tu solicitud de anulación, necesitamos que nos envíes la siguiente documentación:</p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="color:#ccc;margin:0;">${adminText}</p>
      </div>
      <p style="color:#aaa;line-height:1.6;">Por favor, envía la documentación a <a href="mailto:reservas@nayadeexperiences.es" style="color:#f97316;">reservas@nayadeexperiences.es</a> indicando tu número de solicitud <strong>#${requestId}</strong>.</p>
      <p style="color:#555;font-size:12px;text-align:center;margin-top:24px;">Náyade Experiences · Los Ángeles de San Rafael, Segovia</p>
    </div>`;
}

// ─── Admin procedure helper ───────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Solo administradores" });
  }
  return next({ ctx });
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const cancellationsRouter = router({
  // ── Crear solicitud (público — desde landing) ─────────────────────────────
  createRequest: publicProcedure
    .input(
      z.object({
        fullName: z.string().min(2),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        activityDate: z.string().min(1),
        reason: z.enum(["meteorologicas", "accidente", "enfermedad", "desistimiento", "otra"]),
        reasonDetail: z.string().optional(),
        termsChecked: z.boolean(),
        locator: z.string().optional(),
        originUrl: z.string().optional(),
        ipAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!input.termsChecked) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Debes aceptar los términos" });
      }
      if (input.reason === "otra" && !input.reasonDetail?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El campo explicativo es obligatorio para 'Otra'" });
      }

      const [result] = await db.insert(cancellationRequests).values({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        activityDate: input.activityDate,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        termsChecked: input.termsChecked,
        source: "landing_publica",
        locator: input.locator,
        originUrl: input.originUrl,
        ipAddress: input.ipAddress,
        operationalStatus: "recibida",
        resolutionStatus: "sin_resolver",
        financialStatus: "sin_compensacion",
        compensationType: "ninguna",
      });

      const requestId = (result as { insertId: number }).insertId;

      // Log de creación
      await addLog(requestId, "created", {
        source: "landing_publica",
        reason: input.reason,
      });

      // Email acuse de recibo al cliente
      if (input.email) {
        await sendEmail({
          to: input.email,
          subject: `Solicitud de anulación recibida — Ref. #${requestId}`,
          html: emailAcuseRecibo(input.fullName, requestId),
        }).catch(() => {});
      }

      // Notificación interna a reservas
      await sendEmail({
        to: COPY_EMAIL,
        subject: `Nueva solicitud de anulación #${requestId} — ${input.fullName}`,
        html: `<p>Nueva solicitud de anulación recibida desde la landing pública.</p>
               <p><strong>Cliente:</strong> ${input.fullName} (${input.email ?? "sin email"})</p>
               <p><strong>Motivo:</strong> ${input.reason}</p>
               <p><strong>Fecha actividad:</strong> ${input.activityDate}</p>`,
      }).catch(() => {});

      return { success: true, requestId };
    }),

  // ── Listado (admin) ───────────────────────────────────────────────────────
  listRequests: adminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        operationalStatus: z.string().optional(),
        resolutionStatus: z.string().optional(),
        financialStatus: z.string().optional(),
        reason: z.string().optional(),
        hasVoucher: z.boolean().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input.search) {
        conditions.push(
          or(
            like(cancellationRequests.fullName, `%${input.search}%`),
            like(cancellationRequests.email ?? sql`''`, `%${input.search}%`),
            like(cancellationRequests.locator ?? sql`''`, `%${input.search}%`)
          )
        );
      }
      if (input.operationalStatus && input.operationalStatus !== "all") {
        conditions.push(eq(cancellationRequests.operationalStatus, input.operationalStatus as "recibida" | "en_revision" | "pendiente_documentacion" | "pendiente_decision" | "resuelta" | "cerrada" | "incidencia"));
      }
      if (input.resolutionStatus && input.resolutionStatus !== "all") {
        conditions.push(eq(cancellationRequests.resolutionStatus, input.resolutionStatus as "sin_resolver" | "rechazada" | "aceptada_total" | "aceptada_parcial"));
      }
      if (input.financialStatus && input.financialStatus !== "all") {
        conditions.push(eq(cancellationRequests.financialStatus, input.financialStatus as "sin_compensacion" | "pendiente_devolucion" | "devuelta_economicamente" | "pendiente_bono" | "compensada_bono" | "compensacion_mixta" | "incidencia_economica"));
      }
      if (input.reason && input.reason !== "all") {
        conditions.push(eq(cancellationRequests.reason, input.reason as "meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra"));
      }
      if (input.hasVoucher === true) {
        conditions.push(sql`${cancellationRequests.voucherId} IS NOT NULL`);
      } else if (input.hasVoucher === false) {
        conditions.push(sql`${cancellationRequests.voucherId} IS NULL`);
      }

      const rows = await db
        .select()
        .from(cancellationRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(cancellationRequests.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // KPIs
      const all = await db.select().from(cancellationRequests);
      const kpis = {
        total: all.length,
        recibidas: all.filter((r: CancellationRequest) => r.operationalStatus === "recibida").length,
        enRevision: all.filter((r: CancellationRequest) => r.operationalStatus === "en_revision").length,
        pendienteDocumentacion: all.filter((r: CancellationRequest) => r.operationalStatus === "pendiente_documentacion").length,
        resueltasTotal: all.filter((r: CancellationRequest) => r.resolutionStatus === "aceptada_total").length,
        resueltasParcial: all.filter((r: CancellationRequest) => r.resolutionStatus === "aceptada_parcial").length,
        rechazadas: all.filter((r: CancellationRequest) => r.resolutionStatus === "rechazada").length,
        devueltas: all.filter((r: CancellationRequest) => r.financialStatus === "devuelta_economicamente").length,
        compensadasBono: all.filter((r: CancellationRequest) => r.financialStatus === "compensada_bono").length,
        cerradas: all.filter((r: CancellationRequest) => r.operationalStatus === "cerrada").length,
        incidencias: all.filter((r: CancellationRequest) => r.operationalStatus === "incidencia").length,
      };

      return { rows, kpis };
    }),

  // ── Detalle de una solicitud ──────────────────────────────────────────────
  getRequest: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [req] = await db
        .select()
        .from(cancellationRequests)
        .where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      const logs = await db
        .select()
        .from(cancellationLogs)
        .where(eq(cancellationLogs.requestId, input.id))
        .orderBy(desc(cancellationLogs.createdAt));

      let voucher = null;
      if (req.voucherId) {
        const [v] = await db
          .select()
          .from(compensationVouchers)
          .where(eq(compensationVouchers.id, req.voucherId));
        voucher = v ?? null;
      }

      return { request: req, logs, voucher };
    }),

  // ── Actualizar notas internas ─────────────────────────────────────────────
  updateNotes: adminProcedure
    .input(z.object({ id: z.number(), adminNotes: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(cancellationRequests)
        .set({ adminNotes: input.adminNotes })
        .where(eq(cancellationRequests.id, input.id));
      await addLog(input.id, "note_added", { notes: input.adminNotes }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  // ── Asignar responsable ───────────────────────────────────────────────────
  assignUser: adminProcedure
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(cancellationRequests)
        .set({ assignedUserId: input.userId })
        .where(eq(cancellationRequests.id, input.id));
      await addLog(input.id, "assigned", { userId: input.userId }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  // ── ACCIÓN: Rechazar solicitud ────────────────────────────────────────────
  rejectRequest: adminProcedure
    .input(
      z.object({
        id: z.number(),
        adminText: z.string().optional(),
        sendEmail: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cancellationRequests).set({
        operationalStatus: "resuelta",
        resolutionStatus: "rechazada",
        financialStatus: "sin_compensacion",
        compensationType: "ninguna",
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "rejected",
        { adminText: input.adminText, emailSent: input.sendEmail && !!req.email },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, "resuelta"
      );

      if (input.sendEmail && req.email) {
        await sendEmail({
          to: req.email,
          subject: `Resolución de tu solicitud de anulación #${input.id}`,
          html: emailRechazo(req.fullName, input.id, input.adminText),
        }).catch(() => {});
        await addLog(input.id, "email_sent", { type: "rechazo", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
      }

      return { success: true };
    }),

  // ── ACCIÓN: Aceptar solicitud (total o parcial) ───────────────────────────
  acceptRequest: adminProcedure
    .input(
      z.object({
        id: z.number(),
        isPartial: z.boolean().default(false),
        compensationType: z.enum(["devolucion", "bono"]),
        // Devolución
        refundAmount: z.number().optional(),
        refundNote: z.string().optional(),
        refundDate: z.string().optional(),
        // Bono
        activityName: z.string().optional(),
        voucherValue: z.number().optional(),
        voucherExpiresAt: z.string().optional(),
        voucherConditions: z.string().optional(),
        voucherNotes: z.string().optional(),
        sendEmail: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      const resolutionStatus = input.isPartial ? "aceptada_parcial" : "aceptada_total";
      let financialStatus: "pendiente_devolucion" | "pendiente_bono" = "pendiente_devolucion";
      let voucherId: number | undefined;

      if (input.compensationType === "devolucion") {
        if (!input.refundAmount || input.refundAmount <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El importe de devolución es obligatorio" });
        }
        financialStatus = "pendiente_devolucion";

        await db.update(cancellationRequests).set({
          operationalStatus: "resuelta",
          resolutionStatus,
          financialStatus,
          compensationType: "devolucion",
          resolvedAmount: String(input.refundAmount),
        }).where(eq(cancellationRequests.id, input.id));

        await addLog(
          input.id, input.isPartial ? "accepted_partial" : "accepted_total",
          { type: "devolucion", amount: input.refundAmount, note: input.refundNote, date: input.refundDate },
          ctx.user.id, ctx.user.name ?? "Admin",
          req.operationalStatus, "resuelta"
        );

        if (input.sendEmail && req.email) {
          await sendEmail({
            to: req.email,
            subject: `Aceptación de tu solicitud de anulación #${input.id}`,
            html: emailAceptacionDevolucion(req.fullName, input.id, String(input.refundAmount), input.isPartial),
          }).catch(() => {});
          await addLog(input.id, "email_sent", { type: "aceptacion_devolucion", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
        }

      } else {
        // Bono
        if (!input.voucherValue || input.voucherValue <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El valor del bono es obligatorio" });
        }
        financialStatus = "pendiente_bono";
        const code = generateVoucherCode();

        const [vResult] = await db.insert(compensationVouchers).values({
          requestId: input.id,
          code,
          type: "actividad",
          activityName: input.activityName ?? "Actividad Náyade Experiences",
          value: String(input.voucherValue),
          expiresAt: input.voucherExpiresAt ? new Date(input.voucherExpiresAt) : undefined,
          conditions: input.voucherConditions,
          notes: input.voucherNotes,
          status: "generado",
        });
        voucherId = (vResult as { insertId: number }).insertId;

        await db.update(cancellationRequests).set({
          operationalStatus: "resuelta",
          resolutionStatus,
          financialStatus,
          compensationType: "bono",
          resolvedAmount: String(input.voucherValue),
          voucherId,
        }).where(eq(cancellationRequests.id, input.id));

        await addLog(
          input.id, input.isPartial ? "accepted_partial" : "accepted_total",
          { type: "bono", voucherCode: code, value: input.voucherValue, activityName: input.activityName },
          ctx.user.id, ctx.user.name ?? "Admin",
          req.operationalStatus, "resuelta"
        );
        await addLog(input.id, "voucher_generated", { code, voucherId }, ctx.user.id, ctx.user.name ?? "Admin");

        if (input.sendEmail && req.email) {
          const expiresStr = input.voucherExpiresAt
            ? new Date(input.voucherExpiresAt).toLocaleDateString("es-ES")
            : "Sin caducidad";
          await sendEmail({
            to: req.email,
            subject: `Bono de compensación — Solicitud #${input.id}`,
            html: emailAceptacionBono(
              req.fullName, input.id, code,
              input.activityName ?? "Actividad Náyade Experiences",
              String(input.voucherValue), expiresStr, input.isPartial
            ),
          }).catch(() => {});
          await addLog(input.id, "email_sent", { type: "aceptacion_bono", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
        }
      }

      return { success: true, voucherId };
    }),

  // ── ACCIÓN: Solicitar documentación ──────────────────────────────────────
  requestDocumentation: adminProcedure
    .input(
      z.object({
        id: z.number(),
        text: z.string().min(10),
        sendEmail: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cancellationRequests).set({
        operationalStatus: "pendiente_documentacion",
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "doc_requested",
        { text: input.text, emailSent: input.sendEmail && !!req.email },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, "pendiente_documentacion"
      );

      if (input.sendEmail && req.email) {
        await sendEmail({
          to: req.email,
          subject: `Documentación requerida — Solicitud #${input.id}`,
          html: emailSolicitudDocumentacion(req.fullName, input.id, input.text),
        }).catch(() => {});
        await addLog(input.id, "email_sent", { type: "solicitud_documentacion", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
      }

      return { success: true };
    }),

  // ── ACCIÓN: Marcar incidencia ─────────────────────────────────────────────
  markIncidence: adminProcedure
    .input(
      z.object({
        id: z.number(),
        note: z.string().optional(),
        economicIncidence: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cancellationRequests).set({
        operationalStatus: "incidencia",
        financialStatus: input.economicIncidence ? "incidencia_economica" : req.financialStatus,
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "incidence",
        { note: input.note, economicIncidence: input.economicIncidence },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, "incidencia"
      );

      return { success: true };
    }),

  // ── ACCIÓN: Cambiar estado operativo ─────────────────────────────────────
  updateOperationalStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["recibida", "en_revision", "pendiente_documentacion", "pendiente_decision", "resuelta", "cerrada", "incidencia"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cancellationRequests).set({
        operationalStatus: input.status,
        closedAt: input.status === "cerrada" ? new Date() : req.closedAt,
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "status_change",
        { field: "operationalStatus" },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, input.status
      );

      return { success: true };
    }),

  // ── ACCIÓN: Marcar devolución ejecutada ──────────────────────────────────
  markRefundExecuted: adminProcedure
    .input(z.object({ id: z.number(), note: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await db.update(cancellationRequests).set({
        financialStatus: "devuelta_economicamente",
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(input.id, "refund_executed", { note: input.note }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  // ── ACCIÓN: Marcar bono enviado ───────────────────────────────────────────
  markVoucherSent: adminProcedure
    .input(z.object({ id: z.number(), voucherId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.update(compensationVouchers).set({
        status: "enviado",
        sentAt: new Date(),
      }).where(eq(compensationVouchers.id, input.voucherId));

      await db.update(cancellationRequests).set({
        financialStatus: "compensada_bono",
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(input.id, "voucher_sent", { voucherId: input.voucherId }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  // ── ACCIÓN: Cerrar expediente ─────────────────────────────────────────────
  closeRequest: adminProcedure
    .input(z.object({ id: z.number(), note: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      // Validar que hay resolución antes de cerrar
      if (req.resolutionStatus === "sin_resolver") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede cerrar un expediente sin resolución. Rechaza o acepta primero la solicitud.",
        });
      }

      await db.update(cancellationRequests).set({
        operationalStatus: "cerrada",
        closedAt: new Date(),
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "closed",
        { note: input.note },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, "cerrada"
      );

      return { success: true };
    }),

  // ── Actualizar estado financiero manualmente ──────────────────────────────
  updateFinancialStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        financialStatus: z.enum(["sin_compensacion", "pendiente_devolucion", "devuelta_economicamente", "pendiente_bono", "compensada_bono", "compensacion_mixta", "incidencia_economica"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(cancellationRequests).set({ financialStatus: input.financialStatus }).where(eq(cancellationRequests.id, input.id));
      await addLog(input.id, "status_change", { field: "financialStatus" }, ctx.user.id, ctx.user.name ?? "Admin", req.financialStatus, input.financialStatus);
      return { success: true };
    }),

  // ── Eliminar solicitud ────────────────────────────────────────────────────
  deleteRequest: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(cancellationLogs).where(eq(cancellationLogs.requestId, input.id));
      await db.delete(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      return { success: true };
    }),

  // ── Contadores para sidebar badge ──────────────────────────────────────────
  getCounters: adminProcedure
    .query(async () => {
      const all = await db.select().from(cancellationRequests);
      return {
        total: all.length,
        pending: all.filter((r: CancellationRequest) =>
          ["recibida", "en_revision", "pendiente_documentacion", "pendiente_decision"].includes(r.operationalStatus)
        ).length,
        incidencias: all.filter((r: CancellationRequest) => r.operationalStatus === "incidencia").length,
      };
    }),

  // ── Subir PDF de bono a S3 ────────────────────────────────────────────────
  uploadVoucherPdf: adminProcedure
    .input(
      z.object({
        voucherId: z.number(),
        pdfBase64: z.string(),
        filename: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.pdfBase64, "base64");
      const key = `vouchers/${input.voucherId}-${input.filename}`;
      const { url } = await storagePut(key, buffer, "application/pdf");

      await db.update(compensationVouchers).set({ pdfUrl: url }).where(eq(compensationVouchers.id, input.voucherId));
      return { url };
    }),
});
