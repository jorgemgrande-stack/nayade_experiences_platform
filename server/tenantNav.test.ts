/**
 * Web de cada empresa: los textos legales de las plantillas se siembran como borrador y la navegación pública no
 * enlaza páginas sin publicar.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./_core/templates/catalog";
import { LEGAL_PAGE_SLUGS, LEGAL_PLACEHOLDER_MARKERS, hideUnpublishedPageLinks, isLegalPageSlug, isLegalPlaceholder, pageSlugOfUrl } from "../shared/tenantNav";

describe("plantillas: textos legales en borrador", () => {
  it("toda página legal de toda plantilla se siembra sin publicar; el resto sí se publica", () => {
    for (const t of TEMPLATES) {
      const legal = t.pages.filter((p) => isLegalPageSlug(p.slug));
      expect(legal.length, t.id).toBeGreaterThan(0);
      for (const p of legal) expect(p.draft, `${t.id}/${p.slug}`).toBe(true);
      for (const p of t.pages.filter((p) => !isLegalPageSlug(p.slug))) expect(p.draft ?? false, `${t.id}/${p.slug}`).toBe(false);
    }
  });

  it("el alta respeta el borrador al sembrar (isPublished según la plantilla)", () => {
    const src = fs.readFileSync(new URL("./_core/provisioning/mysqlAdapters.ts", import.meta.url), "utf8");
    expect(src).toContain("p.draft ? 0 : 1");
    expect(src).not.toMatch(/INSERT IGNORE INTO static_pages[^"]*VALUES \(\?,\?,\?,\?,\?,1\)/);
  });
});

describe("textos legales de relleno (empresas dadas de alta antes)", () => {
  it("cada texto legal de plantilla lleva una frase de relleno reconocible", () => {
    for (const t of TEMPLATES) for (const p of t.pages.filter((p) => isLegalPageSlug(p.slug))) {
      expect(LEGAL_PLACEHOLDER_MARKERS.some((m) => p.content.includes(m)), `${t.id}/${p.slug}`).toBe(true);
      expect(isLegalPlaceholder(p.slug, p.content)).toBe(true);
    }
  });

  it("un texto redactado por la empresa, o una página que no es legal, se sirve", () => {
    expect(isLegalPlaceholder("aviso-legal", "<p>Titular: Empresa SL, NIF B12345678</p>")).toBe(false);
    expect(isLegalPlaceholder("inicio", "<p>Complete este texto con su política</p>")).toBe(false);
    expect(isLegalPlaceholder("aviso-legal", null)).toBe(false);
  });
});

describe("enlaces a páginas de la empresa", () => {
  it("reconoce «/slug» (con alias de rutas cortas) y descarta lo que no es una página", () => {
    expect(pageSlugOfUrl("/aviso-legal")).toBe("aviso-legal");
    expect(pageSlugOfUrl("/privacidad")).toBe("politica-de-privacidad");
    expect(pageSlugOfUrl("/cookies?x=1")).toBe("politica-de-cookies");
    expect(pageSlugOfUrl("/quienes-somos/")).toBe("quienes-somos");
    for (const u of [null, "", "/", "/blog/entrada", "https://otra.example/aviso-legal", "#ancla"]) expect(pageSlugOfUrl(u)).toBeNull();
  });

  it("quita los enlaces a borradores y sus submenús; deja el resto", () => {
    const items = [
      { id: 1, url: "/inicio", parentId: null },
      { id: 2, url: "/aviso-legal", parentId: null },
      { id: 3, url: "/privacidad", parentId: null },
      { id: 4, url: "/experiencias", parentId: null },
      { id: 5, url: "/sub", parentId: 2 },
      { id: 6, url: "https://externo.example", parentId: null },
    ];
    const out = hideUnpublishedPageLinks(items, new Set(["aviso-legal", "politica-de-privacidad"]));
    expect(out.map((i) => i.id)).toEqual([1, 4, 6]);
    expect(hideUnpublishedPageLinks(items, new Set())).toHaveLength(items.length);
  });

  it("lista de páginas legales", () => {
    expect(LEGAL_PAGE_SLUGS).toContain("aviso-legal");
    expect(isLegalPageSlug("inicio")).toBe(false);
  });
});

describe("web de una empresa sin contenido ajeno", () => {
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  it("sin menú propio no se muestra el menú de respaldo de la instalación", () => {
    const nav = read("../client/src/components/PublicNav.tsx");
    const i = nav.indexOf("const navLinks");
    const body = nav.slice(i, i + 600);
    expect(body).toMatch(/neutralSite[\s\S]*return \[\];[\s\S]*FALLBACK_NAV/);
  });

  it("el pie usa el menú de pie de la propia empresa, sin enlaces legales fijos", () => {
    const t = read("../client/src/components/TenantTheme.tsx");
    const footer = t.slice(t.indexOf("export function TenantFooter"), t.indexOf("function Spinner"));
    expect(footer).toContain('getMenuItems.useQuery({ zone: "footer" }');
    expect(footer).not.toContain('href="/aviso-legal"');
    expect(footer).not.toContain('href="/politica-de-privacidad"');
  });
});
