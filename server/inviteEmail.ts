import { sendEmail } from "./mailer";
import { buildInviteHtml } from "./emailTemplates";
import { getSystemSettingSync } from "./config";

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const sent = await sendEmail({
    to: params.email,
    subject: `Bienvenido a ${getSystemSettingSync("brand_name", "Nayade Experiences")} — Activa tu cuenta`,
    html: buildInviteHtml({
      name: params.name,
      role: params.role,
      setPasswordUrl: params.setPasswordUrl,
    }),
    text: `Hola ${params.name},\n\nSe ha creado una cuenta para ti en ${getSystemSettingSync("brand_name", "Nayade Experiences")}.\n\nEstablece tu contraseña aquí: ${params.setPasswordUrl}\n\nEste enlace es válido durante 72 horas.\n\n${getSystemSettingSync("brand_name", "Nayade Experiences")}`,
  });
  if (sent) {
    console.log(`[InviteEmail] Sent to ${params.email}`);
  } else {
    console.error(`[InviteEmail] Error sending to ${params.email}`);
  }
  return sent;
}
