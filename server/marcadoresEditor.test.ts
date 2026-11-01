/**
 * Marcadores de datos de la empresa en el editor de páginas: se ven como distintivos legibles («Teléfono de tu
 * empresa») y al guardar se sigue guardando el marcador ({{telefono}}), que la web pública sustituye.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SITE_TOKEN_LABELS, badgesToTokens, hasSiteTokens, splitTokens, tokensToBadges } from "../shared/siteTokenLabels";
import { SITE_TOKENS, STARTER_PAGES } from "./_core/templates/starterSite";
import { visibleText } from "../shared/sinNayade";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("distintivos de los datos de la empresa", () => {
  it("cada dato que pueden usar las páginas tiene su distintivo en español", () => {
    expect(Object.keys(SITE_TOKEN_LABELS).sort()).toEqual([...SITE_TOKENS].sort());
    expect(SITE_TOKEN_LABELS.telefono).toBe("Teléfono de tu empresa");
    expect(SITE_TOKEN_LABELS.nif).toBe("NIF de tu empresa");
  });

  it("en el editor se ven los distintivos, no las llaves", () => {
    const html = "<ul><li>Teléfono: {{telefono}}</li><li>NIF: {{ nif }}</li></ul>";
    const shown = tokensToBadges(html);
    expect(visibleText(shown)).toBe("Teléfono: Teléfono de tu empresa NIF: NIF de tu empresa");
    expect(shown).not.toContain("{{");
    expect(shown).toContain('contenteditable="false"');
  });

  it("al guardar vuelve el marcador, también con el HTML tal y como lo devuelve el navegador", () => {
    const html = "<p>Llámanos al {{telefono}} o escribe a {{email}}.</p>";
    expect(badgesToTokens(tokensToBadges(html))).toBe(html);
    // El navegador puede reordenar atributos
    const fromBrowser = '<p>Llámanos al <span class="x" contenteditable="false" data-token="telefono">Teléfono de tu empresa</span>.</p>';
    expect(badgesToTokens(fromBrowser)).toBe("<p>Llámanos al {{telefono}}.</p>");
  });

  it("los marcadores desconocidos y el texto normal no se tocan", () => {
    expect(tokensToBadges("Hola {{desconocido}}")).toBe("Hola {{desconocido}}");
    expect(badgesToTokens("<span data-token=\"otro\">x</span>")).toBe("<span data-token=\"otro\">x</span>");
    expect(hasSiteTokens("Sin datos")).toBe(false);
  });

  it("campos de una línea: «{{nombre}}» se muestra como su distintivo", () => {
    expect(splitTokens("Bienvenido a {{nombre}}")).toEqual([{ text: "Bienvenido a " }, { token: "nombre", label: "Nombre de tu empresa" }]);
  });

  it("las páginas iniciales y legales se ven sin llaves en el editor", () => {
    for (const p of STARTER_PAGES) expect(visibleText(tokensToBadges(p.content)), p.slug).not.toMatch(/\{\{/);
  });
});

describe("editor de páginas", () => {
  it("el texto con formato pinta distintivos y guarda marcadores", () => {
    const src = read("client/src/components/admin/pageBuilder/RichTextEditor.tsx");
    expect(src).toContain("el.innerHTML = tokensToBadges(value)");
    expect(src).toContain("onChange(badgesToTokens(ref.current.innerHTML))");
  });

  it("los campos de una línea y de varias muestran cómo se verán", () => {
    const src = read("client/src/components/admin/pageBuilder/BlockEditors.tsx");
    expect(src).toContain('import { TokenInput as Input, TokenTextarea as Textarea } from "./TokenFields";');
  });

  it("el aviso de datos sin rellenar se mantiene, ya sin llaves", () => {
    const src = read("client/src/components/admin/pageBuilder/PageEditor.tsx");
    expect(src).toContain("Si falta alguno, esa línea no se");
    expect(src).not.toContain('{"{{telefono}}"}');
  });
});
