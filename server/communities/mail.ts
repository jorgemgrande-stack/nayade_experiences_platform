/**
 * Correos de Comunidades: con la marca de la empresa (buildNoticeHtml) y por el servicio de correo del Core
 * (sendEmail: cuotas, idempotencia, MAIL_MODE). Nunca sale correo hacia otra empresa.
 *
 *  - Invitación de cuenta: enlace de un solo uso a `/comunidad/activar` (crea la contraseña con `public.setPassword`,
 *    la misma invitación de las cuentas del Core) y entra en la comunidad.
 *  - Aviso de alta: a quien ya tiene cuenta, enlace a la comunidad (exige iniciar sesión).
 */
import { sendEmail } from "../mailer";
import { buildNoticeHtml } from "../emailTemplates";
import { publicBaseUrl } from "../_core/productIdentity";
import { companyName } from "../tenantBrand";
import type { AddResult } from "../communitiesDb";
import type { Community } from "../communitiesDb";

export const memberAreaPath = (slug: string) => `/comunidad/${encodeURIComponent(slug)}`;
export const activationPath = (token: string, slug: string) => `/comunidad/activar?token=${encodeURIComponent(token)}&c=${encodeURIComponent(slug)}`;

/** Envía la invitación o el aviso de cada alta nueva o reactivada. Devuelve cuántos correos se enviaron. */
export async function notifyNewMembers(community: Community, results: AddResult[]): Promise<number> {
  const base = publicBaseUrl();
  const company = companyName();
  let sent = 0;
  for (const r of results) {
    if (!r.email || r.result === "already") continue;
    const ok = r.invite
      ? await sendEmail({
          to: r.email,
          subject: `Invitación a la comunidad ${community.name}`,
          category: "user_invite",
          idempotencyKey: `community-invite:${community.id}:${r.invite.userId}:${r.invite.token.slice(0, 12)}`,
          html: buildNoticeHtml({
            badge: "Invitación",
            title: `Te damos la bienvenida a ${community.name}`,
            greetingName: r.name,
            paragraphs: [`${company} te ha invitado a su comunidad «${community.name}». Crea tu contraseña para entrar y participar.`],
            cta: { label: "Crear mi contraseña y entrar", url: `${base}${activationPath(r.invite.token, community.slug)}` },
            note: "El enlace es personal, caduca en 7 días y solo puede usarse una vez. Si no esperabas esta invitación, ignora este mensaje.",
          }),
        }).catch(() => false)
      : await sendEmail({
          to: r.email,
          subject: `Ya formas parte de la comunidad ${community.name}`,
          category: "operational",
          idempotencyKey: `community-added:${community.id}:${r.memberId}:${Math.floor(Date.now() / 3600_000)}`,
          html: buildNoticeHtml({
            badge: "Comunidad",
            title: `Ya formas parte de ${community.name}`,
            greetingName: r.name,
            paragraphs: [`${company} te ha dado acceso a su comunidad «${community.name}». Entra con tu cuenta habitual para ver las publicaciones y participar.`],
            cta: { label: "Ir a la comunidad", url: `${base}${memberAreaPath(community.slug)}` },
          }),
        }).catch(() => false);
    if (ok) sent++;
  }
  return sent;
}
