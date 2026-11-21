import type { Mirror } from "../../core";
import type es from "../es/userSites";

export default {
  title: "Arbeitsstandorte",
  intro: "Ohne markierte Standorte arbeitet die Person an allen. Die Administration arbeitet immer an allen.",
  loading: "Standorte werden geladen…",
  loadError: "Die Standorte konnten nicht geladen werden",
  noTeam: "Es gibt keine Teammitglieder, denen Standorte zugewiesen werden können.",
  allSites: "Alle Standorte",
  chooseFor: "Standorte für {name} auswählen",
  sitesButton: "Standorte",
  dialogTitle: "Standorte von {name}",
  dialogDesc: "Markiere die Standorte, an denen die Person arbeitet. Wenn du keinen markierst, arbeitet sie an allen.",
  legend: "Standorte",
  primary: " (Hauptstandort)",
  saved: "Standorte gespeichert",
  saveError: "Die Standorte konnten nicht gespeichert werden.",
  cancel: "Abbrechen",
  saving: "Wird gespeichert…",
  save: "Speichern",
} satisfies Mirror<typeof es>;
