/**
 * Endpoint REST de notificación IPN de Redsys.
 * Redsys llama a este endpoint vía POST con los datos de la transacción.
 * NUNCA se marca una reserva como pagada solo por la URL de retorno OK.
 * Solo se actualiza el estado tras validar la firma aquí.
 */
import express from "express";
import { validateRedsysNotification } from "./redsys";
import { updateReservationPayment, getReservationByMerchantOrder } from "./db";
import { sendReservationPaidNotifications, sendReservationFailedNotifications } from "./reservationEmails";

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

export default redsysRouter;
