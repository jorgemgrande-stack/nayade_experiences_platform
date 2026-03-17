/**
 * Módulo de notificaciones para reservas Redsys.
 *
 * Canales disponibles:
 * 1. Notificación interna al equipo Náyade (Manus Notification Service) — siempre activo
 * 2. Email al cliente via SMTP (Brevo, SendGrid, Gmail, etc.) — activo si SMTP_HOST está configurado
 *
 * Variables de entorno para email (configurar en Settings > Secrets):
 *   SMTP_HOST     — servidor SMTP (ej: smtp-relay.brevo.com)
 *   SMTP_PORT     — puerto SMTP (ej: 587 para TLS, 465 para SSL)
 *   SMTP_USER     — usuario SMTP (ej: tu@email.com)
 *   SMTP_PASS     — contraseña SMTP o API key
 *   SMTP_FROM     — dirección remitente (ej: "Náyade Experiences <reservas@nayadeexperiences.es>")
 *   SMTP_SECURE   — "true" para SSL/465, omitir para TLS/587
 *   ADMIN_EMAIL   — email del equipo para copia de confirmaciones (opcional)
 */
import nodemailer from "nodemailer";
import { notifyOwner } from "./_core/notification";

// ─── Transporter SMTP ────────────────────────────────────────────────────────

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !user || !pass) {
    return null; // SMTP no configurado
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

// ─── Plantilla HTML confirmación ─────────────────────────────────────────────

function buildConfirmationHtml(r: ReservationEmailData, date: string, amount: string, extras: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Reserva confirmada - Nayade Experiences</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#0c4a6e,#0369a1);padding:32px 40px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Reserva Confirmada</h1>
    <p style="color:#bae6fd;margin:8px 0 0;font-size:15px;">Nayade Experiences - Ref: <strong>${r.merchantOrder}</strong></p>
  </td></tr>
  <tr><td style="padding:32px 40px 0;">
    <p style="color:#1e293b;font-size:16px;margin:0 0 8px;">Hola <strong>${r.customerName}</strong>,</p>
    <p style="color:#475569;font-size:15px;margin:0 0 24px;line-height:1.6;">Tu reserva ha sido confirmada y el pago procesado correctamente. Te esperamos para vivir una experiencia unica en Nayade.</p>
  </td></tr>
  <tr><td style="padding:0 40px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
        <p style="color:#64748b;font-size:12px;text-transform:uppercase;margin:0 0 4px;">Experiencia</p>
        <p style="color:#0f172a;font-size:16px;font-weight:600;margin:0;">${r.productName}</p>
      </td></tr>
      <tr><td style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">
        <table width="100%"><tr>
          <td><p style="color:#64748b;font-size:12px;text-transform:uppercase;margin:0 0 4px;">Fecha</p><p style="color:#0f172a;font-size:15px;margin:0;">${date}</p></td>
          <td><p style="color:#64748b;font-size:12px;text-transform:uppercase;margin:0 0 4px;">Personas</p><p style="color:#0f172a;font-size:15px;margin:0;">${r.people}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#0c4a6e;">
        <table width="100%"><tr>
          <td><p style="color:#bae6fd;font-size:13px;margin:0;">Total pagado</p></td>
          <td align="right"><p style="color:#fff;font-size:20px;font-weight:700;margin:0;">${amount}</p></td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px 32px;">
    <p style="color:#475569;font-size:14px;margin:0 0 8px;">Si necesitas modificar tu reserva, contactanos:</p>
    <p style="color:#0369a1;font-size:14px;margin:0;">Tel: +34 919 041 947 | Email: hola@nayadeexperiences.es</p>
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:20px 40px;text-align:center;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">2025 Nayade Experiences - Ref: ${r.merchantOrder}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildFailedHtml(r: ReservationEmailData, responseCode: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Pago no completado - Nayade Experiences</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:32px 40px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Pago No Completado</h1>
    <p style="color:#fecaca;margin:8px 0 0;font-size:15px;">Ref: <strong>${r.merchantOrder}</strong></p>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hola <strong>${r.customerName}</strong>,</p>
    <p style="color:#475569;font-size:15px;margin:0 0 24px;line-height:1.6;">No hemos podido procesar el pago de tu reserva para <strong>${r.productName}</strong>. Puedes intentarlo de nuevo o contactarnos.</p>
    <p style="color:#0369a1;font-size:14px;margin:0;">Tel: +34 919 041 947 | Email: hola@nayadeexperiences.es</p>
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:20px 40px;text-align:center;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">2025 Nayade Experiences - Codigo: ${responseCode}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

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

/**
 * Formatea el importe en céntimos a euros con formato español.
 */
function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/**
 * Formatea la fecha de reserva para mostrar en notificaciones.
 */
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

/**
 * Parsea los extras de la reserva para mostrarlos en la notificación.
 */
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
 * - Notificación interna al owner del proyecto (equipo Náyade) — siempre activo
 * - Email de confirmación al cliente — activo si SMTP_HOST está configurado
 * - Copia al equipo — si ADMIN_EMAIL está configurado
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
    console.log(`[ReservationEmails] Notificacion interna enviada para ${reservation.merchantOrder}`);
  } catch (error) {
    console.error("[ReservationEmails] Error enviando notificacion interna:", error);
  }

  // ── 2. Email de confirmación al cliente ───────────────────────────────────
  const transporter = createTransporter();
  if (transporter) {
    const from = process.env.SMTP_FROM ?? "Nayade Experiences <reservas@nayadeexperiences.es>";
    const adminEmail = process.env.ADMIN_EMAIL;
    try {
      await transporter.sendMail({
        from,
        to: reservation.customerEmail,
        ...(adminEmail ? { bcc: adminEmail } : {}),
        subject: `Reserva confirmada - ${reservation.productName} - Nayade Experiences`,
        html: buildConfirmationHtml(reservation, date, amount, extras),
        text: `Reserva confirmada. Ref: ${reservation.merchantOrder}. Producto: ${reservation.productName}. Fecha: ${date}. Personas: ${reservation.people}. Total: ${amount}. Contacto: hola@nayadeexperiences.es`,
      });
      console.log(`[ReservationEmails] Email de confirmacion enviado a ${reservation.customerEmail} para ${reservation.merchantOrder}`);
    } catch (error) {
      console.error(`[ReservationEmails] Error enviando email al cliente ${reservation.customerEmail}:`, error);
    }
  } else {
    console.log(`[ReservationEmails] SMTP no configurado - email omitido para ${reservation.merchantOrder}`);
    console.log(`[ReservationEmails] Para activar: configurar SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS en Settings > Secrets`);
  }
}

/**
 * Envía notificaciones cuando una reserva FALLA el pago.
 * - Notificación interna al equipo Náyade — siempre
 * - Email informativo al cliente — si SMTP está configurado
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
    console.log(`[ReservationEmails] Notificacion de fallo enviada para ${reservation.merchantOrder}`);
  } catch (error) {
    console.error("[ReservationEmails] Error enviando notificacion de fallo:", error);
  }

  // ── 2. Email informativo al cliente ──────────────────────────────────────
  const transporter = createTransporter();
  if (transporter) {
    const from = process.env.SMTP_FROM ?? "Nayade Experiences <reservas@nayadeexperiences.es>";
    try {
      await transporter.sendMail({
        from,
        to: reservation.customerEmail,
        subject: `Pago no completado - ${reservation.productName} - Nayade Experiences`,
        html: buildFailedHtml(reservation, redsysResponseCode),
        text: `Tu pago para ${reservation.productName} no pudo procesarse. Ref: ${reservation.merchantOrder}. Contacta: hola@nayadeexperiences.es o +34 919 041 947.`,
      });
      console.log(`[ReservationEmails] Email de fallo enviado a ${reservation.customerEmail} para ${reservation.merchantOrder}`);
    } catch (error) {
      console.error(`[ReservationEmails] Error enviando email de fallo al cliente:`, error);
    }
  }
}
