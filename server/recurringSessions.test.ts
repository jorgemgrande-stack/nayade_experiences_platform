/** Sesiones recurrentes de compra permanente: cálculo de fechas (zona horaria, DST, margen), validación y avisos. */
import { describe, expect, it } from "vitest";
import {
  buildRecurringNotice, buildZoomAccessNotice, isoWeekdayOf, isSafeZoomUrl, MORNING_IMPULSE_DEFAULTS, recurringLang, upcomingSessions, validateSchedule,
  type RecurringSchedule,
} from "../shared/recurringSessions";
import { utcMsToLocal } from "../shared/editions";
import { invoiceLinesFor } from "./shopOrdersDb";
import { chargedInvoiceAmounts } from "./invoiceCalc";

const MI: RecurringSchedule = { ...MORNING_IMPULSE_DEFAULTS };
const utc = (s: string) => Date.parse(s);
const local = (ms: number, tz = MI.timezone) => utcMsToLocal(ms, tz);

describe("validateSchedule", () => {
  it("los valores de Morning Impulse son válidos", () => expect(validateSchedule(MI)).toEqual([]));
  it("detecta cada campo erróneo", () => {
    expect(validateSchedule({ ...MI, weekday: 0 })).toEqual(["weekday"]);
    expect(validateSchedule({ ...MI, weekday: 8 })).toEqual(["weekday"]);
    expect(validateSchedule({ ...MI, startTime: "7:30" })).toEqual(["startTime"]);
    expect(validateSchedule({ ...MI, startTime: "24:00" })).toEqual(["startTime"]);
    expect(validateSchedule({ ...MI, timezone: "Mars/Olympus" })).toEqual(["timezone"]);
    expect(validateSchedule({ ...MI, durationMinutes: 0 })).toEqual(["durationMinutes"]);
    expect(validateSchedule({ ...MI, sessionsCount: 0 })).toEqual(["sessionsCount"]);
    expect(validateSchedule({ ...MI, sessionsCount: 53 })).toEqual(["sessionsCount"]);
    expect(validateSchedule({ ...MI, leadMinutes: -1 })).toEqual(["leadMinutes"]);
  });
  it("una configuración no válida lanza al calcular", () => expect(() => upcomingSessions(0, { ...MI, timezone: "x" })).toThrow(/timezone/));
});

describe("upcomingSessions · lunes 07:30 Europe/Madrid, 4 sesiones", () => {
  it("compra entre semana: los 4 próximos lunes a las 07:30 locales (CET, UTC+1)", () => {
    const s = upcomingSessions(utc("2026-11-25T12:00:00Z"), MI); // miércoles
    expect(s.map((x) => x.startsOn)).toEqual(["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"]);
    expect(s[0].startsAt).toBe(utc("2026-11-30T06:30:00Z"));
    expect(s.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(s.every((x) => x.endsAt - x.startsAt === 30 * 60_000)).toBe(true);
    expect(s.every((x) => isoWeekdayOf(x.startsOn) === 1 && local(x.startsAt).endsWith("T07:30"))).toBe(true);
  });
  it("incorporación semanal: comprar otro día cambia la primera sesión, no la hora", () => {
    expect(upcomingSessions(utc("2026-12-01T09:00:00Z"), MI)[0].startsOn).toBe("2026-12-07"); // martes
    expect(upcomingSessions(utc("2026-12-06T09:00:00Z"), MI)[0].startsOn).toBe("2026-12-07"); // domingo
  });
  it("el mismo lunes: con margen suficiente entra esa mañana; sin margen, la semana siguiente", () => {
    expect(upcomingSessions(utc("2026-11-30T05:00:00Z"), MI)[0].startsOn).toBe("2026-11-30"); // 06:00 local, faltan 90 min
    expect(upcomingSessions(utc("2026-11-30T05:30:00Z"), MI)[0].startsOn).toBe("2026-11-30"); // faltan 60 min exactos: entra
    expect(upcomingSessions(utc("2026-11-30T05:31:00Z"), MI)[0].startsOn).toBe("2026-12-07"); // faltan 59 min
    expect(upcomingSessions(utc("2026-11-30T12:00:00Z"), MI)[0].startsOn).toBe("2026-12-07"); // ya pasó
  });
  it("el día lo marca la zona de la oferta, no UTC: domingo 23:30Z ya es lunes 00:30 en Madrid", () => {
    const s = upcomingSessions(utc("2026-11-29T23:30:00Z"), MI);
    expect(s[0].startsOn).toBe("2026-11-30");
  });
  it("sin margen (0) la sesión que empieza justo ahora aún cuenta; con margen mayor, no", () => {
    expect(upcomingSessions(utc("2026-11-30T06:30:00Z"), { ...MI, leadMinutes: 0 })[0].startsOn).toBe("2026-11-30");
    expect(upcomingSessions(utc("2026-11-30T06:30:00Z"), { ...MI, leadMinutes: 1 })[0].startsOn).toBe("2026-12-07");
  });
  it("cambio de hora de primavera (28/03/2027): sigue siendo 07:30 LOCAL, el desfase UTC cambia", () => {
    const s = upcomingSessions(utc("2027-03-20T10:00:00Z"), MI);
    expect(s.map((x) => x.startsOn)).toEqual(["2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12"]);
    expect(s[0].startsAt).toBe(utc("2027-03-22T06:30:00Z")); // CET
    expect(s[1].startsAt).toBe(utc("2027-03-29T05:30:00Z")); // CEST
    expect(s.every((x) => local(x.startsAt).endsWith("T07:30"))).toBe(true);
    expect(s[1].startsAt - s[0].startsAt).toBe(7 * 24 * 3_600_000 - 3_600_000);
  });
  it("cambio de hora de otoño (25/10/2026): también conserva la hora local", () => {
    const s = upcomingSessions(utc("2026-10-20T10:00:00Z"), MI);
    expect(s.map((x) => x.startsOn)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(s.every((x) => local(x.startsAt).endsWith("T07:30"))).toBe(true);
  });
  it("cruza el fin de año y respeta otras zonas", () => {
    const s = upcomingSessions(utc("2026-12-20T10:00:00Z"), { ...MI, timezone: "America/Mexico_City" });
    expect(s.map((x) => x.startsOn)).toEqual(["2026-12-21", "2026-12-28", "2027-01-04", "2027-01-11"]);
    expect(s.every((x) => local(x.startsAt, "America/Mexico_City").endsWith("T07:30"))).toBe(true);
  });
  it("otro día y hora configurables", () => {
    const s = upcomingSessions(utc("2026-11-25T12:00:00Z"), { ...MI, weekday: 3, startTime: "18:15", sessionsCount: 2, durationMinutes: 90 }); // miércoles 18:15
    expect(s.map((x) => x.startsOn)).toEqual(["2026-11-25", "2026-12-02"]);
    expect(s[0].endsAt - s[0].startsAt).toBe(90 * 60_000);
  });
  it("es determinista: el mismo instante da las mismas sesiones", () => {
    const a = upcomingSessions(utc("2026-11-25T12:00:00Z"), MI);
    expect(upcomingSessions(utc("2026-11-25T12:00:00Z"), MI)).toEqual(a);
  });
});

describe("avisos de compra", () => {
  const slots = upcomingSessions(utc("2026-11-25T12:00:00Z"), MI);
  const base = { productName: "MORNING IMPULSE", slots, timezone: "Europe/Madrid", seats: 1 };
  it("con enlace real: lo incluye como botón", () => {
    const n = buildRecurringNotice({ ...base, lang: "es", zoomUrl: "https://us02web.zoom.us/j/123456789" });
    expect(n.cta).toEqual({ label: "Ir a la sesión de Zoom", url: "https://us02web.zoom.us/j/123456789" });
    expect(n.paragraphs.join("\n")).toContain("lunes, 30 de noviembre de 2026, 07:30 (Europe/Madrid)");
  });
  it("SIN enlace: no hay botón y lo dice (no promete acceso)", () => {
    const n = buildRecurringNotice({ ...base, lang: "es", zoomUrl: null });
    expect(n.cta).toBeNull();
    expect(n.paragraphs.join("\n")).toContain("Todavía no hay enlace de Zoom");
  });
  it("cuatro idiomas, con el nombre y las fechas; idioma desconocido: alemán", () => {
    for (const l of ["de", "es", "en", "fr"]) {
      const n = buildRecurringNotice({ ...base, lang: l, zoomUrl: null });
      expect(n.subject).toContain("MORNING IMPULSE");
      expect(n.paragraphs.length).toBe(1 + 4 + 1);
    }
    expect(recurringLang("it")).toBe("de");
    expect(recurringLang(undefined)).toBe("de");
    expect(buildRecurringNotice({ ...base, lang: "xx", zoomUrl: null }).title).toBe("Deine Teilnahme ist bestätigt");
  });
  it("varias plazas se indican", () => {
    expect(buildRecurringNotice({ ...base, lang: "en", seats: 2, zoomUrl: null }).paragraphs.join("\n")).toContain("Places booked: 2.");
  });
  it("aviso posterior de Zoom con el enlace", () => {
    const n = buildZoomAccessNotice({ lang: "fr", productName: "MORNING IMPULSE", slots, timezone: "Europe/Madrid", zoomUrl: "https://zoom.us/j/1" });
    expect(n.cta?.url).toBe("https://zoom.us/j/1");
    expect(n.subject).toContain("Zoom");
  });
  it("solo enlaces https sin credenciales", () => {
    expect(isSafeZoomUrl("https://zoom.us/j/1")).toBe(true);
    for (const u of ["http://zoom.us/j/1", "javascript:alert(1)", "https://user:pw@zoom.us/j/1", "", "zoom.us/j/1", 5, null]) expect(isSafeZoomUrl(u)).toBe(false);
  });
});

describe("IVA provisional del 21 % sobre el PVP de Morning Impulse (49 € con IVA incluido)", () => {
  it("49 € → base 40,50 € + cuota 8,50 €; no se suma el IVA encima", () => {
    const items = invoiceLinesFor([{ productId: 24, productName: "MORNING IMPULSE", people: 1, amountTotal: 4900 }], new Map([[24, 21]]));
    expect(items[0]).toMatchObject({ total: 49, taxRate: 21, fiscalRegime: "general" });
    const a = chargedInvoiceAmounts(items, 49);
    expect([a.subtotal, a.taxAmount, a.total]).toEqual([40.5, 8.5, 49]);
  });
});
