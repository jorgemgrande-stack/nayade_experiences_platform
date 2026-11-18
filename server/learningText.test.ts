import { describe, expect, it } from "vitest";
import { aulaText, formatAccessDate, pickLocale } from "../shared/learningText";

describe("textos del aula", () => {
  it("alemán y español tienen las mismas claves (incluidos los estados)", () => {
    const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
    expect(keys(aulaText("de"))).toEqual(keys(aulaText("es")));
    expect(keys(aulaText("de").status)).toEqual(keys(aulaText("es").status));
    for (const l of ["de", "es"] as const) for (const [k, v] of Object.entries(aulaText(l))) if (typeof v === "string") expect(v.trim(), `${l}.${k}`).not.toBe("");
  });
  it("el idioma se elige por prefijo y cae a español", () => {
    expect(pickLocale("de")).toBe("de");
    expect(pickLocale("de-DE")).toBe("de");
    expect(pickLocale("es")).toBe("es");
    expect(pickLocale(null)).toBe("es");
    expect(pickLocale("fr")).toBe("es");
  });
  it("la fecha de acceso va en hora de Madrid", () => {
    expect(formatAccessDate(Date.parse("2026-11-29T23:30:00Z"), "es")).toBe("30/11/2026");
    expect(formatAccessDate(Date.parse("2026-11-29T22:30:00Z"), "de")).toBe("29.11.2026");
  });
});
