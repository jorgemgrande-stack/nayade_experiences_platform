import { describe, expect, it } from "vitest";
import { editionSubtitle, eventDurationText, sessionsSummary, startsAtHasTime } from "../shared/editionSummary";
import { localToUtcMs } from "../shared/editions";
import { siteUiText } from "../shared/siteUiText";

const TZ = "Europe/Madrid";

describe("editionSubtitle: la etiqueta sin sus fechas", () => {
  it("conserva lo que no es fecha ni el título del producto", () => {
    expect(editionSubtitle("RECONNECT LIVE · 29.11.–20.12.2026", "RECONNECT")).toBe("RECONNECT LIVE");
    expect(editionSubtitle("RECONNECT LIVE · 29/11–20/12/2026", "RECONNECT")).toBe("RECONNECT LIVE");
    expect(editionSubtitle("Grupo de tarde · 12/01/2027", "Curso X")).toBe("Grupo de tarde");
  });
  it("devuelve null cuando solo queda el título del producto (sin distinguir mayúsculas ni acentos)", () => {
    expect(editionSubtitle("MORNING IMPULSE · 30.11.–21.12.2026", "MORNING IMPULSE")).toBeNull();
    expect(editionSubtitle("MORNING IMPULSE · 4.–25.1.2027", "Morning Impulse")).toBeNull();
    expect(editionSubtitle("Neujahr Retreat · 30.12.2026 – 5.1.2027", "Neujahr Retreat")).toBeNull();
    expect(editionSubtitle("Retiro de Año Nuevo · 30.12.2026 – 5.1.2027", "Retiro de Ano Nuevo")).toBeNull();
    expect(editionSubtitle("HEALER ACTIVATION · 13.01.–31.03.2027", "HEALER ACTIVATION")).toBeNull();
    expect(editionSubtitle("HEALER MASTERY · April–September 2027", "HEALER MASTERY")).toBeNull();
    expect(editionSubtitle("HEALER INITIATION · Oktober 2027", "HEALER INITIATION")).toBeNull();
  });
  it("devuelve null cuando la etiqueta son solo fechas", () => {
    expect(editionSubtitle("29.11.–20.12.2026", "Curso")).toBeNull();
    expect(editionSubtitle("20 de noviembre de 2026", "Curso")).toBeNull();
    expect(editionSubtitle("(Oktober 2027)", "Curso")).toBeNull();
    expect(editionSubtitle("", "Curso")).toBeNull();
  });
  it("quita paréntesis y separadores que quedan vacíos", () => {
    expect(editionSubtitle("Edición de otoño (octubre 2026)", "Curso")).toBe("Edición de otoño");
    expect(editionSubtitle("Otoño, 3 de octubre de 2026, Madrid", "Curso")).toBe("Otoño, Madrid");
  });
});

const reconnect = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"].map((startsOn) => ({ startsOn, startTime: null, durationMinutes: 90, status: "scheduled" as const }));
const morning = ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"].map((startsOn) => ({ startsOn, startTime: null, durationMinutes: 30, status: "scheduled" as const }));

describe("sessionsSummary: una línea por paquete, sin inventar nada", () => {
  it("RECONNECT: 4 sesiones los domingos, 90 min y sin hora (hay horas por confirmar)", () => {
    expect(sessionsSummary(reconnect, { locale: "de", t: siteUiText("de") })).toEqual({ count: "4 Termine", weekday: "sonntags", time: null, duration: "90 Min." });
    expect(sessionsSummary(reconnect, { locale: "es", t: siteUiText("es") })).toEqual({ count: "4 sesiones", weekday: "los domingos", time: null, duration: "90 min" });
    expect(sessionsSummary(reconnect, { locale: "en", t: siteUiText("en") })).toEqual({ count: "4 sessions", weekday: "Sundays", time: null, duration: "90 min" });
  });
  it("MORNING IMPULSE: los lunes, 30 min", () => {
    expect(sessionsSummary(morning, { locale: "de-DE", t: siteUiText("de") })).toEqual({ count: "4 Termine", weekday: "montags", time: null, duration: "30 Min." });
  });
  it("con la misma hora en todas, la hora sale como dato", () => {
    const withTime = morning.map((s) => ({ ...s, startTime: "18:00" }));
    expect(sessionsSummary(withTime, { locale: "es", t: siteUiText("es") }).time).toBe("18:00 h");
    const mixed = withTime.map((s, i) => (i === 2 ? { ...s, startTime: null } : s));
    expect(sessionsSummary(mixed, { locale: "es", t: siteUiText("es") }).time).toBeNull();
    const different = withTime.map((s, i) => (i === 1 ? { ...s, startTime: "19:00" } : s));
    expect(sessionsSummary(different, { locale: "es", t: siteUiText("es") }).time).toBeNull();
  });
  it("con días de la semana o duraciones distintas no se resume ese dato", () => {
    const varied = [{ startsOn: "2026-11-30", startTime: null, durationMinutes: 60 }, { startsOn: "2026-12-02", startTime: null, durationMinutes: 90 }];
    expect(sessionsSummary(varied, { locale: "es", t: siteUiText("es") })).toEqual({ count: "2 sesiones", weekday: null, time: null, duration: null });
  });
  it("otros idiomas usan el nombre del día por Intl y las canceladas no cuentan", () => {
    const r = sessionsSummary([...reconnect, { startsOn: "2026-12-23", startTime: null, durationMinutes: 90, status: "cancelled" }], { locale: "fr", t: siteUiText("fr") });
    expect(r.count).toBe("4 sesiones");
    expect(r.weekday?.toLowerCase()).toBe("dimanche");
  });
});

describe("eventDurationText y startsAtHasTime: convocatorias sin sesiones", () => {
  it("Neujahr Retreat 30.12.2026 – 5.1.2027 → 7 días", () => {
    const s = localToUtcMs("2026-12-30T00:00", TZ)!;
    const e = localToUtcMs("2027-01-05T00:00", TZ)!;
    expect(eventDurationText(s, e, TZ, siteUiText("de"))).toBe("7 Tage");
    expect(eventDurationText(s, e, TZ, siteUiText("es"))).toBe("7 días");
    expect(eventDurationText(s, e, TZ, siteUiText("en"))).toBe("7 days");
  });
  it("un solo día o sin fin → null", () => {
    const s = localToUtcMs("2026-12-30T10:00", TZ)!;
    expect(eventDurationText(s, localToUtcMs("2026-12-30T18:00", TZ), TZ, siteUiText("es"))).toBeNull();
    expect(eventDurationText(s, null, TZ, siteUiText("es"))).toBeNull();
  });
  it("la medianoche local no es una hora", () => {
    expect(startsAtHasTime(localToUtcMs("2026-12-30T00:00", TZ)!, TZ)).toBe(false);
    expect(startsAtHasTime(localToUtcMs("2026-12-30T10:00", TZ)!, TZ)).toBe(true);
    // Medianoche en Madrid es 23:00 UTC del día anterior: lo que cuenta es la zona de la edición
    expect(startsAtHasTime(localToUtcMs("2026-12-30T00:00", TZ)!, "UTC")).toBe(true);
  });
});
