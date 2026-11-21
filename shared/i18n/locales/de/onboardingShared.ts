import type { Mirror } from "../../core";
import type es from "../es/onboardingShared";

export default {
  step: {
    welcome: "Willkommen",
    company: "Unternehmensdaten",
    fiscal: "Steuerdaten",
    activity: "Art der Tätigkeit",
    brand: "Logo und Farben",
    web: "Website",
    client: "Erster Kunde",
    product: "Erstes Produkt oder erste Leistung",
    operation: "Erster Verkauf",
    document: "Erstes Angebot oder erste Rechnung",
    comms: "E-Mail des Unternehmens",
    sector: "Dein Branchenmodul",
    finish: "Zusammenfassung und Start",
    users: "Dein Team",
  },
  status: {
    title: "Stand der Einrichtung",
    allDone: "Alles eingerichtet.",
    progress: "{done} von {total} Schritten erledigt.",
    ariaProgress: "Fortschritt der Einrichtung",
    completed: "{percent} % abgeschlossen",
    skipped: "übersprungen",
    recommended: "empfohlen",
    pending: "offen",
    more: "und {n} weitere",
    basicsReady: "Dein Unternehmen hat die Grundlagen fertig eingerichtet.",
    continue: "Weiter: {step}",
    review: "Einrichtung prüfen",
  },
  link: {
    label: "Erste Schritte",
  },
  trial: {
    hiddenGuide: "Anleitung für die ersten Schritte ausgeblendet ({done} von {total} erledigt).",
    show: "Einblenden",
    title: "Starte in drei Schritten",
    intro: "{done} von {total} erledigt. Du kannst sie in beliebiger Reihenfolge erledigen und später weitermachen.",
    hide: "Ausblenden",
    doneSr: " (erledigt)",
    pendingSr: " (offen)",
    company: {
      title: "Vervollständige die Daten deines Unternehmens",
      text: "Handelsname, Land und Währung. Die Steuerdaten können bis zu deiner ersten Rechnung warten.",
      cta: "Vervollständigen",
    },
    client: {
      title: "Lege deinen ersten Kunden an",
      text: "Name und ein Kontakt genügen für den Anfang.",
      cta: "Kunde anlegen",
    },
    quote: {
      title: "Erstelle dein erstes Angebot",
      text: "Bereite es in wenigen Minuten vor und verschicke es per E-Mail direkt aus dem Panel.",
      cta: "Angebot erstellen",
    },
  },
  welcome: {
    saveError: "Speichern nicht möglich",
    hello: "Hallo {name}. ",
    title: "Willkommen bei Elephant Core",
    readyNamed: "Dein Bereich zur Verwaltung von {name} ist bereit.",
    ready: "Dein Verwaltungsbereich ist bereit.",
    proposal: "Wir schlagen vor, ihn in wenigen Minuten einzurichten.",
    onlyNeeded: {
      title: "Nur das Nötigste",
      text: "{steps} kurze Schritte, angepasst an dein Geschäft und an das, was du gebucht hast.",
    },
    nothingLost: {
      title: "Nichts geht verloren",
      text: "Dein Fortschritt wird automatisch gespeichert: Du kannst jederzeit unterbrechen und später weitermachen.",
    },
    noBlocks: {
      title: "Keine Hürden",
      text: "Kein Schritt ist Pflicht, um das System zu nutzen.",
    },
    configure: "Mein Unternehmen einrichten",
    explore: "Erst einmal erkunden",
    footer: "Den Assistenten kannst du jederzeit von der Startseite aus öffnen.",
  },
  financeSync: {
    title: "Schließe die Einrichtung von Finance Sync ab",
    steps: "{done} von {total} erforderlichen Schritten. {next}",
  },
} satisfies Mirror<typeof es>;
