import { describe, expect, it } from "vitest";
import { cardGridClasses } from "../shared/cardGrid";

describe("cardGridClasses: rejilla dinámica de tarjetas", () => {
  it("una ficha: centrada y con ancho máximo", () => {
    const g = cardGridClasses(1, 4);
    expect(g.wrap).toContain("justify-center");
    expect(g.item).toBe("w-full max-w-md");
    expect(cardGridClasses(0, 3).item).toBe("w-full max-w-md");
  });
  it("dos fichas: dos columnas en un contenedor acotado", () => {
    const g = cardGridClasses(2, 4);
    expect(g.wrap).toContain("mx-auto max-w-4xl");
    expect(g.item).toBe("w-full sm:w-[calc(50%-0.75rem)]");
  });
  it("tres fichas: tres columnas a todo el ancho", () => {
    const g = cardGridClasses(3, 4);
    expect(g.wrap).not.toContain("max-w-4xl");
    expect(g.item).toBe("w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]");
  });
  it("cuatro o más con cuatro columnas: cuatro por fila; la última fila se centra", () => {
    for (const n of [4, 5, 6, 7, 12]) {
      const g = cardGridClasses(n, 4);
      expect(g.wrap).toBe("flex flex-wrap justify-center gap-6");
      expect(g.item).toBe("w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(25%-1.125rem)]");
    }
  });
  it("con máximo de tres columnas, cuatro o más fichas usan tres por fila", () => {
    expect(cardGridClasses(4, 3).item).toBe("w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]");
    expect(cardGridClasses(6, 3).item).toBe("w-full sm:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]");
  });
  it("con máximo de dos columnas, dos o más fichas van a dos por fila", () => {
    expect(cardGridClasses(2, 2).item).toBe("w-full sm:w-[calc(50%-0.75rem)]");
    expect(cardGridClasses(5, 2).item).toBe("w-full sm:w-[calc(50%-0.75rem)]");
    expect(cardGridClasses(1, 2).item).toBe("w-full max-w-md");
  });
});
