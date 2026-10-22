/**
 * Web y portal de cada empresa: ningún enlace hacia la web de la instalación original (catálogo del portal de
 * colaboradores, fichas de restaurante).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../client/src", rel), "utf8");

describe("enlaces a la web de la instalación original", () => {
  it("portal de colaboradores: el catálogo es la web de la empresa", () => {
    const src = read("pages/partner/PartnerLayout.tsx");
    expect(src).toContain('const catalogUrl = neutral ? "/experiencias" : CATALOG_URL;');
    expect(src).not.toContain("href={CATALOG_URL}");
  });

  it("restaurantes: sin enlaces externos en la web neutra", () => {
    expect(read("pages/Restaurantes.tsx")).toContain("const ext = neutral ? null : restaurantExternalUrl(r.slug);");
  });
});

describe("páginas comunes sin datos de la instalación original", () => {
  it.each(["pages/MaintenanceNotice.tsx", "pages/LegoPacksList.tsx"])("%s", (file) => {
    expect(read(file)).not.toMatch(/N[aá]yade|nayade_|\blago\b/);
  });

  it("detalle de restaurante: imágenes de la instalación original solo fuera de la web neutra", () => {
    expect(read("pages/RestauranteDetail.tsx")).toContain('restaurant.heroImage || (neutral ? "" : FALLBACK_IMAGES[restaurant.slug]) || ""');
  });
});
