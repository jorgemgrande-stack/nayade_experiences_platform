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
} satisfies Mirror<typeof es>;
