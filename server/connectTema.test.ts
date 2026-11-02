/**
 * El marketplace (/admin/ampliar y sus fichas) sigue el tema del administrador: ninguna pantalla fuerza el modo oscuro
 * y la paleta del escenario tiene versión clara y oscura con contraste AA.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("client/src/components/connect/connectStage.css");

/** Variables de un bloque CSS cuyo selector empieza exactamente así. */
function block(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`Falta el bloque ${selector}`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries(Array.from(body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g), (m) => [m[1], m[2]]));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("marketplace: tema del administrador", () => {
  it("ninguna pantalla del marketplace fuerza el modo oscuro", () => {
    const files = ["client/src/pages/admin/connect/ConnectPage.tsx", "client/src/pages/admin/connect/ConnectDetailPage.tsx", "client/src/components/connect/Showcase.tsx", "client/src/components/connect/ConnectParts.tsx", "client/src/components/connect/SheetBlocks.tsx"];
    for (const f of files) expect(read(f), f).not.toMatch(/["\s]dark cx-stage|cx-stage dark\b/);
  });

  it("el escenario tiene paleta clara y oscura; las bandas sobre imagen siempre oscuras", () => {
    expect(css).toMatch(/\.cx-stage \{\s*color-scheme: light;/);
    expect(css).toMatch(/\.dark \.cx-stage,\s*\.cx-on-image \{\s*color-scheme: dark;/);
  });

  it("contraste AA de la paleta clara", () => {
    const v = block(".cx-stage");
    expect(contrast(v["--foreground"], v["--card"])).toBeGreaterThanOrEqual(7);
    expect(contrast(v["--foreground"], v["--background"])).toBeGreaterThanOrEqual(7);
    expect(contrast(v["--muted-foreground"], v["--card"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--muted-foreground"], v["--muted"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--primary-foreground"], v["--primary"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--cx-red-text"], v["--card"])).toBeGreaterThanOrEqual(4.5);
    for (const t of ["--success", "--warning", "--danger", "--info"]) expect(contrast(v[t], v["--card"]), t).toBeGreaterThanOrEqual(4.5);
  });
});
