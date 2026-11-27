/**
 * Textos de fábrica del formulario de newsletter por idioma (alemán, español, inglés). Los usa el servidor (mensajes de
 * error y de éxito del alta) y el formulario del navegador. Mandan siempre los textos del bloque publicado y su
 * traducción; estos solo cubren lo que el bloque no define o lo que conserva el texto español de fábrica, para que una
 * web en alemán o inglés nunca muestre mensajes en español.
 */
export type NewsletterLang = "de" | "es" | "en";
export type NewsletterMsgKey = "consentText" | "successMessage" | "invalidEmailMessage" | "noConsentMessage" | "errorMessage" | "rateLimitedMessage" | "unavailableMessage" | "forbiddenMessage";

export const NEWSLETTER_MESSAGES: Record<NewsletterLang, Record<NewsletterMsgKey, string>> = {
  es: {
    consentText: "Quiero recibir la newsletter semanal de Quantum Soulrise y acepto la política de privacidad. Puedo darme de baja en cualquier momento.",
    successMessage: "¡Gracias! Te hemos enviado un correo para confirmar tu inscripción.",
    invalidEmailMessage: "Introduce un correo electrónico válido.",
    noConsentMessage: "Para inscribirte tienes que aceptar el consentimiento.",
    errorMessage: "No hemos podido completar la inscripción. Inténtalo de nuevo en unos minutos.",
    rateLimitedMessage: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
    unavailableMessage: "Este formulario ya no está disponible.",
    forbiddenMessage: "No se ha podido enviar el formulario desde esta dirección.",
  },
  de: {
    consentText: "Ich möchte den wöchentlichen Newsletter von Quantum Soulrise erhalten und stimme der Datenschutzerklärung zu. Ich kann mich jederzeit abmelden.",
    successMessage: "Danke! Wir haben dir eine E-Mail gesendet, um deine Anmeldung zu bestätigen.",
    invalidEmailMessage: "Bitte gib eine gültige E-Mail-Adresse ein.",
    noConsentMessage: "Um dich anzumelden, musst du der Einwilligung zustimmen.",
    errorMessage: "Wir konnten die Anmeldung nicht abschließen. Bitte versuche es in ein paar Minuten erneut.",
    rateLimitedMessage: "Zu viele Versuche. Bitte warte ein paar Minuten und versuche es erneut.",
    unavailableMessage: "Dieses Formular ist nicht mehr verfügbar.",
    forbiddenMessage: "Das Formular konnte von dieser Adresse aus nicht gesendet werden.",
  },
  en: {
    consentText: "I would like to receive the weekly Quantum Soulrise newsletter and I accept the privacy policy. I can unsubscribe at any time.",
    successMessage: "Thank you! We have sent you an email to confirm your subscription.",
    invalidEmailMessage: "Please enter a valid email address.",
    noConsentMessage: "To subscribe you need to accept the consent.",
    errorMessage: "We could not complete your subscription. Please try again in a few minutes.",
    rateLimitedMessage: "Too many attempts. Please wait a few minutes and try again.",
    unavailableMessage: "This form is no longer available.",
    forbiddenMessage: "The form could not be submitted from this address.",
  },
};

export function newsletterLang(raw: unknown, fallback: NewsletterLang = "de"): NewsletterLang {
  const l = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 2) : "";
  return l === "de" || l === "es" || l === "en" ? l : fallback;
}

/**
 * Texto a mostrar: el del bloque si lo tiene y no es el texto español de fábrica; si no, el de fábrica del idioma.
 * (Un bloque recién creado guarda el español de fábrica: en una web alemana o inglesa eso no debe verse.)
 */
export function newsletterMessage(locale: unknown, key: NewsletterMsgKey, value?: unknown): string {
  const lang = newsletterLang(locale);
  const v = typeof value === "string" ? value.trim() : "";
  if (v && (lang === "es" || v !== NEWSLETTER_MESSAGES.es[key])) return v;
  return NEWSLETTER_MESSAGES[lang][key];
}
