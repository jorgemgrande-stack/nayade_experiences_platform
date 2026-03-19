/**
 * adapters/notification.ts — Notificaciones al propietario sin depender de Manus.
 *
 * Estrategia según variables de entorno:
 *  1. Si NOTIFY_EMAIL está definido → envía email vía SMTP (usando nodemailer).
 *  2. Si no → imprime el mensaje en consola (útil en desarrollo).
 *
 * Variables de entorno:
 *   NOTIFY_EMAIL   → dirección de destino para las notificaciones del owner
 *   SMTP_HOST      → servidor SMTP (ya existe en el proyecto para emails de reserva)
 *   SMTP_PORT      → puerto SMTP (default: 587)
 *   SMTP_USER      → usuario SMTP
 *   SMTP_PASS      → contraseña SMTP
 *   SMTP_FROM      → dirección remitente
 */

import nodemailer from "nodemailer";

export type NotificationPayload = {
  title: string;
  content: string;
};

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST ?? "",
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@nayade.local",
    notifyEmail: process.env.NOTIFY_EMAIL ?? process.env.ADMIN_EMAIL ?? "",
  };
}

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const { title, content } = payload;

  if (!title?.trim() || !content?.trim()) {
    console.warn("[Notification] Título o contenido vacío — notificación ignorada.");
    return false;
  }

  const cfg = getSmtpConfig();

  if (!cfg.notifyEmail || !cfg.host) {
    // Fallback: log en consola
    console.log(`\n📢 [NOTIFICACIÓN OWNER]\n  Título: ${title}\n  Contenido: ${content}\n`);
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

    await transporter.sendMail({
      from: cfg.from,
      to: cfg.notifyEmail,
      subject: `[Nayade] ${title}`,
      text: content,
      html: `<h2>${title}</h2><pre style="font-family:sans-serif;white-space:pre-wrap">${content}</pre>`,
    });

    return true;
  } catch (err) {
    console.warn("[Notification] Error enviando email:", err);
    return false;
  }
}
