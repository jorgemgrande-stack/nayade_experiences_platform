import type { Mirror } from "../../core";
import type es from "../es/ui";

export default {
  previousSlide: "Vorherige Folie",
  nextSlide: "Nächste Folie",
  pagination: "Seitennavigation",
  previousPage: "Zur vorherigen Seite",
  nextPage: "Zur nächsten Seite",
  morePages: "Weitere Seiten",
  breadcrumb: "Navigationspfad",
  sidebar: "Seitenmenü",
  sidebarMobile: "Zeigt das Seitenmenü auf dem Handy an.",
  toggleSidebar: "Seitenmenü ein- oder ausblenden",
  commandTitle: "Befehlspalette",
  commandDescription: "Suche einen Befehl, um ihn auszuführen...",
} satisfies Mirror<typeof es>;
