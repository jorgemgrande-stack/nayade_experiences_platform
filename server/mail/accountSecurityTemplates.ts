/**
 * Avisos de seguridad de la cuenta de un usuario de EMPRESA (Core): nuevo inicio de sesión desde un dispositivo no
 * visto, verificación del correo nuevo y cambio del correo de acceso. Puros: no envían nada. Marca de la plataforma
 * (logotipo oficial y pie corporativo) con el nombre de la empresa en el texto, como el resto de correos de acceso.
 *
 * El único enlace sensible es el de verificación del correo nuevo (token de un solo uso): nunca va a los logs.
 */
import { CORPORATE, renderEmail } from "./design";
import { platformBrand } from "./templates";

const HELP_URL = `${CORPORATE.web}/soporte`;
const when = (at: Date) => `${at.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" })} (hora de Madrid)`;
const account = (brand: string) => (brand ? `Big Elephant CRM (${brand})` : "Big Elephant CRM");

/** Inicio de sesión desde un dispositivo que la cuenta no había usado antes. */
export function newLoginContent(i: { brand: string; name: string | null; at: Date; device: string; changePasswordUrl: string }) {
  return renderEmail(platformBrand(null), {
    family: "security",
    eyebrow: "Seguridad de tu cuenta",
    hero: "seguridad",
    title: "Nuevo inicio de sesión en tu cuenta",
    subject: `Nuevo inicio de sesión en tu cuenta — ${account(i.brand)}`,
    ...(i.name ? { greeting: `Hola, ${i.name}:` } : {}),
    intro: [`Se ha iniciado sesión en tu cuenta de ${account(i.brand)} desde un dispositivo que no habíamos visto antes.`],
    blocks: [
      { card: { status: { label: "Dispositivo nuevo", tone: "info" }, rows: [{ label: "Fecha", value: when(i.at) }, { label: "Dispositivo", value: i.device }] } },
      { p: "Si has sido tú, no tienes que hacer nada." },
      { h2: "¿No has sido tú?" },
      { p: "Cambia tu contraseña cuanto antes: al hacerlo se cierran todas las sesiones abiertas. Después avisa a la administración de tu empresa." },
      { button: { label: "Cambiar mi contraseña", url: i.changePasswordUrl } },
    ],
    preheader: `Nuevo inicio de sesión desde ${i.device}. Si no has sido tú, cambia tu contraseña.`,
  });
}

/** Verificación del correo NUEVO: el cambio solo se aplica al abrir el enlace (un solo uso, caduca). */
export function emailChangeVerifyContent(i: { brand: string; name: string | null; newEmail: string; url: string; minutes: number }) {
  return renderEmail(platformBrand(null), {
    family: "security",
    eyebrow: "Seguridad de tu cuenta",
    hero: "seguridad",
    title: "Confirma tu nuevo correo",
    subject: `Confirma tu nuevo correo — ${account(i.brand)}`,
    ...(i.name ? { greeting: `Hola, ${i.name}:` } : {}),
    intro: [`Se ha solicitado usar esta dirección como correo de acceso de tu cuenta de ${account(i.brand)}.`],
    blocks: [
      { card: { rows: [{ label: "Correo nuevo", value: i.newEmail }] } },
      { notice: { tone: "info", text: `El enlace es válido durante ${i.minutes} minutos y solo puede usarse una vez. Tendrás que tener la sesión iniciada con tu cuenta.` } },
      { button: { label: "Confirmar mi nuevo correo", url: i.url } },
      { h2: "Si no has solicitado este cambio" },
      { p: "Ignora este mensaje: el correo de tu cuenta no cambiará sin tu confirmación." },
    ],
    preheader: `Confirma ${i.newEmail} como correo de acceso. El enlace caduca en ${i.minutes} minutos.`,
  });
}

/** Aviso al correo ANTERIOR tras aplicar el cambio (sin enlaces a la cuenta: solo la ayuda). */
export function emailChangedContent(i: { brand: string; name: string | null; oldEmail: string; newEmail: string; at: Date }) {
  return renderEmail(platformBrand(null), {
    family: "security",
    eyebrow: "Seguridad de tu cuenta",
    hero: "seguridad",
    title: "Se ha cambiado el correo de tu cuenta",
    subject: `Se ha cambiado el correo de tu cuenta — ${account(i.brand)}`,
    ...(i.name ? { greeting: `Hola, ${i.name}:` } : {}),
    intro: [`El correo de acceso de tu cuenta de ${account(i.brand)} se ha cambiado. A partir de ahora, los avisos de la cuenta llegarán a la dirección nueva.`],
    blocks: [
      { card: { status: { label: "Correo actualizado", tone: "success" }, rows: [{ label: "Correo anterior", value: i.oldEmail }, { label: "Correo nuevo", value: i.newEmail }, { label: "Fecha", value: when(i.at) }] } },
      { notice: { tone: "info", text: "Por seguridad, las sesiones abiertas se han cerrado." } },
      { h2: "¿No has sido tú?" },
      { p: "Avisa cuanto antes a la administración de tu empresa para que recupere el acceso a tu cuenta, o escribe a soporte." },
      { tip: { icon: "escudo", title: "Ayuda con tu cuenta", text: "Te explicamos cómo recuperar el acceso y proteger tu cuenta.", link: { label: "Ir al centro de ayuda", url: HELP_URL } } },
    ],
    preheader: `El correo de acceso de tu cuenta ahora es ${i.newEmail}.`,
  });
}
