/** Textos de las páginas públicas de la newsletter (confirmar, baja y sus estados) por idioma. Sin dependencias. */
import type { Locale } from "./core";

export type PublicPageTextKey =
  | "confirmTitle" | "confirmText" | "confirmBtn" | "doneTitle" | "doneText" | "invalidTitle" | "invalidText" | "expiredTitle" | "expiredText"
  | "unsubTitle" | "unsubText" | "unsubBtn" | "unsubDone" | "unsubDoneText" | "busy" | "busyText" | "many" | "manyText";

export const PUBLIC_PAGE_TEXT: Record<Locale, Record<PublicPageTextKey, string>> = {
  es: {
    confirmTitle: "Confirma tu inscripción", confirmText: "Pulsa el botón para confirmar que quieres recibir la newsletter semanal.", confirmBtn: "Confirmar mi inscripción",
    doneTitle: "¡Inscripción confirmada!", doneText: "Gracias. En unos instantes recibirás un correo de bienvenida.", invalidTitle: "Enlace no válido", invalidText: "Este enlace no es válido, ya se usó o ha caducado. Si quieres recibir la newsletter, vuelve a inscribirte desde la web.",
    expiredTitle: "Enlace caducado", expiredText: "Este enlace ha caducado. Vuelve a inscribirte desde la web para recibir uno nuevo.",
    unsubTitle: "Baja de la newsletter", unsubText: "Confirma que no quieres recibir más correos de la newsletter.", unsubBtn: "Confirmar la baja", unsubDone: "Baja registrada", unsubDoneText: "No volverás a recibir la newsletter. Los avisos de tus compras o reservas, si los hay, se siguen enviando.",
    busy: "No disponible", busyText: "No hemos podido completar la operación. Inténtalo de nuevo en unos minutos.", many: "Demasiadas solicitudes", manyText: "Espera unos minutos y vuelve a intentarlo.",
  },
  de: {
    confirmTitle: "Bestätige deine Anmeldung", confirmText: "Klicke auf den Button, um zu bestätigen, dass du den wöchentlichen Newsletter erhalten möchtest.", confirmBtn: "Anmeldung bestätigen",
    doneTitle: "Anmeldung bestätigt!", doneText: "Danke. In wenigen Augenblicken erhältst du eine Willkommens-E-Mail.", invalidTitle: "Ungültiger Link", invalidText: "Dieser Link ist ungültig, wurde bereits verwendet oder ist abgelaufen. Wenn du den Newsletter erhalten möchtest, melde dich erneut auf der Website an.",
    expiredTitle: "Link abgelaufen", expiredText: "Dieser Link ist abgelaufen. Melde dich erneut auf der Website an, um einen neuen zu erhalten.",
    unsubTitle: "Newsletter abbestellen", unsubText: "Bestätige, dass du keine Newsletter-E-Mails mehr erhalten möchtest.", unsubBtn: "Abmeldung bestätigen", unsubDone: "Abmeldung registriert", unsubDoneText: "Du erhältst den Newsletter nicht mehr. Hinweise zu Käufen oder Buchungen werden weiterhin gesendet.",
    busy: "Nicht verfügbar", busyText: "Der Vorgang konnte nicht abgeschlossen werden. Bitte versuche es in einigen Minuten erneut.", many: "Zu viele Anfragen", manyText: "Bitte warte einige Minuten und versuche es erneut.",
  },
  en: {
    confirmTitle: "Confirm your subscription", confirmText: "Click the button to confirm that you want to receive the weekly newsletter.", confirmBtn: "Confirm my subscription",
    doneTitle: "Subscription confirmed!", doneText: "Thank you. You will receive a welcome email in a moment.", invalidTitle: "Invalid link", invalidText: "This link is invalid, was already used or has expired. If you want to receive the newsletter, subscribe again on the website.",
    expiredTitle: "Link expired", expiredText: "This link has expired. Subscribe again on the website to get a new one.",
    unsubTitle: "Unsubscribe from the newsletter", unsubText: "Confirm that you no longer want to receive the newsletter emails.", unsubBtn: "Confirm unsubscribe", unsubDone: "Unsubscribed", unsubDoneText: "You will no longer receive the newsletter. Notices about your purchases or bookings, if any, will still be sent.",
    busy: "Not available", busyText: "We could not complete the operation. Please try again in a few minutes.", many: "Too many requests", manyText: "Please wait a few minutes and try again.",
  },
};
