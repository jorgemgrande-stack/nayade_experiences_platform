/** Aula del alumno: avisos por módulo, textos y catálogo de ampliaciones (puro, sin base de datos). */
import { describe, expect, it } from "vitest";
import { EXPIRY_WARNING_DAYS, moduleAccessNotice, parseExtensionConfig, DAY_MS } from "../shared/learning";
import { aulaText, fillAula, formatAccessDate, formatAulaPrice } from "../shared/learningText";

const NOW = Date.parse("2026-12-01T10:00:00Z");

describe("aviso de acceso por módulo", () => {
  it("bloqueado: «se desbloquea el …»", () => {
    expect(moduleAccessNotice({ state: "locked", unlocksAt: NOW + 30 * DAY_MS, endsAt: NOW + 120 * DAY_MS }, NOW)).toEqual({ kind: "locked", date: NOW + 30 * DAY_MS });
  });
  it("abierto con caducidad: fecha, y aviso suave solo con 7 días o menos", () => {
    expect(moduleAccessNotice({ state: "open", unlocksAt: null, endsAt: NOW + 20 * DAY_MS }, NOW)).toMatchObject({ kind: "until", daysLeft: 20, soon: false });
    expect(moduleAccessNotice({ state: "open", unlocksAt: null, endsAt: NOW + EXPIRY_WARNING_DAYS * DAY_MS }, NOW)).toMatchObject({ soon: true, daysLeft: 7 });
    expect(moduleAccessNotice({ state: "open", unlocksAt: null, endsAt: NOW + 8 * DAY_MS }, NOW)).toMatchObject({ soon: false });
    expect(moduleAccessNotice({ state: "open", unlocksAt: null, endsAt: NOW + 3 * 3600_000 }, NOW)).toMatchObject({ soon: true, daysLeft: 1 });
  });
  it("cerrado: «acceso finalizado el …»; sin caducidad o no incluido: nada", () => {
    expect(moduleAccessNotice({ state: "closed", unlocksAt: null, endsAt: NOW - DAY_MS }, NOW)).toEqual({ kind: "closed", date: NOW - DAY_MS });
    expect(moduleAccessNotice({ state: "open", unlocksAt: null, endsAt: null }, NOW)).toEqual({ kind: "none" });
    expect(moduleAccessNotice({ state: "not_included", unlocksAt: null, endsAt: null }, NOW)).toEqual({ kind: "none" });
  });
});

describe("textos del aula y fechas", () => {
  it("alemán y español tienen los mismos textos de acceso y ampliación", () => {
    const keys = ["unlocksOn", "accessUntilOn", "accessEndedOn", "accessEnded", "endsSoon", "endsSoonOne", "extendModule", "extendTitle", "extend30", "extend60", "extendPay", "extendNote", "extendClose", "extendFail"] as const;
    for (const k of keys) {
      expect(aulaText("es")[k], `es.${k}`).toMatch(/\S/);
      expect(aulaText("de")[k], `de.${k}`).toMatch(/\S/);
    }
    expect(fillAula(aulaText("es").unlocksOn, { date: "01/01/2027" })).toBe("Se desbloquea el 01/01/2027");
    expect(fillAula(aulaText("de").accessUntilOn, { date: "01.01.2027" })).toBe("Zugang bis 01.01.2027");
    expect(fillAula(aulaText("es").endsSoon, { n: 5 })).toContain("5 días");
  });
  it("las fechas van en horario de Madrid (medianoche cerca del cambio de día)", () => {
    // 23:30 UTC del 31/12 ya es 1 de enero en Madrid
    expect(formatAccessDate(Date.parse("2026-12-31T23:30:00Z"), "es")).toBe("01/01/2027");
    expect(formatAccessDate(Date.parse("2026-12-31T23:30:00Z"), "de")).toBe("01.01.2027");
  });
  it("precio en euros según el idioma", () => {
    expect(formatAulaPrice(3300, "es").replace(/\s/g, " ")).toMatch(/33,00\s?€/);
    expect(formatAulaPrice(5500, "de").replace(/\s/g, " ")).toMatch(/55,00\s?€/);
  });
});

describe("catálogo de ampliaciones: sin configuración no se ofrece nada", () => {
  it("ajuste vacío, roto o sin variantes válidas", () => {
    for (const raw of [undefined, null, "", "   ", "no es json", "{}", '{"experienceId":0,"variants":{"30":1}}', '{"experienceId":5,"variants":{}}', '{"experienceId":5,"variants":{"45":9}}']) expect(parseExtensionConfig(raw)).toBeNull();
  });
  it("solo admite 30 y 60 días", () => {
    expect(parseExtensionConfig('{"experienceId":5,"variants":{"30":7,"60":8,"90":9}}')).toEqual({ experienceId: 5, variants: [{ days: 30, variantId: 7 }, { days: 60, variantId: 8 }] });
    expect(parseExtensionConfig('{"experienceId":5,"variants":{"60":8}}')?.variants).toEqual([{ days: 60, variantId: 8 }]);
  });
});
