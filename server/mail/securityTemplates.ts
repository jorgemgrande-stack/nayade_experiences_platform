/**
 * Avisos de seguridad de una EMPRESA (Core), puros: con la marca de la empresa y el diseño común, sin logotipo ni
 * datos de la plataforma, sin enlaces ni tokens. Los usa el Core al enviar y la vista previa del catálogo.
 */
import { layout, platformBrand } from "./templates";

/** Contraseña cambiada: a la propia persona; si no fue ella, que avise (las sesiones anteriores ya se cerraron). */
export function passwordChangedContent(brand: string, name: string | null, at: Date) {
  const when = at.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
  const m = layout(platformBrand(), "Tu contraseña se ha cambiado", [`La contraseña de tu cuenta de ${brand} se ha cambiado correctamente.`], null, {
    family: "security",
    eyebrow: "Seguridad de tu cuenta",
    greeting: name ? `Hola, ${name}:` : "Hola:",
    blocks: [
      { card: { status: { label: "Contraseña actualizada", tone: "success" }, rows: [{ label: "Fecha", value: `${when} (hora de Madrid)` }] } },
      { notice: { tone: "info", text: "Por seguridad, las sesiones abiertas con la contraseña anterior se han cerrado." } },
      { h2: "¿No has sido tú?" },
      { p: "Avisa cuanto antes a la administración de tu empresa o a soporte." },
    ],
  });
  return { subject: `Tu contraseña se ha cambiado — ${brand}`, html: m.html, text: m.text };
}
