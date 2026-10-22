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
  ])("%s pasa por SingleOnlyPage (en la web neutra, la página propia «%s» no se sirve)", (route, component, slug) => {
    const line = app.split(/\r?\n/).find((l) => l.includes(`<Route path="${route}"`));
    expect(line, route).toBeDefined();
    expect(line).toContain(`<SingleOnlyPage Single={${component}} slug="${slug}" />`);
  });

  it("SingleOnlyPage: en la web neutra, la página de la empresa (o 404); solo en la instalación propia, la original", () => {
    const body = theme.slice(theme.indexOf("export function SingleOnlyPage"), theme.indexOf("export function SlugGate"));
    expect(body).toMatch(/if \(theme\?\.neutralSite\) return <TenantPage slug=\{slug\} \/>;/);
    expect(body.indexOf("neutralSite")).toBeLessThan(body.indexOf("return <Single />"));
  });
});
