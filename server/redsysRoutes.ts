/**
 * Endpoint REST de notificación IPN de Redsys.
 * Redsys llama a este endpoint vía POST con los datos de la transacción.
 * NUNCA se marca una reserva como pagada solo por la URL de retorno OK.
 * Solo se actualiza el estado tras validar la firma aquí.
 */
import express from "express";
import { validateRedsysNotification } from "./redsys";
import { updateReservationPayment, getReservationByMerchantOrder, getAllReservationsByMerchantOrder, createReavExpedient, attachReavDocument, upsertClientFromReservation, postConfirmOperation, createVentaPerdidaLead, getGHLCredentials } from "./db";
import { calcularREAVSimple, validarConfiguracionREAV } from "./reav";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { quotes, leads, invoices, reservations, transactions, paymentInstallments } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendReservationPaidNotifications, sendReservationFailedNotifications } from "./reservationEmails";
import { getBookingByMerchantOrder, updateBooking, updateBookingPaymentAtomic, addBookingLog } from "./restaurantsDb";
import { notifyOwner } from "./_core/notification";
import { logActivity } from "./db";
import { buildConfirmationHtml } from "./emailTemplates";
import { sendEmail } from "./mailer";
import { groupTaxBreakdown, totalTaxAmount } from "./taxUtils";
import { getBusinessEmail, getSystemSettingSync } from "./config";
import { generateDocumentNumber } from "./documentNumbers";
import { checkAndConfirmInstallmentPlan } from "./routers/crm";
import { syncLeadUrlsToGHL } from "./ghl";

// Pool de BD compartido para todo el módulo — evita crear/destruir conexiones por cada IPN
const _sharedPool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const _db = drizzle(_sharedPool);

const redsysRouter = express.Router();

/**
 * POST /api/redsys/notification
 * Redsys envía: Ds_SignatureVersion, Ds_MerchantParameters, Ds_Signature
 */
redsysRouter.post("/api/redsys/notification", express.urlencoded({ extended: true }), async (req, res) => {
  const { Ds_SignatureVersion, Ds_MerchantParameters, Ds_Signature } = req.body;

  console.log("[Redsys IPN] Notificación recibida:", {
    Ds_SignatureVersion,
    Ds_MerchantParameters: Ds_MerchantParameters?.slice(0, 50) + "...",
    Ds_Signature: Ds_Signature?.slice(0, 20) + "...",
  });

  if (!Ds_SignatureVersion || !Ds_MerchantParameters || !Ds_Signature) {
    console.error("[Redsys IPN] Parámetros faltantes en la notificación");
    return res.status(400).send("KO");
  }

  try {
    const result = validateRedsysNotification({
      Ds_SignatureVersion,
      Ds_MerchantParameters,
      Ds_Signature,
    });

    console.log("[Redsys IPN] Resultado de validación:", {
      isValid: result.isValid,
      isAuthorized: result.isAuthorized,
      merchantOrder: result.merchantOrder,
      responseCode: result.responseCode,
      amount: result.amount,
    });

    if (!result.isValid) {
      console.error("[Redsys IPN] Firma inválida — posible fraude o error de configuración");
      return res.status(400).send("KO");
    }

    // Verificar que la reserva existe
    const reservation = await getReservationByMerchantOrder(result.merchantOrder);
    if (!reservation) {
      console.error("[Redsys IPN] Reserva no encontrada para merchantOrder:", result.merchantOrder);
      return res.status(404).send("KO");
    }

    // Validar importe: previene que Redsys confirme un pago con importe manipulado
    if (result.isAuthorized && result.amount !== reservation.amountTotal) {
      console.error(`[Redsys IPN] Importe no coincide — esperado: ${reservation.amountTotal}, recibido: ${result.amount} — merchantOrder: ${result.merchantOrder}`);
      return res.status(400).send("KO");
    }

    // Actualización atómica: solo procede si la reserva sigue en pending_payment.
    // affectedRows === 0 significa IPN duplicada o ya procesada — responder OK sin downstream.
    const newStatus = result.isAuthorized ? "paid" : "failed";
    const redsysResponseJson = JSON.stringify(result.rawData);

    const { affectedRows } = await updateReservationPayment(
      result.merchantOrder,
      newStatus,
      redsysResponseJson,
      result.responseCode,
      result.isAuthorized ? result.amount : 0
    );

    if (affectedRows === 0) {
      console.log(`[Redsys IPN] IPN duplicada o ya procesada para ${result.merchantOrder} — respondiendo OK sin downstream`);
      return res.send("OK");
    }

    console.log(`[Redsys IPN] Reserva ${result.merchantOrder} actualizada a: ${newStatus}`);

    // Responder OK a Redsys inmediatamente antes de ejecutar downstream
    res.send("OK");

    // Procesar downstream en background — no bloquea la respuesta a Redsys
    const updatedReservation = await getReservationByMerchantOrder(result.merchantOrder);

    // ── Pago fallido ──────────────────────────────────────────────────────────
    if (!result.isAuthorized) {
      try {
        const allFailed = await getAllReservationsByMerchantOrder(result.merchantOrder);

        // Caso A: checkout directo sin presupuesto → Lead "Venta Perdida"
        const isDirectCheckout = allFailed.length > 0 &&
          allFailed.every(r => (r as any).channel === "ONLINE_DIRECTO" && !(r as any).quoteId);
        if (isDirectCheckout) {
          await createVentaPerdidaLead(allFailed as any);
        }

        // Caso B: reserva vinculada a un presupuesto → marcar quote como pago_fallido
        const quoteReservation = allFailed.find(r => (r as any).quoteId);
        if (quoteReservation) {
          const quoteId = (quoteReservation as any).quoteId as number;
          const now = new Date();
          const [currentQuote] = await _db.select({ id: quotes.id, viewedAt: quotes.viewedAt })
            .from(quotes).where(eq(quotes.id, quoteId)).limit(1);
          if (currentQuote) {
            await _db.update(quotes).set({
              status: "pago_fallido",
              // Garantizar viewedAt: si el cliente llegó a Redsys, definitivamente vio el presupuesto
              viewedAt: currentQuote.viewedAt ?? now,
              updatedAt: now,
            }).where(eq(quotes.id, quoteId));
            await logActivity("quote", quoteId, "payment_failed_redsys", null, "Sistema (Redsys)", {
              merchantOrder: result.merchantOrder,
              responseCode: result.responseCode,
            });
            console.log(`[Redsys IPN] Presupuesto id=${quoteId} marcado como pago_fallido (order: ${result.merchantOrder})`);
          }
        }
      } catch (vpErr: any) {
        console.error("[Redsys IPN] Error procesando pago fallido:", vpErr.message);
      }
    }

    // ── Crear/actualizar cliente en el CRM cuando el pago es exitoso ──────────
    if (result.isAuthorized && updatedReservation?.customerName) {
      await upsertClientFromReservation({
        name: updatedReservation.customerName,
        email: updatedReservation.customerEmail ?? null,
        phone: updatedReservation.customerPhone ?? null,
        source: "redsys",
      });
    }

    // ── Detectar si la reserva corresponde a una cuota de plan de pagos ──────────
    let linkedInstallmentId: number | null = null;
    let linkedInstallmentQuoteId: number | null = null;
    let allRequiredInstallmentsPaid = false;

    if (result.isAuthorized && updatedReservation?.id) {
      try {
        const [linkedInst] = await _db
          .select({ id: paymentInstallments.id, quoteId: paymentInstallments.quoteId, isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation })
          .from(paymentInstallments)
          .where(eq(paymentInstallments.reservationId, updatedReservation.id))
          .limit(1);

        if (linkedInst) {
          linkedInstallmentId = linkedInst.id;
          linkedInstallmentQuoteId = linkedInst.quoteId;

          // Marcar cuota como pagada
          await _db.update(paymentInstallments).set({
            status: "paid",
            paidAt: new Date(),
            paidBy: "redsys",
            updatedAt: new Date(),
          }).where(eq(paymentInstallments.id, linkedInst.id));

          // Verificar si todas las cuotas requeridas están pagadas
          const allInstallments = await _db.select({
            id: paymentInstallments.id,
            status: paymentInstallments.status,
            isRequiredForConfirmation: paymentInstallments.isRequiredForConfirmation,
          }).from(paymentInstallments).where(eq(paymentInstallments.quoteId, linkedInst.quoteId));

          const required = allInstallments.filter(i => i.isRequiredForConfirmation);
          allRequiredInstallmentsPaid = required.length > 0 && required.every(
            i => i.status === "paid" || i.id === linkedInst.id
          );

          console.log(`[Redsys IPN] Cuota id=${linkedInst.id} marcada como pagada (quoteId=${linkedInst.quoteId}). Todas requeridas pagadas: ${allRequiredInstallmentsPaid}`);
        }
      } catch (instErr: any) {
        console.error("[Redsys IPN] Error procesando cuota de plan de pagos:", instErr.message);
      }
    }

    // ── Si la reserva viene de un presupuesto, confirmar según el tipo de pago ──
    const isInstallmentPayment = linkedInstallmentId !== null;

    if (result.isAuthorized && updatedReservation?.quoteSource === "presupuesto" && updatedReservation?.quoteId) {
      if (isInstallmentPayment) {
        // Plan de pagos: delegar en checkAndConfirmInstallmentPlan (gestiona fases, factura y emails)
        try {
          await checkAndConfirmInstallmentPlan(linkedInstallmentQuoteId!, 0, "Sistema (Redsys)");
          console.log(`[Redsys IPN] checkAndConfirmInstallmentPlan ejecutado para quoteId=${linkedInstallmentQuoteId}`);
        } catch (e) {
          console.error("[Redsys IPN] Error en checkAndConfirmInstallmentPlan:", e);
        }
      } else {
        // Pago único (sin plan fraccionado): flujo clásico — generar factura completa ahora
        try {
          const [quote] = await _db.select().from(quotes).where(eq(quotes.id, updatedReservation.quoteId));
          if (quote && !quote.paidAt) {
            const [lead] = await _db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
            const now = new Date();
            const invoiceNumber = await generateDocumentNumber("factura", "redsys:ipn", "system");
            const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string; taxRate?: number }[]) ?? [];
            const total = Number(quote.total);
            const subtotal = Number(quote.subtotal);
            const bdRedsys = groupTaxBreakdown(items.filter(i => i.fiscalRegime !== "reav"));
            const taxAmount = totalTaxAmount(bdRedsys);
            const taxRateRedsys = bdRedsys.length === 1 ? bdRedsys[0].rate : 21;

            const mainProductIdRedsys = (items as { productId?: number }[]).find(i => i.productId)?.productId ?? updatedReservation.productId ?? 0;

            const [invResRedsys] = await _db.insert(invoices).values({
              invoiceNumber,
              quoteId: quote.id,
              reservationId: updatedReservation.id,
              clientName: lead?.name ?? updatedReservation.customerName,
              clientEmail: lead?.email ?? updatedReservation.customerEmail,
              clientPhone: lead?.phone ?? updatedReservation.customerPhone,
              itemsJson: items,
              subtotal: String(subtotal),
              taxRate: String(taxRateRedsys),
              taxAmount: String(taxAmount),
              total: String(total),
              status: "cobrada",
              paymentMethod: "tarjeta_redsys",
              issuedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            const invoiceIdRedsys = (invResRedsys as { insertId: number }).insertId;

            await _db.update(reservations).set({
              productId: mainProductIdRedsys,
              invoiceId: invoiceIdRedsys,
              invoiceNumber,
              updatedAt: Date.now(),
            } as any).where(eq(reservations.id, updatedReservation.id));

            await _db.update(quotes).set({
              status: "aceptado",
              paidAt: now,
              redsysOrderId: result.merchantOrder,
              invoiceNumber,
              paymentLinkToken: null,
              updatedAt: now,
            }).where(eq(quotes.id, quote.id));

            if (lead) {
              await _db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, lead.id));
            }

            console.log(`[Redsys IPN] Presupuesto ${quote.quoteNumber} marcado como PAGADO. Factura: ${invoiceNumber}`);

            const clientEmail = lead?.email ?? updatedReservation.customerEmail;
            const clientName  = lead?.name  ?? updatedReservation.customerName;
            const COPY_EMAIL  = await getBusinessEmail('reservations');
            if (clientEmail) {
              try {
                const quoteUrl = quote.paymentLinkToken
                  ? `${process.env.APP_URL ?? "https://www.nayadeexperiences.es"}/presupuesto/${quote.paymentLinkToken}`
                  : undefined;
                const html = buildConfirmationHtml({
                  clientName,
                  reservationRef: invoiceNumber,
                  quoteNumber: quote.quoteNumber,
                  quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
                  items,
                  subtotal: String(subtotal),
                  taxAmount: String(taxAmount),
                  total: String(total),
                  bookingDate: updatedReservation.bookingDate ?? undefined,
                  selectedTime: (updatedReservation as any).selectedTime ?? undefined,
                  contactEmail: COPY_EMAIL,
                  contactPhone: "+34 911 67 51 89",
                  quoteUrl,
                });
                await sendEmail({ to: clientEmail, subject: `✅ Reserva confirmada — ${quote.quoteNumber} — ${getSystemSettingSync("brand_name", "Nayade Experiences")}`, html });
                await sendEmail({ to: COPY_EMAIL, subject: `[COPIA] Reserva confirmada — ${quote.quoteNumber} — ${clientName}`, html });
                console.log(`[Redsys IPN] Email de confirmación enviado a ${clientEmail}`);
              } catch (emailErr) {
                console.error("[Redsys IPN] Error al enviar email de confirmación:", emailErr);
              }
            }

            // Sync URL del presupuesto + factura al contacto GHL (fire-and-forget)
            getGHLCredentials().then(ghlCreds => {
              syncLeadUrlsToGHL({
                ghlContactId: (lead as any)?.ghlContactId,
                quoteUrl: quote.paymentLinkToken
                  ? `${process.env.APP_URL ?? "https://www.nayadeexperiences.es"}/presupuesto/${quote.paymentLinkToken}`
                  : undefined,
                invoiceNumber,
                quoteNumber: quote.quoteNumber,
                credentials: ghlCreds ?? undefined,
              });
            });
          }
        } catch (e) {
          console.error("[Redsys IPN] Error al procesar pago de presupuesto:", e);
        }
      }
    }
    // ── Booking operativo + transacción contable + REAV para CADA artículo del carrito ──
    // Usamos getAllReservationsByMerchantOrder para procesar carritos con múltiples artículos.
    // postConfirmOperation es idempotente: no duplica si ya existe booking/transacción.
    if (result.isAuthorized) {
      const allReservations = await getAllReservationsByMerchantOrder(result.merchantOrder);
      const { getExperienceById: getExpById } = await import("./db");

      for (const resv of allReservations) {
        // Booking operativo + transacción contable
        try {
          const amountEuros = (resv.amountPaid ?? resv.amountTotal) / 100;
          await postConfirmOperation({
            reservationId: resv.id,
            productId: resv.productId,
            productName: resv.productName,
            serviceDate: resv.bookingDate ?? new Date().toISOString().split("T")[0],
            people: resv.people,
            amountCents: resv.amountPaid ?? resv.amountTotal,
            customerName: resv.customerName,
            customerEmail: resv.customerEmail ?? "",
            customerPhone: resv.customerPhone,
            totalAmount: amountEuros,
            paymentMethod: "tarjeta_redsys",
            saleChannel: "online",
            reservationRef: resv.merchantOrder,
            description: `Pago online Redsys — ${resv.merchantOrder} — ${resv.productName}`,
            quoteId: resv.quoteId ?? null,
            sourceChannel: "redsys",
          });
          console.log(`[Redsys IPN] Booking operativo + transacción creados para reserva ${resv.id} (${resv.productName})`);
        } catch (bookingErr) {
          console.error(`[Redsys IPN] Error en postConfirmOperation para reserva ${resv.id}:`, bookingErr);
        }

        // REAV — solo para reservas directas (no de presupuesto) con régimen REAV
        if (!resv.quoteId) {
          try {
            const product = await getExpById(resv.productId);
            if (product && (product as any).fiscalRegime === "reav") {
              const amountEuros = (resv.amountPaid ?? resv.amountTotal) / 100;

              // P3+P4: validar config antes de crear expediente — nunca usar 60/40 silencioso
              const configErrors = validarConfiguracionREAV(product as any);
              if (configErrors.length > 0) {
                console.error(`[Redsys IPN] Producto ${resv.productId} (${resv.productName}) tiene config REAV inválida — expediente NO creado: ${configErrors.join("; ")}`);
              } else {
                const reavProviderPct = parseFloat(String((product as any).providerPercent));
                const reavMargenPct = parseFloat(String((product as any).agencyMarginPercent));
                const reavCalcOnline = calcularREAVSimple(amountEuros, reavProviderPct, reavMargenPct);
                const reavResult = await createReavExpedient({
                  reservationId: resv.id,
                  serviceDescription: resv.productName,
                  serviceDate: resv.bookingDate ?? new Date().toISOString().split("T")[0],
                  numberOfPax: resv.people,
                  saleAmountTotal: String(amountEuros.toFixed(2)),
                  providerCostEstimated: String(reavCalcOnline.costeProveedor),
                  agencyMarginEstimated: String(reavCalcOnline.margenAgencia),
                  clientName: resv.customerName ?? undefined,
                  clientEmail: resv.customerEmail ?? undefined,
                  clientPhone: resv.customerPhone ?? undefined,
                  channel: "online",
                  sourceRef: resv.merchantOrder,
                  internalNotes: [
                    `Expediente creado automáticamente tras pago online Redsys.`,
                    `Reserva: ${resv.merchantOrder}`,
                    resv.customerName ? `Cliente: ${resv.customerName}` : null,
                    resv.customerEmail ? `Email: ${resv.customerEmail}` : null,
                    resv.customerPhone ? `Teléfono: ${resv.customerPhone}` : null,
                    `Importe: ${amountEuros.toFixed(2)}€`,
                  ].filter(Boolean).join(" · "),
                });
                await _db.update(reservations).set({ reavExpedientId: reavResult.id } as any).where(eq(reservations.id, resv.id));
                await attachReavDocument({
                  expedientId: reavResult.id,
                  side: "client",
                  docType: "otro",
                  title: `Confirmación de reserva ${resv.merchantOrder}`,
                  fileUrl: `/reserva/ok?order=${resv.merchantOrder}`,
                  mimeType: "text/html",
                  notes: `Confirmación de pago online generada automáticamente. Producto: ${resv.productName}.`,
                });
                console.log(`[Redsys IPN] Expediente REAV ${reavResult.expedientNumber} creado para reserva ${resv.id} (${resv.productName})`);
              } // end else (config válida)
            }
          } catch (reavErr) {
            console.error(`[Redsys IPN] Error al crear expediente REAV para reserva ${resv.id}:`, reavErr);
          }
        }
      }
    }

    // Solo enviar el email estándar de reserva para reservas directas.
    // Las reservas de presupuesto ya reciben el email de confirmación de presupuesto arriba.
    const isQuoteReservation = updatedReservation?.quoteSource === "presupuesto" && !!updatedReservation?.quoteId;
    if (updatedReservation) {
      if (result.isAuthorized && !isQuoteReservation) {
        sendReservationPaidNotifications({
          id: updatedReservation.id,
          merchantOrder: updatedReservation.merchantOrder,
          productName: updatedReservation.productName,
          bookingDate: updatedReservation.bookingDate,
          people: updatedReservation.people,
          amountTotal: updatedReservation.amountTotal,
          amountPaid: updatedReservation.amountPaid ?? 0,
          customerName: updatedReservation.customerName,
          customerEmail: updatedReservation.customerEmail ?? "",
          customerPhone: updatedReservation.customerPhone,
          extrasJson: updatedReservation.extrasJson,
          status: newStatus,
        }).catch(err => console.error("[Redsys IPN] Error en notificaciones:", err));
      } else {
        sendReservationFailedNotifications({
          id: updatedReservation.id,
          merchantOrder: updatedReservation.merchantOrder,
          productName: updatedReservation.productName,
          bookingDate: updatedReservation.bookingDate,
          people: updatedReservation.people,
          amountTotal: updatedReservation.amountTotal,
          amountPaid: 0,
          customerName: updatedReservation.customerName,
          customerEmail: updatedReservation.customerEmail ?? "",
          customerPhone: updatedReservation.customerPhone,
          extrasJson: updatedReservation.extrasJson,
          status: newStatus,
        }, result.responseCode).catch(err => console.error("[Redsys IPN] Error en notificaciones de fallo:", err));
      }
    }

    // Registrar en el log de actividad del dashboard
    if (updatedReservation) {
      await logActivity(
        "reservation",
        updatedReservation.id,
        result.isAuthorized ? "redsys_payment_confirmed" : "redsys_payment_failed",
        null,
        "Sistema (Redsys)",
        {
          merchantOrder: result.merchantOrder,
          amount: (updatedReservation.amountPaid ?? updatedReservation.amountTotal) / 100,
          productName: updatedReservation.productName,
          customerName: updatedReservation.customerName,
          responseCode: result.responseCode,
        }
      ).catch(() => {});
    }
    // res.send("OK") ya fue enviado antes del downstream
  } catch (error) {
    console.error("[Redsys IPN] Error procesando notificación:", error);
    // Solo enviar KO si aún no se ha respondido (affectedRows === 0 ya retornó OK)
    if (!res.headersSent) return res.status(500).send("KO");
  }
});

/**
 * POST /api/redsys/restaurant-notification
 * IPN de Redsys para reservas de restaurante (depósito de 5€/comensal)
 */
redsysRouter.post("/api/redsys/restaurant-notification", express.urlencoded({ extended: true }), async (req, res) => {
  const { Ds_SignatureVersion, Ds_MerchantParameters, Ds_Signature } = req.body;

  console.log("[Redsys Restaurant IPN] Notificación recibida:", {
    Ds_SignatureVersion,
    Ds_MerchantParameters: Ds_MerchantParameters?.slice(0, 50) + "...",
    Ds_Signature: Ds_Signature?.slice(0, 20) + "...",
  });

  if (!Ds_SignatureVersion || !Ds_MerchantParameters || !Ds_Signature) {
    console.error("[Redsys Restaurant IPN] Parámetros faltantes");
    return res.status(400).send("KO");
  }

  try {
    const result = validateRedsysNotification({
      Ds_SignatureVersion,
      Ds_MerchantParameters,
      Ds_Signature,
    });

    console.log("[Redsys Restaurant IPN] Validación:", {
      isValid: result.isValid,
      isAuthorized: result.isAuthorized,
      merchantOrder: result.merchantOrder,
      responseCode: result.responseCode,
    });

    if (!result.isValid) {
      console.error("[Redsys Restaurant IPN] Firma inválida");
      return res.status(400).send("KO");
    }

    const booking = await getBookingByMerchantOrder(result.merchantOrder);
    if (!booking) {
      console.error("[Redsys Restaurant IPN] Reserva no encontrada:", result.merchantOrder);
      return res.status(404).send("KO");
    }

    if (result.isAuthorized) {
      // Actualización atómica: solo procede si paymentStatus sigue en "pending".
      // affectedRows === 0 → IPN duplicada o ya procesada.
      const { affectedRows } = await updateBookingPaymentAtomic(booking.id, {
        paymentStatus: "paid",
        status: "confirmed",
        paymentTransactionId: result.merchantOrder,
        paidAt: new Date(),
      });
      if (affectedRows === 0) {
        console.log(`[Redsys Restaurant IPN] IPN duplicada o ya procesada para ${result.merchantOrder} — respondiendo OK sin downstream`);
        return res.send("OK");
      }
      await addBookingLog(
        booking.id,
        "payment_confirmed",
        `Pago Redsys confirmado. Código: ${result.responseCode}. Importe: ${result.amount / 100}€`,
      );
      await notifyOwner({
        title: `Pago confirmado: Reserva ${booking.locator}`,
        content: `${booking.guestName} — ${booking.guests} pax — ${booking.date} ${booking.time} — ${booking.depositAmount}€ pagado`,
      }).catch(() => {});

      // Crear transacción contable para el depósito del restaurante (idempotente por reservationRef)
      try {
        const existingTx = await _db.select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reservationRef, result.merchantOrder))
          .limit(1);
        if (existingTx.length === 0) {
          const txNumber = `TX-${Date.now()}-${result.merchantOrder.slice(-4)}`;
          const depositEuros = result.amount / 100;
          await _db.insert(transactions).values({
            transactionNumber: txNumber,
            type: "ingreso",
            amount: String(depositEuros.toFixed(2)),
            currency: "EUR",
            paymentMethod: "tarjeta_redsys",
            status: "completado",
            description: `Depósito reserva restaurante ${booking.locator} — ${booking.guests} pax — ${booking.date} ${booking.time}`,
            processedAt: new Date(),
            clientName: booking.guestName,
            clientEmail: booking.guestEmail,
            clientPhone: booking.guestPhone ?? null,
            productName: `Depósito restaurante — ${booking.guests} pax`,
            saleChannel: "online",
            fiscalRegime: "general",
            operationStatus: "confirmada",
            reservationRef: result.merchantOrder,
          } as any);
        }
      } catch (txErr) {
        console.error("[Redsys Restaurant IPN] Error creando transacción contable:", txErr);
      }

      await logActivity(
        "reservation",
        booking.id,
        "redsys_restaurant_payment_confirmed",
        null,
        "Sistema (Redsys)",
        { merchantOrder: result.merchantOrder, amount: result.amount / 100, responseCode: result.responseCode, locator: booking.locator }
      ).catch(() => {});
      console.log(`[Redsys Restaurant IPN] Reserva ${booking.locator} marcada como pagada`);
    } else {
      await updateBooking(booking.id, {
        paymentStatus: "failed",
        status: "payment_failed",
      });
      await addBookingLog(
        booking.id,
        "payment_failed",
        `Pago Redsys fallido. Código: ${result.responseCode}`,
      );
      await logActivity(
        "reservation",
        booking.id,
        "redsys_restaurant_payment_failed",
        null,
        "Sistema (Redsys)",
        { merchantOrder: result.merchantOrder, responseCode: result.responseCode, locator: booking.locator }
      ).catch(() => {});
      console.log(`[Redsys Restaurant IPN] Reserva ${booking.locator} marcada como pago fallido`);
    }

    return res.send("OK");
  } catch (error) {
    console.error("[Redsys Restaurant IPN] Error:", error);
    return res.status(500).send("KO");
  }
});

export default redsysRouter;


