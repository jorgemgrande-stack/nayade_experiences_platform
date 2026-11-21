import type { Mirror } from "../../core";
import type es from "../es/supportBar";

export default {
  readOnly: "Nur Lesezugriff",
  write: "Mit Änderungsrecht",
  writeShort: "Änderungsrecht",
  operator: "Bediener",
  untilRevoked: "Big-Elephant-Support · {mode} · Bis zum Widerruf",
  timed: "Big-Elephant-Support-Modus · {operator} · {mode} · Läuft ab um {until}",
  operatorTitle: "Bediener: {operator}",
  stillValid: "Die Autorisierung bleibt gültig, bis sie im CRM widerrufen wird",
  endSession: "Sitzung beenden",
  exit: "Verlassen",
  endSessionTitle: "Beendet diese Sitzung. Die Autorisierung wird nicht widerrufen: Du kannst im CRM eine neue Sitzung öffnen.",
  exitTitle: "Beendet die Sitzung und den Support-Zugang",
  closeNotRegistered: "Das Beenden konnte auf dem Server nicht registriert werden. Versuche es erneut oder widerrufe den Zugang im CRM.",
  closeNoServer: "Der Server konnte zum Beenden der Sitzung nicht erreicht werden. Versuche es erneut oder widerrufe den Zugang im CRM.",
} satisfies Mirror<typeof es>;
