import { describe, expect, it } from "vitest";
import { BLOCK_KINDS, RESOURCE_KINDS, slugify } from "../shared/learningAuthoring";

describe("creación de formaciones: reglas puras", () => {
  it("el identificador de URL quita acentos y signos, y nunca queda vacío", () => {
    expect(slugify("Meditación: Sanación del Niño Interior")).toBe("meditacion-sanacion-del-nino-interior");
    expect(slugify("  ¡¡ ??  ")).toBe("curso");
    expect(slugify("A".repeat(300)).length).toBeLessThanOrEqual(78);
    expect(slugify("Kurs – Heilung & Energie")).toBe("kurs-heilung-energie");
  });
  it("el identificador cumple el formato que ya acepta el importador", () => {
    const ok = /^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/;
    for (const t of ["Curso 1", "Ñandú y más", "x", "Título muy largo ".repeat(20)]) expect(slugify(t)).toMatch(ok);
  });
  it("los bloques con fichero son un subconjunto de los creables", () => {
    for (const k of RESOURCE_KINDS) expect(BLOCK_KINDS).toContain(k);
    expect(BLOCK_KINDS).toContain("text");
    expect(BLOCK_KINDS).toContain("external_link");
  });
});
