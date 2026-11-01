/**
 * Ficha comercial de Elephant People (aprobada por la dirección comercial el 01/11/2026): el texto aprobado en el
 * catálogo oficial (de donde salen las fichas de Elephant Connect) y en la especificación de la ficha pública; el precio,
 * el estado comercial y el técnico, sin cambios; y como extensión de pago para Essential, Business y Enterprise, sin
 * incluirse gratis en ningún plan (decisión definitiva del 01/11/2026).
 */
import { describe, it, expect } from "vitest";
import { PRODUCTS } from "./catalog/elephantSourceV1";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { PRODUCT_SPECS } from "./catalog/commercial/specs";
import { quoteCatalogFromSeed } from "./catalog/commercial/seedCatalog";
import { quote } from "./catalog/quote";
import { CATALOG_POLICY, PROPOSED_POLICY } from "./catalog/commercial/policy";
import { COMMERCIAL_RULES } from "./catalog/commercial/rules";
import { buildConnectCatalog } from "./connectMarketplace";
import type { PanelCatalogItemView } from "./panelModules";

const people = PRODUCTS.find((p) => p.key === "connect-people")!;
const FEATURES = [
  "Fichas de empleados y documentación",
  "Control horario y registro de fichajes",
  "Horarios semanales",
  "Gestión de ausencias",
  "Registro y consulta de nóminas",
  "Portal del empleado",
  "Acceso protegido según permisos",
];

describe("ficha de Elephant People en el catálogo oficial", () => {
  it("precio, estado comercial y técnico sin cambios: 19 €/mes + IVA, bajo solicitud, parcial", () => {
    expect(people.prices).toEqual([{ kind: "monthly", amountCents: 1900, unit: null }]);
    expect(people.draft.catalog.commercialStatus).toBe("on_request");
    expect(people.draft.technicalStatus).toBe("partial");
    expect(people.draft.catalog.capabilities).toEqual(["people-hr"]);
    expect(people.draft.catalog.scope).toBe("company");
  });

  it("texto aprobado: titular, descripción, funcionalidades, para quién y aviso de nóminas", () => {
    expect(people.draft.tagline).toBe("Gestión de empleados y control horario, integrada en tu empresa.");
    expect(people.draft.description).toContain("Organiza la información de tu equipo desde Elephant Core, sin utilizar herramientas separadas.");
    expect(people.draft.description).toContain("El precio es por empresa.");
    expect(people.draft.description).toContain("Importante: Elephant People permite registrar y consultar nóminas, pero no calcula salarios según convenios ni presenta modelos fiscales o laborales automáticamente.");
    expect(people.draft.description).toContain("La activación añadirá las funcionalidades contratadas al administrador de tu empresa.");
    expect(people.draft.includes).toEqual(FEATURES);
    expect(people.draft.requirements).toEqual(["Disponible como extensión de Elephant Connect para clientes Essential, Business y Enterprise."]);
  });

  it("la ficha pública lleva el mismo texto y no promete inclusiones en planes", () => {
    const spec = PRODUCT_SPECS.find((s) => s.key === "connect-people")!;
    expect(spec.publicContent.headline).toBe(people.draft.tagline);
    expect(spec.includes).toEqual(FEATURES);
    expect(spec.excludes).toEqual(expect.arrayContaining(["Cálculo de salarios según convenios", "Presentación automática de modelos fiscales o laborales"]));
    const all = [spec.longDescription, ...spec.capacityRules, ...spec.publicContent.benefits, spec.seo.description].join(" ");
    expect(all).not.toMatch(/incluid[oa] en (Business|Enterprise)|sin usuario|tableta/i);
  });

  it("con Essential, Business y Enterprise; ningún plan concede la licencia gratis", () => {
    expect(people.draft.compatibleWith).toEqual(["essential", "business", "enterprise"]);
    for (const tier of ["essential", "business", "enterprise"] as const) expect(capabilitiesOfTier(tier)).not.toContain("people-hr");
    // Ningún plan de la semilla lleva la capacidad ni la inclusión de People
    for (const plan of PRODUCTS.filter((p) => p.family === "core_plan")) {
      expect(plan.draft.catalog.capabilities, plan.key).not.toContain("people-hr");
      expect((plan.draft.catalog.inclusions ?? []).map((i) => i.key), plan.key).not.toContain("connect-people");
    }
    // Ni la política vigente ni la propuesta lo incluyen, y no queda ninguna regla que lo regale
    for (const pol of [CATALOG_POLICY, PROPOSED_POLICY]) expect(pol.inclusions.filter((i) => i.key === "connect-people")).toEqual([]);
    expect(COMMERCIAL_RULES.filter((r) => /people/i.test(`${r.id} ${r.title} ${r.where}`))).toEqual([]);
  });

  it("las fichas de los planes no prometen People incluido ni dan su precio", () => {
    for (const key of ["essential", "business", "enterprise"]) {
      const spec = PRODUCT_SPECS.find((s) => s.key === key)!;
      const text = [spec.longDescription, spec.problem, ...spec.includes, ...spec.capacityRules, ...spec.publicContent.benefits, spec.seo.title, spec.seo.description].join(" ");
      expect(text, key).not.toMatch(/people|gesti[oó]n del personal|gesti[oó]n de personal|empleados del tope/i);
      expect([...spec.excludes, text].join(" "), key).not.toMatch(/19\s?€/);
      expect(spec.compatibleExtensions, key).toContain("connect-people");
    }
  });
});

describe("contratación de People según el plan", () => {
  it("el cotizador la admite con Essential, Business y Enterprise y la cobra (19 €) en los tres", () => {
    const cat = quoteCatalogFromSeed();
    for (const plan of ["essential", "business", "enterprise"]) {
      const q = quote(cat, { plan, interval: "month", items: [{ key: "connect-people" }] });
      expect(q.errors, plan).toEqual([]);
      expect(q.lines.find((l) => l.key === "connect-people"), plan).toMatchObject({ status: "charged", amountCents: 1900 });
    }
    // El plan tiene que estar habilitado comercialmente: Enterprise sigue en preparación y no se contrata todavía
    const ent = quote(cat, { plan: "enterprise", interval: "month", items: [{ key: "connect-people" }] });
    expect(ent.contractable).toBe("not_available");
    expect(ent.blocking).toEqual(["Enterprise"]);
    // Essential y Business (bajo solicitud) se contratan con el equipo comercial
    for (const plan of ["essential", "business"]) expect(quote(cat, { plan, interval: "month", items: [{ key: "connect-people" }] }).contractable, plan).toBe("request");
  });

  const item = (o: Partial<PanelCatalogItemView> = {}): PanelCatalogItemView => ({
    key: "connect-people", name: "Elephant People", family: "connect", kind: "module", metric: null, step: null,
    commercialStatus: "on_request", capabilities: ["people-hr"], monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null }, purchasable: false, ...o,
  });

  it("en Elephant Connect: bajo solicitud para Essential, Business y Enterprise", () => {
    for (const plan of ["essential", "business", "enterprise"]) {
      const [p] = buildConnectCatalog({ items: [item()] }, [], Date.now(), plan);
      expect(p.state, plan).toBe("on_request");
      expect(p.plans).toEqual(["essential", "business", "enterprise"]);
      expect(p.tagline).toBe("Gestión de empleados y control horario, integrada en tu empresa.");
      expect(p.includes).toEqual(FEATURES);
    }
    // Un plan que no es de la lista (p. ej. una solución sin plan Core) no la ve como contratable
    const [other] = buildConnectCatalog({ items: [item()] }, [], Date.now(), "starter");
    expect(other.state).toBe("not_eligible");
  });
});
