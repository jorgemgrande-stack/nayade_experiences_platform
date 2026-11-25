import type { Mirror } from "../../core";
import type es from "../es/restaurantNet";

export default {
  parts: {
    readyDishes: "{count, plural, one {# fertig} other {# fertig}}",
  },
  sala: {
    summary: "Übersicht des Gastraums",
    free: "Frei",
    ofTables: "{count, plural, one {von # Tisch} other {von # Tischen}}",
    busy: "Besetzt",
    readyToServe: "{count, plural, one {# Gericht servierbereit} other {# Gerichte servierbereit}}",
    withOrder: "Mit offener Bestellung",
    bill: "Wollen zahlen",
    billHint: "Bereit zum Kassieren",
    toSeat: "Reservierungen zu platzieren",
    bookingsToday: "{count, plural, =0 {Heute keine Reservierungen} one {# Reservierung heute} other {# Reservierungen heute}}",
    viewPlan: "Plan",
    viewList: "Liste",
  },
  comanda: {
    progress: "Stand der Gerichte",
    dishes: "{count, plural, one {# Gericht} other {# Gerichte}}",
    toFire: "{count, plural, one {# zu starten} other {# zu starten}}",
    readyChip: "{count, plural, one {# fertig} other {# fertig}}",
    addDishes: "Gerichte hinzufügen",
  },
  cocina: {
    summary: "Übersicht der Küche",
    waiting: "Wartend",
    waitingHint: "Gestartet, noch nicht begonnen",
    cooking: "In Zubereitung",
    cookingHint: "Gerade in Arbeit",
    ready: "Fertig",
    readyHint: "Warten aufs Servieren",
    late: "Verspätete Bestellungen",
    lightHint: "Grün bis {green} Min., Gelb bis {amber} Min.",
  },
  carta: {
    summary: "Übersicht der Speisekarte",
    dishes: "Gerichte auf der Karte",
    dishesHint: "In den Bestellungen sichtbar",
    categories: "Kategorien",
    categoriesHint: "Gliedern die Karte im Service",
    avgPrice: "Durchschnittspreis",
    vatIncluded: "inkl. MwSt.",
    archived: "Archiviert",
    archivedHint: "Erscheinen nicht in Bestellungen",
    filterByCategory: "Nach Kategorie filtern",
  },
  ajustes: {
    lightPreview: "Grün bis {green} Min., Gelb bis {amber} Min. und danach Rot.",
  },
} satisfies Mirror<typeof es>;
