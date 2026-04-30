/**
 * Router: Solicitudes de Anulación
 * Módulo CRM para gestión completa del pipeline de anulaciones.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure, permissionProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { assertModuleEnabled } from "../_core/flagGuard";
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
  invoices,
  quotes,
  type CancellationRequest,
} from "../../drizzle/schema";
import { eq, desc, and, like, or, sql, lt, inArray } from "drizzle-orm";
import { sendEmail } from "../mailer";
import {
  buildCancellationReceivedHtml,
  buildCancellationRejectedHtml,
  buildCancellationAcceptedRefundHtml,
  buildCancellationAcceptedVoucherHtml,
  buildCancellationDocumentationHtml,
  buildCancellationRefundExecutedHtml,
} from "../emailTemplates";
import { storagePut } from "../storage";
import { generateDocumentNumber } from "../documentNumbers";
import { logActivity } from "../db";
import { getBusinessEmail } from "../config";
const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

const getCopyEmail = () => getBusinessEmail('cancellations');

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
  compensationType: "devolucion" | "bono" | "ninguna";
  adminUserId: number;
  adminUserName: string;
}): Promise<{ cancellationNumber: string; creditNoteNumber?: string }> {
  const { requestId, req, refundAmount, compensationType, adminUserId, adminUserName } = params;

  // ── 1. Generar número ANU- (fuera de la tx, no se puede hacer rollback de numeración) ──
  const cancellationNumber = await generateDocumentNumber(
    "anulacion",
    `cancellations:acceptRequest:${compensationType}`,
    String(adminUserId)
  );

  // Si hay factura vinculada, pre-generar el número de abono también fuera de la tx
  let creditNoteNumber: string | undefined;
  let originalInvoice: typeof invoices.$inferSelect | null = null;

  const reservationId = req.linkedReservationId;
  if (reservationId) {
    const [res] = await db.select({ invoiceId: reservations.invoiceId, invoiceNumber: reservations.invoiceNumber })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);

    if (res?.invoiceId) {
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, res.invoiceId as number)).limit(1);
      if (inv && inv.status !== "abonada" && inv.status !== "anulada") {
        originalInvoice = inv;
        creditNoteNumber = await generateDocumentNumber(
          "abono",
          `cancellations:creditNote:${requestId}`,
          String(adminUserId)
        );
      }
    }
  }

  // ── 2. Todo lo que afecta a otras tablas: dentro de transacción ACID ───────
  await db.transaction(async (tx) => {
    // Guardar el número ANU en la solicitud
    await tx.update(cancellationRequests)
      .set({ cancellationNumber })
      .where(eq(cancellationRequests.id, requestId));

    // ── Cancelar la reserva vinculada ─────────────────────────────────────
    if (reservationId) {
      await tx.update(reservations)
        .set({
          status: "cancelled",
          statusReservation: "ANULADA",
        })
        .where(eq(reservations.id, reservationId));

      // ── Actualizar estado operativo ──────────────────────────────────────
      await tx.update(reservationOperational)
        .set({ opStatus: "anulado", updatedBy: adminUserId })
        .where(eq(reservationOperational.reservationId, reservationId));

      // ── Cerrar expediente REAV si existe ──────────────────────────────────
      const [reavExp] = await tx.select({ id: reavExpedients.id })
        .from(reavExpedients)
        .where(eq(reavExpedients.reservationId, reservationId))
        .limit(1);
      if (reavExp) {
        await tx.update(reavExpedients)
          .set({
            fiscalStatus: "anulado",
            operativeStatus: "anulado",
            closedAt: new Date(),
            internalNotes: `Anulado por expediente ${cancellationNumber} el ${new Date().toLocaleDateString("es-ES")}`,
          })
          .where(eq(reavExpedients.id, reavExp.id));
      }

      // ── Factura rectificativa (abono) ─────────────────────────────────────
      // Se genera siempre que exista factura válida, independientemente del tipo de compensación.
      // El importe del abono = resolvedAmount (parcial) o total de la factura (total).
      if (originalInvoice && creditNoteNumber) {
        const creditAmount = refundAmount && refundAmount > 0
          ? String(refundAmount.toFixed(2))
          : String(Math.abs(Number(originalInvoice.total)).toFixed(2));

        const taxRate = Number(originalInvoice.taxRate ?? 0);
        const creditSubtotal = taxRate > 0
          ? String((Number(creditAmount) / (1 + taxRate / 100)).toFixed(2))
          : creditAmount;
        const creditTax = taxRate > 0
          ? String((Number(creditAmount) - Number(creditSubtotal)).toFixed(2))
          : "0";

        // Crear factura de abono (importe negativo en cuenta de resultados)
        await tx.insert(invoices).values({
          invoiceNumber: creditNoteNumber,
          reservationId,
          clientName: originalInvoice.clientName,
          clientEmail: originalInvoice.clientEmail,
          clientPhone: originalInvoice.clientPhone ?? undefined,
          clientNif: originalInvoice.clientNif ?? undefined,
          clientAddress: originalInvoice.clientAddress ?? undefined,
          itemsJson: [{
            description: `Abono por anulación ${cancellationNumber} — ${originalInvoice.invoiceNumber}`,
            quantity: 1,
            unitPrice: -Number(creditAmount),
            total: -Number(creditAmount),
          }],
          subtotal: `-${creditSubtotal}`,
          taxRate: String(taxRate),
          taxAmount: `-${creditTax}`,
          total: `-${creditAmount}`,
          currency: originalInvoice.currency ?? "EUR",
          invoiceType: "abono",
          creditNoteForId: originalInvoice.id,
          creditNoteReason: `Anulación de reserva. Expediente ${cancellationNumber}.`,
          isAutomatic: false,
          status: "generada",
        } as any);

        // Marcar la factura original como abonada
        await tx.update(invoices)
          .set({ status: "abonada" })
          .where(eq(invoices.id, originalInvoice.id));
      }
    }

    // ── Transacción contable de devolución (solo si hay importe a devolver) ─
    if (compensationType === "devolucion" && refundAmount != null && refundAmount > 0) {
      const txNumber = await generateDocumentNumber(
        "factura",
        `cancellations:refundTransaction:${requestId}`,
        String(adminUserId)
      );
      const refundTxNumber = txNumber.replace("FAC-", "DEV-");
      await tx.insert(transactions).values({
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
        invoiceNumber: creditNoteNumber ?? (req.invoiceRef ?? cancellationNumber),
        sellerUserId: adminUserId,
        sellerName: adminUserName,
      } as any);
    }
  });

  // ── 3. Log de propagación (fuera de tx — no crítico) ──────────────────────
  await addLog(
    requestId,
    "system_propagation",
    {
      cancellationNumber,
      reservationCancelled: !!req.linkedReservationId,
      reavClosed: !!req.linkedReservationId,
      creditNoteGenerated: !!creditNoteNumber,
      creditNoteNumber: creditNoteNumber ?? null,
      originalInvoiceNumber: originalInvoice?.invoiceNumber ?? null,
      refundTransactionCreated: compensationType === "devolucion" && !!refundAmount,
    },
    adminUserId,
    adminUserName
  );

  return { cancellationNumber, creditNoteNumber };
}

// ─── Partial line cancellation ────────────────────────────────────────────────

type CancelledLineItem = { index: number; name: string; priceCents: number; quantity: number };

async function partialLineCancellation(params: {
  requestId: number;
  req: CancellationRequest;
  cancelledItems: CancelledLineItem[];
  refundAmount?: number;
  compensationType: "devolucion" | "bono" | "ninguna";
  adminUserId: number;
  adminUserName: string;
}): Promise<{ cancellationNumber: string }> {
  const { requestId, req, cancelledItems, refundAmount, compensationType, adminUserId, adminUserName } = params;

  const cancellationNumber = await generateDocumentNumber(
    "anulacion",
    `cancellations:partialLine:${requestId}`,
    String(adminUserId)
  );

  if (req.linkedReservationId) {
    const [res] = await db
      .select({ extrasJson: reservations.extrasJson, amountTotal: reservations.amountTotal })
      .from(reservations)
      .where(eq(reservations.id, req.linkedReservationId))
      .limit(1);

    if (res) {
      const extras: any[] = (() => { try { return JSON.parse(res.extrasJson ?? "[]"); } catch { return []; } })();
      const cancelledByIndex = new Map(cancelledItems.map((i) => [i.index, i.quantity]));
      const remainingExtras = extras
        .map((extra, idx) => {
          const cancelQty = cancelledByIndex.get(idx);
          if (cancelQty == null) return extra; // not touched
          const remaining = (extra.quantity ?? 1) - cancelQty;
          if (remaining <= 0) return null; // fully cancelled
          return { ...extra, quantity: remaining }; // partially cancelled — reduce quantity
        })
        .filter(Boolean);
      const cancelledCents = cancelledItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);
      const newAmountTotal = Math.max(0, res.amountTotal - cancelledCents);

      await db.transaction(async (tx) => {
        await tx.update(reservations)
          .set({ extrasJson: JSON.stringify(remainingExtras), amountTotal: newAmountTotal })
          .where(eq(reservations.id, req.linkedReservationId!));

        await tx.update(cancellationRequests)
          .set({ cancellationNumber })
          .where(eq(cancellationRequests.id, requestId));

        if (compensationType === "devolucion" && refundAmount != null && refundAmount > 0) {
          const txNum = await generateDocumentNumber(
            "factura",
            `cancellations:partialLineRefund:${requestId}`,
            String(adminUserId)
          );
          await tx.insert(transactions).values({
            transactionNumber: txNum.replace("FAC-", "DEV-"),
            type: "reembolso",
            amount: String(-Math.abs(refundAmount)),
            currency: "EUR",
            paymentMethod: "transferencia",
            status: "completado",
            description: `Devolución línea anulada ${cancellationNumber} — ${req.fullName}`,
            processedAt: new Date(),
            clientName: req.fullName,
            clientEmail: req.email ?? undefined,
            clientPhone: req.phone ?? undefined,
            saleChannel: (req.saleChannel as any) ?? "admin",
            operationStatus: "reembolsada",
            reservationId: req.linkedReservationId ?? undefined,
            invoiceNumber: req.invoiceRef ?? cancellationNumber,
            sellerUserId: adminUserId,
            sellerName: adminUserName,
          } as any);
        }
      });
    }
  }

  await addLog(
    requestId,
    "system_propagation",
    {
      cancellationNumber,
      scope: "lineas",
      cancelledItems,
      reservationUpdated: !!req.linkedReservationId,
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

const adminProcedure = permissionProcedure("crm.reservations.manage", ["admin"]).use(async ({ ctx, next }) => {
  await assertModuleEnabled("cancellations_module_enabled");
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

      // ── Auto-vinculación: buscar reserva por localizador ─────────────────
      // Si el cliente proporcionó un localizador que coincide con una reserva real,
      // vinculamos automáticamente para que la propagación no quede huérfana.
      if (input.locator?.trim()) {
        try {
          const loc = input.locator.trim();
          const [matchedRes] = await db
            .select({ id: reservations.id, reservationNumber: reservations.reservationNumber })
            .from(reservations)
            .where(
              and(
                or(
                  eq(reservations.reservationNumber, loc),
                  eq(reservations.merchantOrder, loc),
                ),
                sql`${reservations.status} != 'cancelled'`
              )
            )
            .limit(1);

          if (matchedRes) {
            await db.update(cancellationRequests)
              .set({ linkedReservationId: matchedRes.id })
              .where(eq(cancellationRequests.id, requestId));

            await db.update(reservations)
              .set({ cancellationRequestId: requestId } as any)
              .where(eq(reservations.id, matchedRes.id));

            await addLog(requestId, "linked_reservation", {
              source: "auto_locator",
              reservationId: matchedRes.id,
              reservationNumber: matchedRes.reservationNumber,
            });
          }
        } catch (linkErr) {
          console.error("[cancellations] Error en auto-vinculación por localizador:", linkErr);
        }
      }

      // Log de creación
      await addLog(requestId, "created", {
        source: "landing_publica",
        reason: input.reason,
      });

      // Email acuse de recibo al cliente
      if (input.email) {
        await sendEmail({
          to: input.email,
          cc: await getCopyEmail(),
          subject: `Solicitud de anulación recibida — Ref. #${requestId}`,
          html: emailAcuseRecibo(input.fullName, requestId),
        }).catch(() => {});
      }

      // Notificación interna a reservas
      await sendEmail({
        to: await getCopyEmail(),
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
        .select({
          id: cancellationRequests.id,
          fullName: cancellationRequests.fullName,
          email: cancellationRequests.email,
          phone: cancellationRequests.phone,
          activityDate: cancellationRequests.activityDate,
          reason: cancellationRequests.reason,
          reasonDetail: cancellationRequests.reasonDetail,
          locator: cancellationRequests.locator,
          linkedReservationId: cancellationRequests.linkedReservationId,
          reservationNumber: reservations.reservationNumber,
          operationalStatus: cancellationRequests.operationalStatus,
          resolutionStatus: cancellationRequests.resolutionStatus,
          financialStatus: cancellationRequests.financialStatus,
          compensationType: cancellationRequests.compensationType,
          resolvedAmount: cancellationRequests.resolvedAmount,
          cancellationNumber: cancellationRequests.cancellationNumber,
          voucherId: cancellationRequests.voucherId,
          assignedUserId: cancellationRequests.assignedUserId,
          createdAt: cancellationRequests.createdAt,
          updatedAt: cancellationRequests.updatedAt,
          closedAt: cancellationRequests.closedAt,
        })
        .from(cancellationRequests)
        .leftJoin(reservations, eq(cancellationRequests.linkedReservationId, reservations.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(cancellationRequests.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // KPIs — agregados en BD con COUNT GROUP BY, sin cargar toda la tabla en memoria
      const [kpiByOpStatus, kpiByResStatus, kpiByFinStatus] = await Promise.all([
        db.select({ status: cancellationRequests.operationalStatus, count: sql<number>`COUNT(*)` })
          .from(cancellationRequests).groupBy(cancellationRequests.operationalStatus),
        db.select({ status: cancellationRequests.resolutionStatus, count: sql<number>`COUNT(*)` })
          .from(cancellationRequests).groupBy(cancellationRequests.resolutionStatus),
        db.select({ status: cancellationRequests.financialStatus, count: sql<number>`COUNT(*)` })
          .from(cancellationRequests).groupBy(cancellationRequests.financialStatus),
      ]);
      const opCount = (s: string) => Number(kpiByOpStatus.find(r => r.status === s)?.count ?? 0);
      const resCount = (s: string) => Number(kpiByResStatus.find(r => r.status === s)?.count ?? 0);
      const finCount = (s: string) => Number(kpiByFinStatus.find(r => r.status === s)?.count ?? 0);
      const kpis = {
        total: kpiByOpStatus.reduce((s, r) => s + Number(r.count), 0),
        recibidas: opCount("recibida"),
        enRevision: opCount("en_revision"),
        pendienteDocumentacion: opCount("pendiente_documentacion"),
        resueltasTotal: resCount("aceptada_total"),
        resueltasParcial: resCount("aceptada_parcial"),
        rechazadas: resCount("rechazada"),
        devueltas: finCount("devuelta_economicamente"),
        compensadasBono: finCount("compensada_bono"),
        cerradas: opCount("cerrada"),
        incidencias: opCount("incidencia"),
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

      let linkedReservation: {
        id: number;
        reservationNumber: string | null;
        productName: string;
        bookingDate: string;
        people: number;
        amountTotal: number;
        amountPaid: number | null;
        status: string;
        extrasJson: string | null;
        pricingType: string | null;
        unitsBooked: number | null;
        unitCapacity: number | null;
        cancellableItemsJson: string | null;
      } | null = null;
      if (req.linkedReservationId) {
        const [r] = await db
          .select({
            id: reservations.id,
            reservationNumber: reservations.reservationNumber,
            productName: reservations.productName,
            bookingDate: reservations.bookingDate,
            people: reservations.people,
            amountTotal: reservations.amountTotal,
            amountPaid: reservations.amountPaid,
            status: reservations.status,
            extrasJson: reservations.extrasJson,
            pricingType: reservations.pricingType,
            unitsBooked: reservations.unitsBooked,
            unitCapacity: reservations.unitCapacity,
            quoteId: reservations.quoteId,
          })
          .from(reservations)
          .where(eq(reservations.id, req.linkedReservationId));

        if (r) {
          // Si extrasJson está vacío pero la reserva viene de un presupuesto,
          // usamos las líneas del presupuesto como items cancelables
          let cancellableItemsJson: string | null = null;
          const hasExtras = (() => { try { return JSON.parse(r.extrasJson ?? "[]").length > 0; } catch { return false; } })();

          if (!hasExtras) {
            // Resolver quoteId por varios caminos cuando reservations.quoteId es NULL
            let quoteId: number | null = r.quoteId ?? null;

            // Fallback 1: linkedQuoteId en la propia solicitud de anulación
            if (!quoteId && req.linkedQuoteId) {
              quoteId = req.linkedQuoteId;
            }

            // Fallback 2: buscar en invoices por reservationId (siempre almacena quoteId + reservationId)
            if (!quoteId) {
              const [inv] = await db
                .select({ quoteId: invoices.quoteId })
                .from(invoices)
                .where(eq(invoices.reservationId, r.id))
                .limit(1);
              quoteId = inv?.quoteId ?? null;
            }

            if (quoteId) {
              const [q] = await db
                .select({ items: quotes.items })
                .from(quotes)
                .where(eq(quotes.id, quoteId))
                .limit(1);
              if (q?.items && Array.isArray(q.items) && q.items.length > 0) {
                const normalized = q.items.map((item: any) => ({
                  name: item.description ?? "Línea",
                  price: Math.round((item.unitPrice ?? 0) * 100),
                  quantity: item.quantity ?? 1,
                }));
                cancellableItemsJson = JSON.stringify(normalized);
              }
            }
          }

          linkedReservation = { ...r, cancellableItemsJson };
        }
      }

      return { request: req, logs, voucher, linkedReservation };
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

      // Al rechazar cerramos directamente el expediente — no hay pasos pendientes.
      await db.update(cancellationRequests).set({
        operationalStatus: "cerrada",
        resolutionStatus: "rechazada",
        financialStatus: "sin_compensacion",
        compensationType: "ninguna",
        closedAt: new Date(),
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "rejected",
        { adminText: input.adminText, emailSent: input.sendEmail && !!req.email },
        ctx.user.id, ctx.user.name ?? "Admin",
        req.operationalStatus, "cerrada"
      );

      if (input.sendEmail && req.email) {
        await sendEmail({
          to: req.email,
          cc: await getCopyEmail(),
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
        // Scope: "total" = cancel whole reservation, "lineas" = cancel specific extras only
        cancellationScope: z.enum(["total", "lineas"]).default("total"),
        cancelledItems: z.array(z.object({
          index: z.number(),
          name: z.string(),
          priceCents: z.number(),
          quantity: z.number(),
        })).optional(),
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

      // Guard idempotencia: no permitir doble aceptación
      if (req.resolutionStatus !== "sin_resolver") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Esta solicitud ya tiene resolución: "${req.resolutionStatus}". No se puede aceptar de nuevo.`,
        });
      }

      const resolutionStatus = input.isPartial ? "aceptada_parcial" : "aceptada_total";
      let financialStatus: "pendiente_devolucion" | "pendiente_bono" | "compensada_bono" = "pendiente_devolucion";
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
          cancellationScope: input.cancellationScope,
          cancelledItemsJson: input.cancelledItems ? JSON.stringify(input.cancelledItems) : null,
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
            cc: await getCopyEmail(),
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
        financialStatus = "compensada_bono";
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
          status: "enviado",
          sentAt: new Date(),
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
          cancellationScope: input.cancellationScope,
          cancelledItemsJson: input.cancelledItems ? JSON.stringify(input.cancelledItems) : null,
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
            cc: await getCopyEmail(),
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

      // ── Propagación: bifurca según ámbito ────────────────────────────────────
      let cancellationNumber: string;
      let creditNoteNumber: string | undefined;

      if (input.cancellationScope === "lineas" && input.cancelledItems?.length) {
        // Anulación parcial de líneas — la reserva NO se cancela
        ({ cancellationNumber } = await partialLineCancellation({
          requestId: input.id,
          req,
          cancelledItems: input.cancelledItems,
          refundAmount: input.compensationType === "devolucion" ? input.refundAmount : undefined,
          compensationType: input.compensationType,
          adminUserId: ctx.user.id,
          adminUserName: ctx.user.name ?? "Admin",
        }));
      } else {
        // Anulación total — reserva pasa a cancelled, REAV, abono contable
        ({ cancellationNumber, creditNoteNumber } = await propagateCancellation({
          requestId: input.id,
          req,
          refundAmount: input.compensationType === "devolucion" ? input.refundAmount : undefined,
          compensationType: input.compensationType,
          adminUserId: ctx.user.id,
          adminUserName: ctx.user.name ?? "Admin",
        }));
      }

      return { success: true, voucherId, cancellationNumber, creditNoteNumber };
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

      let emailSent = false;
      if (input.sendEmail && req.email) {
        emailSent = await sendEmail({
          to: req.email,
          cc: await getCopyEmail(),
          subject: `Documentación requerida — Solicitud #${input.id}`,
          html: emailSolicitudDocumentacion(req.fullName, input.id, input.text),
        });
        if (emailSent) {
          await addLog(input.id, "email_sent", { type: "solicitud_documentacion", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
        } else {
          console.error(`[Cancellations] requestDocumentation email FAILED for request #${input.id} → ${req.email}`);
          await addLog(input.id, "email_failed", { type: "solicitud_documentacion", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
        }
      }

      return { success: true, emailSent };
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
    .input(z.object({
      id: z.number(),
      note: z.string().optional(),
      executedAt: z.string().optional(),
      proofUrl: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.compensationType !== "devolucion") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Este expediente tiene compensación "${req.compensationType}", no una devolución económica.`,
        });
      }
      if (req.financialStatus === "devuelta_economicamente") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La devolución ya fue marcada como ejecutada anteriormente.",
        });
      }
      if (req.financialStatus !== "pendiente_devolucion") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `El estado financiero actual es "${req.financialStatus}". Solo se puede marcar como ejecutada cuando está en "pendiente_devolucion".`,
        });
      }

      const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();
      await db.update(cancellationRequests).set({
        financialStatus: "devuelta_economicamente",
        refundExecutedAt: executedAt,
        refundProofUrl: input.proofUrl ?? null,
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(input.id, "refund_executed", { note: input.note, proofUrl: input.proofUrl, executedAt: executedAt.toISOString(), oldStatus: req.financialStatus }, ctx.user.id, ctx.user.name ?? "Admin");

      if (req.email) {
        const amount = req.resolvedAmount != null ? Number(req.resolvedAmount).toFixed(2) : "—";
        const executedAtFormatted = executedAt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
        const emailSent = await sendEmail({
          to: req.email,
          cc: await getCopyEmail(),
          subject: `Devolución realizada — Solicitud #${input.id}`,
          html: buildCancellationRefundExecutedHtml({
            fullName: req.fullName,
            requestId: input.id,
            amount,
            executedAt: executedAtFormatted,
          }),
        });
        if (emailSent) {
          await addLog(input.id, "email_sent", { type: "refund_executed_notification", to: req.email }, ctx.user.id, ctx.user.name ?? "Admin");
        } else {
          console.error(`[Cancellations] markRefundExecuted email FAILED for request #${input.id} → ${req.email}`);
        }
      }

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

  // ── ACCIÓN: Revertir resolución (deshacer aceptación o rechazo) ─────────────
  revertResolution: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.resolutionStatus === "sin_resolver") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta solicitud no tiene resolución que revertir." });
      }

      const oldResolution = req.resolutionStatus;
      const oldOperational = req.operationalStatus;
      const oldFinancial = req.financialStatus;

      await db.update(cancellationRequests).set({
        resolutionStatus: "sin_resolver",
        operationalStatus: "en_revision",
        financialStatus: "sin_compensacion",
        compensationType: null,
        resolvedAmount: null,
        closedAt: null,
      }).where(eq(cancellationRequests.id, input.id));

      await addLog(
        input.id, "resolution_reverted",
        { reason: input.reason, oldResolution, oldOperational, oldFinancial },
        ctx.user.id, ctx.user.name ?? "Admin",
        oldResolution, "sin_resolver"
      );

      return { success: true };
    }),

  // ── Enviar todos los templates de email a una dirección (test/auditoría) ────
  sendTestEmails: adminProcedure
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ input }) => {
      const SAMPLE_NAME = "Carlos García López";
      const SAMPLE_ID = 99;
      const SAMPLE_LOCATOR = "NYD-2026-TEST";
      const SAMPLE_DATE = "20 de abril de 2026";

      const templates: { subject: string; html: string }[] = [
        {
          subject: `[1/8] Solicitud de anulación recibida — Ref. #${SAMPLE_ID}`,
          html: buildCancellationReceivedHtml({
            fullName: SAMPLE_NAME,
            requestId: SAMPLE_ID,
            locator: SAMPLE_LOCATOR,
            reason: "meteorologicas",
          }),
        },
        {
          subject: `[2/8] Documentación requerida — Solicitud #${SAMPLE_ID}`,
          html: emailSolicitudDocumentacion(
            SAMPLE_NAME,
            SAMPLE_ID,
            "Por favor, adjunta el parte meteorológico oficial de AEMET correspondiente al día de la actividad, o cualquier justificante oficial que acredite las condiciones adversas."
          ),
        },
        {
          subject: `[3/8] Resolución de tu solicitud de anulación #${SAMPLE_ID} — RECHAZADA`,
          html: emailRechazo(
            SAMPLE_NAME,
            SAMPLE_ID,
            "Según nuestras condiciones generales, las cancelaciones por condiciones meteorológicas deben solicitarse con un mínimo de 24h de antelación a la actividad."
          ),
        },
        {
          subject: `[4/8] Aceptación de tu solicitud #${SAMPLE_ID} — Devolución TOTAL`,
          html: emailAceptacionDevolucion(SAMPLE_NAME, SAMPLE_ID, "405.00", false),
        },
        {
          subject: `[5/8] Aceptación de tu solicitud #${SAMPLE_ID} — Devolución PARCIAL`,
          html: emailAceptacionDevolucion(SAMPLE_NAME, SAMPLE_ID, "135.00", true),
        },
        {
          subject: `[6/8] Bono de compensación TOTAL — Solicitud #${SAMPLE_ID}`,
          html: emailAceptacionBono(
            SAMPLE_NAME,
            SAMPLE_ID,
            "BON-2026-TEST1",
            "Cableski & Wakeboard Angeles de San Rafael",
            "405.00",
            "31 de diciembre de 2026",
            false
          ),
        },
        {
          subject: `[7/8] Bono de compensación PARCIAL — Solicitud #${SAMPLE_ID}`,
          html: emailAceptacionBono(
            SAMPLE_NAME,
            SAMPLE_ID,
            "BON-2026-TEST2",
            "Cableski & Wakeboard Angeles de San Rafael",
            "135.00",
            "31 de diciembre de 2026",
            true
          ),
        },
        {
          subject: `[8/8] Devolución realizada — Solicitud #${SAMPLE_ID}`,
          html: buildCancellationRefundExecutedHtml({
            fullName: SAMPLE_NAME,
            requestId: SAMPLE_ID,
            amount: "405.00",
            executedAt: SAMPLE_DATE,
          }),
        },
      ];

      const results: { subject: string; sent: boolean }[] = [];
      for (const t of templates) {
        const sent = await sendEmail({ to: input.to, subject: t.subject, html: t.html });
        results.push({ subject: t.subject, sent });
      }

      const failed = results.filter(r => !r.sent).length;
      return { total: templates.length, failed, results };
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
      const rows = await db
        .select({
          status: cancellationRequests.operationalStatus,
          count: sql<number>`COUNT(*)`,
          totalRefundable: sql<number>`COALESCE(SUM(CAST(resolved_amount AS DECIMAL(10,2))), 0)`,
        })
        .from(cancellationRequests)
        .groupBy(cancellationRequests.operationalStatus);
      const get = (s: string) => Number(rows.find(r => r.status === s)?.count ?? 0);
      const val = (s: string) => Number(rows.find(r => r.status === s)?.totalRefundable ?? 0);
      const pendingStatuses = ["recibida", "en_revision", "pendiente_documentacion", "pendiente_decision"];
      return {
        total: rows.reduce((s, r) => s + Number(r.count), 0),
        pending: get("recibida") + get("en_revision") + get("pendiente_documentacion") + get("pendiente_decision"),
        incidencias: get("incidencia"),
        importePendiente: pendingStatuses.reduce((s, st) => s + val(st), 0),
        importeIncidencias: val("incidencia"),
        importeTotal: rows.reduce((s, r) => s + Number(r.totalRefundable), 0),
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

  // ── Crear solicitud manual (admin) ─────────────────────────────────────────
  createManualRequest: adminProcedure
    .input(
      z.object({
        fullName: z.string().min(2),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        activityDate: z.string().min(1),
        reason: z.enum(["meteorologicas", "accidente", "enfermedad", "desistimiento", "otra"]),
        reasonDetail: z.string().optional(),
        locator: z.string().optional(),
        adminNotes: z.string().optional(),
        linkedReservationId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(cancellationRequests).values({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        activityDate: input.activityDate,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        termsChecked: true,
        source: "admin_manual",
        locator: input.locator,
        adminNotes: input.adminNotes,
        operationalStatus: "recibida",
        resolutionStatus: "sin_resolver",
        financialStatus: "sin_compensacion",
        compensationType: "ninguna",
        linkedReservationId: input.linkedReservationId,
        assignedUserId: ctx.user.id,
      });
      const requestId = (result as { insertId: number }).insertId;

      // Si viene con reserva vinculada, actualizar el FK inverso
      if (input.linkedReservationId) {
        await db.update(reservations)
          .set({ cancellationRequestId: requestId } as any)
          .where(eq(reservations.id, input.linkedReservationId));
      }

      await addLog(requestId, "created", {
        source: "admin_manual",
        adminUserId: ctx.user.id,
        linkedReservationId: input.linkedReservationId,
      }, ctx.user.id, ctx.user.name ?? "Admin");

      await logActivity(
        "reservation",
        requestId,
        "cancellation_request_created_manual",
        ctx.user.id,
        ctx.user.name ?? "Admin",
        { fullName: input.fullName, reason: input.reason, activityDate: input.activityDate }
      ).catch(() => {});

      // Email acuse de recibo al cliente (mismo que en la landing pública)
      if (input.email) {
        await sendEmail({
          to: input.email,
          cc: await getCopyEmail(),
          subject: `Solicitud de anulación recibida — Ref. #${requestId}`,
          html: emailAcuseRecibo(input.fullName, requestId, input.locator, input.reason),
        }).catch(() => {});
        await addLog(requestId, "email_sent", { type: "acuse_recibo", to: input.email }, ctx.user.id, ctx.user.name ?? "Admin");
      }

      return { success: true, requestId };
    }),

  // ── Vincular solicitud a reserva existente (admin) ──────────────────────────
  linkToReservation: adminProcedure
    .input(
      z.object({
        requestId: z.number(),
        reservationId: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.requestId));
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada" });

      const [res] = await db.select().from(reservations).where(eq(reservations.id, input.reservationId));
      if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });

      // Desvincula la solicitud anterior de la reserva (si la hubiera)
      if (req.linkedReservationId && req.linkedReservationId !== input.reservationId) {
        await db.update(reservations)
          .set({ cancellationRequestId: null } as any)
          .where(eq(reservations.id, req.linkedReservationId));
      }

      await db.update(cancellationRequests)
        .set({ linkedReservationId: input.reservationId, locator: (res as any).reservationNumber ?? req.locator })
        .where(eq(cancellationRequests.id, input.requestId));

      await db.update(reservations)
        .set({ cancellationRequestId: input.requestId } as any)
        .where(eq(reservations.id, input.reservationId));

      await addLog(
        input.requestId, "linked_reservation",
        { reservationId: input.reservationId, reservationNumber: (res as any).reservationNumber },
        ctx.user.id, ctx.user.name ?? "Admin"
      );

      return { success: true };
    }),

  // ── Buscar reservas para vinculación (admin) ─────────────────────────────────
  searchReservations: adminProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      const q = `%${input.query}%`;
      const rows = await db
        .select({
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          customerName: reservations.customerName,
          customerEmail: reservations.customerEmail,
          productName: reservations.productName,
          bookingDate: reservations.bookingDate,
          status: reservations.status,
          cancellationRequestId: sql<number | null>`${reservations.cancellationRequestId}`,
        })
        .from(reservations)
        .where(
          and(
            sql`${reservations.status} != 'cancelled'`,
            or(
              like(reservations.reservationNumber, q),
              like(reservations.customerName, q),
              like(reservations.customerEmail, q),
              like(reservations.merchantOrder, q),
            )
          )
        )
        .orderBy(desc(reservations.createdAt))
        .limit(10);
      return rows;
    }),

  // ── Anular reserva directamente desde CRM (atajo ejecutivo) ─────────────────
  // Crea la solicitud ya cerrada y ejecuta propagateCancellation en un solo paso.
  cancelReservationDirect: adminProcedure
    .input(
      z.object({
        reservationId: z.number(),
        reason: z.enum(["meteorologicas", "accidente", "enfermedad", "desistimiento", "otra"]),
        reasonDetail: z.string().optional(),
        compensationType: z.enum(["devolucion", "bono", "ninguna"]),
        refundAmount: z.number().optional(),   // solo si compensationType = devolucion
        adminNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // ── Guardia: la reserva no debe tener ya una solicitud activa ─────────
      const [res] = await db.select({
        id: reservations.id,
        customerName: reservations.customerName,
        customerEmail: reservations.customerEmail,
        customerPhone: reservations.customerPhone,
        bookingDate: reservations.bookingDate,
        status: reservations.status,
        cancellationRequestId: sql<number | null>`${reservations.cancellationRequestId}`,
      }).from(reservations).where(eq(reservations.id, input.reservationId)).limit(1);

      if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva no encontrada" });
      if (res.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La reserva ya está anulada" });
      }
      if (res.cancellationRequestId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La reserva ya tiene el expediente de anulación #${res.cancellationRequestId} abierto. Gestiona la anulación desde el módulo de Anulaciones.`,
        });
      }

      // ── Crear solicitud de anulación ya resuelta y cerrada ────────────────
      const resolutionStatus = input.compensationType === "ninguna" ? "aceptada_total" : "aceptada_total";
      const financialStatus = input.compensationType === "devolucion"
        ? "pendiente_devolucion"
        : input.compensationType === "bono"
          ? "compensada_bono"
          : "sin_compensacion";

      const [result] = await db.insert(cancellationRequests).values({
        fullName: res.customerName,
        email: res.customerEmail ?? undefined,
        phone: res.customerPhone ?? undefined,
        activityDate: res.bookingDate,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        termsChecked: true,
        source: "admin_crm",
        locator: undefined,
        adminNotes: input.adminNotes,
        operationalStatus: "cerrada",
        resolutionStatus,
        financialStatus,
        compensationType: input.compensationType === "ninguna" ? "ninguna" : input.compensationType,
        resolvedAmount: input.refundAmount ? String(input.refundAmount) : undefined,
        linkedReservationId: input.reservationId,
        assignedUserId: ctx.user.id,
        closedAt: new Date(),
      });
      const requestId = (result as { insertId: number }).insertId;

      // Actualizar FK inverso en la reserva
      await db.update(reservations)
        .set({ cancellationRequestId: requestId } as any)
        .where(eq(reservations.id, input.reservationId));

      await addLog(requestId, "created", {
        source: "admin_crm",
        adminUserId: ctx.user.id,
        reservationId: input.reservationId,
      }, ctx.user.id, ctx.user.name ?? "Admin");

      // ── Propagar cancelación (reserva + factura abono + REAV + operaciones) ─
      const reqRecord = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, requestId)).limit(1).then(r => r[0]);

      const { cancellationNumber, creditNoteNumber } = await propagateCancellation({
        requestId,
        req: reqRecord,
        refundAmount: input.compensationType === "devolucion" ? input.refundAmount : undefined,
        compensationType: input.compensationType,
        adminUserId: ctx.user.id,
        adminUserName: ctx.user.name ?? "Admin",
      });

      await logActivity(
        "reservation",
        input.reservationId,
        "reservation_cancelled_direct",
        ctx.user.id,
        ctx.user.name ?? "Admin",
        { cancellationNumber, creditNoteNumber: creditNoteNumber ?? null, reason: input.reason }
      ).catch(() => {});

      // Email de resolución al cliente (mismo template que acceptRequest)
      if (res.customerEmail) {
        if (input.compensationType === "devolucion" && input.refundAmount) {
          await sendEmail({
            to: res.customerEmail,
            cc: await getCopyEmail(),
            subject: `Aceptación de tu solicitud de anulación #${requestId}`,
            html: emailAceptacionDevolucion(res.customerName, requestId, String(input.refundAmount), false),
          }).catch(() => {});
        } else {
          // Sin compensación o bono sin datos de voucher: notificamos la aceptación sin importe
          await sendEmail({
            to: res.customerEmail,
            cc: await getCopyEmail(),
            subject: `Aceptación de tu solicitud de anulación #${requestId}`,
            html: emailAceptacionDevolucion(res.customerName, requestId, "0.00", false),
          }).catch(() => {});
        }
        await addLog(requestId, "email_sent", { type: "aceptacion", to: res.customerEmail }, ctx.user.id, ctx.user.name ?? "Admin");
      }

      return { success: true, requestId, cancellationNumber, creditNoteNumber };
    }),

  // ── ACCIÓN: Registrar reclamación post-cierre del cliente ─────────────────
  addClientReclamation: adminProcedure
    .input(z.object({
      id: z.number(),
      description: z.string().min(1, "La descripción es obligatoria"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await addLog(
        input.id,
        "client_reclamation",
        { description: input.description },
        ctx.user.id,
        ctx.user.name ?? "Admin"
      );

      return { success: true };
    }),

  // ── GESTIÓN DE BONOS ─────────────────────────────────────────────────────

  getVoucherCounters: adminProcedure
    .query(async () => {
      const rows = await db
        .select({
          status: compensationVouchers.status,
          count: sql<number>`COUNT(*)`,
          totalValue: sql<number>`SUM(CAST(value AS DECIMAL(10,2)))`,
        })
        .from(compensationVouchers)
        .groupBy(compensationVouchers.status);

      const cnt = (s: string) => Number(rows.find(r => r.status === s)?.count ?? 0);
      const val = (s: string) => Number(rows.find(r => r.status === s)?.totalValue ?? 0);

      return {
        total: rows.reduce((s, r) => s + Number(r.count), 0),
        activos: cnt("enviado") + cnt("generado"),
        canjeados: cnt("canjeado"),
        caducados: cnt("caducado"),
        anulados: cnt("anulado"),
        importePendiente: Math.round((val("enviado") + val("generado")) * 100) / 100,
      };
    }),

  listVouchers: adminProcedure
    .input(z.object({
      status: z.enum(["all", "generado", "enviado", "canjeado", "caducado", "anulado"]).default("all"),
      search: z.string().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.status !== "all") {
        conditions.push(eq(compensationVouchers.status, input.status as "generado" | "enviado" | "canjeado" | "caducado" | "anulado"));
      }

      const rows = await db
        .select({
          id: compensationVouchers.id,
          code: compensationVouchers.code,
          activityName: compensationVouchers.activityName,
          value: compensationVouchers.value,
          status: compensationVouchers.status,
          expiresAt: compensationVouchers.expiresAt,
          issuedAt: compensationVouchers.issuedAt,
          sentAt: compensationVouchers.sentAt,
          redeemedAt: compensationVouchers.redeemedAt,
          requestId: compensationVouchers.requestId,
          clientName: cancellationRequests.fullName,
          clientEmail: cancellationRequests.email,
          cancellationNumber: cancellationRequests.cancellationNumber,
          linkedReservationId: cancellationRequests.linkedReservationId,
          reservationNumber: reservations.reservationNumber,
          discountCodeStatus: discountCodes.status,
          currentUses: discountCodes.currentUses,
        })
        .from(compensationVouchers)
        .leftJoin(cancellationRequests, eq(cancellationRequests.id, compensationVouchers.requestId))
        .leftJoin(reservations, eq(reservations.id, cancellationRequests.linkedReservationId))
        .leftJoin(discountCodes, eq(discountCodes.compensationVoucherId, compensationVouchers.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(compensationVouchers.issuedAt))
        .limit(input.limit);

      // Filtro de búsqueda en JS (evita complejidad JOIN para texto)
      if (input.search) {
        const s = input.search.toLowerCase();
        return rows.filter(r =>
          r.code.toLowerCase().includes(s) ||
          (r.clientName ?? "").toLowerCase().includes(s) ||
          (r.clientEmail ?? "").toLowerCase().includes(s) ||
          (r.cancellationNumber ?? "").toLowerCase().includes(s)
        );
      }

      return rows;
    }),

  // ── Ver detalle completo de un bono ──────────────────────────────────────────
  getVoucherById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [v] = await db
        .select({
          id: compensationVouchers.id,
          code: compensationVouchers.code,
          activityName: compensationVouchers.activityName,
          value: compensationVouchers.value,
          status: compensationVouchers.status,
          expiresAt: compensationVouchers.expiresAt,
          issuedAt: compensationVouchers.issuedAt,
          sentAt: compensationVouchers.sentAt,
          redeemedAt: compensationVouchers.redeemedAt,
          notes: compensationVouchers.notes,
          requestId: compensationVouchers.requestId,
          clientName: cancellationRequests.fullName,
          clientEmail: cancellationRequests.email,
          clientPhone: cancellationRequests.phone,
          cancellationNumber: cancellationRequests.cancellationNumber,
          linkedReservationId: cancellationRequests.linkedReservationId,
          reservationNumber: reservations.reservationNumber,
          discountCodeStatus: discountCodes.status,
          discountCodeCurrentUses: discountCodes.currentUses,
        })
        .from(compensationVouchers)
        .leftJoin(cancellationRequests, eq(cancellationRequests.id, compensationVouchers.requestId))
        .leftJoin(reservations, eq(reservations.id, cancellationRequests.linkedReservationId))
        .leftJoin(discountCodes, eq(discountCodes.compensationVoucherId, compensationVouchers.id))
        .where(eq(compensationVouchers.id, input.id))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      return v;
    }),

  // ── Eliminar bono permanentemente ─────────────────────────────────────────────
  deleteVoucher: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [voucher] = await db.select().from(compensationVouchers).where(eq(compensationVouchers.id, input.id));
      if (!voucher) throw new TRPCError({ code: "NOT_FOUND" });
      if (voucher.status === "canjeado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede eliminar un bono ya canjeado" });
      }
      await db.update(discountCodes).set({ status: "inactive", compensationVoucherId: null as any }).where(eq(discountCodes.compensationVoucherId, input.id));
      await db.delete(compensationVouchers).where(eq(compensationVouchers.id, input.id));
      if (voucher.requestId) {
        await addLog(voucher.requestId, "voucher_deleted", { voucherId: input.id, code: voucher.code }, ctx.user.id, ctx.user.name ?? "Admin");
      }
      return { success: true };
    }),

  // ── Reenviar todos los emails de un expediente a una dirección concreta ──────
  resendRequestEmails: adminProcedure
    .input(z.object({
      id: z.number(),
      to: z.string().email(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, input.id));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      const sent: { label: string; ok: boolean }[] = [];

      // 1. Acuse de recibo
      const ackOk = await sendEmail({
        to: input.to,
        subject: `Solicitud de anulación recibida — Ref. #${req.id}`,
        html: buildCancellationReceivedHtml({
          fullName: req.fullName,
          requestId: req.id,
          locator: req.locator ?? undefined,
          reason: req.reason ?? undefined,
        }),
      });
      sent.push({ label: "Acuse de recibo", ok: ackOk });

      // 2. Email de resolución (si la hay)
      if (req.resolutionStatus === "rechazada") {
        const ok = await sendEmail({
          to: input.to,
          subject: `Resolución de tu solicitud de anulación #${req.id}`,
          html: emailRechazo(req.fullName, req.id, undefined),
        });
        sent.push({ label: "Rechazo", ok });

      } else if (req.resolutionStatus === "aceptada_total" || req.resolutionStatus === "aceptada_parcial") {
        const isPartial = req.resolutionStatus === "aceptada_parcial";

        if (req.compensationType === "devolucion") {
          const amount = req.resolvedAmount != null ? Number(req.resolvedAmount).toFixed(2) : "—";
          const ok = await sendEmail({
            to: input.to,
            subject: `Aceptación de tu solicitud de anulación #${req.id}`,
            html: emailAceptacionDevolucion(req.fullName, req.id, amount, isPartial),
          });
          sent.push({ label: "Aceptación devolución", ok });

        } else if (req.compensationType === "bono") {
          // Buscar el bono vinculado
          const [voucher] = await db
            .select()
            .from(compensationVouchers)
            .where(eq(compensationVouchers.requestId, req.id))
            .limit(1);

          if (voucher) {
            const expiresStr = voucher.expiresAt
              ? new Date(voucher.expiresAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
              : "Sin caducidad";
            const ok = await sendEmail({
              to: input.to,
              subject: `Bono de compensación — Solicitud #${req.id}`,
              html: emailAceptacionBono(
                req.fullName,
                req.id,
                voucher.code,
                voucher.activityName ?? "Actividad Náyade Experiences",
                Number(voucher.value).toFixed(2),
                expiresStr,
                isPartial
              ),
            });
            sent.push({ label: `Bono ${voucher.code}`, ok });
          } else {
            sent.push({ label: "Bono (no encontrado)", ok: false });
          }
        }
      }

      // 3. Si ya está devuelto, también el email de confirmación de ejecución
      if (req.financialStatus === "devuelta_economicamente" && req.refundExecutedAt) {
        const amount = req.resolvedAmount != null ? Number(req.resolvedAmount).toFixed(2) : "—";
        const dateStr = new Date(req.refundExecutedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
        const ok = await sendEmail({
          to: input.to,
          subject: `Devolución realizada — Solicitud #${req.id}`,
          html: buildCancellationRefundExecutedHtml({
            fullName: req.fullName,
            requestId: req.id,
            amount,
            executedAt: dateStr,
          }),
        });
        sent.push({ label: "Devolución ejecutada", ok });
      }

      const failed = sent.filter(s => !s.ok).length;
      await addLog(req.id, "emails_resent", { to: input.to, sent }, ctx.user.id, ctx.user.name ?? "Admin");
      return { sent, failed };
    }),

  resendVoucherEmail: adminProcedure
    .input(z.object({ voucherId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [voucher] = await db.select().from(compensationVouchers).where(eq(compensationVouchers.id, input.voucherId));
      if (!voucher) throw new TRPCError({ code: "NOT_FOUND" });

      const [req] = await db.select().from(cancellationRequests).where(eq(cancellationRequests.id, voucher.requestId));
      if (!req?.email) throw new TRPCError({ code: "BAD_REQUEST", message: "El expediente no tiene email registrado" });

      const expiresStr = voucher.expiresAt
        ? new Date(voucher.expiresAt).toLocaleDateString("es-ES")
        : "Sin caducidad";

      await sendEmail({
        to: req.email,
        cc: await getCopyEmail(),
        subject: `Bono de compensación — Código ${voucher.code}`,
        html: buildCancellationAcceptedVoucherHtml({
          fullName: req.fullName,
          requestId: req.id,
          voucherCode: voucher.code,
          activityName: voucher.activityName ?? "Actividad Náyade Experiences",
          value: Number(voucher.value).toFixed(2),
          expiresAt: expiresStr,
          isPartial: false,
        }),
      });

      await addLog(voucher.requestId, "voucher_sent", { voucherId: voucher.id, resentBy: ctx.user.id }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  extendVoucherExpiry: adminProcedure
    .input(z.object({
      voucherId: z.number(),
      newExpiresAt: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const [voucher] = await db.select().from(compensationVouchers).where(eq(compensationVouchers.id, input.voucherId));
      if (!voucher) throw new TRPCError({ code: "NOT_FOUND" });
      if (voucher.status === "canjeado" || voucher.status === "anulado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede modificar un bono canjeado o anulado" });
      }

      const newDate = new Date(input.newExpiresAt);
      await db.update(compensationVouchers)
        .set({ expiresAt: newDate, status: "enviado" })
        .where(eq(compensationVouchers.id, input.voucherId));

      await db.update(discountCodes)
        .set({ expiresAt: newDate, status: "active" })
        .where(eq(discountCodes.compensationVoucherId, input.voucherId));

      await addLog(voucher.requestId, "voucher_expiry_extended", { voucherId: input.voucherId, newExpiresAt: input.newExpiresAt }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  cancelVoucher: adminProcedure
    .input(z.object({
      voucherId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [voucher] = await db.select().from(compensationVouchers).where(eq(compensationVouchers.id, input.voucherId));
      if (!voucher) throw new TRPCError({ code: "NOT_FOUND" });
      if (voucher.status === "canjeado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede anular un bono ya canjeado" });
      }

      await db.update(compensationVouchers)
        .set({ status: "anulado" })
        .where(eq(compensationVouchers.id, input.voucherId));

      await db.update(discountCodes)
        .set({ status: "inactive" })
        .where(eq(discountCodes.compensationVoucherId, input.voucherId));

      await addLog(voucher.requestId, "voucher_cancelled", { voucherId: input.voucherId, reason: input.reason ?? null }, ctx.user.id, ctx.user.name ?? "Admin");
      return { success: true };
    }),

  // ── Anulación masiva directa (solo para limpieza de datos de prueba) ────────
  batchCancelDirect: adminProcedure
    .input(z.object({
      reservationNumbers: z.array(z.string()).min(1).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await db
        .select({ id: reservations.id, reservationNumber: reservations.reservationNumber, status: reservations.status })
        .from(reservations)
        .where(inArray(reservations.reservationNumber, input.reservationNumbers));

      const toCancel = rows.filter(r => r.status !== "cancelled");
      if (toCancel.length === 0) return { cancelled: 0, alreadyCancelled: rows.length, numbers: [] };

      await db.update(reservations)
        .set({ status: "cancelled" } as any)
        .where(inArray(reservations.id, toCancel.map(r => r.id)));

      await Promise.all(toCancel.map(r =>
        logActivity("reservation", r.id, "reservation_cancelled_direct", ctx.user.id, ctx.user.name ?? "Admin", { method: "batch_direct" }).catch(() => {})
      ));

      return {
        cancelled: toCancel.length,
        alreadyCancelled: rows.length - toCancel.length,
        numbers: toCancel.map(r => r.reservationNumber),
      };
    }),
});

