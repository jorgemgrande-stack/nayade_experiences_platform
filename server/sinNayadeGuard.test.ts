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
import { ORIGINAL } from "../shared/sinNayade";

const ROOT = path.join(__dirname, "../client/src");

const BASELINE: Record<string, number> = {
  // Solo en la instalación original o detrás de la condición de web propia
  "components/PublicFooter.tsx": 12,
  "components/PublicNav.tsx": 3,
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

/**
 * Vocabulario de la instalación propia y jerga técnica en el panel (trinquete). Jerga de desarrollo que nunca debe
 * verse, y textos sectoriales (reservas, experiencias, bonos) que en una pyme deben salir del vocabulario
 * (`shared/vocabulary.ts`) o de una condición de capacidad: aquí se cuenta cuántas veces aparecen como texto fijo.
 */
describe("vocabulario sectorial y jerga en el panel", () => {
  const PANEL = [path.join(ROOT, "pages/admin"), path.join(ROOT, "components/brand")];
  const HELP = fs.readFileSync(path.join(__dirname, "../shared/helpCenter.ts"), "utf8");
  const panelFiles = PANEL.flatMap(walk).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
  const count = (text: string, re: RegExp) => text.split(/\r?\n/).filter((l) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;

  it("sin jerga de desarrollo en textos del panel ni en la ayuda", () => {
    const JARGON = /\bBookingModal\b|modal de reserva|propio tenant|del tenant\b/;
    expect(panelFiles.filter((f) => count(fs.readFileSync(f, "utf8"), JARGON) > 0).map(rel)).toEqual([]);
    expect(count(HELP, JARGON)).toBe(0);
  });

  // Textos sectoriales fijos que se han sustituido por el vocabulario: no pueden volver a aparecer sin condición
  // (no cuentan las líneas que ya eligen el texto según `licensed`)
  const SECTORAL: Array<[string, RegExp, number]> = [
    ["pages/admin/products/VariantsManager.tsx", /Todas las experiencias|Selecciona una experiencia"|placeholder="(Filtrar por|Seleccionar) experiencia"|<Label>Experiencia \*<\/Label>/, 0],
    ["pages/admin/cms/HomeModulesManager.tsx", /Nuestras Experiencias/, 1],
    ["pages/admin/tpv/TpvScreen.tsx", /Fecha del servicio/, 1],
    // Formularios del catálogo: los ejemplos y valores de partida salen de `voc.catalog`
    ["pages/admin/products/CategoriesManager.tsx", /Deportes Acu[aá]ticos|Nueva Categor[ií]a|Editar Categor[ií]a/, 0],
    ["pages/admin/products/LocationsManager.tsx", /Embarcadero|Ubicaci[oó]n/, 0],
    ["pages/admin/products/VariantsManager.tsx", /Grupo 10 pax|mayores de 14 años|Variantes de Precio|Variantes y Precios/, 0],
    ["pages/admin/products/ExperiencesManager.tsx", /Destacado en Home|Descripci[oó]n Corta|Descripci[oó]n Completa|Guardar Cambios/, 0],
    ["components/CatalogConceptSelector.tsx", /toFixed\(2\)\} €/, 0],
    ["pages/admin/crm/CRMDashboard.tsx", /Fecha de servicio \(opcional\)|"oportunidades en total" :|ganadas de \{/, 0],
  ];
  it.each(SECTORAL)("%s: textos sectoriales fijos dentro de la línea base", (file, re, max) => {
    const unguarded = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/).filter((l) => !/licensed/.test(l)).join("\n");
    expect(count(unguarded, re)).toBeLessThanOrEqual(max);
  });

  it("formularios del catálogo de una pyme: sin ejemplos sectoriales ni valores de partida de la instalación original", async () => {
    const { buildVocabulary } = await import("../shared/vocabulary");
    const { restosEn } = await import("../shared/sinNayade");
    const v = buildVocabulary({ licensed: true, can: () => false });
    const texts = Object.values(v.catalog).filter((x) => typeof x === "string").join(" | ");
    expect(texts).not.toMatch(/acu[aá]tic|embarcadero|\bpax\b|mayores de \d+ años|Home/i);
    expect(restosEn(texts)).toEqual([]);
    expect(v.catalog.defaultProductType).toBe("own");
    expect(v.catalog.defaultVariantPriceType).toBe("fixed");
    expect(v.productTypes[0]).toEqual({ value: "own", label: "Producto" });
    // El formulario de producto los usa al crear y en la etiqueta del destacado
    const exp = fs.readFileSync(path.join(ROOT, "pages/admin/products/ExperiencesManager.tsx"), "utf8");
    expect(exp).toContain("newProductDefaults({ licensed: isNewCompany, can: sub.can })");
    expect(exp).toContain("{voc.catalog.featured}");
    // Constructor de presupuestos: sin la pestaña «Paquetes» en una pyme
    expect(fs.readFileSync(path.join(ROOT, "components/CatalogConceptSelector.tsx"), "utf8")).toContain("{!voc.licensed && <div className=\"flex gap-2 flex-wrap\">");
  });

  it("los textos sectoriales que quedan van detrás del vocabulario o de una capacidad", () => {
    expect(fs.readFileSync(path.join(ROOT, "pages/admin/cms/HomeModulesManager.tsx"), "utf8")).toContain("GENERIC_LABELS[m.key]");
    expect(fs.readFileSync(path.join(ROOT, "pages/admin/tpv/TpvScreen.tsx"), "utf8")).toContain('can("bookings-generic")');
  });

  it("la ayuda describe el panel de una pyme (pedidos, no reservas)", () => {
    expect(count(HELP, /«Reservas»|«Nueva Reserva»|«Crear Reserva»|«Experiencia o pack»/)).toBe(0);
  });
});
