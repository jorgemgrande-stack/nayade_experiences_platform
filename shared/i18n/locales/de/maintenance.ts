import type { Mirror } from "../../core";
import type es from "../es/maintenance";

export default {
  technical: {
    on: "Wartung AKTIV",
    off: "Wartungsmodus",
    title: "Wartungsmodus — Öffentliche Website",
    description:
      "Wenn aktiv, zeigt die öffentliche Website diesen Hinweis und sperrt alle Seiten außer dem Verwaltungsbereich. Der Zugang zu /admin funktioniert weiterhin normal.",
    switchLabel: "Öffentliche Website deaktivieren",
    switchHint: "Solange der Modus aktiv ist, kann niemand buchen oder die Website durchsuchen.",
    savedOn: "Öffentliche Website deaktiviert",
    savedOff: "Öffentliche Website wieder aktiviert",
    saveOn: "Website deaktivieren und speichern",
  },
  web: {
    on: "Website in Wartung",
    off: "Wartung der Website",
    title: "Website in Wartung",
    description: "Solange der Modus aktiv ist, zeigt deine öffentliche Website diesen Hinweis statt ihrer Inhalte. Das Panel funktioniert weiterhin normal.",
    switchLabel: "Website in Wartung setzen",
    switchHint: "Solange der Modus aktiv ist, kann niemand deine Website durchsuchen.",
    savedOn: "Deine Website ist in Wartung",
    savedOff: "Deine Website ist wieder erreichbar",
    saveOn: "In Wartung setzen und speichern",
  },
  errorPrefix: "Fehler: {message}",
  warning: "Nach dem Speichern ist die Website sofort nicht mehr öffentlich erreichbar.",
  messageShown: "Angezeigte Nachricht",
  cancel: "Abbrechen",
  save: "Speichern",
} satisfies Mirror<typeof es>;
