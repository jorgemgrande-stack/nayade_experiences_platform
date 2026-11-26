import type { Mirror } from "../../core";
import type es from "../es/salesShell";

export default {
  navLabel: "Verkaufsablauf",
  attention: "Braucht deine Aufmerksamkeit",
  moreIndicators: "Mehr Kennzahlen",
  lessIndicators: "Kennzahlen ausblenden",
  filters: "Filter",
  filtersCount: "Filter ({count})",
  allOrders: "Alle Bestellungen",
  shopChannel: "Webshop",
  storeOrdersHint: "Bestellungen aus deinem Online-Shop",
  summaryLabel: "Übersicht",
  panorama: "Überblick",
  panoramaTitle: "Gesamtüberblick",
  panoramaHint: "Trichter, Angebote, Bestellungen, Stornos und Zahlungen des gesamten Unternehmens. Die Daten dieser Seite stehen in ihrer Übersicht.",
} satisfies Mirror<typeof es>;
