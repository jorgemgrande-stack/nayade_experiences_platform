import { describe, expect, it } from "vitest";
import { normalizeBlocks } from "./_core/pageBlocks";
import { DEFAULT_BLOCK_STYLE, isDefaultStyle } from "../shared/pageBlocks";

const textBlock = (style: Record<string, unknown>) => [{ id: "a1", type: "text", data: { title: "", html: "<p>Hola</p>", align: "left" }, style }];
const styleOf = (style: Record<string, unknown>) => normalizeBlocks(textBlock(style))[0].style;

describe("Studio · composición inmersiva (altura, encuadre, capas)", () => {
  it("el diseño de serie con los campos nuevos sigue siendo «de serie» (no se guarda)", () => {
    expect(isDefaultStyle(DEFAULT_BLOCK_STYLE)).toBe(true);
    expect(styleOf({ ...DEFAULT_BLOCK_STYLE })).toBeUndefined();
  });

  it("guarda la altura mínima y la colocación del contenido", () => {
    const s = styleOf({ minHeight: "full", contentY: "bottom", contentWidth: "narrow" });
    expect(s).toMatchObject({ minHeight: "full", contentY: "bottom", contentWidth: "narrow" });
  });

  it("la altura en píxeles solo cuenta con «valor personalizado» y se acota", () => {
    expect(styleOf({ minHeight: "custom", minHeightPx: 99999 })).toMatchObject({ minHeight: "custom", minHeightPx: 1600 });
    expect(styleOf({ minHeight: "custom", minHeightPx: 10 })).toMatchObject({ minHeightPx: 120 });
    expect(styleOf({ minHeight: "60", minHeightPx: 900 })).toMatchObject({ minHeight: "60", minHeightPx: DEFAULT_BLOCK_STYLE.minHeightPx });
  });

  it("rechaza valores fuera de la lista cerrada", () => {
    expect(styleOf({ minHeight: "enorme", contentY: "arriba", overlayDir: "diagonal", background: "image", bgImage: "/files/a/b.jpg" })).toMatchObject({
      minHeight: "auto", contentY: "center", overlayDir: "flat",
    });
  });

  it("el encuadre y la capa solo se guardan con fondo de imagen", () => {
    const sin = styleOf({ background: "soft", bgX: 10, bgZoom: 200, overlayDir: "bottom", overlayOpacity: 40 });
    expect(sin).toMatchObject({ background: "soft", bgX: 50, bgZoom: 100, overlayDir: "flat", overlayOpacity: 0 });
    const con = styleOf({ background: "image", bgImage: "/files/a/b.jpg", bgX: 20, bgY: 80, bgZoom: 140, overlayDir: "bottom", overlayOpacity: 55 });
    expect(con).toMatchObject({ bgX: 20, bgY: 80, bgZoom: 140, overlayDir: "bottom", overlayOpacity: 55 });
  });

  it("acota posición, ampliación y fuerza, y el ajuste del móvil exige «encuadre propio»", () => {
    const base = { background: "image", bgImage: "/files/a/b.jpg" };
    expect(styleOf({ ...base, bgX: -50, bgY: 900, bgZoom: 9999, overlayOpacity: 500 })).toMatchObject({ bgX: 0, bgY: 100, bgZoom: 250, overlayOpacity: 95 });
    expect(styleOf({ ...base, bgMobile: "same", bgXM: 10, bgZoomM: 200, bgX: 30 })).toMatchObject({ bgXM: 50, bgZoomM: 100 });
    expect(styleOf({ ...base, bgMobile: "own", bgXM: 10, bgYM: 20, bgZoomM: 200 })).toMatchObject({ bgMobile: "own", bgXM: 10, bgYM: 20, bgZoomM: 200 });
  });

  it("una cadena numérica se acepta y una no numérica toma el valor de serie", () => {
    const base = { background: "image", bgImage: "/files/a/b.jpg" };
    expect(styleOf({ ...base, bgX: "25" })).toMatchObject({ bgX: 25 });
    expect(styleOf({ ...base, bgX: "abc", bgZoom: 120 })).toMatchObject({ bgX: 50 });
  });
});

describe("Studio · altura mínima propia del móvil", () => {
  it("0 es «la misma que en ordenador» y no se guarda", () => {
    expect(isDefaultStyle({ ...DEFAULT_BLOCK_STYLE, minHeightM: 0 })).toBe(true);
    expect(styleOf({ minHeightM: 0 })).toBeUndefined();
  });
  it("guarda una altura propia acotada entre 240 y 2000 píxeles", () => {
    expect(styleOf({ minHeightM: 1000 })).toMatchObject({ minHeightM: 1000 });
    expect(styleOf({ minHeightM: 50 })).toMatchObject({ minHeightM: 240 });
    expect(styleOf({ minHeightM: 99999 })).toMatchObject({ minHeightM: 2000 });
    expect(styleOf({ minHeightM: "abc", minHeight: "full" })).toMatchObject({ minHeightM: 0 });
  });
});
