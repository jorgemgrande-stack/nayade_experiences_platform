/**
 * Correos de acceso a las cuentas de Big Elephant CRM (familia «seguridad y servicio»): restablecimiento de contraseña
 * (usuarios de las empresas y operadores del administrador central) e invitación de usuarios. Puros: no envían nada.
 *
 * Marca de la plataforma (logotipo oficial y pie corporativo); el nombre de la empresa aparece en el texto. El enlace
 * es el único dato sensible: nunca se registra en los logs ni se reutiliza en otras plantillas.
 */
import { CORPORATE, renderEmail } from "./design";
import { platformBrand } from "./templates";

const SECURITY_TIPS = `${CORPORATE.web}/soporte`;
const ROLE: Record<string, string> = { admin: "Administración", manager: "Gestión", agente: "Agente", agent: "Agente", readonly: "Solo lectura", user: "Usuario", adminrest: "Responsable de restaurante", monitor: "Monitor" };

/** Restablecimiento de contraseña. `product`: cuenta de una empresa o del administrador central. */
export function passwordResetContent(i: { name: string | null; url: string; minutes: number; account: string }) {
  const m = renderEmail(platformBrand(null), {
    family: "security",
    eyebrow: "Seguridad de tu cuenta",
    hero: "seguridad",
    title: "Restablece tu contraseña",
    subject: `Restablece tu contraseña — ${i.account}`,
    ...(i.name ? { greeting: `Hola, ${i.name}:` } : {}),
    intro: [`Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de ${i.account}.`],
    blocks: [
      { notice: { tone: "info", text: `Este enlace es válido durante ${i.minutes} minutos y solo puede usarse una vez.` } },
      { button: { label: "Restablecer contraseña", url: i.url } },
      { h2: "Si no has solicitado este cambio" },
      { p: "Puedes ignorar este mensaje. Tu cuenta seguirá segura y no se realizará ningún cambio sin tu confirmación." },
      { tip: { icon: "escudo", title: "Mantén tu cuenta segura", text: "Te recomendamos usar una contraseña segura y activar la verificación en dos pasos en la configuración de tu cuenta.", link: { label: "Ver consejos de seguridad", url: SECURITY_TIPS } } },
    ],
    preheader: `Restablece la contraseña de tu cuenta de ${i.account}. El enlace caduca en ${i.minutes} minutos.`,
  });
  return m;
}

/** Invitación a un usuario de una empresa: crear su contraseña y entrar. */
export function inviteContent(i: { name: string | null; company: string; role: string; url: string; hours: number }) {
  const m = renderEmail(platformBrand(null), {
    family: "security",
    eyebrow: "Invitación a Big Elephant",
    hero: "bienvenida",
    title: "Te han invitado a Big Elephant",
    subject: `Te han invitado a ${i.company} en Big Elephant`,
    ...(i.name ? { greeting: `Hola, ${i.name}:` } : {}),
    intro: [`${i.company} te ha dado acceso a su espacio de Big Elephant CRM. Crea tu contraseña para entrar.`],
    blocks: [
      { card: { rows: [{ label: "Empresa", value: i.company }, { label: "Permisos", value: ROLE[i.role] ?? i.role }] } },
      { notice: { tone: "info", text: `El enlace es personal, caduca en ${i.hours} horas y solo puede usarse una vez.` } },
      { p: "Si no esperabas esta invitación, ignora este mensaje: no se activará ninguna cuenta." },
    ],
    cta: { label: "Activar mi cuenta", url: i.url },
  });
  return m;
}
