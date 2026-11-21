import { describe, expect, it } from "vitest";
import { aulaText, contentNotice, formatAccessDate, pickLocale, resolveAulaLocale, withLang } from "../shared/learningText";

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

describe("idioma del aula: interfaz, contenido y navegación", () => {
  it("la elección de la URL manda sobre la guardada y esta sobre el idioma de la web", () => {
    expect(resolveAulaLocale({ fromUrl: "es", stored: "de", site: "de" })).toEqual({ locale: "es", explicit: "es" });
    expect(resolveAulaLocale({ fromUrl: null, stored: "es", site: "de" })).toEqual({ locale: "es", explicit: "es" });
    expect(resolveAulaLocale({ fromUrl: null, stored: null, site: "de" })).toEqual({ locale: "de", explicit: null });
    expect(resolveAulaLocale({ fromUrl: "fr", stored: "xx", site: undefined })).toEqual({ locale: "es", explicit: null }); // valores no válidos se ignoran
  });

  it("cambiar de idioma conserva la lección, el resto de parámetros y el ancla", () => {
    expect(withLang("/mi-formacion/curso/1/leccion/7", "es")).toBe("/mi-formacion/curso/1/leccion/7?lang=es");
    expect(withLang("/mi-formacion/curso/1/leccion/7?lang=de", "es")).toBe("/mi-formacion/curso/1/leccion/7?lang=es");
    expect(withLang("/admin/formacion/vista-previa/curso/1?x=1#modulo-2", "de")).toBe("/admin/formacion/vista-previa/curso/1?x=1&lang=de#modulo-2");
    expect(withLang("/mi-formacion", null)).toBe("/mi-formacion"); // sin elección explícita no se toca nada
  });

  it("un curso alemán visto en español muestra el original con un aviso claro; si coinciden no hay aviso", () => {
    expect(contentNotice("de", "es")).toMatch(/solo está disponible en alemán/);
    expect(contentNotice("de", "es")).toMatch(/idioma original/);
    expect(contentNotice("es", "de")).toMatch(/nur auf Spanisch/);
    expect(contentNotice("de", "de")).toBeNull();
    expect(contentNotice("de-DE", "de")).toBeNull();
    expect(contentNotice("es", "es")).toBeNull();
    expect(contentNotice(null, "es")).toBeNull(); // sin idioma de curso se asume el principal
  });

  it("los avisos de contenido existen en los dos idiomas de interfaz", () => {
    expect(Object.keys(aulaText("de").contentOnly).sort()).toEqual(Object.keys(aulaText("es").contentOnly).sort());
  });
});
