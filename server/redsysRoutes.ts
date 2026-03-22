/**
 * Endpoint REST de notificación IPN de Redsys.
 * Redsys llama a este endpoint vía POST con los datos de la transacción.
 * NUNCA se marca una reserva como pagada solo por la URL de retorno OK.
 * Solo se actualiza el estado tras validar la firma aquí.
 */
import express from "express";
import { validateRedsysNotification } from "./redsys";
import { updateReservationPayment, getReservationByMerchantOrder } from "./db";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { quotes, leads, invoices, reservations } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendReservationPaidNotifications, sendReservationFailedNotifications } from "./reservationEmails";
import { getBookingByMerchantOrder, updateBooking, addBookingLog } from "./restaurantsDb";
import { notifyOwner } from "./_core/notification";
import { buildConfirmationHtml } from "./emailTemplates";
import { createTransporter } from "./mailer";

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

    // Evitar procesar dos veces la misma notificación
    if (reservation.status === "paid") {
      console.log("[Redsys IPN] Reserva ya marcada como pagada:", result.merchantOrder);
      return res.send("OK");
    }

    // Actualizar estado según resultado
    const newStatus = result.isAuthorized ? "paid" : "failed";
    const redsysResponseJson = JSON.stringify(result.rawData);

    await updateReservationPayment(
      result.merchantOrder,
      newStatus,
      redsysResponseJson,
      result.responseCode,
      result.isAuthorized ? result.amount : 0
    );

    console.log(`[Redsys IPN] Reserva ${result.merchantOrder} actualizada a: ${newStatus}`);

    // Enviar notificaciones según el resultado del pago
    const updatedReservation = await getReservationByMerchantOrder(result.merchantOrder);

    // ── Si la reserva viene de un presupuesto, marcar el presupuesto como pagado ──
    if (result.isAuthorized && updatedReservation?.quoteSource === "presupuesto" && updatedReservation?.quoteId) {
      try {
        const _pool = mysql.createPool(process.env.DATABASE_URL!);
        const _db = drizzle(_pool);
        const [quote] = await _db.select().from(quotes).where(eq(quotes.id, updatedReservation.quoteId));
        if (quote && !quote.paidAt) {
          const [lead] = await _db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1);
          const now = new Date();
          const invoiceNumber = `FAC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${Date.now().toString(36).toUpperCase()}`;
          const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
          const total = Number(quote.total);
          const subtotal = Number(quote.subtotal);
          const taxAmount = subtotal * 0.21;

          // Insert invoice
          await _db.insert(invoices).values({
            invoiceNumber,
            quoteId: quote.id,
            clientName: lead?.name ?? updatedReservation.customerName,
            clientEmail: lead?.email ?? updatedReservation.customerEmail,
            clientPhone: lead?.phone ?? updatedReservation.customerPhone,
            itemsJson: items,
            subtotal: String(subtotal),
            taxRate: "21",
            taxAmount: String(taxAmount),
            total: String(total),
            status: "generada",
            issuedAt: now,
            createdAt: now,
            updatedAt: now,
          });

          // Update quote to paid
          await _db.update(quotes).set({
            status: "aceptado",
            paidAt: now,
            redsysOrderId: result.merchantOrder,
            invoiceNumber,
            updatedAt: now,
          }).where(eq(quotes.id, quote.id));

          // Update lead
          if (lead) {
            await _db.update(leads).set({ opportunityStatus: "ganada", status: "convertido", updatedAt: now }).where(eq(leads.id, lead.id));
          }

          console.log(`[Redsys IPN] Presupuesto ${quote.quoteNumber} marcado como PAGADO. Factura: ${invoiceNumber}`);

          // ── Enviar email de confirmación al cliente ──
          const clientEmail = lead?.email ?? updatedReservation.customerEmail;
          const clientName  = lead?.name  ?? updatedReservation.customerName;
          if (clientEmail) {
            try {
              const transporter = createTransporter();
              if (transporter) {
                const html = buildConfirmationHtml({
                  clientName,
                  reservationRef: invoiceNumber,
                  quoteTitle: quote.title ?? `Presupuesto ${quote.quoteNumber}`,
                  items,
                  total: String(total),
                });
                await transporter.sendMail({
                  from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
                  to: clientEmail,
                  bcc: process.env.SMTP_FROM ?? process.env.SMTP_USER,
                  subject: `✅ Reserva confirmada — ${quote.quoteNumber} — Náyade Experiences`,
                  html,
                });
                console.log(`[Redsys IPN] Email de confirmación enviado a ${clientEmail}`);
              }
            } catch (emailErr) {
              console.error("[Redsys IPN] Error al enviar email de confirmación:", emailErr);
            }
          }
        }
        await _pool.end();
      } catch (e) {
        console.error("[Redsys IPN] Error al procesar pago de presupuesto:", e);
      }
    }
    if (updatedReservation) {
      if (result.isAuthorized) {
        sendReservationPaidNotifications({
          id: updatedReservation.id,
          merchantOrder: updatedReservation.merchantOrder,
          productName: updatedReservation.productName,
          bookingDate: updatedReservation.bookingDate,
          people: updatedReservation.people,
          amountTotal: updatedReservation.amountTotal,
          amountPaid: updatedReservation.amountPaid ?? 0,
          customerName: updatedReservation.customerName,
          customerEmail: updatedReservation.customerEmail,
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
          customerEmail: updatedReservation.customerEmail,
          customerPhone: updatedReservation.customerPhone,
          extrasJson: updatedReservation.extrasJson,
          status: newStatus,
        }, result.responseCode).catch(err => console.error("[Redsys IPN] Error en notificaciones de fallo:", err));
      }
    }

    // Redsys espera "OK" en texto plano para confirmar recepción
    return res.send("OK");
  } catch (error) {
    console.error("[Redsys IPN] Error procesando notificación:", error);
    return res.status(500).send("KO");
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

    // Evitar doble procesamiento
    if (booking.paymentStatus === "paid") {
      console.log("[Redsys Restaurant IPN] Ya pagada:", result.merchantOrder);
      return res.send("OK");
    }

    if (result.isAuthorized) {
      await updateBooking(booking.id, {
        paymentStatus: "paid",
        status: "confirmed",
        paymentTransactionId: result.merchantOrder,
        paidAt: new Date(),
      });
      await addBookingLog(
        booking.id,
        "payment_confirmed",
        `Pago Redsys confirmado. Código: ${result.responseCode}. Importe: ${result.amount / 100}€`,
      );
      await notifyOwner({
        title: `Pago confirmado: Reserva ${booking.locator}`,
        content: `${booking.guestName} — ${booking.guests} pax — ${booking.date} ${booking.time} — ${booking.depositAmount}€ pagado`,
      }).catch(() => {});
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
      console.log(`[Redsys Restaurant IPN] Reserva ${booking.locator} marcada como pago fallido`);
    }

    return res.send("OK");
  } catch (error) {
    console.error("[Redsys Restaurant IPN] Error:", error);
    return res.status(500).send("KO");
  }
});

export default redsysRouter;

