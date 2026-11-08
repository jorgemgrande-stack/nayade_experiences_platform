import { describe, expect, it } from "vitest";
import { ACCESS_TONES, MARKET_TONES, STATE_TONE, railOffset, railPage, railPages, toneOf } from "@shared/marketplaceVisual";
import { CONNECT_STATE_SHORT } from "@shared/connectMarketplace";

describe("toneOf", () => {
  it("el acento publicado en el catálogo manda", () => {
    expect(toneOf({ key: "hotel-net-complete", icon: "hotel", sheet: { layout: { accentColor: "rose" } } })).toBe("magenta");
    expect(toneOf({ key: "x", sheet: { layout: { accentColor: "teal" } } })).toBe("turquoise");
    expect(toneOf({ key: "x", sheet: { layout: { accentColor: "slate" } } })).toBe("night");
  });

  it("sin acento, cada sector tiene su color por el icono", () => {
    expect(toneOf({ key: "hotel-net-complete", icon: "hotel" })).toBe("electric");
    expect(toneOf({ key: "restaurant-net-complete", icon: "chef" })).toBe("amber");
    expect(toneOf({ key: "care-net-complete", icon: "heart" })).toBe("magenta");
    expect(toneOf({ key: "ski-net-complete", icon: "mountain" })).toBe("turquoise");
    expect(toneOf({ key: "life-net", icon: "leaf" })).toBe("emerald");
  });

  it("icono desconocido o ausente: tono estable por clave, nunca el azul noche del fondo", () => {
    const a = toneOf({ key: "producto-raro", icon: "no-existe" });
    expect(toneOf({ key: "producto-raro", icon: "no-existe" })).toBe(a);
    expect(MARKET_TONES).toContain(a);
    expect(a).not.toBe("night");
    expect(toneOf({ key: "otro", sheet: null })).not.toBe("night");
  });

  it("no se deja engañar por claves heredadas del prototipo", () => {
    expect(MARKET_TONES).toContain(toneOf({ key: "k", icon: "constructor" }));
    expect(MARKET_TONES).toContain(toneOf({ key: "k", icon: "toString" }));
  });
});

describe("estados y accesos", () => {
  it("todos los estados comerciales tienen color", () => {
    for (const s of Object.keys(CONNECT_STATE_SHORT)) expect(STATE_TONE[s as keyof typeof STATE_TONE]).toBeTruthy();
    expect(STATE_TONE.available).toBe("emerald");
    expect(STATE_TONE.on_request).toBe("amber");
    expect(STATE_TONE.coming_soon).toBe("violet");
    expect(STATE_TONE.active).toBe("electric");
  });

  it("los cuatro accesos tienen degradados distintos", () => {
    const keys = Object.values(ACCESS_TONES).map((t) => t.join("-"));
    expect(new Set(keys).size).toBe(4);
  });
});

describe("carril", () => {
  it("sin desbordamiento hay una sola página", () => {
    expect(railPages(800, 800)).toBe(1);
    expect(railPages(0, 0)).toBe(1);
    expect(railPage(0, 800, 800)).toBe(0);
  });

  it("cuenta páginas y la última se marca al llegar al final", () => {
    expect(railPages(2500, 1000)).toBe(3);
    expect(railPage(0, 2500, 1000)).toBe(0);
    expect(railPage(1000, 2500, 1000)).toBe(1);
    expect(railPage(1500, 2500, 1000)).toBe(2);
  });

  it("la posición de una página no se sale del recorrido", () => {
    expect(railOffset(0, 2500, 1000)).toBe(0);
    expect(railOffset(1, 2500, 1000)).toBe(1000);
    expect(railOffset(5, 2500, 1000)).toBe(1500);
    expect(railOffset(-1, 2500, 1000)).toBe(0);
  });
});
