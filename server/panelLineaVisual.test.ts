/**
 * Línea visual del panel: color principal de la empresa con contraste AA en modo claro y oscuro, colores por
 * significado (éxito, aviso, error, información) legibles en los dos modos y declarados igual en index.css.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BIG_ELEPHANT, NEUTRAL_INK, contrastRatio } from "../shared/loginBrand";
import { AA, DARK_SURFACE, LIGHT_SURFACE, NEUTRAL_LIGHT, PANEL_PALETTE_KEYS, SEMANTIC_COLORS, mixHex, panelPalette, panelPaletteCss, shiftUntilReadable } from "../shared/panelTheme";
import { TONE_BADGE, TONE_SURFACE, TONE_TEXT } from "../client/src/lib/panelTones";

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;
const SAMPLES = [undefined, null, "", "nada", "#0f5c4d", "#0b5d3b", "#e8590c", "#ff3035", "#ffd400", "#fff3a0", "#ffffff", "#000000", "#111111", "#1d4ed8", "#7c3aed", "#abc", "#22c55e"];

describe("color principal en el panel", () => {
  it("instalación de una sola empresa: sin cambios", () => {
    expect(panelPalette({ neutralSite: false, primaryColor: "#0f5c4d" })).toBeNull();
    expect(panelPalette(null)).toBeNull();
  });

  it("cualquier marca: botón, texto del botón y enlaces con 4,5:1 o más, en claro y en oscuro", () => {
    for (const c of SAMPLES) {
      const p = panelPalette({ neutralSite: true, primaryColor: c })!;
      for (const [mode, surfaces] of [["light", [LIGHT_SURFACE, "#ffffff"]], ["dark", [DARK_SURFACE]]] as const) {
        const v = p[mode];
        for (const s of surfaces) expect(ratio(v["--primary"], s), `${c} ${mode} sobre ${s}`).toBeGreaterThanOrEqual(AA);
        expect(ratio(v["--primary"], v["--primary-foreground"]), `${c} ${mode} texto del botón`).toBeGreaterThanOrEqual(AA);
        expect(v["--sidebar-primary"]).toBe(v["--primary"]);
        expect(v["--ring"]).toBe(v["--primary"]);
        expect(ratio(v["--secondary"], v["--secondary-foreground"])).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("una marca que ya se lee se respeta tal cual en modo claro; en oscuro se aclara sin dejar de ser suya", () => {
    const p = panelPalette({ neutralSite: true, primaryColor: "#0f5c4d" })!;
    expect(p.source).toBe("own");
    expect(p.light["--primary"]).toBe("#0f5c4d");
    expect(p.light["--primary-foreground"]).toBe("#ffffff");
    // Verde botella sobre el fondo oscuro no se leería: se aclara (mezcla con blanco), no se cambia por otro color
    expect(ratio("#0f5c4d", DARK_SURFACE)).toBeLessThan(AA);
    expect(p.dark["--primary"]).not.toBe("#0f5c4d");
    expect(p.dark["--primary"]).not.toBe(NEUTRAL_LIGHT);
    const shift = shiftUntilReadable("#0f5c4d", DARK_SURFACE, "#ffffff")!;
    expect(p.dark["--primary"]).toBe(mixHex("#0f5c4d", "#ffffff", shift.shift));
  });

  it("una marca algo clara se oscurece lo justo; una que no llega usa la tinta neutra", () => {
    const orange = panelPalette({ neutralSite: true, primaryColor: "#e8590c" })!;
    expect(orange.source).toBe("own");
    expect(orange.light["--primary"]).not.toBe("#e8590c");
    expect(ratio(orange.light["--primary"], LIGHT_SURFACE)).toBeLessThan(AA + 0.6);
    const pale = panelPalette({ neutralSite: true, primaryColor: "#fff3a0" })!;
    expect(pale.source).toBe("neutral");
    expect(pale.light["--primary"]).toBe(NEUTRAL_INK);
  });

  it("sin marca propia: el rojo de Big Elephant", () => {
    const p = panelPalette({ neutralSite: true })!;
    expect(p.source).toBe("default");
    expect(p.light["--primary"]).toBe(BIG_ELEPHANT.redInk);
    expect(p.dark["--primary"]).toBe(BIG_ELEPHANT.red);
  });

  it("hoja de estilos: modo claro, modo oscuro y zonas forzadas a oscuro (caja)", () => {
    const css = panelPaletteCss(panelPalette({ neutralSite: true, primaryColor: "#0f5c4d" })!);
    expect(css).toMatch(/^html:root\{--secondary:[^}]*--primary:#0f5c4d;/);
    expect(css).toContain("html.dark:root,html .dark{");
    for (const k of PANEL_PALETTE_KEYS) expect(css.split(`${k}:`).length - 1).toBe(2);
  });
});

describe("colores por significado", () => {
  const css = fs.readFileSync(path.join(__dirname, "../client/src/index.css"), "utf8");
  const block = (sel: RegExp) => css.slice(css.search(sel), css.indexOf("}", css.search(sel)));

  it("se leen (AA) sobre las superficies del panel en los dos modos", () => {
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.light)) {
      expect(ratio(c, "#ffffff"), name).toBeGreaterThanOrEqual(AA);
      expect(ratio(c, LIGHT_SURFACE), name).toBeGreaterThanOrEqual(AA);
    }
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.dark)) expect(ratio(c, DARK_SURFACE), name).toBeGreaterThanOrEqual(AA);
  });

  it("index.css los declara tal cual en :root y .dark y los expone como clases (text-success…)", () => {
    const root = block(/^:root \{/m);
    const dark = block(/^\.dark \{/m);
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.light)) expect(root).toContain(`--${name}: ${c};`);
    for (const [name, c] of Object.entries(SEMANTIC_COLORS.dark)) expect(dark).toContain(`--${name}: ${c};`);
    for (const name of Object.keys(SEMANTIC_COLORS.light)) expect(css).toContain(`--color-${name}: var(--${name});`);
  });

  it("los tonos del panel solo usan variables (de significado o de la marca), nunca colores fijos", () => {
    const all = [TONE_BADGE, TONE_TEXT, TONE_SURFACE].flatMap((m) => Object.values(m)).join(" ");
    expect(all).not.toMatch(/-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray)-\d/);
    expect(all).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
