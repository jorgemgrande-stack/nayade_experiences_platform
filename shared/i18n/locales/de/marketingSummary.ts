import type { Mirror } from "../../core";
import type es from "../es/marketingSummary";

export default {
  title: "Marketing · Einrichtung und Überblick",
  description: "Werbung, E-Mail-Kampagnen, SEO und Sichtbarkeit in KI-Antworten auf einer Seite: was bei dir schon läuft, was noch fehlt und wo du es erledigst. Jeder Status wird mit den echten Daten deines Unternehmens berechnet.",
  loadError: "Der Marketing-Überblick konnte nicht geladen werden",
  heroDone: "Deine Marketing-Module laufen",
  heroPending: "Es fehlt noch etwas, damit alles läuft",
  heroCount: "{ready} von {included} {included, plural, one {Modul läuft} other {Modulen laufen}}",
  heroSteps: "{n, plural, =0 {Keine offenen Schritte} one {# offener Schritt} other {# offene Schritte}}",
  notComplete: "Du hast {included} von 4 Modulen. Das Marketing-Paket enthält alle.",
  upgradeLink: "So erweiterst du es",
  readOnly: " · nur lesend",
  setupOf: "Einrichtung von {name}",
  optional: " (optional)",
  done: ": erledigt",
  todo: ": offen",
  notIncluded: "Dieses Modul gehört nicht zu dem, was dein Unternehmen gebucht hat. Es ist im Marketing-Paket enthalten.",
  toHaveIt: "Um es zu nutzen: ",
  nextStep: "Nächster Schritt: ",
  howToAdd: "So fügst du es hinzu",
  go: "Los",
  open: "{name} öffnen",
  progress: "{done} von {total} Schritten erledigt",
} as const satisfies Mirror<typeof es>;
