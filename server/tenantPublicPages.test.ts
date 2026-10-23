/**
 * Web pública de cada empresa: las páginas legales y de marketing escritas a mano para la instalación original nunca
 * se sirven en la web neutra de otra empresa (pasan por SingleOnlyPage, que muestra la página propia del CMS o 404).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const app = fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8");
const theme = fs.readFileSync(path.join(__dirname, "../client/src/components/TenantTheme.tsx"), "utf8");

describe("páginas propias de la instalación original en la web de cada empresa", () => {
  it.each([
    ["/privacidad", "PoliticaPrivacidad", "politica-de-privacidad"],
    ["/terminos", "TerminosCondiciones", "terminos"],
    ["/cookies", "PoliticaCookies", "politica-de-cookies"],
    ["/condiciones-cancelacion", "CondicionesCancelacion", "condiciones-cancelacion"],
    ["/colegios", "Colegios", "colegios"],
    ["/ubicaciones", "Locations", "ubicaciones"],
    ["/ubicaciones/:slug", "Locations", "ubicaciones"],
  ])("%s pasa por SingleOnlyPage (en la web neutra, la página propia «%s» no se sirve)", (route, component, slug) => {
    const line = app.split(/\r?\n/).find((l) => l.includes(`<Route path="${route}"`));
    expect(line, route).toBeDefined();
    // Sin `Tenant`, la página propia del CMS; con `Tenant`, la versión genérica alimentada con los datos de la empresa
    expect(line).toMatch(new RegExp(`<SingleOnlyPage Single=\\{${component}\\} slug="${slug}"( Tenant=\\{Tenant[A-Za-z]+\\})? />`));
  });

  it("SingleOnlyPage: en la web neutra, la página de la empresa (o 404); solo en la instalación propia, la original", () => {
    const body = theme.slice(theme.indexOf("export function SingleOnlyPage"), theme.indexOf("export function SlugGate"));
    expect(body).toMatch(/if \(theme\?\.neutralSite\) return Tenant \? <Tenant \/> : <TenantPage slug=\{slug\} \/>;/);
    expect(body.indexOf("neutralSite")).toBeLessThan(body.indexOf("return <Single />"));
  });

  it.each(["Hotel.tsx", "Restaurantes.tsx", "LegoPacksHome.tsx"])("%s: los textos de la instalación original solo fuera de la web neutra", (file) => {
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages", file), "utf8");
    expect(src).toContain("const neutral = theme?.neutralSite ?? true;");
    for (const line of src.split(/\r?\n/).filter((l) => /N[aá]yade|San Rafael/.test(l) && !/^\s*\/\//.test(l))) {
      // Texto alternativo según la web, imagen solo fuera de la web neutra, o dato de packs destacados (bloque oculto)
      expect(line, line.trim()).toMatch(/neutral \?|: "|\{!neutral && [<"]|^\s*featured: \[/);
    }
  });

  it("LegoPacksHome: los packs destacados de la instalación original no se muestran en la web neutra", () => {
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/LegoPacksHome.tsx"), "utf8");
    const i = src.indexOf("cat.featured.map");
    expect(src.lastIndexOf("{!neutral && (", i)).toBeGreaterThan(src.lastIndexOf("</ul>", i));
  });
});
