/**
 * Portada genérica de cada empresa: solo su carrusel, su página «inicio» y sus productos destacados.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveHome } from "../client/src/lib/homeRoute";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

describe("portada genérica", () => {
  const src = read("../client/src/pages/TenantHome.tsx");

  it("sin contenidos, imágenes, promociones ni identidad de otra empresa", () => {
    expect(src).not.toMatch(/n[aá]yade|skicenter|segovia|embalse|cloudfront|lego|temporada|10% dto/i);
  });

  it("sus datos: página «inicio», carrusel y destacados", () => {
    expect(src).toContain("getTenantPage.useQuery({ slug: HOME_PAGE_SLUG }");
    expect(src).toContain("trpc.public.getSlideshowItems.useQuery");
    expect(src).toContain("trpc.public.getFeaturedExperiences.useQuery");
  });

  it("el botón de la cabecera solo enlaza rutas propias o https (nunca javascript:)", () => {
    expect(src).toContain("const isSafeUrl = (u?: string | null): u is string => !!u && (/^\\/(?!\\/)/.test(u) || /^https:\\/\\//.test(u));");
  });

  it("«/» en la web de cada empresa usa la portada genérica; la instalación original conserva la suya", () => {
    expect(read("../client/src/App.tsx")).toContain('<HomeGate Fallback={Home} Tenant={TenantHome} />');
    expect(read("../client/src/components/TenantTheme.tsx")).toContain('if (view.kind === "page") return Tenant ? <Tenant /> : <TenantPage slug={HOME_PAGE_SLUG} />;');
    // Sin página «inicio» publicada, se mantiene el acceso al panel (nada ajeno)
    expect(resolveHome({ themeLoading: false, neutralSite: true, pageLoading: false, hasPage: false })).toEqual({ kind: "redirect", to: "/login" });
    expect(resolveHome({ themeLoading: false, neutralSite: false, pageLoading: false, hasPage: false })).toEqual({ kind: "fallback" });
  });
});
