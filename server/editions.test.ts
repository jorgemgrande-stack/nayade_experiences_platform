/** Convocatorias (E-4): reglas puras de estado, plazas, fechas y validación (panel, web y servidor). */
import { describe, it, expect } from "vitest";
import {
  canRequestSeat,
  formatEditionDates,
  initialEnrollmentStatus,
  isPastEdition,
  isValidTimeZone,
  localToUtcMs,
  publicEditionState,
  seatsLeft,
  utcMsToLocal,
  validateEditionForm,
  type EditionForm,
} from "../shared/editions";

const NOW = Date.UTC(2030, 5, 15, 12, 0);
const ed = (over: Partial<{ status: string; capacity: number | null; reserved: number; startsAt: number; endsAt: number | null }> = {}) => ({ status: "open", capacity: 10, reserved: 0, startsAt: NOW + 7 * 86400000, endsAt: null, ...over });
const okForm: EditionForm = { label: "Otoño", startsLocal: "2031-03-10T10:00", endsLocal: "2031-03-12T14:00", timezone: "Europe/Madrid", scheduleNote: "", mode: "online", locationNote: "", capacity: 10, showAvailability: false, status: "open", priceOverride: null };

describe("estado público de una edición", () => {
  it("borrador y cancelada no se ven; terminadas tampoco", () => {
    expect(publicEditionState(ed({ status: "draft" }), NOW)).toBeNull();
    expect(publicEditionState(ed({ status: "cancelled" }), NOW)).toBeNull();
    expect(publicEditionState(ed({ startsAt: NOW - 3 * 86400000, endsAt: NOW - 86400000 }), NOW)).toBeNull();
  });
  it("abierta, completa (todas las plazas confirmadas), lista de espera y cerrada", () => {
    expect(publicEditionState(ed(), NOW)).toBe("open");
    expect(publicEditionState(ed({ capacity: null, reserved: 999 }), NOW)).toBe("open");
    expect(publicEditionState(ed({ capacity: 10, reserved: 9 }), NOW)).toBe("open");
    expect(publicEditionState(ed({ capacity: 10, reserved: 10 }), NOW)).toBe("full");
    expect(publicEditionState(ed({ status: "waitlist" }), NOW)).toBe("waitlist");
    expect(publicEditionState(ed({ status: "closed" }), NOW)).toBe("closed");
  });
  it("una sin fecha de fin cuenta el día de inicio entero", () => {
    const start = NOW - 3600_000;
    expect(isPastEdition({ startsAt: start, endsAt: null }, NOW)).toBe(false);
    expect(isPastEdition({ startsAt: NOW - 2 * 86400000, endsAt: null }, NOW)).toBe(true);
  });
  it("solicitar plaza: abierta, completa y lista de espera sí (las dos últimas entran en lista de espera); cerrada y oculta no", () => {
    expect(canRequestSeat("open")).toBe(true);
    expect(canRequestSeat("full")).toBe(true);
    expect(canRequestSeat("waitlist")).toBe(true);
    expect(canRequestSeat("closed")).toBe(false);
    expect(canRequestSeat(null)).toBe(false);
    expect(initialEnrollmentStatus("open")).toBe("solicitada");
    expect(initialEnrollmentStatus("full")).toBe("lista_espera");
    expect(initialEnrollmentStatus("waitlist")).toBe("lista_espera");
  });
  it("plazas libres", () => {
    expect(seatsLeft({ capacity: null, reserved: 5 })).toBeNull();
    expect(seatsLeft({ capacity: 10, reserved: 4 })).toBe(6);
    expect(seatsLeft({ capacity: 3, reserved: 7 })).toBe(0);
  });
});

describe("fechas con zona horaria", () => {
  it("de hora local a UTC y de vuelta, con horario de verano e invierno", () => {
    expect(localToUtcMs("2031-01-15T10:00", "Europe/Madrid")).toBe(Date.UTC(2031, 0, 15, 9, 0));
    expect(localToUtcMs("2031-07-15T10:00", "Europe/Madrid")).toBe(Date.UTC(2031, 6, 15, 8, 0));
    expect(localToUtcMs("2031-07-15T10:00", "America/Mexico_City")).toBe(Date.UTC(2031, 6, 15, 16, 0));
    expect(localToUtcMs("2031-07-15T10:00", "UTC")).toBe(Date.UTC(2031, 6, 15, 10, 0));
    for (const tz of ["Europe/Madrid", "America/Bogota", "Asia/Tokyo", "Atlantic/Canary"]) {
      for (const local of ["2031-01-15T10:00", "2031-07-15T23:30", "2031-03-30T02:30", "2031-10-26T01:15"]) {
        const ms = localToUtcMs(local, tz)!;
        expect(ms).not.toBeNull();
        // Ida y vuelta (las horas inexistentes del cambio de hora se desplazan, nunca fallan)
        expect(utcMsToLocal(ms, tz).slice(0, 10)).toBe(local.slice(0, 10));
      }
    }
    expect(utcMsToLocal(Date.UTC(2031, 6, 15, 8, 0), "Europe/Madrid")).toBe("2031-07-15T10:00");
  });
  it("fechas y zonas no válidas", () => {
    for (const bad of ["", "2031-02-31T10:00", "2031-13-01T10:00", "2031-01-15 10:00", "2031-01-15T25:00", "2031-01-15T10:60", "hoy"]) expect(localToUtcMs(bad, "Europe/Madrid")).toBeNull();
    expect(localToUtcMs("2031-01-15T10:00", "Marte/Olimpo")).toBeNull();
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("Marte/Olimpo")).toBe(false);
  });
  it("texto de las fechas en español", () => {
    const s = (l: string) => localToUtcMs(l, "Europe/Madrid")!;
    expect(formatEditionDates(s("2031-03-10T10:00"), null, "Europe/Madrid")).toBe("10 de marzo de 2031");
    expect(formatEditionDates(s("2031-03-10T10:00"), s("2031-03-10T18:00"), "Europe/Madrid")).toBe("10 de marzo de 2031");
    expect(formatEditionDates(s("2031-03-10T10:00"), s("2031-03-12T14:00"), "Europe/Madrid")).toBe("10 – 12 de marzo de 2031");
    expect(formatEditionDates(s("2031-03-30T10:00"), s("2031-04-02T14:00"), "Europe/Madrid")).toBe("30 de marzo – 2 de abril de 2031");
    expect(formatEditionDates(s("2031-12-30T10:00"), s("2032-01-02T14:00"), "Europe/Madrid")).toBe("30 de diciembre de 2031 – 2 de enero de 2032");
    expect(formatEditionDates(s("2031-03-10T10:00"), null, "Europe/Madrid", true)).toBe("10 de marzo de 2031, 10:00 h");
    // Zona desconocida: no falla, usa la de Madrid
    expect(formatEditionDates(s("2031-03-10T10:00"), null, "Marte/Olimpo")).toBe("10 de marzo de 2031");
  });
});

describe("validación del formulario de una edición", () => {
  it("válido", () => expect(validateEditionForm(okForm)).toEqual({}));
  it("errores por campo, en español", () => {
    expect(validateEditionForm({ ...okForm, label: " " }).label).toMatch(/nombre a la edición/);
    expect(validateEditionForm({ ...okForm, label: "x".repeat(161) }).label).toMatch(/160/);
    expect(validateEditionForm({ ...okForm, startsLocal: "" }).startsLocal).toMatch(/inicio/);
    expect(validateEditionForm({ ...okForm, endsLocal: "2031-03-09T10:00" }).endsLocal).toMatch(/anterior/);
    expect(validateEditionForm({ ...okForm, endsLocal: "mañana" }).endsLocal).toMatch(/no es válida/);
    expect(validateEditionForm({ ...okForm, timezone: "Marte/Olimpo" }).timezone).toMatch(/zona horaria/);
    for (const capacity of [0, -3, 2.5, 1_000_000]) expect(validateEditionForm({ ...okForm, capacity }).capacity).toMatch(/entero mayor que 0/);
    expect(validateEditionForm({ ...okForm, capacity: null })).toEqual({});
    expect(validateEditionForm({ ...okForm, priceOverride: -1 }).priceOverride).toMatch(/precio/);
    expect(validateEditionForm({ ...okForm, priceOverride: 0 })).toEqual({});
    expect(validateEditionForm({ ...okForm, scheduleNote: "x".repeat(601) }).scheduleNote).toMatch(/600/);
  });
});
