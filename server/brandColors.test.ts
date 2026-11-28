/** Colores de marca: mezclas, contraste y paleta derivada (funciones puras de shared/brandColors.ts). */
import { describe, expect, it } from "vitest";
import { buildPalette, contrastOn, contrastRatio, mixHex, normalizeHex, readableInk, tint } from "../shared/brandColors";

describe("brandColors", () => {
  it("normaliza hex de 3 y 6 cifras y rechaza lo demás", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #8F7454 ")).toBe("#8f7454");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#8f7454; background:url(x)")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it("mezcla colores linealmente", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#8f7454", "#ffffff", 0)).toBe("#8f7454");
    expect(mixHex("#8f7454", "#ffffff", 1)).toBe("#ffffff");
    expect(tint("#8f7454", 0.92)).toBe("#f6f4f1");
    expect(mixHex("nope", "#fff", 0.5)).toBeNull();
  });

  it("contraste WCAG y texto legible sobre un fondo", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastOn("#8f7454")).toBe("#ffffff");
    expect(contrastOn("#f5e9c8")).toBe("#111111");
    expect(contrastOn(null)).toBe("#ffffff");
  });

  it("una tinta clara se oscurece hasta leerse sobre blanco", () => {
    expect(contrastRatio(readableInk("#d9c9a8"), "#ffffff")!).toBeGreaterThanOrEqual(4.5);
    expect(readableInk("#51483F")).toBe("#51483f");
    expect(readableInk("x")).toBe("#2b2622");
  });

  it("paleta de Quantum: crema derivado del principal, bordes suaves y botón con texto blanco", () => {
    const p = buildPalette({ primary: "#8f7454", accent: "#b28b4e", ink: "#51483F" });
    expect(p).toMatchObject({ primary: "#8f7454", accent: "#b28b4e", ink: "#51483f", surface: "#ffffff", buttonText: "#ffffff" });
    expect(p.background).toBe("#f6f4f1");
    expect(p.border).toBe("#e9e3dd");
    expect(contrastRatio(p.muted, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
  });

  it("sin colores de empresa: neutros cálidos, nunca los de otra marca", () => {
    const p = buildPalette({});
    expect(p.primary).toBe("#4a4036");
    expect(p.accent).toBe("#8a7760");
    expect(buildPalette({ primary: "#8f7454" }).accent).toBe("#8f7454");
  });
});
