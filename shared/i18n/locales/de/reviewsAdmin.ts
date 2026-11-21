import type { Mirror } from "../../core";
import type es from "../es/reviewsAdmin";

export default {
  title: "Bewertungen moderieren",
  subtitle: "Verwalte die Meinungen von Kunden zu Hotel und SPA",
  refresh: "Aktualisieren",
  status: { pending: "Ausstehend", approved: "Freigegeben", rejected: "Abgelehnt" },
  stats: { total: "Gesamt", pending: "Ausstehend", approved: "Freigegeben", rejected: "Abgelehnt", average: "Durchschnitt" },
  filter: {
    type: "Typ:",
    status: "Status:",
    all: "Alle",
    pending: "Ausstehend",
    approved: "Freigegeben",
    rejected: "Abgelehnt",
    results: "{n, plural, one {# Ergebnis} other {# Ergebnisse}}",
  },
  empty: "Keine Bewertungen mit diesen Filtern",
  verifiedBooking: "Verifizierte Buchung",
  teamReply: "Antwort des Teams",
  action: {
    approve: "Freigeben",
    reject: "Ablehnen",
    withdraw: "Zurückziehen",
    reply: "Antworten",
    editReply: "Antwort bearbeiten",
    delete: "Löschen",
    confirmDelete: "Diese Bewertung endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
  },
  pager: { previous: "Zurück", next: "Weiter", page: "Seite {page} von {pages}" },
  reply: {
    title: "Auf die Bewertung antworten",
    label: "Deine Antwort (öffentlich sichtbar)",
    placeholder: "Schreibe eine professionelle und freundliche Antwort...",
    cancel: "Abbrechen",
    saving: "Wird gespeichert…",
    publish: "Antwort veröffentlichen",
  },
} satisfies Mirror<typeof es>;
