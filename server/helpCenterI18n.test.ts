import { describe, expect, it } from "vitest";
import { HELP_ARTICLES, getHelpArticle, helpForLocation, searchHelp } from "../shared/helpCenter";
import { HELP_DE } from "../shared/i18n/helpCenterDe";

describe("centro de ayuda en alemán", () => {
  it("cada artículo español tiene traducción con los mismos pasos, notas y enlaces", () => {
    for (const a of HELP_ARTICLES) {
      const de = HELP_DE[a.id];
      expect(de, a.id).toBeDefined();
      expect(de.steps.length, `${a.id} pasos`).toBe(a.steps.length);
      expect(de.notes?.length ?? 0, `${a.id} notas`).toBe(a.notes?.length ?? 0);
      expect(de.links.length, `${a.id} enlaces`).toBe(a.links.length);
      expect(de.title.trim()).not.toBe("");
    }
    expect(Object.keys(HELP_DE).sort()).toEqual(HELP_ARTICLES.map((a) => a.id).sort());
  });

  it("el español es el idioma por defecto y no cambia", () => {
    expect(getHelpArticle("publicar-blog")).toBe(HELP_ARTICLES.find((a) => a.id === "publicar-blog"));
    expect(helpForLocation("/admin/cms/blog")?.id).toBe("publicar-blog");
    expect(searchHelp("")).toHaveLength(HELP_ARTICLES.length);
  });

  it("en alemán conserva ids, rutas y destinos de enlace", () => {
    const es = getHelpArticle("crear-clientes")!;
    const de = getHelpArticle("crear-clientes", "de")!;
    expect(de.id).toBe(es.id);
    expect(de.contexts).toEqual(es.contexts);
    expect(de.links.map((l) => l.href)).toEqual(es.links.map((l) => l.href));
    expect(de.title).not.toBe(es.title);
    expect(helpForLocation("/admin/crm/clientes", "", "de")?.title).toBe(de.title);
    expect(searchHelp("passwort", "de").map((a) => a.id)).toContain("recuperar-contrasena");
  });
});
