import type { Mirror } from "../../core";
import type es from "../es/peopleShared";

export default {
  firstSteps: {
    title: "Erste Schritte mit Personal",
    count: "{done} von {total}",
    done: "Erledigt",
    pending: "Offen",
  },
  schedule: {
    saved: "Arbeitszeiten gespeichert",
    intro: "Geplante Arbeitszeiten jeder Woche. Sie dienen dazu, die gestempelten mit den geplanten Stunden zu vergleichen. Du kannst an einem Tag mehrere Zeitblöcke hinzufügen (geteilte Schicht).",
    none: "Dieser Mitarbeiter hat noch keine Arbeitszeiten.",
    fill: "Von Montag bis Freitag mit 9:00 bis 17:00 füllen",
    free: "Frei",
    entry: "{day}: Beginn",
    exit: "{day}: Ende",
    to: "bis",
    removeSlot: "Zeitblock entfernen",
    addSlot: "Zeitblock",
    hoursWeek: "{hours} Std. pro Woche",
    saving: "Wird gespeichert…",
    save: "Arbeitszeiten speichern",
    weekday: {
      sun: "Sonntag",
      mon: "Montag",
      tue: "Dienstag",
      wed: "Mittwoch",
      thu: "Donnerstag",
      fri: "Freitag",
      sat: "Samstag",
    },
    err: {
      maxSlots: "Höchstens 4 Zeitblöcke pro Tag.",
      invalidDay: "Ungültiger Wochentag.",
      format: "{day}: Die Zeiten müssen das Format HH:MM haben.",
      order: "{day}: Das Ende muss nach dem Beginn liegen.",
      maxDay: "{day}: höchstens 4 Zeitblöcke.",
      overlap: "{day}: Zeitblöcke überschneiden sich.",
    },
  },
} satisfies Mirror<typeof es>;
