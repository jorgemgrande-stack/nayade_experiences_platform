import { sendEmail } from "./mailer";
import { logDirectEmail } from "./emailManager";
import { buildInviteHtml } from "./emailTemplates";
import { getSystemSettingSync } from "./config";

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const inviteSubject = `Bienvenido a ${getSystemSettingSync("brand_name", "Skicenter")} — Activa tu cuenta`;
  const sent = await sendEmail({
    to: params.email,
    subject: inviteSubject,
    html: buildInviteHtml({
      name: params.name,
      role: params.role,
      setPasswordUrl: params.setPasswordUrl,
    }),
    text: `Hola ${params.name},\n\nSe ha creado una cuenta para ti en ${getSystemSettingSync("brand_name", "Skicenter")}.\n\nEstablece tu contraseña aquí: ${params.setPasswordUrl}\n\nEste enlace es válido durante 72 horas.\n\n${getSystemSettingSync("brand_name", "Skicenter")}`,
  });
  logDirectEmail({ templateKey: "invite", triggerEvent: "user_invited", recipientEmail: params.email, subject: inviteSubject, sent }).catch(() => {});
  if (sent) {
    console.log(`[InviteEmail] Sent to ${params.email}`);
  } else {
    console.error(`[InviteEmail] Error sending to ${params.email}`);
  }
  return sent;
}
