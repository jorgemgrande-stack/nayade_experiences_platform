/**
 * Tipografías propias: la web no llama a Google Fonts (los visitantes no envían su IP a Google), las tres familias
 * (Playfair Display, Inter y Montserrat) se sirven desde la propia web con los mismos nombres y pesos, los ficheros
 * existen y llevan su licencia (SIL OFL 1.1).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const css = read("client/src/index.css");
const html = read("client/index.html");

describe("tipografías propias", () => {
  it("ni el HTML ni la hoja de estilos llaman a Google Fonts", () => {
    for (const src of [css, html]) {
      expect(src).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    }
  });

  it("declara las tres familias con los nombres que ya usa la web", () => {
    const families = Array.from(css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'/g)).map((m) => m[1]);
    expect(new Set(families)).toEqual(new Set(["Playfair Display", "Inter", "Montserrat"]));
    expect(families.filter((f) => f === "Playfair Display")).toHaveLength(4); // normal + cursiva, latino y latino extendido
  });

  it("cada @font-face apunta a un fichero que existe, con display swap y rango de caracteres", () => {
    const blocks = Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g)).map((m) => m[1]);
    expect(blocks.length).toBe(8);
    for (const b of blocks) {
      const file = /url\('\/fonts\/([^']+\.woff2)'\)/.exec(b)?.[1];
      expect(file, b).toBeTruthy();
      expect(fs.existsSync(path.join(ROOT, "client/public/fonts", file!)), String(file)).toBe(true);
      expect(b).toContain("font-display: swap");
      expect(b).toMatch(/unicode-range:\s*U\+/);
    }
  });

  it("alemán y español quedan cubiertos (latino y latino extendido) y la licencia acompaña a los ficheros", () => {
    const latin = /unicode-range:\s*(U\+0000-00FF[^;]*)/.exec(css)?.[1] ?? "";
    expect(latin).toContain("U+20AC"); // €
    for (const pkg of ["playfair-display", "inter", "montserrat"]) {
      expect(fs.existsSync(path.join(ROOT, `client/public/fonts/LICENSE-${pkg}.txt`))).toBe(true);
      expect(read(`client/public/fonts/LICENSE-${pkg}.txt`)).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });

  it("precarga solo las dos fuentes de la primera pantalla (latino normal)", () => {
    const pre = Array.from(html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)).map((m) => m[1]);
    expect(pre).toEqual(["/fonts/playfair-display-latin-wght-normal.woff2", "/fonts/inter-latin-wght-normal.woff2"]);
    for (const p of pre) expect(fs.existsSync(path.join(ROOT, "client/public", p))).toBe(true);
  });
});
