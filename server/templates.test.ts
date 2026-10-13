import { describe, it, expect } from "vitest";
import { TEMPLATES, getTemplate, renderTemplateText, validateTemplate } from "./_core/templates/catalog";

describe("plantillas iniciales", () => {
  it("hay cinco, con identificadores únicos", () => {
    expect(TEMPLATES).toHaveLength(5);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(5);
  });

  for (const t of TEMPLATES) {
    it(`${t.id}: estructura válida y sin datos de otra empresa`, () => {
      expect(validateTemplate(t)).toEqual([]);
      expect(JSON.stringify(t).toLowerCase()).not.toMatch(/náyade|nayade|skicenter/);
      expect(t.recommendedModules).toContain("cms");
    });
  }

  it("el nombre del tenant se escapa al renderizar", () => {
    expect(renderTemplateText("<h1>{{brand}}</h1>", `<img src=x onerror="a()"> & Co`)).toBe(
      "<h1>&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; Co</h1>",
    );
  });

  it("validateTemplate detecta contenido peligroso y enlaces rotos", () => {
    const bad = { ...TEMPLATES[0], pages: [{ slug: "x", title: "x", content: "<script>1</script>" }], menu: [{ label: "a", url: "/no-existe", zone: "header" as const }] };
    const p = validateTemplate(bad);
    expect(p.join(" ")).toMatch(/no seguro/);
    expect(p.join(" ")).toMatch(/inexistente/);
  });

  it("getTemplate", () => {
    expect(getTemplate("hotel")?.sector).toBe("hotel");
    expect(getTemplate("nope")).toBeUndefined();
  });
});
