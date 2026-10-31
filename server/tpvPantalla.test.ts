/**
 * Pantalla de venta del TPV: filtros por categorías propias, selección de caja y textos (lógica pura y fuente).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildTpvFilters, matchesTpvFilter, productBadge, pickInitialRegister,
} from "../client/src/pages/admin/tpv/tpvScreenLogic";

const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/tpv/TpvScreen.tsx"), "utf8");

describe("filtros del TPV", () => {
  it("instalación original: los de siempre", () => {
    expect(buildTpvFilters({ licensed: false }).map((f) => f.label)).toEqual(["Todos", "Experiencia", "Pack", "SPA", "Hotel", "Lego Pack"]);
    expect(buildTpvFilters(undefined).map((f) => f.key)).toContain("legoPack");
  });
  it("pyme: sus categorías y lo sectorial solo si tiene algo a la venta", () => {
    const cat = { licensed: true, categories: [{ id: 3, name: "Peluquería" }, { id: 5, name: "Estética" }], spa: [], hotel: [] };
    expect(buildTpvFilters(cat).map((f) => [f.key, f.label])).toEqual([["all", "Todos"], ["cat:3", "Peluquería"], ["cat:5", "Estética"]]);
    expect(buildTpvFilters({ ...cat, spa: [{}] }).map((f) => f.label)).toContain("Tratamientos");
    const labels = buildTpvFilters(cat).map((f) => f.label).join(" ");
    expect(labels).not.toMatch(/Experiencia|Pack|SPA|Hotel|Lego/);
  });
  it("filtrado por categoría y etiqueta de la tarjeta", () => {
    expect(matchesTpvFilter({ productType: "experience", categoryId: 3 }, "cat:3")).toBe(true);
    expect(matchesTpvFilter({ productType: "experience", categoryId: 5 }, "cat:3")).toBe(false);
    expect(matchesTpvFilter({ productType: "spa" }, "spa")).toBe(true);
    expect(matchesTpvFilter({ productType: "spa" }, "all")).toBe(true);
    expect(productBadge({ productType: "experience", categoryId: 3 }, true, [{ id: 3, name: "Peluquería" }])).toBe("Peluquería");
    expect(productBadge({ productType: "experience", categoryId: null }, true)).toBe("Producto");
    expect(productBadge({ productType: "experience" }, false)).toBe("Experiencia");
  });
});

describe("selección de caja", () => {
  const regs = [{ id: 1, openSession: null }, { id: 2, openSession: { id: 9 } }, { id: 3, openSession: null }];
  it("recuerda la última elegida si sigue existiendo", () => {
    expect(pickInitialRegister(regs, 3)).toBe(3);
    expect(pickInitialRegister(regs, 99)).toBe(2); // ya no existe: la única abierta
  });
  it("con una sola caja, esa; sin cajas, ninguna; con varias cerradas, se pide elegir", () => {
    expect(pickInitialRegister([{ id: 7, openSession: null }], null)).toBe(7);
    expect(pickInitialRegister([], 1)).toBeNull();
    expect(pickInitialRegister([{ id: 1, openSession: null }, { id: 2, openSession: null }], null)).toBeNull();
  });
});

describe("pantalla de venta (fuente)", () => {
  it("sin caja fija: usa el selector de cajas y recuerda la elegida", () => {
    expect(src).not.toMatch(/useState\(1\)/);
    expect(src).toContain("trpc.tpv.getRegisterStatus.useQuery");
    expect(src).toContain("saveLastRegister");
    expect(src).toContain("Todavía no tienes ninguna caja");
    expect(src).toContain("trpc.tpv.createRegister.useMutation");
  });
  it("textos en español claro", () => {
    expect(src).toContain("Punto de venta");
    expect(src).toContain("Abrir caja");
    expect(src).toContain("Volver al inicio");
    expect(src).not.toContain("Terminal Punto de Venta Presencial");
    expect(src).not.toContain("Volver al Dashboard");
    expect(src).not.toContain("Abrir Caja");
  });
  it("adaptable: rejilla por anchos, carrito plegable con barra inferior y botones táctiles", () => {
    expect(src).toContain("grid-cols-2 sm:grid-cols-3");
    expect(src).toContain("md:hidden fixed inset-x-0 bottom-0");
    expect(src).toContain("setCartOpen(true)");
    expect(src).not.toMatch(/w-6 h-6 rounded bg-gray-700/);
    expect(src).toMatch(/w-11 h-11/);
  });
  it("cliente existente al cobrar", () => {
    expect(src).toContain("trpc.tpv.searchClients.useQuery");
    expect(src).toContain("Cliente existente");
  });
});
