import { describe, it, expect } from "vitest";
import { todayMadridISO } from "./db";

describe("vigencia de variantes (hora de Madrid)", () => {
  it("el 23/11/2026 a las 23:30 en Madrid sigue siendo 23/11 (la promoción aún vale)", () => {
    expect(todayMadridISO(new Date("2026-11-23T22:30:00Z"))).toBe("2026-11-23");
  });
  it("a las 00:30 del 24/11 en Madrid ya es 24/11 (la promoción ha caducado)", () => {
    expect(todayMadridISO(new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-24");
  });
  it("respeta el horario de verano", () => {
    expect(todayMadridISO(new Date("2027-07-01T22:30:00Z"))).toBe("2027-07-02");
  });
});

describe("esquema de la vigencia", () => {
  it("las rutas de variantes aceptan una fecha YYYY-MM-DD y rechazan texto libre", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    const m = [...src.matchAll(/validUntil: z\.string\(\)\.regex\((\/.+?\/)\)/g)];
    expect(m.length).toBe(2);
    for (const x of m) {
      const re = new RegExp(x[1].slice(1, -1));
      expect(re.test("2026-11-23")).toBe(true);
      expect(re.test("23/11/2026")).toBe(false);
    }
  });
});
