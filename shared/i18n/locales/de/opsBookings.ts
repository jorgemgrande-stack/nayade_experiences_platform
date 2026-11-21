import type { Mirror } from "../../core";
import type es from "../es/opsBookings";

export default {
  title: "Aktivitäten",
  heading: "Geplante Aktivitäten",
  count: "{n, plural, one {# Aktivität} other {# Aktivitäten}} – automatisch erstellt, sobald die Zahlung bestätigt ist",
  searchPlaceholder: "Aktivität suchen...",
  statusPlaceholder: "Status",
  all: "Alle",
  status: { pendiente: "Ausstehend", confirmado: "Bestätigt", en_curso: "Läuft", completado: "Abgeschlossen", cancelado: "Storniert" },
  source: { tarjeta_fisica: "Kartenzahlung vor Ort", tarjeta_redsys: "Karte (Redsys)", transferencia: "Überweisung", efectivo: "Barzahlung", otro: "Sonstige" },
  emptyTitle: "Keine geplanten Aktivitäten",
  emptyText: "Aktivitäten werden automatisch erstellt, sobald eine Zahlung bestätigt ist (Redsys, Überweisung oder Barzahlung)",
  col: { number: "Aktivitäts-Nr.", client: "Kunde", date: "Datum", persons: "Personen", total: "Gesamt", origin: "Herkunft", state: "Status" },
  manual: "Manuell",
  confirm: "Bestätigen",
  complete: "Abschließen",
  cancel: "Stornieren",
  cancelConfirm: "Diese Aktivität stornieren?",
  statusUpdated: "Status aktualisiert",
} satisfies Mirror<typeof es>;
