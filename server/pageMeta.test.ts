import { describe, it, expect } from "vitest";
import { normalizeMetaPatch } from "./pageBuilderDb";

describe("metadatos de una página (solo título y descripción)", () => {
  it("lo no indicado no cambia; vacío o null borra", () => {
    expect(normalizeMetaPatch({})).toEqual({});
    expect(normalizeMetaPatch({ metaDescription: "Hola" })).toEqual({ metaDescription: "Hola" });
    expect(normalizeMetaPatch({ metaTitle: "  " })).toEqual({ metaTitle: null });
    expect(normalizeMetaPatch({ metaTitle: null, metaDescription: "x" })).toEqual({ metaTitle: null, metaDescription: "x" });
  });
  it("limpia caracteres de control y recorta a la longitud permitida", () => {
    expect(normalizeMetaPatch({ metaTitle: "A" + String.fromCharCode(0) + "B" + String.fromCharCode(10) + "C" })).toEqual({ metaTitle: "A B C" });
    expect(normalizeMetaPatch({ metaTitle: "x".repeat(300) }).metaTitle).toHaveLength(200);
    expect(normalizeMetaPatch({ metaDescription: "y".repeat(500) }).metaDescription).toHaveLength(300);
  });
});
