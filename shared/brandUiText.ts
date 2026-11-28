/**
 * Textos fijos de los correos y páginas públicas con la marca de la empresa (pie, enlaces y ayudas), por idioma
 * (alemán, español, inglés). Son genéricos: los usan la newsletter y cualquier otro módulo que renderice con el kit
 * visual de la empresa. Todo sale del idioma de la persona; sin idioma reconocido, español.
 */
export type BrandUiLang = "de" | "es" | "en";

export interface BrandUiText {
  privacy: string;
  contact: string;
  web: string;
  imprint: string;
  /** «Volver a {brand}» */
  backTo: string;
  /** Ayuda bajo el botón del correo: la URL va a continuación en texto. */
  linkFallback: string;
}

export const BRAND_UI_TEXT: Record<BrandUiLang, BrandUiText> = {
  es: { privacy: "Privacidad", contact: "Contacto", web: "Web", imprint: "Aviso legal", backTo: "Volver a {brand}", linkFallback: "Si el botón no funciona, copia este enlace en tu navegador:" },
  de: { privacy: "Datenschutz", contact: "Kontakt", web: "Website", imprint: "Impressum", backTo: "Zurück zu {brand}", linkFallback: "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:" },
  en: { privacy: "Privacy", contact: "Contact", web: "Website", imprint: "Legal notice", backTo: "Back to {brand}", linkFallback: "If the button does not work, copy this link into your browser:" },
};

export function brandUiLang(raw: unknown, fallback: BrandUiLang = "es"): BrandUiLang {
  const l = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 2) : "";
  return l === "de" || l === "es" || l === "en" ? l : fallback;
}

export function brandUiText(locale: unknown, fallback: BrandUiLang = "es"): BrandUiText {
  return BRAND_UI_TEXT[brandUiLang(locale, fallback)];
}
