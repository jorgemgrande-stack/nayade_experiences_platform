import { sendEmail } from "./mailer";
import { logDirectEmail } from "./emailManager";
import { buildInviteHtml } from "./emailTemplates";
import { brandName } from "./tenantBrand";

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const inviteSubject = `Bienvenido a ${brandName()} — Activa tu cuenta`;
  const sent = await sendEmail({
    to: params.email,
    subject: inviteSubject,
    html: buildInviteHtml({
      name: params.name,
      role: params.role,
      setPasswordUrl: params.setPasswordUrl,
    }),
    text: `Hola ${params.name},\n\nSe ha creado una cuenta para ti en ${brandName()}.\n\nEstablece tu contraseña aquí: ${params.setPasswordUrl}\n\nEste enlace es válido durante 72 horas.\n\n${brandName()}`,
  });
  logDirectEmail({ templateKey: "invite", triggerEvent: "user_invited", recipientEmail: params.email, subject: inviteSubject, sent }).catch(() => {});
  if (sent) {
    console.log(`[InviteEmail] Sent to ${params.email}`);
  } else {
    console.error(`[InviteEmail] Error sending to ${params.email}`);
  }
  return sent;
}
