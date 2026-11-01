/**
 * Caja con la sesión abierta en modo oscuro: el texto secundario (categorías, «Subtotal», precios por unidad…) usa
 * el token `text-muted-foreground` y llega a AA (4,5:1) sobre las superficies oscuras de la caja. El gris heredado
 * (`text-gray-400`, que en oscuro se pinta con oklch(0.56 …)) se quedaba en 4,3:1.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AA } from "../shared/panelTheme";

const css = fs.readFileSync(path.join(__dirname, "../client/src/index.css"), "utf8");
const screen = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/tpv/TpvScreen.tsx"), "utf8");

/** Luminancia relativa (WCAG) de un color oklch(L C h). */
function oklchLuminance(L: number, C: number, h: number): number {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  const R = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const G = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const B = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
const parse = (v: string) => {
  const m = v.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) throw new Error(`color no oklch: ${v}`);
  return oklchLuminance(Number(m[1]), Number(m[2]), Number(m[3]));
};
const ratio = (fg: number, bg: number) => (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);

/** Valor de un token dentro del bloque `.dark { … }` de index.css. */
function darkToken(name: string): string {
  const block = css.match(/\n\.dark \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const v = block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  if (!v) throw new Error(`falta --${name} en .dark`);
  return v.trim();
}

// Superficies de la caja en oscuro: fondo (gray-950 de Tailwind), tarjetas (bg-gray-900/800 → --card) y segundo nivel
const SURFACES = {
  fondo: oklchLuminance(0.13, 0.028, 261.692),
  tarjeta: parse(darkToken("card")),
  segundoNivel: parse(darkToken("muted")),
};

describe("caja en modo oscuro con la sesión abierta: contraste AA del texto secundario", () => {
  it("el token del texto secundario llega a 4,5:1 sobre todas las superficies de la caja", () => {
    const fg = parse(darkToken("muted-foreground"));
    for (const [name, bg] of Object.entries(SURFACES)) expect(ratio(fg, bg), name).toBeGreaterThanOrEqual(AA);
  });

  it("el gris heredado se quedaba por debajo de AA (por eso se sustituye)", () => {
    const gray400 = css.match(/\.dark \.text-gray-400, \.dark \.text-slate-400 \{ color: (oklch\([^)]+\))/)?.[1];
    expect(gray400).toBeTruthy();
    expect(ratio(parse(gray400!), SURFACES.tarjeta)).toBeLessThan(AA);
  });

  it("la caja abierta no usa ese gris: categorías, «Subtotal» y el resto del texto secundario van con el token", () => {
    const open = screen.slice(screen.indexOf('<div className="dark fixed inset-0 bg-gray-950 flex flex-col overflow-hidden'), screen.indexOf("{/* Modal de concepto libre (solo admin) */}"));
    expect(open.length).toBeGreaterThan(1000);
    expect(open).not.toMatch(/\btext-gray-400\b/);
    expect(open).toContain('"text-muted-foreground hover:text-white"'); // filtros de categoría
    expect(open).toMatch(/<div className="flex justify-between text-xs text-muted-foreground">\s*<span>Subtotal<\/span>/);
  });
});
