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
  reservations,
  transactions,
  reservationOperational,
  reavExpedients,
  couponRedemptions,
  discountCodes,
  type CancellationRequest,
} from "../../drizzle/schema";
import { eq, desc, and, like, or, sql } from "drizzle-orm";
import { sendEmail } from "../mailer";
import {
  buildCancellationReceivedHtml,
  buildCancellationRejectedHtml,
  buildCancellationAcceptedRefundHtml,
  buildCancellationAcceptedVoucherHtml,
  buildCancellationDocumentationHtml,
} from "../emailTemplates";
import { storagePut } from "../storage";
import { generateDocumentNumber } from "../documentNumbers";
import { logActivity } from "../db";
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

// ─── Propagación transversal al aprobar una anulación ───────────────────────
/**
 * Propaga el impacto de una anulación aprobada a todos los módulos del sistema:
 * 1. Reserva → status = "cancelled"
 * 2. Contabilidad → transacción de devolución (importe negativo) si refundAmount > 0
 * 3. Operaciones → reservation_operational.opStatus = "anulado"
 * 4. REAV → expediente fiscalStatus = "anulado", operativeStatus = "anulado"
 * 5. Numeración → genera número ANU- y lo guarda en cancellation_requests
 */
async function propagateCancellation(params: {
  requestId: number;
  req: CancellationRequest;
  refundAmount?: number;       // Solo para devoluciones monetarias
  compensationType: "devolucion" | "bono";
  adminUserId: number;
  adminUserName: string;
}): Promise<{ cancellationNumber: string }> {
  const { requestId, req, refundAmount, compensationType, adminUserId, adminUserName } = params;

  // ── 1. Generar número ANU- ────────────────────────────────────────────────
  const cancellationNumber = await generateDocumentNumber(
    "anulacion",
    `cancellations:acceptRequest:${compensationType}`,
    String(adminUserId)
  );

  // Guardar el número ANU en la solicitud
  await db.update(cancellationRequests)
    .set({ cancellationNumber })
    .where(eq(cancellationRequests.id, requestId));

  // ── 2. Cancelar la reserva vinculada ─────────────────────────────────────
  const reservationId = req.linkedReservationId;
  if (reservationId) {
    await db.update(reservations)
      .set({ status: "cancelled" })
      .where(eq(reservations.id, reservationId));

    // ── 3. Actualizar estado operativo ──────────────────────────────────────
    await db.update(reservationOperational)
      .set({ opStatus: "anulado", updatedBy: adminUserId })
      .where(eq(reservationOperational.reservationId, reservationId));

    // ── 4. Cerrar expediente REAV si existe ──────────────────────────────────
    const [reavExp] = await db.select({ id: reavExpedients.id })
      .from(reavExpedients)
      .where(eq(reavExpedients.reservationId, reservationId))
      .limit(1);
    if (reavExp) {
      await db.update(reavExpedients)
        .set({
          fiscalStatus: "anulado",
          operativeStatus: "anulado",
          closedAt: new Date(),
          internalNotes: `Anulado por expediente ${cancellationNumber} el ${new Date().toLocaleDateString("es-ES")}`,
        })
        .where(eq(reavExpedients.id, reavExp.id));
    }
  }

  // ── 5. Transacción contable de devolución (solo si hay importe a devolver) ─
  if (compensationType === "devolucion" && refundAmount && refundAmount > 0) {
    const txNumber = await generateDocumentNumber(
      "factura",
      `cancellations:refundTransaction:${requestId}`,
      String(adminUserId)
    );
    // Usamos un prefijo especial para distinguir las transacciones de devolución
    const refundTxNumber = txNumber.replace("FAC-", "DEV-");
    await db.insert(transactions).values({
      transactionNumber: refundTxNumber,
      type: "reembolso",
      amount: String(-Math.abs(refundAmount)),
      currency: "EUR",
      paymentMethod: "transferencia",
      status: "completado",
      description: `Devolución por anulación ${cancellationNumber} — ${req.fullName}`,
      processedAt: new Date(),
      clientName: req.fullName,
      clientEmail: req.email ?? undefined,
      clientPhone: req.phone ?? undefined,
      saleChannel: (req.saleChannel as any) ?? "admin",
      operationStatus: "anulada",
      reservationId: req.linkedReservationId ?? undefined,
      invoiceNumber: req.invoiceRef ?? cancellationNumber,
      sellerUserId: adminUserId,
      sellerName: adminUserName,
    } as any);
  }

  // ── 6. Log de propagación ─────────────────────────────────────────────────
  await addLog(
    requestId,
    "system_propagation",
    {
      cancellationNumber,
      reservationCancelled: !!reservationId,
      reavClosed: !!reservationId,
      refundTransactionCreated: compensationType === "devolucion" && !!refundAmount,
    },
    adminUserId,
    adminUserName
  );

  return { cancellationNumber };
}

// ─── Email templates ──────────────────────────────────────────────────────────

function emailAcuseRecibo(fullName: string, requestId: number, locator?: string, reason?: string): string {
  return buildCancellationReceivedHtml({ fullName, requestId, locator, reason });
}

function emailRechazo(fullName: string, requestId: number, adminText?: string): string {
  return buildCancellationRejectedHtml({ fullName, requestId, adminText });
}
function emailAceptacionDevolucion(fullName: string, requestId: number, amount: string, isPartial: boolean): string {
  return buildCancellationAcceptedRefundHtml({ fullName, requestId, amount, isPartial });
}
function emailAceptacionBono(fullName: string, requestId: number, voucherCode: string, activityName: string, value: string, expiresAt: string, isPartial: boolean): string {
  return buildCancellationAcceptedVoucherHtml({ fullName, requestId, voucherCode, activityName, value, expiresAt, isPartial });
}
function emailSolicitudDocumentacion(fullName: string, requestId: number, adminText: string): string {
  return buildCancellationDocumentationHtml({ fullName, requestId, adminText });
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

      // Registrar en el log de actividad del dashboard
      await logActivity(
        "reservation",
        requestId,
        "cancellation_request_received",
        null,
        "Sistema (web pública)",
        {
          fullName: input.fullName,
          reason: input.reason,
          activityDate: input.activityDate,
          locator: input.locator ?? null,
        }
      ).catch(() => {});

      return { success: true, requestId };
    }),

  // ── Listado (admin) ─────────────────────────────────────────────────────────────────────────────
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

        // ── Registrar en discount_codes para que sea canjeable en reservas ──────
        // El bono compensatorio se convierte en un código de descuento de importe
        // fijo (tipo 'fixed') con uso único, vinculado al cliente y al voucher.
        try {
          const discountName = `Bono compensatorio #${input.id} — ${input.activityName ?? "Náyade Experiences"}`;
          const discountDescription = [
            `Bono emitido como compensación por anulación de reserva.`,
            input.activityName ? `Actividad: ${input.activityName}.` : null,
            input.voucherConditions ? `Condiciones: ${input.voucherConditions}` : null,
          ].filter(Boolean).join(" ");
          await db.insert(discountCodes).values({
            code,
            name: discountName,
            description: discountDescription,
            discountType: "fixed",
            discountPercent: "0",
            discountAmount: String(input.voucherValue!.toFixed(2)),
            expiresAt: input.voucherExpiresAt ? new Date(input.voucherExpiresAt) : undefined,
            status: "active",
            maxUses: 1,
            currentUses: 0,
            observations: `Generado automáticamente desde anulación #${input.id}. Voucher ID: ${voucherId}.`,
            origin: "voucher",
            compensationVoucherId: voucherId,
            clientEmail: req.email ?? undefined,
            clientName: req.fullName ?? undefined,
          } as any);
          await addLog(input.id, "voucher_generated", { discountCodeCreated: true, code }, ctx.user.id, ctx.user.name ?? "Admin");
        } catch (e) {
          console.error("[Cancellations] Error creando discount_code para bono:", e);
        }

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

      // ── Propagación transversal (reserva, operaciones, REAV, contabilidad, número ANU-) ──
      const { cancellationNumber } = await propagateCancellation({
        requestId: input.id,
        req,
        refundAmount: input.compensationType === "devolucion" ? input.refundAmount : undefined,
        compensationType: input.compensationType,
        adminUserId: ctx.user.id,
        adminUserName: ctx.user.name ?? "Admin",
      });

      return { success: true, voucherId, cancellationNumber };
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

  // ── Consultar impacto de una anulación (preview antes de aprobar) ────────────
  getImpact: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      let reservation = null;
      let reservationOp = null;
      let reavExpedient = null;

      if (req.linkedReservationId) {
        const [r] = await db.select().from(reservations).where(eq(reservations.id, req.linkedReservationId));
        reservation = r ?? null;

        const [op] = await db.select().from(reservationOperational)
          .where(eq(reservationOperational.reservationId, req.linkedReservationId))
          .limit(1);
        reservationOp = op ?? null;

        const [exp] = await db.select().from(reavExpedients)
          .where(eq(reavExpedients.reservationId, req.linkedReservationId))
          .limit(1);
        reavExpedient = exp ?? null;
      }

      return {
        request: req,
        propagation: {
          willCancelReservation: !!reservation && reservation.status !== "cancelled",
          willUpdateOperational: !!reservationOp && reservationOp.opStatus !== "anulado",
          willCloseReav: !!reavExpedient && reavExpedient.operativeStatus !== "anulado",
          willCreateRefundTransaction: !!req.resolvedAmount && parseFloat(String(req.resolvedAmount)) > 0,
          reservationRef: reservation ? (reservation as any).reservationRef ?? null : null,
          reavExpedientNumber: reavExpedient ? reavExpedient.expedientNumber : null,
        },
      };
    }),
});
