import type { Mirror } from "../../core";
import type es from "../es/economyShell";

export default {
  navLabel: "Finanzen",
  groupsLabel: "Finanzbereiche",
  screensLabel: "Seiten des Bereichs",
  subLabel: "Bereiche der Ausgaben",
  group: {
    today: "Heute",
    movements: "Bewegungen",
    pos: "Terminal",
    results: "Ergebnisse",
  },
  screen: {
    summary: "Wirtschaftsübersicht",
    daily: "Tageskontrolle",
    transactions: "Transaktionen",
    expenses: "Ausgaben",
    recurring: "Wiederkehrende Ausgaben",
    suppliers: "Lieferanten für Ausgaben",
    categories: "Ausgabenkategorien",
    costCenters: "Kostenstellen",
    cash: "Kasse",
    bank: "Bankbewegungen",
    pos: "Terminal-Vorgänge",
    batches: "Terminal-Sammelabrechnungen",
    conciliation: "Terminal-Abgleich",
    profitLoss: "Gewinn- und Verlustrechnung",
    reports: "Verkaufsberichte",
    general: "Allgemeine Buchhaltung",
    financeSync: "Finance Sync",
  },
  short: {
    expenses: "Ausgaben",
    recurring: "Wiederkehrend",
    suppliers: "Lieferanten",
    categories: "Kategorien",
    costCenters: "Kostenstellen",
  },
  partial: {
    page: "von dieser Seite",
    pageHint: "Summiert nur die auf dieser Seite geladenen Zeilen, nicht den gesamten Filter.",
  },
} satisfies Mirror<typeof es>;
