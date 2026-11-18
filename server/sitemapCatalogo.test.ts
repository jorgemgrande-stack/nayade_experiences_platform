/**
 * Sitemap de una empresa multidioma con catálogo de productos por solicitud:
 *  - el catálogo (/tienda y /<idioma>/tienda) entra con sus alternativas hreflang;
 *  - los productos por solicitud entran aunque no estén «activos» (como su ficha pública); los de precio fijo, no;
 *  - la ruta genérica /contacto no se lista si la empresa tiene su propia página de contacto (kontakt, contact…).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryI18nRepo } from "./i18nMemoryRepo";
import { addLocale, sitemapAlternates, validateLocale } from "./i18nService";
import { i18nSitemapPlan } from "./sitemapI18n";
import { isContactPageSlug } from "../shared/tenantNav";

const ORIGIN = "https://web.example";

async function twoLanguages() {
  const repo = memoryI18nRepo({ pages: [], home: "inicio" });
  await addLocale(repo, "de", "ana");
  await validateLocale(repo, "de", "ana");
  return repo;
}

describe("catálogo en el sitemap", () => {
  it("una URL por idioma público, cada una con las demás y x-default como alternativas", async () => {
    const repo = await twoLanguages();
    const plan = await i18nSitemapPlan(repo, ORIGIN, [], { catalog: true });
    expect(plan?.alternatesFor.get("/tienda")?.map((a) => [a.hreflang, a.href])).toEqual([
      ["es", `${ORIGIN}/tienda`],
      ["de", `${ORIGIN}/de/tienda`],
      ["x-default", `${ORIGIN}/tienda`],
    ]);
    expect(plan?.extra.map((x) => x.loc)).toEqual(["/de/tienda"]);
  });

  it("sin la opción del catálogo, el sitemap multidioma es el de siempre; con un solo idioma, nada", async () => {
    const repo = await twoLanguages();
    expect(await i18nSitemapPlan(repo, ORIGIN, [])).toBeNull();
    const single = memoryI18nRepo({ pages: [], home: "inicio" });
    expect(await i18nSitemapPlan(single, ORIGIN, [], { catalog: true })).toBeNull();
    expect((await sitemapAlternates(single, [], { catalog: true })).entries).toEqual([]);
  });

  it("un idioma sin validar no entra", async () => {
    const repo = memoryI18nRepo({ pages: [], home: "inicio" });
    await addLocale(repo, "de", "ana");
    const plan = await i18nSitemapPlan(repo, ORIGIN, [], { catalog: true });
    expect(plan).toBeNull();
  });
});

describe("página propia de contacto", () => {
  it("se reconoce en los idiomas de las webs de empresa", () => {
    for (const s of ["contacto", "kontakt", "contact", "contatto", "contato", "Kontakt"]) expect(isContactPageSlug(s)).toBe(true);
    for (const s of ["contacto-comercial", "ueber-mich", "inicio", ""]) expect(isContactPageSlug(s)).toBe(false);
  });
});

describe("consulta de productos del sitemap", () => {
  const src = fs.readFileSync(path.join(__dirname, "sitemapRouter.ts"), "utf8");
  it("en multiempresa: activos o por solicitud (misma regla que la ficha pública), nunca borradores", () => {
    expect(src).toContain('multi ? or(eq(experiences.isActive, true), inArray(experiences.offerMode, ["on_request", "priced_request", "coming_soon"])) : eq(experiences.isActive, true)');
    expect(src).toContain("eq(experiences.isPublished, true)");
  });
  it("el catálogo se anuncia solo en la tienda de una pyme con productos, y /contacto se omite con página propia", () => {
    expect(src).toContain('{ catalog: catalogKind === "generic" && expRows.length > 0 }');
    expect(src).toContain('if (u.path === "/contacto" && ownContact) continue;');
  });
});

describe("título de la ficha en el idioma principal", () => {
  it("el servidor web usa el título y la descripción del propio producto cuando no hay traducción", () => {
    const vite = fs.readFileSync(path.join(__dirname, "_core/vite.ts"), "utf8");
    expect(vite).toContain('if (i18n?.kind === "product" && !i18n.meta) {');
    expect(vite).toContain("getExperienceBySlug(i18n.principalSlug)");
    expect(vite).toContain("pageMetaOverride({ title: e.title, metaTitle: e.metaTitle, metaDescription: e.metaDescription ?? e.shortDescription }, brandName, false)");
  });
});

describe("pantallas genéricas de la plataforma", () => {
  const src = fs.readFileSync(path.join(__dirname, "sitemapRouter.ts"), "utf8");
  it("el plan multidioma informa del idioma principal", async () => {
    const repo = await twoLanguages();
    expect((await i18nSitemapPlan(repo, ORIGIN, [], { catalog: true }))?.defaultLocale).toBe("es");
    const de = memoryI18nRepo({ pages: [], home: "inicio" });
    await de.insertLocale({ locale: "de", isDefault: true, status: "validated", sortOrder: 0 });
    await addLocale(de, "es", "ana");
    await validateLocale(de, "es", "ana");
    expect((await i18nSitemapPlan(de, ORIGIN, [], { catalog: true }))?.defaultLocale).toBe("de");
  });
  it("/presupuesto y /ubicaciones solo se listan con el español como principal; /blog solo con entradas", () => {
    expect(src).toContain('const genericUi = !i18nPlan || i18nPlan.defaultLocale === "es";');
    expect(src).toContain('if (site.quotes && genericUi) add("/presupuesto"');
    expect(src).toContain('if (locationRows.length > 0 && genericUi) add("/ubicaciones"');
    expect(src).toContain("for (const r of genericUi ? locationRows : []) {");
    expect(src).toContain("if (blogRows && blogRows.length > 0) {");
  });
});
