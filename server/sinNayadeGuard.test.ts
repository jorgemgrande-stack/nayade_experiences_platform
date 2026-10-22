/**
 * Guarda de independencia de Náyade en el cliente (web pública, portales y panel).
 *
 * Cuenta, por fichero, las líneas de código (sin comentarios) con datos de la instalación original: nombre, dominios,
 * email, teléfono o ubicación. Lo que queda está en páginas que solo se sirven en la instalación original (portada,
 * páginas legales, ubicaciones, colegios) o detrás de la condición de web propia (`neutral`, `neutralSite`,
 * `isTenantSite()`). La guarda es un trinquete: ningún fichero nuevo puede tenerlos, ninguno puede tener más que hoy y
 * el panel de administración ninguno. Al quitar más, baja aquí el número.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../client/src");
const ORIGINAL = /N[aá]yade|N&[aA]acute;[yY][aA][dD][eE]|nayadeexperiences|skicenter\.es|639 ?57 ?66 ?27|34639576627|San Rafael/;

const BASELINE: Record<string, number> = {
  // Solo en la instalación original o detrás de la condición de web propia
  "components/MetaPixelLoader.tsx": 1,
  "components/PublicFooter.tsx": 12,
  "components/PublicNav.tsx": 3,
  "hooks/usePublicPhone.ts": 4,
  "lib/restaurantLinks.ts": 4,
  "pages/BudgetRequest.tsx": 1,
  "pages/CanjearCupon.tsx": 1,
  "pages/Colegios.tsx": 5,
  "pages/CondicionesCancelacion.tsx": 16,
  "pages/employee/EmployeeLayout.tsx": 1,
  "pages/Experiences.tsx": 1,
  "pages/Gallery.tsx": 1,
  "pages/Home.tsx": 16,
  "pages/Hotel.tsx": 2,
  "pages/LegoPacksHome.tsx": 2,
  "pages/Locations.tsx": 13,
  "pages/partner/PartnerLayout.tsx": 2,
  "pages/PoliticaCookies.tsx": 4,
  "pages/PoliticaPrivacidad.tsx": 12,
  "pages/RestauranteDetail.tsx": 1,
  "pages/Restaurantes.tsx": 4,
  "pages/TerminosCondiciones.tsx": 18,
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function inventory(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(ROOT).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    const n = fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => ORIGINAL.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
    if (n) out[path.relative(ROOT, f).split(path.sep).join("/")] = n;
  }
  return out;
}

describe("independencia de Náyade en el cliente", () => {
  const now = inventory();

  it("el panel de administración no contiene datos de la instalación original", () => {
    expect(Object.keys(now).filter((f) => f.startsWith("pages/admin/"))).toEqual([]);
  });

  it("ningún fichero nuevo los contiene y ninguno tiene más que en la línea base", () => {
    const over = Object.entries(now)
      .filter(([f, n]) => n > (BASELINE[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} (máximo ${BASELINE[f] ?? 0})`);
    expect(over).toEqual([]);
  });
});
