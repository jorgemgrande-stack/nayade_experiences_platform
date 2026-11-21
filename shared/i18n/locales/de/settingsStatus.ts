import type { Mirror } from "../../core";
import type es from "../es/settingsStatus";

export default {
  title: "Systemstatus",
  intro: "Übersicht über die Konfiguration des Geschäfts und den Status der Integrationen.",
  card: { configured: "Konfiguriert", partial: "Teilweise", pending: "Ausstehend", edit: "Bearbeiten" },
  business: {
    titleTech: "Geschäftsinformationen",
    titleCompany: "Unternehmensdaten",
    name: "Firmenname",
    phone: "Telefon",
    domain: "Website-Domain",
    location: "Standort",
  },
  fiscal: { title: "Steuerdaten", taxId: "Steuernummer (NIF/CIF)", address: "Steuerlicher Firmensitz", vatGeneral: "MwSt. (Regelsatz)", vatReduced: "MwSt. (ermäßigt)" },
  emails: {
    title: "E-Mails und Benachrichtigungen",
    orders: "E-Mail für {what}",
    admin: "E-Mail für Admin-Warnungen",
    accounting: "E-Mail Buchhaltung",
    cancellations: "E-Mail Stornierungen",
    noreply: "Absender noreply",
    usingDefault: "(Standardwert wird verwendet)",
  },
  branding: { titleTech: "Branding", titleBrand: "Marke", logo: "Logo", primary: "Primärfarbe", accent: "Akzentfarbe", instagram: "Instagram" },
  modules: { title: "Aktive Module", none: "Es gibt keine aktiven Module." },
  env: { title: "Umgebungsvariablen (Railway)", configured: "{set}/{total} konfiguriert" },
} satisfies Mirror<typeof es>;
