/**
 * Textos fijos de la interfaz de la web pública (formularios de Studio) en el idioma de la página (18/11/2026). Antes
 * salían siempre en español, también en una web alemana. Lo que escribe la empresa (etiquetas, botón, mensajes) manda
 * sobre estos textos. Idioma sin traducción: español.
 */
export const SITE_UI_TEXT = {
  es: {
    chooseOption: "Elige una opción",
    required: "Este campo es obligatorio.",
    checkboxRequired: "Marca esta casilla para continuar.",
    invalidEmail: "Escribe un correo electrónico válido.",
    captchaThirdParty: "Completa la verificación para continuar.",
    captchaCookies: "Acepta las cookies para poder verificar que no eres un robot.",
    consentRequired: "Para enviarlo, acepta la política de privacidad.",
    previewNotSent: "Es la vista previa: el formulario no se envía.",
    sent: "¡Gracias! Hemos recibido tu mensaje.",
    sending: "Enviando…",
    send: "Enviar",
    privacyLink: "política de privacidad",
    privacyLinkTitle: "Política de privacidad",
    consentBefore: "He leído y acepto la ",
    consentAfter: ".",
  },
  de: {
    chooseOption: "Bitte auswählen",
    required: "Dieses Feld ist erforderlich.",
    checkboxRequired: "Bitte bestätige dieses Kästchen, um fortzufahren.",
    invalidEmail: "Bitte gib eine gültige E-Mail-Adresse ein.",
    captchaThirdParty: "Bitte schließe die Überprüfung ab, um fortzufahren.",
    captchaCookies: "Bitte akzeptiere die Cookies, damit wir prüfen können, dass du kein Roboter bist.",
    consentRequired: "Bitte akzeptiere die Datenschutzerklärung, um die Anfrage zu senden.",
    previewNotSent: "Vorschau: Das Formular wird nicht gesendet.",
    sent: "Vielen Dank! Wir haben deine Nachricht erhalten.",
    sending: "Wird gesendet…",
    send: "Senden",
    privacyLink: "Datenschutzerklärung",
    privacyLinkTitle: "Datenschutzerklärung",
    consentBefore: "Ich habe die ",
    consentAfter: " gelesen und akzeptiere sie.",
  },
  en: {
    chooseOption: "Choose an option",
    required: "This field is required.",
    checkboxRequired: "Tick this box to continue.",
    invalidEmail: "Enter a valid email address.",
    captchaThirdParty: "Complete the verification to continue.",
    captchaCookies: "Accept cookies so we can check that you are not a robot.",
    consentRequired: "To send it, please accept the privacy policy.",
    previewNotSent: "Preview: the form is not sent.",
    sent: "Thank you! We have received your message.",
    sending: "Sending…",
    send: "Send",
    privacyLink: "privacy policy",
    privacyLinkTitle: "Privacy policy",
    consentBefore: "I have read and accept the ",
    consentAfter: ".",
  },
} as const;

export type SiteUiText = { [K in keyof (typeof SITE_UI_TEXT)["es"]]: string };

export function siteUiText(locale: string | null | undefined): SiteUiText {
  const l = (locale ?? "").toLowerCase();
  const base = l.split("-")[0] as keyof typeof SITE_UI_TEXT;
  return (SITE_UI_TEXT as Record<string, SiteUiText>)[l] ?? (SITE_UI_TEXT as Record<string, SiteUiText>)[base] ?? SITE_UI_TEXT.es;
}
