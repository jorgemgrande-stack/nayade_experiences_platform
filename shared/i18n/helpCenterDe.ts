/**
 * Centro de ayuda en alemán (de-DE, tono «du»). Misma estructura que `shared/helpCenter.ts` (fuente en español), indexado por
 * id de artículo: título, resumen, pasos, notas y etiquetas de enlace (en el mismo orden que `links`). Los nombres de menús,
 * pestañas y botones son los de la interfaz alemana (`navLabels.ts` y los diccionarios de cada pantalla). La prueba
 * `server/helpCenterI18n.test.ts` comprueba que cada artículo está y conserva el nº de pasos, notas y enlaces.
 */
export interface HelpArticleDe {
  title: string;
  summary: string;
  steps: string[];
  notes?: string[];
  links: string[];
}

export const HELP_DE: Record<string, HelpArticleDe> = {
  "crear-empresa": {
    title: "Dein Unternehmen anlegen und seine Daten vervollständigen",
    summary:
      "Das Unternehmen wird bei der Aktivierung deines Elephant-Source-Kontos angelegt; im Panel ergänzt du seine Steuer- und Kontaktdaten.",
    steps: [
      "Dein Unternehmen wird nicht in diesem Panel angelegt, sondern bei der Aktivierung deines Kontos (zum Beispiel mit der kostenlosen Testphase). Du bekommst eine Willkommens-E-Mail mit der Schaltfläche «Passwort festlegen», um dich zum ersten Mal anzumelden.",
      "Öffne danach den Assistenten «Richte dein Unternehmen ein» (Erste Schritte). Seine Schritte passen sich deiner Branche und deinem gebuchten Umfang an; jeden Schritt kannst du mit «Vorerst überspringen» auslassen, der Fortschritt wird automatisch gespeichert.",
      "Im Schritt Unternehmen füllst du die Pflichtfelder aus: Handelsname, Firmenname, Steuernummer (NIF/CIF), Steueranschrift, Land, Währung und Zeitzone. Klicke auf «Speichern und weiter».",
      "Um die Daten später zu prüfen oder zu ändern, gehe zu Organisation › Unternehmensdaten. Die Seite heißt «Geschäftsdaten», die Steuerdaten findest du im Tab «Rechtliche Angaben».",
      "In «Geschäftsdaten» gibt es keine Schaltfläche «Speichern»: Änderungen werden automatisch gespeichert (du siehst «Wird gespeichert…»).",
    ],
    notes: [
      "Die Daten unter «Rechtliche Angaben» erscheinen als Absender auf Rechnungen, Angeboten und Kassenbons.",
      "Ist für dein Unternehmen bereits eine Steuereinheit hinterlegt, weist der Assistent darauf hin: Das sind die Daten, die auf den Rechnungen stehen.",
    ],
    links: ["Assistenten für die ersten Schritte öffnen", "Unternehmensdaten"],
  },
  "crear-clientes": {
    title: "Kunden anlegen",
    summary: "Lege Kunden unter Kunden und Verkauf › Kunden mit der Schaltfläche «Neuer Kunde» an.",
    steps: [
      "Gehe im Menü zu Kunden und Verkauf › Kunden.",
      "Klicke auf «Neuer Kunde» (wenn du noch keinen hast, auf «Ersten Kunden anlegen»).",
      "Fülle die Pflichtfelder aus: Vollständiger Name und E-Mail. Alles andere ist optional: Telefon, Unternehmen, Steuernummer (NIF/CIF), Adresse, Ort, Postleitzahl und interne Notizen.",
      "Klicke auf «Kunde anlegen». Du siehst die Meldung «Kunde angelegt».",
      "Zum Ändern öffnest du die Kundenkarte (Klick auf den Namen), nutzt «Daten bearbeiten» und danach «Änderungen speichern».",
    ],
    notes: [
      "Kunden werden auch automatisch angelegt, wenn eine Anfrage eingeht, und du kannst beim Erfassen einer Bestellung direkt einen neuen anlegen.",
    ],
    links: ["Zu den Kunden"],
  },
  "etiquetas-clientes": {
    title: "Kunden mit Tags versehen und nach Tag filtern",
    summary: "Erstelle Tags unter Kunden und Verkauf › Tags, weise sie in der Kundenliste zu und filtere danach.",
    steps: [
      "Gehe im Menü zu Kunden und Verkauf › Tags und klicke auf «Neues Tag».",
      "Gib den Namen ein (er darf sich nicht wiederholen) und wähle bei Bedarf eine Farbe. Klicke auf «Tag erstellen».",
      "Klicke unter Kunden und Verkauf › Kunden bei einem Kunden auf die Tag-Schaltfläche und hake an, was du zuweisen möchtest. Änderungen werden sofort gespeichert.",
      "Um nur Kunden mit einem bestimmten Tag zu sehen, wähle es im Auswahlfeld «Alle Tags» neben der Suche oder klicke auf der Tag-Seite auf «Kunden ansehen».",
    ],
    notes: [
      "Wenn du ein Tag löschst, wird es bei allen Kunden entfernt, die es tragen; die Kunden selbst bleiben bestehen.",
      "Benutzer mit Nur Lesezugriff sehen die Tags, können sie aber weder erstellen noch zuweisen.",
    ],
    links: ["Zu den Tags", "Zu den Kunden"],
  },
  "tareas-recordatorios": {
    title: "Aufgaben und Erinnerungen für das Team",
    summary: "Notiere interne Aufgaben mit Datum und Verantwortlichen unter Kunden und Verkauf › Aufgaben; heutige und überfällige erscheinen auf der Startseite.",
    steps: [
      "Gehe im Menü zu Kunden und Verkauf › Aufgaben und klicke auf «Neue Aufgabe».",
      "Gib den Titel ein und bei Bedarf eine Beschreibung, das Datum unter «Fällig am», die verantwortliche Person und die Priorität.",
      "Um sie mit einem Kunden, einer Anfrage oder einem Angebot zu verknüpfen, wähle bei «Verknüpfen mit» die Art, suche den Eintrag und wähle ihn aus. Klicke auf «Aufgabe erstellen».",
      "Unter «Meine Aufgaben» siehst du deine eigenen, unter «Ganzes Team» die aller. Aktiviere «Nur überfällige», um den Rückstand zu sehen.",
      "Klicke auf den Kreis einer Aufgabe, um sie als erledigt zu markieren (und noch einmal, um sie wieder zu öffnen).",
    ],
    notes: [
      "Aufgaben, deren Datum verstrichen ist, werden als «Überfällig» markiert. Auf der Startseite siehst du «Meine offenen Aufgaben» und in den Hinweisen die «Aufgaben für heute oder überfällig».",
      "Es sind interne Erinnerungen: Es wird keine E-Mail an Kunden oder Verantwortliche gesendet.",
      "In der Kundenliste öffnet die Aufgaben-Schaltfläche die mit diesem Kunden verknüpften Aufgaben.",
    ],
    links: ["Zu den Aufgaben"],
  },
  "crear-productos": {
    title: "Produkte und Leistungen anlegen",
    summary: "Baue deinen Katalog unter Katalog und Handel › Produkte und Leistungen mit «Neues Produkt» auf.",
    steps: [
      "Gehe im Menü zu Katalog und Handel › Produkte und Leistungen.",
      "Klicke auf «Neues Produkt». Es öffnet sich «Neues Produkt oder neue Leistung».",
      "Pflichtfelder: Name, Preis (€, inkl. Steuern), Kategorie und Leistungs- oder Verkaufsort. Optional: Bilder (bis zu 4, höchstens 10 MB pro Bild), Preisart (Pro Person / Pro Einheit), Aktiv, Auf der Startseite hervorgehoben und die Adresse auf der Website.",
      "Klicke auf die Speichern-Schaltfläche am Ende des Formulars (sie heißt «Produkt erstellen»). Eine Meldung bestätigt, dass das Produkt angelegt wurde.",
      "Brauchst du eine neue Kategorie, gehe zu Katalog und Handel › Kategorien, klicke auf «Neue Kategorie», gib den Namen ein (die Adresse auf der Website wird automatisch ausgefüllt) und klicke auf «Kategorie erstellen».",
      "Für alternative Preise desselben Produkts gehe zu Varianten und Preise, klicke auf «Neue Variante», wähle das Produkt, den Namen der Variante und die Preisart (Festpreis, Pro Person oder Prozentsatz) und klicke auf «Variante erstellen».",
    ],
    notes: [
      "Im Assistenten für die ersten Schritte wird das erste Produkt mit «Preis (€, inkl. Steuern)» und der MwSt.-Art angelegt, nach derselben Konvention wie in der Produktverwaltung; gibt es sie nicht, werden die Kategorie «General» und der Ort «Principal» erstellt.",
    ],
    links: ["Zu den Produkten und Leistungen", "Kategorien", "Varianten und Preise"],
  },
  "crear-presupuestos": {
    title: "Angebote erstellen und versenden",
    summary: "Bereite Angebote unter Kunden und Verkauf › Angebote mit «Neues Angebot» vor; du kannst sie als Entwurf speichern oder versenden.",
    steps: [
      "Gehe im Menü zu Kunden und Verkauf › Angebote (Tab «Angebote»).",
      "Klicke auf «Neues Angebot». Du kannst «Bestehenden Kunden suchen» oder die Kundendaten eintippen.",
      "Pflichtfelder: Name, E-Mail, «Betreff des Angebots» und mindestens eine Position unter «Positionen» (tippe die Position ein oder suche ein Produkt aus dem Katalog). Optional: Telefon, Unternehmen, Leistungsdatum, Gültig bis, Notizen für den Kunden, Bedingungen und «Ratenzahlungsplan».",
      "Klicke auf «Entwurf speichern», um es später zu prüfen, oder auf «Erstellen und an den Kunden senden», um es sofort zu versenden.",
      "In der Liste kannst du unter anderem: An den Kunden senden (Entwürfe), Erneut senden, Als PDF herunterladen, Duplizieren oder Als verloren markieren.",
    ],
    notes: [
      "Der Kunde erhält einen Link, um das Angebot anzusehen und online anzunehmen und zu bezahlen, sofern du Zahlungen eingerichtet hast.",
    ],
    links: ["Zu den Angeboten"],
  },
  "crear-pedidos": {
    title: "Bestellungen erfassen",
    summary: "Erfasse Bestellungen unter Kunden und Verkauf › Bestellungen mit «Neue Bestellung»; beim Speichern wird auch die Rechnung erstellt.",
    steps: [
      "Gehe im Menü zu Kunden und Verkauf › Bestellungen (Tab «Bestellungen»).",
      "Klicke auf «Neue Bestellung».",
      "Pflichtfelder: Vollständiger Name, E-Mail, «Produkt oder Leistung», «Leistungsdatum» und Gesamtbetrag (€). Optional: Personenzahl, bezahlter Betrag, Zahlungsart, Kanal und interne Notizen.",
      "Klicke auf «Bestellung erstellen». Die Meldung nennt die Nummer der Bestellung und der erstellten Rechnung.",
    ],
    notes: [
      "Bestellungen entstehen auch von selbst, wenn ein Kunde ein Angebot annimmt und bezahlt oder wenn du ein Angebot in eine Bestellung mit offener Zahlung umwandelst.",
      "Bei jeder Bestellung kannst du die Bestätigung erneut senden, die Rechnung als PDF herunterladen, die Rechnung erzeugen, falls noch keine existiert, oder sie stornieren.",
    ],
    links: ["Zu den Bestellungen"],
  },
  "gestionar-facturas": {
    title: "Rechnungen, Gutschriften und Zahlungen verwalten",
    summary: "Rufe Rechnungen unter Abrechnung › Rechnungen ab, lade sie herunter, sende sie erneut und korrigiere sie; offene Zahlungen haben eine eigene Seite.",
    steps: [
      "Rechnungen werden beim Anlegen einer Bestellung oder bei bestätigter Zahlung ausgestellt. Hat eine Bestellung keine Rechnung, nutze «Rechnung erzeugen» in der Bestellung.",
      "Unter Abrechnung › Rechnungen kannst du bei jeder Rechnung: ansehen, herunterladen, das PDF erzeugen, per E-Mail erneut senden und eine manuelle Zahlung bestätigen («Zahlung bestätigen»).",
      "Um Geld zurückzuzahlen oder eine ausgestellte Rechnung zu korrigieren, nutze «Gutschrift ausstellen»: Wähle «Alles Offene» oder «Nur einen Teil» (Positionen markieren und Einheiten oder einen Betrag gutschreiben), prüfe die Vorschau mit Bemessungsgrundlage, MwSt. je Satz und Gesamtbetrag, gib den «Grund der Gutschrift» an und bestätige. Die Gutschrift hat eine eigene Nummer und die ursprüngliche Rechnung bleibt unverändert; decken die Gutschriften alles Abgerechnete ab, gilt sie als gutgeschrieben.",
      "«Rechnung stornieren» kann nicht rückgängig gemacht werden; für Rückerstattungen nutze die Gutschrift.",
      "Unter Abrechnung › Offene Zahlungen (Tab «Offene Zahlungen») kannst du Zahlungen bestätigen, Erinnerungen erneut senden oder sie abbrechen.",
      "Unter Abrechnung › Stornierungen und Gutschriften (Tab «Stornierungen») verwaltest du die Stornierungsanfragen für Bestellungen.",
    ],
    notes: ["Die Nummerierung der Rechnungen stellst du unter Abrechnung › Nummernkreise ein."],
    links: ["Zu den Rechnungen", "Offene Zahlungen", "Nummernkreise"],
  },
  "invitar-empleados": {
    title: "Mitarbeitende einladen",
    summary: "Lade dein Team unter Organisation › Benutzer und Berechtigungen mit «Neuer Benutzer» ein; sie erhalten eine E-Mail, um ihr Passwort festzulegen.",
    steps: [
      "Gehe im Menü zu Organisation › Benutzer und Berechtigungen (Seite «Benutzerverwaltung»).",
      "Klicke auf «Neuer Benutzer» (oder auf «Jemanden einladen», wenn du noch allein bist).",
      "Fülle Vollständiger Name und E-Mail aus und wähle die Rolle (zum Beispiel Administrator oder Vertrieb).",
      "Klicke auf «Erstellen und Einladung senden». Die eingeladene Person erhält eine E-Mail mit einem Link, der nach 72 Stunden abläuft, um das Passwort festzulegen.",
      "Läuft der Link ab, nutze «Einladung erneut senden» im Menü des Benutzers.",
    ],
    notes: [
      "Dein Tarif begrenzt die Anzahl der Panel-Benutzer (Essential enthält 3). Erreichst du das Limit, weist dich das Panel darauf hin: Deaktiviere einen Benutzer oder erweitere deinen Tarif.",
      "Wie viele Benutzer du nutzt, siehst du unter Abonnement › Tarif und Nutzung.",
    ],
    links: ["Zu Benutzer und Berechtigungen"],
  },
  "consultar-suscripcion": {
    title: "Dein Abonnement ansehen",
    summary: "Unter Abonnement › Tarif und Nutzung siehst du deinen Tarif, die verbleibenden Testtage, die Limits und die enthaltenen Funktionen.",
    steps: [
      "Gehe im Menü zu Abonnement › Tarif und Nutzung.",
      "Oben siehst du den Tarif und seinen Status (zum Beispiel Kostenlose Testphase, Aktiv oder Nur Lesezugriff) und während der Testphase die verbleibenden Tage.",
      "Unter «Limits des Tarifs» werden die enthaltenen Benutzer, Standorte und Steuereinheiten angezeigt sowie die Benutzer, die du bereits nutzt.",
      "Unter «Enthaltene Funktionen» findest du, was dein Tarif umfasst, nach Bereichen gruppiert.",
    ],
    notes: [
      "Endet die Testphase ohne Buchung, wechselt das Konto in den Nur-Lesezugriff: Es wird nichts gelöscht und du kannst deine Daten weiter ansehen.",
      "Diese Seite zeigt weder die Rechnungen des Abonnements noch die Preise.",
    ],
    links: ["Zu Tarif und Nutzung"],
  },
  "cambiar-plan": {
    title: "Einen Tarif buchen oder wechseln",
    summary: "Unter Abonnement vergleichst du die Tarife und buchst, wechselst oder sendest je nach Situation eine Anfrage an Elephant Source.",
    steps: [
      "Gehe zu Abonnement › Tarif und Nutzung und klicke auf «Tarife vergleichen», um die Karten und den vollständigen Vergleich zu sehen.",
      "Während der Testphase öffnet «Tarif buchen» die Buchung in drei Schritten (Tarif und Erweiterungen, Rechnungsdaten und Prüfung) und danach die sichere Zahlung. Bei einem aktiven Abonnement zeigt die Schaltfläche des Tarifs den Betrag an, bevor du den Wechsel bestätigst.",
      "Was nicht online gebucht werden kann (zum Beispiel Enterprise), fragst du über die Anfrage-Schaltfläche des Tarifs an: Unser Team meldet sich bei dir. Für Module und Branchenlösungen nutze «Zum Marketplace».",
    ],
    notes: ["Tarifwechsel führt Elephant Source durch; sobald sie aktiv sind, aktualisieren sich Menü und Limits des Panels von selbst."],
    links: ["Zu Tarif und Nutzung"],
  },
  "recuperar-contrasena": {
    title: "Passwort zurücksetzen",
    summary: "Auf der Anmeldeseite sendet dir «Passwort vergessen?» einen Link, der 60 Minuten gültig ist.",
    steps: [
      "Klicke auf der Anmeldeseite auf «Passwort vergessen?».",
      "Gib deine E-Mail-Adresse ein und klicke auf «Link zum Zurücksetzen senden».",
      "Öffne die E-Mail (schau auch im Spam-Ordner nach) und folge dem Link. Er läuft nach 60 Minuten ab.",
      "Gib das neue Passwort ein (mindestens 8 Zeichen), bestätige es und klicke auf «Neues Passwort speichern».",
      "Ist der Link nicht mehr gültig, klicke auf «Neuen Link anfordern» und wiederhole den Vorgang.",
    ],
    notes: ["Aus Sicherheitsgründen antwortet die Seite gleich, egal ob die E-Mail-Adresse existiert oder nicht."],
    links: ["Passwort zurücksetzen"],
  },
  "publicar-blog": {
    title: "Im Blog deiner Website veröffentlichen",
    summary: "Schreibe Beiträge unter Website › Blog mit «Neuer Beitrag»; nur veröffentlichte erscheinen unter /blog deiner Website.",
    steps: [
      "Gehe im Menü zu Website › Blog und klicke auf «Neuer Beitrag» (wenn du noch keinen hast, auf «Ersten Beitrag erstellen»).",
      "Gib den Titel ein: Die Adresse des Beitrags wird automatisch vorgeschlagen (du kannst sie ändern; nur Kleinbuchstaben, Zahlen und Bindestriche). Ergänze einen Auszug und den Text des Beitrags.",
      "Optional lädst du ein Titelbild mit Alternativtext hoch, gibst Autor und Kategorie an und füllst SEO-Titel und -Beschreibung aus.",
      "Klicke auf «Vorschau», um zu sehen, wie der Text auf der Website aussieht (es wird nichts gespeichert).",
      "Wähle unter Status «Entwurf (nicht auf der Website sichtbar)» oder «Veröffentlicht» und klicke auf «Entwurf speichern» oder «Veröffentlichen». Bei einem Veröffentlichungsdatum in der Zukunft heißt die Schaltfläche «Veröffentlichung planen» und der Beitrag erscheint zu dieser Uhrzeit auf der Website.",
      "Klicke auf «Blog ansehen», um deinen öffentlichen Blog zu öffnen.",
    ],
    notes: [
      "Entwürfe und geplante Beiträge sind weder auf der Website noch in der Sitemap sichtbar.",
      "Der Text erlaubt einfaches HTML wie die Seiten; Skripte und Stile werden beim Veröffentlichen entfernt.",
    ],
    links: ["Zum Blog"],
  },
};
