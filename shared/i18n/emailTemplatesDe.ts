/**
 * Plantillas de email: nombre y descripción de cada plantilla del sistema (texto español de origen del servidor,
 * `server/routers/emailTemplatesRouter.ts`) → alemán, SOLO para mostrarlos en el panel.
 * Nunca se traduce ni se guarda el asunto, la cabecera ni el CUERPO: son contenido que se envía a terceros.
 * Una plantilla creada por la empresa (nombre libre) o sin traducción se muestra tal cual.
 */
import type { Locale } from "./core";

const DE: Record<string, string> = {
  // Nombres
  "Confirmación de Reserva": "Buchungsbestätigung",
  "Reserva Fallida": "Buchung fehlgeschlagen",
  "Confirmación Completa de Reserva": "Vollständige Buchungsbestätigung",
  "Confirmación de Transferencia": "Überweisungsbestätigung",
  "Confirmación de Reserva de Restaurante": "Restaurant-Reservierungsbestätigung",
  "Enlace de Pago — Restaurante": "Zahlungslink — Restaurant",
  "Solicitud de Presupuesto — Cliente": "Angebotsanfrage — Kunde",
  "Solicitud de Presupuesto — Equipo": "Angebotsanfrage — Team",
  "Presupuesto Enviado al Cliente": "Angebot an den Kunden gesendet",
  "Anulación Recibida": "Stornierung eingegangen",
  "Anulación Rechazada": "Stornierung abgelehnt",
  "Anulación Aceptada — Devolución": "Stornierung akzeptiert — Rückerstattung",
  "Anulación Aceptada — Bono": "Stornierung akzeptiert — Gutschein",
  "Documentación Requerida — Anulación": "Unterlagen erforderlich — Stornierung",
  "Ticket de Compra TPV": "Kassenbeleg (Kasse)",
  "Canje de Cupón — Solicitud Recibida": "Gutscheineinlösung — Anfrage eingegangen",
  "Canje de Cupón — Sin Disponibilidad": "Gutscheineinlösung — Keine Verfügbarkeit",
  "Canje de Cupón — Alerta Interna": "Gutscheineinlösung — Interner Hinweis",
  "Devolución Ejecutada": "Rückerstattung ausgeführt",
  "Recordatorio Comercial #1": "Vertriebserinnerung Nr. 1",
  "Recordatorio Comercial #2": "Vertriebserinnerung Nr. 2",
  "Recordatorio Comercial #3 — Último Aviso": "Vertriebserinnerung Nr. 3 — Letzte Mahnung",
  "Propuesta Comercial Enviada": "Geschäftsvorschlag gesendet",
  "Aviso de Pago Pendiente": "Hinweis auf ausstehende Zahlung",
  "Recordatorio de Pago Pendiente": "Erinnerung an ausstehende Zahlung",
  "Recordatorio de Cuota Fraccionada": "Erinnerung an Teilzahlungsrate",
  "Apertura de Caja": "Kassenöffnung",
  "Cierre de Caja": "Kassenschluss",
  "Invitación de Usuario": "Benutzereinladung",
  "Recuperación de Contraseña": "Passwort zurücksetzen",
  "Confirmación de Pedido": "Bestellbestätigung",
  "Pago No Completado": "Zahlung nicht abgeschlossen",
  "Confirmación Completa de Pedido": "Vollständige Bestellbestätigung",
  "Anulación Aceptada — Vale de compra": "Stornierung akzeptiert — Einkaufsgutschein",
  "Ticket de Compra": "Kaufbeleg",

  // Descripciones
  "Email enviado al cliente cuando su reserva es confirmada con pago.": "E-Mail an den Kunden, wenn seine Buchung mit Zahlung bestätigt wird.",
  "Email enviado al cliente cuando el pago de su reserva no se ha podido procesar.": "E-Mail an den Kunden, wenn die Zahlung seiner Buchung nicht verarbeitet werden konnte.",
  "Email completo con todos los detalles de la reserva, instrucciones y mapa.": "Vollständige E-Mail mit allen Details der Buchung, Hinweisen und Karte.",
  "Email enviado al cliente cuando realiza el pago por transferencia bancaria.": "E-Mail an den Kunden, wenn er die Zahlung per Banküberweisung ausführt.",
  "Email enviado al cliente cuando confirma una reserva en el restaurante.": "E-Mail an den Kunden, wenn er eine Reservierung im Restaurant bestätigt.",
  "Email con enlace de pago para confirmar reserva de restaurante con señal.": "E-Mail mit Zahlungslink, um eine Restaurant-Reservierung mit Anzahlung zu bestätigen.",
  "Email de acuse de recibo enviado al cliente cuando solicita un presupuesto.": "Eingangsbestätigung per E-Mail an den Kunden, wenn er ein Angebot anfragt.",
  "Alerta interna enviada al equipo cuando llega una nueva solicitud de presupuesto.": "Interner Hinweis an das Team, wenn eine neue Angebotsanfrage eingeht.",
  "Email con el presupuesto detallado y enlace de pago.": "E-Mail mit dem detaillierten Angebot und Zahlungslink.",
  "Email de acuse de recibo enviado al cliente cuando envía su solicitud de anulación.": "Eingangsbestätigung per E-Mail an den Kunden, wenn er seinen Stornierungsantrag sendet.",
  "Email enviado al cliente cuando su solicitud de anulación no es aceptada.": "E-Mail an den Kunden, wenn sein Stornierungsantrag nicht akzeptiert wird.",
  "Email enviado al cliente cuando se aprueba una devolución económica.": "E-Mail an den Kunden, wenn eine Rückerstattung genehmigt wird.",
  "Email enviado al cliente cuando se emite un bono de compensación.": "E-Mail an den Kunden, wenn ein Ausgleichsgutschein ausgestellt wird.",
  "Email enviado al cliente solicitando documentación adicional para su anulación.": "E-Mail an den Kunden mit der Bitte um zusätzliche Unterlagen für seine Stornierung.",
  "Email con el ticket de compra enviado al cliente tras una venta presencial en el TPV.": "E-Mail mit dem Kaufbeleg an den Kunden nach einem Verkauf vor Ort an der Kasse.",
  "Email de acuse de recibo enviado al cliente cuando envía sus cupones para canje.": "Eingangsbestätigung per E-Mail an den Kunden, wenn er seine Gutscheine zur Einlösung sendet.",
  "Email enviado al cliente cuando no hay disponibilidad para la fecha solicitada.": "E-Mail an den Kunden, wenn für das gewünschte Datum keine Verfügbarkeit besteht.",
  "Alerta interna enviada al equipo cuando un cliente envía cupones para canje.": "Interner Hinweis an das Team, wenn ein Kunde Gutscheine zur Einlösung sendet.",
  "Email enviado al cliente cuando la devolución económica de su anulación ha sido transferida.": "E-Mail an den Kunden, wenn die Rückerstattung seiner Stornierung überwiesen wurde.",
  "Primer recordatorio automático enviado 48h después de enviar un presupuesto sin respuesta.": "Erste automatische Erinnerung, 48 Stunden nach dem Versand eines unbeantworteten Angebots.",
  "Segundo recordatorio enviado 96h después. Urgencia de disponibilidad.": "Zweite Erinnerung, 96 Stunden später. Hinweis auf begrenzte Verfügbarkeit.",
  "Tercer y último recordatorio. Cierre inminente de la propuesta.": "Dritte und letzte Erinnerung. Das Angebot läuft in Kürze ab.",
  "Email con propuesta detallada enviado al cliente desde el módulo de Propuestas.": "E-Mail mit detailliertem Vorschlag an den Kunden aus dem Modul Vorschläge.",
  "Email enviado cuando una reserva queda confirmada con pago diferido.": "E-Mail, wenn eine Buchung mit aufgeschobener Zahlung bestätigt wird.",
  "Recordatorio enviado 5 días antes de la fecha límite de pago.": "Erinnerung, die 5 Tage vor der Zahlungsfrist gesendet wird.",
  "Recordatorio enviado 3 días antes del vencimiento de una cuota del plan de pago.": "Erinnerung, die 3 Tage vor Fälligkeit einer Rate des Zahlungsplans gesendet wird.",
  "Notificación interna enviada al abrir una sesión de caja en el TPV.": "Interne Benachrichtigung beim Öffnen einer Kassensitzung.",
  "Resumen de la sesión de caja enviado al equipo al cerrar el TPV.": "Zusammenfassung der Kassensitzung an das Team beim Kassenschluss.",
  "Email enviado cuando se invita a un nuevo usuario a la plataforma.": "E-Mail, wenn ein neuer Benutzer zur Plattform eingeladen wird.",
  "Email enviado al usuario cuando solicita restablecer su contraseña.": "E-Mail an den Benutzer, wenn er das Zurücksetzen seines Passworts anfordert.",
  "Email enviado al cliente cuando su pedido se confirma con el pago.": "E-Mail an den Kunden, wenn seine Bestellung mit der Zahlung bestätigt wird.",
  "Email enviado al cliente cuando el pago de su pedido no se ha podido procesar.": "E-Mail an den Kunden, wenn die Zahlung seiner Bestellung nicht verarbeitet werden konnte.",
  "Email completo con todos los detalles del pedido.": "Vollständige E-Mail mit allen Details der Bestellung.",
  "Email enviado al cliente cuando se le entrega un vale de compra como compensación.": "E-Mail an den Kunden, wenn ihm ein Einkaufsgutschein als Ausgleich übergeben wird.",
  "Email con el ticket de compra enviado al cliente tras una venta presencial en caja.": "E-Mail mit dem Kaufbeleg an den Kunden nach einem Verkauf vor Ort an der Kasse.",
  "Notificación interna enviada al abrir una sesión de caja.": "Interne Benachrichtigung beim Öffnen einer Kassensitzung.",
  "Resumen de la sesión de caja enviado al equipo al cerrarla.": "Zusammenfassung der Kassensitzung an das Team beim Schließen.",
  "Email enviado cuando un pedido queda confirmado con pago diferido.": "E-Mail, wenn eine Bestellung mit aufgeschobener Zahlung bestätigt wird.",
};

/** Nombre o descripción de una plantilla del sistema para mostrar en el panel; sin traducción, el texto original. */
export function localizeTemplateText<T extends string | null | undefined>(text: T, locale: Locale): T {
  if (locale === "es" || !text) return text;
  return (DE[text as string] ?? text) as T;
}

/** Textos con traducción (para las pruebas de cobertura). */
export const EMAIL_TEMPLATE_TEXTS_DE = DE;
