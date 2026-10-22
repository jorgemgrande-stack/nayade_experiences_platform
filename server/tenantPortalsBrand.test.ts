/**
 * Portales de empleados y de gestoría y cabeceras de «Experiencias» y «Galería»: con el nombre, el logo y la imagen
 * de la empresa en su web; los de la instalación original solo fuera de la web neutra.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../client/src/pages", rel), "utf8");

describe("portales y cabeceras con la marca de la empresa", () => {
  it.each(["employee/EmployeePortal.tsx", "gestoria/GestoriaPortal.tsx"])("%s: sin el nombre de la instalación original", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/N[aá]yade/);
    expect(src).toContain("usePublicContact()");
  });

  it("portal de empleados: logo y nombre de la empresa", () => {
    const src = read("employee/EmployeeLayout.tsx");
    expect(src).toContain('(publicSettings as any)?.brand_logo_url || (neutral ? "" : LOGO_FALLBACK)');
    expect(src).not.toMatch(/N[aá]yade Experiences|Llamar a N[aá]yade/);
  });

  it.each(["Experiences.tsx", "Gallery.tsx"])("%s: la imagen de la instalación original solo fuera de la web neutra", (file) => {
    const src = read(file);
    expect(src).toContain("{neutral ? (\n          heroImage && <img src={heroImage} alt={brandName}".replace(/\n/g, src.includes("\r\n") ? "\r\n" : "\n"));
    expect(src).not.toContain('"Foto Náyade"');
  });
});
