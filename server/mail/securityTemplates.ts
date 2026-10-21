/**
 * Avisos de seguridad de una EMPRESA (Core), puros: con la marca de la empresa y el diseño común, sin logotipo ni
 * datos de la plataforma, sin enlaces ni tokens. Los usa el Core al enviar y la vista previa del catálogo.
 */
import { layout } from "./templates";

/** Contraseña cambiada: a la propia persona; si no fue ella, que avise (las sesiones anteriores ya se cerraron). */
export function passwordChangedContent(brand: string, name: string | null, at: Date) {
  const when = at.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
  const m = layout({ name: brand }, "Tu contraseña se ha cambiado", [
    name ? `Hola ${name},` : "Hola,",
    `La contraseña de tu cuenta de ${brand} se ha cambiado el ${when} (hora de Madrid).`,
    "Si has sido tú, no tienes que hacer nada. Si no has sido tú, avisa cuanto antes a la administración de tu empresa o a soporte: las sesiones abiertas con la contraseña anterior ya se han cerrado.",
  ]);
  return { subject: `Tu contraseña se ha cambiado — ${brand}`, html: m.html, text: m.text };
}
