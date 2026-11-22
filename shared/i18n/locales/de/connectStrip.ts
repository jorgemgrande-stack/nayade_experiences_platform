import type { Mirror } from "../../core";
import type es from "../es/connectStrip";

export default {
  title: "Erweitere dein Unternehmen",
  notIncluded: "Nicht in deinem Tarif enthalten",
  discover: "Entdecke, wie du deine Plattform erweitern kannst",
  viewSheet: "Produktseite ansehen",
  states: {
    available: "Zum Buchen verfügbar",
    active: "Gebucht und aktiv",
    pending_setup: "Gebucht, Einrichtung ausstehend",
    activating: "Wird aktiviert",
    not_eligible: "Für deinen Tarif nicht verfügbar",
    on_request: "Auf Anfrage",
    coming_soon: "Demnächst",
    incident: "Gesperrt oder mit Störung",
  },
  statesShort: {
    available: "Verfügbar",
    active: "Gebucht",
    pending_setup: "Gebucht · Einrichtung fehlt",
    activating: "Wird aktiviert",
    not_eligible: "Für deinen Tarif nicht verfügbar",
    on_request: "Auf Anfrage",
    coming_soon: "Demnächst",
    incident: "Mit Störung",
  },
} satisfies Mirror<typeof es>;
