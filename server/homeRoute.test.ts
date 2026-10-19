/**
 * Portada de una empresa (client/src/lib/homeRoute.ts). Regresión del 19/10/2026: toda empresa recién dada de alta
 * (sin página «inicio» publicada) mostraba un 404 en https://<empresa>.app.bigelephant.es/.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HOME_PAGE_SLUG, HOME_WITHOUT_PAGE, resolveHome } from "../client/src/lib/homeRoute";

describe("portada de una empresa", () => {
  it("empresa nueva sin página «inicio»: lleva a su inicio de sesión, nunca a un 404", () => {
    expect(resolveHome({ themeLoading: false, neutralSite: true, pageLoading: false, hasPage: false })).toEqual({ kind: "redirect", to: "/login" });
    expect(HOME_WITHOUT_PAGE).toBe("/login");
  });

  it("con página «inicio» publicada: la muestra", () => {
    expect(resolveHome({ themeLoading: false, neutralSite: true, pageLoading: false, hasPage: true })).toEqual({ kind: "page" });
    expect(HOME_PAGE_SLUG).toBe("inicio");
  });

  it("mientras carga no decide; sin web neutra (un solo tenant) mantiene la portada de siempre", () => {
    expect(resolveHome({ themeLoading: true, neutralSite: false, pageLoading: false, hasPage: false }).kind).toBe("loading");
    expect(resolveHome({ themeLoading: false, neutralSite: true, pageLoading: true, hasPage: false }).kind).toBe("loading");
    expect(resolveHome({ themeLoading: false, neutralSite: false, pageLoading: false, hasPage: false }).kind).toBe("fallback");
  });

  it("la portada («/») usa esta decisión y la ruta /login existe", () => {
    const theme = fs.readFileSync(path.resolve(__dirname, "../client/src/components/TenantTheme.tsx"), "utf8");
    expect(theme).toMatch(/export function HomeGate[\s\S]*resolveHome\(/);
    expect(theme).toMatch(/view\.kind === "redirect"\) return <Redirect to=\{view\.to\}/);
    const app = fs.readFileSync(path.resolve(__dirname, "../client/src/App.tsx"), "utf8");
    expect(app).toMatch(/<Route path="\/">\{\(\) => <HomeGate /);
    expect(app).toMatch(/<Route path="\/login" component=\{Login\} \/>/);
  });
});
