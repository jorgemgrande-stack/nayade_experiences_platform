import type { Mirror } from "../../core";
import type es from "../es/errors";

export default {
  operationFailed: "Der Vorgang konnte nicht abgeschlossen werden. Versuche es noch einmal.",
  badRequest: "Prüfe deine Eingaben: Es fehlen Felder oder das Format ist ungültig.",
  actionUnavailable: "Diese Aktion ist im Moment nicht verfügbar.",
  readOnly: "Dein Tarif ist schreibgeschützt: Du kannst deine Daten ansehen, aber nichts ändern.",
  expired: "Dein Tarif erlaubt im Moment keine Änderungen. Prüfe den Status deines Abonnements.",
} satisfies Mirror<typeof es>;
