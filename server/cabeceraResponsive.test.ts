import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nav = readFileSync("client/src/components/PublicNav.tsx", "utf8");
const sw = readFileSync("client/src/components/LanguageSwitcher.tsx", "utf8");

describe("cabecera centrada: escritorio solo cuando cabe", () => {
  it("con más de 5 opciones el escritorio empieza en xl y el menú desplegable cubre hasta 1279 px", () => {
    expect(nav).toMatch(/const wide = navLinks\.length \+ \(showContactLink \? 1 : 0\) > 5/);
    expect(nav).toMatch(/wide \? "xl:grid-cols-\[1fr_auto_1fr\]"/);
    expect(nav).toMatch(/wide \? "xl:hidden" : "lg:hidden"/);
  });

  it("el menú desplegable incluye el selector de idioma", () => {
    const panel = nav.slice(nav.indexOf("Menú mobile"));
    expect(panel).toContain("<LanguageSwitcher");
  });
});

describe("selector de idioma sobre la portada", () => {
  it("hereda el color de la cabecera y marca el idioma actual con subrayado (legible sobre foto)", () => {
    expect(sw).toMatch(/inherit = false/);
    expect(sw).toContain("underline");
    expect(nav).toContain("<LanguageSwitcher inherit />");
  });
});
