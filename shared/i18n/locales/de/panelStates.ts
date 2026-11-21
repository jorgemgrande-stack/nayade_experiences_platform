import type { Mirror } from "../../core";
import type es from "../es/panelStates";

export default {
  loading: "Wird geladen…",
  notIncluded: {
    title: "Nicht in deinem Tarif enthalten",
    canUpgrade: "Dieser Bereich gehört nicht zu dem, was dein Unternehmen gebucht hat. Du kannst ihn jederzeit hinzufügen.",
    cannotUpgrade: "Dieser Bereich gehört nicht zu dem, was dein Unternehmen gebucht hat. Du kannst nachsehen, was er enthält, und die Person, die das Konto verwaltet, bitten, ihn hinzuzufügen.",
    upgrade: "Dein Unternehmen erweitern",
    home: "Zurück zur Startseite",
  },
  errorTitle: "Etwas ist schiefgelaufen",
  retry: "Erneut versuchen",
  kpiVsPrevious: "{change} ggü. Vormonat",
} satisfies Mirror<typeof es>;
