/**
 * «Grupos» genérica (antes «Colegios» de la instalación original): sin textos, programas, precios ni seguimiento de otra
 * empresa; las actividades ofrecidas son los productos publicados de la propia empresa.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

describe("página genérica de grupos", () => {
  const src = read("../client/src/pages/TenantGroups.tsx");

  it("sin contenidos ni identidad de otra empresa", () => {
    expect(src).not.toMatch(/n[aá]yade|skicenter|segovia|san rafael|embalse|cloudfront|Pack Náutico|26\.00/i);
  });

  it("su presentación, sus productos y su CRM", () => {
    expect(src).toContain('getTenantPage.useQuery({ slug: "colegios" }');
    expect(src).toContain("trpc.public.getExperiences.useQuery");
    expect(src).toContain("trpc.public.submitColegiosLead.useMutation");
  });

  it("sin píxel ni conversiones de la instalación (la analítica de cada web la configura su empresa)", () => {
    expect(src).not.toMatch(/fbq|generateEventId|getFbp|getFbc|eventId/);
  });

  it("rutas: /colegios y /grupos usan la versión genérica en la web de cada empresa", () => {
    const app = read("../client/src/App.tsx");
    expect(app).toContain('<Route path="/colegios">{() => <SingleOnlyPage Single={Colegios} slug="colegios" Tenant={TenantGroups} />}</Route>');
    expect(app).toContain('<Route path="/grupos">{() => <SingleOnlyPage Single={Colegios} slug="colegios" Tenant={TenantGroups} />}</Route>');
  });

  it("servidor: en multiempresa la solicitud es «Grupos», no la categoría de la instalación original", () => {
    const r = read("./routers.ts");
    const body = r.slice(r.indexOf("submitColegiosLead: publicProcedure"), r.indexOf("getPublicPage: publicProcedure"));
    expect(body).toContain('const groupCategory = isMultiTenant() ? "Grupos" : "Colegios y Campamentos";');
    expect(body.split('"Colegios y Campamentos"').length - 1).toBe(1);
  });
});
