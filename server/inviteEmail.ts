import nodemailer from "nodemailer";
import { buildInviteHtml } from "./emailTemplates";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[InviteEmail] SMTP not configured, skipping email send");
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const from = process.env.SMTP_FROM || `"Náyade Experiences" <${process.env.SMTP_USER}>`;

  try {
    await transporter.sendMail({
      from,
      to: params.email,
      subject: `Bienvenido a Náyade Experiences — Activa tu cuenta`,
      html: buildInviteHtml({
        name: params.name,
        role: params.role,
        setPasswordUrl: params.setPasswordUrl,
      }),
      text: `Hola ${params.name},\n\nSe ha creado una cuenta para ti en Náyade Experiences.\n\nEstablece tu contraseña aquí: ${params.setPasswordUrl}\n\nEste enlace es válido durante 72 horas.\n\nNáyade Experiences`,
    });
    console.log(`[InviteEmail] Sent to ${params.email}`);
    return true;
  } catch (err) {
    console.error("[InviteEmail] Error sending:", err);
    return false;
  }
}
