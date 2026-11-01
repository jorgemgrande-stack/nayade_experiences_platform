import { describe, expect, it } from "vitest";
import {
  madridDateKey,
  madridEndOfDayUtc,
  madridMidnightMs,
  madridMonth,
  madridMonthsRange,
  madridQuarterRange,
  madridStartOfDayUtc,
  madridYear,
  nextDateKey,
} from "./utils/timezone";
import { madridRangeMs } from "./tpvReports";

const iso = (d: Date) => d.toISOString();
const HOUR = 3_600_000;

/** Duración (horas) del día de Madrid según inicio y fin calculados. */
const dayHours = (key: string) => (madridEndOfDayUtc(key).getTime() + 1 - madridStartOfDayUtc(key).getTime()) / HOUR;

describe("madridStartOfDayUtc / madridEndOfDayUtc", () => {
  it("días normales: sin cambios respecto al cálculo anterior (invierno +1 h, verano +2 h)", () => {
    expect(iso(madridStartOfDayUtc("2026-05-02"))).toBe("2026-05-01T22:00:00.000Z");
    expect(iso(madridEndOfDayUtc("2026-05-02"))).toBe("2026-05-02T21:59:59.999Z");
    expect(iso(madridStartOfDayUtc("2026-01-15"))).toBe("2026-01-14T23:00:00.000Z");
    expect(iso(madridEndOfDayUtc("2026-01-15"))).toBe("2026-01-15T22:59:59.999Z");
    expect(dayHours("2026-05-02")).toBe(24);
    expect(dayHours("2026-01-15")).toBe(24);
  });

  it("los días normales de todo 2026 y 2027 dan el mismo resultado que la fórmula del mediodía", () => {
    // Fórmula antigua (desfase del mediodía; correcta salvo el día del cambio)
    const oldStart = (key: string) => {
      const noon = new Date(`${key}T12:00:00Z`);
      const u = new Date(noon.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
      const m = new Date(noon.toLocaleString("en-US", { timeZone: "Europe/Madrid" })).getTime();
      return Date.parse(`${key}T00:00:00Z`) - (m - u);
    };
    const changes = new Set(["2026-03-29", "2026-10-25", "2027-03-28", "2027-10-31"]);
    let key = "2026-01-01";
    let checked = 0;
    while (key < "2028-01-01") {
      if (!changes.has(key)) {
        expect(madridStartOfDayUtc(key).getTime()).toBe(oldStart(key));
        expect(dayHours(key)).toBe(24);
        checked++;
      } else {
        expect(madridStartOfDayUtc(key).getTime()).not.toBe(oldStart(key));
      }
      key = nextDateKey(key);
    }
    expect(checked).toBe(730 - 4);
  });

  it("cambio de marzo 2026 (29/03, día de 23 horas)", () => {
    expect(iso(madridStartOfDayUtc("2026-03-29"))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(madridEndOfDayUtc("2026-03-29"))).toBe("2026-03-29T21:59:59.999Z");
    expect(dayHours("2026-03-29")).toBe(23);
    // El día anterior y el siguiente encajan sin huecos ni solapes
    expect(madridEndOfDayUtc("2026-03-28").getTime() + 1).toBe(madridStartOfDayUtc("2026-03-29").getTime());
    expect(madridEndOfDayUtc("2026-03-29").getTime() + 1).toBe(madridStartOfDayUtc("2026-03-30").getTime());
  });

  it("cambio de octubre 2026 (25/10, día de 25 horas)", () => {
    expect(iso(madridStartOfDayUtc("2026-10-25"))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(madridEndOfDayUtc("2026-10-25"))).toBe("2026-10-25T22:59:59.999Z");
    expect(dayHours("2026-10-25")).toBe(25);
    expect(madridEndOfDayUtc("2026-10-24").getTime() + 1).toBe(madridStartOfDayUtc("2026-10-25").getTime());
    expect(madridEndOfDayUtc("2026-10-25").getTime() + 1).toBe(madridStartOfDayUtc("2026-10-26").getTime());
  });

  it("otro año: 2027 (28/03 y 31/10)", () => {
    expect(iso(madridStartOfDayUtc("2027-03-28"))).toBe("2027-03-27T23:00:00.000Z");
    expect(dayHours("2027-03-28")).toBe(23);
    expect(iso(madridStartOfDayUtc("2027-10-31"))).toBe("2027-10-30T22:00:00.000Z");
    expect(iso(madridEndOfDayUtc("2027-10-31"))).toBe("2027-10-31T22:59:59.999Z");
    expect(dayHours("2027-10-31")).toBe(25);
  });

  it("medianoche, 02:00 y 03:00 locales de los días de cambio caen dentro del día correcto", () => {
    // 29/03/2026: 00:00 CET = 23:00Z del 28; 02:00 no existe (salta a 03:00 CEST = 01:00Z)
    const s = madridStartOfDayUtc("2026-03-29").getTime();
    const e = madridEndOfDayUtc("2026-03-29").getTime();
    for (const t of ["2026-03-28T23:00:00Z", "2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z"]) {
      const ms = Date.parse(t);
      expect(ms >= s && ms <= e).toBe(true);
      expect(madridDateKey(new Date(ms))).toBe("2026-03-29");
    }
    expect(madridDateKey(new Date(s - 1))).toBe("2026-03-28");
    // 25/10/2026: 02:00 CEST (00:00Z), 02:00 CET repetida (01:00Z), 03:00 CET (02:00Z)
    const s2 = madridStartOfDayUtc("2026-10-25").getTime();
    const e2 = madridEndOfDayUtc("2026-10-25").getTime();
    for (const t of ["2026-10-24T22:00:00Z", "2026-10-25T00:00:00Z", "2026-10-25T01:00:00Z", "2026-10-25T02:00:00Z", "2026-10-25T22:30:00Z"]) {
      const ms = Date.parse(t);
      expect(ms >= s2 && ms <= e2).toBe(true);
      expect(madridDateKey(new Date(ms))).toBe("2026-10-25");
    }
    expect(madridDateKey(new Date(e2 + 1))).toBe("2026-10-26");
  });

  it("coincide con el rango del informe del TPV (que no cambia)", () => {
    for (const k of ["2026-03-29", "2026-10-25", "2027-03-28", "2027-10-31", "2026-07-14"]) {
      const r = madridRangeMs(k, k);
      expect(madridStartOfDayUtc(k).getTime()).toBe(r.fromMs);
      expect(madridEndOfDayUtc(k).getTime()).toBe(r.toMsExclusive - 1);
      expect(madridMidnightMs(k)).toBe(r.fromMs);
    }
  });
});

describe("fin de mes, de trimestre y de año", () => {
  it("nextDateKey cruza meses, años y bisiestos", () => {
    expect(nextDateKey("2026-01-31")).toBe("2026-02-01");
    expect(nextDateKey("2026-02-28")).toBe("2026-03-01");
    expect(nextDateKey("2028-02-28")).toBe("2028-02-29");
    expect(nextDateKey("2026-12-31")).toBe("2027-01-01");
  });

  it("año y mes fiscal de Madrid en la última hora del mes y del trimestre", () => {
    // 31/03 23:30 Madrid (CEST) = 21:30Z: sigue siendo marzo / T1
    expect(madridMonth(new Date("2026-03-31T21:30:00Z"))).toBe(3);
    // 01/04 00:30 Madrid = 22:30Z del 31/03 en UTC: ya es abril / T2
    expect(madridMonth(new Date("2026-03-31T22:30:00Z"))).toBe(4);
    // Fin de año: 01/01/2027 00:30 Madrid = 23:30Z del 31/12/2026
    expect(madridYear(new Date("2026-12-31T23:30:00Z"))).toBe(2027);
    expect(madridYear(new Date("2026-12-31T22:30:00Z"))).toBe(2026);
  });

  it("trimestres de Madrid: instantes y fechas de calendario", () => {
    const t1 = madridQuarterRange(2026, 1);
    expect(t1.startStr).toBe("2026-01-01");
    expect(t1.endStr).toBe("2026-03-31");
    expect(iso(t1.start)).toBe("2025-12-31T23:00:00.000Z");
    expect(iso(t1.endExcl)).toBe("2026-03-31T22:00:00.000Z"); // 01/04 00:00 CEST
    const t2 = madridQuarterRange(2026, 2);
    expect([t2.startStr, t2.endStr]).toEqual(["2026-04-01", "2026-06-30"]);
    expect(t2.start.getTime()).toBe(t1.endExcl.getTime());
    const t3 = madridQuarterRange(2026, 3);
    expect([t3.startStr, t3.endStr]).toEqual(["2026-07-01", "2026-09-30"]);
    const t4 = madridQuarterRange(2026, 4);
    expect([t4.startStr, t4.endStr]).toEqual(["2026-10-01", "2026-12-31"]);
    expect(iso(t4.endExcl)).toBe("2026-12-31T23:00:00.000Z"); // 01/01/2027 00:00 CET
    expect(madridQuarterRange(2027, 1).start.getTime()).toBe(t4.endExcl.getTime());
  });

  it("una factura del 1 de abril a las 00:30 en España es del 2.º trimestre, no del 1.º", () => {
    const issued = new Date("2026-03-31T22:30:00Z").getTime();
    const t1 = madridQuarterRange(2026, 1);
    const t2 = madridQuarterRange(2026, 2);
    expect(issued >= t1.start.getTime() && issued < t1.endExcl.getTime()).toBe(false);
    expect(issued >= t2.start.getTime() && issued < t2.endExcl.getTime()).toBe(true);
    // Y una del 31 de marzo a las 23:30 de España sigue en el 1.º
    const late = new Date("2026-03-31T21:30:00Z").getTime();
    expect(late >= t1.start.getTime() && late < t1.endExcl.getTime()).toBe(true);
  });

  it("periodos de enero a un mes (cuentas acumuladas)", () => {
    const r = madridMonthsRange(2026, 0, 12);
    expect([r.startStr, r.endStr]).toEqual(["2026-01-01", "2026-12-31"]);
    expect(iso(r.endExcl)).toBe("2026-12-31T23:00:00.000Z");
    const feb = madridMonthsRange(2028, 0, 2);
    expect(feb.endStr).toBe("2028-02-29");
    const nov = madridMonthsRange(2026, 0, 11);
    expect(nov.endStr).toBe("2026-11-30");
    expect(iso(nov.endExcl)).toBe("2026-11-30T23:00:00.000Z");
  });
});
