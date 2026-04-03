/**
 * adapters/notification.ts — Notificaciones al propietario.
 *
 * Estrategia:
 *  1. Si NOTIFY_EMAIL está definido → envía email vía Brevo HTTP API / SMTP fallback.
 *  2. Si no → imprime el mensaje en consola (útil en desarrollo).
 */

import { sendEmail } from "../mailer";

export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const { title, content } = payload;

  if (!title?.trim() || !content?.trim()) {
    console.warn("[Notification] Título o contenido vacío — notificación ignorada.");
    return false;
  }

  const notifyEmail = process.env.NOTIFY_EMAIL ?? process.env.ADMIN_EMAIL ?? "";

  if (!notifyEmail) {
    console.log(`\n📢 [NOTIFICACIÓN OWNER]\n  Título: ${title}\n  Contenido: ${content}\n`);
    return true;
  }

  try {
    await sendEmail({
      to: notifyEmail,
      subject: `[Nayade] ${title}`,
      html: `<h2>${title}</h2><pre style="font-family:sans-serif;white-space:pre-wrap">${content}</pre>`,
      text: content,
    });
    return true;
  } catch (err) {
    console.warn("[Notification] Error enviando email:", err);
    return false;
  }
}
