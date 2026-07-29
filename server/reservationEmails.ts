/**
 * Módulo de notificaciones para reservas Redsys.
 *
 * Canales disponibles:
 * 1. Notificación interna al equipo Náyade (Manus Notification Service) — siempre activo
 * 2. Email al cliente via Brevo HTTP API / SMTP fallback
 */
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { buildReservationConfirmHtml, buildReservationFailedHtml } from "./emailTemplates";
import { sendEmail } from "./mailer";
import { sendManagedEmail, logDirectEmail } from "./emailManager";
import { getBusinessEmail, getSystemSettingSync } from "./config";
import { getDb } from "./db";
import { reservations } from "../drizzle/schema";

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
  publicToken?: string | null;  // Para construir botón "Ver tu reserva"
  /** true si la reserva queda confirmada pero el pago aún está pendiente
   *  (ver ReservationConfirmData.paymentPending en emailTemplates.ts). */
  paymentPending?: boolean;
}

function reservationPublicUrl(publicToken?: string | null): string | undefined {
  if (!publicToken) return undefined;
  const base = process.env.APP_URL ?? "https://www.skicenter.es";
  return `${base}/presupuesto/${publicToken}`;
}

function formatAmount(cents: number | null | undefined): string {
  // Resiliente a null/undefined/NaN — devuelve "0,00 €" en vez de "NaN €".
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (n / 100).toFixed(2).replace(".", ",") + " €";
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
        `Reserva confirmada`,
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
  const copyEmail = await getBusinessEmail('reservations');
  const adminEmail = process.env.ADMIN_EMAIL;
  const bccList = [copyEmail, ...(adminEmail ? [adminEmail] : [])];

  const confirmSubject = `✅ Reserva confirmada — ${reservation.productName} — ${getSystemSettingSync("brand_name", "Skicenter")}`;
  const confirmHtml = buildReservationConfirmHtml({
    merchantOrder: reservation.merchantOrder,
    productName: reservation.productName,
    customerName: reservation.customerName,
    date,
    people: reservation.people,
    amount,
    extras,
    reservationUrl: reservationPublicUrl(reservation.publicToken),
    paymentPending: reservation.paymentPending,
  });

  try {
    await sendManagedEmail({
      templateKey: "reservation_confirm",
      triggerEvent: "reservation_paid",
      recipientEmail: reservation.customerEmail,
      subject: confirmSubject,
      html: confirmHtml,
      relatedEntityType: "reservation",
      relatedEntityId: reservation.id,
      reservationId: reservation.id,
    });
    // BCC manual al equipo (copias separadas para el equipo interno)
    for (const bcc of bccList) {
      const bccSubject = `[COPIA] Reserva confirmada — ${reservation.merchantOrder} — ${reservation.customerName}`;
      const bccSent = await sendEmail({ to: bcc, subject: bccSubject, html: confirmHtml }).catch(() => false);
      logDirectEmail({ templateKey: "reservation_confirm", triggerEvent: "reservation_paid_admin_copy", recipientEmail: bcc, subject: bccSubject, sent: !!bccSent, isAutomatic: true }).catch(() => {});
    }
    console.log(`[ReservationEmails] Email de confirmacion enviado a ${reservation.customerEmail}`);
  } catch (error) {
    console.error(`[ReservationEmails] Error enviando email al cliente:`, error);
  }
}

/**
 * Punto único de entrada para "reserva confirmada → enviar email al cliente",
 * sin importar el canal de origen (TPV, ticketing/cupones, partners, CRM,
 * Redsys, o cualquier canal futuro). Recibe solo el id de la reserva —ya
 * insertada en BD por el canal que sea— y se encarga de todo:
 *
 * - Idempotente: si `confirmationEmailSentAt` ya tiene valor, no reenvía.
 * - No hace nada si la reserva no tiene email de cliente.
 * - Marca `confirmationEmailSentAt` tras el envío para que no se repita y
 *   para dejar trazabilidad fiable (hoy varios canales usan `sendEmail`
 *   directo, que no queda registrado en ningún sitio consultable).
 */
export async function confirmReservationAndNotify(reservationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [row] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!row) return;
  if (row.confirmationEmailSentAt) return;
  if (!row.customerEmail) return;

  await sendReservationPaidNotifications({
    id: row.id,
    merchantOrder: row.merchantOrder ?? row.reservationNumber ?? String(row.id),
    productName: row.productName ?? "",
    bookingDate: row.bookingDate ?? "",
    people: row.people ?? 1,
    amountTotal: row.amountTotal ?? 0,
    amountPaid: row.amountPaid ?? 0,
    customerName: row.customerName ?? "",
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    extrasJson: row.extrasJson,
    status: row.status,
    publicToken: row.publicToken,
    paymentPending: row.status !== "paid",
  });

  await db.update(reservations)
    .set({ confirmationEmailSentAt: new Date() } as any)
    .where(eq(reservations.id, reservationId));
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
    await sendManagedEmail({
      templateKey: "reservation_failed",
      triggerEvent: "reservation_payment_failed",
      recipientEmail: reservation.customerEmail,
      subject: `❌ Pago no completado — ${reservation.productName} — Náyade Experiences`,
      html: buildReservationFailedHtml({
        merchantOrder: reservation.merchantOrder,
        productName: reservation.productName,
        customerName: reservation.customerName,
        responseCode: redsysResponseCode,
      }),
      relatedEntityType: "reservation",
      relatedEntityId: reservation.id,
      reservationId: reservation.id,
    });
    console.log(`[ReservationEmails] Email de fallo enviado a ${reservation.customerEmail}`);
  } catch (error) {
    console.error(`[ReservationEmails] Error enviando email de fallo al cliente:`, error);
  }
}
