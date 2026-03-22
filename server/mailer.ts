/**
 * mailer.ts — Helper compartido de Nodemailer
 *
 * Centraliza la creación del transporter SMTP para evitar duplicación
 * en crm.ts, reservationEmails.ts, inviteEmail.ts, restaurants.ts,
 * adapters/notification.ts y passwordReset.ts.
 *
 * Uso:
 *   import { createTransporter, sendEmail } from "../mailer";
 *   const transporter = createTransporter();
 *   await sendEmail({ to, subject, html });
 */
import nodemailer from "nodemailer";

export function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) return false;

  const fromAddress = from ?? process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@nayade.com";

  await transporter.sendMail({ from: fromAddress, to, subject, html });
  return true;
}
