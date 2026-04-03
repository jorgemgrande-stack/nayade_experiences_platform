/**
 * Módulo de notificaciones para reservas Redsys.
 *
 * Canales disponibles:
 * 1. Notificación interna al equipo Náyade (Manus Notification Service) — siempre activo
 * 2. Email al cliente via Brevo HTTP API / SMTP fallback
 */
import { notifyOwner } from "./_core/notification";
import { buildReservationConfirmHtml, buildReservationFailedHtml } from "./emailTemplates";
import { sendEmail } from "./mailer";

export interface ReservationEmailData {
  id: number;
  merchantOrder: string;
  productName: string;
  bookingDate: string;
  people: number;
  amountTotal: number;
  amountPaid: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  extrasJson?: string | null;
  status: string;
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function parseExtras(extrasJson?: string | null): string {
  if (!extrasJson) return "Ninguno";
  try {
    const extras = JSON.parse(extrasJson);
    if (Array.isArray(extras) && extras.length > 0) {
      return extras.map((e: any) => `${e.name} x${e.quantity ?? 1}`).join(", ");
    }
    return "Ninguno";
  } catch {
    return "Ninguno";
  }
}

/**
 * Envía notificaciones cuando una reserva es confirmada como PAGADA.
 */
export async function sendReservationPaidNotifications(
  reservation: ReservationEmailData
): Promise<void> {
  const extras = parseExtras(reservation.extrasJson);
  const date = formatDate(reservation.bookingDate);
  const amount = formatAmount(reservation.amountTotal);

  // ── 1. Notificación interna al equipo Náyade ──────────────────────────────
  try {
    await notifyOwner({
      title: `Reserva pagada - ${reservation.productName}`,
      content: [
        `Reserva confirmada con pago Redsys`,
        `Referencia: ${reservation.merchantOrder}`,
        `Producto: ${reservation.productName}`,
        `Fecha: ${date}`,
        `Personas: ${reservation.people}`,
        `Extras: ${extras}`,
        `Total: ${amount}`,
        `Cliente: ${reservation.customerName}`,
        `Email: ${reservation.customerEmail}`,
        `Telefono: ${reservation.customerPhone ?? "No proporcionado"}`,
        ``,
        `Accede al panel: Admin > Operaciones > Reservas Redsys`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[ReservationEmails] Error enviando notificacion interna:", error);
  }

  // ── 2. Email de confirmación al cliente ───────────────────────────────────
  const copyEmail = "reservas@nayadeexperiences.es";
  const adminEmail = process.env.ADMIN_EMAIL;
  const bccList = [copyEmail, ...(adminEmail ? [adminEmail] : [])];

  try {
    await sendEmail({
      to: reservation.customerEmail,
      subject: `✅ Reserva confirmada — ${reservation.productName} — Náyade Experiences`,
      html: buildReservationConfirmHtml({
        merchantOrder: reservation.merchantOrder,
        productName: reservation.productName,
        customerName: reservation.customerName,
        date,
        people: reservation.people,
        amount,
        extras,
      }),
      text: `Reserva confirmada. Ref: ${reservation.merchantOrder}. Producto: ${reservation.productName}. Fecha: ${date}. Personas: ${reservation.people}. Total: ${amount}. Contacto: reservas@nayadeexperiences.es`,
    });
    // BCC manual al equipo
    for (const bcc of bccList) {
      await sendEmail({
        to: bcc,
        subject: `[COPIA] Reserva confirmada — ${reservation.merchantOrder} — ${reservation.customerName}`,
        html: buildReservationConfirmHtml({
          merchantOrder: reservation.merchantOrder,
          productName: reservation.productName,
          customerName: reservation.customerName,
          date,
          people: reservation.people,
          amount,
          extras,
        }),
      });
    }
    console.log(`[ReservationEmails] Email de confirmacion enviado a ${reservation.customerEmail}`);
  } catch (error) {
    console.error(`[ReservationEmails] Error enviando email al cliente:`, error);
  }
}

/**
 * Envía notificaciones cuando una reserva FALLA el pago.
 */
export async function sendReservationFailedNotifications(
  reservation: ReservationEmailData,
  redsysResponseCode: string
): Promise<void> {
  // ── 1. Notificación interna ───────────────────────────────────────────────
  try {
    await notifyOwner({
      title: `Pago fallido - ${reservation.productName}`,
      content: [
        `Pago rechazado por Redsys`,
        `Referencia: ${reservation.merchantOrder}`,
        `Producto: ${reservation.productName}`,
        `Codigo Redsys: ${redsysResponseCode}`,
        `Total: ${formatAmount(reservation.amountTotal)}`,
        `Cliente: ${reservation.customerName}`,
        `Email: ${reservation.customerEmail}`,
        ``,
        `El cliente puede reintentar: /reserva/error?order=${reservation.merchantOrder}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[ReservationEmails] Error enviando notificacion de fallo:", error);
  }

  // ── 2. Email informativo al cliente ──────────────────────────────────────
  try {
    await sendEmail({
      to: reservation.customerEmail,
      subject: `❌ Pago no completado — ${reservation.productName} — Náyade Experiences`,
      html: buildReservationFailedHtml({
        merchantOrder: reservation.merchantOrder,
        productName: reservation.productName,
        customerName: reservation.customerName,
        responseCode: redsysResponseCode,
      }),
      text: `Tu pago para ${reservation.productName} no pudo procesarse. Ref: ${reservation.merchantOrder}. Contacta: reservas@nayadeexperiences.es o +34 930 34 77 91.`,
    });
    console.log(`[ReservationEmails] Email de fallo enviado a ${reservation.customerEmail}`);
  } catch (error) {
    console.error(`[ReservationEmails] Error enviando email de fallo al cliente:`, error);
  }
}
